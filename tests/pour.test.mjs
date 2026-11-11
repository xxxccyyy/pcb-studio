import * as core from '../src/engine.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

// 多边形覆铜测试（roadmap 阶段一 #1 验收：边缘平滑/间距精确/贯通 Gerber+EasyEDA）
// 口径：环 = [x,y,...] 扁平数组；外环鞋带面积正、孔负（y 向下、保持右规则）。

const ringArea = f => { let s = 0; for (let i = 0; i < f.length; i += 2) { const j = (i + 2) % f.length; s += f[i] * f[j + 1] - f[j] * f[i + 1]; } return s / 2; };
const ringPts = f => { const p = []; for (let i = 0; i < f.length; i += 2) p.push({ x: f[i], y: f[i + 1] }); return p; };
const allRings = pour => pour.polys.flatMap(p => [p.outer, ...p.holes]);
// 环边界采样：顶点 + 边中点（间距审计用）
const boundarySamples = pour => allRings(pour).flatMap(f => {
  const pts = ringPts(f), out = [];
  for (let i = 0; i < pts.length; i++) {
    out.push(pts[i]);
    const b = pts[(i + 1) % pts.length];
    out.push({ x: (pts[i].x + b.x) / 2, y: (pts[i].y + b.y) / 2 });
  }
  return out;
});

function design() {
  const d = core.designDefaults();
  d.width = 30; d.height = 20; d.grid = 0.25; d.trackW = 0.3; d.clearance = 0.2;
  d.viaOuter = 0.8; d.viaDrill = 0.4;
  d.nets = [{ id: 'gnd', name: 'GND' }, { id: 'sig', name: 'SIG' }];
  return d;
}
// 异网铜距离（精确到铜面，非间距区）：走线胶囊面 / 矩形焊盘面 / 圆焊盘与过孔面
function foreignDist(traces, pads, vias, x, y) {
  let m = 1e9;
  for (const t of traces) m = Math.min(m, core.segDist(x, y, t.a.x, t.a.y, t.b.x, t.b.y) - t.w / 2);
  for (const p of pads) m = Math.min(m, p.shape === 'circle'
    ? Math.max(0, Math.hypot(x - p.x, y - p.y) - p.w / 2)
    : core.distToRect(x, y, p.x, p.y, p.w, p.h));
  for (const v of vias) m = Math.min(m, Math.hypot(x - v.x, y - v.y) - v.d / 2);
  return m;
}

test('多边形覆铜：真实外环+挖空孔，间距保证且贴紧', () => {
  const d = design();
  d.pads = [
    { id: 'G1-1', netId: 'gnd', x: 5, y: 10, w: 1.2, h: 1.6, layer: 'bottom' },
    { id: 'S1-1', netId: 'sig', x: 24, y: 10, w: 1.2, h: 1.6, layer: 'bottom' },
  ];
  const traces = [{ a: { x: 24, y: 10 }, b: { x: 28.5, y: 13 }, w: 0.3 }];
  const r = { nets: [
    { netId: 'gnd', paths: [], vias: [] },
    { netId: 'sig', paths: [[{ x: 24, y: 10, l: 1 }, { x: 28.5, y: 13, l: 1 }]], vias: [] },
  ] };
  const pour = core.computePour(d, r, { layer: 1, netId: 'gnd', thermal: false });
  assert(pour.polys.length >= 1 && pour.area > 100, '应有覆盖大部分板面的多边形');
  const outer = pour.polys[0].outer;
  assert(ringArea(outer) > 0, '外环鞋带面积为正');
  for (const f of pour.polys.flatMap(p => p.holes)) assert(ringArea(f) < 0, '孔环面积为负');
  // 挖空孔：异网焊盘与走线相连，间距区连成一体 → 至少一个孔
  assert(pour.polys.flatMap(p => p.holes).length >= 1, '异网焊盘+斜走线应有挖空孔');
  assert.equal(core.pourContains(pour, 24, 10), false, '异网焊盘中心不在铜皮内');
  assert.equal(core.pourContains(pour, 5, 10), true, '本网焊盘中心在铜皮内');
  assert.equal(core.pourContains(pour, 15, 17), true, '海铜在内');
  // 间距保证：全部环边界采样点到异网铜面 ≥ clearance
  const pad = { x: 24, y: 10, w: 1.2, h: 1.6 }, via = [];
  let minSlack = 1e9;
  for (const s of boundarySamples(pour)) {
    const dd = foreignDist(traces, [pad], via, s.x, s.y);
    assert(dd >= d.clearance - 1e-6, `边界点 (${s.x.toFixed(2)},${s.y.toFixed(2)}) 距异网铜 ${dd.toFixed(4)} < ${d.clearance}`);
    minSlack = Math.min(minSlack, dd - d.clearance);
  }
  // 贴紧性：富余不超过 ~1.2 细格（不因过度保守而失铜）
  assert(minSlack <= pour.cell * 2 + 0.02, `间距富余 ${minSlack.toFixed(4)} 过大（cell=${pour.cell.toFixed(3)}）`);
});

test('热焊盘：环形开窗 + 四条实宽筋条', () => {
  const d = design();
  d.pads = [{ id: 'G1-1', netId: 'gnd', x: 15, y: 10, w: 1.2, h: 1.6, layer: 'bottom' }];
  const r = { nets: [{ netId: 'gnd', paths: [], vias: [] }] };
  const gap = 0.4, spokeW = 0.3;
  const on = core.computePour(d, r, { layer: 1, netId: 'gnd', thermal: true, thermalGap: gap, spokeW });
  // 焊盘本体是本网铜 → 在铜皮内；环带（非筋条）挖空 → 不在
  assert.equal(core.pourContains(on, 15, 10), true, '焊盘本体在铜皮内');
  const pr = 0.6;   // 矩形焊盘右边缘（轴对称方向用半宽）
  // 四条轴向筋条中心线连通（矩形焊盘右/左边缘用半宽 0.6，上/下用半高 0.8）
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const px = dx ? 15 + dx * (0.6 + gap / 2) : 15, py = dy ? 10 + dy * (0.8 + gap / 2) : 10;
    assert.equal(core.pourContains(on, px, py), true, `筋条 (${dx},${dy}) 连通`);
  }
  void pr;
  // 对角点在环带内但远离筋条（轴向筋条不可能覆盖对角）→ 挖空
  assert.equal(core.pourContains(on, 15 + 0.6 + gap * 0.4, 10 + 0.8 + gap * 0.4), false, '对角环带挖空');
  // 孔结构：环带被 4 条筋条切成 4 段弧形孔
  assert.equal(on.polys.flatMap(p => p.holes).length, 4, '热焊盘应有 4 段弧形孔');
  // 实宽筋条定制：加宽后原本挖空的对角旁点仍不在筋条内，但筋条半宽内连通
  const wide = core.computePour(d, r, { layer: 1, netId: 'gnd', thermal: true, thermalGap: gap, spokeW: 0.5 });
  assert.equal(core.pourContains(wide, 15 + 0.6 + gap / 2, 10 + 0.2), true, '0.5 宽筋条覆盖横向 ±0.2');
  assert.equal(core.pourContains(on, 15 + 0.6 + gap / 2, 10 + 0.2), false, '0.3 宽筋条不覆盖横向 ±0.2');
  // 关闭热焊盘：实心连接，环带点为铜
  const off = core.computePour(d, r, { layer: 1, netId: 'gnd', thermal: false });
  assert.equal(core.pourContains(off, 15 + 0.6 + gap * 0.4, 10 + 0.8 + gap * 0.4), true, '实心模式环带为铜');
});

test('孤岛去除：隔墙右侧铜皮被去除并计入孤岛统计', () => {
  const d = design();
  d.pads = [{ id: 'G1-1', netId: 'gnd', x: 5, y: 10, w: 1.2, h: 1.6, layer: 'bottom' }];
  d.keepouts = [{ x: 15.25, y: 10, w: 2, h: 20 }];
  const r = { nets: [{ netId: 'gnd', paths: [], vias: [] }] };
  const pour = core.computePour(d, r, { layer: 1, netId: 'gnd', thermal: false });
  assert.equal(core.pourContains(pour, 5, 10), true, '左侧海铜保留');
  assert.equal(core.pourContains(pour, 22, 10), false, '隔墙右侧孤岛已去除');
  assert(pour.islands >= 1 && pour.islandArea > 0, `应报告孤岛（got ${pour.islands}, ${pour.islandArea}）`);
});

test('Gerber：覆铜多边形区域 LPD 外环 + LPC 孔，区域闭合', () => {
  const d = design();
  d.pads = [
    { id: 'G1-1', netId: 'gnd', x: 5, y: 10, w: 1.2, h: 1.6, layer: 'bottom' },
    { id: 'S1-1', netId: 'sig', x: 24, y: 10, w: 1.2, h: 1.6, layer: 'bottom' },
  ];
  const r = { nets: [{ netId: 'gnd', paths: [], vias: [] }] };
  const pour = core.computePour(d, r, { layer: 1, netId: 'gnd', thermal: true });
  const g = core.buildGerber(d, r, pour);
  const nRings = allRings(pour).length;
  assert(g.bottom.includes('%LPD*%'), 'LPD 极性');
  assert(g.bottom.includes('%LPC*%'), 'LPC 极性（挖空孔）');
  const blocks = g.bottom.split('G36*').length - 1;
  assert.equal(blocks, nRings, `G36 区域数 ${blocks} 应等于环数 ${nRings}`);
  // 每个区域首尾坐标闭合（2.6 整数格式）
  for (const b of g.bottom.split('G36*').slice(1)) {
    const body = b.split('G37*')[0];
    const m = [...body.matchAll(/X(-?\d+)Y(-?\d+)D0[12]\*/g)];
    assert(m.length >= 4, '区域至少 3 顶点+闭合');
    assert.equal(m[0][1], m[m.length - 1][1], '区域 X 闭合');
    assert.equal(m[0][2], m[m.length - 1][2], '区域 Y 闭合');
  }
});

test('EasyEDA：COPPERAREA 导出 + verify 回读校验', () => {
  const d = design();
  d.pads = [
    { id: 'G1-1', netId: 'gnd', x: 5, y: 10, w: 1.2, h: 1.6, layer: 'bottom' },
    { id: 'S1-1', netId: 'sig', x: 24, y: 10, w: 1.2, h: 1.6, layer: 'bottom' },
  ];
  const r = { nets: [{ netId: 'gnd', paths: [], vias: [] }] };
  const pour = core.computePour(d, r, { layer: 1, netId: 'gnd', thermal: true });
  const ee = JSON.parse(core.exportEasyEdaPcb(d, r.nets, pour));
  const ca = ee.shape.filter(s => s.startsWith('COPPERAREA~')).map(s => s.split('~'));
  assert.equal(ca.length, 1, '应有一条 COPPERAREA');
  // 字段序（pcb-rnd io_easyeda 核实）：stroke_width~layer~net~path~clearance~fill~id~thermal~keep_island~zone~locked
  assert.equal(ca[0][2], '2', '底层=层 2');
  assert.equal(ca[0][3], 'GND', '网络名');
  assert.equal(ca[0][6], 'solid', '实心填充');
  assert.equal(ca[0][8], '1', '热焊盘开启');
  assert.equal(ca[0][9], '0', '孤岛去除');
  // 回读校验：一致 → ok；剥掉 COPPERAREA → VRF-POUR 错误
  const v1 = core.verifyEasyEdaExport(d, { nets: r.nets, pour });
  assert.equal(v1.ok, true, 'verify 通过：' + JSON.stringify(v1.findings));
  const stripped = JSON.stringify({ ...ee, shape: ee.shape.filter(s => !s.startsWith('COPPERAREA~')) });
  const v2 = core.verifyEasyEdaExport(d, { nets: r.nets, pour }, stripped);
  assert(v2.findings.some(f => f.id === 'VRF-POUR'), '缺铜皮导出应报 VRF-POUR');
  // 反向：结果无铜皮但导出有 → VRF-POUR-EXTRA
  const v3 = core.verifyEasyEdaExport(d, { nets: r.nets }, JSON.stringify(ee));
  assert(v3.findings.some(f => f.id === 'VRF-POUR-EXTRA'), '多余铜皮导出应报 VRF-POUR-EXTRA');
});

test('缝合孔规划：候选点全部落在铜皮多边形内', () => {
  const d = design();
  d.pads = [
    { id: 'G1-1', netId: 'gnd', x: 5, y: 10, w: 1.2, h: 1.6, layer: 'bottom' },
    { id: 'S1-1', netId: 'sig', x: 24, y: 10, w: 1.2, h: 1.6, layer: 'bottom' },
  ];
  const r = { nets: [{ netId: 'gnd', paths: [], vias: [] }] };
  const pour = core.computePour(d, r, { layer: 1, netId: 'gnd', thermal: true });
  const pts = core.planStitching(d, r, pour, 4);
  assert(pts.length >= 5, `缝合孔应足够多（got ${pts.length}）`);
  for (const p of pts) {
    assert.equal(p.netId, 'gnd', '缝合孔属覆铜网络');
    assert.equal(core.pourContains(pour, p.x, p.y), true, `缝合孔 (${p.x},${p.y}) 应在铜皮上`);
  }
  // 异网焊盘附近不放
  for (const p of pts) assert(core.distToRect(p.x, p.y, 24, 10, 1.2, 1.6) >= d.viaOuter / 2 + d.clearance - 1e-6, '缝合孔避让异网焊盘');
});

test('renderBoardPixels：铜皮像素填充与挖空', () => {
  const d = design();
  d.pads = [
    { id: 'G1-1', netId: 'gnd', x: 5, y: 10, w: 1.2, h: 1.6, layer: 'bottom' },
    { id: 'S1-1', netId: 'sig', x: 24, y: 10, w: 1.2, h: 1.6, layer: 'bottom' },
  ];
  const r = { nets: [{ netId: 'gnd', paths: [], vias: [] }] };
  const pour = core.computePour(d, r, { layer: 1, netId: 'gnd', thermal: true });
  assert.equal(core.pourContains(pour, 15, 16), true, '取样点应在海铜内');
  const img = core.renderBoardPixels(d, r, { scale: 8, pour });
  const at = (x, y) => { const i = ((y * 8) * img.width + x * 8) * 4; return [img.px[i], img.px[i + 1], img.px[i + 2]]; };
  const sea = at(15, 16), hole = at(24, 10);
  assert.deepEqual(sea, [64, 64, 0], '海铜为底层覆铜色');
  assert.notDeepEqual(hole, [64, 64, 0], '异网焊盘挖空处非覆铜色');
});

test('pourContains / pourNear / inPour 语义', () => {
  const d = design();
  d.pads = [
    { id: 'G1-1', netId: 'gnd', x: 10, y: 10, w: 1.2, h: 1.6, layer: 'bottom' },
    { id: 'S1-1', netId: 'sig', x: 24, y: 10, w: 1.2, h: 1.6, layer: 'bottom' },
  ];
  const r = { nets: [{ netId: 'gnd', paths: [], vias: [] }] };
  const pour = core.computePour(d, r, { layer: 1, netId: 'gnd', thermal: false });
  assert.equal(core.pourContains(pour, 10, 10), true, '本网焊盘内（实心连接）');
  assert.equal(core.pourContains(pour, 24, 10), false, '异网焊盘内无铜');
  assert.equal(core.pourContains(pour, 0.05, 0.05), false, '板边带外');
  assert.equal(core.inPour(pour, 10, 10), true, 'inPour 同口径');
  assert.equal(core.pourNear(pour, 10, 10, 0.5), true, '铜皮内即近');
  assert.equal(core.pourNear(pour, 0.05, 0.05, 0.05), false, '板边带深处不近铜');
  assert.equal(core.pourNear(pour, 0.05, 0.05, 0.3), true, '板边带近铜边');
  // 异网焊盘右边缘 24.6，铜皮起点 ≥ 24.6+clearance：
  // 边缘外 0.09 处到铜皮 >0.1 → reach=0.10 不命中、reach=0.5 命中
  assert.equal(core.pourNear(pour, 24.6 + 0.09, 10, d.clearance - 0.1), false, '间距保证（不侵入间距区）');
  assert.equal(core.pourNear(pour, 24.6 + 0.09, 10, d.clearance + 0.3), true, '间距外贴紧');
});

test('45° 斜走线胶囊挖空', () => {
  const d = design();
  d.pads = [{ id: 'G1-1', netId: 'gnd', x: 5, y: 10, w: 1.2, h: 1.6, layer: 'bottom' }];
  const t = { a: { x: 10, y: 5 }, b: { x: 25, y: 15 }, w: 0.3 };
  const r = { nets: [
    { netId: 'gnd', paths: [], vias: [] },
    { netId: 'sig', paths: [[{ x: 10, y: 5, l: 1 }, { x: 25, y: 15, l: 1 }]], vias: [] },
  ] };
  const pour = core.computePour(d, r, { layer: 1, netId: 'gnd', thermal: false });
  assert.equal(core.pourContains(pour, 17, 9.7), false, '斜走线上点不在铜皮内');
  for (const s of boundarySamples(pour)) {
    const dd = core.segDist(s.x, s.y, t.a.x, t.a.y, t.b.x, t.b.y) - t.w / 2;
    assert(dd >= d.clearance - 1e-6, `边界点距斜走线铜面 ${dd.toFixed(4)} < ${d.clearance}`);
  }
});

test('异网泪滴楔形参与避让', () => {
  const d = design();
  d.pads = [
    { id: 'G1-1', netId: 'gnd', x: 5, y: 16, w: 1.2, h: 1.6, layer: 'bottom' },
    { id: 'S1-1', netId: 'sig', x: 10, y: 5, w: 1.2, h: 1.6, layer: 'bottom' },
  ];
  const r = { nets: [
    { netId: 'gnd', paths: [], vias: [] },
    { netId: 'sig', paths: [[{ x: 10, y: 5, l: 1 }, { x: 14, y: 5, l: 1 }]], vias: [{ x: 14, y: 5 }] },
  ] };
  const tds = core.teardropPolys(d, r).filter(t => t.l === 1);
  assert(tds.length >= 1, '应有泪滴');
  const wedge = tds[0].p;
  const pour = core.computePour(d, r, { layer: 1, netId: 'gnd', thermal: false, teardrops: tds });
  for (const s of boundarySamples(pour))
    for (let k = 0; k < wedge.length; k++) {
      const a = wedge[k], b = wedge[(k + 1) % wedge.length];
      const dd = core.segDist(s.x, s.y, a.x, a.y, b.x, b.y);
      assert(dd >= d.clearance - 1e-6, `边界点距泪滴边 ${dd.toFixed(4)} < ${d.clearance}`);
    }
});

test('未知网/空网返回空多边形', () => {
  const d = design();
  d.pads = [{ id: 'G1-1', netId: 'gnd', x: 10, y: 10, w: 1.2, h: 1.6, layer: 'bottom' }];
  const r = { nets: [{ netId: 'gnd', paths: [], vias: [] }] };
  for (const netId of [null, '不存在']) {
    const p = core.computePour(d, r, { layer: 1, netId, thermal: true });
    assert.equal(p.polys.length, 0, '空铜皮');
    assert.equal(p.area, 0, '零面积');
  }
});

test('大板细格自动放粗（内存上限保护）', () => {
  const d = design();
  d.width = 220; d.height = 220;
  d.pads = [
    { id: 'G1-1', netId: 'gnd', x: 60, y: 110, w: 1.2, h: 1.6, layer: 'bottom' },
    { id: 'S1-1', netId: 'sig', x: 170, y: 110, w: 1.2, h: 1.6, layer: 'bottom' },
  ];
  const r = { nets: [{ netId: 'gnd', paths: [], vias: [] }] };
  const pour = core.computePour(d, r, { layer: 1, netId: 'gnd', thermal: false });
  assert(pour.area > 0 && pour.polys.length >= 1, '大板覆铜完成');
  const cap = Math.sqrt(220 * 220 / 12e6);   // POUR_CELL_CAP=12e6
  assert(pour.cell >= cap - 1e-9, `cell ${pour.cell.toFixed(4)} 应放粗到 ≥ ${cap.toFixed(4)}`);
  assert.equal(core.pourContains(pour, 60, 110), true, '本网焊盘连通');
});
