// H2 困难档：STM32F103C8T6 最小系统（LQFP48）
// 数据手册 LQFP48：0.5mm 间距，pad 0.3×1.5；引脚 CCW：1 VBAT … 12 PA2 … 48 VDD_3
// grid 0.25 = 0.5 pitch 的 1/2（2 格逃逸）；trackW 0.15 / clearance 0.1（嘉立创 1oz 极限内）
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const mA = html.match(new RegExp('// ==== ROUTER CORE START ====([\\s\\S]*?)// ==== ROUTER CORE END ===='));
const mB = html.match(new RegExp('// ==== EXAMPLES START ====([\\s\\S]*?)// ==== EXAMPLES END ===='));
const core = new Function(mA[1] + '\n' + mB[1] + '\nreturn {designDefaults, footprintPads};')();

const d = core.designDefaults();
d.width = 50; d.height = 40; d.grid = 0.25;
d.trackW = 0.15; d.clearance = 0.1; d.viaOuter = 0.6; d.viaDrill = 0.3;
d.layers = 2;
d.nets = [
  { id: 'v33', name: '3V3' }, { id: 'gnd', name: 'GND' },
  { id: 'osc_in', name: 'OSC_IN' }, { id: 'osc_out', name: 'OSC_OUT' },
  { id: 'o32i', name: 'OSC32_IN' }, { id: 'o32o', name: 'OSC32_OUT' },
  { id: 'nrst', name: 'NRST' }, { id: 'boot0', name: 'BOOT0' },
  { id: 'swdio', name: 'SWDIO' }, { id: 'swclk', name: 'SWCLK' },
  { id: 'udm', name: 'USB_DM' }, { id: 'udp', name: 'USB_DP' },
  { id: 'led', name: 'LED_N' }
];
for (let i = 0; i < 8; i++) d.nets.push({ id: 'pa' + i, name: 'PA' + i });
const N = {};
for (const n of d.nets) N[n.id] = n.id;
const pads = [];
const add = (c, p, n, x, y, w, h, shape, layer, holeR) =>
  pads.push({ id: `${c}-${p}`, netId: n == null ? null : (N[n] || n), x: +x.toFixed(4), y: +y.toFixed(4), w, h, shape: shape || 'rect', layer: layer || 'top', holeR });
// U1 LQFP48：12 焊盘/边，pitch 0.5，pad 0.3×1.5，中心距焊盘外沿 4.25
{
  const per = 12, off = 4.25, P = [];
  const pinNet = pin => ({
    1: null,                                   // VBAT→3V3
    2: 'led', 3: 'o32i', 4: 'o32o', 5: 'osc_in', 6: 'osc_out', 7: 'nrst',
    8: 'gnd', 9: 'v33',
    10: 'pa0', 11: 'pa1', 12: 'pa2', 13: 'pa3', 14: 'pa4', 15: 'pa5', 16: 'pa6', 17: 'pa7',
    18: null, 19: null, 20: null, 21: null, 22: null,
    23: 'gnd', 24: 'v33',
    25: null, 26: null, 27: null, 28: null, 29: null, 30: null, 31: 'udm', 32: 'udp', 33: 'swdio',
    34: null,
    35: 'gnd', 36: 'v33',
    37: 'swclk',
    38: null, 39: null, 40: null, 41: null, 42: null, 43: null,
    44: 'boot0', 45: null, 46: null,
    47: 'gnd', 48: 'v33'
  }[pin]);
  for (let k = 0; k < per; k++) { const t = (k - (per - 1) / 2) * 0.5; P.push({ pin: k + 1, dx: -off, dy: t, w: 1.5, h: 0.3 }); }         // 左 1-12（上→下）
  for (let k = 0; k < per; k++) { const t = (k - (per - 1) / 2) * 0.5; P.push({ pin: k + 13, dx: t, dy: off, w: 0.3, h: 1.5 }); }        // 底 13-24（左→右）
  for (let k = 0; k < per; k++) { const t = (k - (per - 1) / 2) * 0.5; P.push({ pin: k + 25, dx: off, dy: -t, w: 1.5, h: 0.3 }); }       // 右 25-36（下→上）
  for (let k = 0; k < per; k++) { const t = (k - (per - 1) / 2) * 0.5; P.push({ pin: k + 37, dx: -t, dy: -off, w: 0.3, h: 1.5 }); }      // 顶 37-48（右→左）
  for (const s of P) add('U1', s.pin, pinNet(s.pin), 25 + s.dx, 20 + s.dy, s.w, s.h, 'rect', 'top');
}
// U1 体区禁布（防细间距逃逸区被占）
d.keepouts.push({ x: 25, y: 20, w: 6.5, h: 6.5 });
const fp402 = core.footprintPads('0402');
const place = (comp, fp, cx, cy, netOf, layerOf) => {
  fp.forEach((f, i) => add(comp, i + 1, netOf(i + 1), cx + f.dx, cy + f.dy, f.w, f.h, f.shape, layerOf ? layerOf(i + 1) : f.layer, f.holeR));
};
// Y1 8MHz（OSC_IN=5 左上边第 5 位 → x 25-1.0, y 20-4.25 上方）
add('Y1', 1, 'osc_in', 22.5, 13.5, 2, 1.2);
add('Y1', 2, 'osc_out', 26.5, 13.5, 2, 1.2);
place('C11', fp402.map(f => ({ ...f })), 20.5, 12, i => i === 1 ? 'osc_in' : 'gnd');
place('C12', fp402.map(f => ({ ...f })), 28, 12, i => i === 1 ? 'osc_out' : 'gnd');
// Y2 32.768k（PC14/15 = pin3/4 左上端点附近）
add('Y2', 1, 'o32i', 18, 16.5, 1.6, 1);
add('Y2', 2, 'o32o', 18, 19.5, 1.6, 1);
place('C21', fp402.map(f => ({ ...f })), 15.5, 15.5, i => i === 1 ? 'o32i' : 'gnd');
place('C22', fp402.map(f => ({ ...f })), 15.5, 20.5, i => i === 1 ? 'o32o' : 'gnd');
// NRST：C + R 上拉 + SW1
place('CNR', fp402.map(f => ({ ...f })), 29.5, 13, i => i === 1 ? 'nrst' : 'gnd');
place('RNR', fp402.map(f => ({ ...f })), 29.5, 11, i => i === 1 ? 'nrst' : 'v33');
[[-3.2, -2.3], [3.2, -2.3], [-3.2, 2.3], [3.2, 2.3]].forEach(([dx, dy], i) =>
  add('SW1', i + 1, i < 2 ? 'nrst' : 'gnd', 35 + dx, 12 + dy, 1.5, 1.5, 'rect', 'both', 0.45));
// BOOT0 下拉电阻
place('RBT', fp402.map(f => ({ ...f })), 31.5, 27.5, i => i === 1 ? 'boot0' : 'gnd');
// 去耦：4× VDD 附近 100nF + 1× VDDA
place('C24', fp402.map(f => ({ ...f })), 31, 25, i => i === 1 ? 'v33' : 'gnd');
place('C36', fp402.map(f => ({ ...f })), 31.5, 24, i => i === 1 ? 'v33' : 'gnd');
place('C48', fp402.map(f => ({ ...f })), 32, 23, i => i === 1 ? 'v33' : 'gnd');
place('C9', fp402.map(f => ({ ...f })), 25, 11, i => i === 1 ? 'v33' : 'gnd');
// SWD 头 1×4（3V3 SWIO SWCLK GND）
[['v33'], ['swdio'], ['swclk'], ['gnd']].forEach(([n], i) =>
  add('J3', i + 1, n, 38, 18 + i * 2.54, 1.5, 1.5, 'circle', 'both', 0.4));
// USB 头 1×4（5V GND DM DP）——5V 直接进 3V3 稳压前？简化：板载 USB 供电
[['gnd'], ['udm'], ['udp'], ['v33']].forEach(([n], i) =>
  add('J4', i + 1, n, 12, 4 + i * 2.54, 1.5, 1.5, 'circle', 'both', 0.4));
// LED：PC13(2) → R → LED → 3V3（低电平点亮）
place('RLED', fp402.map(f => ({ ...f })), 17, 25.5, i => i === 1 ? 'led' : 'v33');
place('LED1', fp402.map(f => ({ ...f })), 21, 25.5, i => i === 1 ? 'gnd' : 'led');
// GPIO 排针 1×8（PA0-7 右侧引出）
for (let i = 0; i < 8; i++)
  add('J5', i + 1, 'pa' + i, 44, 4 + i * 2, 1.5, 1.5, 'circle', 'both', 0.4);
d.pads = pads;
d.comps = {
  U1: { x: 25, y: 20, rot: 0, layer: 'top', value: 'STM32F103C8T6', footprint: 'LQFP48' },
  Y1: { x: 24.5, y: 13.5, rot: 0, layer: 'top', value: '8MHz', footprint: 'XTAL-3225' },
  Y2: { x: 18, y: 18, rot: 90, layer: 'top', value: '32.768kHz', footprint: 'XTAL-3215' },
  SW1: { x: 35, y: 12, rot: 0, layer: 'top', value: 'NRST', footprint: 'SW-6x6' },
  J3: { x: 38, y: 21.6, rot: 90, layer: 'top', value: 'SWD', footprint: 'HDR-4P' },
  J4: { x: 12, y: 7.6, rot: 90, layer: 'top', value: 'USB', footprint: 'HDR-4P' },
  J5: { x: 44, y: 11, rot: 90, layer: 'top', value: 'PA0-7', footprint: 'HDR-8P' }
};
mkdirSync(new URL('./', import.meta.url), { recursive: true });
writeFileSync(new URL('./design.json', import.meta.url), JSON.stringify(d, null, 1));
console.log('H2 spec:', pads.length, 'pads /', d.nets.length, 'nets / grid', d.grid);
