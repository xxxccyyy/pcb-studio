import {test} from 'node:test';
import assert from 'node:assert/strict';
import {designDefaults,checkDRC,fabChecklist,buildGerber,exportIPC356,exportEasyEdaPcb} from '../src/engine.mjs';

const empty=()=>({nets:[],overuse:[]});
const design=()=>({...designDefaults(),width:20,height:20,nets:[{id:'g',name:'GND'},{id:'s',name:'Signal',w:1}]});
const pad=(id,x,y=10,more={})=>({id,netId:'g',x,y,w:1.5,h:1.5,shape:'circle',layer:'both',holeR:0.45,...more});
const routed=(vias=[],paths=[],netId='g')=>({nets:[{netId,name:netId,paths,vias,connected:0,total:0}],overuse:[]});
const holesRow=(d,r)=>fabChecklist(d,r).find(x=>x.item==='孔边到孔边（最小）');
const edgeRow=(d,r)=>fabChecklist(d,r).find(x=>x.group==='板边');

test('same-net PTH drills must respect physical edge clearance, independently of copper overlap',()=>{
  const d=design();d.pads=[pad('P1',9),pad('P2',10)];
  const issues=checkDRC(d,empty());
  assert.ok(issues.some(i=>i.type==='孔边距'&&i.sev==='error'&&i.msg.includes('0.10mm')));
  assert.ok(!issues.some(i=>i.type==='焊盘重叠'));
  assert.deepEqual([holesRow(d,empty()).value,holesRow(d,empty()).status],['0.10 mm','fail']);
  assert.equal(holesRow(d,null).status,'fail'); // Pad-only manufacturing checks do not require routes.
  assert.ok(checkDRC(d,empty(),{dfm:false}).some(i=>i.type==='孔边距'));
});

test('PTH to PTH exact hole-edge limit is accepted and actual per-pad radii are used',()=>{
  const d=design();d.pads=[pad('P1',9),pad('P2',10.1)];
  assert.ok(!checkDRC(d,empty()).some(i=>i.type==='孔边距'));
  assert.deepEqual([holesRow(d,empty()).value,holesRow(d,empty()).status],['0.20 mm','warn']);
  d.pads[1].holeR=0.6;
  assert.ok(checkDRC(d,empty()).some(i=>i.type==='孔边距'));
});

test('PTH-via and PTH-stitching drill clearances are checked even on the same net',()=>{
  for(const stitching of [false,true]){
    const d=design();d.pads=[pad('P1',9)];
    const r=stitching?empty():routed([{x:9.75,y:10}]);
    if(stitching)d.stitching=[{netId:'g',x:9.75,y:10}];
    assert.ok(checkDRC(d,r).some(i=>i.type==='孔边距'&&i.msg.includes('0.10mm')));
    assert.equal(holesRow(d,r).status,'fail');
    assert.ok(checkDRC(d,r,{dfm:false}).some(i=>i.type==='孔边距'));
  }
});

test('via-only hole clearance uses drill diameter, not copper outer diameter',()=>{
  const d=design(),r=routed([{x:9,y:10},{x:9.65,y:10}]);
  // 0.65 - 0.40 = 0.25mm physical gap, despite overlapping 0.80mm same-net copper lands.
  assert.ok(!checkDRC(d,r).some(i=>i.type==='DFM 过孔间距'));
  assert.deepEqual([holesRow(d,r).value,holesRow(d,r).status],['0.25 mm','warn']);
  r.nets[0].vias[1].x=9.6; // Exact 0.20mm limit.
  assert.ok(!checkDRC(d,r).some(i=>i.type==='DFM 过孔间距'));
  r.nets[0].vias[1].x=9.59;
  assert.ok(checkDRC(d,r).some(i=>i.type==='DFM 过孔间距'&&i.sev==='warn'));
  assert.equal(holesRow(d,r).status,'fail');
  assert.ok(!checkDRC(d,r,{dfm:false}).some(i=>i.type==='DFM 过孔间距'));
});

test('PTH missing holeR follows export drill fallback; zero-hole and SMD pads are excluded',()=>{
  const d=design();d.pads=[pad('fallback',9,10,{w:0.7,h:0.1})];delete d.pads[0].holeR;
  assert.ok(checkDRC(d,empty()).some(i=>i.type==='插件孔环宽'&&i.sev==='error'));
  assert.equal(fabChecklist(d,empty()).find(x=>x.item==='插件孔环宽（最小）').value,'0.15 mm');
  // Circle ring must use w, not the stale h value; 0.35 - fallback radius 0.20 = 0.15mm.
  d.pads=[pad('solid',9,10,{holeR:0}),pad('SMD',10,10,{layer:'top',holeR:0.45})];
  assert.equal(holesRow(d,empty()),undefined);
  assert.ok(!checkDRC(d,empty()).some(i=>i.type==='孔边距'||i.type==='插件孔环宽'));
});

for(const layer of [0,1,3])test('per-net trace width controls board-edge DFM on layer '+layer,()=>{
  const d=design();d.layers=4;
  const r=routed([],[[{x:3,y:0.6,l:layer},{x:17,y:0.6,l:layer}]],'s');
  assert.ok(checkDRC(d,r).some(i=>i.type==='DFM 板边'));
  assert.deepEqual([edgeRow(d,r).value,edgeRow(d,r).status],['0.10 mm','fail']);
  assert.ok(!checkDRC(d,r,{dfm:false}).some(i=>i.type==='DFM 板边'));
  for(const p of r.nets[0].paths[0])p.y=0.7; // 1mm trace has exactly 0.20mm copper-to-edge clearance.
  assert.ok(!checkDRC(d,r).some(i=>i.type==='DFM 板边'));
  assert.equal(edgeRow(d,r).status,'warn');
});

test('rectangular pad edge clearance uses directional half-extents instead of max dimension',()=>{
  const d=design();d.pads=[pad('tall',0.5,10,{shape:'rect',w:0.4,h:4,layer:'top',holeR:0})];
  assert.ok(!checkDRC(d,empty()).some(i=>i.type==='DFM 板边'||i.type==='焊盘出板'));
  assert.deepEqual([edgeRow(d,empty()).value,edgeRow(d,empty()).status],['0.30 mm','ok']);
  assert.equal(edgeRow(d,null).value,'0.30 mm');
  d.pads[0].x=0.4; // Exact 0.20mm limit.
  assert.ok(!checkDRC(d,empty()).some(i=>i.type==='DFM 板边'));
  d.pads[0].x=0.39;
  assert.ok(checkDRC(d,empty()).some(i=>i.type==='DFM 板边'));
  assert.equal(edgeRow(d,empty()).status,'fail');
});

test('zero-hole and fallback pads agree across Excellon, EasyEDA and IPC exports',()=>{
  const d=design();d.pads=[pad('J1-1',8),pad('J2-1',12,10,{holeR:0})];delete d.pads[0].holeR;
  const r=empty(),drill=buildGerber(d,r,null,[]).drill;
  assert.ok(drill.includes('C0.400'));assert.ok(!drill.includes('C0.000'));
  assert.ok(drill.includes('X8.000Y10.000'));assert.ok(!drill.includes('X12.000Y10.000'));
  const ipc=exportIPC356(d,r).split('\n');
  assert.ok(ipc.some(s=>s.startsWith('317')&&s.includes('J1')&&s.includes('D0157')));
  assert.ok(ipc.some(s=>s.startsWith('327')&&s.includes('J2')));
  const ee=JSON.parse(exportEasyEdaPcb(d,r.nets)).shape.filter(s=>s.startsWith('PAD~')).map(s=>s.split('~'));
  assert.ok(Math.abs(Number(ee[0][9])*0.254-0.2)<0.001);assert.equal(Number(ee[1][9]),0);
});
test('shared same-net same-diameter pad/via/stitch holes are one physical drill',()=>{
  const d=design();d.pads=[pad('P1',10,10,{holeR:0.2}),pad('P2',10,10,{holeR:0.2})];
  d.stitching=[{netId:'g',x:10,y:10}];
  const r=routed([{x:10,y:10},{x:10,y:10}]);
  assert.ok(!checkDRC(d,r).some(i=>i.type==='孔边距'||i.type==='DFM 过孔间距'));
  assert.equal(holesRow(d,r),undefined);
  assert.equal((buildGerber(d,r,null,[]).drill.match(/X10\.000Y10\.000/g)||[]).length,1);
  // Merged records must retain the via's larger copper ring in board-edge checks.
  for(const p of d.pads){p.x=0.5;p.w=p.h=0.7;}
  d.stitching[0].x=0.5;for(const v of r.nets[0].vias)v.x=0.5;
  assert.equal(edgeRow(d,r).value,'0.10 mm');
  assert.ok(checkDRC(d,r).some(i=>i.type==='DFM 板边'));
});
test('duplicate via records alone do not create a fictitious hole-spacing failure',()=>{
  const d=design(),r=routed([{x:10,y:10},{x:10,y:10}]);
  assert.ok(!checkDRC(d,r).some(i=>i.type==='DFM 过孔间距'));
  assert.equal(holesRow(d,r),undefined);
});
test('merging shared drills preserves every stacked pad annular-ring audit',()=>{
  const d=design();d.pads=[pad('large',10,10,{holeR:0.2}),pad('small',10,10,{holeR:0.2,w:0.7,h:0.7})];
  const r=routed([{x:10,y:10}]);
  assert.ok(checkDRC(d,r,{dfm:false}).some(i=>i.type==='插件孔环宽'&&i.msg.includes('small')&&i.sev==='error'));
  assert.equal(fabChecklist(d,r).find(x=>x.item==='插件孔环宽（最小）').value,'0.15 mm');
  assert.ok(!checkDRC(d,r).some(i=>i.type==='孔边距'));
});
test('physical drill merging cannot hide coincident different-net shorts',()=>{
  const d=design();d.pads=[pad('P1',10,10,{holeR:0.2})];
  const r=routed([{x:10,y:10}],[],'s');
  assert.ok(checkDRC(d,r,{dfm:false}).some(i=>i.type==='过孔-焊盘间距'&&i.sev==='error'));
  assert.ok(checkDRC(d,r,{dfm:false}).some(i=>i.type==='孔边距'&&i.sev==='error'));
  const rr={nets:[...routed([{x:10,y:10}]).nets,...r.nets],overuse:[]};
  assert.ok(checkDRC(design(),rr,{dfm:false}).some(i=>i.type==='过孔间距'&&i.sev==='error'));
});
test('coincident different drill diameters remain conflicting and distinct in Excellon',()=>{
  const d=design();d.pads=[pad('P1',10)];
  const r=routed([{x:10,y:10}]),drill=buildGerber(d,r,null,[]).drill;
  assert.ok(checkDRC(d,r,{dfm:false}).some(i=>i.type==='孔边距'&&i.sev==='error'));
  assert.ok(drill.includes('C0.400'));assert.ok(drill.includes('C0.900'));
  assert.equal((drill.match(/X10\.000Y10\.000/g)||[]).length,2);
});
test('via and stitching copper edges are checked against board edges',()=>{
  for(const stitching of [false,true]){
    const d=design(),r=stitching?empty():routed([{x:0.5,y:10}]);
    if(stitching)d.stitching=[{netId:'g',x:0.5,y:10}];
    assert.ok(checkDRC(d,r).some(i=>i.type==='DFM 板边'));
    assert.deepEqual([edgeRow(d,r).value,edgeRow(d,r).status],['0.10 mm','fail']);
    assert.ok(!checkDRC(d,r,{dfm:false}).some(i=>i.type==='DFM 板边'));
    const v=stitching?d.stitching[0]:r.nets[0].vias[0];v.x=0.6;
    assert.ok(!checkDRC(d,r).some(i=>i.type==='DFM 板边'));
    v.x=0.3;
    assert.ok(checkDRC(d,r,{dfm:false}).some(i=>i.type==='过孔出板'));
  }
});

test('per-pad drill diameter below the mechanical minimum is caught independently of the global viaDrill',()=>{
  const d=design();d.pads=[pad('P1',9,10,{holeR:0.04})];   // 钻孔 0.08mm < 机械极限 0.15mm
  const issues=checkDRC(d,empty());
  assert.ok(issues.some(i=>i.type==='插件孔孔径'&&i.sev==='error'&&i.msg.includes('0.08mm')));
  // 正常插件孔（0.9mm 钻孔）不误报
  const d2=design();d2.pads=[pad('P1',9)];
  assert.ok(!checkDRC(d2,empty()).some(i=>i.type==='插件孔孔径'));
  // 过孔全局 viaDrill 0.15（极限）不触发
  const d3=design();d3.viaDrill=0.15;
  const r3={nets:[{netId:'g',name:'GND',paths:[],vias:[{x:5,y:10}],connected:0,total:0}],overuse:[]};
  assert.ok(!checkDRC(d3,r3,{}).some(i=>i.type==='插件孔孔径'));
});
