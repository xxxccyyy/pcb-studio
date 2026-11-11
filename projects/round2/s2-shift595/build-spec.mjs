// S2 超难：STM32 LQFP48 + 2× 74HC595 SOIC-16 级联 LED 驱动
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
const mA = html.match(new RegExp('// ==== ROUTER CORE START ====([\\s\\S]*?)// ==== ROUTER CORE END ===='));
const mB = html.match(new RegExp('// ==== EXAMPLES START ====([\\s\\S]*?)// ==== EXAMPLES END ===='));
const core = new Function(mA[1] + '\n' + mB[1] + '\nreturn {designDefaults};')();
const d = core.designDefaults();
d.width = 55; d.height = 40; d.grid = 0.25;
d.trackW = 0.15; d.clearance = 0.1; d.viaOuter = 0.6; d.viaDrill = 0.3;
const nets = [{ id: 'v33', name: '3V3' }, { id: 'gnd', name: 'GND' },
  { id: 'osc_in', name: 'OSC_IN' }, { id: 'osc_out', name: 'OSC_OUT' },
  { id: 'nrst', name: 'NRST' }, { id: 'swdio', name: 'SWDIO' }, { id: 'swclk', name: 'SWCLK' },
  { id: 'spi_sck', name: 'SPI_SCK' }, { id: 'spi_mosi', name: 'SPI_MOSI' },
  { id: 'sh_cp1', name: 'SH_CP1' }, { id: 'st_cp1', name: 'ST_CP1' },
  { id: 'sh_cp2', name: 'SH_CP2' }, { id: 'st_cp2', name: 'ST_CP2' },
  { id: 'q7s', name: 'Q7S' }, { id: 'oe', name: 'OE' }];
d.nets = nets;
const pads = [];
const add = (c, p, n, x, y, w, h, shape, layer, holeR) =>
  pads.push({ id: `${c}-${p}`, netId: n, x: +x.toFixed(4), y: +y.toFixed(4), w, h, shape: shape || 'rect', layer: layer || 'top', holeR });
// U1 STM32 LQFP48（只接必要引脚，其余悬空）
{
  const per = 12, off = 4.25;
  const pinNet = pin => ({
    5: 'osc_in', 6: 'osc_out', 7: 'nrst', 8: 'gnd', 9: 'v33',
    23: 'gnd', 24: 'v33', 35: 'gnd', 36: 'v33', 47: 'gnd', 48: 'v33',
    34: 'swdio', 37: 'swclk',
    30: 'spi_sck', 33: 'spi_mosi',
    25: 'sh_cp1', 26: 'st_cp1', 29: 'sh_cp2', 28: 'st_cp2'
  }[pin]);
  for (let k = 0; k < per; k++) { const t = (k - (per-1)/2)*0.5; add('U1', k+1, pinNet(k+1)||null, 25-off, 20+t, 1.5, 0.3, 'rect', 'top'); }
  for (let k = 0; k < per; k++) { const t = (k-(per-1)/2)*0.5; add('U1', k+13, pinNet(k+13)||null, 25+t, 20+off, 0.3, 1.5, 'rect', 'top'); }
  for (let k = 0; k < per; k++) { const t = (k-(per-1)/2)*0.5; add('U1', k+25, pinNet(k+25)||null, 25+off, 20-t, 1.5, 0.3, 'rect', 'top'); }
  for (let k = 0; k < per; k++) { const t = (k-(per-1)/2)*0.5; add('U1', k+37, pinNet(k+37)||null, 25-t, 20-off, 0.3, 1.5, 'rect', 'top'); }
}
d.keepouts.push({ x: 25, y: 20, w: 6.5, h: 6.5 });
// U2/U3 74HC595 SOIC-16
// 引脚：1-8 Q1-Q8, 9 Q7S, 10 MR, 11 SH_CP, 12 ST_CP, 13 OE, 14 DS, 15 Q0, 16 VCC
for (const [comp, x, y, ds, sh, st] of [['U2', 12, 8, 'spi_mosi', 'sh_cp1', 'st_cp1'],
                                         ['U3', 12, 28, 'q7s', 'sh_cp2', 'st_cp2']]) {
  const y0 = y - 3.81, y1 = y + 3.81;
  const pns = [ds, null, null, null, null, null, null, null, 'q7s' === ds ? null : 'q7s', 'gnd', sh, st, 'gnd', null, null, 'v33'];
  // 左列 1-8（上→下），右列 9-16（下→上）
  const lv = [ds, null, null, null, null, null, null, null];
  const rv = ['q7s'===ds?'oe':(comp==='U3'?'oe':'q7s'), 'gnd', sh, st, 'gnd', null, null, 'v33'];
  for (let k = 0; k < 8; k++) {
    const t = (k - 3.5) * 1.27;
    add(comp, k + 1, lv[k] || null, x - 2.7, y0 + t, 1.5, 0.6, 'rect', 'top');
    add(comp, k + 9, rv[k] || null, x + 2.7, y0 + t, 1.5, 0.6, 'rect', 'top');
  }
}
// Y1 8MHz + C×2
add('Y1', 1, 'osc_in', 25, 12, 2, 1.2);
add('Y1', 2, 'osc_out', 29, 12, 2, 1.2);
const fp402 = core.footprintPads ? [] : [];
add('C11', 1, 'osc_in', 22, 10, 0.8, 0.6, 'rect', 'top');
add('C12', 1, 'osc_out', 32, 10, 0.8, 0.6, 'rect', 'top');
// NRST C+R
add('CNR', 1, 'nrst', 28, 28, 0.8, 0.6, 'rect', 'top');
add('CNR', 2, 'gnd', 29.8, 28, 0.8, 0.6, 'rect', 'top');
// 去耦
add('C1', 1, 'v33', 18, 20, 0.8, 0.6, 'rect', 'top');
add('C1', 2, 'gnd', 18, 21, 0.8, 0.6, 'rect', 'top');
add('C2', 1, 'v33', 32, 20, 0.8, 0.6, 'rect', 'top');
add('C2', 2, 'gnd', 32, 21, 0.8, 0.6, 'rect', 'top');
// SWD 头
['v33', 'swdio', 'swclk', 'gnd'].forEach((n, i) =>
  add('J1', i + 1, n, 40, 18 + i * 2.54, 1.5, 1.5, 'circle', 'both', 0.4));
d.pads = pads;
mkdirSync(new URL('./', import.meta.url), { recursive: true });
writeFileSync(new URL('./design.json', import.meta.url), JSON.stringify(d, null, 1));
console.log('S2 spec:', pads.length, 'pads /', d.nets.length, 'nets');
