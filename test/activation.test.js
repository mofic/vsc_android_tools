'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { Adb } = require('../src/core');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
test('activates every contributed command and tree, then disposes timers', async () => {
  const commands=new Map(), trees=new Map(), subscriptions=[];
  const disposable=()=>({dispose(){}});
  const project = await fs.mkdtemp(path.join(os.tmpdir(), 'android-project-'));
  await fs.writeFile(path.join(project, 'output-metadata.json'), JSON.stringify({ applicationId: 'com.example.debug', elements: [{ outputFile: 'app.apk' }] }));
  const state=new Map([['project', project]]), calls=[], errors=[];
  let inaccessible = false;
  const mock={
    workspace:{isTrusted:true,getConfiguration:()=>({get:(_,fallback)=>fallback}),onDidChangeWorkspaceFolders:disposable},
    window:{createOutputChannel:()=>({...disposable(),append(){},appendLine(){}}),createStatusBarItem:()=>({...disposable(),show(){}}),showErrorMessage:message=>errors.push(message),registerTreeDataProvider:(id,p)=>{trees.set(id,p);return disposable()}},
    commands:{executeCommand:async id=>calls.push(id),registerCommand:(id,fn)=>{commands.set(id,fn);return disposable()}},
    StatusBarAlignment:{Left:1},EventEmitter:class{event=()=>{};fire(){}dispose(){}},
    TreeItem:class{constructor(label){this.label=label}},ThemeIcon:class{},TreeItemCollapsibleState:{Collapsed:1,None:0}
  };
  const original=Module._load, exec=Adb.prototype.exec;
  Module._load=function(id,...args){return id==='vscode'?mock:original.call(this,id,...args)};
  Adb.prototype.exec=async(serial,args)=> {
    if (args[0] === 'devices') return 'List of devices attached\nserial device model:Pixel\n';
    calls.push({ serial, args });
    if (inaccessible) throw new Error('Permission denied');
    return 'files/\n';
  };
  try {
    const extension=require('../src/extension');
    extension.activate({subscriptions,workspaceState:{get:key=>state.get(key),update:(k,v)=>state.set(k,v)}});
    await new Promise(resolve=>setImmediate(resolve));
    const manifest=require('../package.json');
    assert.deepEqual([...commands.keys()].sort(),manifest.contributes.commands.map(x=>x.command).sort());
    const devices=await trees.get('androidDevices').getChildren(); assert.equal(devices[0].serial,'serial');
    await commands.get('androidTools.selectDevice')(devices[0]);
    assert.equal(trees.get('androidDevices').getTreeItem(devices[0]).description,'serial · 当前');
    await commands.get('androidTools.openAppDirectory')();
    assert.equal(state.get(`package:${project}`), 'com.example.debug');
    assert.ok(calls.includes('androidFiles.focus'));
    const children = await trees.get('androidFiles').getChildren();
    assert.equal(children[0].remote, '/sdcard/Android/data/com.example.debug/files');
    assert.equal(children[0].serial, 'serial');
    inaccessible = true;
    await commands.get('androidTools.openAppDirectory')();
    assert.match(errors.pop(), /目录不存在或无权访问/);
    assert.ok(!calls.some(call => typeof call === 'object' && /mkdir|touch|rm/.test(call.args.join(' '))));
  } finally {for(const item of subscriptions)item.dispose();Module._load=original;Adb.prototype.exec=exec;await fs.rm(project,{recursive:true,force:true});}
});
