import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const B = String.fromCharCode(92);
const mA = html.match(new RegExp('// ==== ROUTER CORE START ====([' + B + 's' + B + 'S]*?)// ==== ROUTER CORE END ===='));
const mB = html.match(new RegExp('// ==== EXAMPLES START ====([' + B + 's' + B + 'S]*?)// ==== EXAMPLES END ===='));
const core = new Function(mA[1] + '\n' + mB[1] + '\nreturn {placeAndRoute};')();
const d = JSON.parse(readFileSync(new URL('./n47-attiny85-vusb/design.json', import.meta.url), 'utf8'));
const r = core.placeAndRoute(d, { rounds: 2, iterations: 4000, maxIter: 150 });
const b = r.best;
for (const n of b.nets) for (const v of (n.vias || []))
  if (Math.abs(v.x - 17.78) < 0.5 && Math.abs(v.y - 8.78) < 0.5) console.log('via net=' + n.netId, v.x, v.y);
for (const p of d.pads) if (p.id.startsWith('R2')) console.log(p.id, 'net=' + p.netId, p.x, p.y, p.w, p.h);
console.log('viaOuter', d.viaOuter, 'clearance', d.clearance);
