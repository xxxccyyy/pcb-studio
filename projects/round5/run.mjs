// 第五轮 runner：批量 place→route→DRC→汇总
// 用法：node run.mjs <tier>   tier = simple | medium | hard | extreme
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const mA = html.match(new RegExp('// ==== ROUTER CORE START ====([\\s\\S]*?)// ==== ROUTER CORE END ===='));
const mB = html.match(new RegExp('// ==== EXAMPLES START ====([\\s\\S]*?)// ==== EXAMPLES END ===='));
const core = new Function(mA[1] + '\n' + mB[1] + '\nreturn {placeAndRoute, checkDRC};')();

const TIER = process.argv[2] || 'all';
const projects = {
  simple:   ['n33-ir-tester', 'n34-usb-splitter', 'n35-pierce-osc', 'n36-cd4017-chaser', 'n37-lm393-photocell'],
  medium:   ['n38-ds3231-rtc', 'n39-lm3914-bar', 'n40-cd4013-ir-latch', 'n41-lm317-337', 'n42-74hc165-cascade'],
  hard:     ['n43-ft232rl', 'n44-tb6612', 'n45-atmega32-tqfp44', 'n46-quad-opamp-pga', 'n47-attiny85-vusb'],
  extreme:  ['n48-qfn32-32u4', 'n49-relay-matrix', 'n50-cp2102n-usbc', 'n51-lqfp48-0402', 'n52-sram-bus']
};
const params = {
  simple:  { rounds: 2, iterations: 3000, maxIter: 80 },
  medium:  { rounds: 4, iterations: 4000, maxIter: 150 },
  hard:    { rounds: 4, iterations: 4000, maxIter: 150 },
  extreme: { rounds: 3, iterations: 4000, maxIter: 150 }
};
const tiers = TIER === 'all' ? Object.keys(projects) : [TIER];
const results = [];
for (const tier of tiers) {
  for (const name of projects[tier]) {
    const file = new URL(`./${name}/design.json`, import.meta.url);
    if (!existsSync(file)) { console.error('SKIP（无 spec）:', name); continue; }
    const d = JSON.parse(readFileSync(file, 'utf8'));
    const pads = d.pads.length, nets = d.nets.length;
    // spec 前置自检：坏引用/单脚网
    const netIds = new Set(d.nets.map(n => n.id));
    const refCount = new Map();
    let badRef = 0;
    for (const p of d.pads) {
      if (p.netId == null) continue;
      if (!netIds.has(p.netId)) { badRef++; console.error(`  [spec] 坏引用 ${p.id} → ${p.netId}`); continue; }
      refCount.set(p.netId, (refCount.get(p.netId) || 0) + 1);
    }
    const singlePad = [...refCount.entries()].filter(([, k]) => k < 2).map(([id]) => id);
    const t0 = Date.now();
    let r = null, err = null;
    try { r = core.placeAndRoute(d, params[tier]); } catch (e) { err = e.message; }
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    let drcErrors = [], drcWarns = [];
    if (r && r.best) {
      const issues = core.checkDRC(d, r.best);
      drcErrors = issues.filter(i => i.sev === 'error').map(i => `${i.type}${i.a ? ' ' + i.a : ''}${i.b ? '/' + i.b : ''}`);
      drcWarns = issues.filter(i => i.sev === 'warn').map(i => i.type);
    }
    const rec = {
      tier, name, pads, nets, timeSec: +dt, err,
      status: r?.best?.status || 'FAIL',
      connected: r?.best?.stats?.connected ?? 0,
      total: r?.best?.stats?.total ?? 0,
      vias: r?.best?.stats?.vias ?? 0,
      len: r?.best?.stats?.len != null ? +(r.best.stats.len / 1000).toFixed(1) : null,
      overuse: r?.best?.overuse?.length ?? -1,
      badRef, singlePad,
      drcErrors, drcWarns
    };
    results.push(rec);
    const pct = rec.total ? Math.round(100 * rec.connected / rec.total) : 0;
    const flag = rec.err ? '✗' : (pct === 100 && drcErrors.length === 0 ? '✓' : '~');
    console.log(`${flag} [${tier}] ${name}: ${pct}% (${rec.connected}/${rec.total}) via=${rec.vias} ${dt}s drc=${drcErrors.length} overuse=${rec.overuse} ${drcErrors[0] || ''}`);
    writeFileSync(new URL('./summary.json', import.meta.url), JSON.stringify(results, null, 1));
  }
}
console.log('\n== 第五轮汇总 ==');
for (const r of results) {
  const pct = r.total ? Math.round(100 * r.connected / r.total) : 0;
  console.log(`${r.tier}\t${r.name}\t${pct}%\t${r.connected}/${r.total}\tvias=${r.vias}\t${r.timeSec}s\tdrcErr=${r.drcErrors.length}\t${r.status}`);
}
