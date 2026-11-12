'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const Module=require('node:module');const vm=require('node:vm');const fs=require('node:fs');
test('project app panel exposes all operations, updates targets and rejects unknown commands',async()=>{
 const original=Module._load,subscriptions=[],messages=[],executed=[];let provider,receive,state={project:'/project',device:'serial',packageName:'com.demo'},finish;
 const mock={Uri:{joinPath:(_, ...parts)=>parts.join('/')},window:{registerWebviewViewProvider:(id,p)=>{assert.equal(id,'androidApp');provider=p;return{dispose(){}};},showErrorMessage:()=>{}}};
 Module._load=function(id,...args){return id==='vscode'?mock:original.call(this,id,...args)};
 try{
  const {registerAppView,actions}=require('../src/app-view');
  assert.deepEqual(Object.keys(actions).slice(3),['build','clearDataAndRun','launch','stop','clearData','uninstall','revoke','appSettings']);
  assert.equal(actions.build,'运行');
  const update=registerAppView({subscriptions,extensionUri:'test'},()=>state,async id=>{executed.push(id);await new Promise(resolve=>{finish=resolve;});});
  const view={webview:{cspSource:'test',asWebviewUri:x=>x,postMessage:m=>messages.push(m),onDidReceiveMessage:fn=>{receive=fn;return{dispose(){}};}},onDidDispose:()=>({dispose(){}})};
  provider.resolveWebviewView(view);
  const controls=Object.keys(actions).map(command=>({dataset:{command},addEventListener:(_,fn)=>{controls.find(button=>button.dataset.command===command).click=fn;}})), fields=new Map(), posted=[];let render;
  vm.runInNewContext(fs.readFileSync(require.resolve('../media/app.js'),'utf8'),{acquireVsCodeApi:()=>({postMessage:m=>posted.push(m)}),document:{querySelectorAll:()=>controls,getElementById:id=>{if(!fields.has(id))fields.set(id,{});return fields.get(id);}},window:{addEventListener:(_,fn)=>{render=fn;}}});
  render({data:{type:'state',...state,busy:false}});assert.equal(fields.get('package').textContent,'com.demo');
  controls.find(button=>button.dataset.command==='clearData').click();assert.equal(posted.at(-1).command,'clearData');
  render({data:{type:'state',...state,busy:true}});assert.ok(controls.every(button=>button.disabled));
  for(const id of Object.keys(actions))assert.ok(view.webview.html.includes(`data-command="${id}"`),id);
  await receive({type:'ready'});assert.equal(messages.at(-1).packageName,'com.demo');
  await receive({type:'command',command:'__proto__'});assert.equal(executed.length,0);
  const pending=receive({type:'command',command:'clearData'});assert.equal(messages.at(-1).busy,true);
  await receive({type:'command',command:'uninstall'});assert.equal(executed.length,1);
  finish();await pending;assert.equal(messages.at(-1).busy,false);
  state={...state,device:'other'};update();assert.equal(messages.at(-1).device,'other');
 }finally{Module._load=original;for(const item of subscriptions)item.dispose();}
});
