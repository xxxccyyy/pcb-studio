// E5 简单：DS18B20 温度探头 + ATtiny85 读取 + 串口输出
// DS18B20 TO-92: 1 GND 2 DQ 3 VCC（1-Wire 单总线 + 4.7k 上拉）
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
const mA = html.match(new RegExp('// ==== ROUTER CORE START ====([\\s\\S]*?)// ==== ROUTER CORE END ===='));
const mB = html.match(new RegExp('// ==== EXAMPLES START ====([\\s\\S]*?)// ==== EXAMPLES END ===='));
const core = new Function(mA[1] + '\n' + mB[1] + '\nreturn {footprintPads, designDefaults};')();
const d = core.designDefaults();
d.width = 35; d.height = 22; d.grid = 0.6;
d.trackW = 0.4; d.clearance = 0.2; d.viaOuter = 0.8; d.viaDrill = 0.4;
d.nets = [{ id: 'vcc', name: 'VCC' }, { id: 'gnd', name: 'GND' },
  { id: 'dq', name: 'DQ' }, { id: 'tx', name: 'TX' }, { id: 'rx', name: 'RX' }];
const pads = [];
const add = (c, p, n, x, y, w, h, shape, layer, holeR) =>
  pads.push({ id: `${c}-${p}`, netId: n, x: +x.toFixed(4), y: +y.toFixed(4), w, h, shape: shape || 'rect', layer: layer || 'top', holeR });
const fp603 = core.footprintPads('0603');
const place = (comp, fp, cx, cy, netOf, layerOf) => {
  fp.forEach((f, i) => add(comp, i + 1, netOf(i + 1), cx + f.dx, cy + f.dy, f.w, f.h, f.shape, layerOf ? layerOf(i + 1) : f.layer, f.holeR));
};
// U1 DS18B20 TO-92: 1 GND 2 DQ 3 VCC（三角排列）
add('U1', 1, 'gnd', 7, 8, 1.2, 1.2, 'circle', 'both', 0.35);
add('U1', 2, 'dq', 9.5, 6.5, 1.2, 1.2, 'circle', 'both', 0.35);
add('U1', 3, 'vcc', 12, 8, 1.2, 1.2, 'circle', 'both', 0.35);
// R1 4.7k 上拉 DQ→VCC
place('R1', fp603.map(f => ({ ...f })), 10.5, 3.5, i => i === 1 ? 'dq' : 'vcc');
// U2 ATtiny85 SOIC-8（PB2=SCK 接 DQ 读取）
place('U2', core.footprintPads('SOIC-8'), 20, 11, pin => ({
  1: null, 2: 'rx', 3: 'tx', 4: 'gnd', 5: 'dq', 6: null, 7: null, 8: 'vcc'
}[pin] || null));
// C1 去耦
place('C1', fp603.map(f => ({ ...f })), 20, 17, i => i === 1 ? 'vcc' : 'gnd');
// J1 串口排针 1×3
['vcc', 'tx', 'rx'].forEach((n, i) => add('J1', i + 1, n, 32, 6 + i * 2.54, 1.7, 1.7, 'circle', 'both', 0.45));
d.pads = pads;
d.comps = {
  U1: { x: 9.5, y: 7, rot: 0, layer: 'top', value: 'DS18B20', footprint: 'TO-92' },
  R1: { x: 10.5, y: 3.5, rot: 0, layer: 'top', value: '4.7k', footprint: 'R0603', lcsc: 'C25819' },
  U2: { x: 20, y: 11, rot: 0, layer: 'top', value: 'ATtiny85', footprint: 'SOIC-8' },
  C1: { x: 20, y: 17, rot: 0, layer: 'top', value: '100nF', footprint: 'C0603', lcsc: 'C1591' },
  J1: { x: 32, y: 8.5, rot: 90, layer: 'top', value: 'UART', footprint: 'HDR-3P-2.54' }
};
mkdirSync(new URL('./', import.meta.url), { recursive: true });
writeFileSync(new URL('./design.json', import.meta.url), JSON.stringify(d, null, 1));
console.log('E5 spec:', pads.length, 'pads /', d.nets.length, 'nets');
