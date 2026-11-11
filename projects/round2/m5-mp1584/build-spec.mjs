// M5 中等：MP1584 降压电源板 —— 24V→5V 3A
// MP1584 SOIC-8: 1 SW 2 IN 3 EN 4 BST 5 PGND 6 FB 7 AGND 8 COMP
// 实际引脚：1 SW, 2 IN, 3 EN, 4 BST, 5 GND, 6 FB, 7 GND, 8 VCC? — 用简化模型
// 电路：VIN→C_IN→MP1584(IN) → SW → 电感 → VOUT，FB 分压反馈，SS34 续流
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
const mA = html.match(new RegExp('// ==== ROUTER CORE START ====([\\s\\S]*?)// ==== ROUTER CORE END ===='));
const mB = html.match(new RegExp('// ==== EXAMPLES START ====([\\s\\S]*?)// ==== EXAMPLES END ===='));
const core = new Function(mA[1] + '\n' + mB[1] + '\nreturn {footprintPads, designDefaults};')();
const d = core.designDefaults();
d.width = 40; d.height = 25; d.grid = 0.6;
d.trackW = 0.4; d.clearance = 0.2; d.viaOuter = 0.8; d.viaDrill = 0.4;
d.nets = [
  { id: 'vin', name: 'VIN', w: 0.5 }, { id: 'gnd', name: 'GND', w: 0.5 },
  { id: 'sw', name: 'SW' }, { id: 'vout', name: 'VOUT', w: 0.5 },
  { id: 'fb', name: 'FB' }, { id: 'bst', name: 'BST' }
];
const pads = [];
const add = (c, p, n, x, y, w, h, shape, layer, holeR) =>
  pads.push({ id: `${c}-${p}`, netId: n, x: +x.toFixed(4), y: +y.toFixed(4), w, h, shape: shape || 'rect', layer: layer || 'top', holeR });
const place = (comp, fp, cx, cy, netOf, layerOf) => {
  fp.forEach((f, i) => add(comp, i + 1, netOf(i + 1), cx + f.dx, cy + f.dy, f.w, f.h, f.shape, layerOf ? layerOf(i + 1) : f.layer, f.holeR));
};
// U1 MP1584 SOIC-8（简化引脚映射）
place('U1', core.footprintPads('SOIC-8'), 20, 12.5, pin => ({
  1: 'sw', 2: 'vin', 3: null, 4: 'bst', 5: 'gnd', 6: 'fb', 7: 'gnd', 8: 'bst'
}[pin] || null));
// C_IN 10µF/25V
place('CIN', core.footprintPads('0805'), 10, 8, i => i === 1 ? 'vin' : 'gnd');
// L1 电感 2 焊盘（SW→VOUT）
add('L1', 1, 'sw', 29, 12, 2, 1.5);
add('L1', 2, 'vout', 33, 12, 2, 1.5);
// D1 SS34 续流（SW→GND）
const fpSMB = [{ dx: -1.8, dy: 0, w: 1.2, h: 1.6, shape: 'rect', layer: 'top' }, { dx: 1.8, dy: 0, w: 1.2, h: 1.6, shape: 'rect', layer: 'top' }];
place('D1', fpSMB, 29, 17, i => i === 1 ? 'sw' : 'gnd');
// C_OUT 22µF
place('COUT', core.footprintPads('0805'), 37, 8, i => i === 1 ? 'vout' : 'gnd');
// R_FB 上 40.2k / 下 8.06k 分压
const fp603 = core.footprintPads('0603');
place('RF1', fp603.map(f => ({ ...f })), 14, 17, i => i === 1 ? 'vout' : 'fb');
place('RF2', fp603.map(f => ({ ...f })), 14, 21, i => i === 1 ? 'fb' : 'gnd');
// C_BST 100nF（BST↔SW 自举）
place('CB', fp603.map(f => ({ ...f })), 25.5, 8, i => i === 1 ? 'bst' : 'sw');
// J1 输入 / J2 输出
add('J1', 1, 'vin', 4, 18, 1.7, 1.7, 'circle', 'both', 0.45);
add('J1', 2, 'gnd', 4, 20.54, 1.7, 1.7, 'circle', 'both', 0.45);
add('J2', 1, 'vout', 38, 20, 1.7, 1.7, 'circle', 'both', 0.45);
add('J2', 2, 'gnd', 35.46, 20, 1.7, 1.7, 'circle', 'both', 0.45);
d.pads = pads;
d.comps = {
  U1: { x: 20, y: 12.5, rot: 0, layer: 'top', value: 'MP1584', footprint: 'SOIC-8' },
  CIN: { x: 10, y: 8, rot: 0, layer: 'top', value: '10uF/25V', footprint: 'C0805' },
  L1: { x: 31, y: 12, rot: 0, layer: 'top', value: '2.2uH', footprint: 'L-SMD' },
  D1: { x: 29, y: 17, rot: 0, layer: 'top', value: 'SS34', footprint: 'SMB' },
  COUT: { x: 37, y: 8, rot: 0, layer: 'top', value: '22uF', footprint: 'C0805' },
  RF1: { x: 14, y: 17, rot: 0, layer: 'top', value: '40.2k', footprint: 'R0603' },
  RF2: { x: 14, y: 21, rot: 0, layer: 'top', value: '8.06k', footprint: 'R0603' },
  CB: { x: 25.5, y: 8, rot: 0, layer: 'top', value: '100nF', footprint: 'C0603' },
  J1: { x: 4, y: 19.3, rot: 90, layer: 'top', value: 'VIN', footprint: 'HDR-2P' },
  J2: { x: 36.7, y: 20, rot: 90, layer: 'top', value: 'VOUT', footprint: 'HDR-2P' }
};
mkdirSync(new URL('./', import.meta.url), { recursive: true });
writeFileSync(new URL('./design.json', import.meta.url), JSON.stringify(d, null, 1));
console.log('M5 spec:', pads.length, 'pads /', d.nets.length, 'nets');
