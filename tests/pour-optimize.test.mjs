import * as core from '../src/engine.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

// 0.2.1 优化轮测试：借鉴 KiCad zone_filler / 嘉立创 DFM / EasyEDA 文档的新特性
// ——多铜皮避让、孤岛三档、筋条连通检测、网格铜、参数化、模糊不变量。

const ringArea = f => { let s = 0; for (let i = 0; i < f.length; i += 2) { const j = (i + 2) % f.length; s += f[i] * f[j + 1] - f[j] * f[i + 1]; } return s / 2; };
const ringPts = f => { const p = []; for (let i = 0; i < f.length; i += 2) p.push({ x: f[i], y: f[i + 1] }); return p; };
const allRings = pour => pour.polys.flatMap(p => [p.outer, ...p.holes]);
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
const foreignDist = (traces, pads, vias, x, y) => {
  let m = 1e9;
  for (const t of traces) m = Math.min(m, core.segDist(x, y, t.a.x, t.a.y, t.b.x, t.b.y) - t.w / 2);
  for (const p of pads) m = Math.min(m, p.shape === 'circle'
    ? Math.max(0, Math.hypot(x - p.x, y - p.y) - p.w / 2)
    : core.distToRect(x, y, p.x, p.y, p.w, p.h));
  for (const v of vias) m = Math.min(m, Math.hypot(x - v.x, y - v.y) - v.d / 2);
  return m;
};

test('多铜皮避让：同层第二块异网铜皮绕开第一块（KiCad 优先级思想）', () => {
  const d = design();
  d.nets = [...d.nets, { id: 'agnd', name: 'AGND' }];
  d.pads = [
    { id: 'G1-1', netId: 'gnd', x: 8, y: 10, w: 1.2, h: 1.6, layer: 'bottom' },
    { id: 'A1-1', netId: 'agnd', x: 22, y: 10, w: 1.2, h: 1.6, layer: 'bottom' },
  ];
  const r = { nets: [{ netId: 'gnd', paths: [], vias: [] }, { netId: 'agnd', paths: [], vias: [] }] };
  const pourG = core.computePour(d, r, { layer: 1, netId: 'gnd', thermal: true });
  const pourA = core.computePour(d, r, { layer: 1, netId: 'agnd', thermal: true, avoidPours: [pourG] });
  assert(pourA.area > 0, '第二块铜皮存在');
  for (const s of boundarySamples(pourA))
    assert(!core.pourNear(pourG, s.x, s.y, d.clearance - 1e-6),
      `AGND 铜皮边界点 (${s.x.toFixed(2)},${s.y.toFixed(2)}) 距 GND 铜皮 < clearance`);
  const pourBad = core.computePour(d, r, { layer: 1, netId: 'agnd', thermal: true });
  assert(core.pourContains(pourBad, 15, 16), '对照：无 avoidPours 时 AGND 铜皮盖住 GND 海铜区');
  assert(!core.pourContains(pourA, 15, 16), 'avoidPours 后同点已让给 GND 铜皮');
});

test('孤岛策略三档（KiCad ISLAND_REMOVAL_MODE）', () => {
  const mk = () => {
    const d = design();
    d.pads = [{ id: 'G1-1', netId: 'gnd', x: 5, y: 10, w: 1.2, h: 1.6, layer: 'bottom' }];
    d.keepouts = [{ x: 15.25, y: 10, w: 2, h: 20 }];
    return { d, r: { nets: [{ netId: 'gnd', paths: [], vias: [] }] } };
  };
  const run = o => { const { d, r } = mk(); return core.computePour(d, r, { layer: 1, netId: 'gnd', thermal: false, ...o }); };
  const always = run({ islandMode: 'always' });
  assert(always.islands >= 1 && always.islandsKept === 0, 'always：孤岛全删');
  const never = run({ islandMode: 'never' });
  assert(never.islandsKept >= 1 && never.keptIslandArea > 0, 'never：孤岛保留并计数');
  assert(never.area > always.area, 'never 面积更大');
  assert.equal(core.pourContains(never, 22, 10), true, '保留的孤岛进入输出多边形');
  const areaDrop = run({ islandMode: 'area', minIslandArea: 1e9 });
  assert.equal(areaDrop.islandsKept, 0, 'area：阈值极大 → 全删（小于阈值即删）');
  const areaKeep = run({ islandMode: 'area', minIslandArea: 0.001 });
  assert(areaKeep.islandsKept >= 1, 'area：阈值极小 → 全保留');
});

test('筋条全被截断 → 焊盘接入失败报告（KiCad 测试点思想）', () => {
  const d = design();
  // 异网焊盘相互贴靠围一圈（挖空区连成封闭带，海铜进不来）
  d.pads = [
    { id: 'G1-1', netId: 'gnd', x: 15, y: 10, w: 1.2, h: 1.6, layer: 'bottom' },
    { id: 'S-top', netId: 'sig', x: 15, y: 12.4, w: 4, h: 1.6, layer: 'bottom' },
    { id: 'S-bot', netId: 'sig', x: 15, y: 7.6, w: 4, h: 1.6, layer: 'bottom' },
    { id: 'S-l', netId: 'sig', x: 12.6, y: 10, w: 1.6, h: 3.2, layer: 'bottom' },
    { id: 'S-r', netId: 'sig', x: 17.4, y: 10, w: 1.6, h: 3.2, layer: 'bottom' },
  ];
  const r = { nets: [{ netId: 'gnd', paths: [], vias: [] }] };
  const pour = core.computePour(d, r, { layer: 1, netId: 'gnd', thermal: true });
  assert(pour.unconnectedPads.includes('G1-1'), '被围死焊盘应报告未接入');
  const d2 = design();
  d2.pads = [{ id: 'G1-1', netId: 'gnd', x: 15, y: 10, w: 1.2, h: 1.6, layer: 'bottom' }];
  const p2 = core.computePour(d2, { nets: [{ netId: 'gnd', paths: [], vias: [] }] }, { layer: 1, netId: 'gnd', thermal: true });
  assert.deepEqual(p2.unconnectedPads, [], '开阔焊盘全部接入');
});

test('网格铜 hatch：条纹连通、焊盘/筋条实心、嘉立创 0.254 钳制', () => {
  const d = design();
  d.pads = [{ id: 'G1-1', netId: 'gnd', x: 15, y: 10, w: 1.2, h: 1.6, layer: 'bottom' }];
  const r = { nets: [{ netId: 'gnd', paths: [], vias: [] }] };
  const solid = core.computePour(d, r, { layer: 1, netId: 'gnd', thermal: true });
  const grid = core.computePour(d, r, { layer: 1, netId: 'gnd', thermal: true, fill: 'grid' });
  assert.equal(grid.fill, 'grid');
  assert(grid.gridW >= 0.254 && grid.gridGap >= 0.254, '网格参数钳制 ≥0.254');
  assert(grid.area < solid.area, '网格面积小于实心');
  // 条纹对齐板原点：x=5.1 落在竖条纹（5.1 mod 0.508 = 0.02 < 0.254），x=5.4 落在空档
  assert.equal(core.pourContains(grid, 5.1, 5.4), true, '条纹上是铜');
  assert.equal(core.pourContains(grid, 5.4, 5.4), false, '空档处不是铜（场区）');
  assert.equal(core.pourContains(grid, 15, 10), true, '焊盘本体实心');
  assert.equal(core.pourContains(grid, 15 + 0.6 + 0.2, 10), true, '筋条实心');
  const pts = core.planStitching(d, r, grid, 4);
  for (const p of pts) assert.equal(core.pourContains(grid, p.x, p.y), true, '缝合孔落在网格铜上');
});

test('clearance / edgeMargin 参数化', () => {
  const d = design();
  d.pads = [
    { id: 'G1-1', netId: 'gnd', x: 8, y: 10, w: 1.2, h: 1.6, layer: 'bottom' },
    { id: 'S1-1', netId: 'sig', x: 22, y: 10, w: 1.2, h: 1.6, layer: 'bottom' },
  ];
  const r = { nets: [{ netId: 'gnd', paths: [], vias: [] }] };
  const pour = core.computePour(d, r, { layer: 1, netId: 'gnd', thermal: false, clearance: 0.4, edgeMargin: 0.5 });
  assert.equal(pour.clearance, 0.4);
  assert.equal(core.pourContains(pour, 22.6 + 0.3, 10), false, '0.4 间距下贴焊盘点无铜');
  assert.equal(core.pourContains(pour, 0.3, 10), false, '0.5 板边带内无铜');
  assert.equal(core.pourContains(pour, 0.55, 10), true, '板边带外有铜');
});

/* ---- 模糊测试：随机板不变量（环自交 + 间距契约 + 统计自洽）---- */
function segX(p1, p2, p3, p4) {
  const d1 = (p2.x - p1.x) * (p3.y - p1.y) - (p2.y - p1.y) * (p3.x - p1.x);
  const d2 = (p2.x - p1.x) * (p4.y - p1.y) - (p2.y - p1.y) * (p4.x - p1.x);
  const d3 = (p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x);
  const d4 = (p4.x - p3.x) * (p2.y - p3.y) - (p4.y - p3.y) * (p2.x - p3.x);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}
test('模糊测试：25 块随机板不变量', () => {
  let seed = 20261108;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let it = 0; it < 25; it++) {
    const d = design();
    d.clearance = [0.15, 0.2, 0.3][it % 3];
    const pads = [];
    const np = 4 + (it % 8);
    for (let i = 0; i < np; i++)
      pads.push({ id: 'P' + i + '-1', netId: i % 2 ? 'gnd' : 'sig',
        x: 3 + rnd() * 24, y: 3 + rnd() * 14, w: 0.8 + rnd() * 1.2, h: 0.8 + rnd() * 1.2,
        shape: rnd() < 0.4 ? 'circle' : 'rect', layer: 'bottom' });
    d.pads = pads;
    const nets = [];
    for (let i = 0; i < 3 + it % 4; i++) {
      const l0 = rnd() < 0.5;
      nets.push({ netId: i % 3 ? 'sig' : 'gnd', paths: [[
        { x: 2 + rnd() * 26, y: 2 + rnd() * 16, l: l0 ? 0 : 1 },
        { x: 2 + rnd() * 26, y: 2 + rnd() * 16, l: l0 ? 0 : 1 }]], vias: [] });
    }
    if (it % 3 === 0) nets[0].vias.push({ x: 5 + rnd() * 20, y: 5 + rnd() * 10 });
    const r = { nets };
    const mode = ['always', 'area', 'never'][it % 3];
    const pour = core.computePour(d, r, { layer: 1, netId: 'gnd', thermal: it % 2 === 0,
      islandMode: mode, minIslandArea: 1, minWidth: it % 3 === 0 ? 0.05 : 0.25, fill: it % 5 === 0 ? 'grid' : 'solid',
      teardrops: it % 4 === 0 ? [{ l: 1, p: [{ x: 10, y: 10 }, { x: 12, y: 10 }, { x: 11, y: 11.5 }] }] : [] });
    // 不变量 1：环闭合、坐标有限、外环正/孔负
    for (const poly of pour.polys) {
      assert(Number.isFinite(poly.outer[0]) && poly.outer.length >= 6, `it${it} 外环有限且 ≥3 点`);
      assert(ringArea(poly.outer) > 0, `it${it} 外环面积正`);
      for (const h of poly.holes) assert(ringArea(h) < 0, `it${it} 孔面积负`);
    }
    // 不变量 2：环不自交（≤400 点全查，大环抽查前 400 段）
    for (const f of allRings(pour)) {
      const pts = ringPts(f), n = Math.min(pts.length, 400);
      for (let a = 0; a < n; a++) {
        const b = (a + 1) % pts.length;
        for (let c = a + 2; c < n; c++) {
          if (a === 0 && c === pts.length - 1) continue;
          const e = (c + 1) % pts.length;
          if (segX(pts[a], pts[b], pts[c], pts[e]))
            throw new Error(`it${it} 环自交：边 ${a}-${b} 与 ${c}-${e} (mode=${mode}, fill=${pour.fill})`);
        }
      }
    }
    // 不变量 3：间距契约——边界采样点到异网铜 ≥ clearance
    const traces = nets.filter(p => p.netId !== 'gnd').flatMap(p => {
      const out = [];
      for (const path of p.paths) for (let k = 1; k < path.length; k++)
        if (path[k].l === 1 && path[k - 1].l === 1) out.push({ a: path[k - 1], b: path[k], w: 0.3 });
      return out;
    });
    const fPads = pads.filter(p => p.netId !== 'gnd');
    for (const s of boundarySamples(pour)) {
      const dd = foreignDist(traces, fPads, [], s.x, s.y);
      assert(dd >= d.clearance - 1e-6, `it${it} 边界点距异网铜 ${dd.toFixed(4)} < ${d.clearance} (mode=${mode})`);
    }
    // 不变量 4：统计有限非负
    assert(Number.isFinite(pour.area) && pour.area >= 0 && Number.isFinite(pour.islandArea) && pour.islandArea >= 0, `it${it} 面积统计`);
  }
});

test('DRC 铜皮审查来源归一化：CLI 不传 opts 也能审查 result.pour/pours', () => {
  const d = design();
  d.pads = [
    { id: 'G1-1', netId: 'gnd', x: 5, y: 10, w: 1.2, h: 1.6, layer: 'bottom' },
    { id: 'A1-1', netId: 'agnd', x: 22, y: 10, w: 1.2, h: 1.6, layer: 'both' },
  ];
  d.nets = [{ id: 'gnd', name: 'GND' }, { id: 'agnd', name: 'AGND' }, { id: 'sig', name: 'SIG' }];
  d.keepouts = [{ x: 15.25, y: 10, w: 2, h: 20 }];   // 隔墙 → 右侧孤岛（never 模式保留）
  const r0 = { nets: [{ netId: 'gnd', paths: [], vias: [] }, { netId: 'agnd', paths: [], vias: [] }] };
  const pourG = core.computePour(d, r0, { layer: 1, netId: 'gnd', thermal: true, islandMode: 'never' });
  assert(pourG.islandsKept >= 1, '前置：GND 铜皮确有保留孤岛');
  // 1) 不传 opts（CLI 口径）：result.pour 自动纳入，孤岛保留报警可见
  const iss1 = core.checkDRC(d, { nets: r0.nets, pour: pourG });
  assert(iss1.some(i => i.type === '保留孤岛' && i.sev === 'warn'), 'CLI 口径应触发保留孤岛报警');
  // 2) 多铜皮：AGND 铺顶层（互避按层过滤，两层各有孤岛），两块的报告都出现且不重复
  const pourA = core.computePour(d, r0, { layer: 0, netId: 'agnd', thermal: true, islandMode: 'never', avoidPours: [pourG] });
  assert(pourA.islandsKept >= 1, '前置：AGND 顶层铜皮确有保留孤岛');
  const iss2 = core.checkDRC(d, { nets: r0.nets, pours: [pourG, pourA], pour: pourG });
  const kept = iss2.filter(i => i.type === '保留孤岛');
  assert.equal(kept.length, 2, `两块铜皮各报一次（got ${kept.length}）`);
  assert(kept.some(i => i.msg.includes('GND')) && kept.some(i => i.msg.includes('AGND')), '报告带网络名');
  // 3) EasyEDA 多铜皮导出 + 回读对账
  const eeText = core.exportEasyEdaPcb(d, r0.nets, [pourG, pourA]);
  const nCA = JSON.parse(eeText).shape.filter(s => s.startsWith('COPPERAREA~')).length;
  assert.equal(nCA, 2, '两条 COPPERAREA');
  const v = core.verifyEasyEdaExport(d, { nets: r0.nets, pours: [pourG, pourA] });
  assert.equal(v.ok, true, 'verify 通过：' + JSON.stringify(v.findings));
  const v2 = core.verifyEasyEdaExport(d, { nets: r0.nets, pours: [pourG, pourA] },
    JSON.stringify(JSON.parse(core.exportEasyEdaPcb(d, r0.nets, [pourG]))));
  assert(v2.findings.some(f => f.id === 'VRF-POUR'), '缺一块铜皮导出应报数量不符');
});

test('多铜皮：powerDrop 的铺铜入口判定认 r.pours 中该网铜皮', () => {
  const d = design();
  d.trackW = 0.5; d.copperWeight = '1';
  d.nets = [{ id: 'p', name: 'VCC' }, { id: 'g', name: 'GND' }];
  d.pads = [
    { id: 'E-1', netId: 'p', x: 5, y: 10, w: 1.2, h: 1.2, layer: 'both', holeR: 0.45 },
    { id: 'U1-1', netId: 'p', x: 25, y: 10, w: 1.2, h: 1.2, layer: 'both', holeR: 0.45 },
  ];
  const sea = { outer: [0.2, 0.2, 29.8, 0.2, 29.8, 19.8, 0.2, 19.8], holes: [] };
  // 主铜皮是 GND，VCC 铜皮只是 r.pours 里的历史块——drop 仍应把 VCC 过孔当入口
  const r = { nets: [
      { netId: 'p', paths: [[{ x: 5, y: 10, l: 1 }, { x: 25, y: 10, l: 1 }]], vias: [{ x: 15, y: 10 }] },
      { netId: 'g', paths: [], vias: [] }],
    pour: { netId: 'g', polys: [sea], area: 580 },
    pours: [{ netId: 'g', polys: [sea], area: 580 }, { netId: 'p', polys: [{ ...sea, holes: [] }], area: 580 }] };
  const drop = core.powerDrop(d, r, 'p', { current: 1 });
  assert(drop.ok, 'p 铜皮在 r.pours → 过孔视为入口（否则会要求 --entries）：' + (drop.reason || ''));
  assert(drop.maxDropV >= 0 && drop.maxDropV < 0.05, '压降合理：' + drop.maxDropV);
});

/* ================= 三轮：大厂对标（KiCad Clipper2 收缩膨胀 / Altium MinWidth / 同网独立填充） ================= */

test('细颈消除：窄于 minWidth 的铜颈坍缩（KiCad shrink-then-grow 等价）', () => {
  const mk = minWidth => {
    const d = design();
    d.pads = [{ id: 'G1-1', netId: 'gnd', x: 5, y: 10, w: 1.2, h: 1.6, layer: 'bottom' }];
    // 两块禁布区之间留 0.6mm 缝隙：挖空(⊕T≈0.229)后铜颈 ≈0.14mm < 0.25 → 消除
    d.keepouts = [
      { x: 15.25, y: 8.35, w: 2, h: 4.7 },   // y 6.0 .. 10.7
      { x: 15.25, y: 14.1, w: 2, h: 5.6 },   // y 11.3 .. 16.9
    ];
    const r = { nets: [{ netId: 'gnd', paths: [], vias: [] }] };
    return core.computePour(d, r, { layer: 1, netId: 'gnd', thermal: false, minWidth });
  };
  const strict = mk(0.25), loose = mk(0.05);
  assert.equal(core.pourContains(strict, 15.25, 11.0), false, '0.25 口径下 0.14mm 铜颈已消除');
  assert.equal(core.pourContains(loose, 15.25, 11.0), true, '关闭消除时铜颈保留（对照）');
  assert(strict.minWidth === 0.25 && loose.minWidth === 0.05, 'minWidth 回传');
  // 间距契约在开运算后依然成立（开运算 ⊆ 原集合，边界只缩不涨）
  const k1 = { x: 15.25, y: 8.35, w: 2, h: 4.7 }, k2 = { x: 15.25, y: 14.1, w: 2, h: 5.6 };
  for (const s of boundarySamples(strict))
    for (const k of [k1, k2])
      assert(core.distToRect(s.x, s.y, k.x, k.y, k.w, k.h) >= 0.2 - 1e-6,
        `边界点 (${s.x.toFixed(2)},${s.y.toFixed(2)}) 距禁布区 < clearance`);
});

test('同网重铺：islandMode 旗标获胜（KiCad/Altium 同网 zone 独立填充）', () => {
  const d = design();
  d.pads = [{ id: 'G1-1', netId: 'gnd', x: 5, y: 10, w: 1.2, h: 1.6, layer: 'bottom' }];
  d.keepouts = [{ x: 15.25, y: 10, w: 2, h: 20 }];
  const r = { nets: [{ netId: 'gnd', paths: [], vias: [] }] };
  // 第一遍 never：右侧孤岛保留
  const pour1 = core.computePour(d, r, { layer: 1, netId: 'gnd', thermal: false, islandMode: 'never' });
  assert(pour1.islandsKept >= 1 && core.pourContains(pour1, 22, 10), '前置：旧铜皮含保留孤岛');
  // 重铺 always（带旧铜皮）：孤岛必须被清理——旗标获胜，不被旧铜皮 seed 救回
  const pour2 = core.computePour(d, r, { layer: 1, netId: 'gnd', thermal: false, islandMode: 'always', avoidPours: [pour1] });
  assert.equal(core.pourContains(pour2, 22, 10), false, '重铺 always：旧保留孤岛被清理');
  assert(pour2.islands >= 1, '清理计入孤岛统计');
  // 重铺 never（带旧铜皮）：孤岛照常保留（全新计算后由 islandMode 裁决）
  const pour3 = core.computePour(d, r, { layer: 1, netId: 'gnd', thermal: false, islandMode: 'never', avoidPours: [pour1] });
  assert.equal(core.pourContains(pour3, 22, 10), true, '重铺 never：孤岛照常保留');
  assert(pour3.islandsKept >= 1, '保留计数正确');
});

test('spokeW < minWidth → 实心连接兜底（KiCad "no stubs < min thickness"）', () => {
  const d = design();
  d.pads = [{ id: 'G1-1', netId: 'gnd', x: 15, y: 10, w: 1.2, h: 1.6, layer: 'bottom' }];
  const r = { nets: [{ netId: 'gnd', paths: [], vias: [] }] };
  const fallback = core.computePour(d, r, { layer: 1, netId: 'gnd', thermal: true, spokeW: 0.15, minWidth: 0.25 });
  assert.equal(fallback.thermalActive, false, '兜底触发标记');
  assert.equal(fallback.polys.flatMap(p => p.holes).length, 0, '无热焊盘开窗孔（实心连接）');
  const solid = core.computePour(d, r, { layer: 1, netId: 'gnd', thermal: false, minWidth: 0.25 });
  assert.deepEqual(fallback.unconnectedPads, [], '实心连接焊盘必然接入');
  assert(Math.abs(fallback.area - solid.area) < 1e-6, `兜底面积=实心面积（${fallback.area.toFixed(2)} vs ${solid.area.toFixed(2)}）`);
  // 正常筋条不受影响
  const normal = core.computePour(d, r, { layer: 1, netId: 'gnd', thermal: true, spokeW: 0.3, minWidth: 0.25 });
  assert.equal(normal.thermalActive, true, '0.3 筋条正常开窗');
  assert(normal.polys.flatMap(p => p.holes).length > 0, '有热焊盘孔');
});

test('网格铜：最坏位置过孔（四空格角点）仍连通为单一铜皮', () => {
  const d = design();
  d.pads = [{ id: 'G1-1', netId: 'gnd', x: 5, y: 10, w: 1.2, h: 1.6, layer: 'bottom' }];
  const r = { nets: [{ netId: 'gnd', paths: [], vias: [] }] };
  // 过孔圆盘 Ø0.8 > 网格周期 0.508 → 任何位置必跨条纹；放在四空格角点最坏情形验证
  const via = { x: 3 * (0.254 + 0.254) + 0.254, y: 6 * 0.508 + 0.254 };   // 条纹对齐原点
  const rr = { nets: [{ netId: 'gnd', paths: [[{ x: 5, y: 10, l: 1 }, { x: 8, y: 10, l: 1 }]], vias: [via] }] };
  const grid = core.computePour(d, rr, { layer: 1, netId: 'gnd', thermal: true, fill: 'grid' });
  assert.equal(grid.polys.length, 1, `应为单一连通铜皮（got ${grid.polys.length} 块外环）`);
  assert.equal(core.pourContains(grid, via.x, via.y), true, '过孔盘是铜');
});

test('网格铜缝合孔吸附条纹：覆盖率追平实心且全部落条纹', () => {
  const d = design();
  d.width = 50; d.height = 40;
  d.pads = [{ id: 'G1-1', netId: 'gnd', x: 8, y: 20, w: 1.2, h: 1.6, layer: 'bottom' }];
  const r = { nets: [{ netId: 'gnd', paths: [], vias: [] }] };
  const grid = core.computePour(d, r, { layer: 1, netId: 'gnd', thermal: true, fill: 'grid' });
  const solid = core.computePour(d, r, { layer: 1, netId: 'gnd', thermal: true });
  const gPts = core.planStitching(d, r, grid, 5);
  const sPts = core.planStitching(d, r, solid, 5);
  assert(gPts.length >= sPts.length * 0.9, `吸附后覆盖应追平实心（grid ${gPts.length} vs solid ${sPts.length}）`);
  const P = grid.gridW + grid.gridGap;
  for (const p of gPts) {
    assert((p.x % P) < grid.gridW + 1e-9 && (p.y % P) < grid.gridW + 1e-9, `缝合孔 (${p.x},${p.y}) 应落在条纹上`);
    assert.equal(core.pourContains(grid, p.x, p.y), true, '缝合孔在铜皮内');
  }
  // 无重复
  assert.equal(new Set(gPts.map(p => p.x + '_' + p.y)).size, gPts.length, '吸附去重');
});
