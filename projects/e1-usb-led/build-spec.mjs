// E1 简单档：USB 灯条 —— 5V → 3 路并联 LED（各带限流电阻）
// 资料依据：USB 2.0 供电 500mA/口；白光 LED Vf≈3.2V → R=(5-3.2)/20mA=90Ω → 取 100Ω
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const mA = html.match(new RegExp('// ==== ROUTER CORE START ====([\\s\\S]*?)// ==== ROUTER CORE END ===='));
const mB = html.match(new RegExp('// ==== EXAMPLES START ====([\\s\\S]*?)// ==== EXAMPLES END ===='));
const core = new Function(mA[1] + '\n' + mB[1] + '\nreturn {footprintPads, designDefaults};')();

const d = core.designDefaults();
d.width = 40; d.height = 20; d.grid = 0.7;   // ≥ 电源网 0.5 + 间距 0.2
d.trackW = 0.4; d.clearance = 0.2; d.viaOuter = 0.8; d.viaDrill = 0.4;
d.nets = [
  { id: 'v5', name: '5V', w: 0.5 }, { id: 'gnd', name: 'GND', w: 0.5 },
  { id: 'l1', name: 'LED1' }, { id: 'l2', name: 'LED2' }, { id: 'l3', name: 'LED3' }
];
const pads = [];
const add = (comp, pin, netId, x, y, w, h, shape, layer, holeR) =>
  pads.push({ id: `${comp}-${pin}`, netId, x: +x.toFixed(4), y: +y.toFixed(4), w, h, shape: shape || 'rect', layer: layer || 'top', holeR });
const fp805 = core.footprintPads('0805');
// J1: USB 电源排针（通孔）
add('J1', 1, 'v5', 4, 10, 1.7, 1.7, 'circle', 'both', 0.45);
add('J1', 2, 'gnd', 6.54, 10, 1.7, 1.7, 'circle', 'both', 0.45);
// 三路并联：R(5V侧) → LED(GND侧)，x 间隔 4mm
[1, 2, 3].forEach((ch, i) => {
  const y = 6.5 + i * 3.5;
  const r = fp805.map(f => ({ ...f }));
  add('R' + ch, 1, 'v5', 16 + r[0].dx, y, r[0].w, r[0].h);
  add('R' + ch, 2, 'l' + ch, 16 + r[1].dx, y, r[1].w, r[1].h);
  const led = fp805.map(f => ({ ...f }));
  add('LED' + ch, 1, 'l' + ch, 28 + i * 4 + led[0].dx, y, led[0].w, led[0].h);
  add('LED' + ch, 2, 'gnd', 28 + i * 4 + led[1].dx, y, led[1].w, led[1].h);
});
d.pads = pads;
d.comps = {
  J1: { x: 5.3, y: 10, rot: 90, layer: 'top', value: 'USB-5V', footprint: 'HDR-2P-2.54' },
  R1: { x: 16, y: 6.5, rot: 0, layer: 'top', value: '100R', footprint: 'R0805', lcsc: 'C17414' },
  R2: { x: 16, y: 10, rot: 0, layer: 'top', value: '100R', footprint: 'R0805', lcsc: 'C17414' },
  R3: { x: 16, y: 13.5, rot: 0, layer: 'top', value: '100R', footprint: 'R0805', lcsc: 'C17414' },
  LED1: { x: 28, y: 6.5, rot: 0, layer: 'top', value: 'LED White', footprint: 'LED0805', lcsc: 'C2297' },
  LED2: { x: 32, y: 10, rot: 0, layer: 'top', value: 'LED White', footprint: 'LED0805', lcsc: 'C2297' },
  LED3: { x: 36, y: 13.5, rot: 0, layer: 'top', value: 'LED White', footprint: 'LED0805', lcsc: 'C2297' }
};
mkdirSync(new URL('./', import.meta.url), { recursive: true });
writeFileSync(new URL('./design.json', import.meta.url), JSON.stringify(d, null, 1));
console.log('E1 spec:', pads.length, 'pads /', d.nets.length, 'nets');
