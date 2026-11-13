import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/engine.mjs';

/* ============================================================
   HDI 盲埋孔（阶段三 #15）回归
   口径：
   · 无 span 的过孔 = 通孔（贯穿全部层）——向后兼容的唯一约定
   · span 不相交的孔物理上不共存于同一层 ⇒ 不比较间距/孔边距
   · span 相交（含相同）必须满足间距与孔边距（同网也不豁免孔边距）
   · 合并去重键含 span：同 XY 同直径的埋孔与通孔是两块不同的物理钻
   ============================================================ */

function board4(){
  const d=core.designDefaults();
  d.width=40; d.height=30; d.grid=0.5; d.layers=4;
  d.trackW=0.25; d.clearance=0.2; d.viaOuter=0.6; d.viaDrill=0.3;
  d.nets=[{id:'n1',name:'A'},{id:'n2',name:'B'}];
  d.pads=[];
  return d;
}

test('viaSpan：无 span = 通孔；给定 span 归一化且端点有序',()=>{
  assert.deepEqual(core.viaSpan({x:0,y:0},4),[0,3]);
  assert.deepEqual(core.viaSpan({x:0,y:0,layers:[2,3]},4),[2,3]);
  assert.deepEqual(core.viaSpan({x:0,y:0,layers:[3,2]},4),[2,3],'端点反序应被归一化');
  assert.deepEqual(core.viaSpan({x:0,y:0,layers:[0,0]},4),[0,0],'同层（理论上非法）取值不崩');
  assert.equal(core.viaThrough({x:0,y:0},4),true);
  assert.equal(core.viaThrough({x:0,y:0,layers:[1,2]},4),false);
});

test('viaOnLayer / viaSpanOverlap：层交集判定',()=>{
  const v={x:0,y:0,layers:[1,2]};
  assert.equal(core.viaOnLayer(v,0,4),false);
  assert.equal(core.viaOnLayer(v,1,4),true);
  assert.equal(core.viaOnLayer(v,2,4),true);
  assert.equal(core.viaOnLayer(v,3,4),false);
  assert.equal(core.viaSpanOverlap({layers:[0,1]},{layers:[2,3]},4),false);
  assert.equal(core.viaSpanOverlap({layers:[0,2]},{layers:[2,3]},4),true);
  assert.equal(core.viaSpanOverlap({},{layers:[1,2]},4),true,'无 span=通孔，与任何 span 相交');
});

test('normalizeResult：畸形 span 干净报错',()=>{
  const d=board4();
  const bad=[
    {layers:[0]}, {layers:[0,1,2]}, {layers:[-1,2]}, {layers:[0,4]},
    {layers:[2,1]}, {layers:[0.5,2]}, {drill:0}, {outer:-1}, {drill:0.5,outer:0.3}
  ];
  for(const v of bad){
    assert.throws(()=>core.normalizeResult({nets:[{netId:'n1',name:'A',paths:[],connected:0,total:0,
      vias:[{x:1,y:1,...v}]}]},d),/Invalid via|Via drill/,JSON.stringify(v)+' 应报错');
  }
});

test('合法 span 通过 normalizeResult',()=>{
  const d=board4();
  const r=core.normalizeResult({nets:[{netId:'n1',name:'A',paths:[],connected:1,total:1,
    vias:[{x:5,y:5,layers:[1,2]},{x:8,y:8},{x:9,y:9,layers:[0,3],drill:0.2,outer:0.5}]}]},d);
  assert.equal(r.nets[0].vias.length,3);
});

test('DRC：span 不相交的两孔同 XY 不下孔边距结论',()=>{
  const d=board4();
  // 两条网络各一颗埋孔，落在同一坐标但跨度不相交（1-2 与 3-3）
  const result={status:'partial',nets:[
    {netId:'n1',name:'A',paths:[],vias:[{x:10,y:10,layers:[1,2]}],connected:1,total:1},
    {netId:'n2',name:'B',paths:[],vias:[{x:10,y:10,layers:[3,3]}],connected:1,total:1}
  ],overuse:[]};
  const errs=core.checkDRC(d,result,{dfm:false}).filter(i=>i.sev==='error');
  const hole=errs.filter(i=>/孔边距|过孔间距|过孔-焊盘/.test(i.type));
  assert.equal(hole.length,0,'span 不相交不应报孔距/间距：'+JSON.stringify(hole));
});

test('DRC：span 相交的两孔同 XY 必须报孔边距（同网也不豁免）',()=>{
  const d=board4();
  // 一颗埋孔 + 一颗同网通孔：跨度相交（[1,2] 与 [0,3]）→ 孔边距必须检查。
  // via-only 对的严重度由专门的 DFM 检查给出（warn），故此处不过滤 sev。
  const result={status:'complete',nets:[
    {netId:'n1',name:'A',paths:[],vias:[{x:10,y:10,layers:[1,2]},{x:10,y:10}],connected:1,total:1}
  ],overuse:[],stats:{connected:1,total:1,trackTop:0,trackBot:0,vias:2,trackLen:0,trackLayers:[0,0,0,0],trackInner:0}};
  const issues=core.checkDRC(d,result);   // via-only 孔距属 DFM 检查（warn 级）
  // via-only 对的报告类型是「DFM 过孔间距」（warn）——与焊盘参与的「孔边距」（error）分开，
  // 这是既有口径（测试制造规则里 locked 的那条），此处沿用。
  assert.ok(issues.some(i=>/孔边距/.test(i.msg)||/过孔间距/.test(i.type)),
    'span 相交同 XY 应报孔距：'+JSON.stringify(issues.map(i=>i.type)));
});

test('DRC：埋孔不与跨度外的焊盘比间距',()=>{
  const d=board4();
  // 焊盘在 top 层，埋孔只在内层 1-2 ⇒ 不同层，无间距约束
  d.pads=[{id:'U1-1',netId:'n2',x:10,y:10,w:0.5,h:0.5,shape:'rect',layer:'top'}];
  const result={status:'partial',nets:[
    {netId:'n1',name:'A',paths:[],vias:[{x:10,y:10,layers:[1,2]}],connected:1,total:1},
    {netId:'n2',name:'B',paths:[],vias:[],connected:1,total:1}
  ],overuse:[]};
  const errs=core.checkDRC(d,result,{dfm:false}).filter(i=>i.sev==='error');
  assert.equal(errs.filter(i=>i.type==='过孔-焊盘间距').length,0,
    '埋孔与跨度外焊盘不应报间距：'+JSON.stringify(errs.filter(i=>i.type==='过孔-焊盘间距')));
});

test('DRC：埋孔与跨度内焊盘仍比间距',()=>{
  const d=board4();
  d.pads=[{id:'U1-1',netId:'n2',x:10,y:10,w:0.5,h:0.5,shape:'rect',layer:'bottom'}];
  const result={status:'partial',nets:[
    {netId:'n1',name:'A',paths:[],vias:[{x:10,y:10,layers:[2,3]}],connected:1,total:1},
    {netId:'n2',name:'B',paths:[],vias:[],connected:1,total:1}
  ],overuse:[]};
  const errs=core.checkDRC(d,result,{dfm:false}).filter(i=>i.sev==='error');
  assert.ok(errs.some(i=>i.type==='过孔-焊盘间距'),'跨度内焊盘应报间距');
});

test('Gerber：埋孔只在其跨度内的铜层闪现',()=>{
  const d=board4();
  const result={status:'complete',nets:[
    {netId:'n1',name:'A',paths:[],vias:[{x:10,y:10,layers:[1,2]}],connected:1,total:1}
  ],overuse:[],stats:{connected:1,total:1,trackTop:0,trackBot:0,vias:1,trackLen:0,trackLayers:[0,0,0,0],trackInner:0}};
  const g=core.buildGerber(d,result,null,null);
  const flash=(txt)=> (txt.match(/D03\*/g)||[]).length;
  // 顶部/底部铜层不应有该埋孔的 flash；内层 1/2 应有
  assert.equal(flash(g.top),0,'顶层不应出现埋孔');
  assert.equal(flash(g.bottom),0,'底层不应出现埋孔');
  assert.equal(flash(g.inner[0]),1,'内层1 应有埋孔');
  assert.equal(flash(g.inner[1]),1,'内层2 应有埋孔');
});

test('Gerber：通孔在所有铜层闪现（向后兼容）',()=>{
  const d=board4();
  const result={status:'complete',nets:[
    {netId:'n1',name:'A',paths:[],vias:[{x:10,y:10}],connected:1,total:1}
  ],overuse:[],stats:{connected:1,total:1,trackTop:0,trackBot:0,vias:1,trackLen:0,trackLayers:[0,0,0,0],trackInner:0}};
  const g=core.buildGerber(d,result,null,null);
  const flash=txt=>(txt.match(/D03\*/g)||[]).length;
  assert.equal(flash(g.top),1);
  assert.equal(flash(g.bottom),1);
  assert.equal(flash(g.inner[0]),1);
  assert.equal(flash(g.inner[1]),1);
});

test('Excellon：同 XY 同直径的埋孔与通孔是两个独立钻孔',()=>{
  const d=board4();
  const result={status:'complete',nets:[
    {netId:'n1',name:'A',paths:[],vias:[{x:10,y:10},{x:10,y:10,layers:[1,2]}],connected:1,total:1}
  ],overuse:[],stats:{connected:1,total:1,trackTop:0,trackBot:0,vias:2,trackLen:0,trackLayers:[0,0,0,0],trackInner:0}};
  const g=core.buildGerber(d,result,null,null);
  const hits=(g.drill.match(/X10\.000Y10\.000/g)||[]).length;
  assert.equal(hits,2,'埋孔与通孔不应被去重合并（实得 '+hits+'）');
});

test('Excellon：同 span 同 XY 的重复过孔仍去重',()=>{
  const d=board4();
  const result={status:'complete',nets:[
    {netId:'n1',name:'A',paths:[],vias:[{x:10,y:10,layers:[1,2]},{x:10,y:10,layers:[1,2]}],connected:1,total:1}
  ],overuse:[],stats:{connected:1,total:1,trackTop:0,trackBot:0,vias:2,trackLen:0,trackLayers:[0,0,0,0],trackInner:0}};
  const g=core.buildGerber(d,result,null,null);
  assert.equal((g.drill.match(/X10\.000Y10\.000/g)||[]).length,1,'同 span 共位孔应合并');
});

// ---- 微孔（激光孔）DFM ----
const microResult=(vias)=>({status:'complete',nets:[
  {netId:'n1',name:'A',paths:[],vias,connected:1,total:1}],overuse:[],
  stats:{connected:1,total:1,trackTop:0,trackBot:0,vias:vias.length,trackLen:0,
    trackLayers:[0,0,0,0],trackInner:0}});

test('HDI 微孔：合法激光孔（0.1 钻/0.25 盘/相邻层）无 HDI 报错',()=>{
  const d=board4();
  const issues=core.checkDRC(d,microResult([{x:10,y:10,layers:[0,1],drill:0.1,outer:0.25}]));
  assert.equal(issues.filter(i=>/HDI/.test(i.type)).length,0);
});

test('HDI 微孔：跨多层是伪 HDI（激光孔只能跨相邻层）',()=>{
  const d=board4();
  const issues=core.checkDRC(d,microResult([{x:10,y:10,layers:[0,3],drill:0.1,outer:0.25}]));
  assert.ok(issues.some(i=>i.type==='HDI 激光孔跨度'&&i.sev==='error'));
});

test('HDI 微孔：环宽不足报错',()=>{
  const d=board4();
  const issues=core.checkDRC(d,microResult([{x:10,y:10,layers:[0,1],drill:0.1,outer:0.15}]));
  assert.ok(issues.some(i=>i.type==='HDI 激光孔环宽'&&i.sev==='error'));
});

test('HDI 微孔：机械孔（≥0.15）不按激光孔口径检查',()=>{
  const d=board4();
  const issues=core.checkDRC(d,microResult([{x:10,y:10,layers:[0,1],drill:0.3,outer:0.6}]));
  assert.equal(issues.filter(i=>/HDI 激光孔/.test(i.type)).length,0);
});

test('HDI 微孔：钻孔小于工艺口径给 warn',()=>{
  const d=board4();
  const issues=core.checkDRC(d,microResult([{x:10,y:10,layers:[0,1],drill:0.08,outer:0.25}]));
  assert.ok(issues.some(i=>i.type==='HDI 激光孔孔径'&&i.sev==='warn'));
});

// ---- 覆铜 span 语义（0.13.3 深度检查补）----
function pourBoard(){
  const d=core.designDefaults();
  d.width=40; d.height=30; d.grid=0.5; d.layers=4;
  d.trackW=0.25; d.clearance=0.2; d.viaOuter=0.6; d.viaDrill=0.3;
  d.nets=[{id:'n1',name:'A'},{id:'n2',name:'B'}];
  d.pads=[{id:'U1-1',netId:'n1',x:2,y:15,w:0.5,h:0.5,shape:'rect',layer:'top'},
          {id:'U1-2',netId:'n1',x:38,y:15,w:0.5,h:0.5,shape:'rect',layer:'top'},
          {id:'U2-1',netId:'n2',x:2,y:25,w:0.5,h:0.5,shape:'rect',layer:'bottom'},
          {id:'U2-2',netId:'n2',x:38,y:25,w:0.5,h:0.5,shape:'rect',layer:'bottom'}];
  return d;
}
function pourResult(via){
  return {status:'complete',nets:[
    {netId:'n1',name:'A',paths:[[{x:2,y:15,l:1},{x:38,y:15,l:1}]],vias:via?[via]:[],connected:2,total:2},
    {netId:'n2',name:'B',paths:[[{x:2,y:25,l:3},{x:38,y:25,l:3}]],vias:[],connected:2,total:2}],overuse:[],
    stats:{connected:2,total:2,trackTop:0,trackBot:0,vias:via?1:0,trackLen:72,trackLayers:[0,36,0,36],trackInner:36}};
}

test('pour：本网埋孔在其 span 层参与种子（连接铜），span 外层无铜',()=>{
  const d=pourBoard();
  const r=pourResult({x:20,y:15,layers:[1,2]});
  assert.equal(core.pourContains(core.computePour(d,r,{netId:'n1',layer:1}),20,15),true,
    'span 内层应被 seed');
  assert.equal(core.pourContains(core.computePour(d,r,{netId:'n1',layer:3}),20,15),false,
    'span 外层不应有铜');
});

test('pour：异网埋孔在其 span 层被挖空，span 外层不避让',()=>{
  const d=pourBoard();
  const r=pourResult({x:20,y:15,layers:[1,2]});
  assert.equal(core.pourContains(core.computePour(d,r,{netId:'n2',layer:1}),20,15),false,
    'span 内层应避让');
  assert.equal(core.pourContains(core.computePour(d,r,{netId:'n2',layer:3}),20,15),true,
    'span 外层不应避让');
});

test('pour：通孔（无 span）在所有层照旧 seed/避让（向后兼容）',()=>{
  const d=pourBoard();
  const r=pourResult({x:20,y:15});
  assert.equal(core.pourContains(core.computePour(d,r,{netId:'n1',layer:0}),20,15),true);
  assert.equal(core.pourContains(core.computePour(d,r,{netId:'n1',layer:3}),20,15),true);
  assert.equal(core.pourContains(core.computePour(d,r,{netId:'n2',layer:0}),20,15),false);
  assert.equal(core.pourContains(core.computePour(d,r,{netId:'n2',layer:3}),20,15),false);
});

// ---- SVG span 语义（0.13.3 深度检查补）----
function svgBoard(){
  const d=core.designDefaults();
  d.width=40; d.height=30; d.grid=0.5; d.layers=4;
  d.trackW=0.25; d.clearance=0.2; d.viaOuter=0.6; d.viaDrill=0.3;
  d.nets=[{id:'n1',name:'A'}];
  d.pads=[{id:'U1-1',netId:'n1',x:2,y:15,w:0.5,h:0.5,shape:'rect',layer:'top'},
          {id:'U1-2',netId:'n1',x:38,y:15,w:0.5,h:0.5,shape:'rect',layer:'top'}];
  return d;
}
function svgResult(via){
  return {status:'complete',nets:[{netId:'n1',name:'A',
    paths:[[{x:2,y:15,l:1},{x:18,y:15,l:1}],[{x:18,y:15,l:2},{x:38,y:15,l:2}]],
    vias:[via],connected:2,total:2}],
    overuse:[],stats:{connected:2,total:2,trackTop:0,trackBot:0,vias:1,trackLen:72,
    trackLayers:[0,36,36,0],trackInner:36}};
}
test('SVG：埋孔不出现在顶层/底层视图（图纸不画不存在的孔）',()=>{
  const d=svgBoard();
  const n=svg=>(svg.match(/<circle/g)||[]).length;
  assert.equal(n(core.buildSVG(d,svgResult({x:18,y:15,layers:[1,2]}),{})),0);
});
test('SVG：盲孔只出现在其 span 触及的外层组',()=>{
  const d=svgBoard();
  const n=svg=>(svg.match(/<circle/g)||[]).length;
  assert.equal(n(core.buildSVG(d,svgResult({x:18,y:15,layers:[0,1]}),{})),2,'顶层组应有');
  assert.equal(n(core.buildSVG(d,svgResult({x:18,y:15,layers:[2,3]}),{})),2,'底层组应有');
});
test('SVG：通孔照旧两视图都画 + 逐孔 outer/drill 生效',()=>{
  const d=svgBoard();
  const svg=core.buildSVG(d,svgResult({x:18,y:15,drill:0.1,outer:0.25}),{});
  const n=(svg.match(/<circle/g)||[]).length;
  assert.equal(n,4);
  assert.ok(svg.includes('r="0.125"'),'外径 0.25/2 应出现在光圈');
});
