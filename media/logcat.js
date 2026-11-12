'use strict';
const vscode = acquireVsCodeApi();
const byId = id => document.getElementById(id);
for (const id of ['screenshot','record','newTab','split','apply','pause','clear','deviceClear','copy','import','export','restart']) byId(id).addEventListener('click', () => {
  if (id === 'apply') vscode.postMessage({ type: 'filter', filter: { level: byId('level').value, text: byId('text').value, regex: byId('regex').checked, tag: byId('tag').value, package: byId('package').value } });
  else vscode.postMessage({ type: id });
});
byId('history').addEventListener('change', () => {
  if (byId('history').value) vscode.postMessage({ type: 'useFilter', filter: JSON.parse(byId('history').value) });
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
  const logs = byId('logs'), top = logs.scrollTop, anchor = hits[currentHit]?.key, oldIndex = currentHit;
  const query = byId('findText').value;
  const pattern = query ? new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi') : null;
  const fragment = document.createDocumentFragment(), occurrences = new Map(); hits = [];
  for (const entry of entries) {
    const occurrence = occurrences.get(entry.line) || 0; occurrences.set(entry.line, occurrence + 1);
    const row = document.createElement('div'); row.className = 'level-' + entry.level;
    if (!pattern) row.textContent = entry.line;
    else {
      let offset = 0;
      for (const match of entry.line.matchAll(pattern)) {
        row.append(document.createTextNode(entry.line.slice(offset, match.index)));
        const mark = document.createElement('mark'); mark.textContent = match[0]; row.append(mark);
        hits.push({ node: mark, key: JSON.stringify([entry.line, occurrence, match.index]) });
        offset = match.index + match[0].length;
      }
      row.append(document.createTextNode(entry.line.slice(offset)));
    }
    fragment.append(row);
  }
  logs.replaceChildren(fragment); logs.scrollTop = byId('scroll').checked ? logs.scrollHeight : top;
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
  if (event.key === 'Escape') { event.preventDefault(); byId('findText').value = ''; renderLogs(); byId('logs').focus(); }
});
window.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); byId('findText').focus(); byId('findText').select(); }
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
  }
  if (data.type === 'captureState') {
    byId('screenshot').disabled = !data.device || data.screenshotBusy;
    byId('record').disabled = !data.device || data.recordingBusy;
    byId('record').textContent = data.recordingBusy ? '处理中…' : (data.recording ? '停止录屏' : '开始录屏');
  }
  if (data.type === 'status') byId('status').textContent = data.text;
  if (data.type === 'paused') byId('pause').textContent = data.value ? '继续' : '暂停';
  if (data.type === 'lines') {
    entries = data.lines; renderLogs();
  }
});
vscode.postMessage({ type: 'ready' });
