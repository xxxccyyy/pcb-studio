// 第十一轮 runner：50 项目批量 place→route→DRC→汇总
// 用法：node run11.mjs <batch>   batch = 1..5（并行跑批）或 all
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

const ALL = [
  'p01-555-tiny', 'p02-555-small', 'p03-555-mid', 'p04-555-large', 'p05-555-xlarge',
  'p06-grid-03', 'p07-grid-04', 'p08-grid-05', 'p09-grid-06', 'p10-grid-08',
  'p11-density-1', 'p12-density-2', 'p13-density-3', 'p14-density-4', 'p15-density-6',
  'p16-star-2', 'p17-star-4', 'p18-star-6', 'p19-star-7', 'p20-star-7b',
  'p21-via-05', 'p22-via-15', 'p23-via-30', 'p24-via-60', 'p25-via-120',
  'p26-ws2812-8x8', 'p27-cnc-shield', 'p28-shield', 'p29-hat', 'p30-thermocouple',
  'p31-onewire', 'p32-rs485-multi', 'p33-servo16', 'p34-iso-output', 'p35-quad-charge',
  'p36-mixer', 'p37-lock', 'p38-power-tree', 'p39-min-board', 'p40-single-net',
  'p41-dense-nets', 'p42-all-tht', 'p43-single-layer', 'p44-led-strip', 'p45-center-keepout',
  'p46-sip9', 'p47-db25', 'p48-term15', 'p49-daisy', 'p50-broadcast'
];
// viaCost 家族参数（P21-P25 专属）；其余默认
const VIA = { 'p21-via-05': 5, 'p22-via-15': 15, 'p23-via-30': 30, 'p24-via-60': 60, 'p25-via-120': 120 };

const BATCH = process.argv[2] || 'all';
const batch = BATCH === 'all' ? [1, 2, 3, 4, 5] : [+BATCH];
const names = batch.flatMap(b => ALL.slice((b - 1) * 10, b * 10));
mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
const results = [];

for (const name of names) {
  const file = new URL(`./${name}/design.json`, import.meta.url);
  if (!existsSync(file)) { console.error('SKIP:', name); continue; }
  const d = JSON.parse(readFileSync(file, 'utf8'));
  const opts = { rounds: 3, iterations: 4000, maxIter: 150 };
  if (VIA[name]) opts.viaCost = VIA[name];
  const t0 = Date.now();
  let r = null, err = null;
  try { r = placeAndRoute(d, opts); } catch (e) { err = e.message; }
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  let drcErrors = [];
  if (r && r.best) {
    drcErrors = checkDRC(d, r.best).filter(i => i.sev === 'error').map(i => `${i.type}`);
    const dir = new URL(`./out/${name}/`, import.meta.url);
    mkdirSync(dir, { recursive: true });
    writeFileSync(new URL('design.json', dir), JSON.stringify(d));
    writeFileSync(new URL('result.json', dir), JSON.stringify(r.best));
    try {
      const img = renderBoardPixels(d, r.best, { scale: d.grid < 0.3 ? 12 : 8 });
      writeFileSync(new URL('board.png', dir), pngEncode(img.width, img.height, img.px));
    } catch {}
  }
  const rec = { name, timeSec: +dt, err, status: r?.best?.status || 'FAIL',
    connected: r?.best?.stats?.connected ?? 0, total: r?.best?.stats?.total ?? 0,
    vias: r?.best?.stats?.vias ?? 0, drcErrors };
  results.push(rec);
  const pct = rec.total ? Math.round(100 * rec.connected / rec.total) : 0;
  const flag = rec.err ? '✗' : (pct === 100 && drcErrors.length === 0 ? '✓' : '~');
  console.log(`${flag} ${name}: ${pct}% (${rec.connected}/${rec.total}) via=${rec.vias} ${dt}s drc=${drcErrors.length} ${drcErrors[0] || ''} ${err || ''}`);
}
writeFileSync(new URL(`summary-b${BATCH}.json`, import.meta.url), JSON.stringify(results, null, 1));
