// bisect：n45 的 J1 几何坍缩触发条件
// 用法：node exp-bisect.mjs [去掉的元件前缀，逗号分隔]
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const mA = html.match(new RegExp('// ==== ROUTER CORE START ====([\\s\\S]*?)// ==== ROUTER CORE END ===='));
const mB = html.match(new RegExp('// ==== EXAMPLES START ====([\\s\\S]*?)// ==== EXAMPLES END ===='));
const core = new Function(mA[1] + '\n' + mB[1] + '\nreturn {autoPlace, designDefaults};')();
const drop = (process.argv[2] || '').split(',').filter(Boolean);
const orig = JSON.parse(readFileSync(new URL('./n45-atmega32-tqfp44/design.json', import.meta.url), 'utf8'));
const d = JSON.parse(JSON.stringify(orig));
if (drop.length) {
  d.pads = d.pads.filter(p => !drop.some(pre => p.id.startsWith(pre + '-')));
  for (const pre of drop) delete d.comps[pre];
}
const before = d.pads.filter(p => p.id.startsWith('J1-')).map(p => `${p.id}@${p.x},${p.y}`);
core.autoPlace(d, { iterations: 4000, restarts: 4 });
const j1 = d.pads.filter(p => p.id.startsWith('J1-'));
const xs = [...new Set(j1.map(p => p.x))], ys = [...new Set(j1.map(p => p.y))];
console.log(`drop=[${drop}] J1: comps=${JSON.stringify(d.comps.J1)} 唯一x=${xs.length} 唯一y=${ys.length} ${xs.length < 5 ? '<<< 坍缩!' : 'OK'}`);
if (xs.length < 5) {
  console.log('  放置前:', before.slice(0, 4).join(' | '));
  console.log('  放置后:', j1.slice(0, 4).map(p => `${p.id}@${p.x},${p.y}`).join(' | '));
}
// 其他元件也查一遍
for (const [name] of Object.entries(d.comps)) {
  const ps = d.pads.filter(p => p.id.startsWith(name + '-'));
  if (ps.length < 3) continue;
  const ux = new Set(ps.map(p => p.x)).size, uy = new Set(ps.map(p => p.y)).size;
  // 与 spec 相对几何比：pairwise 距离集合是否保持
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y).toFixed(3);
  console.log(`  ${name}: ${ps.length}p 唯一x=${ux} 唯一y=${uy}`);
}
