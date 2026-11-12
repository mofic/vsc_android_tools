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
    const state = new Map(), globalState={get:(key,fallback)=>state.get(key) || fallback,update:async(key,value)=>state.set(key,value)};
    const ctx={subscriptions,extensionUri:'test',globalState}, adb={binary:()=> 'adb',shell:async()=> 'PID NAME\n123 com.example.app:remote\n'}, fail=e=>{throw e;};
    const first=openLogcat(ctx,adb,'serial',fail,undefined,mock.ViewColumn.Active,async()=> 'com.example.app');
    assert.match(first.webview.html,/id="newTab"/);
    await first.send({type:'ready'});
    assert.equal(first.messages.find(m=>m.type==='filterApplied').filter.query,'package:mine');
    assert.equal(state.has('logcat.recentFilters'),false);
    await first.send({type:'newTab'});
    const second=panels[1];assert.notEqual(first.title,second.title);assert.equal(second.column,mock.ViewColumn.Active);
    await second.send({type:'ready'});
    const data=Buffer.from('11-12 12:13:14.123  123  456 E App: failure\n11-12 12:13:14.124  123  456 D Other: debug\n');
    const foreign=Buffer.from('11-12 12:13:14.125  999  456 E Other: foreign app\n');
    processes[0].stdout.emit('data',Buffer.concat([data,foreign]));processes[1].stdout.emit('data',data);
    await new Promise(resolve=>setTimeout(resolve,450));
    assert.equal(first.messages.findLast(m=>m.type==='lines').lines.length,2);
    assert.equal(first.messages.findLast(m=>m.type==='lines').lines[0].processName,'com.example.app:remote');
    await first.send({type:'filter',filter:{level:'E',text:'',tag:'',package:''}});
    assert.equal(state.get('logcat.recentFilters')[0].level,'E');
    assert.ok(second.messages.some(m=>m.type==='history' && m.filters[0]?.level==='E'));
    assert.equal(second.messages.filter(m=>m.type==='filterApplied').length,1);
    assert.equal(second.messages.find(m=>m.type==='filterApplied').filter.query,'package:mine');
    await first.send({type:'copy'});assert.match(clipboard,/failure/);assert.ok(!clipboard.includes('debug'));assert.match(clipboard,/foreign app/);
    await second.send({type:'copy'});assert.match(clipboard,/debug/);
    await first.send({type:'pause'});assert.equal(first.messages.at(-1).type,'paused');assert.ok(!second.messages.some(m=>m.type==='paused'));
    processes[0].stdout.emit('data',data);assert.equal(first.messages.at(-1).pending,2);
    await first.send({type:'clear'});await second.send({type:'copy'});assert.match(clipboard,/debug/);
    first.dispose();assert.ok(processes[0].killed);assert.equal(processes[1].killed,false);
    await second.send({type:'split'});assert.equal(panels[2].column,mock.ViewColumn.Beside);
    await panels[2].send({type:'ready'});assert.equal(processes.length,3);
    assert.equal(panels[2].messages.find(m=>m.type==='history').filters[0].level,'E');
    await Promise.all([
      second.send({type:'filter',filter:{level:'D',text:'debug',tag:'',package:''}}),
      panels[2].send({type:'filter',filter:{level:'E',text:'failure',tag:'',package:''}})
    ]);
    assert.equal(state.get('logcat.recentFilters').length,3);
    await second.send({type:'useFilter',filter:state.get('logcat.recentFilters')[0]});
    await second.send({type:'copy'});assert.match(clipboard,/failure/);assert.ok(!clipboard.includes('debug'));
    assert.equal(state.get('logcat.recentFilters').length,3);
    await second.send({type:'filter',filter:{level:'V',text:'',tag:'',package:'',query:'package:mine level:ERROR'}});await second.send({type:'copy'});assert.match(clipboard,/failure/);assert.ok(!clipboard.includes('debug'));
    let resolveDefault;
    const delayed=openLogcat(ctx,adb,'serial',fail,undefined,mock.ViewColumn.Active,()=>new Promise(resolve=>{resolveDefault=resolve;}));
    const ready=delayed.send({type:'ready'});
    await delayed.send({type:'filter',filter:{level:'V',text:'',tag:'',package:''}});
    resolveDefault('com.example.app');await ready;
    assert.equal(delayed.messages.filter(m=>m.type==='filterApplied').length,1);
    assert.equal(delayed.messages.find(m=>m.type==='filterApplied').filter.package,'');
    const noProject=openLogcat(ctx,adb,'serial',fail,undefined,mock.ViewColumn.Active,async()=>undefined);
    await noProject.send({type:'ready'});
    assert.ok(!noProject.messages.some(m=>m.type==='filterApplied'));
    const originalInterval=global.setInterval;let tick,draw;
    let ps='PID NAME\n';
    let startup;
    try {
      global.setInterval=(fn,ms)=>{if(ms===1500)tick=fn;if(ms===400)draw=fn;return originalInterval(fn,ms);};
      startup=openLogcat(ctx,{binary:()=> 'adb',shell:async()=>ps},'serial',fail,undefined,mock.ViewColumn.Active,async()=> 'com.example.app');
    } finally {global.setInterval=originalInterval;}
    await startup.send({type:'ready'});
    processes.at(-1).stdout.emit('data',Buffer.from('11-12 12:13:14.123  555  456 E App: startup log\n'));
    draw();assert.equal(startup.messages.findLast(m=>m.type==='lines').lines.length,0);
    ps='PID NAME\n555 com.example.app\n';await tick();draw();
    assert.equal(startup.messages.findLast(m=>m.type==='lines').lines[0].processName,'com.example.app');
  } finally {for(const item of subscriptions)item.dispose();Module._load=original;}
});
