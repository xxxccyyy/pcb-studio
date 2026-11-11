// 第四轮批量 spec 生成：N13-N32（20 项目，4 档，全部新设计维度）
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
  const add = (c, p, n, x, y, w, h, shape, layer, holeR) =>
    pads.push({ id: `${c}-${p}`, netId: n, x: +x.toFixed(4), y: +y.toFixed(4), w, h, shape: shape || 'rect', layer: layer || 'top', holeR });
  const place = (comp, fp, cx, cy, netOf, layerOf) => {
    fp.forEach((f, i) => add(comp, i + 1, netOf(i + 1), cx + f.dx, cy + f.dy, f.w, f.h, f.shape, layerOf ? layerOf(i + 1) : f.layer, f.holeR));
  };
  return { d, pads, add, place, save(subdir, comps) {
    d.pads = pads;
    d.comps = comps || {};
    const dir = new URL(subdir + '/', base);
    mkdirSync(dir, { recursive: true });
    writeFileSync(new URL(subdir + '/design.json', base), JSON.stringify(d, null, 1));
    console.log(name + ':', pads.length, 'pads /', d.nets.length, 'nets');
  }};
}
const mk = n => core.footprintPads(n);

// ===== N13: PWM MOSFET 电机驱动（TO-220 + 排针）=====
{
  const { d, pads, add, save } = makeDesign('N13 PWM MOSFET 电机驱动', {
    width: 40, height: 25,
    nets: [{ id: 'vcc', name: 'VCC' }, { id: 'gnd', name: 'GND' },
           { id: 'pwm', name: 'PWM' }, { id: 'motor', name: 'MOTOR' }]
  });
  // Q1 IRLZ44N TO-220（G D S）→ 电机 → GND
  add('Q1', 1, 'pwm', 12, 8, 1.5, 1.5, 'circle', 'both', 0.5);
  add('Q1', 2, 'motor', 15, 8, 1.5, 1.5, 'circle', 'both', 0.5);
  add('Q1', 3, 'gnd', 18, 8, 1.5, 1.5, 'circle', 'both', 0.5);
  // R1 栅极电阻
  const fp603 = core.footprintPads('0603');
  [[1,'pwm'],[2,'pwm']].forEach(([p,n],i) =>
    add('R1', p, n, 8+i*1.6, 8, 0.9, 0.8));
  // M1 电机连接
  add('M1', 1, 'vcc', 30, 6, 1.7, 1.7, 'circle', 'both', 0.45);
  add('M1', 2, 'motor', 30, 10, 1.7, 1.7, 'circle', 'both', 0.45);
  // J1 控制
  add('J1', 1, 'pwm', 2, 8, 1.7, 1.7, 'circle', 'both', 0.45);
  add('J1', 2, 'gnd', 2, 11, 1.7, 1.7, 'circle', 'both', 0.45);
  add('J1', 3, 'vcc', 2, 14, 1.7, 1.7, 'circle', 'both', 0.45);
  d.comps = { Q1:{x:15,y:8,rot:0,layer:'top',value:'IRLZ44N',footprint:'TO-220'},
              R1:{x:8.8,y:8,rot:0,layer:'top',value:'100R',footprint:'R0603'},
              M1:{x:30,y:8,rot:90,layer:'top',value:'MOTOR',footprint:'HDR-2P'},
              J1:{x:2,y:11,rot:90,layer:'top',value:'CTRL',footprint:'HDR-3P'} };
  save('n13-mosfet-motor');
}

// ===== N14: HT12E/HT12D 编解码配对板（2× DIP-18）=====
{
  const nets = [{ id: 'vcc', name: 'VCC' }, { id: 'gnd', name: 'GND' }];
  for (let i = 0; i < 4; i++) nets.push({ id: 'ad' + i, name: 'AD' + i });
  nets.push({ id: 'data', name: 'DATA' });
  const { d, pads, add, save } = makeDesign('N14 HT12E/D 编解码板', {
    width: 55, height: 25, nets
  });
  // HT12E DIP-18 左侧，HT12D DIP-18 右侧，数据线直连
  for (let i = 0; i < 9; i++) {
    add('U1', i + 1, i === 0 ? 'gnd' : (i === 8 ? 'vcc' : 'ad' + (i - 1)), 10, 8 + i * 2, 1.2, 1.2, 'circle', 'both', 0.35);
    add('U1', i + 10, i === 0 ? 'data' : (i === 8 ? 'gnd' : null), 10 + 7.62, 8 + i * 2, 1.2, 1.2, 'circle', 'both', 0.35);
  }
  for (let i = 0; i < 9; i++) {
    add('U2', i + 1, i === 0 ? 'gnd' : (i === 8 ? 'vcc' : 'ad' + (i - 1)), 40, 8 + i * 2, 1.2, 1.2, 'circle', 'both', 0.35);
    add('U2', i + 10, i === 0 ? 'data' : (i === 8 ? 'gnd' : null), 40 + 7.62, 8 + i * 2, 1.2, 1.2, 'circle', 'both', 0.35);
  }
  d.comps = { U1:{x:13.8,y:16,rot:0,layer:'top',value:'HT12E',footprint:'DIP-18'},
              U2:{x:43.8,y:16,rot:0,layer:'top',value:'HT12D',footprint:'DIP-18'} };
  save('n14-ht12');
}

// ===== N15: LCD1602 接口板（16 引脚连接器 + 电位器）=====
{
  const nets = [{ id: 'vcc', name: 'VCC' }, { id: 'gnd', name: 'GND' }];
  for (let i = 0; i < 8; i++) nets.push({ id: 'db' + i, name: 'DB' + i });
  nets.push({ id: 'rs', name: 'RS' }, { id: 'en', name: 'EN' }, { id: 'contrast', name: 'CONTRAST' });
  const { d, pads, add, save } = makeDesign('N15 LCD1602 接口板', {
    width: 50, height: 25, nets
  });
  // LCD1602 16 pin 连接器
  const lcdNets = ['gnd','vcc','contrast','rs',null,null,null,null,'db0','db1','db2','db3','db4','db5','db6','db7'];
  lcdNets.forEach((n, i) => add('LCD1', i + 1, n, 5 + i * 2.54, 5, 1.5, 1.5, 'circle', 'both', 0.45));
  // 对比度电位器
  add('RV1', 1, 'contrast', 15, 15, 1.2, 1.2, 'circle', 'both', 0.35);
  add('RV1', 2, 'vcc', 18, 15, 1.2, 1.2, 'circle', 'both', 0.35);
  add('RV1', 3, 'gnd', 21, 15, 1.2, 1.2, 'circle', 'both', 0.35);
  // J1 MCU 接口（8 数据 + RS + EN）
  ['db0','db1','db2','db3','db4','db5','db6','db7','rs','en'].forEach((n, i) =>
    add('J1', i + 1, n, 40, 4 + i * 2, 1.2, 1.2, 'circle', 'both', 0.35));
  d.comps = { LCD1:{x:22.5,y:5,rot:0,layer:'top',value:'LCD1602',footprint:'HDR-16P'},
              RV1:{x:18,y:15,rot:0,layer:'top',value:'10k POT',footprint:'POT-3P'},
              J1:{x:40,y:22,rot:90,layer:'top',value:'MCU',footprint:'HDR-10P'} };
  save('n15-lcd1602');
}

// ===== N16: WS2812 环形 8 灯（环形串行链）=====
{
  const nets = [{ id: 'v5', name: '5V' }, { id: 'gnd', name: 'GND' }, { id: 'din', name: 'DIN' }];
  for (let i = 1; i < 8; i++) nets.push({ id: 'd' + i, name: 'D' + i });
  const { d, pads, add, save } = makeDesign('N16 WS2812 环形 8 灯', {
    width: 50, height: 50, nets
  });
  // 8× WS2812 环形排列（半径 15mm，中心 25,25）
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const x = 25 + Math.cos(angle) * 15;
    const y = 25 + Math.sin(angle) * 15;
    const din = i === 0 ? 'din' : ('d' + i);
    const dout = i === 7 ? null : ('d' + (i + 1));
    add('WS' + (i + 1), 1, 'v5', x - 2.5, y - 2, 1.2, 1.2);
    add('WS' + (i + 1), 2, dout, x - 2.5, y + 2, 1.2, 1.2);
    add('WS' + (i + 1), 3, 'gnd', x + 2.5, y + 2, 1.2, 1.2);
    add('WS' + (i + 1), 4, din, x + 2.5, y - 2, 1.2, 1.2);
  }
  add('J1', 1, 'v5', 25, 2, 1.7, 1.7, 'circle', 'both', 0.45);
  add('J1', 2, 'gnd', 28, 2, 1.7, 1.7, 'circle', 'both', 0.45);
  add('J1', 3, 'din', 22, 2, 1.7, 1.7, 'circle', 'both', 0.45);
  d.comps = { J1:{x:25,y:2,rot:0,layer:'top',value:'IN',footprint:'HDR-3P'} };
  for (let i = 0; i < 8; i++) d.comps['WS'+(i+1)] = {x:25+Math.cos((i/8)*Math.PI*2-Math.PI/2)*15, y:25+Math.sin((i/8)*Math.PI*2-Math.PI/2)*15, rot:0, layer:'top', value:'WS2812B', footprint:'WS2812-5050'};
  save('n16-ws2812-ring');
}

// ===== N17: 继电器驱动板（继电器 + 光耦 + 三极管 + 续流二极管）=====
{
  const { d, pads, add, save } = makeDesign('N17 继电器驱动板', {
    width: 45, height: 25,
    nets: [{ id: 'v5', name: '5V' }, { id: 'gnd', name: 'GND' },
           { id: 'ctrl', name: 'CTRL' }, { id: 'coil', name: 'COIL' },
           { id: 'com', name: 'COM' }, { id: 'no', name: 'NO' }]
  });
  // K1 继电器（4 pin: 线圈×2 + COM + NO）
  add('K1', 1, 'coil', 8, 6, 1.5, 1.5, 'circle', 'both', 0.5);
  add('K1', 2, 'gnd', 8, 12, 1.5, 1.5, 'circle', 'both', 0.5);
  add('K1', 3, 'com', 14, 6, 1.5, 1.5, 'circle', 'both', 0.5);
  add('K1', 4, 'no', 14, 12, 1.5, 1.5, 'circle', 'both', 0.5);
  // D1 续流二极管
  add('D1', 1, 'coil', 11, 6, 0.9, 0.8);
  add('D1', 2, 'gnd', 11, 9, 0.9, 0.8);
  // Q1 NPN 驱动
  add('Q1', 1, 'ctrl', 5, 8, 0.9, 0.8);
  add('Q1', 2, 'gnd', 5, 11, 0.9, 0.8);
  add('Q1', 3, 'coil', 5, 14, 0.9, 0.8);
  // R1 基极电阻
  add('R1', 1, 'ctrl', 2, 8, 0.9, 0.8);
  add('R1', 2, 'ctrl', 3.5, 8, 0.9, 0.8);
  // J1 控制信号
  add('J1', 1, 'ctrl', 2, 18, 1.7, 1.7, 'circle', 'both', 0.45);
  add('J1', 2, 'gnd', 2, 20.54, 1.7, 1.7, 'circle', 'both', 0.45);
  d.comps = { K1:{x:11,y:9,rot:0,layer:'top',value:'RELAY-SPDT',footprint:'RELAY-SPDT'},
              D1:{x:11,y:7.5,rot:0,layer:'top',value:'1N4148',footprint:'R0603'},
              Q1:{x:5,y:11,rot:0,layer:'top',value:'2N2222',footprint:'SOT-23'},
              R1:{x:2.75,y:8,rot:0,layer:'top',value:'1k',footprint:'R0603'},
              J1:{x:2,y:19.3,rot:90,layer:'top',value:'CTRL',footprint:'HDR-2P'} };
  save('n17-relay');
}

// ===== N18: 精密模拟前端（运放×2 + 精密电阻 + 保护二极管）=====
{
  const { d, pads, add, place, save } = makeDesign('N18 精密模拟前端', {
    width: 55, height: 30,
    nets: [{ id: 'vcc', name: 'VCC' }, { id: 'gnd', name: 'GND' },
           { id: 'in', name: 'VIN' }, { id: 'buf', name: 'BUF' },
           { id: 'filt', name: 'FILT' }, { id: 'out', name: 'VOUT' }]
  });
  const fp603 = core.footprintPads('0603');
  // U1 缓冲运放 SOIC-8（同相跟随器）
  place('U1', core.footprintPads('SOIC-8'), 15, 15, pin => ({
    1: 'buf', 2: 'buf', 3: 'in', 4: 'gnd', 8: 'vcc'
  }[pin] || null));
  // U2 滤波放大 SOIC-8（Sallen-Key 低通）
  place('U2', core.footprintPads('SOIC-8'), 35, 15, pin => ({
    1: 'out', 2: 'filt', 3: 'filt', 4: 'gnd', 8: 'vcc'
  }[pin] || null));
  // R1 保护电阻 + R2 反馈
  place('R1', fp603.map(f=>({...f})), 8, 15, i=>i===1?'in':'buf');
  // R3/R4 Sallen-Key 滤波
  place('R3', fp603.map(f=>({...f})), 24, 10, i=>i===1?'buf':'filt');
  place('R4', fp603.map(f=>({...f})), 28, 10, i=>i===1?'filt':'filt');
  // C1/C2 滤波电容
  place('C1', fp603.map(f=>({...f})), 26, 20, i=>i===1?'filt':'gnd');
  place('C2', fp603.map(f=>({...f})), 31, 20, i=>i===1?'filt':'gnd');
  // J1 输入 / J2 输出
  add('J1', 1, 'in', 2, 15, 1.7, 1.7, 'circle', 'both', 0.45);
  add('J2', 1, 'out', 52, 15, 1.7, 1.7, 'circle', 'both', 0.45);
  d.comps = { U1:{x:15,y:15,rot:0,layer:'top',value:'OPA2277',footprint:'SOIC-8'},
              U2:{x:35,y:15,rot:0,layer:'top',value:'OPA2277',footprint:'SOIC-8'},
              R1:{x:9.6,y:15,rot:0,layer:'top',value:'1k',footprint:'R0603'},
              R3:{x:24,y:10,rot:0,layer:'top',value:'10k',footprint:'R0603'},
              R4:{x:28,y:10,rot:0,layer:'top',value:'10k',footprint:'R0603'},
              C1:{x:26,y:20,rot:0,layer:'top',value:'1nF',footprint:'C0603'},
              C2:{x:31,y:20,rot:0,layer:'top',value:'1nF',footprint:'C0603'},
              J1:{x:2,y:15,rot:90,layer:'top',value:'IN',footprint:'HDR-1P'},
              J2:{x:52,y:15,rot:90,layer:'top',value:'OUT',footprint:'HDR-1P'} };
  save('n18-analog-front');
}

// ===== N19: 7 段数码管驱动板（2× 74HC595 + 4× 7SEG）=====
{
  const nets = [{ id: 'vcc', name: 'VCC' }, { id: 'gnd', name: 'GND' },
    { id: 'sck', name: 'SCK' }, { id: 'mosi', name: 'MOSI' }, { id: 'rclk', name: 'RCLK' }];
  for (let i = 0; i < 8; i++) nets.push({ id: 'seg' + i, name: 'SEG' + i });
  const { d, pads, add, save } = makeDesign('N19 7 段数码管驱动板', {
    width: 70, height: 30, nets
  });
  // 2× 74HC595 SOIC-16 级联
  for (const [comp, x, dn] of [['U1', 20, 'mosi'], ['U2', 45, null]]) {
    const lv = [dn||'mosi', null, null, null, null, null, null, null];
    const rv = ['rclk', 'gnd', 'sck', null, null, null, null, 'vcc'];
    for (let k = 0; k < 8; k++) {
      const t = (k - 3.5) * 1.27;
      add(comp, k + 1, lv[k] || null, x - 2.7, 15 - 3.81 + t, 1.5, 0.6, 'rect', 'top');
      add(comp, k + 9, rv[k] || null, x + 2.7, 15 - 3.81 + t, 1.5, 0.6, 'rect', 'top');
    }
  }
  // 4× 7 段数码管（共阳，8 段焊盘各）
  for (let d = 0; d < 4; d++) {
    const x = 12 + d * 12;
    for (let s = 0; s < 8; s++) {
      add('SEG' + (d + 1), s + 1, 'seg' + s, x + (s % 4) * 2.54, 22 + Math.floor(s / 4) * 3, 1.2, 1.2, 'circle', 'both', 0.35);
    }
  }
  // J1 控制
  ['vcc', 'sck', 'mosi', 'rclk', 'gnd'].forEach((n, i) =>
    add('J1', i + 1, n, 2, 5 + i * 2.54, 1.5, 1.5, 'circle', 'both', 0.4));
  d.comps = { U1:{x:20,y:15,rot:0,layer:'top',value:'74HC595',footprint:'SOIC-16'},
              U2:{x:45,y:15,rot:0,layer:'top',value:'74HC595',footprint:'SOIC-16'},
              J1:{x:2,y:10,rot:90,layer:'top',value:'CTRL',footprint:'HDR-5P'} };
  save('n19-7seg');
}

// ===== N20: 双 BSS138 独立电平转换（双向独立通道）=====
{
  const nets = [{ id: 'lv', name: '1V8' }, { id: 'hv', name: '3V3' }, { id: 'gnd', name: 'GND' }];
  for (const s of ['uart_tx', 'uart_rx', 'gpio1', 'gpio2'])
    { nets.push({ id: s + '_l', name: s.toUpperCase() + '_1V8' }); nets.push({ id: s + '_h', name: s.toUpperCase() + '_3V3' }); }
  const { d, pads, add, save } = makeDesign('N20 双电平转换 4 通道', {
    width: 50, height: 25, nets
  });
  const signals = ['uart_tx', 'uart_rx', 'gpio1', 'gpio2'];
  signals.forEach((sig, i) => {
    const x = 10 + i * 10;
    add('Q' + (i + 1), 1, sig + '_l', x - 0.95, 8, 0.6, 1.0);
    add('Q' + (i + 1), 2, sig + '_h', x + 0.95, 8, 0.6, 1.0);
    add('Q' + (i + 1), 3, 'lv', x, 11, 0.6, 1.0);
    // 上拉
    add('R' + (i * 2 + 1), 1, sig + '_l', x - 2, 4, 0.8, 0.6);
    add('R' + (i * 2 + 1), 2, 'lv', x - 2, 2, 0.8, 0.6);
    add('R' + (i * 2 + 2), 1, sig + '_h', x + 2, 4, 0.8, 0.6);
    add('R' + (i * 2 + 2), 2, 'hv', x + 2, 2, 0.8, 0.6);
  });
  // 排针 LV/HV
  signals.forEach((s, i) => {
    add('J1', i + 1, s + '_l', 2, 4 + i * 2.54, 1.2, 1.2, 'circle', 'both', 0.35);
    add('J2', i + 1, s + '_h', 48, 4 + i * 2.54, 1.2, 1.2, 'circle', 'both', 0.35);
  });
  add('J1', 5, 'lv', 2, 14.16, 1.2, 1.2, 'circle', 'both', 0.35);
  add('J2', 5, 'hv', 48, 14.16, 1.2, 1.2, 'circle', 'both', 0.35);
  d.comps = {};
  for (let i = 0; i < 4; i++) d.comps['Q'+(i+1)] = {x:10+i*10, y:8, rot:0, layer:'top', value:'BSS138', footprint:'SOT-23'};
  save('n20-level-shift-4ch');
}

// ===== N21: 音频前置放大 + 功放链 =====
{
  const { d, pads, add, place, save } = makeDesign('N21 音频放大链', {
    width: 60, height: 30,
    nets: [{ id: 'vcc', name: 'VCC' }, { id: 'gnd', name: 'GND' },
           { id: 'audio_in', name: 'AUDIO_IN' }, { id: 'pre_out', name: 'PRE_OUT' },
           { id: 'amp_in', name: 'AMP_IN' }, { id: 'spk', name: 'SPK+' }, { id: 'spk_r', name: 'SPK-' }]
  });
  const fp603 = core.footprintPads('0603');
  // U1 前置运放
  place('U1', core.footprintPads('SOIC-8'), 15, 15, pin => ({
    1: 'pre_out', 2: null, 3: 'audio_in', 4: 'gnd', 8: 'vcc'
  }[pin] || null));
  // U2 功放（LM386 DIP-8）
  [[1, null], [2, null], [3, 'amp_in'], [4, 'gnd'], [5, 'spk'], [6, 'vcc'], [7, null], [8, null]].forEach(([p, n], i) => {
    const row = i < 4 ? 0 : 1, col = i % 4;
    add('U2', p, n, 35 + col * 2.54, 12 + row * 3.5, 1.2, 1.2, 'circle', 'both', 0.35);
  });
  // C1 耦合
  place('C1', fp603.map(f=>({...f})), 10, 15, i=>i===1?'audio_in':'audio_in');
  // R1 反馈
  place('R1', fp603.map(f=>({...f})), 20, 20, i=>i===1?'pre_out':'pre_out');
  // C2 耦合 pre→amp
  place('C2', fp603.map(f=>({...f})), 27, 15, i=>i===1?'pre_out':'amp_in');
  // J1 输入 / J2 喇叭
  add('J1', 1, 'audio_in', 2, 15, 1.7, 1.7, 'circle', 'both', 0.45);
  add('J1', 2, 'gnd', 2, 17.54, 1.7, 1.7, 'circle', 'both', 0.45);
  add('J2', 1, 'spk', 57, 12, 1.7, 1.7, 'circle', 'both', 0.45);
  add('J2', 2, 'gnd', 57, 14.54, 1.7, 1.7, 'circle', 'both', 0.45);
  d.comps = { U1:{x:15,y:15,rot:0,layer:'top',value:'NE5532',footprint:'SOIC-8'},
              U2:{x:38.6,y:13.75,rot:0,layer:'top',value:'LM386',footprint:'DIP-8'},
              C1:{x:10,y:15,rot:0,layer:'top',value:'1uF',footprint:'C0603'},
              R1:{x:20,y:20,rot:0,layer:'top',value:'10k',footprint:'R0603'},
              C2:{x:27,y:15,rot:0,layer:'top',value:'100nF',footprint:'C0603'},
              J1:{x:2,y:16.3,rot:90,layer:'top',value:'IN',footprint:'HDR-2P'},
              J2:{x:57,y:13.3,rot:90,layer:'top',value:'SPK',footprint:'HDR-2P'} };
  save('n21-audio-amp');
}

// ===== N22: 双 12 位 DAC 输出板（MCP4725 ×2 I2C）=====
{
  const { d, pads, add, place, save } = makeDesign('N22 双 DAC 输出板', {
    width: 45, height: 22,
    nets: [{ id: 'vcc', name: 'VCC' }, { id: 'gnd', name: 'GND' },
           { id: 'sda', name: 'SDA' }, { id: 'scl', name: 'SCL' },
           { id: 'da1', name: 'DAC1' }, { id: 'da2', name: 'DAC2' }]
  });
  const fp603 = core.footprintPads('0603');
  // MCP4725 SOIC-8 ×2（I2C 地址不同）
  for (const [comp, x, out] of [['U1', 18, 'da1'], ['U2', 30, 'da2']]) {
    [[1, 'sda'], [2, 'gnd'], [3, 'vcc'], [4, out], [5, 'scl'], [6, 'vcc'], [7, null], [8, null]].forEach(([p, n], i) => {
      const row = i < 4 ? 0 : 1, col = i % 4;
      add(comp, p, n, x + col * 2.54, 10 + row * 3.5, 1.2, 1.2, 'circle', 'both', 0.35);
    });
  }
  // I2C 上拉
  place('R1', fp603.map(f=>({...f})), 8, 4, i=>i===1?'sda':'vcc');
  place('R2', fp603.map(f=>({...f})), 11, 4, i=>i===1?'scl':'vcc');
  // J1 I2C / J2 DAC 输出
  ['vcc','gnd','sda','scl'].forEach((n,i)=>add('J1', i+1, n, 2, 4+i*2.54, 1.5, 1.5, 'circle', 'both', 0.4));
  add('J2', 1, 'da1', 20, 20, 1.5, 1.5, 'circle', 'both', 0.4);
  add('J2', 2, 'da2', 25, 20, 1.5, 1.5, 'circle', 'both', 0.4);
  add('J2', 3, 'gnd', 30, 20, 1.5, 1.5, 'circle', 'both', 0.4);
  d.comps = { U1:{x:21.3,y:11.75,rot:0,layer:'top',value:'MCP4725',footprint:'SOIC-8'},
              U2:{x:33.3,y:11.75,rot:0,layer:'top',value:'MCP4725',footprint:'SOIC-8'},
              R1:{x:8,y:4,rot:0,layer:'top',value:'10k',footprint:'R0603'},
              R2:{x:11,y:4,rot:0,layer:'top',value:'10k',footprint:'R0603'},
              J1:{x:2,y:7.8,rot:90,layer:'top',value:'I2C',footprint:'HDR-4P'},
              J2:{x:25,y:20,rot:0,layer:'top',value:'DAC-OUT',footprint:'HDR-3P'} };
  save('n22-dual-dac');
}

console.log('Batch 1 (N13-N22) specs generated');
