// 差分对强制压实（0.13.27，0.4.0 留档后续项）——route 后成对重构回归
// 注意口径：routeBoard 会把 grid 提升到 minimumRoutingGrid 并吸附焊盘，
// DRC 复检必须用同一（被改写的）design 对象——用未吸附副本复检会产生
// 假违规（M3/QFN 同款教训，本文件 fixture grid 直接取 minGrid 规避）
import * as core from '../src/engine.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// USB 差分对板（grid 0.4 = minGrid 口径，免吸附）
const mkBoard = ({ keepout = null } = {}) => core.normalizeDesign({
  width: 30, height: 14, grid: 0.4, layers: 4, trackW: 0.25, clearance: 0.15,
  viaOuter: 0.6, viaDrill: 0.3,
  nets: [
    { id: 'p', name: 'USB_DP', pair: 'usb' }, { id: 'm', name: 'USB_DM', pair: 'usb' },
    { id: 'g', name: 'GND' }, { id: 'v', name: 'VBUS' }
  ],
  pads: [
    { id: 'J1-1', netId: 'p', x: 2, y: 4, w: 0.9, h: 1.8, shape: 'rect', layer: 'top' },
    { id: 'J1-2', netId: 'm', x: 2, y: 6, w: 0.9, h: 1.8, shape: 'rect', layer: 'top' },
    { id: 'J1-3', netId: 'v', x: 2, y: 8, w: 0.9, h: 1.8, shape: 'rect', layer: 'top' },
    { id: 'J1-4', netId: 'g', x: 2, y: 10, w: 0.9, h: 1.8, shape: 'rect', layer: 'top' },
    { id: 'U1-1', netId: 'p', x: 28, y: 4, w: 1.2, h: 1.2, shape: 'rect', layer: 'top' },
    { id: 'U1-2', netId: 'm', x: 28, y: 6, w: 1.2, h: 1.2, shape: 'rect', layer: 'top' },
    { id: 'U1-3', netId: 'v', x: 28, y: 8, w: 1.2, h: 1.2, shape: 'rect', layer: 'top' },
    { id: 'U1-4', netId: 'g', x: 28, y: 10, w: 1.2, h: 1.2, shape: 'rect', layer: 'top' }
  ],
  keepouts: keepout ? [keepout] : []
});
const drc = (d, r) => core.checkDRC(d, { ...r, nets: [...r.nets, ...core.manualRouteEntries(d)] }, { dfm: false });

test('已耦合板：压实如实 skipped（0.913 无法更优），DRC 清洁', () => {
  const d = mkBoard();
  const r = core.routeBoard(d, { maxIter: 20 }).result;
  assert.ok(r.compact, 'result 应附 compact 报告');
  assert.equal(r.compact.pairs[0].group, 'usb');
  assert.ok(r.compact.pairs[0].ratioBefore >= 0.6, '偏置路由在此板应已耦合 ≥0.6');
  assert.equal(r.compact.pairs[0].action, 'skipped', '已耦合时不得强行重构');
  assert.equal(r.compact.compacted, 0);
  assert.deepEqual(drc(d, r).filter(i => i.sev === 'error'), []);
  const w = drc(d, r).filter(i => i.type === '差分耦合');
  assert.deepEqual(w, [], '耦合占比 ≥0.6 不得触发差分耦合 warn');
});

test('障碍逼离板：压实提升占比或如实 skipped，最终 DRC 清洁', () => {
  // keepout 横在默认走廊一侧——偏置布线耦合下降，压实器重构或如实放弃
  const d = mkBoard({ keepout: { x: 14, y: 4.2, w: 12, h: 1.2 } });
  const r = core.routeBoard(d, { maxIter: 20 }).result;
  assert.equal(r.stats.connected + '/' + r.stats.total, '8/8');
  assert.ok(r.compact, 'compact 报告必须存在');
  const pair = r.compact.pairs[0];
  assert.ok(['compacted', 'skipped'].includes(pair.action), 'action=' + pair.action);
  if (pair.action === 'compacted') {
    assert.ok(pair.ratioAfter > pair.ratioBefore, '压实必须提升占比');
    assert.equal(r.compact.compacted, 1);
  } else {
    assert.equal(r.compact.skipped, 1);
  }
  assert.deepEqual(drc(d, r).filter(i => i.sev === 'error'), [], '压实验收门：DRC error 不增');
});

test('无 pair 板：compact 开/关结果逐字一致（位级不变门）', () => {
  const mk = () => core.normalizeDesign({
    width: 20, height: 10, grid: 0.4, layers: 2, trackW: 0.25, clearance: 0.15,
    viaOuter: 0.6, viaDrill: 0.3,
    nets: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
    pads: [
      { id: 'a1', netId: 'a', x: 2, y: 3, w: 1, h: 1, shape: 'rect', layer: 'top' },
      { id: 'a2', netId: 'a', x: 18, y: 3, w: 1, h: 1, shape: 'rect', layer: 'top' },
      { id: 'b1', netId: 'b', x: 2, y: 7, w: 1, h: 1, shape: 'rect', layer: 'bottom' },
      { id: 'b2', netId: 'b', x: 18, y: 7, w: 1, h: 1, shape: 'rect', layer: 'bottom' }
    ]
  });
  const rOff = core.routeBoard(mk(), { maxIter: 12, compactPairs: false }).result;
  const rOn = core.routeBoard(mk(), { maxIter: 12 }).result;
  assert.equal(JSON.stringify(rOff.nets), JSON.stringify(rOn.nets));
  assert.ok(!rOn.compact, '无 pair 板不得附 compact 报告');
});

test('带全堵板：压实 skipped 且结果与关闭时逐字一致（restore 语义）', () => {
  // keepout 盖住 p 走线走廊整条带——band 无路可走 → skipped → 快照还原
  // → 同一板 compact 开/关结果必须逐字一致（同板对照，非两块板）
  const mk = () => core.normalizeDesign({
    width: 30, height: 14, grid: 0.4, layers: 4, trackW: 0.25, clearance: 0.15,
    viaOuter: 0.6, viaDrill: 0.3,
    nets: [
      { id: 'p', name: 'USB_DP', pair: 'usb' }, { id: 'm', name: 'USB_DM', pair: 'usb' }
    ],
    pads: [
      { id: 'J1-1', netId: 'p', x: 2, y: 5, w: 0.9, h: 1.8, shape: 'rect', layer: 'top' },
      { id: 'J1-2', netId: 'm', x: 2, y: 8, w: 0.9, h: 1.8, shape: 'rect', layer: 'top' },
      { id: 'U1-1', netId: 'p', x: 28, y: 5, w: 1.2, h: 1.2, shape: 'rect', layer: 'top' },
      { id: 'U1-2', netId: 'm', x: 28, y: 8, w: 1.2, h: 1.2, shape: 'rect', layer: 'top' }
    ],
    keepouts: [{ x: 15, y: 5.0, w: 18, h: 2.6 }]   // 覆盖 p 中段走廊 ±1.3mm（避开焊盘）
  });
  const rOff = core.routeBoard(mk(), { maxIter: 20, compactPairs: false }).result;
  const rOn = core.routeBoard(mk(), { maxIter: 20 }).result;
  assert.equal(rOn.compact.pairs[0].action, 'skipped', '带全堵必须如实 skipped');
  assert.equal(JSON.stringify(rOn.nets), JSON.stringify(rOff.nets),
    'skipped 后快照还原：compact 开/关结果必须逐字一致');
});

test('pairCoupleTarget 校验：越界值干净报错', () => {
  const d = mkBoard();
  assert.throws(() => core.routeBoard(d, { maxIter: 2, pairCoupleTarget: 1.5 }), /pairCoupleTarget/);
  assert.throws(() => core.routeBoard(d, { maxIter: 2, pairCoupleTarget: -0.1 }), /pairCoupleTarget/);
});

test('压实触发现场：偏置失灵（pairBias=false）→ 压实把 partner 拉回间隙带', () => {
  // 会话级驱动：pairBias=false 让 m 脱离走廊（占比 0），compactPairs 重构到
  // 设计间隙带——接受路径（占比提升 + DRC 不增 + 连通满）的端到端证明
  const sess = core.createSession(mkBoard(), { pairBias: false });
  let st;
  while (!(st = sess.step()).done) {}
  const rep = sess.compactPairs();
  assert.equal(rep.compacted, 1, '压实应触发一次');
  const pair = rep.pairs[0];
  assert.equal(pair.action, 'compacted');
  assert.equal(pair.ratioBefore, 0, '偏置失灵现场占比应为 0');
  assert.ok(pair.ratioAfter >= 0.6, '压实后占比 ' + pair.ratioAfter + ' 应达 DRC 阈值');
  assert.ok(rep.drcAfter <= rep.drcBefore, 'DRC error 不得增加');
  const d = mkBoard();
  const r = sess.buildResult();
  assert.equal(r.stats.connected + '/' + r.stats.total, '8/8');
  assert.deepEqual(drc(d, r).filter(i => i.sev === 'error'), []);
  // 压实后耦合 warn 消失（占比 ≥0.6）
  const w = drc(d, r).filter(i => i.type === '差分耦合');
  assert.deepEqual(w, [], '压实后不得再报差分耦合 warn');
});
