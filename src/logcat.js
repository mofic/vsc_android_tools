'use strict';
const v = require('vscode');
const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');
const { randomBytes } = require('node:crypto');
const path = require('node:path');
const { parseLog, filterLog, packageName, importLogs } = require('./core');
let nextSession = 1;
async function importLogcat(ctx, adb, error) {
  const uri = (await v.window.showOpenDialog({ canSelectMany: false, canSelectFiles: true, canSelectFolders: false, filters: { '日志文件': ['log', 'txt'], '所有文件': ['*'] }, title: '导入 Logcat 日志（UTF-8，最大 32MB）' }))?.[0];
  if (!uri) return;
  const max = 32 * 1024 * 1024;
  if ((await v.workspace.fs.stat(uri)).size > max) throw new Error('日志超过 32MB，请拆分后导入');
  const bytes = await v.workspace.fs.readFile(uri);
  if (bytes.byteLength > max) throw new Error('日志超过 32MB，请拆分后导入');
  const source = { name: path.basename(uri.fsPath), ...importLogs(Buffer.from(bytes).toString('utf8')) };
  return openLogcat(ctx, adb, undefined, error, source);
}
function openLogcat(ctx, adb, serial, error, source, column = v.ViewColumn.Active) {
  const panel = v.window.createWebviewPanel('androidLogcat', `Logcat #${nextSession++} · ${source ? source.name : serial}`, column, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [v.Uri.joinPath(ctx.extensionUri, 'media')] });
  const nonce = randomBytes(16).toString('hex');
  const script = panel.webview.asWebviewUri(v.Uri.joinPath(ctx.extensionUri, 'media', 'logcat.js'));
  const style = panel.webview.asWebviewUri(v.Uri.joinPath(ctx.extensionUri, 'media', 'logcat.css'));
  const offline = source ? 'disabled' : '';
  panel.webview.html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${panel.webview.cspSource}; script-src 'nonce-${nonce}'"><link rel="stylesheet" href="${style}"></head><body><header><button id="newTab" title="为当前设备或日志新建独立标签页">新建标签页</button><button id="split" title="在旁边打开独立 Logcat">分屏</button><label>级别 <select id="level"><option>V</option><option>D</option><option>I</option><option>W</option><option>E</option><option>F</option></select></label><label>关键词 <input id="text" placeholder="过滤内容"></label><label><input id="regex" type="checkbox">正则</label><label>Tag <input id="tag"></label><label>包名 <input id="package" ${offline} title="包名过滤需要实时设备进程信息" placeholder="留空显示全部进程"></label><button id="apply">应用过滤</button><button id="pause" ${offline}>暂停</button><label><input id="scroll" type="checkbox" checked>自动滚动</label><button id="clear">清空视图</button><button id="deviceClear" ${offline}>清除设备日志</button><button id="copy">复制</button><button id="import">导入</button><button id="export">导出</button><button id="restart" ${offline}>重连</button></header><p id="status" role="status">连接中…</p><main id="logs" tabindex="0" aria-label="Logcat 日志"></main><script nonce="${nonce}" src="${script}"></script></body></html>`;
  let lines = source?.entries.slice() || [], filter = { level: 'V' }, pids, child, partial = '', paused = false, disposed = false, changed = true, packageId = '', checking = false;
  const send = message => { if (!disposed) panel.webview.postMessage(message); };
  function filtered() { return lines.filter(entry => filterLog(entry, filter, pids)); }
  function start() {
    if (!serial) return;
    child?.kill(); partial = '';
    const process = spawn(adb.binary(), ['-s', serial, 'logcat', '-v', 'threadtime'], { windowsHide: true }); child = process; const decoder = new StringDecoder('utf8');
    send({ type: 'status', text: '已连接 · 最多保留 10000 行' });
    process.stdout.on('data', chunk => {
      if (child !== process) return;
      partial += decoder.write(chunk); const entries = partial.split(/\r?\n/); partial = entries.pop().slice(-65536);
      lines.push(...entries.map(parseLog)); if (lines.length > 10000) lines.splice(0, lines.length - 10000); changed = true;
    });
    process.stderr.on('data', chunk => send({ type: 'status', text: chunk.toString() }));
    process.on('error', e => send({ type: 'status', text: e.message }));
    process.on('close', () => { if (child === process) send({ type: 'status', text: '连接已结束，可点击重连' }); });
  }
  const render = setInterval(() => { if (!paused && changed) { send({ type: 'lines', lines: filtered() }); changed = false; } }, 400);
  const track = setInterval(async () => {
    if (!serial || !packageId || checking) return; checking = true;
    const current = packageId;
    try { const result = await adb.shell(serial, ['ps', '-A', '-o', 'PID,NAME'], { timeout: 3000 }); if (current === packageId) { pids = new Set(result.split(/\r?\n/).map(line => line.trim().split(/\s+/)).filter(([, name]) => name === current || name?.startsWith(current + ':')).map(([pid]) => pid)); changed = true; } }
    catch { if (current === packageId) { pids = new Set(); changed = true; } }
    finally { checking = false; }
  }, 1500);
  panel.webview.onDidReceiveMessage(async message => {
    if (disposed) return;
    try {
      switch (message.type) {
        case 'ready':
          if (source) { send({ type: 'status', text: `已导入 ${source.name} · ${source.total} 行${source.total > lines.length ? `，显示最后 ${lines.length} 行` : ''} · 离线模式` }); send({ type: 'lines', lines: filtered() }); changed = false; }
          else start(); break;
        case 'newTab': openLogcat(ctx, adb, serial, error, source); break;
        case 'split': openLogcat(ctx, adb, serial, error, source, v.ViewColumn.Beside); break;
        case 'import': await importLogcat(ctx, adb, error); break;
        case 'restart': start(); break;
        case 'filter': {
          const f = message.filter;
          if (!f || typeof f.text !== 'string' || f.text.length > 300 || typeof f.tag !== 'string' || !/^[VDIWEF]$/.test(f.level)) throw new Error('无效过滤条件');
          if (f.regex && /\([^)]*[+*][^)]*\)[+*{]/.test(f.text)) throw new Error('请避免嵌套重复的正则表达式');
          if (f.regex) new RegExp(f.text);
          const next = String(f.package || '').trim(); if (next) { if (!serial) throw new Error('离线日志不支持按设备包名过滤，请使用关键词或 Tag'); packageName(next); }
          filter = { text: f.text, regex: !!f.regex, tag: f.tag, level: f.level }; packageId = next; pids = next ? new Set() : undefined; changed = true;
          send({ type: 'status', text: next ? `跟踪 ${next}，等待匹配进程…` : '过滤已应用' }); break;
        }
        case 'pause': paused = !paused; send({ type: 'paused', value: paused }); changed = true; break;
        case 'clear': lines = []; changed = true; send({ type: 'lines', lines: [] }); break;
        case 'deviceClear':
          if (!serial) return;
          if (!v.workspace.isTrusted) throw new Error('请先信任工作区');
          if (await v.window.showWarningMessage(`清除 ${serial} 的设备日志缓冲区？`, { modal: true }, '确认') === '确认') await adb.exec(serial, ['logcat', '-c']); break;
        case 'copy': await v.env.clipboard.writeText(filtered().map(x => x.line).join('\n')); break;
        case 'export': { const uri = await v.window.showSaveDialog({ defaultUri: v.Uri.file(`logcat-${Date.now()}.txt`) }); if (uri) await v.workspace.fs.writeFile(uri, Buffer.from(filtered().map(x => x.line).join('\n'))); break; }
      }
    } catch(e) { error(e); }
  });
  const cleanup = () => { disposed = true; child?.kill(); child = undefined; lines = []; source = undefined; pids = undefined; clearInterval(render); clearInterval(track); };
  panel.onDidDispose(cleanup); ctx.subscriptions.push(panel, { dispose: cleanup });
  return panel;
}
module.exports = { openLogcat, importLogcat };
