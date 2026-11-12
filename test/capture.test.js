'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const Module=require('node:module');
const {EventEmitter}=require('node:events');
test('screenshot saves valid PNG safely and preserves existing destination on transfer failure',async t=>{
  const {screenshot}=require('../src/capture');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'capture-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const dest=path.join(dir,'screen.png'),calls=[];
  const adb={shell:async(serial,args)=>calls.push({serial,args}),exec:async(serial,args)=>{calls.push({serial,args});await fs.writeFile(args[2],Buffer.from('89504e470d0a1a0a0000','hex'));}};
  await screenshot(adb,'device-a',dest);assert.ok((await fs.readFile(dest)).equals(Buffer.from('89504e470d0a1a0a0000','hex')));
  assert.ok(calls.every(c=>c.serial==='device-a'));assert.equal(calls.at(-1).args[0],'rm');
  adb.exec=async()=>{throw Error('disconnected')};
  await assert.rejects(screenshot(adb,'device-a',dest),/设备临时文件保留/);
  assert.equal((await fs.readFile(dest)).subarray(0,8).toString('hex'),'89504e470d0a1a0a');
});
test('recording stops only its own PID, prevents duplicate device sessions and saves MP4',async t=>{
  const original=Module._load,children=[],calls=[];
  const spawn=()=>{const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>child.emit('close',1);children.push(child);return child;};
  Module._load=function(id,...args){return id==='node:child_process'?{spawn}:original.call(this,id,...args)};
  delete require.cache[require.resolve('../src/capture')];
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'record-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  try{
    const {startRecording}=require('../src/capture');
    const adb={binary:()=> 'adb',shell:async(serial,args)=>{calls.push({serial,args});if(args[0]==='kill')children[0].emit('close',0);},exec:async(_,args)=>fs.writeFile(args[2],Buffer.from('00000018667479706d703432','hex'))};
    const recording=startRecording(adb,'device-a',path.join(dir,'video.mp4'));
    assert.throws(()=>startRecording(adb,'device-a',path.join(dir,'other.mp4')),/正在录屏/);
    children[0].stdout.emit('data',Buffer.from('12'));children[0].stdout.emit('data',Buffer.from('34\n'));
    await recording.ready;await recording.stop();await recording.done;
    assert.deepEqual(calls.find(c=>c.args[0]==='kill'),{serial:'device-a',args:['kill','-INT','1234']});
    assert.equal((await fs.readFile(path.join(dir,'video.mp4'))).subarray(4,8).toString(),'ftyp');
    const next=startRecording(adb,'device-a',path.join(dir,'next.mp4'));children[1].emit('error',Error('device disconnected'));
    await assert.rejects(next.done,/device disconnected/);
  }finally{Module._load=original;}
});
