import * as core from '../src/engine.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

test('distance maps match an independent distance formula, including layers and fractional via costs', () => {
  for (const [GW,GH] of [[1,1],[1,9],[9,1],[13,7]]) for (const L of [1,2,4]) {
    const NC=GW*GH, TS=NC*L, model={GW,GH,NC,L};
    const distances=new Float32Array(TS), queue=new Int32Array(TS);
    for (const diag of [false,true]) for (const viaCost of [1,15,17.3,150,1000]) {
      const goals=new Set([0,TS-1,Math.floor(TS/3)]);
      core.fillDistanceMap(model,goals,viaCost,diag,distances,queue);
      for(let s=0;s<TS;s++) {
        let expected=Infinity;
        for(const g of goals) {
          const dx=Math.abs(s%GW-g%GW), dy=Math.abs(Math.floor((s%NC)/GW)-Math.floor((g%NC)/GW));
          const dl=Math.abs(Math.floor(s/NC)-Math.floor(g/NC));
          expected=Math.min(expected,(diag?Math.max(dx,dy):dx+dy)+dl*Math.max(1,viaCost*0.1));
        }
        assert.ok(Math.abs(distances[s]-expected)<1e-4, `state ${s}: ${distances[s]} vs ${expected}`);
      }
      // A subsequent search must discard all distances from the previous goal set.
      core.fillDistanceMap(model,new Set(),viaCost,diag,distances,queue);
      assert.ok(distances.every(d=>d===1e9));
    }
  }
});

test('via influence matches millimetre distances on rectangular grids and at board edges', () => {
  for(const grid of [0.25,0.5,1,1.5]) {
    const model={GW:23,GH:11,grid}, NC=model.GW*model.GH;
    for(const cell of [0,NC-1,3*model.GW+17]) {
      const owners=new Int16Array(NC), multi=new Uint8Array(NC), radius=1.1;
      core.markViaInfluence(model,cell,radius,1,owners,multi);
      for(let s=0;s<NC;s++) {
        const distance=Math.hypot((s%model.GW-cell%model.GW)*grid,
          (Math.floor(s/model.GW)-Math.floor(cell/model.GW))*grid);
        assert.equal(owners[s],distance<radius?1:0, `grid ${grid}, via ${cell}, state ${s}`);
      }
      core.markViaInfluence(model,cell,radius,1,owners,multi);
      assert.ok(multi.every(v=>v===0), 'same-net vias may overlap');
      core.markViaInfluence(model,cell,radius,2,owners,multi);
      for(let s=0;s<NC;s++) assert.equal(multi[s],owners[s]===1?1:0);
    }
  }
});

const design=()=>{
  const d=core.designDefaults();
  d.nets=[{id:'a',name:'A'},{id:'b',name:'B'}];
  return d;
};
const track=(netId,points,extra={})=>({netId,name:netId,paths:[points.map(([x,y,l=0])=>({x,y,l}))],
  vias:[],connected:2,total:2,...extra});
const drc=(d,nets)=>core.checkDRC(d,{nets,overuse:[]},{dfm:false});
const spacing=issues=>issues.filter(i=>i.type==='走线间距');

test('DRC detects orthogonal crossings with an empty occupancy conflict list', () => {
  assert.ok(spacing(drc(design(),[
    track('a',[[2,10],[50,10]]),track('b',[[13,2],[13,30]])
  ])).length);
});

test('DRC detects diagonal-to-axis crossings', () => {
  assert.ok(spacing(drc(design(),[
    track('a',[[2,2],[30,30]]),track('b',[[13,2],[13,30]])
  ])).length);
});

test('DRC detects long manual crossings between the old sample points', () => {
  assert.ok(spacing(drc(design(),[
    track('a',[[2,10],[50,10]],{manual:true}),track('b',[[13,9],[13,11]])
  ])).length);
});

test('DRC respects per-net widths and the exact clearance boundary', () => {
  const d=design(); d.nets[0].w=1; d.nets[1].w=0.2;
  const a=track('a',[[5,10],[25,10]]);
  assert.ok(spacing(drc(d,[a,track('b',[[5,10.7],[25,10.7]])])).length);
  assert.equal(spacing(drc(d,[a,track('b',[[5,10.8],[25,10.8]])])).length,0);
});

test('DRC ignores same-net, different-layer, and zero-length segments', () => {
  const a=track('a',[[2,10],[50,10]]);
  for(const b of [track('a',[[13,2],[13,30]]),track('b',[[13,2,1],[13,30,1]]),
    track('b',[[13,10],[13,10]])]) assert.equal(spacing(drc(design(),[a,b])).length,0);
});

test('DRC via-to-track clearance includes the actual track half-width', () => {
  const d=design(); d.nets[1].w=1;
  const v=track('a',[],{vias:[{x:15,y:10}]});
  const hit=y=>drc(d,[v,track('b',[[5,y],[25,y]])]).some(i=>i.type==='过孔-走线间距');
  assert.equal(hit(10.9),true);
  assert.equal(hit(11.1),false);
});

test('DRC sweep agrees with a brute-force oracle across mixed widths and layers', () => {
  let seed=42;
  const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
  for(let run=0;run<100;run++) {
    const d=design(); d.nets[0].w=0.1+random(); d.nets[1].w=0.1+random();
    const pts=Array.from({length:4},()=>[random()*50,random()*30,random()<0.5?0:1]);
    pts[1][2]=pts[0][2]; pts[3][2]=pts[2][2];
    // Independent line intersection / endpoint projection distance oracle.
    const [a,b,c,e]=pts;
    const pointDist=(p,u,v)=>{
      const dx=v[0]-u[0],dy=v[1]-u[1];
      const t=Math.max(0,Math.min(1,((p[0]-u[0])*dx+(p[1]-u[1])*dy)/(dx*dx+dy*dy)));
      return Math.hypot(p[0]-u[0]-t*dx,p[1]-u[1]-t*dy);
    };
    const cross=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
    const intersects=cross(a,b,c)*cross(a,b,e)<=0 && cross(c,e,a)*cross(c,e,b)<=0;
    const dist=intersects?0:Math.min(pointDist(a,c,e),pointDist(b,c,e),pointDist(c,a,b),pointDist(e,a,b));
    const expected=a[2]===c[2] && dist<(d.nets[0].w+d.nets[1].w)/2+d.clearance-1e-9;
    assert.equal(spacing(drc(d,[track('a',[a,b]),track('b',[c,e])])).length>0,expected);
  }
});
