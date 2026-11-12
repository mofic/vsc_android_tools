'use strict';
const v = require('vscode');
const capture = require('./capture');
function deviceCapture(ctx, adb, changed, error) {
  const sessions = new Map(), busy = new Set(), screenshots = new Set();
  let disposed = false;
  const trust = () => { if (!v.workspace.isTrusted) throw new Error('请先信任工作区'); };
  const state = serial => busy.has(serial) ? 'Busy' : sessions.has(serial) ? 'Recording' : '';
  async function screenshot(serial) {
    trust(); if (screenshots.has(serial) || disposed) return;
    screenshots.add(serial);
    try {
      const uri = await v.window.showSaveDialog({ title: `设备截屏 · ${serial}`, defaultUri:v.Uri.file(`screenshot-${Date.now()}.png`), filters:{PNG:['png']} });
      if (!uri || disposed) return;
      if (uri.scheme !== 'file') throw new Error('请选择本地保存路径');
      await capture.screenshot(adb,serial,uri.fsPath);
      v.window.showInformationMessage(`截图已保存：${uri.fsPath}`);
      await v.commands.executeCommand('vscode.open',uri);
    } finally { screenshots.delete(serial); }
  }
  async function stop(serial) {
    const entry = sessions.get(serial); if (!entry || busy.has(serial)) return;
    busy.add(serial); entry.status.text = `$(sync~spin) 录屏保存中 · ${serial}`; changed();
    try { await entry.session.stop(); }
    catch(e) { busy.delete(serial); entry.status.text = `$(debug-stop) 停止录屏 · ${serial}`; changed(); throw e; }
  }
  async function record(serial) {
    trust(); if (disposed || busy.has(serial) || sessions.has(serial)) return;
    busy.add(serial); changed();
    try {
      const uri = await v.window.showSaveDialog({ title:`录屏保存位置 · ${serial}`, defaultUri:v.Uri.file(`recording-${Date.now()}.mp4`), filters:{MP4:['mp4']} });
      if (!uri || disposed) { busy.delete(serial); changed(); return; }
      if (uri.scheme !== 'file') throw new Error('请选择本地保存路径');
      const session = capture.startRecording(adb,serial,uri.fsPath);
      const status = v.window.createStatusBarItem(v.StatusBarAlignment.Left);
      status.text = `$(debug-stop) 停止录屏 · ${serial}`;
      status.tooltip = '停止录屏并保存（无声，最长 180 秒）';
      status.command = { command:'androidTools.stopRecording', title:'停止录屏', arguments:[{serial}] };
      status.show(); sessions.set(serial,{session,status});
      session.done.finally(() => {
        sessions.delete(serial); busy.delete(serial); status.dispose(); if (!disposed) changed();
      }).then(() => { if (!disposed) v.window.showInformationMessage(`录屏已保存：${uri.fsPath}`); }, e => { if (!disposed) error(e); });
      await session.ready.catch(() => {});
      busy.delete(serial); if (!disposed) changed();
    } catch(e) { busy.delete(serial); changed(); throw e; }
  }
  ctx.subscriptions.push({ dispose() {
    disposed = true;
    for (const {session,status} of sessions.values()) { status.dispose(); session.stop().catch(error); }
  } });
  return { screenshot, record, stop, state };
}
module.exports = { deviceCapture };
