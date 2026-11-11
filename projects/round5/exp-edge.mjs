// 实验 A：贴边罚权重 A/B（同种子对照）
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const B = String.fromCharCode(92);
const mA = html.match(new RegExp('// ==== ROUTER CORE START ====([' + B + 's' + B + 'S]*?)// ==== ROUTER CORE END ===='));
const mB = html.match(new RegExp('// ==== EXAMPLES START ====([' + B + 's' + B + 'S]*?)// ==== EXAMPLES END ===='));
const core = new Function(mA[1] + '\n' + mB[1] + '\nreturn {placeAndRoute, checkDRC};')();
for (const name of process.argv.slice(2)) {
  const d0 = JSON.parse(readFileSync(new URL(`./${name}/design.json`, import.meta.url), 'utf8'));
  const dens = (d0.width * d0.height / d0.pads.length).toFixed(1);
  console.log(`=== ${name}（密度 ${dens} mm²/pad）===`);
  for (const ew of [0, 20000, null]) {
    const d = JSON.parse(JSON.stringify(d0));
    const opts = { rounds: 2, iterations: 4000, maxIter: 150 };
    if (ew !== null) opts.edgeWeight = ew;
    const t0 = Date.now();
    const r = core.placeAndRoute(d, opts);
    const b = r.best;
    const drcE = core.checkDRC(d, b).filter(i => i.sev === 'error').length;
    const label = ew === null ? '自适应' : 'ew=' + ew;
    console.log(`  ${label}: ${b.stats.connected}/${b.stats.total} via=${b.stats.vias} over=${b.overuse.length} drc=${drcE} ${((Date.now()-t0)/1000).toFixed(0)}s`);
  }
}
