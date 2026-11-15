import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// Run the real UI routing functions/event handlers and the real Worker client.
// Only DOM, drawing and the worker transport are deterministic test doubles.
const ui=readFileSync(new URL('../src/ui.js',import.meta.url),'utf8');
const client=readFileSync(new URL('../src/worker-client.js',import.meta.url),'utf8');
function section(start,end){
  const a=ui.indexOf(start),b=ui.indexOf(end,a);
  assert.ok(a>=0&&b>a,'UI section must exist: '+start);
  return ui.slice(a,b);
}
const reroute=section('  async function rerouteOne(id){','  function clearNetRoutes(id){');
const routing=section('  // ---------------- 自动布线 ----------------','  // ---------------- 统计与 DRC ----------------');
const keyboard=section("  window.addEventListener('keydown',e=>{","  cv.addEventListener('contextmenu',e=>{");
const quickStop=section('  for(const [id,fn] of [\n    [\'zoomOut\'',"  if($('quickStop')) $('quickStop').disabled=true;");

function harness(){
  const elements=new Map();
  const $=id=>{
    if(!elements.has(id))elements.set(id,{id,disabled:false,hidden:false,checked:true,value:'2',style:{},
      handlers:new Map(),closest(){return null;},
      addEventListener(type,fn){this.handlers.set(type,fn);},
      click(){return this.handlers.get('click')?.();}});
    return elements.get(id);
  };
  for(const id of ['btnStop','quickStop','btnRoute','btnShape','btnAutopcb','btnNew','rVia','rTurn','rIter',
    'rDiag','rBeautify','rOptimize','btnUndo','btnRedo'])$(id);
  $('btnRedo').disabled=true;
  const workers=[],toasts=[],keys=new Map();
  const app={design:{manual:[]},result:null,session:null,routing:false,ratsCache:[],teardrops:[],view:{scale:10}};
  const context={app,$,DOMException,structuredClone,console,
    document:{querySelectorAll(){return [...elements.values()];}},
    window:{addEventListener(type,fn){keys.set(type,fn);}},
    factory(){
      const worker={sent:[],stopped:false,terminate(){this.stopped=true;},
        postMessage(m){this.sent.push(structuredClone(m));},
        emit(type,fields={}){this.onmessage({data:{id:this.sent.at(-1).id,type,...fields}});}};
      workers.push(worker);return worker;
    },
    toast:message=>toasts.push(message),num:(value,fallback)=>Number.isFinite(Number(value))?Number(value):fallback,
    syncCanvasUI(){},updateHistBtns(){},select(){},syncParamInputs(){},sbMsg(){},computeDerived(){},
    renderNets(){},renderStats(){},runDRC(){},requestDraw(){},pushHistory(){},confirm:()=>true,
    hasOpenPopup:()=>false,fitView(){},zoomAt(){},toggleFocus(){}};
  vm.createContext(context);
  vm.runInContext(client+'\nconst routingClient=new RoutingWorkerClient(factory);\n'+
    reroute+routing+keyboard+quickStop+'\nglobalThis.api={runRoute,rerouteOne,routingClient};',context);
  return {app,$,workers,toasts,api:context.api,
    key(key){keys.get('keydown')({key,target:{closest:()=>false},preventDefault(){}});},
    async seed(){
      const pending=context.api.runRoute();
      workers.at(-1).emit('result',{design:app.design,result:{status:'partial',stats:{connected:1,total:2},overuse:[],nets:[]}});
      await pending;assert.equal(app.session,true);
    }};
}
function start(h,command){
  return command==='shapePatch'?h.$('btnShape').click():command==='reroute'?h.api.rerouteOne('a'):h.api.runRoute();
}
function idle(h){
  assert.equal(h.app.routing,false);
  assert.equal(h.$('btnStop').disabled,true);
  assert.equal(h.$('quickStop').hidden,true);
  assert.equal(h.$('btnNew').disabled,false);
  assert.equal(h.$('btnRedo').disabled,true,'originally disabled controls stay disabled');
}

test('shapePatch Stop invalidates the session immediately and preserves the old result',async()=>{
  const h=harness();await h.seed();
  const previous=h.app.result,design=h.app.design,w=h.workers.at(-1);
  const pending=start(h,'shapePatch');
  w.emit('progress',{text:'working',frac:0.25});
  assert.equal(h.$('progressWrap').style.display,'block');
  h.$('btnStop').click();
  assert.equal(h.app.session,null,'terminated worker cannot leave a live-session flag before catch runs');
  await pending;
  assert.equal(w.stopped,true);assert.equal(h.api.routingClient.worker,null);
  assert.equal(h.app.result,previous);assert.equal(h.app.design,design);
  assert.equal(h.$('progressWrap').style.display,'none');idle(h);
  assert.equal(h.toasts.at(-1),'已停止形状补线，保留原布线结果');
  w.emit('result',{result:{status:'late'}});
  assert.equal(h.app.result,previous,'terminated-worker late results must be ignored');
  await h.api.rerouteOne('a');
  assert.equal(h.workers.length,1,'single-net rerouting must be rejected locally, not create a sessionless worker');
});

test('shapePatch cancellation stays invalid after the async catch settles',async()=>{
  const h=harness();await h.seed();const previous=h.app.result;
  const pending=start(h,'shapePatch');h.$('btnStop').click();await pending;
  assert.equal(h.api.routingClient.worker,null);
  assert.equal(h.app.session,null,'catch must not leave a ghost session on a destroyed worker');
  assert.equal(h.app.result,previous);idle(h);
});

test('reroute Escape and shapePatch quickStop share immediate cancellation state',async()=>{
  for(const [command,cancel] of [['reroute',h=>h.key('Escape')],['shapePatch',h=>h.$('quickStop').click()]]){
    const h=harness();await h.seed();const previous=h.app.result;
    const pending=start(h,command);cancel(h);
    assert.equal(h.app.session,null,command+' immediate session state');
    await pending;assert.equal(h.app.result,previous);assert.equal(h.api.routingClient.worker,null);idle(h);
  }
});

test('all routing command failures discard a possibly mutated worker and leave consistent controls',async()=>{
  for(const command of ['route','reroute','shapePatch'])for(const failure of ['error-message','runtime','messageerror']){
    const h=harness();await h.seed();const previous=h.app.result;
    const pending=start(h,command),w=h.workers.at(-1);
    if(failure==='error-message')w.emit('error',{error:'search failed'});
    else if(failure==='runtime')w.onerror({message:'worker crashed'});
    else w.onmessageerror();
    await pending;
    assert.equal(h.app.session,null,command+' / '+failure);
    assert.equal(h.api.routingClient.worker,null,command+' / '+failure+' must discard worker');
    assert.equal(w.stopped,true);idle(h);
    assert.equal(h.app.result,command==='route'?null:previous,'only full route replaces/clears the prior result');
  }
});

test('reroute stale reply invalidates the old model without changing its displayed result',async()=>{
  const h=harness();await h.seed();const previous=h.app.result;
  const pending=start(h,'reroute');h.workers.at(-1).emit('stale');await pending;
  assert.equal(h.app.session,null);assert.equal(h.app.result,previous);idle(h);
});

test('an idle worker failure cannot create a sessionless worker on the next reroute',async()=>{
  for(const kind of ['runtime','messageerror']){
    const h=harness();await h.seed();const previous=h.app.result,w=h.workers.at(-1);
    if(kind==='runtime')w.onerror({message:'idle crash'});else w.onmessageerror();
    assert.equal(h.api.routingClient.worker,null);
    await h.api.rerouteOne('a');
    assert.equal(h.app.session,null);assert.equal(h.app.result,previous);
    assert.equal(h.workers.length,1,'reroute must not manufacture a fresh sessionless worker');
    idle(h);
  }
});

test('success keeps reroute session, invalidates shapePatch session, and allows fresh routing after cancel',async()=>{
  const h=harness();await h.seed();
  const next={status:'partial',stats:{connected:1,total:2},overuse:[],nets:[]};
  let pending=start(h,'reroute');h.workers.at(-1).emit('result',{result:next,outcome:{ok:true}});await pending;
  assert.equal(h.app.session,true);assert.equal(h.app.result,next);idle(h);
  pending=start(h,'shapePatch');h.workers.at(-1).emit('result',{result:next,shape:{applied:false}});await pending;
  assert.equal(h.app.session,null);assert.equal(h.app.result,next);idle(h);
  pending=h.api.runRoute();h.$('btnStop').click();await pending;
  assert.equal(h.app.result,null);assert.equal(h.app.session,null);idle(h);
  pending=h.api.runRoute();h.workers.at(-1).emit('result',{design:h.app.design,result:next});await pending;
  assert.equal(h.app.session,true);assert.equal(h.app.result,next);idle(h);
});
