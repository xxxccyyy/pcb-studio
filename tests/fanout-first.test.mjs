// 扇出优先 F1（0.13.20）——阵列判定 / 环深 / pass-1 队列 moveToFront 回归
// 语义来源：Freerouting BallFields + BallEscapeOrder + TwoLayerBga 源码实证
import * as core from '../src/engine.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// 合成 4×4 圆形球阵（组件前缀 U1-），节距 0.8，球径 0.4
function ballDesign({ nx = 4, ny = 4, shape = 'circle', layer = 'top', prefix = 'U1', pitch = 0.8, w = 0.4 } = {}) {
  const pads = [], nets = [];
  let k = 0;
  for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) {
    const id = prefix + '-' + (++k);
    nets.push({ id: 'n' + k, name: 'n' + k });
    pads.push({ id, x: 2 + c * pitch, y: 2 + r * pitch, w, h: shape === 'circle' ? undefined : w, shape, layer, netId: 'n' + k });
  }
  return { width: 10, height: 10, grid: 0.2, layers: 2, trackW: 0.1, clearance: 0.08,
    viaOuter: 0.3, viaDrill: 0.15, nets, pads };
}

test('判定：4×4 圆形球阵被识别，环深内圈最大/外圈 0', () => {
  const d = core.normalizeDesign(ballDesign());
  const det = core.detectBallArrays(d);
  assert.equal(det.comps.length, 1);
  assert.equal(det.comps[0], 'U1');
  assert.equal(det.ringByNetId.size, 16);
  // 角球（2,2）到包围盒四边最小距离 0 → ring 0；中心球（4.4? 3.2）ring 1
  const cornerRing = det.ringByNetId.get('n1');          // (2,2) 角
  const innerRing = det.ringByNetId.get('n6');           // (3.6,3.6) 内圈
  assert.equal(cornerRing, 0, '角球 ring 0');
  assert.equal(innerRing, 1, '内圈球 ring 1');
});

test('判定：15 球不构成阵列（MIN_BALLS=16）', () => {
  const d0 = ballDesign();
  d0.nets = d0.nets.slice(0, 15); d0.pads = d0.pads.slice(0, 15);
  const det = core.detectBallArrays(core.normalizeDesign(d0));
  assert.equal(det.comps.length, 0);
});

test('判定：QFP 型周边环状焊盘（填充率 <50%）排除', () => {
  const d0 = ballDesign({ nx: 5, ny: 5 });
  // 只留周边 16 颗（5×5 去掉中心 3×3 = 16），填充 16/25 = 64%… 需 <50% 才排除
  // → 用 7×7 周边环（24 颗，填充 24/49≈49%）
  const pads = [], nets = [];
  const N = 7; let k = 0;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (r > 0 && r < N - 1 && c > 0 && c < N - 1) continue;   // 掏空内部
    const id = 'Q1-' + (++k);
    nets.push({ id: 'q' + k, name: 'q' + k });
    pads.push({ id, x: 2 + c * 0.8, y: 2 + r * 0.8, w: 0.4, shape: 'circle', layer: 'top', netId: 'q' + k });
  }
  d0.nets = nets; d0.pads = pads;
  assert.equal(pads.length, 24);
  const det = core.detectBallArrays(core.normalizeDesign(d0));
  assert.equal(det.comps.length, 0, '周边环状 24/49≈49% 应被填充率排除');
});

test('判定：矩形焊盘（LGA/连接器）排除——圆焊盘占比 <75%', () => {
  const d0 = ballDesign({ shape: 'rect' });
  const det = core.detectBallArrays(core.normalizeDesign(d0));
  assert.equal(det.comps.length, 0);
});

test('判定：混层焊盘排除（通孔件语义）', () => {
  const d0 = ballDesign();
  d0.pads[0].layer = 'bottom';
  const det = core.detectBallArrays(core.normalizeDesign(d0));
  assert.equal(det.comps.length, 0);
});

test('fanoutMoveToFront：inner_first 环深降序在前、非阵列网保序在后、同环稳定', () => {
  const mk = (i, ring) => ({ i, fanoutRing: ring });
  const rest = [{ i: 90, fanoutRing: null }, { i: 91, fanoutRing: null }];
  const q = [rest[0], mk(5, 1), mk(3, 2), mk(7, 1), mk(1, 3), rest[1]];
  const out = core.fanoutMoveToFront(q, 'inner_first');
  assert.deepEqual(out.map(n => n.i), [1, 3, 5, 7, 90, 91],
    'inner_first：ring 3→2→1→1（同环按 i 升序），非阵列网殿后保序');
  const out2 = core.fanoutMoveToFront(q, 'outer_first');
  assert.deepEqual(out2.map(n => n.i), [5, 7, 3, 1, 90, 91],
    'outer_first：ring 1→1→2→3');
  // 无阵列网：原队列原样返回
  const plain = [{ i: 2, fanoutRing: null }, { i: 1, fanoutRing: null }];
  assert.deepEqual(core.fanoutMoveToFront(plain, 'inner_first').map(n => n.i), [2, 1]);
});

test('非法 fanoutFirst 值干净报错', () => {
  const d = core.normalizeDesign(ballDesign());
  // 两端各加一个目标焊盘让网可布
  for (let k = 1; k <= 16; k++)
    d.pads.push({ id: 'T-' + k, x: 8, y: 1 + k * 0.5, w: 0.4, h: 0.4, shape: 'circle', layer: 'bottom', netId: 'n' + k });
  assert.throws(() => core.routeBoard(d, { fanoutFirst: 'bogus', maxIter: 2 }), /fanoutFirst/);
});

test('fanoutBorrowPen 校验：负值/NaN/Infinity 干净报错（负权会破坏 A* 不变量）', () => {
  const d0 = ballDesign();
  for (let k = 1; k <= 16; k++)
    d0.pads.push({ id: 'T-' + k, x: 8, y: 1 + k * 0.5, w: 0.4, h: 0.4, shape: 'circle', layer: 'bottom', netId: 'n' + k });
  const d = core.normalizeDesign(d0);
  for (const bad of [-1, NaN, Infinity])
    assert.throws(() => core.routeBoard(d, { fanoutFirst: 'inner_first', fanoutBorrowPen: bad, maxIter: 2 }),
      /fanoutBorrowPen/, 'pen=' + bad + ' 应报错');
});

test('BGA-64 行为门：inner_first 连通 98/98 且 DRC ≤ 33（不劣于基线）', { timeout: 900000 }, async () => {
  const { readFileSync } = await import('node:fs');
  const d0 = JSON.parse(readFileSync('projects/round6/n71-bga64/design.json', 'utf8'));
  const d = core.normalizeDesign(JSON.parse(JSON.stringify(d0)));
  const r = core.routeBoard(d, { maxIter: 20, fanoutFirst: 'inner_first' }).result;
  assert.equal(r.stats.connected + '/' + r.stats.total, '98/98');
  assert.ok(r.drcErrors <= 33, 'DRC ' + r.drcErrors + ' > 基线 33');
});

test('缺省位级不变：无阵列板 ON/OFF 结果逐字一致', { timeout: 300000 }, () => {
  // 无组件前缀命名（id 不含 '-'）→ 每焊盘独立"组件"→ 无阵列 → 队列不变
  const nets = [], pads = [];
  for (let k = 1; k <= 20; k++) {
    nets.push({ id: 'n' + k, name: 'n' + k });
    pads.push({ id: 'p' + k, x: 1 + (k % 5) * 1.2, y: 1 + ((k / 5) | 0) * 1.2, w: 0.4, shape: 'circle', layer: 'top', netId: 'n' + k });
    pads.push({ id: 'q' + k, x: 8, y: 1 + k * 0.4, w: 0.4, h: 0.4, shape: 'circle', layer: 'bottom', netId: 'n' + k });
  }
  const mk = () => core.normalizeDesign({ width: 10, height: 10, grid: 0.2, layers: 2,
    trackW: 0.1, clearance: 0.08, viaOuter: 0.3, viaDrill: 0.15,
    nets: JSON.parse(JSON.stringify(nets)), pads: JSON.parse(JSON.stringify(pads)) });
  const rOff = core.routeBoard(mk(), { maxIter: 8 }).result;
  const rOn = core.routeBoard(mk(), { maxIter: 8, fanoutFirst: 'inner_first' }).result;
  assert.equal(JSON.stringify(rOff.nets), JSON.stringify(rOn.nets), '无阵列板 ON/OFF 必须位级一致');
});
