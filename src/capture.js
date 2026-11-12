'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { quote } = require('./core');
const recordings = new Map();
const recovery = (error, serial, remote) => new Error(`${error.message}；设备临时文件保留（若已生成）：${serial}:${remote}`);
async function saveDeviceFile(adb, serial, remote, destination, format) {
  const temp = await fs.mkdtemp(path.join(path.dirname(destination), '.android-capture-'));
  try {
    const local = path.join(temp, 'capture.' + format);
    await adb.exec(serial, ['pull', remote, local]);
    const handle = await fs.open(local, 'r');
    const header = Buffer.alloc(12);
    try { await handle.read(header, 0, 12, 0); } finally { await handle.close(); }
    if (format === 'png' ? header.subarray(0,8).toString('hex') !== '89504e470d0a1a0a' : header.subarray(4,8).toString() !== 'ftyp') throw new Error('设备未生成有效的图片或视频');
    await fs.rename(local, destination);
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
  try { await adb.shell(serial, ['rm', '-f', '--', remote]); }
  catch(e) { throw new Error(`本地文件已保存到 ${destination}，设备临时文件清理失败：${e.message}`); }
  return destination;
}
async function screenshot(adb, serial, destination) {
  const remote = `/data/local/tmp/android-tools-${randomUUID()}.png`;
  try {
    await adb.shell(serial, ['screencap', '-p', remote]);
    return await saveDeviceFile(adb, serial, remote, destination, 'png');
  } catch(e) { throw recovery(e, serial, remote); }
}
function startRecording(adb, serial, destination) {
  if (recordings.has(serial)) throw new Error('该设备正在录屏，请先在设备列表停止');
  const remote = `/data/local/tmp/android-tools-${randomUUID()}.mp4`;
  const child = spawn(adb.binary(), ['-s', serial, 'shell', `echo $$; exec screenrecord --time-limit 180 ${quote(remote)}`], { windowsHide: true });
  let pid, output = '', diagnostic = '', ended = false, stopping = false, resolveReady, rejectReady, finish, stopTimer;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  ready.catch(() => {});
  const complete = new Promise((resolve, reject) => {
    finish = error => {
      if (ended) return; ended = true;
      clearTimeout(startup); clearTimeout(watchdog); clearTimeout(stopTimer);
      if (!pid) rejectReady(error || new Error('录屏启动失败'));
      error ? reject(error) : resolve();
    };
  });
  const session = { remote, ready, async stop() {
    if (ended || stopping) return;
    const target = await ready;
    if (ended || stopping) return;
    stopping = true;
    stopTimer = setTimeout(() => { finish(new Error('停止录屏后 15 秒仍未收到进程结束通知，请检查设备连接')); child.kill(); }, 15000);
    try { await adb.shell(serial, ['kill', '-INT', target], { timeout: 10000 }); }
    catch(e) { clearTimeout(stopTimer); stopping = false; if (!ended) throw e; }
  }};
  const startup = setTimeout(() => { finish(new Error('录屏启动超时')); child.kill(); }, 10000);
  const watchdog = setTimeout(() => { session.stop().catch(e => { finish(e); child.kill(); }); }, 190000);
  child.stdout.on('data', chunk => {
    output = (output + chunk.toString()).slice(-65536);
    if (!pid) { const match = output.match(/^([1-9]\d*)\r?\n/); if (match) { pid = match[1]; clearTimeout(startup); resolveReady(pid); } }
  });
  child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk.toString()).slice(-65536); });
  child.on('error', finish);
  child.on('close', code => finish((code === 0 || stopping && code === 130) && pid ? null : new Error(diagnostic || output || `录屏退出 ${code}`)));
  recordings.set(serial, session);
  session.done = complete.then(() => saveDeviceFile(adb, serial, remote, destination, 'mp4')).catch(e => { throw recovery(e, serial, remote); }).finally(() => recordings.delete(serial));
  session.done.catch(() => {});
  return session;
}
module.exports = { screenshot, startRecording };
