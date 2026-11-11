import {test} from 'node:test';
import assert from 'node:assert/strict';
import {autoPlace,checkDRC,designDefaults,padGap} from '../src/engine.mjs';

const pad=(id,netId,x,y,extra={})=>({id,netId,x,y,w:1,h:1,shape:'rect',layer:'top',...extra});
const design=pads=>({...designDefaults(),width:30,height:20,nets:[{id:'a',name:'A'},{id:'b',name:'B'}],pads});
const pairIssues=(d,dfm=false)=>checkDRC(d,{nets:[],overuse:[]},{dfm}).filter(x=>['焊盘间距','焊盘重叠','DFM 焊盘间距'].includes(x.type));

test('pad copper clearance is enforced even when factory DFM checks are disabled',()=>{
  const d=design([pad('A','a',10,10),pad('B','b',11.15,10)]);
  assert.equal(pairIssues(d).filter(x=>x.type==='焊盘间距'&&x.sev==='error').length,1);
  d.pads[1].x=11.2;
  assert.equal(pairIssues(d).length,0); // Exactly the requested 0.2 mm clearance.
  d.pads[1].x=11.199;
  assert.equal(pairIssues(d).length,1);
});
test('pad clearance respects pad layers, through pads, and same-net exceptions',()=>{
  const d=design([pad('A','a',10,10),pad('B','b',10.5,10,{layer:'bottom'})]);
  d.layers=4;
  assert.equal(pairIssues(d,true).length,0);
  d.pads[1].layer='both';assert.equal(pairIssues(d).length,1);
  d.pads[1].netId='a';assert.equal(pairIssues(d,true).length,0);
  d.pads[1].netId=null;assert.equal(pairIssues(d).length,1);
});
test('diagonally separated pads use actual shapes rather than box-axis gaps',()=>{
  const d=design([pad('A','a',10,10,{shape:'circle'}),pad('B','b',10.8,10.8,{shape:'circle'})]);
  // Circular copper gap is 0.131 mm, so 0.10 factory rule passes but requested 0.20 fails.
  assert.ok(padGap(...d.pads)>0.1);
  assert.deepEqual(pairIssues(d,true).map(x=>x.type),['焊盘间距']);
  d.clearance=0.1;assert.equal(pairIssues(d,true).length,0);
  d.pads[0].shape=d.pads[1].shape='rect';
  d.pads[1].x=11.08;d.pads[1].y=11.08;
  assert.ok(padGap(...d.pads)>0.1);assert.equal(pairIssues(d,true).length,0);
});
test('overlap is reported once instead of also reporting a clearance error',()=>{
  const d=design([pad('A','a',10,10),pad('B','b',10.5,10)]);
  assert.deepEqual(pairIssues(d).map(x=>x.type),['焊盘重叠']);
});
test('automatic placement retains a better imported starting arrangement',()=>{
  const d=design([pad('R1-1','a',20.25,10.25),pad('R2-1','a',22.25,10.25)]);
  const before=structuredClone(d.pads);
  const info=autoPlace(d,{iterations:0,restarts:2,edgeWeight:0});
  assert.deepEqual(d.pads,before);
  assert.equal(info.before,2);assert.equal(info.after,2);
});

test('anchored pads preserve imported precision through restarts and writeback',()=>{
  for(const iterations of [0,80]){
    const d=design([pad('J1-1','a',10.123456,10.654321,{w:1.123456,h:0.876543}),
      pad('J1-2','a',12.663456,10.654321),pad('R1-1','b',20.25,10.25)]);
    const locked=structuredClone(d.pads.slice(0,2));
    autoPlace(d,{iterations,restarts:3,anchor:['J1']});
    assert.deepEqual(d.pads.slice(0,2),locked);
  }
});

// Independent evaluation of the documented placement objective, without hotspots.
function placementCost(d){
  const group=p=>p.id.includes('-')?p.id.slice(0,p.id.lastIndexOf('-')):p.id;
  let cost=0;
  for(let i=0;i<d.pads.length;i++) for(let j=i+1;j<d.pads.length;j++){
    const a=d.pads[i],b=d.pads[j];
    if(a.netId!=null&&a.netId===b.netId) cost+=Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
    if(group(a)===group(b)) continue;
    const ox=(a.w+b.w)/2-Math.abs(a.x-b.x),oy=(a.h+b.h)/2-Math.abs(a.y-b.y);
    if(ox>0&&oy>0) cost+=1e6*(0.1+Math.min(ox,oy));
    else if(Math.abs(a.x-b.x)<(a.w+b.w)/2+d.clearance&&Math.abs(a.y-b.y)<(a.h+b.h)/2+d.clearance) cost+=200000;
  }
  for(const p of d.pads){
    if(p.x-p.w/2<-.01||p.x+p.w/2>d.width+.01||p.y-p.h/2<-.01||p.y+p.h/2>d.height+.01) cost+=100000;
  }
  return +cost.toFixed(1);
}
test('multi-restart placement reports the cost of the final written pads, including repairs',()=>{
  for(const seed of [1,7,42,123]){
    const d=design(Array.from({length:8},(_,i)=>pad('R'+i+'-1',i%2?'b':'a',10+i%3,8+(i%2),{w:2,h:1})));
    const info=autoPlace(d,{iterations:80,restarts:4,seed,edgeWeight:0});
    assert.equal(info.after,placementCost(d),'seed '+seed);
    const again=structuredClone(d),fixed=autoPlace(again,{iterations:0,restarts:1,warmStart:true,edgeWeight:0});
    assert.equal(fixed.before,placementCost(d));
  }
});
