// M3 中等：ATtiny85 驱动 4× WS2812 灯带
// WS2812: 1 VCC 2 DOUT 3 GND 4 DIN（数据串行链）
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
const mA = html.match(new RegExp('// ==== ROUTER CORE START ====([\\s\\S]*?)// ==== ROUTER CORE END ===='));
const mB = html.match(new RegExp('// ==== EXAMPLES START ====([\\s\\S]*?)// ==== EXAMPLES END ===='));
const core = new Function(mA[1] + '\n' + mB[1] + '\nreturn {footprintPads, designDefaults};')();
const d = core.designDefaults();
d.width = 55; d.height = 25; d.grid = 0.6;
d.trackW = 0.4; d.clearance = 0.2; d.viaOuter = 0.8; d.viaDrill = 0.4;
d.nets = [
  { id: 'v5', name: '5V' }, { id: 'gnd', name: 'GND' },
  { id: 'din', name: 'DIN' }, { id: 'd1', name: 'D1' }, { id: 'd2', name: 'D2' }, { id: 'd3', name: 'D3' },
  { id: 'rst', name: 'RST' }
];
const pads = [];
const add = (c, p, n, x, y, w, h, shape, layer, holeR) =>
  pads.push({ id: `${c}-${p}`, netId: n, x: +x.toFixed(4), y: +y.toFixed(4), w, h, shape: shape || 'rect', layer: layer || 'top', holeR });
const place = (comp, fp, cx, cy, netOf, layerOf) => {
  fp.forEach((f, i) => add(comp, i + 1, netOf(i + 1), cx + f.dx, cy + f.dy, f.w, f.h, f.shape, layerOf ? layerOf(i + 1) : f.layer, f.holeR));
};
// U1 ATtiny85 SOIC-8
place('U1', core.footprintPads('SOIC-8'), 8, 12.5, pin => ({
  1: 'rst', 2: null, 3: null, 4: 'gnd', 5: 'din', 6: null, 7: null, 8: 'v5'
}[pin] || null));
// R1 复位上拉
const fp603 = core.footprintPads('0603');
place('R1', fp603.map(f => ({ ...f })), 8, 6, i => i === 1 ? 'rst' : 'v5');
// C1 去耦
place('C1', fp603.map(f => ({ ...f })), 8, 19, i => i === 1 ? 'v5' : 'gnd');
// WS2812 ×4 数据链串接（5050 封装 4 边焊盘）
for (let i = 0; i < 4; i++) {
  const x = 18 + i * 9;
  const dinNet = i === 0 ? 'din' : ('d' + i);
  const doutNet = i === 3 ? null : ('d' + (i + 1));
  add('WS' + (i + 1), 1, 'v5', x - 2.5, 8, 1.2, 1.2);
  add('WS' + (i + 1), 2, doutNet, x - 2.5, 12, 1.2, 1.2);
  add('WS' + (i + 1), 3, 'gnd', x + 2.5, 12, 1.2, 1.2);
  add('WS' + (i + 1), 4, dinNet, x + 2.5, 8, 1.2, 1.2);
}
// J1 电源+数据输入，J2 灯带输出
add('J1', 1, 'v5', 2, 6, 1.7, 1.7, 'circle', 'both', 0.45);
add('J1', 2, 'gnd', 2, 8.54, 1.7, 1.7, 'circle', 'both', 0.45);
add('J2', 1, 'd3', 53, 10, 1.7, 1.7, 'circle', 'both', 0.45);
add('J2', 2, 'gnd', 53, 12.54, 1.7, 1.7, 'circle', 'both', 0.45);
d.pads = pads;
d.comps = {
  U1: { x: 8, y: 12.5, rot: 0, layer: 'top', value: 'ATtiny85', footprint: 'SOIC-8' },
  R1: { x: 8, y: 6, rot: 0, layer: 'top', value: '10k', footprint: 'R0603' },
  C1: { x: 8, y: 19, rot: 0, layer: 'top', value: '100nF', footprint: 'C0603' },
  WS1: { x: 18, y: 10, rot: 0, layer: 'top', value: 'WS2812B', footprint: 'WS2812-5050' },
  WS2: { x: 27, y: 10, rot: 0, layer: 'top', value: 'WS2812B', footprint: 'WS2812-5050' },
  WS3: { x: 36, y: 10, rot: 0, layer: 'top', value: 'WS2812B', footprint: 'WS2812-5050' },
  WS4: { x: 45, y: 10, rot: 0, layer: 'top', value: 'WS2812B', footprint: 'WS2812-5050' },
  J1: { x: 2, y: 7.3, rot: 90, layer: 'top', value: 'PWR', footprint: 'HDR-2P' },
  J2: { x: 53, y: 11.3, rot: 90, layer: 'top', value: 'OUT', footprint: 'HDR-2P' }
};
mkdirSync(new URL('./', import.meta.url), { recursive: true });
writeFileSync(new URL('./design.json', import.meta.url), JSON.stringify(d, null, 1));
console.log('M3 spec:', pads.length, 'pads /', d.nets.length, 'nets');
