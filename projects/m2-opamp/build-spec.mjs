// M2 中等档：LM358 双通道同相放大板
// 通道1: J1-1 → C1 耦合 →(in1p)→ R2 偏置 → U1-3(+)；R3/R4 设增益（反相端 in1n）
// 通道2 同构。电源去耦 C3。增益 = 1+R3/R4 ≈ 11
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const mA = html.match(new RegExp('// ==== ROUTER CORE START ====([\\s\\S]*?)// ==== ROUTER CORE END ===='));
const mB = html.match(new RegExp('// ==== EXAMPLES START ====([\\s\\S]*?)// ==== EXAMPLES END ===='));
const core = new Function(mA[1] + '\n' + mB[1] + '\nreturn {footprintPads, designDefaults};')();

const d = core.designDefaults();
d.width = 55; d.height = 30; d.grid = 0.6;
d.trackW = 0.4; d.clearance = 0.2; d.viaOuter = 0.8; d.viaDrill = 0.4;
d.nets = [
  { id: 'vcc', name: 'VCC' }, { id: 'gnd', name: 'GND' },
  { id: 'in1', name: 'IN1' }, { id: 'in1p', name: 'IN1P' }, { id: 'in1n', name: 'IN1N' }, { id: 'out1', name: 'OUT1' },
  { id: 'in2', name: 'IN2' }, { id: 'in2p', name: 'IN2P' }, { id: 'in2n', name: 'IN2N' }, { id: 'out2', name: 'OUT2' }
];
const pads = [];
const add = (c, p, n, x, y, w, h, shape, layer, holeR) =>
  pads.push({ id: `${c}-${p}`, netId: n, x: +x.toFixed(4), y: +y.toFixed(4), w, h, shape: shape || 'rect', layer: layer || 'top', holeR });
const fp603 = core.footprintPads('0603');
const place = (comp, fp, cx, cy, netOf, layerOf) => {
  fp.forEach((f, i) => add(comp, i + 1, netOf(i + 1), cx + f.dx, cy + f.dy, f.w, f.h, f.shape, layerOf ? layerOf(i + 1) : f.layer, f.holeR));
};
// U1 LM358 SOIC-8: 1=OUT1 2=IN1- 3=IN1+ 4=GND 5=IN2+ 6=IN2- 7=OUT2 8=VCC
place('U1', core.footprintPads('SOIC-8'), 27, 15, pin => ({
  1: 'out1', 2: 'in1n', 3: 'in1p', 4: 'gnd', 5: 'in2p', 6: 'in2n', 7: 'out2', 8: 'vcc'
}[pin] || null));
// 通道1（上半）：C1 耦合 → R1 到地（偏置）→ in1p
place('C1', fp603.map(f => ({ ...f })), 10, 9, i => i === 1 ? 'in1' : 'in1p');
place('R1', fp603.map(f => ({ ...f })), 10, 13, i => i === 1 ? 'in1p' : 'gnd');
place('R2', fp603.map(f => ({ ...f })), 17, 6, i => i === 1 ? 'in1n' : 'out1');   // 反馈
place('R3', fp603.map(f => ({ ...f })), 17, 11.5, i => i === 1 ? 'in1n' : 'gnd'); // 增益
// 通道2（下半）
place('C2', fp603.map(f => ({ ...f })), 10, 20, i => i === 1 ? 'in2' : 'in2p');
place('R4', fp603.map(f => ({ ...f })), 10, 24, i => i === 1 ? 'in2p' : 'gnd');
place('R5', fp603.map(f => ({ ...f })), 17, 17.5, i => i === 1 ? 'in2n' : 'out2');
place('R6', fp603.map(f => ({ ...f })), 17, 23, i => i === 1 ? 'in2n' : 'gnd');
// C3 去耦
place('C3', fp603.map(f => ({ ...f })), 30, 22.5, i => i === 1 ? 'vcc' : 'gnd');
// J1 输入 / J2 输出 / J3 电源
[['in1', 'gnd'], ['in2', null]].forEach((pair, i) => {
  add('J1', i * 2 + 1, pair[0], 4, 9 + i * 6, 1.7, 1.7, 'circle', 'both', 0.45);
  if (pair[1]) add('J1', i * 2 + 2, pair[1], 4, 12 + i * 6, 1.7, 1.7, 'circle', 'both', 0.45);
});
add('J2', 1, 'out1', 50, 9, 1.7, 1.7, 'circle', 'both', 0.45);
add('J2', 2, 'gnd', 50, 11.54, 1.7, 1.7, 'circle', 'both', 0.45);
add('J2', 3, 'out2', 50, 14.08, 1.7, 1.7, 'circle', 'both', 0.45);
add('J3', 1, 'vcc', 27, 3, 1.7, 1.7, 'circle', 'both', 0.45);
add('J3', 2, 'gnd', 29.54, 3, 1.7, 1.7, 'circle', 'both', 0.45);
d.pads = pads;
d.comps = {
  U1: { x: 27, y: 15, rot: 0, layer: 'top', value: 'LM358', footprint: 'SOIC-8' },
  C1: { x: 10, y: 9, rot: 0, layer: 'top', value: '1uF', footprint: 'C0603', lcsc: 'C15849' },
  R1: { x: 10, y: 13, rot: 0, layer: 'top', value: '100k', footprint: 'R0603', lcsc: 'C25803' },
  R2: { x: 17, y: 6, rot: 0, layer: 'top', value: '100k', footprint: 'R0603', lcsc: 'C25803' },
  R3: { x: 17, y: 11.5, rot: 0, layer: 'top', value: '10k', footprint: 'R0603', lcsc: 'C25804' },
  C2: { x: 10, y: 20, rot: 0, layer: 'top', value: '1uF', footprint: 'C0603', lcsc: 'C15849' },
  R4: { x: 10, y: 24, rot: 0, layer: 'top', value: '100k', footprint: 'R0603', lcsc: 'C25803' },
  R5: { x: 17, y: 17.5, rot: 0, layer: 'top', value: '100k', footprint: 'R0603', lcsc: 'C25803' },
  R6: { x: 17, y: 23, rot: 0, layer: 'top', value: '10k', footprint: 'R0603', lcsc: 'C25804' },
  C3: { x: 30, y: 22.5, rot: 0, layer: 'top', value: '100nF', footprint: 'C0603', lcsc: 'C1591' },
  J1: { x: 4, y: 10.5, rot: 90, layer: 'top', value: 'IN', footprint: 'HDR-3P-2.54' },
  J2: { x: 50, y: 11.5, rot: 90, layer: 'top', value: 'OUT', footprint: 'HDR-3P-2.54' },
  J3: { x: 28.3, y: 3, rot: 0, layer: 'top', value: 'PWR', footprint: 'HDR-2P-2.54' }
};
mkdirSync(new URL('./', import.meta.url), { recursive: true });
writeFileSync(new URL('./design.json', import.meta.url), JSON.stringify(d, null, 1));
console.log('M2 spec:', pads.length, 'pads /', d.nets.length, 'nets');
