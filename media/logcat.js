'use strict';
const vscode = acquireVsCodeApi();
const byId = id => document.getElementById(id);
for (const id of ['newTab','split','apply','pause','clear','deviceClear','copy','import','export','restart']) byId(id).addEventListener('click', () => {
  if (id === 'apply') vscode.postMessage({ type: 'filter', filter: { level: byId('level').value, text: byId('text').value, regex: byId('regex').checked, tag: byId('tag').value, package: byId('package').value } });
  else vscode.postMessage({ type: id });
});
byId('history').addEventListener('change', () => {
  if (byId('history').value) vscode.postMessage({ type: 'useFilter', filter: JSON.parse(byId('history').value) });
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
  if (data.type === 'status') byId('status').textContent = data.text;
  if (data.type === 'paused') byId('pause').textContent = data.value ? '继续' : '暂停';
  if (data.type === 'lines') {
    const logs = byId('logs'), top = logs.scrollTop;
    const fragment = document.createDocumentFragment();
    for (const entry of data.lines) { const row = document.createElement('div'); row.className = 'level-' + entry.level; row.textContent = entry.line; fragment.append(row); }
    logs.replaceChildren(fragment); logs.scrollTop = byId('scroll').checked ? logs.scrollHeight : top;
  }
});
vscode.postMessage({ type: 'ready' });
