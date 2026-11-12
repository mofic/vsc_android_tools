'use strict';
const v = require('vscode');
const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');
const { randomBytes } = require('node:crypto');
const path = require('node:path');
const { compileQuery } = require('./log-query');
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
<div class="keyword"><input id="query" placeholder="package:mine level:ERROR  或输入关键词…" aria-label="Logcat 查询" maxlength="2000" autocomplete="off" aria-controls="querySuggestions" aria-expanded="false" aria-haspopup="dialog"><button id="queryToggle" class="query-toggle" title="收藏和最近过滤配置" aria-label="收藏和最近过滤配置" aria-expanded="false" aria-controls="querySuggestions">▾</button><div id="querySuggestions" class="query-suggestions" role="dialog" aria-label="过滤配置" hidden></div></div>
${iconButton('apply', '应用过滤（Enter）', 'apply')}
<span class="separator" aria-hidden="true"></span>
${iconButton('pause', '暂停日志显示', 'pause', `${offline} aria-pressed="false"`)}
<label class="scroll-toggle" title="自动滚动到最新日志"><input id="scroll" type="checkbox" checked>跟随</label><label class="scroll-toggle" title="自动换行；关闭后单行显示并支持横向滚动"><input id="wrap" type="checkbox" checked>换行</label><label class="scroll-toggle" title="隐藏时间和 PID/TID 列；窄窗口会自动精简"><input id="compact" type="checkbox">精简</label>
${iconButton('jumpEnd', '回到最新日志并跟随', 'down')}
${iconButton('clear', '清空当前视图', 'clear')}
${iconButton('findToggle', '搜索日志（Ctrl/Cmd+F）', 'search', 'aria-expanded="false" aria-controls="searchbar"')}
<details id="more" class="popover"><summary title="更多操作" aria-label="更多操作">${icon('more')}</summary><div class="more-menu">
<button id="newTab">新建标签页</button><button id="split">在旁边分屏</button><hr><button id="import">导入日志…</button><button id="export">导出日志…</button><button id="copy">复制日志</button><hr><button id="restart" ${offline}>重新连接</button><button id="deviceClear" ${offline}>清除设备日志…</button></div></details>
</header>
<section class="log-content"><div id="searchbar" hidden role="search"><input id="findText" type="search" maxlength="300" placeholder="查找日志…" aria-label="日志内搜索"><span id="findCount" role="status" aria-live="polite">0/0</span>${iconButton('findPrev', '上一个（Shift+Enter）', 'up')}${iconButton('findNext', '下一个（Enter）', 'down')}${iconButton('findClose', '关闭搜索（Escape）', 'close')}</div>
<main id="logs" tabindex="0" aria-label="Logcat 日志，实时行首显示当前 PID 对应包名或进程名"></main></section><footer><span id="packageStatus" title="当前生效的包名过滤">${source ? '离线日志 · 无设备包名映射' : '包名过滤：全部进程'}</span><span id="pauseStatus"></span><span id="status" role="status">连接中…</span></footer><script nonce="${nonce}" src="${script}"></script></body></html>`;
  let sequence = source?.entries.length || 0, pausedAt = 0;
  let queryMatcher = compileQuery();
  let lines = source?.entries.map((entry,index) => ({ ...entry, id: index + 1 })) || [], filter = { level: 'V' }, pids, child, partial = '', paused = false, disposed = false, changed = true, packageId = '', checking = false;
  let processNames = new Map(), defaultInitialized = false, filterTouched = false;
  const send = message => { if (!disposed) panel.webview.postMessage(message); };
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
      for (const entry of lines) if (!entry.processName && processNames.has(entry.pid)) {
        entry.processName = processNames.get(entry.pid); changed = true;
      }
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
          sendHistory();
          if (source) { send({ type: 'status', text: `已导入 ${source.name} · ${source.total} 行${source.total > lines.length ? `，显示最后 ${lines.length} 行` : ''} · 离线模式` }); send({ type: 'lines', lines: filtered() }); changed = false; }
          else {
            if (!defaultInitialized) {
              defaultInitialized = true;
              try {
                const value = await resolveMine(false);
                if (value && !disposed && !filterTouched) {
                  const f = normalizeLogFilter({level:'V',text:'',tag:'',regex:false,package:'',query:'package:mine'});
                  queryMatcher = compileQuery(f.query,{mine:[value]}); changed = true;
                  send({type:'filterApplied',filter:f,queryName:'当前应用：' + value + ' · package:mine'});
                }
              } catch(e) { error(e); }
            }
            await updateProcesses(); if (!disposed) start();
          } break;
        case 'newTab': openLogcat(ctx, adb, serial, error, source, v.ViewColumn.Active, resolveMine); break;
        case 'split': openLogcat(ctx, adb, serial, error, source, v.ViewColumn.Beside, resolveMine); break;
        case 'import': await importLogcat(ctx, adb, error); break;
        case 'restart': await updateProcesses(); if (!disposed) start(); break;
        case 'filter':
        case 'useFilter': {
          filterTouched = true;
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
        case 'toggleFavorite': {
          const selected = normalizeLogFilter(message.filter);
          const key = JSON.stringify(selected);
          const write = historyWrite.then(async () => {
            const items = ctx.globalState.get('logcat.favorites', []);
            const matching = item => JSON.stringify(normalizeLogFilter(item.filter)) === key;
            const exists = items.some(matching);
            const name = (selected.query || [selected.package, selected.tag, selected.text, '级别:' + selected.level].filter(Boolean).join(' · ')).slice(0,60);
            await ctx.globalState.update('logcat.favorites', exists ? items.filter(item => !matching(item)) : [{name,filter:selected}, ...items].slice(0,20));
            historyEvents.emit('changed');
          });
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
  const cleanup = () => { historyEvents.off('changed', sendHistory); disposed = true; child?.kill(); child = undefined; lines = []; processNames.clear(); source = undefined; pids = undefined; clearInterval(render); clearInterval(track); };
  panel.onDidDispose(cleanup); ctx.subscriptions.push(panel, { dispose: cleanup });
  return panel;
}
module.exports = { openLogcat, importLogcat };
