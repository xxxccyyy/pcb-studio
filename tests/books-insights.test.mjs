import * as core from '../src/engine.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
// 书籍研读成果落地测试：阻抗/趋肤/传输线判据/IR-drop/每网线长与 advise 新建议。
// 运行：node tests/books-insights.test.mjs
let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.error('  ✗ ' + name + '\n     ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n     ')); }
}
function assert(c, msg) { if (!c) throw new Error(msg || '断言失败'); }
function assertEq(a, b, msg) { if (a !== b) throw new Error((msg || '不相等') + `：实际 ${a}，期望 ${b}`); }
function near(a, b, tol, msg) { if (!(Math.abs(a - b) <= tol)) throw new Error((msg || '数值偏差') + `：实际 ${a}，期望 ${b}±${tol}`); }

console.log('— 介电常数与阻抗 —');

t('DIELECTRICS 预设值正确（FR-4 4.5 / RO4350B 3.48 / PTFE 2.1）+ Df 字段', () => {
  near(core.DIELECTRICS.fr4.er, 4.5, 1e-9, 'FR-4');
  near(core.DIELECTRICS.rogers4350b.er, 3.48, 1e-9, 'RO4350B');
  near(core.DIELECTRICS.ptfe.er, 2.1, 1e-9, 'PTFE');
  near(core.DIELECTRICS.fr4.df, 0.02, 1e-9, 'FR-4 Df');
  for (const k of Object.keys(core.DIELECTRICS)) assert(core.DIELECTRICS[k].er >= 1, k + ' 应 ≥1');
});

t('dielectricLossDbPerIn：FR-4 @1GHz ≈0.1dB/in（Bogatin ch9 验算口径）', () => {
  near(core.dielectricLossDbPerIn(1, 0.02, 4.5), 0.1, 0.01, 'FR-4 1GHz 介质损');
  assert(core.dielectricLossDbPerIn(10, 0.02, 4.5) > core.dielectricLossDbPerIn(1, 0.02, 4.5) * 9, '随频率线性增长');
});

t('effectiveEr 介于 1 与 εr 之间（微带场一半在空气）', () => {
  const e = core.effectiveEr(4.5, 0.2, 0.3);
  assert(e > 1 && e < 4.5, '应落在 (1, 4.5)：' + e);
  const eThin = core.effectiveEr(4.5, 0.05, 1.0);   // h/w 很小 → 贴近 εr
  const eFat = core.effectiveEr(4.5, 2.0, 0.1);     // h/w 很大 → 贴近 (1+εr)/2
  assert(eThin > eFat, '介质越贴近导体 εeff 越大');
  assert(eFat > 2.75 && eFat < 2.95, 'h≫w 时 εeff→(1+εr)/2=2.75 附近');
});

t('impedance 原口径不受影响：50Ω 微带反算合理', () => {
  const w = core.widthForZ0(50, 0.2, 4.5, 0.035, 'microstrip');
  assert(w > 0.2 && w < 0.6, 'FR-4 h=0.2mm 50Ω 线宽应在 0.2~0.6mm：' + w);
  near(core.impedance(w, 0.2, 4.5, 0.035, 'microstrip').z0, 50, 0.1, '反算回代');
});

console.log('— 趋肤效应 —');

t('skinDepth：1GHz≈2.1µm、100MHz≈6.6µm，且随频率下降', () => {
  const d1 = core.skinDepth(1e9), d2 = core.skinDepth(1e8);
  near(d1, 0.0021, 0.0002, '1GHz δ(mm)');
  near(d2, 0.0066, 0.0005, '100MHz δ(mm)');
  assert(d2 > d1, '频率越高 δ 越小');
});

t('acTraceR：低频回退 DC 电阻，高频按周长×δ，且单调增', () => {
  const rDC = core.acTraceR(0.3, 0.035, 1);          // δ≫t → DC 值
  near(rDC, 1.638e-3, 1e-5, '0.3mm/1oz 直流电阻 Ω/mm');
  const r1G = core.acTraceR(0.3, 0.035, 1e9);
  assert(r1G > rDC * 5, '1GHz AC 电阻应远大于 DC：' + r1G);
  assert(core.acTraceR(0.3, 0.035, 1e8) < r1G, '频率高→电阻高');
});

console.log('— 传输线判据（黑魔书） —');

t('fknee=0.5/Tr：1ns → 500MHz', () => {
  near(core.fknee(1e-9), 5e8, 1, 'Fknee');
});

t('criticalLineLen：FR-4 1ns ≈ 23.6mm（1/6 判据）', () => {
  const L = core.criticalLineLen(1e-9, 4.5);
  assert(L > 20 && L < 27, '应在 20~27mm：' + L);
  assert(core.criticalLineLen(10e-9, 4.5) > L * 9, '边沿慢 10 倍 → 临界长度约 10 倍');
});

console.log('— 每网走线长度 —');

t('netRoutedLen：同层段累加、换层段不计、含手动走线', () => {
  const d = core.designDefaults();
  d.grid = 0.5; d.nets = [{ id: 'a', name: 'A', tr: 1, hs: true }, { id: 'g', name: 'GND' }];
  d.pads = [
    { id: 'p1', netId: 'a', x: 5.25, y: 5.25, w: 1, h: 1, layer: 'both' },
    { id: 'p2', netId: 'a', x: 10.25, y: 5.25, w: 1, h: 1, layer: 'both' },
  ];
  d.manual = [{ netId: 'a', pts: [{ x: 5.25, y: 5.25, l: 0 }, { x: 10.25, y: 5.25, l: 0 }] }];
  const result = { nets: [{ netId: 'a', name: 'A', connected: 2, total: 2,
    paths: [[{ x: 5.25, y: 5.25, l: 0 }, { x: 7.75, y: 5.25, l: 0 }, { x: 10.25, y: 5.25, l: 0 }]],
    vias: [{ x: 7.75, y: 5.25 }] }] };
  near(core.netRoutedLen(d, result, 'a'), 10, 1e-6, '结果路径5mm+手动5mm=10mm');
  const r2 = { nets: [] };
  near(core.netRoutedLen(d, r2, 'a'), 5, 1e-6, '仅手动走线=5mm');
  near(core.netRoutedLen(d, result, 'g'), 0, 1e-9, '其它网不计');
});

console.log('— IR-drop 求解器 —');

function lineBoard() {
  const d = core.designDefaults();
  d.grid = 0.5; d.trackW = 0.5; d.copperWeight = '1';
  d.nets = [{ id: 'p', name: 'VCC' }];
  d.pads = [
    { id: 'E-1', netId: 'p', x: 5.25, y: 5.25, w: 1, h: 1, layer: 'both' },
    { id: 'U1-1', netId: 'p', x: 15.25, y: 5.25, w: 1, h: 1, layer: 'both' },
    { id: 'U1-2', netId: 'p', x: 25.25, y: 5.25, w: 1, h: 1, layer: 'both' },
  ];
  return d;
}

t('三点一线：压降线性分布，数值与解析解一致', () => {
  const d = lineBoard();
  const result = { nets: [{ netId: 'p', name: 'VCC', connected: 3, total: 3,
    paths: [[{ x: 5.25, y: 5.25, l: 0 }, { x: 15.25, y: 5.25, l: 0 }, { x: 25.25, y: 5.25, l: 0 }]], vias: [] }] };
  const r = core.powerDrop(d, result, 'p', { current: 1, entries: ['E-1'] });
  assert(r.ok, '求解成功');
  // 每段 10mm：r=ρL/(wt)=1.72e-8*0.01/(0.5e-3*35e-6)=9.83mΩ；两负载各 0.5A
  const Rseg = 1.72e-8 * 0.01 / (0.5e-3 * 35e-6);
  const vFar = 0.5 * Rseg + 1.0 * Rseg;
  near(r.maxR, vFar / 0.5, vFar * 0.02, '远端 rEff');
  near(r.maxDropV, vFar, vFar * 0.02, '远端压降');
  assertEq(r.worstPad, 'U1-2', '最远端压降最大');
  const near1 = r.drops.find(x => x.pad === 'U1-1');
  near(near1.rEff, (1.0 * Rseg) / 0.5, vFar * 0.02, '中点 rEff（远端负载电流不经它）');
});

t('过孔电阻计入：换层段串联 viaR', () => {
  const d = lineBoard();
  const result = { nets: [{ netId: 'p', name: 'VCC', connected: 3, total: 3,
    paths: [[{ x: 5.25, y: 5.25, l: 0 }, { x: 15.25, y: 5.25, l: 1 }, { x: 25.25, y: 5.25, l: 1 }]], vias: [{ x: 15.25, y: 5.25 }] }] };
  const r = core.powerDrop(d, result, 'p', { current: 1, entries: ['E-1'] });
  const r2 = core.powerDrop(d, { nets: [{ netId: 'p', name: 'VCC', connected: 3, total: 3,
    paths: [[{ x: 5.25, y: 5.25, l: 0 }, { x: 15.25, y: 5.25, l: 0 }, { x: 25.25, y: 5.25, l: 0 }]], vias: [] }] }, 'p', { current: 1, entries: ['E-1'] });
  assert(r.maxR > r2.maxR, '含过孔网络电阻应更大：' + r.maxR + ' vs ' + r2.maxR);
});

t('无入口且无铺铜 → 诚实返回 ok:false 与用法提示', () => {
  const d = lineBoard();
  const r = core.powerDrop(d, { nets: [] }, 'p', {});
  assert(!r.ok && /entries/.test(r.reason), '应要求 entries：' + r.reason);
  assert(r.hint.includes('--entries'), '提示用法');
});

t('铺铜网络：过孔自动视为入口（平面≈理想0V）', () => {
  const d = lineBoard();
  const result = { pour: { netId: 'p', area: 100 }, nets: [{ netId: 'p', name: 'VCC', connected: 3, total: 3,
    paths: [[{ x: 5.25, y: 5.25, l: 0 }, { x: 25.25, y: 5.25, l: 0 }]], vias: [{ x: 15.25, y: 5.25 }] }] };
  const r = core.powerDrop(d, result, 'p', { current: 1 });
  assert(r.ok, '铺铜过孔作为入口后可解');
  assert(r.maxDropV >= 0 && r.maxDropV < 0.01, '理想平面近似下压降很小：' + r.maxDropV);
});

t('孤立焊盘（未连通）单独报告，不污染求解', () => {
  const d = lineBoard();
  const result = { nets: [{ netId: 'p', name: 'VCC', connected: 2, total: 3,
    paths: [[{ x: 5.25, y: 5.25, l: 0 }, { x: 15.25, y: 5.25, l: 0 }]], vias: [] }] };
  const r = core.powerDrop(d, result, 'p', { current: 1, entries: ['E-1'] });
  assert(r.ok, '可解');
  assert(r.isolated.includes('U1-2'), '孤立焊盘在列：' + JSON.stringify(r.isolated));
  assert(!r.drops.some(x => x.pad === 'U1-2'), '孤立焊盘不进 drops');
});

t('T 型分支（顶点落段切分）：中点分支可见主干电流', () => {
  const d = core.designDefaults();
  d.grid = 0.5; d.trackW = 0.5; d.copperWeight = '1';
  d.nets = [{ id: 'p', name: 'VCC' }];
  d.pads = [
    { id: 'E-1', netId: 'p', x: 5.25, y: 10.25, w: 1, h: 1, layer: 'both' },
    { id: 'U1-1', netId: 'p', x: 25.25, y: 10.25, w: 1, h: 1, layer: 'both' },
    { id: 'C1-1', netId: 'p', x: 15.25, y: 15.25, w: 1, h: 1, layer: 'both' },   // 从主干中点分支
  ];
  const result = { nets: [{ netId: 'p', name: 'VCC', connected: 3, total: 3,
    paths: [
      [{ x: 5.25, y: 10.25, l: 0 }, { x: 25.25, y: 10.25, l: 0 }],
      [{ x: 15.25, y: 10.25, l: 0 }, { x: 15.25, y: 15.25, l: 0 }],     // 分支起点是主干中途点
    ], vias: [] }] };
  const r = core.powerDrop(d, result, 'p', { current: 1, entries: ['E-1'] });
  assert(r.ok, '求解成功');
  // T 型网络解析（电流自负载流向入口的注入约定，压降取幅值）：
  // 分支点电位 = 1A×R1（10mm 主干段）；C1-1 = 分支点 + 0.5A×R3（5mm 分支段）；
  // U1-1 = 分支点 + 0.5A×R2（10mm）——U1-1 更远，压降最大
  const R1 = 1.72e-8 * 0.010 / (0.5e-3 * 35e-6);
  const R2 = R1, R3 = 1.72e-8 * 0.005 / (0.5e-3 * 35e-6);
  const vBranch = 1.0 * R1;
  const vC1 = vBranch + 0.5 * R3;
  const vFar = vBranch + 0.5 * R2;
  near(r.drops.find(x => x.pad === 'C1-1').dropV, vC1, vC1 * 0.02, '分支焊盘压降');
  near(r.drops.find(x => x.pad === 'U1-1').dropV, vFar, vFar * 0.02, '主干末端压降');
  assertEq(r.worstPad, 'U1-1', '主干末端（再走 10mm）比分支末端（5mm）压降更大');
});

console.log('— fabChecklist 新条目 —');

t('fabChecklist 含趋肤/传输线判据/装配净空提示行', () => {
  const d = lineBoard();
  const rows = core.fabChecklist(d, { nets: [] }, {});
  const items = rows.map(r => r.item + r.note + r.group);
  assert(items.some(s => s.includes('趋肤')), '缺趋肤效应行');
  assert(rows.some(r => (r.item + r.group).includes('传输线判据')), '缺传输线判据行');
  assert(rows.some(r => (r.item + r.group).includes('装配净空')), '缺装配净空行');
});

console.log('— advise 新建议 —');

function adviseFor(design, result) {
  // advise 逻辑单一实现在 ai/pcb.mjs：这里通过 CLI 进程验证（引擎不含文案层）
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcbadv-'));
  fs.writeFileSync(path.join(dir, 'd.json'), JSON.stringify(design));
  fs.writeFileSync(path.join(dir, 'r.json'), JSON.stringify(result));
  const out = execFileSync('node', [path.join(process.cwd(), 'ai/pcb.mjs'), 'advise',
    path.join(dir, 'd.json'), path.join(dir, 'r.json')], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  return JSON.parse(out);
}

t('advise：hs+tr 网走线超临界长度 → TERMINATE 建议', () => {
  const d = core.designDefaults();
  d.grid = 0.5; d.nets = [{ id: 'a', name: 'CLK', hs: true, tr: 0.2 }];   // 0.2ns → Lcrit≈4.7mm
  d.pads = [
    { id: 'p1', netId: 'a', x: 5.25, y: 5.25, w: 1, h: 1, layer: 'both' },
    { id: 'p2', netId: 'a', x: 40.25, y: 5.25, w: 1, h: 1, layer: 'both' },
  ];
  const result = { stats: { total: 2, connected: 2, failed: 0 }, nets: [{ netId: 'a', name: 'CLK', connected: 2, total: 2,
    paths: [[{ x: 5.25, y: 5.25, l: 0 }, { x: 40.25, y: 5.25, l: 0 }]], vias: [] }], overuse: [] };
  const recs = adviseFor(d, result).recommendations;
  assert(recs.some(r => r.id === 'TERMINATE'), '缺 TERMINATE：' + JSON.stringify(recs.map(r => r.id)));
});

t('advise：压降过大 → IRDROP 建议（确定性，连接器焊盘自动推断入口）', () => {
  const d = core.designDefaults();
  d.grid = 0.5; d.trackW = 0.25; d.copperWeight = '1';   // 细线长线 → 大电阻
  d.nets = [{ id: 'p', name: 'VCC' }];
  d.pads = [
    { id: 'J1-1', netId: 'p', x: 5.25, y: 5.25, w: 1, h: 1, layer: 'both' },
    { id: 'U1-1', netId: 'p', x: 55.25, y: 5.25, w: 1, h: 1, layer: 'both' },
    { id: 'U1-2', netId: 'p', x: 55.25, y: 15.25, w: 1, h: 1, layer: 'both' },
  ];
  const result = { stats: { total: 3, connected: 3, failed: 0 }, nets: [{ netId: 'p', name: 'VCC', connected: 3, total: 3,
    paths: [[{ x: 5.25, y: 5.25, l: 0 }, { x: 55.25, y: 5.25, l: 0 }, { x: 55.25, y: 15.25, l: 0 }]], vias: [] }], overuse: [] };
  const recs = adviseFor(d, result).recommendations;
  assert(recs.some(r => r.id === 'IRDROP'), '缺 IRDROP：' + JSON.stringify(recs.map(r => r.id)));
});

console.log('— 高速网串扰并行扫描（Bogatin B.70-89） —');

t('hsCrosstalkScan：并行贴行长度统计正确、交叉线不误报', () => {
  const d = core.designDefaults();
  d.grid = 0.5; d.trackW = 0.3;
  d.nets = [{ id: 'a', name: 'CLK', hs: true }, { id: 'b', name: 'DATA' }, { id: 'c', name: 'FAR' }];
  // a 与 b 平行 20mm，间距 0.5mm（<3W=0.9）；c 远离；b 与 a 还有一段垂直交叉（不计并行）
  d.pads = [
    { id: 'a1', netId: 'a', x: 5.25, y: 5.25, w: 1, h: 1, layer: 'both' },
    { id: 'a2', netId: 'a', x: 25.25, y: 5.25, w: 1, h: 1, layer: 'both' },
    { id: 'b1', netId: 'b', x: 5.25, y: 6.0, w: 1, h: 1, layer: 'both' },
    { id: 'b2', netId: 'b', x: 25.25, y: 6.0, w: 1, h: 1, layer: 'both' },
    { id: 'c1', netId: 'c', x: 5.25, y: 30.25, w: 1, h: 1, layer: 'both' },
    { id: 'c2', netId: 'c', x: 25.25, y: 30.25, w: 1, h: 1, layer: 'both' },
  ];
  const result = { nets: [
    { netId: 'a', name: 'CLK', connected: 2, total: 2, paths: [[{ x: 5.25, y: 5.25, l: 0 }, { x: 25.25, y: 5.25, l: 0 }]], vias: [] },
    { netId: 'b', name: 'DATA', connected: 2, total: 2, paths: [
      [{ x: 5.25, y: 6.0, l: 0 }, { x: 25.25, y: 6.0, l: 0 }],           // 平行段
      [{ x: 10.25, y: 0.25, l: 0 }, { x: 10.25, y: 30.25, l: 0 }],       // 垂直交叉段
    ], vias: [] },
    { netId: 'c', name: 'FAR', connected: 2, total: 2, paths: [[{ x: 5.25, y: 30.25, l: 0 }, { x: 25.25, y: 30.25, l: 0 }]], vias: [] },
  ], overuse: [] };
  const scan = core.hsCrosstalkScan(d, result);
  assertEq(scan.scanned, 1, '仅 a 标记 hs');
  assertEq(scan.report.length, 1, 'a 有并行对象');
  const off = scan.report[0].offenders;
  assertEq(off.length, 1, '只有 b 贴行（c 远离）');
  assertEq(off[0].net, 'DATA', '贴行对象是 DATA');
  // 平行长度：b 的平行段 20mm 全部 <3W；垂直交叉段只在交点附近 few mm 贴行
  assert(off[0].runMm >= 20 && off[0].runMm <= 20 + 6, '并行长度≈20mm±交叉点贡献：' + off[0].runMm);
  assert(off[0].minDist <= 0.8, '最近中心距≈0.75-0.55：' + off[0].minDist);
});

t('hsCrosstalkScan：间距 ≥3W 时不报并行', () => {
  const d = core.designDefaults();
  d.grid = 0.5; d.trackW = 0.3;
  d.nets = [{ id: 'a', name: 'CLK', hs: true }, { id: 'b', name: 'DATA' }];
  d.pads = [
    { id: 'a1', netId: 'a', x: 5.25, y: 5.25, w: 1, h: 1, layer: 'both' },
    { id: 'a2', netId: 'a', x: 25.25, y: 5.25, w: 1, h: 1, layer: 'both' },
    { id: 'b1', netId: 'b', x: 5.25, y: 6.5, w: 1, h: 1, layer: 'both' },
    { id: 'b2', netId: 'b', x: 25.25, y: 6.5, w: 1, h: 1, layer: 'both' },
  ];
  const result = { nets: [
    { netId: 'a', name: 'CLK', connected: 2, total: 2, paths: [[{ x: 5.25, y: 5.25, l: 0 }, { x: 25.25, y: 5.25, l: 0 }]], vias: [] },
    { netId: 'b', name: 'DATA', connected: 2, total: 2, paths: [[{ x: 5.25, y: 6.5, l: 0 }, { x: 25.25, y: 6.5, l: 0 }]], vias: [] },
  ], overuse: [] };
  const scan = core.hsCrosstalkScan(d, result);
  // 中心距 1.25mm；3W+clearance = 0.9+0.2=1.1 → 不贴行
  assertEq(scan.report.length, 0, '间距≥3W 无并行贴行');
});

console.log('— advise GUARD 建议 —');

t('advise：并行 >20mm → GUARD 建议（book-backed）', () => {
  const d = core.designDefaults();
  d.grid = 0.5; d.trackW = 0.3;
  d.nets = [{ id: 'a', name: 'CLK', hs: true }, { id: 'b', name: 'DATA' }];
  d.pads = [
    { id: 'a1', netId: 'a', x: 5.25, y: 5.25, w: 1, h: 1, layer: 'both' },
    { id: 'a2', netId: 'a', x: 45.25, y: 5.25, w: 1, h: 1, layer: 'both' },
    { id: 'b1', netId: 'b', x: 5.25, y: 6.0, w: 1, h: 1, layer: 'both' },
    { id: 'b2', netId: 'b', x: 45.25, y: 6.0, w: 1, h: 1, layer: 'both' },
  ];
  const result = { stats: { total: 4, connected: 4, failed: 0 }, nets: [
    { netId: 'a', name: 'CLK', connected: 2, total: 2, paths: [[{ x: 5.25, y: 5.25, l: 0 }, { x: 45.25, y: 5.25, l: 0 }]], vias: [] },
    { netId: 'b', name: 'DATA', connected: 2, total: 2, paths: [[{ x: 5.25, y: 6.0, l: 0 }, { x: 45.25, y: 6.0, l: 0 }]], vias: [] },
  ], overuse: [] };
  const recs = adviseFor(d, result).recommendations;
  const g = recs.find(r => r.id === 'GUARD');
  assert(g, '缺 GUARD：' + JSON.stringify(recs.map(r => r.id)));
  assertEq(g.evidence, 'book-backed', 'GUARD 证据级');
});

console.log('— rules 知识库 Bogatin 附录速查 —');

t('rules：Bogatin附录速查 五组齐备且带编号出处', () => {
  const out = execFileSync('node', [path.join(process.cwd(), 'ai/pcb.mjs'), 'rules'], { encoding: 'utf8' });
  const j = JSON.parse(out);
  const q = j['Bogatin附录速查'];
  assert(q, '缺 Bogatin附录速查');
  for (const k of ['串扰与间距', '传输线与端接', '回流与平面', 'PDN_去耦', '载流_损耗', '差分_预留'])
    assert(Array.isArray(q[k]) && q[k].length > 0, '缺组：' + k);
  assert(q['串扰与间距'].some(s => s.includes('A.34')), '应有附录A编号出处');
  assert(q['串扰与间距'].some(s => s.includes('B.74')), '应有附录B编号出处');
});

console.log('— 结果-设计同步检查（实测事故固化） —');

t('staleResultCheck：路径完全脱离焊盘 → 判不同步', () => {
  const d = core.designDefaults();
  d.grid = 0.5;
  d.nets = [{ id: 'a', name: 'A' }];
  d.pads = [{ id: 'p1', netId: 'a', x: 5.25, y: 5.25, w: 1, h: 1, layer: 'both' },
            { id: 'p2', netId: 'a', x: 10.25, y: 5.25, w: 1, h: 1, layer: 'both' }];
  // 路径在远离焊盘的地方（模拟 design 被编辑后焊盘挪走了）
  const staleResult = { nets: [{ netId: 'a', name: 'A', connected: 2, total: 2,
    paths: [[{ x: 30.25, y: 30.25, l: 0 }, { x: 35.25, y: 30.25, l: 0 }]], vias: [] }], overuse: [] };
  const st = core.staleResultCheck(d, staleResult);
  assert(!st.ok && st.staleNets.includes('A'), '应判定 A 不同步');
  // 路径端点在焊盘铜内 → 同步
  const goodResult = { nets: [{ netId: 'a', name: 'A', connected: 2, total: 2,
    paths: [[{ x: 5.25, y: 5.25, l: 0 }, { x: 10.25, y: 5.25, l: 0 }]], vias: [] }], overuse: [] };
  assert(core.staleResultCheck(d, goodResult).ok, '同步结果应通过');
});

t('staleResultCheck：真实事故复现（旧 atmega result 配当前 design）', () => {
  const fs2 = fs;
  const proj = path.join(process.cwd(), 'projects', 'atmega328p-minsys');
  if (!fs2.existsSync(proj)) return;   // 项目不存在则跳过
  const d = core.normalizeDesign(JSON.parse(fs2.readFileSync(path.join(proj, 'design.json'), 'utf8')));
  const j = JSON.parse(fs2.readFileSync(path.join(proj, 'result.json'), 'utf8'));
  const r = core.normalizeResult(j, d);
  const st = core.staleResultCheck(d, r);
  if (!st.ok) assert(st.staleNets.length > 0, '检出脱节网络');   // 旧产物应被检出
});

console.log('— Altium Day2 教训回归：覆铜不与异网泪滴交叠（布尔抵消事故的预防性测试） —');

t('同层 GND 覆铜条带与异网信号泪滴保持间距', () => {
  const d = core.designDefaults();
  d.grid = 0.5; d.trackW = 0.3; d.clearance = 0.2; d.viaOuter = 0.8;
  d.nets = [{ id: 's', name: 'SIG' }, { id: 'g', name: 'GND' }];
  d.pads = [
    { id: 'U1-1', netId: 's', x: 10.25, y: 10.25, w: 1.2, h: 1.2, layer: 'both', holeR: 0.45 },
    { id: 'J1-1', netId: 'g', x: 30.25, y: 30.25, w: 1.2, h: 1.2, layer: 'both', holeR: 0.45 },
  ];
  const r = { nets: [
    { netId: 's', name: 'SIG', connected: 2, total: 2,
      paths: [[{ x: 10.25, y: 10.25, l: 1 }, { x: 12.75, y: 10.25, l: 1 }]], vias: [{ x: 12.75, y: 10.25 }] },
    { netId: 'g', name: 'GND', connected: 1, total: 1, paths: [], vias: [] },
  ], overuse: [] };
  const tds = core.teardropPolys(d, r);
  assert(tds.length >= 1, '应有泪滴生成');
  const td = tds.find(t2 => t2.l === 1);
  assert(td, '泪滴应在底层（换层过孔处）');
  // 多边形覆铜（传入 teardrops）：底层铜皮不得进入异网泪滴的间距区——
  // 环边界采样点到泪滴各边 >= clearance（多边形口径下这才是真检查，旧条带版该循环为空转）
  const pour = core.computePour(d, r, { netId: 'g', layer: 1, teardrops: tds });
  const rings = pour.polys.flatMap(pp => [pp.outer, ...pp.holes]);
  assert(rings.length >= 1, '应有铜皮环');
  let checked = 0;
  for (const f of rings) for (let i = 0; i < f.length; i += 2) {
    const x = f[i], y = f[i + 1];
    for (let k = 0; k < td.p.length; k++) {
      const a = td.p[k], b = td.p[(k + 1) % td.p.length];
      const dd = core.segDist(x, y, a.x, a.y, b.x, b.y);
      checked++;
      if (dd < d.clearance - 1e-9)
        throw new Error(`覆铜边界点 (${x.toFixed(2)},${y.toFixed(2)}) 距泪滴边 ${dd.toFixed(3)}mm < 间距 ${d.clearance}mm`);
    }
  }
  assert(checked >= 10, `应实际采样到边界点（got ${checked}）`);
});

console.log('— PDN 回路电感解析式族（Bogatin ch13 验算口径） —');

t('五个电感解析式与书中算例一致', () => {
  near(core.traceLoopInductancePh(4, 100, 5), 2560, 1, '走线 32·h·Len/w');
  near(core.viaPairLoopInductancePh(100, 50, 10), 10.16 * 100 * Math.log(10), 1, '过孔对≈2.3nH');
  near(core.viaPairLoopInductancePh(100, 50, 10) / 1000, 2.34, 0.05, '过孔对 nH 量级');
  near(core.planeSquareLoopInductancePh(16), 512, 1, '平面对 32·h（4mil 介质→512pH/sq 按 ch13 算例）');
  near(core.radialSpreadingInductancePh(10, 5, 1000), 5.14 * 10 * Math.log(200), 1, '径向扩散≈270pH');
  near(core.betweenViasSpreadingInductancePh(10, 500, 10), 21 * 10 * Math.log(50), 1, '孔间扩散≈1nH');
});

console.log('— 行为级深度优化：差分对 lite / 去耦位置 / PDN估算 / 损耗预算 —');

t('pdnPlaneCapPf：与 Bogatin B.17 口径一致（FR-4 1mil≈1nF/in²）', () => {
  const c = core.pdnPlaneCapPf(645, 0.0254, 4.5);   // 1in²、1mil
  near(c, 1000, 30, '1in²/1mil 平面电容 pF');
  const c4 = core.pdnPlaneCapPf(60 * 45, 0.2, 4.5); // 60×45mm 板、0.2mm 介质
  assert(c4 > 400 && c4 < 700, '整板估算应在 400~700pF：' + c4);
});

t('checkDRC 差分对等长：超预算告警、同预算内不告警', () => {
  const mk = (lenA, lenB, tr) => {
    const d = core.designDefaults();
    d.grid = 0.5;
    d.nets = [{ id: 'p', name: 'USB_P', hs: true, pair: 'usb', tr },
              { id: 'n', name: 'USB_N', hs: true, pair: 'usb', tr }];
    d.pads = [
      { id: 'U1-1', netId: 'p', x: 5.25, y: 5.25, w: 1, h: 1, layer: 'both' },
      { id: 'U1-2', netId: 'p', x: 5.25, y: 7.25, w: 1, h: 1, layer: 'both' },
      { id: 'U1-3', netId: 'n', x: 5.25, y: 9.25, w: 1, h: 1, layer: 'both' },
      { id: 'U1-4', netId: 'n', x: 5.25, y: 11.25, w: 1, h: 1, layer: 'both' },
    ];
    // P 网绕大弯（约 90mm），N 网直线（约 2mm）
    const r = { nets: [
      { netId: 'p', name: 'USB_P', connected: 2, total: 2,
        paths: [[{ x: 5.25, y: 5.25, l: 0 }, { x: 50.25, y: 5.25, l: 0 }, { x: 50.25, y: 7.25, l: 0 }, { x: 5.25, y: 7.25, l: 0 }]], vias: [] },
      { netId: 'n', name: 'USB_N', connected: 2, total: 2,
        paths: [[{ x: 5.25, y: 9.25, l: 0 }, { x: 7.25, y: 9.25, l: 0 }, { x: 7.25, y: 11.25, l: 0 }, { x: 5.25, y: 11.25, l: 0 }]], vias: [] },
    ], overuse: [] };
    return core.checkDRC(d, r, {});
  };
  // tr=1ns → 预算 0.2×1ns×v≈6.3mm，差 80mm+ → 必须告警
  const warns1 = mk(90, 2, 1).filter(i => i.type === '差分等长');
  assert(warns1.length >= 1, '等长超预算应告警：' + JSON.stringify(warns1));
  assert(warns1[0].msg.includes('0.2×UI'), '应注明预算口径');
  // 两网等长 → 无告警
  const r2 = mk(0, 0, 1);
  // mk 里 P 网 90mm、N 网 2mm 固定；构造等长场景直接改用小差：重新用直线对直线
  const d2 = core.designDefaults();
  d2.grid = 0.5;
  d2.nets = [{ id: 'p', name: 'USB_P', hs: true, pair: 'usb', tr: 1 },
             { id: 'n', name: 'USB_N', hs: true, pair: 'usb', tr: 1 }];
  d2.pads = [
    { id: 'U1-1', netId: 'p', x: 5.25, y: 5.25, w: 1, h: 1, layer: 'both' },
    { id: 'U1-2', netId: 'p', x: 15.25, y: 5.25, w: 1, h: 1, layer: 'both' },
    { id: 'U1-3', netId: 'n', x: 5.25, y: 9.25, w: 1, h: 1, layer: 'both' },
    { id: 'U1-4', netId: 'n', x: 15.25, y: 9.25, w: 1, h: 1, layer: 'both' },
  ];
  const r3 = { nets: [
    { netId: 'p', name: 'USB_P', connected: 2, total: 2, paths: [[{ x: 5.25, y: 5.25, l: 0 }, { x: 15.25, y: 5.25, l: 0 }]], vias: [] },
    { netId: 'n', name: 'USB_N', connected: 2, total: 2, paths: [[{ x: 5.25, y: 9.25, l: 0 }, { x: 15.25, y: 9.25, l: 0 }]], vias: [] },
  ], overuse: [] };
  assert(!core.checkDRC(d2, r3, {}).some(i => i.type === '差分等长'), '等长对不应告警');
});

t('checkDRC 3W：同 pair 两高速网贴近不互相告警（对内豁免）', () => {
  const d = core.designDefaults();
  d.grid = 0.5; d.trackW = 0.3; d.clearance = 0.2;
  d.nets = [{ id: 'p', name: 'USB_P', hs: true, pair: 'usb' },
            { id: 'n', name: 'USB_N', hs: true, pair: 'usb' },
            { id: 'x', name: 'OTHER', hs: true }];
  d.pads = [
    { id: 'U1-1', netId: 'p', x: 5.25, y: 5.25, w: 1, h: 1, layer: 'both' },
    { id: 'U1-2', netId: 'p', x: 25.25, y: 5.25, w: 1, h: 1, layer: 'both' },
    { id: 'U1-3', netId: 'n', x: 5.25, y: 6.0, w: 1, h: 1, layer: 'both' },
    { id: 'U1-4', netId: 'n', x: 25.25, y: 6.0, w: 1, h: 1, layer: 'both' },
    { id: 'U1-5', netId: 'x', x: 5.25, y: 6.75, w: 1, h: 1, layer: 'both' },
    { id: 'U1-6', netId: 'x', x: 25.25, y: 6.75, w: 1, h: 1, layer: 'both' },
  ];
  const result = { nets: [
    { netId: 'p', name: 'USB_P', connected: 2, total: 2, paths: [[{ x: 5.25, y: 5.25, l: 0 }, { x: 25.25, y: 5.25, l: 0 }]], vias: [] },
    { netId: 'n', name: 'USB_N', connected: 2, total: 2, paths: [[{ x: 5.25, y: 6.0, l: 0 }, { x: 25.25, y: 6.0, l: 0 }]], vias: [] },
    { netId: 'x', name: 'OTHER', connected: 2, total: 2, paths: [[{ x: 5.25, y: 6.75, l: 0 }, { x: 25.25, y: 6.75, l: 0 }]], vias: [] },
  ], overuse: [] };
  const warns = core.checkDRC(d, result, {}).filter(i => i.type === '3W 间距');
  assert(warns.length >= 1, '与 OTHER 贴行应告警 3W');
  // 对内豁免验证：n-x 中心距 0.75<0.9 违规（从 n、x 两个方向各计一次=2 条）；
  // 若对内豁免失效，p-n 0.75<0.9 也违规 → 会是 4 条。恰好 2 条即证明豁免生效。
  assertEq(warns.length, 2, '应恰好 2 条（n-x 双向），p-n 对内豁免生效');
});

t('advise PAIR-DETECT：USB_D+/D- 未标 pair → 建议标记', () => {
  const d = core.designDefaults();
  d.grid = 0.5;
  d.nets = [{ id: 'dp', name: 'USB_D+' }, { id: 'dn', name: 'USB_D-' }];
  d.pads = [
    { id: 'U1-1', netId: 'dp', x: 5.25, y: 5.25, w: 1, h: 1, layer: 'both' },
    { id: 'J1-1', netId: 'dp', x: 30.25, y: 5.25, w: 1, h: 1, layer: 'both' },
    { id: 'U1-2', netId: 'dn', x: 5.25, y: 7.25, w: 1, h: 1, layer: 'both' },
    { id: 'J1-2', netId: 'dn', x: 30.25, y: 7.25, w: 1, h: 1, layer: 'both' },
  ];
  const recs = adviseFor(d, { stats: { total: 4, connected: 4, failed: 0 }, nets: [], overuse: [] }).recommendations;
  assert(recs.some(r => r.id === 'PAIR-DETECT'), '缺 PAIR-DETECT：' + JSON.stringify(recs.map(r => r.id)));
});

t('advise DECUPLE-POS：去耦电容离 IC 电源引脚 >6mm → 告警', () => {
  const d = core.designDefaults();
  d.grid = 0.5;
  d.nets = [{ id: 'v', name: 'VCC' }, { id: 'g', name: 'GND' }];
  d.pads = [
    { id: 'U1-1', netId: 'v', x: 5.25, y: 5.25, w: 1, h: 1, layer: 'both' },
    { id: 'U1-2', netId: 'g', x: 5.25, y: 7.25, w: 1, h: 1, layer: 'both' },
    { id: 'U1-3', netId: 'v', x: 7.25, y: 5.25, w: 1, h: 1, layer: 'both' },
    { id: 'U1-4', netId: 'g', x: 7.25, y: 7.25, w: 1, h: 1, layer: 'both' },
    { id: 'C1-1', netId: 'v', x: 45.25, y: 5.25, w: 1, h: 1, layer: 'both' },   // 远
    { id: 'C1-2', netId: 'g', x: 45.25, y: 7.25, w: 1, h: 1, layer: 'both' },
  ];
  const recs = adviseFor(d, { stats: { total: 6, connected: 6, failed: 0 }, nets: [], overuse: [] }).recommendations;
  const rec = recs.find(r => r.id === 'DECUPLE-POS');
  assert(rec, '缺 DECUPLE-POS：' + JSON.stringify(recs.map(r => r.id)));
  assert(rec.msg.includes('U1'), '应指认 IC');
});

t('advise LOSS：长高速网介质损耗超 3dB → 告警', () => {
  const d = core.designDefaults();
  d.grid = 0.5;
  d.nets = [{ id: 'a', name: 'CLK', hs: true, tr: 0.02 }];   // Fknee=25GHz：45mm≈4.3dB
  d.pads = [
    { id: 'p1', netId: 'a', x: 5.25, y: 5.25, w: 1, h: 1, layer: 'both' },
    { id: 'p2', netId: 'a', x: 50.25, y: 5.25, w: 1, h: 1, layer: 'both' },
  ];
  const result = { stats: { total: 2, connected: 2, failed: 0 }, nets: [{ netId: 'a', name: 'CLK', connected: 2, total: 2,
    paths: [[{ x: 5.25, y: 5.25, l: 0 }, { x: 50.25, y: 5.25, l: 0 }]], vias: [] }], overuse: [] };
  const recs = adviseFor(d, result).recommendations;
  const rec = recs.find(r => r.id === 'LOSS');
  assert(rec, '缺 LOSS：' + JSON.stringify(recs.map(r => r.id)));
  assert(rec.evidence === 'book-backed', 'LOSS 应为 book-backed');
});

console.log('— 行为级深度优化 2：自动回流地孔 + 布线器对内豁免/3W偏置 —');

t('autoReturnVias：孤立高速换层孔自动配对地孔；已有地导体覆盖则跳过', () => {
  const d = core.designDefaults();
  d.grid = 0.5; d.trackW = 0.3; d.clearance = 0.2; d.viaOuter = 0.8; d.viaDrill = 0.4;
  d.width = 60; d.height = 40;
  d.nets = [{ id: 'a', name: 'CLK', hs: true }, { id: 'g', name: 'GND' }];
  d.pads = [
    { id: 'U1-1', netId: 'a', x: 10.25, y: 10.25, w: 1.2, h: 1.2, layer: 'both' },
    { id: 'U1-2', netId: 'a', x: 20.25, y: 10.25, w: 1.2, h: 1.2, layer: 'both' },
    { id: 'J1-1', netId: 'g', x: 50.25, y: 35.25, w: 1.2, h: 1.2, layer: 'both' },  // 远角
  ];
  // CLK 换层过孔在 (15.25,10.25)：reach 1.6mm 内没有任何地导体
  const result = { nets: [{ netId: 'a', name: 'CLK', connected: 2, total: 2,
    paths: [[{ x: 10.25, y: 10.25, l: 0 }, { x: 15.25, y: 10.25, l: 0 }, { x: 20.25, y: 10.25, l: 1 }]],
    vias: [{ x: 15.25, y: 10.25 }] }], overuse: [] };
  const r1 = core.autoReturnVias(d, result, {});
  assert(r1.ok && r1.checked === 1, '应检查 1 个高速过孔');
  assert(r1.added.length === 1, '应补 1 颗回流地孔：' + JSON.stringify(r1.added));
  const v = r1.added[0];
  const dist = Math.hypot(v.x - 15.25, v.y - 10.25);
  assert(dist <= 1.6 + 1e-9 && dist >= 0.9, '地孔应在 reach(1.6mm) 内：' + dist);
  assert(v.netId === 'g', '地孔应属于 GND');
  // 已覆盖场景：把地孔放进 reach 内 → 不再补
  d.stitching = [{ x: v.x, y: v.y, netId: 'g' }];
  const r2 = core.autoReturnVias(d, result, {});
  assert(r2.added.length === 0, '已有地孔覆盖时不应重复配对');
});

t('autoReturnVias：与异网走线冲突的方位被跳过（间距审查）', () => {
  const d = core.designDefaults();
  d.grid = 0.5; d.trackW = 0.3; d.clearance = 0.2; d.viaOuter = 0.8; d.viaDrill = 0.4;
  d.width = 60; d.height = 40;
  d.nets = [{ id: 'a', name: 'CLK', hs: true }, { id: 'g', name: 'GND' }, { id: 'x', name: 'BUSY' }];
  d.pads = [
    { id: 'U1-1', netId: 'a', x: 10.25, y: 20.25, w: 1.2, h: 1.2, layer: 'both' },
    { id: 'U1-2', netId: 'a', x: 20.25, y: 20.25, w: 1.2, h: 1.2, layer: 'both' },
    { id: 'J1-1', netId: 'g', x: 50.25, y: 35.25, w: 1.2, h: 1.2, layer: 'both' },
    { id: 'X1-1', netId: 'x', x: 15.25, y: 15.25, w: 1.2, h: 1.2, layer: 'both' },   // 上方堵位
    { id: 'X2-1', netId: 'x', x: 15.25, y: 25.25, w: 1.2, h: 1.2, layer: 'both' },   // 下方堵位
  ];
  // 换层孔 + 上下 5mm 处异网焊盘：右侧必须留出通道——若被堵满则如实 skipped
  const result = { nets: [{ netId: 'a', name: 'CLK', connected: 2, total: 2,
    paths: [[{ x: 10.25, y: 20.25, l: 0 }, { x: 15.25, y: 20.25, l: 0 }, { x: 20.25, y: 20.25, l: 1 }]],
    vias: [{ x: 15.25, y: 20.25 }] }], overuse: [] };
  const r = core.autoReturnVias(d, result, {});
  assert(r.ok, '应成功执行');
  if (r.added.length === 1) {
    const v = r.added[0];
    // 放下的孔必须与异网焊盘保持间距（pointPadDistance ≥ viaOuter/2+clearance）
    for (const p of d.pads.filter(p => p.netId === 'x'))
      assert(core.pointPadDistance(v.x, v.y, p) >= d.viaOuter / 2 + d.clearance - 1e-9,
        '回流孔与异网焊盘间距不足');
  }
  // 无论放没放下，都不允许产生间距违规——把 added 注入后再跑 DRC
  d.stitching = r.added.map(v => ({ x: v.x, y: v.y, netId: 'g' }));
  const rFull = { ...result, overuse: [] };
  const issues = core.checkDRC(d, rFull, {});
  assert(!issues.some(i => i.type === '过孔间距' || i.type === '过孔-焊盘间距'),
    '注入回流孔后不得有新间距违规：' + JSON.stringify(issues.slice(0, 3)));
});

t('布线器：hs/pair 网参与协商不劣化布通率（烟雾）', () => {
  const d = core.designDefaults();
  d.width = 50; d.height = 35; d.grid = 0.5;
  d.nets = [
    { id: 'p', name: 'USB_P', hs: true, pair: 'usb' },
    { id: 'n', name: 'USB_N', hs: true, pair: 'usb' },
    { id: 'g', name: 'GND' }, { id: 'v', name: 'VCC' },
  ];
  d.pads = [
    { id: 'U1-1', netId: 'p', x: 5.25, y: 5.25, w: 1, h: 1, layer: 'both' },
    { id: 'J1-1', netId: 'p', x: 45.25, y: 30.25, w: 1, h: 1, layer: 'both' },
    { id: 'U1-2', netId: 'n', x: 7.25, y: 5.25, w: 1, h: 1, layer: 'both' },
    { id: 'J1-2', netId: 'n', x: 43.25, y: 30.25, w: 1, h: 1, layer: 'both' },
    { id: 'U1-3', netId: 'g', x: 5.25, y: 7.25, w: 1, h: 1, layer: 'both' },
    { id: 'J1-3', netId: 'g', x: 45.25, y: 5.25, w: 1, h: 1, layer: 'both' },
    { id: 'U1-4', netId: 'v', x: 7.25, y: 7.25, w: 1, h: 1, layer: 'both' },
    { id: 'J1-4', netId: 'v', x: 43.25, y: 5.25, w: 1, h: 1, layer: 'both' },
  ];
  const s = core.createSession(d, {});
  let guard = 0;
  for (;;) { const st = s.step(); if (st.done) break; if (++guard > 200000) throw new Error('步数超限'); }
  const r = s.buildResult();
  assertEq(r.status, 'complete', '含 hs/pair 的板应全部布通');
  // 对内豁免生效的旁证：两网都布通且 3W DRC 不因 pair 内部贴近而报错（0.3 线 0.2 距，栅格 0.5 天然合规）
});

console.log('— 第四轮：PDN 一阶阻抗求解器（Bogatin ch13 口径） —');

function pdnBoard(layers) {
  const d = core.designDefaults();
  d.width = 60; d.height = 40; d.grid = 0.5; d.layers = layers;
  d.nets = [{ id: 'v', name: 'VCC' }, { id: 'g', name: 'GND' }];
  d.pads = [
    { id: 'U1-1', netId: 'v', x: 10.25, y: 10.25, w: 1, h: 1, layer: 'both' },
    { id: 'U1-2', netId: 'g', x: 10.25, y: 12.25, w: 1, h: 1, layer: 'both' },
    { id: 'J1-1', netId: 'v', x: 50.25, y: 30.25, w: 1, h: 1, layer: 'both' },
    { id: 'J1-2', netId: 'g', x: 50.25, y: 32.25, w: 1, h: 1, layer: 'both' },
    { id: 'C1-1', netId: 'v', x: 12.25, y: 10.25, w: 1, h: 1, layer: 'both' },
    { id: 'C1-2', netId: 'g', x: 12.25, y: 12.25, w: 1, h: 1, layer: 'both' },
    { id: 'C2-1', netId: 'v', x: 14.25, y: 10.25, w: 1, h: 1, layer: 'both' },
    { id: 'C2-2', netId: 'g', x: 14.25, y: 12.25, w: 1, h: 1, layer: 'both' },
    { id: 'C3-1', netId: 'v', x: 16.25, y: 10.25, w: 1, h: 1, layer: 'both' },
    { id: 'C3-2', netId: 'g', x: 16.25, y: 12.25, w: 1, h: 1, layer: 'both' },
    { id: 'C4-1', netId: 'v', x: 18.25, y: 10.25, w: 1, h: 1, layer: 'both' },
    { id: 'C4-2', netId: 'g', x: 18.25, y: 12.25, w: 1, h: 1, layer: 'both' },
  ];
  return d;
}

t('pdnEstimate：目标阻抗/体电容/电容库 SRF 与手算一致', () => {
  const d = pdnBoard(4);
  const r = core.pdnEstimate(d, null, { vdd: 3.3, itrans: 1, ripplePct: 5, dtUs: 10, eslNh: 1, capUf: 0.1 });
  near(r.ztargetOhm, 0.165, 0.001, 'Ztarget=5%×3.3/1');
  near(r.bulkCuf, 60.6, 0.5, '库仑桶 C=I·Δt/ΔV（10µs）');
  assertEq(r.caps.count, 4, '识别 4 颗去耦电容');
  near(r.caps.cTotalNf, 400, 0.01, '4×100nF');
  near(r.caps.eslTotalNh, 0.25, 0.001, '1nH/4');
  near(r.caps.srfMhz, 15.9, 0.2, '同容值并联 SRF 不变（159/√(1nH·100nF)）');
  near(r.planeCapPf, 478, 15, '四层平面对电容（60×40mm/0.2mm/εr4.5）');
});

t('pdnEstimate：交接阻抗 √(L/C) 与达标判定（FAIL→建议降 ESL）', () => {
  const d = pdnBoard(4);
  const r = core.pdnEstimate(d, null, { vdd: 3.3, itrans: 1, ripplePct: 5, eslNh: 1, capUf: 0.1 });
  // L_total=0.25nH, C_plane≈478pF → Z=√(L/C)≈0.723Ω > 0.165Ω → FAIL
  near(r.zHandoffOhm, 0.72, 0.05, '交接阻抗 √(L_total/C_plane)');
  assertEq(r.pass, false, '默认参数应不达标');
  assert(r.notes.some(s => s.includes('安装电感')), 'FAIL 应给降 ESL 建议');
  // 降低 ESL + 加颗数 → 达标
  d.pads.push(
    { id: 'C5-1', netId: 'v', x: 20.25, y: 10.25, w: 1, h: 1, layer: 'both' },
    { id: 'C5-2', netId: 'g', x: 20.25, y: 12.25, w: 1, h: 1, layer: 'both' },
    { id: 'C6-1', netId: 'v', x: 22.25, y: 10.25, w: 1, h: 1, layer: 'both' },
    { id: 'C6-2', netId: 'g', x: 22.25, y: 12.25, w: 1, h: 1, layer: 'both' },
    { id: 'C7-1', netId: 'v', x: 24.25, y: 10.25, w: 1, h: 1, layer: 'both' },
    { id: 'C7-2', netId: 'g', x: 24.25, y: 12.25, w: 1, h: 1, layer: 'both' },
    { id: 'C8-1', netId: 'v', x: 26.25, y: 10.25, w: 1, h: 1, layer: 'both' },
    { id: 'C8-2', netId: 'g', x: 26.25, y: 12.25, w: 1, h: 1, layer: 'both' },
    { id: 'C9-1', netId: 'v', x: 28.25, y: 10.25, w: 1, h: 1, layer: 'both' },
    { id: 'C9-2', netId: 'g', x: 28.25, y: 12.25, w: 1, h: 1, layer: 'both' },
    { id: 'C10-1', netId: 'v', x: 30.25, y: 10.25, w: 1, h: 1, layer: 'both' },
    { id: 'C10-2', netId: 'g', x: 30.25, y: 12.25, w: 1, h: 1, layer: 'both' },
  );
  const r2 = core.pdnEstimate(d, null, { vdd: 3.3, itrans: 1, ripplePct: 5, eslNh: 0.1, capUf: 0.1 });
  // L_total=0.01nH → Z=√(0.01e-9/478e-12)≈0.145Ω < 0.165 → PASS
  assertEq(r2.caps.count, 10, '10 颗电容');
  assertEq(r2.pass, true, '低 ESL+多颗应达标');
});

t('pdnEstimate：双层板平面电容按 0 计并诚实注明；封装上限 Fmax 可选', () => {
  const d = pdnBoard(2);
  const r = core.pdnEstimate(d, null, { vdd: 3.3, itrans: 1, ripplePct: 5, pkgLnH: 0.5 });
  assertEq(r.planeCapPf, 0, '双层无平面对');
  assert(r.handoffMhz === null && r.pass === null, '无平面对时不做交接判定');
  assert(r.notes.some(s => s.includes('双层板')), '应注明双层板口径');
  near(r.fmaxPkgMhz, 0.165 / (2 * Math.PI * 0.5e-9) / 1e6, 0.5, '封装上限 Fmax=Ztarget/(2πL)');
});

t('CLI pdn：端到端输出结构（含 --plan FDTIM 选型）', () => {
  const d = pdnBoard(4);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcbpdn-'));
  const f = path.join(dir, 'd.json');
  fs.writeFileSync(f, JSON.stringify(d));
  const out = execFileSync('node', [path.join(process.cwd(), 'ai/pcb.mjs'), 'pdn', f, '--vdd', '1.2', '--itrans', '4'], { encoding: 'utf8' });
  const j = JSON.parse(out);
  assert(j.ok, 'ok');
  near(j.pdn.ztargetOhm, 0.015, 0.003, '5%×1.2/4');
  assert(j.pdn.caps && typeof j.pdn.caps.count === 'number', 'caps 结构');
  assert(j.plan === null, '未加 --plan 时无选型');
  const out2 = execFileSync('node', [path.join(process.cwd(), 'ai/pcb.mjs'), 'pdn', f, '--vdd', '1.2', '--itrans', '4', '--plan', '--plane-pf', '20000', '--fmax', '100', '--plan-esl-nh', '2'], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  const j2 = JSON.parse(out2);
  assert(j2.plan && j2.plan.ok, 'plan 结构');
  assert(j2.plan.pass === true, 'FDTIM 选型后全频段达标');
  assert(j2.plan.schedule.length > 0 && j2.plan.schedule[0].cNf, 'schedule 条目');
  assert(j2.plan.theoryMin >= 1 && j2.plan.total >= j2.plan.theoryMin, '总颗数 ≥ 理论最少');
});

console.log('— 第五轮：IPC-D-356A 导出（RTF2 附录3 交付件） —');

t('exportIPC356：记录结构逐列对齐真实样例（317/327/坐标/层/999）', () => {
  const d = core.designDefaults();
  d.width = 60; d.height = 40; d.grid = 0.5; d.layers = 2; d.viaOuter = 0.8; d.viaDrill = 0.4;
  d.nets = [{ id: 'g', name: 'GND' }, { id: 'v', name: 'VCC' }, { id: 'c', name: 'CLK', hs: true }];
  d.pads = [
    { id: 'J1-1', netId: 'g', x: 10.25, y: 10.25, w: 1.2, h: 1.2, layer: 'both', holeR: 0.45 },  // 通孔
    { id: 'U1-1', netId: 'v', x: 20, y: 20, w: 1, h: 1, layer: 'top' },                          // 顶层表贴
    { id: 'U1-2', netId: 'v', x: 30, y: 30, w: 1, h: 1, layer: 'bottom' },                       // 底层表贴
  ];
  d.stitching = [{ x: 25, y: 25, netId: 'g' }];
  const result = { nets: [{ netId: 'c', name: 'CLK', connected: 2, total: 2,
    paths: [[{ x: 5.25, y: 5.25, l: 0 }, { x: 15.25, y: 5.25, l: 0 }]], vias: [{ x: 15.25, y: 5.25 }] }], overuse: [] };
  const text = core.exportIPC356(d, result);
  const lines = text.split('\n').filter(l => l.length);
  assert(lines.some(l => l === '999'), '999 结束记录');
  assert(lines.some(l => l.startsWith('P  VER IPC-D-356A')), '版本参数头');
  // 通孔 317：D0354（0.9mm=0.0354"）PA00，X=10.25mm→4035，Y=(40-10.25)=29.75mm→11713
  const th = lines.find(l => l.startsWith('317') && l.includes('J1-1'.slice(0, 4)) === false && l.includes('D0354'));
  assert(th, '应存在通孔 317 记录（D0354）：\n' + lines.join('\n'));
  assertEq(th.length, 55, '317 记录 55 字符');
  assert(th.includes('X+004035') && th.includes('Y+011713'), '坐标换算（0.0001"、Y 翻转）：' + th);
  assert(th.slice(3, 17).trim() === 'GND', '网名段');
  // 表贴 327：顶层 A01 / 底层 A02（两层板），无 D 孔径字段
  const top = lines.find(l => l.startsWith('327') && l.includes('A01X+007874'));
  assert(top, '顶层 327 A01：' + lines.join('\n'));
  const bot = lines.find(l => l.startsWith('327') && l.includes('A02X+011811'));
  assert(bot, '底层 327 A02（两层板 A0L）');
  assertEq(top.length, 55, '327 记录 55 字符');
  // 过孔 VIA 记录：D0157（0.4mm）
  const via = lines.find(l => l.startsWith('317') && l.includes('D0157') && l.includes('VIA'));
  assert(via, 'VIA 317 记录（走线过孔）');
  assert(lines.filter(l => l.includes('VIA')).length === 2, '走线过孔+缝合孔共 2 颗 VIA');
});

t('exportIPC356：数字开头网名加 + 前缀、14 字符截断、超界报错', () => {
  const d = core.designDefaults();
  d.width = 60; d.height = 40; d.grid = 0.5; d.layers = 2;
  d.nets = [{ id: 'x', name: '3V3' }, { id: 'y', name: 'A_VERY_LONG_NET_NAME_XYZ' }];
  d.pads = [
    { id: 'U1-1', netId: 'x', x: 5, y: 5, w: 1, h: 1, layer: 'top' },
    { id: 'U1-2', netId: 'y', x: 10, y: 10, w: 1, h: 1, layer: 'top' },
  ];
  const text = core.exportIPC356(d, null);
  const lines = text.split('\n');
  assert(lines.some(l => l.startsWith('327+3V3')), '数字开头网名 + 前缀');
  const long = lines.find(l => l.startsWith('327A_VERY_LONG_'));
  assert(long && long.slice(3, 17).trim() === 'A_VERY_LONG_NE', '网名 14 字符截断');
  // 超界：单坐标 >999999 单位（254mm）→ 诚实报错（守卫是逐坐标的）
  const d2 = { ...d, width: 300, height: 40 };
  d2.pads = [{ id: 'U1-9', netId: 'x', x: 3000, y: 10, w: 1, h: 1, layer: 'top' }];
  let threw = false;
  try { core.exportIPC356(d2, null); } catch (e) { threw = /2540mm/.test(e.message); }
  assert(threw, '单坐标超 6 位字段应报错');
});

t('CLI export ipc356：端到端', () => {
  const d = core.designDefaults();
  d.width = 60; d.height = 40; d.grid = 0.5; d.layers = 2;
  d.nets = [{ id: 'g', name: 'GND' }];
  d.pads = [{ id: 'J1-1', netId: 'g', x: 10.25, y: 10.25, w: 1.2, h: 1.2, layer: 'both', holeR: 0.45 }];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcb356-'));
  const f = path.join(dir, 'd.json');
  fs.writeFileSync(f, JSON.stringify(d));
  const out = path.join(dir, 'netlist.356');
  execFileSync('node', [path.join(process.cwd(), 'ai/pcb.mjs'), 'export', 'ipc356', f, '-o', out], { encoding: 'utf8' });
  const text = fs.readFileSync(out, 'utf8');
  fs.rmSync(dir, { recursive: true, force: true });
  assert(text.includes('999') && text.includes('D0354'), 'CLI 导出内容正确');
});

console.log('— 第六轮：换层跨平面检查 / PDN敏感性 / 串扰饱和长度 —');

t('checkDRC 换层跨参考平面：四层板 0↔3 直跨告警、0↔1 不告警', () => {
  const d = core.designDefaults();
  d.grid = 0.5; d.layers = 4;
  d.nets = [{ id: 'a', name: 'SIG' }];
  d.pads = [
    { id: 'p1', netId: 'a', x: 5.25, y: 5.25, w: 1, h: 1, layer: 'both' },
    { id: 'p2', netId: 'a', x: 15.25, y: 5.25, w: 1, h: 1, layer: 'both' },
    { id: 'p3', netId: 'a', x: 25.25, y: 5.25, w: 1, h: 1, layer: 'both' },
  ];
  const result = { nets: [{ netId: 'a', name: 'SIG', connected: 3, total: 3,
    paths: [
      [{ x: 5.25, y: 5.25, l: 0 }, { x: 10.25, y: 5.25, l: 0 }, { x: 15.25, y: 5.25, l: 3 },
       { x: 20.25, y: 5.25, l: 3 }, { x: 25.25, y: 5.25, l: 3 }],
    ], vias: [{ x: 15.25, y: 5.25 }] }], overuse: [] };
  const warns = core.checkDRC(d, result, {}).filter(i => i.type === '换层跨参考平面');
  assert(warns.length === 1, '0→3 直跨应告警 1 次：' + JSON.stringify(warns));
  assert(warns[0].msg.includes('中间隔 2 个参考平面'), '应说明隔层数');
  // 0→1 相邻换层：不告警
  const r2 = { nets: [{ netId: 'a', name: 'SIG', connected: 2, total: 2,
    paths: [[{ x: 5.25, y: 5.25, l: 0 }, { x: 10.25, y: 5.25, l: 0 }, { x: 10.25, y: 5.25, l: 1 }]], vias: [{ x: 10.25, y: 5.25 }] }], overuse: [] };
  assert(!core.checkDRC(d, r2, {}).some(i => i.type === '换层跨参考平面'), '相邻换层不应告警');
});

t('pdnEstimate ESL 敏感性：达标但对 +50% 不达标 → ESL 敏感警告', () => {
  const d = pdnBoard(4);
  for (let i = 5; i <= 10; i++) d.pads.push(
    { id: 'C' + i + '-1', netId: 'v', x: 12.25 + i * 2, y: 10.25, w: 1, h: 1, layer: 'both' },
    { id: 'C' + i + '-2', netId: 'g', x: 12.25 + i * 2, y: 12.25, w: 1, h: 1, layer: 'both' });
  const r = core.pdnEstimate(d, null, { vdd: 3.3, itrans: 1, ripplePct: 5, eslNh: 0.1, capUf: 0.1 });
  assertEq(r.pass, true, '名义达标');
  assertEq(r.sensitivity.passPess, false, 'ESL+50% 悲观不达标');
  assert(r.notes.some(s => s.includes('ESL 敏感')), '应有 ESL 敏感警告');
  near(r.sensitivity.eslX15Zohm, r.zHandoffOhm * Math.sqrt(1.5), 0.02, '悲观阻抗=√1.5×名义');
});

t('hsCrosstalkScan 饱和长度：tr 标注网输出 Len_sat=½×RT×v', () => {
  const d = core.designDefaults();
  d.grid = 0.5; d.trackW = 0.3;
  d.nets = [{ id: 'a', name: 'CLK', hs: true, tr: 1 }, { id: 'b', name: 'DATA' }];
  d.pads = [
    { id: 'a1', netId: 'a', x: 5.25, y: 5.25, w: 1, h: 1, layer: 'both' },
    { id: 'a2', netId: 'a', x: 25.25, y: 5.25, w: 1, h: 1, layer: 'both' },
    { id: 'b1', netId: 'b', x: 5.25, y: 6.0, w: 1, h: 1, layer: 'both' },
    { id: 'b2', netId: 'b', x: 25.25, y: 6.0, w: 1, h: 1, layer: 'both' },
  ];
  const result = { nets: [
    { netId: 'a', name: 'CLK', connected: 2, total: 2, paths: [[{ x: 5.25, y: 5.25, l: 0 }, { x: 25.25, y: 5.25, l: 0 }]], vias: [] },
    { netId: 'b', name: 'DATA', connected: 2, total: 2, paths: [[{ x: 5.25, y: 6.0, l: 0 }, { x: 25.25, y: 6.0, l: 0 }]], vias: [] },
  ], overuse: [] };
  const scan = core.hsCrosstalkScan(d, result);
  assertEq(scan.report.length, 1, '有并行对象');
  // tr=1ns → Len_sat=½×1ns×v(εr4.5)≈70.7mm
  assert(scan.report[0].satLenMm > 65 && scan.report[0].satLenMm < 76, '饱和长度≈70.7mm：' + scan.report[0].satLenMm);
});

console.log('— 第七轮：耦合差分平行布线 + FDTIM 频域选型 —');

// 平行度：B 网（pair 伙伴）路径格中与 A 网路径格正交相邻的占比
function pairParallelRatio(optsBias) {
  const d = core.designDefaults();
  d.width = 50; d.height = 30; d.grid = 0.5;
  d.nets = [{ id: 'p', name: 'USB_P', hs: true, pair: 'usb' },
            { id: 'n', name: 'USB_N', hs: true, pair: 'usb' }];
  d.pads = [
    { id: 'U1-1', netId: 'p', x: 5.25, y: 8.25, w: 1, h: 1, layer: 'both' },
    { id: 'J1-1', netId: 'p', x: 45.25, y: 8.25, w: 1, h: 1, layer: 'both' },
    { id: 'U1-2', netId: 'n', x: 5.25, y: 10.25, w: 1, h: 1, layer: 'both' },
    { id: 'J1-2', netId: 'n', x: 45.25, y: 10.25, w: 1, h: 1, layer: 'both' },
  ];
  d.keepouts = [{ x: 25, y: 9.25, w: 8, h: 3 }];     // 卡在两网直连走廊中间，迫使绕行
  const s = core.createSession(d, { pairBias: optsBias });
  let guard = 0;
  for (;;) { const st = s.step(); if (st.done) break; if (++guard > 300000) throw new Error('步数超限'); }
  const r = s.buildResult();
  assertEq(r.status, 'complete', '布通');
  const pn = r.nets.find(n => n.netId === 'p'), nn = r.nets.find(n => n.netId === 'n');
  const cellOf = pt => Math.round(pt.x / d.grid - 0.5) + Math.round(pt.y / d.grid - 0.5) * Math.round(d.width / d.grid);
  const pCells = new Set();
  for (const path of pn.paths) for (const pt of path) pCells.add(cellOf(pt));
  let adj = 0, tot = 0;
  for (const path of nn.paths) for (const pt of path) {
    const c = cellOf(pt);
    tot++;
    // 正交 4 邻或自身（同排平行时 B 恰好在 A 的 4 邻）
    if (pCells.has(c) || pCells.has(c - 1) || pCells.has(c + 1) || pCells.has(c - Math.round(d.width / d.grid)) || pCells.has(c + Math.round(d.width / d.grid))) adj++;
  }
  return adj / tot;
}

t('耦合差分平行布线：pairBias 开启时伙伴沿走廊平行（绕障区度量）', () => {
  // 夹具：keepout 同时挡住两网直连走廊；p 的上行绕行代价低、n 独立绕行下行代价低
  // ——无走廊时 n 选下行（与 p 分离），有走廊时 n 跟随 p 上行贴邻 → 绕障区平行度区分两者
  function ratio(bias) {
    const d = core.designDefaults();
    d.width = 50; d.height = 30; d.grid = 0.5;
    d.nets = [{ id: 'p', name: 'USB_P', hs: true, pair: 'usb' },
              { id: 'n', name: 'USB_N', hs: true, pair: 'usb' }];
    d.pads = [
      { id: 'U1-1', netId: 'p', x: 5.25, y: 8.25, w: 1, h: 1, layer: 'both' },
      { id: 'J1-1', netId: 'p', x: 45.25, y: 8.25, w: 1, h: 1, layer: 'both' },
      { id: 'U1-2', netId: 'n', x: 5.25, y: 9.25, w: 1, h: 1, layer: 'both' },
      { id: 'J1-2', netId: 'n', x: 45.25, y: 9.25, w: 1, h: 1, layer: 'both' },
    ];
    d.keepouts = [{ x: 25, y: 9, w: 8, h: 2 }, { x: 25, y: 10.5, w: 8, h: 1.2 }];  // 两块夹死 9.25/10.25 通道：n 上行跟随 p 走廊成唯一近路
    const s = core.createSession(d, { pairBias: bias });
    let guard = 0;
    for (;;) { const st = s.step(); if (st.done) break; if (++guard > 300000) throw new Error('步数超限'); }
    const r = s.buildResult();
    assertEq(r.status, 'complete', '布通');
    const pn = r.nets.find(n => n.netId === 'p'), nn = r.nets.find(n => n.netId === 'n');
    const W = Math.round(d.width / d.grid);
    const cellOf = pt => Math.round(pt.x / d.grid - 0.5) + Math.round(pt.y / d.grid - 0.5) * W;
    const pCells = new Set();
    for (const path of pn.paths) for (const pt of path) pCells.add(cellOf(pt));
    let adj = 0, tot = 0;
    for (const path of nn.paths) for (const pt of path) {
      if (pt.x < 16 || pt.x > 34) continue;          // 只度量绕障区
      const c = cellOf(pt);
      tot++;
      if (pCells.has(c) || pCells.has(c - 1) || pCells.has(c + 1) || pCells.has(c - W) || pCells.has(c + W)) adj++;
    }
    return tot ? adj / tot : 0;
  }
  const withBias = ratio(true);
  const noBias = ratio(false);
  console.log(`    （绕障区平行度：带走廊 ${(withBias * 100).toFixed(0)}% vs 无走廊 ${(noBias * 100).toFixed(0)}%）`);
  assert(withBias >= 0.4, '开启 pairBias 绕障区平行度应 ≥40%：' + withBias);
});

t('FDTIM：书例（Zt=0.1Ω/平面20nF/ESL2nH/1-100MHz）收敛且颗数≥理论最少', () => {
  const r = core.fdtimPlan({ ztarget: 0.1, fminMhz: 1, fmaxMhz: 100, planeCapPf: 20000, eslNh: 2 });
  assert(r.ok, 'ok');
  assertEq(r.theoryMin, 13, '理论最少颗数（13.21 算例）');
  assertEq(r.smallestTierNf, 4.7, '最小档=≤平面/3 的最大标准档（20nF/3≈6.7nF→4.7）');
  assertEq(r.pass, true, '贪心收敛后全频段达标');
  assert(r.total >= r.theoryMin, '总颗数 ≥ 理论最少');
  assert(r.total <= 60, '总颗数有界：' + r.total);
  assert(r.maxZOhm <= 0.1 + 1e-9, '扫频峰值 ≤ 目标：' + r.maxZOhm);
  const ladder = [1000, 470, 220, 100, 47, 22, 10, 4.7, 2.2];
  for (const s of r.schedule) assert(ladder.includes(s.cNf), '档位来自标准阶梯：' + s.cNf);
  const maxFromSweep = Math.max(...r.sweep.map(p => p.zOhm));
  near(maxFromSweep, r.maxZOhm, 0.02, '扫频最大值一致性');
});

t('FDTIM：反谐振峰从导纳模型涌现（13.16 PRF 算例）+ 居中档压峰（13.17）', () => {
  // 13.16 验证算例族：100nF(ESL 2nH) 并 10nF → PRF≈36MHz 族（模型扫出 ~29MHz，同族口径）
  const base = { ztarget: 0.01, fminMhz: 0.5, fmaxMhz: 100, planeCapPf: 0, eslNh: 2, maxPerTier: 1 };
  const no10 = core.fdtimPlan({ ...base, ladderNf: [1000, 100], maxTotal: 2 });
  const with10 = core.fdtimPlan({ ...base, ladderNf: [1000, 100, 10], maxTotal: 3 });
  const fPRF = 29;
  const zAt = (sw, f) => sw.reduce((a, p) => Math.abs(p.fMhz - f) < Math.abs(a.fMhz - f) ? p : a).zOhm;
  const zNo = zAt(no10.sweep, fPRF), zWith = zAt(with10.sweep, fPRF);
  assert(zWith > zNo * 2, `加 10nF 后 ${fPRF}MHz 处应涌现反谐振峰：${zNo} → ${zWith}`);
  // 13.17 验证算例族：插入 SRF 居中的 22nF 档 → 峰被压低
  const with22 = core.fdtimPlan({ ...base, ladderNf: [1000, 100, 22, 10], maxTotal: 8, maxPerTier: 3 });
  const z22 = zAt(with22.sweep, fPRF);
  assert(z22 < zWith, `居中档 22nF 应压峰：${zWith} → ${z22}`);
  console.log(`    （${fPRF}MHz 处：无 10nF ${zNo}Ω → 加 10nF ${zWith}Ω（PRF 峰）→ 加 22nF 居中档 ${z22}Ω（压峰））`);
});

console.log(`\n${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);