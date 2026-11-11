// 第三轮批量 spec 生成：N7-N12
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
    d.pads = pads;
    d.comps = comps || {};
    const dir = new URL(subdir + '/', base);
    mkdirSync(dir, { recursive: true });
    writeFileSync(new URL(subdir + '/design.json', base), JSON.stringify(d, null, 1));
    console.log(name + ':', pads.length, 'pads /', d.nets.length, 'nets');
  }};
}

// ===== N7: MCP23017 I2C GPIO 扩展（SOIC-28——首次测试 28 脚 SOIC）=====
{
  const nets = [{ id: 'vcc', name: 'VCC' }, { id: 'gnd', name: 'GND' },
                { id: 'sda', name: 'SDA' }, { id: 'scl', name: 'SCL' },
                { id: 'rst', name: 'RST' }, { id: 'int', name: 'INT' }];
  for (let i = 0; i < 16; i++) nets.push({ id: 'gp' + i, name: 'GP' + i });
  const { d, pads, add, place, save } = makeDesign('N7 MCP23017 SOIC-28 GPIO 扩展', {
    width: 55, height: 30, nets
  });
  const fp603 = core.footprintPads('0603');
  // U1 MCP23017 SOIC-28: 左列 1-14, 右列 15-28
  // 引脚：1 SCL 2 SDA 3 A0 4 A1 5 A2 6 RST 7-12 GP0-5 13 VSS 14 NC
  //       15 GP6 16 GP7 17 INTB 18 INTA 19-26 GP7-0(B) 27 VDD 28 NC
  const pinNets = {
    1: 'scl', 2: 'sda', 6: 'rst',
    7: 'gp0', 8: 'gp1', 9: 'gp2', 10: 'gp3', 11: 'gp4', 12: 'gp5',
    13: 'gnd', 15: 'gp6', 16: 'gp7',
    18: 'int', 21: 'gnd', 27: 'vcc'
  };
  const fp28 = [];
  const per = 14, pitch = 1.27, span = 5.08;
  for (let k = 0; k < per; k++) { const t = (k-(per-1)/2)*pitch; fp28.push({pin:k+1, dx:-span, dy:t, w:1.5, h:0.5}); }
  for (let k = 0; k < per; k++) { const t = (k-(per-1)/2)*pitch; fp28.push({pin:k+15, dx:span, dy:-t, w:1.5, h:0.5}); }
  place('U1', fp28, 25, 15, p => pinNets[p] || null);
  // I2C 上拉
  place('R1', fp603.map(f=>({...f})), 12, 5, i=>i===1?'sda':'vcc');
  place('R2', fp603.map(f=>({...f})), 15, 5, i=>i===1?'scl':'vcc');
  place('R3', fp603.map(f=>({...f})), 18, 5, i=>i===1?'rst':'vcc');
  // GPIO 排针 1×8（GP0-7 左侧引出）
  for (let i = 0; i < 8; i++) add('J1', i+1, 'gp'+i, 2, 4+i*2, 1.2, 1.2, 'circle', 'both', 0.35);
  // 去耦
  place('C1', fp603.map(f=>({...f})), 25, 25, i=>i===1?'vcc':'gnd');
  d.comps = { U1:{x:25,y:15,rot:0,layer:'top',value:'MCP23017',footprint:'SOIC-28'},
              R1:{x:12,y:5,rot:0,layer:'top',value:'10k',footprint:'R0603'},
              R2:{x:15,y:5,rot:0,layer:'top',value:'10k',footprint:'R0603'},
              R3:{x:18,y:5,rot:0,layer:'top',value:'10k',footprint:'R0603'},
              C1:{x:25,y:25,rot:0,layer:'top',value:'100nF',footprint:'C0603'},
              J1:{x:2,y:18,rot:90,layer:'top',value:'GPIO',footprint:'HDR-8P'} };
  save('n7-mcp23017');
}

// ===== N8: LM2596 大电流降压（TO-263-5 封装 + 大电流路径）=====
{
  const { d, pads, add, place, save } = makeDesign('N8 LM2596 大电流降压', {
    width: 50, height: 30,
    nets: [{ id: 'vin', name: 'VIN', w: 0.5 }, { id: 'gnd', name: 'GND', w: 0.5 },
           { id: 'sw', name: 'SW' }, { id: 'vout', name: 'VOUT', w: 0.5 },
           { id: 'fb', name: 'FB' }, { id: 'on', name: 'ON' }]
  });
  const fpSMB = [{dx:-1.8,dy:0,w:1.2,h:1.6,shape:'rect',layer:'top'},{dx:1.8,dy:0,w:1.2,h:1.6,shape:'rect',layer:'top'}];
  const fp805 = core.footprintPads('0805');
  // U1 LM2596 TO-263-5: 1 VIN 2 OUT 3 GND 4 FB 5 ON
  [[-2.54, 0, 'vin'], [0, 0, 'sw'], [2.54, 0, 'gnd'], [-2.54, 4, 'fb'], [0, 4, 'on']].forEach(([dx,dy,n],i) =>
    add('U1', i+1, n, 20+dx, 15+dy, 1.8, 1.5, 'rect', 'top'));
  // D1 SS34 续流
  place('D1', fpSMB, 28, 15, i=>i===1?'sw':'gnd');
  // L1 电感
  add('L1', 1, 'sw', 34, 13, 2, 1.5);
  add('L1', 2, 'vout', 34, 17, 2, 1.5);
  // C_IN / C_OUT 大电容
  place('CIN', fp805.map(f=>({...f})), 10, 12, i=>i===1?'vin':'gnd');
  place('COUT', fp805.map(f=>({...f})), 42, 15, i=>i===1?'vout':'gnd');
  // R_FB 分压
  const fp603 = core.footprintPads('0603');
  place('R1', fp603.map(f=>({...f})), 14, 22, i=>i===1?'vout':'fb');
  place('R2', fp603.map(f=>({...f})), 14, 25, i=>i===1?'fb':'gnd');
  // J1/J2
  add('J1', 1, 'vin', 2, 12, 1.7, 1.7, 'circle', 'both', 0.45);
  add('J1', 2, 'gnd', 2, 14.54, 1.7, 1.7, 'circle', 'both', 0.45);
  add('J2', 1, 'vout', 48, 12, 1.7, 1.7, 'circle', 'both', 0.45);
  add('J2', 2, 'gnd', 48, 14.54, 1.7, 1.7, 'circle', 'both', 0.45);
  save('n8-lm2596', { U1:{x:20,y:15,rot:0,layer:'top',value:'LM2596',footprint:'TO-263-5'},
    D1:{x:28,y:15,rot:0,layer:'top',value:'SS34',footprint:'SMB'},
    L1:{x:34,y:15,rot:0,layer:'top',value:'33uH',footprint:'L-SMD'},
    CIN:{x:10,y:12,rot:0,layer:'top',value:'470uF',footprint:'C0805'},
    COUT:{x:42,y:15,rot:0,layer:'top',value:'220uF',footprint:'C0805'},
    R1:{x:14,y:22,rot:0,layer:'top',value:'13.7k',footprint:'R0603'},
    R2:{x:14,y:25,rot:0,layer:'top',value:'4.99k',footprint:'R0603'},
    J1:{x:2,y:13.3,rot:90,layer:'top',value:'VIN',footprint:'HDR-2P'},
    J2:{x:48,y:13.3,rot:90,layer:'top',value:'VOUT',footprint:'HDR-2P'} });
}

// ===== N9: 传感器调理板（ADS1115 I2C ADC + 滤波）=====
{
  const nets = [{ id: 'vcc', name: 'VCC' }, { id: 'gnd', name: 'GND' },
                { id: 'sda', name: 'SDA' }, { id: 'scl', name: 'SCL' },
                { id: 'ain0', name: 'AIN0' }, { id: 'ain1', name: 'AIN1' },
                { id: 'alert', name: 'ALERT' }];
  const { d, pads, add, place, save } = makeDesign('N9 ADS1115 传感器调理板', {
    width: 40, height: 25, nets
  });
  const fp603 = core.footprintPads('0603');
  // ADS1115 SOIC-10（简化为 SOIC-8 + 2 extra）
  // 引脚：1 ADDR 2 VDD 3 SDA 4 SCL 5 ALERT 6 AIN0 7 AIN1 8 GND
  [[1,'gnd'],[2,'vcc'],[3,'sda'],[4,'scl'],[5,'alert'],[6,'ain0'],[7,'ain1'],[8,'gnd']].forEach(([p,n],i) => {
    const row = i < 4 ? 0 : 1;
    const col = i % 4;
    add('U1', p, n, 15+col*2.54, 8+row*3.5, 1.2, 1.2, 'circle', 'both', 0.35);
  });
  // I2C 上拉
  place('R1', fp603.map(f=>({...f})), 8, 4, i=>i===1?'sda':'vcc');
  place('R2', fp603.map(f=>({...f})), 11, 4, i=>i===1?'scl':'vcc');
  // AIN 滤波 RC
  place('R3', fp603.map(f=>({...f})), 8, 16, i=>i===1?'ain0':'ain0_f');
  place('C1', fp603.map(f=>({...f})), 11, 18, i=>i===1?'ain0_f':'gnd');
  place('R4', fp603.map(f=>({...f})), 14, 16, i=>i===1?'ain0_f':'ain0');
  // J1 I2C 头, J2 传感器输入
  ['vcc','gnd','sda','scl'].forEach((n,i) => add('J1', i+1, n, 2, 4+i*2.54, 1.5, 1.5, 'circle', 'both', 0.4));
  ['ain0','gnd'].forEach((n,i) => add('J2', i+1, n, 2, 14+i*2.54, 1.5, 1.5, 'circle', 'both', 0.4));
  save('n9-ads1115', { U1:{x:17.5,y:9.75,rot:0,layer:'top',value:'ADS1115',footprint:'SOIC-10'},
    R1:{x:8,y:4,rot:0,layer:'top',value:'10k',footprint:'R0603'},
    R2:{x:11,y:4,rot:0,layer:'top',value:'10k',footprint:'R0603'},
    R3:{x:8,y:16,rot:0,layer:'top',value:'1k',footprint:'R0603'},
    R4:{x:14,y:16,rot:0,layer:'top',value:'1k',footprint:'R0603'},
    C1:{x:11,y:18,rot:0,layer:'top',value:'100nF',footprint:'C0603'},
    J1:{x:2,y:7.8,rot:90,layer:'top',value:'I2C',footprint:'HDR-4P'},
    J2:{x:2,y:15.3,rot:90,layer:'top',value:'SENSOR',footprint:'HDR-2P'} });
}

// ===== N10: 双 LQFP48 SPI 通信板 =====
{
  const nets = [{ id: 'v33', name: '3V3' }, { id: 'gnd', name: 'GND' },
                { id: 'osc_in', name: 'OSC_IN' }, { id: 'osc_out', name: 'OSC_OUT' },
                { id: 'nrst', name: 'NRST' }, { id: 'swdio', name: 'SWDIO' }, { id: 'swclk', name: 'SWCLK' },
                { id: 'spi_sck', name: 'SPI_SCK' }, { id: 'spi_mosi', name: 'SPI_MOSI' },
                { id: 'spi_miso', name: 'SPI_MISO' }, { id: 'spi_cs', name: 'SPI_CS' }];
  const { d, pads, add, save } = makeDesign('N10 双 LQFP48 SPI 通信板', {
    width: 70, height: 40, grid: 0.25, trackW: 0.15, clearance: 0.1, viaOuter: 0.6, viaDrill: 0.3, layers: 2, nets
  });
  // 双 LQFP48：U1 主机(x=18,y=20)，U2 从机(x=52,y=20)
  for (const [comp, cx] of [['U1', 18], ['U2', 52]]) {
    const per = 12, off = 4.25;
    const pinNet = (comp === 'U1') ? (pin => ({
      5: 'osc_in', 6: 'osc_out', 7: 'nrst', 8: 'gnd', 9: 'v33',
      23: 'gnd', 24: 'v33', 35: 'gnd', 36: 'v33', 47: 'gnd', 48: 'v33',
      34: 'swdio', 37: 'swclk',
      30: 'spi_sck', 33: 'spi_mosi', 32: null, 31: 'spi_miso', 15: 'spi_cs'
    }[pin])) : (pin => ({
      5: 'osc_in', 6: 'osc_out', 7: 'nrst', 8: 'gnd', 9: 'v33',
      23: 'gnd', 24: 'v33', 35: 'gnd', 36: 'v33', 47: 'gnd', 48: 'v33',
      30: 'spi_sck', 33: 'spi_mosi', 32: null, 31: 'spi_miso', 15: 'spi_cs'
    }[pin]));
    for (let k = 0; k < per; k++) { const t=(k-(per-1)/2)*0.5; add(comp, k+1, pinNet(k+1)||null, cx-off, 20+t, 1.5, 0.3, 'rect', 'top'); }
    for (let k = 0; k < per; k++) { const t=(k-(per-1)/2)*0.5; add(comp, k+13, pinNet(k+13)||null, cx+t, 20+off, 0.3, 1.5, 'rect', 'top'); }
    for (let k = 0; k < per; k++) { const t=(k-(per-1)/2)*0.5; add(comp, k+25, pinNet(k+25)||null, cx+off, 20-t, 1.5, 0.3, 'rect', 'top'); }
    for (let k = 0; k < per; k++) { const t=(k-(per-1)/2)*0.5; add(comp, k+37, pinNet(k+37)||null, cx-t, 20-off, 0.3, 1.5, 'rect', 'top'); }
  }
  d.keepouts.push({ x: 18, y: 20, w: 6.5, h: 6.5 });
  d.keepouts.push({ x: 52, y: 20, w: 6.5, h: 6.5 });
  // 晶振 ×2
  add('Y1', 1, 'osc_in', 14, 12, 2, 1.2);
  add('Y1', 2, 'osc_out', 18, 12, 2, 1.2);
  add('Y2', 1, 'osc_in', 48, 12, 2, 1.2);
  add('Y2', 2, 'osc_out', 52, 12, 2, 1.2);
  // SWD
  ['v33','swdio','swclk','gnd'].forEach((n,i)=>add('J1', i+1, n, 4, 12+i*2.54, 1.5, 1.5, 'circle', 'both', 0.4));
  ['v33','swdio','swclk','gnd'].forEach((n,i)=>add('J2', i+1, n, 66, 12+i*2.54, 1.5, 1.5, 'circle', 'both', 0.4));
  // 去耦
  add('C1', 1, 'v33', 18, 30, 0.8, 0.6, 'rect', 'top');
  add('C2', 1, 'v33', 52, 30, 0.8, 0.6, 'rect', 'top');
  save('n10-dual-lqfp48', {});
}

// ===== N11: 高密度混合板（DIP-28 + SOIC-16 + LQFP48）=====
{
  const nets = [{ id: 'v5', name: '5V' }, { id: 'gnd', name: 'GND' },
    { id: 'rst', name: 'RST' }, { id: 'sck', name: 'SCK' }, { id: 'mosi', name: 'MOSI' }, { id: 'miso', name: 'MISO' },
    { id: 'sh_cp', name: 'SH_CP' }, { id: 'st_cp', name: 'ST_CP' }, { id: 'q7s', name: 'Q7S' }, { id: 'ds', name: 'DS' },
    { id: 'tx', name: 'TX' }, { id: 'rx', name: 'RX' }];
  const { d, pads, add, save } = makeDesign('N11 高密度混合板', {
    width: 70, height: 45, grid: 0.5, trackW: 0.2, clearance: 0.15, viaOuter: 0.6, viaDrill: 0.3, nets
  });
  // U1 STM32 LQFP48
  for (let k = 0; k < 12; k++) { const t=(k-(11)/2)*0.5; add('U1', k+1, null, 18-4.25, 20+t, 1.5, 0.3, 'rect', 'top'); }
  for (let k = 0; k < 12; k++) { const t=(k-(11)/2)*0.5; add('U1', k+13, null, 18+t, 20+4.25, 0.3, 1.5, 'rect', 'top'); }
  for (let k = 0; k < 12; k++) { const t=(k-(11)/2)*0.5; add('U1', k+25, {30:'sck',33:'mosi'}[k+25]||null, 18+4.25, 20-t, 1.5, 0.3, 'rect', 'top'); }
  for (let k = 0; k < 12; k++) { const t=(k-(11)/2)*0.5; add('U1', k+37, {37:'swclk',34:'swdio',5:'osc_in',6:'osc_out',7:'nrst'}[k+37]||null, 18-t, 20-4.25, 0.3, 1.5, 'rect', 'top'); }
  d.keepouts.push({ x: 18, y: 20, w: 6.5, h: 6.5 });
  // U2 ATmega328 DIP-28
  for (let k = 0; k < 14; k++) { const t=(k-(13)/2)*2.54; add('U2', k+1, {1:'rst',7:'v5',8:'gnd',17:'mosi',18:'miso',19:'sck',2:'tx',3:'rx'}[k+1]||null, 40, 22.5+t, 1.2, 1.2, 'circle', 'both', 0.45); }
  for (let k = 0; k < 14; k++) { const t=(k-(13)/2)*2.54; add('U2', k+15, null, 40+7.62, 22.5+t, 1.2, 1.2, 'circle', 'both', 0.45); }
  // U3/U4 74HC595 SOIC-16
  for (const [comp, x, y] of [['U3', 60, 10], ['U4', 60, 30]]) {
    const lv = comp==='U3' ? ['mosi',null,null,null,null,null,null,null] : ['q7s',null,null,null,null,null,null,null];
    const rv = ['q7s','gnd','sh_cp','st_cp','gnd',null,null,'v5'];
    for (let k = 0; k < 8; k++) { const t=(k-3.5)*1.27;
      add(comp, k+1, lv[k]||null, x-2.7, y-3.81+t, 1.5, 0.6, 'rect', 'top');
      add(comp, k+9, rv[k]||null, x+2.7, y-3.81+t, 1.5, 0.6, 'rect', 'top');
    }
  }
  // 去耦
  add('C1', 1, 'v5', 18, 32, 0.8, 0.6, 'rect', 'top');
  add('C2', 1, 'v5', 40, 6, 0.8, 0.6, 'rect', 'top');
  add('C3', 1, 'v5', 60, 5, 0.8, 0.6, 'rect', 'top');
  // J1 SWD
  ['v5','swdio','swclk','gnd'].forEach((n,i)=>add('J1', i+1, n, 4, 14+i*2.54, 1.5, 1.5, 'circle', 'both', 0.4));
  save('n11-mixed-dense', {});
}

// ===== N12: 4 层板 ESP32 载板重跑（从 H3 复制改 4 层）=====
{
  const h3 = JSON.parse(readFileSync(new URL('../round2/h3-esp12f/design.json', base), 'utf8'));
  h3.layers = 4;
  const dir = new URL('n12-4layer/', base);
  mkdirSync(dir, { recursive: true });
  writeFileSync(new URL('n12-4layer/design.json', base), JSON.stringify(h3, null, 1));
  console.log('N12 4 层 ESP32:', h3.pads.length, 'pads /', h3.nets.length, 'nets / layers', h3.layers);
}
