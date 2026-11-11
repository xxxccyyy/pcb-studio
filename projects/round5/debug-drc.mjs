// 调试：单项目 DRC 错误明细（与 runner 同参）
// 用法：node debug-drc.mjs <name> [rounds] [maxIter]
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const mA = html.match(new RegExp('// ==== ROUTER CORE START ====([\\s\\S]*?)// ==== ROUTER CORE END ===='));
const mB = html.match(new RegExp('// ==== EXAMPLES START ====([\\s\\S]*?)// ==== EXAMPLES END ===='));
const core = new Function(mA[1] + '\n' + mB[1] + '\nreturn {placeAndRoute, checkDRC};')();
const name = process.argv[2] || 'n44-tb6612';
const rounds = parseInt(process.argv[3] || '1');
const maxIter = parseInt(process.argv[4] || '30');
const d = JSON.parse(readFileSync(new URL(`./${name}/design.json`, import.meta.url), 'utf8'));
console.log(`grid=${d.grid} trackW=${d.trackW} clr=${d.clearance} via=${d.viaOuter}/${d.viaDrill} ${d.width}x${d.height} rounds=${rounds} maxIter=${maxIter}`);
const r = core.placeAndRoute(d, { rounds, iterations: 4000, maxIter });
const b = r.best;
console.log('status', b.status, 'conn', b.stats.connected, '/', b.stats.total, 'vias', b.stats.vias, 'overuse', b.overuse.length);
const done = new Set(b.nets.filter(n => n.done).map(n => n.netId));
for (const net of d.nets) {
  const rn = b.nets.find(n => n.netId === net.id);
  if (!rn || !rn.done) console.log('  未连:', net.id, d.pads.filter(p => p.netId === net.id).length + 'p', b.overuse.filter(o => o.netId === net.id).length + 'over');
}
const issues = core.checkDRC(d, b);
const errs = issues.filter(x => x.sev === 'error');
const byType = {};
for (const i of errs) { (byType[i.type] = byType[i.type] || []).push(i); }
for (const [k, v] of Object.entries(byType)) {
  console.log(`--- ${k} × ${v.length}`);
  for (const i of v.slice(0, 4)) console.log('   ', JSON.stringify(i).slice(0, 200));
}
// 附加：布局与 DRC 类型概览（已有输出之后）
console.log('== 布局 ==');
for (const k of ['U1', 'Y1', 'J1', 'J2', 'J3', 'J4', 'J5', 'J6'])
  if (d.comps[k]) console.log(' ', k, JSON.stringify(d.comps[k]));
