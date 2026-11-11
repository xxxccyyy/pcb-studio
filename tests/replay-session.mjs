// 会话重放诊断工具（路线图阶段一 #5）
// 用法：node tests/replay-session.mjs <design.json> [--rounds N] [--runs N]
// 作用：对同一设计跑 routeBoard N 次，逐阶段（初始布线/优化候选/逐网优化）留痕：
//       状态/连通/vias/DRC/几何哈希 → 判定确定性 + 定位"不可复现违规"出现的阶段。
// 产物：stdout 时间线 + out/replay-<name>.json（两次运行的逐阶段对比）
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { placeAndRoute } from '../src/engine.mjs';

const file = process.argv[2];
if (!file) { console.error('用法: node tests/replay-session.mjs <design.json> [--rounds N] [--runs N]'); process.exit(1); }
const argOf = (flag, def) => { const i = process.argv.indexOf(flag); return i > 0 ? +process.argv[i + 1] : def; };
const ROUNDS = argOf('--rounds', 3);
const RUNS = argOf('--runs', 2);
const name = file.split(/[\\/]/).slice(-2, -1)[0] || 'design';

const design0 = JSON.parse(readFileSync(file, 'utf8'));
const runs = [];
for (let r = 1; r <= RUNS; r++) {
  const d = JSON.parse(JSON.stringify(design0));
  const stages = [];
  const t0 = Date.now();
  const out = placeAndRoute(d, { rounds: ROUNDS, iterations: 4000, maxIter: 150, onStage: st => stages.push(st) });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  const best = out.best;
  runs.push({ run: r, timeSec: +dt, status: best.status, connected: best.stats.connected,
    total: best.stats.total, vias: best.stats.vias, stages });
  console.log(`\n=== 运行 ${r}/${RUNS} — ${dt}s · ${best.status} · ${best.stats.connected}/${best.stats.total} · via=${best.stats.vias} ===`);
  for (const st of stages)
    console.log(`  [${st.stage}] via=${st.viaCost} ${st.status} ${st.connected}/${st.total} drc=${st.drcErrors} hash=${st.hash}`);
}

// 确定性判定：逐阶段哈希对比
const s1 = runs[0].stages, s2 = runs[1]?.stages || [];
const n = Math.max(s1.length, s2.length);
let divergeAt = -1;
for (let i = 0; i < n; i++) {
  if (!s1[i] || !s2[i] || s1[i].hash !== s2[i].hash) { divergeAt = i; break; }
}
console.log('\n=== 确定性判定 ===');
if (RUNS < 2) console.log('（单次运行，跳过对比）');
else if (divergeAt < 0) console.log(`两次运行全部 ${s1.length} 阶段哈希一致 —— 引擎行为确定`);
else {
  console.log(`✗ 第 ${divergeAt + 1} 阶段起出现分歧：`);
  console.log('  run1:', JSON.stringify(s1[divergeAt]));
  console.log('  run2:', JSON.stringify(s2[divergeAt]));
}
const outName = 'replay-' + name + '.json';
writeFileSync(outName, JSON.stringify({ design: file, rounds: ROUNDS, runs }, null, 1));
console.log('已写:', outName);
