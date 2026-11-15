// BG2208-4G 大电流铜带强化 v2：同网并行多线 + 逐段间距校验（对其它网络铜违规即弃）
// 泵 5A / 阀 / 模块 VBAT 2A——栅格 0.15mm 单线载流不足，以并行铜带补足。
// 用法：node reinforce.mjs  （读 result.json，写回 result.json；之后必须重跑 pour）
import * as core from '../../src/engine.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

const design = core.normalizeDesign(JSON.parse(readFileSync('design.json', 'utf8')));
const result = JSON.parse(readFileSync('result.json', 'utf8'));
const CLR = design.clearance;                    // 0.15
const HW = design.trackW / 2;                    // 0.075
const pads = {};
for (const p of design.pads) pads[p.id] = p;

// 其它网络的铜（pad 矩形 + 走线段 + 过孔圆），用于间距校验
const otherPads = [];
const otherSegs = [];
const otherVias = [];
for (const p of design.pads) {
  otherPads.push({ net: p.netId, id: p.id, x: p.x, y: p.y, w: p.w, h: p.h, shape: p.shape });
}
for (const n of result.nets) {
  for (const path of n.paths) for (let i = 1; i < path.length; i++) {
    if (path[i].l !== path[i-1].l) continue;
    otherSegs.push({ net: n.netId, x1: path[i-1].x, y1: path[i-1].y, x2: path[i].x, y2: path[i].y });
  }
  for (const v of n.vias || []) otherVias.push({ net: n.netId, x: v.x, y: v.y, r: (v.outer || design.viaOuter) / 2 });
}
const netById = {};
for (const n of design.nets) netById[n.id] = n.name;

// 校验：候选段（含半宽）对其它网铜的间距
function bandOK(netId, x1, y1, x2, y2) {
  const id = netId;
  // pad 矩形间距
  for (const p of otherPads) {
    if (p.net === id) continue;
    const dx = Math.max(p.x - p.w / 2 - Math.max(x1, x2), Math.min(x1, x2) - (p.x + p.w / 2), 0);
    const dy = Math.max(p.y - p.h / 2 - Math.max(y1, y2), Math.min(y1, y2) - (p.y + p.h / 2), 0);
    if (Math.hypot(dx, dy) < CLR + HW - 1e-9) return false;
  }
  // 走线段-段距离
  for (const s of otherSegs) {
    if (s.net === id) continue;
    if (core.segSegDist(x1, y1, x2, y2, s.x1, s.y1, s.x2, s.y2) < CLR + 2 * HW - 1e-9) return false;
  }
  // 过孔
  for (const v of otherVias) {
    if (v.net === id) continue;
    if (core.segDist(v.x, v.y, x1, y1, x2, y2) < CLR + HW + v.r - 1e-9) return false;
  }
  return true;
}
// 拆分为正交小段逐段校验；折线若任一段违规则整条丢弃
function pathOK(netId, pts) {
  for (let i = 1; i < pts.length; i++) {
    if (!bandOK(netId, pts[i-1][0], pts[i-1][1], pts[i][0], pts[i][1])) return false;
  }
  return true;
}

const netIdOf = name => { const n = design.nets.find(x => x.name === name); if (!n) throw new Error('无网 ' + name); return n.id; };
const G = name => result.nets.find(x => x.netId === netIdOf(name));
const padXY = id => { const p = pads[id]; if (!p) throw new Error('无焊盘 ' + id); return [p.x, p.y]; };
const L = 1, T = 0;
let added = 0, dropped = 0;

function addBand(netName, items) {
  const entry = G(netName);
  if (!entry) throw new Error('result 缺少 ' + netName);
  for (const item of items) {
    const poly = item.pts.map(([x, y]) => ({ x: +x.toFixed(3), y: +y.toFixed(3), l: item.l ?? L }));
    let ok = true;
    for (let i = 1; i < poly.length && ok; i++) ok = bandOK(entry.netId, poly[i-1].x, poly[i-1].y, poly[i].x, poly[i].y);
    if (ok) { entry.paths.push(poly); added++; }
    else dropped++;
  }
}

// ---- PUMP_D：12P-8/10 → MOS 漏极（5A）----
{
  const p8 = padXY('CON1-8'), p10 = padXY('CON1-10');
  const dr = ['U3-5', 'U3-6', 'U3-7', 'U3-8'].map(padXY);
  const exp = padXY('U3-9');
  const xEnd = Math.max(...dr.map(d => d[0])) + 0.5;
  const ys = [41.8, 42.4, 43.0, 43.6];
  for (const y of ys) addBand('PUMP_D', [{ l: L, pts: [[p8[0] + 0.9, p8[1]], [xEnd, y], [xEnd, y], [p10[0] + 0.9, p10[1]]] }]);
  for (const d of dr) addBand('PUMP_D', [{ l: L, pts: [[xEnd, 43.6], [xEnd, d[1]], [d[0] + 0.3, d[1]]] }]);
  addBand('PUMP_D', [{ l: L, pts: [[xEnd, 43.6], [xEnd, exp[1]], [exp[0], exp[1]]] }]);
}

// ---- VALVE_D：12P-12 → U4 漏极 ----
{
  const p12 = padXY('CON1-12');
  const dr = ['U4-5', 'U4-6', 'U4-7', 'U4-8'].map(padXY);
  const exp = padXY('U4-9');
  const xEnd = Math.max(...dr.map(d => d[0])) + 0.5;
  const ys = [55.0, 55.6];
  for (const y of ys) addBand('VALVE_D', [{ l: L, pts: [[p12[0] + 0.9, p12[1]], [p12[0] + 0.9, y], [xEnd, y], [dr[0][0] + 0.3, dr[0][1]]] }]);
  for (const d of dr.slice(1)) addBand('VALVE_D', [{ l: L, pts: [[xEnd, ys[1]], [xEnd, d[1]], [d[0] + 0.3, d[1]]] }]);
  addBand('VALVE_D', [{ l: L, pts: [[xEnd, ys[1]], [xEnd, exp[1]], [exp[0], exp[1]]] }]);
}

// ---- V24：F1 → 12P-7/9/11（顶层左中区空档）----
{
  const f1 = padXY('F1-2');
  const p7 = padXY('CON1-7'), p9 = padXY('CON1-9'), p11 = padXY('CON1-11');
  // 顶层竖带（正面左中部空旷）；F1 在背面——起点经 12P-1 通孔：V24IN 已由自动布线连通，
  // 铜带从 F1.2 焊盘正上方过孔下行。过孔放 F1 焊盘旁（同网），避免与其它网冲突由校验兜底
  const xs = [11.0, 11.6, 12.2, 12.8];
  const yTop = f1[1], yBot = p11[1] + 0.9;
  for (const x of xs) addBand('V24', [{ l: T, pts: [[f1[0] + 1.55, yTop], [f1[0] + 1.55, yTop - 0.6], [x, yTop - 0.6], [x, yBot]] }]);
  for (const pn of [p7, p9, p11]) addBand('V24', [{ l: T, pts: [[xs[0], yBot], [xs[3], yBot], [xs[3], pn[1]], [pn[0] + 1.55, pn[1]]] }]);
}

// ---- V4V0：L2 输出 → FB1/模块 VBAT（2A，顶层 y 5-13 空带）----
{
  const l2 = padXY('L2-2');
  const fb1 = padXY('FB1-1');
  const ys = [5.0, 5.5, 6.0, 6.5];
  for (const y of ys) addBand('V4V0', [{ l: T, pts: [[l2[0], y], [fb1[0] - 0.5, y], [fb1[0] - 0.5, y], [fb1[0], fb1[1]]] }]);
}

writeFileSync('result.json', JSON.stringify(result));
console.log('铜带强化完成：新增 ' + added + ' 条并行带（丢弃 ' + dropped + ' 条间距违规候选）');
console.log('⚠ 下一步必须重跑 pour（铜带先于铺铜，铺铜才会避让）');
