'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { Adb } = require('../src/core');
test('activates every contributed command and tree, then disposes timers', async () => {
  const commands=new Map(), trees=new Map(), subscriptions=[];
  const disposable=()=>({dispose(){}});
  const state=new Map();
  const mock={
    workspace:{isTrusted:true,getConfiguration:()=>({get:(_,fallback)=>fallback}),onDidChangeWorkspaceFolders:disposable},
    window:{createOutputChannel:()=>({...disposable(),append(){},appendLine(){}}),createStatusBarItem:()=>({...disposable(),show(){}}),showErrorMessage:message=>{throw Error(message)},registerTreeDataProvider:(id,p)=>{trees.set(id,p);return disposable()}},
    commands:{registerCommand:(id,fn)=>{commands.set(id,fn);return disposable()}},
    StatusBarAlignment:{Left:1},EventEmitter:class{event=()=>{};fire(){}dispose(){}},
    TreeItem:class{constructor(label){this.label=label}},ThemeIcon:class{},TreeItemCollapsibleState:{Collapsed:1,None:0}
  };
  const original=Module._load, exec=Adb.prototype.exec;
  Module._load=function(id,...args){return id==='vscode'?mock:original.call(this,id,...args)};
  Adb.prototype.exec=async()=> 'List of devices attached\nserial device model:Pixel\n';
  try {
    const extension=require('../src/extension');
    extension.activate({subscriptions,workspaceState:{get:key=>state.get(key),update:(k,v)=>state.set(k,v)}});
    await new Promise(resolve=>setImmediate(resolve));
    const manifest=require('../package.json');
    assert.deepEqual([...commands.keys()].sort(),manifest.contributes.commands.map(x=>x.command).sort());
    const devices=await trees.get('androidDevices').getChildren(); assert.equal(devices[0].serial,'serial');
    await commands.get('androidTools.selectDevice')(devices[0]);
    assert.equal(trees.get('androidDevices').getTreeItem(devices[0]).description,'serial · 当前');
  } finally {for(const item of subscriptions)item.dispose();Module._load=original;Adb.prototype.exec=exec;}
});
