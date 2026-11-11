// ATmega328P 最小系统板 —— spec 生成器（AI 从"资料"构建设计 JSON）
// 资料来源（AI 决策记录）：
//   - ATmega328P DIP-28 引脚定义：数据手册 §1（引脚通览），AI 已核对：
//     1 RESET 2 PD0/RX 3 PD1/TX 7 VCC 8 GND 9 XTAL1 10 XTAL2 14 PB0
//     20 AVCC 21 AREF 22 GND 23 PC0/ADC0
//   - NE555/按键/LED/阻容为通用元件；16MHz 晶振 HC-49S 两焊盘间距 11mm
// 决策：双层板、线宽 0.4（电源载流与信号布通的折中）、栅格 0.6（=线宽+间距）
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const mA = html.match(new RegExp('// ==== ROUTER CORE START ====([\\s\\S]*?)// ==== ROUTER CORE END ===='));
const mB = html.match(new RegExp('// ==== EXAMPLES START ====([\\s\\S]*?)// ==== EXAMPLES END ===='));
const core = new Function(mA[1] + '\n' + mB[1] + '\nreturn {footprintPads, designDefaults};')();

const d = core.designDefaults();
d.width = 65; d.height = 45; d.grid = 0.6;
d.trackW = 0.4; d.clearance = 0.2; d.viaOuter = 0.8; d.viaDrill = 0.4;
d.name = 'atmega328p-minsys';

d.nets = [
  // 网络类：电源 0.5mm（1oz 1A 建议值），信号默认 0.4
  { id: 'vcc', name: 'VCC', w: 0.5 }, { id: 'gnd', name: 'GND', w: 0.5 },
  { id: 'reset', name: 'RESET' }, { id: 'xtal1', name: 'XTAL1', hs: true }, { id: 'xtal2', name: 'XTAL2', hs: true },
  { id: 'tx', name: 'TX' }, { id: 'rx', name: 'RX' },
  { id: 'pb0', name: 'PB0' }, { id: 'pb1', name: 'PB1' }, { id: 'adc0', name: 'ADC0' },
  { id: 'aref', name: 'AREF' }, { id: 'leda', name: 'LED_A' }
];
const N = Object.fromEntries(d.nets.map(n => [n.id, n.id]));   // id 即引用

let seq = 1;
const pads = [];
const add = (comp, pin, netId, x, y, w, h, shape, layer, holeR) =>
  pads.push({ id: `${comp}-${pin}`, netId, x: +x.toFixed(4), y: +y.toFixed(4), w, h, shape: shape || 'rect', layer: layer || 'both', holeR });
const placeComp = (comp, fp, cx, cy, netOf, layerOf) => {
  fp.forEach((f, i) => add(comp, i + 1, netOf(i + 1), cx + f.dx, cy + f.dy, f.w, f.h, f.shape, layerOf ? layerOf(i + 1) : f.layer, f.holeR));
};

// U1: ATmega328P DIP-28（2.54mm，排距 7.62）——引脚→网络按数据手册
// AI 决策：旋转 90° 横放并锚定在板中下部（autoPlace 的 anchor 参数）；
// 芯片两排引脚之间的体区加禁布（防止退火把去耦/晶振塞进芯片肚子里造成结构性拥塞）
{
  const fp = core.footprintPads('DIP-N', 28).map(f => ({ dx: -f.dy, dy: f.dx, w: f.w, h: f.h, shape: f.shape, layer: f.layer, holeR: f.holeR }));
  placeComp('U1', fp, 30, 30, pin => ({
    1: N.reset, 2: N.rx, 3: N.tx, 7: N.vcc, 8: N.gnd, 9: N.xtal1, 10: N.xtal2,
    14: N.pb0, 15: N.pb1, 20: N.vcc, 21: N.aref, 22: N.gnd, 23: N.adc0
  }[pin] || null));
}

// 晶振电路预布局（锚定，修正版）：整体移到 U1 顶排左段上方，让出右侧 x≈40 通道给
// ADC0 上行（上一版 XTAL2 横穿 ADC0 造成死锁）；XTAL1 走左、XTAL2 走右，互不交叉
add('Y1', 1, N.xtal1, 24.5, 17, 2.5, 2, 'rect', 'both', 0.45);
add('Y1', 2, N.xtal2, 35.5, 17, 2.5, 2, 'rect', 'both', 0.45);
const fp603 = core.footprintPads('0603');
placeComp('C5', fp603.map(f => ({ ...f })), 20.5, 17.5, i => i === 1 ? N.xtal1 : N.gnd, () => 'top');
placeComp('C6', fp603.map(f => ({ ...f })), 38.5, 17.5, i => i === 1 ? N.xtal2 : N.gnd, () => 'top');
// C1/C2: 100nF 去耦（VCC-GND）；C3: 10µF 储能；C4: AREF 100nF
// AI 决策：去耦电容手动锚定——紧贴各自 VCC/GND 引脚、但离开引脚逃逸走廊
// （退火只看线长会把电容压在走廊上堵死别的网络；去耦位置是布局知识，AI 负责）
// C1 ← U1-7 VCC(31.3,26.1) 上方；C2/C3 ← U1-20 VCC(33.8,33.8) 下方；C4 ← U1-21 AREF(36.3,33.8) 下方
placeComp('C1', fp603.map(f => ({ ...f })), 31.3, 20.1, i => i === 1 ? N.vcc : N.gnd, () => 'top');
placeComp('C2', fp603.map(f => ({ ...f })), 30.5, 39.5, i => i === 1 ? N.vcc : N.gnd, () => 'top');
placeComp('C3', core.footprintPads('0805'), 35.5, 39.5, i => i === 1 ? N.vcc : N.gnd, () => 'top');
placeComp('C4', fp603.map(f => ({ ...f })), 40.5, 39.5, i => i === 1 ? N.aref : N.gnd, () => 'top');
// R1: 10k RESET 上拉；R2: 330Ω LED 限流
placeComp('R1', fp603.map(f => ({ ...f })), 18, 10, i => i === 1 ? N.reset : N.vcc, () => 'top');
placeComp('R2', fp603.map(f => ({ ...f })), 51, 26, i => i === 1 ? N.pb0 : N.leda, () => 'top');
// LED1（0603）：阳极接 R2，阴极 GND
placeComp('LED1', fp603.map(f => ({ ...f })), 54, 26, i => i === 1 ? N.gnd : N.leda, () => 'top');
// SW1: 复位按键 6×6（1-2 一侧 RESET，3-4 另一侧 GND）
{
  const sw = [[-3.2, -2.3], [3.2, -2.3], [-3.2, 2.3], [3.2, 2.3]];
  sw.forEach(([dx, dy], i) => add('SW1', i + 1, i < 2 ? N.reset : N.gnd, 8 + dx, 37.5 + dy, 1.5, 1.5, 'rect', 'both', 0.45));   // 移出禁布带；孔 0.9mm
}
// J1: 串口排针（GND VCC TX RX RESET）；J2: 扩展排针 1×6
// AI 决策：① DTR 直连 RESET（自动复位简化）② 排针竖放贴右板边（横向放会超板宽被钳位挤重叠）
{
  const rot = fp => fp.map(f => ({ dx: f.dy, dy: f.dx, w: f.w, h: f.h, shape: f.shape, layer: f.layer, holeR: f.holeR }));
  placeComp('J1', rot(core.footprintPads('排针 1×N', 5)), 61, 8, i => [N.reset, N.rx, N.tx, N.vcc, N.gnd][i - 1] || null);   // RESET 放顶部（易逃逸）、GND 放底部（处处可连）
  placeComp('J2', rot(core.footprintPads('排针 1×N', 6)), 61, 32, i => [N.vcc, N.gnd, N.pb0, N.pb1, N.adc0, N.reset][i - 1] || null);
}

// 芯片体区禁布：U1 两排引脚（y≈26.2/33.8）之间的区域禁止放元件
// （引脚行间只留走线通道；匹配 autoPlace 的 keepout 罚 1e5）
d.keepouts.push({ x: 30, y: 30, w: 34.5, h: 5.4 });
d.pads = pads;
// 组件元数据（BOM/坐标文件/丝印用）：位置、旋转、层、值；lcsc 仅填已核实的
d.comps = {
  U1:{x:30,y:30,rot:90,layer:'top',value:'ATMEGA328P-PU',footprint:'DIP-28'},
  Y1:{x:32,y:20.5,rot:0,layer:'top',value:'16MHz HC-49S',footprint:'XTAL-49S'},
  C5:{x:24.5,y:23.5,rot:0,layer:'top',value:'22pF',footprint:'C0603',lcsc:'C1653'},
  C6:{x:39.5,y:23.5,rot:0,layer:'top',value:'22pF',footprint:'C0603',lcsc:'C1653'},
  C1:{x:31.3,y:20.1,rot:0,layer:'top',value:'100nF',footprint:'C0603',lcsc:'C1591'},
  C2:{x:30.5,y:39.5,rot:0,layer:'top',value:'100nF',footprint:'C0603',lcsc:'C1591'},
  C3:{x:35.5,y:39.5,rot:0,layer:'top',value:'10uF',footprint:'C0805',lcsc:'C15850'},
  C4:{x:40.5,y:39.5,rot:0,layer:'top',value:'100nF',footprint:'C0603',lcsc:'C1591'},
  R1:{x:18,y:10,rot:0,layer:'top',value:'10k',footprint:'R0603',lcsc:'C25804'},
  R2:{x:51,y:26,rot:0,layer:'top',value:'330R',footprint:'R0603',lcsc:'C23178'},
  LED1:{x:54,y:26,rot:0,layer:'top',value:'LED Red',footprint:'LED0603',lcsc:'C2286'},
  SW1:{x:8,y:37.5,rot:0,layer:'top',value:'RESET',footprint:'SW-6x6'},
  J1:{x:61,y:8,rot:90,layer:'top',value:'UART',footprint:'HDR-5P-2.54'},
  J2:{x:61,y:32,rot:90,layer:'top',value:'GPIO',footprint:'HDR-6P-2.54'}
};
// AI 决策记录：C1653/C25804/C23178/C2286/C15850 为常见值，投板前以嘉立创库在售/现货复核（erc/bom 会提示）
mkdirSync(new URL('./', import.meta.url), { recursive: true });
writeFileSync(new URL('./design.json', import.meta.url), JSON.stringify(d, null, 1));
console.log('spec written:', pads.length, 'pads /', d.nets.length, 'nets');
