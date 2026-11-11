// M4 中等：I2C 双向电平转换板 —— BSS138 MOSFET 方案（3.3V↔5V）
// 每通道：LV侧上拉10k + MOSFET + HV侧上拉10k；SDA+SCL 双通道
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
const mA = html.match(new RegExp('// ==== ROUTER CORE START ====([\\s\\S]*?)// ==== ROUTER CORE END ===='));
const mB = html.match(new RegExp('// ==== EXAMPLES START ====([\\s\\S]*?)// ==== EXAMPLES END ===='));
const core = new Function(mA[1] + '\n' + mB[1] + '\nreturn {footprintPads, designDefaults};')();
const d = core.designDefaults();
d.width = 40; d.height = 22; d.grid = 0.6;
d.trackW = 0.4; d.clearance = 0.2; d.viaOuter = 0.8; d.viaDrill = 0.4;
const nets = [{ id: 'lv', name: '3V3' }, { id: 'hv', name: '5V' }, { id: 'gnd', name: 'GND' }];
for (const ch of ['sda', 'scl']) {
  nets.push({ id: ch + '_l', name: ch.toUpperCase() + '_3V3' });
  nets.push({ id: ch + '_h', name: ch.toUpperCase() + '_5V' });
}
d.nets = nets;
const pads = [];
const add = (c, p, n, x, y, w, h, shape, layer, holeR) =>
  pads.push({ id: `${c}-${p}`, netId: n, x: +x.toFixed(4), y: +y.toFixed(4), w, h, shape: shape || 'rect', layer: layer || 'top', holeR });
const fp603 = core.footprintPads('0603');
const place = (comp, fp, cx, cy, netOf, layerOf) => {
  fp.forEach((f, i) => add(comp, i + 1, netOf(i + 1), cx + f.dx, cy + f.dy, f.w, f.h, f.shape, layerOf ? layerOf(i + 1) : f.layer, f.holeR));
};
// 2× BSS138 SOT-23（1=G 2=S 3=D）——SDA 通道 x=15, SCL 通道 x=27
['sda', 'scl'].forEach((ch, i) => {
  const x = 15 + i * 12;
  const L = ch + '_l', H = ch + '_h';
  place('Q' + (i + 1), core.footprintPads('SOT-23'), x, 11, idx => [null, L, H][idx - 1] || null);
  // LV 上拉
  const r1 = 'R' + (i * 2 + 1);
  place(r1, fp603.map(f => ({ ...f })), x - 4, 6, idx => idx === 1 ? L : 'lv');
  // HV 上拉
  const r2 = 'R' + (i * 2 + 2);
  place(r2, fp603.map(f => ({ ...f })), x + 4, 6, idx => idx === 1 ? H : 'hv');
});
// J1 LV 侧（3V3 GND SDA_SCL_L）、J2 HV 侧（5V GND SDA_SCL_H）
add('J1', 1, 'lv', 2, 5, 1.7, 1.7, 'circle', 'both', 0.45);
add('J1', 2, 'gnd', 2, 7.54, 1.7, 1.7, 'circle', 'both', 0.45);
add('J1', 3, 'sda_l', 2, 10.08, 1.7, 1.7, 'circle', 'both', 0.45);
add('J1', 4, 'scl_l', 2, 12.62, 1.7, 1.7, 'circle', 'both', 0.45);
add('J2', 1, 'hv', 38, 5, 1.7, 1.7, 'circle', 'both', 0.45);
add('J2', 2, 'gnd', 38, 7.54, 1.7, 1.7, 'circle', 'both', 0.45);
add('J2', 3, 'sda_h', 38, 10.08, 1.7, 1.7, 'circle', 'both', 0.45);
add('J2', 4, 'scl_h', 38, 12.62, 1.7, 1.7, 'circle', 'both', 0.45);
d.pads = pads;
d.comps = {
  Q1: { x: 15, y: 11, rot: 0, layer: 'top', value: 'BSS138', footprint: 'SOT-23' },
  Q2: { x: 27, y: 11, rot: 0, layer: 'top', value: 'BSS138', footprint: 'SOT-23' },
  R1: { x: 11, y: 6, rot: 0, layer: 'top', value: '10k', footprint: 'R0603' },
  R2: { x: 19, y: 6, rot: 0, layer: 'top', value: '10k', footprint: 'R0603' },
  R3: { x: 23, y: 6, rot: 0, layer: 'top', value: '10k', footprint: 'R0603' },
  R4: { x: 31, y: 6, rot: 0, layer: 'top', value: '10k', footprint: 'R0603' },
  J1: { x: 2, y: 8.8, rot: 90, layer: 'top', value: 'LV-3V3', footprint: 'HDR-4P' },
  J2: { x: 38, y: 8.8, rot: 90, layer: 'top', value: 'HV-5V', footprint: 'HDR-4P' }
};
mkdirSync(new URL('./', import.meta.url), { recursive: true });
writeFileSync(new URL('./design.json', import.meta.url), JSON.stringify(d, null, 1));
console.log('M4 spec:', pads.length, 'pads /', d.nets.length, 'nets');
