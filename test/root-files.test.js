'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {Adb}=require('../src/core');
test('Root authorization is device scoped and ordinary shell stays unprivileged',async()=>{
 const adb=new Adb(()=> 'adb'), calls=[];
 adb.exec=async(serial,args)=>{calls.push({serial,args});return args[1]==="'id' '-u'"?'2000\n':'0\n';};
 await adb.enableFileRoot('a');
 assert.equal(adb.fileRoots.get('a').kind,'su');assert.equal(adb.fileRoots.has('b'),false);
 await adb.fileShell('a',['ls',"/data/data/a'b"]);
 assert.match(calls.at(-1).args[1],/^su -c /);
 await adb.shell('a',['pm','list','packages']);assert.doesNotMatch(calls.at(-1).args[1],/^su /);
 adb.exec=async()=>{throw new Error('denied');};
 await assert.rejects(adb.enableFileRoot('a'),/denied/);assert.equal(adb.fileRoots.has('a'),false);
});
test('private transfer cleans staging after errors and rejects local links',async()=>{
 const adb=new Adb(()=> 'adb'), calls=[];
 adb.fileRoots.set('a',{kind:'su',uid:'2000'});
 adb.shell=async(_,args)=>calls.push(args);
 adb.fileShell=async(_,args)=>calls.push(args);
 adb.fileScript=async()=>{};
 adb.exec=async()=>{throw new Error('transfer failed');};
 await assert.rejects(adb.pullFile('a','/data/data/pkg/file','/tmp/unused'),/transfer failed/);
 assert.deepEqual(calls.at(-1).slice(0,3),['rm','-rf','--']);
 assert.equal(calls[0].at(-1),calls.at(-1).at(-1));
 const local=await fs.mkdtemp(path.join(os.tmpdir(),'root-unit-'));
 try{await fs.symlink('/tmp',path.join(local,'link'));
 await assert.rejects(adb.pushFile('a',local,'/data/data/pkg/'),/符号链接/);}
 finally{await fs.rm(local,{recursive:true,force:true});}
});
test('root adbd private uploads also preserve application metadata',async()=>{
 const adb=new Adb(()=> 'adb'), scripts=[], calls=[];
 adb.fileRoots.set('a',{kind:'adbd',uid:'0'});
 adb.shell=async(_,args)=>calls.push(args);adb.fileShell=async(_,args)=>calls.push(args);
 adb.exec=async(_,args)=>calls.push(args);adb.fileScript=async(_,script)=>scripts.push(script);
 const local=await fs.mkdtemp(path.join(os.tmpdir(),'root-adbd-'));
 try{
  const source=path.join(local,'file');await fs.writeFile(source,'value');
  await adb.pushFile('a',source,'/data/data/pkg/file');
  assert.equal(scripts.length,1);assert.match(scripts[0],/cp --preserve=mode,ownership,context/);
  assert.match(scripts[0],/chown "\$owner"/);assert.match(scripts[0],/chcon "\$context"/);
  assert.ok(calls.find(args=>args[0]==='push'&&args[2].startsWith('/data/local/tmp/android-tools-files-')));
  assert.equal(calls.at(-1)[0],'rm');
 }finally{await fs.rm(local,{recursive:true,force:true});}
});
