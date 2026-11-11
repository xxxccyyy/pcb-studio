// 第六轮批量 spec 生成：N53-N72（20 项目，4 档，全部与前五轮不同的设计维度）
// 直接从 src/engine.mjs 导入（不再从 index.html 提取）
// 自检门（第五轮 L3/L4/L5 教训）：坏引用 / 单脚网 / 同元件焊盘重叠 / 出板，任一失败退出码 1
import { designDefaults, footprintPads } from '../../src/engine.mjs';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';

const base = new URL('./', import.meta.url);
const mk = (n, count) => footprintPads(n, count);
const fp402 = mk('0402'), fp603 = mk('0603'), fp805 = mk('0805'), fp1206 = mk('1206');

// ---- 手动封装 ----
const sidePairs = (per, pitch, pw, ph, c2c) => {
  const P = [], s = (per - 1) / 2 * pitch, w = c2c || s + 2.7;
  for (let k = 0; k < per; k++) P.push({ dx: -w, dy: -s + k * pitch, w: ph, h: pw });
  for (let k = per - 1; k >= 0; k--) P.push({ dx: w, dy: -s + k * pitch, w: ph, h: pw });
  return P;
};
// QFP/QFN：沿边跨度 ±s，垂直中线外移 s+1.1（四角相邻边焊盘矩形间隙 0.1mm，L4 教训）
const qfpPads = (per, pitch, pw, ph) => {
  const s = (per - 1) / 2 * pitch, A = s + 1.1, P = [];
  for (let k = 0; k < per; k++) P.push({ dx: -A, dy: -s + k * pitch, w: ph, h: pw });
  for (let k = 0; k < per; k++) P.push({ dx: -s + k * pitch, dy: A, w: pw, h: ph });
  for (let k = 0; k < per; k++) P.push({ dx: A, dy: s - k * pitch, w: ph, h: pw });
  for (let k = 0; k < per; k++) P.push({ dx: s - k * pitch, dy: -A, w: pw, h: ph });
  return P;
};
const hd = (n, pitch = 2.54) => Array.from({ length: n }, (_, k) => ({ dx: (k - (n - 1) / 2) * pitch, dy: 0, w: 1.7, h: 1.7, shape: 'circle', layer: 'both', holeR: 0.45 }));
const hdv = (n, pitch = 2.54) => Array.from({ length: n }, (_, k) => ({ dx: 0, dy: (k - (n - 1) / 2) * pitch, w: 1.7, h: 1.7, shape: 'circle', layer: 'both', holeR: 0.45 }));
const term = (n, pitch = 5.0) => Array.from({ length: n }, (_, k) => ({ dx: (k - (n - 1) / 2) * pitch, dy: 0, w: 2.2, h: 2.2, shape: 'circle', layer: 'both', holeR: 0.8 }));
const thLED = [{ dx: 0, dy: 0, w: 1.2, h: 1.2, shape: 'circle', layer: 'both', holeR: 0.35 }, { dx: 2.54, dy: 0, w: 1.2, h: 1.2, shape: 'circle', layer: 'both', holeR: 0.35 }];
const to92 = [0, 1, 2].map(k => ({ dx: k * 1.27, dy: 0, w: 1.0, h: 1.0, shape: 'circle', layer: 'both', holeR: 0.3 }));
const pot3 = [0, 1, 2].map(k => ({ dx: (k - 1) * 2.5, dy: 0, w: 1.6, h: 1.6, shape: 'circle', layer: 'both', holeR: 0.4 }));
const smc2 = [{ dx: -2.6, dy: 0, w: 2.4, h: 3.8 }, { dx: 2.6, dy: 0, w: 2.4, h: 3.8 }];          // SS34 SMC
const sod123 = [{ dx: -1.55, dy: 0, w: 1.0, h: 1.25 }, { dx: 1.55, dy: 0, w: 1.0, h: 1.25 }];
const xtal2 = [{ dx: -1.1, dy: 0, w: 1.3, h: 3.4 }, { dx: 1.1, dy: 0, w: 1.3, h: 3.4 }];
const sot235 = [ // 1,2,3 下排（左→中→右），4,5 上排（右→左）
  { dx: -0.95, dy: 0.95, w: 0.6, h: 1.0 }, { dx: 0, dy: 0.95, w: 0.6, h: 1.0 }, { dx: 0.95, dy: 0.95, w: 0.6, h: 1.0 },
  { dx: 0.95, dy: -0.95, w: 0.6, h: 1.0 }, { dx: -0.95, dy: -0.95, w: 0.6, h: 1.0 }];
const sot236 = [ // 1,2,3 下排，4,5,6 上排
  { dx: -0.95, dy: 0.95, w: 0.55, h: 0.9 }, { dx: 0, dy: 0.95, w: 0.55, h: 0.9 }, { dx: 0.95, dy: 0.95, w: 0.55, h: 0.9 },
  { dx: 0.95, dy: -0.95, w: 0.55, h: 0.9 }, { dx: 0, dy: -0.95, w: 0.55, h: 0.9 }, { dx: -0.95, dy: -0.95, w: 0.55, h: 0.9 }];
const dpak = [ // DPAK TO-252：1=门极, 2=漏极(大tab), 3=源极
  { dx: -2.54, dy: 3.6, w: 1.5, h: 3.0 }, { dx: 0, dy: -2.4, w: 6.6, h: 6.4 }, { dx: 2.54, dy: 3.6, w: 1.5, h: 3.0 }];
const osc4 = [{ dx: -2.0, dy: 1.25, w: 1.6, h: 1.6 }, { dx: 2.0, dy: 1.25, w: 1.6, h: 1.6 },
  { dx: 2.0, dy: -1.25, w: 1.6, h: 1.6 }, { dx: -2.0, dy: -1.25, w: 1.6, h: 1.6 }];
const usbA = [0, 1, 2, 3].map(k => ({ dx: (k - 1.5) * 2.54, dy: 0, w: 1.4, h: 2.2 })).concat([
  { dx: -6.4, dy: 0, w: 2.0, h: 2.0, shape: 'circle', layer: 'top' }, { dx: 6.4, dy: 0, w: 2.0, h: 2.0, shape: 'circle', layer: 'top' }]);
const usbB = [0, 1, 2, 3].map(k => ({ dx: (k - 1.5) * 2.54, dy: 0, w: 1.5, h: 2.4 })).concat([
  { dx: -7.2, dy: 0, w: 2.0, h: 2.0, shape: 'circle', layer: 'top' }, { dx: 7.2, dy: 0, w: 2.0, h: 2.0, shape: 'circle', layer: 'top' }]);
const magjack = [ // HR911105A 简化：4 信号 SMD + 2 LED + 4 屏蔽通孔
  { dx: -3.81, dy: -2.0, w: 0.7, h: 1.8 }, { dx: -2.29, dy: -2.0, w: 0.7, h: 1.8 },
  { dx: 2.29, dy: -2.0, w: 0.7, h: 1.8 }, { dx: 3.81, dy: -2.0, w: 0.7, h: 1.8 },
  { dx: -3.0, dy: 2.5, w: 0.7, h: 1.4 }, { dx: 3.0, dy: 2.5, w: 0.7, h: 1.4 },
  ...[-7.62, 7.62].flatMap(x => [-4.5, 4.5].map(y => ({ dx: x, dy: y, w: 2.2, h: 2.2, shape: 'circle', layer: 'both', holeR: 0.9 })))];
const bga64 = []; // 8×8，0.8mm 球距，A1 左上，行优先编号
for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++)
  bga64.push({ dx: (c - 3.5) * 0.8, dy: (r - 3.5) * 0.8, w: 0.45, h: 0.45, shape: 'circle' });

function makeDesign(name, opts) {
  const d = designDefaults();
  Object.assign(d, { width: 45, height: 30, grid: 0.6, trackW: 0.4, clearance: 0.2, viaOuter: 0.8, viaDrill: 0.4, ...opts });
  d.nets = opts.nets;
  const pads = [], compsMeta = {};
  const add = (c, p, n, x, y, w, h, shape, layer, holeR) =>
    pads.push({ id: `${c}-${p}`, netId: n, x: +x.toFixed(4), y: +y.toFixed(4), w, h, shape: shape || 'rect', layer: layer || 'top', holeR });
  const place = (comp, fp, cx, cy, nets, meta) => {
    fp.forEach((f, i) => add(comp, i + 1, nets[i] || null, cx + f.dx, cy + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
    if (meta) compsMeta[comp] = meta;
  };
  const addFp = (comp, fp, cx, cy, nets, meta) => place(comp, fp, cx, cy, nets, meta);   // 别名
  return { d, pads, add, place, addFp, compsMeta, save(subdir) {
    d.pads = pads; d.comps = compsMeta;
    mkdirSync(new URL(subdir + '/', base), { recursive: true });
    writeFileSync(new URL(subdir + '/design.json', base), JSON.stringify(d, null, 1));
    console.log(name + ':', pads.length, 'pads /', d.nets.length, 'nets');
  }};
}
const CM = (x, y, rot, value, footprint, extra) => ({ x, y, rot, layer: 'top', value, footprint, ...extra });

// ============ 简单档 ============

// n53: CH32V003 SOP-8 最小系统 —— 8 脚 RISC-V 主控 + SWD 首测
{
  const nets = ['v33', 'gnd', 'swio', 'nrst', 'g1', 'g2', 'g3', 'g4'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n53 CH32V003 最小系统', { width: 30, height: 18, nets });
  const so8 = mk('SOIC-8');
  c.place('U1', so8, 10, 9, ['g1', 'g2', 'g3', 'g4', 'swio', 'nrst', 'gnd', 'v33'], CM(10, 9, 0, 'CH32V003', 'SOIC-8'));
  c.place('C1', fp805, 10, 14, ['nrst', 'gnd'], CM(10, 14, 0, '100nF', 'C0805'));
  c.place('C2', fp805, 16, 9, ['v33', 'gnd'], CM(16, 9, 0, '10uF', 'C0805'));
  c.place('J1', hd(3), 4, 4, ['nrst', 'gnd', 'swio'], CM(4, 4, 0, 'SWD', 'HDR-3P'));
  c.place('J2', hd(4), 22, 9, ['g1', 'g2', 'g3', 'g4'], CM(22, 9, 90, 'GPIO', 'HDR-4P'));
  c.save('n53-ch32v003');
}

// n54: TTP223 电容触摸 4 键 —— 4 通道独立重复单元
{
  const nets = ['v33', 'gnd', 't1', 't2', 't3', 't4', 'l1', 'l2', 'l3', 'l4'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n54 TTP223 触摸 4 键', { width: 42, height: 20, nets });
  for (let k = 0; k < 4; k++) {
    const x = 7 + k * 9;
    c.place(`U${k + 1}`, to92, x, 10, ['v33', `t${k + 1}`, 'gnd'], CM(x, 10, 0, 'TTP223', 'TO-92'));
    c.place(`R${k + 1}`, fp603, x + 1, 5, [`t${k + 1}`, `l${k + 1}`], CM(x + 1, 5, 0, '470R', 'R0603'));
    c.place(`LED${k + 1}`, thLED, x, 15.5, [`l${k + 1}`, 'gnd'], CM(x, 15.5, 0, 'LED', 'LED-THT'));
  }
  c.place('J1', hd(2), 3, 10, ['v33', 'gnd'], CM(3, 10, 90, '3.3V', 'HDR-2P'));
  c.save('n54-ttp223-touch');
}

// n55: PT100 电桥测温 —— 惠斯通电桥 + 差分放大
{
  const nets = ['v5', 'gnd', 'mid_a', 'mid_b', 'amp_out', 'fb'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n55 PT100 电桥测温', { width: 40, height: 25, nets });
  const so8 = mk('SOIC-8');
  c.place('U1', so8, 24, 12, ['amp_out', 'fb', 'mid_a', 'gnd', 'mid_b', null, null, 'v5'], CM(24, 12, 0, 'LM358', 'SOIC-8'));
  c.place('R1', fp603, 8, 6, ['v5', 'mid_a'], CM(8, 6, 90, '10k', 'R0603'));
  c.place('R2', fp603, 8, 12, ['mid_a', 'gnd'], CM(8, 12, 90, '10k', 'R0603'));
  c.place('R3', fp603, 14, 6, ['v5', 'mid_b'], CM(14, 6, 90, 'PT100', 'R0603'));
  c.place('R4', fp603, 14, 12, ['mid_b', 'gnd'], CM(14, 12, 90, '10k', 'R0603'));
  c.place('R5', fp603, 24, 18, ['amp_out', 'fb'], CM(24, 18, 0, '100k', 'R0603'));
  c.place('R6', fp603, 30, 6, ['mid_b', 'fb'], CM(30, 6, 0, '10k', 'R0603'));
  c.place('J1', hd(2), 3, 12, ['v5', 'gnd'], CM(3, 12, 90, '5V', 'HDR-2P'));
  c.place('J2', hd(2), 36, 12, ['amp_out', 'gnd'], CM(36, 12, 90, 'ADC', 'HDR-2P'));
  c.save('n55-pt100-bridge');
}

// n56: MOC3021 可控硅调光 —— 强电隔离 + 光耦 DIP-6 首测
{
  const nets = ['ac_l', 'ac_n', 'fused', 'gate', 'mt2_r', 'snub', 'trig', 'a_r', 'mgnd'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n56 MOC3021 可控硅调光', { width: 50, height: 30, nets });
  const dip6 = mk('DIP-N', 6);
  c.place('T1', [0, 1, 2].map(k => ({ dx: k * 2.54, dy: 0, w: 1.9, h: 1.9, shape: 'circle', layer: 'both', holeR: 0.6 })), 12, 8, ['ac_n', 'fused', 'gate'], CM(13.54, 8, 0, 'BTA16', 'TO-220'));
  c.place('F1', fp1206, 4, 8, ['ac_l', 'fused'], CM(4, 8, 90, '2A', 'F1206'));
  const dip6n = ['a_r', 'mgnd', null, 'mt2_r', null, 'gate'];
  dip6.forEach((f, i) => c.add('U1', i + 1, dip6n[i], 26 + f.dx, 9 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.U1 = CM(26, 9, 0, 'MOC3021', 'DIP-6');
  c.place('R1', fp603, 20, 16, ['trig', 'a_r'], CM(20, 16, 0, '330R', 'R0603'));
  c.place('R2', fp603, 33, 16, ['fused', 'mt2_r'], CM(33, 16, 0, '180R', 'R0603'));
  c.place('R3', fp1206, 16, 22, ['fused', 'snub'], CM(16, 22, 0, '100R', 'R1206'));
  c.place('C1', fp1206, 22, 22, ['snub', 'ac_n'], CM(22, 22, 0, '10nF-X2', 'C1206'));
  c.place('J1', term(2), 5, 26, ['ac_l', 'ac_n'], CM(5, 26, 0, 'AC-IN', 'TB-2P'));
  c.place('J2', term(2), 14, 26, ['ac_n', 'fused'], CM(14, 26, 0, 'LOAD', 'TB-2P'));
  c.place('J3', hd(2), 20, 5, ['trig', 'mgnd'], CM(20, 5, 0, 'MCU', 'HDR-2P'));
  c.save('n56-triac-dimmer');
}

// n57: 双电源肖特基切换 —— ideal diode OR-ing
{
  const nets = ['vin1', 'vin2', 'vout', 'gnd'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n57 双电源切换', { width: 35, height: 20, nets });
  c.place('D1', smc2, 12, 6, ['vin1', 'vout'], CM(12, 6, 0, 'SS34', 'SMC'));
  c.place('D2', smc2, 12, 14, ['vin2', 'vout'], CM(12, 14, 0, 'SS34', 'SMC'));
  c.place('C1', fp1206, 20, 10, ['vout', 'gnd'], CM(20, 10, 0, '100u', 'C1206'));
  c.place('C2', fp1206, 5, 6, ['vin1', 'gnd'], CM(5, 6, 0, '100n', 'C1206'));
  c.place('C3', fp1206, 5, 14, ['vin2', 'gnd'], CM(5, 14, 0, '100n', 'C1206'));
  c.place('J1', term(2), 28, 5, ['vout', 'gnd'], CM(28, 5, 0, 'OUT', 'TB-2P'));
  c.place('J2', term(2), 4, 5, ['vin1', 'gnd'], CM(4, 5, 0, 'DC1', 'TB-2P'));
  c.place('J3', term(2), 4, 15, ['vin2', 'gnd'], CM(4, 15, 0, 'DC2', 'TB-2P'));
  c.save('n57-dual-diode-or');
}

// ============ 中等档 ============

// n58: 键盘矩阵二极管板 —— 24 网交叉矩阵
{
  const nets = [];
  for (let k = 1; k <= 8; k++) nets.push({ id: `r${k}`, name: `R${k}` });
  for (let k = 1; k <= 8; k++) nets.push({ id: `c${k}`, name: `C${k}` });
  for (let k = 1; k <= 8; k++) nets.push({ id: `rd${k}`, name: `RD${k}` });
  const c = makeDesign('n58 键盘矩阵二极管板', { width: 70, height: 30, nets });
  const rNets = Array.from({ length: 8 }, (_, k) => `r${k + 1}`);
  const cNets = Array.from({ length: 8 }, (_, k) => `c${k + 1}`);
  const rdNets = Array.from({ length: 8 }, (_, k) => `rd${k + 1}`);
  c.place('J1', hd(8), 12, 8, rNets, CM(12, 8, 0, 'MCU-R', 'HDR-8P'));
  c.place('J2', hd(8), 12, 22, cNets, CM(12, 22, 0, 'MCU-C', 'HDR-8P'));
  for (let k = 0; k < 8; k++) c.place(`D${k + 1}`, sod123, 24 + (k % 4) * 9, 8 + Math.floor(k / 4) * 6, [rNets[k], rdNets[k]], CM(24 + (k % 4) * 9, 8 + Math.floor(k / 4) * 6, 0, '1N4148W', 'SOD-123'));
  c.place('J3', hd(8), 58, 8, rdNets, CM(58, 8, 0, 'KB-R', 'HDR-8P'));
  c.place('J4', hd(8), 58, 22, cNets, CM(58, 22, 0, 'KB-C', 'HDR-8P'));
  c.save('n58-matrix-keys');
}

// n59: MAX7219 点阵驱动 —— SOIC-24 首测 + 21 网
{
  const nets = ['vcc', 'gnd', 'din', 'clk', 'ld', 'rset'];
  for (let k = 0; k < 8; k++) nets.push(`s${k}`);
  for (let k = 0; k < 8; k++) nets.push(`d${k}`);
  const netObjs = nets.map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n59 MAX7219 点阵驱动', { width: 70, height: 35, nets: netObjs });
  const so24 = sidePairs(12, 1.27, 0.5, 1.6, 4.6);
  const u1n = ['din', 'd0', 'd2', 'd4', 'd6', 'gnd', 'd7', 'd5', 'd3', 'd1', 's5', 's7',
    's3', 's1', 'rset', 'vcc', 's0', 's2', 's4', 's6', 'clk', 'ld'];
  so24.forEach((f, i) => c.add('U1', i + 1, u1n[i], 18 + f.dx, 17 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U1 = CM(18, 17, 0, 'MAX7219', 'SOIC-24');
  c.place('R1', fp603, 18, 27, ['rset', 'gnd'], CM(18, 27, 0, '10k', 'R0603'));
  c.place('C1', fp805, 18, 6, ['vcc', 'gnd'], CM(18, 6, 0, '100n', 'C0805'));
  c.place('J1', hd(5), 6, 17, ['vcc', 'gnd', 'din', 'clk', 'ld'], CM(6, 17, 90, 'MCU', 'HDR-5P'));
  c.place('J2', hd(8), 42, 8, Array.from({ length: 8 }, (_, k) => `d${k}`), CM(42, 8, 0, 'DIG', 'HDR-8P'));
  c.place('J3', hd(8), 42, 27, Array.from({ length: 8 }, (_, k) => `s${k}`), CM(42, 27, 0, 'SEG', 'HDR-8P'));
  c.save('n59-max7219');
}

// n60: HX711 称重前端 —— 桥式传感
{
  const nets = ['vcc', 'gnd', 'dt', 'sck', 'ep', 'em', 'sp', 'sn', 'avdd', 'rate', 'dvdd'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n60 HX711 称重前端', { width: 40, height: 22, nets });
  const so16 = mk('SOIC-16');
  const u1n = ['avdd', null, 'avdd', 'ep', 'gnd', 'em', 'sn', 'sp', 'sck', 'dt', null, null, 'rate', 'dvdd', 'vcc', null];
  so16.forEach((f, i) => c.add('U1', i + 1, u1n[i], 20 + f.dx, 11 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U1 = CM(20, 11, 0, 'HX711', 'SOIC-16');
  c.place('R1', fp603, 20, 18, ['rate', 'gnd'], CM(20, 18, 0, '10k', 'R0603'));
  c.place('C1', fp805, 12, 11, ['avdd', 'gnd'], CM(12, 11, 0, '100n', 'C0805'));
  c.place('C2', fp805, 28, 11, ['dvdd', 'gnd'], CM(28, 11, 0, '100n', 'C0805'));
  c.place('J1', hd(4), 6, 11, ['vcc', 'gnd', 'dt', 'sck'], CM(6, 11, 90, 'MCU', 'HDR-4P'));
  c.place('J2', hd(4), 34, 11, ['ep', 'em', 'sp', 'sn'], CM(34, 11, 90, 'LOADCELL', 'HDR-4P'));
  c.save('n60-hx711');
}

// n61: 双节点 CAN 总线 —— 差分总线 + 端接
{
  const nets = ['tx1', 'rx1', 'tx2', 'rx2', 'v5', 'gnd', 'canh', 'canl', 'rs1', 'rs2'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n61 双节点 CAN', { width: 65, height: 28, nets });
  const dip8 = mk('DIP-N', 8);
  const mcp = ['tx', 'gnd', 'v5', 'rx', null, 'canl', 'canh', 'rs'];
  dip8.forEach((f, i) => c.add('U1', i + 1, (mcp[i] || '') === '' ? null : (mcp[i] === 'tx' ? 'tx1' : mcp[i] === 'rx' ? 'rx1' : mcp[i] === 'rs' ? 'rs1' : mcp[i]), 20 + f.dx, 10 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.U1 = CM(20, 10, 0, 'MCP2551', 'DIP-8');
  dip8.forEach((f, i) => c.add('U2', i + 1, mcp[i] === 'tx' ? 'tx2' : mcp[i] === 'rx' ? 'rx2' : mcp[i] === 'rs' ? 'rs2' : mcp[i], 44 + f.dx, 10 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.U2 = CM(44, 10, 0, 'MCP2551', 'DIP-8');
  c.place('R1', fp603, 14, 16, ['rs1', 'gnd'], CM(14, 16, 0, '10k', 'R0603'));
  c.place('R2', fp603, 50, 16, ['rs2', 'gnd'], CM(50, 16, 0, '10k', 'R0603'));
  c.place('R3', fp1206, 32, 20, ['canh', 'canl'], CM(32, 20, 0, '120R', 'R1206'));
  c.place('C1', fp805, 20, 4, ['v5', 'gnd'], CM(20, 4, 0, '100n', 'C0805'));
  c.place('C2', fp805, 44, 4, ['v5', 'gnd'], CM(44, 4, 0, '100n', 'C0805'));
  c.place('J1', hd(4), 10, 10, ['tx1', 'rx1', 'v5', 'gnd'], CM(10, 10, 90, 'MCU1', 'HDR-4P'));
  c.place('J2', hd(4), 54, 10, ['tx2', 'rx2', 'v5', 'gnd'], CM(54, 10, 90, 'MCU2', 'HDR-4P'));
  c.place('J3', term(3), 32, 6, ['canh', 'canl', 'gnd'], CM(32, 6, 0, 'BUS', 'TB-3P'));
  c.save('n61-can-bus');
}

// n62: 5 段图示均衡器 —— 电位器面板阵列 + 音频星形地
{
  const nets = ['in_l', 'out_l', 'vpos', 'vneg', 'agnd'];
  for (let k = 1; k <= 5; k++) nets.push(`w${k}`);
  for (let k = 1; k <= 4; k++) nets.push(`b${k}`);
  for (let k = 1; k <= 5; k++) nets.push(`f${k}`);
  const netObjs = nets.map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n62 五段均衡器', { width: 80, height: 40, nets: netObjs });
  const so8 = mk('SOIC-8');
  const chainIn = ['in_l', 'b1', 'b2', 'b3', 'b4'];
  for (let k = 0; k < 5; k++) {
    const x = 12 + k * 13;
    c.place(`P${k + 1}`, pot3, x, 8, [chainIn[k], `w${k + 1}`, 'agnd'], CM(x, 8, 0, 'B100K', 'POT-3'));
  }
  // U1 段1+段2, U2 段3+段4, U3 段5+输出缓冲
  const amps = [
    ['w1', 'f1', 'b1', 'w2', 'f2', 'b2'],
    ['w3', 'f3', 'b3', 'w4', 'f4', 'b4'],
    ['w5', 'f5', 'out_l', null, null, null]];
  amps.forEach((an, u) => {
    so8.forEach((f, i) => c.add(`U${u + 1}`, i + 1, an[i] || null, 16 + u * 20 + f.dx, 22 + f.dy, f.w, f.h, f.shape, f.layer));
    c.compsMeta[`U${u + 1}`] = CM(16 + u * 20, 22, 0, 'NE5532', 'SOIC-8');
  });
  for (let k = 0; k < 5; k++) {
    const x = 12 + k * 13;
    c.place(`R${k + 1}`, fp603, x, 15, [`f${k + 1}`, k < 4 ? `b${k + 1}` : 'out_l'], CM(x, 15, 0, '10k', 'R0603'));
    c.place(`C${k + 1}`, fp805, x + 4, 15, [`w${k + 1}`, 'agnd'], CM(x + 4, 15, 0, '22n', 'C0805'));
  }
  c.place('C6', fp805, 4, 22, ['in_l', 'w1'], CM(4, 22, 0, '1u', 'C0805'));
  c.place('C7', fp805, 8, 30, ['vpos', 'agnd'], CM(8, 30, 0, '10u', 'C0805'));
  c.place('C8', fp805, 13, 30, ['vneg', 'agnd'], CM(13, 30, 0, '10u', 'C0805'));
  c.place('J1', hd(2), 4, 8, ['in_l', 'agnd'], CM(4, 8, 90, 'IN', 'HDR-2P'));
  c.place('J2', hd(2), 76, 22, ['out_l', 'agnd'], CM(76, 22, 90, 'OUT', 'HDR-2P'));
  c.place('J3', hd(3), 76, 8, ['vpos', 'agnd', 'vneg'], CM(76, 8, 90, 'PWR', 'HDR-3P'));
  c.save('n62-equalizer');
}

// ============ 困难档 ============

// n63: nRF24L01+ 无线载板 —— 2×4 模块座 + DIP-20
{
  const nets = ['vcc', 'gnd', 'ce', 'csn', 'sck', 'mosi', 'miso', 'irq', 'x1', 'x2', 'rst', 'tx', 'rx'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n63 nRF24L01+ 载板', { width: 55, height: 35, nets });
  const dip20 = mk('DIP-N', 20);
  const u1n = ['rst', 'x2', 'x1', null, 'irq', 'tx', 'rx', 'sck', 'mosi', 'gnd',
    'miso', null, null, 'ce', null, 'csn', null, null, null, 'vcc'];
  dip20.forEach((f, i) => c.add('U1', i + 1, u1n[i], 24 + f.dx, 19 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.U1 = CM(24, 19, 0, 'ATtiny2313', 'DIP-20');
  const mod8 = ['gnd', 'vcc', 'ce', 'csn', 'sck', 'mosi', 'miso', 'irq'];
  const mod = [];
  for (let k = 0; k < 4; k++) for (const dy of [-1.27, 1.27]) mod.push({ dx: (k - 1.5) * 2.54, dy, w: 1.7, h: 1.7, shape: 'circle', layer: 'both', holeR: 0.45 });
  const modN = [0, 2, 4, 6, 1, 3, 5, 7]; // 2×4 座引脚序（双排）
  mod.forEach((f, i) => c.add('J1', i + 1, modN[i] < 8 ? modN[i] >= 0 ? mod8[modN[i]] : null : null, 8 + f.dx, 8 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.J1 = CM(8, 8, 0, 'nRF24L01+', 'HDR-2x4');
  c.place('Y1', [{ dx: -1.7, dy: 0, w: 1.6, h: 4.6, shape: 'circle', layer: 'both', holeR: 0.5 }, { dx: 1.7, dy: 0, w: 1.6, h: 4.6, shape: 'circle', layer: 'both', holeR: 0.5 }], 10, 28, ['x1', 'x2'], CM(10, 28, 0, '16MHz', 'HC-49'));
  c.place('C1', fp805, 15, 28, ['x1', 'gnd'], CM(15, 28, 0, '22p', 'C0805'));
  c.place('C2', fp805, 19, 28, ['x2', 'gnd'], CM(19, 28, 0, '22p', 'C0805'));
  c.place('R1', fp603, 32, 30, ['rst', 'vcc'], CM(32, 30, 0, '10k', 'R0603'));
  c.place('J2', hd(4), 40, 30, ['rst', 'tx', 'rx', 'gnd'], CM(40, 30, 0, 'SER', 'HDR-4P'));
  c.place('C3', fp805, 12, 15, ['vcc', 'gnd'], CM(12, 15, 0, '100n', 'C0805'));
  c.save('n63-nrf24-carrier');
}

// n64: 3S 电池采样板 —— 0402 密排 + 大端子 + 采样链
{
  const nets = ['bm', 'b1', 'b2', 'b3', 'bp', 't0', 't1', 't2', 't3'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n64 3S 电池采样板', { width: 36, height: 22, grid: 0.25, trackW: 0.15, clearance: 0.1, viaOuter: 0.5, viaDrill: 0.25, nets });
  c.place('J1', term(5), 18, 4, ['bm', 'b1', 'b2', 'b3', 'bp'], CM(18, 4, 0, 'CELLS', 'TB-5P'));
  const chain = [['bp', 't3'], ['b3', 't2'], ['b2', 't1'], ['b1', 't0']];
  for (let k = 0; k < 4; k++) {
    const x = 7 + k * 7.5;
    c.place(`R${k * 2 + 1}`, fp402, x, 11, [chain[k][0], `t${3 - k}`], CM(x, 11, 0, '100k', 'R0402'));
    c.place(`R${k * 2 + 2}`, fp402, x, 15, [`t${3 - k}`, 'bm'], CM(x, 15, 0, '33k', 'R0402'));
    c.place(`C${k + 1}`, fp402, x, 18.5, [`t${3 - k}`, 'bm'], CM(x, 18.5, 0, '100n', 'C0402'));
  }
  c.place('J2', hdv(4), 32.5, 13, ['t0', 't1', 't2', 't3'], CM(32.5, 13, 90, 'ADC', 'HDR-4P'));
  c.save('n64-3s-sampler');
}

// n65: 隔离 RS-485 节点 —— 隔离带禁布 + 隔离 IC + 隔离电源
{
  const nets = ['v5', 'gnd', 'tx', 'rx', 'de', 'rst', 'ivcc', 'ignd', 'ro', 'a', 'b'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n65 隔离 RS-485 节点', { width: 60, height: 38, nets,
    keepouts: [{ x: 29.5, y: 2, w: 2.0, h: 31 }] });   // 隔离带横穿板中央
  const dip28 = mk('DIP-N', 28);
  const u1n = Array.from({ length: 28 }, (_, i) => {
    const map = { 2: 'tx', 3: 'rx', 4: 'de', 7: 'v5', 8: 'gnd', 9: 'rst', 20: 'v5', 22: 'gnd' };
    return map[i + 1] || null;
  });
  dip28.forEach((f, i) => c.add('U1', i + 1, u1n[i], 12 + f.dx, 19 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.U1 = CM(12, 19, 0, 'ATmega328P', 'DIP-28');
  const so16w = sidePairs(8, 1.27, 0.5, 1.8, 5.2);
  const u2n = ['gnd', 'ro', 'de', 'tx', 'v5', null, null, null, 'ignd', 'a', 'b', 'ignd', null, null, 'ivcc', 'ivcc'];
  so16w.forEach((f, i) => c.add('U2', i + 1, u2n[i], 42 + f.dx, 17 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U2 = CM(42, 17, 0, 'ADM2483', 'SOIC-16W');
  const b0505 = [{ dx: -3.81, dy: 0, w: 1.7, h: 1.7, shape: 'circle', layer: 'both', holeR: 0.45 },
    { dx: -1.27, dy: 0, w: 1.7, h: 1.7, shape: 'circle', layer: 'both', holeR: 0.45 },
    { dx: 1.27, dy: 0, w: 1.7, h: 1.7, shape: 'circle', layer: 'both', holeR: 0.45 },
    { dx: 3.81, dy: 0, w: 1.7, h: 1.7, shape: 'circle', layer: 'both', holeR: 0.45 }];
  c.place('U3', b0505, 30, 30, ['v5', 'gnd', 'ivcc', 'ignd'], CM(30, 30, 0, 'B0505S', 'SIP-4'));
  c.place('R1', fp603, 34, 8, ['ivcc', 'ro'], CM(34, 8, 0, '10k', 'R0603'));
  c.place('R2', fp1206, 52, 24, ['a', 'b'], CM(52, 24, 0, '120R', 'R1206'));
  c.place('C1', fp805, 36, 30, ['ivcc', 'ignd'], CM(36, 30, 0, '100n', 'C0805'));
  c.place('C2', fp805, 24, 30, ['v5', 'gnd'], CM(24, 30, 0, '100n', 'C0805'));
  c.place('J1', hd(5), 8, 4, ['rst', 'tx', 'rx', 'v5', 'gnd'], CM(8, 4, 90, 'MCU', 'HDR-5P'));
  c.place('J2', term(3), 53, 5, ['a', 'b', 'ignd'], CM(53, 5, 0, 'BUS', 'TB-3P'));
  c.save('n65-iso-rs485');
}

// n66: XR-2206 函数发生器 —— DIP-20 + 面板电位器
{
  const nets = ['vcc', 'gnd', 'out', 'sync', 'f1', 'f2', 'w1', 'w2', 'w3', 'w4',
    's1', 's2', 'amp_in', 'buf'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n66 XR-2206 函数发生器', { width: 80, height: 45, nets });
  const dip20 = mk('DIP-N', 20);
  const u1n = ['f1', 's1', 's2', 'w1', 'w2', null, null, null, 'gnd', null,
    'buf', 'w3', null, 'amp_in', 'w4', 'out', 'sync', 'f2', null, 'vcc'];
  dip20.forEach((f, i) => c.add('U1', i + 1, u1n[i], 34 + f.dx, 26 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.U1 = CM(34, 26, 0, 'XR-2206', 'DIP-20');
  const pots = [['w1', 'f1', 'gnd'], ['w2', 's1', 's2'], ['w3', 'amp_in', 'gnd'], ['w4', 'out', 'gnd']];
  pots.forEach((pn, k) => c.place(`P${k + 1}`, pot3, 12 + k * 14, 10, pn, CM(12 + k * 14, 10, 0, 'PANEL', 'POT-3')));
  c.place('C1', fp805, 24, 20, ['f1', 'f2'], CM(24, 20, 0, '2.2n', 'C0805'));
  c.place('C2', fp805, 44, 16, ['buf', 'out'], CM(44, 16, 0, '1u', 'C0805'));
  c.place('R1', fp603, 30, 14, ['w1', 'f1'], CM(30, 14, 0, '4k7', 'R0603'));
  c.place('R2', fp603, 50, 20, ['amp_in', 'buf'], CM(50, 20, 0, '50k', 'R0603'));
  c.place('R3', fp603, 56, 26, ['out', 'gnd'], CM(56, 26, 0, '600R', 'R0603'));
  c.place('R4', fp603, 22, 36, ['vcc', 'w2'], CM(22, 36, 0, '10k', 'R0603'));
  c.place('J1', hd(2), 4, 40, ['vcc', 'gnd'], CM(4, 40, 0, '9V', 'HDR-2P'));
  c.place('J2', hd(3), 72, 40, ['out', 'gnd', 'sync'], CM(72, 40, 0, 'BNC', 'HDR-3P'));
  c.place('C3', fp805, 8, 30, ['vcc', 'gnd'], CM(8, 30, 0, '100n', 'C0805'));
  c.save('n66-xr2206');
}

// n67: USB Hub SL2.1A —— 一对多扇出（上行 + 4 下行）
{
  const nets = ['vbus', 'gnd', 'v33', 'udp', 'udm', 'p1p', 'p1m', 'p2p', 'p2m', 'p3p', 'p3m', 'p4p', 'p4m', 'x1', 'x2'];
  const netObjs = nets.map(id => ({ id, name: id.toUpperCase(), ...(id.startsWith('p') || id.startsWith('u') ? { pair: id.replace(/[pm]$/, '') } : {}) }));
  const c = makeDesign('n67 USB Hub', { width: 75, height: 35, nets: netObjs });
  const so28 = sidePairs(14, 1.27, 0.4, 1.5, 3.9);
  const u1n = ['x1', 'x2', 'udm', 'udp', 'gnd', 'p1m', 'p1p', 'gnd', 'p2m', 'p2p', 'v33', 'gnd', 'p3m', 'p3p',
    'p4p', 'p4m', 'vbus', 'gnd', 'v33', null, null, null, 'gnd', 'v33', null, 'vbus', 'gnd', 'v33'];
  so28.forEach((f, i) => c.add('U1', i + 1, u1n[i], 22 + f.dx, 17 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U1 = CM(22, 17, 0, 'SL2.1A', 'SOP-28');
  usbB.forEach((f, i) => c.add('J1', i + 1, ['vbus', 'udm', 'udp', 'gnd', 'gnd', 'gnd'][i], 9 + f.dx, 17 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.J1 = CM(9, 17, 0, 'USB-B-UP', 'USB-B');
  for (let k = 0; k < 4; k++) {
    const y = 6 + k * 8;
    usbA.forEach((f, i) => c.add(`J${k + 2}`, i + 1, ['vbus', `p${k + 1}m`, `p${k + 1}p`, 'gnd', 'gnd', 'gnd'][i], 60 + f.dx, y + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
    c.compsMeta[`J${k + 2}`] = CM(60, y, 0, 'USB-A-DN', 'USB-A');
  }
  c.place('Y1', xtal2, 22, 5, ['x1', 'x2'], CM(22, 5, 0, '12MHz', 'XTAL-3225'));
  c.place('C1', fp805, 27, 5, ['x1', 'gnd'], CM(27, 5, 0, '18p', 'C0805'));
  c.place('C2', fp805, 31, 5, ['x2', 'gnd'], CM(31, 5, 0, '18p', 'C0805'));
  c.place('C3', fp805, 14, 30, ['v33', 'gnd'], CM(14, 30, 0, '100n', 'C0805'));
  c.place('C4', fp805, 19, 30, ['vbus', 'gnd'], CM(19, 30, 0, '100n', 'C0805'));
  c.place('R1', fp603, 24, 30, ['vbus', 'v33'], CM(24, 30, 0, '1k5', 'R0603'));
  c.save('n67-usb-hub');
}

// ============ 超难档 ============

// n68: RP2040 QFN-56 —— 0.4mm 极限间距首测（低于第五轮 L1 对照表最细档）
{
  const nets = ['v33', 'gnd', 'swclk', 'swdio', 'xin', 'xout', 'usb_dp', 'usb_dm',
    'qcs', 'qsck', 'qd0', 'qd1', 'qd2', 'qd3', 'vbus'];
  for (let k = 0; k < 8; k++) nets.push(`g${k}`);
  const netObjs = nets.map(id => ({ id, name: id.toUpperCase(), ...(id.startsWith('usb') ? { pair: 'usb' } : {}) }));
  const c = makeDesign('n68 RP2040 QFN-56', { width: 52, height: 52, grid: 0.2, trackW: 0.1, clearance: 0.05, viaOuter: 0.45, viaDrill: 0.2, nets: netObjs });
  const qfn56 = qfpPads(14, 0.4, 0.2, 0.9);
  // 逆时针四边：左 14（1-14）下→上、下 14（15-28）左→右、右 14（29-42）上→下、上 14（43-56）右→左
  const rp = ['g0', 'g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'gnd', 'v33', 'gnd', 'v33', 'swclk', 'swdio',
    'usb_dp', 'usb_dm', 'v33', 'gnd', 'vbus', 'gnd', 'v33', 'gnd', 'v33', 'gnd', 'xin', 'xout', 'gnd', 'v33',
    'qd0', 'qd1', 'qd2', 'qd3', 'qcs', 'qsck', 'gnd', 'v33', 'gnd', 'v33', 'gnd', 'v33', 'gnd', 'v33',
    'gnd', 'v33', 'gnd', 'v33', 'gnd', 'v33', 'gnd', 'v33', 'gnd', 'v33', 'gnd', 'v33', 'gnd', 'v33'];
  qfn56.forEach((f, i) => c.add('U1', i + 1, rp[i] || null, 26 + f.dx, 26 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U1 = CM(26, 26, 0, 'RP2040', 'QFN-56');
  const so8 = mk('SOIC-8');
  c.place('U2', so8, 40, 40, ['qcs', 'qd1', 'qd2', 'gnd', 'qd0', 'qsck', 'qd3', 'v33'], CM(40, 40, 0, 'W25Q16', 'SOIC-8'));
  c.place('Y1', xtal2, 12, 12, ['xin', 'xout'], CM(12, 12, 0, '12MHz', 'XTAL-3225'));
  c.place('C1', fp402, 17, 12, ['xin', 'gnd'], CM(17, 12, 0, '15p', 'C0402'));
  c.place('C2', fp402, 17, 15, ['xout', 'gnd'], CM(17, 15, 0, '15p', 'C0402'));
  c.place('J1', hdv(4), 5, 12, ['v33', 'gnd', 'swclk', 'swdio'], CM(5, 12, 90, 'SWD', 'HDR-4P'));
  c.place('J2', hdv(4), 5, 26, ['vbus', 'usb_dp', 'usb_dm', 'gnd'], CM(5, 26, 90, 'USB', 'HDR-4P'));
  c.place('J3', hdv(8), 5, 42, Array.from({ length: 8 }, (_, k) => `g${k}`), CM(5, 42, 90, 'GPIO', 'HDR-8P'));
  c.place('C3', fp402, 20, 40, ['v33', 'gnd'], CM(20, 40, 0, '100n', 'C0402'));
  c.place('C4', fp402, 20, 43.5, ['v33', 'gnd'], CM(20, 43.5, 0, '100n', 'C0402'));
  c.place('R1', fp402, 40, 30, ['qd2', 'v33'], CM(40, 30, 0, '10k', 'R0402'));
  c.place('R2', fp402, 44, 30, ['qd3', 'v33'], CM(44, 30, 0, '10k', 'R0402'));
  c.save('n68-rp2040-qfn56');
}

// n69: 三相无刷 ESC —— DPAK + 三相大电流拓扑（全网统一 0.4：L1 教训，maxTrackW 全板生效）
{
  const nets = ['batp', 'gnd', 'v33', 'pu', 'pv', 'pw', 'gh1', 'gl1', 'gh2', 'gl2', 'gh3', 'gl3',
    'su', 'sv', 'sw', 'ampu', 'sig'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n69 三相无刷 ESC', { width: 90, height: 50, nets });
  const so16 = sidePairs(8, 1.27, 0.4, 1.5, 2.7);
  const u1n = ['sig', 'gnd', 'gh1', 'gl1', 'gh2', 'gl2', 'gh3', 'gl3',
    'ampu', 'v33', null, null, 'gnd', 'su', 'sv', 'sw'];
  so16.forEach((f, i) => c.add('U1', i + 1, u1n[i], 30 + f.dx, 12 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U1 = CM(30, 12, 0, 'MCU-ESC', 'SOP-16');
  // 半桥：Q1(QH-U) Q2(QL-U) Q3(QH-V) Q4(QL-V) Q5(QH-W) Q6(QL-W)
  // DPAK 引脚：1=G, 2=D(tab), 3=S
  const bridges = [ // [高侧gate, 相网, 低侧gate, 低侧source采样网]
    ['gh1', 'pu', 'gl1', 'su'], ['gh2', 'pv', 'gl2', 'sv'], ['gh3', 'pw', 'gl3', 'sw']];
  bridges.forEach((br, k) => {
    const x = 20 + k * 22;
    c.place(`Q${k * 2 + 1}`, dpak, x, 36, [br[0], 'batp', br[1]], CM(x, 36, 0, 'MOS-N', 'DPAK'));
    c.place(`Q${k * 2 + 2}`, dpak, x, 14, [br[2], br[1], br[3]], CM(x, 14, 0, 'MOS-N', 'DPAK'));
  });
  for (let k = 0; k < 3; k++) c.place(`R${k + 1}`, fp1206, 42 + k * 22, 25, [bridges[k][3], 'gnd'], CM(42 + k * 22, 25, 90, '5mR', 'R1206'));
  const so8 = mk('SOIC-8');
  c.place('U2', so8, 62, 12, ['su', 'ampu', 'sig', 'gnd', 'gnd', null, null, 'v33'], CM(62, 12, 0, 'LM358', 'SOIC-8'));
  for (let k = 0; k < 3; k++) c.place(`C${k + 1}`, fp805, 14 + k * 6, 25, ['batp', 'gnd'], CM(14 + k * 6, 25, 0, '100n', 'C0805'));
  c.place('C4', fp805, 30, 30, ['v33', 'gnd'], CM(30, 30, 0, '1u', 'C0805'));
  c.place('J1', hd(2), 6, 12, ['sig', 'gnd'], CM(6, 12, 90, 'PWM', 'HDR-2P'));
  c.place('J2', term(2), 6, 42, ['batp', 'gnd'], CM(6, 42, 0, 'BAT', 'TB-2P'));
  c.place('J3', term(3), 78, 40, ['pu', 'pv', 'pw'], CM(78, 40, 0, 'PHASE', 'TB-3P'));
  c.save('n69-esc-3phase');
}

// n70: Ethernet PHY 载板 —— QFN-32 + MagJack 双差分
{
  const nets = ['v33', 'gnd', 'txp', 'txn', 'rxp', 'rxn', 'refclk', 'crs', 'mdio', 'mdc',
    'ledl', 'ledr', 'x1', 'x2', 'sh'];
  for (let k = 0; k < 6; k++) nets.push(`rm${k}`);
  const netObjs = nets.map(id => ({ id, name: id.toUpperCase(), ...(id.endsWith('p') || id.endsWith('n') ? { pair: id.slice(0, -1) } : {}) }));
  const c = makeDesign('n70 Ethernet PHY 载板', { width: 65, height: 45, grid: 0.25, trackW: 0.15, clearance: 0.1, viaOuter: 0.5, viaDrill: 0.25, nets: netObjs });
  const qfn32 = qfpPads(8, 0.5, 0.3, 0.8);
  const lan = ['x1', 'x2', 'gnd', 'v33', 'refclk', 'gnd', 'txp', 'txn', 'gnd', 'v33', 'rxp', 'rxn',
    'gnd', 'ledl', 'ledr', 'v33', 'rm0', 'rm1', 'rm2', 'rm3', 'rm4', 'rm5', 'mdio', 'mdc',
    'crs', 'gnd', 'v33', 'gnd', 'v33', 'gnd', 'v33', 'gnd'];
  qfn32.forEach((f, i) => c.add('U1', i + 1, lan[i] || null, 22 + f.dx, 22 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U1 = CM(22, 22, 0, 'LAN8720', 'QFN-32');
  const mjN = ['txp', 'txn', 'rxp', 'rxn', 'ledl', 'ledr', 'sh', 'sh', 'sh', 'sh', 'gnd', 'gnd'];
  magjack.forEach((f, i) => c.add('J1', i + 1, mjN[i], 50 + f.dx, 22 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.J1 = CM(50, 22, 0, 'HR911105A', 'MAGJACK');
  c.place('Y1', xtal2, 12, 8, ['x1', 'x2'], CM(12, 8, 0, '25MHz', 'XTAL-3225'));
  c.place('R1', fp603, 12, 16, ['refclk', 'v33'], CM(12, 16, 0, '10k', 'R0603'));
  c.place('R2', fp603, 17, 16, ['rxp', null], CM(17, 16, 0, '49R9', 'R0603'));
  c.place('R3', fp603, 21, 16, ['rxn', null], CM(21, 16, 0, '49R9', 'R0603'));
  c.place('R4', fp603, 25, 16, ['mdio', 'v33'], CM(25, 16, 0, '10k', 'R0603'));
  c.place('J2', hdv(6), 6, 22, ['rm0', 'rm1', 'rm2', 'rm3', 'rm4', 'rm5'], CM(6, 22, 90, 'RMII', 'HDR-6P'));
  c.place('J3', hdv(5), 6, 34, ['v33', 'gnd', 'refclk', 'mdc', 'crs'], CM(6, 34, 90, 'PWR', 'HDR-5P'));
  c.place('C1', fp402, 30, 8, ['v33', 'gnd'], CM(30, 8, 0, '100n', 'C0402'));
  c.place('C2', fp402, 34, 8, ['v33', 'gnd'], CM(34, 8, 0, '100n', 'C0402'));
  c.save('n70-eth-phy');
}

// n71: BGA-64 CPLD 载板 —— BGA 首测（8×8，0.8mm 球距）
{
  const nets = ['v33', 'gnd', 'tck', 'tms', 'tdi', 'tdo', 'osc'];
  for (let k = 0; k < 8; k++) nets.push(`io${k}`);
  const netObjs = nets.map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n71 BGA-64 CPLD', { width: 52, height: 52, grid: 0.2, trackW: 0.15, clearance: 0.08, viaOuter: 0.45, viaDrill: 0.2, nets: netObjs });
  // BGA 引脚网映射：外圈电源/地交错，内圈信号（每网 ≥2 球），中心 2×2 地
  const inner = {  // "r,c" → 网（内圈 32 球）
    '1,1': 'io0', '1,2': 'io1', '1,3': 'io2', '1,4': 'io3', '1,5': 'tck', '1,6': 'tms',
    '2,1': 'io4', '2,2': 'io5', '2,3': 'io6', '2,4': 'io7', '2,5': 'tdi', '2,6': 'tdo',
    '3,1': 'osc', '3,2': 'osc', '3,5': 'io0', '3,6': 'io1',
    '4,1': 'io2', '4,2': 'io3', '4,5': 'io4', '4,6': 'io5',
    '5,1': 'io6', '5,2': 'io7', '5,3': 'tck', '5,4': 'tms', '5,5': 'tdi', '5,6': 'tdo',
    '6,1': 'v33', '6,2': 'gnd', '6,3': 'v33', '6,4': 'gnd', '6,5': 'v33', '6,6': 'gnd' };
  const bgaNets = [];
  for (let r = 0; r < 8; r++) for (let cI = 0; cI < 8; cI++) {
    const edge = r === 0 || r === 7 || cI === 0 || cI === 7;
    if (inner[`${r},${cI}`]) bgaNets.push(inner[`${r},${cI}`]);
    else if (edge) bgaNets.push((r + cI) % 3 === 0 ? 'v33' : 'gnd');
    else bgaNets.push('gnd');   // 中心 2×2 + 内圈空位
  }
  bga64.forEach((f, i) => c.add('U1', i + 1, bgaNets[i] || null, 26 + f.dx, 26 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U1 = CM(26, 26, 0, 'XC9572XL', 'BGA-64');
  c.place('X1', osc4, 10, 10, ['v33', 'osc', 'gnd', 'gnd'], CM(10, 10, 0, '50MHz', 'XO-4P'));
  c.place('J1', hdv(4), 4, 20, ['tck', 'tms', 'tdi', 'tdo'], CM(4, 20, 90, 'JTAG', 'HDR-4P'));
  // tck/tms/tdi/tdo 需要 ≥2 焊盘：BGA 外圈分配
  c.place('J2', hdv(8), 48, 12, Array.from({ length: 8 }, (_, k) => `io${k}`), CM(48, 12, 90, 'IO', 'HDR-8P'));
  c.place('J3', hdv(2), 48, 30, ['v33', 'gnd'], CM(48, 30, 90, 'PWR', 'HDR-2P'));
  for (let k = 0; k < 8; k++) {
    const x = 10 + (k % 4) * 8, y = k < 4 ? 38 : 44;
    c.place(`C${k + 1}`, fp402, x, y, ['v33', 'gnd'], CM(x, y, 0, '100n', 'C0402'));
  }
  // JTAG/osc 网已由 BGA 内圈保证 ≥2 球
  c.save('n71-bga64');
}

// n72: LQFP144 最小系统 —— 规模天花板 + 底层贴装 SMD 首测
{
  const nets = ['v33', 'gnd', 'swclk', 'swdio', 'x1', 'x2', 'vcap', 'boot'];
  for (let k = 0; k < 8; k++) nets.push(`p${k}`);
  for (let k = 0; k < 8; k++) nets.push(`k${k}`);
  const netObjs = nets.map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n72 LQFP144 底层贴装', { width: 65, height: 65, grid: 0.25, trackW: 0.15, clearance: 0.1, viaOuter: 0.5, viaDrill: 0.25, nets: netObjs });
  const qfp144 = qfpPads(36, 0.5, 0.22, 1.1);
  const rp = [];
  for (let k = 0; k < 144; k++) {
    const m = { 10: 'x1', 11: 'x2', 12: 'boot', 27: 'swdio', 28: 'swclk', 31: 'vcap', 48: 'vcap', 49: 'v33', 76: 'gnd', 110: 'v33', 137: 'gnd' };
    if (m[k + 1]) rp.push(m[k + 1]);
    else if (k % 5 === 0) rp.push('gnd');
    else if (k % 5 === 2) rp.push('v33');
    else if (k % 10 === 1) rp.push(`p${Math.floor(k / 10) % 8}`);
    else if (k % 10 === 6) rp.push(`k${Math.floor(k / 10) % 8}`);
    else rp.push(null);
  }
  // 保证 p0..p7 / k0..k7 每网 ≥2 焊盘（LQFP 一脚 + 排针一脚）
  const seen = new Set();
  rp.forEach(n => { if (n && (n.startsWith('p') || n.startsWith('k'))) seen.add(n); });
  for (let k = 0; k < 8; k++) {
    if (!seen.has(`p${k}`)) { const idx = rp.findIndex((n, i) => n === null && i % 7 === 1); if (idx >= 0) rp[idx] = `p${k}`; }
    if (!seen.has(`k${k}`)) { const idx = rp.findIndex((n, i) => n === null && i % 7 === 3); if (idx >= 0) rp[idx] = `k${k}`; }
  }
  qfp144.forEach((f, i) => c.add('U1', i + 1, rp[i] || null, 32.5 + f.dx, 32.5 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U1 = CM(32.5, 32.5, 0, 'STM32F103', 'LQFP-144');
  c.place('Y1', xtal2, 18, 12, ['x1', 'x2'], CM(18, 12, 0, '8MHz', 'XTAL-3225'));
  c.place('C1', fp402, 23, 12, ['x1', 'gnd'], CM(23, 12, 0, '20p', 'C0402'));
  c.place('C2', fp402, 23, 15, ['x2', 'gnd'], CM(23, 15, 0, '20p', 'C0402'));
  c.place('C3', fp402, 32.5, 12, ['vcap', 'gnd'], CM(32.5, 12, 0, '2.2u', 'C0402'));
  c.place('R1', fp402, 40, 12, ['boot', 'gnd'], CM(40, 12, 0, '10k', 'R0402'));
  c.place('J1', hdv(4), 8, 12, ['v33', 'gnd', 'swclk', 'swdio'], CM(8, 12, 90, 'SWD', 'HDR-4P'));
  c.place('J2', hdv(8), 8, 30, Array.from({ length: 8 }, (_, k) => `p${k}`), CM(8, 30, 90, 'GPIO-P', 'HDR-8P'));
  c.place('J3', hdv(8), 8, 48, Array.from({ length: 8 }, (_, k) => `k${k}`), CM(8, 48, 90, 'GPIO-K', 'HDR-8P'));
  // 底层贴装首测：3 颗 SMD 放 bottom 层
  c.place('D1', fp603, 46, 52, ['v33', 'gnd'], { x: 46, y: 52, rot: 0, layer: 'bottom', value: 'LED-0603', footprint: 'LED0603' });
  // 0603 两脚：place 按焊盘序赋网 —— D1 是 LED 用 0603 库（2 脚）OK
  c.place('C4', fp402, 52, 52, ['v33', 'gnd'], { x: 52, y: 52, rot: 0, layer: 'bottom', value: '100n', footprint: 'C0402' });
  c.place('C5', fp402, 56, 52, ['v33', 'gnd'], { x: 56, y: 52, rot: 0, layer: 'bottom', value: '100n', footprint: 'C0402' });
  for (let k = 0; k < 4; k++) {
    const x = 30 + k * 5, y = 56;
    c.place(`C${k + 6}`, fp402, x, y, ['v33', 'gnd'], CM(x, y, 0, '100n', 'C0402'));
  }
  c.save('n72-lqfp144-bottom');
}

// ============ 自检门（第五轮 L3/L4/L5 教训固化）============
let fail = 0;
const dirs = ['n53-ch32v003', 'n54-ttp223-touch', 'n55-pt100-bridge', 'n56-triac-dimmer', 'n57-dual-diode-or',
  'n58-matrix-keys', 'n59-max7219', 'n60-hx711', 'n61-can-bus', 'n62-equalizer',
  'n63-nrf24-carrier', 'n64-3s-sampler', 'n65-iso-rs485', 'n66-xr2206', 'n67-usb-hub',
  'n68-rp2040-qfn56', 'n69-esc-3phase', 'n70-eth-phy', 'n71-bga64', 'n72-lqfp144-bottom'];
for (const dir of dirs) {
  const d = JSON.parse(readDesign(dir));
  const problems = [];
  const netIds = new Set(d.nets.map(n => n.id));
  const refCount = new Map();
  for (const p of d.pads) {
    if (p.netId == null) continue;
    if (!netIds.has(p.netId)) problems.push(`坏引用 ${p.id}→${p.netId}`);
    else refCount.set(p.netId, (refCount.get(p.netId) || 0) + 1);
  }
  for (const [id, k] of refCount) if (k < 2) problems.push(`单脚网 ${id}(${k})`);
  for (const n of d.nets) if (!refCount.has(n.id)) problems.push(`空网 ${n.id}`);
  // 同元件焊盘两两矩形距离（L4）
  const byComp = new Map();
  for (const p of d.pads) {
    const comp = p.id.split('-')[0];
    if (!byComp.has(comp)) byComp.set(comp, []);
    byComp.get(comp).push(p);
  }
  const rectGap = (a, b) => Math.max(Math.abs(a.x - b.x) - (a.w + b.w) / 2, Math.abs(a.y - b.y) - (a.h + b.h) / 2);
  for (const [comp, ps] of byComp) {
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      const g = rectGap(ps[i], ps[j]);
      if (g < -1e-9) problems.push(`同元件重叠 ${comp}: ${ps[i].id}/${ps[j].id} gap=${g.toFixed(3)}`);
    }
  }
  for (const p of d.pads) {
    if (p.x - p.w / 2 < -1e-9 || p.x + p.w / 2 > d.width + 1e-9 || p.y - p.h / 2 < -1e-9 || p.y + p.h / 2 > d.height + 1e-9)
      problems.push(`出板 ${p.id} @(${p.x},${p.y})`);
  }
  if (problems.length) { console.error(`✗ ${dir}:`); problems.forEach(p => console.error('   ' + p)); fail = 1; }
  else console.log(`✓ ${dir}: 网表完整`);
}
if (fail) process.exit(1);
console.log('\n全部 20 项目自检通过');

function readDesign(dir) { return readFileSync(new URL(`${dir}/design.json`, base), 'utf8'); }
