import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as core from '../src/engine.mjs';

const source=readFileSync(new URL('../src/engine.mjs',import.meta.url),'utf8');
const start=source.indexOf('function fixedViaDrillConflict('),end=source.indexOf('// 两过孔的层跨度是否相交',start);
assert.ok(start>=0&&end>start);
const conflict=vm.runInNewContext(source.slice(start,end)+'\nfixedViaDrillConflict;',{JLC:core.JLC,Math});
const hole=(overrides={})=>({x:5.75,y:5.25,r:.2,net:'a',span:[0,1],hasVia:true,...overrides});
function fixture(kind){
  const d=core.designDefaults();Object.assign(d,{width:12,height:12,grid:.5,trackW:.2,clearance:.2,viaOuter:.8,viaDrill:.4});
  d.nets=[{id:'a',name:'A'}];
  d.pads=['top','bottom'].map((layer,i)=>({id:'P'+i,netId:'a',x:5.25,y:5.25,w:.4,h:.4,shape:'circle',layer}));
  if(kind==='stitch')d.stitching=[{netId:'a',x:5.75,y:5.25}];
  else d.manual=[{netId:'a',pts:[{x:5.75,y:5.25,l:0},{x:5.75,y:5.25,l:1}]}];
  return d;
}
const allResult=(d,r)=>({...r,nets:[...r.nets,...core.manualRouteEntries(d)]});
const drillWarnings=(d,r)=>core.checkDRC(d,allResult(d,r),{dfm:true}).filter(i=>i.type==='DFM 过孔间距');

test('new automatic vias preserve clearance to same-net stitching and manual drills',()=>{
  for(const kind of ['stitch','manual']) for(const optimize of [false,true]){
    const d=fixture(kind),before=structuredClone(d);
    const r=core.routeBoard(d,{optimize,beautify:false,maxIter:4}).result;
    assert.equal(r.status,'complete',kind);assert.equal(r.stats.connected,r.stats.total);
    assert.equal(r.stats.vias,1,'must not repair the warning by adding vias');
    assert.equal(drillWarnings(d,r).length,0,kind+' must not leave the known 0.1mm drill-edge gap');
    assert.equal(core.checkDRC(d,allResult(d,r),{dfm:false}).filter(i=>i.sev==='error').length,0);
    assert.deepEqual(d,before,'fixed input geometry is not moved');
    const holes=core.manufacturingHoles(d,allResult(d,r));
    for(let i=0;i<holes.length;i++)for(let j=i+1;j<holes.length;j++){
      if(holes[i].span[0]>holes[j].span[1]||holes[j].span[0]>holes[i].span[1])continue;
      const gap=Math.hypot(holes[i].x-holes[j].x,holes[i].y-holes[j].y)-holes[i].r-holes[j].r;
      assert.ok(gap>=core.JLC.viaEdgeMin-1e-9,'physical drill-edge gap '+gap);
    }
  }
});

test('fixed drill gate honors the exact minimum and does not exempt same nets',()=>{
  const holes=[hole({x:0,y:0})];
  assert.equal(conflict(.6,0,.2,'a',0,1,holes),false,'exact 0.2mm edge gap is legal');
  assert.equal(conflict(.6-1e-8,0,.2,'a',0,1,holes),true);
  assert.equal(conflict(.6+1e-8,0,.2,'a',0,1,holes),false);
  assert.equal(conflict(.5,0,.2,'a',0,1,holes),true,'same net still has a 0.1mm hole-edge violation');
});

test('only identical known-net, coordinate, drill and span holes may be reused',()=>{
  const holes=[hole()];
  assert.equal(conflict(5.75,5.25,.2,'a',0,1,holes),false);
  assert.equal(conflict(5.75,5.25,.2,'b',0,1,holes),true,'different net cannot reuse hole');
  assert.equal(conflict(5.75,5.25,.2,null,0,1,[hole({net:null})]),true,'unknown net cannot mask collisions');
  assert.equal(conflict(5.75,5.25,.15,'a',0,1,holes),true,'concentric unequal drill is not an equivalent drill');
  assert.equal(conflict(5.75,5.25,.2,'a',0,3,holes),true,'through via cannot reuse a partial-span drill');
  assert.equal(conflict(5.75+1e-10,5.25,.2,'a',0,1,holes),true,'only exact shared XY is reusable');
});

test('disjoint buried drill spans are free but shared copper layers overlap',()=>{
  const holes=[hole({span:[2,3]})];
  assert.equal(conflict(5.75,5.25,.2,'b',0,1,holes),false,'no common drilled layers');
  assert.equal(conflict(5.75,5.25,.2,'b',1,2,holes),true,'layer 2 is shared');
  assert.equal(conflict(5.75,5.25,.2,'b',0,3,holes),true,'through hole overlaps all spans');
});

test('fixed-hole table retains via drills merged with a THT pad, including fallback drill size',()=>{
  const start=source.indexOf('  const hasFixedVias='),end=source.indexOf('  function viaLegal(',start);
  assert.ok(start>=0&&end>start);
  for(const kind of ['stitch','manual']){
    const design=fixture(kind);
    design.pads.push({id:'PTH',netId:'a',x:5.75,y:5.25,w:.8,h:.8,shape:'circle',layer:'both'});
    const {fixedViaHoles,fixedViaReach}=vm.runInNewContext(source.slice(start,end)+'\n({fixedViaHoles,fixedViaReach});',{
      design,manufacturingHoles:core.manufacturingHoles,manualRouteEntries:core.manualRouteEntries,JLC:core.JLC,Math
    });
    assert.equal(fixedViaHoles.length,1,'a merged pad/via is still an existing fixed drill');
    assert.ok(fixedViaHoles[0].pad);assert.equal(fixedViaHoles[0].r,design.viaDrill/2);
    assert.equal(conflict(5.25,5.25,.2,'a',0,1,fixedViaHoles,fixedViaReach),true);
  }
});

test('x-index neighborhood filtering matches a full fixed-hole scan',()=>{
  let seed=712;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const holes=Array.from({length:150},(_,i)=>hole({x:random()*100,y:random()*30,r:.1+random()*.2,net:i%2?'a':'b',span:i%3?[0,1]:[2,3]}));
  const sorted=holes.slice().sort((a,b)=>a.x-b.x),r=.2;
  const reach=r+Math.max(...holes.map(h=>h.r))+core.JLC.viaEdgeMin;
  for(let i=0;i<1000;i++){
    const x=random()*110-5,y=random()*40-5,span=i%2?[0,1]:[0,3],net=i%3?'a':'b';
    assert.equal(conflict(x,y,r,net,...span,sorted,reach),conflict(x,y,r,net,...span,holes));
  }
});

test('an existing equivalent stitching or manual drill remains reusable',()=>{
  for(const kind of ['stitch','manual']){
    const d=fixture(kind);
    d.pads.forEach(p=>{p.x=5.75;});
    const r=core.routeBoard(d,{optimize:false,beautify:false,maxIter:3}).result;
    assert.equal(r.status,'complete');assert.equal(r.stats.vias,1);
    assert.equal(r.nets[0].vias[0].x,5.75);assert.equal(r.nets[0].vias[0].y,5.25);
    assert.equal(core.manufacturingHoles(d,allResult(d,r)).length,1,'equivalent shared drill is not double manufactured');
    assert.equal(drillWarnings(d,r).length,0);
  }
});
