// M1 独立审计：全量 20 板重跑（当前引擎 HEAD）+ 独立 DRC + 形状兜底链路复现
// 与 m1-batch.test.mjs（抽样 4 板）不同：本脚本全量跑，且逐板记录栅格/形状两阶段
import { readFileSync, writeFileSync } from 'node:fs';
import * as core from '../../src/engine.mjs';

const SUMMARY = JSON.parse(readFileSync(new URL('./M1-summary.json', import.meta.url), 'utf8'));
const rows = [];
for (const rec of SUMMARY) {
  const d = core.normalizeDesign(JSON.parse(readFileSync(new URL(`./${rec.name}/design.json`, import.meta.url), 'utf8')));
  const t0 = Date.now();
  let r = core.routeBoard(d, { maxIter: 30 }).result;
  const gridStage = { status: r.status, connected: r.stats.connected, total: r.stats.total };
  let shapeUsed = false;
  if (r.status !== 'complete' || r.stats.connected < r.stats.total) {
    const sp = core.routeBoardShape(d, { base: r, maxIter: 12 });
    r = sp.result ?? sp;
    shapeUsed = true;
  }
  const drc = core.checkDRC(d, { ...r, nets: [...r.nets, ...core.manualRouteEntries(d)] }, { dfm: false })
    .filter(i => i.sev === 'error');
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  const ok = r.status === 'complete' && r.stats.connected === r.stats.total && drc.length === 0;
  rows.push({ name: rec.name, pads: d.pads.length, layers: d.layers, grid: gridStage,
    shapeUsed, status: r.status, connected: r.stats.connected, total: r.stats.total,
    vias: r.stats.vias, drcErrors: drc.length, timeSec: +dt, ok,
    mismatchVsSummary: (rec.connected !== r.stats.connected || rec.status !== r.status) });
  console.log(`${ok ? '✓' : '✗'} ${rec.name}: ${r.stats.connected}/${r.stats.total} grid[${gridStage.connected}/${gridStage.total}]${shapeUsed ? ' +SHAPE' : ''} ${dt}s drc=${drc.length}${rows[rows.length-1].mismatchVsSummary ? ' ⚠与存档不符' : ''}`);
  if (!ok) drc.slice(0, 3).forEach(i => console.log('    ', i.msg.slice(0, 90)));
}
const green = rows.filter(x => x.ok).length;
const mismatch = rows.filter(x => x.mismatchVsSummary).length;
console.log(`\n=== M1 独立审计：${green}/20 全绿；与存档不一致 ${mismatch} 板 ===`);
writeFileSync(new URL('./M1-audit.json', import.meta.url), JSON.stringify(rows, null, 1));
if (green < 20) process.exit(1);
