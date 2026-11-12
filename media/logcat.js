'use strict';
const vscode = acquireVsCodeApi();
const byId = id => document.getElementById(id);
for (const id of ['apply','pause','clear','deviceClear','copy','import','export','restart']) byId(id).addEventListener('click', () => {
  if (id === 'apply') vscode.postMessage({ type: 'filter', filter: { level: byId('level').value, text: byId('text').value, regex: byId('regex').checked, tag: byId('tag').value, package: byId('package').value } });
  else vscode.postMessage({ type: id });
});
window.addEventListener('message', ({ data }) => {
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
