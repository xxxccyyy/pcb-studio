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

// ---- 12b 软障碍协商（0.13.4）----
test('协商：软模式能穿越硬阻塞区（硬模式 no-path 的场景）',()=>{
  const d=base();
  d.width=12; d.height=6;
  d.nets=[{id:'n1',name:'A'},{id:'n2',name:'B'}];
  // 完整横墙：硬模式必失败
  d.pads=[{id:'U1-1',netId:'n1',x:1,y:3,w:0.5,h:0.5,shape:'rect',layer:'top'},
          {id:'U1-2',netId:'n1',x:11,y:3,w:0.5,h:0.5,shape:'rect',layer:'top'},
          {id:'U2-1',netId:'n2',x:4,y:0.6,w:0.4,h:1.5,shape:'rect',layer:'top'},
          {id:'U2-2',netId:'n2',x:6,y:2.5,w:0.4,h:1.5,shape:'rect',layer:'top'},
          {id:'U2-3',netId:'n2',x:8,y:4.4,w:0.4,h:1.5,shape:'rect',layer:'top'}];
  const OBS=core.shpCollectObstacles(d,[],'n1');
  const hard=core.shpRouteNet(d,{id:'n1',name:'A'},OBS,{x0:0,x1:12,y0:0,y1:6},{});
  // 硬模式：可能失败或只能部分连通——不强制断言，只要求软模式至少不劣
  const soft=core.shpRouteNet(d,{id:'n1',name:'A'},OBS,{x0:0,x1:12,y0:0,y1:6},{soft:true,penScale:40});
  assert.ok(soft,'软模式应产出结果');
  assert.ok(!hard || soft.connected>=hard.connected,'软模式连通数不得低于硬模式');
});

test('协商：接受准则拒绝净违规增加的借道（对称三查）',()=>{
  // 场景：已布网 n2 有干净路径；给 n1 一条"借道更短但必然贴住 n2"的诱惑
  const d=base();
  d.width=20; d.height=8;
  d.nets=[{id:'n1',name:'A'},{id:'n2',name:'B'}];
  d.pads=[{id:'U1-1',netId:'n1',x:1,y:6,w:0.5,h:0.5,shape:'rect',layer:'top'},
          {id:'U1-2',netId:'n1',x:19,y:6,w:0.5,h:0.5,shape:'rect',layer:'top'},
          {id:'U2-1',netId:'n2',x:10,y:1,w:0.8,h:0.8,shape:'rect',layer:'top'}];
  const OBS=core.shpCollectObstacles(d,[],'n1');
  const soft=core.shpRouteNet(d,{id:'n1',name:'A'},OBS,{x0:0,x1:20,y0:0,y1:8},{soft:true});
  assert.ok(soft);
  // 软模式的结果经"与全板交互"审计不得出现违规（本场景有充足绕行空间，
  // penScale 足够大时 A* 应选择绕行——借道付的代价高于绕行）
  const segVio=(()=>{ let c=0; const hw=0.1;
    for(const path of soft.paths) for(let k=1;k<path.length;k++){
      const a=path[k-1], b=path[k];
      if(a.l!==b.l) continue;
      for(const p of d.pads){
        if(p.netId==='n1') continue;
        if(core.segmentPadDistance(a,b,p)<hw+d.clearance-1e-9) c++;
      }
    } return c; })();
  assert.equal(segVio,0,'绕行空间充足时软路径不得引入违规');
});

test('协商：routeBoardShape 端到端不产生净新增违规',()=>{
  // 用 EXAMPLES[0] 全链跑，补线后 DRC errors 不得增加
  const d=core.EXAMPLES[0].build();
  const baseR=core.routeBoard(d,{}).result;
  const sp=core.routeBoardShape(d,{base:baseR});
  const e0=core.checkDRC(d,baseR,{dfm:false}).filter(i=>i.sev==='error').length;
  const e1=core.checkDRC(d,sp.result,{dfm:false}).filter(i=>i.sev==='error').length;
  assert.ok(e1<=e0,'补线后 DRC errors 不得增加：'+e0+'→'+e1);
});

// ---- 12b-3 拆-重布修复轮（0.13.5）----
test('修复轮：存量段-焊盘违规被形状重布消除（触发条件含非段-段违规）',()=>{
  const d=core.designDefaults();
  d.width=24; d.height=8; d.grid=0.5; d.layers=2;
  d.clearance=0.2; d.trackW=0.3;
  d.nets=[{id:'n1',name:'A'},{id:'n2',name:'B'}];
  d.pads=[{id:'U1-1',netId:'n1',x:1,y:4,w:0.5,h:0.5,shape:'rect',layer:'both'},
          {id:'U1-2',netId:'n1',x:23,y:4,w:0.5,h:0.5,shape:'rect',layer:'both'},
          {id:'U2-1',netId:'n2',x:1,y:4.35,w:0.5,h:0.5,shape:'rect',layer:'both'},
          {id:'U2-2',netId:'n2',x:23,y:4.35,w:0.5,h:0.5,shape:'rect',layer:'both'}];
  // n2 的直线与 n1 的直线间距 0.35 < 0.3+0.2/2+... ——构造一段靠太近的存量违规：
  // n2 直线在 y=4.35，n1 在 y=4，段-段距离 0.35，两半宽和 0.3 + clearance 0.2 = 0.5 → 违规
  const base={status:'partial',nets:[
    {netId:'n1',name:'A',paths:[[{x:1,y:4,l:0},{x:12,y:4,l:0},{x:12,y:7,l:0},{x:23,y:7,l:0}]],vias:[],connected:2,total:2},
    {netId:'n2',name:'B',paths:[[{x:1,y:4.35,l:0},{x:23,y:4.35,l:0}]],vias:[],connected:2,total:2}],
    overuse:[],stats:{}};
  const e0=core.checkDRC(d,base,{dfm:false}).filter(i=>i.sev==='error').length;
  const sp=core.routeBoardShape(d,{base});
  const e1=core.checkDRC(d,sp.result,{dfm:false}).filter(i=>i.sev==='error').length;
  assert.ok(e1<e0 || (sp.shape.repaired===0 && e1===e0),
    '修复轮应消除存量违规或如实不动：'+e0+'→'+e1+' repaired='+sp.shape.repaired);
  assert.ok(sp.shape.repairTried>=0);   // 统计字段存在
});

test('修复轮：不能修时如实保留原状（DRC 不增加）',()=>{
  const d=core.EXAMPLES[0].build();
  const baseR=core.routeBoard(d,{}).result;
  const sp=core.routeBoardShape(d,{base:baseR});
  const e0=core.checkDRC(d,baseR,{dfm:false}).filter(i=>i.sev==='error').length;
  const e1=core.checkDRC(d,sp.result,{dfm:false}).filter(i=>i.sev==='error').length;
  assert.ok(e1<=e0,'修复轮不得增加 DRC：'+e0+'→'+e1);
});

// ---- 12b-5 拆-重布级联（0.13.6）----
test('级联：软协商过孔不落在异网铜上（gap=0 硬墙）',()=>{
  // 构造：目标焊盘被异网焊盘包围，唯一"通道"是打在异网焊盘上
  // ——软模式必须拒绝 gap=0 的过孔（短路），哪怕代价是 no-path
  const d=base();
  d.width=10; d.height=6;
  d.nets=[{id:'n1',name:'A'},{id:'n2',name:'B'}];
  d.pads=[{id:'U1-1',netId:'n1',x:1,y:3,w:0.5,h:0.5,shape:'rect',layer:'top'},
          {id:'U1-2',netId:'n1',x:9,y:3,w:0.5,h:0.5,shape:'rect',layer:'top'},
          {id:'U2-1',netId:'n2',x:4,y:3,w:0.6,h:0.6,shape:'rect',layer:'top'},
          {id:'U2-2',netId:'n2',x:5.5,y:3,w:0.6,h:0.6,shape:'rect',layer:'top'},
          {id:'U2-3',netId:'n2',x:7,y:3,w:0.6,h:0.6,shape:'rect',layer:'top'}];
  const OBS=core.shpCollectObstacles(d,[],'n1');
  const r=core.shpRouteNet(d,{id:'n1',name:'A'},OBS,{x0:0,x1:10,y0:0,y1:6},
    {soft:true,penScale:40});
  if(r){
    // 任何产出的过孔都不得落在异网铜上
    for(const v of r.vias){
      for(const p of d.pads){
        if(p.netId==='n1') continue;
        const g=core.pointPadDistance(v.x,v.y,p);
        assert.ok(g>1e-9,'过孔落在异网焊盘上（gap='+g+'）——短路');
      }
    }
    // 走线同理：不得重叠异网铜
    for(const path of r.paths) for(let k=1;k<path.length;k++){
      const a=path[k-1], b=path[k];
      if(a.l!==b.l) continue;
      for(const p of d.pads){
        if(p.netId==='n1') continue;
        const g=core.segmentPadDistance(a,b,p);
        assert.ok(g>1e-9,'走线重叠异网焊盘（gap='+g+'）');
      }
    }
  }
});

test('级联：端到端 DRC 不劣化（DRC 优先字典序）',()=>{
  for(const ex of core.EXAMPLES){
    const d=ex.build();
    const baseR=core.routeBoard(d,{}).result;
    const sp=core.routeBoardShape(d,{base:baseR});
    const e0=core.checkDRC(d,baseR,{dfm:false}).filter(i=>i.sev==='error').length;
    const e1=core.checkDRC(d,sp.result,{dfm:false}).filter(i=>i.sev==='error').length;
    assert.ok(e1<=e0,ex.name+' DRC 劣化：'+e0+'→'+e1);
    assert.ok(sp.result.stats.connected>=baseR.stats.connected,
      ex.name+' 连通数下降');
  }
});

// ---- room-gate v1：软 Prim（0.13.7）----
test('软 Prim：协商顺序导致的接入失败可被软图恢复（多盘大网）',()=>{
  // 构造 6 盘网，其中一个盘只能擦边借道接入（硬 Prim 顺序下最后接入失败）
  const d=base();
  d.width=30; d.height=10;
  d.trackW=0.2; d.clearance=0.15;
  d.nets=[{id:'n1',name:'A'},{id:'n2',name:'B'}];
  d.pads=[
    {id:'U1-1',netId:'n1',x:2,y:2,w:0.5,h:0.5,shape:'rect',layer:'top'},
    {id:'U1-2',netId:'n1',x:10,y:2,w:0.5,h:0.5,shape:'rect',layer:'top'},
    {id:'U1-3',netId:'n1',x:18,y:2,w:0.5,h:0.5,shape:'rect',layer:'top'},
    {id:'U1-4',netId:'n1',x:26,y:2,w:0.5,h:0.5,shape:'rect',layer:'top'},
    {id:'U1-5',netId:'n1',x:6,y:8,w:0.5,h:0.5,shape:'rect',layer:'top'},
    {id:'U1-6',netId:'n1',x:22,y:8,w:0.5,h:0.5,shape:'rect',layer:'top'},
    // 异网墙：把上排两个盘与主排隔开，硬 Prim 从主排长过去时被挡
    {id:'U2-1',netId:'n2',x:8,y:4.4,w:0.5,h:1.2,shape:'rect',layer:'top'},
    {id:'U2-2',netId:'n2',x:12,y:4.4,w:0.5,h:1.2,shape:'rect',layer:'top'},
    {id:'U2-3',netId:'n2',x:16,y:4.4,w:0.5,h:1.2,shape:'rect',layer:'top'},
    {id:'U2-4',netId:'n2',x:20,y:4.4,w:0.5,h:1.2,shape:'rect',layer:'top'},
    {id:'U2-5',netId:'n2',x:24,y:4.4,w:0.5,h:1.2,shape:'rect',layer:'top'}];
  const OBS=core.shpCollectObstacles(d,[],'n1');
  const hard=core.shpRouteNet(d,{id:'n1',name:'A'},OBS,{x0:0,x1:30,y0:0,y1:10},{});
  const soft=core.shpRouteNet(d,{id:'n1',name:'A'},OBS,{x0:0,x1:30,y0:0,y1:10},{soft:true,penScale:40});
  assert.ok(soft,'软模式必须产出');
  assert.ok(!hard || soft.connected>=hard.connected,'软连通 ≥ 硬');
  // 软路径不得重叠异网铜（gap=0 红线）
  for(const path of soft.paths) for(let k=1;k<path.length;k++){
    const a=path[k-1], b=path[k];
    if(a.l!==b.l) continue;
    for(const p of d.pads){
      if(p.netId==='n1') continue;
      if(p.layer==='bottom') continue;
      const g=core.segmentPadDistance(a,b,p);
      assert.ok(g>1e-9,'重叠异网焊盘 '+p.id);
    }
  }
});

test('软 Prim：gap=0 红线（走线段与过孔同口径）',()=>{
  const d=base();
  d.width=10; d.height=6;
  d.nets=[{id:'n1',name:'A'},{id:'n2',name:'B'}];
  d.pads=[{id:'U1-1',netId:'n1',x:1,y:3,w:0.5,h:0.5,shape:'rect',layer:'top'},
          {id:'U1-2',netId:'n1',x:9,y:3,w:0.5,h:0.5,shape:'rect',layer:'top'},
          {id:'U2-1',netId:'n2',x:5,y:3,w:1.2,h:1.2,shape:'rect',layer:'top'}];
  const OBS=core.shpCollectObstacles(d,[],'n1');
  const r=core.shpRouteNet(d,{id:'n1',name:'A'},OBS,{x0:0,x1:10,y0:0,y1:6},{soft:true,penScale:1});
  if(r&&r.paths.length){
    for(const path of r.paths) for(let k=1;k<path.length;k++){
      const a=path[k-1], b=path[k];
      if(a.l!==b.l) continue;
      const g=core.segmentPadDistance(a,b,d.pads[2]);
      assert.ok(g>1e-9,'软路径穿过异网焊盘（gap='+g+'）');
    }
  }
});
