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
  let inaccessible = false; const opened=[];
  const mock={
    workspace:{isTrusted:true,getConfiguration:()=>({get:(_,fallback)=>fallback}),onDidChangeWorkspaceFolders:disposable},
    window:{createOutputChannel:()=>({...disposable(),append(){},appendLine(){}}),createStatusBarItem:()=>({...disposable(),show(){}}),showErrorMessage:message=>errors.push(message),showTextDocument:async(uri,opts)=>opened.push({uri,opts}),withProgress:async(_,action)=>action({},{}),showWarningMessage:async()=> '确认',registerTreeDataProvider:(id,p)=>{trees.set(id,p);return disposable()}},
    commands:{executeCommand:async (id,uri,opts)=>{calls.push(id);if(id==='vscode.open')opened.push({uri,opts});},registerCommand:(id,fn)=>{commands.set(id,fn);return disposable()}},
    Uri:{file:fsPath=>({fsPath})},ProgressLocation:{Notification:1},StatusBarAlignment:{Left:1},EventEmitter:class{event=()=>{};fire(){}dispose(){}},
    TreeItem:class{constructor(label){this.label=label}},ThemeIcon:class{constructor(id){this.id=id}},TreeItemCollapsibleState:{Collapsed:1,None:0}
  };
  const original=Module._load, exec=Adb.prototype.exec;
  Module._load=function(id,...args){return id==='vscode'?mock:original.call(this,id,...args)};
  Adb.prototype.exec=async(serial,args)=> {
    if (args[0] === 'devices') return 'List of devices attached\nserial device model:Pixel\n';
    calls.push({ serial, args });
    if (inaccessible) throw new Error('Permission denied');
    if (args[0] === 'pull') { await fs.writeFile(args[2], 'target content'); return ''; }
    return ['D','files','','LD','sdcard','/storage/emulated/0','LF','alias','/real.txt'].join('\0') + '\0';
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
    const linkFolder = children.find(f=>f.name==='sdcard'), linkFile=children.find(f=>f.name==='alias');
    assert.equal(trees.get('androidFiles').getTreeItem(linkFolder).iconPath.id, 'file-symlink-directory');
    assert.equal(trees.get('androidFiles').getTreeItem(linkFile).iconPath.id, 'file-symlink-file');
    assert.match(trees.get('androidFiles').getTreeItem(linkFile).tooltip, /real.txt/);
    const nested=await trees.get('androidFiles').getChildren(linkFolder);
    assert.equal(nested[0].remote, '/storage/emulated/0/files');
    await commands.get('androidTools.open')(linkFile);
    await commands.get('androidTools.open')(linkFile);
    assert.equal(calls.filter(call=>call.args?.[0]==='pull').length, 1);
    assert.equal(calls.find(call=>call.args?.[0]==='pull').args[1], '/real.txt');
    assert.equal(opened[0].uri.fsPath, opened[1].uri.fsPath);
    assert.equal(await fs.readFile(opened[0].uri.fsPath,'utf8'), 'target content');
    mock.window.activeTextEditor={document:{uri:opened[0].uri,save:async()=>true}};
    await commands.get('androidTools.save')();
    assert.equal(calls.find(call=>call.args?.[0]==='push').args[2], '/real.txt');
    inaccessible = true;
    await commands.get('androidTools.openAppDirectory')();
    assert.match(errors.pop(), /目录不存在或无权访问/);
    assert.ok(!calls.some(call => typeof call === 'object' && /\b(mkdir|touch|rm)\b/.test(call.args.join(' '))));
  } finally {for(const item of subscriptions)item.dispose();Module._load=original;Adb.prototype.exec=exec;await fs.rm(project,{recursive:true,force:true});}
});
