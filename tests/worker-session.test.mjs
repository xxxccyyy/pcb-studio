import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import * as engine from '../src/engine.mjs';

// Execute the real browser worker handler with the real engine, without a browser
// dependency. Clone at the message boundary just as Worker.postMessage does.
const workerSource=readFileSync(new URL('../src/route-worker.js',import.meta.url),'utf8')
  .replace(/^import[^\n]*\n/,'');
function workerHarness(){
  const messages=[];
  const self={postMessage(message){messages.push(structuredClone(message));}};
  vm.runInNewContext(workerSource,{...engine,self});
  let id=0;
  return (command,payload={})=>{
    const requestId=++id;
    self.onmessage({data:structuredClone({id:requestId,command,...payload})});
    const response=messages.findLast(m=>m.id===requestId&&m.type!=='progress');
    assert.ok(response,'worker must settle each request');
    assert.notEqual(response.type,'error',response.error);
    return response;
  };
}
function fixture(){
  return {...engine.designDefaults(),width:30,height:20,
    trackW:0.25,grid:0.5,
    nets:[{id:'a',name:'A'},{id:'gnd',name:'GND'}],
    pads:[
      {id:'A1',netId:'a',x:3.25,y:10.25,w:1,h:1,shape:'rect',layer:'top'},
      {id:'A2',netId:'a',x:26.25,y:10.25,w:1,h:1,shape:'rect',layer:'top'}
    ],
    keepouts:[{x:15,y:3,w:1,h:1}],
    stitching:[{x:15,y:17,netId:'gnd'}],
    manual:[{id:'M1',netId:'gnd',pts:[{x:3,y:17,l:0},{x:6,y:17,l:0}]}]
  };
}
const routeOptions={maxIter:2,optimize:false,beautify:false};

test('worker accepts an unchanged normalized design and rejects all model-affecting edits',()=>{
  const request=workerHarness();
  const initial=request('route',{design:fixture(),options:routeOptions});
  assert.equal(initial.type,'result');
  const design=initial.design;
  // Round trips and repeated normalization are what the UI sends after routing.
  const unchanged=engine.normalizeDesign(JSON.parse(JSON.stringify(design)));
  assert.equal(request('reroute',{design:unchanged,netId:'a',options:{beautify:false}}).type,'result');
  const edits={
    trackW:d=>{d.trackW+=0.1;},
    clearance:d=>{d.clearance+=0.1;},
    viaOuter:d=>{d.viaOuter+=0.1;},
    viaDrill:d=>{d.viaDrill-=0.1;},
    copperWeight:d=>{d.copperWeight='2';},
    grid:d=>{d.grid=0.25;},
    width:d=>{d.width+=1;},
    height:d=>{d.height+=1;},
    layers:d=>{d.layers=4;},
    padPosition:d=>{d.pads[0].x+=0.5;},
    padHole:d=>{d.pads[0].holeR=0.1;},
    manualPosition:d=>{d.manual[0].pts[0].x+=0.5;},
    manualOwnership:d=>{d.manual[0].netId='a';},
    keepoutPosition:d=>{d.keepouts[0].x+=1;},
    keepoutScope:d=>{d.keepouts[0].scope='power';},
    stitchingAdded:d=>{d.stitching.push({x:12,y:17,netId:'gnd'});},
    stitchingRemoved:d=>{d.stitching=[];},
    stitchingMoved:d=>{d.stitching[0].x+=1;},
    stitchingOwnership:d=>{d.stitching[0].netId='a';},
    netWidth:d=>{d.nets[0].w=0.4;},
    highSpeed:d=>{d.nets[0].hs=true;},
    riseTime:d=>{d.nets[0].tr=0.1;},
    pair:d=>{d.nets[0].pair='usb';d.nets[1].pair='usb';},
    diffZ:d=>{d.nets[0].diffZ=90;},
    rules:d=>{d.rules={classes:{power:{}},netClass:{A:'power'}};}
  };
  for(const [name,edit] of Object.entries(edits)){
    const changed=structuredClone(design);edit(changed);
    const response=request('reroute',{design:changed,netId:'a',options:{beautify:false}});
    assert.equal(response.type,'stale',name+' must invalidate the captured model');
    assert.equal(response.result,undefined,name+' must not return obsolete geometry');
  }
  // Rejected edits must not mutate the existing session.
  assert.equal(request('reroute',{design,netId:'a',options:{beautify:false}}).type,'result');
});

test('a new fixed via on a routed segment cannot be ignored by single-net rerouting',()=>{
  const request=workerHarness();
  const initial=request('route',{design:fixture(),options:routeOptions});
  const changed=structuredClone(initial.design);
  const paths=initial.result.nets.find(n=>n.netId==='a').paths;
  let longest=null;
  for(const path of paths) for(let i=1;i<path.length;i++){
    const a=path[i-1],b=path[i];
    const length=a.l===b.l?Math.hypot(a.x-b.x,a.y-b.y):0;
    if(!longest||length>longest.length) longest={a,b,length};
  }
  assert.ok(longest.length>0);
  changed.stitching.push({x:(longest.a.x+longest.b.x)/2,y:(longest.a.y+longest.b.y)/2,netId:'gnd'});
  assert.ok(engine.checkDRC(changed,initial.result,{dfm:false})
    .some(issue=>issue.sev==='error'&&issue.type==='过孔-走线间距'),
  'fixture must introduce a real fixed-copper conflict');
  assert.equal(request('reroute',{design:changed,netId:'a',options:{beautify:false}}).type,'stale');
  // A fresh full route builds a model containing the added obstacle.
  const rebuilt=request('route',{design:changed,options:routeOptions});
  assert.equal(rebuilt.type,'result');
  assert.equal(engine.checkDRC(rebuilt.design,rebuilt.result,{dfm:false})
    .filter(issue=>issue.sev==='error'&&issue.type==='过孔-走线间距').length,0);
});
