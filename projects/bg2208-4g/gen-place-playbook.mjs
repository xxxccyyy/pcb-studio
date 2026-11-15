// BG2208-4G 原理图放置 playbook 生成器：按功能区分区摆放全部器件
// 用法：node gen-place-playbook.mjs → place-playbook.json
import { readFileSync, writeFileSync } from 'node:fs';

const lib = {
  ...JSON.parse(readFileSync('devices-lib.json', 'utf8')),
  ...JSON.parse(readFileSync('passives-lib.json', 'utf8'))
};
const ALIAS = { Q4: 'Q2', Q3: 'Q2', Q2: 'Q2', D_LM: 'D73', D75: 'D74', U4: 'U3', J5: 'J4' };
const pickOf = k => {
  const e = lib[ALIAS[k] || k];
  if (!e || !e.picks || !e.picks[0]) throw new Error('库身份缺失: ' + k);
  const p = e.picks[0];
  if (!p.libraryUuid || !p.uuid) throw new Error('库身份不完整: ' + k + ' ' + JSON.stringify(p).slice(0, 80));
  return { libraryUuid: p.libraryUuid, uuid: p.uuid, name: p.name, fp: p.footprintName };
};
const passive = k => {
  const e = lib[k];
  if (!e || !e.uuid) throw new Error('无源库身份缺失: ' + k + ' ' + JSON.stringify(e).slice(0, 80));
  return { libraryUuid: e.libraryUuid, uuid: e.uuid, name: e.name, fp: e.footprintName };
};

const steps = [];
let sn = 0;
const id = () => 'p' + (++sn);
function place(ref, ident, x, y, note) {
  steps.push({
    id: id(), name: `${ref} ${ident.name} @(${x},${y})` + (note ? ' ' + note : ''),
    action: 'schematic.component.place',
    payload: { libraryUuid: ident.libraryUuid, uuid: ident.uuid, x, y, designatorHint: ref }
  });
}

// ---- 电源区（左上）----
// —— 实际放置清单（devices-lib keys）：U5,U6,U7,U3,U1,U8,Q1,Q2,D73,D74,D76,CON1,J2,J3,J4,J1,CON2,X1,BUZ,F1 + passives ——
// U2 LM2596 与 L2/D_LM/C63/C64 未在 devices-lib（漏检）——补检 LM2596 在生成器外先跑

const Z = {
  power: { x: 150, y: 120 },
  module: { x: 780, y: 120 },
  mcu: { x: 480, y: 360 },
  display: { x: 760, y: 380 },
  actuator: { x: 150, y: 420 },
  sensor: { x: 480, y: 560 },
  connector: { x: 120, y: 560 },
  buzzer: { x: 860, y: 560 },
  led: { x: 700, y: 420 }
};

// IC / 三极管 / 二极管 / 连接器（devices-lib.json）
const icOrder = [
  ['U5', 'module'], ['X1', 'module'], ['CON2', 'module'],
  ['U6', 'mcu'],
  ['U7', 'display'],
  ['U1', 'power'], ['U8', 'power'],
  ['Q1', 'module'], ['Q2', 'module'], ['Q4', 'module'],
  ['Q3', 'buzzer'],
  ['U3', 'actuator'], ['U4', 'actuator'],
  ['D73', 'power'], ['D74', 'actuator'], ['D75', 'actuator'], ['D76', 'buzzer'],
  ['CON1', 'connector'], ['J2', 'sensor'], ['J3', 'sensor'], ['J4', 'connector'], ['J5', 'connector'],
  ['J1', 'connector'], ['BUZ', 'buzzer'], ['F1', 'power']
];
const zoneCursor = {};
for (const [ref, zone] of icOrder) {
  const z = Z[zone], k = zone;
  zoneCursor[k] = (zoneCursor[k] || 0) + 1;
  const x = z.x + (zoneCursor[k] - 1) % 3 * 220;
  const y = z.y + Math.floor((zoneCursor[k] - 1) / 3) * 140;
  place(ref, pickOf(ref), x, y);
}

// 无源器件按值放（围绕各自功能区）
const passiveOrder = [
  // 电源区
  ['R_FU', 'R10K', 'power'], ['R_FD', 'R10K', 'power'], ['R_FU2', 'R10K', 'power'], ['R_FD2', 'R10K', 'power'],
  ['R_EN1', 'R10K', 'power'], ['R_EN2', 'R10K', 'power'],
  ['L2', 'L33U', 'power'], ['L1', 'L6U8', 'power'],
  ['C_BST', 'C100N', 'power'], ['C61', 'C100N', 'power'], ['C62', 'C10U50', 'power'], ['C63', 'SVP220', 'power'],
  ['C71', 'C10U50', 'power'], ['C72', 'C10U50', 'power'], ['C73', 'C22U', 'power'], ['C74', 'C22U', 'power'],
  ['C81', 'C100N', 'power'], ['C82', 'C100N', 'power'], ['C83', 'C10U', 'power'],
  ['C21', 'TANT220', 'module'], ['C22', 'TANT220', 'module'], ['C23', 'C10U', 'module'], ['C24', 'C100N', 'module'], ['C25', 'C33P', 'module'],
  ['FB1', 'R10K', 'module'], ['R_PWR', 'R1K', 'module'], ['C_PWR', 'C33P', 'module'], ['R_NL1', 'R1K', 'module'], ['R_NL2', 'R1K', 'module'],
  // MCU 区
  ['C41', 'C100N', 'mcu'], ['C42', 'C10U', 'mcu'], ['R_RST', 'R10K', 'mcu'], ['C51', 'C1U', 'mcu'], ['C52', 'C10U', 'mcu'],
  // 模块信号区
  ['R_DIV1', 'R1K', 'module'], ['R_DIV2', 'R910', 'module'], ['R_B1', 'R1K', 'module'], ['R_C1', 'R10K', 'module'],
  ['R_DET', 'R10K', 'module'],
  ['R_SIM1', 'R10', 'module'], ['R_SIM2', 'R10', 'module'], ['R_SIM3', 'R10', 'module'], ['R_SIM4', 'R10', 'module'],
  ['C31', 'C33P', 'module'], ['C32', 'C33P', 'module'], ['C33', 'C33P', 'module'], ['C34', 'C33P', 'module'], ['C35', 'C1U', 'module'],
  // 执行器区
  ['R_GP', 'R10', 'actuator'], ['R_PD1', 'R100K', 'actuator'], ['R_GV', 'R10', 'actuator'], ['R_PDV', 'R100K', 'actuator'],
  ['R_SWH', 'R1K', 'sensor'], ['R_SWHU', 'R10K', 'sensor'], ['R_SWL', 'R1K', 'sensor'], ['R_SWLU', 'R10K', 'sensor'],
  ['R_PRB', 'R1K', 'sensor'], ['R_PRBU', 'R10K', 'sensor'],
  // 传感器区
  ['R_DP1', 'R10K', 'sensor'], ['R_DP2', 'R10K', 'sensor'], ['C_ADC1', 'C100N', 'sensor'],
  ['R_DT1', 'R10K', 'sensor'], ['R_DT2', 'R10K', 'sensor'], ['R_TPU', 'R10K', 'sensor'], ['C_ADC2', 'C100N', 'sensor'],
  // 调试/蜂鸣器
  ['R_HD1', 'R1K', 'connector'], ['R_HD2', 'R1K', 'connector'],
  ['R_BB', 'R1K', 'buzzer'], ['R_BUZ', 'R220', 'buzzer'],
  ['C64', 'RAD470', 'power'], ['D_LM', 'D73', 'power']
];
for (const [ref, valKey, zone] of passiveOrder) {
  const z = Z[zone], k = zone + 'p';
  zoneCursor[k] = (zoneCursor[k] || 0) + 1;
  const x = z.x + (zoneCursor[k] - 1) % 4 * 90;
  const y = z.y + Math.floor((zoneCursor[k] - 1) / 4) * 70;
  const ident = (ref === 'D_LM') ? pickOf('D73') : passive(valKey);
  place(ref, ident, x, y);
}

// ---- LED 阵列（73 颗 0603：D1-D72 数码段位 + D77 网络灯）----
{
  let dn = 0;
  const z = Z.led;
  for (let d = 0; d < 8; d++) for (let s = 0; s < 8; s++) {
    const x = z.x + d * 55, y = z.y + s * 45;
    place('D' + (++dn), passive('LED0603'), x, y);
  }
  for (let n = 0; n < 8; n++) {
    const x = z.x + n * 55, y = z.y + 8 * 45;
    place('D' + (++dn), passive('LED0603'), x, y);
  }
  place('D77', passive('LED0603'), 1100, 120);
}

// 保存
const playbook = {
  version: 1,
  meta: { name: 'bg2208-place-all' },
  defaults: { timeoutSec: 60, continueOnError: false },
  steps
};
writeFileSync('place-playbook.json', JSON.stringify(playbook, null, 1));
console.log('place playbook:', steps.length, '步');
