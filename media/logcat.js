'use strict';
const vscode = acquireVsCodeApi();
const byId = id => document.getElementById(id);
const currentFilter = () => ({ query: byId('query').value, level: byId('level').value, text: byId('text').value, regex: byId('regex').checked, tag: byId('tag').value, package: byId('package').value });
for (const id of ['screenshot','record','newTab','split','apply','pause','clear','deviceClear','copy','import','export','restart','favorite','unfavorite']) byId(id).addEventListener('click', () => {
  if (id === 'apply' || id === 'favorite') vscode.postMessage({ type: id === 'apply' ? 'filter' : 'favorite', filter: currentFilter() });
  else if (id === 'unfavorite') { if (byId('favorites').value) vscode.postMessage({ type: id, name: JSON.parse(byId('favorites').value).name }); }
  else vscode.postMessage({ type: id });
  byId('more').open = false;
  if (id === 'apply') byId('filterOptions').open = false;
});
byId('history').addEventListener('change', () => {
  if (byId('history').value) vscode.postMessage({ type: 'useFilter', filter: JSON.parse(byId('history').value) });
});
byId('favorites').addEventListener('change', () => {
  if (byId('favorites').value) vscode.postMessage({ type: 'useFilter', filter: JSON.parse(byId('favorites').value).filter });
});
function showSearch(visible) {
  byId('searchbar').hidden = !visible;
  byId('findToggle').ariaExpanded = String(visible);
  if (visible) { byId('findText').focus(); byId('findText').select(); }
  else { byId('findText').value = ''; renderLogs(); byId('logs').focus(); }
}
byId('findToggle').addEventListener('click', () => showSearch(byId('searchbar').hidden));
byId('findClose').addEventListener('click', () => showSearch(false));
for (const id of ['query', 'text', 'tag', 'package']) byId(id).addEventListener('keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); byId('apply').click(); }
});
byId('wrap').addEventListener('change', () => {
  byId('logs').style.whiteSpace = byId('wrap').checked ? 'pre-wrap' : 'pre';
  byId('logs').style.overflowWrap = byId('wrap').checked ? 'anywhere' : 'normal';
});
byId('compact').addEventListener('change', () => { byId('logs').dataset.compact = String(byId('compact').checked); });
function followEnd() { byId('scroll').checked = true; byId('jumpEnd').hidden = true; byId('logs').scrollTop = byId('logs').scrollHeight; }
byId('jumpEnd').addEventListener('click', followEnd);
byId('scroll').addEventListener('change', () => { byId('jumpEnd').hidden = byId('scroll').checked; if (byId('scroll').checked) followEnd(); });
byId('logs').addEventListener('pointerdown', () => { byId('scroll').checked = false; byId('jumpEnd').hidden = false; });
byId('logs').addEventListener('wheel', event => { if (event.deltaY < 0) { byId('scroll').checked = false; byId('jumpEnd').hidden = false; } });
byId('logs').addEventListener('scroll', () => {
  if (byId('findText').value || window.getSelection?.()?.toString()) return;
  const logs = byId('logs'), bottom = logs.scrollHeight - logs.clientHeight - logs.scrollTop <= 4;
  byId('scroll').checked = bottom; byId('jumpEnd').hidden = bottom;
});
let entries = [], hits = [], currentHit = -1, selectedMark, rowRecords = [], renderedQuery;

function selectHit(scroll) {
  selectedMark?.classList.remove('current-match');
  selectedMark = hits[currentHit]?.node;
  selectedMark?.classList.add('current-match');
  byId('findCount').textContent = `${hits.length ? currentHit + 1 : 0}/${hits.length}`;
  byId('findPrev').disabled = byId('findNext').disabled = !hits.length;
  if (scroll) selectedMark?.scrollIntoView({ block: 'center' });
}
function createRow(entry, key, pattern) {
  const row = document.createElement('div'); row.className = 'log-row level-' + entry.level;
  const matches = [];
  function text(parent, value, field) {
    value = String(value); if (!pattern) { parent.textContent = value; return; }
    let offset = 0;
    for (const match of value.matchAll(pattern)) {
      parent.append(document.createTextNode(value.slice(offset, match.index)));
      const mark = document.createElement('mark'); mark.textContent = match[0]; parent.append(mark);
      matches.push({ node: mark, key: JSON.stringify([key, field, match.index]) }); offset = match.index + match[0].length;
    }
    parent.append(document.createTextNode(value.slice(offset)));
  }
  if (!entry.time || entry.message === undefined) {
    row.className += ' raw-log';
    text(row, entry.processName === undefined ? entry.line : `[${entry.processName || '未知进程'}] ${entry.line}`, 'raw');
  } else {
    const fields = [['time', `${entry.date} ${entry.time}`], ['pid', `${entry.pid}:${entry.tid}`], ['package', entry.processName || '未知进程'], ['level', entry.level], ['tag', entry.tag], ['message', entry.message]];
    for (const [field, value] of fields) { const cell = document.createElement('span'); cell.className = 'log-' + field; cell.title = value; text(cell, value, field); row.append(cell); }
  }
  return { key, row, hits: matches };
}
function renderLogs(jump = false) {
  const logs = byId('logs'), top = logs.scrollTop, left = logs.scrollLeft, anchor = hits[currentHit]?.key, oldIndex = currentHit;
  const query = byId('findText').value;
  const pattern = query ? new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi') : null;
  const occurrences = new Map();
  const keys = entries.map(entry => { const line = JSON.stringify([entry.line,entry.processName]); const n = occurrences.get(line) || 0; occurrences.set(line,n+1); return entry.id !== undefined ? `id:${entry.id}` : `${line}:${n}`; });
  const start = keys.length ? rowRecords.findIndex(record => record.key === keys[0]) : -1;
  const retained = start >= 0 ? rowRecords.slice(start) : [];
  const reusable = query === renderedQuery && start >= 0 && retained.length <= keys.length && retained.every((record,i) => record.key === keys[i]);
  let viewportAnchor;
  if (reusable && !byId('scroll').checked) {
    const viewport = logs.getBoundingClientRect(); let low = start, high = rowRecords.length;
    while (low < high) { const middle = (low + high) >>> 1; if (rowRecords[middle].row.getBoundingClientRect().bottom <= viewport.top) low = middle + 1; else high = middle; }
    const row = rowRecords[low]?.row;
    if (row && row.getBoundingClientRect().top < viewport.bottom) viewportAnchor = { row, offset: row.getBoundingClientRect().top - viewport.top };
  }
  if (reusable) { for (const record of rowRecords.slice(0,start)) record.row.remove(); rowRecords = retained; }
  else { logs.replaceChildren(); rowRecords = []; }
  const fragment = document.createDocumentFragment();
  for (let i=rowRecords.length;i<entries.length;i++) { const record = createRow(entries[i],keys[i],pattern); rowRecords.push(record); fragment.append(record.row); }
  logs.append(fragment); renderedQuery = query; hits = rowRecords.flatMap(record => record.hits);
  logs.scrollLeft = left;
  if (byId('scroll').checked) logs.scrollTop = logs.scrollHeight;
  else if (viewportAnchor?.row.isConnected) logs.scrollTop += viewportAnchor.row.getBoundingClientRect().top - logs.getBoundingClientRect().top - viewportAnchor.offset;
  else if (!reusable) logs.scrollTop = top;
  currentHit = anchor ? hits.findIndex(hit => hit.key === anchor) : -1;
  if (currentHit < 0 && hits.length) currentHit = Math.min(Math.max(oldIndex,0),hits.length-1);
  selectHit(jump);
}
function moveHit(delta) {
  if (!hits.length) return;
  byId('scroll').checked = false;
  currentHit = (currentHit + delta + hits.length) % hits.length; selectHit(true);
}
byId('findText').addEventListener('input', () => {
  hits = []; currentHit = -1;
  if (byId('findText').value) byId('scroll').checked = false;
  renderLogs(true);
});
byId('findPrev').addEventListener('click', () => moveHit(-1));
byId('findNext').addEventListener('click', () => moveHit(1));
byId('findText').addEventListener('keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); moveHit(event.shiftKey ? -1 : 1); }
  if (event.key === 'Escape') { event.preventDefault(); showSearch(false); }
});
window.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    for (const id of ['more', 'filterOptions']) if (byId(id).open) { byId(id).open = false; byId(id).querySelector('summary').focus(); }
    if (!byId('searchbar').hidden) showSearch(false);
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); showSearch(true); }
});
for (const id of ['more', 'filterOptions']) byId(id).addEventListener('toggle', () => {
  const details = byId(id); if (!details.open) return;
  byId(id === 'more' ? 'filterOptions' : 'more').open = false;
  const panel = details.querySelector('div'), anchor = details.querySelector('summary').getBoundingClientRect();
  panel.style.left = Math.max(8, Math.min(anchor.right - panel.offsetWidth, window.innerWidth - panel.offsetWidth - 8)) + 'px';
  panel.style.top = document.querySelector('header').getBoundingClientRect().bottom + 4 + 'px';
});
window.addEventListener('resize', () => {
  for (const id of ['more', 'filterOptions']) { byId(id).open = false; byId(id).querySelector('div').style.left = ''; }
});
window.addEventListener('click', event => {
  if (!event.target.closest('#more')) byId('more').open = false;
  if (!event.target.closest('#filterOptions')) byId('filterOptions').open = false;
});
window.addEventListener('message', ({ data }) => {
  if (data.type === 'history') {
    const history = byId('history'), selected = history.value;
    history.replaceChildren(new Option('选择最近配置…', ''));
    for (const f of data.filters) {
      const label = [f.query, `级别:${f.level}`, f.text && `关键词:${f.text}`, f.regex && '正则', f.tag && `Tag:${f.tag}`, f.package && `包名:${f.package}`].filter(Boolean).join(' · ');
      const option = new Option(label, JSON.stringify(f)); option.title = label; history.add(option);
    }
    history.value = selected;
    const favorites = byId('favorites'), previous = favorites.value; favorites.replaceChildren(new Option('选择收藏…', ''));
    for (const item of data.favorites || []) favorites.add(new Option(item.name, JSON.stringify(item)));
    favorites.value = previous;
  }
  if (data.type === 'filterApplied') {
    for (const id of ['level', 'text', 'tag', 'package']) byId(id).value = data.filter[id];
    byId('query').value = data.filter.query || '';
    byId('regex').checked = data.filter.regex;
    const f = data.filter;
    byId('packageStatus').textContent = [data.queryName || f.query, f.package && `包名过滤：${f.package}`, f.tag && `Tag:${f.tag}`, f.text && `关键词:${f.text}`, f.level !== 'V' && `级别:${f.level}`].filter(Boolean).join(' · ') || (byId('package').disabled ? '离线日志 · 无设备包名映射' : '包名过滤：全部进程');
    byId('query').ariaInvalid = 'false'; byId('query').title = '示例：package:mine level:ERROR -tag:Noise';
    byId('packageStatus').title = byId('packageStatus').textContent;
    byId('filterOptionsToggle').ariaPressed = String(!!(data.filter.tag || data.filter.package));
  }
  if (data.type === 'queryError') { byId('query').ariaInvalid = 'true'; byId('query').title = data.text; byId('status').textContent = data.text; }
  if (data.type === 'captureState') {
    byId('screenshot').disabled = !data.device || data.screenshotBusy;
    byId('record').disabled = !data.device || data.recordingBusy;
    byId('record').title = byId('record').ariaLabel = data.recordingBusy ? '录屏处理中…' : (data.recording ? '停止录屏并保存' : '开始录屏（无声，最长 180 秒）');
    byId('record').ariaPressed = String(data.recording); byId('record').ariaBusy = String(data.recordingBusy);
  }
  if (data.type === 'status') byId('status').textContent = data.text;
  if (data.type === 'paused') { byId('pause').title = byId('pause').ariaLabel = data.value ? '继续日志显示' : '暂停日志显示'; byId('pause').ariaPressed = String(data.value); byId('pauseStatus').textContent = data.value ? `已暂停 · 新增 ${data.pending || 0} 条` : ''; }
  if (data.type === 'lines') {
    entries = data.lines; renderLogs();
  }
});
vscode.postMessage({ type: 'ready' });
