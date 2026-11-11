// H4 困难：L293D 双 H 桥电机驱动板 + ATmega328 DIP-28 控制
// L293D DIP-16: 1 EN1,2 2 IN1 3 OUT1 4,5 GND 6 OUT2 7 IN2 8 VCC_M
// 9 EN3,4 10 IN3 11 OUT3 12,13 GND 14 OUT4 15 IN4 16 VCC
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
const mA = html.match(new RegExp('// ==== ROUTER CORE START ====([\\s\\S]*?)// ==== ROUTER CORE END ===='));
const mB = html.match(new RegExp('// ==== EXAMPLES START ====([\\s\\S]*?)// ==== EXAMPLES END ===='));
const core = new Function(mA[1] + '\n' + mB[1] + '\nreturn {footprintPads, designDefaults};')();
const d = core.designDefaults();
d.width = 65; d.height = 40; d.grid = 0.6;
d.trackW = 0.4; d.clearance = 0.2; d.viaOuter = 0.8; d.viaDrill = 0.4;
const nets = [{ id: 'v5', name: '5V' }, { id: 'gnd', name: 'GND' }, { id: 'vm', name: 'VM' },
  { id: 'rst', name: 'RST' }, { id: 'sck', name: 'SCK' }, { id: 'mosi', name: 'MOSI' }];
for (const sig of ['in1', 'in2', 'in3', 'in4', 'en12', 'en34']) nets.push({ id: sig, name: sig.toUpperCase() });
for (const m of ['m1a', 'm1b', 'm2a', 'm2b']) nets.push({ id: m, name: m.toUpperCase() });
d.nets = nets;
const pads = [];
const add = (c, p, n, x, y, w, h, shape, layer, holeR) =>
  pads.push({ id: `${c}-${p}`, netId: n, x: +x.toFixed(4), y: +y.toFixed(4), w, h, shape: shape || 'rect', layer: layer || 'top', holeR });
const place = (comp, fp, cx, cy, netOf, layerOf) => {
  fp.forEach((f, i) => add(comp, i + 1, netOf(i + 1), cx + f.dx, cy + f.dy, f.w, f.h, f.shape, layerOf ? layerOf(i + 1) : f.layer, f.holeR));
};
// U1 L293D DIP-16（x=30, y=17.5，排距 7.62）
place('U1', core.footprintPads('DIP-N', 16), 30, 17.5, pin => ({
  1: 'en12', 2: 'in1', 3: 'm1a', 4: 'gnd', 5: 'gnd', 6: 'm1b', 7: 'in2', 8: 'vm',
  9: 'en34', 10: 'in3', 11: 'm2a', 12: 'gnd', 13: 'gnd', 14: 'm2b', 15: 'in4', 16: 'v5'
}[pin] || null));
// U2 ATmega328 DIP-28
place('U2', core.footprintPads('DIP-N', 28), 12, 17.5, pin => ({
  1: 'rst', 2: null, 3: null, 4: null, 5: null, 6: null, 7: 'v5', 8: 'gnd',
  9: null, 10: null, 11: null, 12: null, 13: null, 14: null,
  15: 'in1', 16: 'in2', 17: 'in3', 18: 'in4', 19: 'sck',
  20: null, 21: null, 22: null, 23: null, 24: null, 25: null, 26: null, 27: null, 28: null
}[pin] || null));
// 补充 U2 引脚：19=SCK, MOSI/EN 由剩余 pin
// 用 pin 15(PB5?)... 实际 ATmega328 DIP-28: pin15=PB1(OC1A) pin16=PB2(OC1B) pin17=PB3(MOSI) pin18=PB4 pin19=PB5(SCK)
// en12/en34 接 pin12/PB6? 不对，用剩余 pin... 简化：pin2=en12, pin3=en34
const fixPad = (id, n) => { const p = pads.find(x => x.id === id); if (p) p.netId = n; };
fixPad('U2-2', 'en12'); fixPad('U2-3', 'en34');
fixPad('U2-17', 'mosi'); // MOSI 控制
// 4 个电机排针
[['m1a', 'gnd'], ['m1b', 'gnd'], ['m2a', 'gnd'], ['m2b', 'gnd']].forEach(([a, b], i) => {
  add('M' + (i + 1), 1, a, 50, 4 + i * 4, 1.7, 1.7, 'circle', 'both', 0.45);
  add('M' + (i + 1), 2, b, 52.54, 4 + i * 4, 1.7, 1.7, 'circle', 'both', 0.45);
});
// 去耦：100nF ×2 + 100µF 电机电源
const fp603 = core.footprintPads('0603');
place('C1', fp603.map(f => ({ ...f })), 22, 6, i => i === 1 ? 'v5' : 'gnd');
place('C2', fp603.map(f => ({ ...f })), 38, 28, i => i === 1 ? 'vm' : 'gnd');
place('CB', core.footprintPads('0805'), 38, 5, i => i === 1 ? 'vm' : 'gnd');
// R1 复位上拉
place('R1', fp603.map(f => ({ ...f })), 12, 6, i => i === 1 ? 'rst' : 'v5');
// J1 电源（5V VM GND）
add('J1', 1, 'v5', 2, 2, 1.7, 1.7, 'circle', 'both', 0.45);
add('J1', 2, 'vm', 2, 4.54, 1.7, 1.7, 'circle', 'both', 0.45);
add('J1', 3, 'gnd', 2, 7.08, 1.7, 1.7, 'circle', 'both', 0.45);
d.pads = pads;
d.comps = {
  U1: { x: 30, y: 17.5, rot: 0, layer: 'top', value: 'L293D', footprint: 'DIP-16' },
  U2: { x: 12, y: 17.5, rot: 0, layer: 'top', value: 'ATmega328', footprint: 'DIP-28' },
  C1: { x: 22, y: 6, rot: 0, layer: 'top', value: '100nF', footprint: 'C0603' },
  C2: { x: 38, y: 28, rot: 0, layer: 'top', value: '100nF', footprint: 'C0603' },
  CB: { x: 38, y: 5, rot: 0, layer: 'top', value: '100uF', footprint: 'C0805' },
  R1: { x: 12, y: 6, rot: 0, layer: 'top', value: '10k', footprint: 'R0603' },
  J1: { x: 2, y: 4.8, rot: 90, layer: 'top', value: 'PWR', footprint: 'HDR-3P' },
  M1: { x: 51.3, y: 4, rot: 0, layer: 'top', value: 'M1', footprint: 'HDR-2P' },
  M2: { x: 51.3, y: 8, rot: 0, layer: 'top', value: 'M2', footprint: 'HDR-2P' },
  M3: { x: 51.3, y: 12, rot: 0, layer: 'top', value: 'M3', footprint: 'HDR-2P' },
  M4: { x: 51.3, y: 16, rot: 0, layer: 'top', value: 'M4', footprint: 'HDR-2P' }
};
mkdirSync(new URL('./', import.meta.url), { recursive: true });
writeFileSync(new URL('./design.json', import.meta.url), JSON.stringify(d, null, 1));
console.log('H4 spec:', pads.length, 'pads /', d.nets.length, 'nets');
