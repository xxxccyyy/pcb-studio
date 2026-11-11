// E4 简单：TP4056 锂电充电板 —— USB → 充电管理 → 电池头 + 双 LED 指示
// TP4056 SOIC-8: 1 TEMP 2 PROG 3 GND 4 BAT 5 STD/BY 6 CHRG 7 CE 8 VCC
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
const mA = html.match(new RegExp('// ==== ROUTER CORE START ====([\\s\\S]*?)// ==== ROUTER CORE END ===='));
const mB = html.match(new RegExp('// ==== EXAMPLES START ====([\\s\\S]*?)// ==== EXAMPLES END ===='));
const core = new Function(mA[1] + '\n' + mB[1] + '\nreturn {footprintPads, designDefaults};')();
const d = core.designDefaults();
d.width = 35; d.height = 22; d.grid = 0.6;
d.trackW = 0.4; d.clearance = 0.2; d.viaOuter = 0.8; d.viaDrill = 0.4;
d.nets = [{ id: 'v5', name: '5V' }, { id: 'gnd', name: 'GND' }, { id: 'bat', name: 'BAT' }, { id: 'prog', name: 'PROG' }, { id: 'chrg', name: 'CHRG' }, { id: 'stdby', name: 'STDBY' }, { id: 'chrg_led', name: 'CHRG_LED' }, { id: 'std_led', name: 'STDBY_LED' }];
const pads = [];
const add = (c, p, n, x, y, w, h, shape, layer, holeR) =>
  pads.push({ id: `${c}-${p}`, netId: n, x: +x.toFixed(4), y: +y.toFixed(4), w, h, shape: shape || 'rect', layer: layer || 'top', holeR });
const fp603 = core.footprintPads('0603');
const place = (comp, fp, cx, cy, netOf, layerOf) => {
  fp.forEach((f, i) => add(comp, i + 1, netOf(i + 1), cx + f.dx, cy + f.dy, f.w, f.h, f.shape, layerOf ? layerOf(i + 1) : f.layer, f.holeR));
};
// U1 TP4056 SOIC-8
place('U1', core.footprintPads('SOIC-8'), 17.5, 11, pin => ({
  1: 'gnd', 2: 'prog', 3: 'gnd', 4: 'bat', 5: 'stdby', 6: 'chrg', 7: 'gnd', 8: 'v5'
}[pin] || null));
// R2 PROG 1.2k → GND
place('R2', fp603.map(f => ({ ...f })), 22.5, 15.5, i => i === 1 ? 'prog' : 'gnd');
// LED CHRG（红）+ LED STDBY（蓝）+ R3/R4 限流
place('R3', fp603.map(f => ({ ...f })), 12.5, 5, i => i === 1 ? 'chrg' : 'chrg_led');
place('LED1', fp603.map(f => ({ ...f })), 17, 5, i => i === 1 ? 'chrg_led' : 'gnd');
place('R4', fp603.map(f => ({ ...f })), 22.5, 5, i => i === 1 ? 'stdby' : 'std_led');
place('LED2', fp603.map(f => ({ ...f })), 27.5, 5, i => i === 1 ? 'std_led' : 'gnd');
// J1 USB 5V/GND、J2 电池 BAT/GND
add('J1', 1, 'v5', 3, 18, 1.7, 1.7, 'circle', 'both', 0.45);
add('J1', 2, 'gnd', 5.54, 18, 1.7, 1.7, 'circle', 'both', 0.45);
add('J2', 1, 'bat', 32, 18, 1.7, 1.7, 'circle', 'both', 0.45);
add('J2', 2, 'gnd', 29.46, 18, 1.7, 1.7, 'circle', 'both', 0.45);
d.pads = pads;
d.comps = {
  U1: { x: 17.5, y: 11, rot: 0, layer: 'top', value: 'TP4056', footprint: 'SOIC-8' },
  R2: { x: 22.5, y: 15.5, rot: 0, layer: 'top', value: '1.2k', footprint: 'R0603' },
  R3: { x: 12.5, y: 5, rot: 0, layer: 'top', value: '1k', footprint: 'R0603' },
  R4: { x: 22.5, y: 5, rot: 0, layer: 'top', value: '1k', footprint: 'R0603' },
  LED1: { x: 17, y: 5, rot: 0, layer: 'top', value: 'LED Red', footprint: 'LED0603' },
  LED2: { x: 27.5, y: 5, rot: 0, layer: 'top', value: 'LED Blue', footprint: 'LED0603' },
  J1: { x: 4.3, y: 18, rot: 90, layer: 'top', value: 'USB', footprint: 'HDR-2P' },
  J2: { x: 30.7, y: 18, rot: 90, layer: 'top', value: 'BAT', footprint: 'HDR-2P' }
};
mkdirSync(new URL('./', import.meta.url), { recursive: true });
writeFileSync(new URL('./design.json', import.meta.url), JSON.stringify(d, null, 1));
console.log('E4 spec:', pads.length, 'pads /', d.nets.length, 'nets');
