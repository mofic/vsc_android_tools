'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
test('offline import renders, filters, exports without ADB; cancel and size errors preserve panels', async () => {
  const original=Module._load, subscriptions=[], messages=[], panels=[], errors=[];
  let onMessage, cancelled=false, size=100, clipboard='', exported;
  const uri={fsPath:'/tmp/sample.log'}, content='11-12 12:13:14.123  123  456 E App: failure\n11-12 12:13:14.124  123  456 D Other: debug\n';
  const mock={
    Uri:{joinPath:(_, ...parts)=>parts.join('/'),file:fsPath=>({fsPath})},ViewColumn:{Active:-1,Beside:-2},
    window:{showOpenDialog:async()=>cancelled?undefined:[uri],showSaveDialog:async()=>uri,createWebviewPanel:()=>{
      const panel={webview:{asWebviewUri:x=>x,cspSource:'test',postMessage:m=>messages.push(m),onDidReceiveMessage:fn=>{onMessage=fn;}},onDidDispose(){},dispose(){}};
      panels.push(panel);return panel;
    }},
    workspace:{fs:{stat:async()=>({size}),readFile:async()=>Buffer.from(content),writeFile:async(_,data)=>{exported=data.toString();}}},
    env:{clipboard:{writeText:async text=>{clipboard=text;}}}
  };
  Module._load=function(id,...args){return id==='vscode'?mock:original.call(this,id,...args)};
  const adb={binary(){throw Error('offline must not start ADB')},shell(){throw Error('offline must not query device')}};
  try {
    const {importLogcat}=require('../src/logcat');
    const panel=await importLogcat({subscriptions,extensionUri:'test'},adb,e=>errors.push(e));
    assert.match(panel.webview.html,/id="import"/); assert.match(panel.webview.html,/id="package" disabled/);
    await onMessage({type:'ready'});
    assert.equal(messages.find(m=>m.type==='lines').lines.length,2);
    assert.equal(messages.find(m=>m.type==='lines').lines[0].level,'E');
    await onMessage({type:'filter',filter:{level:'E',text:'fail',regex:false,tag:'App',package:''}});
    await onMessage({type:'copy'}); await onMessage({type:'export'});
    assert.match(clipboard,/failure/); assert.ok(!clipboard.includes('debug')); assert.equal(exported,clipboard);
    cancelled=true; await onMessage({type:'import'}); assert.equal(panels.length,1);
    cancelled=false;size=33*1024*1024;
    await assert.rejects(importLogcat({subscriptions},adb,e=>errors.push(e)),/超过 32MB/);
    assert.equal(panels.length,1); assert.equal(errors.length,0);
    await onMessage({type:'restart'}); await onMessage({type:'deviceClear'});
  } finally { for(const item of subscriptions)item.dispose();Module._load=original; }
});
