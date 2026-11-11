// H3 困难：ESP-12F WiFi 模块载板
// ESP-12F 2×8=16 焊盘（1.27mm 间距，2 排，排距 17.5mm）+ CH340G 自动下载 + 去耦
// ESP-12F 引脚：左排 L1-L8 = RST ADC EN IO16 IO14 IO12 IO13 VCC
//               右排 R1-R8 = GND IO15 IO2 IO0 IO4 IO5 RX TX
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
const mA = html.match(new RegExp('// ==== ROUTER CORE START ====([\\s\\S]*?)// ==== ROUTER CORE END ===='));
const mB = html.match(new RegExp('// ==== EXAMPLES START ====([\\s\\S]*?)// ==== EXAMPLES END ===='));
const core = new Function(mA[1] + '\n' + mB[1] + '\nreturn {footprintPads, designDefaults};')();
const d = core.designDefaults();
d.width = 50; d.height = 35; d.grid = 0.6;
d.trackW = 0.4; d.clearance = 0.2; d.viaOuter = 0.8; d.viaDrill = 0.4;
const netNames = ['gnd', 'adc', 'en', 'io16', 'io14', 'io12', 'io13', 'v33',
                  'gnd2', 'io15', 'io2', 'io0', 'io4', 'io5', 'rxd', 'txd'];
d.nets = [
  { id: 'v33', name: '3V3' }, { id: 'gnd', name: 'GND' },
  { id: 'txd', name: 'TXD' }, { id: 'rxd', name: 'RXD' },
  { id: 'en', name: 'EN' }, { id: 'io0', name: 'IO0' }, { id: 'io15', name: 'IO15' },
  { id: 'io2', name: 'IO2' }, { id: 'io4', name: 'IO4' }, { id: 'io5', name: 'IO5' },
  { id: 'io12', name: 'IO12' }, { id: 'io13', name: 'IO13' }, { id: 'io14', name: 'IO14' }, { id: 'io16', name: 'IO16' },
  { id: 'adc', name: 'ADC' }, { id: 'dtr', name: 'DTR' }, { id: 'rts', name: 'RTS' }
];
const pads = [];
const add = (c, p, n, x, y, w, h, shape, layer, holeR) =>
  pads.push({ id: `${c}-${p}`, netId: n, x: +x.toFixed(4), y: +y.toFixed(4), w, h, shape: shape || 'rect', layer: layer || 'top', holeR });
const fp603 = core.footprintPads('0603');
const place = (comp, fp, cx, cy, netOf, layerOf) => {
  fp.forEach((f, i) => add(comp, i + 1, netOf(i + 1), cx + f.dx, cy + f.dy, f.w, f.h, f.shape, layerOf ? layerOf(i + 1) : f.layer, f.holeR));
};
// ESP-12F 模块 2 排焊盘（pitch 1.27，排距 17.5，左 8 右 8）
const espNets = ['gnd','adc','en','io16','io14','io12','io13','v33',
                 'gnd','io15','io2','io0','io4','io5','rxd','txd'];
for (let i = 0; i < 8; i++) {
  add('ESP', i + 1, espNets[i], 15, 8 + i * 1.27 * 2, 1.0, 1.0);  // 左排
  add('ESP', i + 9, espNets[i + 8], 32.5, 8 + i * 1.27 * 2, 1.0, 1.0);  // 右排
}
// U2 CH340G SOIC-16 自动下载
place('U2', core.footprintPads('SOIC-16'), 38, 17.5, pin => ({
  1: 'gnd', 2: 'txd', 3: 'rxd', 4: null, 13: 'dtr', 14: 'rts', 16: 'v33'
}[pin] || null));
// 自动下载：DTR/RTS → Q1/Q2 SOT-23 NPN → EN/IO0
place('Q1', core.footprintPads('SOT-23'), 42, 8, i => [null, null, 'en'][i - 1] || null);
place('Q2', core.footprintPads('SOT-23'), 46, 8, i => [null, null, 'io0'][i - 1] || null);
// 去耦
place('C1', fp603.map(f => ({ ...f })), 25, 27, i => i === 1 ? 'v33' : 'gnd');
// 上拉：EN 10k→3V3, IO15 10k→GND, IO2 10k→3V3
place('R_EN', fp603.map(f => ({ ...f })), 10, 27, i => i === 1 ? 'en' : 'v33');
place('R_IO15', fp603.map(f => ({ ...f })), 14, 30, i => i === 1 ? 'io15' : 'gnd');
place('R_IO2', fp603.map(f => ({ ...f })), 18, 27, i => i === 1 ? 'io2' : 'v33');
// J1 串口排针（5V TX RX GND）
['v33', 'txd', 'rxd', 'gnd'].forEach((n, i) =>
  add('J1', i + 1, n, 48, 4 + i * 3, 1.7, 1.7, 'circle', 'both', 0.45));
// J2 编程/运行选择（IO0→GND 按键）
[[-3.2, -2.3], [3.2, -2.3], [-3.2, 2.3], [3.2, 2.3]].forEach(([dx, dy], i) =>
  add('SW1', i + 1, i < 2 ? 'io0' : 'gnd', 5 + dx, 30 + dy, 1.5, 1.5, 'rect', 'both', 0.45));
d.pads = pads;
d.comps = {
  ESP: { x: 23.75, y: 16.5, rot: 0, layer: 'top', value: 'ESP-12F', footprint: 'ESP-12F' },
  U2: { x: 38, y: 17.5, rot: 0, layer: 'top', value: 'CH340G', footprint: 'SOIC-16' },
  Q1: { x: 42, y: 8, rot: 0, layer: 'top', value: '2N3904', footprint: 'SOT-23' },
  Q2: { x: 46, y: 8, rot: 0, layer: 'top', value: '2N3904', footprint: 'SOT-23' },
  C1: { x: 25, y: 27, rot: 0, layer: 'top', value: '100nF', footprint: 'C0603' },
  R_EN: { x: 10, y: 27, rot: 0, layer: 'top', value: '10k', footprint: 'R0603' },
  R_IO15: { x: 14, y: 30, rot: 0, layer: 'top', value: '10k', footprint: 'R0603' },
  R_IO2: { x: 18, y: 27, rot: 0, layer: 'top', value: '10k', footprint: 'R0603' },
  SW1: { x: 5, y: 30, rot: 0, layer: 'top', value: 'FLASH', footprint: 'SW-6x6' },
  J1: { x: 48, y: 8.5, rot: 90, layer: 'top', value: 'UART', footprint: 'HDR-4P' }
};
mkdirSync(new URL('./', import.meta.url), { recursive: true });
writeFileSync(new URL('./design.json', import.meta.url), JSON.stringify(d, null, 1));
console.log('H3 spec:', pads.length, 'pads /', d.nets.length, 'nets');
