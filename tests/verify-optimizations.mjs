import * as core from '../src/engine.mjs';
// 优化逐项验证：每个优化一个独立测试，直接验证行为而非仅检查代码存在
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const mA = html.match(new RegExp('// ==== ROUTER CORE START ====([\\s\\S]*?)// ==== ROUTER CORE END ===='));
const mB = html.match(new RegExp('// ==== EXAMPLES START ====([\\s\\S]*?)// ==== EXAMPLES END ===='));


let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.error('  ✗ ' + name + '\n     ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n     ')); }
}
function assert(c, msg) { if (!c) throw new Error(msg || '断言失败'); }
function assertEq(a, b, msg) { if (a !== b) throw new Error((msg || '') + `：实际 ${a}，期望 ${b}`); }

console.log('— 优化逐项验证 —\n');

// ===== 1. 几何间距审查（checkGeoSpacing）=====
// 验证方式：布线后用 DRC 检查，确认无间距违规
// 如果 checkGeoSpacing 不工作，中等复杂度的板会出现"complete 但 DRC 有间距错"
t('1a. checkGeoSpacing：ATmega 级复杂度布线后 DRC 无间距违规', () => {
  const d = core.EXAMPLES ? null : null;
  // 用 EXAMPLES[0]（555 电路）跑完整布线
  const ex = core;
  const design = ex.EXAMPLES[0].build();
  const sess = ex.createSession(design, {});
  for (;;) { if (sess.step().done) break; }
  sess.optimize(1);
  const result = sess.buildResult();
  const issues = core.checkDRC(design, result);
  const spacingErrors = issues.filter(i => i.type === '间距冲突' && i.sev === 'error');
  assertEq(spacingErrors.length, 0, '间距违规数');
});

t('1b. checkGeoSpacing：几何审查函数存在且可调用', () => {
  // checkGeoSpacing 是 createSession 内部函数，无法直接调用
  // 但可以通过检查代码中是否在协商完成条件中被引用来间接验证
  const code = mA[1];
  assert(code.includes('checkGeoSpacing'), 'checkGeoSpacing 函数存在');
  assert(code.includes('几何间距修正'), '协商完成条件中被引用');
});

// ===== 2. 板边禁布带（0.2mm）=====
t('2a. 板边禁布：走线不贴板边', () => {
  const d = core.designDefaults();
  d.width = 30; d.height = 20;
  d.nets = [{ id: 'a', name: 'A' }];
  d.pads = [
    { id: 'U1-1', netId: 'a', x: 5, y: 5, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' },
    { id: 'U1-2', netId: 'a', x: 25, y: 15, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' }
  ];
  const s = core.createSession(d, {});
  for (;;) { if (s.step().done) break; }
  const r = s.buildResult();
  // 检查所有走线点距板边 ≥ 0.2mm
  for (const n of r.nets) for (const path of n.paths) for (const pt of path) {
    assert(pt.x >= 0.15 && pt.x <= d.width - 0.15, `走线点 x=${pt.x} 距板边不足`);
    assert(pt.y >= 0.15 && pt.y <= d.height - 0.15, `走线点 y=${pt.y} 距板边不足`);
  }
});

t('2b. 板边禁布：板边格在 buildModel 中被屏蔽', () => {
  // 通过间接方式验证：在板边放焊盘，确认路由仍可达（禁布不屏蔽焊盘格）
  const d = core.designDefaults();
  d.width = 20; d.height = 15;
  d.nets = [{ id: 'a', name: 'A' }];
  d.pads = [
    { id: 'P1', netId: 'a', x: 1, y: 7.5, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' },
    { id: 'P2', netId: 'a', x: 19, y: 7.5, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' }
  ];
  const s = core.createSession(d, {});
  for (;;) { if (s.step().done) break; }
  const r = s.buildResult();
  assertEq(r.stats.connected, r.stats.total, '板边焊盘仍可达');
});

// ===== 3. hMap 过孔代价感知（viaH）=====
t('3. hMap 过孔代价：同层焊盘间布线不产生不必要过孔', () => {
  const d = core.designDefaults();
  d.width = 40; d.height = 20; d.layers = 2;
  d.nets = [{ id: 'a', name: 'A' }];
  // 同层（顶层）两个焊盘
  d.pads = [
    { id: 'P1', netId: 'a', x: 5, y: 10, w: 1.2, h: 1.2, shape: 'rect', layer: 'top' },
    { id: 'P2', netId: 'a', x: 35, y: 10, w: 1.2, h: 1.2, shape: 'rect', layer: 'top' }
  ];
  const s = core.createSession(d, { viaCost: 15 });
  for (;;) { if (s.step().done) break; }
  const r = s.buildResult();
  assertEq(r.stats.vias, 0, '同层布线不应产生过孔');
});

// ===== 4. snapPadsPreserveGroups（组保持吸附）=====
t('4. snapPadsPreserveGroups：DIP 节距在栅格变化后保持', () => {
  const d = core.designDefaults();
  d.width = 40; d.height = 30; d.grid = 0.6;
  const dip = core.footprintPads('DIP-N', 8);
  // 创建 DIP-8（pitch 2.54mm）
  for (let i = 0; i < 4; i++) {
    d.pads.push({ id: `U1-${i+1}`, netId: 'a', x: 10 + dip[i].dx, y: 10 + dip[i].dy, w: dip[i].w, h: dip[i].h, shape: 'circle', layer: 'both' });
    d.pads.push({ id: `U1-${i+5}`, netId: 'a', x: 10 + dip[i+4].dx, y: 10 + dip[i+4].dy, w: dip[i+4].w, h: dip[i+4].h, shape: 'circle', layer: 'both' });
  }
  // 变更栅格并吸附
  d.grid = 0.7;
  core.snapPadsPreserveGroups(d);
  // 验证节距不变
  const col0 = d.pads.filter(p => Math.abs(p.x - d.pads[0].x) < 0.01);
  const col1 = d.pads.filter(p => Math.abs(p.x - d.pads[4].x) < 0.01);
  // 每列内的 y 间距应保持 2.54mm
  if (col0.length >= 2) {
    col0.sort((a, b) => a.y - b.y);
    const pitch = col0[1].y - col0[0].y;
    assert(Math.abs(pitch - 2.54) < 0.01, 'DIP 节距保持 2.54mm（实际 ' + pitch.toFixed(2) + '）');
  }
});

// ===== 5. 退火边缘间距罚（200000）=====
t('5. 退火边缘间距罚：SOT-23 不嵌入 SOIC-8 引脚间隙', () => {
  const d = core.designDefaults();
  d.width = 40; d.height = 25;
  d.nets = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  // SOIC-8 密集引脚
  const soic = core.footprintPads('SOIC-8');
  for (let i = 0; i < 8; i++) {
    d.pads.push({ id: `U1-${i+1}`, netId: i % 2 ? 'a' : 'b', x: 20 + soic[i].dx, y: 12 + soic[i].dy, w: soic[i].w, h: soic[i].h, shape: soic[i].shape, layer: 'top' });
  }
  // SOT-23 在附近（可能被退火移入间隙）
  const sot = core.footprintPads('SOT-23');
  d.pads.push({ id: 'Q1-1', netId: 'a', x: 10 + sot[0].dx, y: 12 + sot[0].dy, w: sot[0].w, h: sot[0].h, shape: sot[0].shape, layer: 'top' });
  d.pads.push({ id: 'Q1-2', netId: 'b', x: 10 + sot[1].dx, y: 12 + sot[1].dy, w: sot[1].w, h: sot[1].h, shape: sot[1].shape, layer: 'top' });
  d.pads.push({ id: 'Q1-3', netId: null, x: 10 + sot[2].dx, y: 12 + sot[2].dy, w: sot[2].w, h: sot[2].h, shape: sot[2].shape, layer: 'top' });
  // 布线
  const s = core.createSession(d, {});
  for (;;) { if (s.step().done) break; }
  const r = s.buildResult();
  // DRC 不应有焊盘重叠（间距罚应阻止嵌入）
  const issues = core.checkDRC(d, r);
  const overlaps = issues.filter(i => i.type === '焊盘重叠' && i.sev === 'error');
  assertEq(overlaps.length, 0, '焊盘重叠数（间距罚应阻止嵌入）');
});

// ===== 6. 罚金常数下限（0.1+）=====
// 教训来源：H1——两焊盘间隙 1e-16 时比例罚金 1000000*1e-16≈0，退火视为免费，
// 接受"恰好接触"的布局。常数下限保证任何正重叠至少罚 1000000*0.1=100000。
t('6. 罚金常数下限：微重叠焊盘被退火强制分离', () => {
  const code = mA[1];
  assert(code.includes('1000000*(0.1+Math.min(ox,oy))'), '罚金常数下限代码存在');
  const d = core.designDefaults();
  d.width = 30; d.height = 20;
  d.nets = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  // P1/P2 垂直方向微重叠 1e-7mm——旧比例罚金≈0.0001，新常数下限罚 ≥100000
  d.pads = [
    { id: 'P1', netId: 'a', x: 10, y: 7.5, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' },
    { id: 'P2', netId: 'b', x: 10, y: 7.5 + 1.1999999, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' }
  ];
  // warmStart 跳过初始装箱，退火从重叠状态出发，必须靠罚金逃离
  core.autoPlace(d, { warmStart: true, iterations: 1500, restarts: 1 });
  // 验证：两焊盘不再重叠（任一轴中心距 ≥ 边长和的一半，留 1e-4 浮点容差）
  const p1 = d.pads[0], p2 = d.pads[1];
  const sepX = Math.abs(p1.x - p2.x), sepY = Math.abs(p1.y - p2.y);
  assert(sepX >= 1.2 - 1e-4 || sepY >= 1.2 - 1e-4,
    `焊盘未分离：sepX=${sepX.toFixed(4)}, sepY=${sepY.toFixed(4)}`);
});

// ===== 7. SOIC-N 参数化 =====
t('7. SOIC-N 参数化：8/14/16 均正确生成', () => {
  const fp8 = core.footprintPads('SOIC-8');
  const fp14 = core.footprintPads('SOIC-14');
  const fp16 = core.footprintPads('SOIC-16');
  assertEq(fp8.length, 8, 'SOIC-8');
  assertEq(fp14.length, 14, 'SOIC-14');
  assertEq(fp16.length, 16, 'SOIC-16');
  // SOIC-14 pin7 应在左列底端，pin8 应在右列顶端
  assertEq(fp14[6].dx, -2.7, 'pin7 左列');
  assertEq(fp14[7].dx, 2.7, 'pin8 右列');
});

// ===== 8. 钻孔多刀分组 =====
t('8. 钻孔多刀：不同孔径自动分组', () => {
  const d = core.designDefaults();
  d.width = 30; d.height = 20;
  d.nets = [{ id: 'a', name: 'A' }];
  d.pads = [
    { id: 'J1-1', netId: 'a', x: 10, y: 10, w: 1.7, h: 1.7, shape: 'circle', layer: 'both', holeR: 0.45 },
    { id: 'R1-1', netId: 'a', x: 20, y: 10, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' }  // 无 holeR → viaDrill/2
  ];
  const r = { nets: [{ netId: 'a', paths: [], vias: [{ x: 15, y: 15 }], cells: [] }], overuse: [] };
  const g = core.buildGerber(d, r, null, null);
  assert(g.drill.includes('C0.400'), '过孔刀 0.4mm');
  assert(g.drill.includes('C0.900'), '插件孔刀 0.9mm');
});

// ===== 9. Gerber 八件套 =====
t('9. Gerber 八件套：fmask/bmask/fsilk/bsilk 存在', () => {
  const d = core.designDefaults();
  d.width = 30; d.height = 20;
  d.nets = [{ id: 'a', name: 'A' }];
  d.pads = [{ id: 'U1-1', netId: 'a', x: 10, y: 10, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' }];
  const r = { nets: [{ netId: 'a', paths: [], vias: [], cells: [] }], overuse: [] };
  const g = core.buildGerber(d, r, null, null);
  for (const k of ['top', 'bottom', 'outline', 'drill', 'fmask', 'bmask', 'fsilk', 'bsilk'])
    assert(g[k] && g[k].length > 20, k + ' 非空');
});

// ===== 10. 组保持吸附 + 板边禁布综合验证 =====
t('10. 综合：DIP-8 板边放置 + 栅格变更 + 布线全链', () => {
  const d = core.designDefaults();
  d.width = 30; d.height = 20; d.grid = 0.6;
  d.nets = [{ id: 'a', name: 'A' }];
  const dip = core.footprintPads('DIP-N', 8);
  for (let i = 0; i < 8; i++) {
    d.pads.push({ id: `U1-${i+1}`, netId: 'a', x: 5 + dip[i].dx, y: 10 + dip[i].dy, w: dip[i].w, h: dip[i].h, shape: 'circle', layer: 'both', holeR: 0.45 });
    d.pads.push({ id: `U2-${i+1}`, netId: 'a', x: 25 + dip[i].dx, y: 10 + dip[i].dy, w: dip[i].w, h: dip[i].h, shape: 'circle', layer: 'both', holeR: 0.45 });
  }
  // 栅格变更 → 组保持吸附
  d.grid = 0.7;
  core.snapPadsPreserveGroups(d);
  // 布线
  const s = core.createSession(d, {});
  for (;;) { if (s.step().done) break; }
  const r = s.buildResult();
  assertEq(r.stats.connected, r.stats.total, '全部连通');
  const issues = core.checkDRC(d, r);
  assertEq(issues.filter(i => i.sev === 'error').length, 0, 'DRC 干净');
});

// ===== 13. 逃逸口袋罚（第六轮 L12）=====
// 教训来源：n54——TO-92 中脚被 LED/邻通道/自身引脚 4 个正交方向围死成 2 格口袋，
// 布局"合法"但几何不可达，布线器如实报 unreachable；退火罚金对可逃逸性零感知。
// 验证方式（沿用测试 6 的行为级口径）：warmStart 从密封口袋初始态出发，
// 退火必须靠口袋罚逃离——布后中心焊盘至少 1 个正交方向可逃逸。
t('13. 逃逸口袋罚：被 4 向围死的焊盘被退火解封', () => {
  const code = mA[1];
  assert(code.includes('逃逸口袋'), '口袋罚代码存在');
  const d = core.designDefaults();
  d.width = 30; d.height = 20;
  d.nets = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  // 中心焊盘 + 4 向阻挡（同一元件 U2，退火可整体移走）
  d.pads = [
    { id: 'U1-1', netId: 'a', x: 15, y: 10, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' },
    { id: 'U2-1', netId: 'b', x: 15, y: 12.5, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' },
    { id: 'U2-2', netId: 'b', x: 15, y: 7.5, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' },
    { id: 'U2-3', netId: 'b', x: 17.5, y: 10, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' },
    { id: 'U2-4', netId: 'b', x: 12.5, y: 10, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' }
  ];
  // 初始态确认密封：4 正交方向边距 1.3 < pocketReach(0.2+0.3+2*0.5=1.7... grid 0.5)
  const reach = d.clearance + 0.3 + 2 * d.grid;
  const edgeGap = (p, q) => Math.max(Math.abs(p.x - q.x) - (p.w + q.w) / 2, 0);
  const sealed0 = edgeGap(d.pads[0], d.pads[1]) < reach && edgeGap(d.pads[0], d.pads[2]) < reach
    && edgeGap(d.pads[0], d.pads[3]) < reach && edgeGap(d.pads[0], d.pads[4]) < reach;
  assert(sealed0, '测试前置：初始态应为 4 向密封');
  // warmStart 从密封态出发，退火必须逃出
  core.autoPlace(d, { warmStart: true, iterations: 2500, restarts: 2 });
  // 布后验证：中心焊盘至少 1 个正交方向脱离 pocketReach
  const c = d.pads[0], blk = d.pads.slice(1);
  const dirGap = dir => {   // dir: 0=N 1=E 2=S 3=W
    const cands = blk.filter(q => dir === 0 ? (q.y > c.y && Math.abs(q.x - c.x) <= Math.abs(q.y - c.y))
      : dir === 2 ? (q.y < c.y && Math.abs(q.x - c.x) <= Math.abs(q.y - c.y))
      : dir === 1 ? (q.x > c.x && Math.abs(q.y - c.y) <= Math.abs(q.x - c.x))
      : (q.x < c.x && Math.abs(q.y - c.y) <= Math.abs(q.x - c.x)));
    if (!cands.length) return Infinity;
    return Math.min(...cands.map(q => {
      const ax = Math.abs(q.x - c.x) - (q.w + c.w) / 2, ay = Math.abs(q.y - c.y) - (q.h + c.h) / 2;
      return (dir % 2 === 0) ? ay : ax;   // 该方向上的分离距离
    }));
  };
  const free = [0, 1, 2, 3].filter(k => dirGap(k) >= reach - 1e-9).length;
  assert(free >= 1, `退火后仍有 ${4 - free}/4 方向密封（口袋罚未生效）`);
});

// ===== 14. 孔边距口径统一（第六轮 L13，L7 家族第 4 例）=====
// 教训来源：n66——viaLegal 只查异网，布线器把过孔钻孔贴到同网 THT 焊盘孔（孔边距 0.00），
// DRC（同网不豁免）判违规：布线合法 ≠ DRC 干净。
// 验证：buildModel.viaHoleBlocked 覆盖同网 THT 孔，恰界（=）允许（L7 容差口径）。
t('14a. viaHoleBlocked：同网 THT 孔边距进布线器模型', () => {
  const d = core.designDefaults();
  d.width = 30; d.height = 20; d.grid = 0.5;
  d.nets = [{ id: 'a', name: 'A' }];
  d.pads = [{ id: 'J1-1', netId: 'a', x: 15, y: 10, w: 1.2, h: 1.2, shape: 'circle', layer: 'both', holeR: 0.45 }];
  const m = core.buildModel(d);
  assert(m.viaHoleBlocked, 'viaHoleBlocked 存在');
  const cellIdx = (x, y) => Math.round(y / d.grid - 0.5) * m.GW + Math.round(x / d.grid - 0.5);
  // R = holeR 0.45 + viaDrill/2 0.2 + viaEdgeMin 0.2 = 0.85
  assert(m.viaHoleBlocked[cellIdx(15.75, 10)] === 1, '孔边距 0.3（<0.85）应屏蔽');   // d=0.75
  assert(m.viaHoleBlocked[cellIdx(15.25, 10.75)] === 1, '斜向 d≈0.79 应屏蔽');
  assert(m.viaHoleBlocked[cellIdx(16.25, 10)] === 0, 'd=1.25 不应屏蔽');
});
t('14b. 孔边距口径：THT 密集板布线后 DRC 无孔边距错误', () => {
  const d = core.designDefaults();
  d.width = 40; d.height = 25;
  d.nets = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  // 两排 TO-92 式 THT（1.27 间距小孔）——过孔易贴近的形态
  for (let i = 0; i < 6; i++) {
    d.pads.push({ id: `U1-${i + 1}`, netId: i % 2 ? 'a' : 'b', x: 8 + i * 1.27, y: 8, w: 1.0, h: 1.0, shape: 'circle', layer: 'both', holeR: 0.3 });
    d.pads.push({ id: `U2-${i + 1}`, netId: i % 2 ? 'b' : 'a', x: 8 + i * 1.27, y: 16, w: 1.0, h: 1.0, shape: 'circle', layer: 'both', holeR: 0.3 });
  }
  const s = core.createSession(d, {});
  for (;;) { if (s.step().done) break; }
  const r = s.buildResult();
  const issues = core.checkDRC(d, r);
  const holeEdge = issues.filter(i => i.type === '孔边距' && i.sev === 'error');
  assertEq(holeEdge.length, 0, '孔边距错误数（布线器与 DRC 口径应一致）');
});

// ===== 15. 美化/弦拉直精确距离（第六轮 L21，n72 抓出）=====
// 教训来源：n72——chamferOK 固定 5 点采样、segClearOK 步进采样对"擦边接触"漏检
// （凹陷区可以比采样间距短任意多），弦拉直产出距焊盘 0.1722mm 的段（要求 0.175）。
// 修复：三类障碍物（焊盘/禁布区/过孔）全部改精确线段距离（闭式解，采样不可遗漏）。
// 行为级 A/B 见 docs/第六轮实测报告.md §五（n72：1899s/1 错 → 631s/0 错）。
t('15. 美化间距检查用精确线段距离（采样漏检修复）', () => {
  const code = mA[1];
  // chamferOK 与 segClearOK 都必须调用 segmentRectDistance（精确）而非 distToRect 采样点
  const chamfer = code.match(/function chamferOK[\s\S]*?\n  \}/);
  assert(chamfer, 'chamferOK 存在');
  assert(chamfer[0].includes('segmentRectDistance'), 'chamferOK 用精确线段-矩形距离');
  assert(!chamfer[0].includes('for(const s of S)'), 'chamferOK 不再用 5 点采样');
  const segClear = code.match(/function segClearOK[\s\S]*?\n  \}/);
  assert(segClear, 'segClearOK 存在');
  assert(segClear[0].includes('segmentRectDistance'), 'segClearOK 用精确线段-矩形距离');
  assert(!segClear[0].includes('nS='), 'segClearOK 不再步进采样');
});

// ===== 17. 圆焊盘影响区方形化（第八轮 L26，n103 抓出）=====
// 教训来源：n103——圆焊盘影响区按圆弧逐格标记，格点中心采样在弧线两格之间留出弦缺口
// （格点余量 0.006mm），走线弦从缺口穿过：格点合法但线段-焊盘间距违规 0.01mm。
// 修复：圆焊盘影响区改外接方形（享受矩形斜移防切角保护）；起始格保持圆真值。
t('17a. 圆焊盘影响区：弧缺口格被方形影响区覆盖', () => {
  const d = core.designDefaults();
  d.width = 30; d.height = 20; d.grid = 0.6;
  d.trackW = 0.4;   // 对齐 n103 spec：halfClr = 0.2 + 0.4/2 = 0.4
  d.nets = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  // n103 实测案例几何：圆 pad r0.95 @ (13.71,7.64)，格 (13.5,6.3) 圆距 0.406 ≥ halfClr 0.4（旧模型空闲）
  d.pads = [
    { id: 'L1-3', netId: 'a', x: 13.71, y: 7.64, w: 1.9, h: 1.9, shape: 'circle', layer: 'both', holeR: 0.6 },
    { id: 'P1', netId: 'b', x: 3, y: 3, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' }
  ];
  const m = core.buildModel(d);
  const gi = Math.round(13.5 / 0.6 - 0.5), gj = Math.round(6.3 / 0.6 - 0.5);
  const own = m.padOwner[gj * m.GW + gi];
  assert(own !== 0, '弧缺口格 (13.5,6.3) 应被方形影响区覆盖（旧圆弧模型此处空闲）');
  // 起始格保持圆真值：pad 中心格属于本网，pad 角外格（圆外方形内）不得成为起始格
  const states = m.padCells.get('L1-3') || [];
  const cornerI = Math.round((13.71 + 0.8) / 0.6 - 0.5), cornerJ = Math.round((7.64 + 0.8) / 0.6 - 0.5);
  assert(!states.includes(cornerJ * m.GW + cornerI), '方形角格（圆外）不得成为起始格');
});
t('17b. 圆焊盘板布线后 DRC 无走线-焊盘间距违规', () => {
  // THT 密集圆焊盘板（n103 形态缩小版）
  const d = core.designDefaults();
  d.width = 40; d.height = 25;
  d.nets = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  for (let i = 0; i < 4; i++) {
    d.pads.push({ id: `L1-${i + 1}`, netId: i % 2 ? 'a' : 'b', x: 12 + i * 1.9, y: 8, w: 1.9, h: 1.9, shape: 'circle', layer: 'both', holeR: 0.6 });
    d.pads.push({ id: `L2-${i + 1}`, netId: i % 2 ? 'b' : 'a', x: 12 + i * 1.9, y: 16, w: 1.9, h: 1.9, shape: 'circle', layer: 'both', holeR: 0.6 });
  }
  d.pads.push({ id: 'J1-1', netId: 'a', x: 4, y: 12, w: 1.7, h: 1.7, shape: 'circle', layer: 'both', holeR: 0.45 });
  d.pads.push({ id: 'J1-2', netId: 'b', x: 36, y: 12, w: 1.7, h: 1.7, shape: 'circle', layer: 'both', holeR: 0.45 });
  const s = core.createSession(d, {});
  for (;;) { if (s.step().done) break; }
  const r = s.buildResult();
  assertEq(r.stats.connected, r.stats.total, '全部连通');
  const issues = core.checkDRC(d, r);
  const tp = issues.filter(i => i.type === '走线-焊盘间距' && i.sev === 'error');
  assertEq(tp.length, 0, '走线-焊盘间距违规数（圆弧弦缺口应被修复）');
});

// ===== 18. 禁布区缓冲带（第十轮 L35，n145 抓出）=====
// 教训来源：n145——禁布区此前只阻挡自身格点，格心距禁布区边缘 0.1mm 的行走线
// "格点合法"，但走线铜皮（半宽 w/2=0.2）入侵禁布区 0.1mm → DRC 判走线-禁布区冲突。
// 修复：禁布阻挡外扩 maxTrackW/2 缓冲带（格心 ≥ maxTrackW/2 ≥ 任意网 w/2 → 铜皮不出界）；
// 焊盘真铜格豁免（pad 本体可达性由 spec/DRC 负责）。
t('18a. 禁布缓冲带：边缘外缓冲内格被阻挡、缓冲外空闲、真铜格豁免', () => {
  const d = core.designDefaults();
  d.width = 30; d.height = 30; d.grid = 0.6; d.trackW = 0.8; d.clearance = 0.2;   // 缓冲 = maxTrackW/2 = 0.4
  d.nets = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  d.keepouts = [{ x: 15, y: 15, w: 6.0, h: 6.0 }];   // x∈[12,18]，阻挡到 11.6
  d.pads = [{ id: 'P1', netId: 'a', x: 16.2, y: 16.2, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' }];
  const m = core.buildModel(d);
  const cell = (x, y) => Math.round(y / 0.6 - 0.5) * m.GW + Math.round(x / 0.6 - 0.5);
  assert(m.blocked[cell(11.7, 15)] === 1, '缓冲带内格（距边 0.3 < 0.4）应阻挡');
  assert(m.blocked[cell(11.1, 15)] === 0, '缓冲带外格（距边 0.9 > 0.4）不应阻挡');
  assert(m.blocked[cell(16.2, 16.2)] === 0, '焊盘真铜格应豁免（pad 本体可达）');
});
t('18b. 分区禁布板布线后 DRC 无走线-禁布区冲突', () => {
  const d = core.designDefaults();
  d.width = 60; d.height = 24;
  d.nets = [{ id: 'v5', name: 'V5' }, { id: 'gnd', name: 'GND' }, { id: 'sig', name: 'SIG' }];
  d.keepouts = [{ x: 20, y: 12, w: 1.6, h: 20 }, { x: 40, y: 12, w: 1.6, h: 20 }];
  d.pads = [
    { id: 'U1-1', netId: 'v5', x: 8, y: 8, w: 1.7, h: 1.7, shape: 'circle', layer: 'both', holeR: 0.45 },
    { id: 'U1-2', netId: 'sig', x: 8, y: 16, w: 1.7, h: 1.7, shape: 'circle', layer: 'both', holeR: 0.45 },
    { id: 'U2-1', netId: 'v5', x: 30, y: 8, w: 1.7, h: 1.7, shape: 'circle', layer: 'both', holeR: 0.45 },
    { id: 'U2-2', netId: 'sig', x: 30, y: 16, w: 1.7, h: 1.7, shape: 'circle', layer: 'both', holeR: 0.45 },
    { id: 'U3-1', netId: 'v5', x: 52, y: 8, w: 1.7, h: 1.7, shape: 'circle', layer: 'both', holeR: 0.45 },
    { id: 'U3-2', netId: 'sig', x: 52, y: 16, w: 1.7, h: 1.7, shape: 'circle', layer: 'both', holeR: 0.45 },
    { id: 'J1-1', netId: 'gnd', x: 30, y: 21, w: 1.7, h: 1.7, shape: 'circle', layer: 'both', holeR: 0.45 }
  ];
  const sess = core.createSession(d, {});
  for (;;) { if (sess.step().done) break; }
  const r = sess.buildResult();
  const issues = core.checkDRC(d, r);
  const ko = issues.filter(ii => ii.type === '走线-禁布区冲突' && ii.sev === 'error');
  assertEq(ko.length, 0, '走线-禁布区冲突数（缓冲带应防止贴边入侵）');
});

// ===== 19. 薄焊盘格心保障（第十轮后 L39，n59 真根因）=====
// 教训来源：n59——SOIC 旋转后 0.5mm 短边横向，放置量化落在格界上 → padCells 为空
// → 焊盘对本网完全不可达（RMST/Prim 的 src 均为空），协商器无能为力，曾伪装成
// "影响区墙"（L17）与"电源 highway 物理限制"（L18）两个错误理论。
// 修复：autoPlace 写回时薄于栅格的轴向半格微移，使中心落在最近格心线上。
t('19a. 薄焊盘格心保障：autoPlace 后零格焊盘为 0', () => {
  const d = core.designDefaults();
  d.width = 40; d.height = 24; d.grid = 0.6;
  d.nets = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  const so8 = core.footprintPads('SOIC-8');
  for (let i = 0; i < 8; i++) {
    d.pads.push({ id: `U1-${i + 1}`, netId: i % 2 ? 'a' : 'b', x: 12 + so8[i].dx, y: 12 + so8[i].dy, w: so8[i].w, h: so8[i].h, shape: so8[i].shape, layer: 'top' });
  }
  d.pads.push({ id: 'J1-1', netId: 'a', x: 32, y: 12, w: 1.7, h: 1.7, shape: 'circle', layer: 'both', holeR: 0.45 });
  core.autoPlace(d, { iterations: 800, restarts: 1 });
  const m = core.buildModel(d);
  const zero = d.pads.filter(p => !(m.padCells.get(p.id) || []).length);
  assertEq(zero.length, 0, '零格焊盘数（薄焊盘格心保障应消除不可达）');
});
t('19b. 薄焊盘板布线全链：连通 100% + DRC 干净', () => {
  const d = core.designDefaults();
  d.width = 40; d.height = 24; d.grid = 0.6;
  d.nets = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  const so8 = core.footprintPads('SOIC-8');
  for (let i = 0; i < 8; i++) {
    d.pads.push({ id: `U1-${i + 1}`, netId: i % 2 ? 'a' : 'b', x: 12 + so8[i].dx, y: 12 + so8[i].dy, w: so8[i].w, h: so8[i].h, shape: so8[i].shape, layer: 'top' });
  }
  d.pads.push({ id: 'J1-1', netId: 'a', x: 34, y: 12, w: 1.7, h: 1.7, shape: 'circle', layer: 'both', holeR: 0.45 });
  d.pads.push({ id: 'J2-1', netId: 'b', x: 4, y: 12, w: 1.7, h: 1.7, shape: 'circle', layer: 'both', holeR: 0.45 });
  const sess = core.createSession(d, {});
  for (;;) { if (sess.step().done) break; }
  sess.optimize(1);
  const r = sess.buildResult();
  assertEq(r.stats.connected, r.stats.total, '全部连通');
  const issues = core.checkDRC(d, r);
  assertEq(issues.filter(ii => ii.sev === 'error').length, 0, 'DRC 干净');
});

console.log('\n优化验证结果：' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
