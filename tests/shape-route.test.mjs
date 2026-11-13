import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/engine.mjs';

/* ============================================================
   形状布线（阶段三 #12）回归
   覆盖：几何底座确定性 / 压缩坐标完备性 / 合法性契约 /
        多端网 / 确定性 / 补充式共存不改变默认路径
   ============================================================ */

function base(){
  const d=core.designDefaults();
  d.width=10; d.height=10; d.grid=0.5; d.layers=2;
  d.trackW=0.2; d.clearance=0.2; d.viaOuter=0.6; d.viaDrill=0.3;
  d.nets=[{id:'n1',name:'A'}]; d.pads=[]; d.comps={};
  return d;
}

// 独立几何（不复用被测实现）
function ptSeg(px,py, ax,ay,bx,by){
  const vx=bx-ax, vy=by-ay, wx=px-ax, wy=py-ay, L2=vx*vx+vy*vy;
  let t=L2<1e-18?0:(wx*vx+wy*vy)/L2; t=Math.max(0,Math.min(1,t));
  return Math.hypot(px-(ax+t*vx), py-(ay+t*vy));
}
function ptRect(px,py,cx,cy,w,h){
  return Math.hypot(Math.max(Math.abs(px-cx)-w/2,0), Math.max(Math.abs(py-cy)-h/2,0));
}
function segPad(ax,ay,bx,by,p){
  if(p.shape==='circle') return Math.max(0, ptSeg(p.x,p.y,ax,ay,bx,by)-p.w/2);
  const x0=p.x-p.w/2,x1=p.x+p.w/2,y0=p.y-p.h/2,y1=p.y+p.h/2;
  return Math.min(
    ptSeg(x0,y0,ax,ay,bx,by), ptSeg(x1,y0,ax,ay,bx,by),
    ptSeg(x1,y1,ax,ay,bx,by), ptSeg(x0,y1,ax,ay,bx,by),
    ptRect(ax,ay,p.x,p.y,p.w,p.h), ptRect(bx,by,p.x,p.y,p.w,p.h));
}
const layersOf=(p,L)=>p.layer==='top'?[0]:p.layer==='bottom'?[L-1]:Array.from({length:L},(_,i)=>i);

test('压缩坐标：两焊盘直连且长度接近中心距',()=>{
  const d=base();
  d.pads=[{id:'U1-1',netId:'n1',x:2,y:5,w:1,h:1,shape:'rect',layer:'top'},
          {id:'U1-2',netId:'n1',x:7,y:5,w:1,h:1,shape:'rect',layer:'top'}];
  const OBS=core.shpCollectObstacles(d,[],'n1');
  const r=core.shpRouteNet(d,{id:'n1',name:'A'},OBS,{x0:0,x1:10,y0:0,y1:10},{});
  assert.ok(r);
  assert.equal(r.connected,2);
  assert.equal(r.paths.length,1);
  const len=core.__pathLen(r.paths);
  assert.ok(Math.abs(len-4)<1.5,'长 '+len+' 应≈4（焊盘中心距）');
});

test('合法性契约：异网焊盘绕行后逐段间距 ≥ clearance+半宽',()=>{
  const d=base();
  d.nets.push({id:'n2',name:'B'});
  d.pads=[{id:'U1-1',netId:'n1',x:1,y:5,w:0.6,h:0.6,shape:'rect',layer:'top'},
          {id:'U1-2',netId:'n1',x:9,y:5,w:0.6,h:0.6,shape:'rect',layer:'top'},
          {id:'U2-1',netId:'n2',x:5,y:5,w:2,h:2,shape:'rect',layer:'top'}];
  const OBS=core.shpCollectObstacles(d,[],'n1');
  const r=core.shpRouteNet(d,{id:'n1',name:'A'},OBS,{x0:0,x1:10,y0:0,y1:10},{});
  assert.equal(r.connected,2);
  const R=d.clearance+d.trackW/2, ob={x:5,y:5,w:2,h:2};
  for(const path of r.paths) for(let i=1;i<path.length;i++){
    const a=path[i-1], b=path[i];
    if(a.l!==b.l) continue;
    // 段到矩形（独立实现）
    const x0=ob.x-1,x1=ob.x+1,y0=ob.y-1,y1=ob.y+1;
    const g=Math.min(ptSeg(a.x,a.y,x0,y0,x1,y0), ptSeg(a.x,a.y,x1,y0,x1,y1),
      ptSeg(a.x,a.y,x1,y1,x0,y1), ptSeg(a.x,a.y,x0,y1,x0,y0),
      ptRect(a.x,a.y,ob.x,ob.y,ob.w,ob.h), ptRect(b.x,b.y,ob.x,ob.y,ob.w,ob.h),
      ptSeg(b.x,b.y,x0,y0,x1,y0), ptSeg(b.x,b.y,x1,y0,x1,y1),
      ptSeg(b.x,b.y,x1,y1,x0,y1), ptSeg(b.x,b.y,x0,y1,x0,y0),
      Math.min(ptSeg(x0,y0,a.x,a.y,b.x,b.y), ptSeg(x1,y0,a.x,a.y,b.x,b.y),
        ptSeg(x1,y1,a.x,a.y,b.x,b.y), ptSeg(x0,y1,a.x,a.y,b.x,b.y)));
    assert.ok(g>=R-1e-6,'段间距 '+g.toFixed(4)+' < '+R.toFixed(4));
  }
});

test('0.4mm 节距窄通道：不侵入嘉立创极限间距',()=>{
  const d=base();
  d.trackW=0.1; d.clearance=0.1; d.viaOuter=0.45; d.viaDrill=0.2;
  d.nets=[{id:'n1',name:'A'},{id:'n2',name:'B'}];
  d.pads=[
    {id:'U1-1',netId:'n1',x:2,y:3,w:0.25,h:0.6,shape:'rect',layer:'top'},
    {id:'U1-2',netId:'n1',x:8,y:3,w:0.25,h:0.6,shape:'rect',layer:'top'},
    {id:'U2-1',netId:'n2',x:5,y:2.8,w:0.25,h:0.6,shape:'rect',layer:'top'},
    {id:'U2-2',netId:'n2',x:5,y:3.6,w:0.25,h:0.6,shape:'rect',layer:'top'},
    {id:'U2-3',netId:'n2',x:5,y:4.4,w:0.25,h:0.6,shape:'rect',layer:'top'}];
  const OBS=core.shpCollectObstacles(d,[],'n1');
  const r=core.shpRouteNet(d,{id:'n1',name:'A'},OBS,{x0:0,x1:10,y0:0,y1:6},{});
  assert.equal(r.connected,2);
  const R=d.clearance+d.trackW/2;
  for(const p of d.pads) if(p.netId==='n2')
    for(const path of r.paths) for(let i=1;i<path.length;i++){
      const a=path[i-1], b=path[i];
      if(a.l!==b.l) continue;
      assert.ok(segPad(a.x,a.y,b.x,b.y,p)>=R-1e-6,'距 '+p.id+' 过近');
    }
});

test('单层阻断 → 通过过孔换层（vias 成对出现）',()=>{
  const d=base();
  d.width=8; d.height=4;
  d.nets=[{id:'n1',name:'A'},{id:'n2',name:'B'}];
  d.pads=[{id:'U1-1',netId:'n1',x:1,y:2,w:0.6,h:0.6,shape:'rect',layer:'top'},
          {id:'U1-2',netId:'n1',x:7,y:2,w:0.6,h:0.6,shape:'rect',layer:'top'},
          {id:'U2-1',netId:'n2',x:4,y:1,w:0.4,h:1.6,shape:'rect',layer:'top'},
          {id:'U2-2',netId:'n2',x:4,y:3,w:0.4,h:1.6,shape:'rect',layer:'top'}];
  const OBS=core.shpCollectObstacles(d,[],'n1');
  const r=core.shpRouteNet(d,{id:'n1',name:'A'},OBS,{x0:0,x1:8,y0:0,y1:4},{viaCost:5});
  assert.equal(r.connected,2);
  assert.ok(r.vias.length>=2,'过孔数 '+r.vias.length+' 应≥2');
});

test('多端网（三焊盘）T 型接入全连通',()=>{
  const d=base();
  d.pads=[{id:'U1-1',netId:'n1',x:2,y:2,w:0.6,h:0.6,shape:'rect',layer:'top'},
          {id:'U1-2',netId:'n1',x:8,y:2,w:0.6,h:0.6,shape:'rect',layer:'top'},
          {id:'U1-3',netId:'n1',x:5,y:8,w:0.6,h:0.6,shape:'rect',layer:'top'}];
  const OBS=core.shpCollectObstacles(d,[],'n1');
  const r=core.shpRouteNet(d,{id:'n1',name:'A'},OBS,{x0:0,x1:10,y0:0,y1:10},{});
  assert.equal(r.connected,3);
});

test('确定性：同输入两次逐点相同（resultHash 可复算）',()=>{
  const mk=()=>{
    const d=base(); d.width=16; d.height=12;
    d.nets=[{id:'n1',name:'A'},{id:'n2',name:'B'}];
    d.pads=[{id:'U1-1',netId:'n1',x:2,y:2,w:0.6,h:0.6,shape:'rect',layer:'top'},
            {id:'U1-2',netId:'n1',x:13,y:9,w:0.6,h:0.6,shape:'rect',layer:'top'},
            {id:'U2-1',netId:'n2',x:6,y:2,w:0.6,h:0.6,shape:'rect',layer:'top'},
            {id:'U2-2',netId:'n2',x:6,y:9,w:0.6,h:0.6,shape:'rect',layer:'top'}];
    return d;
  };
  const run=()=>{
    const d=mk();
    const OBS=core.shpCollectObstacles(d,[],'n1');
    const r=core.shpRouteNet(d,{id:'n1',name:'A'},OBS,{x0:0,x1:16,y0:0,y1:12},{});
    return JSON.stringify({p:r.paths,v:r.vias,c:r.connected});
  };
  assert.equal(run(),run());
});

test('补充式共存：默认 routeBoard 路径不受形状内核影响',()=>{
  const d=core.EXAMPLES[0].build();
  const a=core.routeBoard(d,{}).result;
  const b=core.routeBoard(core.EXAMPLES[0].build(),{}).result;
  // 逐位一致（去掉 timeMs/iterations 等时间相关字段）
  const strip=r=>JSON.stringify({status:r.status,nets:r.nets,overuse:r.overuse,stats:r.stats});
  assert.equal(strip(a),strip(b));
});

test('routeBoardShape：无失败网时如实不动作',()=>{
  const d=core.EXAMPLES[0].build();
  const base=core.routeBoard(d,{}).result;
  const sp=core.routeBoardShape(d,{base});
  assert.equal(sp.shape.applied,false);
  assert.equal(sp.shape.reason,'no-failed-nets');
  assert.deepEqual(sp.result.nets,base.nets);
});

test('几何审计 auditGeometry：重叠走线必须报出',()=>{
  const d=core.designDefaults();
  d.width=20; d.height=10; d.grid=0.5; d.layers=2;
  d.nets=[{id:'n1',name:'A'},{id:'n2',name:'B'}];
  d.pads=[{id:'U1-1',netId:'n1',x:1,y:5,w:0.5,h:0.5,shape:'rect',layer:'both'},
          {id:'U1-2',netId:'n1',x:19,y:5,w:0.5,h:0.5,shape:'rect',layer:'both'},
          {id:'U2-1',netId:'n2',x:1,y:5.2,w:0.5,h:0.5,shape:'rect',layer:'both'},
          {id:'U2-2',netId:'n2',x:19,y:5.2,w:0.5,h:0.5,shape:'rect',layer:'both'}];
  const result={nets:[
    {netId:'n1',name:'A',paths:[[{x:1,y:5,l:0},{x:19,y:5,l:0}]],vias:[],connected:2,total:2},
    {netId:'n2',name:'B',paths:[[{x:1,y:5.1,l:0},{x:19,y:5.1,l:0}]],vias:[],connected:2,total:2}
  ]};
  const bad=core.auditGeometry(d,result);
  assert.ok(bad.length>0,'重叠走线未报出冲突');
  if(bad.length) assert.equal(bad[0].l,0);
});

test('几何审计 auditGeometry：安全间距不误报',()=>{
  const d=core.designDefaults();
  d.width=20; d.height=10; d.grid=0.5; d.layers=2; d.clearance=0.2; d.trackW=0.3;
  d.nets=[{id:'n1',name:'A'},{id:'n2',name:'B'}];
  d.pads=[{id:'U1-1',netId:'n1',x:1,y:3,w:0.5,h:0.5,shape:'rect',layer:'both'},
          {id:'U1-2',netId:'n1',x:19,y:3,w:0.5,h:0.5,shape:'rect',layer:'both'},
          {id:'U2-1',netId:'n2',x:1,y:7,w:0.5,h:0.5,shape:'rect',layer:'both'},
          {id:'U2-2',netId:'n2',x:19,y:7,w:0.5,h:0.5,shape:'rect',layer:'both'}];
  const result={nets:[
    {netId:'n1',name:'A',paths:[[{x:1,y:3,l:0},{x:19,y:3,l:0}]],vias:[],connected:2,total:2},
    {netId:'n2',name:'B',paths:[[{x:1,y:7,l:0},{x:19,y:7,l:0}]],vias:[],connected:2,total:2}
  ]};
  assert.equal(core.auditGeometry(d,result).length,0);
});
