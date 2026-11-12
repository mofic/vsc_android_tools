'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
test('history dropdown restores configuration and keeps editor fields synchronized', () => {
  const elements=new Map(), sent=[];let receive;
  const element=id=>{if(!elements.has(id))elements.set(id,{value:'',checked:false,style:{},dataset:{},options:[],listeners:{},addEventListener(type,fn){this.listeners[type]=fn;},replaceChildren(...options){this.options=options;},add(option){this.options.push(option);}});return elements.get(id);};
  vm.runInNewContext(fs.readFileSync(require.resolve('../media/logcat.js'),'utf8'),{
    acquireVsCodeApi:()=>({postMessage:m=>sent.push(m)}),document:{getElementById:element},window:{addEventListener:(_,fn)=>{receive=fn;}},Option:class{constructor(text,value){this.text=text;this.value=value;}}
  });
  const filter={level:'W',text:'<script>error',regex:true,tag:'App',package:'com.example.app'};
  receive({data:{type:'history',filters:[filter]}});
  const history=element('history');assert.equal(history.options.length,2);assert.match(history.options[1].text,/<script>error/);
  history.value=history.options[1].value;history.listeners.change();
  assert.equal(sent.at(-1).type,'useFilter');assert.equal(sent.at(-1).filter.package,filter.package);
  receive({data:{type:'filterApplied',filter}});
  assert.equal(element('text').value,filter.text);assert.equal(element('level').value,'W');assert.equal(element('regex').checked,true);
  assert.match(element('packageStatus').textContent,/包名过滤：com.example.app/);
  element('compact').checked=true;element('compact').listeners.change();assert.equal(element('logs').dataset.compact,'true');
  element('wrap').checked=false;element('wrap').listeners.change();assert.equal(element('logs').style.whiteSpace,'pre');
  element('wrap').checked=true;element('wrap').listeners.change();assert.equal(element('logs').style.whiteSpace,'pre-wrap');
  receive({data:{type:'paused',value:true,pending:6}});assert.match(element('pauseStatus').textContent,/新增 6/);
  element('apply').listeners.click();assert.equal(sent.at(-1).type,'filter');assert.equal(sent.at(-1).filter.tag,'App');
});
