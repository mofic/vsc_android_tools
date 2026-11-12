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
  const links = '/data/local/tmp/AndroidToolsLinks-' + Date.now();
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
    await adb.shell(serial,['mkdir',links]);
    await adb.shell(serial,['ln','-s',remote+'/renamed.txt',links+'/file-link']);
    await adb.shell(serial,['ln','-s',remote+'/folder',links+'/folder-link']);
    await adb.shell(serial,['ln','-s','missing',links+'/broken-link']);
    const linkEntries = await adb.list(serial,links);
    assert.ok(linkEntries.find(f=>f.name==='file-link').symlink);
    assert.equal(linkEntries.find(f=>f.name==='file-link').target, await adb.shell(serial,['readlink','-f',remote+'/renamed.txt']).then(s=>s.trim()));
    assert.ok(linkEntries.find(f=>f.name==='folder-link').directory);
    assert.ok((await adb.list(serial,linkEntries.find(f=>f.name==='folder-link').target)).some(f=>f.name==='child.txt'));
    assert.ok(linkEntries.find(f=>f.name==='broken-link').symlink);
    const linkDownload=path.join(local,'link-target.txt');
    await adb.exec(serial,['pull',linkEntries.find(f=>f.name==='file-link').target,linkDownload]);
    assert.equal(await fs.readFile(linkDownload,'utf8'),'edited 世界\n');
    const sdcard = (await adb.list(serial,'/')).find(f=>f.name==='sdcard');
    assert.ok(sdcard.symlink && sdcard.directory); console.log('PASS: /sdcard directory link, file link target, broken link, linked folder expansion');
    console.log('PASS: device, list, create, upload, overwrite, rename, download, recursive transfer, logcat');
  } finally { await adb.shell(serial,['rm','-rf',remote,links]); await fs.rm(local,{recursive:true,force:true}); }
})().catch(e=>{console.error(e);process.exitCode=1;});
