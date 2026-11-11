// Optional comparison: npm run bench -- /absolute/path/to/previous/index.html
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';

function load(file) {
  const html=readFileSync(file,'utf8');
  const extract=mark=>html.match(new RegExp('// ==== '+mark+' START ====([\\s\\S]*?)// ==== '+mark+' END ===='))[1];
  const source=extract('ROUTER CORE');
  const core=new Function(source+'\n'+extract('EXAMPLES')+'\nreturn {createSession,checkDRC,EXAMPLES};')();
  // Isolate the real session heuristic for a repeatable comparison without A* noise.
  const start=source.indexOf('  function computeH(goalSet){');
  const end=source.indexOf('\n  function astar(',start);
  const helper=source.includes('function fillDistanceMap(')
    ? source.slice(source.indexOf('function fillDistanceMap('),source.indexOf('// 过孔影响区')) : '';
  core.map=new Function('model','goals','viaCost','diagOn',`
    const {GW,GH,NC,L,TS}=model, BIG=1e9;
    const hMap=new Float32Array(TS), hQueue=new Int32Array(TS);
    ${helper}
    ${source.slice(start,end)}
    return ()=>{computeH(goals); return hMap;};
  `);
  return core;
}

const variants=[];
if(process.argv[2]) variants.push({name:'before',core:load(process.argv[2])});
variants.push({name:'current',core:load(new URL('../index.html',import.meta.url))});
const median=xs=>xs.sort((a,b)=>a-b)[Math.floor(xs.length/2)];
console.log('Heuristic median ms per call (7 samples, 5 calls/sample; lower is better)');
for(const L of [2,4]) {
  const GW=240,GH=160,NC=GW*GH,model={GW,GH,NC,L,TS:NC*L};
  const goals=new Set([Math.floor(NC/3),NC-25]);
  for(const viaCost of [15,150]) {
    const runners=variants.map(v=>({...v,run:v.core.map(model,goals,viaCost,true),times:[]}));
    for(const v of runners) for(let i=0;i<3;i++) v.run();
    for(let sample=0;sample<7;sample++) for(const v of sample%2?runners.toReversed():runners) {
      const t=performance.now();
      for(let i=0;i<5;i++) v.run();
      v.times.push((performance.now()-t)/5);
    }
    if(runners.length===2) {
      const a=runners[0].run(),b=runners[1].run();
      for(let i=0;i<a.length;i++) assert.ok(Math.abs(a[i]-b[i])<1e-4);
    }
    console.log(JSON.stringify({grid:`${GW}x${GH}x${L}`,viaCost,
      ...Object.fromEntries(runners.map(v=>[v.name,+median(v.times).toFixed(3)]))}));
  }
}

console.log('Full session + two optimization passes: median of 5 runs (one warmup)');
for(let ex=0;ex<variants[0].core.EXAMPLES.length;ex++) {
  const runners=variants.map(v=>({...v,times:[]}));
  for(let sample=-1;sample<5;sample++) for(const v of sample%2?runners.toReversed():runners) {
    const d=v.core.EXAMPLES[ex].build(),t=performance.now(),s=v.core.createSession(d,{});
    let steps=0;
    while(!s.step().done) assert.ok(++steps<200000);
    s.optimize(2);
    const ms=performance.now()-t,r=s.buildResult();
    if(sample>=0) v.times.push(ms);
    assert.equal(r.status,'complete');
    assert.equal(v.core.checkDRC(d,r).filter(i=>i.sev==='error').length,0);
    v.quality={connected:r.stats.connected,vias:r.stats.vias,length:+r.stats.trackLen.toFixed(3)};
  }
  console.log(JSON.stringify({example:variants[0].core.EXAMPLES[ex].id,
    ...Object.fromEntries(runners.map(v=>[v.name,{ms:+median(v.times).toFixed(2),...v.quality}]))}));
}
