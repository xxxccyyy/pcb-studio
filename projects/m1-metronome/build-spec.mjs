// M1 中等档：ATtiny85 蜂鸣器节拍器
// ATtiny85 SOIC-8（数据手册：pin1 RST /2 PB3 /3 PB4 /4 GND /5 PB0 MOSI /6 PB1 MISO /7 PB2 SCK /8 VCC）
// 无源蜂鸣器经 SOT-23 NPN 驱动：PB1(PWM) → R1 → Q1 基极；蜂鸣器接 VCC 与集电极
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const mA = html.match(new RegExp('// ==== ROUTER CORE START ====([\\s\\S]*?)// ==== ROUTER CORE END ===='));
const mB = html.match(new RegExp('// ==== EXAMPLES START ====([\\s\\S]*?)// ==== EXAMPLES END ===='));
const core = new Function(mA[1] + '\n' + mB[1] + '\nreturn {footprintPads, designDefaults};')();

const d = core.designDefaults();
d.width = 50; d.height = 30; d.grid = 0.6;
d.trackW = 0.4; d.clearance = 0.2; d.viaOuter = 0.8; d.viaDrill = 0.4;
d.nets = [
  { id: 'vcc', name: 'VCC' }, { id: 'gnd', name: 'GND' },
  { id: 'rst', name: 'RST' }, { id: 'sck', name: 'SCK' },
  { id: 'mosi', name: 'MOSI' }, { id: 'miso', name: 'MISO' },
  { id: 'sw1', name: 'TAP' },
  { id: 'base', name: 'BASE' }, { id: 'buz', name: 'BUZ' }
];
const pads = [];
const add = (c, p, n, x, y, w, h, shape, layer, holeR) =>
  pads.push({ id: `${c}-${p}`, netId: n, x: +x.toFixed(4), y: +y.toFixed(4), w, h, shape: shape || 'rect', layer: layer || 'top', holeR });
const place = (comp, fp, cx, cy, netOf, layerOf) => {
  fp.forEach((f, i) => add(comp, i + 1, netOf(i + 1), cx + f.dx, cy + f.dy, f.w, f.h, f.shape, layerOf ? layerOf(i + 1) : f.layer, f.holeR));
};
const fp603 = core.footprintPads('0603');
// U1 ATtiny85 SOIC-8
place('U1', core.footprintPads('SOIC-8'), 25, 15, pin => ({
  1: 'rst', 2: 'sw1', 3: null, 4: 'gnd', 5: 'mosi', 6: 'miso', 7: 'sck', 8: 'vcc'   // PB1=MISO，蜂鸣器驱动经 R1 复用此线
}[pin] || null));
// BUZ1 无源蜂鸣器（通孔两脚）
add('BUZ1', 1, 'vcc', 8, 8, 1.5, 1.5, 'circle', 'both', 0.45);
add('BUZ1', 2, 'buz', 11, 8, 1.5, 1.5, 'circle', 'both', 0.45);
// Q1 SOT-23 NPN：1 基极 2 发射极(GND) 3 集电极(buz)
place('Q1', core.footprintPads('SOT-23'), 19, 19, i => [ 'base', 'gnd', 'buz' ][i - 1] || null);
place('R1', fp603.map(f => ({ ...f })), 20.5, 10.5, i => i === 1 ? 'miso' : 'base');
// R2 复位上拉 rst→vcc
place('R2', fp603.map(f => ({ ...f })), 30, 7.5, i => i === 1 ? 'rst' : 'vcc');
// C1 100nF 去耦，C2 10µF 储能
place('C1', fp603.map(f => ({ ...f })), 25, 21, i => i === 1 ? 'vcc' : 'gnd');
place('C2', core.footprintPads('0805'), 30, 21, i => i === 1 ? 'vcc' : 'gnd');
// SW1 节拍按键（pb3→gnd）
[[-3.2, -2.3], [3.2, -2.3], [-3.2, 2.3], [3.2, 2.3]].forEach(([dx, dy], i) =>
  add('SW1', i + 1, i < 2 ? 'sw1' : 'gnd', 10 + dx, 21 + dy, 1.5, 1.5, 'rect', 'both', 0.45));
// J1 电源，J2 ISP 2×3
add('J1', 1, 'vcc', 46, 5, 1.7, 1.7, 'circle', 'both', 0.45);
add('J1', 2, 'gnd', 46, 7.54, 1.7, 1.7, 'circle', 'both', 0.45);
[['miso', 'vcc'], ['sck', 'mosi'], ['rst', 'gnd']].forEach(([n, fill], i) => {
  add('J2', i * 2 + 1, n, 42.46, 14 + i * 2.54, 1.7, 1.7, 'circle', 'both', 0.45);   // 左列
  add('J2', i * 2 + 2, fill, 45, 14 + i * 2.54, 1.7, 1.7, 'circle', 'both', 0.45);   // 右列
});
d.pads = pads;
d.comps = {
  U1: { x: 25, y: 15, rot: 0, layer: 'top', value: 'ATtiny85', footprint: 'SOIC-8' },
  BUZ1: { x: 9.5, y: 8, rot: 0, layer: 'top', value: 'Passive Buzzer', footprint: 'BUZ-TH' },
  Q1: { x: 19, y: 19, rot: 0, layer: 'top', value: '2N3904S', footprint: 'SOT-23' },
  R1: { x: 20.5, y: 10, rot: 0, layer: 'top', value: '1k', footprint: 'R0603', lcsc: 'C21190' },
  R2: { x: 30, y: 7.5, rot: 0, layer: 'top', value: '10k', footprint: 'R0603', lcsc: 'C25804' },
  C1: { x: 25, y: 21, rot: 0, layer: 'top', value: '100nF', footprint: 'C0603', lcsc: 'C1591' },
  C2: { x: 30, y: 21, rot: 0, layer: 'top', value: '10uF', footprint: 'C0805', lcsc: 'C15850' },
  SW1: { x: 10, y: 21, rot: 0, layer: 'top', value: 'TAP', footprint: 'SW-6x6' },
  J1: { x: 46, y: 6.3, rot: 90, layer: 'top', value: 'PWR', footprint: 'HDR-2P-2.54' },
  J2: { x: 43.7, y: 16.5, rot: 90, layer: 'top', value: 'ISP', footprint: 'HDR-2x3P-2.54' }
};
mkdirSync(new URL('./', import.meta.url), { recursive: true });
writeFileSync(new URL('./design.json', import.meta.url), JSON.stringify(d, null, 1));
console.log('M1 spec:', pads.length, 'pads /', d.nets.length, 'nets');
