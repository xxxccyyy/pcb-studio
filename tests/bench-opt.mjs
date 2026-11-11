import * as core from '../src/engine.mjs';
// 基准：逐网优化器与跨障折扣的效果对比（不计入测试套件）
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function extract(mark) {
  const m = html.match(new RegExp('// ==== ' + mark + ' START ====([\\s\\S]*?)// ==== ' + mark + ' END ===='));
  if (!m) throw new Error('未找到代码块：' + mark);
  return m[1];
}


function runFull(design, opts) {
  const s = core.createSession(design, opts || {});
  for (;;) { if (s.step().done) break; }
  const before = s.buildResult();
  const t0 = Date.now();
  const opt = s.optimize(2);
  const optMs = Date.now() - t0;
  const after = s.buildResult();
  return { before, after, opt, optMs };
}
const fmt = r => `complete=${r.status === 'complete'} fails=${r.stats.total - r.stats.connected} ov=${r.overuse.length} vias=${r.stats.vias} len=${r.stats.trackLen.toFixed(1)}`;

for (const ex of core.EXAMPLES) {
  for (const viaCost of [15, 50]) {
    const d = ex.build();
    const { before, after, opt, optMs } = runFull(d, { viaCost });
    const gained = (after.stats.vias < before.stats.vias) || (after.stats.trackLen < before.stats.trackLen - 1e-6);
    console.log(`${ex.id} viaCost=${viaCost}`);
    console.log(`  优化前: ${fmt(before)}`);
    console.log(`  优化后: ${fmt(after)}   (optimize 改进 ${opt.improved} 处, ${optMs}ms)${gained ? '  ◀ 有实质改进' : ''}`);
  }
}

// ---- 拥塞压力板：狭窄通道 + 强制换层，制造协商后残留次优路径 ----
function stressDesign(channel) {
  const d = core.designDefaults();
  d.width = 40; d.height = 22; d.grid = 0.5;
  d.nets = [];
  d.pads = [];
  const ys = [2.5, 5, 7.5, 10, 12.5, 15, 17.5, 20];
  ys.forEach((y, i) => {
    const id = 'n' + i;
    d.nets.push({ id, name: id });
    const leftLayer = ['top', 'bottom', 'both', 'top'][i % 4];
    const rightLayer = ['bottom', 'top', 'both', 'bottom'][(i + 1) % 4];
    d.pads.push({ id: id + 'L', netId: id, x: 6, y, w: 1.4, h: 1.4, layer: leftLayer });
    d.pads.push({ id: id + 'R', netId: id, x: 34, y, w: 1.4, h: 1.4, layer: rightLayer });
  });
  // 中部两条水平禁布带，只留 channel 宽通道
  const c = channel / 2;
  d.keepouts = [
    { x: 20, y: 10 - 5 - c, w: 17, h: 10 - 2.5 + 0 }, // 上带：y 2.5~(10-c)
    { x: 20, y: 10 + 5 + c, w: 17, h: 10 }
  ];
  d.keepouts = [
    { x: 20, y: (2.5 + 10 - c) / 2, w: 17, h: (10 - c) - 2.5 },
    { x: 20, y: (10 + c + 20) / 2, w: 17, h: 20 - (10 + c) }
  ];
  return d;
}
for (const [ch, maxIter] of [[4, 30], [2.5, 30], [2.5, 6]]) {
  const d = stressDesign(ch);
  const s = core.createSession(d, { viaCost: 15, maxIter });
  for (;;) { if (s.step().done) break; }
  const before = s.buildResult();
  const t0 = Date.now();
  const opt = s.optimize(3);
  const optMs = Date.now() - t0;
  const after = s.buildResult();
  const gained = (after.stats.vias < before.stats.vias) || (after.stats.trackLen < before.stats.trackLen - 1e-6)
    || (after.overuse.length < before.overuse.length) || (after.stats.total - after.stats.connected) < (before.stats.total - before.stats.connected);
  console.log(`拥塞压力板(通道${ch}mm, maxIter=${maxIter})`);
  console.log(`  优化前: ${fmt(before)}`);
  console.log(`  优化后: ${fmt(after)}   (optimize 改进 ${opt.improved} 处, ${optMs}ms)${gained ? '  ◀ 有实质改进' : ''}`);
}
