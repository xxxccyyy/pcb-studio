// 引擎 A/B 位级对拍架（深优轮常备工具，2026-11-15 转正——此前各轮的 diff 架留在 .scratch
// 未随库存档，CHANGELOG 0.14.4 已记"留痕缺口"；本工具让任意一轮优化可复现）。
//
// 用法：
//   node scripts/ab-diff.mjs [--before <git-ref>] [--quick]
//     --before  基线引擎的 git 引用（默认 HEAD）。工作区引擎为 after 侧。
//     --quick   跳过 >30s 慢案例（fable-03 栅格/形状/铺铜/DRC 全口径），日常快速对拍用。
//
// 口径：
//   - before 引擎 = `git show <ref>:src/engine.mjs` 归一化 LF 后写 .scratch/engine-before.mjs
//     （data 模块独立实例，与工作区引擎同进程共存）。
//   - 输出经 clean() 清理：session（会话句柄：t0 墙钟 + typed arrays，非交付物）与 timeMs
//     递归剔除后 sha256 逐字节对比。
//   - 实测 routeBoard 的 result 字段跨进程/跨运行逐字节确定（0.14.4，e555 三连跑同哈希）——
//     位级对拍的成立前提，若未来某轮改动破坏了它，本工具的 PASS/FAIL 会直接暴露。
//   - 两案例曾借此抓真 bug：pour slab yhi 水平边漏检、pairCoupleStats 端点序假设
//     （见 docs/深度优化报告-20261114.md §4）。
import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const argv = process.argv.slice(2);
const beforeRef = argv.includes('--before') ? argv[argv.indexOf('--before') + 1] : 'HEAD';
const QUICK = argv.includes('--quick');

const srcBefore = execSync(`git show ${beforeRef}:src/engine.mjs`, { maxBuffer: 64 * 1024 * 1024 })
  .toString('utf8').replace(/\r\n/g, '\n');
writeFileSync(new URL('../.scratch/engine-before.mjs', import.meta.url), srcBefore);
const before = await import(new URL('../.scratch/engine-before.mjs', import.meta.url).href);
const after = await import('../src/engine.mjs');

const clean = r => JSON.parse(JSON.stringify(r, (k, v) =>
  (k === 'timeMs' || k === 't0' || k === 'session') ? undefined : v));
const sha = r => createHash('sha256').update(JSON.stringify(clean(r))).digest('hex').slice(0, 16);

const load = p => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const fable = load('../projects/ext-fable-03/placed.json');
const m1 = load('../projects/m1-4layer/p01-lqfp144-mcu/design.json');
const h2 = load('../projects/h2-stm32/design.json');        // 2 层容量停滞档（75/77 卡死特征）
const atmega = load('../projects/atmega328p-minsys/design.json');

function stressDesign() {
  const d = before.designDefaults();
  d.width = 40; d.height = 22; d.grid = 0.5;
  d.nets = []; d.pads = [];
  const ys = [2.5, 5, 7.5, 10, 12.5, 15, 17.5, 20];
  ys.forEach((y, i) => {
    const id = 'n' + i;
    d.nets.push({ id, name: id });
    d.pads.push({ id: id + 'L', netId: id, x: 6, y, w: 1.4, h: 1.4, layer: ['top', 'bottom', 'both', 'top'][i % 4] });
    d.pads.push({ id: id + 'R', netId: id, x: 34, y, w: 1.4, h: 1.4, layer: ['bottom', 'top', 'both', 'bottom'][(i + 1) % 4] });
  });
  const c = 2.5 / 2;
  d.keepouts = [
    { x: 20, y: (2.5 + 10 - c) / 2, w: 17, h: (10 - c) - 2.5 },
    { x: 20, y: (10 + c + 20) / 2, w: 17, h: 20 - (10 + c) }
  ];
  return d;
}

const sessionRoute = (core, d, opts) => {
  const s = core.createSession(d, opts);
  for (;;) { if (s.step().done) break; }
  return s;
};

const cases = [
  ['e555 routeBoard', core => core.routeBoard(core.EXAMPLES[0].build(), { viaCost: 15 })],
  ['eled routeBoard', core => core.routeBoard(core.EXAMPLES[1].build(), { viaCost: 15 })],
  ['emcu routeBoard', core => core.routeBoard(core.EXAMPLES[2].build(), { viaCost: 15 })],
  ['m1-p01 routeBoard', core => core.routeBoard(JSON.parse(JSON.stringify(m1)), { viaCost: 15 })],
  ['atmega routeBoard', core => core.routeBoard(JSON.parse(JSON.stringify(atmega)), { viaCost: 15 })],
  ['e555 autoPlace', core => core.autoPlace(core.EXAMPLES[0].build(), {})],
  ['emcu placeAndRoute', core => core.placeAndRoute(core.EXAMPLES[2].build(), {})],
  ['压力板 optimize(3)', core => { const s = sessionRoute(core, stressDesign(), { viaCost: 15, maxIter: 30 }); const snap = s.snapshot(); s.restore(snap); s.optimize(3); return s.buildResult(); }],
];
if (!QUICK) {
  cases.push(
    ['h2-stm32 routeBoard', core => core.routeBoard(JSON.parse(JSON.stringify(h2)), { viaCost: 15 })],   // 容量停滞档，单引擎 ~3min
    ['fable-03 栅格全链', core => core.routeBoard(JSON.parse(JSON.stringify(fable)), { viaCost: 15 })],
    ['fable-03 形状补线', core => core.routeBoardShape(JSON.parse(JSON.stringify(fable)), {})],
    ['fable-03 shape-only', core => { const r = core.routeBoard(JSON.parse(JSON.stringify(fable)), { viaCost: 15 }).result; return core.routeBoardShape(JSON.parse(JSON.stringify(fable)), { base: r }); }],
    // 铺铜 / DRC 全口径：以各引擎自己的栅格链结果为输入（同结果前提下等价口径）
    ['fable-03 铺铜', core => { const r = core.routeBoard(JSON.parse(JSON.stringify(fable)), { viaCost: 15 }); return core.computePour(JSON.parse(JSON.stringify(fable)), r, { islandMode: 'area' }); }],
    ['fable-03 DRC 全口径', core => { const r = core.routeBoard(JSON.parse(JSON.stringify(fable)), { viaCost: 15 }); return core.checkDRC(JSON.parse(JSON.stringify(fable)), r, { dfm: true }); }],
  );
}

let fail = 0;
for (const [name, fn] of cases) {
  const t0 = performance.now();
  let a, b;
  try { a = sha(fn(before)); } catch (e) { a = 'ERR:' + e.message.slice(0, 120); }
  try { b = sha(fn(after)); } catch (e) { b = 'ERR:' + e.message.slice(0, 120); }
  const ok = a === b;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(22)} ${a} vs ${b}  (${((performance.now() - t0) / 1000).toFixed(1)}s)`);
}
console.log(fail === 0 ? `\nALL ${cases.length} CASES BIT-IDENTICAL (before=${beforeRef} → after=worktree)` : `\n${fail} CASES DIVERGED (before=${beforeRef})`);
process.exitCode = fail === 0 ? 0 : 1;
