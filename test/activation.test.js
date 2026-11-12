'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { Adb } = require('../src/core');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const metadata = fields => { const result=[]; for(let i=0;i<fields.length;i+=3)result.push(...fields.slice(i,i+3),'',''); return result.join('\0')+'\0'; };
test('activates every contributed command and tree, then disposes timers', async () => {
  const commands=new Map(), trees=new Map(), subscriptions=[];
  const disposable=()=>({dispose(){}});
  const project = await fs.mkdtemp(path.join(os.tmpdir(), 'android-project-'));
  await fs.writeFile(path.join(project, 'output-metadata.json'), JSON.stringify({ applicationId: 'com.example.debug', elements: [{ outputFile: 'app.apk' }] }));
  const state=new Map([['project', project]]), calls=[], errors=[];
  let inaccessible = false, onEdit, inputs=0; const opened=[], bars=[];
  const mock={
    workspace:{isTrusted:true,getConfiguration:()=>({get:(_,fallback)=>fallback}),onDidChangeTextDocument:fn=>{onEdit=fn;return disposable();},onDidSaveTextDocument:disposable,onDidChangeWorkspaceFolders:disposable},
    window:{showInputBox:async()=>{inputs++;return undefined;},onDidChangeActiveTextEditor:disposable,showInformationMessage:()=>{},createTreeView:(id,options)=>{trees.set(id,options.treeDataProvider);return disposable();},createOutputChannel:()=>({...disposable(),append(){},appendLine(){}}),createStatusBarItem:()=>{const bar={...disposable(),show(){},hide(){}};bars.push(bar);return bar;},showErrorMessage:message=>errors.push(message),showTextDocument:async(uri,opts)=>opened.push({uri,opts}),withProgress:async(_,action)=>action({},{}),showWarningMessage:async()=> '确认',registerTreeDataProvider:(id,p)=>{trees.set(id,p);return disposable()}},
    commands:{executeCommand:async (id,uri,opts)=>{calls.push(id);if(id==='vscode.open')opened.push({uri,opts});},registerCommand:(id,fn)=>{commands.set(id,fn);return disposable()}},
    Uri:{file:fsPath=>({fsPath})},ProgressLocation:{Notification:1},StatusBarAlignment:{Left:1},EventEmitter:class{event=()=>{};fire(){}dispose(){}},
    TreeItem:class{constructor(label){this.label=label}},ThemeIcon:class{constructor(id){this.id=id}},TreeItemCollapsibleState:{Collapsed:1,None:0}
  };
  const original=Module._load, exec=Adb.prototype.exec, originalInterval=global.setInterval;
  let poll; global.setInterval=fn=>{poll=fn;return {};};
  Module._load=function(id,...args){return id==='vscode'?mock:original.call(this,id,...args)};
  Adb.prototype.exec=async(serial,args)=> {
    if (args[0] === 'devices') return 'List of devices attached\nserial device model:Pixel\n';
    calls.push({ serial, args });
    if (inaccessible) throw new Error('Permission denied');
    if (args[0] === 'pull') { await fs.writeFile(args[2], 'target content'); return ''; }
    return metadata(['drwxr-xr-x','files','','drwxr-xr-x','sdcard','/storage/emulated/0','-rw-r--r--','alias','/real.txt']);
  };
  try {
    const extension=require('../src/extension');
    extension.activate({subscriptions,workspaceState:{get:(key,fallback)=>state.has(key)?state.get(key):fallback,update:(k,v)=>state.set(k,v)}});
    await new Promise(resolve=>setImmediate(resolve));
    const manifest=require('../package.json');
    assert.deepEqual([...commands.keys()].sort(),manifest.contributes.commands.map(x=>x.command).sort());
    const devices=await trees.get('androidDevices').getChildren(); assert.equal(devices[0].serial,'serial');
    await commands.get('androidTools.selectDevice')(devices[0]);
    assert.equal(trees.get('androidDevices').getTreeItem(devices[0]).description,'serial · 当前');
    await commands.get('androidTools.openAppDirectory')();
    assert.equal(state.get(`package:${project}`), 'com.example.debug');
    assert.ok(calls.includes('androidFiles.focus'));
    const listCount = () => calls.filter(call=>call.args?.[0]==='shell').length;
    const beforeListing = listCount();
    const [children] = await Promise.all([trees.get('androidFiles').getChildren(), trees.get('androidFiles').getChildren()]);
    assert.equal(listCount(),beforeListing); // App-directory validation already cached this listing.
    await poll(); await trees.get('androidFiles').getChildren();
    assert.equal(listCount(),beforeListing);
    assert.ok(!calls.some(call=>['pull','push'].includes(call.args?.[0])));
    await commands.get('androidTools.refresh')();
    const beforeReload=listCount();
    await Promise.all([trees.get('androidFiles').getChildren(),trees.get('androidFiles').getChildren()]);
    assert.equal(listCount(),beforeReload+1);
    await commands.get('androidTools.newFolder')({viewId:'androidFiles'});assert.equal(inputs,1);assert.equal(errors.length,0);
    assert.equal(children[0].parent, true);
    const parentItem = trees.get('androidFiles').getTreeItem(children[0]);
    assert.equal(parentItem.command.command, 'androidTools.goParent');
    assert.equal(parentItem.contextValue, 'androidParent');
    assert.equal(children.find(f=>f.name==='files').remote, '/sdcard/Android/data/com.example.debug/files');
    assert.equal(children[0].serial, 'serial');
    await commands.get(parentItem.command.command)();
    const upper = await trees.get('androidFiles').getChildren();
    assert.equal(upper.find(f=>f.name==='files').remote, '/sdcard/Android/data/files');
    await commands.get('androidTools.goBack')();assert.equal((await trees.get('androidFiles').getChildren()).find(f=>f.name==='files').remote, '/sdcard/Android/data/com.example.debug/files');
    await commands.get('androidTools.goForward')();
    for (let i=0;i<5;i++) await commands.get('androidTools.goParent')();
    const atRoot = await trees.get('androidFiles').getChildren();
    assert.ok(!atRoot.some(f=>f.parent));
    assert.equal(atRoot.find(f=>f.name==='files').remote, '/files');
    const linkFolder = children.find(f=>f.name==='sdcard'), linkFile=children.find(f=>f.name==='alias');
    assert.equal(trees.get('androidFiles').getTreeItem(linkFolder).iconPath.id, 'file-symlink-directory');
    assert.equal(trees.get('androidFiles').getTreeItem(linkFile).iconPath.id, 'file-symlink-file');
    assert.match(trees.get('androidFiles').getTreeItem(linkFile).tooltip, /real.txt/);
    const nested=await trees.get('androidFiles').getChildren(linkFolder);
    assert.equal(nested[0].remote, '/storage/emulated/0/files');
    const alias={...linkFolder,name:'second-link',remote:'/other-link',treePath:'/other-link'};
    const aliasChildren=await trees.get('androidFiles').getChildren(alias);
    assert.notEqual(trees.get('androidFiles').getTreeItem(nested[0]).id,trees.get('androidFiles').getTreeItem(aliasChildren[0]).id);
    assert.equal(nested[0].remote,aliasChildren[0].remote);
    await commands.get('androidTools.open')(linkFile);
    await commands.get('androidTools.open')(linkFile);
    assert.equal(calls.filter(call=>call.args?.[0]==='pull').length, 1);
    assert.equal(calls.find(call=>call.args?.[0]==='pull').args[1], '/real.txt');
    assert.equal(opened[0].uri.fsPath, opened[1].uri.fsPath);
    assert.equal(await fs.readFile(opened[0].uri.fsPath,'utf8'), 'target content');
    assert.equal(trees.get('androidFiles').getTreeItem(linkFile).contextValue,'androidLinkFile');
    assert.equal(trees.get('androidFiles').getTreeItem(linkFile).id,`serial:${linkFile.remote}`);
    mock.window.activeTextEditor={document:{uri:opened[0].uri,save:async()=>true}};
    onEdit({document:mock.window.activeTextEditor.document});assert.match(bars[1].text,/待同步/);
    await commands.get('androidTools.save')();
    assert.equal(calls.find(call=>call.args?.[0]==='push').args[2], '/real.txt');assert.match(bars[1].text,/已同步/);
    const originalInput=mock.window.showInputBox;mock.window.showInputBox=async()=> 'renamed.txt';
    await commands.get('androidTools.rename')({remote:'/real.txt',serial:'serial',directory:false});
    await commands.get('androidTools.save')();assert.equal(calls.filter(call=>call.args?.[0]==='push').at(-1).args[2],'/renamed.txt');
    mock.window.showInputBox=originalInput;
    const transferExec=Adb.prototype.exec;mock.window.activeTextEditor.document.version=1;
    Adb.prototype.exec=async function(serial,args,...rest){const result=await transferExec.call(this,serial,args,...rest);if(args[0]==='push')mock.window.activeTextEditor.document.version++;return result;};
    await commands.get('androidTools.save')();assert.match(bars[1].text,/待同步/);Adb.prototype.exec=transferExec;


    inaccessible = true; await commands.get('androidTools.refresh')();
    await commands.get('androidTools.openAppDirectory')();
    assert.match(errors.pop(), /目录不存在或无权访问/);
    const failed=await trees.get('androidFiles').getChildren(linkFolder);assert.equal(trees.get('androidFiles').getTreeItem(failed[0]).contextValue,'androidError');assert.match(errors.pop(),/Permission denied/);
    assert.ok(!calls.some(call => typeof call === 'object' && /\b(mkdir|touch|rm)\b/.test(call.args.join(' '))));
  } finally {for(const item of subscriptions)item.dispose();Module._load=original;Adb.prototype.exec=exec;global.setInterval=originalInterval;await fs.rm(project,{recursive:true,force:true});}
});
