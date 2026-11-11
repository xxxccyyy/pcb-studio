// 第八轮批量 spec 生成：N93-N112（20 项目，4 档，全部与前七轮不同的设计维度）
// 新维度：拨动/轻触/自锁开关、EC11 非对称、U.FL/SMA 射频、SD 卡座单侧焊盘、
//         D-sub D 形双排（DB-9/DB-15）、开尔文四线、保护环 manual 环、采样保持、
//         Royer/ZVS 谐振、多绕组 PSU、电池平衡、霍尔换相、邮票孔半孔拼板、VFD 高压多路
// 自检门：坏引用/单脚网/空网/同元件焊盘间距（DRC padGap 同口径）/出板（半孔豁免）
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
const thLED = [{ dx: 0, dy: 0, w: 1.2, h: 1.2, shape: 'circle', layer: 'both', holeR: 0.35 }, { dx: 2.54, dy: 0, w: 1.2, h: 1.2, shape: 'circle', layer: 'both', holeR: 0.35 }];
const to220 = [0, 1, 2].map(k => ({ dx: k * 2.54, dy: 0, w: 1.9, h: 1.9, shape: 'circle', layer: 'both', holeR: 0.6 }));
const xtal2 = [{ dx: -1.1, dy: 0, w: 1.3, h: 3.4 }, { dx: 1.1, dy: 0, w: 1.3, h: 3.4 }];
const smc2 = [{ dx: -2.6, dy: 0, w: 2.4, h: 3.8 }, { dx: 2.6, dy: 0, w: 2.4, h: 3.8 }];
const capBig = [-2.5, 2.5].map(dx => ({ dx, dy: 0, w: 2.6, h: 2.6, shape: 'circle', layer: 'both', holeR: 0.9 }));
const thR = [{ dx: -1.27, dy: 0, w: 1.3, h: 1.3, shape: 'circle', layer: 'both', holeR: 0.35 }, { dx: 1.27, dy: 0, w: 1.3, h: 1.3, shape: 'circle', layer: 'both', holeR: 0.35 }];
const thC = [{ dx: -1.27, dy: 0, w: 1.6, h: 1.6, shape: 'circle', layer: 'both', holeR: 0.4 }, { dx: 1.27, dy: 0, w: 1.6, h: 1.6, shape: 'circle', layer: 'both', holeR: 0.4 }];
// SS-12D00 拨动开关（3 pin 2.0 间距）
const slide3 = [0, 1, 2].map(k => ({ dx: (k - 1) * 2.0, dy: 0, w: 1.3, h: 1.7 }));
// SMD 轻触开关 4 脚
const tact4 = [{ dx: -3.1, dy: -2.5, w: 1.4, h: 1.6 }, { dx: 3.1, dy: -2.5, w: 1.4, h: 1.6 }, { dx: 3.1, dy: 2.5, w: 1.4, h: 1.6 }, { dx: -3.1, dy: 2.5, w: 1.4, h: 1.6 }];
// EC11 旋转编码器（3 编码 + 2 按键，非对称）
const ec11 = [-2.5, 0, 2.5].map(dx => ({ dx, dy: -6.2, w: 1.7, h: 1.7, shape: 'circle', layer: 'both', holeR: 0.5 }))
  .concat([{ dx: -6.4, dy: 6.2, w: 1.7, h: 1.7, shape: 'circle', layer: 'both', holeR: 0.5 }, { dx: 6.4, dy: 6.2, w: 1.7, h: 1.7, shape: 'circle', layer: 'both', holeR: 0.5 }]);
// U.FL 射频座（微焊盘 + 大屏蔽）
const ufl = [{ dx: -0.8, dy: 0.5, w: 0.35, h: 0.9 }, { dx: 0, dy: 0.5, w: 0.35, h: 0.9 }, { dx: 0.8, dy: 0.5, w: 0.35, h: 0.9 }, { dx: 0, dy: -1.3, w: 2.8, h: 1.6 }];
// SMA 边缘端子（中心针 THT + 4 接地腿）
const sma = [{ dx: 0, dy: 0, w: 1.4, h: 1.4, shape: 'circle', layer: 'both', holeR: 0.5 },
  { dx: -2.6, dy: 2.6, w: 1.7, h: 1.7 }, { dx: 2.6, dy: 2.6, w: 1.7, h: 1.7 }, { dx: 2.6, dy: -2.6, w: 1.7, h: 1.7 }, { dx: -2.6, dy: -2.6, w: 1.7, h: 1.7 }];
// SD 卡座（9 pin 单侧 1.1 间距 + 4 固定耳）
const sdSlot = Array.from({ length: 9 }, (_, k) => ({ dx: (k - 4) * 1.1, dy: 0, w: 0.6, h: 1.7 }))
  .concat([{ dx: -9, dy: 4.5, w: 2.6, h: 2.0, shape: 'circle', layer: 'both', holeR: 0.8 }, { dx: 9, dy: 4.5, w: 2.6, h: 2.0, shape: 'circle', layer: 'both', holeR: 0.8 },
    { dx: -9, dy: -4.5, w: 2.6, h: 2.0, shape: 'circle', layer: 'both', holeR: 0.8 }, { dx: 9, dy: -4.5, w: 2.6, h: 2.0, shape: 'circle', layer: 'both', holeR: 0.8 }]);
// D-sub（D 形双排 + 2 屏蔽孔）
const dsub = (n) => {
  const per = Math.ceil(n / 2), P = [], pitch = 2.84, rows = 2.16;
  for (let k = 0; k < per; k++) P.push({ dx: (k - (per - 1) / 2) * pitch, dy: -rows / 2, w: 1.4, h: 1.8, shape: 'circle', layer: 'both', holeR: 0.5 });
  for (let k = 0; k < n - per; k++) P.push({ dx: (k - (n - per - 1) / 2) * pitch, dy: rows / 2, w: 1.4, h: 1.8, shape: 'circle', layer: 'both', holeR: 0.5 });
  const half = (per - 1) / 2 * pitch + 3.2;
  P.push({ dx: -half, dy: 0, w: 3.2, h: 3.2, shape: 'circle', layer: 'both', holeR: 1.3 });
  P.push({ dx: half, dy: 0, w: 3.2, h: 3.2, shape: 'circle', layer: 'both', holeR: 1.3 });
  return P;
};
// 共模电感（4 pin THT）
const cmc4 = [{ dx: -3.81, dy: -2.54, w: 1.9, h: 1.9, shape: 'circle', layer: 'both', holeR: 0.6 }, { dx: 3.81, dy: -2.54, w: 1.9, h: 1.9, shape: 'circle', layer: 'both', holeR: 0.6 },
  { dx: 3.81, dy: 2.54, w: 1.9, h: 1.9, shape: 'circle', layer: 'both', holeR: 0.6 }, { dx: -3.81, dy: 2.54, w: 1.9, h: 1.9, shape: 'circle', layer: 'both', holeR: 0.6 }];
// 变压器 THT（2 排 3 pin）
const xfmr6 = [-2.54, 0, 2.54].flatMap(dy => [-2.54, 2.54].map(dx => ({ dx, dy, w: 1.9, h: 1.9, shape: 'circle', layer: 'both', holeR: 0.6 })));
// SOT-89（tab + 3 pin）
const sot89 = [{ dx: 0, dy: -1.2, w: 4.5, h: 2.2 }, { dx: -1.5, dy: 2.9, w: 0.8, h: 2.0 }, { dx: 0, dy: 2.9, w: 0.8, h: 2.0 }, { dx: 1.5, dy: 2.9, w: 0.8, h: 2.0 }];
// TQFP32（0.8 节距）
const tqfp32 = (() => { const P = [], s = 3.5 * 0.8, A = s + 1.1; for (let k = 0; k < 8; k++) P.push({ dx: -A, dy: -s + k * 0.8, w: 1.5, h: 0.45 }); for (let k = 0; k < 8; k++) P.push({ dx: -s + k * 0.8, dy: A, w: 0.45, h: 1.5 }); for (let k = 0; k < 8; k++) P.push({ dx: A, dy: s - k * 0.8, w: 1.5, h: 0.45 }); for (let k = 0; k < 8; k++) P.push({ dx: s - k * 0.8, dy: -A, w: 0.45, h: 1.5 }); return P; })();
// LQFP48
const qfpPads = (per, pitch, pw, ph, off) => {
  const s = (per - 1) / 2 * pitch, A = s + (off != null ? off : 1.1), P = [];
  for (let k = 0; k < per; k++) P.push({ dx: -A, dy: -s + k * pitch, w: ph, h: pw });
  for (let k = 0; k < per; k++) P.push({ dx: -s + k * pitch, dy: A, w: pw, h: ph });
  for (let k = 0; k < per; k++) P.push({ dx: A, dy: s - k * pitch, w: ph, h: pw });
  for (let k = 0; k < per; k++) P.push({ dx: s - k * pitch, dy: -A, w: pw, h: ph });
  return P;
};
// 邮票孔半孔（castellated，圆心在板边）
const castRow = (n, pitch, y, x0) => Array.from({ length: n }, (_, k) => ({ dx: x0 + k * pitch, dy: y, w: 1.1, h: 1.1, shape: 'circle', layer: 'both', holeR: 0.35 }));

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

// n93: SS-12D00 拨动开关电源选择 —— 拨动开关首测
{
  const nets = ['vin1', 'vin2', 'vsw1', 'vsw2', 'vout', 'gnd'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n93 拨动开关电源选择', { width: 40, height: 18, nets });
  c.place('SW1', slide3, 12, 6, ['vin1', 'vsw1', null], CM(12, 6, 0, 'SS-12D00', 'SLIDE-3'));
  c.place('SW2', slide3, 12, 13, ['vin2', 'vsw2', null], CM(12, 13, 0, 'SS-12D00', 'SLIDE-3'));
  c.place('D1', smc2, 22, 6, ['vsw1', 'vout'], CM(22, 6, 0, 'SS14', 'SMC'));
  c.place('D2', smc2, 22, 13, ['vsw2', 'vout'], CM(22, 13, 0, 'SS14', 'SMC'));
  c.place('C1', fp805, 30, 10, ['vout', 'gnd'], CM(30, 10, 0, '100u', 'C0805'));
  c.place('J1', term(2), 3, 6, ['vin1', 'gnd'], CM(3, 6, 90, 'A', 'TB-2P'));
  c.place('J2', term(2), 3, 13, ['vin2', 'gnd'], CM(3, 13, 90, 'B', 'TB-2P'));
  c.place('J3', term(2), 36, 10, ['vout', 'gnd'], CM(36, 10, 90, 'OUT', 'TB-2P'));
  c.save('n93-slide-select');
}

// n94: EC11 旋转编码器接口 —— 非对称 3+2 封装首测
{
  const nets = ['v5', 'gnd', 'a', 'b', 'sw'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n94 EC11 编码器接口', { width: 36, height: 26, nets });
  c.place('U1', ec11, 15, 13, ['gnd', 'a', 'v5', 'sw', 'gnd'], CM(15, 13, 0, 'EC11', 'EC11'));
  c.place('R1', fp603, 26, 7, ['v5', 'a'], CM(26, 7, 0, '10k', 'R0603'));
  c.place('R2', fp603, 26, 12, ['v5', 'b'], CM(26, 12, 0, '10k', 'R0603'));
  c.place('R3', fp603, 26, 17, ['v5', 'sw'], CM(26, 17, 0, '10k', 'R0603'));
  c.place('C1', fp805, 31, 7, ['a', 'gnd'], CM(31, 7, 0, '10n', 'C0805'));
  c.place('C2', fp805, 31, 12, ['b', 'gnd'], CM(31, 12, 0, '10n', 'C0805'));
  c.place('C3', fp805, 31, 17, ['sw', 'gnd'], CM(31, 17, 0, '100n', 'C0805'));
  c.place('J1', hd(5), 4, 13, ['v5', 'gnd', 'a', 'b', 'sw'], CM(4, 13, 90, 'MCU', 'HDR-5P'));
  c.save('n94-ec11');
}

// n95: 0Ω 跳线配置阵列 —— 配置跳线维度
{
  const nets = ['sig1', 'sig2', 'sig3', 'sig4', 'cfg1', 'cfg2', 'cfg3', 'cfg4', 'v5', 'gnd'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n95 跳线配置阵列', { width: 46, height: 22, nets });
  for (let k = 0; k < 4; k++) {
    const x = 10 + k * 8;
    c.place(`J${k + 1}`, fp603, x, 7, [`sig${k + 1}`, `cfg${k + 1}`], CM(x, 7, 0, '0R', 'R0603'));
    c.place(`R${k + 1}`, fp603, x, 13, [`cfg${k + 1}`, k % 2 ? 'v5' : 'gnd'], CM(x, 13, 0, '10k', 'R0603'));
    c.place(`R${k + 5}`, fp603, x, 18, [`cfg${k + 1}`, k % 2 ? 'gnd' : 'v5'], CM(x, 18, 0, '10k', 'R0603'));
  }
  c.place('J5', hd(4), 4, 7, ['sig1', 'sig2', 'sig3', 'sig4'], CM(4, 7, 90, 'IN', 'HDR-4P'));
  c.place('J6', hd(4), 42, 7, ['sig1', 'sig2', 'sig3', 'sig4'], CM(42, 7, 90, 'OUT', 'HDR-4P'));
  c.place('C1', fp805, 42, 16, ['v5', 'gnd'], CM(42, 16, 0, '100n', 'C0805'));
  c.save('n95-jumper-cfg');
}

// n96: 表贴轻触按键 ×4 —— SMD 4 脚开关首测
{
  const nets = ['v5', 'gnd', 'k1', 'k2', 'k3', 'k4'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n96 轻触按键 ×4', { width: 48, height: 24, nets });
  for (let k = 0; k < 4; k++) {
    const x = 9 + k * 9;
    c.place(`SW${k + 1}`, tact4, x, 8, ['gnd', 'gnd', `k${k + 1}`, `k${k + 1}`], CM(x, 8, 0, 'TACT', 'TACT-SMD'));
    c.place(`R${k + 1}`, fp603, x, 15, ['v5', `k${k + 1}`], CM(x, 15, 0, '10k', 'R0603'));
  }
  c.place('J1', hd(6), 43, 12, ['v5', 'gnd', 'k1', 'k2', 'k3', 'k4'], CM(43, 12, 90, 'MCU', 'HDR-6P'));
  c.save('n96-tact4');
}

// n97: U.FL→SMA 射频跳板 —— 射频座首测 + 直线走线意识
{
  const nets = ['rf', 'gnd'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n97 U.FL→SMA 跳板', { width: 40, height: 18, grid: 0.3, trackW: 0.2, clearance: 0.1, viaOuter: 0.6, viaDrill: 0.3, nets });
  c.place('J1', ufl, 8, 9, ['rf', 'rf', 'gnd', 'gnd'], CM(8, 9, 0, 'U.FL', 'UFL'));
  c.place('J2', sma, 30, 9, ['rf', 'gnd', 'gnd', 'gnd', 'gnd'], CM(30, 9, 0, 'SMA', 'SMA-E'));
  c.place('C1', fp402, 19, 4, ['gnd', 'gnd'], CM(19, 4, 0, 'NA', 'C0402'));
  c.save('n97-ufl-sma');
}

// ============ 中等档 ============

// n98: SD 卡 SPI 接口 —— 卡座单侧焊盘首测
{
  const nets = ['v33', 'gnd', 'cs', 'mosi', 'miso', 'sck', 'cd'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n98 SD 卡 SPI', { width: 50, height: 30, nets });
  const sdn = ['cd', 'cs', 'mosi', 'v33', 'sck', 'gnd', 'miso', 'v33', 'gnd', 'gnd', 'gnd', 'gnd', 'gnd'];
  sdSlot.forEach((f, i) => c.add('J1', i + 1, sdn[i], 13 + f.dx, 9 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.J1 = CM(13, 9, 0, 'microSD', 'TF-PUSH');
  c.place('R1', fp603, 32, 8, ['v33', 'cs'], CM(32, 8, 0, '10k', 'R0603'));
  c.place('R2', fp603, 32, 13, ['v33', 'mosi'], CM(32, 13, 0, '10k', 'R0603'));
  c.place('C1', fp805, 32, 20, ['v33', 'gnd'], CM(32, 20, 0, '100n', 'C0805'));
  c.place('J2', hd(7), 43, 14, ['v33', 'gnd', 'cs', 'mosi', 'miso', 'sck', 'cd'], CM(43, 14, 90, 'MCU', 'HDR-7P'));
  c.save('n98-sd-spi');
}

// n99: DB-9 RS-232 —— D-sub 首测 + 电荷泵电容阵列
{
  const nets = ['v5', 'gnd', 'tx0', 'rx0', 'td', 'rts', 'cts', 'vpos', 'c1p', 'c1n', 'c2p', 'c2n', 'vp', 'vn'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n99 DB-9 RS-232', { width: 66, height: 30, nets });
  const dsub9 = dsub(9);
  const dbn = ['gnd', 'td', 'rx0', 'rts', 'cts', null, null, null, 'gnd', 'gnd', 'gnd'];
  dsub9.forEach((f, i) => c.add('J1', i + 1, dbn[i], 12 + f.dx, 15 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.J1 = CM(12, 15, 0, 'DB-9', 'DSUB-9');
  const so16 = mk('SOIC-16');
  const m232 = ['c1p', 'vp', 'c1n', 'vn', 'c2p', 'c2n', 'td', 'gnd', 'rx0', 'v5', 'cts0', 'rts0', 'tx0', 'cts', 'rts', 'vpos'];
  // 简化按 MAX232 功能排布（电荷泵电容 4 颗）
  const m232n = ['c1p', 'vp', 'c1n', 'c2p', 'c2n', 'vn', 'td', 'gnd', 'rx0', 'v5', null, null, 'tx0', 'rts', 'cts', 'vpos'];
  so16.forEach((f, i) => c.add('U1', i + 1, m232n[i], 40 + f.dx, 15 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U1 = CM(40, 15, 0, 'MAX232', 'SOIC-16');
  c.place('C1', fp805, 32, 6, ['c1p', 'vp'], CM(32, 6, 0, '100n', 'C0805'));
  c.place('C2', fp805, 32, 24, ['c1n', 'gnd'], CM(32, 24, 0, '100n', 'C0805'));
  c.place('C3', fp805, 48, 6, ['c2p', 'c2n'], CM(48, 6, 0, '100n', 'C0805'));
  c.place('C4', fp805, 48, 24, ['vpos', 'gnd'], CM(48, 24, 0, '100n', 'C0805'));
  c.place('C5', fp805, 54, 24, ['vn', 'gnd'], CM(54, 24, 0, '100n', 'C0805'));
  c.place('J2', hd(5), 60, 15, ['v5', 'gnd', 'tx0', 'rx0', null], CM(60, 15, 90, 'MCU', 'HDR-5P'));
  c.save('n99-db9-rs232');
}

// n100: 三运放仪表放大器 —— INA 拓扑 + 高阻走线
{
  const nets = ['inp', 'inn', 'rg1', 'rg2', 'a1o', 'a2o', 'ref', 'out', 'fb', 'vpos', 'vneg', 'agnd'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n100 三运放仪表放大', { width: 56, height: 30, nets });
  const so8 = mk('SOIC-8');
  const amps = [
    ['inp', 'rg1', 'a1o', 'vpos', 'agnd', 'vneg'],
    ['inn', 'rg2', 'a2o', 'vpos', 'agnd', 'vneg'],
    ['a2o', 'fb', 'out', 'vpos', 'agnd', 'vneg']];
  amps.forEach((an, u) => {
    so8.forEach((f, i) => c.add(`U${u + 1}`, i + 1, [an[0], an[1], an[2], 'vneg', an[3] === 'vpos' ? 'agnd' : an[3], null, null, an[3]][i] || null, 16 + u * 14 + f.dx, 15 + f.dy, f.w, f.h, f.shape, f.layer));
    c.compsMeta[`U${u + 1}`] = CM(16 + u * 14, 15, 0, 'OPA2277', 'SOIC-8');
  });
  c.place('R1', fp603, 20, 7, ['a1o', 'fb'], CM(20, 7, 0, '10k', 'R0603'));
  c.place('R2', fp603, 28, 7, ['fb', 'a2o'], CM(28, 7, 0, '10k', 'R0603'));
  c.place('R3', fp603, 14, 24, ['rg1', 'rg2'], CM(14, 24, 0, 'RG', 'R0603'));
  c.place('R4', fp603, 40, 7, ['fb', 'out'], CM(40, 7, 0, '20k', 'R0603'));
  c.place('R5', fp603, 46, 7, ['out', 'ref'], CM(46, 7, 0, '10k', 'R0603'));
  c.place('C1', fp805, 46, 22, ['ref', 'agnd'], CM(46, 22, 0, '10u', 'C0805'));
  c.place('J1', term(3), 4, 15, ['inp', 'agnd', 'inn'], CM(4, 15, 90, 'IN', 'TB-3P'));
  c.place('J2', hd(4), 52, 22, ['out', 'ref', 'agnd', 'gnd_x'].map(x => x === 'gnd_x' ? null : x), CM(52, 22, 90, 'OUT', 'HDR-4P'));
  c.save('n100-ina3');
}

// n101: 开尔文四线电流检测 —— Kelvin shunt 结构
{
  const nets = ['bus_p', 'load_p', 'sns_p', 'sns_n', 'gnd_k', 'v33', 'gnd', 'sda', 'scl'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n101 开尔文四线检测', { width: 56, height: 26, grid: 0.325, trackW: 0.2, clearance: 0.1, viaOuter: 0.6, viaDrill: 0.3, nets });
  // Shunt 主体 2 pad + sense 2 pad 紧贴（4 焊盘一排，Kelvin）
  const kelvin = [
    { dx: -7.5, dy: 0, w: 4.6, h: 4.6 }, { dx: 7.5, dy: 0, w: 4.6, h: 4.6 },
    { dx: -2.6, dy: 0, w: 1.4, h: 2.8 }, { dx: 2.6, dy: 0, w: 1.4, h: 2.8 }];
  const kn = ['bus_p', 'load_p', 'sns_p', 'sns_n'];
  kelvin.forEach((f, i) => c.add('R1', i + 1, kn[i], 20 + f.dx, 13 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.R1 = CM(20, 13, 0, 'R003-4W', 'KELVIN');
  const msop = [];
  { const s = 2 * 0.65; for (let k = 0; k < 5; k++) msop.push({ dx: -2.3, dy: -s + k * 0.65, w: 1.4, h: 0.35 }); for (let k = 4; k >= 0; k--) msop.push({ dx: 2.3, dy: -s + k * 0.65, w: 1.4, h: 0.35 }); }
  const inaN = [null, 'sns_p', 'sns_n', 'gnd', 'v33', 'sda', 'scl', null, null, 'gnd'];
  msop.forEach((f, i) => c.add('U1', i + 1, inaN[i], 38 + f.dx, 9 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U1 = CM(38, 9, 0, 'INA226', 'MSOP-10');
  c.place('J1', term(2), 4, 8, ['bus_p', 'gnd_k'], CM(4, 8, 90, 'IN', 'TB-2P'));
  c.place('J2', term(2), 4, 19, ['load_p', 'gnd_k'], CM(4, 19, 90, 'OUT', 'TB-2P'));
  c.place('J3', hd(4), 48, 20, ['v33', 'gnd', 'sda', 'scl'], CM(48, 20, 90, 'I2C', 'HDR-4P'));
  c.place('C1', fp402, 38, 17, ['v33', 'gnd'], CM(38, 17, 0, '100n', 'C0402'));
  c.save('n101-kelvin');
}

// n102: 频率计前端 —— 分频链 74HC390 级联
{
  const nets = ['in_sig', 'sh_out', 'qa1', 'qb1', 'fdiv1', 'fdiv2', 'qa2', 'v5', 'gnd', 'mr'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n102 频率计前端', { width: 56, height: 26, nets });
  const so14 = mk('SOIC-14');
  const u1n = ['in_sig', 'sh_out', null, 'qb1', 'gnd', 'mr', null, 'qa1', null, null, 'fdiv1', null, null, 'v5'];
  so14.forEach((f, i) => c.add('U1', i + 1, u1n[i], 16 + f.dx, 13 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U1 = CM(16, 13, 0, '74HC390', 'SOIC-14');
  const u2n = ['fdiv1', 'sh_out', null, null, 'gnd', 'mr', null, 'qa2', null, null, 'fdiv2', null, null, 'v5'];
  so14.forEach((f, i) => c.add('U2', i + 1, u2n[i], 34 + f.dx, 13 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U2 = CM(34, 13, 0, '74HC390', 'SOIC-14');
  c.place('J1', hd(2), 4, 10, ['in_sig', 'gnd'], CM(4, 10, 90, 'IN', 'HDR-2P'));
  c.place('J2', hd(4), 50, 8, ['qa1', 'qb1', 'qa2', 'fdiv2'], CM(50, 8, 90, 'CNT', 'HDR-4P'));
  c.place('J3', hd(3), 50, 18, ['v5', 'gnd', 'mr'], CM(50, 18, 90, 'PWR', 'HDR-3P'));
  c.place('C1', fp805, 16, 5, ['v5', 'gnd'], CM(16, 5, 0, '100n', 'C0805'));
  c.place('C2', fp805, 34, 21, ['v5', 'gnd'], CM(34, 21, 0, '100n', 'C0805'));
  c.save('n102-freq-count');
}

// ============ 困难档 ============

// n103: 汽车输入防护链 —— TVS + PTC + 共模电感 + 稳压
{
  const nets = ['bat_in', 'bat_f', 'bat_c', 'v12', 'gnd', 'v5'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n103 汽车输入防护', { width: 66, height: 28, nets });
  c.place('F1', smc2, 10, 9, ['bat_in', 'bat_f'], CM(10, 9, 0, 'PTC-2A', 'SMC'));
  c.place('D1', smc2, 18, 9, ['bat_f', 'gnd'], CM(18, 9, 0, 'SMBJ24A', 'SMC'));
  c.place('L1', cmc4, 28, 9, ['bat_f', 'bat_c', 'v12', 'gnd'], CM(28, 9, 0, 'CMC-2A', 'CMC'));
  c.place('U1', to220, 44, 9, ['v12', 'v5', 'gnd'], CM(45.54, 9, 0, 'LM7805', 'TO-220'));
  c.place('C1', capBig, 38, 20, ['v12', 'gnd'], CM(38, 20, 0, '100u', 'CAP-THT'));
  c.place('C2', fp805, 50, 20, ['v5', 'gnd'], CM(50, 20, 0, '100n', 'C0805'));
  c.place('C3', fp805, 44, 20, ['bat_c', 'gnd'], CM(44, 20, 0, '100n', 'C0805'));
  c.place('D2', smc2, 26, 20, ['v12', 'gnd'], CM(26, 20, 0, 'TVS-5V', 'SMC'));
  c.place('J1', term(2), 3, 20, ['bat_in', 'gnd'], CM(3, 20, 90, 'BAT', 'TB-2P'));
  c.place('J2', term(2), 60, 20, ['v5', 'gnd'], CM(60, 20, 90, 'OUT', 'TB-2P'));
  c.save('n103-auto-prot');
}

// n104: Royer 逆变 —— 谐振变压器拓扑
{
  const nets = ['vin', 'gnd', 'ct', 'b1', 'b2', 'sec1', 'sec2'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n104 Royer 逆变', { width: 60, height: 32, nets });
  c.place('T1', xfmr6, 30, 16, ['ct', 'b1', 'b2', 'sec1', 'sec2', null], CM(30, 16, 0, 'EE16', 'XFMR-6'));
  c.place('Q1', to220, 12, 10, ['b1', 'vin', 'ct'], CM(13.54, 10, 0, 'MOS-N', 'TO-220'));
  c.place('Q2', to220, 12, 22, ['b2', 'vin', 'ct'], CM(13.54, 22, 0, 'MOS-N', 'TO-220'));
  c.place('R1', thR, 20, 8, ['vin', 'ct'], CM(20, 8, 0, '470R', 'R-THT'));
  c.place('R2', thR, 20, 24, ['ct', 'gnd'], CM(20, 24, 0, '470R', 'R-THT'));
  c.place('C1', thC, 26, 26, ['ct', 'gnd'], CM(26, 26, 0, '100n', 'C-THT'));
  c.place('C2', thC, 8, 16, ['vin', 'gnd'], CM(8, 16, 0, '47u', 'C-THT'));
  c.place('J1', term(2), 3, 5, ['vin', 'gnd'], CM(3, 5, 90, 'IN', 'TB-2P'));
  c.place('J2', term(2), 54, 10, ['sec1', 'sec2'], CM(54, 10, 90, 'LAMP', 'TB-2P'));
  c.save('n104-royer');
}

// n105: ZVS 感应加热驱动 —— 谐振半桥大电流
{
  const nets = ['vbus', 'gnd', 'sw1', 'sw2', 'tg1', 'tg2', 'lc1', 'lc2', 'vcc'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n105 ZVS 感应加热', { width: 70, height: 34, nets });
  c.place('Q1', to220, 20, 10, ['tg1', 'vbus', 'sw1'], CM(21.54, 10, 0, 'IRFP260', 'TO-220'));
  c.place('Q2', to220, 20, 24, ['tg2', 'sw1', 'gnd'], CM(21.54, 24, 0, 'IRFP260', 'TO-220'));
  c.place('Q3', to220, 44, 10, ['tg1', 'vbus', 'sw2'], CM(45.54, 10, 0, 'IRFP260', 'TO-220'));
  c.place('Q4', to220, 44, 24, ['tg2', 'sw2', 'gnd'], CM(45.54, 24, 0, 'IRFP260', 'TO-220'));
  c.place('L1', cmc4, 32, 8, ['sw1', 'lc1', 'sw2', 'lc2'], CM(32, 8, 0, 'LC-RES', 'CMC'));
  c.place('C1', thC, 32, 22, ['lc1', 'lc2'], CM(32, 22, 0, '330n', 'C-THT'));
  c.place('C2', capBig, 8, 16, ['vbus', 'gnd'], CM(8, 16, 0, '470u', 'CAP-THT'));
  c.place('C3', capBig, 60, 16, ['vbus', 'gnd'], CM(60, 16, 0, '470u', 'CAP-THT'));
  c.place('J1', term(2), 4, 30, ['vbus', 'gnd'], CM(4, 30, 0, 'BUS', 'TB-2P'));
  c.place('J2', term(2), 66, 30, ['lc1', 'lc2'], CM(66, 30, 0, 'COIL', 'TB-2P'));
  c.place('J3', hd(3), 4, 5, ['vcc', 'gnd', 'vcc'], CM(4, 5, 90, 'DRV', 'HDR-3P'));
  c.save('n105-zvs');
}

// n106: 多绕组线性电源 —— 大电解 + 桥堆 THT + 三路稳压
{
  const nets = ['ac1', 'ac2', 'vpk', 'nkg', 'gnd', 'v15', 'v5', 'vf'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n106 多绕组线性电源', { width: 76, height: 40, nets });
  c.place('T1', xfmr6, 12, 20, ['ac1', 'ac2', 'ac1', 'vf', null, null], CM(12, 20, 0, 'TOROID', 'XFMR-6'));
  const br4 = mk('DIP-N', 4);
  c.place('BR1', br4, 26, 14, ['ac1', 'vpk', 'ac2', 'gnd'], CM(26, 14, 0, 'KBPC', 'BR4'));
  c.place('C1', capBig, 34, 10, ['vpk', 'gnd'], CM(34, 10, 0, '2200u', 'CAP-THT'));
  c.place('C2', capBig, 34, 20, ['vpk', 'gnd'], CM(34, 20, 0, '2200u', 'CAP-THT'));
  c.place('U1', to220, 44, 10, ['vpk', 'v15', 'gnd'], CM(45.54, 10, 0, 'LM7815', 'TO-220'));
  c.place('U2', to220, 44, 22, ['v15', 'v5', 'gnd'], CM(45.54, 22, 0, 'LM7805', 'TO-220'));
  c.place('C3', fp805, 52, 8, ['v15', 'gnd'], CM(52, 8, 0, '100n', 'C0805'));
  c.place('C4', fp805, 52, 16, ['v5', 'gnd'], CM(52, 16, 0, '100n', 'C0805'));
  c.place('C5', capBig, 34, 30, ['nkg', 'gnd'], CM(34, 30, 0, '1000u', 'CAP-THT'));
  c.place('D1', smc2, 26, 30, ['nkg', 'gnd'], CM(26, 30, 0, 'SS34', 'SMC'));
  c.place('J1', term(2), 3, 8, ['ac1', 'ac2'], CM(3, 8, 90, 'AC', 'TB-2P'));
  c.place('J2', term(3), 68, 12, ['v15', 'gnd', 'v5'], CM(68, 12, 90, 'OUT', 'TB-3P'));
  c.place('J3', hd(3), 68, 26, ['vf', 'gnd', 'nkg'], CM(68, 26, 90, 'AUX', 'HDR-3P'));
  c.save('n106-multi-psu');
}

// n107: 4S 锂电平衡头 —— 平衡 MOS 阵列 + 采样线束
{
  const nets = ['b0', 'b1', 'b2', 'b3', 'b4', 'bal1', 'bal2', 'bal3', 'bal4', 'chg_p', 'chg_n'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n107 4S 平衡头', { width: 60, height: 26, nets });
  const s23 = mk('SOT-23');
  for (let k = 0; k < 4; k++) {
    const x = 14 + k * 9;
    c.place(`Q${k + 1}`, s23, x, 9, [`bal${k + 1}`, `b${k}`, `b${k + 1}`], CM(x, 9, 0, 'AO4406', 'SOT-23'));
    c.place(`R${k + 1}`, fp805, x, 16, [`bal${k + 1}`, `b${k + 1}`], CM(x, 16, 0, '47R', 'R0805'));
  }
  c.place('J1', term(5), 24, 22, ['b0', 'b1', 'b2', 'b3', 'b4'], CM(24, 22, 0, 'CELLS', 'TB-5P'));
  c.place('J2', term(2), 4, 22, ['chg_p', 'chg_n'], CM(4, 22, 0, 'CHG', 'TB-2P'));
  c.place('J3', hd(5), 46, 8, ['b1', 'b2', 'b3', 'b4', 'gnd_x'].map(x => x === 'gnd_x' ? null : x), CM(46, 8, 90, 'MON', 'HDR-5P'));
  c.place('C1', fp805, 8, 8, ['chg_p', 'chg_n'], CM(8, 8, 0, '10u', 'C0805'));
  c.save('n107-4s-bal');
}

// ============ 超难档 ============

// n108: BLDC 霍尔换相 —— 霍尔 ×3 + SOT-89 三相桥全链
{
  const netObjs = ['v5', 'gnd', 'h1', 'h2', 'h3', 'gh_u', 'gl_u', 'gh_v', 'gl_v', 'gh_w', 'gl_w', 'pu', 'pv', 'pw', 'vb'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n108 BLDC 霍尔换相', { width: 76, height: 44, grid: 0.5, trackW: 0.3, clearance: 0.15, nets: netObjs });
  const qfp32 = tqfp32;
  const rp = ['gh_u', 'gl_u', 'gh_v', 'gl_v', 'gh_w', 'gl_w', 'h1', 'h2', 'h3', 'gnd', 'v5', 'gnd',
    'pu', 'pv', 'pw', 'vb', 'gnd', 'v5', 'gnd', 'v5', 'gnd', 'v5', 'gnd', 'v5',
    'gnd', 'v5', 'gnd', 'v5', 'gnd', 'v5', 'gnd', 'v5'];
  qfp32.forEach((f, i) => c.add('U1', i + 1, rp[i] || null, 38 + f.dx, 22 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U1 = CM(38, 22, 0, 'MCU-BLDC', 'TQFP-32');
  const s23 = mk('SOT-23');
  for (let k = 0; k < 3; k++) c.place(`H${k + 1}`, s23, 14 + k * 5, 8, ['v5', `h${k + 1}`, 'gnd'], CM(14 + k * 5, 8, 0, 'Hall', 'SOT-23'));
  // 三相桥：6× SOT-89（tab=漏极）
  const bridges = [['gh_u', 'pu', 'gl_u', 'vb'], ['gh_v', 'pv', 'gl_v', 'vb'], ['gh_w', 'pw', 'gl_w', 'vb']];
  bridges.forEach((br, k) => {
    const x = 20 + k * 16;
    c.place(`Q${k * 2 + 1}`, sot89, x, 32, [br[0], 'vb', br[1]], CM(x, 32, 0, 'MOS-N', 'SOT-89'));
    c.place(`Q${k * 2 + 2}`, sot89, x, 14, [br[2], br[1], 'vb'], CM(x, 14, 0, 'MOS-N', 'SOT-89'));
  });
  c.place('J1', term(3), 68, 36, ['pu', 'pv', 'pw'], CM(68, 36, 0, 'PHASE', 'TB-3P'));
  c.place('J2', term(2), 68, 12, ['vb', 'gnd'], CM(68, 12, 0, 'VM', 'TB-2P'));
  c.place('J3', hd(5), 4, 30, ['v5', 'gnd', 'h1', 'h2', 'h3'], CM(4, 30, 90, 'HALL', 'HDR-5P'));
  c.place('C1', fp805, 10, 20, ['vb', 'gnd'], CM(10, 20, 0, '100n', 'C0805'));
  c.place('C2', fp805, 30, 4, ['v5', 'gnd'], CM(30, 4, 0, '100n', 'C0805'));
  c.save('n108-bldc-hall');
}

// n109: 保护环高阻测量前端 —— manual gnd 环 + 布线器环口进入
{
  const nets = ['in_sig', 'gnd', 'out', 'vpos', 'vneg'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n109 保护环高阻前端', { width: 56, height: 34, nets });
  const so8 = mk('SOIC-8');
  c.place('U1', so8, 38, 17, ['out', 'vneg', 'in_sig', 'gnd', 'gnd', null, null, 'vpos'], CM(38, 17, 0, 'LMC6001', 'SOIC-8'));
  c.place('J1', term(2), 5, 17, ['in_sig', 'gnd'], CM(5, 17, 90, 'IN', 'TB-2P'));
  c.place('J2', hd(4), 51, 17, ['out', 'gnd', 'vpos', 'vneg'], CM(51, 17, 90, 'OUT', 'HDR-4P'));
  c.place('C1', fp805, 38, 8, ['vpos', 'gnd'], CM(38, 8, 0, '100n', 'C0805'));
  c.place('C2', fp805, 44, 8, ['vneg', 'gnd'], CM(44, 8, 0, '100n', 'C0805'));
  c.place('R1', fp603, 30, 28, ['out', 'vneg'], CM(30, 28, 0, '100M', 'R0603'));
  // 保护环：gnd 手动环，围绕 in_sig 走线走廊，右侧留 2.2mm 环口供 U1-IN+ 进入
  const ring = [];
  const pts = [[12, 11], [30, 11], [30, 20.5], [26, 20.5], [26, 13.5], [12, 13.5]];
  for (let k = 0; k < pts.length; k++) {
    const [x, y] = pts[k], nx = pts[(k + 1) % pts.length], ny = pts[(k + 1) % pts.length];
    const steps = Math.max(1, Math.round(Math.hypot(ny - y, nx - x) / 1.5));
    for (let s = 0; s < steps; s++) ring.push({ x: +(x + (nx - x) * s / steps).toFixed(3), y: +(y + (ny - y) * s / steps).toFixed(3), l: 0 });
  }
  ring.push({ x: 12, y: 11, l: 0 });
  c.d.manual = [{ netId: 'gnd', pts: ring }];
  c.save('n109-guard-ring');
}

// n110: 邮票孔拼板载板 —— 半孔 castellated 阵列 + 双子板
{
  const nets = ['v33', 'gnd', 'swclk', 'swdio', 'x1', 'x2', 'sda', 'scl', 'p0', 'p1', 'p2', 'p3'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n110 邮票孔拼板', { width: 72, height: 40, grid: 0.25, trackW: 0.15, clearance: 0.1, viaOuter: 0.5, viaDrill: 0.25, nets });
  // 子板 1（左）：MCU 最小系统
  const qfp48 = qfpPads(12, 0.5, 0.3, 1.2);
  const rp = ['x1', 'x2', 'swdio', 'swclk', 'gnd', 'v33', 'sda', 'scl', 'p0', 'p1', 'p2', 'p3',
    'gnd', 'v33', 'gnd', 'v33', 'gnd', 'v33', 'gnd', 'v33', 'gnd', 'v33', 'gnd', 'v33',
    'gnd', 'v33', 'gnd', 'v33', 'gnd', 'v33', 'gnd', 'v33', 'gnd', 'v33', 'gnd', 'v33',
    'gnd', 'v33', 'gnd', 'v33', 'gnd', 'v33', 'gnd', 'v33', 'gnd', 'v33', 'gnd', 'v33'];
  qfp48.forEach((f, i) => c.add('U1', i + 1, rp[i] || null, 18 + f.dx, 20 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U1 = CM(18, 20, 0, 'STM32F030', 'LQFP-48');
  c.place('Y1', xtal2, 6, 12, ['x1', 'x2'], CM(6, 12, 0, '8MHz', 'XTAL-3225'));
  c.place('C1', fp402, 11, 12, ['x1', 'gnd'], CM(11, 12, 0, '20p', 'C0402'));
  c.place('C2', fp402, 11, 16, ['x2', 'gnd'], CM(11, 16, 0, '20p', 'C0402'));
  c.place('J1', hd(4), 6, 24, ['v33', 'gnd', 'swclk', 'swdio'], CM(6, 24, 90, 'SWD', 'HDR-4P'));
  // 子板 2（右）：传感器接口（I2C 链）
  const so8 = mk('SOIC-8');
  c.place('U2', so8, 54, 20, ['sda', 'scl', null, 'gnd', null, null, null, 'v33'], CM(54, 20, 0, 'LM75', 'SOIC-8'));
  c.place('U3', so8, 66, 20, ['sda', 'scl', null, 'gnd', null, null, null, 'v33'], CM(66, 20, 0, 'LM75B', 'SOIC-8'));
  c.place('R1', fp603, 48, 8, ['v33', 'sda'], CM(48, 8, 0, '4k7', 'R0603'));
  c.place('R2', fp603, 52, 8, ['v33', 'scl'], CM(52, 8, 0, '4k7', 'R0603'));
  // 邮票孔：左右板边各 10 个半孔（castellated，圆心在板边）
  castRow(10, 3.0, 0, 21).forEach((f, i) => c.add('PB1', i + 1, ['gnd', 'v33', 'p0', 'p1', 'p2', 'p3', 'sda', 'scl', 'gnd', 'v33'][i], 21 + (i * 3.0) - 13.5, 0, f.w, f.h, f.shape, f.layer, f.holeR));
  castRow(10, 3.0, 40, 21).forEach((f, i) => c.add('PB2', i + 1, ['gnd', 'v33', 'p3', 'p2', 'p1', 'p0', 'scl', 'sda', 'v33', 'gnd'][i], 21 + (i * 3.0) - 13.5, 40, f.w, f.h, f.shape, f.layer, f.holeR));
  for (let k = 0; k < 4; k++) c.place(`C${k + 3}`, fp402, 24 + k * 4, 34, ['v33', 'gnd'], CM(24 + k * 4, 34, 0, '100n', 'C0402'));
  c.save('n110-mousebites');
}

// n111: DB-15 双游戏口多机接口 —— D-sub 15 + 多路复用
{
  const nets = ['v5', 'gnd', 'u1a', 'u1b', 'u1c', 'u1d', 'u1s', 'u2a', 'u2b', 'u2c', 'u2d', 'u2s', 'sel0', 'ma', 'mb', 'mc', 'md'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n111 双游戏口接口', { width: 90, height: 34, nets });
  const dsub15 = dsub(15);
  const g15 = ['v5', 'u1a', 'u1b', 'u1c', 'u1d', 'gnd', null, null, 'u1s', 'u2a', 'u2b', 'u2c', 'u2d', null, null, 'gnd', 'gnd'];
  dsub15.forEach((f, i) => c.add('J1', i + 1, g15[i], 20 + f.dx, 17 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.J1 = CM(20, 17, 0, 'DB-15', 'DSUB-15');
  const so16 = mk('SOIC-16');
  // 74HC157 双 4 选 1：两路游戏口共享 MCU 排针
  const hn = ['sel0', 'u1a', 'u1b', 'gnd', 'u1c', 'u1d', 'sel0', 'gnd', 'u1s', null, 'ma', 'mb', 'mc', 'md', 'v5', null];
  so16.forEach((f, i) => c.add('U1', i + 1, hn[i], 52 + f.dx, 10 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U1 = CM(52, 10, 0, '74HC157', 'SOIC-16');
  const hn2 = ['sel0', 'u2a', 'u2b', 'gnd', 'u2c', 'u2d', 'sel0', 'gnd', 'u2s', null, 'ma', 'mb', 'mc', 'md', 'v5', null];
  so16.forEach((f, i) => c.add('U2', i + 1, hn2[i], 52 + f.dx, 24 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U2 = CM(52, 24, 0, '74HC157', 'SOIC-16');
  c.place('J2', hd(8), 74, 17, ['v5', 'gnd', 'sel0', 'u2s', 'ma', 'mb', 'mc', 'md'], CM(74, 17, 90, 'MCU', 'HDR-8P'));
  c.place('C1', fp805, 40, 28, ['v5', 'gnd'], CM(40, 28, 0, '100n', 'C0805'));
  c.place('C2', fp805, 64, 30, ['v5', 'gnd'], CM(64, 30, 0, '100n', 'C0805'));
  c.save('n111-dsub15');
}

// n112: VFD 荧光显示驱动 —— 多路高压栅极/阳极 + 灯丝
{
  const nets = ['gnd', 'vneg', 'vf1', 'vf2', 'din', 'clk', 'stb'];
  for (let k = 0; k < 8; k++) nets.push(`an${k}`);
  for (let k = 0; k < 4; k++) nets.push(`gr${k}`);
  const netObjs = nets.map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n112 VFD 驱动', { width: 72, height: 40, grid: 0.5, trackW: 0.3, clearance: 0.15, nets: netObjs });
  const so24 = [];
  { const s = (12 - 1) / 2 * 1.27; for (let k = 0; k < 12; k++) so24.push({ dx: -4.6, dy: -s + k * 1.27, w: 1.6, h: 0.5 }); for (let k = 11; k >= 0; k--) so24.push({ dx: 4.6, dy: -s + k * 1.27, w: 1.6, h: 0.5 }); }
  const u1n = ['din', 'clk', 'stb', 'gnd', 'gnd', 'an0', 'an1', 'an2', 'an3', 'an4', 'an5', 'an6',
    'an7', 'gr0', 'gr1', 'gr2', 'gr3', 'vf1', 'vf2', 'vneg', 'vneg', 'gnd', null, null];
  so24.forEach((f, i) => c.add('U1', i + 1, u1n[i] || null, 26 + f.dx, 20 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U1 = CM(26, 20, 0, 'PT6312', 'SOIC-24');
  c.place('J1', hd2x(8), 52, 20, ['an0', 'an1', 'an2', 'an3', 'an4', 'an5', 'an6', 'an7', 'gr0', 'gr1', 'gr2', 'gr3', 'vf1', 'vf2', 'vneg', 'gnd'], CM(52, 20, 0, 'VFD', 'HDR-2x8'));
  c.place('J2', hd(5), 6, 20, ['din', 'clk', 'stb', 'vneg', 'gnd'], CM(6, 20, 90, 'MCU', 'HDR-5P'));
  c.place('C1', fp805, 16, 8, ['vneg', 'gnd'], CM(16, 8, 0, '10u', 'C0805'));
  c.place('C2', fp805, 22, 8, ['vneg', 'gnd'], CM(22, 8, 0, '100n', 'C0805'));
  c.save('n112-vfd');
}

// ============ 自检门（spec 门同款 + 半孔豁免）============
let fail = 0;
const dirs = ['n93-slide-select', 'n94-ec11', 'n95-jumper-cfg', 'n96-tact4', 'n97-ufl-sma',
  'n98-sd-spi', 'n99-db9-rs232', 'n100-ina3', 'n101-kelvin', 'n102-freq-count',
  'n103-auto-prot', 'n104-royer', 'n105-zvs', 'n106-multi-psu', 'n107-4s-bal',
  'n108-bldc-hall', 'n109-guard-ring', 'n110-mousebites', 'n111-dsub15', 'n112-vfd'];
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
    if (isCast(p, d)) continue;   // 铸铜半孔豁免
    const hw = p.w / 2, hh = p.shape === 'circle' ? p.w / 2 : p.h / 2;
    if (p.x - hw < -1e-9 || p.x + hw > d.width + 1e-9 || p.y - hh < -1e-9 || p.y + hh > d.height + 1e-9)
      problems.push(`出板 ${p.id} @(${p.x},${p.y})`);
  }
  if (problems.length) { console.error(`✗ ${dir}:`); problems.forEach(p => console.error('   ' + p)); fail = 1; }
  else console.log(`✓ ${dir}: 网表完整`);
}
if (fail) process.exit(1);
console.log('\n全部 20 项目自检通过');
