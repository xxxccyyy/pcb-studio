// 实验 2：细间距 = trackW↓ + clearance↓ + via↓ 联动验证
// halfClr = clearance + maxTrackW/2；要打开逃逸走廊需要 halfClr < (pitch-padH)/2 + padH/2 - ... 实测决定
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const mA = html.match(new RegExp('// ==== ROUTER CORE START ====([\\s\\S]*?)// ==== ROUTER CORE END ===='));
const mB = html.match(new RegExp('// ==== EXAMPLES START ====([\\s\\S]*?)// ==== EXAMPLES END ===='));
const core = new Function(mA[1] + '\n' + mB[1] + '\nreturn {placeAndRoute, checkDRC};')();
const names = process.argv.slice(2);
const combos = [
  { label: '基线 0.4/0.2clr/0.8via', trackW: 0.4, clearance: 0.2, viaOuter: 0.8, viaDrill: 0.4 },
  { label: '线细 0.2/0.2clr/0.8via', trackW: 0.2, clearance: 0.2, viaOuter: 0.8, viaDrill: 0.4 },
  { label: '联动 0.2/0.1clr/0.6via', trackW: 0.2, clearance: 0.1, viaOuter: 0.6, viaDrill: 0.3 },
  { label: '联动 0.15/0.1clr/0.5via', trackW: 0.15, clearance: 0.1, viaOuter: 0.5, viaDrill: 0.25 }
];
for (const name of names) {
  const orig = JSON.parse(readFileSync(new URL(`./${name}/design.json`, import.meta.url), 'utf8'));
  console.log(`\n=== ${name}（grid=${orig.grid}）===`);
  for (const cb of combos) {
    const d = JSON.parse(JSON.stringify(orig));
    Object.assign(d, { trackW: cb.trackW, clearance: cb.clearance, viaOuter: cb.viaOuter, viaDrill: cb.viaDrill });
    for (const n of d.nets) if (n.w) n.w = Math.min(n.w, cb.trackW);
    const t0 = Date.now();
    const r = core.placeAndRoute(d, { rounds: 1, iterations: 2000, maxIter: 30 });
    const b = r.best;
    const issues = core.checkDRC(d, b);
    const drcE = issues.filter(i => i.sev === 'error').length;
    console.log(`  ${cb.label}: ${b.stats.connected}/${b.stats.total} via=${b.stats.vias} overuse=${b.overuse.length} drcErr=${drcE} ${((Date.now()-t0)/1000).toFixed(1)}s`);
  }
}
