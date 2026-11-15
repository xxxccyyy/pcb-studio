import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { netLowerBound } from '../src/engine.mjs';

const source=readFileSync(new URL('../src/ui.js',import.meta.url),'utf8');
const helperStart=source.indexOf('  function createNetGeometryCache(');
const helperEnd=source.indexOf('  const netGeometryCache=',helperStart);
const renderStart=source.indexOf('  function renderNets(){',helperEnd);
const renderEnd=source.indexOf("  $('btnAddNet').addEventListener",renderStart);
assert.ok(helperStart>=0&&helperEnd>helperStart&&renderStart>helperEnd&&renderEnd>renderStart);
const helper=source.slice(helperStart,helperEnd);
const createCache=vm.runInNewContext(helper+'\ncreateNetGeometryCache;');
function fixture(){
  return {nets:[{id:'a',name:'A'},{id:'b',name:'B'}],manual:[],pads:[
    {id:'a1',netId:'a',x:1,y:1},{id:'a2',netId:'a',x:4,y:5},
    {id:'b1',netId:'b',x:10,y:10},{id:'b2',netId:'b',x:13,y:14}
  ]};
}
function measuredCache(){
  const calls=[];
  const update=createCache(pads=>{calls.push(pads.map(p=>p.id));return netLowerBound(pads);});
  return {calls,update};
}

test('net geometry cache invalidates moved, added, removed and reassigned pads',()=>{
  const d=fixture(),{calls,update}=measuredCache();
  function verify(){
    const groups=update(d);
    for(const n of d.nets){
      const expected=d.pads.filter(p=>p.netId===n.id),actual=groups.get(n.id);
      assert.deepEqual(Array.from(actual.pads),expected);
      assert.equal(actual.lowerBound,netLowerBound(expected));
    }
  }
  verify();assert.equal(calls.length,2);
  verify();assert.equal(calls.length,2);
  d.pads[0].x+=2;verify();assert.equal(calls.length,3,'moving recomputes only its net');
  d.pads.push({id:'a3',netId:'a',x:8,y:9});verify();assert.equal(calls.length,4);
  d.pads.pop();verify();assert.equal(calls.length,5);
  d.pads[0].netId='b';verify();assert.equal(calls.length,7,'reassignment invalidates both nets');
  d.pads[0].netId=null;verify();assert.equal(calls.length,8,'independent pads leave the old net');
  d.pads[0].netId='a';verify();assert.equal(calls.length,9,'joining a net recomputes its bound');
});

test('cache discards removed nets and resets on imported or undo/redo design objects',()=>{
  const d=fixture(),{calls,update}=measuredCache();
  update(d);assert.equal(calls.length,2);
  const removed=d.nets.pop();
  assert.equal(update(d).has('b'),false);assert.equal(calls.length,2);
  d.nets.push(removed);update(d);
  assert.equal(calls.length,3,'re-added net must not find a retained deleted entry');
  const undo=structuredClone(d);undo.pads[0].x+=5;
  const undone=update(undo);assert.equal(calls.length,5);
  assert.equal(undone.get('a').lowerBound,netLowerBound(undo.pads.filter(p=>p.netId==='a')));
  update(d);assert.equal(calls.length,7,'redo/design replacement resets the old cache');
  update(structuredClone(d));assert.equal(calls.length,9,'import replacement resets even equal geometry');
  const empty={nets:[],pads:d.pads};assert.equal(update(empty).size,0);
});

// Minimal DOM for the real renderNets implementation. Exercise its event
// callbacks too, so a cache helper that is not wired into the UI cannot pass.
class Element{
  constructor(){this.handlers=new Map();this.children=[];this.options=[];this.value='';this.queries=new Map();}
  set innerHTML(value){this.html=value;this.children=[];}
  get innerHTML(){return this.html;}
  addEventListener(type,handler){this.handlers.set(type,handler);}
  appendChild(child){this.children.push(child);}
  querySelector(selector){
    if(!this.queries.has(selector))this.queries.set(selector,new Element());
    return this.queries.get(selector);
  }
}
test('real renderNets and selecting networks reuse bounds and group pads in one traversal',()=>{
  const d=fixture(),app={design:d,selNet:'a',routing:false,result:null};
  let calls=0,traversals=0;
  const pads=d.pads;
  d.pads=new Proxy(pads,{get(target,key,receiver){
    if(key===Symbol.iterator)traversals++;
    return Reflect.get(target,key,receiver);
  }});
  const elements=new Map([['netList',new Element()],['pourNet',new Element()]]);
  const context={app,$:id=>elements.get(id),document:{createElement:()=>new Element()},
    netLowerBound:points=>{calls++;return netLowerBound(points);},
    escapeHtml:String,netColor:()=> '#fff',requestDraw(){},runDRC(){},toast(){}};
  vm.createContext(context);
  vm.runInContext(helper+'\nconst netGeometryCache=createNetGeometryCache(netLowerBound);\n'+
    source.slice(renderStart,renderEnd)+'\nglobalThis.renderNets=renderNets;',context);
  context.renderNets();assert.equal(calls,2);assert.equal(traversals,1);
  context.renderNets();assert.equal(calls,2);assert.equal(traversals,2);
  const list=elements.get('netList');
  list.children[1].handlers.get('click')({target:{closest:()=>null}});
  assert.equal(app.selNet,'b');assert.equal(calls,2);assert.equal(traversals,3);
  list.children[0].handlers.get('keydown')({target:list.children[0],key:'Enter',preventDefault(){}});
  assert.equal(app.selNet,'a');assert.equal(calls,2);assert.equal(traversals,4);
  list.children[0].querySelector('[data-a=hs]').handlers.get('click')();
  assert.equal(d.nets[0].hs,true);assert.equal(calls,2);
  d.nets[0].name='Renamed';d.pads[0].w=2;context.renderNets();
  assert.equal(calls,2,'metadata and pad width do not change the coordinate-only bound');
});
