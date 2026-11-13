import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/engine.mjs';
import { readFileSync, existsSync } from 'node:fs';

/* ============================================================
   形状补线的全板几何审计（0.13.10 常驻回归）

   来历：0.13.8 声称的三板 +6/+6/+6 中有 2/3 是假绿——跨轮残留的路径与
   异网焊盘 gap=0 重叠（短路），而 DRC 的走线-焊盘检查按段"首命中"break，
   重叠被掩盖、连通数虚高。当时所有守门都过了：A/B 位级只测默认路径、
   独立几何审计只测随机小场景、全量回归没有真实板的重叠断言。

   本文件就是补上这个缺口：**真实板 × 全板逐对几何审计**。
   审计用本文件内的独立几何原语（不复用被测实现），判据只有一条硬线：
   异网铜之间不得 gap<=0（重叠=短路）。擦边间距不在此断言（由接受准则裁决）。

   覆盖六个消费面：段-段、段-焊盘、过孔-焊盘、过孔-走线、过孔-过孔、
   以及"路径点必须落在合法层范围内"。
   ============================================================ */

// ---------- 独立几何原语（刻意不复用引擎实现）----------
function ptSeg(px, py, ax, ay, bx, by){
  const vx=bx-ax, vy=by-ay, wx=px-ax, wy=py-ay;
  const L2=vx*vx+vy*vy;
  let t = L2<1e-18 ? 0 : (wx*vx+wy*vy)/L2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px-(ax+t*vx), py-(ay+t*vy));
}
function segSeg(ax, ay, bx, by, cx, cy, dx, dy){
  const d1=(bx-ax)*(cy-ay)-(by-ay)*(cx-ax);
  const d2=(bx-ax)*(dy-ay)-(by-ay)*(dx-ax);
  const d3=(dx-cx)*(ay-cy)-(dy-cy)*(ax-cx);
  const d4=(dx-cx)*(by-cy)-(dy-cy)*(bx-cx);
  if(((d1>0&&d2<0)||(d1<0&&d2>0)) && ((d3>0&&d4<0)||(d3<0&&d4>0))) return 0;
  return Math.min(ptSeg(ax,ay,cx,cy,dx,dy), ptSeg(bx,by,cx,cy,dx,dy),
                  ptSeg(cx,cy,ax,ay,bx,by), ptSeg(dx,dy,ax,ay,bx,by));
}
function ptRect(px, py, cx, cy, w, h){
  const dx=Math.max(Math.abs(px-cx)-w/2, 0);
  const dy=Math.max(Math.abs(py-cy)-h/2, 0);
  return Math.hypot(dx, dy);
}
function ptPad(px, py, p){
  return p.shape==='circle'
    ? Math.max(0, Math.hypot(px-p.x, py-p.y)-p.w/2)
    : ptRect(px, py, p.x, p.y, p.w, p.h);
}
function segPad(ax, ay, bx, by, p){
  if(p.shape==='circle') return Math.max(0, ptSeg(p.x, p.y, ax, ay, bx, by)-p.w/2);
  const x0=p.x-p.w/2, x1=p.x+p.w/2, y0=p.y-p.h/2, y1=p.y+p.h/2;
  return Math.min(
    ptRect(ax, ay, p.x, p.y, p.w, p.h), ptRect(bx, by, p.x, p.y, p.w, p.h),
    segSeg(ax, ay, bx, by, x0, y0, x1, y0), segSeg(ax, ay, bx, by, x1, y0, x1, y1),
    segSeg(ax, ay, bx, by, x1, y1, x0, y1), segSeg(ax, ay, bx, by, x0, y1, x0, y0));
}
const padLayerIndex=(p, L)=>p.layer==='top'?0:(p.layer==='bottom'?L-1:null);
const viaSpanOf=(v, L)=>{
  if(Array.isArray(v.layers)&&v.layers.length===2){
    let a=v.layers[0]|0, b=v.layers[1]|0;
    if(a>b){ const t=a; a=b; b=t; }
    return [Math.max(0,Math.min(L-1,a)), Math.max(0,Math.min(L-1,b))];
  }
  return [0, L-1];
};
const spanHit=(a,b)=>a[0]<=b[1] && b[0]<=a[1];

/* 全板审计：返回违规清单（空 = 干净）。
   判据只有 gap<=0（重叠/短路）；间距不足不在本审计范围。 */
function auditBoard(design, result){
  const L=Math.max(1, design.layers|0);
  const vias=[];
  const segs=[];
  const problems=[];

  for(const n of result.nets||[]){
    for(const path of n.paths||[]) for(let k=1;k<path.length;k++){
      const a=path[k-1], b=path[k];
      if(a.l!==b.l) continue;
      if(a.l<0||a.l>=L) problems.push('层越界 '+n.name+' l'+a.l);
      if(Math.abs(a.x-b.x)<1e-12 && Math.abs(a.y-b.y)<1e-12) continue;
      segs.push({net:n.netId, name:n.name, l:a.l, a, b});
    }
    for(const v of n.vias||[]) vias.push({net:n.netId, name:n.name, x:v.x, y:v.y,
      span:viaSpanOf(v, L), outer:v.outer!=null?v.outer:design.viaOuter});
  }

  // 1) 段-段（同层、异网）
  const byLayer=new Map();
  for(const s of segs){ let a=byLayer.get(s.l); if(!a){ a=[]; byLayer.set(s.l,a); } a.push(s); }
  for(const [l,arr] of byLayer){
    arr.sort((p,q)=>Math.min(p.a.x,p.b.x)-Math.min(q.a.x,q.b.x));
    for(let i=0;i<arr.length;i++) for(let j=i+1;j<arr.length;j++){
      const s=arr[i], t=arr[j];
      if(s.net===t.net) continue;
      if(Math.min(t.a.x,t.b.x) > Math.max(s.a.x,s.b.x)) break;   // 左边界已超出
      const g=segSeg(s.a.x,s.a.y,s.b.x,s.b.y,t.a.x,t.a.y,t.b.x,t.b.y);
      if(g<=1e-9) problems.push('段-段重叠 l'+l+' '+s.name+' × '+t.name+
        ' @'+s.a.x.toFixed(3)+','+s.a.y.toFixed(3));
    }
  }

  // 2) 段-焊盘（异网、层匹配）
  for(const s of segs) for(const p of design.pads||[]){
    if(p.netId===s.net) continue;
    const pl=padLayerIndex(p, L);
    const onLayer = pl===null ? true : pl===s.l;
    if(!onLayer) continue;
    const g=segPad(s.a.x,s.a.y,s.b.x,s.b.y,p);
    if(g<=1e-9) problems.push('段-焊盘重叠 '+s.name+' × '+p.id+
      ' @'+s.a.x.toFixed(3)+','+s.a.y.toFixed(3));
  }

  // 3) 过孔-焊盘（异网、跨度与焊盘层相交）
  for(const v of vias) for(const p of design.pads||[]){
    if(p.netId===v.net) continue;
    const pl=padLayerIndex(p, L);
    const onSpan = pl===null ? true : (pl>=v.span[0] && pl<=v.span[1]);
    if(!onSpan) continue;
    const g=ptPad(v.x, v.y, p);
    if(g<=1e-9) problems.push('过孔-焊盘重叠 '+v.name+' × '+p.id+
      ' @'+v.x.toFixed(3)+','+v.y.toFixed(3));
  }

  // 4) 过孔-走线（异网、层相交）
  for(const v of vias) for(const s of segs){
    if(s.net===v.net) continue;
    if(s.l<v.span[0]||s.l>v.span[1]) continue;
    const g=ptSeg(v.x, v.y, s.a.x, s.a.y, s.b.x, s.b.y);
    if(g<=1e-9) problems.push('过孔-走线重叠 '+v.name+' × '+s.name+
      ' @'+v.x.toFixed(3)+','+v.y.toFixed(3));
  }

  // 5) 过孔-过孔（异网、跨度相交）
  for(let i=0;i<vias.length;i++) for(let j=i+1;j<vias.length;j++){
    const a=vias[i], b=vias[j];
    if(a.net===b.net) continue;
    if(!spanHit(a.span,b.span)) continue;
    if(Math.hypot(a.x-b.x, a.y-b.y) <= (a.outer+b.outer)/2 - 1e-9)
      problems.push('过孔-过孔重叠 '+a.name+' × '+b.name+
        ' @'+a.x.toFixed(3)+','+a.y.toFixed(3));
  }

  return problems;
}

// ---------- 真实板回归 ----------
const PROJECTS=['ext-fable-01','ext-fable-02','ext-fable-03'];
const has=name=>existsSync('projects/'+name+'/placed.json');

for(const proj of PROJECTS){
  test('全板几何审计（真实板 '+proj+'）：形状补线后异网铜零重叠',()=>{
    if(!has(proj)) return;   // 仓库无该板时跳过（外部数据可能被清理）
    const d=core.normalizeDesign(JSON.parse(readFileSync('projects/'+proj+'/placed.json','utf8')));
    const base=JSON.parse(readFileSync('projects/'+proj+'/result.json','utf8'));
    const sp=core.routeBoardShape(d,{base});
    // 基线本身可能有存量违规——先量基线，再断言"补线不得新增重叠"
    const baseProblems=auditBoard(d, base);
    const afterProblems=auditBoard(d, sp.result);
    assert.ok(afterProblems.length<=baseProblems.length,
      proj+' 补线新增重叠 '+baseProblems.length+'→'+afterProblems.length+
      '：\n  '+afterProblems.slice(0,5).join('\n  '));
    // 补线接受过网（applied）时，结果必须零重叠（基线已零重叠的前提下）
    if(sp.shape.applied && baseProblems.length===0)
      assert.equal(afterProblems.length, 0,
        proj+' 补线已接受但存在重叠：\n  '+afterProblems.slice(0,5).join('\n  '));
  });
}

// ---------- 合成板：覆盖 HDI span 与多轮协商 ----------
test('全板几何审计（合成 4 层 + 盲埋孔）：零重叠',()=>{
  const d=core.designDefaults();
  d.width=40; d.height=30; d.grid=0.5; d.layers=4;
  d.trackW=0.25; d.clearance=0.2; d.viaOuter=0.6; d.viaDrill=0.3;
  d.nets=[{id:'n1',name:'A'},{id:'n2',name:'B'}];
  d.pads=[{id:'U1-1',netId:'n1',x:2,y:15,w:0.5,h:0.5,shape:'rect',layer:'top'},
          {id:'U1-2',netId:'n1',x:38,y:15,w:0.5,h:0.5,shape:'rect',layer:'top'},
          {id:'U2-1',netId:'n2',x:2,y:25,w:0.5,h:0.5,shape:'rect',layer:'bottom'},
          {id:'U2-2',netId:'n2',x:38,y:25,w:0.5,h:0.5,shape:'rect',layer:'bottom'}];
  const r={status:'complete',nets:[
    {netId:'n1',name:'A',paths:[[{x:2,y:15,l:0},{x:10,y:15,l:0}],
                                [{x:10,y:15,l:1},{x:30,y:15,l:1}],
                                [{x:30,y:15,l:2},{x:38,y:15,l:2}]],
     vias:[{x:10,y:15,layers:[0,1]},{x:30,y:15,layers:[1,2],drill:0.1,outer:0.25}],
     connected:2,total:2},
    {netId:'n2',name:'B',paths:[[{x:2,y:25,l:3},{x:38,y:25,l:3}]],vias:[],connected:2,total:2}],
    overuse:[],stats:{connected:2,total:2,trackTop:8,trackBot:8,vias:2,trackLen:52,
    trackLayers:[8,20,16,8],trackInner:36}};
  assert.deepEqual(auditBoard(d,r),[]);
});

test('全板几何审计：能抓出人为构造的重叠（自检有效性）',()=>{
  const d=core.designDefaults();
  d.width=20; d.height=10; d.grid=0.5; d.layers=2;
  d.nets=[{id:'n1',name:'A'},{id:'n2',name:'B'}];
  d.pads=[{id:'U2-1',netId:'n2',x:10,y:5,w:1,h:1,shape:'rect',layer:'top'}];
  const bad={nets:[{netId:'n1',name:'A',
    paths:[[{x:2,y:5,l:0},{x:18,y:5,l:0}]],vias:[],connected:1,total:1}],overuse:[]};
  const problems=auditBoard(d,bad);
  assert.ok(problems.length>0,'审计必须抓出穿过异网焊盘的走线');
  assert.ok(problems[0].includes('段-焊盘重叠'),'问题类型应为段-焊盘重叠：'+problems[0]);
});

test('全板几何审计：能抓出过孔落在异网焊盘上',()=>{
  const d=core.designDefaults();
  d.width=20; d.height=10; d.grid=0.5; d.layers=2;
  d.nets=[{id:'n1',name:'A'},{id:'n2',name:'B'}];
  d.pads=[{id:'U2-1',netId:'n2',x:10,y:5,w:1,h:1,shape:'rect',layer:'top'}];
  const bad={nets:[{netId:'n1',name:'A',paths:[],vias:[{x:10,y:5}],connected:1,total:1}],
    overuse:[]};
  const problems=auditBoard(d,bad);
  assert.ok(problems.some(p=>p.includes('过孔-焊盘重叠')),
    '审计必须抓出过孔落在异网焊盘：'+JSON.stringify(problems));
});

test('全板几何审计：同网重叠不报（同网铜可自交）',()=>{
  const d=core.designDefaults();
  d.width=20; d.height=10; d.grid=0.5; d.layers=2;
  d.nets=[{id:'n1',name:'A'}];
  d.pads=[];
  const ok={nets:[{netId:'n1',name:'A',
    paths:[[{x:2,y:5,l:0},{x:18,y:5,l:0}],[{x:10,y:1,l:0},{x:10,y:9,l:0}]],
    vias:[],connected:1,total:1}],overuse:[]};
  assert.deepEqual(auditBoard(d,ok),[]);
});
