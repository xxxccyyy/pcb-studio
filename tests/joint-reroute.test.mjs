// 多网联合重布（0.14.1，#12b 多网联合规划栅格侧）——失败网+阻塞者 mask 枚举回归
// 王牌测试用 Fable 实板：commitRoutes 摄入存档 84/95 态（无需重跑协商），
// jointReroute 直接打真实现场。
import * as core from '../src/engine.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const drc = (d, r) => core.checkDRC(d, { ...r, nets: [...r.nets, ...core.manualRouteEntries(d)] }, { dfm: false })
  .filter(i => i.sev === 'error');

test('Fable 实板接入：摄档 84/95 态 → jointReroute 联合重排', { timeout: 900000 }, () => {
  const d = core.normalizeDesign(JSON.parse(readFileSync(
    new URL('../projects/ext-fable-01/design-redeliver.json', import.meta.url), 'utf8')));
  const saved = JSON.parse(readFileSync(
    new URL('../projects/ext-fable-01/result-redeliver.json', import.meta.url), 'utf8'));
  const sess = core.createSession(d, {});
  // 摄入存档态：netId→i 映射 + viaSet 重建（result vias 是点对象，需回算格号）
  const GW = Math.round(d.width / d.grid), NC = GW * Math.round(d.height / d.grid);
  const cellOf = (x, y) => Math.round(x / d.grid - 0.5) + GW * Math.round(y / d.grid - 0.5);
  const iOf = new Map(d.nets.map((n, i) => [n.id, i]));
  const results = saved.nets.map(n => {
    const i = iOf.get(n.netId);
    if (i == null) return null;
    return { i, failed: n.total - n.connected, connected: n.connected,
      cells: n.cells || [], paths: n.paths,
      viaSet: (n.vias || []).map(v => [cellOf(v.x, v.y), { x: v.x, y: v.y, ...(v.layers ? { layers: v.layers } : {}) }]) };
  }).filter(Boolean);
  sess.commitRoutes(results, false);
  const before = sess.buildResult();
  const connBefore = before.stats.connected;
  const drcBefore = drc(d, before).length;
  const rep = sess.jointReroute();
  const after = sess.buildResult();
  assert.ok(rep.nets.length > 0, '存档态有失败网，joint 应尝试');
  assert.ok(after.stats.connected >= connBefore, '连通不得回退');
  assert.ok(drc(d, after).filter(i => i.sev === 'error').length <= drcBefore, 'DRC error 不得增加');
  if (rep.improved > 0) {
    for(const p of rep.nets.filter(x => x.action === 'improved'))
      assert.ok(p.connAfter >= p.connBefore, 'improved 网连通不得回退');
  }
  console.log('  [fable-01 joint]', JSON.stringify({improved: rep.improved,
    actions: rep.nets.map(n => n.action), connBefore, connAfter: after.stats.connected,
    drcBefore, drcAfter: drc(d, after).length}));
});

test('无失败网板：joint 开/关结果逐字一致（no-op 门）', () => {
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
  const rOff = core.routeBoard(mk(), { maxIter: 12, jointReroute: false }).result;
  const rOn = core.routeBoard(mk(), { maxIter: 12 }).result;
  assert.equal(JSON.stringify(rOff.nets), JSON.stringify(rOn.nets));
  assert.ok(!rOn.joint, '无失败网板不得附 joint 报告');
});

test('确定性：joint 双跑逐字一致', { timeout: 900000 }, () => {
  const load = () => core.normalizeDesign(JSON.parse(readFileSync(
    new URL('../projects/ext-fable-01/design-redeliver.json', import.meta.url), 'utf8')));
  const r1 = core.routeBoard(load(), { maxIter: 12 }).result;
  const r2 = core.routeBoard(load(), { maxIter: 12 }).result;
  assert.equal(JSON.stringify(r1.nets), JSON.stringify(r2.nets));
  assert.equal(JSON.stringify(r1.joint), JSON.stringify(r2.joint));
});

test('opts 校验：jointRerouteMaxNets/jointR 越界干净报错', () => {
  const mk = () => core.normalizeDesign({
    width: 10, height: 8, grid: 0.4, layers: 2, trackW: 0.25, clearance: 0.15,
    viaOuter: 0.6, viaDrill: 0.3,
    nets: [{ id: 'a', name: 'A' }],
    pads: [
      { id: 'a1', netId: 'a', x: 2, y: 4, w: 1, h: 1, shape: 'rect', layer: 'top' },
      { id: 'a2', netId: 'a', x: 8, y: 4, w: 1, h: 1, shape: 'rect', layer: 'top' }
    ]
  });
  assert.throws(() => core.routeBoard(mk(), { maxIter: 2, jointRerouteMaxNets: -1 }), /jointRerouteMaxNets/);
  assert.throws(() => core.routeBoard(mk(), { maxIter: 2, jointR: 0 }), /jointR/);
});
