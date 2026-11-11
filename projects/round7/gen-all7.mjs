// 第七轮批量 spec 生成：N73-N92（20 项目，4 档，全部与前六轮不同的设计维度）
// 新维度：SOIC-10/TSSOP-20/28/HSOP-28(pad) 首测、PLCC-44 J 引脚、9-pin 胆座圆周、
//         DIN-6 圆周连接器、金手指板边焊盘、HUB75 双排宽总线、差分接收、I2C 链
// 自检门（L3/L4/L5 制度化）：坏引用/单脚网/空网/同元件焊盘重叠/出板
import { designDefaults, footprintPads } from '../../src/engine.mjs';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';

const base = new URL('./', import.meta.url);
const mk = (n, count) => footprintPads(n, count);
const fp402 = mk('0402'), fp603 = mk('0603'), fp805 = mk('0805'), fp1206 = mk('1206');

// ---- 手动封装 ----
const qfpPads = (per, pitch, pw, ph, off) => {
  const s = (per - 1) / 2 * pitch, A = s + (off != null ? off : 1.1), P = [];
  for (let k = 0; k < per; k++) P.push({ dx: -A, dy: -s + k * pitch, w: ph, h: pw });
  for (let k = 0; k < per; k++) P.push({ dx: -s + k * pitch, dy: A, w: pw, h: ph });
  for (let k = 0; k < per; k++) P.push({ dx: A, dy: s - k * pitch, w: ph, h: pw });
  for (let k = 0; k < per; k++) P.push({ dx: s - k * pitch, dy: -A, w: pw, h: ph });
  return P;
};
const hd = (n, pitch = 2.54) => Array.from({ length: n }, (_, k) => ({ dx: (k - (n - 1) / 2) * pitch, dy: 0, w: 1.7, h: 1.7, shape: 'circle', layer: 'both', holeR: 0.45 }));
const hd2x = (n, pitch = 2.54) => {  // 双排 2×N：上排 1..n，下排 n+1..2n
  const P = [];
  for (let k = 0; k < n; k++) P.push({ dx: (k - (n - 1) / 2) * pitch, dy: -1.27, w: 1.7, h: 1.7, shape: 'circle', layer: 'both', holeR: 0.45 });
  for (let k = 0; k < n; k++) P.push({ dx: (k - (n - 1) / 2) * pitch, dy: 1.27, w: 1.7, h: 1.7, shape: 'circle', layer: 'both', holeR: 0.45 });
  return P;
};
const term = (n, pitch = 5.0) => Array.from({ length: n }, (_, k) => ({ dx: (k - (n - 1) / 2) * pitch, dy: 0, w: 2.2, h: 2.2, shape: 'circle', layer: 'both', holeR: 0.8 }));
const xtal2 = [{ dx: -1.1, dy: 0, w: 1.3, h: 3.4 }, { dx: 1.1, dy: 0, w: 1.3, h: 3.4 }];
const to92 = [0, 1, 2].map(k => ({ dx: k * 1.27, dy: 0, w: 1.0, h: 1.0, shape: 'circle', layer: 'both', holeR: 0.3 }));
const to220 = [0, 1, 2].map(k => ({ dx: k * 2.54, dy: 0, w: 1.9, h: 1.9, shape: 'circle', layer: 'both', holeR: 0.6 }));
const thLED = [{ dx: 0, dy: 0, w: 1.2, h: 1.2, shape: 'circle', layer: 'both', holeR: 0.35 }, { dx: 2.54, dy: 0, w: 1.2, h: 1.2, shape: 'circle', layer: 'both', holeR: 0.35 }];
const indTHT = [{ dx: -2.5, dy: 0, w: 2.4, h: 2.4, shape: 'circle', layer: 'both', holeR: 0.7 }, { dx: 2.5, dy: 0, w: 2.4, h: 2.4, shape: 'circle', layer: 'both', holeR: 0.7 }];
const thR = [{ dx: -1.27, dy: 0, w: 1.3, h: 1.3, shape: 'circle', layer: 'both', holeR: 0.35 }, { dx: 1.27, dy: 0, w: 1.3, h: 1.3, shape: 'circle', layer: 'both', holeR: 0.35 }];
const thC = [{ dx: -1.27, dy: 0, w: 1.6, h: 1.6, shape: 'circle', layer: 'both', holeR: 0.4 }, { dx: 1.27, dy: 0, w: 1.6, h: 1.6, shape: 'circle', layer: 'both', holeR: 0.4 }];
// SOT-23-6（0.95 节距，pad 0.5）
const sot236 = [
  { dx: -0.95, dy: 0.95, w: 0.5, h: 0.9 }, { dx: 0, dy: 0.95, w: 0.5, h: 0.9 }, { dx: 0.95, dy: 0.95, w: 0.5, h: 0.9 },
  { dx: 0.95, dy: -0.95, w: 0.5, h: 0.9 }, { dx: 0, dy: -0.95, w: 0.5, h: 0.9 }, { dx: -0.95, dy: -0.95, w: 0.5, h: 0.9 }];
// MSOP-10（INA226）
const msop10 = (() => { const P = [], s = 2 * 0.65; for (let k = 0; k < 5; k++) P.push({ dx: -2.3, dy: -s + k * 0.65, w: 1.4, h: 0.35 }); for (let k = 4; k >= 0; k--) P.push({ dx: 2.3, dy: -s + k * 0.65, w: 1.4, h: 0.35 }); return P; })();
// HSOP-28 + 散热盘（TMC2209）：pad 编号 29
const hsop28 = sidePairs28();
function sidePairs28() {
  const P = [], s = (14 - 1) / 2 * 0.65, w = 4.6;
  for (let k = 0; k < 14; k++) P.push({ dx: -w, dy: -s + k * 0.65, w: 1.5, h: 0.4 });
  for (let k = 13; k >= 0; k--) P.push({ dx: w, dy: -s + k * 0.65, w: 1.5, h: 0.4 });
  P.push({ dx: 0, dy: 0, w: 5.4, h: 6.4 });   // pad 29 = 散热盘
  return P;
}
// PLCC-44 J 引脚（1.27 节距，径向长 1.8；A=s+1.35 保证四角相邻边焊盘矩形间隙 0.125）
const plcc44 = qfpPads(11, 1.27, 0.65, 1.8, 1.45);
// 9-pin 电子管座（圆周 + 中心固定孔）
const tube9 = (() => {
  const P = [];
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * 2 * Math.PI + 0.35;
    P.push({ dx: +(Math.cos(a) * 5.85).toFixed(3), dy: +(Math.sin(a) * 5.85).toFixed(3), w: 2.6, h: 2.6, shape: 'circle', layer: 'both', holeR: 0.6 });
  }
  P.push({ dx: 0, dy: 0, w: 3.4, h: 3.4, shape: 'circle', layer: 'both', holeR: 1.2 });
  return P;
})();
// DIN-6（PS/2）：6 pin 圆周 + 2 屏蔽孔
const din6 = (() => {
  const P = [];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * 2 * Math.PI + Math.PI / 6;
    P.push({ dx: +(Math.cos(a) * 4.72).toFixed(3), dy: +(Math.sin(a) * 4.72).toFixed(3), w: 2.2, h: 2.2, shape: 'circle', layer: 'both', holeR: 0.7 });
  }
  P.push({ dx: -8, dy: 0, w: 3.0, h: 3.0, shape: 'circle', layer: 'both', holeR: 1.2 });
  P.push({ dx: 8, dy: 0, w: 3.0, h: 3.0, shape: 'circle', layer: 'both', holeR: 1.2 });
  return P;
})();
// 3.5mm 音频插座：3 信号 THT + 2 固定孔
const jack35 = hd(3).concat([
  { dx: -4, dy: -3, w: 2.6, h: 2.6, shape: 'circle', layer: 'both', holeR: 1.0 },
  { dx: 4, dy: 3, w: 2.6, h: 2.6, shape: 'circle', layer: 'both', holeR: 1.0 }]);
// 金手指 32 pin（板下边缘，焊盘延伸到 y=0，双面无孔）
const edge32 = Array.from({ length: 32 }, (_, k) => ({ dx: (k - 15.5) * 1.27, dy: 1.6, w: 0.85, h: 3.2, layer: 'both' }));
const tcrt4 = hd(4);

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
  return { d, pads, add, place, compsMeta, save(subdir) {
    d.pads = pads; d.comps = compsMeta;
    mkdirSync(new URL(subdir + '/', base), { recursive: true });
    writeFileSync(new URL(subdir + '/design.json', base), JSON.stringify(d, null, 1));
    console.log(name + ':', pads.length, 'pads /', d.nets.length, 'nets');
  }};
}
const CM = (x, y, rot, value, footprint) => ({ x, y, rot, layer: 'top', value, footprint });

// ============ 简单档 ============

// n73: Si5351 时钟发生器 —— SOIC-10 首测 + 三路时钟输出
{
  const nets = ['v33', 'gnd', 'sda', 'scl', 'x1', 'x2', 'c0', 'c1', 'c2'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n73 Si5351 时钟发生器', { width: 30, height: 20, nets });
  const so10 = mk('SOIC-10');
  const u1n = ['x1', 'x2', 'gnd', 'sda', 'scl', 'c0', 'gnd', 'c1', 'gnd', 'c2'];
  so10.forEach((f, i) => c.add('U1', i + 1, u1n[i], 11 + f.dx, 10 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U1 = CM(11, 10, 0, 'Si5351A', 'SOIC-10');
  c.place('Y1', xtal2, 4, 8, ['x1', 'x2'], CM(4, 8, 0, '25MHz', 'XTAL-3225'));
  c.place('C1', fp402, 4, 13, ['x1', 'gnd'], CM(4, 13, 0, '10p', 'C0402'));
  c.place('C2', fp402, 7, 13, ['x2', 'gnd'], CM(7, 13, 0, '10p', 'C0402'));
  c.place('C3', fp805, 18, 10, ['v33', 'gnd'], CM(18, 10, 0, '100n', 'C0805'));
  c.place('J1', hd(4), 5.5, 4, ['v33', 'gnd', 'sda', 'scl'], CM(5.5, 4, 0, 'I2C', 'HDR-4P'));
  c.place('J2', hd(4), 25, 10, ['c0', 'c1', 'c2', 'gnd'], CM(25, 10, 90, 'CLK', 'HDR-4P'));
  c.save('n73-si5351');
}

// n74: 锂电升压 5V —— SOT-23-6 升压拓扑 + 功率电感 THT
{
  const nets = ['vin', 'gnd', 'sw', 'fb', 'vout'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n74 锂电升压 5V', { width: 26, height: 20, grid: 0.3, trackW: 0.15, clearance: 0.15, viaOuter: 0.6, viaDrill: 0.3, nets });
  c.place('U1', sot236, 9, 10, ['sw', 'gnd', 'fb', 'vin', 'vout', 'vin'], CM(9, 10, 0, 'FP6291', 'SOT-23-6'));
  c.place('L1', indTHT, 4, 10, ['vin', 'sw'], CM(4, 10, 0, '4.7uH', 'IND-744'));
  c.place('D1', [{ dx: -1.55, dy: 0, w: 1.0, h: 1.25 }, { dx: 1.55, dy: 0, w: 1.0, h: 1.25 }], 16, 10, ['sw', 'vout'], CM(16, 10, 0, 'SS14', 'SOD-123'));
  c.place('C1', fp805, 4, 16, ['vin', 'gnd'], CM(4, 16, 0, '22u', 'C0805'));
  c.place('C2', fp1206, 20, 6, ['vout', 'gnd'], CM(20, 6, 0, '22u', 'C1206'));
  c.place('C3', fp1206, 22.5, 6, ['vout', 'gnd'], CM(22.5, 6, 0, '22u', 'C1206'));
  c.place('R1', fp603, 13, 15, ['vout', 'fb'], CM(13, 15, 0, '680k', 'R0603'));
  c.place('R2', fp603, 17, 15, ['fb', 'gnd'], CM(17, 15, 0, '150k', 'R0603'));
  c.place('J1', term(2), 4.2, 4, ['vin', 'gnd'], CM(4.2, 4, 0, 'BAT', 'TB-2P'));
  c.place('J2', hd(2), 23.5, 16, ['vout', 'gnd'], CM(23.5, 16, 0, '5V', 'HDR-2P'));
  c.save('n74-boost-5v');
}

// n75: PS/2 键盘接口 —— DIN-6 圆周连接器首测
{
  const nets = ['v5', 'gnd', 'clk', 'dat', 'sh'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n75 PS/2 键盘接口', { width: 40, height: 24, nets });
  const din6n = ['gnd', null, 'v5', 'clk', 'v5', 'dat', 'sh', 'sh'];
  din6.forEach((f, i) => c.add('J1', i + 1, din6n[i], 14 + f.dx, 12 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.J1 = CM(14, 12, 0, 'DIN-6', 'PS2-F');
  c.place('R1', fp603, 26, 8, ['v5', 'clk'], CM(26, 8, 0, '4k7', 'R0603'));
  c.place('R2', fp603, 26, 14, ['v5', 'dat'], CM(26, 14, 0, '4k7', 'R0603'));
  c.place('C1', fp805, 30, 11, ['v5', 'gnd'], CM(30, 11, 0, '100n', 'C0805'));
  c.place('J2', hd(4), 35, 12, ['v5', 'gnd', 'clk', 'dat'], CM(35, 12, 90, 'MCU', 'HDR-4P'));
  c.save('n75-ps2-if');
}

// n76: 驻极体麦克风前放 —— 3.5mm 插座首测 + 单电源同相放大
{
  const nets = ['v5', 'gnd', 'mic_p', 'in', 'out', 'fb', 'out_j'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n76 麦克风前放', { width: 36, height: 22, nets });
  c.place('MIC1', [{ dx: -1.27, dy: 0, w: 1.3, h: 1.3, shape: 'circle', layer: 'both', holeR: 0.35 }, { dx: 1.27, dy: 0, w: 1.3, h: 1.3, shape: 'circle', layer: 'both', holeR: 0.35 }], 5, 8, ['v5', 'mic_p'], CM(5, 8, 0, 'ECM', 'MIC-6'));
  c.place('R1', fp603, 5, 13, ['v5', 'mic_p'], CM(5, 13, 90, '2k2', 'R0603'));
  c.place('C1', fp805, 10, 8, ['mic_p', 'in'], CM(10, 8, 0, '1u', 'C0805'));
  const so8 = mk('SOIC-8');
  c.place('U1', so8, 17, 11, ['null', 'fb', 'out', 'gnd', 'in', null, null, 'v5'].map(x => x === 'null' ? null : x), CM(17, 11, 0, 'LM358', 'SOIC-8'));
  c.place('R2', fp603, 17, 17, ['in', 'gnd'], CM(17, 17, 0, '1k', 'R0603'));
  c.place('R3', fp603, 23, 8, ['out', 'fb'], CM(23, 8, 0, '100k', 'R0603'));
  c.place('R4', fp603, 23, 13, ['fb', 'gnd'], CM(23, 13, 0, '1k', 'R0603'));
  c.place('C2', fp805, 28, 8, ['out', 'out_j'], CM(28, 8, 0, '1u', 'C0805'));
  const jack35n = ['out_j', 'gnd', null, 'gnd', 'gnd'];
  jack35.forEach((f, i) => c.add('J1', i + 1, jack35n[i], 30 + f.dx, 14 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.J1 = CM(30, 14, 0, 'PJ-302', 'JACK-3.5');
  c.place('C3', fp805, 10, 17, ['v5', 'gnd'], CM(10, 17, 0, '100n', 'C0805'));
  c.save('n76-mic-pre');
}

// n77: IR 对管避障 ×2 —— TCRT5000 反射对管 + 双比较器
{
  const nets = ['v5', 'gnd', 's1', 's2', 'a1', 'a2', 'o1', 'o2', 'cmp1', 'cmp2'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n77 IR 对管避障', { width: 46, height: 20, nets });
  c.place('U1', tcrt4, 8, 8, ['a1', 'gnd', 's1', 'gnd'], CM(8, 8, 0, 'TCRT5000', 'TCRT'));
  c.place('U2', tcrt4, 8, 15, ['a2', 'gnd', 's2', 'gnd'], CM(8, 15, 0, 'TCRT5000', 'TCRT'));
  c.place('R1', fp603, 14, 6, ['v5', 'a1'], CM(14, 6, 0, '150R', 'R0603'));
  c.place('R2', fp603, 14, 11, ['v5', 'a2'], CM(14, 11, 0, '150R', 'R0603'));
  c.place('R3', fp603, 14, 16, ['v5', 's1'], CM(14, 16, 0, '10k', 'R0603'));
  c.place('R4', fp603, 18, 16, ['v5', 's2'], CM(18, 16, 0, '10k', 'R0603'));
  const so8 = mk('SOIC-8');
  c.place('U3', so8, 28, 11, ['o1', 'cmp1', 's1', 'gnd', 's2', 'cmp2', 'o2', 'v5'], CM(28, 11, 0, 'LM393', 'SOIC-8'));
  c.place('R5', fp603, 36, 8, ['o1', 'cmp1'], CM(36, 8, 0, '100k', 'R0603'));
  c.place('R6', fp603, 36, 14, ['o2', 'cmp2'], CM(36, 14, 0, '100k', 'R0603'));
  c.place('R7', thR, 41, 6, ['cmp1', 'cmp2'], CM(41, 6, 0, '100k', 'R-THT'));
  c.place('J1', hd(4), 41, 15, ['v5', 'gnd', 'o1', 'o2'], CM(41, 15, 90, 'OUT', 'HDR-4P'));
  c.save('n77-ir-obstacle');
}

// ============ 中等档 ============

// n78: 增量编码器差分接收 —— AM26LS32 + ABZ 差分端子
{
  const nets = ['v5', 'gnd', 'ap', 'an', 'bp', 'bn', 'zp', 'zn', 'a', 'b', 'z'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n78 编码器差分接收', { width: 46, height: 26, nets });
  const so16 = mk('SOIC-16');
  const u1n = ['a', 'ap', 'an', 'gnd', 'bp', 'bn', 'b', 'zp', 'zn', 'z', null, null, null, null, 'v5', null];
  so16.forEach((f, i) => c.add('U1', i + 1, u1n[i], 22 + f.dx, 13 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U1 = CM(22, 13, 0, 'AM26LS32', 'SOIC-16');
  c.place('J1', term(6), 23, 22, ['ap', 'an', 'bp', 'bn', 'zp', 'zn'], CM(23, 22, 0, 'ENC', 'TB-6P'));
  c.place('R1', fp1206, 15, 6, ['ap', 'an'], CM(15, 6, 0, '120R', 'R1206'));
  c.place('R2', fp1206, 15, 20, ['bp', 'bn'], CM(15, 20, 0, '120R', 'R1206'));
  c.place('C1', fp805, 22, 6, ['v5', 'gnd'], CM(22, 6, 0, '100n', 'C0805'));
  c.place('J2', hd(5), 40, 13, ['v5', 'gnd', 'a', 'b', 'z'], CM(40, 13, 90, 'MCU', 'HDR-5P'));
  c.save('n78-enc-diff');
}

// n79: 多路 INA226 电流监测 —— MSOP-10 首测 + I2C 链 + 3 检测点
{
  const nets = ['v33', 'gnd', 'sda', 'scl', 'bus_p', 'm1', 'm2', 'm3'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n79 多路电流监测', { width: 50, height: 26, grid: 0.325, trackW: 0.2, clearance: 0.1, viaOuter: 0.6, viaDrill: 0.3, nets });
  const inaN = (k, a0net) => [null, 'bus_p', `m${k}`, 'gnd', 'v33', 'sda', 'scl', a0net, null, 'gnd'];
  for (let k = 0; k < 3; k++) {
    const x = 14 + k * 12;
    msop10.forEach((f, i) => c.add(`U${k + 1}`, i + 1, inaN(k + 1, k === 0 ? 'gnd' : k === 1 ? 'v33' : 'sda')[i], x + f.dx, 10 + f.dy, f.w, f.h, f.shape, f.layer));
    c.compsMeta[`U${k + 1}`] = CM(x, 10, 0, 'INA226', 'MSOP-10');
    c.place(`R${k + 1}`, fp1206, x - 5, 19, ['bus_p', `m${k + 1}`], CM(x - 5, 19, 0, '2mR', 'R2512'));
    c.place(`C${k + 1}`, fp402, x + 4, 18, ['v33', 'gnd'], CM(x + 4, 18, 0, '100n', 'C0402'));
  }
  c.place('J1', hd(4), 5.5, 10, ['v33', 'gnd', 'sda', 'scl'], CM(5.5, 10, 90, 'I2C', 'HDR-4P'));
  c.place('J2', term(4), 40, 22, ['bus_p', 'm1', 'm2', 'm3'], CM(40, 22, 0, 'LOAD', 'TB-4P'));
  c.save('n79-ina226');
}

// n80: I2S 音频 DAC —— TSSOP-20 首测 + 数字音频链
{
  const nets = ['v33', 'gnd', 'sck', 'bck', 'din', 'lrck', 'out_l', 'out_r', 'agnd'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n80 I2S 音频 DAC', { width: 50, height: 28, grid: 0.325, trackW: 0.2, clearance: 0.1, viaOuter: 0.6, viaDrill: 0.3, nets });
  const tssop20 = [];
  { const s = (10 - 1) / 2 * 0.65; for (let k = 0; k < 10; k++) tssop20.push({ dx: -3.0, dy: -s + k * 0.65, w: 1.45, h: 0.4 }); for (let k = 9; k >= 0; k--) tssop20.push({ dx: 3.0, dy: -s + k * 0.65, w: 1.45, h: 0.4 }); }
  const u1n = ['sck', 'gnd', 'bck', 'gnd', 'din', 'lrck', 'gnd', 'v33', null, null, 'out_l', 'gnd', 'out_r', 'agnd', null, 'v33', null, null, 'gnd', 'v33'];
  tssop20.forEach((f, i) => c.add('U1', i + 1, u1n[i], 20 + f.dx, 14 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U1 = CM(20, 14, 0, 'PCM5102', 'TSSOP-20');
  c.place('C1', fp402, 20, 6, ['v33', 'gnd'], CM(20, 6, 0, '100n', 'C0402'));
  c.place('C2', fp402, 24, 6, ['agnd', 'gnd'], CM(24, 6, 0, '0R', 'R0402'));
  c.place('C3', fp805, 13, 14, ['out_l', 'agnd'], CM(13, 14, 0, '2n2', 'C0805'));
  c.place('C4', fp805, 13, 20, ['out_r', 'agnd'], CM(13, 20, 0, '2n2', 'C0805'));
  c.place('J1', hd(6), 7.5, 14, ['v33', 'gnd', 'lrck', 'bck', 'din', 'sck'], CM(7.5, 14, 90, 'I2S', 'HDR-6P'));
  c.place('J2', hd(3), 42, 14, ['out_l', 'agnd', 'out_r'], CM(42, 14, 90, 'AOUT', 'HDR-3P'));
  c.save('n80-i2s-dac');
}

// n81: PCA9685 伺服驱动 —— TSSOP-28 首测 + PWM 扇出
{
  const nets = ['v33', 'gnd', 'sda', 'scl', 'oe', 'xi', 'vplus', 'p0', 'p1', 'p2', 'p3'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n81 PCA9685 伺服驱动', { width: 56, height: 30, grid: 0.325, trackW: 0.2, clearance: 0.1, viaOuter: 0.6, viaDrill: 0.3, nets });
  const tssop28 = [];
  { const s = (14 - 1) / 2 * 0.65; for (let k = 0; k < 14; k++) tssop28.push({ dx: -3.9, dy: -s + k * 0.65, w: 1.5, h: 0.4 }); for (let k = 13; k >= 0; k--) tssop28.push({ dx: 3.9, dy: -s + k * 0.65, w: 1.5, h: 0.4 }); }
  const u1n = ['p0', 'p1', 'p2', 'p3', null, null, null, null, 'oe', 'gnd', 'xi', null, 'scl', 'sda',
    'gnd', 'v33', 'gnd', 'vplus', null, null, null, null, null, null, null, null, null, null];
  tssop28.forEach((f, i) => c.add('U1', i + 1, u1n[i], 20 + f.dx, 15 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U1 = CM(20, 15, 0, 'PCA9685', 'TSSOP-28');
  for (let k = 0; k < 4; k++) {
    const y = 6 + k * 6.5;
    c.place(`J${k + 2}`, hd(3), 42, y, ['vplus', 'gnd', `p${k}`], CM(42, y, 0, 'SRV', 'HDR-3P'));
  }
  c.place('J1', hd(6), 7.5, 15, ['v33', 'gnd', 'sda', 'scl', 'oe', 'xi'], CM(7.5, 15, 90, 'CTRL', 'HDR-6P'));
  c.place('J5', term(2), 12, 27, ['vplus', 'gnd'], CM(12, 27, 0, 'PWR', 'TB-2P'));
  c.place('C1', fp402, 20, 6, ['v33', 'gnd'], CM(20, 6, 0, '100n', 'C0402'));
  c.place('C2', fp805, 28, 6, ['vplus', 'gnd'], CM(28, 6, 0, '100n', 'C0805'));
  c.save('n81-pca9685');
}

// n82: 多风扇温控 —— 4-pin 风扇座阵列 + 转速采样
{
  const nets = ['v12', 'gnd', 'v5', 'tach1', 'tach2', 'tach3', 'tach4', 'pwm1', 'pwm2', 'pwm3', 'pwm4', 'sda', 'scl'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n82 多风扇温控', { width: 56, height: 28, nets });
  const so16 = mk('SOIC-16');
  const u1n = ['pwm1', 'pwm2', 'pwm3', 'pwm4', 'gnd', 'tach1', 'tach2', 'tach3',
    'tach4', 'v5', 'sda', 'scl', 'gnd', null, null, 'v5'];
  so16.forEach((f, i) => c.add('U1', i + 1, u1n[i], 24 + f.dx, 14 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U1 = CM(24, 14, 0, 'MCU-FAN', 'SOIC-16');
  for (let k = 0; k < 4; k++) {
    const y = 5 + k * 6.5;
    c.place(`J${k + 2}`, hd(4), 46, y, ['v12', 'gnd', 'tach' + (k + 1), 'pwm' + (k + 1)], CM(46, y, 0, 'FAN', 'HDR-4P'));
  }
  const so8 = mk('SOIC-8');
  c.place('U2', so8, 12, 14, ['sda', 'scl', null, 'gnd', null, null, null, 'v5'], CM(12, 14, 0, 'LM75', 'SOIC-8'));
  c.place('J1', term(2), 4, 5, ['v12', 'gnd'], CM(4, 5, 0, '12V', 'TB-2P'));
  c.place('C1', fp805, 10, 5, ['v12', 'gnd'], CM(10, 5, 0, '10u', 'C0805'));
  c.place('C2', fp805, 14, 22, ['v5', 'gnd'], CM(14, 22, 0, '100n', 'C0805'));
  c.save('n82-fan-ctrl');
}

// ============ 困难档 ============

// n83: PLC 8 路光耦隔离输入 —— 光耦 THT 阵列 + 双侧端子排
{
  const nets = [];  // 地址 a0-a7
  for (let k = 1; k <= 8; k++) nets.push({ id: `in${k}`, name: `IN${k}` });
  for (let k = 1; k <= 8; k++) nets.push({ id: `out${k}`, name: `OUT${k}` });
  nets.push({ id: 'com_in', name: 'COM_IN' }, { id: 'v5', name: 'V5' });
  const c = makeDesign('n83 PLC 8 路隔离输入', { width: 86, height: 36, nets });
  const dip4 = mk('DIP-N', 4);
  for (let k = 0; k < 8; k++) {
    const x = 14 + k * 8.5;
    dip4.forEach((f, i) => c.add(`U${k + 1}`, i + 1, [`in${k + 1}`, `out${k + 1}`, 'com_in', 'v5'][i] || null, x + f.dx, 12 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
    c.compsMeta[`U${k + 1}`] = CM(x, 12, 0, 'PC817', 'DIP-4');
    c.place(`R${k + 1}`, fp1206, x - 1.5, 4, [`in${k + 1}`, 'com_in'], CM(x - 1.5, 4, 0, '2k2', 'R1206'));
    c.place(`R${k + 9}`, fp603, x - 1.5, 20, [`out${k + 1}`, 'v5'], CM(x - 1.5, 20, 0, '10k', 'R0603'));
  }
  c.place('J1', term(9), 43, 31, ['in1', 'in2', 'in3', 'in4', 'in5', 'in6', 'in7', 'in8', 'com_in'], CM(43, 31, 0, 'INPUT', 'TB-9P'));
  c.place('J2', hd(9), 43, 4, ['v5', 'out1', 'out2', 'out3', 'out4', 'out5', 'out6', 'out7', 'out8'], CM(43, 4, 0, 'OUT', 'HDR-9P'));
  c.save('n83-plc-input');
}

// n84: TMC2209 步进驱动 —— HSOP-28 散热盘首测 + 电机功率
{
  const nets = ['vm', 'gnd', 'v33', 'oa1', 'oa2', 'ob1', 'ob2', 'iref', 'utx', 'urx', 'en', 'vref'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n84 TMC2209 步进驱动', { width: 56, height: 40, grid: 0.325, trackW: 0.2, clearance: 0.1, viaOuter: 0.6, viaDrill: 0.3, nets });
  const u1n = ['en', 'utx', 'urx', 'vref', 'iref', 'gnd', 'gnd', 'oa1', 'gnd', 'vm', 'ob1', 'gnd', 'vm', 'gnd',
    'gnd', 'vm', 'gnd', 'ob2', 'vm', 'gnd', 'oa2', 'gnd', 'vm', 'gnd', 'v33', 'gnd', 'v33', 'gnd', 'gnd'];
  hsop28.forEach((f, i) => c.add('U1', i + 1, u1n[i] || 'gnd', 26 + f.dx, 17 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.U1 = CM(26, 17, 0, 'TMC2209', 'HSOP-28');
  c.place('J1', term(4), 12, 34, ['oa1', 'oa2', 'ob1', 'ob2'], CM(12, 34, 0, 'MOTOR', 'TB-4P'));
  c.place('J2', term(2), 30, 34, ['vm', 'gnd'], CM(30, 34, 0, 'VM', 'TB-2P'));
  c.place('J3', hd(6), 48, 30, ['v33', 'gnd', 'utx', 'urx', 'en', 'gnd'], CM(48, 30, 90, 'UART', 'HDR-6P'));
  c.place('R1', fp402, 15, 8, ['iref', 'gnd'], CM(15, 8, 0, '12k', 'R0402'));
  c.place('R2', fp402, 38, 8, ['vref', 'v33'], CM(38, 8, 0, '10k', 'R0402'));
  c.place('C1', fp402, 18, 8, ['v33', 'gnd'], CM(18, 8, 0, '100n', 'C0402'));
  c.place('C2', fp402, 34, 8, ['v33', 'gnd'], CM(34, 8, 0, '100n', 'C0402'));
  c.place('C3', fp805, 20, 30, ['vm', 'gnd'], CM(20, 30, 0, '100n', 'C0805'));
  c.place('C4', fp805, 25, 30, ['vm', 'gnd'], CM(25, 30, 0, '10u', 'C0805'));
  c.save('n84-tmc2209');
}

// n85: T12 烙铁控制器 —— 热电偶模拟 + 加热功率 MOS 混合
{
  const nets = ['vm', 'gnd', 'heat', 'tc', 'amp', 'pwm_g', 'v33', 'urx', 'utx'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n85 T12 烙铁控制器', { width: 60, height: 40, nets });
  c.place('J1', term(3), 8, 32, ['heat', 'tc', 'gnd'], CM(8, 32, 0, 'T12', 'TB-3P'));
  c.place('Q1', to220, 16, 24, ['pwm_g', 'vm', 'heat'], CM(17.54, 24, 0, 'AO3400', 'TO-220'));
  c.place('R1', fp1206, 24, 32, ['heat', 'gnd'], CM(24, 32, 0, '0R01', 'R2512'));
  const so8 = mk('SOIC-8');
  c.place('U2', so8, 30, 12, ['amp', 'null', 'null', 'gnd', 'null', 'null', 'tc', 'v33'].map(x => x === 'null' ? null : x), CM(30, 12, 0, 'LM358', 'SOIC-8'));
  c.place('R2', fp603, 30, 6, ['tc', 'gnd'], CM(30, 6, 0, '6k8', 'R0603'));
  c.place('R3', fp603, 35, 6, ['tc', 'amp'], CM(35, 6, 0, '1M', 'R0603'));
  const so16 = mk('SOIC-16');
  const u1n = ['pwm_g', null, 'amp', null, null, null, 'gnd', null, 'urx', 'utx', null, null, 'v33', 'gnd', null, 'v33'];
  so16.forEach((f, i) => c.add('U1', i + 1, u1n[i], 44 + f.dx, 20 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U1 = CM(44, 20, 0, 'MCU-T12', 'SOIC-16');
  c.place('J2', hd(4), 54, 6, ['v33', 'gnd', 'urx', 'utx'], CM(54, 6, 90, 'SER', 'HDR-4P'));
  c.place('C1', fp805, 10, 8, ['vm', 'gnd'], CM(10, 8, 0, '100n', 'C0805'));
  c.place('C2', fp805, 38, 30, ['v33', 'gnd'], CM(38, 30, 0, '100n', 'C0805'));
  c.place('R4', fp603, 40, 12, ['heat', 'amp'], CM(40, 12, 0, '100k', 'R0603'));
  c.save('n85-t12');
}

// n86: 74141 辉光管驱动 —— 170V 高压 + BCD 星形出线
{
  const nets = [];  // 地址 a0-a7
  ['a', 'b', 'c', 'd'].forEach(k => nets.push({ id: 'bcd_' + k, name: 'BCD_' + k.toUpperCase() }));
  nets.push({ id: 'hv', name: 'HV' }, { id: 'anode', name: 'ANODE' }, { id: 'gnd', name: 'GND' });
  for (let k = 0; k < 10; k++) nets.push({ id: 'n' + k, name: 'N' + k });
  const c = makeDesign('n86 辉光管驱动', { width: 50, height: 34, clearance: 0.3, nets });
  const dip16 = mk('DIP-N', 16);
  const u1n = ['gnd', 'n9', 'n8', 'n7', 'n6', 'n5', 'n4', 'n3', 'n2', 'n1', 'n0', 'bcd_a', 'bcd_b', 'bcd_c', 'bcd_d', 'hv'];
  dip16.forEach((f, i) => c.add('U1', i + 1, u1n[i], 20 + f.dx, 14 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.U1 = CM(20, 14, 0, '74141', 'DIP-16');
  c.place('R1', thR, 32, 22, ['hv', 'anode'], CM(32, 22, 0, '15k', 'R-THT'));
  c.place('J1', hd2x(6), 36, 10, ['n0', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'n9', 'anode', 'gnd'], CM(36, 10, 0, 'NIXIE', 'HDR-2x6'));
  c.place('J2', hd(5), 6, 14, ['bcd_a', 'bcd_b', 'bcd_c', 'bcd_d', 'gnd'], CM(6, 14, 90, 'BCD', 'HDR-5P'));
  c.place('J3', hd(2), 6, 26, ['hv', 'gnd'], CM(6, 26, 0, 'HV', 'HDR-2P'));
  c.save('n86-nixie');
}

// n87: 可编程电子负载 —— 功率 MOS 环 + 运放控制
{
  const nets = ['dut_p', 'gnd', 'gate', 'sns', 'ctrl', 'adc_v', 'v5', 'urx', 'utx'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n87 可编程电子负载', { width: 60, height: 40, nets });
  c.place('Q1', to220, 18, 12, ['gate', 'dut_p', 'sns'], CM(19.54, 12, 0, 'IRF3205', 'TO-220'));
  c.place('Q2', to220, 18, 24, ['gate', 'dut_p', 'sns'], CM(19.54, 24, 0, 'IRF3205', 'TO-220'));
  c.place('R1', fp1206, 26, 12, ['sns', 'gnd'], CM(26, 12, 90, '0R05', 'R2512'));
  c.place('R2', fp1206, 26, 20, ['sns', 'gnd'], CM(26, 20, 90, '0R05', 'R2512'));
  const so8 = mk('SOIC-8');
  c.place('U2', so8, 34, 16, ['gate', 'null', 'null', 'gnd', 'sns', 'null', 'ctrl', 'v5'].map(x => x === 'null' ? null : x), CM(34, 16, 0, 'LM358', 'SOIC-8'));
  const so16 = mk('SOIC-16');
  const u1n = ['adc_v', null, 'ctrl', null, null, null, 'gnd', null, 'urx', 'utx', null, null, 'v5', 'gnd', null, 'v5'];
  so16.forEach((f, i) => c.add('U1', i + 1, u1n[i], 46 + f.dx, 20 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U1 = CM(46, 20, 0, 'MCU-LOAD', 'SOIC-16');
  c.place('J1', term(2), 6, 18, ['dut_p', 'gnd'], CM(6, 18, 90, 'DUT', 'TB-2P'));
  c.place('J2', hd(4), 54, 6, ['v5', 'gnd', 'urx', 'utx'], CM(54, 6, 90, 'SER', 'HDR-4P'));
  c.place('R3', fp603, 34, 8, ['sns', 'adc_v'], CM(34, 8, 0, '10k', 'R0603'));
  c.place('C1', fp805, 10, 8, ['dut_p', 'gnd'], CM(10, 8, 0, '100n', 'C0805'));
  c.place('C2', fp805, 40, 30, ['v5', 'gnd'], CM(40, 30, 0, '100n', 'C0805'));
  c.save('n87-eload');
}

// ============ 超难档 ============

// n88: HUB75 双口转接驱动 —— 2×16 宽总线 + 74HC245 阵列
{
  const hubNets = ['gnd', 'r1', 'g1', 'b1', 'r2', 'g2', 'b2', 'a', 'b', 'c', 'd', 'clk', 'lat', 'oe'];
  const nets = [...new Set(hubNets)].concat(['v5']).map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n88 HUB75 双口驱动', { width: 86, height: 44, nets });
  const so20 = mk('SOIC-20');
  const busN = ['gnd', 'oe', 'b2', 'g2', 'r2', 'b1', 'g1', 'r1', 'lat', 'clk', 'd', 'c', 'b', 'a', 'gnd', 'v5', null, null, null, null];
  for (let k = 0; k < 3; k++) {
    const x = 22 + k * 14;
    so20.forEach((f, i) => c.add(`U${k + 1}`, i + 1, busN[i], x + f.dx, 22 + f.dy, f.w, f.h, f.shape, f.layer));
    c.compsMeta[`U${k + 1}`] = CM(x, 22, 0, '74HC245', 'SOIC-20');
  }
  const hubN = ['gnd', 'gnd', 'r1', 'r2', 'b1', 'b2', 'g1', 'g2', 'a', 'b', 'c', 'd', 'clk', 'lat', 'oe', 'gnd'];
  hd2x(8).forEach((f, i) => c.add('J1', i + 1, hubN[i], 11 + f.dx, 10 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.J1 = CM(11, 10, 0, 'HUB75-1', 'HDR-2x8');
  hd2x(8).forEach((f, i) => c.add('J2', i + 1, hubN[i], 11 + f.dx, 36 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.J2 = CM(11, 36, 0, 'HUB75-2', 'HDR-2x8');
  c.place('J3', hd2x(8), 72, 22, ['a', 'b', 'c', 'd', 'clk', 'lat', 'oe', 'gnd', 'r1', 'g1', 'b1', 'r2', 'g2', 'b2', 'v5', 'gnd'], CM(72, 22, 0, 'MCU', 'HDR-2x8'));
  c.save('n88-hub75');
}

// n89: 金手指载板 —— 板边焊盘几何首测（J1 锚定在 y=0 板边）
{
  const nets = [];  // 地址 a0-a7
  for (let k = 0; k < 8; k++) nets.push({ id: `a${k}`, name: `A${k}` });
  for (let k = 0; k < 8; k++) nets.push({ id: `d${k}`, name: `D${k}` });
  ['ior', 'iow', 'reset', 'clk', 'irq', 'vcc', 'gnd'].forEach(k => nets.push({ id: k, name: k.toUpperCase() }));
  const c = makeDesign('n89 金手指载板', { width: 72, height: 50, nets });
  // 金手指 32 pin 贴下板边（y=0），双面——spec 位置即锚定位置
  const edgeN = ['gnd', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'gnd', 'vcc', 'gnd', 'vcc',
    'd0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'ior', 'iow', 'reset', 'clk', 'irq',
    'vcc', 'vcc', 'gnd', 'gnd', 'gnd', 'gnd'];
  edge32.forEach((f, i) => c.add('J1', i + 1, edgeN[i], 20.5 + f.dx, 1.6 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.J1 = CM(20.5, 1.6, 0, 'EDGE-32', 'GOLD-32');
  const so14 = mk('SOIC-14');
  c.place('U1', so14, 35, 28, ['d0', 'd1', 'd2', 'gnd', 'ior', 'iow', 'a0', 'gnd', 'a1', 'a2', 'reset', 'clk', 'vcc', null], CM(35, 28, 0, '74HC00', 'SOIC-14'));
  c.place('U2', so14, 55, 28, ['d3', 'd4', 'd5', 'gnd', 'irq', 'reset', 'a3', 'gnd', 'a4', 'a5', 'a6', 'a7', 'vcc', null], CM(55, 28, 0, '74HC08', 'SOIC-14'));
  c.place('J2', hd(8), 10, 40, ['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7'], CM(10, 40, 0, 'EXP', 'HDR-8P'));
  c.place('C1', fp805, 24, 40, ['vcc', 'gnd'], CM(24, 40, 0, '100n', 'C0805'));
  c.place('C2', fp805, 45, 40, ['vcc', 'gnd'], CM(45, 40, 0, '100n', 'C0805'));
  c.save('n89-goldfinger');
}

// n90: PLCC-44 载板 —— J 型引脚封装首测
{
  const nets = ['vcc', 'gnd', 'x1', 'x2', 'rst'];
  for (let k = 0; k < 8; k++) nets.push(`p${k}`);
  for (let k = 0; k < 8; k++) nets.push(`k${k}`);
  const netObjs = nets.map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n90 PLCC-44 载板', { width: 66, height: 52, nets: netObjs });
  const plccN = [];
  for (let k = 0; k < 44; k++) {
    const m = { 1: 'x1', 2: 'x2', 3: 'rst', 22: 'vcc', 23: 'gnd', 44: 'gnd' };
    if (m[k + 1]) plccN.push(m[k + 1]);
    else if (k % 4 === 0) plccN.push('gnd');
    else if (k % 4 === 2) plccN.push('vcc');
    else if (k % 8 === 1) plccN.push(`p${Math.floor(k / 8) % 8}`);
    else if (k % 8 === 3) plccN.push(`k${Math.floor(k / 8) % 8}`);
    else plccN.push(null);
  }
  // 补齐 p/k 每网 ≥2 焊盘
  const seen = new Set(plccN.filter(n => n && (n.startsWith('p') || n.startsWith('k'))));
  for (let k = 0; k < 8; k++) {
    if (!seen.has(`p${k}`)) { const idx = plccN.indexOf(null); if (idx >= 0) plccN[idx] = `p${k}`; }
    if (!seen.has(`k${k}`)) { const idx = plccN.indexOf(null, plccN.indexOf(null) + 1); if (idx >= 0) plccN[idx] = `k${k}`; }
  }
  plcc44.forEach((f, i) => c.add('U1', i + 1, plccN[i] || null, 33 + f.dx, 26 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U1 = CM(33, 26, 0, 'XC9536', 'PLCC-44');
  c.place('Y1', xtal2, 14, 12, ['x1', 'x2'], CM(14, 12, 0, '16MHz', 'XTAL-3225'));
  c.place('C1', fp402, 19, 12, ['x1', 'gnd'], CM(19, 12, 0, '20p', 'C0402'));
  c.place('C2', fp402, 19, 16, ['x2', 'gnd'], CM(19, 16, 0, '20p', 'C0402'));
  c.place('R1', fp402, 48, 12, ['rst', 'vcc'], CM(48, 12, 0, '10k', 'R0402'));
  c.place('C3', fp402, 52, 12, ['rst', 'gnd'], CM(52, 12, 0, '100n', 'C0402'));
  c.place('J1', hd(8), 11, 30, Array.from({ length: 8 }, (_, k) => `p${k}`), CM(11, 30, 90, 'IO-P', 'HDR-8P'));
  c.place('J2', hd(8), 55, 30, Array.from({ length: 8 }, (_, k) => `k${k}`), CM(55, 30, 90, 'IO-K', 'HDR-8P'));
  c.place('J3', hd(4), 33, 48, ['vcc', 'gnd', 'rst', 'gnd'], CM(33, 48, 0, 'PWR', 'HDR-4P'));
  for (let k = 0; k < 4; k++) c.place(`C${k + 4}`, fp402, 24 + k * 5, 44, ['vcc', 'gnd'], CM(24 + k * 5, 44, 0, '100n', 'C0402'));
  c.save('n90-plcc44');
}

// n91: 飞控缩减版 —— IMU + 4 电机排 + 6 通道接收机（多域混合）
{
  const nets = ['v5', 'gnd', 'sda', 'scl', 'x1', 'x2', 'swclk', 'swdio'];
  for (let k = 1; k <= 4; k++) nets.push(`m${k}`);
  for (let k = 1; k <= 6; k++) nets.push(`ch${k}`);
  const netObjs = nets.map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n91 飞控缩减版', { width: 70, height: 60, grid: 0.25, trackW: 0.15, clearance: 0.1, viaOuter: 0.5, viaDrill: 0.25, nets: netObjs });
  const qfp48 = qfpPads(12, 0.5, 0.3, 1.2);
  const rp = [];
  for (let k = 0; k < 48; k++) {
    const m = { 5: 'x1', 6: 'x2', 23: 'swdio', 24: 'swclk', 34: 'v5', 35: 'gnd', 44: 'gnd', 10: 'sda', 11: 'scl' };
    if (m[k + 1]) rp.push(m[k + 1]);
    else if (k % 6 === 0) rp.push('gnd');
    else if (k % 6 === 3) rp.push('v5');
    else if (k % 12 === 1) rp.push(`m${Math.floor(k / 12) % 4 + 1}`);
    else if (k % 8 === 2) rp.push(`ch${Math.floor(k / 8) % 6 + 1}`);
    else rp.push(null);
  }
  const seen = new Set(rp.filter(n => n && (n.startsWith('m') || n.startsWith('ch'))));
  for (let k = 0; k < 4; k++) if (!seen.has(`m${k + 1}`)) { const i = rp.indexOf(null); if (i >= 0) rp[i] = `m${k + 1}`; }
  for (let k = 0; k < 6; k++) if (!seen.has(`ch${k + 1}`)) { const i = rp.indexOf(null); if (i >= 0) rp[i] = `ch${k + 1}`; }
  qfp48.forEach((f, i) => c.add('U1', i + 1, rp[i] || null, 35 + f.dx, 30 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U1 = CM(35, 30, 0, 'STM32F103', 'LQFP-48');
  const qfn24 = qfpPads(6, 0.5, 0.3, 0.8);
  const mpu = ['v5', 'gnd', 'scl', 'sda', null, null, 'gnd', 'v5', null, null, 'gnd', 'v5', null, null, 'gnd', 'v5', null, null, null, null, null, null, null, null];
  qfn24.forEach((f, i) => c.add('U2', i + 1, mpu[i] || null, 52 + f.dx, 44 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U2 = CM(52, 44, 0, 'MPU9250', 'QFN-24');
  for (let k = 0; k < 4; k++) {
    const x = 12 + k * 14;
    c.place(`J${k + 1}`, hd(3), x, 8, ['v5', 'gnd', `m${k + 1}`], CM(x, 8, 0, 'ESC', 'HDR-3P'));
  }
  c.place('J5', hd(8), 12, 52, ['v5', 'gnd', 'ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'ch6'], CM(12, 52, 0, 'RX', 'HDR-8P'));
  c.place('Y1', xtal2, 54, 12, ['x1', 'x2'], CM(54, 12, 0, '8MHz', 'XTAL-3225'));
  c.place('C1', fp402, 59, 12, ['x1', 'gnd'], CM(59, 12, 0, '20p', 'C0402'));
  c.place('C2', fp402, 59, 16, ['x2', 'gnd'], CM(59, 16, 0, '20p', 'C0402'));
  c.place('J6', hd(4), 62, 30, ['v5', 'gnd', 'swclk', 'swdio'], CM(62, 30, 90, 'SWD', 'HDR-4P'));
  for (let k = 0; k < 4; k++) c.place(`C${k + 3}`, fp402, 22 + k * 4, 46, ['v5', 'gnd'], CM(22 + k * 4, 46, 0, '100n', 'C0402'));
  c.save('n91-fc-mini');
}

// n92: 电子管前级 —— 9-pin 胆座圆周 THT + 170V 高压 + 6.3V 灯丝
{
  const nets = ['bplus', 'p1', 'g1', 'k1', 'p2', 'g2', 'k2', 'h_a', 'h_b', 'in', 'out', 'gnd'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n92 电子管前级', { width: 80, height: 52, grid: 0.8, trackW: 0.4, clearance: 0.2, nets });
  // V1（放大级）与 V2（缓冲级）：pin1=阳极 p, pin2=栅 g, pin3=阴极 k, pin4/5=灯丝
  const v1n = ['p1', null, null, 'h_a', 'h_b', null, null, null, 'g1', null];
  tube9.forEach((f, i) => c.add('V1', i + 1, v1n[i], 26 + f.dx, 30 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.V1 = CM(26, 30, 0, '12AU7', 'TUBE-9');
  const v2n = ['p2', null, null, 'h_a', 'h_b', null, null, null, 'g2', null];
  tube9.forEach((f, i) => c.add('V2', i + 1, v2n[i], 54 + f.dx, 30 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.V2 = CM(54, 30, 0, '12AU7', 'TUBE-9');
  c.place('R1', thR, 14, 30, ['bplus', 'p1'], CM(14, 30, 0, '100k', 'R-THT'));
  c.place('R2', thR, 26, 44, ['k1', 'gnd'], CM(26, 44, 0, '1k', 'R-THT'));
  c.place('R3', thR, 42, 30, ['bplus', 'p2'], CM(42, 30, 0, '100k', 'R-THT'));
  c.place('R4', thR, 54, 44, ['k2', 'gnd'], CM(54, 44, 0, '1k', 'R-THT'));
  c.place('C1', thC, 18, 18, ['p1', 'g2'], CM(18, 18, 0, '100n', 'C-THT'));
  c.place('C2', thC, 46, 18, ['p2', 'out'], CM(46, 18, 0, '1u', 'C-THT'));
  c.place('C3', thC, 10, 40, ['g1', 'gnd'], CM(10, 40, 0, '47n', 'C-THT'));
  c.place('R5', thR, 34, 10, ['in', 'g1'], CM(34, 10, 0, '47k', 'R-THT'));
  c.place('R6', thR, 64, 30, ['g2', 'k1'], CM(64, 30, 0, '470k', 'R-THT'));
  c.place('R7', thR, 70, 40, ['g2', 'k2'], CM(70, 40, 0, '1M', 'R-THT'));
  c.place('J1', term(2), 6, 8, ['in', 'gnd'], CM(6, 8, 0, 'IN', 'TB-2P'));
  c.place('J2', term(2), 74, 10, ['out', 'gnd'], CM(74, 10, 0, 'OUT', 'TB-2P'));
  c.place('J3', term(2), 40, 48, ['bplus', 'gnd'], CM(40, 48, 0, 'B+', 'TB-2P'));
  c.place('J4', term(2), 22, 48, ['h_a', 'h_b'], CM(22, 48, 0, 'FIL', 'TB-2P'));
  c.save('n92-tube-pre');
}

// ============ 自检门 ============
let fail = 0;
const dirs = ['n73-si5351', 'n74-boost-5v', 'n75-ps2-if', 'n76-mic-pre', 'n77-ir-obstacle',
  'n78-enc-diff', 'n79-ina226', 'n80-i2s-dac', 'n81-pca9685', 'n82-fan-ctrl',
  'n83-plc-input', 'n84-tmc2209', 'n85-t12', 'n86-nixie', 'n87-eload',
  'n88-hub75', 'n89-goldfinger', 'n90-plcc44', 'n91-fc-mini', 'n92-tube-pre'];
for (const dir of dirs) {
  const d = JSON.parse(readFileSync(new URL(`${dir}/design.json`, base), 'utf8'));
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
  const byComp = new Map();
  for (const p of d.pads) {
    const comp = p.id.split('-')[0];
    if (!byComp.has(comp)) byComp.set(comp, []);
    byComp.get(comp).push(p);
  }
  for (const [comp, ps] of byComp)
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], b = ps[j];
      const ox = (a.w + b.w) / 2 - Math.abs(a.x - b.x), oy = (a.h + b.h) / 2 - Math.abs(a.y - b.y);
      // 与 DRC padGap 同口径：矩形重叠/单轴贴靠 → 负重叠量；双轴分离 → 欧氏角距
      const gap = (ox > 0 && oy > 0) ? -Math.max(ox, oy)
        : (ox > 0 ? -oy : (oy > 0 ? -ox : Math.hypot(-ox, -oy)));
      if (gap < d.clearance - 1e-9) problems.push('同元件间距 ' + comp + ': ' + a.id + '/' + b.id + ' gap=' + gap.toFixed(3));
    }
  for (const p of d.pads)
    if (p.x - p.w / 2 < -1e-9 || p.x + p.w / 2 > d.width + 1e-9 || p.y - p.h / 2 < -1e-9 || p.y + p.h / 2 > d.height + 1e-9)
      problems.push(`出板 ${p.id} @(${p.x},${p.y})`);
  if (problems.length) { console.error(`✗ ${dir}:`); problems.forEach(p => console.error('   ' + p)); fail = 1; }
  else console.log(`✓ ${dir}: 网表完整`);
}
if (fail) process.exit(1);
console.log('\n全部 20 项目自检通过');
