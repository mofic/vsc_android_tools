// Explicit opt-in: creates and deletes only a unique test directory on the selected device.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const c = require('../src/core');
(async () => {
  const adb = new c.Adb(() => process.env.ADB || 'adb');
  const serial = process.argv[2]; if (!serial) throw new Error('Pass a device serial');
  assert.ok(c.devices(await adb.exec(null,['devices','-l'])).some(d=>d.serial===serial && d.state==='device'));
  const local = await fs.mkdtemp(path.join(os.tmpdir(),'android-device-smoke-'));
  const remote = '/sdcard/AndroidToolsSmoke-' + Date.now();
  try {
    await adb.shell(serial,['mkdir',remote]);
    const source = path.join(local,"hello ' 世界.txt");
    await fs.writeFile(source,'first\n');
    await adb.exec(serial,['push',source,remote+'/']);
    let listing=await adb.list(serial,remote); assert.equal(listing[0].name,path.basename(source));
    await fs.writeFile(source,'edited 世界\n'); await adb.exec(serial,['push',source,remote+'/'+path.basename(source)]);
    await adb.shell(serial,['mv',remote+'/'+path.basename(source),remote+'/renamed.txt']);
    const dest=path.join(local,'download.txt'); await adb.exec(serial,['pull',remote+'/renamed.txt',dest]);
    assert.equal(await fs.readFile(dest,'utf8'),'edited 世界\n');
    const folder=path.join(local,'folder'); await fs.mkdir(folder); await fs.writeFile(path.join(folder,'child.txt'),'nested');
    await adb.exec(serial,['push',folder,remote+'/']);
    await adb.exec(serial,['pull',remote+'/folder',path.join(local,'received')]);
    assert.equal(await fs.readFile(path.join(local,'received','child.txt'),'utf8'),'nested');
    assert.ok((await adb.list(serial,remote)).some(f=>f.name==='folder' && f.directory));
    const log=await adb.exec(serial,['logcat','-d','-t','10','-v','threadtime']); assert.ok(log.length);
    console.log('PASS: device, list, create, upload, overwrite, rename, download, recursive transfer, logcat');
  } finally { await adb.shell(serial,['rm','-rf',remote]); await fs.rm(local,{recursive:true,force:true}); }
})().catch(e=>{console.error(e);process.exitCode=1;});
