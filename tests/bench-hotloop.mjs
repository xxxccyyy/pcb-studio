import * as core from '../src/engine.mjs';
// 热循环微基准（2026-11-14 性能深优轮的对比口径，不计入测试套件）
// 覆盖：optimize 热循环（checkGeoSpacing/scanOveruse 主战场）、checkDRC 全口径、
//       形状补线管线、autoPlace 代价函数、computePour + pourContains 探针。
// 用法：node tests/bench-hotloop.mjs —— 每案例打印中位耗时；优化前后各跑一次对比。
import { existsSync, readdirSync, readFileSync } from 'node:fs';

const median = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const bench = (label, runs, fn) => {
  const ts = [];
  let last = null;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    last = fn();
    ts.push(performance.now() - t0);
  }
  console.log(`${label}: ${median(ts).toFixed(1)} ms (n=${runs})`);
  return last;
};
const fmt = r => `complete=${r.status === 'complete'} fails=${r.stats.total - r.stats.connected} ov=${r.overuse.length} vias=${r.stats.vias}`;

// ---- 1. optimize 热循环：示例板 route 完成后 optimize(2) ----
for (const ex of core.EXAMPLES) {
  const d = ex.build();
  const s = core.createSession(d, { viaCost: 15 });
  for (;;) { if (s.step().done) break; }
  const snap = s.snapshot();   // 快照在计时区外预取——optimize 改状态，每轮 restore 回起点
  const r = bench(`${ex.id} optimize(2)`, 5, () => { s.restore(snap); return s.optimize(2); });
  console.log(`  状态: ${fmt(s.buildResult())} improved=${r.improved}`);
}

// ---- 2. 拥塞压力板 optimize(3)（逐网接受判定高频触发 checkGeoSpacing）----
function stressDesign(channel) {
  const d = core.designDefaults();
  d.width = 40; d.height = 22; d.grid = 0.5;
  d.nets = []; d.pads = [];
  const ys = [2.5, 5, 7.5, 10, 12.5, 15, 17.5, 20];
  ys.forEach((y, i) => {
    const id = 'n' + i;
    d.nets.push({ id, name: id });
    d.pads.push({ id: id + 'L', netId: id, x: 6, y, w: 1.4, h: 1.4, layer: ['top', 'bottom', 'both', 'top'][i % 4] });
    d.pads.push({ id: id + 'R', netId: id, x: 34, y, w: 1.4, h: 1.4, layer: ['bottom', 'top', 'both', 'bottom'][(i + 1) % 4] });
  });
  const c = channel / 2;
  d.keepouts = [
    { x: 20, y: (2.5 + 10 - c) / 2, w: 17, h: (10 - c) - 2.5 },
    { x: 20, y: (10 + c + 20) / 2, w: 17, h: 20 - (10 + c) }
  ];
  return d;
}
{
  const d = stressDesign(2.5);
  const s = core.createSession(d, { viaCost: 15, maxIter: 30 });
  for (;;) { if (s.step().done) break; }
  const snap = s.snapshot();
  const r = bench('压力板 optimize(3)', 5, () => { s.restore(snap); return s.optimize(3); });
  console.log(`  状态: ${fmt(s.buildResult())} improved=${r.improved}`);
}

// ---- 3. checkDRC 全口径（DFM/3W/回流地孔/焊盘-走线家族）----
{
  // 合成密板：40×30mm，0.25 栅格，10×6 网格布线后 DRC
  const d = core.designDefaults();
  d.width = 40; d.height = 30; d.grid = 0.25; d.trackW = 0.2; d.clearance = 0.15;
  d.nets = []; d.pads = [];
  for (let r = 0; r < 6; r++) for (let c = 0; c < 10; c++) {
    const id = 'n' + (r * 10 + c);
    d.nets.push({ id, name: id });
    d.pads.push({ id: id + 'A', netId: id, x: 3 + c * 3.6, y: 3 + r * 4.8, w: 0.8, h: 0.8, layer: 'both' });
    d.pads.push({ id: id + 'B', netId: id, x: 4.8 + c * 3.6, y: 6.2 + r * 4.8, w: 0.8, h: 0.8, layer: 'both' });
  }
  const s = core.createSession(d, { viaCost: 15, maxIter: 30 });
  for (;;) { if (s.step().done) break; }
  const res = s.buildResult();
  const full = { ...res, nets: [...res.nets, ...core.manualRouteEntries(d)] };
  bench('密板 checkDRC(dfm)', 7, () => core.checkDRC(d, full, { dfm: true }));
  console.log(`  状态: ${fmt(res)} findings=${core.checkDRC(d, full, { dfm: true }).length}`);
}

// ---- 4. 形状补线管线（fable-03 优先，退化为 round 项目）----
{
  let design = null, base = null, label = '';
  const fp = 'projects/ext-fable-03/';
  if (existsSync(fp + 'design.json')) {
    design = core.normalizeDesign(JSON.parse(readFileSync(fp + 'design.json', 'utf8')));
    base = JSON.parse(readFileSync(fp + 'result.json', 'utf8'));
    label = 'fable-03 routeBoardShape';
  } else {
    for (const root of ['projects/round11/out', 'projects/round10/out']) {
      if (!existsSync(root)) continue;
      const name = readdirSync(root)[0];
      if (!name) continue;
      design = core.normalizeDesign(JSON.parse(readFileSync(root + '/' + name + '/design.json', 'utf8')));
      base = JSON.parse(readFileSync(root + '/' + name + '/result.json', 'utf8'));
      label = 'shape:' + name;
      break;
    }
  }
  if (design && base) bench(label, 3, () => core.routeBoardShape(design, { base: JSON.parse(JSON.stringify(base)) }));
  else console.log('shape: 无可用项目，跳过');
}

// ---- 5. autoPlace（emcu，代价函数热点）----
{
  const d = core.EXAMPLES[2].build();
  bench('emcu autoPlace', 5, () => core.autoPlace(core.normalizeDesign(d), { seed: 42 }));
}

// ---- 6. computePour + pourContains 探针（压力板布线结果上铺 GND）----
{
  const d = stressDesign(4);
  const s = core.createSession(d, { viaCost: 15, maxIter: 30 });
  for (;;) { if (s.step().done) break; }
  const res = s.buildResult();
  const pour = bench('压力板 computePour', 5, () => core.computePour(d, res, { layer: 1, netId: 'n0', thermal: true }));
  let seed = 12345 >>> 0;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const probes = Array.from({ length: 2000 }, () => [rnd() * d.width, rnd() * d.height]);
  bench('pourContains×2000', 7, () => probes.reduce((a, [x, y]) => a + (core.pourContains(pour, x, y) ? 1 : 0), 0));
}
console.log('BENCH DONE');
