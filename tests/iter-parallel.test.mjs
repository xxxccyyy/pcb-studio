import * as core from '../src/engine.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

const ENGINE_URL = new URL('../src/engine.mjs', import.meta.url).href;

function design() {
  const d = core.designDefaults();
  d.width = 30; d.height = 14; d.grid = 0.25; d.trackW = 0.25; d.clearance = 0.15;
  d.nets = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
  d.pads = [
    { id: 'A1-1', netId: 'a', x: 3, y: 4, w: 1, h: 1, layer: 'top' },
    { id: 'A1-2', netId: 'a', x: 27, y: 10, w: 1, h: 1, layer: 'top' },
    { id: 'B1-1', netId: 'b', x: 3, y: 7, w: 1, h: 1, layer: 'top' },
    { id: 'B1-2', netId: 'b', x: 27, y: 4, w: 1, h: 1, layer: 'top' },
    { id: 'C1-1', netId: 'c', x: 3, y: 10, w: 1, h: 1, layer: 'top' },
    { id: 'C1-2', netId: 'c', x: 27, y: 7, w: 1, h: 1, layer: 'top' },
  ];
  return d;
}

test('routeBoardIterParallel：结果有效（status/连通/DRC）', async () => {
  const d = design();
  const par = await core.routeBoardIterParallel(d, { iterWorkers: 3, engineUrl: ENGINE_URL, maxIter: 15 });
  assert.equal(par.result.status, 'complete', JSON.stringify({ conn: par.result.stats, drc: par.result.drcErrors }));
  assert.equal(par.result.stats.connected, par.result.stats.total, '全连通');
  assert.equal(par.result.drcErrors, 0, 'DRC 干净');
  assert.equal(par.workers, 3, 'worker 数回传');
  assert(par.iterations > 0, '迭代数回传');
});

test('routeBoardIterParallel：确定性（同输入两次输出一致）', async () => {
  const mk = () => design();
  const d1 = mk(), d2 = mk();
  const a = await core.routeBoardIterParallel(d1, { iterWorkers: 2, engineUrl: ENGINE_URL, maxIter: 15 });
  const b = await core.routeBoardIterParallel(d2, { iterWorkers: 2, engineUrl: ENGINE_URL, maxIter: 15 });
  const strip = r => JSON.stringify({ st: r.result.status, stats: r.result.stats, paths: r.result.nets.map(n => n.paths), vias: r.result.nets.map(n => n.vias) });
  assert.equal(strip(a), strip(b), '两次并行协商输出一致');
});

test('routeBoardIterParallel：质量与串行同级（连通/DRC/过孔），optimize 后长度收敛', async () => {
  const d1 = design(), d2 = JSON.parse(JSON.stringify(d1));
  const par = await core.routeBoardIterParallel(d1, { iterWorkers: 2, engineUrl: ENGINE_URL, maxIter: 15 });
  const seq = core.routeBoard(d2, { maxIter: 15 });
  // 同级口径：连通与 DRC 完全一致（批内并发导致的路径微差由 optimize 收敛）
  assert.equal(par.result.stats.connected, seq.result.stats.connected, '连通同级');
  assert.equal(par.result.drcErrors, 0, 'DRC 干净');
  assert.equal(seq.result.drcErrors, 0, '串行 DRC 干净');
  // 逐网优化后总长差 <5%（批内并发协商的预期微差）
  const lenDelta = Math.abs(par.result.stats.trackLen - seq.result.stats.trackLen) / seq.result.stats.trackLen;
  assert(lenDelta < 0.05, `长度差 ${(lenDelta * 100).toFixed(1)}% 应 <5%`);
});

test('routeBoardIterParallel：iterWorkers<2 回退串行', async () => {
  const d = design();
  const par = await core.routeBoardIterParallel(d, { iterWorkers: 1, engineUrl: ENGINE_URL, maxIter: 15 });
  assert.equal(par.fallback, true, '回退标记');
  assert.equal(par.result.stats.connected, par.result.stats.total);
});
