import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/engine.mjs';

const line=(netId,x,y,dx=0,dy=1,l=0)=>({netId,name:netId,
  paths:[[{x,y,l},{x:x+dx,y:y+dy,l}]],vias:[],connected:0,total:0});

function fixture(){
  const d=core.designDefaults();
  d.trackW=0.2; d.clearance=0.2;
  d.nets=[{id:'a',name:'A',w:0.2},{id:'b',name:'B',w:0.2},{id:'c',name:'C',w:2}];
  // B is too far in X for the narrow A-B pair, but must not terminate the scan:
  // the later, wider C is only 1 mm from A, below their 1.3 mm requirement.
  return {d,r:{nets:[line('a',5,5),line('b',5.5,10),line('c',6,5)],overuse:[]}};
}

test('geometry sweep does not stop at a narrow candidate before a wider violation',()=>{
  const {d,r}=fixture();
  assert.deepEqual(core.auditGeometry(d,r),[{x:5,y:5.5,l:0}]);
  assert.ok(core.checkDRC(d,r,{dfm:false}).some(i=>i.type==='走线间距'));
});

test('mixed-width geometry sweep also covers fixed manual tracks and reversed endpoints',()=>{
  const {d,r}=fixture();
  d.manual=[{netId:'c',pts:r.nets.pop().paths[0].slice().reverse()}];
  r.nets.reverse();
  r.nets[1].paths[0].reverse();
  assert.deepEqual(core.auditGeometry(d,r),[{x:5,y:5.5,l:0}]);
});

// Independent exhaustive oracle: same deterministic output ordering, but no
// spatial cutoff and no engine distance primitive (including segment crossing).
function pointSegment(p,a,b){
  const dx=b.x-a.x,dy=b.y-a.y;
  const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy)));
  return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
}
function distance(a,b,c,d){
  const cross=(p,q,r)=>(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
  const ac=cross(a,b,c),ad=cross(a,b,d),ca=cross(c,d,a),cb=cross(c,d,b);
  if(((ac<0&&ad>0)||(ac>0&&ad<0))&&((ca<0&&cb>0)||(ca>0&&cb<0))) return 0;
  return Math.min(pointSegment(a,c,d),pointSegment(b,c,d),pointSegment(c,a,b),pointSegment(d,a,b));
}
function oracle(d,r){
  const widths=new Map(d.nets.map(n=>[n.id,n.w||d.trackW]));
  const layers=new Map();
  const entries=[...r.nets,...d.manual.map(m=>({netId:m.netId,paths:[m.pts]}))];
  for(const n of entries) for(const path of n.paths) for(let i=1;i<path.length;i++){
    const a=path[i-1],b=path[i];
    if(a.l!==b.l||Math.hypot(a.x-b.x,a.y-b.y)<1e-12) continue;
    if(!layers.has(a.l)) layers.set(a.l,[]);
    layers.get(a.l).push({net:n.netId,a,b,x0:Math.min(a.x,b.x),y0:Math.min(a.y,b.y)});
  }
  const out=[];
  for(const [l,segs] of layers){
    segs.sort((p,q)=>p.x0-q.x0||p.y0-q.y0);
    for(let i=0;i<segs.length;i++) for(let j=i+1;j<segs.length;j++){
      const s=segs[i],t=segs[j];
      if(s.net===t.net) continue;
      const need=(widths.get(s.net)+widths.get(t.net))/2+d.clearance;
      if(distance(s.a,s.b,t.a,t.b)<need-1e-9) out.push({x:(s.a.x+s.b.x)/2,y:(s.a.y+s.b.y)/2,l});
    }
  }
  return out;
}

test('mixed-width sweep matches exhaustive independent geometry on seeded multilayer boards',()=>{
  let seed=117;
  const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let run=0;run<80;run++){
    const d=core.designDefaults(); d.layers=4; d.clearance=0.05+rnd()*0.3;
    d.nets=Array.from({length:8},(_,i)=>({id:'n'+i,name:'N'+i,w:[0.15,0.2,0.4,1,2,4][i%6]}));
    const nets=Array.from({length:36},(_,i)=>line('n'+(i%8),rnd()*12,rnd()*12,
      (rnd()-0.5)*6,(rnd()-0.5)*6,(rnd()*4)|0));
    // Include fixed manual copper and a layer-changing edge (not a planar segment).
    d.manual=[{netId:'n7',pts:nets.pop().paths[0]}];
    nets[0].paths.push([{x:2,y:2,l:0},{x:2,y:2,l:1}]);
    assert.deepEqual(core.auditGeometry(d,{nets}),oracle(d,{nets}),'seeded case '+run);
  }
});
