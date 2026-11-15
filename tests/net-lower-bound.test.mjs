import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { netLowerBound, rmstTasks } from '../src/engine.mjs';
import { referenceNetLowerBound, seededPads } from './net-lower-bound-reference.mjs';

function compare(pads,label){
  const before=structuredClone(pads);
  assert.equal(netLowerBound(pads),referenceNetLowerBound(pads),label+' must match every numeric bit');
  assert.deepEqual(pads,before,label+' must not mutate caller data');
}

test('length bound keeps empty, singleton, duplicate and exact RMST behavior',()=>{
  for(const pads of [undefined,null,[],[{x:1,y:2}]]) compare(pads,'empty/singleton');
  const steiner=[{x:0,y:1},{x:1,y:0},{x:2,y:1}];
  assert.equal(netLowerBound(steiner),3,'small net must use Steiner tree, not MST=4');
  for(let n=2;n<=10;n++){
    const pads=Array.from({length:n},(_,i)=>({...steiner[i%3]}));
    assert.ok(rmstTasks(pads));compare(pads,'RMST boundary '+n);
  }
  const eleven=Array.from({length:11},(_,i)=>({...steiner[i%3]}));
  assert.equal(rmstTasks(eleven),null,'cutoff depends on raw count, not unique coordinates');
  assert.equal(netLowerBound(eleven),4,'duplicate reduction must not accidentally enable RMST');
  compare(eleven,'duplicate cutoff');
  for(let n=2;n<=8;n++) for(let seed=0;seed<12;seed++) compare(seededPads(n,seed),'small '+n+'/'+seed);
  compare(seededPads(9,49),'nine exact terminals');
  compare(seededPads(10,50),'ten exact terminals');
});

test('Prim fallback preserves ties, repeated coordinates, signed zero and coordinate extremes',()=>{
  const fixtures=[
    Array.from({length:40},()=>({x:3.25,y:-7.125})),
    Array.from({length:40},(_,i)=>({x:i%8,y:Math.floor(i/8)})),
    Array.from({length:33},(_,i)=>({x:i-16,y:2})),
    Array.from({length:33},(_,i)=>({x:-2,y:i-16})),
    Array.from({length:21},(_,i)=>({x:i%2?-0:0,y:i%2?0:-0})),
    Array.from({length:32},(_,i)=>({x:i%2?1e-300:-1e-300,y:(i%7)*1e-310})),
    Array.from({length:32},(_,i)=>({x:1e15+i*.125,y:-1e15+(i%7)*.25})),
    Array.from({length:20},(_,i)=>({x:i%2?Number.MAX_VALUE:-Number.MAX_VALUE,y:i%3})),
    seededPads(64,918).map((p,i)=>({...p,x:i%4?1e8+p.x*1e-5:p.x*1e-10})),
    Array.from({length:80},(_,i)=>({x:(i%9)*0.1,y:(i%13)*0.3}))
  ];
  for(const [i,pads] of fixtures.entries()){
    compare(pads,'edge '+i);compare(pads.slice().reverse(),'reversed edge '+i);
    compare(pads.slice(7).concat(pads.slice(0,7)),'rotated edge '+i);
  }
});

test('Prim fallback matches frozen cubic reference on seeded random and duplicate-rich nets',()=>{
  for(let seed=0;seed<240;seed++){
    const count=11+(seed*37)%110;
    const pads=seededPads(count,seed);
    if(seed%3===0) for(let i=3;i<pads.length;i+=3) pads[i]={...pads[i%3]};
    if(seed%3===1) for(const p of pads){p.x=Math.round(p.x*.2);p.y=Math.round(p.y*.2);}
    compare(pads,'random '+seed+' size '+count);
  }
  for(const count of [100,300,600,1000]) compare(seededPads(count,0xcafebabe),'large '+count);
});

test('fallback performs exactly P(P-1)/2 distance calculations instead of cubic rescans',()=>{
  const source=readFileSync(new URL('../src/engine.mjs',import.meta.url),'utf8');
  const start=source.indexOf('function netLowerBound(pads){');
  const end=source.indexOf('\n/* ---------- 特性阻抗估算',start);
  assert.ok(start>=0&&end>start);
  let absCalls=0;
  const instrumented=vm.runInNewContext(source.slice(start,end)+'\nnetLowerBound;',{
    rmstTasks:()=>null,Math:{abs(value){absCalls++;return Math.abs(value);}}
  });
  for(const count of [11,100,300]){
    absCalls=0;const pads=seededPads(count,37);
    assert.equal(instrumented(pads),netLowerBound(pads));
    assert.equal(absCalls,count*(count-1),'two abs per pair; no historical-tree rescan');
  }
});
