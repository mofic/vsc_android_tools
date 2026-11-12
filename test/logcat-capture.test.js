'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
test('Logcat capture buttons bind their own device, handle cancel and stop on tab close',async()=>{
  const original=Module._load,subscriptions=[],calls=[],errors=[],sessions=[];
  let cancelled=false;
  const mock={Uri:{joinPath:(_, ...parts)=>parts.join('/'),file:fsPath=>({fsPath,scheme:'file'})},ViewColumn:{Active:-1},workspace:{isTrusted:true},commands:{executeCommand:async(...args)=>calls.push(args)},window:{
    showSaveDialog:async options=>{calls.push(['dialog',options.title]);return cancelled?undefined:{scheme:'file',fsPath:'/tmp/capture-test-output'};},
    showInformationMessage:text=>{calls.push(['info',text]);return new Promise(()=>{});},
    createWebviewPanel:()=>{let handler,dispose;const panel={webview:{cspSource:'test',asWebviewUri:x=>x,postMessage:m=>calls.push(m),onDidReceiveMessage:fn=>{handler=fn;}},onDidDispose:fn=>{dispose=fn;},dispose:()=>dispose?.(),send:m=>handler(m)};return panel;}
  }};
  const capture={screenshot:async(_,serial,dest)=>calls.push(['screenshot',serial,dest]),startRecording:(_,serial)=>{
    let finish,reject;const done=new Promise((resolve,fail)=>{finish=resolve;reject=fail;});
    const session={fail:reject,ready:Promise.resolve('1234'),done,stop:async()=>{calls.push(['stop',serial]);finish();}};sessions.push(session);return session;
  }};
  Module._load=function(id,...args){if(id==='vscode')return mock;if(id==='./capture')return capture;return original.call(this,id,...args)};
  try{
    const {openLogcat}=require('../src/logcat');const ctx={subscriptions,extensionUri:'test',globalState:{get:(_,fallback)=>fallback}};
    const panel=openLogcat(ctx,{},'bound-device',e=>{errors.push(e);return new Promise(()=>{});});
    cancelled=true;await panel.send({type:'screenshot'});assert.ok(!calls.some(c=>c[0]==='screenshot'));
    cancelled=false;await panel.send({type:'screenshot'});assert.deepEqual(calls.find(c=>c[0]==='screenshot'),['screenshot','bound-device','/tmp/capture-test-output']);
    await panel.send({type:'record'});assert.equal(sessions.length,1);assert.equal(calls.findLast(c=>c.type==='captureState').recording,true);
    await panel.send({type:'record'});await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.findLast(c=>c.type==='captureState').recording,false);
    await panel.send({type:'record'});sessions[1].fail(Error('save failed'));await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.findLast(c=>c.type==='captureState').recording,false);assert.equal(calls.findLast(c=>c.type==='captureState').recordingBusy,false);assert.match(errors.pop().message,/save failed/);
    await panel.send({type:'record'});panel.dispose();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.filter(c=>c[0]==='stop').length,2);
    const offline=openLogcat(ctx,{},undefined,e=>errors.push(e),{name:'offline',entries:[],total:0});
    const before=calls.filter(c=>c[0]==='dialog').length;await offline.send({type:'screenshot'});await offline.send({type:'record'});assert.equal(calls.filter(c=>c[0]==='dialog').length,before);
    const untrusted=openLogcat(ctx,{},'device-b',e=>errors.push(e));mock.workspace.isTrusted=false;await untrusted.send({type:'record'});assert.match(errors.pop().message,/信任工作区/);assert.equal(errors.length,0);
  }finally{for(const item of subscriptions)item.dispose();Module._load=original;}
});
