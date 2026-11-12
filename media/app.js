'use strict';
const vscode = acquireVsCodeApi();
const buttons = [...document.querySelectorAll('[data-command]')];
for (const button of buttons) button.addEventListener('click', () => vscode.postMessage({ type:'command',command:button.dataset.command }));
window.addEventListener('message', ({data}) => {
  if (data.type !== 'state') return;
  for (const [id,value] of Object.entries({project:data.project || '未选择项目',device:data.device || '未选择设备',package:data.packageName || '待确认 applicationId'})) {
    document.getElementById(id).textContent = value; document.getElementById(id).title = value;
  }
  for (const button of buttons) button.disabled = data.busy;
  document.getElementById('status').textContent = data.busy ? '正在执行，请稍候…' : '操作使用上方目标，卸载和清数据需确认。';
});
vscode.postMessage({type:'ready'});
