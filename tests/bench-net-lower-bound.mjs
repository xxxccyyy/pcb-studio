// Run: node tests/bench-net-lower-bound.mjs
// Isolates first-call netLowerBound work: no UI cache, files, or routing pipeline.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { netLowerBound } from '../src/engine.mjs';
import { referenceNetLowerBound, seededPads } from './net-lower-bound-reference.mjs';

const median=values=>values.slice().sort((a,b)=>a-b)[Math.floor(values.length/2)];
const timed=(fn,pads)=>{const start=performance.now();const value=fn(pads);return {value,ms:performance.now()-start};};
// Warm JavaScript functions without reusing any per-net cache (neither has one).
for(let i=0;i<8;i++){
  const pads=seededPads(40,29+i);
  assert.equal(netLowerBound(pads),referenceNetLowerBound(pads));
}
const rows=[];
for(const count of [100,300,600,1000]){
  const pads=seededPads(count,0x12345678),oldTimes=[],newTimes=[];
  for(let sample=0;sample<5;sample++){
    // Alternate ordering to reduce one-sided JIT/thermal bias.
    const old=sample%2?null:timed(referenceNetLowerBound,pads);
    const optimized=timed(netLowerBound,pads);
    const baseline=old||timed(referenceNetLowerBound,pads);
    assert.equal(optimized.value,baseline.value,'bitwise-equal length at '+count+' pads');
    oldTimes.push(baseline.ms);newTimes.push(optimized.ms);
  }
  const beforeMedianMs=median(oldTimes),afterMedianMs=median(newTimes);
  rows.push({pads:count,beforeMedianMs,afterMedianMs,speedup:beforeMedianMs/afterMedianMs,
    beforeDistanceEvaluations:(count*count*count-count)/6,
    afterDistanceEvaluations:count*(count-1)/2,
    numericEquivalent:true});
}
console.log(JSON.stringify({scope:'netLowerBound Prim fallback only; no UI cache',
  node:process.version,platform:process.platform,arch:process.arch,samples:5,rows},null,2));
