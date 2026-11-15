// Usage: node tests/bench-engine-quality.mjs <before-engine.mjs>
// A single-run quality comparison, not a stable runtime benchmark. Never writes projects.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import * as after from '../src/engine.mjs';
import {searchCases} from './search-cases.mjs';
if(!process.argv[2])throw new Error('Supply a pre-change engine module path. This script never overwrites the baseline.');
const before=await import(pathToFileURL(resolve(process.argv[2])).href);
const fixtures=searchCases(after).map(f=>({...f,opts:{...f.opts,maxIter:10,compactPairs:false,jointReroute:false}}));
for(const name of ['p10-grid-08','p13-density-3','p19-star-7','p27-cnc-shield','p43-single-layer','p45-center-keepout']){
  const raw=JSON.parse(readFileSync(new URL('../projects/round11/out/'+name+'/design.json',import.meta.url),'utf8'));
  fixtures.push({name,design:after.normalizeDesign(raw.design||raw),opts:{maxIter:10,compactPairs:false,jointReroute:false}});
}
function run(core,f){
  const design=structuredClone(f.design),start=performance.now(),r=core.routeBoard(design,f.opts).result;
  const ms=performance.now()-start,all={...r,nets:[...r.nets,...core.manualRouteEntries(design)]};
  const geometricErrors=core.checkDRC(design,all,{dfm:false}).filter(i=>i.sev==='error').length;
  const manufacturing=core.checkDRC(design,all,{dfm:true});
  return {ms,status:r.status,connected:r.stats.connected,total:r.stats.total,geometricErrors,
    manufacturingErrors:manufacturing.filter(i=>i.sev==='error').length,
    manufacturingWarnings:manufacturing.filter(i=>i.sev==='warn').length,
    overuse:r.overuse.length,vias:r.stats.vias,trackLen:r.stats.trackLen,score:core.routeScore(r)};
}
const rows=[];
for(const fixture of fixtures){
  const a=run(before,fixture),b=run(after,fixture);
  rows.push({name:fixture.name,before:a,after:b,improved:after.scoreBetter(b.score,a.score),regressed:after.scoreBetter(a.score,b.score)});
}
const sum=(side,key)=>rows.reduce((total,row)=>total+row[side][key],0);
const summary={cases:rows.length,improved:rows.filter(r=>r.improved).length,regressed:rows.filter(r=>r.regressed).length,
  geometricErrorsBefore:sum('before','geometricErrors'),geometricErrorsAfter:sum('after','geometricErrors'),
  unconnectedBefore:sum('before','total')-sum('before','connected'),unconnectedAfter:sum('after','total')-sum('after','connected'),
  viasBefore:sum('before','vias'),viasAfter:sum('after','vias'),trackLenBefore:sum('before','trackLen'),trackLenAfter:sum('after','trackLen')};
console.log(JSON.stringify({scope:'same-input 21-case quality comparison; single-run runtime is illustrative only',summary,rows},null,2));
