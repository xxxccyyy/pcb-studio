// Run: node tests/bench-via-ring.mjs (about one minute; no project writes).
// Same current engine, cache on/off; neither changes heuristics or route quality.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as cached from '../src/engine.mjs';
import {uncachedEngine,cleanResult} from './via-ring-reference.mjs';
const direct=await uncachedEngine();
const raw=JSON.parse(readFileSync(new URL('../projects/ext-fable-03/design.json',import.meta.url),'utf8'));
const design=cached.normalizeDesign(raw.design||raw);
const samples=Number(process.env.PCB_BENCH_SAMPLES||5);
assert.ok(Number.isInteger(samples)&&samples>=1&&samples<=9);
function run(api){const start=performance.now(),s=api.createSession(structuredClone(design),{maxIter:8});
  while(!s.step().done){}return {ms:performance.now()-start,result:cleanResult(s.buildResult())};}
const rows=[];
for(let i=0;i<=samples;i++){
  let a,b;if(i%2){b=run(cached);a=run(direct);}else{a=run(direct);b=run(cached);}
  assert.deepEqual(b.result,a.result,'cache cannot change routed geometry/statistics');
  if(i)rows.push({beforeMs:a.ms,afterMs:b.ms});
}
const median=a=>a.sort((a,b)=>a-b)[a.length>>1];
const beforeMedianMs=median(rows.map(r=>r.beforeMs)),afterMedianMs=median(rows.map(r=>r.afterMs));
console.log(JSON.stringify({scope:'ext-fable-03 createSession(maxIter=8), no postroute/beautify',
  node:process.version,samples,rows,beforeMedianMs,afterMedianMs,reduction:1-afterMedianMs/beforeMedianMs,
  equivalent:true},null,2));
