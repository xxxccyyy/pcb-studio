// 实验 3：协商不收敛（overuse 残留）的调参——viaCost / maxIter / rounds
// 用法：node exp-tune.mjs <name>
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const mA = html.match(new RegExp('// ==== ROUTER CORE START ====([\\s\\S]*?)// ==== ROUTER CORE END ===='));
const mB = html.match(new RegExp('// ==== EXAMPLES START ====([\\s\\S]*?)// ==== EXAMPLES END ===='));
const core = new Function(mA[1] + '\n' + mB[1] + '\nreturn {placeAndRoute, checkDRC};')();
const name = process.argv[2];
const trials = [
  { label: '基线 r2/i50/via15', rounds: 2, iterations: 4000, maxIter: 50, viaCost: 15 },
  { label: '多迭代 r2/i150', rounds: 2, iterations: 4000, maxIter: 150, viaCost: 15 },
  { label: '高via罚 r2/i50/via40', rounds: 2, iterations: 4000, maxIter: 50, viaCost: 40 },
  { label: '高via罚+多迭代 r2/i150/via40', rounds: 2, iterations: 4000, maxIter: 150, viaCost: 40 }
];
const d0 = JSON.parse(readFileSync(new URL(`./${name}/design.json`, import.meta.url), 'utf8'));
console.log(`=== ${name}（${d0.pads.length}p / ${d0.nets.length}n）===`);
for (const t of trials) {
  const d = JSON.parse(JSON.stringify(d0));
  const t0 = Date.now();
  const r = core.placeAndRoute(d, t);
  const b = r.best;
  const drcE = b ? core.checkDRC(d, b).filter(i => i.sev === 'error').length : -1;
  console.log(`  ${t.label}: ${b.stats.connected}/${b.stats.total} via=${b.stats.vias} over=${b.overuse.length} drc=${drcE} ${((Date.now()-t0)/1000).toFixed(0)}s`);
}
