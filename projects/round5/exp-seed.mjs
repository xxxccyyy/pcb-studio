// 实验 B：n40 换种子能否解 1 焊盘围死
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const B = String.fromCharCode(92);
const mA = html.match(new RegExp('// ==== ROUTER CORE START ====([' + B + 's' + B + 'S]*?)// ==== ROUTER CORE END ===='));
const mB = html.match(new RegExp('// ==== EXAMPLES START ====([' + B + 's' + B + 'S]*?)// ==== EXAMPLES END ===='));
const core = new Function(mA[1] + '\n' + mB[1] + '\nreturn {placeAndRoute, checkDRC};')();
const d0 = JSON.parse(readFileSync(new URL('./n40-cd4013-ir-latch/design.json', import.meta.url), 'utf8'));
for (const seed of [42, 43, 44, 45, 46]) {
  const d = JSON.parse(JSON.stringify(d0));
  const t0 = Date.now();
  const r = core.placeAndRoute(d, { rounds: 2, iterations: 4000, maxIter: 150, seed });
  const b = r.best;
  const drcE = core.checkDRC(d, b).filter(i => i.sev === 'error').length;
  console.log(`n40 seed=${seed}: ${b.stats.connected}/${b.stats.total} via=${b.stats.vias} over=${b.overuse.length} drc=${drcE} ${((Date.now()-t0)/1000).toFixed(0)}s`);
}
