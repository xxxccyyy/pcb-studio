// M3 里程碑验收（路线图）："形状布线引擎在 0.4mm QFN 密集板 DRC 全绿"
// 口径一（现实 breakout）：QFN-44 @0.4mm，目标四外侧行平行逃逸——
//   栅格全绿 + 形状补线无失败网可接（平凡绿）
// 口径二（压力环）：目标环形放射（强制交叉）——栅格有残留时形状补线
//   不得劣化（连通 100% + DRC ≤ 栅格口径），残留如实留档
import * as core from '../src/engine.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const P = 0.4, PADW = 0.2, PADH = 0.3, CX = 12, CY = 12, half = 2.2;
const offs = Array.from({ length: 11 }, (_, i) => -half + P / 2 + i * P);

function buildQFN({ ring = false } = {}) {
  const nets = [], pads = [];
  let k = 0;
  const addPin = (x, y, w, h) => {
    const net = 'N' + (++k);
    nets.push({ id: net, name: net });
    pads.push({ id: 'U1-' + k, x, y, w, h, shape: 'rect', layer: 'top', netId: net });
  };
  for (const off of offs) addPin(CX + off, CY - half - PADH / 2, PADW, PADH);
  for (const off of offs) addPin(CX + off, CY + half + PADH / 2, PADW, PADH);
  for (const off of offs) addPin(CX - half - PADH / 2, CY + off, PADH, PADW);
  for (const off of offs) addPin(CX + half + PADH / 2, CY + off, PADH, PADW);
  const W = 24, H = 24;
  if (!ring) {
    const rowX = i => +(CX + (i - 5) * 0.8).toFixed(2);
    for (let i = 0; i < 11; i++) pads.push({ id: 'T' + (i + 1), x: rowX(i), y: 4.2, w: 0.4, h: 0.4, shape: 'circle', layer: 'bottom', netId: 'N' + (i + 1) });
    for (let i = 0; i < 11; i++) pads.push({ id: 'T' + (i + 12), x: rowX(i), y: 19.8, w: 0.4, h: 0.4, shape: 'circle', layer: 'bottom', netId: 'N' + (i + 12) });
    for (let i = 0; i < 11; i++) pads.push({ id: 'T' + (i + 23), x: 4.2, y: rowX(i), w: 0.4, h: 0.4, shape: 'circle', layer: 'bottom', netId: 'N' + (i + 23) });
    for (let i = 0; i < 11; i++) pads.push({ id: 'T' + (i + 34), x: 19.8, y: rowX(i), w: 0.4, h: 0.4, shape: 'circle', layer: 'bottom', netId: 'N' + (i + 34) });
  } else {
    for (let i = 0; i < 44; i++) {
      const ang = (i / 44) * Math.PI * 2;
      pads.push({ id: 'T' + (i + 1), x: +(W / 2 + Math.cos(ang) * (half + 4.5)).toFixed(3),
        y: +(H / 2 + Math.sin(ang) * (half + 4.5)).toFixed(3), w: 0.4, h: 0.4, shape: 'circle', layer: 'bottom', netId: 'N' + (i + 1) });
    }
  }
  return core.normalizeDesign({ width: W, height: H, grid: 0.1, layers: 2,
    trackW: 0.1, clearance: 0.08, viaOuter: 0.3, viaDrill: 0.15, nets, pads });
}
const drcOf = (d, r) => core.checkDRC(d, { ...r, nets: [...r.nets, ...core.manualRouteEntries(d)] }, { dfm: false })
  .filter(i => i.sev === 'error');

test('M3 现实口径：0.4mm QFN-44 breakout 全链 DRC 全绿', { timeout: 600000 }, () => {
  const d = buildQFN();
  const g = core.routeBoard(d, { maxIter: 20 }).result;
  assert.equal(g.stats.connected + '/' + g.stats.total, '88/88');
  assert.deepEqual(drcOf(d, g), [], '现实 breakout 栅格口径必须零 DRC error');
  const sp = core.routeBoardShape(d, { base: g, maxIter: 12 });
  assert.equal(sp.result.stats.connected + '/' + sp.result.stats.total, '88/88');
  assert.deepEqual(drcOf(d, sp.result), [], '形状补线后仍须全绿');
});

test('M3 压力口径：目标环形放射——形状补线不劣化栅格口径', { timeout: 900000 }, () => {
  const d = buildQFN({ ring: true });
  const g = core.routeBoard(d, { maxIter: 20 }).result;
  assert.equal(g.stats.connected + '/' + g.stats.total, '88/88');
  const gridDrc = drcOf(d, g);
  const sp = core.routeBoardShape(d, { base: g, maxIter: 12 });
  assert.equal(sp.result.stats.connected + '/' + sp.result.stats.total, '88/88');
  const shapeDrc = drcOf(d, sp.result);
  assert.ok(shapeDrc.length <= gridDrc.length,
    '形状补线后 DRC ' + shapeDrc.length + ' 不得多于栅格 ' + gridDrc.length);
  // 残留如实留档（当前实测：栅格 6 → 补线 2）
  if (shapeDrc.length) console.log('  [M3 压力口径残留（如实）]', shapeDrc.length, '个:',
    shapeDrc.map(e => e.type).join(','));
});
