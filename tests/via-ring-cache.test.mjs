import assert from 'node:assert/strict';
import vm from 'node:vm';
import test from 'node:test';
import * as core from '../src/engine.mjs';
import {engineSource,uncachedEngine,cleanResult} from './via-ring-reference.mjs';
const direct=await uncachedEngine();
const start=engineSource.indexOf('          let bad=false, rpen=0;\n          if(viaRingStamp');
const end=engineSource.indexOf('          if(bad) continue;',start);
assert.ok(start>=0&&end>start);
const scanBody=engineSource.slice(start,end)+'\nreturn {bad,rpen:bad?0:rpen};';
function ringHarness(cached){
  const GW=9,NC=81,L=4,raw=new Int16Array(NC*L);let reads=0;
  const usage=new Proxy(raw,{get(target,key){if(/^\d+$/.test(String(key)))reads++;return target[key];}});
  const context={GW,GH:9,NC,L,usage,ownStamp:new Int32Array(NC*L),gen:1,presFac:2,
    ringOffs:[[-1,0],[1,0],[0,-1],[0,1]],viaRingPenalty:cached?new Float64Array(NC):null,
    viaRingStamp:cached?new Int32Array(NC):null};
  const scan=vm.runInNewContext('(function(cc,cur,ns,hard){'+scanBody+'})',context);
  return {context,raw,scan:(cc,from,to,hard)=>cleanResult(scan(cc,from*NC+cc,to*NC+cc,hard)),reads:()=>reads};
}
test('via-ring cache reuses all layer pairs and invalidates on each search generation',()=>{
  const a=ringHarness(true),b=ringHarness(false),cc=40;
  function next({hard=false,presFac=2,own=false}={}){
    for(const h of [a,b]){
      h.context.gen++;h.context.presFac=presFac;h.raw.fill(0);h.raw[cc+1]=2;h.raw[cc+81*3-1]=1;
      h.context.ownStamp.fill(0);if(own)h.context.ownStamp[cc+1]=h.context.gen;
    }
    const before=a.reads();
    for(const [from,to] of [[0,1],[1,0],[1,2],[2,3],[3,2],[2,1]])
      assert.deepEqual(a.scan(cc,from,to,hard),b.scan(cc,from,to,hard));
    assert.ok(a.reads()>before,'first lookup must compute after gen changes');
    const after=a.reads();a.scan(cc,0,3,hard);assert.equal(a.reads(),after,'no usage reads on cache hit');
  }
  next();next({hard:true});next({presFac:2.7});next({own:true,presFac:.1});next({hard:true,own:true});
  // Border clipping is also invariant across layer pairs.
  for(const h of [a,b])h.context.gen++;
  for(const [from,to] of [[0,1],[1,2],[3,2]])assert.deepEqual(a.scan(0,from,to,false),b.scan(0,from,to,false));
});
test('via-ring cache has a 12 MB cap and its null path computes directly',()=>{
  const begin=engineSource.indexOf('  const viaRingPenalty='),finish=engineSource.indexOf('  const ownStamp=',begin);
  const declarations=engineSource.slice(begin,finish);
  for(const [NC,enabled] of [[1_000_000,true],[1_000_001,false]]){
    const arrays=vm.runInNewContext(declarations+'\n({viaRingPenalty,viaRingStamp});',{NC});
    assert.equal(!!arrays.viaRingPenalty,enabled);assert.equal(!!arrays.viaRingStamp,enabled);
    if(enabled)assert.equal(arrays.viaRingPenalty.byteLength+arrays.viaRingStamp.byteLength,12_000_000);
  }
  const h=ringHarness(false);assert.doesNotThrow(()=>h.scan(40,0,1,false));
  const reads=h.reads();h.scan(40,1,2,false);assert.ok(h.reads()>reads,'null path must recompute safely');
});
function routed(api,design,opts){
  const session=api.createSession(structuredClone(design),opts);while(!session.step().done){}
  return session;
}
test('cached and direct search agree across diagonal, hard/soft, via-cost and blind-via configurations',()=>{
  for(const example of core.EXAMPLES)for(const opts of [{},{diag:false},{viaCost:17.3},{layerDir:false},{blindVias:true}]){
    const d=example.build(),a=routed(core,d,opts),b=routed(direct,d,opts);
    assert.deepEqual(cleanResult(a.buildResult()),cleanResult(b.buildResult()),example.id+' '+JSON.stringify(opts));
  }
});
test('cache generations do not leak across restore, optimization and single-net rerouting',()=>{
  for(const layers of [2,4]){
    const d=core.EXAMPLES[2].build();d.layers=layers;
    const opts={maxIter:8,blindVias:true},a=routed(core,d,opts),b=routed(direct,d,opts);
    const snapA=a.snapshot(),snapB=b.snapshot();
    const same=()=>assert.deepEqual(cleanResult(a.buildResult()),cleanResult(b.buildResult()));
    same();a.optimize(2);b.optimize(2);same();
    a.restore(snapA);b.restore(snapB);same();
    const id=d.nets[0].id;assert.deepEqual(cleanResult(a.rerouteSingle(id)),cleanResult(b.rerouteSingle(id)));same();
    a.restore(snapA);b.restore(snapB);a.optimize(1);b.optimize(1);same();
  }
});
