import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const ui=readFileSync(new URL('../src/ui.js',import.meta.url),'utf8');
const bridge=ui.slice(ui.indexOf('  (function(){\n    const B=window.__PCB_BRIDGE;'),ui.lastIndexOf('  window.__pcbViewTest='));
function harness({storageBlocked=false,statePending=false}={}){
  const timers=new Map(), calls=[], elements=[], listeners={}; let seq=0, resolveState;
  const canvas={width:800,height:600,toDataURL:()=> 'data:image/png;base64,iVBORw=='};
  class EventSource { constructor(){this.readyState=1;} addEventListener(name,fn){listeners[name]=fn;} }
  const context={console,Uint8Array,atob,Event,EventSource,
    window:{__PCB_BRIDGE:{token:'test'},dispatchEvent(){}},location:{protocol:'http:'},
    localStorage:{getItem(){if(storageBlocked)throw Error('blocked');return null;},setItem(){if(storageBlocked)throw Error('blocked');}},
    document:{createElement(){const el={style:{}};elements.push(el);return el;},body:{appendChild(){}},getElementById:()=>canvas,addEventListener(){}},
    setTimeout(fn,delay){timers.set(++seq,{fn,delay});return seq;},clearTimeout(id){timers.delete(id);},setInterval(){},
    app:{design:{width:60,height:40,nets:[],pads:[]},result:null,view:{scale:1},show:{}},
    loadDesign(d){context.app.design=d;},designChanged(){},applySnapshot(){},runRoute:async()=>{},requestDraw(){},
    toast(){},normalizeDesign:d=>d,normalizeResult:r=>r,computeDerived(){},renderNets(){},renderStats(){},draw(){},
    canvasArea:()=>({width:800,height:600,left:0,right:0,top:0,bottom:0}),
    fetch:async(url,options)=>{calls.push({url,options});if(url==='/api/state'&&statePending)return new Promise(r=>{resolveState=r;});return {ok:true,json:async()=>({ok:true})};}
  };
  vm.runInNewContext(bridge,context);
  const tick=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
  const flush=async delay=>{const tasks=[...timers].filter(([,t])=>t.delay===delay);for(const [id,t]of tasks){timers.delete(id);await t.fn();}await tick();};
  return {context,calls,elements,listeners,tick,flush,resolveState:st=>resolveState({json:async()=>st})};
}
test('bridge survives blocked browser storage and honors opt-out for queued and forced screenshots',async()=>{
  const h=harness({storageBlocked:true});await h.tick();
  assert.ok(h.context.window.__pcbBridge);
  h.context.window.__pcbBridge.push();h.elements[0].onclick();
  await h.flush(800);await h.flush(1200);
  h.context.window.__pcbBridge.applyView({fit:true});await h.tick();
  assert.equal(h.calls.filter(c=>c.options?.method==='POST').length,0);
  h.elements[0].onclick();await h.flush(800);await h.flush(1200);
  assert.ok(h.calls.some(c=>c.url==='/api/ui-state'));
  assert.ok(h.calls.some(c=>c.url==='/api/ui-screenshot'));
});
test('bootstrap waits for server state and cannot overwrite a newer SSE update',async()=>{
  const h=harness({statePending:true});await h.tick();
  h.context.window.__pcbBridge.push();await h.flush(800);
  assert.equal(h.calls.filter(c=>c.options?.method==='POST').length,0);
  const newer={width:80,height:40,nets:[],pads:[]};
  h.listeners.state({data:JSON.stringify({design:newer})});
  h.resolveState({ok:true,design:{width:20,height:40,nets:[],pads:[]}});await h.tick();
  assert.equal(h.context.app.design.width,80);
  await h.flush(800);
  assert.equal(JSON.parse(h.calls.find(c=>c.url==='/api/ui-state').options.body).design.width,80);
});
test('UI PNG exports bound both total pixels and individual canvas dimensions',()=>{
  const source=ui.slice(ui.indexOf("  $('btnPng').addEventListener"),ui.indexOf("  $('btnNew').addEventListener"));
  for(const [width,height] of [[5000,5000],[1,5000],[5000,1],[60,40]]){
    let click; const canvas={getContext:()=>({scale(){}}),toBlob:fn=>fn(null)};
    vm.runInNewContext(source,{$:id=>({addEventListener:(_,fn)=>click=fn}),app:{design:{width,height},show:{}},
      document:{createElement:()=>canvas},renderScene(){},toast(){},download(){throw Error('null blob must not download');}});
    click();assert.ok(canvas.width*canvas.height<=16000000);assert.ok(canvas.width<=8192&&canvas.height<=8192);
  }
});
test('failed asynchronous uploads are caught and unchanged state retries on the next push',async()=>{
  const h=harness();await h.tick();
  let attempts=0;
  h.context.fetch=async()=>{attempts++;throw Error('offline');};
  h.context.window.__pcbBridge.push();await h.flush(800);await h.flush(1200);
  const previous=attempts;
  h.context.window.__pcbBridge.push();await h.flush(800);await h.flush(1200);
  assert.ok(attempts>previous);
});
