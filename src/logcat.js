'use strict';
const v = require('vscode');
const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');
const { randomBytes } = require('node:crypto');
const { parseLog, filterLog, packageName } = require('./core');
function openLogcat(ctx, adb, serial, error) {
  const panel = v.window.createWebviewPanel('androidLogcat', `Logcat · ${serial}`, v.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [v.Uri.joinPath(ctx.extensionUri, 'media')] });
  const nonce = randomBytes(16).toString('hex');
  const script = panel.webview.asWebviewUri(v.Uri.joinPath(ctx.extensionUri, 'media', 'logcat.js'));
  const style = panel.webview.asWebviewUri(v.Uri.joinPath(ctx.extensionUri, 'media', 'logcat.css'));
  panel.webview.html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${panel.webview.cspSource}; script-src 'nonce-${nonce}'"><link rel="stylesheet" href="${style}"></head><body><header><label>级别 <select id="level"><option>V</option><option>D</option><option>I</option><option>W</option><option>E</option><option>F</option></select></label><label>关键词 <input id="text" placeholder="过滤内容"></label><label><input id="regex" type="checkbox">正则</label><label>Tag <input id="tag"></label><label>包名 <input id="package" placeholder="留空显示全部进程"></label><button id="apply">应用过滤</button><button id="pause">暂停</button><label><input id="scroll" type="checkbox" checked>自动滚动</label><button id="clear">清空视图</button><button id="deviceClear">清除设备日志</button><button id="copy">复制</button><button id="export">导出</button><button id="restart">重连</button></header><p id="status" role="status">连接中…</p><main id="logs" tabindex="0" aria-label="Logcat 日志"></main><script nonce="${nonce}" src="${script}"></script></body></html>`;
  let lines = [], filter = { level: 'V' }, pids, child, partial = '', paused = false, disposed = false, changed = true, packageId = '', checking = false;
  const send = message => { if (!disposed) panel.webview.postMessage(message); };
  function filtered() { return lines.filter(entry => filterLog(entry, filter, pids)); }
  function start() {
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
    if (!packageId || checking) return; checking = true;
    const current = packageId;
    try { const result = await adb.shell(serial, ['ps', '-A', '-o', 'PID,NAME'], { timeout: 3000 }); if (current === packageId) { pids = new Set(result.split(/\r?\n/).map(line => line.trim().split(/\s+/)).filter(([, name]) => name === current || name?.startsWith(current + ':')).map(([pid]) => pid)); changed = true; } }
    catch { if (current === packageId) { pids = new Set(); changed = true; } }
    finally { checking = false; }
  }, 1500);
  panel.webview.onDidReceiveMessage(async message => {
    try {
      switch (message.type) {
        case 'ready': start(); break;
        case 'restart': start(); break;
        case 'filter': {
          const f = message.filter;
          if (!f || typeof f.text !== 'string' || f.text.length > 300 || typeof f.tag !== 'string' || !/^[VDIWEF]$/.test(f.level)) throw new Error('无效过滤条件');
          if (f.regex && /\([^)]*[+*][^)]*\)[+*{]/.test(f.text)) throw new Error('请避免嵌套重复的正则表达式');
          if (f.regex) new RegExp(f.text);
          const next = String(f.package || '').trim(); if (next) packageName(next);
          filter = { text: f.text, regex: !!f.regex, tag: f.tag, level: f.level }; packageId = next; pids = next ? new Set() : undefined; changed = true;
          send({ type: 'status', text: next ? `跟踪 ${next}，等待匹配进程…` : '过滤已应用' }); break;
        }
        case 'pause': paused = !paused; send({ type: 'paused', value: paused }); changed = true; break;
        case 'clear': lines = []; changed = true; send({ type: 'lines', lines: [] }); break;
        case 'deviceClear':
          if (!v.workspace.isTrusted) throw new Error('请先信任工作区');
          if (await v.window.showWarningMessage(`清除 ${serial} 的设备日志缓冲区？`, { modal: true }, '确认') === '确认') await adb.exec(serial, ['logcat', '-c']); break;
        case 'copy': await v.env.clipboard.writeText(filtered().map(x => x.line).join('\n')); break;
        case 'export': { const uri = await v.window.showSaveDialog({ defaultUri: v.Uri.file(`logcat-${Date.now()}.txt`) }); if (uri) await v.workspace.fs.writeFile(uri, Buffer.from(filtered().map(x => x.line).join('\n'))); break; }
      }
    } catch(e) { error(e); }
  });
  const cleanup = () => { disposed = true; child?.kill(); clearInterval(render); clearInterval(track); };
  panel.onDidDispose(cleanup); ctx.subscriptions.push(panel, { dispose: cleanup });
}
module.exports = { openLogcat };
