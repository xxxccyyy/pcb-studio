// 锚定补救实验：连接器贴板边 + anchor（验证"布局压缩密封"假设）
// 若锚定后布通 → 假设成立，教训固化为操作规程/引擎改进方向
import { readFileSync, writeFileSync } from 'node:fs';
import { placeAndRoute, checkDRC } from '../../src/engine.mjs';

// 把某元件的焊盘组平移到目标中心（保持相对形状，spec 坐标即锚定位置）
function moveComp(d, comp, cx, cy) {
  const ps = d.pads.filter(p => p.id.startsWith(comp + '-'));
  const mx = ps.reduce((s, p) => s + p.x, 0) / ps.length, my = ps.reduce((s, p) => s + p.y, 0) / ps.length;
  for (const p of ps) { p.x = +(p.x + cx - mx).toFixed(4); p.y = +(p.y + cy - my).toFixed(4); }
  if (d.comps && d.comps[comp]) { d.comps[comp].x = cx; d.comps[comp].y = cy; }
}

const cases = [
  { name: 'n54-ttp223-touch', opts: { rounds: 2, iterations: 3000, maxIter: 80 },
    moves: [['J1', 2.5, 10]], anchor: ['J1'] },
  { name: 'n59-max7219', opts: { rounds: 4, iterations: 4000, maxIter: 150 },
    moves: [['J1', 3, 17], ['J2', 66, 9], ['J3', 66, 26]], anchor: ['J1', 'J2', 'J3'] },
];
for (const c of cases) {
  const d = JSON.parse(readFileSync(new URL(`./${c.name}/design.json`, import.meta.url), 'utf8'));
  for (const [comp, x, y] of c.moves) moveComp(d, comp, x, y);
  const t0 = Date.now();
  const r = placeAndRoute(d, { ...c.opts, anchor: c.anchor });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  const drc = checkDRC(d, r.best).filter(i => i.sev === 'error');
  const s = r.best.stats;
  console.log(`${c.name} ANCHORED: ${s.connected}/${s.total} via=${s.vias} ${dt}s drc=${drc.length} over=${(r.best.overuse || []).length} ${r.best.status}`);
  drc.slice(0, 4).forEach(i => console.log('  ', i.msg));
  const dir = new URL(`./out/${c.name}-anchored/`, import.meta.url);
  try { writeFileSync(new URL('design.json', dir), JSON.stringify(d)); writeFileSync(new URL('result.json', dir), JSON.stringify(r.best)); } catch {}
}
