// H1 困难档：CH340G USB 转串口板
// CH340G SOIC-16（数据手册）：1 GND / 2 TXD / 3 RXD / 4 V3(5V供电接100nF到地)
// 5 UD+ / 6 UD- / 7 XI / 8 XO / 13 DTR / 16 VCC；12MHz 晶振于 XI/XO
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const mA = html.match(new RegExp('// ==== ROUTER CORE START ====([\\s\\S]*?)// ==== ROUTER CORE END ===='));
const mB = html.match(new RegExp('// ==== EXAMPLES START ====([\\s\\S]*?)// ==== EXAMPLES END ===='));
const core = new Function(mA[1] + '\n' + mB[1] + '\nreturn {footprintPads, designDefaults};')();

const d = core.designDefaults();
d.width = 60; d.height = 35; d.grid = 0.6;   // 本板 <50mA，0.4 电源线足够
d.trackW = 0.4; d.clearance = 0.2; d.viaOuter = 0.8; d.viaDrill = 0.4;
d.nets = [
  { id: 'v5', name: '5V' }, { id: 'gnd', name: 'GND' },
  { id: 'txd', name: 'TXD' }, { id: 'rxd', name: 'RXD' }, { id: 'dtr', name: 'DTR' },
  { id: 'udp', name: 'UD_P' }, { id: 'udn', name: 'UD_N' },
  { id: 'xi', name: 'XI' }, { id: 'xo', name: 'XO' }, { id: 'v3', name: 'V3' }
];
const pads = [];
const add = (c, p, n, x, y, w, h, shape, layer, holeR) =>
  pads.push({ id: `${c}-${p}`, netId: n, x: +x.toFixed(4), y: +y.toFixed(4), w, h, shape: shape || 'rect', layer: layer || 'top', holeR });
const fp603 = core.footprintPads('0603');
const place = (comp, fp, cx, cy, netOf, layerOf) => {
  fp.forEach((f, i) => add(comp, i + 1, netOf(i + 1), cx + f.dx, cy + f.dy, f.w, f.h, f.shape, layerOf ? layerOf(i + 1) : f.layer, f.holeR));
};
// U1 CH340G SOIC-16
place('U1', core.footprintPads('SOIC-16'), 30, 15, pin => ({
  1: 'gnd', 2: 'txd', 3: 'rxd', 4: 'v3', 5: 'udp', 6: 'udn', 7: 'xi', 8: 'xo',
  13: 'dtr', 16: 'v5'
}[pin] || null));
// Y1 12MHz 晶振 + 负载电容（XI=7 左上引脚，晶振放左上）
add('Y1', 1, 'xi', 20.5, 8, 2, 1.5);
add('Y1', 2, 'xo', 24.5, 8, 2, 1.5);
place('C11', fp603.map(f => ({ ...f })), 18, 6, i => i === 1 ? 'xi' : 'gnd');
place('C12', fp603.map(f => ({ ...f })), 26, 6, i => i === 1 ? 'xo' : 'gnd');
// C1 V3 去耦、C2 VCC 去耦
place('C1', fp603.map(f => ({ ...f })), 30, 22.5, i => i === 1 ? 'v3' : 'gnd');
place('C2', fp603.map(f => ({ ...f })), 34, 22.5, i => i === 1 ? 'v5' : 'gnd');
// USB mini 连接器（5 通孔焊盘：1 VBUS 2 D- 3 D+ 4 ID(悬空) 5 GND）
add('USB1', 1, 'v5', 6, 6, 1.5, 1.5, 'circle', 'both', 0.45);
add('USB1', 2, 'udn', 6, 9, 1.5, 1.5, 'circle', 'both', 0.45);
add('USB1', 3, 'udp', 6, 12, 1.5, 1.5, 'circle', 'both', 0.45);
add('USB1', 4, null, 6, 15, 1.5, 1.5, 'circle', 'both', 0.45);
add('USB1', 5, 'gnd', 6, 18, 1.5, 1.5, 'circle', 'both', 0.45);
// LED1 电源（5V→R1→LED→GND）、LED2/3 在 TXD/RXD 上
place('R1', fp603.map(f => ({ ...f })), 12, 22, i => i === 1 ? 'v5' : 'pwr_led');
place('LED1', fp603.map(f => ({ ...f })), 16, 22, i => i === 1 ? 'pwr_led' : 'gnd');
place('R2', fp603.map(f => ({ ...f })), 40, 6, i => i === 1 ? 'txd' : 'txd_led');
place('LED2', fp603.map(f => ({ ...f })), 44, 6, i => i === 1 ? 'txd_led' : 'gnd');
place('R3', fp603.map(f => ({ ...f })), 40, 22.5, i => i === 1 ? 'rxd' : 'rxd_led');
place('LED3', fp603.map(f => ({ ...f })), 44, 22.5, i => i === 1 ? 'rxd_led' : 'gnd');
// J1 串口排针 1×5：5V TX RX GND DTR
['v5', 'txd', 'rxd', 'gnd', 'dtr'].forEach((n, i) =>
  add('J1', i + 1, n, 52, 6 + i * 3, 1.7, 1.7, 'circle', 'both', 0.45));
d.pads = pads;
d.nets.push({ id: 'pwr_led', name: 'PWR_LED' }, { id: 'txd_led', name: 'TXD_LED' }, { id: 'rxd_led', name: 'RXD_LED' });
d.comps = {
  U1: { x: 30, y: 15, rot: 0, layer: 'top', value: 'CH340G', footprint: 'SOIC-16' },
  Y1: { x: 22.5, y: 8, rot: 0, layer: 'top', value: '12MHz', footprint: 'XTAL-49S' },
  C11: { x: 18, y: 6, rot: 0, layer: 'top', value: '20pF', footprint: 'C0603', lcsc: 'C1648' },
  C12: { x: 26, y: 6, rot: 0, layer: 'top', value: '20pF', footprint: 'C0603', lcsc: 'C1648' },
  C1: { x: 30, y: 22.5, rot: 0, layer: 'top', value: '100nF', footprint: 'C0603', lcsc: 'C1591' },
  C2: { x: 34, y: 22.5, rot: 0, layer: 'top', value: '100nF', footprint: 'C0603', lcsc: 'C1591' },
  USB1: { x: 6, y: 12, rot: 90, layer: 'top', value: 'USB Mini', footprint: 'USB-MINI-B' },
  R1: { x: 12, y: 22, rot: 0, layer: 'top', value: '1k', footprint: 'R0603', lcsc: 'C21190' },
  LED1: { x: 16, y: 22, rot: 0, layer: 'top', value: 'LED Red', footprint: 'LED0603', lcsc: 'C2286' },
  R2: { x: 40, y: 6, rot: 0, layer: 'top', value: '1k', footprint: 'R0603', lcsc: 'C21190' },
  LED2: { x: 44, y: 6, rot: 0, layer: 'top', value: 'LED Green', footprint: 'LED0603', lcsc: 'C72043' },
  R3: { x: 40, y: 22.5, rot: 0, layer: 'top', value: '1k', footprint: 'R0603', lcsc: 'C21190' },
  LED3: { x: 44, y: 22.5, rot: 0, layer: 'top', value: 'LED Green', footprint: 'LED0603', lcsc: 'C72043' },
  J1: { x: 52, y: 18, rot: 90, layer: 'top', value: 'SERIAL', footprint: 'HDR-5P-2.54' }
};
mkdirSync(new URL('./', import.meta.url), { recursive: true });
writeFileSync(new URL('./design.json', import.meta.url), JSON.stringify(d, null, 1));
console.log('H1 spec:', pads.length, 'pads /', d.nets.length, 'nets');
