// H5 困难：SD 卡数据记录板 —— ATmega328 DIP-28 SPI → SD 卡座
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
const mA = html.match(new RegExp('// ==== ROUTER CORE START ====([\\s\\S]*?)// ==== ROUTER CORE END ===='));
const mB = html.match(new RegExp('// ==== EXAMPLES START ====([\\s\\S]*?)// ==== EXAMPLES END ===='));
const core = new Function(mA[1] + '\n' + mB[1] + '\nreturn {footprintPads, designDefaults};')();
const d = core.designDefaults();
d.width = 55; d.height = 40; d.grid = 0.6;
d.trackW = 0.4; d.clearance = 0.2; d.viaOuter = 0.8; d.viaDrill = 0.4;
const nets = [{ id: 'v5', name: '5V' }, { id: 'gnd', name: 'GND' },
  { id: 'rst', name: 'RST' }, { id: 'sck', name: 'SCK' },
  { id: 'mosi', name: 'MOSI' }, { id: 'miso', name: 'MISO' },
  { id: 'cs', name: 'CS' }, { id: 'tx', name: 'TX' }];
d.nets = nets;
const pads = [];
const add = (c, p, n, x, y, w, h, shape, layer, holeR) =>
  pads.push({ id: `${c}-${p}`, netId: n, x: +x.toFixed(4), y: +y.toFixed(4), w, h, shape: shape || 'rect', layer: layer || 'top', holeR });
const place = (comp, fp, cx, cy, netOf, layerOf) => {
  fp.forEach((f, i) => add(comp, i + 1, netOf(i + 1), cx + f.dx, cy + f.dy, f.w, f.h, f.shape, layerOf ? layerOf(i + 1) : f.layer, f.holeR));
};
const fp603 = core.footprintPads('0603');
// U1 ATmega328 DIP-28
place('U1', core.footprintPads('DIP-N', 28), 15, 17.5, pin => ({
  1: 'rst', 7: 'v5', 8: 'gnd', 9: null, 10: null,
  15: null, 16: null, 17: 'mosi', 18: 'miso', 19: 'sck',
  20: null, 21: null, 22: null, 23: 'cs', 24: null, 25: null, 26: null,
  27: null, 28: null, 2: 'tx', 3: null, 5: null, 6: null,
  11: null, 12: null, 13: null, 14: null
}[pin] || null));
// SD 卡座 6 SPI 焊盘（简化：GND 3V3 CS MOSI VCC MISO SCK）
const sdNets = ['gnd', 'v5', 'cs', 'mosi', 'v5', 'miso', 'sck'];
sdNets.forEach((n, i) => add('SD1', i + 1, n, 42, 8 + i * 3, 1.5, 1.5, 'circle', 'both', 0.45));
// C1/C2 去耦
place('C1', fp603.map(f => ({ ...f })), 15, 6, i => i === 1 ? 'v5' : 'gnd');
place('C2', fp603.map(f => ({ ...f })), 42, 5, i => i === 1 ? 'v5' : 'gnd');
// R1 复位上拉
place('R1', fp603.map(f => ({ ...f })), 15, 29, i => i === 1 ? 'rst' : 'v5');
// J1 串口 1×3（VCC TX GND）
['v5', 'tx', 'gnd'].forEach((n, i) => add('J1', i + 1, n, 2, 10 + i * 2.54, 1.7, 1.7, 'circle', 'both', 0.45));
d.pads = pads;
d.comps = {
  U1: { x: 15, y: 17.5, rot: 0, layer: 'top', value: 'ATmega328', footprint: 'DIP-28' },
  SD1: { x: 42, y: 17, rot: 90, layer: 'top', value: 'SD Card', footprint: 'SD-CARD' },
  C1: { x: 15, y: 6, rot: 0, layer: 'top', value: '100nF', footprint: 'C0603' },
  C2: { x: 42, y: 5, rot: 0, layer: 'top', value: '100nF', footprint: 'C0603' },
  R1: { x: 15, y: 29, rot: 0, layer: 'top', value: '10k', footprint: 'R0603' },
  J1: { x: 2, y: 12.5, rot: 90, layer: 'top', value: 'UART', footprint: 'HDR-3P' }
};
mkdirSync(new URL('./', import.meta.url), { recursive: true });
writeFileSync(new URL('./design.json', import.meta.url), JSON.stringify(d, null, 1));
console.log('H5 spec:', pads.length, 'pads /', d.nets.length, 'nets');
