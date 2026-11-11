// 第七轮 runner：批量 place→route→DRC→汇总（产物落盘供诊断/渲染）
// 用法：node run7.mjs <tier>   tier = simple | medium | hard | extreme
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { placeAndRoute, checkDRC, renderBoardPixels } from '../../src/engine.mjs';

const crcTable = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); return c; });
const crc32 = buf => { let c = ~0; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return ~c >>> 0; };
function pngEncode(w, h, rgba) {
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const t = Buffer.from(type); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, cr]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const TIER = process.argv[2] || 'all';
const projects = {
  simple:  ['n73-si5351', 'n74-boost-5v', 'n75-ps2-if', 'n76-mic-pre', 'n77-ir-obstacle'],
  medium:  ['n78-enc-diff', 'n79-ina226', 'n80-i2s-dac', 'n81-pca9685', 'n82-fan-ctrl'],
  hard:    ['n83-plc-input', 'n84-tmc2209', 'n85-t12', 'n86-nixie', 'n87-eload'],
  extreme: ['n88-hub75', 'n89-goldfinger', 'n90-plcc44', 'n91-fc-mini', 'n92-tube-pre']
};
const params = {
  simple:  { rounds: 2, iterations: 3000, maxIter: 80 },
  medium:  { rounds: 4, iterations: 4000, maxIter: 150 },
  hard:    { rounds: 4, iterations: 4000, maxIter: 150 },
  extreme: { rounds: 3, iterations: 4000, maxIter: 150 }
};
const tiers = TIER === 'all' ? Object.keys(projects) : [TIER];
const results = [];
mkdirSync(new URL('./out/', import.meta.url), { recursive: true });

for (const tier of tiers) {
  for (const name of projects[tier]) {
    const file = new URL(`./${name}/design.json`, import.meta.url);
    if (!existsSync(file)) { console.error('SKIP（无 spec）:', name); continue; }
    const d = JSON.parse(readFileSync(file, 'utf8'));
    const pads = d.pads.length, nets = d.nets.length;
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
    try { r = placeAndRoute(d, params[tier]); } catch (e) { err = e.message; }
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    let drcErrors = [], drcWarns = [];
    if (r && r.best) {
      const issues = checkDRC(d, r.best);
      drcErrors = issues.filter(i => i.sev === 'error').map(i => `${i.type}${i.a ? ' ' + i.a : ''}${i.b ? '/' + i.b : ''}`);
      drcWarns = issues.filter(i => i.sev === 'warn').map(i => i.type);
      const dir = new URL(`./out/${name}/`, import.meta.url);
      mkdirSync(dir, { recursive: true });
      writeFileSync(new URL('design.json', dir), JSON.stringify(d));
      writeFileSync(new URL('result.json', dir), JSON.stringify(r.best));
      try {
        const img = renderBoardPixels(d, r.best, { scale: d.grid < 0.3 ? 12 : 8 });
        writeFileSync(new URL('board.png', dir), pngEncode(img.width, img.height, img.px));
      } catch (e) { console.error('  render fail:', e.message); }
    }
    const rec = {
      tier, name, pads, nets, timeSec: +dt, err,
      status: r?.best?.status || 'FAIL',
      connected: r?.best?.stats?.connected ?? 0,
      total: r?.best?.stats?.total ?? 0,
      vias: r?.best?.stats?.vias ?? 0,
      overuse: r?.best?.overuse?.length ?? -1,
      badRef, singlePad,
      drcErrors, drcWarns
    };
    results.push(rec);
    const pct = rec.total ? Math.round(100 * rec.connected / rec.total) : 0;
    const flag = rec.err ? '✗' : (pct === 100 && drcErrors.length === 0 ? '✓' : '~');
    console.log(`${flag} [${tier}] ${name}: ${pct}% (${rec.connected}/${rec.total}) via=${rec.vias} ${dt}s drc=${drcErrors.length} over=${rec.overuse} ${drcErrors[0] || ''}`);
    writeFileSync(new URL(`summary-${TIER}.json`, import.meta.url), JSON.stringify(results, null, 1));
  }
}
console.log('\n== 第七轮汇总 ==');
for (const r of results) {
  const pct = r.total ? Math.round(100 * r.connected / r.total) : 0;
  console.log(`${r.tier}\t${r.name}\t${pct}%\t${r.connected}/${r.total}\tvias=${r.vias}\t${r.timeSec}s\tdrcErr=${r.drcErrors.length}\t${r.status}`);
}
