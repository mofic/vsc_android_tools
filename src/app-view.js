'use strict';
const v = require('vscode');
const { randomBytes } = require('node:crypto');
const actions = {
  selectDevice:'选择设备', selectProject:'选择项目', selectPackage:'确认／切换包名',
  build:'构建并安装启动', installProject:'安装项目 APK', launch:'启动', stop:'停止',
  uninstall:'卸载应用', clearData:'清空应用数据', revoke:'撤销运行时权限', install:'安装其他 APK…'
};
function registerAppView(ctx, getState, execute) {
  let view, busy = false;
  const update = () => { if (view) view.webview.postMessage({ type:'state', ...getState(), busy }); };
  const provider = { resolveWebviewView(resolved) {
    view = resolved;
    const nonce = randomBytes(16).toString('hex');
    view.webview.options = { enableScripts:true, localResourceRoots:[v.Uri.joinPath(ctx.extensionUri,'media')] };
    const style = view.webview.asWebviewUri(v.Uri.joinPath(ctx.extensionUri,'media','app.css'));
    const script = view.webview.asWebviewUri(v.Uri.joinPath(ctx.extensionUri,'media','app.js'));
    const buttons = Object.entries(actions).filter(([id]) => !['selectDevice','selectProject','selectPackage'].includes(id)).map(([id,title]) => `<button data-command="${id}"${['uninstall','clearData','revoke'].includes(id)?' class="danger"':id==='build'?' class="primary"':''}>${title}</button>`).join('');
    view.webview.html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${view.webview.cspSource}; script-src 'nonce-${nonce}'"><link rel="stylesheet" href="${style}"></head><body><dl><dt>项目</dt><dd><button class="target" id="project" data-command="selectProject">选择项目…</button></dd><dt>设备</dt><dd><button class="target" id="device" data-command="selectDevice">选择设备…</button></dd><dt>包名</dt><dd><button class="target" id="package" data-command="selectPackage">确认包名…</button></dd></dl><div class="actions">${buttons}</div><p id="status" role="status">操作使用上方目标，卸载和清数据需确认。</p><script nonce="${nonce}" src="${script}"></script></body></html>`;
    ctx.subscriptions.push(view.webview.onDidReceiveMessage(async message => {
      if (message?.type === 'ready') { update(); return; }
      if (busy || message?.type !== 'command' || !Object.hasOwn(actions,message.command)) return;
      busy = true; update();
      try { await execute(message.command); }
      catch(e) { v.window.showErrorMessage(`Android Tools: ${e.message}`); }
      finally { busy = false; update(); }
    }));
    ctx.subscriptions.push(view.onDidDispose(() => { if (view === resolved) view = undefined; }));
    update();
  }};
  ctx.subscriptions.push(v.window.registerWebviewViewProvider('androidApp',provider,{webviewOptions:{retainContextWhenHidden:true}}));
  return update;
}
module.exports = { registerAppView, actions };
