// S1 超难：ESP32-WROOM-32 + CH340G 自动下载板
// ESP32 模块 2×8=16 焊盘（pitch 1.27，排距 17.5）+ CH340G + 自动下载 Q1/Q2 + 双按键 + LED
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
const mA = html.match(new RegExp('// ==== ROUTER CORE START ====([\\s\\S]*?)// ==== ROUTER CORE END ===='));
const mB = html.match(new RegExp('// ==== EXAMPLES START ====([\\s\\S]*?)// ==== EXAMPLES END ===='));
const core = new Function(mA[1] + '\n' + mB[1] + '\nreturn {footprintPads, designDefaults};')();
const d = core.designDefaults();
d.width = 70; d.height = 45; d.grid = 0.6;
d.trackW = 0.4; d.clearance = 0.2; d.viaOuter = 0.8; d.viaDrill = 0.4;
const ids = ['gnd','io12','io0','io2','io4','io5','io13','v33',
             'gnd','txd','rxd','io14','io15','en','io16','v33'];
d.nets = [
  { id: 'v33', name: '3V3' }, { id: 'gnd', name: 'GND' },
  { id: 'txd', name: 'TXD' }, { id: 'rxd', name: 'RXD' },
  { id: 'en', name: 'EN' }, { id: 'io0', name: 'IO0' },
  { id: 'io2', name: 'IO2' }, { id: 'io4', name: 'IO4' }, { id: 'io5', name: 'IO5' },
  { id: 'io12', name: 'IO12' }, { id: 'io13', name: 'IO13' }, { id: 'io14', name: 'IO14' },
  { id: 'io15', name: 'IO15' }, { id: 'io16', name: 'IO16' },
  { id: 'dtr', name: 'DTR' }, { id: 'rts', name: 'RTS' },
  { id: 'en_q', name: 'EN_Q' }, { id: 'io0_q', name: 'IO0_Q' }
];
const pads = [];
const add = (c, p, n, x, y, w, h, shape, layer, holeR) =>
  pads.push({ id: `${c}-${p}`, netId: n, x: +x.toFixed(4), y: +y.toFixed(4), w, h, shape: shape || 'rect', layer: layer || 'top', holeR });
const fp603 = core.footprintPads('0603');
const place = (comp, fp, cx, cy, netOf, layerOf) => {
  fp.forEach((f, i) => add(comp, i + 1, netOf(i + 1), cx + f.dx, cy + f.dy, f.w, f.h, f.shape, layerOf ? layerOf(i + 1) : f.layer, f.holeR));
};
// ESP32 模块 2×8 焊盘
const espNets = ['gnd','io12','io0','io2','io4','io5','io13','v33',
                 'gnd','txd','rxd','io14','io15','en','io16','v33'];
for (let i = 0; i < 8; i++) {
  add('ESP', i + 1, espNets[i], 15, 6 + i * 1.27 * 2, 1.0, 1.0);
  add('ESP', i + 9, espNets[i + 8], 32.5, 6 + i * 1.27 * 2, 1.0, 1.0);
}
// U2 CH340G
place('U2', core.footprintPads('SOIC-16'), 48, 20, pin => ({
  1: 'gnd', 2: 'txd', 3: 'rxd', 13: 'dtr', 14: 'rts', 16: 'v33'
}[pin] || null));
// 自动下载 Q1/Q2
place('Q1', core.footprintPads('SOT-23'), 44, 6, i => ['dtr', null, 'en_q'][i - 1] || null);
place('Q2', core.footprintPads('SOT-23'), 48, 6, i => ['rts', null, 'io0_q'][i - 1] || null);
// 去耦 + 上拉
place('C1', fp603.map(f => ({ ...f })), 25, 32, i => i === 1 ? 'v33' : 'gnd');
place('R_EN', fp603.map(f => ({ ...f })), 10, 32, i => i === 1 ? 'en' : 'v33');
place('R_IO0', fp603.map(f => ({ ...f })), 14, 32, i => i === 1 ? 'io0' : 'v33');
place('R_IO15', fp603.map(f => ({ ...f })), 18, 32, i => i === 1 ? 'io15' : 'gnd');
// SW1 EN 按键 / SW2 IO0 按键
[[-3.2, -2.3], [3.2, -2.3], [-3.2, 2.3], [3.2, 2.3]].forEach(([dx, dy], i) =>
  add('SW1', i + 1, i < 2 ? 'en' : 'gnd', 2 + dx, 12 + dy, 1.5, 1.5, 'rect', 'both', 0.45));
[[-3.2, -2.3], [3.2, -2.3], [-3.2, 2.3], [3.2, 2.3]].forEach(([dx, dy], i) =>
  add('SW2', i + 1, i < 2 ? 'io0' : 'gnd', 2 + dx, 22 + dy, 1.5, 1.5, 'rect', 'both', 0.45));
// J1 串口
['v33', 'txd', 'rxd', 'gnd'].forEach((n, i) =>
  add('J1', i + 1, n, 57, 8 + i * 3, 1.7, 1.7, 'circle', 'both', 0.45));
d.pads = pads;
d.comps = {
  ESP: { x: 23.75, y: 14, rot: 0, layer: 'top', value: 'ESP32-WROOM', footprint: 'ESP32-WROOM' },
  U2: { x: 48, y: 20, rot: 0, layer: 'top', value: 'CH340G', footprint: 'SOIC-16' },
  Q1: { x: 44, y: 6, rot: 0, layer: 'top', value: '2N3904', footprint: 'SOT-23' },
  Q2: { x: 48, y: 6, rot: 0, layer: 'top', value: '2N3904', footprint: 'SOT-23' },
  C1: { x: 25, y: 32, rot: 0, layer: 'top', value: '100nF', footprint: 'C0603' },
  R_EN: { x: 10, y: 32, rot: 0, layer: 'top', value: '10k', footprint: 'R0603' },
  R_IO0: { x: 14, y: 32, rot: 0, layer: 'top', value: '10k', footprint: 'R0603' },
  R_IO15: { x: 18, y: 32, rot: 0, layer: 'top', value: '10k', footprint: 'R0603' },
  SW1: { x: 2, y: 12, rot: 0, layer: 'top', value: 'EN', footprint: 'SW-6x6' },
  SW2: { x: 2, y: 22, rot: 0, layer: 'top', value: 'FLASH', footprint: 'SW-6x6' },
  J1: { x: 57, y: 12.5, rot: 90, layer: 'top', value: 'UART', footprint: 'HDR-4P' }
};
mkdirSync(new URL('./', import.meta.url), { recursive: true });
writeFileSync(new URL('./design.json', import.meta.url), JSON.stringify(d, null, 1));
console.log('S1 spec:', pads.length, 'pads /', d.nets.length, 'nets');
