'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const c = require('../src/core');
test('remote paths and shell metacharacters stay literal', () => {
  assert.equal(c.quote("a'b;$(id)"), "'a'\\''b;$(id)'");
  assert.equal(c.remotePath('/sdcard/a b'), '/sdcard/a b');
  for (const x of ['relative', '/a/../b', '/a\nb']) assert.throws(() => c.remotePath(x));
  for (const x of ['..', 'a/b', 'a\nb']) assert.throws(() => c.filename(x));
  assert.equal(c.filename("a'b.txt"), "a'b.txt");
});
test('devices retain offline and unauthorized states', () => {
  assert.deepEqual(c.devices('List of devices attached\nabc device product:p model:Pixel_9\nxyz unauthorized\nlocalhost:5555 offline\n').map(d=>[d.serial,d.state,d.model]), [['abc','device','Pixel 9'],['xyz','unauthorized',''],['localhost:5555','offline','']]);
});
test('multi-root discovery excludes build and respects depth', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'android-test-')); t.after(()=>fs.rm(root,{recursive:true,force:true}));
  for (const dir of ['one/app','two','build/fake']) { await fs.mkdir(path.join(root,dir),{recursive:true}); await fs.writeFile(path.join(root,dir,'settings.gradle.kts'),''); }
  assert.equal((await c.discover([root])).length,2);
  assert.deepEqual(await c.discover([root],0),[]);
  assert.equal((await c.discover([path.join(root,'two'),root])).length,2);
});
test('APK metadata supplies variant applicationId and rejects escaping paths', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'apk-test-')); t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.writeFile(path.join(root,'output-metadata.json'), JSON.stringify({applicationId:'com.demo.debug',variantName:'demoDebug',elements:[{outputFile:'app.apk'},{outputFile:'../../escape.apk'}]}));
  const values=await c.artifacts(root); assert.equal(values.length,1); assert.equal(values[0].packageName,'com.demo.debug');
});
test('log level tag keyword regex and changing PID filters', () => {
  const entry=c.parseLog('11-12 12:13:14.123  123  456 E AppTag: hello <script>');
  assert.equal(entry.pid,'123'); assert.equal(entry.level,'E');
  assert.equal(c.filterLog(entry,{level:'W',tag:'App',text:'HELLO'}),true);
  assert.equal(c.filterLog(entry,{level:'F'}),false);
  assert.equal(c.filterLog(entry,{text:'h.llo',regex:true},new Set(['123'])),true);
  assert.equal(c.filterLog(entry,{},new Set(['124'])),false);
  assert.throws(()=>c.filterLog(entry,{text:'[',regex:true}));
});
test('package names reject shell and option injection',()=>{
  assert.equal(c.packageName('com.example.app_debug'),'com.example.app_debug');
  for(const value of ['-x','com.foo;id','com.foo\n','']) assert.throws(()=>c.packageName(value));
});
test('process errors and nonzero exit reject', async()=>{
  await assert.rejects(c.run(process.execPath,['-e','process.exit(7)']),/7/);
  await assert.rejects(c.run('missing-android-tools-binary',[]));
  assert.equal(await c.run(process.execPath,['-e','process.stdout.write("ok")']),'ok');
});
test('directory listing distinguishes links and resolves relative link targets', async () => {
  const adb = new c.Adb(() => 'adb');
  adb.exec = async () => ['D','folder','','LD','sdcard','/storage/emulated/0','LF','alias','../real.txt','F',"a ' b.txt",''].join('\0') + '\0';
  const entries = await adb.list('serial','/example');
  assert.equal(entries.find(e=>e.name==='sdcard').directory, true);
  assert.equal(entries.find(e=>e.name==='sdcard').symlink, true);
  assert.equal(entries.find(e=>e.name==='sdcard').target, '/storage/emulated/0');
  assert.equal(entries.find(e=>e.name==='alias').target, '/real.txt');
  assert.equal(entries.find(e=>e.name==="a ' b.txt").symlink, false);
});
