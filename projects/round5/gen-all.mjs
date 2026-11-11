// 第五轮批量 spec 生成：N33-N52（20 项目，4 档，全部与前四轮不同的设计维度）
// netOf 一律用显式数组（第 n 元 = pin n 的网络，null/undefined = 悬空），避免三元链语法问题
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const mA = html.match(new RegExp('// ==== ROUTER CORE START ====([\\s\\S]*?)// ==== ROUTER CORE END ===='));
const mB = html.match(new RegExp('// ==== EXAMPLES START ====([\\s\\S]*?)// ==== EXAMPLES END ===='));
const core = new Function(mA[1] + '\n' + mB[1] + '\nreturn {footprintPads, designDefaults};')();
const base = new URL('./', import.meta.url);

function makeDesign(name, opts) {
  const d = core.designDefaults();
  Object.assign(d, { width: 45, height: 30, grid: 0.6, trackW: 0.4, clearance: 0.2, viaOuter: 0.8, viaDrill: 0.4, ...opts });
  d.nets = opts.nets;
  const pads = [];
  const compsMeta = {};
  const add = (c, p, n, x, y, w, h, shape, layer, holeR) =>
    pads.push({ id: `${c}-${p}`, netId: n, x: +x.toFixed(4), y: +y.toFixed(4), w, h, shape: shape || 'rect', layer: layer || 'top', holeR });
  const place = (comp, fp, cx, cy, nets, meta) => {
    fp.forEach((f, i) => add(comp, i + 1, nets[i] || null, cx + f.dx, cy + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
    if (meta) compsMeta[comp] = meta;
  };
  return { d, pads, add, place, compsMeta, save(subdir) {
    d.pads = pads;
    d.comps = compsMeta;
    const dir = new URL(subdir + '/', base);
    mkdirSync(dir, { recursive: true });
    writeFileSync(new URL(subdir + '/design.json', base), JSON.stringify(d, null, 1));
    console.log(name + ':', pads.length, 'pads /', d.nets.length, 'nets');
  }};
}
const mk = (n, count) => core.footprintPads(n, count);   // count 必须透传（DIP-N 依赖它定脚数）
const fp603 = mk('0603');
const fp402 = mk('0402');
const fp805 = mk('0805');
const fp1206 = mk('1206');

// ---- 手动封装 ----
const sidePairs = (per, pitch, pw, ph) => {
  const P = [], s = (per - 1) / 2 * pitch;
  for (let k = 0; k < per; k++) P.push({ dx: -s, dy: -s + k * pitch, w: ph, h: pw });
  for (let k = per - 1; k >= 0; k--) P.push({ dx: s, dy: -s + k * pitch, w: ph, h: pw });
  return P;
};
// QFP：沿边跨度 ±s，垂直中线外移 s+1.1 —— 四角相邻边焊盘矩形间隙 0.1mm（不重叠）
const qfpPads = (per, pitch, pw, ph) => {
  const s = (per - 1) / 2 * pitch, A = s + 1.1, P = [];
  for (let k = 0; k < per; k++) P.push({ dx: -A, dy: -s + k * pitch, w: ph, h: pw });
  for (let k = 0; k < per; k++) P.push({ dx: -s + k * pitch, dy: A, w: pw, h: ph });
  for (let k = 0; k < per; k++) P.push({ dx: A, dy: s - k * pitch, w: ph, h: pw });
  for (let k = 0; k < per; k++) P.push({ dx: s - k * pitch, dy: -A, w: pw, h: ph });
  return P;
};
const SSOP28 = sidePairs(14, 0.65, 0.4, 1.5);
const SSOP24 = sidePairs(12, 0.65, 0.4, 1.5);
const TQFP44 = qfpPads(11, 0.8, 0.5, 1.5);
const LQFP48 = qfpPads(12, 0.5, 0.3, 1.2);
const LQFP100 = qfpPads(25, 0.5, 0.25, 1.2);
const TSOP44 = sidePairs(22, 0.8, 0.4, 1.5);
const QFN32 = qfpPads(8, 0.5, 0.3, 0.8);
const QFN28 = qfpPads(7, 0.5, 0.28, 0.8);
const hd = (n, pitch = 2.54) => Array.from({ length: n }, (_, k) => ({ dx: (k - (n - 1) / 2) * pitch, dy: 0, w: 1.7, h: 1.7, shape: 'circle', layer: 'both', holeR: 0.45 }));
const hdv = (n, pitch = 2.54) => Array.from({ length: n }, (_, k) => ({ dx: 0, dy: (k - (n - 1) / 2) * pitch, w: 1.7, h: 1.7, shape: 'circle', layer: 'both', holeR: 0.45 }));
const term = (n, pitch = 5.0) => Array.from({ length: n }, (_, k) => ({ dx: (k - (n - 1) / 2) * pitch, dy: 0, w: 2.2, h: 2.2, shape: 'circle', layer: 'both', holeR: 0.8 }));
const thLED = [{ dx: 0, dy: 0, w: 1.2, h: 1.2, shape: 'circle', layer: 'both', holeR: 0.35 }, { dx: 2.54, dy: 0, w: 1.2, h: 1.2, shape: 'circle', layer: 'both', holeR: 0.35 }];
const to220 = [0, 1, 2].map(k => ({ dx: k * 2.54, dy: 0, w: 1.7, h: 1.7, shape: 'circle', layer: 'both', holeR: 0.5 }));
const to92 = [0, 1, 2].map(k => ({ dx: k * 1.27, dy: 0, w: 1.1, h: 1.1, shape: 'circle', layer: 'both', holeR: 0.35 }));
const sw4 = [-1.27, 1.27].flatMap(dy => [-1.27, 1.27].map(dx => ({ dx, dy, w: 1.2, h: 1.2, shape: 'circle', layer: 'both', holeR: 0.4 })));
const usbB = [0, 1, 2, 3].map(k => ({ dx: (k - 1.5) * 2.54, dy: 0, w: 1.5, h: 2.4 })).concat([
  { dx: -7.2, dy: 0, w: 2.0, h: 2.0, shape: 'circle', layer: 'top' }, { dx: 7.2, dy: 0, w: 2.0, h: 2.0, shape: 'circle', layer: 'top' }]);
const usbA = [0, 1, 2, 3].map(k => ({ dx: (k - 1.5) * 2.54, dy: 0, w: 1.4, h: 2.2 })).concat([
  { dx: -6.4, dy: 0, w: 2.0, h: 2.0, shape: 'circle', layer: 'top' }, { dx: 6.4, dy: 0, w: 2.0, h: 2.0, shape: 'circle', layer: 'top' }]);
const miniB = [0, 1, 2, 3, 4].map(k => ({ dx: (k - 2) * 0.8, dy: 0, w: 0.4, h: 1.2 })).concat([
  { dx: -3.95, dy: 0, w: 2.0, h: 2.0, shape: 'circle', layer: 'top' }, { dx: 3.95, dy: 0, w: 2.0, h: 2.0, shape: 'circle', layer: 'top' }]);
const usbc16 = [];
for (let k = 0; k < 8; k++) { usbc16.push({ dx: (k - 3.5) * 0.8, dy: -1.75, w: 0.35, h: 1.2 }); usbc16.push({ dx: (k - 3.5) * 0.8, dy: 1.75, w: 0.35, h: 1.2 }); }
const relay5 = [{ dx: -3.0, dy: -6.0, w: 1.5, h: 1.5, shape: 'circle', layer: 'both', holeR: 0.45 },
  { dx: 3.0, dy: -6.0, w: 1.5, h: 1.5, shape: 'circle', layer: 'both', holeR: 0.45 },
  { dx: -4.0, dy: 6.0, w: 1.5, h: 1.5, shape: 'circle', layer: 'both', holeR: 0.45 },
  { dx: 0, dy: 6.0, w: 1.5, h: 1.5, shape: 'circle', layer: 'both', holeR: 0.45 },
  { dx: 4.0, dy: 6.0, w: 1.5, h: 1.5, shape: 'circle', layer: 'both', holeR: 0.45 }];
const coinCell = [{ dx: 0, dy: -10, w: 2.4, h: 2.4, shape: 'circle', layer: 'both', holeR: 0.9 },
  { dx: 0, dy: 10, w: 2.4, h: 2.4, shape: 'circle', layer: 'both', holeR: 0.9 }];

// ============ 简单档 ============

// N33: 红外遥控检测笔
{
  const nets = ['v5', 'gnd', 'ir', 'led_a', 'drv'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('N33 红外遥控检测笔', { width: 30, height: 15, nets });
  c.place('U1', hd(3), 8, 7.5, ['gnd', 'v5', 'ir'], { x: 8, y: 7.5, rot: 90, layer: 'top', value: 'TSOP1838', footprint: 'HDR-3P' });
  c.place('Q1', to92, 16, 7.5, ['drv', 'gnd', 'led_a'], { x: 17.27, y: 7.5, rot: 0, layer: 'top', value: 'S8050', footprint: 'TO-92' });
  c.place('LED1', thLED, 22, 5, ['drv', 'led_a'], { x: 23.27, y: 5, rot: 0, layer: 'top', value: 'LED', footprint: 'LED-THT' });
  c.place('R1', fp603, 12, 10, ['ir', 'drv'], { x: 12, y: 10, rot: 0, layer: 'top', value: '10k', footprint: 'R0603' });
  c.place('R2', fp603, 18, 12, ['v5', 'led_a'], { x: 18, y: 12, rot: 0, layer: 'top', value: '470R', footprint: 'R0603' });
  c.place('J1', hd(2), 4, 12, ['v5', 'gnd'], { x: 4, y: 12, rot: 90, layer: 'top', value: '5V', footprint: 'HDR-2P' });
  c.save('n33-ir-tester');
}

// N34: USB 分线板
{
  const nets = ['vbus', 'gnd', 'dp', 'dm', 'sh'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('N34 USB 分线板', { width: 55, height: 25, nets });
  usbB.forEach((f, i) => c.add('J1', i + 1, ['vbus', 'dm', 'dp', 'gnd', 'sh', 'sh'][i], 10 + f.dx, 12.5 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.J1 = { x: 10, y: 12.5, rot: 0, layer: 'top', value: 'USB-B-F', footprint: 'USB-B' };
  c.place('F1', fp1206, 22, 12.5, ['vbus', 'vbus'], { x: 22, y: 12.5, rot: 0, layer: 'top', value: '500mA', footprint: 'F1812' });
  usbA.forEach((f, i) => c.add('J2', i + 1, ['vbus', 'dm', 'dp', 'gnd', 'sh', 'sh'][i], 34 + f.dx, 7.5 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.J2 = { x: 34, y: 7.5, rot: 0, layer: 'top', value: 'USB-A-F', footprint: 'USB-A' };
  usbA.forEach((f, i) => c.add('J3', i + 1, ['vbus', 'dm', 'dp', 'gnd', 'sh', 'sh'][i], 34 + f.dx, 18.5 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.J3 = { x: 34, y: 18.5, rot: 0, layer: 'top', value: 'USB-A-F', footprint: 'USB-A' };
  c.save('n34-usb-splitter');
}

// N35: 74HC04 皮尔斯晶振缓冲板
{
  const nets = ['vcc', 'gnd', 'xo', 'xi', 'clk'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('N35 晶振缓冲板', { width: 35, height: 22, nets });
  const so14 = mk('SOIC-14');
  const u1n = ['xo', 'xi', 'clk', 'xo', null, null, 'gnd', null, null, null, null, null, null, 'vcc'];
  so14.forEach((f, i) => c.add('U1', i + 1, u1n[i], 12 + f.dx, 8 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U1 = { x: 12, y: 8, rot: 0, layer: 'top', value: '74HC04', footprint: 'SOIC-14' };
  c.add('Y1', 1, 'xo', 24, 8, 1.7, 1.7, 'circle', 'both', 0.45);
  c.add('Y1', 2, 'xi', 28.9, 8, 1.7, 1.7, 'circle', 'both', 0.45);
  c.compsMeta.Y1 = { x: 26.45, y: 8, rot: 0, layer: 'top', value: '8MHz', footprint: 'HC-49S' };
  c.place('C1', fp603, 24, 12, ['xo', 'gnd'], { x: 24, y: 12, rot: 0, layer: 'top', value: '20pF', footprint: 'C0603' });
  c.place('C2', fp603, 28.9, 12, ['xi', 'gnd'], { x: 28.9, y: 12, rot: 0, layer: 'top', value: '20pF', footprint: 'C0603' });
  c.place('R1', fp603, 18, 14, ['xo', 'xi'], { x: 18, y: 14, rot: 0, layer: 'top', value: '1M', footprint: 'R0603' });
  c.place('J1', hd(4), 6, 16, ['vcc', 'gnd', 'clk', 'gnd'], { x: 6, y: 16, rot: 90, layer: 'top', value: 'PWR+CLK', footprint: 'HDR-4P' });
  c.save('n35-pierce-osc');
}

// N36: CD4017 六灯跑马灯
{
  const nets = ['vcc', 'gnd', 'clk', 'rst'].map(id => ({ id, name: id.toUpperCase() }));
  for (let i = 0; i < 6; i++) nets.push({ id: 'q' + i, name: 'Q' + i });
  for (let i = 0; i < 6; i++) nets.push({ id: 'led' + i, name: 'LEDR' + i });
  const c = makeDesign('N36 CD4017 跑马灯', { width: 55, height: 30, grid: 0.635, nets });
  const dip16 = mk('DIP-N', 16);
  const pinNet = ['q5', 'q1', 'q0', 'q2', null, null, 'q3', 'gnd', null, 'q4', null, null, 'gnd', 'clk', 'rst', 'vcc'];  // CD4017: Q0=3 Q1=2 Q2=4 Q3=7 Q4=10 Q5=1
  dip16.forEach((f, i) => c.add('U1', i + 1, pinNet[i], 12 + f.dx, 15 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.U1 = { x: 12, y: 15, rot: 0, layer: 'top', value: 'CD4017', footprint: 'DIP-16' };
  for (let i = 0; i < 6; i++) {
    const x = 26 + i * 4.4;
    c.place('LED' + (i + 1), thLED, x, 8, ['q' + i, 'led' + i], { x: x + 1.27, y: 8, rot: 0, layer: 'top', value: 'LED', footprint: 'LED-THT' });
    c.place('R' + (i + 1), fp603, x + 1.27, 12, ['led' + i, 'gnd'], { x: x + 1.27, y: 12, rot: 0, layer: 'top', value: '470R', footprint: 'R0603' });
  }
  c.place('J1', hd(2), 4, 26, ['vcc', 'gnd'], { x: 4, y: 26, rot: 90, layer: 'top', value: '5V', footprint: 'HDR-2P' });
  c.place('J2', hd(3), 4, 8, ['clk', 'rst', 'gnd'], { x: 4, y: 8, rot: 90, layer: 'top', value: 'CLK', footprint: 'HDR-3P' });
  c.save('n36-cd4017-chaser');
}

// N37: LM393 光控开关
{
  const nets = ['vcc', 'gnd', 'ldr', 'ref', 'cmp', 'led_a', 'drv'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('N37 LM393 光控开关', { width: 35, height: 20, nets });
  const so8 = mk('SOIC-8');
  const u1n = ['cmp', 'ref', 'ldr', 'gnd', null, null, null, 'vcc'];
  so8.forEach((f, i) => c.add('U1', i + 1, u1n[i], 14 + f.dx, 8 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U1 = { x: 14, y: 8, rot: 0, layer: 'top', value: 'LM393', footprint: 'SOIC-8' };
  c.place('LDR1', fp805, 6, 6, ['ldr', 'vcc'], { x: 6, y: 6, rot: 0, layer: 'top', value: 'GL5528', footprint: 'LDR-0805' });
  c.place('R1', fp603, 6, 10, ['ldr', 'gnd'], { x: 6, y: 10, rot: 0, layer: 'top', value: '10k', footprint: 'R0603' });
  c.place('R2', fp603, 10, 14, ['ref', 'vcc'], { x: 10, y: 14, rot: 0, layer: 'top', value: '10k', footprint: 'R0603' });
  c.place('R3', fp603, 14, 14, ['ref', 'gnd'], { x: 14, y: 14, rot: 0, layer: 'top', value: '10k', footprint: 'R0603' });
  c.place('R4', fp603, 20, 12, ['cmp', 'drv'], { x: 20, y: 12, rot: 0, layer: 'top', value: '1k', footprint: 'R0603' });
  c.place('LED1', fp603, 24, 12, ['drv', 'led_a'], { x: 24, y: 12, rot: 0, layer: 'top', value: 'LED', footprint: 'C0603' });
  c.place('R5', fp603, 28, 12, ['led_a', 'gnd'], { x: 28, y: 12, rot: 0, layer: 'top', value: '470R', footprint: 'R0603' });
  c.place('J1', hd(3), 4, 17, ['vcc', 'gnd', 'cmp'], { x: 4, y: 17, rot: 90, layer: 'top', value: 'PWR/OUT', footprint: 'HDR-3P' });
  c.save('n37-lm393-photocell');
}

// ============ 中等档 ============

// N38: DS3231 RTC（宽体 SOIC-16 + 纽扣电池座大跨距）
{
  const nets = ['vcc', 'gnd', 'sda', 'scl', 'bat', 'sqw', 'k32'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('N38 DS3231 RTC 模块', { width: 40, height: 32, nets });
  // 左列 pin1-8 上→下；右列 pin16-9（下→上）
  const leftN = ['vcc', 'bat', 'sqw', null, null, 'k32', null, null];
  const rightN = [null, null, null, null, 'scl', 'sda', null, 'gnd'];  // 索引 0 = pin16
  for (let k = 0; k < 8; k++) {
    const y = 12 + (k - 3.5) * 1.27;
    c.add('U1', k + 1, leftN[k], 15 - 2.7, y, 1.5, 0.6);
    c.add('U1', 16 - k, rightN[7 - k], 15 + 2.7, y, 1.5, 0.6);
  }
  c.compsMeta.U1 = { x: 15, y: 12, rot: 0, layer: 'top', value: 'DS3231SN', footprint: 'SOIC-16W' };
  coinCell.forEach((f, i) => c.add('BT1', i + 1, ['bat', 'gnd'][i], 28 + f.dx, 14 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.BT1 = { x: 28, y: 14, rot: 0, layer: 'top', value: 'CR2032', footprint: 'COIN-20' };
  c.place('R1', fp603, 8, 8, ['sda', 'vcc'], { x: 8, y: 8, rot: 0, layer: 'top', value: '10k', footprint: 'R0603' });
  c.place('R2', fp603, 11, 8, ['scl', 'vcc'], { x: 11, y: 8, rot: 0, layer: 'top', value: '10k', footprint: 'R0603' });
  c.place('J1', hdv(7), 7, 20, ['vcc', 'gnd', 'sda', 'scl', 'sqw', 'k32', null], { x: 7, y: 20, rot: 0, layer: 'top', value: 'I2C', footprint: 'HDR-7P' });
  c.save('n38-ds3231-rtc');
}

// N39: LM3914 条形电平表
{
  const nets = ['vcc', 'gnd', 'sig', 'ref'].map(id => ({ id, name: id.toUpperCase() }));
  for (let i = 1; i <= 10; i++) nets.push({ id: 'bar' + i, name: 'BAR' + i });
  for (let i = 1; i <= 10; i++) nets.push({ id: 'led' + i, name: 'LEDA' + i });
  const c = makeDesign('N39 LM3914 条形电平表', { width: 60, height: 26, nets });
  const dip18 = mk('DIP-N', 18);
  const pinNet = ['bar1', 'ref', 'gnd', 'gnd', 'sig', 'sig', null, null, 'gnd', 'bar10', 'bar9', 'bar8', 'bar7', 'bar6', 'bar5', 'bar4', 'bar3', 'bar2'];
  dip18.forEach((f, i) => c.add('U1', i + 1, pinNet[i], 10 + f.dx, 12 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.U1 = { x: 10, y: 12, rot: 0, layer: 'top', value: 'LM3914', footprint: 'DIP-18' };
  for (let i = 0; i < 10; i++) {
    const x = 30 + i * 2.6;
    c.place('LED' + (i + 1), fp603, x, 7, ['bar' + (i + 1), 'led' + (i + 1)], { x, y: 7, rot: 0, layer: 'top', value: 'LED', footprint: 'C0603' });
    c.place('R' + (i + 1), fp603, x, 15, ['led' + (i + 1), 'vcc'], { x, y: 15, rot: 0, layer: 'top', value: '1k', footprint: 'R0603' });
  }
  c.place('J1', hd(4), 5, 25, ['vcc', 'gnd', 'sig', 'ref'], { x: 5, y: 25, rot: 90, layer: 'top', value: 'IN', footprint: 'HDR-4P' });
  c.save('n39-lm3914-bar');
}

// N40: 红外遥控自锁开关
{
  const nets = ['v5', 'gnd', 'ir', 'clk', 'q', 'qn', 'set', 'drv', 'led_a'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('N40 红外自锁开关', { width: 45, height: 28, nets });
  c.place('U1', hd(3), 7, 8, ['gnd', 'v5', 'ir'], { x: 7, y: 8, rot: 90, layer: 'top', value: 'TSOP1838', footprint: 'HDR-3P' });
  const dip14 = mk('DIP-N', 14);
  const pinNet = ['q', 'qn', 'clk', 'gnd', 'qn', 'set', 'gnd', null, null, null, 'q', 'qn', null, 'v5'];
  dip14.forEach((f, i) => c.add('U2', i + 1, pinNet[i], 15 + f.dx, 12 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.U2 = { x: 15, y: 12, rot: 0, layer: 'top', value: 'CD4013', footprint: 'DIP-14' };
  c.place('Q1', to92, 28, 8, ['drv', 'gnd', 'led_a'], { x: 29.27, y: 8, rot: 0, layer: 'top', value: 'S8050', footprint: 'TO-92' });
  c.place('LED1', thLED, 34, 6, ['drv', 'led_a'], { x: 35.27, y: 6, rot: 0, layer: 'top', value: 'LED', footprint: 'LED-THT' });
  c.place('R1', fp603, 11, 8, ['ir', 'clk'], { x: 11, y: 8, rot: 0, layer: 'top', value: '10k', footprint: 'R0603' });
  c.place('R2', fp603, 26, 12, ['q', 'drv'], { x: 26, y: 12, rot: 0, layer: 'top', value: '1k', footprint: 'R0603' });
  c.place('R3', fp603, 31, 12, ['v5', 'led_a'], { x: 31, y: 12, rot: 0, layer: 'top', value: '470R', footprint: 'R0603' });
  c.place('SW1', sw4, 24, 18, ['clk', 'clk', 'gnd', 'gnd'], { x: 24, y: 18, rot: 0, layer: 'top', value: 'MANUAL', footprint: 'SW-4P' });
  c.place('SW2', sw4, 31, 18, ['set', 'set', 'gnd', 'gnd'], { x: 31, y: 18, rot: 0, layer: 'top', value: 'RESET', footprint: 'SW-4P' });
  c.place('J1', hd(3), 4, 22, ['v5', 'gnd', 'q'], { x: 4, y: 22, rot: 90, layer: 'top', value: 'PWR/OUT', footprint: 'HDR-3P' });
  c.save('n40-cd4013-ir-latch');
}

// N41: LM317+LM337 正负可调电源
{
  const nets = ['vp_in', 'vn_in', 'gnd', 'vp_out', 'vn_out', 'vp_adj', 'vn_adj'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('N41 正负可调电源', { width: 55, height: 32, nets });
  to220.forEach((f, i) => c.add('U1', i + 1, ['vp_adj', 'vp_out', 'vp_in'][i], 14 + f.dx, 10 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.U1 = { x: 15.04, y: 10, rot: 0, layer: 'top', value: 'LM317', footprint: 'TO-220' };
  to220.forEach((f, i) => c.add('U2', i + 1, ['vn_adj', 'vn_in', 'vn_out'][i], 14 + f.dx, 22 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.U2 = { x: 15.04, y: 22, rot: 0, layer: 'top', value: 'LM337', footprint: 'TO-220' };
  c.place('RV1', hd(3), 26, 8, ['vp_out', 'vp_adj', 'gnd'], { x: 26, y: 8, rot: 90, layer: 'top', value: '10k', footprint: 'POT-3P' });
  c.place('RV2', hd(3), 26, 24, ['vn_out', 'vn_adj', 'gnd'], { x: 26, y: 24, rot: 90, layer: 'top', value: '10k', footprint: 'POT-3P' });
  c.place('C1', fp603, 8, 8, ['vp_in', 'gnd'], { x: 8, y: 8, rot: 0, layer: 'top', value: '100n', footprint: 'C0603' });
  c.place('C2', fp603, 8, 24, ['vn_in', 'gnd'], { x: 8, y: 24, rot: 0, layer: 'top', value: '100n', footprint: 'C0603' });
  c.place('C3', fp603, 34, 8, ['vp_out', 'gnd'], { x: 34, y: 8, rot: 0, layer: 'top', value: '10u', footprint: 'C0603' });
  c.place('C4', fp603, 34, 24, ['vn_out', 'gnd'], { x: 34, y: 24, rot: 0, layer: 'top', value: '10u', footprint: 'C0603' });
  c.place('J1', term(3), 6, 16, ['vp_in', 'gnd', 'vn_in'], { x: 6, y: 16, rot: 90, layer: 'top', value: 'DC-IN', footprint: 'TERM-3P' });
  c.place('J2', term(4), 46, 16, ['vp_out', 'gnd', 'vn_out', 'gnd'], { x: 46, y: 16, rot: 90, layer: 'top', value: 'RAIL-OUT', footprint: 'TERM-4P' });
  c.save('n41-lm317-337');
}

// N42: 74HC165 ×2 级联并入串出
{
  const nets = ['vcc', 'gnd', 'clk', 'ld', 'qh'].map(id => ({ id, name: id.toUpperCase() }));
  for (let i = 0; i < 8; i++) nets.push({ id: 'p' + i, name: 'P' + i });
  const c = makeDesign('N42 74HC165 级联', { width: 55, height: 26, nets });
  const so16 = mk('SOIC-16');
  const mk165 = (comp, y, serNet) => {
    const pin = ['ld', 'clk', 'p4', 'p5', 'p6', 'p7', null, 'gnd', serNet, null, 'p0', 'p1', 'p2', 'p3', 'gnd', 'vcc'];
    so16.forEach((f, i) => c.add(comp, i + 1, pin[i], 15 + f.dx, y + f.dy, f.w, f.h, f.shape, f.layer));
    c.compsMeta[comp] = { x: 15, y, rot: 0, layer: 'top', value: '74HC165', footprint: 'SOIC-16' };
  };
  mk165('U1', 10, 'qh');
  mk165('U2', 20, null);
  c.pads.find(p => p.id === 'U2-13').netId = 'qh';   // 第二级 SER 接第一级 QH
  const dip8 = mk('DIP-N', 8);
  const mkSw = (comp, y) => {
    const pin = ['p0', 'p1', 'p2', 'p3', 'p7', 'p6', 'p5', 'p4'];
    dip8.forEach((f, i) => c.add(comp, i + 1, pin[i], 32 + f.dx, y + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
    c.compsMeta[comp] = { x: 32, y, rot: 0, layer: 'top', value: 'DIP-SW8', footprint: 'DIP-8-SW' };
  };
  mkSw('SW1', 10); mkSw('SW2', 20);
  for (let k = 0; k < 8; k++)
    c.place('R' + (k + 1), fp603, k < 4 ? 44 : 48, 6 + (k % 4) * 2.4, ['p' + k, 'vcc'], { x: k < 4 ? 44 : 48, y: 6 + (k % 4) * 2.4, rot: 0, layer: 'top', value: '10k', footprint: 'R0603' });
  c.place('J1', hd(6), 5, 17, ['vcc', 'gnd', 'clk', 'ld', 'qh', 'gnd'], { x: 5, y: 17, rot: 90, layer: 'top', value: 'MCU', footprint: 'HDR-6P' });
  c.save('n42-74hc165-cascade');
}

// ============ 困难档 ============

// N43: FT232RL USB-TTL（SSOP-28 0.65mm）
{
  const nets = ['vcc', 'gnd', 'v3', 'dp', 'dm', 'vbus', 'tx', 'rx', 'rts', 'cts', 'txled', 'rxled', 'txled_r', 'rxled_r']
    .map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('N43 FT232RL USB-TTL', { width: 50, height: 26, grid: 0.325, trackW: 0.2, clearance: 0.1, viaOuter: 0.6, viaDrill: 0.3, nets });
  const u1n = ['gnd', 'cts', null, null, 'tx', 'rx', 'v3', null, null, null, 'rts', 'gnd', 'txled', 'rxled',
               null, null, 'v3', null, null, 'vcc', 'gnd', 'dp', 'dm', null, null, 'gnd', null, 'gnd'];
  SSOP28.forEach((f, i) => c.add('U1', i + 1, u1n[i], 22 + f.dx, 13 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U1 = { x: 22, y: 13, rot: 0, layer: 'top', value: 'FT232RL', footprint: 'SSOP-28' };
  usbB.forEach((f, i) => c.add('J1', i + 1, ['vbus', 'dm', 'dp', 'gnd', 'gnd', 'gnd'][i], 8 + f.dx, 13 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.J1 = { x: 8, y: 13, rot: 0, layer: 'top', value: 'USB-B', footprint: 'USB-B' };
  c.place('LED1', fp603, 34, 6, ['txled', 'txled_r'], { x: 34, y: 6, rot: 0, layer: 'top', value: 'TX', footprint: 'C0603' });
  c.place('R1', fp603, 38, 6, ['txled_r', 'vcc'], { x: 38, y: 6, rot: 0, layer: 'top', value: '1k', footprint: 'R0603' });
  c.place('LED2', fp603, 34, 20, ['rxled', 'rxled_r'], { x: 34, y: 20, rot: 0, layer: 'top', value: 'RX', footprint: 'C0603' });
  c.place('R2', fp603, 38, 20, ['rxled_r', 'vcc'], { x: 38, y: 20, rot: 0, layer: 'top', value: '1k', footprint: 'R0603' });
  c.place('C1', fp402, 22, 5, ['vcc', 'gnd'], { x: 22, y: 5, rot: 0, layer: 'top', value: '100n', footprint: 'C0402' });
  c.place('C2', fp402, 25, 5, ['v3', 'gnd'], { x: 25, y: 5, rot: 0, layer: 'top', value: '100n', footprint: 'C0402' });
  c.place('C3', fp402, 12, 5, ['vbus', 'gnd'], { x: 12, y: 5, rot: 0, layer: 'top', value: '100n', footprint: 'C0402' });
  c.place('J2', hd(6), 42, 13, ['vcc', 'gnd', 'tx', 'rx', 'rts', 'cts'], { x: 42, y: 13, rot: 90, layer: 'top', value: 'TTL', footprint: 'HDR-6P' });
  c.save('n43-ft232rl');
}

// N44: TB6612FNG 双电机驱动（SSOP-24 0.65mm）
{
  const base = ['vm', 'vcc', 'gnd', 'pwma', 'pwmb', 'stby', 'ao1', 'ao2', 'bo1', 'bo2'];
  const nets = base.map(id => ({ id, name: id.toUpperCase() }));
  for (const s of ['a', 'b']) for (let i = 0; i < 2; i++) nets.push({ id: s + 'in' + i, name: s.toUpperCase() + 'IN' + i });
  const c = makeDesign('N44 TB6612 双电机驱动', { width: 45, height: 24, grid: 0.325, trackW: 0.2, clearance: 0.1, viaOuter: 0.6, viaDrill: 0.3, nets });
  const u1n = ['gnd', 'ao1', 'ao1', 'ao2', 'ao2', 'gnd', 'stby', 'ain1', 'ain0', 'pwma', null, 'gnd',
               'gnd', null, 'pwmb', 'bin0', 'bin1', 'gnd', 'bo1', 'bo1', 'bo2', 'bo2', 'vm', 'vm'];
  SSOP24.forEach((f, i) => c.add('U1', i + 1, u1n[i], 16 + f.dx, 12 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U1 = { x: 16, y: 12, rot: 0, layer: 'top', value: 'TB6612FNG', footprint: 'SSOP-24' };
  c.place('J1', term(2), 4, 7, ['ao1', 'ao2'], { x: 4, y: 7, rot: 90, layer: 'top', value: 'MOTOR-A', footprint: 'TERM-2P' });
  c.place('J2', term(2), 4, 17, ['bo1', 'bo2'], { x: 4, y: 17, rot: 90, layer: 'top', value: 'MOTOR-B', footprint: 'TERM-2P' });
  c.place('J3', term(3), 38, 12, ['vm', 'gnd', 'vm'], { x: 38, y: 12, rot: 90, layer: 'top', value: 'PWR', footprint: 'TERM-3P' });
  const hd2x = [];
  for (let k = 0; k < 4; k++) for (const dy of [-1.27, 1.27]) hd2x.push({ dx: (k - 1.5) * 2.54, dy, w: 1.7, h: 1.7, shape: 'circle', layer: 'both', holeR: 0.45 });
  const ctrlNet = ['pwma', 'ain0', 'ain1', 'stby', 'pwmb', 'bin0', 'bin1', 'vcc'];
  hd2x.forEach((f, i) => c.add('J4', i + 1, ctrlNet[i], 26 + f.dx, 5 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.J4 = { x: 26, y: 5, rot: 0, layer: 'top', value: 'CTRL', footprint: 'HDR-2x4P' };
  c.place('C1', fp402, 16, 18, ['vm', 'gnd'], { x: 16, y: 18, rot: 0, layer: 'top', value: '100n', footprint: 'C0402' });
  c.place('C2', fp402, 20, 18, ['vcc', 'gnd'], { x: 20, y: 18, rot: 0, layer: 'top', value: '100n', footprint: 'C0402' });
  c.save('n44-tb6612');
}

// N45: ATmega32A TQFP44 最小系统
{
  const base = ['vcc', 'gnd', 'xo', 'xi', 'rst', 'rx', 'tx'];
  const nets = base.map(id => ({ id, name: id.toUpperCase() }));
  for (let i = 0; i < 8; i++) nets.push({ id: 'pa' + i, name: 'PA' + i });
  for (let i = 0; i < 8; i++) nets.push({ id: 'pb' + i, name: 'PB' + i });
  for (let i = 0; i < 8; i++) nets.push({ id: 'pc' + i, name: 'PC' + i });
  const c = makeDesign('N45 ATmega32 TQFP44', { width: 45, height: 30, grid: 0.25, trackW: 0.2, clearance: 0.1, viaOuter: 0.6, viaDrill: 0.3, nets });
  const pinNet = {};
  [44, 24, 18, 6, 28, 38].forEach(p => pinNet[p] = 'vcc');
  [20, 10, 30, 40, 8].forEach(p => pinNet[p] = 'gnd');
  pinNet[12] = 'xo'; pinNet[13] = 'xi'; pinNet[9] = 'rst'; pinNet[16] = 'rx'; pinNet[17] = 'tx';
  const paPins = [34, 35, 36, 37, 39, 42, 43, 22], pbPins = [1, 2, 3, 4, 5, 7, 14, 15], pcPins = [19, 23, 25, 26, 27, 29, 31, 32];
  paPins.forEach((p, i) => pinNet[p] = 'pa' + i);
  pbPins.forEach((p, i) => pinNet[p] = 'pb' + i);
  pcPins.forEach((p, i) => pinNet[p] = 'pc' + i);
  TQFP44.forEach((f, i) => c.add('U1', i + 1, pinNet[i + 1] || null, 20 + f.dx, 15 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U1 = { x: 20, y: 15, rot: 0, layer: 'top', value: 'ATmega32A', footprint: 'TQFP-44' };
  c.add('Y1', 1, 'xo', 30, 10, 1.7, 1.7, 'circle', 'both', 0.45);
  c.add('Y1', 2, 'xi', 34.9, 10, 1.7, 1.7, 'circle', 'both', 0.45);
  c.compsMeta.Y1 = { x: 32.45, y: 10, rot: 0, layer: 'top', value: '16MHz', footprint: 'HC-49S' };
  c.place('C1', fp603, 30, 14, ['xo', 'gnd'], { x: 30, y: 14, rot: 0, layer: 'top', value: '22p', footprint: 'C0603' });
  c.place('C2', fp603, 34.9, 14, ['xi', 'gnd'], { x: 34.9, y: 14, rot: 0, layer: 'top', value: '22p', footprint: 'C0603' });
  const hd2x5 = [];
  for (let k = 0; k < 5; k++) for (const dy of [-1.27, 1.27]) hd2x5.push({ dx: (k - 2) * 2.54, dy, w: 1.7, h: 1.7, shape: 'circle', layer: 'both', holeR: 0.45 });
  // ATmega32 JTAG：PC2=TCK PC3=TMS PC4=TDO PC5=TDI
  const jtagN = ['vcc', 'gnd', 'pc5', 'pc3', 'pc2', 'gnd', 'pc4', 'gnd', 'gnd', 'gnd'];
  hd2x5.forEach((f, i) => c.add('J1', i + 1, jtagN[i], 34 + f.dx, 24 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.J1 = { x: 34, y: 24, rot: 0, layer: 'top', value: 'JTAG', footprint: 'HDR-2x5P' };
  c.place('J2', hd(6), 7, 25, ['vcc', 'gnd', 'pb5', 'pb7', 'rst', 'pb6'], { x: 7, y: 25, rot: 90, layer: 'top', value: 'ISP', footprint: 'HDR-6P' });
  for (let i = 0; i < 8; i++) c.add('J3', i + 1, 'pa' + i, 8, 4 + i * 2.2, 1.7, 1.7, 'circle', 'both', 0.45);
  c.compsMeta.J3 = { x: 8, y: 11.7, rot: 0, layer: 'top', value: 'PORTA', footprint: 'HDR-8P' };
  for (let i = 0; i < 8; i++) c.add('J4', i + 1, 'pb' + i, 40, 6 + i * 2.2, 1.7, 1.7, 'circle', 'both', 0.45);
  c.compsMeta.J4 = { x: 40, y: 13.7, rot: 0, layer: 'top', value: 'PORTB', footprint: 'HDR-8P' };
  // UART + 剩余 PC 引脚出线（避免单脚网）
  c.place('J5', hd(3), 4, 16, ['rx', 'tx', 'gnd'], { x: 4, y: 16, rot: 90, layer: 'top', value: 'UART', footprint: 'HDR-3P' });
  for (let i = 0; i < 4; i++) c.add('J6', i + 1, ['pc0', 'pc1', 'pc6', 'pc7'][i], 44, 6 + i * 2.2, 1.7, 1.7, 'circle', 'both', 0.45);
  c.compsMeta.J6 = { x: 44, y: 9.3, rot: 0, layer: 'top', value: 'PORTC', footprint: 'HDR-4P' };
  c.place('C3', fp402, 12, 8, ['vcc', 'gnd'], { x: 12, y: 8, rot: 0, layer: 'top', value: '100n', footprint: 'C0402' });
  c.place('C4', fp402, 26, 6, ['vcc', 'gnd'], { x: 26, y: 6, rot: 0, layer: 'top', value: '100n', footprint: 'C0402' });
  c.place('R1', fp603, 10, 20, ['vcc', 'rst'], { x: 10, y: 20, rot: 0, layer: 'top', value: '10k', footprint: 'R0603' });
  c.place('C5', fp603, 14, 24, ['rst', 'gnd'], { x: 14, y: 24, rot: 0, layer: 'top', value: '100n', footprint: 'C0603' });
  c.save('n45-atmega32-tqfp44');
}

// N46: 可编程增益通道（LM324 + CD4051 ×2：衰减器 + 反馈选择）
{
  const base = ['vcc', 'gnd', 'in', 'out', 's0', 's1', 's2', 'fb_bus', 'in_sel'];
  const nets = base.map(id => ({ id, name: id.toUpperCase() }));
  for (let k = 0; k < 4; k++) nets.push({ id: 'fb' + k, name: 'FB' + k });
  for (let k = 0; k < 4; k++) nets.push({ id: 'att' + k, name: 'ATT' + k });
  const c = makeDesign('N46 可编程增益四运放', { width: 50, height: 26, grid: 0.325, trackW: 0.2, clearance: 0.1, viaOuter: 0.6, viaDrill: 0.3, nets });
  const so14 = mk('SOIC-14');
  const u1n = ['out', 'fb_bus', 'in_sel', 'vcc', null, null, null, null, null, null, 'gnd', null, null, null];
  so14.forEach((f, i) => c.add('U1', i + 1, u1n[i], 14 + f.dx, 10 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U1 = { x: 14, y: 10, rot: 0, layer: 'top', value: 'LM324', footprint: 'SOIC-14' };
  const so16 = mk('SOIC-16');
  // CD4051（只用 4 通道）：pin12,13,14,15 = ch0..3? 简化：pin13/14/15/12 → ch0/1/2/3
  const c4051 = (comp, x, y, comNet, chBase) => {
    const pin = [chBase + '3', null, comNet, 'gnd', chBase + '2', 'gnd', 'gnd', 'gnd', 's0', 's1', 's2', 'gnd', chBase + '0', chBase + '1', 'gnd', 'vcc'];
    so16.forEach((f, i) => c.add(comp, i + 1, pin[i], x + f.dx, y + f.dy, f.w, f.h, f.shape, f.layer));
    c.compsMeta[comp] = { x, y, rot: 0, layer: 'top', value: 'CD4051', footprint: 'SOIC-16' };
  };
  c4051('U2', 32, 8, 'fb_bus', 'fb');
  c4051('U3', 32, 19, 'in_sel', 'att');
  for (let k = 0; k < 4; k++)
    c.place('R' + (k + 1), fp603, 44, 4 + k * 2.2, ['out', 'fb' + k], { x: 44, y: 4 + k * 2.2, rot: 0, layer: 'top', value: 'GAIN', footprint: 'R0603' });
  for (let k = 0; k < 4; k++)
    c.place('R' + (k + 5), fp603, 8, 4 + k * 2.2, ['in', 'att' + k], { x: 8, y: 4 + k * 2.2, rot: 0, layer: 'top', value: 'ATT', footprint: 'R0603' });
  c.place('J1', hd(2), 5, 18, ['in', 'gnd'], { x: 5, y: 18, rot: 90, layer: 'top', value: 'IN', footprint: 'HDR-2P' });
  c.place('J2', hd(2), 46, 22, ['out', 'gnd'], { x: 46, y: 22, rot: 90, layer: 'top', value: 'OUT', footprint: 'HDR-2P' });
  c.place('J3', hd(5), 20, 24, ['s0', 's1', 's2', 'vcc', 'gnd'], { x: 20, y: 24, rot: 90, layer: 'top', value: 'SEL', footprint: 'HDR-5P' });
  c.save('n46-quad-opamp-pga');
}

// N47: ATtiny85 V-USB（SOIC-8 + MiniUSB 差分 + 稳压二极管）
{
  const nets = ['vbus', 'gnd', 'dp', 'dm', 'pb3', 'pb4', 'pull'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('N47 ATtiny85 V-USB', { width: 32, height: 20, grid: 0.3175, trackW: 0.3, clearance: 0.15, viaOuter: 0.7, viaDrill: 0.35, nets });
  const so8 = mk('SOIC-8');
  const u1n = ['pull', 'pb3', 'pb4', 'gnd', null, null, null, 'vbus'];
  so8.forEach((f, i) => c.add('U1', i + 1, u1n[i], 14 + f.dx, 10 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U1 = { x: 14, y: 10, rot: 0, layer: 'top', value: 'ATtiny85', footprint: 'SOIC-8' };
  miniB.forEach((f, i) => c.add('J1', i + 1, ['vbus', 'dm', 'dp', null, 'gnd', 'gnd', 'gnd'][i], 5 + f.dx, 10 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.J1 = { x: 5, y: 10, rot: 0, layer: 'top', value: 'USB-MiniB', footprint: 'USB-MINI-B' };
  c.place('D1', fp603, 20, 16, ['dm', 'gnd'], { x: 20, y: 16, rot: 0, layer: 'top', value: '3.6V', footprint: 'C0603' });
  c.place('D2', fp603, 24, 16, ['dp', 'gnd'], { x: 24, y: 16, rot: 0, layer: 'top', value: '3.6V', footprint: 'C0603' });
  c.place('R1', fp603, 20, 5, ['pb3', 'dm'], { x: 20, y: 5, rot: 0, layer: 'top', value: '68R', footprint: 'R0603' });
  c.place('R2', fp603, 24, 5, ['pb4', 'dp'], { x: 24, y: 5, rot: 0, layer: 'top', value: '68R', footprint: 'R0603' });
  c.place('R3', fp603, 28, 10, ['dp', 'pull'], { x: 28, y: 10, rot: 0, layer: 'top', value: '1.5k', footprint: 'R0603' });
  c.place('C1', fp402, 9, 16, ['vbus', 'gnd'], { x: 9, y: 16, rot: 0, layer: 'top', value: '100n', footprint: 'C0402' });
  c.save('n47-attiny85-vusb');
}

// ============ 超难档 ============

// N48: ATmega32U4 QFN32（0.5mm + 中央散热盘 + USB 差分 + 晶振）
{
  const base = ['vcc', 'gnd', 'dp', 'dm', 'vbus', 'xo', 'xi', 'rst', 'hwbe'];
  const nets = base.map(id => ({ id, name: id.toUpperCase() }));
  for (let i = 0; i < 6; i++) nets.push({ id: 'pb' + i, name: 'PB' + i });
  for (let i = 0; i < 6; i++) nets.push({ id: 'pd' + i, name: 'PD' + i });
  const c = makeDesign('N48 ATmega32U4 QFN32', { width: 40, height: 26, grid: 0.25, trackW: 0.15, clearance: 0.1, viaOuter: 0.5, viaDrill: 0.25, nets });
  const u1n = ['xi', 'xo', 'gnd', 'vcc', 'gnd', 'vcc', 'rst', 'gnd',
               'dp', 'dm', null, 'pb0', 'pb1', 'pb2', 'pb3', 'pb4',
               'pb5', 'pd0', 'pd1', 'pd2', 'pd3', 'pd4', 'pd5', 'gnd',
               'vcc', 'hwbe', null, null, null, null, null, 'gnd'];
  QFN32.forEach((f, i) => c.add('U1', i + 1, u1n[i], 26 + f.dx, 13 + f.dy, f.w, f.h, f.shape, f.layer));
  c.add('U1', 33, 'gnd', 26, 13, 3.2, 3.2);
  c.compsMeta.U1 = { x: 26, y: 13, rot: 0, layer: 'top', value: 'ATmega32U4', footprint: 'QFN-32' };
  usbB.forEach((f, i) => c.add('J1', i + 1, ['vbus', 'dm', 'dp', 'gnd', 'gnd', 'gnd'][i], 9 + f.dx, 13 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.J1 = { x: 9, y: 13, rot: 0, layer: 'top', value: 'USB-B', footprint: 'USB-B' };
  c.add('Y1', 1, 'xo', 32, 8, 1.7, 1.7, 'circle', 'both', 0.45);
  c.add('Y1', 2, 'xi', 36.9, 8, 1.7, 1.7, 'circle', 'both', 0.45);
  c.compsMeta.Y1 = { x: 34.45, y: 8, rot: 0, layer: 'top', value: '16MHz', footprint: 'HC-49S' };
  c.place('C1', fp402, 32, 12, ['xo', 'gnd'], { x: 32, y: 12, rot: 0, layer: 'top', value: '22p', footprint: 'C0402' });
  c.place('C2', fp402, 36.9, 12, ['xi', 'gnd'], { x: 36.9, y: 12, rot: 0, layer: 'top', value: '22p', footprint: 'C0402' });
  c.place('C3', fp402, 24, 20, ['vcc', 'gnd'], { x: 24, y: 20, rot: 0, layer: 'top', value: '1u', footprint: 'C0402' });
  c.place('C4', fp402, 28, 20, ['vcc', 'gnd'], { x: 28, y: 20, rot: 0, layer: 'top', value: '100n', footprint: 'C0402' });
  c.place('R3', fp402, 32, 17, ['hwbe', 'gnd'], { x: 32, y: 17, rot: 0, layer: 'top', value: '10k', footprint: 'R0402' });
  c.place('R4', fp402, 16, 17, ['rst', 'vcc'], { x: 16, y: 17, rot: 0, layer: 'top', value: '10k', footprint: 'R0402' });
  c.place('C5', fp402, 12, 20, ['vbus', 'gnd'], { x: 12, y: 20, rot: 0, layer: 'top', value: '100n', footprint: 'C0402' });
  const pbpd = ['pb0', 'pb1', 'pb2', 'pb3', 'pb4', 'pb5', 'pd0', 'pd1', 'pd2', 'pd3', 'pd4', 'pd5'];
  pbpd.forEach((n, i) => c.add('J2', i + 1, n, 6 + i * 2.0, 22.5, 1.7, 1.7, 'circle', 'both', 0.45));
  c.compsMeta.J2 = { x: 17, y: 22.5, rot: 0, layer: 'top', value: 'IO', footprint: 'HDR-12P' };
  c.save('n48-qfn32-32u4');
}

// N49: 8 继电器矩阵（100×70 大板）
{
  const base = ['vcc', 'gnd', 'com_bus'];
  const nets = base.map(id => ({ id, name: id.toUpperCase() }));
  for (let i = 0; i < 8; i++) nets.push({ id: 'drv' + i, name: 'DRV' + i });
  for (let i = 0; i < 8; i++) nets.push({ id: 'no' + i, name: 'NO' + i });
  for (let i = 0; i < 8; i++) nets.push({ id: 'in' + i, name: 'IN' + i });
  const c = makeDesign('N49 8 继电器矩阵', { width: 100, height: 70, grid: 0.635, nets });
  for (let i = 0; i < 8; i++) {
    const x = 12 + (i % 4) * 20, y = 14 + Math.floor(i / 4) * 24;
    const rn = ['drv' + i, 'vcc', 'com_bus', 'no' + i, null];
    relay5.forEach((f, k) => c.add('K' + (i + 1), k + 1, rn[k], x + f.dx, y + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
    c.compsMeta['K' + (i + 1)] = { x, y, rot: 0, layer: 'top', value: 'SRD-05VDC', footprint: 'RELAY-SRD' };
  }
  const dip18 = mk('DIP-N', 18);
  const ulnN = ['in0', 'in1', 'in2', 'in3', 'in4', 'in5', 'in6', 'in7', 'gnd', 'com_bus', 'drv7', 'drv6', 'drv5', 'drv4', 'drv3', 'drv2', 'drv1', 'drv0'];
  dip18.forEach((f, i) => c.add('U1', i + 1, ulnN[i], 88 + f.dx, 20 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.U1 = { x: 88, y: 20, rot: 0, layer: 'top', value: 'ULN2803', footprint: 'DIP-18' };
  c.place('JIN', term(2), 4, 62, ['vcc', 'gnd'], { x: 4, y: 62, rot: 90, layer: 'top', value: 'COIL-PWR', footprint: 'TERM-2P' });
  for (let i = 0; i < 8; i++)
    c.place('J' + i, term(2), 14 + i * 10, 62, ['com_bus', 'no' + i], { x: 14 + i * 10, y: 62, rot: 90, layer: 'top', value: 'CH' + i, footprint: 'TERM-2P' });
  const ctrl10 = ['in0', 'in1', 'in2', 'in3', 'in4', 'in5', 'in6', 'in7', 'vcc', 'gnd'];
  ctrl10.forEach((n, i) => c.add('JCTL', i + 1, n, 90, 40 + i * 2.54, 1.7, 1.7, 'circle', 'both', 0.45));
  c.compsMeta.JCTL = { x: 90, y: 49.1, rot: 0, layer: 'top', value: 'CTRL', footprint: 'HDR-10P' };
  c.save('n49-relay-matrix');
}

// N50: CP2102N USB-C 桥（QFN28 0.5mm + USB-C 双差分）
{
  const nets = ['vbus', 'gnd', 'vdd', 'vreg', 'dp_c', 'dm_c', 'cc1', 'cc2', 'txd', 'rxd', 'rts', 'cts', 'dcdn']
    .map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('N50 CP2102N USB-C 桥', { width: 42, height: 26, grid: 0.25, trackW: 0.15, clearance: 0.1, viaOuter: 0.5, viaDrill: 0.25, nets });
  const u1n = ['vdd', 'gnd', 'rxd', 'txd', null, null, 'vdd',
               'rts', null, null, 'cts', 'dcdn', null, 'vreg',
               'gnd', 'vbus', 'dm_c', 'dp_c', 'gnd', 'vdd', null,
               'gnd', 'gnd', 'dm_c', 'dp_c', null, 'vdd', 'gnd'];
  QFN28.forEach((f, i) => c.add('U1', i + 1, u1n[i], 21 + f.dx, 13 + f.dy, f.w, f.h, f.shape, f.layer));
  c.add('U1', 29, 'gnd', 21, 13, 2.6, 2.6);
  c.compsMeta.U1 = { x: 21, y: 13, rot: 0, layer: 'top', value: 'CP2102N', footprint: 'QFN-28' };
  const ccPins = ['gnd', 'dm_c', 'dp_c', null, 'cc1', 'dp_c', 'dm_c', 'gnd',
                  'gnd', 'dm_c', 'dp_c', null, 'cc2', 'dp_c', 'dm_c', 'gnd'];
  usbc16.forEach((f, i) => c.add('J1', i + 1, ccPins[i], 8 + f.dx, 8 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.J1 = { x: 8, y: 8, rot: 0, layer: 'top', value: 'USB-C-16P', footprint: 'USB-C' };
  usbA.forEach((f, i) => c.add('J2', i + 1, ['vbus', 'dm_c', 'dp_c', 'gnd', 'gnd', 'gnd'][i], 8 + f.dx, 21 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.J2 = { x: 8, y: 21, rot: 0, layer: 'top', value: 'USB-A', footprint: 'USB-A' };
  c.place('R1', fp402, 15, 3, ['cc1', 'gnd'], { x: 15, y: 3, rot: 0, layer: 'top', value: '5.1k', footprint: 'R0402' });
  c.place('R2', fp402, 19, 3, ['cc2', 'gnd'], { x: 19, y: 3, rot: 0, layer: 'top', value: '5.1k', footprint: 'R0402' });
  c.place('C1', fp402, 28, 6, ['vdd', 'gnd'], { x: 28, y: 6, rot: 0, layer: 'top', value: '100n', footprint: 'C0402' });
  c.place('C2', fp402, 31, 6, ['vreg', 'gnd'], { x: 31, y: 6, rot: 0, layer: 'top', value: '4.7u', footprint: 'C0402' });
  c.place('C3', fp402, 31, 10, ['vbus', 'gnd'], { x: 31, y: 10, rot: 0, layer: 'top', value: '100n', footprint: 'C0402' });
  c.place('J3', hd(7), 30, 3, ['vdd', 'gnd', 'txd', 'rxd', 'rts', 'cts', 'dcdn'], { x: 30, y: 3, rot: 90, layer: 'top', value: 'TTL', footprint: 'HDR-7P' });
  c.save('n50-cp2102n-usbc');
}

// N51: LQFP48 + W25Q128 + 0402 密排去耦（grid 0.25 最小无源件维度）
{
  const base = ['vcc', 'gnd', 'vdd', 'rst', 'xo', 'xi'];
  const nets = base.map(id => ({ id, name: id.toUpperCase() }));
  for (let i = 0; i < 5; i++) nets.push({ id: 'spi' + i, name: 'SPI' + i });
  for (let i = 0; i < 8; i++) nets.push({ id: 'pa' + i, name: 'PA' + i });
  for (let i = 0; i < 6; i++) nets.push({ id: 'pb' + i, name: 'PB' + i });
  const c = makeDesign('N51 LQFP48+Flash+0402 密排', { width: 32, height: 24, grid: 0.25, trackW: 0.15, clearance: 0.1, viaOuter: 0.5, viaDrill: 0.25, nets });
  const u1n = ['vdd', 'vdd', 'gnd', 'gnd', 'gnd', 'gnd', 'gnd', 'gnd', 'gnd',
               'vdd', 'pa0', 'pa1', 'pa2', 'pa3', 'pa4', 'pa5', 'pa6', 'pa7',
               'gnd', 'vcc', 'pb0', 'pb1', 'pb2', 'pb3', 'pb4', 'pb5',
               'xo', 'xi', 'rst', null, null, 'vdd',
               null, null, 'spi0', 'spi1', 'spi2', 'spi3', 'spi4',
               null, null, 'gnd', 'vdd', null, null, 'gnd', 'vdd'];
  LQFP48.forEach((f, i) => c.add('U1', i + 1, u1n[i], 16 + f.dx, 12 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U1 = { x: 16, y: 12, rot: 0, layer: 'top', value: 'STM32F030', footprint: 'LQFP-48' };
  const so8 = mk('SOIC-8');
  const u2n = ['spi0', 'vdd', 'gnd', 'spi1', null, 'spi2', 'spi3', 'spi4'];
  so8.forEach((f, i) => c.add('U2', i + 1, u2n[i], 26 + f.dx, 6 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U2 = { x: 26, y: 6, rot: 0, layer: 'top', value: 'W25Q128', footprint: 'SOIC-8' };
  c.add('Y1', 1, 'xo', 22, 20, 1.7, 1.7, 'circle', 'both', 0.45);
  c.add('Y1', 2, 'xi', 26.9, 20, 1.7, 1.7, 'circle', 'both', 0.45);
  c.compsMeta.Y1 = { x: 24.45, y: 20, rot: 0, layer: 'top', value: '8MHz', footprint: 'HC-49S' };
  const dec = [[6, 4, 'vdd'], [10, 4, 'vcc'], [14, 4, 'vdd'], [20, 3, 'vdd'], [25, 3, 'vdd'], [6, 20, 'vdd'], [12, 20, 'gnd']];
  dec.forEach(([x, y, net], k) =>
    c.place('C' + (k + 1), fp402, x, y, [net, 'gnd'], { x, y, rot: 0, layer: 'top', value: '100n', footprint: 'C0402' }));
  c.place('J1', hdv(8), 4, 13, ['vcc', 'gnd', 'rst', 'spi0', 'spi1', 'spi2', 'spi3', 'spi4'], { x: 4, y: 13, rot: 0, layer: 'top', value: 'SPI', footprint: 'HDR-8P' });
  for (let i = 0; i < 8; i++) c.add('J2', i + 1, 'pa' + i, 16 + i * 2.0, 22, 1.7, 1.7, 'circle', 'both', 0.45);
  c.compsMeta.J2 = { x: 23, y: 22, rot: 0, layer: 'top', value: 'PORTA', footprint: 'HDR-8P' };
  for (let i = 0; i < 6; i++) c.add('J3', i + 1, 'pb' + i, 31, 10 + i * 2.0, 1.7, 1.7, 'circle', 'both', 0.45);
  c.compsMeta.J3 = { x: 31, y: 15, rot: 0, layer: 'top', value: 'PORTB', footprint: 'HDR-6P' };
  c.save('n51-lqfp48-0402');
}

// N52: STM32F103VC LQFP100 + TSOP-44 SRAM 16 位并行总线
{
  const base = ['vcc', 'gnd', 'noe', 'nwe', 'ne1', 'xo', 'xi', 'rst'];
  const nets = base.map(id => ({ id, name: id.toUpperCase() }));
  for (let i = 0; i < 16; i++) nets.push({ id: 'd' + i, name: 'D' + i });
  for (let i = 0; i < 16; i++) nets.push({ id: 'a' + i, name: 'A' + i });
  const c = makeDesign('N52 LQFP100+TSOP44 SRAM 总线', { width: 54, height: 36, grid: 0.25, trackW: 0.15, clearance: 0.1, viaOuter: 0.5, viaDrill: 0.25, nets });
  const pinNet = {};
  pinNet[3] = 'xo'; pinNet[4] = 'xi'; pinNet[5] = 'vcc'; pinNet[6] = 'gnd'; pinNet[25] = 'gnd';
  for (let i = 0; i < 16; i++) pinNet[8 + i] = 'd' + i;
  for (let i = 0; i < 16; i++) pinNet[26 + i] = 'a' + i;
  pinNet[42] = 'noe'; pinNet[43] = 'nwe'; pinNet[44] = 'ne1'; pinNet[45] = 'rst';
  pinNet[47] = 'vcc'; pinNet[48] = 'gnd'; pinNet[50] = 'vcc';
  pinNet[51] = 'vcc'; pinNet[52] = 'gnd'; pinNet[75] = 'gnd';
  pinNet[76] = 'vcc'; pinNet[77] = 'gnd'; pinNet[100] = 'vcc';
  LQFP100.forEach((f, i) => c.add('U1', i + 1, pinNet[i + 1] || null, 24 + f.dx, 18 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U1 = { x: 24, y: 18, rot: 0, layer: 'top', value: 'STM32F103VC', footprint: 'LQFP-100' };
  const sram = {};
  for (let i = 0; i < 16; i++) sram[i + 1] = 'a' + i;
  sram[17] = 'd0'; sram[18] = 'd1'; sram[19] = 'd2'; sram[20] = 'd3';
  sram[21] = 'gnd'; sram[22] = 'ne1';
  for (let i = 0; i < 12; i++) sram[23 + i] = 'd' + (4 + i);
  sram[35] = 'nwe'; sram[36] = 'noe';
  sram[37] = 'gnd'; sram[38] = 'vcc'; sram[39] = 'vcc'; sram[40] = 'gnd';
  sram[43] = 'vcc'; sram[44] = 'gnd';
  TSOP44.forEach((f, i) => c.add('U2', i + 1, sram[i + 1] || null, 41 + f.dx, 18 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U2 = { x: 41, y: 18, rot: 0, layer: 'top', value: 'IS62WV51216', footprint: 'TSOP-44' };
  c.add('Y1', 1, 'xo', 10, 6, 1.7, 1.7, 'circle', 'both', 0.45);
  c.add('Y1', 2, 'xi', 14.9, 6, 1.7, 1.7, 'circle', 'both', 0.45);
  c.compsMeta.Y1 = { x: 12.45, y: 6, rot: 0, layer: 'top', value: '8MHz', footprint: 'HC-49S' };
  c.add('TP1', 1, 'rst', 6, 30, 1.2, 1.2, 'circle', 'both', 0.4);
  c.compsMeta.TP1 = { x: 6, y: 30, rot: 0, layer: 'top', value: 'RST-TP', footprint: 'TP' };
  c.place('C1', fp402, 10, 10, ['xo', 'gnd'], { x: 10, y: 10, rot: 0, layer: 'top', value: '22p', footprint: 'C0402' });
  c.place('C2', fp402, 14.9, 10, ['xi', 'gnd'], { x: 14.9, y: 10, rot: 0, layer: 'top', value: '22p', footprint: 'C0402' });
  for (let k = 0; k < 4; k++) c.place('C' + (3 + k), fp402, 16 + k * 3, 30, ['vcc', 'gnd'], { x: 16 + k * 3, y: 30, rot: 0, layer: 'top', value: '100n', footprint: 'C0402' });
  for (let k = 0; k < 4; k++) c.place('C' + (7 + k), fp402, 28 + k * 3, 30, ['vcc', 'gnd'], { x: 28 + k * 3, y: 30, rot: 0, layer: 'top', value: '100n', footprint: 'C0402' });
  c.save('n52-sram-bus');
}

console.log('第五轮批量 spec 生成完成（N33-N52）');
