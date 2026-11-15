import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as core from '../src/engine.mjs';
import { parseArguments } from '../src/cli-args.mjs';

test('normalization supplies defaults without changing input or footprint pitch',()=>{
  const input={pads:[{id:'P',x:1,y:2,w:1,h:1}],nets:[{id:'a'}]};
  const d=core.normalizeDesign(input);
  assert.equal(d.grid,0.5);assert.equal(d.nets[0].name,'a');assert.equal(d.pads[0].layer,'both');
  assert.equal(input.pads[0].layer,undefined);
});
test('malformed and unbounded geometry fails before allocation',()=>{
  for(const input of [null,[],{pads:null},{grid:0},{width:NaN},{layers:3},{nets:[{id:'a'},{id:'a'}]},
    {pads:[{id:'a',x:1,y:2,w:-1,h:1}]},{nets:[{id:'a',w:Infinity}]}]) assert.throws(()=>core.normalizeDesign(input));
  assert.throws(()=>core.buildModel({...core.designDefaults(),width:1e9}),/grid exceeds/);
  assert.throws(()=>core.renderBoardPixels({...core.designDefaults(),width:1e9},{nets:[]}),/pixels/);
});
test('grid adjustment always rounds upward and preserves physical footprint spacing',()=>{
  const d=core.designDefaults();d.trackW=0.31;d.clearance=0.22;
  assert.equal(core.minimumRoutingGrid(d),0.55);
  d.pads=[{id:'U-1',netId:'a',x:10,y:10,w:1,h:1,shape:'rect',layer:'both'},
    {id:'U-2',netId:'a',x:12.54,y:10,w:1,h:1,shape:'rect',layer:'both'}];d.nets=[{id:'a',name:'A'}];
  core.routeBoard(d,{optimize:false});assert.equal(d.grid,0.55);
  assert.ok(Math.abs(d.pads[1].x-d.pads[0].x-2.54)<1e-8);
});
test('CLI parses repeated positional values, boolean flags and fractional costs',()=>{
  const {args,options}=parseArguments('pour',['same.json','same.json','--no-stitch','--net','GND']);
  assert.deepEqual(args,['same.json','same.json']);assert.equal(options.get('--no-stitch'),true);
  assert.equal(parseArguments('route',['x','--via-cost','17.3']).options.get('--via-cost'),'17.3');
  assert.deepEqual(parseArguments('spec',['--','-name.json']).args,['-name.json']);
});
test('CLI joint-reroute switch is boolean regardless of option order',()=>{
  for(const cmd of ['route','autopcb']){
    for(const argv of [['board.json','--no-joint-reroute'],['--no-joint-reroute','board.json'],
      ['board.json','--no-joint-reroute','--max-iter','2']]){
      const {args,options}=parseArguments(cmd,argv);
      assert.deepEqual(args,['board.json']);assert.equal(options.get('--no-joint-reroute'),true);
    }
  }
});
test('CLI validates fanout modes before starting routing or reading files',()=>{
  for(const cmd of ['route','autopcb']){
    for(const mode of ['off','auto','inner','outer','inner_first','outer_first'])
      assert.equal(parseArguments(cmd,['board.json','--fanout-first',mode]).options.get('--fanout-first'),mode);
    assert.throws(()=>parseArguments(cmd,['board.json','--fanout-first','typo']),/--fanout-first must/);
    assert.throws(()=>parseArguments(cmd,['board.json','--fanout-first']),/Missing value/);
  }
});
test('CLI rejects missing, unknown, duplicate and invalid option values',()=>{
  for(const [cmd,args] of [['route',['-o']],['route',['--via-cost','no']],['route',['--max-iter','1.5']],
    ['route',['--max-iter','0']],['route',['--typo','1']],['route',['-o','a','-o','b']],
    ['pour',['--layer','middle']],['render',['--scale','Infinity']],['place',['--iterations','-1']]])
    assert.throws(()=>parseArguments(cmd,args));
});
const result=path=>({nets:[{netId:'a',name:'A',paths:[path],vias:[],connected:2,total:2}],overuse:[]});
test('exact DRC catches a tiny pad and keepout between former sample locations',()=>{
  const d=core.designDefaults();d.pads=[{id:'tiny',netId:'b',x:13,y:10,w:0.2,h:0.2,shape:'rect',layer:'top'}];
  const r=result([{x:2,y:10,l:0},{x:50,y:10,l:0}]);r.nets[0].manual=true;
  assert.ok(core.checkDRC(d,r,{dfm:false}).some(i=>i.type==='手动布线冲突'));
  d.pads=[];d.keepouts=[{x:13,y:10,w:0.2,h:0.2}];
  assert.ok(core.checkDRC(d,r,{dfm:false}).some(i=>i.type==='手动布线冲突'));
});
test('exact pad geometry avoids circle-corner and different-layer false positives',()=>{
  assert.ok(core.padGap({x:0,y:0,w:2,h:2,shape:'circle'},{x:1.5,y:1.5,w:2,h:2,shape:'circle'})>0);
  const d=core.designDefaults();d.pads=[{id:'p',netId:'b',x:13,y:10,w:1,h:1,shape:'rect',layer:'bottom'}];
  assert.equal(core.checkDRC(d,result([{x:2,y:10,l:0},{x:50,y:10,l:0}]),{dfm:false}).filter(i=>i.sev==='error').length,0);
});
test('manual routes and vias become fixed obstacles while their owner can pass',()=>{
  const d=core.designDefaults();d.nets=[{id:'a',name:'A'},{id:'b',name:'B'}];
  d.manual=[{netId:'a',pts:[{x:15.25,y:2.25,l:0},{x:15.25,y:18.25,l:0}]}];
  const p=(id,x)=>({id,netId:'b',x,y:10.25,w:1.2,h:1.2,shape:'rect',layer:'top'});
  d.pads=[p('b1',5.25),p('b2',25.25)];
  const model=core.buildModel(d),cell=20*model.GW+30;
  assert.equal(model.fixedOwner[cell],1);assert.equal(model.fixedOwner[model.NC+cell],0);
  const s=core.createSession(d,{});while(!s.step().done){}
  const r=s.buildResult();r.nets.push(...core.manualRouteEntries(d));
  assert.equal(r.status,'complete');assert.equal(core.checkDRC(d,r,{dfm:false}).filter(i=>i.sev==='error').length,0);
});
test('manual layer transitions are included in CLI/GUI via audits',()=>{
  const d=core.designDefaults();d.manual=[{netId:'a',pts:[{x:1,y:2,l:0},{x:1,y:2,l:1},{x:3,y:2,l:1}]}];
  assert.deepEqual(core.manualRouteEntries(d)[0].vias,[{x:1,y:2,layers:[0,1]}]);   // #15：换层点带跨度
  assert.throws(()=>core.normalizeResult({nets:[{paths:[[{x:NaN,y:2,l:0}]],vias:[]}]},d));
});
test('four-layer track statistics include inner layers before and after beautification',()=>{
  const d=core.designDefaults();d.layers=4;
  const r=result([{x:5,y:10,l:1},{x:25,y:10,l:1}]);
  r.stats={connected:2,total:2,trackTop:0,trackBot:0,trackLen:0,vias:0};
  core.beautifyResult(d,r);assert.equal(r.stats.trackLen,20);assert.equal(r.stats.trackInner,20);
  assert.deepEqual(r.stats.trackLayers,[0,20,0,0]);
});
test('four-layer Gerber exports contain both inner copper layers and the real bottom layer',()=>{
  const d=core.designDefaults();d.layers=4;
  d.pads=[{id:'B',netId:'a',x:20,y:20,w:1,h:1,shape:'rect',layer:'bottom'}];
  const r=result([{x:5,y:10,l:1},{x:25,y:10,l:1}]);
  const g=core.buildGerber(d,r,null,[]),files=core.gerberFiles(g);
  assert.equal(files.length,10);assert.equal(g.inner.length,2);
  assert.ok(g.inner[0].includes('X5000000Y10000000D02*'));
  assert.ok(!g.bottom.includes('X5000000Y10000000D02*'));
  assert.ok(g.bottom.includes('X20000000Y20000000D03*'));
  assert.ok(g.bmask.includes('X20000000Y20000000D03*'));
});
test('CLI option errors are clean JSON with a nonzero exit status',()=>{
  const cli=fileURLToPath(new URL('../ai/pcb.mjs',import.meta.url));
  for(const args of [['route','missing.json','--via-cost','NaN'],['route','missing.json','-o'],['route','--unknown']]){
    const r=spawnSync(process.execPath,[cli,...args],{encoding:'utf8'});
    assert.equal(r.status,1);assert.equal(JSON.parse(r.stdout).ok,false);assert.equal(r.stderr,'');
  }
});
test('CLI routing strategy switches work end to end for route and autopcb',t=>{
  const dir=mkdtempSync(join(tmpdir(),'pcb-strategy-'));
  // mkdtempSync 返回本测试独占的绝对目录；只清理此目录。
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const design=join(dir,'design.json'),placed=join(dir,'placed.json');
  const d=core.designDefaults();d.width=20;d.height=15;
  d.nets=[{id:'a',name:'A'}];
  d.pads=[3,15].map((x,i)=>({id:'P'+i,netId:'a',x,y:7,w:1,h:1,shape:'circle',layer:'both'}));
  writeFileSync(design,JSON.stringify(d));
  const cli=fileURLToPath(new URL('../ai/pcb.mjs',import.meta.url));
  for(const cmd of ['route','autopcb']){
    const args=[cli,cmd,design,'--no-joint-reroute','--no-compact-pairs','--blind-vias','--fanout-first','inner','--max-iter','2'];
    if(cmd==='autopcb')args.push('--rounds','1','--iterations','1','-o',placed);
    const r=spawnSync(process.execPath,args,{encoding:'utf8',timeout:30000});
    assert.equal(r.status,0,r.stdout+'\n'+r.stderr);assert.equal(JSON.parse(r.stdout).ok,true);
  }
});
test('placement is repeatable with a seed',()=>{
  const a=core.EXAMPLES[0].build(),b=structuredClone(a);
  core.autoPlace(a,{iterations:300,seed:42});core.autoPlace(b,{iterations:300,seed:42});
  assert.deepEqual(a.pads,b.pads);
});
test('placement preserves real footprint dimensions and anchors through rotations and board clamping',()=>{
  const d=core.designDefaults();d.nets=[{id:'a',name:'A'}];
  d.pads=core.footprintPads('SOIC-8').map((p,i)=>({id:'U1-'+i,netId:'a',x:1+p.dx,y:1+p.dy,w:p.w,h:p.h,shape:p.shape,layer:p.layer}));
  const original=structuredClone(d.pads);
  core.autoPlace(d,{iterations:500});
  for(let i=0;i<original.length;i++)for(let j=i+1;j<original.length;j++)
    assert.ok(Math.abs(Math.hypot(original[i].x-original[j].x,original[i].y-original[j].y)-Math.hypot(d.pads[i].x-d.pads[j].x,d.pads[i].y-d.pads[j].y))<0.0002);
  const anchored=structuredClone(d);core.autoPlace(d,{iterations:100,anchor:['U1']});assert.deepEqual(d.pads,anchored.pads);
});
test('session rollback restores geometry, occupancy and subsequent rerouting',()=>{
  const d=core.EXAMPLES[2].build(),s=core.createSession(d,{});while(!s.step().done){}
  const saved=s.snapshot(),before=s.buildResult();s.optimize(2);s.restore(saved);
  const after=s.buildResult();assert.deepEqual(after.nets,before.nets);assert.deepEqual(after.stats,before.stats);
  assert.equal(s.rerouteSingle(d.nets[0].id).ok,true);
  assert.equal(core.checkDRC(d,s.buildResult(),{dfm:false}).filter(i=>i.sev==='error').length,0);
});
const Client=vm.runInNewContext(readFileSync(new URL('../src/worker-client.js',import.meta.url),'utf8')+'\nRoutingWorkerClient;', {DOMException});
test('worker cancellation rejects pending work, terminates the search, and supports a fresh session',async()=>{
  const workers=[],client=new Client(()=>{const w={terminate(){this.stopped=true;},postMessage(m){this.sent=m;}};workers.push(w);return w;});
  const pending=client.request('route');client.dispose();await assert.rejects(pending,{name:'AbortError'});assert.equal(workers[0].stopped,true);
  const next=client.request('route'),w=workers[1];
  w.onmessage({data:{id:w.sent.id-1,type:'result',result:'stale'}});
  w.onmessage({data:{id:w.sent.id,type:'result',result:'new'}});
  assert.equal((await next).result,'new');client.dispose();
});
test('worker failures settle promises and discard invalid sessions',async()=>{
  let w;const client=new Client(()=>w={terminate(){},postMessage(){}});
  const p=client.request('route');w.onerror({message:'failed'});
  await assert.rejects(p,/failed/);assert.equal(client.worker,null);
});
