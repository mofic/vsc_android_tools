'use strict';
const v = require('vscode');
const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');
const { randomBytes } = require('node:crypto');
const path = require('node:path');
const { compileQuery } = require('./log-query');
const { screenshot, startRecording } = require('./capture');
const { EventEmitter } = require('node:events');
const { parseLog, filterLog, importLogs, normalizeLogFilter, recentFilters } = require('./core');
let nextSession = 1;
const historyEvents = new EventEmitter();
historyEvents.setMaxListeners(0);
let historyWrite = Promise.resolve();
function saveRecentFilter(ctx, filter) {
  const write = historyWrite.then(async () => {
    const history = recentFilters(ctx.globalState.get('logcat.recentFilters', []), filter);
    await ctx.globalState.update('logcat.recentFilters', history);
    historyEvents.emit('changed');
  });
  historyWrite = write.catch(() => {});
  return write;
}
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
const icons = {
  apply: '<path d="m4 12 5 5L20 6"/>', filters: '<path d="M4 7h16M4 17h16M9 4v6m6 4v6"/>',
  pause: '<path class="idle-icon" d="M8 5v14M16 5v14"/><path class="active-icon" d="m8 5 11 7-11 7Z"/>',
  clear: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7m4-7v7"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  screenshot: '<path d="M3 7h4l2-3h6l2 3h4v13H3Z"/><circle cx="12" cy="13" r="4"/>',
  record: '<circle class="idle-icon" cx="12" cy="12" r="7"/><rect class="active-icon" x="6" y="6" width="12" height="12"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  up: '<path d="m6 14 6-6 6 6"/>', down: '<path d="m6 10 6 6 6-6"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
const iconButton = (id, title, name, attributes = '') => `<button class="icon-button" id="${id}" title="${title}" aria-label="${title}" ${attributes}>${icon(name)}</button>`;
function openLogcat(ctx, adb, serial, error, source, column = v.ViewColumn.Active, resolveMine = async () => { const project = ctx.workspaceState?.get('project'); return project && ctx.workspaceState.get(`package:${project}`); }) {
  const panel = v.window.createWebviewPanel('androidLogcat', `Logcat #${nextSession++} · ${source ? source.name : serial}`, column, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [v.Uri.joinPath(ctx.extensionUri, 'media')] });
  const nonce = randomBytes(16).toString('hex');
  const script = panel.webview.asWebviewUri(v.Uri.joinPath(ctx.extensionUri, 'media', 'logcat.js'));
  const style = panel.webview.asWebviewUri(v.Uri.joinPath(ctx.extensionUri, 'media', 'logcat.css'));
  const offline = source ? 'disabled' : '';
  panel.webview.html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${panel.webview.cspSource}; script-src 'nonce-${nonce}'"><link rel="stylesheet" href="${style}"></head><body><header class="toolbar" aria-label="Logcat 工具栏">
<select id="level" aria-label="最低日志级别" title="最低日志级别"><option>V</option><option>D</option><option>I</option><option>W</option><option>E</option><option>F</option></select>
<div class="keyword"><input id="query" list="querySuggestions" placeholder="package:mine level:ERROR  或输入关键词…" aria-label="Logcat 查询" maxlength="2000"><datalist id="querySuggestions"><option value="package:mine"><option value="level:ERROR"><option value="tag:"><option value="message:"><option value="process:"><option value="-tag:"><option value="age:5m"><option value="is:crash"><option value="is:stacktrace"><option value="name:"></datalist></div>
${iconButton('apply', '应用过滤（Enter）', 'apply')}
<details id="filterOptions" class="popover"><summary id="filterOptionsToggle" title="更多过滤条件" aria-label="更多过滤条件">${icon('filters')}</summary><div class="filter-options">
<label>收藏配置<select id="favorites" aria-label="收藏的过滤配置"><option value="">选择收藏…</option></select></label><div class="favorite-actions"><button id="favorite">收藏当前配置…</button><button id="unfavorite">移除所选收藏</button></div><label>最近配置<select id="history" aria-label="最近使用的过滤配置"><option value="">选择最近配置…</option></select></label>
<label>关键词（兼容旧配置）<input id="text" placeholder="原始日志关键词"></label><label class="scroll-toggle"><input id="regex" type="checkbox">关键词使用正则</label><label>Tag<input id="tag" placeholder="按 Tag 过滤"></label><label>包名<input id="package" ${offline} title="包名过滤需要实时设备进程信息" placeholder="留空显示全部进程"></label><small>设置后按 Enter 或点击主栏的应用按钮</small></div></details>
<span class="separator" aria-hidden="true"></span>
${iconButton('pause', '暂停日志显示', 'pause', `${offline} aria-pressed="false"`)}
<label class="scroll-toggle" title="自动滚动到最新日志"><input id="scroll" type="checkbox" checked>跟随</label><label class="scroll-toggle" title="自动换行；关闭后单行显示并支持横向滚动"><input id="wrap" type="checkbox" checked>换行</label><label class="scroll-toggle" title="隐藏时间和 PID/TID 列；窄窗口会自动精简"><input id="compact" type="checkbox">精简</label>
${iconButton('jumpEnd', '回到最新日志并跟随', 'down')}
${iconButton('clear', '清空当前视图', 'clear')}
${iconButton('findToggle', '搜索日志（Ctrl/Cmd+F）', 'search', 'aria-expanded="false" aria-controls="searchbar"')}
${iconButton('screenshot', '设备截屏', 'screenshot', offline)}
${iconButton('record', '开始录屏（无声，最长 180 秒）', 'record', `${offline} aria-pressed="false"`)}
<details id="more" class="popover"><summary title="更多操作" aria-label="更多操作">${icon('more')}</summary><div class="more-menu">
<button id="newTab">新建标签页</button><button id="split">在旁边分屏</button><hr><button id="import">导入日志…</button><button id="export">导出日志…</button><button id="copy">复制日志</button><hr><button id="restart" ${offline}>重新连接</button><button id="deviceClear" ${offline}>清除设备日志…</button></div></details>
</header>
<section class="log-content"><div id="searchbar" hidden role="search"><input id="findText" type="search" maxlength="300" placeholder="查找日志…" aria-label="日志内搜索"><span id="findCount" role="status" aria-live="polite">0/0</span>${iconButton('findPrev', '上一个（Shift+Enter）', 'up')}${iconButton('findNext', '下一个（Enter）', 'down')}${iconButton('findClose', '关闭搜索（Escape）', 'close')}</div>
<main id="logs" tabindex="0" aria-label="Logcat 日志，实时行首显示当前 PID 对应包名或进程名"></main></section><footer><span id="packageStatus" title="当前生效的包名过滤">${source ? '离线日志 · 无设备包名映射' : '包名过滤：全部进程'}</span><span id="pauseStatus"></span><span id="status" role="status">连接中…</span></footer><script nonce="${nonce}" src="${script}"></script></body></html>`;
  let sequence = source?.entries.length || 0, pausedAt = 0;
  let queryMatcher = compileQuery();
  let lines = source?.entries.map((entry,index) => ({ ...entry, id: index + 1 })) || [], filter = { level: 'V' }, pids, child, partial = '', paused = false, disposed = false, changed = true, packageId = '', checking = false;
  let processNames = new Map();
  let recording, screenshotBusy = false, recordingBusy = false;
  const send = message => { if (!disposed) panel.webview.postMessage(message); };
  const captureState = () => send({ type: 'captureState', device: !!serial, recording: !!recording, screenshotBusy, recordingBusy });
  async function captureScreenshot() {
    if (!serial || screenshotBusy) return;
    if (!v.workspace.isTrusted) throw new Error('请先信任工作区');
    screenshotBusy = true; captureState();
    try {
      const uri = await v.window.showSaveDialog({ title: `设备截屏 · ${serial}`, defaultUri: v.Uri.file(`screenshot-${Date.now()}.png`), filters: { PNG: ['png'] } });
      if (!uri || disposed) return;
      if (uri.scheme !== 'file') throw new Error('请选择本地保存路径');
      await screenshot(adb, serial, uri.fsPath);
      v.window.showInformationMessage(`截图已保存：${uri.fsPath}`);
      await v.commands.executeCommand('vscode.open', uri);
    } finally { screenshotBusy = false; captureState(); }
  }
  async function toggleRecording() {
    if (!serial || recordingBusy) return;
    if (!v.workspace.isTrusted) throw new Error('请先信任工作区');
    recordingBusy = true; captureState();
    if (recording) {
      try { await recording.stop(); } catch(e) { recordingBusy = false; captureState(); throw e; }
      return;
    }
    try {
      const uri = await v.window.showSaveDialog({ title: `录屏保存位置 · ${serial}`, defaultUri: v.Uri.file(`recording-${Date.now()}.mp4`), filters: { MP4: ['mp4'] } });
      if (!uri || disposed) { recordingBusy = false; captureState(); return; }
      if (uri.scheme !== 'file') throw new Error('请选择本地保存路径');
      const session = startRecording(adb, serial, uri.fsPath); recording = session;
      // Notification promises wait for dismissal; release recording state before showing them.
      session.done.finally(() => { if (recording === session) { recording = undefined; recordingBusy = false; captureState(); } }).then(() => v.window.showInformationMessage(`录屏已保存：${uri.fsPath}`), error);
      await session.ready.catch(() => {});
      recordingBusy = false; captureState();
    } catch(e) { recordingBusy = false; captureState(); throw e; }
  }
  const sendHistory = () => send({ type: 'history', filters: ctx.globalState.get('logcat.recentFilters', []), favorites: ctx.globalState.get('logcat.favorites', []) });
  historyEvents.on('changed', sendHistory);
  function filtered() { return lines.filter(entry => filterLog(entry, filter, packageId && entry.processName ? undefined : pids) && (!packageId || !entry.processName || entry.processName === packageId || entry.processName.startsWith(packageId + ':')) && queryMatcher.test(entry)); }
  function start() {
    if (!serial) return;
    child?.kill(); partial = '';
    const process = spawn(adb.binary(), ['-s', serial, 'logcat', '-v', 'threadtime'], { windowsHide: true }); child = process; const decoder = new StringDecoder('utf8');
    send({ type: 'status', text: '已连接 · 最多保留 10000 行' });
    process.stdout.on('data', chunk => {
      if (child !== process) return;
      partial += decoder.write(chunk); const entries = partial.split(/\r?\n/); partial = entries.pop().slice(-65536);
      lines.push(...entries.map(line => { const entry = parseLog(line); return { ...entry, id: ++sequence, processName: processNames.get(entry.pid) || '' }; })); if (lines.length > 10000) lines.splice(0, lines.length - 10000); changed = true;
      if (paused) send({ type: 'paused', value: true, pending: sequence - pausedAt });
    });
    process.stderr.on('data', chunk => send({ type: 'status', text: chunk.toString() }));
    process.on('error', e => send({ type: 'status', text: e.message }));
    process.on('close', () => { if (child === process) send({ type: 'status', text: '连接已结束，可点击重连' }); });
  }
  let ageTick = 0;
  const render = setInterval(() => { if (queryMatcher.usesAge && Date.now() - ageTick >= 1000) { ageTick = Date.now(); changed = true; } if (!paused && changed) { send({ type: 'lines', lines: filtered() }); changed = false; } }, 400);
  async function updateProcesses() {
    if (!serial || checking || disposed) return; checking = true;
    const current = packageId;
    try {
      const result = await adb.shell(serial, ['ps', '-A', '-o', 'PID,NAME'], { timeout: 3000 });
      if (disposed) return;
      processNames = new Map(result.split(/\r?\n/).map(line => line.trim().split(/\s+/)).filter(([pid, name]) => /^\d+$/.test(pid) && name));
      if (current && current === packageId) { pids = new Set([...processNames].filter(([, name]) => name === current || name.startsWith(current + ':')).map(([pid]) => pid)); changed = true; }
    } catch { processNames = new Map(); if (current && current === packageId) { pids = new Set(); changed = true; } }
    finally { checking = false; }
  }
  const track = setInterval(updateProcesses, 1500);
  panel.webview.onDidReceiveMessage(async message => {
    if (disposed) return;
    try {
      switch (message.type) {
        case 'ready':
          sendHistory(); captureState();
          if (source) { send({ type: 'status', text: `已导入 ${source.name} · ${source.total} 行${source.total > lines.length ? `，显示最后 ${lines.length} 行` : ''} · 离线模式` }); send({ type: 'lines', lines: filtered() }); changed = false; }
          else { await updateProcesses(); if (!disposed) start(); } break;
        case 'newTab': openLogcat(ctx, adb, serial, error, source, v.ViewColumn.Active, resolveMine); break;
        case 'split': openLogcat(ctx, adb, serial, error, source, v.ViewColumn.Beside, resolveMine); break;
        case 'import': await importLogcat(ctx, adb, error); break;
        case 'screenshot': await captureScreenshot(); break;
        case 'record': await toggleRecording(); break;
        case 'restart': await updateProcesses(); if (!disposed) start(); break;
        case 'filter':
        case 'useFilter': {
          const saved = normalizeLogFilter(message.filter);
          let mine = [];
          if (compileQuery(saved.query).usesMine) { if (!serial) throw new Error('离线日志不支持 package:mine'); const value = await resolveMine(); if (!value) throw new Error('请先选择当前项目并确认 applicationId'); mine = [value]; }
          const matcher = compileQuery(saved.query, { mine });
          const f = { ...saved, package: serial ? saved.package : '' };
          queryMatcher = matcher;
          filter = { query: f.query, text: f.text, regex: f.regex, tag: f.tag, level: f.level }; packageId = f.package; pids = packageId ? new Set() : undefined; changed = true;
          send({ type: 'filterApplied', filter: f, queryName: matcher.name });
          await saveRecentFilter(ctx, saved);
          send({ type: 'status', text: packageId ? `跟踪 ${packageId}，等待匹配进程…` : (!serial && saved.package ? '过滤已应用（离线日志已跳过包名过滤）' : '过滤已应用') }); break;
        }
        case 'favorite': {
          const selected = normalizeLogFilter(message.filter);
          const name = (await v.window.showInputBox({ prompt: '收藏配置名称', value: compileQuery(selected.query).name || '', validateInput: value => value.trim() && value.trim().length <= 60 ? undefined : '请输入 1–60 个字符' }))?.trim();
          if (!name) break; if (name.length > 60) throw new Error('收藏名称过长');
          const write = historyWrite.then(async () => { const items = ctx.globalState.get('logcat.favorites', []); await ctx.globalState.update('logcat.favorites', [{ name, filter: selected }, ...items.filter(item => item.name !== name)].slice(0,20)); historyEvents.emit('changed'); });
          historyWrite = write.catch(() => {}); await write; break;
        }
        case 'unfavorite': {
          const name = String(message.name || '');
          const write = historyWrite.then(async () => { await ctx.globalState.update('logcat.favorites', ctx.globalState.get('logcat.favorites', []).filter(item => item.name !== name)); historyEvents.emit('changed'); });
          historyWrite = write.catch(() => {}); await write; break;
        }
        case 'pause': paused = !paused; pausedAt = sequence; send({ type: 'paused', value: paused, pending: 0 }); changed = true; break;
        case 'clear': lines = []; changed = true; send({ type: 'lines', lines: [] }); break;
        case 'deviceClear':
          if (!serial) return;
          if (!v.workspace.isTrusted) throw new Error('请先信任工作区');
          if (await v.window.showWarningMessage(`清除 ${serial} 的设备日志缓冲区？`, { modal: true }, '确认') === '确认') await adb.exec(serial, ['logcat', '-c']); break;
        case 'copy': await v.env.clipboard.writeText(filtered().map(x => x.line).join('\n')); break;
        case 'export': { const uri = await v.window.showSaveDialog({ defaultUri: v.Uri.file(`logcat-${Date.now()}.txt`) }); if (uri) await v.workspace.fs.writeFile(uri, Buffer.from(filtered().map(x => x.line).join('\n'))); break; }
      }
    } catch(e) { if (['filter','useFilter'].includes(message.type)) send({ type: 'queryError', text: e.message }); error(e); }
  });
  const cleanup = () => { historyEvents.off('changed', sendHistory); disposed = true; recording?.stop().catch(error); child?.kill(); child = undefined; lines = []; processNames.clear(); source = undefined; pids = undefined; clearInterval(render); clearInterval(track); };
  panel.onDidDispose(cleanup); ctx.subscriptions.push(panel, { dispose: cleanup });
  return panel;
}
module.exports = { openLogcat, importLogcat };
