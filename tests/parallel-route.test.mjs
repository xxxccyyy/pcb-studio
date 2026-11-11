import * as core from '../src/engine.mjs';
import assert from 'node:assert/strict';
const ENGINE_URL = new URL('../src/engine.mjs', import.meta.url).href;
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';

// 并行候选布线测试（roadmap 阶段一 #4 的可落地增量：
// freerouting optimizer 线程池 / OpenROAD FlexDR worker 批次的架构对应物）

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

test('routeBoardParallel：结果有效（status/DRC/连通）', async () => {
  const d = design();
  const par = await core.routeBoardParallel(d, { parallel: 3, engineUrl: ENGINE_URL });
  assert(par.result, '有结果');
  assert(['complete', 'partial'].includes(par.result.status), 'status 有效');
  assert(Number.isFinite(par.result.drcErrors), 'DRC 计数存在');
  assert.equal(par.result.drcErrors, 0, 'DRC 干净：' + par.result.drcErrors);
  assert.equal(par.result.stats.connected, par.result.stats.total, '全连通');
  assert(par.parallel, '元信息存在');
  assert(par.parallel.timeMs > 0, 'wall clock 存在');
  assert(par.result.timeMs > 0, 'result.timeMs 与 routeBoard 契约一致');
});

test('routeBoardParallel：质量不低于串行（每候选均优化后取最优）', async () => {
  const d1 = design(), d2 = JSON.parse(JSON.stringify(d1));
  const par = await core.routeBoardParallel(d1, { parallel: 3, engineUrl: ENGINE_URL });
  const seq = core.routeBoard(d2, {});
  const sp = core.routeScore(par.result), ss = core.routeScore(seq.result);
  // 并行版每候选都优化再取最优——质量应 ≥ 串行（串行只优化最优候选）
  assert(!core.scoreBetter(ss, sp), `并行质量劣于串行：par=${JSON.stringify(sp)} seq=${JSON.stringify(ss)}`);
});

test('routeBoardParallel：确定性（同输入两次同结果）', async () => {
  const d1 = design(), d2 = JSON.parse(JSON.stringify(d1));
  const a = await core.routeBoardParallel(d1, { parallel: 3, engineUrl: ENGINE_URL });
  const b = await core.routeBoardParallel(d2, { parallel: 3, engineUrl: ENGINE_URL });
  const strip = r => JSON.stringify({ status: r.result.status, stats: r.result.stats, paths: r.result.nets.map(n => n.paths) });
  assert.equal(strip(a), strip(b), '两次并行输出一致');
});

test('routeBoardParallel：parallel=1 走串行回退路径', async () => {
  const d = design();
  const par = await core.routeBoardParallel(d, { parallel: 1, engineUrl: ENGINE_URL });
  assert.equal(par.result.stats.connected, par.result.stats.total);
  assert.equal(par.result.drcErrors, 0);
});

test('CLI route --parallel：端到端', () => {
  const dir = join(tmpdir(), 'pcb-par-route-test');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const d = design();
  writeFileSync(join(dir, 'design.json'), JSON.stringify(d));
  const out = JSON.parse(execFileSync(process.execPath,
    [join(process.cwd(), 'ai', 'pcb.mjs'), 'route', join(dir, 'design.json'), '-o', join(dir, 'result.json'), '--parallel', '3'],
    { encoding: 'utf8', timeout: 300000 }));
  assert(out.ok && out.via.mode === 'parallel', JSON.stringify(out).slice(0, 200));
  assert.equal(out.status, 'complete');
  const r = JSON.parse(readFileSync(join(dir, 'result.json'), 'utf8'));
  assert.equal(r.stats.connected, r.stats.total);
});
