'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
test('log search highlights literal case-insensitive matches, wraps navigation and survives live updates',()=>{
  class Element{
    constructor(tag='div'){this.tag=tag;this.children=[];this.value='';this.checked=false;this.listeners={};this.scrollTop=0;this.scrollHeight=100;const classes=new Set();this.classList={add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x)};}
    addEventListener(type,fn){this.listeners[type]=fn;}
    append(node){if(node.tag==='fragment')this.children.push(...node.children);else this.children.push(node);}
    replaceChildren(...nodes){this.children=[];for(const node of nodes)this.append(node);this._text='';}
    set textContent(text){this.children=[];this._text=text;}
    get textContent(){return this._text || this.children.map(n=>n.textContent).join('');}
    scrollIntoView(){this.scrolled=true;}
    focus(){this.focused=true;}
    select(){this.selected=true;}
  }
  const elements=new Map(),listeners={},sent=[];
  const byId=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  const context={acquireVsCodeApi:()=>({postMessage:m=>sent.push(m)}),document:{getElementById:byId,createElement:tag=>new Element(tag),createDocumentFragment:()=>new Element('fragment'),createTextNode:text=>({textContent:text})},window:{addEventListener:(type,fn)=>{listeners[type]=fn;}}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../media/logcat.js'),'utf8'),context);
  byId('searchbar').hidden=true;
  byId('findToggle').listeners.click();assert.equal(byId('searchbar').hidden,false);
  const rows=[{line:'A.b <script> a.b',level:'E'},{line:'other line',level:'I'}];
  listeners.message({data:{type:'lines',lines:rows}});
  byId('scroll').checked=true;byId('findText').value='a.b';byId('findText').listeners.input();
  assert.equal(byId('findCount').textContent,'1/2');assert.equal(byId('logs').children.length,2);assert.match(byId('logs').textContent,/<script>/);assert.equal(byId('scroll').checked,false);
  const marks=byId('logs').children[0].children.filter(n=>n.tag==='mark');assert.equal(marks[0].textContent,'A.b');assert.ok(marks[0].classList.contains('current-match'));
  byId('findNext').listeners.click();assert.equal(byId('findCount').textContent,'2/2');assert.ok(marks[1].scrolled);
  byId('findNext').listeners.click();assert.equal(byId('findCount').textContent,'1/2');
  byId('findPrev').listeners.click();assert.equal(byId('findCount').textContent,'2/2');
  listeners.message({data:{type:'lines',lines:[...rows,{line:'new a.b',level:'D'}]}});assert.equal(byId('findCount').textContent,'2/3');
  const key={key:'Enter',shiftKey:true,preventDefault(){}};byId('findText').listeners.keydown(key);assert.equal(byId('findCount').textContent,'1/3');
  byId('findText').value='absent';byId('findText').listeners.input();assert.equal(byId('findCount').textContent,'0/0');assert.equal(byId('findNext').disabled,true);
  byId('findText').listeners.keydown({key:'Escape',preventDefault(){}});assert.equal(byId('findText').value,'');assert.equal(byId('logs').children.length,3);assert.ok(byId('logs').focused);assert.equal(byId('searchbar').hidden,true);
  listeners.keydown({key:'f',metaKey:true,preventDefault(){}});assert.ok(byId('findText').focused && byId('findText').selected);assert.equal(byId('searchbar').hidden,false);
  byId('findClose').listeners.click();assert.equal(byId('searchbar').hidden,true);
  assert.equal(sent.filter(m=>m.type==='filter').length,0);
});
