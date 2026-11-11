// 第三轮批量 spec 生成：N1-N12 全部一次性生成
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const mA = html.match(new RegExp('// ==== ROUTER CORE START ====([\\s\\S]*?)// ==== ROUTER CORE END ===='));
const mB = html.match(new RegExp('// ==== EXAMPLES START ====([\\s\\S]*?)// ==== EXAMPLES END ===='));
const core = new Function(mA[1] + '\n' + mB[1] + '\nreturn {footprintPads, designDefaults};')();
const base = new URL('./', import.meta.url);
const fp603 = core.footprintPads('0603');
const fp805 = core.footprintPads('0805');

function makeDesign(name, opts) {
  const d = core.designDefaults();
  Object.assign(d, { width: 40, height: 25, grid: 0.6, trackW: 0.4, clearance: 0.2, viaOuter: 0.8, viaDrill: 0.4, ...opts });
  d.nets = opts.nets;
  const pads = [];
  const add = (c, p, n, x, y, w, h, shape, layer, holeR) =>
    pads.push({ id: `${c}-${p}`, netId: n, x: +x.toFixed(4), y: +y.toFixed(4), w, h, shape: shape || 'rect', layer: layer || 'top', holeR });
  const place = (comp, fp, cx, cy, netOf, layerOf) => {
    fp.forEach((f, i) => add(comp, i + 1, netOf(i + 1), cx + f.dx, cy + f.dy, f.w, f.h, f.shape, layerOf ? layerOf(i + 1) : f.layer, f.holeR));
  };
  const comps = {};
  return { d, pads, add, place, comps, save(subdir) {
    d.pads = pads;
    d.comps = comps;
    const dir = new URL(subdir + '/', base);
    mkdirSync(dir, { recursive: true });
    writeFileSync(new URL(subdir + '/design.json', base), JSON.stringify(d, null, 1));
    console.log(name + ':', pads.length, 'pads /', d.nets.length, 'nets');
  }};
}

// ===== N1: 光耦隔离板（2× PC817 DIP-4 + 排针）=====
{
  const { d, pads, add, save } = makeDesign('N1 光耦隔离板', {
    nets: [{ id: 'v5', name: '5V' }, { id: 'gnd', name: 'GND' },
           { id: 'sig_in', name: 'SIG_IN' }, { id: 'sig_out', name: 'SIG_OUT' },
           { id: 'iso_v', name: 'ISO_V' }, { id: 'iso_g', name: 'ISO_G' }]
  });
  // PC817 DIP-4: 1=阳极 2=阴极 3=发射极 4=集电极
  [[6, 8], [18, 8]].forEach(([x, y], ch) => {
    const anode = ch === 0 ? 'sig_in' : 'sig_out';
    const em = ch === 0 ? 'iso_g' : 'iso_g';
    const col = ch === 0 ? 'iso_v' : 'iso_v';
    add('OC' + (ch + 1), 1, anode, x, y, 1.2, 1.2, 'circle', 'both', 0.35);
    add('OC' + (ch + 1), 2, 'gnd', x + 2.54, y, 1.2, 1.2, 'circle', 'both', 0.35);
    add('OC' + (ch + 1), 3, em, x + 2.54, y + 3.5, 1.2, 1.2, 'circle', 'both', 0.35);
    add('OC' + (ch + 1), 4, col, x, y + 3.5, 1.2, 1.2, 'circle', 'both', 0.35);
  });
  add('J1', 1, 'sig_in', 2, 5, 1.7, 1.7, 'circle', 'both', 0.45);
  add('J1', 2, 'gnd', 2, 7.54, 1.7, 1.7, 'circle', 'both', 0.45);
  add('J2', 1, 'iso_v', 38, 5, 1.7, 1.7, 'circle', 'both', 0.45);
  add('J2', 2, 'iso_g', 38, 7.54, 1.7, 1.7, 'circle', 'both', 0.45);
  d.comps = { OC1: {x:6,y:8,rot:0,layer:'top',value:'PC817',footprint:'DIP-4'},
              OC2: {x:18,y:8,rot:0,layer:'top',value:'PC817',footprint:'DIP-4'},
              J1: {x:2,y:6.3,rot:90,layer:'top',value:'IN',footprint:'HDR-2P'},
              J2: {x:38,y:6.3,rot:90,layer:'top',value:'ISO',footprint:'HDR-2P'} };
  save('n1-optocoupler');
}

// ===== N2: CR2032 电池扣板（极简 LED）=====
{
  const { d, pads, add, save } = makeDesign('N2 电池扣板', {
    nets: [{ id: 'bat', name: 'BAT+3V' }, { id: 'gnd', name: 'GND' }]
  });
  add('BAT1', 1, 'bat', 10, 10, 2, 2, 'circle', 'both', 0.5);
  add('BAT1', 2, 'gnd', 10, 15, 2, 2, 'circle', 'both', 0.5);
  add('R1', 1, 'bat', 18, 8, 0.9, 0.8);
  add('R1', 2, 'led_n', 18, 11, 0.9, 0.8);
  add('LED1', 1, 'led_n', 24, 8, 0.9, 0.8);
  add('LED1', 2, 'gnd', 24, 11, 0.9, 0.8);
  d.nets.push({ id: 'led_n', name: 'LED_N' });
  d.comps = { BAT1: {x:10,y:12.5,rot:0,layer:'top',value:'CR2032',footprint:'BAT-CR2032'},
              R1: {x:18,y:9.5,rot:0,layer:'top',value:'100R',footprint:'R0603'},
              LED1: {x:24,y:9.5,rot:0,layer:'top',value:'LED',footprint:'LED0603'} };
  save('n2-battery');
}

// ===== N3: 拨码开关板（4 位拨码 + 4 上拉 + 排针）=====
{
  const nets = [{ id: 'vcc', name: 'VCC' }, { id: 'gnd', name: 'GND' }];
  for (let i = 0; i < 4; i++) nets.push({ id: 'sw' + i, name: 'SW' + i });
  const { d, pads, add, save } = makeDesign('N3 拨码开关板', { nets });
  // 4 位拨码开关（每路 2 焊盘，公用端接 GND）
  for (let i = 0; i < 4; i++) {
    add('SW1', i * 2 + 1, 'sw' + i, 6 + i * 2.54, 8, 1.2, 1.2);
    add('SW1', i * 2 + 2, 'gnd', 6 + i * 2.54, 12, 1.2, 1.2);
    add('R' + (i + 1), 1, 'sw' + i, 6 + i * 2.54, 4, 0.9, 0.8);
    add('R' + (i + 1), 2, 'vcc', 6 + i * 2.54, 2, 0.9, 0.8);
    add('J1', i + 1, 'sw' + i, 18 + i * 2.54, 20, 1.2, 1.2, 'circle', 'both', 0.35);
  }
  add('J1', 5, 'vcc', 18, 22.5, 1.2, 1.2, 'circle', 'both', 0.35);
  d.comps = { SW1: {x:10.6,y:10,rot:0,layer:'top',value:'DIP-4',footprint:'DIP-4'},
              R1: {x:6,y:3,rot:0,layer:'top',value:'10k',footprint:'R0603'},
              R2: {x:8.5,y:3,rot:0,layer:'top',value:'10k',footprint:'R0603'},
              R3: {x:11,y:3,rot:0,layer:'top',value:'10k',footprint:'R0603'},
              R4: {x:13.5,y:3,rot:0,layer:'top',value:'10k',footprint:'R0603'},
              J1: {x:22.3,y:16.3,rot:90,layer:'top',value:'OUT',footprint:'HDR-5P'} };
  save('n3-dipswitch');
}

// ===== N4: NE555 可调定时器（DIP-8 + 电位器 + RC 网络）=====
{
  const { d, pads, add, save } = makeDesign('N4 NE555 可调定时器', {
    width: 45, height: 25,
    nets: [{ id: 'vcc', name: 'VCC' }, { id: 'gnd', name: 'GND' },
           { id: 'thr', name: 'THR' }, { id: 'trig', name: 'TRIG' },
           { id: 'cv', name: 'CV' }, { id: 'out', name: 'OUT' }]
  });
  // U1 NE555 DIP-8: 1 GND 2 TRIG 3 OUT 4 RST 5 CV 6 THR 7 DIS 8 VCC
  [[1,'gnd'],[2,'trig'],[3,'out'],[4,'vcc'],[5,'cv'],[6,'thr'],[7,'thr'],[8,'vcc']].forEach(([p,n],i) => {
    const row = i < 4 ? 0 : 1;
    const col = i % 4;
    add('U1', p, n, 12 + col * 2.54, 8 + row * 3.5, 1.2, 1.2, 'circle', 'both', 0.35);
  });
  // 电位器（3 焊盘）
  add('RV1', 1, 'thr', 22, 6, 1.2, 1.2, 'circle', 'both', 0.35);
  add('RV1', 2, 'gnd', 26, 6, 1.2, 1.2, 'circle', 'both', 0.35);
  add('RV1', 3, 'thr', 24, 10, 1.2, 1.2, 'circle', 'both', 0.35);
  // C1 定时电容
  add('C1', 1, 'thr', 22, 16, 0.9, 0.8);
  add('C1', 2, 'gnd', 24, 16, 0.9, 0.8);
  // J1 输出
  add('J1', 1, 'out', 35, 6, 1.7, 1.7, 'circle', 'both', 0.45);
  add('J1', 2, 'gnd', 35, 8.54, 1.7, 1.7, 'circle', 'both', 0.45);
  add('J1', 3, 'vcc', 35, 11.08, 1.7, 1.7, 'circle', 'both', 0.45);
  d.comps = { U1: {x:15,y:9.75,rot:0,layer:'top',value:'NE555',footprint:'DIP-8'},
              RV1: {x:24,y:8,rot:0,layer:'top',value:'100k POT',footprint:'POT-3P'},
              C1: {x:23,y:16,rot:0,layer:'top',value:'10uF',footprint:'C0603'},
              J1: {x:35,y:8.8,rot:90,layer:'top',value:'OUT',footprint:'HDR-3P'} };
  save('n4-ne555');
}

// ===== N5: LM7805+7905 双电源板 =====
{
  const { d, pads, add, save } = makeDesign('N5 双电源板', {
    width: 45, height: 22,
    nets: [{ id: 'vin', name: 'VIN' }, { id: 'gnd', name: 'GND' },
           { id: 'v5', name: '+5V' }, { id: 'vn5', name: '-5V' }]
  });
  // U1 LM7805 TO-220（3 pin: IN GND OUT）
  [['U1', 'vin', 'gnd', 'v5', 12, 6], ['U2', 'gnd', 'vin', 'vn5', 12, 16]].forEach(([c, p1, p2, p3, x, y]) => {
    add(c, 1, p1, x, y, 1.5, 1.5, 'circle', 'both', 0.5);
    add(c, 2, p2, x + 2.54, y, 1.5, 1.5, 'circle', 'both', 0.5);
    add(c, 3, p3, x + 5.08, y, 1.5, 1.5, 'circle', 'both', 0.5);
  });
  // C_in ×2, C_out ×2
  [[8, 6, 'vin', 'gnd'], [8, 16, 'vin', 'gnd'], [22, 6, 'v5', 'gnd'], [22, 16, 'vn5', 'gnd']].forEach(([x, y, n1, n2], i) => {
    add('C' + (i + 1), 1, n1, x, y, 1.15, 0.95);
    add('C' + (i + 1), 2, n2, x + 1.6, y, 1.15, 0.95);
  });
  // J1 AC input, J2 ±5V output
  add('J1', 1, 'vin', 2, 11, 1.7, 1.7, 'circle', 'both', 0.45);
  add('J1', 2, 'gnd', 2, 13.54, 1.7, 1.7, 'circle', 'both', 0.45);
  add('J2', 1, 'v5', 42, 8, 1.7, 1.7, 'circle', 'both', 0.45);
  add('J2', 2, 'gnd', 42, 11, 1.7, 1.7, 'circle', 'both', 0.45);
  add('J2', 3, 'vn5', 42, 14, 1.7, 1.7, 'circle', 'both', 0.45);
  d.comps = { U1: {x:14,y:6,rot:0,layer:'top',value:'LM7805',footprint:'TO-220'},
              U2: {x:14,y:16,rot:0,layer:'top',value:'LM7905',footprint:'TO-220'},
              J1: {x:2,y:12.3,rot:90,layer:'top',value:'AC-IN',footprint:'HDR-2P'},
              J2: {x:42,y:11,rot:90,layer:'top',value:'DC-OUT',footprint:'HDR-3P'} };
  save('n5-dual-supply');
}

// ===== N6: ULN2003 达林顿驱动板（DIP-16 + 7 路输出）=====
{
  const nets = [{ id: 'v5', name: '5V' }, { id: 'gnd', name: 'GND' }];
  for (let i = 1; i <= 7; i++) nets.push({ id: 'in' + i, name: 'IN' + i });
  for (let i = 1; i <= 7; i++) nets.push({ id: 'out' + i, name: 'OUT' + i });
  const { d, pads, add, save } = makeDesign('N6 ULN2003 驱动板', {
    width: 50, height: 25, nets
  });
  // U1 ULN2003 DIP-16: 1-7 IN, 8 GND, 9 COM, 10-16 OUT
  for (let i = 1; i <= 7; i++) {
    const row = (i - 1) % 2, col = Math.floor((i - 1) / 2);
    add('U1', i, 'in' + i, 10 + col * 2.54, 8 + row * 3.5, 1.2, 1.2, 'circle', 'both', 0.35);
  }
  add('U1', 8, 'gnd', 10 + 3 * 2.54, 11.5, 1.2, 1.2, 'circle', 'both', 0.35);
  add('U1', 9, 'v5', 10 + 0 * 2.54, 15, 1.2, 1.2, 'circle', 'both', 0.35);
  for (let i = 1; i <= 7; i++) {
    const row = (i - 1) % 2, col = Math.floor((i - 1) / 2);
    add('U1', 16 - (i - 1), 'out' + i, 10 + col * 2.54, 15 - row * 3.5, 1.2, 1.2, 'circle', 'both', 0.35);
  }
  // 7 路输出排针
  for (let i = 1; i <= 7; i++) {
    add('J1', i, 'in' + i, 2, 4 + i * 2, 1.2, 1.2, 'circle', 'both', 0.35);
    add('J2', i, 'out' + i, 48, 4 + i * 2, 1.2, 1.2, 'circle', 'both', 0.35);
  }
  d.comps = { U1: {x:14.3,y:11.5,rot:0,layer:'top',value:'ULN2003',footprint:'DIP-16'},
              J1: {x:2,y:11,rot:90,layer:'top',value:'IN',footprint:'HDR-7P'},
              J2: {x:48,y:11,rot:90,layer:'top',value:'OUT',footprint:'HDR-7P'} };
  save('n6-uln2003');
}

console.log('Batch 1 (N1-N6) specs generated');
