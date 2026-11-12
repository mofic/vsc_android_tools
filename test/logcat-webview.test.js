'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
test('history dropdown restores configuration and keeps editor fields synchronized', () => {
  const elements=new Map(), sent=[];let receive;
  const make=()=>({value:'',checked:false,hidden:true,style:{},dataset:{},children:[],listeners:{},addEventListener(type,fn){this.listeners[type]=fn;},replaceChildren(...nodes){this.children=nodes;},append(...nodes){this.children.push(...nodes);},focus(){}});
  const element=id=>{if(!elements.has(id))elements.set(id,make());return elements.get(id);};
  vm.runInNewContext(fs.readFileSync(require.resolve('../media/logcat.js'),'utf8'),{
    acquireVsCodeApi:()=>({postMessage:m=>sent.push(m)}),document:{getElementById:element,createElement:make},window:{addEventListener:(_,fn)=>{receive=fn;}},Option:class{constructor(text,value){this.text=text;this.value=value;}}
  });
  const filter={level:'V',text:'',regex:false,tag:'',package:'',query:'package:mine tag:App message:"<script>error"'};
  receive({data:{type:'history',filters:[filter]}});
  const popup=element('querySuggestions');
  const row=popup.children.find(row=>row.children?.[0]?.textContent?.includes('<script>error'));
  assert.ok(row);assert.equal(row.children[1].textContent,'☆');
  row.children[1].listeners.click();assert.equal(sent.at(-1).type,'toggleFavorite');assert.equal(sent.at(-1).filter.package,filter.package);
  receive({data:{type:'history',filters:[filter],favorites:[{name:'Errors',filter}]}});
  const starred=popup.children.find(row=>row.children?.[0]?.textContent==='Errors');
  assert.equal(starred.children[1].textContent,'★');
  starred.children[1].listeners.click();assert.equal(sent.at(-1).type,'toggleFavorite');
  starred.children[0].listeners.click();
  assert.equal(sent.at(-1).type,'useFilter');assert.equal(sent.at(-1).filter.package,filter.package);assert.equal(popup.hidden,true);
  receive({data:{type:'filterApplied',filter}});
  assert.equal(element('query').value,filter.query);
  assert.equal(element('packageStatus').textContent,filter.query);
  element('compact').checked=true;element('compact').listeners.change();assert.equal(element('logs').dataset.compact,'true');
  element('wrap').checked=false;element('wrap').listeners.change();assert.equal(element('logs').style.whiteSpace,'pre');
  element('wrap').checked=true;element('wrap').listeners.change();assert.equal(element('logs').style.whiteSpace,'pre-wrap');
  receive({data:{type:'paused',value:true,pending:6}});assert.match(element('pauseStatus').textContent,/新增 6/);
  const hint=popup.children.find(row=>row.className==='query-hint'&&row.textContent.startsWith('level:ERROR'));
  element('query').value='package:mine';const beforeHint=sent.length;hint.listeners.click();
  assert.equal(element('query').value,'package:mine level:ERROR');assert.equal(sent.length,beforeHint);
  element('query').value='package:mine level:';hint.listeners.click();assert.equal(element('query').value,'package:mine level:ERROR');
  element('query').value=filter.query;
  element('apply').listeners.click();assert.equal(sent.at(-1).type,'filter');assert.equal(sent.at(-1).filter.query,filter.query);
  assert.equal(popup.children[0].children[0].textContent,'Errors');
});
