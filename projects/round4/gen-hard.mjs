// 第四轮批量 spec：N23-N32（困难+超难）
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const mA = html.match(new RegExp('// ==== ROUTER CORE START ====([\\s\\S]*?)// ==== ROUTER CORE END ===='));
const mB = html.match(new RegExp('// ==== EXAMPLES START ====([\\s\\S]*?)// ==== EXAMPLES END ===='));
const core = new Function(mA[1] + '\n' + mB[1] + '\nreturn {footprintPads, designDefaults};')();
const base = new URL('./', import.meta.url);

function makeDesign(name, opts) {
  const d = core.designDefaults();
  Object.assign(d, { width: 50, height: 35, grid: 0.6, trackW: 0.4, clearance: 0.2, viaOuter: 0.8, viaDrill: 0.4, ...opts });
  d.nets = opts.nets;
  const pads = [];
  const add = (c, p, n, x, y, w, h, shape, layer, holeR) =>
    pads.push({ id: `${c}-${p}`, netId: n, x: +x.toFixed(4), y: +y.toFixed(4), w, h, shape: shape || 'rect', layer: layer || 'top', holeR });
  const place = (comp, fp, cx, cy, netOf, layerOf) => {
    fp.forEach((f, i) => add(comp, i + 1, netOf(i + 1), cx + f.dx, cy + f.dy, f.w, f.h, f.shape, layerOf ? layerOf(i + 1) : f.layer, f.holeR));
  };
  return { d, pads, add, place, save(subdir, comps) {
    d.pads = pads; d.comps = comps || {};
    mkdirSync(new URL(subdir + '/', base), { recursive: true });
    writeFileSync(new URL(subdir + '/design.json', base), JSON.stringify(d, null, 1));
    console.log(name + ':', pads.length, 'pads /', d.nets.length, 'nets');
  }};
}
const mk = n => core.footprintPads(n);
const fp603 = mk('0603');

// ===== N23: 精密恒流源板 =====
{
  const { d, pads, add, place, save } = makeDesign('N23 精密恒流源板', {
    nets: [{ id: 'vcc', name: 'VCC' }, { id: 'gnd', name: 'GND' },
           { id: 'vref', name: 'VREF' }, { id: 'iset', name: 'ISET' },
           { id: 'isense', name: 'ISENSE' }, { id: 'iload', name: 'ILOAD' }]
  });
  place('U1', mk('SOIC-8'), 15, 12, p => ({ 1:'iset', 2:'iset', 3:'isense', 4:'gnd', 8:'vcc' }[p]||null));
  place('Q1', mk('SOT-23'), 22, 12, i=>['iset',null,'iload'][i-1]||null);
  place('R1', fp603.map(f=>({...f})), 8, 8, i=>i===1?'vref':'iset');
  place('R2', fp603.map(f=>({...f})), 27, 12, i=>i===1?'iload':'isense');
  place('R3', fp603.map(f=>({...f})), 27, 18, i=>i===1?'isense':'gnd');
  add('J1', 1, 'vref', 2, 8, 1.5, 1.5, 'circle', 'both', 0.4);
  add('J1', 2, 'gnd', 2, 10.54, 1.5, 1.5, 'circle', 'both', 0.4);
  add('J2', 1, 'iload', 35, 12, 1.5, 1.5, 'circle', 'both', 0.4);
  add('J2', 2, 'gnd', 35, 14.54, 1.5, 1.5, 'circle', 'both', 0.4);
  save('n23-constant-current', { U1:{x:15,y:12,rot:0,layer:'top',value:'OPA2277',footprint:'SOIC-8'},
    Q1:{x:22,y:12,rot:0,layer:'top',value:'IRLML6402',footprint:'SOT-23'},
    R1:{x:8,y:8,rot:0,layer:'top',value:'10k',footprint:'R0603'},
    R2:{x:27,y:12,rot:0,layer:'top',value:'1R',footprint:'R0805'},
    R3:{x:27,y:18,rot:0,layer:'top',value:'1R',footprint:'R0805'},
    J1:{x:2,y:9.3,rot:90,layer:'top',value:'VREF',footprint:'HDR-2P'},
    J2:{x:35,y:13.3,rot:90,layer:'top',value:'LOAD',footprint:'HDR-2P'} });
}

// ===== N24: 4 通道衰减器板 =====
{
  const nets = [{ id: 'in', name: 'VIN' }, { id: 'gnd', name: 'GND' }];
  for (let i = 1; i <= 4; i++) { nets.push({id:'out'+i, name:'OUT'+i}); nets.push({id:'tap'+i, name:'TAP'+i}); }
  const { d, pads, add, save } = makeDesign('N24 4 通道衰减器', {
    width: 55, height: 20, nets
  });
  for (let i = 0; i < 4; i++) {
    const x = 8 + i * 12;
    add('R' + (i*2+1), 1, 'in', x, 8, 0.9, 0.8);
    add('R' + (i*2+1), 2, 'tap' + (i+1), x + 3, 8, 0.9, 0.8);
    add('R' + (i*2+2), 1, 'tap' + (i+1), x + 3, 12, 0.9, 0.8);
    add('R' + (i*2+2), 2, 'gnd', x + 6, 12, 0.9, 0.8);
    add('J' + (i+1), 1, 'out' + (i+1), x + 9, 8, 1.2, 1.2, 'circle', 'both', 0.35);
    // 通道间连接
    if (i < 3) add('W' + (i+1), 1, 'in', x + 9, 8, 0.5, 0.5);
    if (i < 3) add('W' + (i+1), 2, 'in', x + 12, 8, 0.5, 0.5);
  }
  add('JIN', 1, 'in', 2, 8, 1.5, 1.5, 'circle', 'both', 0.4);
  save('n24-attenuator', {});
}

// ===== N25: A4988 步进电机接口板 =====
{
  const nets = [{ id: 'vcc', name: 'VCC' }, { id: 'vm', name: 'VM' }, { id: 'gnd', name: 'GND' },
    { id: 'step', name: 'STEP' }, { id: 'dir', name: 'DIR' }, { id: 'en', name: 'EN' },
    { id: 'ms1', name: 'MS1' }, { id: 'ms2', name: 'MS2' }, { id: 'ms3', name: 'MS3' },
    { id: 'slp', name: 'SLP' }, { id: 'rst', name: 'RST' }];
  for (const m of ['m1a','m1b','m2a','m2b']) nets.push({ id: m, name: m.toUpperCase() });
  const { d, pads, add, place, save } = makeDesign('N25 A4988 步进接口板', {
    width: 45, height: 35, nets
  });
  // A4988 接口板（16 pin 排针模拟 A4988 模块引脚）
  const a4988 = ['en','ms1','ms2','ms3','rst','slp','step','dir',null,'gnd','vm','m1b','m1a','m2a','m2b','gnd'];
  a4988.forEach((n, i) => {
    const row = i < 8 ? 0 : 1, col = i % 8;
    add('A1', i + 1, n, 8 + col * 2.54, 8 + row * 3.5, 1.2, 1.2, 'circle', 'both', 0.35);
  });
  // MCU 排针
  ['step','dir','en','ms1','ms2','ms3','slp','rst'].forEach((n, i) =>
    add('J1', i + 1, n, 2, 4 + i * 2.54, 1.2, 1.2, 'circle', 'both', 0.35));
  // 电机排针
  ['m1b','m1a','m2a','m2b'].forEach((n, i) =>
    add('J2', i + 1, n, 42, 4 + i * 2.54, 1.5, 1.5, 'circle', 'both', 0.4));
  // 去耦
  const fp603 = core.footprintPads('0603');
  place('C1', fp603.map(f=>({...f})), 8, 20, i=>i===1?'vm':'gnd');
  place('C2', fp603.map(f=>({...f})), 12, 20, i=>i===1?'vcc':'gnd');
  d.comps = { A1:{x:14.6,y:11.3,rot:0,layer:'top',value:'A4988',footprint:'HDR-16P'},
              J1:{x:2,y:13,rot:90,layer:'top',value:'MCU',footprint:'HDR-8P'},
              J2:{x:42,y:8,rot:90,layer:'top',value:'MOTOR',footprint:'HDR-4P'},
              C1:{x:8,y:20,rot:0,layer:'top',value:'100nF',footprint:'C0603'},
              C2:{x:12,y:20,rot:0,layer:'top',value:'100nF',footprint:'C0603'} };
  save('n25-a4988');
}

// ===== N26: MCP42010 双数字电位器 SPI 链 =====
{
  const nets = [{ id: 'vcc', name: 'VCC' }, { id: 'gnd', name: 'GND' },
    { id: 'sck', name: 'SCK' }, { id: 'mosi', name: 'MOSI' },
    { id: 'cs', name: 'CS' }, { id: 'pw0', name: 'PW0' }, { id: 'pw1', name: 'PW1' }];
  const { d, pads, add, place, save } = makeDesign('N26 MCP42010 双数字电位器', {
    width: 40, height: 25, nets
  });
  // MCP42010 SOIC-14 ×2（SPI 级联：U1 SDO → U2 DIN）
  for (const [comp, x, din, sdo] of [['U1', 12, 'mosi', null], ['U2', 28, 'q7s', null]]) {
    for (let i = 0; i < 7; i++) {
      const t = (i - 3) * 1.27;
      add(comp, i + 1, null, x - 2.7, 12.5 + t, 1.5, 0.5, 'rect', 'top');
    }
    for (let i = 0; i < 7; i++) {
      const t = (i - 3) * 1.27;
      add(comp, i + 8, i === 0 ? null : (i === 1 ? din : (i === 2 ? 'sck' : (i === 3 ? 'cs' : null))), x + 2.7, 12.5 + t, 1.5, 0.5, 'rect', 'top');
    }
  }
  add('J1', 1, 'sck', 2, 6, 1.5, 1.5, 'circle', 'both', 0.4);
  add('J1', 2, 'mosi', 2, 8.54, 1.5, 1.5, 'circle', 'both', 0.4);
  add('J1', 3, 'cs', 2, 11.08, 1.5, 1.5, 'circle', 'both', 0.4);
  add('J1', 4, 'vcc', 2, 13.62, 1.5, 1.5, 'circle', 'both', 0.4);
  d.comps = { U1:{x:12,y:12.5,rot:0,layer:'top',value:'MCP42010',footprint:'SOIC-14'},
              U2:{x:28,y:12.5,rot:0,layer:'top',value:'MCP42010',footprint:'SOIC-14'},
              J1:{x:2,y:9.8,rot:90,layer:'top',value:'SPI',footprint:'HDR-4P'} };
  save('n26-mcp42010');
}

// ===== N27: CD4051 多路复用板 =====
{
  const nets = [{ id: 'vcc', name: 'VCC' }, { id: 'gnd', name: 'GND' },
    { id: 'com', name: 'COM' }, { id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
  for (let i = 0; i < 8; i++) nets.push({ id: 'ch' + i, name: 'CH' + i });
  const { d, pads, add, place, save } = makeDesign('N27 CD4051 多路复用板', {
    width: 50, height: 25, nets
  });
  // CD4051 DIP-16: 1-4 CH0-3, 5 CH4? — 简化：引脚 1-8 为 8 通道，9-11 为 A/B/C，12 COM
  for (let i = 0; i < 8; i++) {
    const row = i < 4 ? 0 : 1, col = i % 4;
    add('U1', i + 1, 'ch' + i, 10 + col * 2.54, 8 + row * 3.5, 1.2, 1.2, 'circle', 'both', 0.35);
  }
  add('U1', 9, 'c', 10, 15, 1.2, 1.2, 'circle', 'both', 0.35);
  add('U1', 10, 'b', 12.54, 15, 1.2, 1.2, 'circle', 'both', 0.35);
  add('U1', 11, 'a', 15.08, 15, 1.2, 1.2, 'circle', 'both', 0.35);
  add('U1', 12, 'com', 17.62, 15, 1.2, 1.2, 'circle', 'both', 0.35);
  // 8 通道排针
  for (let i = 0; i < 8; i++)
    add('J1', i + 1, 'ch' + i, 40, 4 + i * 2.54, 1.2, 1.2, 'circle', 'both', 0.35);
  // COM 输出
  add('J2', 1, 'com', 40, 24, 1.5, 1.5, 'circle', 'both', 0.4);
  // 地址排针
  ['a','b','c'].forEach((n, i) => add('J3', i + 1, n, 2, 4 + i * 2.54, 1.2, 1.2, 'circle', 'both', 0.35));
  d.comps = { U1:{x:14.3,y:11.5,rot:0,layer:'top',value:'CD4051',footprint:'DIP-16'},
              J1:{x:40,y:12.8,rot:90,layer:'top',value:'CH',footprint:'HDR-8P'},
              J2:{x:40,y:24,rot:0,layer:'top',value:'COM',footprint:'HDR-1P'},
              J3:{x:2,y:6.3,rot:90,layer:'top',value:'ADDR',footprint:'HDR-3P'} };
  save('n27-cd4051');
}

// ===== N28: LQFP64 ARM 载板（0.5mm pitch, 16/side）=====
{
  const nets = [{ id: 'v33', name: '3V3' }, { id: 'gnd', name: 'GND' },
    { id: 'osc_in', name: 'OSC_IN' }, { id: 'osc_out', name: 'OSC_OUT' },
    { id: 'nrst', name: 'NRST' }, { id: 'swdio', name: 'SWDIO' }, { id: 'swclk', name: 'SWCLK' }];
  for (let i = 0; i < 32; i++) nets.push({ id: 'io' + i, name: 'IO' + i });
  const { d, pads, add, save } = makeDesign('N28 LQFP64 ARM 载板', {
    width: 60, height: 50, grid: 0.25, trackW: 0.15, clearance: 0.1, viaOuter: 0.6, viaDrill: 0.3, nets
  });
  const per = 16, off = 5.0;
  const pinN = p => 'io' + (p - 1);  // 简化 IO 映射
  // 电源引脚（LQFP64 特定位置）
  const pw = { 12: 'gnd', 13: 'v33', 32: 'gnd', 33: 'v33', 52: 'gnd', 53: 'v33', 64: 'v33', 1: 'gnd' };
  for (let k = 0; k < per; k++) { const t=(k-(per-1)/2)*0.5; add('U1', k+1, pw[k+1]||pinN(k+1), 30-off, 25+t, 1.5, 0.3, 'rect', 'top'); }
  for (let k = 0; k < per; k++) { const t=(k-(per-1)/2)*0.5; add('U1', k+17, pw[k+17]||pinN(k+16), 30+t, 25+off, 0.3, 1.5, 'rect', 'top'); }
  for (let k = 0; k < per; k++) { const t=(k-(per-1)/2)*0.5; add('U1', k+33, pw[k+33]||pinN(k+32), 30+off, 25-t, 1.5, 0.3, 'rect', 'top'); }
  for (let k = 0; k < per; k++) { const t=(k-(per-1)/2)*0.5; add('U1', k+49, pw[k+49]||pinN(k+48), 30-t, 25-off, 0.3, 1.5, 'rect', 'top'); }
  d.keepouts.push({ x: 30, y: 25, w: 8, h: 8 });
  // 去耦
  add('C1', 1, 'v33', 30, 14, 0.8, 0.6, 'rect', 'top');
  add('C2', 1, 'gnd', 32, 14, 0.8, 0.6, 'rect', 'top');
  // SWD
  ['v33','swdio','swclk','gnd'].forEach((n,i)=>add('J1', i+1, n, 4, 20+i*2.54, 1.5, 1.5, 'circle', 'both', 0.4));
  // GPIO 排针 1×16
  for (let i = 0; i < 16; i++) add('J2', i+1, 'io'+i, 58, 4+i*2.54, 1.5, 1.5, 'circle', 'both', 0.4);
  save('n28-lqfp64', { U1:{x:30,y:25,rot:0,layer:'top',value:'STM32-LQFP64',footprint:'LQFP64'} });
}

// ===== N29: 多路 DC-DC 级联板 =====
{
  const nets = [{ id: 'vin', name: 'VIN', w: 0.5 }, { id: 'gnd', name: 'GND', w: 0.5 },
    { id: 'v12', name: '12V', w: 0.5 }, { id: 'v5', name: '5V', w: 0.5 }, { id: 'v33', name: '3V3' }];
  const { d, pads, add, place, save } = makeDesign('N29 多路 DC-DC 级联', {
    width: 70, height: 30, nets
  });
  const fp805 = core.footprintPads('0805');
  // 三级降压：VIN→12V→5V→3.3V
  for (const [comp, x, vin, vout] of [['DC1', 10, 'vin', 'v12'], ['DC2', 30, 'v12', 'v5'], ['DC3', 50, 'v5', 'v33']]) {
    place(comp, fp805.map(f=>({...f})), x, 15, i=>i===1?vout:(i===2?vin:'gnd'));
    place('C'+comp, fp805.map(f=>({...f})), x+4, 8, i=>i===1?vout:'gnd');
  }
  // J1 输入 / J2/J3/J4 各级输出
  add('J1', 1, 'vin', 2, 15, 1.7, 1.7, 'circle', 'both', 0.45);
  add('J1', 2, 'gnd', 2, 17.54, 1.7, 1.7, 'circle', 'both', 0.45);
  [['J2','v12',20],['J3','v5',40],['J4','v33',60]].forEach(([j,n,x]) => {
    add(j, 1, n, x, 22, 1.7, 1.7, 'circle', 'both', 0.45);
    add(j, 2, 'gnd', x+2.54, 22, 1.7, 1.7, 'circle', 'both', 0.45);
  });
  save('n29-dc-dc-cascade', {});
}

// ===== N30: DIP-40 大型板（Z80 CPU 载板）=====
{
  const nets = [{ id: 'vcc', name: 'VCC' }, { id: 'gnd', name: 'GND' },
    { id: 'clk', name: 'CLK' }, { id: 'rst', name: 'RST' }];
  for (let i = 0; i < 16; i++) nets.push({ id: 'ad' + i, name: 'A' + i });
  for (let i = 0; i < 8; i++) nets.push({ id: 'da' + i, name: 'D' + i });
  const { d, pads, add, place, save } = makeDesign('N30 Z80 CPU 载板', {
    width: 60, height: 40, nets
  });
  // Z80 DIP-40: 1-20 左列（下→上），21-40 右列（上→下）
  const z80 = { 1:'v5', 2:'rst', 3:null, 4:null, 5:null, 6:'clk', 7:null, 8:null,
    11:'ad0', 12:'ad1', 13:'ad2', 14:'ad3', 15:'ad4', 16:'ad5', 17:'ad6', 18:'ad7',
    19:'da0', 20:'da1', 21:'da2', 22:'da3', 23:'da4', 24:'da5', 25:'da6', 26:'da7',
    27:null, 28:null, 29:'gnd', 30:null, 31:null, 32:null, 33:null, 34:null,
    35:null, 36:null, 37:null, 38:null, 39:null, 40:'gnd' };
  for (let i = 0; i < 20; i++) {
    add('U1', i + 1, z80[i + 1] || null, 20, 30 - i * 1.5, 1.2, 1.2, 'circle', 'both', 0.45);
    add('U1', i + 21, z80[i + 21] || null, 27.62, 10 + i * 1.5, 1.2, 1.2, 'circle', 'both', 0.45);
  }
  // 地址/数据排针
  for (let i = 0; i < 16; i++) add('J1', i + 1, 'ad' + i, 45, 4 + i * 2, 1.2, 1.2, 'circle', 'both', 0.35);
  for (let i = 0; i < 8; i++) add('J2', i + 1, 'da' + i, 50, 4 + i * 2, 1.2, 1.2, 'circle', 'both', 0.35);
  // 时钟 + 复位
  add('Y1', 1, 'clk', 12, 5, 1.5, 1.2);
  add('Y1', 2, 'gnd', 14, 5, 1.5, 1.2);
  const fp603 = core.footprintPads('0603');
  place('R1', fp603.map(f=>({...f})), 12, 38, i=>i===1?'rst':'vcc');
  d.comps = { U1:{x:23.8,y:20,rot:0,layer:'top',value:'Z80-CPU',footprint:'DIP-40'},
              Y1:{x:13,y:5,rot:0,layer:'top',value:'4MHz',footprint:'XTAL'},
              R1:{x:12,y:38,rot:0,layer:'top',value:'10k',footprint:'R0603'},
              J1:{x:45,y:20,rot:90,layer:'top',value:'ADDR',footprint:'HDR-16P'},
              J2:{x:50,y:10,rot:90,layer:'top',value:'DATA',footprint:'HDR-8P'} };
  save('n30-z80');
}

// ===== N31: LQFP48 + SOIC-28 混合密度板（0.25 grid 压力测试）=====
{
  const { d, pads, add, place, save } = makeDesign('N31 LQFP48+SOIC-28 混合', {
    width: 60, height: 40, grid: 0.25, trackW: 0.15, clearance: 0.1, viaOuter: 0.6, viaDrill: 0.3,
    nets: [{ id: 'v33', name: '3V3' }, { id: 'gnd', name: 'GND' },
      { id: 'sda', name: 'SDA' }, { id: 'scl', name: 'SCL' },
      { id: 'spi_sck', name: 'SPI_SCK' }, { id: 'spi_mosi', name: 'SPI_MOSI' },
      { id: 'nrst', name: 'NRST' }, { id: 'swdio', name: 'SWDIO' }, { id: 'swclk', name: 'SWCLK' }]
  });
  // LQFP48（从 H2 复制核心，位置左移）
  for (let k = 0; k < 12; k++) { const t=(k-5.5)*0.5; add('U1', k+1, null, 18-4.25, 20+t, 1.5, 0.3, 'rect', 'top'); }
  for (let k = 0; k < 12; k++) { const t=(k-5.5)*0.5; add('U1', k+13, {30:'spi_sck',33:'spi_mosi'}[k+13]||null, 18+t, 20+4.25, 0.3, 1.5, 'rect', 'top'); }
  for (let k = 0; k < 12; k++) { const t=(k-5.5)*0.5; add('U1', k+25, {27:'sda',31:'swdio'}[k+25]||null, 18+4.25, 20-t, 1.5, 0.3, 'rect', 'top'); }
  for (let k = 0; k < 12; k++) { const t=(k-5.5)*0.5; add('U1', k+37, {37:'swclk',7:'nrst',9:'v33',8:'gnd'}[k+37]||null, 18-t, 20-4.25, 0.3, 1.5, 'rect', 'top'); }
  d.keepouts.push({ x: 18, y: 20, w: 6.5, h: 6.5 });
  // MCP23017 SOIC-28（右移）
  const pinN = p => ({ 1:'scl', 2:'sda', 21:'gnd', 27:'v33' }[p]||null);
  const per28 = 14, span28 = 5.08, pitch28 = 1.27;
  for (let k = 0; k < per28; k++) { const t=(k-(per28-1)/2)*pitch28; add('U2', k+1, pinN(k+1)||null, 45-span28, 20+t, 1.5, 0.5, 'rect', 'top'); }
  for (let k = 0; k < per28; k++) { const t=(k-(per28-1)/2)*pitch28; add('U2', k+15, pinN(k+15)||null, 45+span28, 20-t, 1.5, 0.5, 'rect', 'top'); }
  // 连接
  add('C1', 1, 'v33', 30, 32, 0.8, 0.6, 'rect', 'top');
  save('n31-lqfp48-soic28', {});
}

// ===== N32: 4 层板混合信号（4 层 + LQFP48 + SOIC-16 + DIP-16）=====
{
  const { d, pads, add, place, save } = makeDesign('N32 4 层混合信号板', {
    width: 60, height: 40, grid: 0.5, trackW: 0.2, clearance: 0.15, viaOuter: 0.6, viaDrill: 0.3, layers: 4,
    nets: [{ id: 'v33', name: '3V3' }, { id: 'gnd', name: 'GND' },
      { id: 'sck', name: 'SCK' }, { id: 'mosi', name: 'MOSI' }, { id: 'miso', name: 'MISO' },
      { id: 'tx', name: 'TX' }, { id: 'rx', name: 'RX' }]
  });
  const fp603 = core.footprintPads('0603');
  const place603 = (comp, cx, cy, netOf) => place(comp, fp603.map(f=>({...f})), cx, cy, netOf);
  // U1 STM32 LQFP48（左）
  for (let k = 0; k < 12; k++) { const t=(k-5.5)*0.5; add('U1', k+1, null, 15-4.25, 20+t, 1.5, 0.3, 'rect', 'top'); }
  for (let k = 0; k < 12; k++) { const t=(k-5.5)*0.5; add('U1', k+13, {30:'sck',33:'mosi'}[k+13]||null, 15+t, 20+4.25, 0.3, 1.5, 'rect', 'top'); }
  for (let k = 0; k < 12; k++) { const t=(k-5.5)*0.5; add('U1', k+25, {31:'miso'}[k+25]||null, 15+4.25, 20-t, 1.5, 0.3, 'rect', 'top'); }
  for (let k = 0; k < 12; k++) { const t=(k-5.5)*0.5; add('U1', k+37, {37:'swclk',7:'nrst',9:'v33',8:'gnd'}[k+37]||null, 15-t, 20-4.25, 0.3, 1.5, 'rect', 'top'); }
  // U2 CH340G SOIC-16（右）
  place('U2', core.footprintPads('SOIC-16'), 45, 20, pin => ({
    1: 'gnd', 2: 'tx', 3: 'rx', 16: 'v33'
  }[pin] || null));
  // U3 ULN2003 DIP-16（下方）
  for (let i = 0; i < 8; i++) {
    const row = i < 4 ? 0 : 1, col = i % 4;
    add('U3', i + 1, null, 20 + col * 2.54, 32 + row * 3.5, 1.2, 1.2, 'circle', 'both', 0.45);
  }
  add('U3', 9, 'v33', 20, 38, 1.2, 1.2, 'circle', 'both', 0.45);
  for (let i = 0; i < 7; i++) {
    const row = (i) % 2, col = Math.floor(i / 2);
    add('U3', 16 - i, null, 20 + col * 2.54, 38 - row * 3.5, 1.2, 1.2, 'circle', 'both', 0.45);
  }
  // 排针
  ['v33','swdio','swclk','gnd'].forEach((n,i)=>add('J1', i+1, n, 4, 14+i*2.54, 1.5, 1.5, 'circle', 'both', 0.4));
  save('n32-4layer-mixed', { U1:{x:15,y:20,rot:0,layer:'top',value:'STM32',footprint:'LQFP48'},
    U2:{x:45,y:20,rot:0,layer:'top',value:'CH340G',footprint:'SOIC-16'},
    U3:{x:23.8,y:35,rot:0,layer:'top',value:'ULN2003',footprint:'DIP-16'},
    J1:{x:4,y:17.8,rot:90,layer:'top',value:'SWD',footprint:'HDR-4P'} });
}

console.log('Batch 2 (N23-N32) specs generated');
