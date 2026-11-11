// 第九轮批量 spec 生成：N113-N132（20 项目，4 档，全部与前八轮不同的设计维度）
// 新维度：氖泡/干簧管/多圈电位器/香蕉座/卧式电解/磁保持继电器/盖革管/LD/PM T分压塔、
//         环形振荡器、PLL 反馈环、LF398 采样保持、4-20mA 电流环、倍压链、SSR、
//         文氏桥 AGC、频闪脉冲大电流、电磁阀阵列
// 自检门：坏引用/单脚网/空网/同元件间距(DRC padGap)/出板(半孔豁免)/THT 环宽（R8 L29 补齐）
import { designDefaults, footprintPads, padGap } from '../../src/engine.mjs';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';

const base = new URL('./', import.meta.url);
const mk = (n, count) => footprintPads(n, count);
const fp402 = mk('0402'), fp603 = mk('0603'), fp805 = mk('0805'), fp1206 = mk('1206');

// ---- 手动封装 ----
const hd = (n, pitch = 2.54) => Array.from({ length: n }, (_, k) => ({ dx: (k - (n - 1) / 2) * pitch, dy: 0, w: 1.7, h: 1.7, shape: 'circle', layer: 'both', holeR: 0.45 }));
const hd2x = (n, pitch = 2.54) => {
  const P = [];
  for (let k = 0; k < n; k++) P.push({ dx: (k - (n - 1) / 2) * pitch, dy: -1.27, w: 1.7, h: 1.7, shape: 'circle', layer: 'both', holeR: 0.45 });
  for (let k = 0; k < n; k++) P.push({ dx: (k - (n - 1) / 2) * pitch, dy: 1.27, w: 1.7, h: 1.7, shape: 'circle', layer: 'both', holeR: 0.45 });
  return P;
};
const term = (n, pitch = 5.0) => Array.from({ length: n }, (_, k) => ({ dx: (k - (n - 1) / 2) * pitch, dy: 0, w: 2.2, h: 2.2, shape: 'circle', layer: 'both', holeR: 0.8 }));
const to220 = [0, 1, 2].map(k => ({ dx: k * 2.54, dy: 0, w: 1.9, h: 1.9, shape: 'circle', layer: 'both', holeR: 0.6 }));
const smc2 = [{ dx: -2.6, dy: 0, w: 2.4, h: 3.8 }, { dx: 2.6, dy: 0, w: 2.4, h: 3.8 }];
const thLED = [{ dx: 0, dy: 0, w: 1.2, h: 1.2, shape: 'circle', layer: 'both', holeR: 0.35 }, { dx: 2.54, dy: 0, w: 1.2, h: 1.2, shape: 'circle', layer: 'both', holeR: 0.35 }];
const xtal2 = [{ dx: -1.1, dy: 0, w: 1.3, h: 3.4 }, { dx: 1.1, dy: 0, w: 1.3, h: 3.4 }];
// 氖泡 NE-2（2 端大孔）
const ne2 = [-2.0, 2.0].map(dx => ({ dx, dy: 0, w: 2.4, h: 2.4, shape: 'circle', layer: 'both', holeR: 0.8 }));
// 干簧管（2 端长条）
const reed = [-6.0, 6.0].map(dx => ({ dx, dy: 0, w: 1.6, h: 2.6 }));
// 3296 多圈电位器（3 pin 2.54 一排）
const pot3296 = [-2.54, 0, 2.54].map(dx => ({ dx, dy: 0, w: 1.5, h: 1.9 }));
// 卧式电解（横放：两孔大间距）
const capH = [-5.0, 5.0].map(dx => ({ dx, dy: 0, w: 2.8, h: 2.8, shape: 'circle', layer: 'both', holeR: 1.0 }));
const capBig = [-2.5, 2.5].map(dx => ({ dx, dy: 0, w: 2.8, h: 2.8, shape: 'circle', layer: 'both', holeR: 1.0 }));
const thR = [{ dx: -1.27, dy: 0, w: 1.3, h: 1.3, shape: 'circle', layer: 'both', holeR: 0.35 }, { dx: 1.27, dy: 0, w: 1.3, h: 1.3, shape: 'circle', layer: 'both', holeR: 0.35 }];
const thC = [{ dx: -1.27, dy: 0, w: 1.6, h: 1.6, shape: 'circle', layer: 'both', holeR: 0.4 }, { dx: 1.27, dy: 0, w: 1.6, h: 1.6, shape: 'circle', layer: 'both', holeR: 0.4 }];
// 香蕉座 4mm（超大盘 + 3.2 孔）
const banana = [{ dx: 0, dy: 0, w: 6.0, h: 6.0, shape: 'circle', layer: 'both', holeR: 1.6 }];
// 磁保持继电器（双线圈 6 pin：2×3）
const magrel = hd2x(3);
// 盖革管座（阳极中心大孔 + 阴极环 2 端）
const gmtube = [{ dx: 0, dy: -8, w: 3.4, h: 3.4, shape: 'circle', layer: 'both', holeR: 1.4 },
  { dx: 0, dy: 8, w: 3.4, h: 3.4, shape: 'circle', layer: 'both', holeR: 1.4 }];
// FPC 0.5mm 8pin（单排侧向 + 2 固定耳）
const fpc8 = Array.from({ length: 8 }, (_, k) => ({ dx: (k - 3.5) * 0.5, dy: 0, w: 0.3, h: 1.4 }))
  .concat([{ dx: -4.4, dy: 0, w: 1.4, h: 2.6 }, { dx: 4.4, dy: 0, w: 1.4, h: 2.6 }]);
// LD TO-56（3 pin + 外壳法兰）
const to56 = [{ dx: -2.0, dy: 0, w: 1.4, h: 1.4, shape: 'circle', layer: 'both', holeR: 0.5 },
  { dx: 0, dy: 0, w: 1.4, h: 1.4, shape: 'circle', layer: 'both', holeR: 0.5 },
  { dx: 2.0, dy: 0, w: 1.4, h: 1.4, shape: 'circle', layer: 'both', holeR: 0.5 },
  { dx: 0, dy: -3.2, w: 8.0, h: 2.2 }];
// LQFP48
const qfpPads = (per, pitch, pw, ph, off) => {
  const s = (per - 1) / 2 * pitch, A = s + (off != null ? off : 1.1), P = [];
  for (let k = 0; k < per; k++) P.push({ dx: -A, dy: -s + k * pitch, w: ph, h: pw });
  for (let k = 0; k < per; k++) P.push({ dx: -s + k * pitch, dy: A, w: pw, h: ph });
  for (let k = 0; k < per; k++) P.push({ dx: A, dy: s - k * pitch, w: ph, h: pw });
  for (let k = 0; k < per; k++) P.push({ dx: s - k * pitch, dy: -A, w: pw, h: ph });
  return P;
};
const qfp48 = qfpPads(12, 0.5, 0.3, 1.2);
// LF398 DIP-8
const dip8 = mk('DIP-N', 8);

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

// n113: 氖泡电源指示 —— NE-2 首测 + 双电阻串联高阻链
{
  const nets = ['ac1', 'ac2', 'mid1', 'mid2', 'mid3'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n113 氖泡电源指示', { width: 46, height: 20, clearance: 0.3, nets });
  for (let k = 0; k < 3; k++) {
    const x = 8 + k * 12;
    c.place(`NE${k + 1}`, ne2, x, 8, [k === 0 ? 'ac1' : `mid${k}`, `mid${k + 1}`], CM(x, 8, 0, 'NE-2', 'NE-2'));
  }
  c.place('R1', fp1206, 6, 15, ['ac2', 'mid1'], CM(6, 15, 0, '470k', 'R1206'));
  c.place('R2', fp1206, 14, 15, ['mid1', 'ac1'], CM(14, 15, 0, '470k', 'R1206'));
  c.place('R3', fp1206, 22, 15, ['mid2', 'ac1'], CM(22, 15, 0, '470k', 'R1206'));
  c.place('R4', fp1206, 30, 15, ['mid3', 'ac2'], CM(30, 15, 0, '470k', 'R1206'));
  c.place('R5', fp1206, 38, 15, ['ac1', 'mid3'], CM(38, 15, 0, '470k', 'R1206'));
  c.place('J1', term(2), 42, 8, ['ac1', 'ac2'], CM(42, 8, 90, 'AC', 'TB-2P'));
  c.save('n113-ne2-indicator');
}

// n114: 干簧管门磁接口 —— 干簧管首测
{
  const nets = ['v5', 'gnd', 'reed1', 'reed2', 'led1', 'led2'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n114 干簧管门磁接口', { width: 48, height: 20, nets });
  c.place('SW1', reed, 10, 6, ['reed1', 'gnd'], CM(10, 6, 0, ' Reed', 'REED-2'));
  c.place('SW2', reed, 10, 13, ['reed2', 'gnd'], CM(10, 13, 0, 'Reed', 'REED-2'));
  c.place('R1', fp603, 20, 6, ['v5', 'reed1'], CM(20, 6, 0, '10k', 'R0603'));
  c.place('R2', fp603, 20, 13, ['v5', 'reed2'], CM(20, 13, 0, '10k', 'R0603'));
  c.place('R3', fp603, 28, 6, ['reed1', 'led1'], CM(28, 6, 0, '1k', 'R0603'));
  c.place('R4', fp603, 28, 13, ['reed2', 'led2'], CM(28, 13, 0, '1k', 'R0603'));
  c.place('LED1', thLED, 36, 6, ['led1', 'gnd'], CM(36, 6, 0, 'LED', 'LED-THT'));
  c.place('LED2', thLED, 36, 13, ['led2', 'gnd'], CM(36, 13, 0, 'LED', 'LED-THT'));
  c.place('J1', hd(2), 3, 10, ['v5', 'gnd'], CM(3, 10, 90, '5V', 'HDR-2P'));
  c.save('n114-reed');
}

// n115: 多圈电位器基准分压 —— 3296 首测
{
  const nets = ['vref', 'gnd', 'w1', 'w2', 'w3'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n115 多圈电位器分压', { width: 44, height: 20, nets });
  c.place('P1', pot3296, 10, 7, ['vref', 'w1', 'gnd'], CM(10, 7, 0, '10k', '3296W'));
  c.place('P2', pot3296, 20, 7, ['vref', 'w2', 'gnd'], CM(20, 7, 0, '50k', '3296W'));
  c.place('P3', pot3296, 30, 7, ['vref', 'w3', 'gnd'], CM(30, 7, 0, '100k', '3296W'));
  c.place('C1', fp805, 10, 14, ['vref', 'gnd'], CM(10, 14, 0, '100n', 'C0805'));
  c.place('C2', fp805, 20, 14, ['vref', 'gnd'], CM(20, 14, 0, '100n', 'C0805'));
  c.place('C3', fp805, 30, 14, ['vref', 'gnd'], CM(30, 14, 0, '100n', 'C0805'));
  c.place('J1', hd(5), 40, 10, ['vref', 'gnd', 'w1', 'w2', 'w3'], CM(40, 10, 90, 'ADC', 'HDR-5P'));
  c.save('n115-pot-div');
}

// n116: 香蕉座测试工装 —— 超大盘+大孔+星形汇流
{
  const nets = ['in_p', 'gnd', 'o1', 'o2', 'o3'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n116 香蕉座工装', { width: 50, height: 30, nets });
  for (let k = 0; k < 3; k++) {
    const x = 14 + k * 11;
    c.place(`J${k + 1}`, banana, x, 8, [`o${k + 1}`], CM(x, 8, 0, '4mm-R', 'BANANA'));
    c.place(`J${k + 4}`, banana, x, 22, ['gnd'], CM(x, 22, 0, '4mm-B', 'BANANA'));
    c.place(`R${k + 1}`, smc2, x - 5.5, 15, ['in_p', `o${k + 1}`], CM(x - 5.5, 15, 0, 'PTC', 'SMC'));
  }
  c.place('J7', term(2), 3, 15, ['in_p', 'gnd'], CM(3, 15, 90, 'IN', 'TB-2P'));
  c.save('n116-banana-jig');
}

// n117: 卧式电解阵列 —— 卧式 footprint + 极性板
{
  const nets = ['vbus', 'gnd', 'vout1', 'vout2'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n117 卧式电解阵列', { width: 52, height: 24, nets });
  c.place('C1', capH, 12, 6, ['vbus', 'gnd'], CM(12, 6, 0, '470u', 'CAP-H'));
  c.place('C2', capH, 26, 6, ['vbus', 'gnd'], CM(26, 6, 0, '470u', 'CAP-H'));
  c.place('C3', capH, 40, 6, ['vbus', 'gnd'], CM(40, 6, 0, '470u', 'CAP-H'));
  c.place('L1', [{ dx: -2.5, dy: 0, w: 2.4, h: 2.4, shape: 'circle', layer: 'both', holeR: 0.7 }, { dx: 2.5, dy: 0, w: 2.4, h: 2.4, shape: 'circle', layer: 'both', holeR: 0.7 }], 12, 17, ['vbus', 'vout1'], CM(12, 17, 0, '10uH', 'IND-THT'));
  c.place('C4', capH, 24, 17, ['vout1', 'gnd'], CM(24, 17, 0, '220u', 'CAP-H'));
  c.place('L2', [{ dx: -2.5, dy: 0, w: 2.4, h: 2.4, shape: 'circle', layer: 'both', holeR: 0.7 }, { dx: 2.5, dy: 0, w: 2.4, h: 2.4, shape: 'circle', layer: 'both', holeR: 0.7 }], 36, 17, ['vout1', 'vout2'], CM(36, 17, 0, '10uH', 'IND-THT'));
  c.place('C5', capH, 46, 17, ['vout2', 'gnd'], CM(46, 17, 0, '220u', 'CAP-H'));
  c.place('J1', term(2), 3, 6, ['vbus', 'gnd'], CM(3, 6, 90, 'IN', 'TB-2P'));
  c.save('n117-cap-h');
}

// ============ 中等档 ============

// n118: FPC 0.5mm 转排针 —— 0.5mm 单排细间距首测
{
  const nets = ['v33', 'gnd', 'sda', 'scl', 'int', 'rst', 'p0', 'p1'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n118 FPC 转排针', { width: 44, height: 24, grid: 0.25, trackW: 0.15, clearance: 0.1, viaOuter: 0.5, viaDrill: 0.25, nets });
  const fpc8n = ['gnd', 'sda', 'scl', 'int', 'rst', 'p0', 'p1', 'v33'];
  fpc8.forEach((f, i) => c.add('J1', i + 1, fpc8n[i], 10 + f.dx, 9 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.J1 = CM(10, 9, 0, 'FPC-8', 'FPC-0.5');
  const fpc8n2 = ['v33', 'p1', 'p0', 'rst', 'int', 'scl', 'sda', 'gnd'];
  fpc8.forEach((f, i) => c.add('J2', i + 1, fpc8n2[i], 24 + f.dx, 9 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.J2 = CM(24, 9, 0, 'FPC-8', 'FPC-0.5');
  c.place('R1', fp402, 17, 15, ['v33', 'sda'], CM(17, 15, 0, '4k7', 'R0402'));
  c.place('R2', fp402, 20, 15, ['v33', 'scl'], CM(20, 15, 0, '4k7', 'R0402'));
  c.place('C1', fp402, 24, 15, ['v33', 'gnd'], CM(24, 15, 0, '100n', 'C0402'));
  c.place('J3', hd(8), 34, 15, ['v33', 'gnd', 'sda', 'scl', 'int', 'rst', 'p0', 'p1'], CM(34, 15, 90, 'HDR', 'HDR-8P'));
  c.save('n118-fpc-adapter');
}

// n119: CD4046 PLL 倍频环 —— 反馈环拓扑（VCO→分频→相位比较→滤波→VCO）
{
  const nets = ['v5', 'gnd', 'vin_sig', 'vco_out', 'div_out', 'sig_in', 'comp_out', 'vco_in', 'c1a', 'c1b'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n119 CD4046 PLL', { width: 56, height: 28, nets });
  const dip16 = mk('DIP-N', 16);
  // 4046：14=SIG_in, 3=COMP_in, 13=PC2_out, 9=VCO_in, 4=VCO_out, 6/7=C, 11/12=R
  const u1n = [null, null, 'div_out', null, 'vco_out', 'c1a', 'c1b', null, 'vco_in', null, null, null, 'comp_out', 'vin_sig', 'sig_in', 'gnd'];
  // 修正 4046 引脚：1=PC3_out 2=PC1_out 3=COMP_in 4=VCO_out 5=INH 6=Ca 7=Cb 8=VSS 9=VCO_in 10=DEM 11=R1 12=R2 13=PC2_out 14=SIG_in 15=VCO_z 16=VDD
  const u1n2 = ['vco_out', null, 'div_out', 'vco_out', null, 'c1a', 'c1b', 'gnd', 'vco_in', null, null, null, 'comp_out', 'sig_in', null, 'v5'];
  dip16.forEach((f, i) => c.add('U1', i + 1, u1n2[i], 16 + f.dx, 14 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.U1 = CM(16, 14, 0, 'CD4046', 'DIP-16');
  const dip16b = mk('DIP-N', 16);
  // 4040 分频：10=CLK 11=RST Q 输出 1-7；用 Q4(4? 实际 4040: 9=Q1? 简化按功能)
  const u2n = [null, null, null, 'div_out', null, null, null, 'gnd', 'vco_out', null, null, null, null, null, null, 'v5'];
  dip16b.forEach((f, i) => c.add('U2', i + 1, u2n[i], 38 + f.dx, 14 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.U2 = CM(38, 14, 0, 'CD4040', 'DIP-16');
  c.place('R1', fp603, 26, 6, ['comp_out', 'vco_in'], CM(26, 6, 0, '100k', 'R0603'));
  c.place('C1', fp805, 26, 22, ['vco_in', 'gnd'], CM(26, 22, 0, '10n', 'C0805'));
  c.place('C2', fp805, 8, 6, ['v5', 'gnd'], CM(8, 6, 0, '100n', 'C0805'));
  c.place('C3', fp805, 44, 6, ['v5', 'gnd'], CM(44, 6, 0, '100n', 'C0805'));
  c.place('J1', hd(3), 4, 14, ['v5', 'gnd', 'vin_sig'], CM(4, 14, 90, 'IN', 'HDR-3P'));
  c.place('J2', hd(2), 52, 20, ['vco_out', 'gnd'], CM(52, 20, 90, 'OUT', 'HDR-2P'));
  c.save('n119-pll4046');
}

// n120: LF398 采样保持 —— S&H 首测
{
  const nets = ['vin', 'vout', 'ctrl', 'cap_s', 'vpos', 'vneg', 'agnd'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n120 LF398 采样保持', { width: 48, height: 26, nets });
  const u1n = ['vin', null, 'cap_s', 'vneg', 'null_adj', 'gnd', 'ctrl', 'vpos'];
  // LF398: 1=V+ 2=VL 3=V- 4=adj? 简化按功能: 1=V+, 2=?, 3=VIN, 4=V-, 5=OUT, 6=CHOLD, 7=REF, 8=LOGIC
  const u1n2 = ['vpos', null, 'vin', 'vneg', 'vout', 'cap_s', 'agnd', 'ctrl'];
  dip8.forEach((f, i) => c.add('U1', i + 1, u1n2[i], 20 + f.dx, 13 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.U1 = CM(20, 13, 0, 'LF398', 'DIP-8');
  c.place('C1', fp1206, 30, 8, ['cap_s', 'agnd'], CM(30, 8, 0, '1n-C0G', 'C1206'));
  c.place('R1', fp603, 12, 6, ['ctrl', 'vpos'], CM(12, 6, 0, '10k', 'R0603'));
  c.place('C2', fp805, 12, 20, ['vpos', 'agnd'], CM(12, 20, 0, '100n', 'C0805'));
  c.place('C3', fp805, 28, 20, ['vneg', 'agnd'], CM(28, 20, 0, '100n', 'C0805'));
  c.place('J1', hd(4), 4, 8, ['vin', 'agnd', 'ctrl', 'gnd_x'].map(x => x === 'gnd_x' ? null : x), CM(4, 8, 90, 'IN', 'HDR-4P'));
  c.place('J2', hd(3), 44, 13, ['vout', 'agnd', 'gnd_x'].map(x => x === 'gnd_x' ? null : x), CM(44, 13, 90, 'OUT', 'HDR-3P'));
  c.place('J3', hd(3), 4, 18, ['vpos', 'agnd', 'vneg'], CM(4, 18, 90, 'PWR', 'HDR-3P'));
  c.save('n120-lf398');
}

// n121: 4-20mA 电流环变送 —— 电流环拓扑
{
  const nets = ['vloop', 'isense', 'vdrv', 'fb', 'vin_sig', 'gnd_loop'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n121 4-20mA 变送', { width: 50, height: 26, nets });
  const so8 = mk('SOIC-8');
  c.place('U1', so8, 18, 13, ['fb', 'isense', 'vdrv', 'gnd_loop', 'vin_sig', null, null, 'vloop'], CM(18, 13, 0, 'OPA', 'SOIC-8'));
  c.place('Q1', to220, 30, 13, ['vdrv', 'vloop', 'isense'], CM(31.54, 13, 0, 'PNP', 'TO-220'));
  c.place('R1', fp1206, 40, 8, ['isense', 'fb'], CM(40, 8, 0, '100R', 'R2512'));
  c.place('R2', fp603, 12, 6, ['vin_sig', 'fb'], CM(12, 6, 0, '10k', 'R0603'));
  c.place('R3', fp603, 12, 20, ['fb', 'gnd_loop'], CM(12, 20, 0, '10k', 'R0603'));
  c.place('C1', fp805, 8, 13, ['vloop', 'gnd_loop'], CM(8, 13, 0, '100n', 'C0805'));
  c.place('J1', term(2), 44, 20, ['isense', 'gnd_loop'], CM(44, 20, 0, 'LOOP', 'TB-2P'));
  c.place('J2', hd(3), 4, 13, ['vin_sig', 'gnd_loop', 'vloop'], CM(4, 13, 90, 'IN', 'HDR-3P'));
  c.save('n121-loop420');
}

// n122: 峰值检波器链 —— 精密整流+保持 两级
{
  const nets = ['vin', 'pk1', 'pk2', 'hold1', 'hold2', 'rst', 'vpos', 'vneg', 'agnd'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n122 峰值检波链', { width: 56, height: 26, nets });
  const so8 = mk('SOIC-8');
  const amps = [
    ['vin', 'hold1', 'pk1'], ['pk1', 'hold2', 'pk2']];
  amps.forEach((an, u) => {
    so8.forEach((f, i) => c.add(`U${u + 1}`, i + 1, [an[0], an[1], an[2], 'vneg', 'agnd', null, null, 'vpos'][i] || null, 16 + u * 14 + f.dx, 13 + f.dy, f.w, f.h, f.shape, f.layer));
    c.compsMeta[`U${u + 1}`] = CM(16 + u * 14, 13, 0, 'OPA', 'SOIC-8');
  });
  c.place('D1', [{ dx: -1.55, dy: 0, w: 1.0, h: 1.25 }, { dx: 1.55, dy: 0, w: 1.0, h: 1.25 }], 22, 7, ['pk1', 'hold1'], CM(22, 7, 0, '1N4148W', 'SOD-123'));
  c.place('D2', [{ dx: -1.55, dy: 0, w: 1.0, h: 1.25 }, { dx: 1.55, dy: 0, w: 1.0, h: 1.25 }], 36, 7, ['pk2', 'hold2'], CM(36, 7, 0, '1N4148W', 'SOD-123'));
  c.place('C1', fp805, 26, 20, ['hold1', 'agnd'], CM(26, 20, 0, '10n', 'C0805'));
  c.place('C2', fp805, 40, 20, ['hold2', 'agnd'], CM(40, 20, 0, '10n', 'C0805'));
  c.place('R1', fp603, 8, 13, ['rst', 'agnd'], CM(8, 13, 0, '1M', 'R0603'));
  c.place('J1', hd(4), 4, 8, ['vin', 'agnd', 'rst', 'gnd_x'].map(x => x === 'gnd_x' ? null : x), CM(4, 8, 90, 'IN', 'HDR-4P'));
  c.place('J2', hd(3), 50, 13, ['pk2', 'agnd', 'gnd_x'].map(x => x === 'gnd_x' ? null : x), CM(50, 13, 90, 'OUT', 'HDR-3P'));
  c.place('J3', hd(3), 4, 20, ['vpos', 'agnd', 'vneg'], CM(4, 20, 90, 'PWR', 'HDR-3P'));
  c.save('n122-peak-chain');
}

// ============ 困难档 ============

// n123: 磁保持继电器双稳驱动 —— 双线圈 6 pin 首测
{
  const nets = ['v5', 'gnd', 'set1', 'set2', 'rst1', 'rst2', 'com1', 'com2', 'fb1', 'fb2'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n123 磁保持继电器', { width: 60, height: 30, nets });
  const mr = mk('DIP-N', 6);
  const mrn = ['set1', 'rst1', 'com1', 'set2', 'rst2', 'com2'];
  // R1: 线圈 set1/rst1, 触点 com1/no1 内部——焊盘只表达外部: set/rst 线圈 + com 公共
  const mrn2 = ['set1', 'set2', 'com1', 'rst1', 'rst2', 'com2'];
  mr.forEach((f, i) => c.add('K1', i + 1, mrn2[i], 14 + f.dx, 15 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.K1 = CM(14, 15, 0, 'HFE10', 'MAG-REL');
  const mr2n = ['set2', 'com2', 'gnd_x', 'rst2', null, 'com1'].map(x => x === 'gnd_x' ? null : x);
  mr.forEach((f, i) => c.add('K2', i + 1, mr2n[i] || null, 32 + f.dx, 15 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.K2 = CM(32, 15, 0, 'HFE10', 'MAG-REL');
  const so16 = mk('SOIC-16');
  const u1n = ['set1', 'rst1', 'set2', 'rst2', null, null, 'gnd', 'fb1', 'fb2', null, null, null, 'v5', 'gnd', null, 'v5'];
  so16.forEach((f, i) => c.add('U1', i + 1, u1n[i], 48 + f.dx, 15 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U1 = CM(48, 15, 0, 'DRV', 'SOIC-16');
  c.place('J1', hd(6), 4, 15, ['v5', 'gnd', 'set1', 'rst1', 'set2', 'rst2'], CM(4, 15, 90, 'CTRL', 'HDR-6P'));
  c.place('J2', term(4), 24, 26, ['com1', 'com2', 'fb1', 'fb2'], CM(24, 26, 0, 'CON', 'TB-4P'));
  c.place('C1', fp805, 48, 6, ['v5', 'gnd'], CM(48, 6, 0, '100n', 'C0805'));
  c.save('n123-mag-relay');
}

// n124: 电磁阀驱动阵列 —— 4 路大电流螺线管 + 续流
{
  const nets = ['v24', 'gnd', 'g1', 'g2', 'g3', 'g4', 's1', 's2', 's3', 's4'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n124 电磁阀阵列', { width: 70, height: 32, nets });
  for (let k = 0; k < 4; k++) {
    const x = 14 + k * 13;
    c.place(`Q${k + 1}`, to220, x, 12, [`g${k + 1}`, 'v24', `s${k + 1}`], CM(x + 1.54, 12, 0, 'MOS-N', 'TO-220'));
    c.place(`D${k + 1}`, smc2, x, 22, [`s${k + 1}`, 'v24'], CM(x, 22, 0, 'SS54', 'SMC'));
  }
  c.place('R1', fp603, 4, 12, ['g1', 'gnd'], CM(4, 12, 90, '10k', 'R0603'));
  const so16 = mk('SOIC-16');
  const u1n = ['g1', 'g2', 'g3', 'g4', null, null, 'gnd', null, null, null, null, null, 'v24', 'gnd', null, 'v24'];
  // U1 是驱动器：输入来自 J2
  const u1n2 = ['g1', 'g2', 'g3', 'g4', null, null, 'gnd', 'v24', null, null, null, null, null, 'gnd', null, 'v24'];
  so16.forEach((f, i) => c.add('U1', i + 1, u1n2[i], 56 + f.dx, 16 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U1 = CM(56, 16, 0, 'DRV-VALVE', 'SOIC-16');
  c.place('J1', term(5), 32, 28, ['s1', 's2', 's3', 's4', 'gnd'], CM(32, 28, 0, 'VALVE', 'TB-5P'));
  c.place('J2', term(2), 4, 24, ['v24', 'gnd'], CM(4, 24, 0, '24V', 'TB-2P'));
  c.place('C1', capBig, 66, 8, ['v24', 'gnd'], CM(66, 8, 0, '100u', 'CAP-THT'));
  c.save('n124-solenoid');
}

// n125: 盖革管脉冲前端 —— 400V 高压 + 脉冲整形
{
  const nets = ['hv', 'gnd', 'anode', 'cath', 'pulse', 'v5', 'thresh'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n125 盖革管前端', { width: 60, height: 36, clearance: 0.3, nets });
  c.place('G1', gmtube, 14, 18, ['anode', 'cath'], CM(14, 18, 0, 'GM-TUBE', 'GM-2'));
  c.place('R1', thR, 14, 6, ['hv', 'anode'], CM(14, 6, 0, '4M7', 'R-THT'));
  c.place('C1', thC, 24, 18, ['cath', 'gnd'], CM(24, 18, 0, '1n-6kV', 'C-THT'));
  c.place('R2', thR, 32, 18, ['cath', 'pulse'], CM(32, 18, 0, '100k', 'R-THT'));
  const so8 = mk('SOIC-8');
  c.place('U1', so8, 44, 12, ['pulse', 'thresh', 'pulse', 'gnd', 'thresh', null, null, 'v5'], CM(44, 12, 0, 'LM393', 'SOIC-8'));
  c.place('R3', fp603, 44, 24, ['thresh', 'v5'], CM(44, 24, 0, '10k', 'R0603'));
  c.place('R4', fp603, 50, 24, ['thresh', 'gnd'], CM(50, 24, 0, '10k', 'R0603'));
  c.place('J1', term(2), 4, 30, ['hv', 'gnd'], CM(4, 30, 0, '400V', 'TB-2P'));
  c.place('J2', hd(3), 54, 30, ['v5', 'gnd', 'pulse'], CM(54, 30, 0, 'OUT', 'HDR-3P'));
  c.place('C2', fp805, 8, 8, ['v5', 'gnd'], CM(8, 8, 0, '100n', 'C0805'));
  c.save('n125-geiger');
}

// n126: 倍压整流链 —— 4 级 C-W ladder
{
  const nets = ['ac', 'gnd', 's1', 's2', 's3', 'hvout'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n126 倍压整流链', { width: 70, height: 30, clearance: 0.3, nets });
  // 链式：每级电容跨接相邻节点、二极管串联递进
  for (let k = 0; k < 4; k++) {
    const x = 12 + k * 12;
    const top = k % 2 === 0 ? 'ac' : `s${k}`;
    const bot = k % 2 === 0 ? `s${k + 1}` : (k === 3 ? 'hvout' : `s${k + 1}`);
    c.place(`C${k + 1}`, [{ dx: -1.27, dy: 0, w: 1.8, h: 1.8, shape: 'circle', layer: 'both', holeR: 0.45 }, { dx: 1.27, dy: 0, w: 1.8, h: 1.8, shape: 'circle', layer: 'both', holeR: 0.45 }], x, 10, [top, bot], CM(x, 10, 0, '10u-250V', 'C-THT'));
  }
  for (let k = 0; k < 4; k++) {
    const x = 18 + k * 12;
    const from = k === 0 ? 'ac' : `s${k}`;
    const to = k === 3 ? 'hvout' : `s${k + 1}`;
    c.place(`D${k + 1}`, [{ dx: -1.55, dy: 0, w: 1.3, h: 1.6, shape: 'circle', layer: 'both', holeR: 0.45 }, { dx: 1.55, dy: 0, w: 1.3, h: 1.6, shape: 'circle', layer: 'both', holeR: 0.45 }], x, 20, [from, to], CM(x, 20, 0, '1N4007', 'DIODE-THT'));
  }
  c.place('J1', term(2), 4, 10, ['ac', 'gnd'], CM(4, 10, 90, 'AC', 'TB-2P'));
  c.place('J2', term(2), 66, 20, ['hvout', 'gnd'], CM(66, 20, 0, 'HV', 'TB-2P'));
  c.place('C5', capBig, 60, 10, ['hvout', 'gnd'], CM(60, 10, 0, '4.7u', 'CAP-THT'));
  c.save('n126-cw-ladder');
}

// n127: SSR 输出级 —— MOC 光耦可控硅 + 功率 TRIAC
{
  const nets = ['ctrl', 'gnd', 'tri_g', 'tri_m2', 'load_l', 'ac_n', 'snub'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n127 SSR 输出级', { width: 62, height: 30, clearance: 0.3, nets });
  const dip6 = mk('DIP-N', 6);
  const mocn = ['ctrl_r', 'gnd', null, 'tri_m2', null, 'tri_g'].map(x => x === 'ctrl_r' ? 'ctrl' : x);
  dip6.forEach((f, i) => c.add('U1', i + 1, mocn[i], 14 + f.dx, 10 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.U1 = CM(14, 10, 0, 'MOC3063', 'DIP-6');
  c.place('R1', fp603, 6, 10, ['ctrl', 'gnd'], CM(6, 10, 90, '330R', 'R0603'));
  const triac = [0, 1, 2].map(k => ({ dx: k * 2.54, dy: 0, w: 1.9, h: 1.9, shape: 'circle', layer: 'both', holeR: 0.6 }));
  c.place('T1', triac, 34, 10, ['tri_g', 'tri_m2', 'load_l'], CM(35.54, 10, 0, 'BTA16', 'TO-220'));
  c.place('R2', fp1206, 24, 18, ['tri_m2', 'tri_g'], CM(24, 18, 0, '39R', 'R1206'));
  c.place('R3', fp1206, 42, 20, ['tri_m2', 'snub'], CM(42, 20, 0, '39R', 'R1206'));
  c.place('C1', fp1206, 50, 20, ['snub', 'load_l'], CM(50, 20, 0, '10n-X2', 'C1206'));
  c.place('J1', term(2), 4, 24, ['load_l', 'ac_n'], CM(4, 24, 0, 'AC', 'TB-2P'));
  c.place('J2', term(2), 56, 8, ['load_l', 'ac_n'], CM(56, 8, 90, 'LOAD', 'TB-2P'));
  c.place('J3', hd(2), 4, 8, ['ctrl', 'gnd'], CM(4, 8, 90, 'CTRL', 'HDR-2P'));
  c.save('n127-ssr');
}

// ============ 超难档 ============

// n128: PMT 分压塔 —— 10 级高压电阻链 + 信号输出
{
  const nets = ['hv', 'gnd', 'k', 'dy1', 'dy2', 'dy3', 'dy4', 'dy5', 'dy6', 'dy7', 'dy8', 'dy9', 'anode', 'sig'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n128 PMT 分压塔', { width: 60, height: 44, clearance: 0.3, nets });
  const thR2 = [{ dx: -1.27, dy: 0, w: 1.3, h: 1.3, shape: 'circle', layer: 'both', holeR: 0.35 }, { dx: 1.27, dy: 0, w: 1.3, h: 1.3, shape: 'circle', layer: 'both', holeR: 0.35 }];
  // 10 级串联：hv→k→dy1→...→dy9→anode→gnd
  const chain = ['hv', 'k', 'dy1', 'dy2', 'dy3', 'dy4', 'dy5', 'dy6', 'dy7', 'dy8', 'dy9', 'anode', 'gnd'];
  for (let k = 0; k < 12; k++) {
    const x = 8 + (k % 6) * 8.5, y = 8 + Math.floor(k / 6) * 8;
    c.place(`R${k + 1}`, thR2, x, y, [chain[k], chain[k + 1]], CM(x, y, 0, '330k', 'R-THT'));
  }
  c.place('C1', thC, 8, 26, ['k', 'gnd'], CM(8, 26, 0, '10n-3kV', 'C-THT'));
  c.place('C2', thC, 16, 26, ['anode', 'gnd'], CM(16, 26, 0, '10n-3kV', 'C-THT'));
  c.place('R13', thR2, 26, 30, ['anode', 'sig'], CM(26, 30, 0, '1M', 'R-THT'));
  c.place('C3', thC, 34, 30, ['sig', 'gnd'], CM(34, 30, 0, '100p-3kV', 'C-THT'));
  c.place('J1', term(2), 46, 8, ['hv', 'gnd'], CM(46, 8, 90, '-HV', 'TB-2P'));
  c.place('J2', hd(11), 44, 28, chain.slice(1, 12), CM(44, 28, 90, 'DY', 'HDR-11P'));
  c.place('J3', hd(2), 8, 38, ['sig', 'gnd'], CM(8, 38, 0, 'OUT', 'HDR-2P'));
  c.save('n128-pmt-tower');
}

// n129: 激光二极管恒流驱动 —— LD+监测PD+慢启动+恒流环
{
  const nets = ['vld', 'gnd', 'ld_a', 'ld_k', 'pd_k', 'pd_mon', 'iset', 'slow', 'v5'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n129 激光二极管驱动', { width: 56, height: 34, grid: 0.5, trackW: 0.3, clearance: 0.15, nets });
  c.place('D1', to56, 40, 12, ['ld_a', 'ld_k', 'pd_k', 'gnd'], CM(40, 12, 0, 'LD-TO56', 'TO-56'));
  c.place('Q1', to220, 22, 12, ['iset', 'vld', 'ld_k'], CM(23.54, 12, 0, 'PASS-N', 'TO-220'));
  const so8 = mk('SOIC-8');
  c.place('U1', so8, 14, 12, ['iset', 'pd_mon', 'slow', 'gnd', 'pd_k', null, null, 'v5'], CM(14, 12, 0, 'OPA', 'SOIC-8'));
  c.place('R1', fp1206, 31, 20, ['iset', 'gnd'], CM(31, 20, 90, '10R', 'R2512'));
  c.place('R2', fp603, 8, 6, ['v5', 'slow'], CM(8, 6, 0, '100k', 'R0603'));
  c.place('C1', fp805, 14, 22, ['slow', 'gnd'], CM(14, 22, 0, '1u', 'C0805'));
  c.place('C2', fp805, 22, 24, ['vld', 'gnd'], CM(22, 24, 0, '10u', 'C0805'));
  c.place('C3', fp402, 48, 20, ['ld_a', 'ld_k'], CM(48, 20, 0, '100p', 'C0402'));
  c.place('J1', term(2), 4, 30, ['vld', 'gnd'], CM(4, 30, 0, 'VLD', 'TB-2P'));
  c.place('J2', hd(4), 50, 30, ['v5', 'gnd', 'slow', 'pd_mon'], CM(50, 30, 0, 'CTRL', 'HDR-4P'));
  c.save('n129-ld-driver');
}

// n130: BTB 板对板载板 —— 0.5mm 60pin 双排 ×2 对接
{
  const nets = ['v33', 'gnd', 'x1', 'x2', 'swclk', 'swdio'];
  for (let k = 0; k < 8; k++) nets.push(`io${k}`);
  for (let k = 0; k < 4; k++) nets.push(`diff${k}p`);
  for (let k = 0; k < 4; k++) nets.push(`diff${k}n`);
  const netObjs = nets.map(id => ({ id, name: id.toUpperCase(), ...(id.startsWith('diff') ? { pair: id.slice(0, -1) } : {}) }));
  const c = makeDesign('n130 BTB 板对板', { width: 70, height: 46, grid: 0.25, trackW: 0.15, clearance: 0.1, viaOuter: 0.5, viaDrill: 0.25, nets: netObjs });
  const btb60 = hd2x(30).map(f => ({ ...f, w: 0.8, h: 0.8, shape: 'circle', holeR: 0, layer: 'top' }));
  // BTB-1：60 pin（0.5 间距 30×2）
  const btb60a = hd2x(30, 0.5).map(f => ({ dx: f.dx, dy: f.dy, w: 0.3, h: 0.7, shape: 'rect', layer: 'top' }));
  const b1n = [];
  for (let k = 0; k < 60; k++) {
    const m = { 1: 'v33', 2: 'gnd', 30: 'gnd', 31: 'gnd', 60: 'v33', 3: 'x1', 32: 'x2', 4: 'swclk', 33: 'swdio' };
    if (m[k + 1]) b1n.push(m[k + 1]);
    else if (k % 6 === 0) b1n.push('gnd');
    else if (k % 6 === 3) b1n.push('v33');
    else if (k % 10 === 1) b1n.push(`io${Math.floor(k / 10) % 8}`);
    else b1n.push(null);
  }
  const count = id => b1n.filter(n => n === id).length;
  const fill2 = id => { while (count(id) < 2) { const i = b1n.indexOf(null); if (i < 0) break; b1n[i] = id; } };
  for (let k = 0; k < 8; k++) fill2(`io${k}`);
  for (let k = 0; k < 4; k++) { fill2(`diff${k}p`); fill2(`diff${k}n`); }
  btb60a.forEach((f, i) => c.add('J1', i + 1, b1n[i] || null, 22 + f.dx, 14 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.J1 = CM(22, 14, 0, 'BTB-60', 'BTB-0.5');
  const btb60b = hd2x(30, 0.5).map(f => ({ dx: f.dx, dy: f.dy, w: 0.3, h: 0.7, shape: 'rect', layer: 'top' }));
  const b2n = [];
  for (let k = 0; k < 60; k++) {
    const m = { 1: 'v33', 2: 'gnd', 30: 'gnd', 31: 'gnd', 60: 'v33' };
    if (m[k + 1]) b2n.push(m[k + 1]);
    else if (k % 6 === 0) b2n.push('gnd');
    else if (k % 6 === 3) b2n.push('v33');
    else if (k % 10 === 1) b2n.push(`io${(Math.floor(k / 10) + 4) % 8}`);
    else b2n.push(null);
  }
  const count2 = id => b2n.filter(n => n === id).length;
  for (let k = 0; k < 8; k++) while (count2(`io${k}`) < 2) { const i = b2n.indexOf(null); if (i < 0) break; b2n[i] = `io${k}`; }
  btb60b.forEach((f, i) => c.add('J2', i + 1, b2n[i] || null, 48 + f.dx, 32 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.J2 = CM(48, 32, 0, 'BTB-60', 'BTB-0.5');
  c.place('Y1', xtal2, 8, 8, ['x1', 'x2'], CM(8, 8, 0, '25MHz', 'XTAL-3225'));
  c.place('C1', fp402, 13, 8, ['x1', 'gnd'], CM(13, 8, 0, '18p', 'C0402'));
  c.place('C2', fp402, 13, 12, ['x2', 'gnd'], CM(13, 12, 0, '18p', 'C0402'));
  c.place('J3', hd(4), 6, 22, ['v33', 'gnd', 'swclk', 'swdio'], CM(6, 22, 90, 'SWD', 'HDR-4P'));
  for (let k = 0; k < 6; k++) c.place(`C${k + 3}`, fp402, 8 + (k % 3) * 4, k < 3 ? 34 : 40, ['v33', 'gnd'], CM(8 + (k % 3) * 4, k < 3 ? 34 : 40, 0, '100n', 'C0402'));
  c.save('n130-btb');
}

// n131: 文氏桥振荡器 —— 桥网络 + JFET AGC 闭环
{
  const nets = ['vpos', 'vneg', 'agnd', 'w_p', 'w_n', 'w_mid', 'agc', 'gate', 'amp_out', 'buf_out'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n131 文氏桥振荡器', { width: 60, height: 34, nets });
  const so8 = mk('SOIC-8');
  c.place('U1', so8, 22, 17, ['w_n', 'agc', 'amp_out', 'vneg', 'agnd', null, 'w_p', 'vpos'], CM(22, 17, 0, 'OPA', 'SOIC-8'));
  c.place('U2', so8, 44, 17, ['amp_out', null, 'buf_out', 'vneg', 'agnd', null, null, 'vpos'], CM(44, 17, 0, 'OPA', 'SOIC-8'));
  c.place('R1', fp603, 14, 8, ['amp_out', 'w_n'], CM(14, 8, 0, '10k', 'R0603'));
  c.place('R2', fp603, 14, 24, ['w_n', 'agnd'], CM(14, 24, 0, '10k', 'R0603'));
  c.place('C1', fp805, 20, 6, ['w_p', 'w_mid'], CM(20, 6, 0, '15n', 'C0805'));
  c.place('R3', fp603, 28, 6, ['w_mid', 'agnd'], CM(28, 6, 0, '10k', 'R0603'));
  c.place('C2', fp805, 34, 6, ['w_p', 'agnd'], CM(34, 6, 0, '15n', 'C0805'));
  c.place('R4', fp603, 40, 6, ['w_p', 'w_mid'], CM(40, 6, 0, '10k', 'R0603'));
  // AGC：输出检波 → JFET 栅
  c.place('R5', fp603, 30, 26, ['amp_out', 'agc'], CM(30, 26, 0, '100k', 'R0603'));
  c.place('D1', [{ dx: -1.55, dy: 0, w: 1.0, h: 1.25 }, { dx: 1.55, dy: 0, w: 1.0, h: 1.25 }], 36, 26, ['agc', 'agnd'], CM(36, 26, 0, '1N4148W', 'SOD-123'));
  c.place('C3', fp805, 42, 26, ['gate', 'agnd'], CM(42, 26, 0, '1u', 'C0805'));
  c.place('R6', fp603, 36, 26, ['agc', 'gate'], CM(36, 26, 0, '47k', 'R0603'));
  c.place('Q1', [{ dx: 0, dy: 0, w: 1.4, h: 1.6 }, { dx: 2.0, dy: 0, w: 1.4, h: 1.6 }, { dx: 1.0, dy: -2.2, w: 1.4, h: 1.6 }], 22, 28, ['gate', 'w_n', 'agnd'], CM(23, 28, 0, 'JFET', 'SOT-23'));
  c.place('J1', hd(3), 4, 8, ['vpos', 'agnd', 'vneg'], CM(4, 8, 90, 'PWR', 'HDR-3P'));
  c.place('J2', hd(2), 56, 26, ['buf_out', 'agnd'], CM(56, 26, 90, 'OUT', 'HDR-2P'));
  c.save('n131-wien');
}

// n132: LED 频闪曝光驱动 —— 储能电容堆 + SCR + 触发 + 大电流回路
{
  const nets = ['hv', 'gnd', 'cap_t', 'scr_a', 'trig1', 'trig2', 'lamp_a', 'lamp_k'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n132 LED 频闪驱动', { width: 76, height: 40, clearance: 0.3, nets });
  const capBig = [-2.5, 2.5].map(dx => ({ dx, dy: 0, w: 2.8, h: 2.8, shape: 'circle', layer: 'both', holeR: 1.0 }));
  for (let k = 0; k < 3; k++) c.place(`C${k + 1}`, capBig, 14 + k * 7, 10, ['hv', 'cap_t'], CM(14 + k * 7, 10, 0, '100u-350V', 'CAP-THT'));
  c.place('D1', [{ dx: -1.55, dy: 0, w: 1.3, h: 1.6, shape: 'circle', layer: 'both', holeR: 0.45 }, { dx: 1.55, dy: 0, w: 1.3, h: 1.6, shape: 'circle', layer: 'both', holeR: 0.45 }], 8, 10, ['hv', 'cap_t'], CM(8, 10, 0, '1N4007', 'DIODE-THT'));
  // SCR 大电流：阴极→灯堆
  const scr = [0, 1, 2].map(k => ({ dx: k * 2.54, dy: 0, w: 2.0, h: 2.0, shape: 'circle', layer: 'both', holeR: 0.7 }));
  c.place('S1', scr, 40, 10, ['trig2', 'cap_t', 'scr_a'], CM(41.54, 10, 0, 'SCR-70TPS', 'TO-220'));
  c.place('R1', thR, 34, 24, ['scr_a', 'lamp_k'], CM(34, 24, 0, '0R5', 'R-THT'));
  c.place('R2', thR, 40, 24, ['lamp_k', 'gnd'], CM(40, 24, 0, '0R5', 'R-THT'));
  // 触发变压器
  c.place('T1', [-2.54, 0, 2.54].flatMap(dy => [-2.54, 2.54].map(dx => ({ dx, dy, w: 1.9, h: 1.9, shape: 'circle', layer: 'both', holeR: 0.6 }))), 56, 16, ['trig1', 'trig2', null, 'lamp_a', null, null], CM(56, 16, 0, 'TRIG-XFMR', 'XFMR-6'));
  c.place('C4', fp1206, 48, 30, ['trig1', 'trig2'], CM(48, 30, 0, '100n', 'C1206'));
  c.place('R3', fp603, 54, 30, ['trig2', 'gnd'], CM(54, 30, 0, '1k', 'R0603'));
  c.place('J1', term(2), 4, 30, ['hv', 'gnd'], CM(4, 30, 0, '300V', 'TB-2P'));
  c.place('J2', term(2), 68, 30, ['trig1', 'trig2'], CM(68, 30, 0, 'TRIG', 'TB-2P'));
  c.place('J3', hd(2), 68, 10, ['lamp_a', 'lamp_k'], CM(68, 10, 90, 'LAMP', 'HDR-2P'));
  c.save('n132-strobe');
}

// ============ 自检门（spec 门同款 + 半孔豁免 + 环宽检查）============
let fail = 0;
const dirs = ['n113-ne2-indicator', 'n114-reed', 'n115-pot-div', 'n116-banana-jig', 'n117-cap-h',
  'n118-fpc-adapter', 'n119-pll4046', 'n120-lf398', 'n121-loop420', 'n122-peak-chain',
  'n123-mag-relay', 'n124-solenoid', 'n125-geiger', 'n126-cw-ladder', 'n127-ssr',
  'n128-pmt-tower', 'n129-ld-driver', 'n130-btb', 'n131-wien', 'n132-strobe'];
const isCast = (p, d) => p.shape === 'circle' && (p.holeR || 0) > 0 &&
  Math.min(p.x, d.width - p.x, p.y, d.height - p.y) < p.holeR;
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
      if (a.netId != null && b.netId != null && a.netId === b.netId) continue;
      const gap = padGap(a, b);
      if (gap < d.clearance - 1e-9) problems.push(`同元件间距 ${comp}: ${a.id}/${b.id} gap=${gap.toFixed(3)}`);
    }
  for (const p of d.pads) {
    if (isCast(p, d)) continue;
    const hw = p.w / 2, hh = p.shape === 'circle' ? p.w / 2 : p.h / 2;
    if (p.x - hw < -1e-9 || p.x + hw > d.width + 1e-9 || p.y - hh < -1e-9 || p.y + hh > d.height + 1e-9)
      problems.push(`出板 ${p.id} @(${p.x},${p.y})`);
    if ((p.holeR || 0) > 0) {
      const ring = Math.min(p.w, p.shape === 'circle' ? p.w : p.h) / 2 - p.holeR;
      if (ring < 0.18 - 1e-9) problems.push(`环宽 ${p.id} ${ring.toFixed(2)} < 0.18`);
    }
  }
  if (problems.length) { console.error(`✗ ${dir}:`); problems.forEach(p => console.error('   ' + p)); fail = 1; }
  else console.log(`✓ ${dir}: 网表完整`);
}
if (fail) process.exit(1);
console.log('\n全部 20 项目自检通过');
