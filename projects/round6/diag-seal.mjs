// 插桩诊断：未连通焊盘周边 5×5 格点占有图
import { readFileSync } from 'node:fs';
import { buildModel, computeRatsnest } from '../../src/engine.mjs';

const name = process.argv[2] || 'n54-ttp223-touch';
const d = JSON.parse(readFileSync(new URL(`./out/${name}/design.json`, import.meta.url), 'utf8'));
const r = JSON.parse(readFileSync(new URL(`./out/${name}/result.json`, import.meta.url), 'utf8'));
const model = buildModel(d);
const { GW, GH, NC, grid, netIdx, padOwner, L } = model;
console.log('grid=', grid, 'GW×GH=', GW, GH, 'L=', L);

const edges = computeRatsnest(d, r);
console.log('ratsnest 边数(全部视为待连):', edges.length);
const netName = Object.fromEntries(d.nets.map(n => [n.id, n.name]));

const seen = new Set();
for (const e of edges) {
  for (const [ex, ey] of [[e.x1, e.y1], [e.x2, e.y2]]) {
    const p = d.pads.reduce((best, q) => {
      const dq = Math.hypot(q.x - ex, q.y - ey);
      return dq < best.d ? { d: dq, q } : best;
    }, { d: Infinity, q: null });
    if (!p.q || seen.has(p.q.id)) continue;
    seen.add(p.q.id);
    const pnet = p.q.netId;
    const netNum = netIdx.get(pnet) == null ? -2 : netIdx.get(pnet) + 1;
    const cx = Math.round(p.q.x / grid), cy = Math.round(p.q.y / grid);
    console.log(`\n${p.q.id} net=${netName[pnet]} @(${p.q.x},${p.q.y}) cell=(${cx},${cy})`);
    for (let dy = -2; dy <= 2; dy++) {
      const rowT = [], rowB = [];
      for (let dx = -2; dx <= 2; dx++) {
        const X = cx + dx, Y = cy + dy;
        if (X < 0 || Y < 0 || X >= GW || Y >= GH) { rowT.push('#'); rowB.push('#'); continue; }
        const oT = padOwner[0 * NC + Y * GW + X];
        const oB = L > 1 ? padOwner[1 * NC + Y * GW + X] : null;
        const f = o => o === -1 ? 'x' : o === 0 ? '.' : o === netNum ? 'o' : 'O';
        rowT.push(f(oT)); rowB.push(oB == null ? ' ' : f(oB));
      }
      console.log('  top ' + rowT.join(' ') + '   bot ' + rowB.join(' '));
    }
  }
}
console.log('\n图例: o=本网 x=属主-1(禁行) O=他网 .=空 #=界外');
