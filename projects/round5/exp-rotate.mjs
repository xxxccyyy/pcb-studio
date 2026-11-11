// 实验：autoPlace 旋转 + 刚性组吸附是否破坏 2 行排针几何
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const mA = html.match(new RegExp('// ==== ROUTER CORE START ====([\\s\\S]*?)// ==== ROUTER CORE END ===='));
const mB = html.match(new RegExp('// ==== EXAMPLES START ====([\\s\\S]*?)// ==== EXAMPLES END ===='));
const core = new Function(mA[1] + '\n' + mB[1] + '\nreturn {autoPlace, designDefaults};')();

// 构造 2×5 排针 + 一个 TQFP44（强制退火旋转排针）
const d = core.designDefaults();
d.width = 40; d.height = 30; d.grid = 0.25;
d.nets = Array.from({ length: 12 }, (_, i) => ({ id: 'n' + i, name: 'N' + i }));
// 模拟 n45：JTAG 排针多脚同网（gnd x5）
const dupNets = ['vcc', 'gnd', 'pc5', 'pc3', 'pc2', 'gnd', 'pc4', 'gnd', 'gnd', 'gnd'];
const hd2x5 = [];
for (let k = 0; k < 5; k++) for (const dy of [-1.27, 1.27])
  hd2x5.push({ dx: (k - 2) * 2.54, dy, w: 1.7, h: 1.7, shape: 'circle', layer: 'both', holeR: 0.45 });
hd2x5.forEach((f, i) => d.pads.push({ id: `J1-${i + 1}`, netId: dupNets[i], x: 30 + f.dx, y: 15 + f.dy, w: f.w, h: f.h, shape: 'circle', layer: 'both', holeR: f.holeR }));
// 一个占位元件在左边（给退火移动空间）
for (let i = 0; i < 4; i++) d.pads.push({ id: `U1-${i + 1}`, netId: 'n' + i, x: 8 + (i % 2) * 2.54, y: 10 + Math.floor(i / 2) * 2.54, w: 1.2, h: 1.2, shape: 'rect', layer: 'top' });
d.comps = { J1: { x: 30, y: 15, rot: 0 }, U1: { x: 9.27, y: 11.27, rot: 0 } };

console.log('放置前 J1 焊盘:');
for (const p of d.pads.filter(p => p.id.startsWith('J1'))) console.log(' ', p.id, p.x, p.y);
core.autoPlace(d, { iterations: 500, restarts: 1, seed: 42 });
console.log('放置后 J1 焊盘（comps.J1=', JSON.stringify(d.comps.J1), '）:');
const j1 = d.pads.filter(p => p.id.startsWith('J1'));
for (const p of j1) console.log(' ', p.id, p.x, p.y);
// 节距检查
const xs = [...new Set(j1.map(p => p.x))].sort((a, b) => a - b);
const ys = [...new Set(j1.map(p => p.y))].sort((a, b) => a - b);
console.log('唯一 x:', xs.join(','), ' 唯一 y:', ys.join(','));
