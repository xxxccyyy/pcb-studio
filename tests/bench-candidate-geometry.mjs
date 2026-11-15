// Candidate-only segment audit vs two whole-board audits; not full routing speed.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {performance} from 'node:perf_hooks';
import * as core from '../src/engine.mjs';
const source=readFileSync(new URL('../src/engine.mjs',import.meta.url),'utf8');
const start=source.indexOf('function countNetSegmentViolations('),end=source.indexOf('\nfunction routeBoardShape(',start);
assert.ok(start>=0&&end>start);
const count=vm.runInNewContext(source.slice(start,end)+'\ncountNetSegmentViolations;',{...core});
const median=a=>a.sort((a,b)=>a-b)[a.length>>1];
function measure(fn){const times=[];let sum;for(let i=0;i<5;i++){const t=performance.now();sum=fn();times.push(performance.now()-t);}return {ms:median(times),sum};}
function bench(label,d,nets){
  const cases=nets.slice(0,16).map(entry=>({entry,rest:nets.filter(n=>n.netId!==entry.netId)}));
  const reference=()=>cases.map(({entry,rest})=>core.auditGeometry(d,{nets:[entry,...rest]}).length-core.auditGeometry(d,{nets:rest}).length);
  const candidate=()=>cases.map(({entry,rest})=>count(d,entry,rest));
  assert.deepEqual(candidate(),reference());reference();candidate();
  const before=measure(reference),after=measure(candidate);
  assert.deepEqual(after.sum,before.sum);
  console.log(JSON.stringify({label,scope:'16 candidate segment audits only',nets:nets.length,
    segments:nets.reduce((s,n)=>s+n.paths.reduce((s,p)=>s+Math.max(0,p.length-1),0),0),
    beforeMs:before.ms,afterMs:after.ms,speedup:before.ms/after.ms,equivalent:true}));
}
{
  const d=core.designDefaults();d.width=100;d.height=100;
  d.nets=Array.from({length:60},(_,i)=>({id:'n'+i,w:.2+(i%4)*.1}));
  let seed=123;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const nets=d.nets.map(n=>({netId:n.id,paths:Array.from({length:12},()=>{
    const l=(rnd()*2)|0;return [{x:rnd()*40,y:rnd()*40,l},{x:rnd()*40,y:rnd()*40,l}];}),vias:[]}));
  bench('dense synthetic',d,nets);
}
{
  const root=new URL('../projects/ext-fable-03/',import.meta.url);
  const raw=JSON.parse(readFileSync(new URL('design.json',root),'utf8'));
  const saved=JSON.parse(readFileSync(new URL('result.json',root),'utf8'));
  const d=core.normalizeDesign(raw.design||raw),r=saved.result||saved;
  bench('ext-fable-03 saved routes',d,r.nets);
}
