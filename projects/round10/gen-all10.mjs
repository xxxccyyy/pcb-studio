// 第十轮批量 spec 生成：N133-N152（20 项目，4 档，全部与前九轮不同的设计维度）
// 新维度：BNC/RCA/DC-005/XLR/电池弹片/TO-247/KBP 桥/旋转编码开关(17 pad 圆周)/
//         4 位数码管/SRD 继电器/5×7 点阵扫描、三分区隔离带、宽走线端子节距、
//         null-net 工装孔+基准点工艺边、LQFP64 双电源域、THT 插装密度
// 自检门：坏引用/单脚网/空网/同元件间距(DRC padGap)/出板(半孔豁免)/THT 环宽
import { designDefaults, footprintPads, padGap } from '../../src/engine.mjs';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';

const base = new URL('./', import.meta.url);
const mk = (n, count) => footprintPads(n, count);
const fp402 = mk('0402'), fp603 = mk('0603'), fp805 = mk('0805'), fp1206 = mk('1206');

// ---- 手动封装 ----
const hd = (n, pitch = 2.54) => Array.from({ length: n }, (_, k) => ({ dx: (k - (n - 1) / 2) * pitch, dy: 0, w: 1.7, h: 1.7, shape: 'circle', layer: 'both', holeR: 0.45 }));
const term = (n, pitch = 5.0) => Array.from({ length: n }, (_, k) => ({ dx: (k - (n - 1) / 2) * pitch, dy: 0, w: 2.2, h: 2.2, shape: 'circle', layer: 'both', holeR: 0.8 }));
const to220 = [0, 1, 2].map(k => ({ dx: k * 2.54, dy: 0, w: 1.9, h: 1.9, shape: 'circle', layer: 'both', holeR: 0.6 }));
const smc2 = [{ dx: -2.6, dy: 0, w: 2.4, h: 3.8 }, { dx: 2.6, dy: 0, w: 2.4, h: 3.8 }];
const xtal2 = [{ dx: -1.1, dy: 0, w: 1.3, h: 3.4 }, { dx: 1.1, dy: 0, w: 1.3, h: 3.4 }];
const thLED = [{ dx: 0, dy: 0, w: 1.2, h: 1.2, shape: 'circle', layer: 'both', holeR: 0.35 }, { dx: 2.54, dy: 0, w: 1.2, h: 1.2, shape: 'circle', layer: 'both', holeR: 0.35 }];
const thR = [{ dx: -1.27, dy: 0, w: 1.3, h: 1.3, shape: 'circle', layer: 'both', holeR: 0.35 }, { dx: 1.27, dy: 0, w: 1.3, h: 1.3, shape: 'circle', layer: 'both', holeR: 0.35 }];
const thC = [{ dx: -1.27, dy: 0, w: 1.6, h: 1.6, shape: 'circle', layer: 'both', holeR: 0.4 }, { dx: 1.27, dy: 0, w: 1.6, h: 1.6, shape: 'circle', layer: 'both', holeR: 0.4 }];
// BNC 座（中心针 + 4 接地腿 + 2 安装孔）
const bnc = [{ dx: 0, dy: 0, w: 1.8, h: 1.8, shape: 'circle', layer: 'both', holeR: 0.65 },
  ...[[0, 4.2], [4.2, 0], [0, -4.2], [-4.2, 0]].map(([dx, dy]) => ({ dx, dy, w: 2.2, h: 2.2, shape: 'circle', layer: 'both', holeR: 0.9 })),
  { dx: -7.5, dy: 0, w: 3.0, h: 3.0, shape: 'circle', layer: 'both', holeR: 1.2 }, { dx: 7.5, dy: 0, w: 3.0, h: 3.0, shape: 'circle', layer: 'both', holeR: 1.2 }];
// RCA 莲花座（中心针 + 环端子 + 2 固定）
const rca = [{ dx: 0, dy: 0, w: 1.7, h: 1.7, shape: 'circle', layer: 'both', holeR: 0.6 },
  { dx: 0, dy: 4.5, w: 2.2, h: 2.2, shape: 'circle', layer: 'both', holeR: 0.8 },
  { dx: -5.5, dy: 0, w: 2.6, h: 2.6, shape: 'circle', layer: 'both', holeR: 1.0 }, { dx: 5.5, dy: 0, w: 2.6, h: 2.6, shape: 'circle', layer: 'both', holeR: 1.0 }];
// DC-005 电源座（3 pin + 2 固定）
const dc005 = [{ dx: -2.0, dy: -2.4, w: 1.7, h: 2.6, shape: 'circle', layer: 'both', holeR: 0.55 }, { dx: 0, dy: 2.4, w: 1.7, h: 2.6, shape: 'circle', layer: 'both', holeR: 0.55 }, { dx: 2.0, dy: -2.4, w: 1.7, h: 2.6, shape: 'circle', layer: 'both', holeR: 0.55 },
  { dx: -6.4, dy: 0, w: 3.0, h: 3.0, shape: 'circle', layer: 'both', holeR: 1.1 }, { dx: 6.4, dy: 0, w: 3.0, h: 3.0, shape: 'circle', layer: 'both', holeR: 1.1 }];
// 光敏电阻 LDR（2 pin 大盘）
const ldr2 = [-2.54, 2.54].map(dx => ({ dx, dy: 0, w: 2.0, h: 2.0, shape: 'circle', layer: 'both', holeR: 0.55 }));
// 蜂鸣器 THT（2 pin 7.62 大间距）
const buz2 = [-3.81, 3.81].map(dx => ({ dx, dy: 0, w: 1.7, h: 1.7, shape: 'circle', layer: 'both', holeR: 0.55 }));
// XLR 卡侬（3 pin 圆周 120° + 2 固定）
const xlr3 = (() => { const P = []; for (let k = 0; k < 3; k++) { const a = k * 2 * Math.PI / 3 - Math.PI / 2; P.push({ dx: +(Math.cos(a) * 4.7).toFixed(3), dy: +(Math.sin(a) * 4.7).toFixed(3), w: 2.0, h: 2.0, shape: 'circle', layer: 'both', holeR: 0.7 }); } P.push({ dx: -9.0, dy: 0, w: 3.0, h: 3.0, shape: 'circle', layer: 'both', holeR: 1.1 }); P.push({ dx: 9.0, dy: 0, w: 3.0, h: 3.0, shape: 'circle', layer: 'both', holeR: 1.1 }); return P; })();
// 电池仓弹片（长条大盘一对，5 对）
const cellSpring = [-2.5, 2.5].map(dx => ({ dx, dy: 0, w: 2.6, h: 4.6 }));
// TO-247（3 pin 大间距 5.45 + 安装孔）
const to247 = [-5.45, 0, 5.45].map(dx => ({ dx, dy: 0, w: 2.6, h: 2.6, shape: 'circle', layer: 'both', holeR: 0.9 })).concat([{ dx: 0, dy: -7.0, w: 4.0, h: 4.0, shape: 'circle', layer: 'both', holeR: 1.6 }]);
// KBP 桥堆（4 pin 方形 ±2.54 + 中心孔）
const kbp4 = [{ dx: -2.54, dy: -2.54, w: 1.6, h: 1.6, shape: 'circle', layer: 'both', holeR: 0.5 }, { dx: 2.54, dy: -2.54, w: 1.6, h: 1.6, shape: 'circle', layer: 'both', holeR: 0.5 },
  { dx: 2.54, dy: 2.54, w: 1.6, h: 1.6, shape: 'circle', layer: 'both', holeR: 0.5 }, { dx: -2.54, dy: 2.54, w: 1.6, h: 1.6, shape: 'circle', layer: 'both', holeR: 0.5 }];
// 旋转编码开关（中心 common + 16 taps 圆周）
const rot16 = (() => {
  const P = [{ dx: 0, dy: 0, w: 2.4, h: 2.4, shape: 'circle', layer: 'both', holeR: 0.8 }];
  for (let k = 0; k < 16; k++) {
    const a = k * 2 * Math.PI / 16;
    P.push({ dx: +(Math.cos(a) * 7.5).toFixed(3), dy: +(Math.sin(a) * 7.5).toFixed(3), w: 1.3, h: 1.3, shape: 'circle', layer: 'both', holeR: 0.4 });
  }
  return P;
})();
// SRD 继电器（线圈 2 + 触点 3）
const srd5 = [{ dx: -2.54, dy: 3.81, w: 1.9, h: 1.9, shape: 'circle', layer: 'both', holeR: 0.6 }, { dx: 2.54, dy: 3.81, w: 1.9, h: 1.9, shape: 'circle', layer: 'both', holeR: 0.6 },
  { dx: -2.54, dy: -3.81, w: 1.9, h: 1.9, shape: 'circle', layer: 'both', holeR: 0.6 }, { dx: 0, dy: -3.81, w: 1.9, h: 1.9, shape: 'circle', layer: 'both', holeR: 0.6 }, { dx: 2.54, dy: -3.81, w: 1.9, h: 1.9, shape: 'circle', layer: 'both', holeR: 0.6 }];
// LQFP64
const qfpPads = (per, pitch, pw, ph, off) => {
  const s = (per - 1) / 2 * pitch, A = s + (off != null ? off : 1.1), P = [];
  for (let k = 0; k < per; k++) P.push({ dx: -A, dy: -s + k * pitch, w: ph, h: pw });
  for (let k = 0; k < per; k++) P.push({ dx: -s + k * pitch, dy: A, w: pw, h: ph });
  for (let k = 0; k < per; k++) P.push({ dx: A, dy: s - k * pitch, w: ph, h: pw });
  for (let k = 0; k < per; k++) P.push({ dx: s - k * pitch, dy: -A, w: pw, h: ph });
  return P;
};
const qfp64 = qfpPads(16, 0.5, 0.3, 1.1);
const qfp48 = qfpPads(12, 0.5, 0.3, 1.2);
// SOT-23-6（0.95 节距 pad 0.5）
const sot236 = [
  { dx: -0.95, dy: 0.95, w: 0.5, h: 0.9 }, { dx: 0, dy: 0.95, w: 0.5, h: 0.9 }, { dx: 0.95, dy: 0.95, w: 0.5, h: 0.9 },
  { dx: 0.95, dy: -0.95, w: 0.5, h: 0.9 }, { dx: 0, dy: -0.95, w: 0.5, h: 0.9 }, { dx: -0.95, dy: -0.95, w: 0.5, h: 0.9 }];

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

// n133: BNC 视频输出 —— BNC 座首测
{
  const nets = ['vid', 'gnd', 'vid_o'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n133 BNC 视频输出', { width: 40, height: 22, nets });
  c.place('J1', bnc, 12, 11, ['vid', 'gnd', 'gnd', 'gnd', 'gnd', 'gnd', 'gnd'], CM(12, 11, 0, 'BNC', 'BNC-F'));
  c.place('R1', thR, 26, 11, ['vid', 'vid_o'], CM(26, 11, 0, '75R', 'R-THT'));
  c.place('J2', hd(2), 35, 11, ['vid_o', 'gnd'], CM(35, 11, 90, 'IN', 'HDR-2P'));
  c.place('C1', thC, 26, 5, ['gnd', 'gnd'], CM(26, 5, 0, 'NA', 'C-THT'));
  c.save('n133-bnc');
}

// n134: RCA 双声道 —— RCA 座首测
{
  const nets = ['au_l', 'au_r', 'agnd'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n134 RCA 双声道', { width: 48, height: 22, nets });
  c.place('J1', rca, 12, 7, ['au_l', 'agnd', 'agnd', 'agnd'], CM(12, 7, 0, 'RCA-W', 'RCA'));
  c.place('J2', rca, 12, 16, ['au_r', 'agnd', 'agnd', 'agnd'], CM(12, 16, 0, 'RCA-R', 'RCA'));
  c.place('C1', fp805, 24, 7, ['au_l', 'agnd'], CM(24, 7, 0, '100n', 'C0805'));
  c.place('C2', fp805, 24, 16, ['au_r', 'agnd'], CM(24, 16, 0, '100n', 'C0805'));
  c.place('J3', hd(3), 40, 11, ['au_l', 'agnd', 'au_r'], CM(40, 11, 90, 'AMP', 'HDR-3P'));
  c.save('n134-rca');
}

// n135: DC-005 电源座 + 极性保护 —— DC-005 首测
{
  const nets = ['vin', 'vin_p', 'gnd'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n135 DC-005 电源座', { width: 44, height: 22, nets });
  const dcn = ['vin', 'gnd', 'gnd', 'gnd', 'gnd'];
  c.place('J1', dc005, 12, 11, dcn, CM(12, 11, 0, 'DC-005', 'DC-005'));
  c.place('D1', smc2, 24, 8, ['vin', 'vin_p'], CM(24, 8, 0, 'SS34', 'SMC'));
  c.place('D2', smc2, 24, 15, ['gnd', 'vin_p'], CM(24, 15, 0, 'SS34', 'SMC'));
  c.place('C1', fp1206, 33, 8, ['vin_p', 'gnd'], CM(33, 8, 0, '100u', 'C1206'));
  c.place('C2', fp1206, 33, 15, ['vin_p', 'gnd'], CM(33, 15, 0, '100n', 'C1206'));
  c.place('J2', term(2), 41, 11, ['vin_p', 'gnd'], CM(41, 11, 90, 'OUT', 'TB-2P'));
  c.save('n135-dc005');
}

// n136: 光敏电阻光控 —— LDR 首测
{
  const nets = ['v5', 'gnd', 'lux1', 'lux2', 'cmp'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n136 光敏光控开关', { width: 46, height: 20, nets });
  c.place('LDR1', ldr2, 8, 7, ['v5', 'lux1'], CM(8, 7, 0, 'LDR', 'LDR-5'));
  c.place('LDR2', ldr2, 8, 14, ['v5', 'lux2'], CM(8, 14, 0, 'LDR', 'LDR-5'));
  c.place('R1', fp603, 16, 7, ['lux1', 'gnd'], CM(16, 7, 0, '10k', 'R0603'));
  c.place('R2', fp603, 16, 14, ['lux2', 'gnd'], CM(16, 14, 0, '10k', 'R0603'));
  const so8 = mk('SOIC-8');
  c.place('U1', so8, 26, 11, ['cmp', 'lux1', 'lux2', 'gnd', null, null, null, 'v5'], CM(26, 11, 0, 'LM393', 'SOIC-8'));
  c.place('R3', fp603, 34, 8, ['cmp', 'v5'], CM(34, 8, 0, '10k', 'R0603'));
  c.place('J1', hd(3), 42, 11, ['v5', 'gnd', 'cmp'], CM(42, 11, 90, 'OUT', 'HDR-3P'));
  c.save('n136-ldr');
}

// n137: THT 蜂鸣器驱动 —— 大间距 2 pin 首测
{
  const nets = ['v5', 'gnd', 'drv', 'sig'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n137 蜂鸣器驱动', { width: 40, height: 20, nets });
  c.place('BZ1', buz2, 12, 10, ['v5', 'drv'], CM(12, 10, 0, 'B10-1205', 'BUZZER'));
  c.place('Q1', to220, 24, 10, ['sig', 'v5', 'drv'], CM(25.54, 10, 0, 'S8050', 'TO-220'));
  c.place('R1', fp603, 32, 5, ['sig', 'gnd'], CM(32, 5, 0, '1k', 'R0603'));
  c.place('D1', smc2, 18, 17, ['drv', 'v5'], CM(18, 17, 0, '1N4148', 'SMC'));
  c.place('J1', hd(2), 35, 15, ['sig', 'gnd'], CM(35, 15, 90, 'MCU', 'HDR-2P'));
  c.save('n137-buzzer');
}

// ============ 中等档 ============

// n138: XLR 平衡输入 —— 卡侬座首测 + 差分接收
{
  const nets = ['vpos', 'vneg', 'agnd', 'xh', 'xhot2', 'xcold', 'amp_p', 'amp_n', 'out'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n138 XLR 平衡输入', { width: 56, height: 28, nets });
  const xlrn = ['xh', 'xcold', 'xhot2', 'agnd', 'agnd'];
  c.place('J1', xlr3, 13, 14, xlrn, CM(13, 14, 0, 'XLR-F', 'XLR-3'));
  const so8 = mk('SOIC-8');
  c.place('U1', so8, 34, 14, ['out', 'amp_n', 'amp_p', 'vneg', 'agnd', null, null, 'vpos'], CM(34, 14, 0, 'NE5532', 'SOIC-8'));
  c.place('R1', fp603, 24, 8, ['xhot2', 'amp_p'], CM(24, 8, 0, '10k', 'R0603'));
  c.place('R2', fp603, 24, 20, ['xcold', 'amp_n'], CM(24, 20, 0, '10k', 'R0603'));
  c.place('R3', fp603, 30, 8, ['xh', 'agnd'], CM(30, 8, 0, '6k8', 'R0603'));
  c.place('R4', fp603, 42, 8, ['out', 'amp_n'], CM(42, 8, 0, '30k', 'R0603'));
  c.place('R5', fp603, 42, 20, ['amp_p', 'agnd'], CM(42, 20, 0, '10k', 'R0603'));
  c.place('C1', fp805, 26, 25, ['vpos', 'agnd'], CM(26, 25, 0, '100n', 'C0805'));
  c.place('C2', fp805, 32, 25, ['vneg', 'agnd'], CM(32, 25, 0, '100n', 'C0805'));
  c.place('J2', hd(3), 52, 14, ['out', 'agnd', 'gnd_x'].map(x => x === 'gnd_x' ? null : x), CM(52, 14, 90, 'OUT', 'HDR-3P'));
  c.save('n138-xlr');
}

// n139: 电池仓弹片接口 —— 长条弹片首测 + 4S 串联采样
{
  const nets = ['b0', 'b1', 'b2', 'b3', 'b4', 'gnd', 'vsys'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n139 电池仓接口', { width: 72, height: 26, nets });
  for (let k = 0; k < 5; k++) {
    const x = 8 + k * 13;
    c.place(`S${k + 1}`, cellSpring, x, 10, k < 4 ? [`b${k}`, `b${k + 1}`] : ['b4', 'b4'], CM(x, 10, 0, 'AA-Spring', 'SPRING'));
  }
  c.place('R1', fp603, 20, 20, ['b4', 'vsys'], CM(20, 20, 0, '0R', 'R0603'));
  c.place('C1', fp805, 26, 20, ['vsys', 'gnd'], CM(26, 20, 0, '10u', 'C0805'));
  c.place('J1', term(5), 48, 20, ['b0', 'b1', 'b2', 'b3', 'b4'], CM(48, 20, 0, 'TAP', 'TB-5P'));
  c.place('J2', term(2), 66, 20, ['vsys', 'gnd'], CM(66, 20, 0, 'SYS', 'TB-2P'));
  c.save('n139-battery-spring');
}

// n140: TO-247 IGBT 驱动 —— 大间距首测
{
  const nets = ['vbus', 'gnd', 'vdrive', 'gate', 'coll', 'emit'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n140 TO-247 IGBT', { width: 58, height: 30, nets });
  c.place('Q1', to247, 18, 14, ['gate', 'coll', 'emit', 'gnd'], CM(18, 14, 0, 'IGBT', 'TO-247'));
  c.place('R1', fp603, 8, 10, ['vdrive', 'gate'], CM(8, 10, 90, '10R', 'R0603'));
  c.place('R2', fp603, 8, 18, ['gate', 'emit'], CM(8, 18, 90, '10k', 'R0603'));
  c.place('D1', smc2, 30, 8, ['emit', 'gate'], CM(30, 8, 0, 'BAT54', 'SMC'));
  c.place('C1', thC, 40, 20, ['vbus', 'gnd'], CM(40, 20, 0, '1u-450V', 'C-THT'));
  c.place('J1', term(2), 4, 22, ['vbus', 'gnd'], CM(4, 22, 90, 'BUS', 'TB-2P'));
  c.place('J2', term(2), 50, 8, ['coll', 'emit'], CM(50, 8, 90, 'LOAD', 'TB-2P'));
  c.place('J3', hd(2), 4, 8, ['vdrive', 'gnd'], CM(4, 8, 90, 'DRV', 'HDR-2P'));
  c.save('n140-to247');
}

// n141: KBP 桥式整流 —— 桥堆首测
{
  const nets = ['ac1', 'ac2', 'vpk', 'gnd', 'vout'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n141 KBP 桥整流', { width: 50, height: 26, nets });
  c.place('BR1', kbp4, 14, 13, ['ac1', 'vpk', 'ac2', 'gnd'], CM(14, 13, 0, 'KBP-210', 'KBP'));
  c.place('C1', [{ dx: -2.5, dy: 0, w: 2.8, h: 2.8, shape: 'circle', layer: 'both', holeR: 1.0 }, { dx: 2.5, dy: 0, w: 2.8, h: 2.8, shape: 'circle', layer: 'both', holeR: 1.0 }], 28, 8, ['vpk', 'gnd'], CM(28, 8, 0, '470u', 'CAP-THT'));
  c.place('C2', fp805, 28, 18, ['vpk', 'gnd'], CM(28, 18, 0, '100n', 'C0805'));
  const lm = to220;
  c.place('U1', lm, 38, 13, ['vpk', 'vout', 'gnd'], CM(39.54, 13, 0, 'LM7805', 'TO-220'));
  c.place('C3', fp805, 46, 20, ['vout', 'gnd'], CM(46, 20, 0, '100n', 'C0805'));
  c.place('J1', term(2), 3, 13, ['ac1', 'ac2'], CM(3, 13, 90, 'AC', 'TB-2P'));
  c.place('J2', term(2), 46, 6, ['vout', 'gnd'], CM(46, 6, 90, 'OUT', 'TB-2P'));
  c.save('n141-kbp');
}

// n142: 旋转编码开关 16 位 —— 17 pad 圆周首测
{
  const nets = ['com'];
  for (let k = 0; k < 16; k++) nets.push(`ch${k}`);
  const netObjs = nets.map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n142 旋转编码开关', { width: 44, height: 44, nets: netObjs });
  const rn = ['com'];
  for (let k = 0; k < 16; k++) rn.push(`ch${k}`);
  rn.push('com');   // 18th pad（封装多出）→ 用 com
  rot16.forEach((f, i) => c.add('SW1', i + 1, rn[i] || null, 22 + f.dx, 22 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.SW1 = CM(22, 22, 0, 'ROTARY-16', 'ROT-16');
  
  c.place('J1', hd(9), 38, 22, ['com', 'ch0', 'ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'ch6', 'ch7'], CM(38, 22, 90, 'SEL', 'HDR-9P'));
  c.place('J2', hd(9), 22, 40, ['com', 'ch8', 'ch9', 'ch10', 'ch11', 'ch12', 'ch13', 'ch14', 'ch15'], CM(22, 40, 0, 'SEL2', 'HDR-9P'));
  c.save('n142-rot16');
}

// ============ 困难档 ============

// n143: 4 位数码管时钟 —— 12 pin 数码管 + RTC + 按键
{
  const nets = ['v5', 'gnd', 'x1', 'x2'];
  for (let k = 0; k < 8; k++) nets.push(`seg${k}`);   // A-G + DP
  for (let k = 0; k < 4; k++) nets.push(`dig${k}`);
  nets.push('sw1', 'sw2');
  const netObjs = nets.map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n143 四位数码管时钟', { width: 72, height: 34, nets: netObjs });
  c.place('LCD1', hd(12), 34, 10, ['seg0', 'seg1', 'seg2', 'seg3', 'seg4', 'seg5', 'seg6', 'seg7', 'dig0', 'dig1', 'dig2', 'dig3'], CM(34, 10, 0, '4-DIGIT', 'HDR-12P'));
  const so16 = mk('SOIC-16');
  const rtcn = ['x1', 'x2', null, null, 'gnd', 'sw1', 'sw2', null, null, null, null, null, 'seg5', 'seg6', 'v5', null];
  so16.forEach((f, i) => c.add('U1', i + 1, rtcn[i], 14 + f.dx, 22 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U1 = CM(14, 22, 0, 'DS1302', 'SOIC-16');
  const so18 = mk('SOIC-18');
  const drvn = ['seg0', 'seg1', 'seg2', 'seg3', 'seg4', null, 'gnd', 'seg7', 'seg6', 'seg5', null, null, 'v5', 'dig0', 'dig1', 'dig2', 'dig3', null];
  so18.forEach((f, i) => c.add('U2', i + 1, drvn[i], 50 + f.dx, 22 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U2 = CM(50, 22, 0, '74HC595', 'SOIC-18');
  c.place('Y1', xtal2, 6, 22, ['x1', 'x2'], CM(6, 22, 0, '32.768k', 'XTAL-3225'));
  c.place('C1', fp402, 11, 22, ['x1', 'gnd'], CM(11, 22, 0, '6p', 'C0402'));
  c.place('C2', fp402, 11, 26, ['x2', 'gnd'], CM(11, 26, 0, '6p', 'C0402'));
  c.place('C3', fp805, 22, 30, ['v5', 'gnd'], CM(22, 30, 0, '100n', 'C0805'));
  c.place('C4', fp805, 60, 30, ['v5', 'gnd'], CM(60, 30, 0, '100n', 'C0805'));
  c.place('J3', hd(2), 66, 8, ['sw1', 'sw2'], CM(66, 8, 90, 'KEY', 'HDR-2P'));
  c.save('n143-seg-clock');
}

// n144: ULN2803 继电器阵列 —— SRD 5 pin 首测 + 8 路达林顿
{
  const nets = ['v5', 'gnd', 'v12'];
  for (let k = 1; k <= 4; k++) nets.push(`co${k}`);
  for (let k = 1; k <= 4; k++) nets.push(`k${k}`);
  nets.push('in1', 'in2', 'in3', 'in4');
  const netObjs = nets.map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n144 继电器阵列', { width: 84, height: 32, nets: netObjs });
  for (let k = 0; k < 4; k++) {
    const x = 12 + k * 14;
    c.place(`K${k + 1}`, srd5, x, 10, [`co${k + 1}`, `k${k + 1}`, `co${k + 1}`, `k${k + 1}`, `k${k + 1}`].slice(0, 5), CM(x, 10, 0, 'SRD-05', 'SRD'));
  }
  const so18 = mk('SOIC-18');
  const uln = ['in1', 'in2', 'in3', 'in4', null, null, null, null, 'gnd', 'co1', 'co2', 'co3', 'co4', null, null, null, null, 'v5'];
  so18.forEach((f, i) => c.add('U1', i + 1, uln[i], 60 + f.dx, 16 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U1 = CM(60, 16, 0, 'ULN2803', 'SOIC-18');
  c.place('D1', smc2, 6, 26, ['v12', 'gnd'], CM(6, 26, 0, 'TVS', 'SMC'));
  c.place('J1', term(2), 12, 26, ['v12', 'gnd'], CM(12, 26, 0, '12V', 'TB-2P'));
  c.place('J2', term(4), 34, 26, ['k1', 'k2', 'k3', 'k4'], CM(34, 26, 0, 'LOAD', 'TB-4P'));
  c.place('J3', hd(4), 76, 26, ['in1', 'in2', 'in3', 'in4'], CM(76, 26, 90, 'MCU', 'HDR-4P'));
  c.place('C1', fp805, 60, 26, ['v5', 'gnd'], CM(60, 26, 0, '100n', 'C0805'));
  c.save('n144-relay8');
}

// n145: 三分区混合板 —— 数字/模拟/功率三分区 + 双禁布带
{
  const nets = ['v5', 'gnd', 'vp', 'sw', 'pwm', 'ain', 'aout', 'ref', 'dig0', 'dig1', 'clk', 'dat'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n145 三分区混合板', { width: 90, height: 34, nets,
    keepouts: [{ x: 30.5, y: 2, w: 1.6, h: 30 }, { x: 59.5, y: 2, w: 1.6, h: 30 }] });
  // 数字区（左）：MCU SOIC-16 + 晶振
  const so16 = mk('SOIC-16');
  const mcin = ['pwm', 'clk', 'dat', 'dig0', 'dig1', null, 'gnd', null, null, null, null, null, 'v5', 'gnd', null, 'v5'];
  so16.forEach((f, i) => c.add('U1', i + 1, mcin[i], 14 + f.dx, 17 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U1 = CM(14, 17, 0, 'MCU', 'SOIC-16');
  c.place('Y1', xtal2, 4, 8, ['clk', 'dat'], CM(4, 8, 0, '16MHz', 'XTAL'));
  c.place('C1', fp805, 22, 8, ['v5', 'gnd'], CM(22, 8, 0, '100n', 'C0805'));
  // 模拟区（中）：运放 + 基准
  const so8 = mk('SOIC-8');
  c.place('U2', so8, 40, 12, ['ain', 'ref', 'aout', 'vp', 'gnd', null, null, 'v5'], CM(40, 12, 0, 'OPA', 'SOIC-8'));
  c.place('R1', fp603, 38, 22, ['aout', 'ref'], CM(38, 22, 0, '10k', 'R0603'));
  c.place('R2', fp603, 44, 22, ['ref', 'gnd'], CM(44, 22, 0, '10k', 'R0603'));
  c.place('C2', fp805, 48, 8, ['v5', 'gnd'], CM(48, 8, 0, '100n', 'C0805'));
  c.place('J1', hd(6), 34, 30, ['ain', 'gnd', 'aout', 'pwm', 'dig0', 'dig1'], CM(34, 30, 0, 'IO', 'HDR-6P'));
  // 功率区（右）：MOS + 续流
  c.place('Q1', to220, 72, 12, ['sw', 'vp', 'gnd'], CM(73.54, 12, 0, 'MOS-N', 'TO-220'));
  c.place('D1', smc2, 66, 22, ['gnd', 'vp'], CM(66, 22, 0, 'SS54', 'SMC'));
  c.place('L1', [{ dx: -2.5, dy: 0, w: 2.4, h: 2.4, shape: 'circle', layer: 'both', holeR: 0.7 }, { dx: 2.5, dy: 0, w: 2.4, h: 2.4, shape: 'circle', layer: 'both', holeR: 0.7 }], 76, 24, ['sw', 'vp'], CM(76, 24, 0, '22uH', 'IND'));
  c.place('C3', [{ dx: -2.5, dy: 0, w: 2.8, h: 2.8, shape: 'circle', layer: 'both', holeR: 1.0 }, { dx: 2.5, dy: 0, w: 2.8, h: 2.8, shape: 'circle', layer: 'both', holeR: 1.0 }], 84, 24, ['vp', 'gnd'], CM(84, 24, 0, '470u', 'CAP-THT'));
  c.place('J2', term(2), 86, 8, ['vp', 'gnd'], CM(86, 8, 90, 'PWR', 'TB-2P'));
  c.save('n145-three-zone');
}

// n146: 宽走线大电流汇流 —— w 1.2 汇流 + 5mm 端子（宽线节距维度）
{
  const nets = ['bus_p', 'gnd'];
  for (let k = 1; k <= 6; k++) nets.push(`br${k}`);
  const netObjs = nets.map(id => ({ id, name: id.toUpperCase(), ...(id === 'bus_p' ? { w: 1.2 } : {}) }));
  const c = makeDesign('n146 大电流汇流', { width: 74, height: 34, grid: 1.4, trackW: 0.8, clearance: 0.3, nets: netObjs });
  c.place('J1', term(2), 6, 17, ['bus_p', 'gnd'], CM(6, 17, 90, 'IN', 'TB-2P'));
  for (let k = 0; k < 6; k++) {
    const y = 5 + k * 4.8;
    c.place(`F${k + 1}`, smc2, 34, y, ['bus_p', `br${k + 1}`], CM(34, y, 0, 'FUSE', 'SMC'));
    c.place(`J${k + 2}`, term(2), 52, y, [`br${k + 1}`, 'gnd'], CM(52, y, 0, 'BR' + (k + 1), 'TB-2P'));
  }
  c.place('J8', term(2), 68, 17, ['bus_p', 'gnd'], CM(68, 17, 90, 'AUX', 'TB-2P'));
  c.save('n146-bus-bar');
}

// n147: 工艺边+基准点+双单元拼板 —— null-net pads 首测
{
  const nets = ['v33', 'gnd', 'sda', 'scl', 'led1', 'led2'];
  const netObjs = nets.map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n147 拼板双单元', { width: 76, height: 40, nets: netObjs });
  // 单元 A（左）：I2C 传感器
  const so8 = mk('SOIC-8');
  c.place('U1', so8, 18, 18, ['sda', 'scl', null, 'gnd', null, null, null, 'v33'], CM(18, 18, 0, 'LM75', 'SOIC-8'));
  c.place('R1', fp603, 10, 10, ['v33', 'sda'], CM(10, 10, 0, '4k7', 'R0603'));
  c.place('R2', fp603, 14, 10, ['v33', 'scl'], CM(14, 10, 0, '4k7', 'R0603'));
  c.place('J1', hd(4), 5, 28, ['v33', 'gnd', 'sda', 'scl'], CM(5, 28, 90, 'BUS', 'HDR-4P'));
  // 单元 B（右）：LED 指示
  for (let k = 0; k < 2; k++) {
    c.place(`LED${k + 1}`, thLED, 48 + k * 10, 18, [`led${k + 1}`, 'gnd'], CM(48 + k * 10, 18, 0, 'LED', 'LED-THT'));
    c.place(`R${k + 3}`, fp603, 52 + k * 10, 28, ['v33', `led${k + 1}`], CM(52 + k * 10, 28, 0, '470R', 'R0603'));
  }
  c.place('J2', hd(4), 68, 18, ['v33', 'gnd', 'led1', 'led2'], CM(68, 18, 90, 'MCU', 'HDR-4P'));
  // 工艺边：3 工装孔（null-net 镀孔近似 NPTH）+ 2 基准点（null-net 光点）
  c.place('TH1', [{ dx: 0, dy: 0, w: 3.6, h: 3.6, shape: 'circle', layer: 'both', holeR: 1.6 }], 38, 4, [null], CM(38, 4, 0, 'TOOL-3.2', 'TOOL'));
  c.place('TH2', [{ dx: 0, dy: 0, w: 3.6, h: 3.6, shape: 'circle', layer: 'both', holeR: 1.6 }], 38, 36, [null], CM(38, 36, 0, 'TOOL-3.2', 'TOOL'));
  c.place('FD1', [{ dx: 0, dy: 0, w: 1.0, h: 1.0, shape: 'circle', layer: 'top' }], 38, 20, [null], CM(38, 20, 0, 'FID', 'FID'));
  c.save('n147-panel');
}

// ============ 超难档 ============

// n148: LQFP64 双电源域 —— 双 LDO 分域 + 域间隔离
{
  const nets = ['v5', 'gnd', 'x1', 'x2', 'swclk', 'swdio'];
  for (let k = 0; k < 12; k++) nets.push(`pa${k}`);
  for (let k = 0; k < 12; k++) nets.push(`pb${k}`);
  for (let k = 0; k < 8; k++) nets.push(`pc${k}`);
  nets.push('v33a', 'v33b', 'fb_a', 'fb_b');
  const netObjs = nets.map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n148 LQFP64 双电源域', { width: 74, height: 52, grid: 0.25, trackW: 0.15, clearance: 0.1, viaOuter: 0.5, viaDrill: 0.25, nets: netObjs });
  const rp = [];
  for (let k = 0; k < 64; k++) {
    const m = { 5: 'x1', 6: 'x2', 25: 'swdio', 26: 'swclk', 32: 'v33a', 33: 'gnd', 48: 'v33b', 49: 'gnd' };
    if (m[k + 1]) rp.push(m[k + 1]);
    else if (k % 8 === 0) rp.push('gnd');
    else if (k % 8 === 4) rp.push(k < 32 ? 'v33a' : 'v33b');
    else if (k % 8 === 1) rp.push(`pa${Math.floor(k / 8) % 12}`);
    else if (k % 8 === 2) rp.push(`pb${Math.floor(k / 8) % 12}`);
    else if (k % 8 === 3) rp.push(`pc${Math.floor(k / 8) % 8}`);
    else rp.push(null);
  }
  const seen = new Set(rp.filter(n => n && (n.startsWith('pa') || n.startsWith('pb') || n.startsWith('pc'))));
  for (let k = 0; k < 12; k++) if (!seen.has(`pa${k}`)) { const i = rp.indexOf(null); if (i >= 0) rp[i] = `pa${k}`; }
  for (let k = 0; k < 12; k++) if (!seen.has(`pb${k}`)) { const i = rp.indexOf(null); if (i >= 0) rp[i] = `pb${k}`; }
  for (let k = 0; k < 8; k++) if (!seen.has(`pc${k}`)) { const i = rp.indexOf(null); if (i >= 0) rp[i] = `pc${k}`; }
  qfp64.forEach((f, i) => c.add('U1', i + 1, rp[i] || null, 37 + f.dx, 26 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U1 = CM(37, 26, 0, 'STM32F103', 'LQFP-64');
  // 域 A LDO（左）与域 B LDO（右）
  const s223 = mk('SOT-223');
  c.place('U2', s223, 10, 12, ['v5', 'gnd', 'gnd', 'v33a'], CM(10, 12, 0, 'AMS1117-3.3A', 'SOT-223'));
  c.place('U3', s223, 64, 12, ['v5', 'gnd', 'gnd', 'v33b'], CM(64, 12, 0, 'AMS1117-3.3B', 'SOT-223'));
  c.place('R1', fp402, 10, 22, ['v33a', 'fb_a'], CM(10, 22, 0, '100k', 'R0402'));
  c.place('R2', fp402, 14, 22, ['fb_a', 'gnd'], CM(14, 22, 0, '100k', 'R0402'));
  c.place('R3', fp402, 60, 22, ['v33b', 'fb_b'], CM(60, 22, 0, '100k', 'R0402'));
  c.place('R4', fp402, 64, 22, ['fb_b', 'gnd'], CM(64, 22, 0, '100k', 'R0402'));
  c.place('Y1', xtal2, 20, 8, ['x1', 'x2'], CM(20, 8, 0, '8MHz', 'XTAL'));
  c.place('C1', fp402, 25, 8, ['x1', 'gnd'], CM(25, 8, 0, '20p', 'C0402'));
  c.place('C2', fp402, 25, 12, ['x2', 'gnd'], CM(25, 12, 0, '20p', 'C0402'));
  c.place('J1', hd(4), 5, 34, ['v5', 'gnd', 'swclk', 'swdio'], CM(5, 34, 90, 'SWD', 'HDR-4P'));
  c.place('J2', hd(12), 26, 46, Array.from({ length: 12 }, (_, k) => `pa${k}`), CM(26, 46, 0, 'IOA', 'HDR-12P'));
  c.place('J3', hd(12), 48, 46, Array.from({ length: 12 }, (_, k) => `pb${k}`), CM(48, 46, 0, 'IOB', 'HDR-12P'));
  c.place('J4', hd(8), 69, 34, Array.from({ length: 8 }, (_, k) => `pc${k}`), CM(69, 34, 90, 'IOC', 'HDR-8P'));
  for (let k = 0; k < 6; k++) c.place(`C${k + 3}`, fp402, 20 + (k % 3) * 4, k < 3 ? 20 : 24, ['v33a', 'gnd'], CM(20 + (k % 3) * 4, k < 3 ? 20 : 24, 0, '100n', 'C0402'));
  for (let k = 0; k < 6; k++) c.place(`C${k + 9}`, fp402, 50 + (k % 3) * 4, k < 3 ? 20 : 24, ['v33b', 'gnd'], CM(50 + (k % 3) * 4, k < 3 ? 20 : 24, 0, '100n', 'C0402'));
  c.save('n148-dual-domain');
}

// n149: 双 5×7 点阵扫描 —— 行列多路复用（大网数扇出）
{
  const nets = ['v5', 'gnd'];
  for (let k = 0; k < 5; k++) nets.push(`r${k}`);
  for (let k = 0; k < 5; k++) nets.push(`ca${k}`);
  for (let k = 0; k < 5; k++) nets.push(`cb${k}`);
  const netObjs = nets.map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n149 双点阵扫描', { width: 76, height: 30, nets: netObjs });
  const dot10 = hd(10);
  const d1n = ['r0', 'r1', 'r2', 'r3', 'r4', 'ca0', 'ca1', 'ca2', 'ca3', 'ca4'];
  dot10.forEach((f, i) => c.add('M1', i + 1, d1n[i], 14 + f.dx, 10 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.M1 = CM(14, 10, 0, '5x7-A', 'DOT-5x7');
  const d2n = ['r0', 'r1', 'r2', 'r3', 'r4', 'cb0', 'cb1', 'cb2', 'cb3', 'cb4'];
  dot10.forEach((f, i) => c.add('M2', i + 1, d2n[i], 14 + f.dx, 22 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.M2 = CM(14, 22, 0, '5x7-B', 'DOT-5x7');
  const so16 = mk('SOIC-16');
  const rn = ['r0', 'r1', 'r2', 'r3', 'r4', null, null, null, null, null, null, null, 'gnd', 'v5', null, null];
  so16.forEach((f, i) => c.add('U1', i + 1, rn[i], 40 + f.dx, 8 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U1 = CM(40, 8, 0, 'ROW-DRV', 'SOIC-16');
  const cn = ['ca0', 'ca1', 'ca2', 'ca3', 'ca4', 'cb0', 'cb1', 'cb2', 'cb3', 'cb4', null, null, 'gnd', 'v5', null, null];
  so16.forEach((f, i) => c.add('U2', i + 1, cn[i], 40 + f.dx, 22 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U2 = CM(40, 22, 0, 'COL-MUX', 'SOIC-16');
  c.place('J1', hd(16), 66, 15, ['v5', 'gnd', 'r0', 'r1', 'r2', 'r3', 'r4', 'ca0', 'ca1', 'ca2', 'ca3', 'ca4', 'cb0', 'cb1', 'cb2', 'cb3'], CM(66, 15, 90, 'MCU', 'HDR-16P'));
  c.place('C1', fp805, 30, 15, ['v5', 'gnd'], CM(30, 15, 0, '100n', 'C0805'));
  c.save('n149-dot-matrix');
}

// n150: 4 层高速混合 —— layers:4 + LQFP48 + 双差分对
{
  const nets = ['v33', 'gnd', 'x1', 'x2', 'swdio', 'swclk'];
  const pairs = [['txp', 'txn'], ['rxp', 'rxn']];
  for (const [p, n] of pairs) { nets.push(p); nets.push(n); }
  for (let k = 0; k < 10; k++) nets.push(`io${k}`);
  const netObjs = nets.map(id => ({ id, name: id.toUpperCase(), ...(id.endsWith('p') || id.endsWith('n') ? { pair: id.slice(0, -1) } : {}) }));
  const c = makeDesign('n150 四层高速混合', { width: 66, height: 50, grid: 0.25, trackW: 0.15, clearance: 0.1, viaOuter: 0.5, viaDrill: 0.25, layers: 4, nets: netObjs });
  const rp = ['x1', 'x2', 'swdio', 'swclk', 'gnd', 'v33', 'txp', 'txn', 'rxp', 'rxn',
    'io0', 'io1', 'io2', 'io3', 'gnd', 'v33', 'io4', 'io5', 'gnd', 'v33',
    'io6', 'io7', 'io8', 'io9', 'gnd', 'v33', 'gnd', 'v33', 'gnd', 'v33',
    'gnd', 'v33', 'gnd', 'v33', 'gnd', 'v33', 'gnd', 'v33', 'gnd', 'v33',
    'gnd', 'v33', 'gnd', 'v33', 'gnd', 'v33', 'gnd', 'v33'];
  qfp48.forEach((f, i) => c.add('U1', i + 1, rp[i] || null, 33 + f.dx, 25 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U1 = CM(33, 25, 0, 'STM32F103', 'LQFP-48');
  c.place('Y1', xtal2, 16, 10, ['x1', 'x2'], CM(16, 10, 0, '25MHz', 'XTAL'));
  c.place('C1', fp402, 21, 10, ['x1', 'gnd'], CM(21, 10, 0, '18p', 'C0402'));
  c.place('C2', fp402, 21, 14, ['x2', 'gnd'], CM(21, 14, 0, '18p', 'C0402'));
  c.place('R1', fp402, 27, 10, ['txp', 'txp'], CM(27, 10, 0, '33R', 'R0402'));
  c.place('R2', fp402, 31, 10, ['txn', 'txn'], CM(31, 10, 0, '33R', 'R0402'));
  c.place('J1', hd(4), 5, 25, ['v33', 'gnd', 'swclk', 'swdio'], CM(5, 25, 90, 'SWD', 'HDR-4P'));
  c.place('J2', hd(10), 60, 25, ['io0', 'io1', 'io2', 'io3', 'io4', 'io5', 'io6', 'io7', 'io8', 'io9'], CM(60, 25, 90, 'IO', 'HDR-10P'));
  c.place('J3', hd(4), 33, 44, ['txp', 'txn', 'rxp', 'rxn'], CM(33, 44, 0, 'DIFF', 'HDR-4P'));
  for (let k = 0; k < 6; k++) c.place(`C${k + 3}`, fp402, 44 + (k % 3) * 4, k < 3 ? 8 : 13, ['v33', 'gnd'], CM(44 + (k % 3) * 4, k < 3 ? 8 : 13, 0, '100n', 'C0402'));
  c.save('n150-4layer-hs');
}

// n151: SOT-23-6 密排传感阵列 —— 0.25 grid 小板密排
{
  const nets = ['v33', 'gnd', 'sda', 'scl'];
  for (let k = 1; k <= 6; k++) nets.push(`al${k}`);
  for (let k = 1; k <= 6; k++) nets.push(`ah${k}`);
  const netObjs = nets.map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n151 密排传感阵列', { width: 34, height: 24, grid: 0.25, trackW: 0.15, clearance: 0.1, viaOuter: 0.5, viaDrill: 0.25, nets: netObjs });
  for (let k = 0; k < 6; k++) {
    const x = 6 + (k % 3) * 9, y = 7 + Math.floor(k / 3) * 10;
    c.place(`U${k + 1}`, sot236, x, y, [`al${k + 1}`, 'gnd', 'sda', 'scl', `ah${k + 1}`, 'v33'], CM(x, y, 0, 'SENS', 'SOT-23-6'));
    c.place(`C${k + 1}`, fp402, x + 3, y + 4, ['v33', 'gnd'], CM(x + 3, y + 4, 0, '100n', 'C0402'));
  }
  c.place('J1', hd(4), 3, 12, ['v33', 'gnd', 'sda', 'scl'], CM(3, 12, 90, 'I2C', 'HDR-4P'));
  c.place('J2', hd(12), 17, 22, Array.from({ length: 6 }, (_, k) => `al${k + 1}`).concat(Array.from({ length: 6 }, (_, k) => `ah${k + 1}`)), CM(17, 22, 0, 'OUT', 'HDR-12P'));
  c.save('n151-sensor-array');
}

// n152: DIP 密度极限插装 —— DIP-14 ×6 阵列
{
  const nets = ['v5', 'gnd'];
  for (let k = 0; k < 8; k++) nets.push(`d${k}`);
  for (let k = 0; k < 8; k++) nets.push(`q${k}`);
  const netObjs = nets.map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('n152 DIP 密插装', { width: 84, height: 42, nets: netObjs });
  const dip14 = mk('DIP-N', 14);
  const rowNets = [
    ['d0', 'd1', 'd2', 'd3', 'q0', 'q1', 'q2', 'q3'],
    ['d4', 'd5', 'd6', 'd7', 'q4', 'q5', 'q6', 'q7'],
    ['d0', 'd1', 'd2', 'd3', 'q0', 'q1', 'q2', 'q3'],
    ['d4', 'd5', 'd6', 'd7', 'q4', 'q5', 'q6', 'q7']];
  for (let k = 0; k < 4; k++) {
    const y = 10 + k * 8;
    const nets14 = rowNets[k].concat(['gnd', 'v5', 'd0', 'd1', 'd2', 'd3']);
    dip14.forEach((f, i) => c.add(`U${k + 1}`, i + 1, nets14[i] || null, 16 + f.dx, y + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
    c.compsMeta[`U${k + 1}`] = CM(16, y, 0, '74HC00', 'DIP-14');
  }
  c.place('J1', hd(10), 40, 5, ['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'v5', 'gnd'], CM(40, 5, 0, 'IN', 'HDR-10P'));
  c.place('J2', hd(10), 40, 37, ['q0', 'q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'v5', 'gnd'], CM(40, 37, 0, 'OUT', 'HDR-10P'));
  for (let k = 0; k < 4; k++) c.place(`C${k + 1}`, fp805, 68 + (k % 2) * 6, k < 2 ? 12 : 20, ['v5', 'gnd'], CM(68 + (k % 2) * 6, k < 2 ? 12 : 20, 0, '100n', 'C0805'));
  c.save('n152-dip-dense');
}

// ============ 自检门（spec 门同款 + 半孔豁免 + 环宽）============
let fail = 0;
const dirs = ['n133-bnc', 'n134-rca', 'n135-dc005', 'n136-ldr', 'n137-buzzer',
  'n138-xlr', 'n139-battery-spring', 'n140-to247', 'n141-kbp', 'n142-rot16',
  'n143-seg-clock', 'n144-relay8', 'n145-three-zone', 'n146-bus-bar', 'n147-panel',
  'n148-dual-domain', 'n149-dot-matrix', 'n150-4layer-hs', 'n151-sensor-array', 'n152-dip-dense'];
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
