'use strict';
const vscode = acquireVsCodeApi();
const byId = id => document.getElementById(id);
const currentFilter = () => ({query:byId('query').value,level:'V',text:'',regex:false,tag:'',package:''});
for (const id of ['newTab','split','apply','pause','clear','deviceClear','copy','import','export','restart']) byId(id).addEventListener('click', () => {
  if (id === 'apply') vscode.postMessage({ type:'filter', filter:currentFilter() });
  else vscode.postMessage({ type: id });
  byId('more').open = false;
  if (id === 'apply') showSuggestions(false);
});
let recentFilters = [], favoriteFilters = [];
const filterKey = f => f.query || '';
const filterLabel = f => f.query || '全部日志';
const queryOnly = f => f && !f.text && !f.regex && !f.tag && !f.package && (!f.level || f.level === 'V');
function renderSuggestions() {
  const popup = byId('querySuggestions'), focusKey = document.activeElement?.dataset?.filterKey;
  popup.replaceChildren();
  const current = currentFilter(), seen = new Set(); let focusStar;
  const add = (filter, label) => {
    const key = filterKey(filter); if (seen.has(key)) return; seen.add(key);
    const favorite = favoriteFilters.some(item => filterKey(item.filter) === key);
    const row = document.createElement('div'); row.className = 'query-option';
    const choose = document.createElement('button'); choose.className = 'query-choice';
    choose.textContent = label || filterLabel(filter); choose.title = filterLabel(filter);
    choose.addEventListener('click', () => { vscode.postMessage({type:'useFilter',filter}); showSuggestions(false); });
    const star = document.createElement('button'); star.className = 'query-star';
    star.dataset.filterKey = key; if (focusKey === key) focusStar = star;
    star.textContent = favorite ? '★' : '☆'; star.ariaPressed = String(favorite);
    star.title = star.ariaLabel = favorite ? '取消收藏' : '收藏配置';
    star.addEventListener('click', () => vscode.postMessage({type:'toggleFavorite',filter}));
    row.append(choose,star); popup.append(row);
  };
  for (const item of favoriteFilters) add(item.filter,item.name);
  add(current);
  for (const filter of recentFilters) add(filter);
  const hints = [
    ['package:mine','当前应用及子进程'], ['level:ERROR','错误及以上'],
    ['tag:App','按 Tag 过滤'], ['message:"request failed"','按消息过滤，空格加引号'],
    ['process:remote','按进程名过滤'], ['-tag:Noise','排除 Tag'],
    ['message~:"timeout|failed"','消息正则匹配'], ['age:5m','最近 5 分钟'],
    ['is:crash','崩溃日志'], ['is:stacktrace','异常堆栈']
  ];
  for (const [query,description] of hints) {
    const row = document.createElement('button'); row.className = 'query-hint'; row.textContent = query + ' — ' + description;
    row.title = '补到当前查询末尾，不会自动应用';
    if (seen.has(filterKey({...current,query}))) continue;
    row.addEventListener('click', () => {
      const input = byId('query'), value = input.value.trimEnd();
      const incomplete = value.match(/(?:^|\s)(-?[a-z]+~?:)$/i);
      input.value = incomplete && query.startsWith(incomplete[1]) ? value.slice(0,-incomplete[1].length) + query : [value,query].filter(Boolean).join(' ');
      input.focus(); showSuggestions(false);
    });
    popup.append(row);
  }
  focusStar?.focus();
}
function showSuggestions(visible) {
  byId('querySuggestions').hidden = !visible;
  byId('query').ariaExpanded = byId('queryToggle').ariaExpanded = String(visible);
  if (visible) renderSuggestions();
}
byId('queryToggle').addEventListener('click', () => showSuggestions(byId('querySuggestions').hidden));
byId('query').addEventListener('focus', () => showSuggestions(true));
byId('query').addEventListener('input', () => showSuggestions(true));
byId('query').addEventListener('keydown', event => {
  if (event.key === 'ArrowDown') { event.preventDefault(); showSuggestions(true); byId('querySuggestions').querySelector('button')?.focus(); }
});
byId('querySuggestions').addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); showSuggestions(false); byId('queryToggle').focus(); }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const buttons = [...byId('querySuggestions').querySelectorAll('button')], index = buttons.indexOf(document.activeElement);
    buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
  }
});
function showSearch(visible) {
  byId('searchbar').hidden = !visible;
  byId('findToggle').ariaExpanded = String(visible);
  if (visible) { byId('findText').focus(); byId('findText').select(); }
  else { byId('findText').value = ''; renderLogs(); byId('logs').focus(); }
}
byId('findToggle').addEventListener('click', () => showSearch(byId('searchbar').hidden));
byId('findClose').addEventListener('click', () => showSearch(false));
for (const id of ['query']) byId(id).addEventListener('keydown', event => {
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
    showSuggestions(false);
    for (const id of ['more','syntaxHelp']) if (byId(id).open) { byId(id).open = false; byId(id).querySelector('summary').focus(); }
    if (!byId('searchbar').hidden) showSearch(false);
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); showSearch(true); }
});
for (const id of ['more','syntaxHelp']) byId(id).addEventListener('toggle', () => {
  const details = byId(id); if (!details.open) return;
  byId(id === 'more' ? 'syntaxHelp' : 'more').open = false;
  showSuggestions(false);
  const panel = details.querySelector('div'), anchor = details.querySelector('summary').getBoundingClientRect();
  panel.style.left = Math.max(8, Math.min(anchor.right - panel.offsetWidth, window.innerWidth - panel.offsetWidth - 8)) + 'px';
  panel.style.top = document.querySelector('header').getBoundingClientRect().bottom + 4 + 'px';
});
window.addEventListener('resize', () => {
  showSuggestions(false);
  for (const id of ['more','syntaxHelp']) { byId(id).open = false; byId(id).querySelector('div').style.left = ''; }
});
window.addEventListener('click', event => {
  if (!event.target.closest('.keyword')) showSuggestions(false);
  if (!event.target.closest('#more')) byId('more').open = false;
  if (!event.target.closest('#syntaxHelp')) byId('syntaxHelp').open = false;
});
window.addEventListener('message', ({ data }) => {
  if (data.type === 'history') {
    recentFilters = (data.filters || []).filter(queryOnly); favoriteFilters = (data.favorites || []).filter(item => queryOnly(item.filter));
    renderSuggestions();
  }
  if (data.type === 'filterApplied') {
    byId('query').value = data.filter.query || '';
    const f = data.filter;
    byId('packageStatus').textContent = data.queryName || f.query || '全部日志';
    byId('query').ariaInvalid = 'false'; byId('query').title = '示例：package:mine level:ERROR -tag:Noise';
    byId('packageStatus').title = byId('packageStatus').textContent;
  }
  if (data.type === 'queryError') { byId('query').ariaInvalid = 'true'; byId('query').title = data.text; byId('status').textContent = data.text; }
  if (data.type === 'status') byId('status').textContent = data.text;
  if (data.type === 'paused') { byId('pause').title = byId('pause').ariaLabel = data.value ? '继续日志显示' : '暂停日志显示'; byId('pause').ariaPressed = String(data.value); byId('pauseStatus').textContent = data.value ? `已暂停 · 新增 ${data.pending || 0} 条` : ''; }
  if (data.type === 'lines') {
    entries = data.lines; renderLogs();
  }
});
vscode.postMessage({ type: 'ready' });
