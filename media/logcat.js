'use strict';
const vscode = acquireVsCodeApi();
const byId = id => document.getElementById(id);
for (const id of ['screenshot','record','newTab','split','apply','pause','clear','deviceClear','copy','import','export','restart']) byId(id).addEventListener('click', () => {
  if (id === 'apply') vscode.postMessage({ type: 'filter', filter: { level: byId('level').value, text: byId('text').value, regex: byId('regex').checked, tag: byId('tag').value, package: byId('package').value } });
  else vscode.postMessage({ type: id });
  byId('more').open = false;
  if (id === 'apply') byId('filterOptions').open = false;
});
byId('history').addEventListener('change', () => {
  if (byId('history').value) vscode.postMessage({ type: 'useFilter', filter: JSON.parse(byId('history').value) });
});
function showSearch(visible) {
  byId('searchbar').hidden = !visible;
  byId('findToggle').ariaExpanded = String(visible);
  if (visible) { byId('findText').focus(); byId('findText').select(); }
  else { byId('findText').value = ''; renderLogs(); byId('logs').focus(); }
}
byId('findToggle').addEventListener('click', () => showSearch(byId('searchbar').hidden));
byId('findClose').addEventListener('click', () => showSearch(false));
for (const id of ['text', 'tag', 'package']) byId(id).addEventListener('keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); byId('apply').click(); }
});
byId('wrap').addEventListener('change', () => {
  byId('logs').style.whiteSpace = byId('wrap').checked ? 'pre-wrap' : 'pre';
  byId('logs').style.overflowWrap = byId('wrap').checked ? 'anywhere' : 'normal';
});
let entries = [], hits = [], currentHit = -1, selectedMark;
function selectHit(scroll) {
  selectedMark?.classList.remove('current-match');
  selectedMark = hits[currentHit]?.node;
  selectedMark?.classList.add('current-match');
  byId('findCount').textContent = `${hits.length ? currentHit + 1 : 0}/${hits.length}`;
  byId('findPrev').disabled = byId('findNext').disabled = !hits.length;
  if (scroll) selectedMark?.scrollIntoView({ block: 'center' });
}
function renderLogs(jump = false) {
  const logs = byId('logs'), top = logs.scrollTop, left = logs.scrollLeft, anchor = hits[currentHit]?.key, oldIndex = currentHit;
  const query = byId('findText').value;
  const pattern = query ? new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi') : null;
  const fragment = document.createDocumentFragment(), occurrences = new Map(); hits = [];
  for (const entry of entries) {
    const line = entry.processName === undefined ? entry.line : `[${entry.processName || '未知进程'}] ${entry.line}`;
    const occurrence = occurrences.get(line) || 0; occurrences.set(line, occurrence + 1);
    const row = document.createElement('div'); row.className = 'level-' + entry.level;
    if (!pattern) row.textContent = line;
    else {
      let offset = 0;
      for (const match of line.matchAll(pattern)) {
        row.append(document.createTextNode(line.slice(offset, match.index)));
        const mark = document.createElement('mark'); mark.textContent = match[0]; row.append(mark);
        hits.push({ node: mark, key: JSON.stringify([line, occurrence, match.index]) });
        offset = match.index + match[0].length;
      }
      row.append(document.createTextNode(line.slice(offset)));
    }
    fragment.append(row);
  }
  logs.replaceChildren(fragment); logs.scrollLeft = left; logs.scrollTop = byId('scroll').checked ? logs.scrollHeight : top;
  currentHit = anchor ? hits.findIndex(hit => hit.key === anchor) : -1;
  if (currentHit < 0 && hits.length) currentHit = Math.min(Math.max(oldIndex, 0), hits.length - 1);
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
      const label = [`级别:${f.level}`, f.text && `关键词:${f.text}`, f.regex && '正则', f.tag && `Tag:${f.tag}`, f.package && `包名:${f.package}`].filter(Boolean).join(' · ');
      const option = new Option(label, JSON.stringify(f)); option.title = label; history.add(option);
    }
    history.value = selected;
  }
  if (data.type === 'filterApplied') {
    for (const id of ['level', 'text', 'tag', 'package']) byId(id).value = data.filter[id];
    byId('regex').checked = data.filter.regex;
    byId('packageStatus').textContent = data.filter.package ? `包名过滤：${data.filter.package}` : (byId('package').disabled ? '离线日志 · 无设备包名映射' : '包名过滤：全部进程');
    byId('packageStatus').title = byId('packageStatus').textContent;
    byId('filterOptionsToggle').ariaPressed = String(!!(data.filter.tag || data.filter.package));
  }
  if (data.type === 'captureState') {
    byId('screenshot').disabled = !data.device || data.screenshotBusy;
    byId('record').disabled = !data.device || data.recordingBusy;
    byId('record').title = byId('record').ariaLabel = data.recordingBusy ? '录屏处理中…' : (data.recording ? '停止录屏并保存' : '开始录屏（无声，最长 180 秒）');
    byId('record').ariaPressed = String(data.recording); byId('record').ariaBusy = String(data.recordingBusy);
  }
  if (data.type === 'status') byId('status').textContent = data.text;
  if (data.type === 'paused') { byId('pause').title = byId('pause').ariaLabel = data.value ? '继续日志显示' : '暂停日志显示'; byId('pause').ariaPressed = String(data.value); }
  if (data.type === 'lines') {
    entries = data.lines; renderLogs();
  }
});
vscode.postMessage({ type: 'ready' });
