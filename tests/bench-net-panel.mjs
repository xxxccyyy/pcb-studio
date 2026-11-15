// Run: node tests/bench-net-panel.mjs
// Measures only network-panel geometry preparation, not DOM, drawing or routing.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { netLowerBound } from '../src/engine.mjs';

const source=readFileSync(new URL('../src/ui.js',import.meta.url),'utf8');
const start=source.indexOf('  function createNetGeometryCache(');
const end=source.indexOf('  const netGeometryCache=',start);
assert.ok(start>=0&&end>start);
const createCache=vm.runInNewContext(source.slice(start,end)+'\ncreateNetGeometryCache;');
const design={nets:Array.from({length:101},(_,i)=>({id:'n'+i})),pads:[]};
for(let i=0;i<600;i++) design.pads.push({id:'g'+i,netId:'n0',x:(i%30)*0.8,y:Math.floor(i/30)*0.8});
for(let n=1;n<=100;n++) for(let i=0;i<4;i++)
  design.pads.push({id:n+'-'+i,netId:'n'+n,x:n+i,y:n-i});
const baseline=()=>design.nets.map(n=>({
  count:design.pads.filter(p=>p.netId===n.id).length,
  lowerBound:netLowerBound(design.pads.filter(p=>p.netId===n.id))
}));
const update=createCache(netLowerBound);
const cached=()=>Array.from(update(design).values(),g=>({count:g.pads.length,lowerBound:g.lowerBound}));
assert.deepEqual(cached(),baseline());
const median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
const measure=(fn,repeats)=>{
  const samples=[];
  for(let i=0;i<repeats;i++){const t=performance.now();fn();samples.push(performance.now()-t);}
  return median(samples);
};
const beforeMs=measure(baseline,5),afterMs=measure(cached,21);
design.pads[0].x+=0.2;
assert.deepEqual(cached(),baseline(),'geometry edits must not return stale bounds');
console.log(JSON.stringify({scope:'network-panel geometry only; unchanged design after warm-up',
  nets:design.nets.length,pads:design.pads.length,beforeMedianMs:beforeMs,
  afterMedianMs:afterMs,speedup:beforeMs/afterMs,outputEquivalent:true},null,2));
