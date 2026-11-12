'use strict';
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const {Adb}=require('../src/core');
const {screenshot,startRecording}=require('../src/capture');
(async()=>{
  const serial=process.argv[2];if(!serial)throw Error('Pass a device serial');
  const adb=new Adb(()=>process.env.ADB || 'adb');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'android-capture-smoke-'));
  await screenshot(adb,serial,path.join(dir,'screenshot.png'));
  assert.equal((await fs.readFile(path.join(dir,'screenshot.png'))).subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  const session=startRecording(adb,serial,path.join(dir,'recording.mp4'));
  console.log('Recording PID:',await session.ready);
  await new Promise(resolve=>setTimeout(resolve,2500));await session.stop();await session.done;
  const mp4=await fs.readFile(path.join(dir,'recording.mp4'));assert.equal(mp4.subarray(4,8).toString(),'ftyp');assert.ok(mp4.length>1024);
  console.log('PASS PNG screenshot, MP4 recording and precise PID stop:',dir);
})().catch(e=>{console.error(e);process.exitCode=1;});
