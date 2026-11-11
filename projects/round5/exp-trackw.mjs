// 实验：验证细间距失败的根因是 trackW（影响区 halfClr=clearance+maxTrackW/2）
// 同一设计分别用 0.4 / 0.25 / 0.2 跑，对比连通率
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const mA = html.match(new RegExp('// ==== ROUTER CORE START ====([\\s\\S]*?)// ==== ROUTER CORE END ===='));
const mB = html.match(new RegExp('// ==== EXAMPLES START ====([\\s\\S]*?)// ==== EXAMPLES END ===='));
const core = new Function(mA[1] + '\n' + mB[1] + '\nreturn {placeAndRoute, checkDRC};')();
const names = process.argv.slice(2);
for (const name of names) {
  const orig = JSON.parse(readFileSync(new URL(`./${name}/design.json`, import.meta.url), 'utf8'));
  console.log(`\n=== ${name}（grid=${orig.grid}）===`);
  for (const tw of [0.4, 0.25, 0.2]) {
    const d = JSON.parse(JSON.stringify(orig));
    d.trackW = tw;
    for (const n of d.nets) if (n.w) n.w = Math.min(n.w, tw);   // 同步压低个别网宽
    const t0 = Date.now();
    const r = core.placeAndRoute(d, { rounds: 1, iterations: 2000, maxIter: 30 });
    const b = r.best;
    const issues = core.checkDRC(d, b);
    const drcE = issues.filter(i => i.sev === 'error').length;
    console.log(`  trackW=${tw}: ${b.stats.connected}/${b.stats.total} via=${b.stats.vias} overuse=${b.overuse.length} drcErr=${drcE} ${((Date.now()-t0)/1000).toFixed(1)}s`);
  }
}
