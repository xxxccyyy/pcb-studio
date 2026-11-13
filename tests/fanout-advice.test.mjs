import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync, mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import * as core from '../src/engine.mjs';

/* ============================================================
   阵列扇出容量建议（0.13.13）
   几何算术：外圈相邻球之间的缝是内圈球唯一逃逸通道。
   缝宽 = 球距 − 球径；每缝可穿 ⌊缝宽/(线宽+间距)⌋ 条。
   内圈独立网数 > 总容量 ⇒ 物理不可能（FANOUT，prio 0）。
   内圈占用 > 50% 且 <4 层 ⇒ 容量够但分配难（FANOUT_TIGHT，prio 2）。
   ============================================================ */

function mkBoard(opts){
  const d=core.designDefaults();
  d.width=60; d.height=60; d.grid=opts.grid||0.25; d.layers=opts.layers||2;
  d.trackW=opts.trackW||0.15; d.clearance=opts.clearance||0.08;
  d.viaOuter=0.45; d.viaDrill=0.2;
  d.nets=[]; d.pads=[];
  const n=opts.n||8, pitch=opts.pitch||0.8, ballW=opts.ballW||0.45;
  const cx=30, cy=30;
  // n×n 阵列，每球独立网（内圈全部需逃逸）
  for(let r=0;r<n;r++)for(let c=0;c<n;c++){
    const id='B'+(r*n+c);
    d.nets.push({id,name:id});
    d.pads.push({id:'U1-'+(r*n+c+1),netId:id,
      x:cx+(c-(n-1)/2)*pitch, y:cy+(r-(n-1)/2)*pitch,
      w:ballW,h:ballW,shape:'circle',layer:'top'});
  }
  return d;
}

function adviseOf(d){
  const dir=mkdtempSync(join(tmpdir(),'fanout-'));
  const f=join(dir,'d.json');
  writeFileSync(f, JSON.stringify(d));
  const out=execFileSync('node',['ai/pcb.mjs','advise',f],{encoding:'utf8',maxBuffer:1e7});
  return JSON.parse(out).recommendations||[];
}

test('FANOUT：缝宽不足走线需求 → prio 0 物理无法引出',()=>{
  // pitch 0.4, ball 0.35 ⇒ 缝 0.05 < 需求 0.23
  const d=mkBoard({n:6,pitch:0.4,ballW:0.35});
  const recs=adviseOf(d);
  const f=recs.filter(r=>r.id==='FANOUT');
  assert.ok(f.length>0,'应报 FANOUT：'+JSON.stringify(recs.map(r=>r.id)));
  assert.equal(f[0].prio,0);
  assert.ok(/无法从缝中引出|物理容量不足/.test(f[0].msg),f[0].msg);
});

test('FANOUT_TIGHT：容量够但占用过半且 2 层板 → prio 2',()=>{
  // pitch 0.8, ball 0.45 ⇒ 缝 0.35，每缝 1 条；8×8 外圈 28 缝；
  // 内圈 36 球、36 独立网 > 28 ⇒ 容量不足。改用 6×6：外圈 20，内圈 16，
  // 16/20=80% > 50% 且不超容量
  const d=mkBoard({n:6,pitch:0.8,ballW:0.45});
  const recs=adviseOf(d);
  const t=recs.filter(r=>r.id==='FANOUT_TIGHT');
  assert.ok(t.length>0,'应报 FANOUT_TIGHT：'+JSON.stringify(recs.map(r=>r.id)));
  assert.equal(t[0].prio,2);
  assert.ok(/占用过半/.test(t[0].msg),t[0].msg);
});

test('FANOUT：4 层板不报 TIGHT（内层可分流）',()=>{
  const d=mkBoard({n:6,pitch:0.8,ballW:0.45,layers:4});
  const recs=adviseOf(d);
  assert.equal(recs.filter(r=>r.id==='FANOUT_TIGHT').length,0,
    '4 层板不应报 TIGHT');
});

test('FANOUT：宽松阵列（占用低）不报',()=>{
  // 4×4 阵列，外圈 12 缝，内圈 4 球 4 网 ⇒ 4/12=33% < 50%
  const d=mkBoard({n:4,pitch:0.8,ballW:0.45});
  const recs=adviseOf(d);
  assert.equal(recs.filter(r=>/FANOUT/.test(r.id)).length,0,
    '宽松阵列不应报：'+JSON.stringify(recs.map(r=>r.id)));
});

test('FANOUT：非阵列（少量焊盘）不误报',()=>{
  const d=core.designDefaults();
  d.width=30; d.height=30; d.grid=0.5; d.layers=2;
  d.nets=[{id:'n1',name:'A'}];
  d.pads=[{id:'U1-1',netId:'n1',x:5,y:5,w:0.5,h:0.5,shape:'rect',layer:'top'},
          {id:'U1-2',netId:'n1',x:10,y:5,w:0.5,h:0.5,shape:'rect',layer:'top'}];
  const recs=adviseOf(d);
  assert.equal(recs.filter(r=>/FANOUT/.test(r.id)).length,0);
});
