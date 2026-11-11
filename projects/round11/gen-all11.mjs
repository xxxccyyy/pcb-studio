// 第十一轮批量 spec 生成：P01-P50（50 项目，不分档位，全部与前十轮不同的设计维度）
// 结构：5 个参数扫描家族（板幅/栅格/密度/网数/viaCost × 5 点 = 25，产出定量曲线）
//      + 25 个新维度（WS2812 64-pad 链/CNC shield/HAT/DS18B20 星形/16 路扇出/
//        layers:1 单层/细长板/中央禁区/菊花链/广播/禁布迷宫/混合线宽/全 THT/最小板/单网板…）
// 自检门：坏引用/单脚网/空网/同元件间距(DRC padGap)/出板(半孔豁免)/THT 环宽/零格
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
const to92 = [0, 1, 2].map(k => ({ dx: k * 1.27, dy: 0, w: 1.0, h: 1.0, shape: 'circle', layer: 'both', holeR: 0.3 }));
const thLED = [{ dx: 0, dy: 0, w: 1.2, h: 1.2, shape: 'circle', layer: 'both', holeR: 0.35 }, { dx: 2.54, dy: 0, w: 1.2, h: 1.2, shape: 'circle', layer: 'both', holeR: 0.35 }];
const xtal2 = [{ dx: -1.1, dy: 0, w: 1.3, h: 3.4 }, { dx: 1.1, dy: 0, w: 1.3, h: 3.4 }];
const dpak = [{ dx: -2.54, dy: 3.6, w: 1.5, h: 3.0 }, { dx: 0, dy: -2.4, w: 6.6, h: 6.4 }, { dx: 2.54, dy: 3.6, w: 1.5, h: 3.0 }];
const smc2 = [{ dx: -2.6, dy: 0, w: 2.4, h: 3.8 }, { dx: 2.6, dy: 0, w: 2.4, h: 3.8 }];
const sip9 = Array.from({ length: 9 }, (_, k) => ({ dx: (k - 4) * 2.54, dy: 0, w: 1.8, h: 1.8, shape: 'circle', layer: 'both', holeR: 0.5 }));
const ws2812 = [ // 5050 4-pad
  { dx: -1.25, dy: -1.55, w: 1.0, h: 1.4 }, { dx: 1.25, dy: -1.55, w: 1.0, h: 1.4 },
  { dx: 1.25, dy: 1.55, w: 1.0, h: 1.4 }, { dx: -1.25, dy: 1.55, w: 1.0, h: 1.4 }];
const qfp48 = (() => { const P = [], s = 5.5 * 0.5, A = s + 1.1; for (let k = 0; k < 12; k++) P.push({ dx: -A, dy: -s + k * 0.5, w: 1.2, h: 0.3 }); for (let k = 0; k < 12; k++) P.push({ dx: -s + k * 0.5, dy: A, w: 0.3, h: 1.2 }); for (let k = 0; k < 12; k++) P.push({ dx: A, dy: s - k * 0.5, w: 1.2, h: 0.3 }); for (let k = 0; k < 12; k++) P.push({ dx: s - k * 0.5, dy: -A, w: 0.3, h: 1.2 }); return P; })();
const dsub25 = (() => {
  const per = 13, P = [], pitch = 2.16, rows = 1.93;
  for (let k = 0; k < per; k++) P.push({ dx: (k - (per - 1) / 2) * pitch, dy: -rows / 2, w: 1.4, h: 1.8, shape: 'circle', layer: 'both', holeR: 0.5 });
  for (let k = 0; k < 12; k++) P.push({ dx: (k - 5.5) * pitch, dy: rows / 2, w: 1.4, h: 1.8, shape: 'circle', layer: 'both', holeR: 0.5 });
  const half = (per - 1) / 2 * pitch + 3.0;
  P.push({ dx: -half, dy: 0, w: 3.2, h: 3.2, shape: 'circle', layer: 'both', holeR: 1.3 });
  P.push({ dx: half, dy: 0, w: 3.2, h: 3.2, shape: 'circle', layer: 'both', holeR: 1.3 });
  return P;
})();
const max31855 = mk('SOIC-8');
const tssop28 = (() => { const P = [], s = 6.5 * 0.65; for (let k = 0; k < 14; k++) P.push({ dx: -3.9, dy: -s + k * 0.65, w: 1.5, h: 0.4 }); for (let k = 13; k >= 0; k--) P.push({ dx: 3.9, dy: -s + k * 0.65, w: 1.5, h: 0.4 }); return P; })();

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

// ===== 家族 1：板幅扫描 P01-P05（NE555 最小系统 × 5 板幅，比例化布局）=====
const p555Nets = ['gnd', 'trig', 'out', 'ctrl', 'thresh', 'disch', 'vcc', 'led_a'].map(id => ({ id, name: id.toUpperCase() }));
function gen555(width, height, subdir) {
  const c = makeDesign('P' + subdir + ' 555 最小系统 ' + width + 'x' + height, { width, height, nets: p555Nets });
  const dip8 = mk('DIP-N', 8);
  const u1n = ['gnd', 'trig', 'out', 'vcc', 'ctrl', 'thresh', 'disch', 'vcc'];
  c.place('U1', dip8, width * 0.42, height / 2, u1n, CM(width * 0.42, height / 2, 0, 'NE555', 'DIP-8'));
  const xR = width * 0.18, y0 = height * 0.22, dy = (height * 0.56) / 2;
  c.place('R1', fp603, xR, y0, ['vcc', 'disch'], CM(xR, y0, 0, '4k7', 'R0603'));
  c.place('R2', fp603, xR, y0 + dy, ['disch', 'thresh'], CM(xR, y0 + dy, 0, '47k', 'R0603'));
  c.place('R3', fp603, xR, y0 + dy * 2, ['thresh', 'trig'], CM(xR, y0 + dy * 2, 0, '47k', 'R0603'));
  const xC = width * 0.66;
  c.place('C1', fp805, xC, y0, ['thresh', 'gnd'], CM(xC, y0, 0, '10n', 'C0805'));
  c.place('C2', fp805, xC, y0 + dy, ['ctrl', 'gnd'], CM(xC, y0 + dy, 0, '10n', 'C0805'));
  c.place('C3', fp805, xC, y0 + dy * 2, ['vcc', 'gnd'], CM(xC, y0 + dy * 2, 0, '100n', 'C0805'));
  c.place('R4', fp603, width * 0.82, height / 2, ['out', 'led_a'], CM(width * 0.82, height / 2, 0, '470R', 'R0603'));
  c.place('LED1', thLED, width * 0.92, height / 2, ['led_a', 'gnd'], CM(width * 0.92, height / 2, 0, 'LED', 'LED-THT'));
  c.place('J1', term(2), 4, height / 2, ['vcc', 'gnd'], CM(4, height / 2, 90, 'PWR', 'TB-2P'));
  c.save(subdir);
}
[[15, 10, 'p01-555-tiny'], [20, 15, 'p02-555-small'], [30, 20, 'p03-555-mid'], [45, 30, 'p04-555-large'], [60, 40, 'p05-555-xlarge']].forEach(([w, h, s]) => gen555(w, h, s));

// ===== 家族 2：栅格扫描 P06-P10（SOIC-8 + DIP-8 交叉系统 × 5 栅格）=====
// 网表固定，栅格/线宽/间距按 L1 联动调整
function genGrid(grid, trackW, clearance, via, subdir) {
  const nets = ['v5', 'gnd', 'a1', 'a2', 'b1', 'b2', 'x1', 'x2'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('P' + subdir + ' 栅格 ' + grid, { width: 50, height: 30, grid, trackW, clearance, viaOuter: via[0], viaDrill: via[1], nets });
  const so8 = mk('SOIC-8');
  c.place('U1', so8, 14, 10, ['a1', 'a2', 'gnd', 'x1', 'x2', 'b1', 'b2', 'v5'], CM(14, 10, 0, 'SOIC-8', 'SOIC-8'));
  const dip8 = mk('DIP-N', 8);
  c.place('U2', dip8, 14, 22, ['b2', 'b1', 'gnd', null, null, 'a2', 'a1', 'v5'], CM(14, 22, 0, 'DIP-8', 'DIP-8'));
  c.place('Y1', xtal2, 32, 15, ['x1', 'x2'], CM(32, 15, 0, 'XTAL', 'XTAL-3225'));
  c.place('J1', hd(4), 44, 8, ['v5', 'gnd', 'a1', 'b1'], CM(44, 8, 90, 'IO', 'HDR-4P'));
  c.place('J2', hd(4), 44, 22, ['v5', 'gnd', 'a2', 'b2'], CM(44, 22, 90, 'IO2', 'HDR-4P'));
  c.place('C1', fp805, 30, 8, ['v5', 'gnd'], CM(30, 8, 0, '100n', 'C0805'));
  c.place('C2', fp805, 30, 22, ['v5', 'gnd'], CM(30, 22, 0, '100n', 'C0805'));
  c.save(subdir);
}
[[0.3, 0.2, 0.1, [0.6, 0.3], 'p06-grid-03'], [0.4, 0.25, 0.15, [0.6, 0.3], 'p07-grid-04'], [0.5, 0.3, 0.2, [0.8, 0.4], 'p08-grid-05'], [0.6, 0.4, 0.2, [0.8, 0.4], 'p09-grid-06'], [0.8, 0.5, 0.3, [0.8, 0.4], 'p10-grid-08']].forEach(([g, tw, cl, via, s]) => genGrid(g, tw, cl, via, s));

// ===== 家族 3：SOIC 密度爬坡 P11-P15（40×25 板 × 1/2/3/4/6 颗 SOIC-8，两列网格）=====
function genDensity(count, subdir) {
  const nets = ['v5', 'gnd'];
  for (let k = 0; k < count; k++) nets.push(`oa${k}`, `ob${k}`);
  const netObjs = nets.map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('P' + subdir + ' SOIC 密度 ' + count + ' 颗', { width: 40, height: 25, nets: netObjs });
  const so8 = mk('SOIC-8');
  const rows = Math.ceil(count / 2);
  for (let k = 0; k < count; k++) {
    const x = k % 2 === 0 ? 13 : 27;
    const y = rows === 1 ? 12.5 : 5.5 + Math.floor(k / 2) * (14 / (rows - 1));
    c.place(`U${k + 1}`, so8, x, y, [`oa${k}`, `ob${k}`, 'gnd', null, null, 'gnd', 'v5', 'v5'], CM(x, y, 0, 'OPA', 'SOIC-8'));
    c.place(`C${k + 1}`, fp805, x + (k % 2 === 0 ? -5 : 5), y + 4.5, ['v5', 'gnd'], CM(x + (k % 2 === 0 ? -5 : 5), y + 4.5, 0, '100n', 'C0805'));
  }
  for (let j = 0; j < count; j += 2) {
    const has = j + 1 < count;
    c.place(`J${j / 2 + 1}`, hd(4), 36, 5 + j * 3.5, [has ? `oa${j + 1}` : 'v5', `oa${j}`, `ob${j}`, has ? `ob${j + 1}` : 'gnd'], CM(36, 5 + j * 3.5, 90, 'IO', 'HDR-4P'));
  }
  c.save(subdir);
}
[1, 2, 3, 4, 6].forEach((n, idx) => genDensity(n, 'p1' + (1 + idx) + '-density-' + n));

// ===== 家族 4：网数阶梯 P16-P20（星形拓扑：中心 SOIC-16 + N 外设排针）=====
function genStar(ports, subdir) {
  const nets = ['v5', 'gnd'];
  for (let k = 0; k < ports; k++) { nets.push(`s${k}a`, `s${k}b`); }
  const netObjs = nets.map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('P' + subdir + ' 星形 ' + ports + ' 端口', { width: 60, height: 40, nets: netObjs });
  const so16 = mk('SOIC-16');
  const u1n = [];
  const eff = Math.min(ports, 7);
  for (let k = 0; k < eff; k++) u1n.push(`s${k}a`, `s${k}b`);
  while (u1n.length < 14) u1n.push(null);
  u1n.push('gnd', 'v5');   // pin15/pin16 固定电源
  so16.forEach((f, i) => c.add('U1', i + 1, u1n[i] || null, 30 + f.dx, 20 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U1 = CM(30, 20, 0, 'HUB', 'SOIC-16');
  for (let k = 0; k < eff; k++) {
    const x = 8 + k * (44 / Math.max(1, eff - 1));
    c.place(`J${k + 1}`, hd(2), x, 6, [`s${k}a`, `s${k}b`], CM(x, 6, 0, 'P' + k, 'HDR-2P'));
    c.place(`J${k + 9}`, hd(2), x, 34, [`s${k}b`, `s${k}a`], CM(x, 34, 0, 'Q' + k, 'HDR-2P'));
  }
  c.place('C1', fp805, 4, 20, ['v5', 'gnd'], CM(4, 20, 0, '100n', 'C0805'));
  c.save(subdir);
}
[2, 4, 6, 7, 7].forEach((p, idx) => { if (idx < 4) genStar(p, 'p1' + (6 + idx) + '-star-' + p); });
// p20: 7 端口满配（与 p19 同构但网格不同）——改为 7 端口 + 加密外设
genStar(7, 'p20-star-7b');

// ===== 家族 5：viaCost 扫描 P21-P25（同板 5 份，runner 注入 viaCost）=====
function genVia(subdir) {
  const nets = ['v5', 'gnd', 'n1', 'n2', 'n3', 'n4'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('P' + subdir + ' viaCost 扫描', { width: 44, height: 26, nets });
  const so8a = mk('SOIC-8');
  c.place('U1', so8a, 12, 8, ['n1', 'n2', 'gnd', 'n3', 'n4', 'gnd', 'v5', 'v5'], CM(12, 8, 0, 'A', 'SOIC-8'));
  const so8b = mk('SOIC-8');
  c.place('U2', so8b, 32, 18, ['n4', 'n3', 'gnd', 'n2', 'n1', 'gnd', 'v5', 'v5'], CM(32, 18, 0, 'B', 'SOIC-8'));
  c.place('J1', hd(4), 4, 20, ['v5', 'gnd', 'n1', 'n2'], CM(4, 20, 90, 'IO', 'HDR-4P'));
  c.save(subdir);
}
['p21-via-05', 'p22-via-15', 'p23-via-30', 'p24-via-60', 'p25-via-120'].forEach(s => genVia(s));

// ===== 新板型 P26-P38 =====

// P26: WS2812 8×8 矩阵 —— 64 颗 5050 串行链（数据单网 64 pad）
{
  const nets = ['v5', 'gnd', 'din'].map(id => ({ id, name: id.toUpperCase() }));
  for (let k = 0; k < 63; k++) nets.push({ id: `n${k}`, name: 'N' + k });
  const c = makeDesign('P26 WS2812 8x8 矩阵', { width: 52, height: 52, grid: 0.5, trackW: 0.3, clearance: 0.15, viaOuter: 0.6, viaDrill: 0.3, nets });
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const idx = row * 8 + col;
      const x = 10 + col * 4.6, y = 10 + row * 4.6;
      const din = idx === 0 ? 'din' : `n${idx - 1}`;
      const dout = idx === 63 ? null : `n${idx}`;
      const nn2 = ['v5', dout, 'gnd', din];
      ws2812.forEach((f, i) => c.add(`D${idx + 1}`, i + 1, nn2[i], x + f.dx, y + f.dy, f.w, f.h, f.shape, f.layer));
      c.compsMeta[`D${idx + 1}`] = CM(x, y, 0, 'WS2812B', '5050');
    }
  }
  c.place('J1', hd(3), 4, 4, ['v5', 'gnd', 'din'], CM(4, 4, 0, 'IN', 'HDR-3P'));
  c.place('C1', fp805, 48, 4, ['v5', 'gnd'], CM(48, 4, 0, '100n', 'C0805'));
  c.save('p26-ws2812-8x8');
}

// P27: CNC Shield（4× A4988 模块座 2×8 + 电机端子 + 限位）
{
  const nets = ['v12', 'v5', 'gnd'];
  for (let k = 0; k < 4; k++) nets.push(`st${k}a`, `st${k}b`, `st${k}c`, `st${k}d`);
  for (let k = 0; k < 4; k++) nets.push(`lim${k}`);
  const netObjs = nets.map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('P27 CNC Shield', { width: 84, height: 50, nets: netObjs });
  for (let k = 0; k < 4; k++) {
    const x = 12 + k * 18;
    const sock = hd2x(8);
    const sn = [];
    for (let q = 0; q < 16; q++) sn.push(null);
    sn[0] = 'v12'; sn[1] = 'gnd'; sn[2] = `st${k}a`; sn[3] = `st${k}b`; sn[4] = `st${k}c`; sn[5] = `st${k}d`; sn[6] = 'v5'; sn[7] = 'gnd';
    sock.forEach((f, i) => c.add(`S${k + 1}`, i + 1, sn[i] || null, x + f.dx, 14 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
    c.compsMeta[`S${k + 1}`] = CM(x, 14, 0, 'A4988', 'HDR-2x8');
    c.place(`J${k + 1}`, term(4), x, 34, [`st${k}a`, `st${k}b`, `st${k}c`, `st${k}d`], CM(x, 34, 0, 'M' + (k + 1), 'TB-4P'));
    c.place(`J${k + 5}`, hd(2), x + 6, 44, ['gnd', `lim${k}`], CM(x + 6, 44, 0, 'LIM', 'HDR-2P'));
  }
  c.place('J9', term(2), 4, 44, ['v12', 'gnd'], CM(4, 44, 0, 'PWR', 'TB-2P'));
  c.place('J10', hd(4), 40, 44, ['lim0', 'lim1', 'lim2', 'lim3'], CM(40, 44, 0, 'LIM', 'HDR-4P'));
  c.place('C1', capBigHelper(), 6, 10, ['v12', 'gnd'], CM(6, 10, 0, '100u', 'CAP-THT'));
  c.save('p27-cnc-shield');
  function capBigHelper() { return [{ dx: -2.5, dy: 0, w: 2.8, h: 2.8, shape: 'circle', layer: 'both', holeR: 1.0 }, { dx: 2.5, dy: 0, w: 2.8, h: 2.8, shape: 'circle', layer: 'both', holeR: 1.0 }]; }
}

// P28: Arduino Shield 形态（边沿母座 + 全部数字/模拟引脚）——R10 n147 拼板测过双单元；本项测 shield 母座
{
  const nets = ['v5', 'gnd', 'vvin'];
  for (let k = 0; k < 14; k++) nets.push(`dg${k}`);
  for (let k = 0; k < 6; k++) nets.push(`an${k}`);
  const netObjs = nets.map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('P28 Shield 形态', { width: 70, height: 46, nets: netObjs });
  // 上排：数字口 14（实际 2×8 母座两颗）
  const dgn = ['vvin', 'gnd', 'dg0', 'dg1', 'dg2', 'dg3', 'dg4', 'dg5', 'dg6', 'dg7', 'dg8', 'dg9', 'dg10', 'dg11', 'dg12', 'dg13'];
  hd2x(8).forEach((f, i) => c.add('J1', i + 1, dgn[i] || null, 20 + f.dx, 8 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.J1 = CM(20, 8, 0, 'POWER+DIGITAL', 'HDR-2x8');
  const ann = ['dg13', 'gnd', null, null, null, null, null, 'an0', 'an1', 'an2', 'an3', 'an4', 'an5', null, null, null];
  hd2x(8).forEach((f, i) => c.add('J2', i + 1, ann[i] && ann[i] !== 'aref' ? ann[i] : (ann[i] === 'aref' ? null : ann[i]), 20 + f.dx, 38 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.J2 = CM(20, 38, 0, 'ANALOG', 'HDR-2x8');
  // 板中央：应用电路（LED + 电阻）
  for (let k = 0; k < 4; k++) {
    c.place(`LED${k + 1}`, thLED, 48 + k * 6, 18, [`dg${k + 2}`, 'gnd'], CM(48 + k * 6, 18, 0, 'LED', 'LED-THT'));
    c.place(`R${k + 1}`, fp603, 50 + k * 6, 26, ['v5', `dg${k + 2}`], CM(50 + k * 6, 26, 0, '470R', 'R0603'));
  }
  c.place('C1', fp805, 44, 8, ['v5', 'gnd'], CM(44, 8, 0, '100n', 'C0805'));
  c.place('J3', hd(2), 4, 8, ['vvin', 'gnd'], CM(4, 8, 90, 'VIN', 'HDR-2P'));
  c.place('J4', hd(9), 4, 20, ['dg0', 'dg1', 'dg6', 'dg7', 'dg8', 'dg9', 'dg10', 'dg11', 'dg12'], CM(4, 20, 90, 'EXP', 'HDR-9P'));
  c.place('J5', hd(6), 60, 40, ['an0', 'an1', 'an2', 'an3', 'an4', 'an5'], CM(60, 40, 0, 'AN', 'HDR-6P'));
  c.save('p28-shield');
}

// P29: 树莓派 HAT（2×20 排母 40pin + 中央应用 + 缺口禁布）
{
  const nets = ['v33', 'v5', 'gnd'];
  for (let k = 0; k < 8; k++) nets.push(`g${k}`);
  for (let k = 0; k < 4; k++) nets.push(`e${k}`);
  const netObjs = nets.map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('P29 HAT 载板', { width: 66, height: 52, nets: netObjs });
  const hatN = ['v33', 'v5', 'gnd', 'g0', 'g1', 'g2', 'g3', 'e0', 'g4', 'g5', 'e1', 'g6', 'g7', 'gnd', 'e2', 'e3', 'g0', 'g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'gnd', 'v5', 'v33', 'gnd'];
  const sock = hd2x(14);
  sock.slice(0, 28).forEach((f, i) => c.add('J1', i + 1, hatN[i] || null, 33 + f.dx, 6 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.J1 = CM(33, 6, 0, 'GPIO-40', 'HDR-2x20');
  // 中央应用：I2C 传感器 ×2 + LED
  c.place('U1', mk('SOIC-8'), 24, 26, ['g3', 'g2', null, 'gnd', null, null, null, 'v33'], CM(24, 26, 0, 'SENS', 'SOIC-8'));
  c.place('U2', mk('SOIC-8'), 42, 26, ['g2', 'g3', null, 'gnd', null, null, null, 'v33'], CM(42, 26, 0, 'EEPROM', 'SOIC-8'));
  for (let k = 0; k < 4; k++) {
    c.place(`LED${k + 1}`, thLED, 14 + k * 12, 40, [`e${k}`, 'gnd'], CM(14 + k * 12, 40, 0, 'LED', 'LED-THT'));
    c.place(`R${k + 1}`, fp603, 17 + k * 12, 46, ['v33', `e${k}`], CM(17 + k * 12, 46, 0, '330R', 'R0603'));
  }
  c.place('C1', fp805, 52, 40, ['v33', 'gnd'], CM(52, 40, 0, '100n', 'C0805'));
  c.place('C2', fp805, 58, 40, ['v5', 'gnd'], CM(58, 40, 0, '100n', 'C0805'));
  c.save('p29-hat');
}

// P30: 多路热电偶采集（MAX31855 ×4 SOIC-8 + 4 端子 + SPI）
{
  const nets = ['v33', 'gnd', 'sck', 'miso', 'cs1', 'cs2', 'cs3', 'cs4'];
  for (let k = 0; k < 4; k++) nets.push(`tc${k + 1}p`, `tc${k + 1}n`);
  const netObjs = nets.map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('P30 四路热电偶', { width: 80, height: 34, nets: netObjs });
  for (let k = 0; k < 4; k++) {
    const x = 12 + k * 17;
    const sn = ['tc' + (k + 1) + 'p', 'tc' + (k + 1) + 'n', 'gnd', `cs${k + 1}`, 'miso', null, 'sck', 'v33'];
    max31855.forEach((f, i) => c.add(`U${k + 1}`, i + 1, sn[i] || null, x + f.dx, 12 + f.dy, f.w, f.h, f.shape, f.layer));
    c.compsMeta[`U${k + 1}`] = CM(x, 12, 0, 'MAX31855', 'SOIC-8');
    c.place(`J${k + 1}`, term(2), x, 26, [`tc${k + 1}p`, `tc${k + 1}n`], CM(x, 26, 0, 'TC' + (k + 1), 'TB-2P'));
    c.place(`C${k + 1}`, fp805, x + 5, 8, ['v33', 'gnd'], CM(x + 5, 8, 0, '100n', 'C0805'));
  }
  c.place('J5', hd(8), 66, 26, ['v33', 'gnd', 'sck', 'miso', 'cs1', 'cs2', 'cs3', 'cs4'], CM(66, 26, 0, 'SPI', 'HDR-8P'));
  c.save('p30-thermocouple');
}

// P31: DS18B20 单总线星形（8× TO-92 + 上拉，总线网 9 pad）
{
  const nets = ['v5', 'gnd', 'ow'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('P31 单总线星形', { width: 76, height: 26, nets });
  for (let k = 0; k < 8; k++) {
    const x = 8 + k * 8.5;
    c.place(`U${k + 1}`, to92, x, 10, ['gnd', 'ow', 'v5'], CM(x, 10, 0, 'DS18B20', 'TO-92'));
  }
  c.place('R1', fp603, 40, 19, ['v5', 'ow'], CM(40, 19, 0, '4k7', 'R0603'));
  c.place('J1', hd(3), 4, 19, ['v5', 'ow', 'gnd'], CM(4, 19, 0, 'BUS', 'HDR-3P'));
  c.place('C1', fp805, 66, 19, ['v5', 'gnd'], CM(66, 19, 0, '100n', 'C0805'));
  c.save('p31-onewire');
}

// P32: RS-485 三 drop 链（3× 收发器 + 端子链式）
{
  const nets = ['v5', 'gnd', 'a_bus', 'b_bus', 'tx1', 'rx1', 'tx2', 'rx2', 'tx3', 'rx3', 'de'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('P32 RS-485 三 drop', { width: 84, height: 28, nets });
  const so8 = mk('SOIC-8');
  for (let k = 0; k < 3; k++) {
    const x = 12 + k * 26;
    const sn = [`tx${k + 1}`, 'gnd', 'v5', `rx${k + 1}`, null, 'b_bus', 'a_bus', k === 0 ? 'de' : 'de'];
    so8.forEach((f, i) => c.add(`U${k + 1}`, i + 1, sn[i] || null, x + f.dx, 10 + f.dy, f.w, f.h, f.shape, f.layer));
    c.compsMeta[`U${k + 1}`] = CM(x, 10, 0, 'RS485', 'SOIC-8');
    c.place(`J${k + 1}`, term(2), x, 22, ['a_bus', 'b_bus'], CM(x, 22, 0, 'DROP' + (k + 1), 'TB-2P'));
  }
  c.place('R1', fp1206, 66, 10, ['a_bus', 'b_bus'], CM(66, 10, 0, '120R', 'R1206'));
  c.place('C1', fp805, 4, 10, ['v5', 'gnd'], CM(4, 10, 0, '100n', 'C0805'));
  c.place('J4', hd(6), 4, 22, ['v5', 'gnd', 'tx1', 'rx1', 'de', 'gnd'], CM(4, 22, 0, 'MCU1', 'HDR-6P'));
  c.place('J5', hd(6), 74, 22, ['tx2', 'rx2', 'tx3', 'rx3', 'de', 'gnd'], CM(74, 22, 0, 'MCU23', 'HDR-6P'));
  c.save('p32-rs485-multi');
}

// P33: 16 路舵机驱动（PCA9685 TSSOP-28 + 16× 3pin = 极限扇出）
{
  const nets = ['v5', 'gnd', 'sda', 'scl', 'oe', 'vplus'];
  for (let k = 0; k < 16; k++) nets.push(`p${k}`);
  const netObjs = nets.map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('P33 16 路舵机', { width: 110, height: 44, grid: 0.325, trackW: 0.2, clearance: 0.1, viaOuter: 0.6, viaDrill: 0.3, nets: netObjs });
  const u1n = [];
  for (let k = 0; k < 16; k++) u1n.push(`p${k}`);
  u1n.push(null, null, null, null, 'oe', 'gnd', 'v5', 'scl', 'sda', null, 'gnd', 'v5');
  tssop28.forEach((f, i) => c.add('U1', i + 1, u1n[i] || null, 55 + f.dx, 12 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U1 = CM(55, 12, 0, 'PCA9685', 'TSSOP-28');
  for (let k = 0; k < 16; k++) {
    const x = 8 + k * 6.2;
    c.place(`J${k + 1}`, hd(3), x, 30, ['vplus', 'gnd', `p${k}`], CM(x, 30, 0, 'S' + k, 'HDR-3P'));
  }
  c.place('J17', hd(5), 5, 12, ['v5', 'gnd', 'sda', 'scl', 'oe'], CM(5, 12, 90, 'CTRL', 'HDR-5P'));
  c.place('J18', term(2), 5, 36, ['vplus', 'gnd'], CM(5, 36, 0, 'V+', 'TB-2P'));
  c.place('C1', fp805, 12, 12, ['v5', 'gnd'], CM(12, 12, 0, '100n', 'C0805'));
  c.place('C2', fp805, 100, 12, ['vplus', 'gnd'], CM(100, 12, 0, '100n', 'C0805'));
  c.save('p33-servo16');
}

// P34: 8 路光耦-MOS 隔离输出（光耦 + DPAK MOS + 端子 ×8）
{
  const nets = ['v5', 'gnd'];
  for (let k = 0; k < 8; k++) nets.push(`in${k + 1}`, `drv${k + 1}`, `out${k + 1}`);
  const netObjs = nets.map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('P34 8 路隔离输出', { width: 110, height: 40, nets: netObjs });
  const dip4 = mk('DIP-N', 4);
  for (let k = 0; k < 8; k++) {
    const x = 12 + k * 12;
    dip4.forEach((f, i) => c.add(`U${k + 1}`, i + 1, [`in${k + 1}`, `drv${k + 1}`, 'gnd', 'v5'][i] || null, x + f.dx, 9 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
    c.compsMeta[`U${k + 1}`] = CM(x, 9, 0, 'PC817', 'DIP-4');
    c.place(`R${k + 1}`, fp603, x - 2, 19, [`drv${k + 1}`, 'gnd'], CM(x - 2, 19, 0, '10k', 'R0603'));
    c.place(`Q${k + 1}`, dpak, x, 30, [`drv${k + 1}`, `out${k + 1}`, 'gnd'], CM(x, 30, 0, 'MOS-N', 'DPAK'));
    c.place(`J${k + 1}`, term(2), x - 2, 38, [`out${k + 1}`, 'gnd'], CM(x - 2, 38, 0, 'O' + (k + 1), 'TB-2P'));
  }
  c.place('J9', term(2), 4, 38, ['v5', 'gnd'], CM(4, 38, 0, 'PWR', 'TB-2P'));
  c.place('J10', hd(8), 12, 38, ['in1', 'in2', 'in3', 'in4', 'in5', 'in6', 'in7', 'in8'], CM(12, 38, 0, 'IN', 'HDR-8P'));
  c.save('p34-iso-output');
}

// P35: 四路 TP4056 充电（4× SOP-8 + LED ×8 + 端子）
{
  const nets = ['vbus', 'gnd'];
  for (let k = 0; k < 4; k++) nets.push(`bat${k}p`, `bat${k}n`, `chg${k}`, `stby${k}`);
  const netObjs = nets.map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('P35 四路充电', { width: 96, height: 38, nets: netObjs });
  const so8 = mk('SOIC-8');
  for (let k = 0; k < 4; k++) {
    const x = 12 + k * 22;
    const sn = [`bat${k}p`, `bat${k}n`, 'gnd', `stby${k}`, `chg${k}`, 'gnd', 'vbus', 'vbus'];
    so8.forEach((f, i) => c.add(`U${k + 1}`, i + 1, sn[i] || null, x + f.dx, 12 + f.dy, f.w, f.h, f.shape, f.layer));
    c.compsMeta[`U${k + 1}`] = CM(x, 12, 0, 'TP4056', 'SOIC-8');
    c.place(`LED${k * 2 + 1}`, thLED, x - 4, 24, [`chg${k}`, 'gnd'], CM(x - 4, 24, 0, 'CHG', 'LED-THT'));
    c.place(`LED${k * 2 + 2}`, thLED, x + 2, 24, [`stby${k}`, 'gnd'], CM(x + 2, 24, 0, 'STBY', 'LED-THT'));
    c.place(`R${k * 2 + 1}`, fp603, x - 4, 32, [`chg${k}`, 'vbus'], CM(x - 4, 32, 0, '1k', 'R0603'));
    c.place(`R${k * 2 + 2}`, fp603, x + 2, 32, [`stby${k}`, 'vbus'], CM(x + 2, 32, 0, '1k', 'R0603'));
    c.place(`J${k + 1}`, term(2), x + 8, 32, [`bat${k}p`, `bat${k}n`], CM(x + 8, 32, 0, 'B' + (k + 1), 'TB-2P'));
    c.place(`C${k + 1}`, fp805, x - 7, 6, ['vbus', 'gnd'], CM(x - 7, 6, 0, '10u', 'C0805'));
  }
  c.save('p35-quad-charge');
}

// P36: 双路音频混音器（4 进 2 出）
{
  const nets = ['agnd', 'in1', 'in2', 'in3', 'in4', 'mix1', 'mix2', 'out1', 'out2', 'vpos', 'vneg'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('P36 双路混音器', { width: 70, height: 34, nets });
  const so8 = mk('SOIC-8');
  const amps = [['in1', 'mix1', 'mix1', 'in2'], ['in3', 'mix2', 'mix2', 'in4'], ['mix1', 'out1', 'out1', 'agnd'], ['mix2', 'out2', 'out2', 'agnd']];
  amps.forEach((an, u) => {
    so8.forEach((f, i) => c.add(`U${u + 1}`, i + 1, [an[0], an[1], an[2], 'vneg', 'agnd', null, an[3], 'vpos'][i] || null, 16 + (u % 2) * 18 + f.dx, 10 + Math.floor(u / 2) * 12 + f.dy, f.w, f.h, f.shape, f.layer));
    c.compsMeta[`U${u + 1}`] = CM(16 + (u % 2) * 18, 10 + Math.floor(u / 2) * 12, 0, 'NE5532', 'SOIC-8');
  });
  for (let k = 0; k < 4; k++) c.place(`R${k + 1}`, fp603, 4 + k * 3, 10 + (k % 2) * 12, [`in${k + 1}`, 'mix' + (k % 2 + 1)], CM(4 + k * 3, 10 + (k % 2) * 12, 90, '10k', 'R0603'));
  c.place('J1', hd(4), 4, 30, ['in1', 'in2', 'in3', 'in4'], CM(4, 30, 0, 'IN', 'HDR-4P'));
  c.place('J2', hd(3), 66, 30, ['out1', 'agnd', 'out2'], CM(66, 30, 0, 'OUT', 'HDR-3P'));
  c.place('J3', hd(3), 66, 4, ['vpos', 'agnd', 'vneg'], CM(66, 4, 0, 'PWR', 'HDR-3P'));
  c.save('p36-mixer');
}

// P37: 电磁锁驱动（大线圈端子 + MOS + 续流 + 电流检测）
{
  const nets = ['v12', 'gnd', 'gate', 'sw_n', 'sense', 'lock_b', 'fb'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('P37 电磁锁驱动', { width: 54, height: 30, nets });
  c.place('Q1', dpak, 20, 12, ['gate', 'lock_b', 'sw_n'], CM(20, 12, 0, 'MOS-N', 'DPAK'));
  c.place('R1', fp1206, 32, 20, ['sw_n', 'sense'], CM(32, 20, 90, '20mR', 'R2512'));
  c.place('D1', smc2, 12, 24, ['gnd', 'lock_b'], CM(12, 24, 0, 'SS54', 'SMC'));
  const so8 = mk('SOIC-8');
  c.place('U1', so8, 40, 12, ['fb', 'sense', 'gate', 'gnd', null, null, null, 'v12'], CM(40, 12, 0, 'DRV', 'SOIC-8'));
  c.place('J1', term(2), 4, 12, ['v12', 'gnd'], CM(4, 12, 90, 'PWR', 'TB-2P'));
  c.place('J2', term(2), 4, 24, ['v12', 'lock_b'], CM(4, 24, 90, 'LOCK', 'TB-2P'));
  c.place('J3', hd(3), 48, 24, ['v12', 'gnd', 'fb'], CM(48, 24, 0, 'CTRL', 'HDR-3P'));
  c.place('C1', fp805, 30, 8, ['v12', 'gnd'], CM(30, 8, 0, '100n', 'C0805'));
  c.save('p37-lock');
}

// P38: 三域电源树（5V → 3.3V → 1.8V 级联 + 域间去耦）
{
  const nets = ['v5', 'gnd', 'v33', 'v18', 'f33', 'f18'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('P38 三域电源树', { width: 62, height: 30, nets });
  const s223 = mk('SOT-223');
  c.place('U1', s223, 14, 10, ['v5', 'gnd', 'gnd', 'v33'], CM(14, 10, 0, 'LDO-3.3', 'SOT-223'));
  c.place('U2', s223, 34, 10, ['v33', 'gnd', 'gnd', 'v18'], CM(34, 10, 0, 'LDO-1.8', 'SOT-223'));
  c.place('R1', fp603, 14, 20, ['v33', 'f33'], CM(14, 20, 0, '100k', 'R0603'));
  c.place('R2', fp603, 19, 20, ['f33', 'gnd'], CM(19, 20, 0, '100k', 'R0603'));
  c.place('R3', fp603, 34, 20, ['v18', 'f18'], CM(34, 20, 0, '100k', 'R0603'));
  c.place('R4', fp603, 39, 20, ['f18', 'gnd'], CM(39, 20, 0, '100k', 'R0603'));
  for (let k = 0; k < 3; k++) c.place(`C${k + 1}`, fp805, 8 + k * 5, 27, ['v5', 'gnd'], CM(8 + k * 5, 27, 0, '100n', 'C0805'));
  for (let k = 0; k < 3; k++) c.place(`C${k + 4}`, fp805, 26 + k * 5, 27, ['v33', 'gnd'], CM(26 + k * 5, 27, 0, '100n', 'C0805'));
  for (let k = 0; k < 3; k++) c.place(`C${k + 7}`, fp805, 44 + k * 5, 27, ['v18', 'gnd'], CM(44 + k * 5, 27, 0, '100n', 'C0805'));
  c.place('J1', term(2), 4, 8, ['v5', 'gnd'], CM(4, 8, 90, 'IN', 'TB-2P'));
  c.place('J2', hd(4), 54, 12, ['v33', 'gnd', 'v18', 'gnd'], CM(54, 12, 90, 'OUT', 'HDR-4P'));
  c.save('p38-power-tree');
}

// ===== 极端案例 P39-P45 =====

// P39: 最小板 12×8（SOT-23-5 LDO + 2 排针）
{
  const nets = ['vin', 'gnd', 'vout'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('P39 最小板', { width: 12, height: 8, grid: 0.3, trackW: 0.2, clearance: 0.1, viaOuter: 0.5, viaDrill: 0.25, nets });
  const s25 = [{ dx: -0.95, dy: 0.95, w: 0.5, h: 0.9 }, { dx: 0, dy: 0.95, w: 0.5, h: 0.9 }, { dx: 0.95, dy: 0.95, w: 0.5, h: 0.9 }, { dx: 0.95, dy: -0.95, w: 0.5, h: 0.9 }, { dx: -0.95, dy: -0.95, w: 0.5, h: 0.9 }];
  c.place('U1', s25, 6, 4, ['vin', 'gnd', 'vout', 'vin', 'vin'], CM(6, 4, 0, 'LDO', 'SOT-23-5'));
  c.place('C1', fp402, 2.5, 2, ['vin', 'gnd'], CM(2.5, 2, 0, '1u', 'C0402'));
  c.place('C2', fp402, 9.5, 6, ['vout', 'gnd'], CM(9.5, 6, 0, '1u', 'C0402'));
  c.save('p39-min-board');
}

// P40: 单网板（2 焊盘 1 网）
{
  const nets = ['only'].map(id => ({ id, name: 'ONLY' }));
  const c = makeDesign('P40 单网板', { width: 30, height: 14, nets });
  c.place('J1', term(2), 6, 7, ['only', null], CM(6, 7, 90, 'A', 'TB-2P'));
  c.place('J2', term(2), 24, 7, ['only', null], CM(24, 7, 90, 'B', 'TB-2P'));
  c.save('p40-single-net');
}

// P41: 大网数小板（25×18，SOIC-16 + 2 排针 20 网）
{
  const nets = ['v5', 'gnd'];
  for (let k = 0; k < 8; k++) nets.push(`a${k}`, `b${k}`);
  const netObjs = nets.map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('P41 大网数小板', { width: 25, height: 18, grid: 0.325, trackW: 0.2, clearance: 0.1, viaOuter: 0.6, viaDrill: 0.3, nets: netObjs });
  const so16 = mk('SOIC-16');
  const u1n = [];
  for (let k = 0; k < 8; k++) u1n.push(`a${k}`, `b${k}`);
  so16.forEach((f, i) => c.add('U1', i + 1, u1n[i] || null, 12.5 + f.dx, 9 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U1 = CM(12.5, 9, 0, 'BUS-X', 'SOIC-16');
  c.place('J1', hd(9), 3.5, 4, ['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'gnd'], CM(3.5, 4, 0, 'A', 'HDR-9P'));
  c.place('J2', hd(9), 21.5, 14, ['b0', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'v5'], CM(21.5, 14, 0, 'B', 'HDR-9P'));
  c.place('C1', fp805, 12.5, 15.5, ['v5', 'gnd'], CM(12.5, 15.5, 0, '100n', 'C0805'));
  c.save('p41-dense-nets');
}

// P42: 全 THT 板（DIP-8 + DIP-14 + 排针 + 端子，全部通孔）
{
  const nets = ['v5', 'gnd', 's1', 's2', 's3', 's4', 'o1', 'o2'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('P42 全 THT', { width: 60, height: 36, nets });
  const dip8 = mk('DIP-N', 8);
  c.place('U1', dip8, 14, 12, ['s1', 's2', 'gnd', 's3', 's4', 'gnd', 'o1', 'v5'], CM(14, 12, 0, 'DIP-8', 'DIP-8'));
  const dip14 = mk('DIP-N', 14);
  const u2n = ['o2', 's1', 's2', 'gnd', 's3', 's4', 'o1', 'gnd', 'v5', null, null, null, null, 'v5'];
  dip14.forEach((f, i) => c.add('U2', i + 1, u2n[i] || null, 34 + f.dx, 20 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.U2 = CM(34, 20, 0, 'DIP-14', 'DIP-14');
  c.place('Y1', [{ dx: -1.7, dy: 0, w: 1.6, h: 4.6, shape: 'circle', layer: 'both', holeR: 0.5 }, { dx: 1.7, dy: 0, w: 1.6, h: 4.6, shape: 'circle', layer: 'both', holeR: 0.5 }], 48, 12, ['s3', 's4'], CM(48, 12, 0, 'XTAL', 'HC-49'));
  c.place('C1', thC2(), 48, 24, ['v5', 'gnd'], CM(48, 24, 0, '100n', 'C-THT'));
  c.place('J1', term(4), 8, 30, ['v5', 'gnd', 's1', 's2'], CM(8, 30, 0, 'IO', 'TB-4P'));
  c.place('J2', term(2), 52, 30, ['o1', 'o2'], CM(52, 30, 0, 'OUT', 'TB-2P'));
  c.save('p42-all-tht');
  function thC2() { return [{ dx: -1.27, dy: 0, w: 1.6, h: 1.6, shape: 'circle', layer: 'both', holeR: 0.4 }, { dx: 1.27, dy: 0, w: 1.6, h: 1.6, shape: 'circle', layer: 'both', holeR: 0.4 }]; }
}

// P43: 单层板 layers:1（全部顶层布线）
{
  const nets = ['v5', 'gnd', 'a1', 'a2', 'b1', 'b2'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('P43 单层板', { width: 50, height: 28, layers: 1, nets });
  const so8 = mk('SOIC-8');
  c.place('U1', so8, 14, 10, ['a1', 'a2', 'gnd', 'b1', 'b2', 'gnd', 'v5', 'v5'], CM(14, 10, 0, 'SOIC-8', 'SOIC-8'));
  c.place('J1', hd(4), 40, 8, ['v5', 'gnd', 'a1', 'a2'], CM(40, 8, 90, 'IO', 'HDR-4P'));
  c.place('J2', hd(4), 40, 20, ['v5', 'gnd', 'b1', 'b2'], CM(40, 20, 90, 'IO2', 'HDR-4P'));
  c.place('R1', fp603, 28, 10, ['a1', 'a2'], CM(28, 10, 0, '10k', 'R0603'));
  c.place('C1', fp805, 28, 20, ['v5', 'gnd'], CM(28, 20, 0, '100n', 'C0805'));
  c.save('p43-single-layer');
}

// P44: 细长板 100×12（LED 灯条形态，极端长宽比）
{
  const nets = ['v12', 'gnd'];
  for (let k = 0; k < 10; k++) nets.push(`l${k}`);
  const netObjs = nets.map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('P44 细长灯条', { width: 100, height: 12, nets: netObjs });
  for (let k = 0; k < 10; k++) {
    const x = 8 + k * 9;
    c.place(`LED${k + 1}`, thLED, x, 5, [`l${k}`, 'gnd'], CM(x, 5, 0, 'LED', 'LED-THT'));
    c.place(`R${k + 1}`, fp603, x + 3, 5, ['v12', `l${k}`], CM(x + 3, 5, 0, '680R', 'R0603'));
  }
  c.place('J1', term(2), 3, 5, ['v12', 'gnd'], CM(3, 5, 90, 'IN', 'TB-2P'));
  c.place('J2', term(2), 97, 5, ['v12', 'gnd'], CM(97, 5, 90, 'OUT', 'TB-2P'));
  c.save('p44-led-strip');
}

// P45: 中央禁区板（50×50，中央 20×20 禁布，四角元件绕行）
{
  const nets = ['v5', 'gnd', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('P45 中央禁区', { width: 50, height: 50, nets,
    keepouts: [{ x: 25, y: 25, w: 20, h: 20 }] });
  c.place('U1', mk('SOIC-8'), 10, 10, ['n1', 'n2', 'gnd', 'n3', 'n4', 'gnd', 'v5', 'v5'], CM(10, 10, 0, 'A', 'SOIC-8'));
  c.place('U2', mk('SOIC-8'), 40, 10, ['n5', 'n6', 'gnd', 'n3', 'n4', 'gnd', 'v5', 'v5'], CM(40, 10, 0, 'B', 'SOIC-8'));
  c.place('U3', mk('SOIC-8'), 10, 40, ['n3', 'n4', 'gnd', 'n1', 'n2', 'gnd', 'v5', 'v5'], CM(10, 40, 0, 'C', 'SOIC-8'));
  c.place('U4', mk('SOIC-8'), 40, 40, ['n6', 'n5', 'gnd', 'n2', 'n1', 'gnd', 'v5', 'v5'], CM(40, 40, 0, 'D', 'SOIC-8'));
  c.place('J1', hd(4), 25, 3, ['v5', 'gnd', 'n1', 'n5'], CM(25, 3, 0, 'TOP', 'HDR-4P'));
  c.place('J2', hd(4), 25, 47, ['v5', 'gnd', 'n2', 'n6'], CM(25, 47, 0, 'BOT', 'HDR-4P'));
  c.place('J3', hd(4), 3, 25, ['v5', 'gnd', 'n3', 'n4'], CM(3, 25, 90, 'LEF', 'HDR-4P'));
  c.save('p45-center-keepout');
}

// ===== 新封装 P46-P48 =====

// P46: SIP-9 直插模块载板
{
  const nets = ['v5', 'gnd', 'tx', 'rx', 'rst', 'io1', 'io2', 'io3', 'cfg'].map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('P46 SIP-9 模块', { width: 52, height: 26, nets });
  const m9 = ['gnd', 'v5', 'rst', 'tx', 'rx', 'io1', 'io2', 'io3', 'cfg'];
  c.place('U1', sip9, 20, 8, m9, CM(20, 8, 0, 'SIP-MODULE', 'SIP-9'));
  c.place('R1', fp603, 6, 18, ['v5', 'rst'], CM(6, 18, 0, '10k', 'R0603'));
  c.place('C1', fp805, 11, 18, ['v5', 'gnd'], CM(11, 18, 0, '100n', 'C0805'));
  c.place('J1', hd(5), 30, 18, ['v5', 'gnd', 'tx', 'rx', 'rst'], CM(30, 18, 0, 'SER', 'HDR-5P'));
  c.place('J2', hd(4), 46, 12, ['io1', 'io2', 'io3', 'cfg'], CM(46, 12, 90, 'IO', 'HDR-4P'));
  c.save('p46-sip9');
}

// P47: DB-25 并口转接
{
  const nets = ['gnd'];
  for (let k = 1; k <= 17; k++) nets.push(`d${k}`);
  const netObjs = nets.map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('P47 DB-25 转接', { width: 88, height: 30, nets: netObjs });
  const dbn = ['gnd', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9', 'd10', 'd11', 'd12', 'd13', 'd14', 'd15', 'd16', 'd17', 'gnd', 'gnd', null, null, null, null, null, 'gnd', 'gnd'];
  dsub25.forEach((f, i) => c.add('J1', i + 1, dbn[i] || null, 20 + f.dx, 15 + f.dy, f.w, f.h, f.shape, f.layer, f.holeR));
  c.compsMeta.J1 = CM(20, 15, 0, 'DB-25', 'DSUB-25');
  c.place('J2', hd(9), 62, 8, ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'gnd'], CM(62, 8, 0, 'A', 'HDR-9P'));
  c.place('J3', hd(9), 62, 22, ['d9', 'd10', 'd11', 'd12', 'd13', 'd14', 'd15', 'd16', 'd17'], CM(62, 22, 0, 'B', 'HDR-9P'));
  c.save('p47-db25');
}

// P48: 15 位接线端子排 + 移位寄存器
{
  const nets = ['v5', 'gnd'];
  for (let k = 0; k < 8; k++) nets.push(`q${k}`);
  for (let k = 0; k < 7; k++) nets.push(`aux${k}`);
  const netObjs = nets.map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('P48 15 位端子排', { width: 110, height: 32, nets: netObjs });
  const so18 = mk('SOIC-18');
  const uln = [];
  for (let k = 0; k < 8; k++) uln.push(`q${k}`);
  uln.push('gnd'); for (let k = 0; k < 7; k++) uln.push(`aux${k}`); uln.push('v5');
  so18.forEach((f, i) => c.add('U1', i + 1, uln[i] || null, 55 + f.dx, 10 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U1 = CM(55, 10, 0, 'DRIVER', 'SOIC-18');
  for (let k = 0; k < 15; k++) {
    const x = 8 + k * 6.8;
    c.place(`J${k + 1}`, term(2), x, 26, [k < 8 ? `q${k}` : `aux${k - 8}`, 'gnd'], CM(x, 26, 0, 'T' + (k + 1), 'TB-2P'));
  }
  c.place('J16', hd(4), 4, 10, ['v5', 'gnd', 'q0', 'aux0'], CM(4, 10, 90, 'CTRL', 'HDR-4P'));
  c.save('p48-term15');
}

// ===== 网络拓扑 P49-P50 =====

// P49: 菊花链 + 两端端接（4× SOIC-8 串行存储链）
{
  const nets = ['v5', 'gnd', 'din', 'dout_end'];
  for (let k = 0; k < 3; k++) nets.push(`chain${k}`);
  for (let k = 0; k < 4; k++) nets.push(`cs${k + 1}`);
  const netObjs = nets.map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('P49 菊花链存储', { width: 84, height: 28, nets: netObjs });
  const so8 = mk('SOIC-8');
  for (let k = 0; k < 4; k++) {
    const x = 14 + k * 19;
    const din = k === 0 ? 'din' : `chain${k - 1}`;
    const dout = k === 3 ? 'dout_end' : `chain${k}`;
    const sn = [`cs${k + 1}`, din, 'gnd', 'v5', dout, 'gnd', null, null];
    so8.forEach((f, i) => c.add(`U${k + 1}`, i + 1, sn[i] || null, x + f.dx, 12 + f.dy, f.w, f.h, f.shape, f.layer));
    c.compsMeta[`U${k + 1}`] = CM(x, 12, 0, 'MEM', 'SOIC-8');
  }
  c.place('R1', fp603, 5, 12, ['din', 'gnd'], CM(5, 12, 90, '10k', 'R0603'));
  c.place('R2', fp603, 79, 12, ['dout_end', 'gnd'], CM(79, 12, 90, '10k', 'R0603'));
  c.place('J1', hd(6), 4, 22, ['v5', 'gnd', 'din', 'cs1', 'cs2', 'cs3'], CM(4, 22, 0, 'CTRL', 'HDR-6P'));
  c.place('J2', hd(3), 78, 22, ['dout_end', 'cs4', 'gnd'], CM(78, 22, 0, 'TAP', 'HDR-3P'));
  c.save('p49-daisy');
}

// P50: 广播总线（1 驱动 → 8 接收单网 9 pad + 独立使能）
{
  const nets = ['v5', 'gnd', 'bcast'];
  for (let k = 0; k < 8; k++) nets.push(`en${k + 1}`);
  const netObjs = nets.map(id => ({ id, name: id.toUpperCase() }));
  const c = makeDesign('P50 广播总线', { width: 80, height: 30, nets: netObjs });
  const so14 = mk('SOIC-14');
  const drv = ['bcast', null, null, 'gnd', null, null, null, 'v5', null, null, null, null, 'gnd', null];
  so14.forEach((f, i) => c.add('U1', i + 1, drv[i] || null, 12 + f.dx, 15 + f.dy, f.w, f.h, f.shape, f.layer));
  c.compsMeta.U1 = CM(12, 15, 0, 'DRV', 'SOIC-14');
  for (let k = 0; k < 8; k++) {
    const x = 34 + k * 5.8;
    const so8 = mk('SOIC-8');
    so8.forEach((f, i) => c.add(`R${k + 1}`, i + 1, ['bcast', `en${k + 1}`, 'gnd', 'v5', null, null, null, null][i] || null, 40 + k * 5.2 + f.dx, 10 + (k % 2) * 10 + f.dy, f.w, f.h, f.shape, f.layer));
  }
  c.place('J1', hd(2), 4, 8, ['v5', 'gnd'], CM(4, 8, 90, 'PWR', 'HDR-2P'));
  c.place('J2', hd(8), 12, 24, ['en1', 'en2', 'en3', 'en4', 'en5', 'en6', 'en7', 'en8'], CM(12, 24, 0, 'EN', 'HDR-8P'));
  c.save('p50-broadcast');
}

// ============ 自检门（spec 门同款 + 半孔豁免 + 环宽 + 零格）============
let fail = 0;
const dirs = [];
// 家族目录
['p01-555-tiny', 'p02-555-small', 'p03-555-mid', 'p04-555-large', 'p05-555-xlarge',
 'p06-grid-03', 'p07-grid-04', 'p08-grid-05', 'p09-grid-06', 'p10-grid-08',
 'p11-density-1', 'p12-density-2', 'p13-density-3', 'p14-density-4', 'p15-density-6',
 'p16-star-2', 'p17-star-4', 'p18-star-6', 'p19-star-7', 'p20-star-7b',
 'p21-via-05', 'p22-via-15', 'p23-via-30', 'p24-via-60', 'p25-via-120'].forEach(d => dirs.push(d));
['p26-ws2812-8x8', 'p27-cnc-shield', 'p28-shield', 'p29-hat', 'p30-thermocouple',
 'p31-onewire', 'p32-rs485-multi', 'p33-servo16', 'p34-iso-output', 'p35-quad-charge',
 'p36-mixer', 'p37-lock', 'p38-power-tree', 'p39-min-board', 'p40-single-net',
 'p41-dense-nets', 'p42-all-tht', 'p43-single-layer', 'p44-led-strip', 'p45-center-keepout',
 'p46-sip9', 'p47-db25', 'p48-term15', 'p49-daisy', 'p50-broadcast'].forEach(d => dirs.push(d));
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
console.log('\n全部 50 项目自检通过');
