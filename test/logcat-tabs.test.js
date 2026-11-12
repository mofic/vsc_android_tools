'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
test('Logcat tabs split and keep independent filters, buffers, pause and process lifetime', async () => {
  const original=Module._load, subscriptions=[], panels=[], processes=[];
  let clipboard='';
  const mock={Uri:{joinPath:(_, ...parts)=>parts.join('/')},ViewColumn:{Active:-1,Beside:-2},env:{clipboard:{writeText:async text=>{clipboard=text;}}},window:{createWebviewPanel:(_,title,column)=>{
    let receive, dispose;
    const panel={title,column,messages:[],webview:{cspSource:'test',asWebviewUri:x=>x,postMessage:m=>panel.messages.push(m),onDidReceiveMessage:fn=>{receive=fn;}},onDidDispose:fn=>{dispose=fn;},dispose:()=>dispose?.(),send:m=>receive(m)};
    panels.push(panel);return panel;
  }}};
  const fakeSpawn=()=>{const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.killed=false;child.kill=()=>{child.killed=true;child.emit('close');};processes.push(child);return child;};
  Module._load=function(id,...args){if(id==='vscode')return mock;if(id==='node:child_process')return {spawn:fakeSpawn};return original.call(this,id,...args)};
  try {
    const {openLogcat}=require('../src/logcat');
    const ctx={subscriptions,extensionUri:'test'}, adb={binary:()=> 'adb'}, fail=e=>{throw e;};
    const first=openLogcat(ctx,adb,'serial',fail);
    assert.match(first.webview.html,/id="newTab"/);
    await first.send({type:'ready'});await first.send({type:'newTab'});
    const second=panels[1];assert.notEqual(first.title,second.title);assert.equal(second.column,mock.ViewColumn.Active);
    await second.send({type:'ready'});
    const data=Buffer.from('11-12 12:13:14.123  123  456 E App: failure\n11-12 12:13:14.124  123  456 D Other: debug\n');
    processes[0].stdout.emit('data',data);processes[1].stdout.emit('data',data);
    await first.send({type:'filter',filter:{level:'E',text:'',tag:'',package:''}});
    await first.send({type:'copy'});assert.match(clipboard,/failure/);assert.ok(!clipboard.includes('debug'));
    await second.send({type:'copy'});assert.match(clipboard,/debug/);
    await first.send({type:'pause'});assert.equal(first.messages.at(-1).type,'paused');assert.ok(!second.messages.some(m=>m.type==='paused'));
    await first.send({type:'clear'});await second.send({type:'copy'});assert.match(clipboard,/debug/);
    first.dispose();assert.ok(processes[0].killed);assert.equal(processes[1].killed,false);
    await second.send({type:'split'});assert.equal(panels[2].column,mock.ViewColumn.Beside);
    await panels[2].send({type:'ready'});assert.equal(processes.length,3);
  } finally {for(const item of subscriptions)item.dispose();Module._load=original;}
});
