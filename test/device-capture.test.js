'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
test('device capture handles cancel, bound targets, stop, failures and disposal independently of Logcat',async()=>{
 const original=Module._load,subscriptions=[],calls=[],errors=[],sessions=[],bars=[];
 let cancelled=false,changed=0;
 const mock={Uri:{file:fsPath=>({fsPath,scheme:'file'})},StatusBarAlignment:{Left:1},workspace:{isTrusted:true},commands:{executeCommand:async(...args)=>calls.push(args)},window:{
  showSaveDialog:async()=>cancelled?undefined:{scheme:'file',fsPath:'/tmp/capture-test-output'},
  showInformationMessage:text=>{calls.push(['info',text]);return new Promise(()=>{});},
  createStatusBarItem:()=>{const bar={show(){},dispose(){this.disposed=true;}};bars.push(bar);return bar;}
 }};
 const capture={screenshot:async(_,serial,dest)=>calls.push(['screenshot',serial,dest]),startRecording:(_,serial)=>{
  let finish,reject;const done=new Promise((resolve,fail)=>{finish=resolve;reject=fail;});
  const session={fail:reject,finish,ready:Promise.resolve('1234'),done,stop:async()=>{calls.push(['stop',serial]);finish();}};sessions.push(session);return session;
 }};
 Module._load=function(id,...args){if(id==='vscode')return mock;if(id==='./capture')return capture;return original.call(this,id,...args);};
 try{
  const controller=require('../src/device-capture').deviceCapture({subscriptions},{},()=>changed++,e=>errors.push(e));
  cancelled=true;await controller.screenshot('a');await controller.record('a');assert.equal(sessions.length,0);assert.equal(controller.state('a'),'');
  cancelled=false;await controller.screenshot('a');assert.deepEqual(calls.find(c=>c[0]==='screenshot'),['screenshot','a','/tmp/capture-test-output']);
  await controller.record('a');assert.equal(controller.state('a'),'Recording');
  assert.equal(bars[0].command.arguments[0].serial,'a');
  await controller.record('a');assert.equal(sessions.length,1);
  await controller.record('b');assert.equal(controller.state('b'),'Recording');
  await controller.stop('a');await new Promise(r=>setImmediate(r));
  assert.equal(controller.state('a'),'');assert.equal(controller.state('b'),'Recording');assert.equal(bars[0].disposed,true);
  sessions[1].fail(Error('save failed'));await new Promise(r=>setImmediate(r));
  assert.equal(controller.state('b'),'');assert.match(errors.pop().message,/save failed/);
  await controller.record('a');sessions[2].finish();await new Promise(r=>setImmediate(r));assert.equal(controller.state('a'),'');
  await controller.record('a');subscriptions[0].dispose();await new Promise(r=>setImmediate(r));assert.equal(calls.filter(c=>c[0]==='stop').length,2);
  mock.workspace.isTrusted=false;await assert.rejects(controller.record('c'),/信任工作区/);await assert.rejects(controller.screenshot('c'),/信任工作区/);
  assert.ok(changed>0);assert.equal(errors.length,0);
 }finally{Module._load=original;}
});
