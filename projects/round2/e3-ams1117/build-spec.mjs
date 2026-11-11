// E3 简单：AMS1117-3.3 LDO 稳压板 —— 5V→3.3V，SOT-223 + 钽电容 + LED 指示
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
const mA = html.match(new RegExp('// ==== ROUTER CORE START ====([\\s\\S]*?)// ==== ROUTER CORE END ===='));
const mB = html.match(new RegExp('// ==== EXAMPLES START ====([\\s\\S]*?)// ==== EXAMPLES END ===='));
const core = new Function(mA[1] + '\n' + mB[1] + '\nreturn {footprintPads, designDefaults};')();
const d = core.designDefaults();
d.width = 30; d.height = 18; d.grid = 0.6;
d.trackW = 0.4; d.clearance = 0.2; d.viaOuter = 0.8; d.viaDrill = 0.4;
d.nets = [{ id: 'v5', name: '5V' }, { id: 'v33', name: '3V3' }, { id: 'gnd', name: 'GND' }];
const pads = [];
const add = (c, p, n, x, y, w, h, shape, layer, holeR) =>
  pads.push({ id: `${c}-${p}`, netId: n, x: +x.toFixed(4), y: +y.toFixed(4), w, h, shape: shape || 'rect', layer: layer || 'top', holeR });
// U1 AMS1117 SOT-223: 1=GND/ADJ 2=VOUT 3=VIN 4=VOUT(tab)
[[-2.3, 1.75, 'gnd'], [0, 1.75, 'v33'], [2.3, 1.75, 'v5'], [0, -1.75, 'v33']].forEach(([dx, dy, n], i) =>
  add('U1', i + 1, n, 15 + dx, 9 + dy, 1.6, 1.8, 'rect', 'both', 0.35));   // 1.6mm pad - 0.7mm hole = 0.5mm ring ✓
// C1 输入 10µF 钽 / C2 输出 22µF 钽
const fp805 = core.footprintPads('0805');
[["C1", 'v5', 8, 4], ["C2", 'v33', 22, 4]].forEach(([comp, n, x, y]) => {
  const fp = fp805.map(f => ({ ...f }));
  add(comp, 1, n, x + fp[0].dx, y + fp[0].dy, fp[0].w, fp[0].h);
  add(comp, 2, 'gnd', x + fp[1].dx, y + fp[1].dy, fp[1].w, fp[1].h);
});
// LED1 电源指示（3V3→R1→LED→GND）
const fp603 = core.footprintPads('0603');
[["R1", 'v33', 22, 10], ["LED1", 'gnd', 26, 10]].forEach(([comp, n, x, y]) => {
  const fp = fp603.map(f => ({ ...f }));
  add(comp, 1, n, x + fp[0].dx, y + fp[0].dy, fp[0].w, fp[0].h);
  add(comp, 2, n, x + fp[1].dx, y + fp[1].dy, fp[1].w, fp[1].h);
});
// J1 输入 5V/GND，J2 输出 3V3/GND
add('J1', 1, 'v5', 3, 14, 1.7, 1.7, 'circle', 'both', 0.45);
add('J1', 2, 'gnd', 5.54, 14, 1.7, 1.7, 'circle', 'both', 0.45);
add('J2', 1, 'v33', 27, 14, 1.7, 1.7, 'circle', 'both', 0.45);
add('J2', 2, 'gnd', 24.46, 14, 1.7, 1.7, 'circle', 'both', 0.45);
d.pads = pads;
d.comps = {
  U1: { x: 15, y: 9, rot: 0, layer: 'top', value: 'AMS1117-3.3', footprint: 'SOT-223' },
  C1: { x: 8, y: 4, rot: 0, layer: 'top', value: '10uF', footprint: 'C0805' },
  C2: { x: 22, y: 4, rot: 0, layer: 'top', value: '22uF', footprint: 'C0805' },
  R1: { x: 22, y: 10, rot: 0, layer: 'top', value: '1k', footprint: 'R0603' },
  LED1: { x: 26, y: 10, rot: 0, layer: 'top', value: 'LED Red', footprint: 'LED0603' },
  J1: { x: 4.3, y: 14, rot: 90, layer: 'top', value: '5V-IN', footprint: 'HDR-2P' },
  J2: { x: 25.7, y: 14, rot: 90, layer: 'top', value: '3V3-OUT', footprint: 'HDR-2P' }
};
mkdirSync(new URL('./', import.meta.url), { recursive: true });
writeFileSync(new URL('./design.json', import.meta.url), JSON.stringify(d, null, 1));
console.log('E3 spec:', pads.length, 'pads /', d.nets.length, 'nets');
