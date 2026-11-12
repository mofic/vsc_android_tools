'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
function quote(value) { return "'" + String(value).replace(/'/g, "'\\''") + "'"; }
function remotePath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || /[\x00-\x1f\x7f]/.test(value) || value.split('/').includes('..')) throw new Error('设备路径必须是绝对路径，且不含 .. 或控制字符');
  return path.posix.normalize(value);
}
function filename(value) {
  if (!value || value === '.' || value === '..' || /[/\x00-\x1f\x7f]/.test(value)) throw new Error('无效文件名');
  return value;
}
function devices(output) {
  return output.split(/\r?\n/).slice(1).filter(x => x.trim()).map(line => {
    const [serial, state, ...info] = line.trim().split(/\s+/);
    return { serial, state, model: (info.find(x => x.startsWith('model:')) || '').slice(6).replace(/_/g, ' ') };
  });
}
function run(binary, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd: options.cwd, windowsHide: true, shell: false });
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    let stdout = '', stderr = '', settled = false;
    const finish = (error) => { if (settled) return; settled = true; clearTimeout(timer); subscription?.dispose(); error ? reject(error) : resolve(stdout); };
    const timer = setTimeout(() => { child.kill(); finish(new Error('命令超时')); }, options.timeout || 120000);
    const subscription = options.token?.onCancellationRequested(() => { child.kill(); finish(new Error('操作已取消')); });
    child.stdout.on('data', b => { stdout += b; options.onOutput?.(b.toString()); if (stdout.length > 32 * 1024 * 1024) { child.kill(); finish(new Error('输出超过 32MB')); } });
    child.stderr.on('data', b => { stderr = (stderr + b).slice(-65536); options.onOutput?.(b.toString()); });
    child.on('error', finish);
    child.on('close', code => finish(code === 0 ? null : new Error(stderr || stdout || `命令退出 ${code}`)));
    if (options.token?.isCancellationRequested) { child.kill(); finish(new Error('操作已取消')); }
  });
}
class Adb {
  constructor(binary) { this.binary = binary; }
  exec(serial, args, options) { return run(this.binary(), serial ? ['-s', serial, ...args] : args, options); }
  shell(serial, args, options) { return this.exec(serial, ['shell', args.map(quote).join(' ')], options); }
  async list(serial, dir) {
    const directory = remotePath(dir);
    const script = `cd ${quote(directory)} || exit 1
[ -r . ] && [ -x . ] || { echo 'Permission denied' >&2; exit 1; }
for entry in .[!.]* ..?* *; do
  [ -e "$entry" ] || [ -L "$entry" ] || continue
  target=''; kind=F
  if [ -L "$entry" ]; then
    target=$(readlink -f -- "$entry") || target=$(readlink -- "$entry") || exit 1
    if [ -d "$entry" ]; then kind=LD; else kind=LF; fi
  elif [ -d "$entry" ]; then kind=D; fi
  printf '%s\\000%s\\000%s\\000' "$kind" "$entry" "$target"
done`;
    const fields = (await this.exec(serial, ['shell', script])).split('\0');
    const entries = [];
    for (let i = 0; i + 2 < fields.length; i += 3) {
      const [kind, name, target] = fields.slice(i, i + 3);
      filename(name);
      entries.push({ name, directory: kind === 'D' || kind === 'LD', symlink: kind.startsWith('L'), target: target ? remotePath(path.posix.resolve(directory, target)) : undefined });
    }
    return entries.sort((a,b) => Number(b.directory)-Number(a.directory) || a.name.localeCompare(b.name));
  }
}
const excluded = new Set(['node_modules', '.git', '.gradle', '.idea', 'build', '.dart_tool']);
async function discover(roots, depth = 4) {
  const found = [];
  async function visit(dir, level) {
    let entries; try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    if (entries.some(e => /^settings\.gradle(\.kts)?$/.test(e.name))) { found.push(dir); return; }
    if (level < depth) for (const entry of entries) if (entry.isDirectory() && !excluded.has(entry.name)) await visit(path.join(dir, entry.name), level + 1);
  }
  for (const root of roots) await visit(root, 0);
  return [...new Set(found)];
}
async function artifacts(project) {
  const result = [];
  async function visit(dir, depth) {
    if (depth > 12) return;
    let entries; try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const target = path.join(dir, e.name);
      if (e.isDirectory() && !['.git', '.gradle', 'node_modules'].includes(e.name)) await visit(target, depth + 1);
      else if (e.name === 'output-metadata.json') {
        const data = JSON.parse(await fs.readFile(target, 'utf8'));
        for (const item of data.elements || []) {
          const apk = path.resolve(dir, item.outputFile || '');
          if (!apk.startsWith(path.resolve(project) + path.sep) || !apk.endsWith('.apk')) continue;
          result.push({ apk, packageName: data.applicationId, variant: data.variantName, filters: item.filters || [] });
        }
      }
    }
  }
  await visit(project, 0); return result;
}
function packageName(value) {
  if (!/^[A-Za-z_][\w]*(\.[A-Za-z_][\w]*)+$/.test(value || '')) throw new Error('无效 Android 包名');
  return value;
}
function parseLog(line) {
  const match = line.match(/^\s*\d+-\d+\s+[\d:.]+\s+(\d+)\s+\d+\s+([VDIWEF])\s+([^:]+):\s?(.*)$/);
  return match ? { line, pid: match[1], level: match[2], tag: match[3].trim(), message: match[4] } : { line, level: 'I', tag: '', pid: '' };
}
function filterLog(entry, filter, pids) {
  if ('VDIWEF'.indexOf(entry.level) < 'VDIWEF'.indexOf(filter.level || 'V')) return false;
  if (filter.tag && !entry.tag.includes(filter.tag)) return false;
  if (pids && !pids.has(entry.pid)) return false;
  if (!filter.text) return true;
  return filter.regex ? new RegExp(filter.text, 'i').test(entry.line) : entry.line.toLowerCase().includes(filter.text.toLowerCase());
}
module.exports = { quote, remotePath, filename, devices, run, Adb, discover, artifacts, packageName, parseLog, filterLog };
