// E2 简单档：按键去抖 + 施密特整形板 —— 74HC14 一通道
// 链路：SW →(sw_raw)→ R1 上拉/C1 滤波 → R2 →(deb)→ 74HC14 →(out)→ J1-3
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const mA = html.match(new RegExp('// ==== ROUTER CORE START ====([\\s\\S]*?)// ==== ROUTER CORE END ===='));
const mB = html.match(new RegExp('// ==== EXAMPLES START ====([\\s\\S]*?)// ==== EXAMPLES END ===='));
const core = new Function(mA[1] + '\n' + mB[1] + '\nreturn {footprintPads, designDefaults};')();

const d = core.designDefaults();
d.width = 45; d.height = 25; d.grid = 0.6;
d.trackW = 0.4; d.clearance = 0.2; d.viaOuter = 0.8; d.viaDrill = 0.4;
d.nets = [
  { id: 'vcc', name: 'VCC' }, { id: 'gnd', name: 'GND' },
  { id: 'sw_raw', name: 'SW_RAW' }, { id: 'deb', name: 'DEB' }, { id: 'out', name: 'OUT' }
];
const pads = [];
const add = (c, p, n, x, y, w, h, shape, layer, holeR) =>
  pads.push({ id: `${c}-${p}`, netId: n, x: +x.toFixed(4), y: +y.toFixed(4), w, h, shape: shape || 'rect', layer: layer || 'top', holeR });
const fp603 = core.footprintPads('0603');
const place = (comp, fp, cx, cy, netOf, layerOf) => {
  fp.forEach((f, i) => add(comp, i + 1, netOf(i + 1), cx + f.dx, cy + f.dy, f.w, f.h, f.shape, layerOf ? layerOf(i + 1) : f.layer, f.holeR));
};
// U1: 74HC14 SOIC-14 —— pin1 A1, pin2 Y1, pin14 VCC, pin7 GND（数据手册引脚）
place('U1', core.footprintPads('SOIC-14'), 30, 12.5, pin => ({
  1: 'deb', 2: 'out', 7: 'gnd', 14: 'vcc'
}[pin] || null));
// SW1: 6×6 按键
[[-3.2, -2.3], [3.2, -2.3], [-3.2, 2.3], [3.2, 2.3]].forEach(([dx, dy], i) =>
  add('SW1', i + 1, i < 2 ? 'sw_raw' : 'gnd', 10 + dx, 12.5 + dy, 1.5, 1.5, 'rect', 'both', 0.45));
// R1 上拉（sw_raw→vcc）
place('R1', fp603.map(f => ({ ...f })), 15, 6, i => i === 1 ? 'sw_raw' : 'vcc');
// C1 滤波（sw_raw→gnd）
place('C1', fp603.map(f => ({ ...f })), 19, 19, i => i === 1 ? 'sw_raw' : 'gnd');
// R2 串联（sw_raw→deb）
place('R2', fp603.map(f => ({ ...f })), 23, 6, i => i === 1 ? 'sw_raw' : 'deb');
// J1: 输入输出排针
[["vcc", 'VCC'], ["gnd", 'GND'], ["out", 'OUT']].forEach(([n], i) =>
  add('J1', i + 1, n, 42, 4 + i * 2.54, 1.7, 1.7, 'circle', 'both', 0.45));
d.pads = pads;
d.comps = {
  U1: { x: 30, y: 12.5, rot: 0, layer: 'top', value: '74HC14', footprint: 'SOIC-14' },
  SW1: { x: 10, y: 12.5, rot: 0, layer: 'top', value: 'RESET', footprint: 'SW-6x6' },
  R1: { x: 15, y: 6, rot: 0, layer: 'top', value: '10k', footprint: 'R0603', lcsc: 'C25804' },
  R2: { x: 23, y: 6, rot: 0, layer: 'top', value: '1k', footprint: 'R0603', lcsc: 'C21190' },
  C1: { x: 19, y: 19, rot: 0, layer: 'top', value: '100nF', footprint: 'C0603', lcsc: 'C1591' },
  J1: { x: 42, y: 6.5, rot: 90, layer: 'top', value: 'IO', footprint: 'HDR-3P-2.54' }
};
mkdirSync(new URL('./', import.meta.url), { recursive: true });
writeFileSync(new URL('./design.json', import.meta.url), JSON.stringify(d, null, 1));
console.log('E2 spec:', pads.length, 'pads /', d.nets.length, 'nets');
