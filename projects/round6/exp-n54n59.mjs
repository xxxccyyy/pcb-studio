// n54/n59 补救实验：rounds 与 seed 扫描（先做参数级补救，再决定是否引擎级修复）
import { readFileSync } from 'node:fs';
import { placeAndRoute, checkDRC } from '../../src/engine.mjs';

const cases = [
  ['n54-ttp223-touch', { rounds: 2, iterations: 3000, maxIter: 80 }],
  ['n54-ttp223-touch', { rounds: 4, iterations: 4000, maxIter: 150 }],
  ['n54-ttp223-touch', { rounds: 4, iterations: 4000, maxIter: 150, seed: 7 }],
  ['n54-ttp223-touch', { rounds: 4, iterations: 4000, maxIter: 150, seed: 42 }],
  ['n59-max7219', { rounds: 4, iterations: 4000, maxIter: 150, seed: 7 }],
  ['n59-max7219', { rounds: 4, iterations: 4000, maxIter: 150, seed: 42 }],
  ['n59-max7219', { rounds: 6, iterations: 4000, maxIter: 150 }],
];
for (const [name, opts] of cases) {
  const d = JSON.parse(readFileSync(new URL(`./${name}/design.json`, import.meta.url), 'utf8'));
  const t0 = Date.now();
  let r, err = null;
  try { r = placeAndRoute(d, opts); } catch (e) { err = e.message; }
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  if (!r) { console.log(`${name} ${JSON.stringify(opts)}: ERROR ${err}`); continue; }
  const drc = checkDRC(d, r.best).filter(i => i.sev === 'error');
  const s = r.best.stats;
  console.log(`${name} rounds=${opts.rounds} seed=${opts.seed || 'def'}: ${s.connected}/${s.total} via=${s.vias} ${dt}s drc=${drc.length} over=${(r.best.overuse || []).length} ${r.best.status}`);
}
