// BG2208-4G 商用净水机控制板 design.json 构建脚本 v4（完整终版）
// 设计依据：projects/bg2208-4g/DESIGN.md（全部 datasheet 实证）
// 坐标系：y 向下（0=顶边）；层 'top'/'bottom'/'both'
// 用法：
//   node build-design.mjs dump   —— 打印真封装 pad 几何（人工核对 SIM/IPEX 映射）
//   node build-design.mjs        —— 生成 design.json
import { readFileSync, writeFileSync } from 'node:fs';
import { devFootprint, manual } from './footprints.mjs';

const mode = process.argv[2] || 'build';
const FP = {
  U5: devFootprint('../../../.scratch/bg2208/ml307r-device.json', 'ML307R-DC'),
  U7: devFootprint('../../../.scratch/bg2208/tm1640-device.json', 'TM1640'),
  U3: devFootprint('../../../.scratch/bg2208/ru3030-device.json', 'RU3030M2'),
  U2: devFootprint('../../../.scratch/bg2208/dev-C963385.json', 'LM2596S-ADJ'),
  CON2: devFootprint('../../../.scratch/bg2208/dev-C266627.json', 'SIM-114'),
  X1: devFootprint('../../../.scratch/bg2208/dev-C88374.json', 'IPEX-UFL')
};

// ===== 真封装 pad↔功能映射（dump 人工核对后锁定；信号全串 0Ω，映射错可跳线救）=====
const SIM_MAP = { 1: 'SIM_VCC', 2: 'SIM_RST', 3: 'SIM_CLK', 4: 'SIM_DATA', 5: 'GND', 6: 'GND', 7: 'GND', 8: 'GND' };
const IPEX_MAP = { 1: 'M_ANT_F', 2: 'GND', 3: 'GND' };

// ===== 网络表 =====
const nets = [];
const nid = {};
function net(name, w) {
  if (nid[name]) return nid[name];
  const id = 'n' + (nets.length + 1);
  nets.push({ id, name, ...(w ? { w } : {}) });
  nid[name] = id;
  return id;
}
const N = {
  V24IN: net('V24IN'), V24: net('V24'), GND: net('GND'),
  V4V0: net('V4V0'), M_VBAT: net('M_VBAT'),
  SW2596: net('SW2596'), FB2596: net('FB2596'),
  V3V8: net('V3V8'), SW2451: net('SW2451'), FB2451: net('FB2451'),
  BST_C: net('BST_C'), EN2451: net('EN2451'),
  V5V0: net('V5V0'),
  M_TXD: net('M_TXD'), PNP_B: net('PNP_B'), VDD_EXT: net('VDD_EXT'),
  MCU_RXD: net('MCU_RXD'), MCU_TXD: net('MCU_TXD'), M_RXD: net('M_RXD'),
  M_PWR: net('M_PWR'), MCU_PWR: net('MCU_PWR'), Q2_B: net('Q2_B'),
  M_SIM_PWR: net('M_SIM_PWR'), SIM_VCC: net('SIM_VCC'),
  M_SIM_RST: net('M_SIM_RST'), SIM_RST: net('SIM_RST'),
  M_SIM_CLK: net('M_SIM_CLK'), SIM_CLK: net('SIM_CLK'),
  M_SIM_DATA: net('M_SIM_DATA'), SIM_DATA: net('SIM_DATA'),
    M_ANT: net('M_ANT'), M_ANT_F: net('M_ANT_F'),
  M_NL: net('M_NL'), NL_B: net('NL_B'), NL_C: net('NL_C'), NL_A: net('NL_A'),
  DIN: net('DIN'), SCLK: net('SCLK'),
  ADC_PRESS: net('ADC_PRESS'), SENS_P: net('SENS_P'),
  ADC_TEMP: net('ADC_TEMP'), SENS_T: net('SENS_T'),
  PUMP_G: net('PUMP_G'), PUMP_GATE: net('PUMP_GATE'),
  PUMP_D: net('PUMP_D'),
  VALVE_G: net('VALVE_G'), VALVE_GATE: net('VALVE_GATE'),
  VALVE_D: net('VALVE_D'),
  BEEP: net('BEEP'), BEEP_B: net('BEEP_B'), BEEP_C: net('BEEP_C'),
  BEEP_V24: net('BEEP_V24'), BEEP_P: net('BEEP_P'),
  RST_MC: net('RST_MC'), CTKVDD: net('CTKVDD'),
  RST_MDU: net('RST_MDU'), BOOT_MDU: net('BOOT_MDU'),
  HD_TX: net('HD_TX'), HD_RX: net('HD_RX')
};
for (let i = 1; i <= 4; i++) N['TKEY' + i] = net('TKEY' + i);
for (const ch of ['1', '2']) {
  N['TDS' + ch + '_A'] = net('TDS' + ch + '_A');
  N['TDS' + ch + '_B'] = net('TDS' + ch + '_B');
  N['TDS' + ch + '_EA'] = net('TDS' + ch + '_EA');
  N['TDS' + ch + '_EB'] = net('TDS' + ch + '_EB');
}
for (let i = 1; i <= 8; i++) N['SEG' + i] = net('SEG' + i);
for (let i = 1; i <= 16; i++) N['GRID' + i] = net('GRID' + i);
N.SWH_IN = net('SWH_IN'); N.SWL_IN = net('SWL_IN'); N.PRB_IN = net('PRB_IN');
N.SW_HIGH = net('SW_HIGH'); N.SW_LOW = net('SW_LOW'); N.PROBE = net('PROBE');

// ===== 焊盘装配 =====
const pads = [];
const comps = [];
function place(ref, fp, x, y, rotDeg, netMap, layerOverride) {
  const rot = ((rotDeg % 360) + 360) % 360;
  for (const p of fp.pads) {
    let px = p.x, py = p.y, pw = p.w, ph = p.h;
    if (rot === 90) { const t = px; px = -py; py = t; const t2 = pw; pw = ph; ph = t2; }
    else if (rot === 180) { px = -px; py = -py; }
    else if (rot === 270) { const t = px; px = py; py = -t; const t2 = pw; pw = ph; ph = t2; }
    const netName = netMap ? netMap[p.num] : null;
    if (netName === undefined) throw new Error(ref + '-' + p.num + ' 无映射键');
    const layer = layerOverride || (p.layer === 'both' ? 'both' : (p.layer === 1 ? 'bottom' : 'top'));
    const pad = { id: ref + '-' + p.num, x: +(x + px).toFixed(3), y: +(y + py).toFixed(3), w: pw, h: ph, shape: p.shape, layer };
    if (netName !== null) {
      if (!nid[netName]) throw new Error(ref + '-' + p.num + ' 引用未注册网络: ' + netName);
      pad.netId = nid[netName];
    }
    if (p.holeR) pad.holeR = p.holeR;
    pads.push(pad);
  }
  comps.push({ ref, fp: fp.name, x, y, rot: rotDeg });
}
function part(ref, fpName, x, y, rot, n1, n2) {
  place(ref, manual[fpName](), x, y, rot, { 1: n1, 2: n2 }, 'bottom');
}
function led(ref, x, y, orient, na, nc) {
  place(ref, manual['LED0603'](), x, y, orient === 'v' ? 90 : 0, { 1: na, 2: nc });
}

// ================= U5 ML307R（背面右上，ANT_MAIN 焊盘朝右板边）=================
{
  const p35 = FP.U5.pads.find(p => p.num === '35');
  const rot = p35.x > 0 ? 0 : (p35.x < 0 ? 180 : (p35.y > 0 ? 270 : 90));
  // 手册 Table 5-30 权威映射；未列出的焊盘（RSV/USB/IIC/GPIO/PWM/ADC0/PCM/LCD_FMARK）= null 悬空
  const nm = {
    42: 'M_VBAT', 43: 'M_VBAT', 35: 'M_ANT', 24: 'VDD_EXT',
    17: 'M_RXD', 18: 'M_TXD', 22: 'GND', 23: 'GND', 19: 'GND', 20: 'GND', 21: 'GND',
    7: 'M_PWR', 16: 'M_NL',
    14: 'M_SIM_PWR', 11: 'M_SIM_DATA', 13: 'M_SIM_CLK', 12: 'M_SIM_RST', 79: null,
    1: 'GND', 10: 'GND', 27: 'GND', 34: 'GND', 36: 'GND', 37: 'GND', 40: 'GND', 41: 'GND',
    70: 'GND', 71: 'GND', 72: 'GND', 88: 'GND', 89: 'GND', 90: 'GND', 91: 'GND', 92: 'GND',
    93: 'GND', 94: 'GND', 95: 'GND',
    15: 'RST_MDU', 82: 'BOOT_MDU'
    // 其余（RSV/STATE/USB/IIC/GPIO/PWM/ADC0/PCM/WAKEUP/DBG/LCD_FMARK）：悬空
    // DBG_TXD/RXD(38/39) 悬空（1.8V 域，直连 3.3V USB-TTL 会损坏——检查表注明）
  };
  place('U5', FP.U5, 93, 22, rot, new Proxy(nm, { get: (t, k) => (k in t ? t[k] : null) }), 'bottom');
}

// ================= 模块储能电容（Figure 4）=================
part('FB1', 'R0603', 92.5, 8, 0, 'V4V0', 'M_VBAT');
part('C21', 'TANT-D', 77, 7, 0, 'M_VBAT', 'GND');
part('C22', 'TANT-D', 86, 7, 0, 'M_VBAT', 'GND');
part('C23', 'R0805', 98, 7, 0, 'M_VBAT', 'GND');
part('C24', 'R0603', 104, 6, 0, 'M_VBAT', 'GND');
part('C25', 'R0603', 110, 6, 0, 'M_VBAT', 'GND');

// ================= IPEX + π 匹配串位 =================
place('X1', FP.X1, 112, 13, 0, IPEX_MAP, 'bottom');
part('R_ANT', 'R0603', 105, 10, 0, 'M_ANT', 'M_ANT_F');

// ================= SIM 卡座 + 串阻/滤波（Figure 8）=================
place('CON2', FP.CON2, 106, 44, 90, SIM_MAP, 'bottom');
part('R_SIM1', 'R0603', 100, 36, 0, 'M_SIM_PWR', 'SIM_VCC');
part('R_SIM2', 'R0603', 100, 38, 0, 'M_SIM_RST', 'SIM_RST');
part('R_SIM3', 'R0603', 100, 40, 0, 'M_SIM_CLK', 'SIM_CLK');
part('R_SIM4', 'R0603', 100, 42, 0, 'M_SIM_DATA', 'SIM_DATA');
part('C31', 'R0603', 105, 37, 0, 'SIM_RST', 'GND');
part('C32', 'R0603', 105, 41, 0, 'SIM_CLK', 'GND');
part('C33', 'R0603', 105, 45, 0, 'SIM_DATA', 'GND');
part('C34', 'R0603', 105, 33, 0, 'SIM_VCC', 'GND');
part('C35', 'R0805', 110, 33, 0, 'SIM_VCC', 'GND');

// ================= UART 电平转换（下行 1K+910Ω 分压=1.83V；上行 8550 E=VDD_EXT）=================
part('R_DIV1', 'R0603', 70, 34, 0, 'MCU_TXD', 'M_RXD');
part('R_DIV2', 'R0603', 70, 37, 90, 'M_RXD', 'GND');
part('R_B1', 'R0603', 76, 32, 0, 'M_TXD', 'PNP_B');
place('Q1', manual['SOT23'](), 81, 30, 0, { 1: 'PNP_B', 2: 'VDD_EXT', 3: 'MCU_RXD' }, 'bottom'); // 8550: 1=B 2=E 3=C
part('R_C1', 'R0603', 76, 27, 90, 'MCU_RXD', 'V3V8');

// ================= 模块 PWR_ON/OFF（Figure 10）=================
part('R_PWR', 'R0603', 74, 20, 0, 'MCU_PWR', 'Q2_B');
place('Q2', manual['SOT23'](), 78, 22, 0, { 1: 'Q2_B', 2: 'GND', 3: 'M_PWR' }, 'bottom');
part('C_PWR', 'R0603', 82, 26, 90, 'M_PWR', 'GND');

// ================= NETLIGHT（Figure 14；LED 在正面右上）=================
part('R_NL1', 'R0603', 74, 14, 0, 'M_NL', 'NL_B');
place('Q4', manual['SOT23'](), 78, 12, 180, { 1: 'NL_B', 2: 'GND', 3: 'NL_C' }, 'bottom');
part('R_NL2', 'R0603', 98, 11, 0, 'V4V0', 'NL_A');
led('D77', 110, 26, 'h', 'NL_A', 'NL_C');

// ================= U6 HC89F303C（背面中央）=================
place('U6', manual['SSOP28'](), 56, 46, 0, {
  1: 'MCU_RXD', 2: 'MCU_TXD', 3: 'VALVE_G', 4: 'BEEP',
  5: 'TKEY1', 6: 'TKEY2', 7: 'TKEY3', 8: 'TKEY4',
  9: 'PUMP_G', 10: 'ADC_PRESS', 11: 'TDS2_EA', 12: 'TDS1_EA',
  13: 'GND', 14: 'V3V8',
  15: 'TDS2_B', 16: 'TDS2_A', 17: 'TDS1_B', 18: 'TDS1_A',
  19: 'SCLK', 20: 'DIN',
  21: null,
  22: 'RST_MC', 23: 'CTKVDD', 24: 'MCU_PWR',
  25: 'SW_LOW', 26: 'SW_HIGH', 27: 'PROBE', 28: 'ADC_TEMP'
}, 'bottom');
part('C41', 'R0603', 63, 40, 90, 'V3V8', 'GND');
part('C42', 'R0805', 68, 43, 0, 'V3V8', 'GND');
part('R_RST', 'R0603', 47, 41, 0, 'V3V8', 'RST_MC');
part('C51', 'R0603', 64, 52, 0, 'CTKVDD', 'GND');
part('C52', 'R0805', 69, 52, 0, 'CTKVDD', 'GND');

// ================= U7 TM1640（背面，矩阵正后方）=================
place('U7', FP.U7, 56, 22, 0, {
  1: 'GRID12', 2: 'GRID13', 3: 'GRID14', 4: 'GRID15', 5: 'GRID16',
  6: 'GND', 7: 'DIN', 8: 'SCLK',
  9: 'SEG1', 10: 'SEG2', 11: 'SEG3', 12: 'SEG4', 13: 'SEG5', 14: 'SEG6',
  15: 'SEG7', 16: 'SEG8', 17: 'V3V8',
  18: 'GRID1', 19: 'GRID2', 20: 'GRID3', 21: 'GRID4', 22: 'GRID5',
  23: 'GRID6', 24: 'GRID7', 25: 'GRID8', 26: 'GRID9', 27: 'GRID10', 28: 'GRID11'
}, 'bottom');
part('C43', 'R0603', 63, 22, 90, 'V3V8', 'GND');

// ================= 触摸弹簧（正面底部均布）=================
for (let i = 0; i < 4; i++)
  place('SW' + (i + 1), manual['SPRING'](), 20 + i * 27, 70, 0, { 1: 'TKEY' + (i + 1) }, 'top');

// ================= 显示矩阵（64 段 LED + V1-V8）=================
{
  let dn = 0;
  for (let d = 0; d < 8; d++) {
    const cx = 21 + d * 11, cy = 20;
    const segs = {
      1: [cx, cy - 5.5, 'h'], 2: [cx + 3.1, cy - 2.75, 'v'], 3: [cx + 3.1, cy + 2.75, 'v'],
      4: [cx, cy + 5.5, 'h'], 5: [cx - 3.1, cy + 2.75, 'v'], 6: [cx - 3.1, cy - 2.75, 'v'],
      7: [cx, cy, 'h'], 8: [cx + 4.5, cy + 5.5, 'h']
    };
    for (let s = 1; s <= 8; s++) {
      const [x, y, o] = segs[s];
      led('D' + (++dn), +x.toFixed(2), +y.toFixed(2), o, 'SEG' + s, 'GRID' + (d + 1));
    }
  }
  for (let n = 1; n <= 8; n++)
    led('D' + (++dn), 21 + (n - 1) * 11, 31.5, 'h', 'SEG1', 'GRID' + (8 + n));
}

// ================= LM2596（V4V0）=================
part('F1', 'F1812', 7.5, 16, 90, 'V24IN', 'V24');
place('U2', FP.U2, 18, 13, 0, { 1: 'V24', 2: 'SW2596', 3: 'GND', 4: 'FB2596', 5: 'GND', 6: 'GND' }, 'bottom');
part('L2', 'IND-8x8', 32, 12, 0, 'SW2596', 'V4V0');
part('D_LM', 'SMA', 25, 5, 0, 'GND', 'SW2596');        // 续流：pad1=阳(GND) pad2=阴(SW)
part('C61', 'R0603', 33, 5, 0, 'V4V0', 'GND');
part('C62', 'R0805', 38, 5, 0, 'V4V0', 'GND');
part('C63', 'CAP-SVP6', 33, 20, 0, 'V4V0', 'GND');
place('C64', manual['CAP-RAD'](), 5.5, 10, 0, { 1: 'V24', 2: 'GND' }, 'bottom');
part('R_FU', 'R0603', 9.5, 21, 0, 'V4V0', 'FB2596');     // 22.6K
part('R_FD', 'R0603', 13, 23, 90, 'FB2596', 'GND');     // 10K

// ================= MP2451（V3V8，引脚序 datasheet p2：1=BST 2=GND 3=FB 4=EN 5=SW 6=VIN）=================
place('U1', manual['SOT23-6'](), 15, 31, 0, {
  1: 'BST_C', 2: 'GND', 3: 'FB2451', 4: 'EN2451', 5: 'SW2451', 6: 'V24'
}, 'bottom');
part('C_BST', 'R0603', 17, 35, 0, 'BST_C', 'SW2451');
part('L1', 'IND-5x5', 22, 31, 0, 'SW2451', 'V3V8');
part('D73', 'SMA', 22, 25, 0, 'GND', 'SW2451');
part('C71', 'C1206', 9.5, 26, 0, 'V24', 'GND');
part('C72', 'C1206', 9.5, 31, 0, 'V24', 'GND');
part('C73', 'C1206', 29.5, 26, 0, 'V3V8', 'GND');
part('C74', 'C1206', 29.5, 31, 0, 'V3V8', 'GND');
part('R_FU2', 'R0603', 8, 36, 0, 'V3V8', 'FB2451');    // 124K
part('R_FD2', 'R0603', 8, 39, 90, 'FB2451', 'GND');    // 32.4K
part('R_EN1', 'R0603', 12, 36, 0, 'V24', 'EN2451');    // 100K
part('R_EN2', 'R0603', 12, 39, 90, 'EN2451', 'GND');   // 33K → EN=5.96V<8V ✓

// ================= 78L05（V5V0）=================
place('U8', manual['SOT89'](), 41, 62, 0, { 1: 'V24', 2: 'GND', 3: 'V5V0' }, 'bottom');
part('C81', 'R0603', 40, 56, 0, 'V24', 'GND');
part('C82', 'R0603', 40, 68, 0, 'V5V0', 'GND');
part('C83', 'R0805', 47, 62, 90, 'V5V0', 'GND');

// ================= 泵/阀 MOS + 续流（贴近 12P 引脚 7-12）=================
part('R_GP', 'R0603', 26, 44, 0, 'PUMP_G', 'PUMP_GATE');
part('R_PD1', 'R0603', 26, 46, 0, 'PUMP_GATE', 'GND');
place('U3', FP.U3, 18, 45, 90, { 1: 'GND', 2: 'GND', 3: 'GND', 4: 'PUMP_GATE', 5: 'PUMP_D', 6: 'PUMP_D', 7: 'PUMP_D', 8: 'PUMP_D', 9: 'PUMP_D' }, 'bottom');
part('D74', 'SMA', 27, 41, 0, 'PUMP_D', 'V24');
part('R_GV', 'R0603', 26, 55, 0, 'VALVE_G', 'VALVE_GATE');
part('R_PDV', 'R0603', 26, 57, 0, 'VALVE_GATE', 'GND');
place('U4', FP.U3, 18, 56, 90, { 1: 'GND', 2: 'GND', 3: 'GND', 4: 'VALVE_GATE', 5: 'VALVE_D', 6: 'VALVE_D', 7: 'VALVE_D', 8: 'VALVE_D', 9: 'VALVE_D' }, 'bottom');
part('D75', 'SMA', 28, 60, 0, 'VALVE_D', 'V24');

// ================= 连接器 =================
place('CON1', manual['XHB12'](), 5.5, 38, 90, {
  1: 'V24IN', 2: 'GND', 3: 'PRB_IN', 4: 'GND', 5: 'SWL_IN', 6: 'GND',
  7: 'V24', 8: 'PUMP_D', 9: 'V24', 10: 'PUMP_D', 11: 'V24', 12: 'VALVE_D'
}, 'both');
place('J2', manual['XHB4'](), 5.5, 61, 90, { 1: 'V5V0', 2: 'GND', 3: 'SENS_P', 4: 'SENS_T' }, 'both');
place('J3', manual['XHB2-2P'](), 5.5, 70, 90, { 1: 'SWH_IN', 2: 'GND' }, 'both');
part('R_SWH', 'R0603', 10, 70, 0, 'SW_HIGH', 'SWH_IN');
part('R_SWHU', 'R0603', 10, 73, 90, 'SW_HIGH', 'V3V8');
part('R_SWL', 'R0603', 12, 55, 0, 'SW_LOW', 'SWL_IN');
part('R_SWLU', 'R0603', 12, 58, 90, 'SW_LOW', 'V3V8');
part('R_PRB', 'R0603', 22, 64, 0, 'PROBE', 'PRB_IN');
part('R_PRBU', 'R0603', 27, 65, 90, 'PROBE', 'V3V8');
place('J4', manual['XHB2-2P'](), 36, 76, 0, { 1: 'TDS1_EA', 2: 'TDS1_EB' }, 'both');
place('J5', manual['XHB2-2P'](), 44, 76, 0, { 1: 'TDS2_EA', 2: 'TDS2_EB' }, 'both');
part('R_TA1', 'R0603', 52, 55, 0, 'TDS1_A', 'TDS1_EA');
part('R_TB1', 'R0603', 52, 57, 0, 'TDS1_B', 'TDS1_EB');
part('R_TA2', 'R0603', 52, 59, 0, 'TDS2_A', 'TDS2_EA');
part('R_TB2', 'R0603', 52, 61, 0, 'TDS2_B', 'TDS2_EB');
// 传感器分压/上拉
part('R_DP1', 'R0603', 31, 63, 0, 'SENS_P', 'ADC_PRESS');
part('R_DP2', 'R0603', 31, 66.5, 0, 'ADC_PRESS', 'GND');
part('C_ADC1', 'R0603', 36.5, 61, 0, 'ADC_PRESS', 'GND');
part('R_DT1', 'R0603', 29, 70, 0, 'SENS_T', 'ADC_TEMP');
part('R_DT2', 'R0603', 49, 67, 0, 'ADC_TEMP', 'GND');
part('R_TPU', 'R0603', 35, 67, 0, 'V5V0', 'SENS_T');
part('C_ADC2', 'R0603', 33, 70, 0, 'ADC_TEMP', 'GND');
// 调试 3P 排针（UART 总线串 1K）
part('R_HD1', 'R0603', 24, 70, 0, 'MCU_TXD', 'HD_TX');
part('R_HD2', 'R0603', 22, 73, 0, 'MCU_RXD', 'HD_RX');
place('J1', manual['HDR3'](), 28, 73, 0, { 1: 'HD_TX', 2: 'HD_RX', 3: 'GND' }, 'both');
// 蜂鸣器（8530 无源 + S8050 + 220Ω/0805 + 1N5819W 续流）
part('R_BB', 'R0603', 80, 64, 0, 'BEEP', 'BEEP_B');
place('Q3', manual['SOT23'](), 84, 66, 0, { 1: 'BEEP_B', 2: 'GND', 3: 'BEEP_C' }, 'bottom');
part('R_BUZ', 'R0805', 92, 62, 0, 'BEEP_V24', 'BEEP_P');
place('BUZ', manual['BUZZ-8530'](), 96, 68, 0, { 1: 'BEEP_P', 2: 'BEEP_C' }, 'bottom');
part('D76', 'SOD123', 96, 74, 0, 'BEEP_C', 'BEEP_V24');
// 测试点（背面）
place('TP1', manual['TP'](), 51, 38, 0, { 1: 'RST_MC' }, 'bottom');
place('TP2', manual['TP'](), 92, 38, 0, { 1: 'BOOT_MDU' }, 'bottom');
place('TP3', manual['TP'](), 84, 34, 0, { 1: 'RST_MDU' }, 'bottom');

// ================= 自检与组装 =================
function build() {
  const warn = [];
  const boxes = pads.filter(p => p.layer !== 'both').map(p => ({
    id: p.id, ref: p.id.slice(0, p.id.lastIndexOf('-')), l: p.layer,
    x0: p.x - p.w / 2 - 0.5, x1: p.x + p.w / 2 + 0.5,
    y0: p.y - p.h / 2 - 0.5, y1: p.y + p.h / 2 + 0.5
  }));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    const anet = pads.find(q=>q.id===a.id)?.netId, bnet = pads.find(q=>q.id===b.id)?.netId;
    if (a.l !== b.l || a.ref === b.ref || (anet && anet === bnet)) continue;
    if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) warn.push(a.id + ' × ' + b.id);
  }
  if (warn.length) console.error('⚠ 跨元件焊盘重叠 ' + warn.length + ' 对：\n  ' + warn.slice(0, 24).join('\n  '));
  const oob = pads.filter(p => p.x < 1.5 || p.x > 118.5 || p.y < 1.5 || p.y > 78.5);
  if (oob.length) console.error('⚠ 越界焊盘: ' + oob.map(p => p.id).join(', '));
  const noNet = pads.filter(p => p.netId == null);
  const byRef = {};
  for (const p of noNet) { const r = p.id.slice(0, p.id.lastIndexOf('-')); byRef[r] = (byRef[r] || 0) + 1; }
  console.log('无网（悬空）焊盘: ' + noNet.length, JSON.stringify(byRef));
  const design = {
    width: 120, height: 80, layers: 2, grid: 0.3,   // 0.15/0.15 精细规则：矩阵区通道密度翻倍
    trackW: 0.15, clearance: 0.15,   // 嘉立创精细双层（标准工艺 6mil/6mil）：显示矩阵区通道密度翻倍 viaOuter: 0.7, viaDrill: 0.35,
    copperWeight: 1,   // 1oz（0.15 线宽的工艺前提）；泵 5A 由并行铜带补足（reinforce.mjs 10 带 ≈3.9A + 峰值短时）
    nets, pads,
    keepouts: []
  };
  writeFileSync('design.json', JSON.stringify(design, null, 1));
  console.log('design.json：nets=' + nets.length + ' pads=' + pads.length + ' comps=' + comps.length);
  console.log('重叠警告: ' + warn.length + ' 对；越界: ' + oob.length);
}

function dump() {
  for (const [name, fp] of [['U5-ML307R', FP.U5], ['CON2-SIM114', FP.CON2], ['X1-IPEX', FP.X1], ['U2-LM2596', FP.U2], ['U3-RU3030', FP.U3], ['U7-TM1640', FP.U7]]) {
    console.log('== ' + name + ' ==');
    for (const p of fp.pads) console.log('  ' + String(p.num).padStart(3), `${p.shape} ${p.x},${p.y} ${p.w}x${p.h} L=${p.layer}`);
  }
}

if (mode === 'dump') dump(); else build();
