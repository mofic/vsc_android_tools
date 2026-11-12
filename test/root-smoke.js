// Explicit opt-in: only modifies a unique fixture under /data/data, never an installed app.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {Adb,quote}=require('../src/core');
(async()=>{
 const serial=process.argv[2];if(!serial)throw new Error('Pass device serial');
 const adb=new Adb(()=>process.env.ADB||'adb');
 await adb.enableFileRoot(serial);
 const remote='/data/data/AndroidToolsRootSmoke-'+Date.now();
 const local=await fs.mkdtemp(path.join(os.tmpdir(),'android-root-smoke-'));
 try{
  // Metadata only: confirm the actual installed application's private directory opens.
  assert.ok((await adb.list(serial,'/data/data/com.android.settings')).length);
  await adb.fileShell(serial,['mkdir','-m','700',remote]);
  await adb.fileShell(serial,['chown','10000:10000',remote]);
  await assert.rejects(adb.shell(serial,['ls',remote]),/denied/i);
  const name="hello ' $HOME `id` 世界.bin", source=path.join(local,name), dest=remote+'/'+name;
  const bytes=Buffer.from([0,1,2,255,10,128]);await fs.writeFile(source,bytes);
  await adb.pushFile(serial,source,remote+'/');
  const stat=()=>adb.fileShell(serial,['stat','-c','%u:%g %a %C',dest]);
  const before=(await stat()).trim();assert.match(before,/^10000:10000 600 /);
  assert.ok((await adb.list(serial,remote)).some(f=>f.name===name&&f.size===bytes.length));
  const received=path.join(local,'received.bin');await adb.pullFile(serial,dest,received);
  assert.deepEqual(await fs.readFile(received),bytes);
  await adb.fileShell(serial,['chmod','640',dest]);
  const metadata=await stat();await fs.writeFile(source,'edited');await adb.pushFile(serial,source,dest);
  assert.equal(await stat(),metadata);
  await adb.pullFile(serial,dest,received);assert.equal(await fs.readFile(received,'utf8'),'edited');
  const folder=path.join(local,'folder');await fs.mkdir(folder);await fs.writeFile(path.join(folder,'.hidden'),'nested');
  await adb.pushFile(serial,folder,remote+'/');await adb.pullFile(serial,remote+'/folder',path.join(local,'download'));
  assert.equal(await fs.readFile(path.join(local,'download','.hidden'),'utf8'),'nested');
  await adb.createFile(serial,remote+'/new',true);await adb.createFile(serial,remote+'/new/empty',false);
  assert.match(await adb.fileShell(serial,['stat','-c','%u:%g %a',remote+'/new/empty']),/^10000:10000 600/);
  await assert.rejects(adb.createFile(serial,remote+'/new/empty',false),/已存在/);
  await adb.fileScript(serial,'mv -- '+quote(dest)+' '+quote(remote+'/renamed.bin'));
  await adb.fileShell(serial,['rm','--',remote+'/renamed.bin']);
  assert.ok(!(await adb.list(serial,remote)).some(f=>f.name==='renamed.bin'));
  console.log('PASS: real private app directory listing; Root binary/file/folder upload/download, hidden files, create/rename/delete, literal shell names, owner/mode/SELinux preservation.');
 }finally{
  await adb.fileShell(serial,['rm','-rf','--',remote]);
  await fs.rm(local,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
