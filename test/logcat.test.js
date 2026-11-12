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
    window:{showInputBox:async()=> 'Errors',showOpenDialog:async()=>cancelled?undefined:[uri],showSaveDialog:async()=>uri,createWebviewPanel:()=>{
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
    const state=new Map(), globalState={get:(key,fallback)=>state.get(key) || fallback,update:async(key,value)=>state.set(key,value)};
    const panel=await importLogcat({subscriptions,extensionUri:'test',globalState},adb,e=>errors.push(e));
    assert.match(panel.webview.html,/id="searchbar" hidden/);assert.match(panel.webview.html,/<details id="more"/);
    assert.match(panel.webview.html,/id="import"/); assert.match(panel.webview.html,/id="package" disabled/);
    await onMessage({type:'ready'});
    assert.equal(messages.find(m=>m.type==='lines').lines.length,2);
    assert.equal(messages.find(m=>m.type==='lines').lines[0].level,'E');
    await onMessage({type:'filter',filter:{level:'E',text:'fail',regex:false,tag:'App',package:''}});
    await onMessage({type:'copy'}); await onMessage({type:'export'});
    assert.match(clipboard,/failure/); assert.ok(!clipboard.includes('debug')); assert.equal(exported,clipboard);
    await onMessage({type:'useFilter',filter:{level:'E',text:'fail',regex:false,tag:'App',package:'com.example.app'}});
    assert.equal(messages.findLast(m=>m.type==='filterApplied').filter.package,'');
    assert.equal(state.get('logcat.recentFilters')[0].package,'com.example.app');
    const before=JSON.stringify(state.get('logcat.recentFilters'));
    await onMessage({type:'filter',filter:{level:'E',text:'[',regex:true,tag:'',package:''}});
    assert.ok(errors.pop() instanceof SyntaxError);
    assert.equal(JSON.stringify(state.get('logcat.recentFilters')),before);
    const favorite={level:'E',text:'',tag:'',package:'',query:'message:failure level:ERROR'};
    await onMessage({type:'favorite',filter:favorite});assert.equal(state.get('logcat.favorites')[0].name,'Errors');
    await onMessage({type:'useFilter',filter:state.get('logcat.favorites')[0].filter});await onMessage({type:'copy'});assert.match(clipboard,/failure/);
    await onMessage({type:'unfavorite',name:'Errors'});assert.equal(state.get('logcat.favorites').length,0);
    cancelled=true; await onMessage({type:'import'}); assert.equal(panels.length,1);
    cancelled=false;size=33*1024*1024;
    await assert.rejects(importLogcat({subscriptions},adb,e=>errors.push(e)),/超过 32MB/);
    assert.equal(panels.length,1); assert.equal(errors.length,0);
    await onMessage({type:'restart'}); await onMessage({type:'deviceClear'});
  } finally { for(const item of subscriptions)item.dispose();Module._load=original; }
});
