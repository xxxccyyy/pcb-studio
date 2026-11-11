// 残留项目 rounds=3 重试
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const mA = html.match(new RegExp('// ==== ROUTER CORE START ====([\\s\\S]*?)// ==== ROUTER CORE END ===='));
const mB = html.match(new RegExp('// ==== EXAMPLES START ====([\\s\\S]*?)// ==== EXAMPLES END ===='));
const core = new Function(mA[1] + '\n' + mB[1] + '\nreturn {placeAndRoute, checkDRC};')();
for (const name of process.argv.slice(2)) {
  const d = JSON.parse(readFileSync(new URL(`./${name}/design.json`, import.meta.url), 'utf8'));
  const t0 = Date.now();
  const r = core.placeAndRoute(d, { rounds: 3, iterations: 4000, maxIter: 150 });
  const b = r.best;
  const drcE = core.checkDRC(d, b).filter(i => i.sev === 'error').length;
  console.log(`${name}: ${b.stats.connected}/${b.stats.total} via=${b.stats.vias} over=${b.overuse.length} drc=${drcE} ${((Date.now()-t0)/1000).toFixed(0)}s`);
}
