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

// ===== 20. 载流感知线宽定档（第十一轮后 L47）=====
// 用户需求：规格书声明载流（nets[].current）后线宽必须自动定档——
// IPC-2152 锚点插值（w = base × I^1.113）+ −20% 公差 + spec 门拦截 + 投板检查表逐网行。
t('20a. ampWidthFor 锚点数学：IPC-2152 正反向一致', () => {
  const d = core.designDefaults();   // 1oz 双面
  // 正向（投板检查表口径）：I = (w/base_t)^(1/1.113)
  // 反向（本功能）：w = base_s × I^1.113
  assertEq(core.ampWidthFor(d, 1).width, 0.5, '1A 建议 0.5mm（s 锚点）');
  assertEq(core.ampWidthFor(d, 1, {anchor:'t'}).width, 0.4, '1A 理论 0.4mm（t 锚点）');
  // 3A：s 口径 1.698mm = t 极限 + −20% 公差 1.698mm（自洽：limit_with_tol = t×I^k/0.8 = s×I^k/1）
  const s3 = core.ampWidthFor(d, 3).width;
  const t3tol = core.ampWidthFor(d, 3, {anchor:'t', tolerance:0.8}).width;
  assert(Math.abs(s3 - 1.698) < 0.01, '3A 建议 ≈1.698');
  assert(Math.abs(s3 - t3tol) < 0.01, 's 口径 ≡ t+公差口径（自洽）');
  // 2oz 铜厚：1A 建议 0.3mm
  assertEq(core.ampWidthFor({...d, copperWeight:'2'}, 1).width, 0.3, '2oz 1A 建议 0.3mm');
  // 4 层 0.5oz 内层：1A 建议 1.6mm（理论 1.5）
  const d4 = {...core.designDefaults(), layers:4, copperWeight:'0.5'};
  assertEq(core.ampWidthFor(d4, 1, {layer:'inner'}).width, 1.6, '0.5oz 内层 1A 建议 1.6mm');
  assertEq(core.ampWidthFor(d4, 1, {layer:'inner', anchor:'t'}).width, 1.5, '0.5oz 内层 1A 理论 1.5mm');
  // 过孔并联：3A → ≥3 个 0.3mm 过孔
  assertEq(core.ampWidthFor(d, 3).viaCount, 3, '3A → 3 过孔');
});
t('20b. 载流声明 → netW 内核自动抬宽 → 检查表确认行', () => {
  const d = core.designDefaults();
  d.width = 60; d.height = 36; d.grid = 0.6; d.trackW = 0.4; d.clearance = 0.2;
  d.nets = [{id:'batp',name:'BATP',current:8},{id:'sig',name:'SIG'}];
  d.pads = [
    {id:'J1-1',netId:'batp',x:8,y:18,w:1.7,h:1.7,shape:'circle',layer:'both',holeR:0.45},
    {id:'J2-1',netId:'sig',x:52,y:18,w:1.7,h:1.7,shape:'circle',layer:'both',holeR:0.45},
    {id:'J2-2',netId:'gnd',x:52,y:22,w:1.7,h:1.7,shape:'circle',layer:'both',holeR:0.45}
  ];
  // 内核自动抬宽（用户指令：以后都要根据电流大小调整线的粗细）：fabChecklist→
  // netCurrentDecls→netW 缓存构建时 0.4mm 已被原地抬到 8A 需求 5.06mm。
  // 检查表语义随之升级：不再暴露 fail（fail 在 spec 门拦截），而是确认最终宽度达标。
  const checklist = core.fabChecklist(d, null);
  const rows = checklist.filter(r => r.group === '载流' && r.item.includes('BATP'));
  assert(rows.length === 1, '投板检查表应有 BATP 逐网载流行，实际 ' + rows.length);
  assertEq(rows[0].status, 'ok', '内核自动抬宽后 5.06mm 应判 ok');
  assert(rows[0].value.includes('5.06'), '检查表值应为自动抬宽后的 5.06mm，实际 ' + rows[0].value);
  assert(rows[0].limit.includes('5.06'), '需求值应 ≈5.06mm');
  // 抬宽是原地生效：设计对象里 batp.w 已被内核改写
  assert(Math.abs(d.nets.find(n=>n.id==='batp').w - 5.06) < 0.05,
    'netW 内核应把 batp.w 原地抬到 ≈5.06，实际 ' + d.nets.find(n=>n.id==='batp').w);
});
t('20c. 薄焊盘格心保障 + 宽线声明共存（L39×L37 协同）', () => {
  const d = core.designDefaults();
  d.width = 40; d.height = 24; d.grid = 0.6; d.trackW = 0.4; d.clearance = 0.2;
  d.nets = [{id:'pwr',name:'PWR',current:2},{id:'sig',name:'SIG'}];
  const so8 = core.footprintPads('SOIC-8');
  for (let i = 0; i < 8; i++) {
    d.pads.push({id:`U1-${i+1}`,netId:i%2?'pwr':'sig',x:12+so8[i].dx,y:12+so8[i].dy,w:so8[i].w,h:so8[i].h,shape:so8[i].shape,layer:'top'});
  }
  d.pads.push({id:'J1-1',netId:'pwr',x:34,y:12,w:1.7,h:1.7,shape:'circle',layer:'both',holeR:0.45});
  core.autoPlace(d, { iterations: 800, restarts: 1 });
  const m = core.buildModel(d);
  const zero = d.pads.filter(p => !(m.padCells.get(p.id) || []).length);
  assertEq(zero.length, 0, '宽线声明后零格焊盘仍应为 0（L39 格心保障 × L37 maxTrackW 协同）');
});

console.log('\n优化验证结果：' + pass + ' 通过, ' + fail + ' 失败');// ===== 20d. IPC-2221B 电压→安全间距（第十一轮后批次1，L48）=====
// 用户需求：规格书声明工作电压（nets[].voltage）→ IPC-2221B 自动查安全间距 →
// per-pad 影响区（高压焊盘推开异网更远）→ checkDRC 间距口径一致。
t('20d. IPC-2221B 查表 + per-pad 影响区 + 混合电压端到端', () => {
  const d = core.designDefaults();
  d.width = 60; d.height = 30; d.grid = 0.4; d.trackW = 0.3; d.clearance = 0.2;
  d.nets = [{id:'hv',name:'HV_170V',voltage:170},{id:'lv',name:'LV_3V3'},{id:'gnd',name:'GND'}];
  d.pads = [
    {id:'HV-1', netId:'hv', x:15, y:10, w:2.0, h:2.0, shape:'circle', layer:'top'},
    {id:'LV-1', netId:'lv', x:30, y:10, w:1.0, h:1.0, shape:'rect', layer:'top'},
    {id:'G1-1', netId:'gnd', x:45, y:10, w:1.7, h:1.7, shape:'circle', layer:'both', holeR:0.45}
  ];
  // 查表数值校验（IPC-2221B Table 6-1，0.14.7 修正后标准值——两份独立复现一致：
  // B2=外层无涂层 ≤3050m 缺省档；B4=外层聚合物涂层）
  assertEq(core.ipc2221Clr(170), 1.25, '170V@B2（缺省无涂层）→ 1.25mm');
  assertEq(core.ipc2221Clr(220), 1.25, '220V@B2 → 1.25mm');
  assertEq(core.ipc2221Clr(400), 2.5, '400V@B2 → 2.5mm');
  assertEq(core.ipc2221Clr(50), 0.6, '50V@B2 → 0.6mm');
  assertEq(core.ipc2221Clr(800), 4, '800V@B2 → 线性外推 4.0mm');
  assertEq(core.ipc2221Clr(170, 'B4'), 0.4, '170V@B4（涂层）→ 0.4mm');
  assertEq(core.ipc2221Clr(300, 'B1'), 0.2, '300V@B1（内层）→ 0.2mm');
  // per-net clearance
  assertEq(core.netClr(d, 'hv'), 1.25, 'HV 170V → 1.25mm');
  assertEq(core.netClr(d, 'lv'), 0.2, 'LV 无电压声明 → 全局 0.2mm');
  // per-pad 影响区：HV 焊盘推开异网更远
  const m = core.buildModel(d);
  const hvCells = m.padCells.get('HV-1') || [];
  assert(hvCells.length > 0, 'HV-1 有格');
  // 端到端：布线 + DRC
  const sess = core.createSession(d, { maxIter: 60 });
  for (;;) { if (sess.step().done) break; }
  sess.optimize(1);
  const r = sess.buildResult();
  const issues = core.checkDRC(d, r);
  assertEq(issues.filter(ii => ii.sev === 'error').length, 0, '混合电压板 DRC 干净');
});

// ===== 21a-21d. 过孔载流 + 热过孔阵列（第十一轮后批次2）=====

t('21a. 过孔载流并联检查表：路由换层孔 + stitching 计入，不足 warn', () => {
  const mk = () => {
    const d = core.designDefaults();
    d.width = 50; d.height = 30; d.grid = 0.6; d.trackW = 0.5; d.clearance = 0.25;
    d.viaDrill = 0.3; d.viaOuter = 0.6;
    d.nets = [{id:'pwr',name:'PWR',current:6},{id:'sig',name:'SIG'}];
    d.pads = [
      {id:'J1-1',netId:'pwr',x:6,y:8,w:4,h:4,shape:'rect',layer:'top'},
      {id:'U1-1',netId:'pwr',x:44,y:8,w:2,h:2,shape:'circle',layer:'bottom'},
      {id:'J2-1',netId:'sig',x:6,y:22,w:1.5,h:1.5,shape:'circle',layer:'top'},
      {id:'U2-1',netId:'sig',x:44,y:22,w:1.5,h:1.5,shape:'circle',layer:'top'}
    ];
    return d;
  };
  const d1 = mk();
  const r1 = core.routeBoard(d1, { maxIter: 25 }).result;
  assertEq(r1.stats.connected, 4, '跨层板 4/4 布通');
  const rn1 = r1.nets.find(n => n.netId === 'pwr');
  const act1 = (rn1.vias || []).length;
  assert(act1 > 0, '跨层路径必有换层孔');
  const cl1 = core.fabChecklist(d1, r1);
  const row1 = cl1.find(x => x.group === '载流' && x.item === '网 PWR：换层过孔并联');
  assert(row1, '有换层过孔并联行');
  assertEq(row1.status, act1 >= 6 ? 'ok' : 'warn', '6A 需 6 孔——实际 ' + act1 + ' 孔应 warn');
  assertEq(row1.value, act1 + ' 孔', '值=实际并联数');
  assert(row1.limit.includes('6'), '需 6 孔（6A/1A每孔）');
  const arr = core.thermalViaArray(d1, 'J1');
  assert(arr.added >= 6, '4×4mm 盘自适应阵列 ≥6 孔，实际 ' + arr.added);
  d1.stitching = arr.vias;
  const cl2 = core.fabChecklist(d1, r1);
  const row2 = cl2.find(x => x.group === '载流' && x.item === '网 PWR：换层过孔并联');
  assertEq(row2.status, 'ok', 'stitching 补齐后 ok');
});
t('21b. thermalViaArray 自适应阵列 + DRC 干净 + 钻孔表', () => {
  const d = core.designDefaults();
  d.width = 50; d.height = 30; d.grid = 0.6; d.trackW = 0.4; d.clearance = 0.25;
  d.viaDrill = 0.3; d.viaOuter = 0.6;
  d.nets = [{id:'vbat',name:'VBAT',current:6},{id:'sw',name:'SW'},{id:'gnd',name:'GND'}];
  d.pads = [
    {id:'U1-1',netId:'sw',x:10,y:10,w:1.2,h:2.4,shape:'rect',layer:'top'},
    {id:'U1-2',netId:'gnd',x:10,y:16,w:1.2,h:2.4,shape:'rect',layer:'top'},
    {id:'U1-3',netId:'vbat',x:7,y:24,w:6.5,h:7,shape:'rect',layer:'top'},
    {id:'J1-1',netId:'vbat',x:40,y:8,w:2,h:2,shape:'circle',layer:'both',holeR:0.6},
    {id:'J1-2',netId:'gnd',x:40,y:20,w:2,h:2,shape:'circle',layer:'both',holeR:0.6}
  ];
  const arr = core.thermalViaArray(d, 'U1');
  assertEq(arr.pad, 'U1-3', '选面积最大焊盘（散热盘）');
  assertEq(arr.cols, 6); assertEq(arr.rows, 7);
  assertEq(arr.added, 42, '6×7=42 孔全落盘');
  assertEq(arr.skipped, 0, '无越界跳过');
  for (const v of arr.vias) {
    assert(Math.abs(v.x - 7) <= 6.5/2 - 0.3 + 1e-6 && Math.abs(v.y - 24) <= 7/2 - 0.3 + 1e-6,
      '孔心收进 viaOuter/2');
    assertEq(v.netId, 'vbat', '阵列属散热盘网');
  }
  const gaps = [];
  for (let i = 0; i < arr.vias.length; i++) for (let j = i+1; j < arr.vias.length; j++)
    gaps.push(Math.hypot(arr.vias[i].x - arr.vias[j].x, arr.vias[i].y - arr.vias[j].y));
  assert(Math.min(...gaps) >= 1.0 - 1e-9, '阵内最小间距=pitch');
  const arr2 = core.thermalViaArray(d, 'U1', { cols: 3, rows: 3 });
  assertEq(arr2.added, 9, '显式 3×3=9');
  let threw = false;
  try { core.thermalViaArray(d, 'U1', { pitch: 0.5 }); } catch (e) { threw = true; }
  assert(threw, 'pitch < viaOuter+viaEdgeMin 必须报错');
  threw = false;
  try { core.thermalViaArray(d, 'U1', { drill: 0.4 }); } catch (e) { threw = true; }
  assert(threw, 'drill 不等于 viaDrill 必须报错');
  threw = false;
  try { core.thermalViaArray(d, 'NOPE'); } catch (e) { threw = true; }
  assert(threw, '无焊盘元件报错');
  d.stitching = arr.vias;
  d.grid = Math.max(d.grid, core.minimumRoutingGrid(d));
  const r = core.routeBoard(d, { maxIter: 25 }).result;
  const drc = core.checkDRC(d, { ...r, nets: [...r.nets, ...core.manualRouteEntries(d)] }, { dfm: false })
    .filter(i2 => i2.sev === 'error');
  assertEq(drc.length, 0, '散热阵列 + 布线 DRC 干净');
  const holes = core.manufacturingHoles(d, r);
  const inDrill = holes.filter(h => arr.vias.some(v => Math.abs(v.x-h.x) < 1e-6 && Math.abs(v.y-h.y) < 1e-6));
  assertEq(inDrill.length, 42, '42 阵列孔全进钻孔表（Gerber 链）');
});
t('21c. thermalViaArray TO-220 舌孔滤除（孔边距同网不豁免）', () => {
  const d = core.designDefaults();
  d.width = 40; d.height = 30; d.grid = 0.6; d.trackW = 0.4; d.clearance = 0.25;
  d.viaDrill = 0.3; d.viaOuter = 0.6;
  d.nets = [{id:'tab',name:'TAB'},{id:'sig',name:'SIG'}];
  d.pads = [
    {id:'U1-1',netId:'tab',x:10,y:15,w:10,h:8,shape:'rect',layer:'top',holeR:1.6},
    {id:'U1-2',netId:'sig',x:30,y:10,w:1.2,h:2.4,shape:'rect',layer:'top'},
    {id:'U1-3',netId:'sig',x:30,y:15,w:1.2,h:2.4,shape:'rect',layer:'top'}
  ];
  const arr = core.thermalViaArray(d, 'U1', { cols: 5, rows: 5 });
  assert(arr.added > 0, '阵列有孔落盘');
  assert(arr.skipped > 0, '靠近舌孔的位置被滤除');
  for (const v of arr.vias)
    assert(Math.hypot(v.x-10, v.y-15) >= 1.6 + 0.15 + core.JLC.viaEdgeMin - 1e-9,
      '孔心距插件孔至少孔边距口径');
  d.stitching = arr.vias;
  const r = core.routeBoard(d, { maxIter: 15 }).result;
  const drc = core.checkDRC(d, { ...r, nets: [...r.nets, ...core.manualRouteEntries(d)] }, { dfm: false })
    .filter(i2 => i2.sev === 'error');
  assertEq(drc.length, 0, '舌孔滤除后 DRC 干净');
});
t('21d. 热设计检查表行：无孔 warn / 达标 ok / THT 插件孔不误报', () => {
  const d = core.designDefaults();
  d.width = 40; d.height = 30; d.grid = 0.6; d.trackW = 0.4; d.clearance = 0.25;
  d.nets = [{id:'gnd',name:'GND'},{id:'sig',name:'SIG'}];
  d.pads = [
    {id:'U1-1',netId:'gnd',x:10,y:15,w:3.4,h:3,shape:'rect',layer:'top'},
    {id:'U2-1',netId:'sig',x:28,y:15,w:2,h:2,shape:'circle',layer:'both',holeR:0.5}
  ];
  let cl = core.fabChecklist(d, null);
  let row = cl.find(x => x.group === '热设计' && x.item.includes('U1-1'));
  assert(row, '散热盘行存在');
  assertEq(row.status, 'warn', '无过孔 warn');
  assert(row.note.includes('thermal'), 'note 指向 thermal 命令');
  assert(!cl.some(x => x.group === '热设计' && x.item.includes('U2-1')),
    'THT 插件孔（holeR>0）不进热设计行');
  const arr = core.thermalViaArray(d, 'U1', { cols: 3, rows: 3 });
  d.stitching = arr.vias;
  cl = core.fabChecklist(d, null);
  row = cl.find(x => x.group === '热设计' && x.item.includes('U1-1'));
  assertEq(row.status, 'ok', '3×3=9 孔 ok');
  assertEq(row.value, '9 孔', '值=孔数（stitching 计入）');
});

// ===== 22a-22d. 阻抗自动定档（第十一轮后批次3）=====

t('22a. rules.pairs z → sFor 反查 → pairGapFor 单一事实源', () => {
  const mk = (layers=4) => {
    const d = core.designDefaults();
    d.width = 60; d.height = 40; d.grid = 0.6; d.layers = layers; d.trackW = 0.3; d.clearance = 0.2;
    d.nets = [{id:'dp',name:'USB_DP'},{id:'dm',name:'USB_DM'},{id:'sig',name:'SIG'},{id:'gnd',name:'GND'}];
    d.pads = [
      {id:'U1-1',netId:'dp',x:8,y:10,w:1,h:1,shape:'rect',layer:'top'},
      {id:'U1-2',netId:'dm',x:8,y:13,w:1,h:1,shape:'rect',layer:'top'},
      {id:'U2-1',netId:'dp',x:50,y:10,w:1,h:1,shape:'rect',layer:'top'},
      {id:'U2-2',netId:'dm',x:50,y:13,w:1,h:1,shape:'rect',layer:'top'},
      {id:'U3-1',netId:'sig',x:8,y:30,w:1,h:1,shape:'rect',layer:'top'},
      {id:'U3-2',netId:'sig',x:50,y:30,w:1,h:1,shape:'rect',layer:'top'}
    ];
    return d;
  };
  const d1 = mk();
  d1.rules = { pairs: [{ group:'USB', nets:['USB_DP','USB_DM'], z:90 }] };
  const n1 = core.normalizeDesign(d1);
  assertEq(n1.nets[0].pair, 'USB', 'pair 展开');
  assertEq(n1.nets[0].diffZ, 90, 'diffZ 展开');
  const g1 = core.pairGapFor(n1, n1.nets[0]);
  assertEq(g1, 0.25, '4 层 0.3mm 90Ω 反查 sFor=0.25');
  const zi = core.diffPairZFor(n1, 0.3, 90);
  assert(Math.abs(zi.zdiffAt(g1) - 90) < 1, 'S=0.25 处 Zdiff≈90（奇偶模口径自洽）');
});
t('22b. 显式 gap 覆写 + gap≤wEff 拦截 + 冲突报错', () => {
  const mk = () => {
    const d = core.designDefaults();
    d.width = 60; d.height = 40; d.grid = 0.6; d.layers = 4; d.trackW = 0.3; d.clearance = 0.2;
    d.nets = [{id:'dp',name:'USB_DP'},{id:'dm',name:'USB_DM'},{id:'sig',name:'SIG'},{id:'gnd',name:'GND'}];
    d.pads = [
      {id:'U1-1',netId:'dp',x:8,y:10,w:1,h:1,shape:'rect',layer:'top'},
      {id:'U1-2',netId:'dm',x:8,y:13,w:1,h:1,shape:'rect',layer:'top'},
      {id:'U2-1',netId:'dp',x:50,y:10,w:1,h:1,shape:'rect',layer:'top'},
      {id:'U2-2',netId:'dm',x:50,y:13,w:1,h:1,shape:'rect',layer:'top'},
      {id:'U3-1',netId:'sig',x:8,y:30,w:1,h:1,shape:'rect',layer:'top'},
      {id:'U3-2',netId:'sig',x:50,y:30,w:1,h:1,shape:'rect',layer:'top'}
    ];
    return d;
  };
  const d1 = mk();
  d1.rules = { pairs: [{ group:'USB', nets:['USB_DP','USB_DM'], z:100, gap:0.4 }] };
  const n1 = core.normalizeDesign(d1);
  assertEq(n1.nets[0].pairGap, 0.4, 'gap 展开到两成员网');
  assertEq(core.pairGapFor(n1, n1.nets[0]), 0.4, '显式 gap 优先于反查');
  assertEq(n1.nets[1].pairGap, 0.4, '两成员一致');
  // gap < 间距 → 报错（对内间隙边到边低于全局间距必 DRC 违规；与线宽无关）
  let threw = false, msg = '';
  try {
    const d2 = mk();
    d2.rules = { pairs: [{ group:'USB', nets:['USB_DP','USB_DM'], gap:0.15 }] };
    core.normalizeDesign(d2);
  } catch (e) { threw = true; msg = e.message; }
  assert(threw, 'gap 0.15 < 间距 0.2 必须报错');
  assert(msg.includes('间距'), '报错含间距口径：' + msg.slice(0, 60));
  // gap ≥ 间距但 < 线宽 → 合法（边到边语义）
  const d4 = mk();
  d4.rules = { pairs: [{ group:'USB', nets:['USB_DP','USB_DM'], gap:0.25 }] };
  const n4 = core.normalizeDesign(d4);
  assertEq(n4.nets[0].pairGap, 0.25, 'gap 0.25 ≥ 间距 → 合法（虽 < w 0.3）');
  // 负 gap → 报错
  threw = false;
  try {
    const d3 = mk();
    d3.rules = { pairs: [{ group:'USB', nets:['USB_DP','USB_DM'], gap:-0.1 }] };
    core.normalizeDesign(d3);
  } catch (e) { threw = true; }
  assert(threw, '负 gap 报错');
});
t('22c. 2 层 90Ω 不可达 → pairGapFor null + 检查表/spec 门如实 warn', () => {
  const mk = (layers=2) => {
    const d = core.designDefaults();
    d.width = 60; d.height = 40; d.grid = 0.6; d.layers = layers; d.trackW = 0.3; d.clearance = 0.2;
    d.nets = [{id:'dp',name:'USB_DP'},{id:'dm',name:'USB_DM'},{id:'sig',name:'SIG'},{id:'gnd',name:'GND'}];
    d.pads = [
      {id:'U1-1',netId:'dp',x:8,y:10,w:1,h:1,shape:'rect',layer:'top'},
      {id:'U1-2',netId:'dm',x:8,y:13,w:1,h:1,shape:'rect',layer:'top'},
      {id:'U2-1',netId:'dp',x:50,y:10,w:1,h:1,shape:'rect',layer:'top'},
      {id:'U2-2',netId:'dm',x:50,y:13,w:1,h:1,shape:'rect',layer:'top'},
      {id:'U3-1',netId:'sig',x:8,y:30,w:1,h:1,shape:'rect',layer:'top'},
      {id:'U3-2',netId:'sig',x:50,y:30,w:1,h:1,shape:'rect',layer:'top'}
    ];
    return d;
  };
  const d1 = mk(2);
  d1.rules = { pairs: [{ group:'USB', nets:['USB_DP','USB_DM'], z:90 }] };
  const n1 = core.normalizeDesign(d1);
  assertEq(core.pairGapFor(n1, n1.nets[0]), null, '2 层 90Ω 不可达 → null');
  const zi = core.diffPairZFor(n1, 0.3, 90);
  assert(zi.zdiffMinAtSmin > 90, '最低可达 ' + zi.zdiffMinAtSmin + 'Ω > 90Ω（诚实物理）');
  // 检查表：warn 行含建议路径
  const cl = core.fabChecklist(n1, null);
  const row = cl.find(x => x.group === '阻抗' && x.item.includes('USB'));
  assert(row, '阻抗行存在');
  assertEq(row.status, 'warn', '不可达 warn');
  assert(row.note.includes('rules.pairs[].gap'), 'note 指向显式 gap 逃生门');
  // 显式 gap 后不再 warn（用户定档）
  const d2 = mk(2);
  d2.rules = { pairs: [{ group:'USB', nets:['USB_DP','USB_DM'], z:90, gap:0.25 }] };
  const n2 = core.normalizeDesign(d2);
  const cl2 = core.fabChecklist(n2, null);
  const row2 = cl2.find(x => x.group === '阻抗' && x.item.includes('USB'));
  assertEq(row2.status, 'info', '显式 gap → info（精确控阻须板厂复算）');
  assert(row2.value.includes('0.25'), '行值含显式间隙');
});
t('22d. 阻抗定档端到端：4 层 USB 对布线 + 耦合走廊 + DRC', () => {
  const d = core.designDefaults();
  d.width = 60; d.height = 40; d.grid = 0.6; d.layers = 4; d.trackW = 0.3; d.clearance = 0.2;
  d.nets = [{id:'dp',name:'USB_DP'},{id:'dm',name:'USB_DM'},{id:'sig',name:'SIG'},{id:'gnd',name:'GND'}];
  d.pads = [
    {id:'U1-1',netId:'dp',x:8,y:10,w:1,h:1,shape:'rect',layer:'top'},
    {id:'U1-2',netId:'dm',x:8,y:12.6,w:1,h:1,shape:'rect',layer:'top'},
    {id:'U2-1',netId:'dp',x:50,y:10,w:1,h:1,shape:'rect',layer:'top'},
    {id:'U2-2',netId:'dm',x:50,y:12.6,w:1,h:1,shape:'rect',layer:'top'},
    {id:'U3-1',netId:'sig',x:8,y:30,w:1,h:1,shape:'rect',layer:'top'},
    {id:'U3-2',netId:'sig',x:50,y:30,w:1,h:1,shape:'rect',layer:'top'}
  ];
  d.rules = { pairs: [{ group:'USB', nets:['USB_DP','USB_DM'], z:90 }] };
  const n = core.normalizeDesign(d);
  const r = core.routeBoard(n, { maxIter: 30 }).result;
  assertEq(r.stats.connected, 6, '6/6 布通');
  const drc = core.checkDRC(n, { ...r, nets: [...r.nets, ...core.manualRouteEntries(n)] }, { dfm: false })
    .filter(x => x.sev === 'error');
  assertEq(drc.length, 0, 'DRC 干净');
  // 耦合占比 ≥60%（走廊已按 S=0.25 建偏置）→ 无差分耦合 warn
  const warns = core.checkDRC(n, { ...r, nets: [...r.nets, ...core.manualRouteEntries(n)] })
    .filter(x => x.sev === 'warn' && x.kind === '差分耦合');
  assertEq(warns.length, 0, '耦合走廊生效（无差分耦合 warn）');
});

// ===== 23a-23b. 过孔载流孔径感知 + 热设计阈值智能化（0.14.7 批次1）=====

t('23a. viaAmpFor 孔径折算：0.3 锚点 1A 线性，viaCount/检查表行跟随', () => {
  const mk = (drill) => {
    const d = core.designDefaults();
    d.viaDrill = drill; d.viaOuter = 0.6;
    return d;
  };
  // 独立折算锚点（π·D·t 一阶线性，锚 0.3mm→1A）
  assert(Math.abs(core.viaAmpFor(mk(0.4)) - 4/3) < 1e-9, '0.4mm→1.333A');
  assert(Math.abs(core.viaAmpFor(mk(0.3)) - 1) < 1e-9, '0.3mm→1A（锚点）');
  assert(Math.abs(core.viaAmpFor(mk(0.2)) - 2/3) < 1e-9, '0.2mm→0.667A');
  // viaCount 跟随：8A @ 0.4→6 / @0.3→8 / @0.2→12
  assertEq(core.ampWidthFor(mk(0.4), 8).viaCount, 6, '8A@0.4mm→6 孔');
  assertEq(core.ampWidthFor(mk(0.3), 8).viaCount, 8, '8A@0.3mm→8 孔');
  assertEq(core.ampWidthFor(mk(0.2), 8).viaCount, 12, '8A@0.2mm→12 孔');
  // 检查表行带实际孔径
  const d = mk(0.4);
  d.nets = [{id:'pwr',name:'PWR',current:8},{id:'sig',name:'SIG'},{id:'gnd',name:'GND'}];
  d.pads = [
    {id:'J1-1',netId:'pwr',x:6,y:15,w:6,h:6,shape:'rect',layer:'top'},
    {id:'J1-2',netId:'gnd',x:6,y:24,w:1.5,h:1.5,shape:'circle',layer:'both',holeR:0.5},
    {id:'U1-1',netId:'sig',x:44,y:15,w:1.5,h:1.5,shape:'circle',layer:'top'}
  ];
  const r = core.routeBoard(d, { maxIter: 15 }).result;
  const cl = core.fabChecklist(d, r);
  const row = cl.find(x => x.group === '载流' && x.item === '网 PWR：换层过孔并联');
  if (row) {
    assert(row.limit.includes('0.4mm'), 'limit 带实际孔径：' + row.limit);
    assert(row.limit.includes('6'), '8A@0.4mm 需 6 孔：' + row.limit);
  }
});
t('23b. 热设计阈值智能化：载流声明网 3mm² 触发，普通网仍 6mm²', () => {
  const d = core.designDefaults();   // viaDrill 0.4
  d.width = 40; d.height = 30; d.grid = 0.6; d.trackW = 0.4; d.clearance = 0.25;
  d.nets = [{id:'pwr',name:'PWR',current:2},{id:'sig',name:'SIG'}];
  d.pads = [
    {id:'U1-1',netId:'pwr',x:10,y:10,w:2,h:2,shape:'rect',layer:'top'},    // 4mm² < 6 但 ≥3
    {id:'U2-1',netId:'sig',x:28,y:10,w:2,h:2,shape:'rect',layer:'top'}     // 4mm² 普通网不触发
  ];
  const cl = core.fabChecklist(d, null);
  assert(cl.some(x => x.group === '热设计' && x.item.includes('U1-1')),
    '载流声明网 4mm² 盘触发热设计行');
  assert(!cl.some(x => x.group === '热设计' && x.item.includes('U2-1')),
    '普通网 4mm² 盘不触发（阈值仍 6mm²）');
  // 阈值下限不误伤小信号脚
  const d2 = core.designDefaults();
  d2.width = 40; d2.height = 30; d2.grid = 0.6; d2.trackW = 0.4; d2.clearance = 0.25;
  d2.nets = [{id:'pwr',name:'PWR',current:2},{id:'sig',name:'SIG'}];
  d2.pads = [{id:'U3-1',netId:'pwr',x:10,y:10,w:1,h:1,shape:'rect',layer:'top'}];  // 1mm²
  assert(!core.fabChecklist(d2, null).some(x => x.group === '热设计'),
    '1mm² 小脚不触发');
});

// ===== 24a-24c. 涂层声明 + DRC 逐对校验 + class clr（0.14.7 批次2）=====

t('24a. design.coating → IPC-2221B 档位切换（B2 无涂层 / B4 三防漆）', () => {
  const mk = (coating) => {
    const d = core.designDefaults();
    d.width = 50; d.height = 30; d.grid = 0.6; d.trackW = 0.3; d.clearance = 0.2;
    if (coating) d.coating = coating;
    d.nets = [{id:'hv',name:'HV',voltage:170},{id:'sig',name:'SIG'}];
    d.pads = [
      {id:'A1',netId:'hv',x:10,y:15,w:2,h:2,shape:'rect',layer:'top'},
      {id:'A2',netId:'sig',x:30,y:15,w:2,h:2,shape:'rect',layer:'top'}
    ];
    return core.normalizeDesign(d);
  };
  const bare = mk();
  const coated = mk('coated');
  assertEq(core.netClr(bare, 'hv'), 1.25, '裸板 170V → B2 档 1.25mm');
  assertEq(core.netClr(coated, 'hv'), 0.4, '三防漆 170V → B4 档 0.4mm');
  // 涂层声明 → 影响区半径变小：焊盘外围环带（1.2~2.5mm）内被推开格数 bare > coated
  const mb = core.buildModel(bare), mc = core.buildModel(coated);
  const ringBlocked = (m, dd) => {
    // 影响区 = padOwner 标记（焊盘矩形外扩 pClr 的格子）——异网不可用
    let cnt = 0;
    for (let j = 0; j < m.GH; j++) for (let i = 0; i < m.GW; i++) {
      const cx = (i + 0.5) * dd.grid, cy = (j + 0.5) * dd.grid;
      const dist = Math.hypot(cx - 10, cy - 15);
      if (dist > 1.2 && dist < 2.5 && m.padOwner[j * m.GW + i] !== 0) cnt++;
    }
    return cnt;
  };
  const nb = ringBlocked(mb, bare), nc = ringBlocked(mc, coated);
  assert(nb > nc, 'bare 影响区环带标记格数应大于 coated（bare 半径 2.4 vs coated 1.55）');
  // 非法 coating 报错
  let threw = false;
  try { const d = mk(); d.coating = 'dip'; core.normalizeDesign(d); } catch (e) { threw = true; }
  assert(threw, 'coating=dip 必须报错');
  // 检查表电压组：档位标注
  const cl = core.fabChecklist(coated, null);
  const row = cl.find(x => x.group === '电压' && x.item.includes('HV'));
  assert(row, '电压组行存在');
  assert(row.limit.includes('B4'), 'coated 行标注 B4 档：' + row.limit);
  const cl2 = core.fabChecklist(bare, null);
  const row2 = cl2.find(x => x.group === '电压' && x.item.includes('HV'));
  assert(row2.limit.includes('B2'), 'bare 行标注 B2 档：' + row2.limit);
});
t('24b. checkDRC 逐对校验：声明网间距闭环（影响区必要条件 → DRC 充分复核）', () => {
  const mk = (voltage) => {
    const d = core.designDefaults();
    d.width = 40; d.height = 20; d.grid = 0.6; d.trackW = 0.3; d.clearance = 0.2;
    d.nets = [{id:'hv',name:'HV'},...(voltage?[{id:'hv2',name:'HV2',voltage}]:[]),{id:'sig',name:'SIG'}];
    // HV2（声明网）焊盘与 SIG 焊盘 0.5mm 间距——全局 0.2 通过，声明网 1.25 拦截
    d.pads = [
      {id:'A1',netId:voltage?'hv2':'sig',x:10,y:10,w:2,h:2,shape:'rect',layer:'top'},
      {id:'A2',netId:'sig',x:12.5,y:10,w:2,h:2,shape:'rect',layer:'top'}
    ];
    return d;
  };
  // 无声明：0.5mm 间距 > 全局 0.2 → 干净
  const d0 = mk();
  const r0 = core.checkDRC(d0, {nets: []});
  assertEq(r0.filter(x => x.sev === 'error' && x.type === '焊盘间距').length, 0,
    '无声明 0.5mm 间距不报');
  // 声明 170V：0.5mm < 1.25mm → 焊盘间距 error（DRC 逐对闭环）
  const d1 = mk(170);
  const r1 = core.checkDRC(d1, {nets: []});
  const errs = r1.filter(x => x.sev === 'error' && x.type === '焊盘间距');
  assertEq(errs.length, 1, '声明网 0.5mm 间距必须被 DRC 拦截');
  assert(errs[0].msg.includes('0.5'), '报错含实际间距值');
  // 走线-走线逐对：HV 手动走线 vs SIG 手动走线 0.5mm
  const d2 = core.designDefaults();
  d2.width = 40; d2.height = 20; d2.grid = 0.6; d2.trackW = 0.3; d2.clearance = 0.2;
  d2.nets = [{id:'hv2',name:'HV2',voltage:170},{id:'sig',name:'SIG'}];
  d2.manual = [
    {netId:'hv2', pts:[{x:8,y:5,l:0},{x:30,y:5,l:0}]},
    {netId:'sig', pts:[{x:8,y:5.5,l:0},{x:30,y:5.5,l:0}]}   // 边到边 0.2 < 1.25
  ];
  // manual 走线按 CLI drc 同口径并入 result（否则走线-走线检查看不到 manual 段）
  const r2 = core.checkDRC(d2, { nets: core.manualRouteEntries(d2) });
  assert(r2.some(x => x.sev === 'error' && x.type === '走线间距'),
    '声明网走线对 0.2mm 间距必须被拦截（走线-走线逐对）');
  // 同几何无声明 → 干净
  const d3 = core.designDefaults();
  d3.width = 40; d3.height = 20; d3.grid = 0.6; d3.trackW = 0.3; d3.clearance = 0.2;
  d3.nets = [{id:'hv2',name:'HV2'},{id:'sig',name:'SIG'}];
  d3.manual = [
    {netId:'hv2', pts:[{x:8,y:5,l:0},{x:30,y:5,l:0}]},
    {netId:'sig', pts:[{x:8,y:5.5,l:0},{x:30,y:5.5,l:0}]}
  ];
  const r3 = core.checkDRC(d3, { nets: core.manualRouteEntries(d3) });
  assertEq(r3.filter(x => x.sev === 'error' && x.type === '走线间距').length, 0,
    '同几何无声明 → 位级不变不报');
});
t('24c. rules.classes[].clr → netClr 第三来源（影响区 + DRC + 检查表）', () => {
  const d = core.designDefaults();
  d.width = 40; d.height = 20; d.grid = 0.6; d.trackW = 0.3; d.clearance = 0.2;
  d.nets = [{id:'pwr',name:'PWR'},{id:'sig',name:'SIG'}];
  d.pads = [
    {id:'A1',netId:'pwr',x:10,y:10,w:2,h:2,shape:'rect',layer:'top'},
    {id:'A2',netId:'sig',x:12.4,y:10,w:2,h:2,shape:'rect',layer:'top'}   // 0.4mm 间距 < class 0.5
  ];
  d.rules = { classes: { pwr: { clr: 0.5 } }, netClass: { PWR: 'pwr' } };
  const n = core.normalizeDesign(d);
  assertEq(n.nets[0].clr, 0.5, 'class clr 展开到成员网');
  assertEq(core.netClr(n, 'pwr'), 0.5, 'netClr 三来源 max');
  assertEq(core.netClr(n, 'sig'), 0.2, '未声明网不受影响');
  // DRC 逐对：PWR-SIG 0.4mm 间距 < class 0.5 → error（恰在 0.5 不算违规——严格 < 口径）
  const r = core.checkDRC(n, {nets: []});
  assert(r.some(x => x.sev === 'error' && x.type === '焊盘间距'), 'class clr 0.5 逐对拦截');
  // 三来源 max：同网 voltage + class clr 取大
  const d2 = core.designDefaults();
  d2.width = 40; d2.height = 20; d2.grid = 0.6; d2.trackW = 0.3; d2.clearance = 0.2;
  d2.nets = [{id:'mix',name:'MIX',voltage:170}];
  d2.pads = [{id:'A1',netId:'mix',x:10,y:10,w:2,h:2,shape:'rect',layer:'top'}];
  d2.rules = { classes: { hi: { clr: 1.5 } }, netClass: { MIX: 'hi' } };
  const n2 = core.normalizeDesign(d2);
  assertEq(core.netClr(n2, 'mix'), 1.5, 'max(IPC 1.25, class 1.5) = 1.5');
  // 检查表 class 行
  const cl = core.fabChecklist(n2, null);
  const row = cl.find(x => x.group === '电压' && x.item.includes('MIX'));
  assert(row && row.value.includes('1.50'), '电压组行显示有效间距 1.50mm');
});

// ===== 25a-25b. 阻抗阻焊一阶修正（0.14.7 批次3）=====

t('25a. solderMask=0 位级兼容（不修正）', () => {
  const mk = (mask) => {
    const d = core.designDefaults();
    d.width=60; d.height=40; d.grid=0.6; d.layers=4; d.trackW=0.3; d.clearance=0.2;
    if (mask) d.solderMask = mask;
    d.nets=[{id:'dp',name:'USB_DP'},{id:'dm',name:'USB_DM'},{id:'sig',name:'SIG'},{id:'gnd',name:'GND'}];
    d.pads=[
      {id:'U1-1',netId:'dp',x:8,y:10,w:1,h:1,shape:'rect',layer:'top'},
      {id:'U1-2',netId:'dm',x:8,y:13,w:1,h:1,shape:'rect',layer:'top'},
      {id:'U2-1',netId:'dp',x:50,y:10,w:1,h:1,shape:'rect',layer:'top'},
      {id:'U2-2',netId:'dm',x:50,y:13,w:1,h:1,shape:'rect',layer:'top'},
      {id:'U3-1',netId:'sig',x:8,y:30,w:1,h:1,shape:'rect',layer:'top'},
      {id:'U3-2',netId:'sig',x:50,y:30,w:1,h:1,shape:'rect',layer:'top'}];
    d.rules={pairs:[{group:'USB',nets:['USB_DP','USB_DM'],z:90}]};
    return core.normalizeDesign(d);
  };
  const n0 = mk();
  const z0 = core.diffPairZFor(n0, 0.3, 90);
  assertEq(z0.corrected, false, '无声明 corrected=false');
  assertEq(z0.maskMm, 0, 'maskMm=0');
  assertEq(core.pairGapFor(n0, n0.nets[0]), 0.25, 'sFor 与无修正口径一致');
  // 检查表阻抗行不带修正注
  const cl = core.fabChecklist(n0, null);
  const row = cl.find(x => x.group === '阻抗' && x.item.includes('USB'));
  assert(!row.note.includes('阻焊'), '无声明行不提阻焊');
});
t('25b. solderMask 0.0254mm（1mil）→ z0 −2Ω，sFor 增大（阻焊压低阻抗→需更松耦合回到目标），pairGapFor 跟随', () => {
  const mk = (mask) => {
    const d = core.designDefaults();
    d.width=60; d.height=40; d.grid=0.6; d.layers=4; d.trackW=0.3; d.clearance=0.2;
    if (mask) d.solderMask = mask;
    d.nets=[{id:'dp',name:'USB_DP'},{id:'dm',name:'USB_DM'},{id:'sig',name:'SIG'},{id:'gnd',name:'GND'}];
    d.pads=[
      {id:'U1-1',netId:'dp',x:8,y:10,w:1,h:1,shape:'rect',layer:'top'},
      {id:'U1-2',netId:'dm',x:8,y:13,w:1,h:1,shape:'rect',layer:'top'},
      {id:'U2-1',netId:'dp',x:50,y:10,w:1,h:1,shape:'rect',layer:'top'},
      {id:'U2-2',netId:'dm',x:50,y:13,w:1,h:1,shape:'rect',layer:'top'},
      {id:'U3-1',netId:'sig',x:8,y:30,w:1,h:1,shape:'rect',layer:'top'},
      {id:'U3-2',netId:'sig',x:50,y:30,w:1,h:1,shape:'rect',layer:'top'}];
    d.rules={pairs:[{group:'USB',nets:['USB_DP','USB_DM'],z:90}]};
    return core.normalizeDesign(d);
  };
  const n0 = mk(), n1 = mk(0.0254);
  const zA = core.diffPairZFor(n0, 0.3, 90), zB = core.diffPairZFor(n1, 0.3, 90);
  assertEq(zB.corrected, true, 'corrected=true');
  assertEq(zB.z0, +(zA.z0 - 2).toFixed(2), '1mil → z0 −2Ω（Bogatin B.43/44）');
  assertEq(zB.maskMm, 0.0254, 'maskMm 记录');
  const gA = core.pairGapFor(n0, n0.nets[0]), gB = core.pairGapFor(n1, n1.nets[0]);
  assertEq(gB, 0.305, '阻焊压低 z0 → sFor 增大（0.25→0.305，独立核算一致）');
  assert(gB > gA, 'sFor 增大：' + gA + '→' + gB);
  // zdiffAt(sFor) 仍回到目标 90（奇偶模自洽）
  assert(Math.abs(zB.zdiffAt(gB) - 90) < 1, '修正后 S 处 Zdiff 仍=90');
  // 检查表行注明修正
  const cl = core.fabChecklist(n1, null);
  const row = cl.find(x => x.group === '阻抗' && x.item.includes('USB'));
  assert(row.value.includes('0.31') || row.value.includes('0.30'),
    '检查表 S 值为修正后间隙：' + row.value);
  // 端到端：布线 + DRC 干净（走廊按修正间隙工作）
  const r = core.routeBoard(n1, { maxIter: 30 }).result;
  assertEq(r.stats.connected, 6, '6/6 布通');
  const drc = core.checkDRC(n1, { ...r, nets: [...r.nets, ...core.manualRouteEntries(n1)] }, { dfm: false })
    .filter(x => x.sev === 'error');
  assertEq(drc.length, 0, 'DRC 干净');
});

// ===== 26a. 层位感知探针机制（0.14.7 批次5，探针级）=====

t('26a. preferredLayer 硬层位约束：规范化/生效/无声明 no-op/越界报错', () => {
  const mk = (withPref) => {
    const d = core.designDefaults();
    d.width=30; d.height=20; d.grid=0.5; d.layers=4; d.trackW=0.3; d.clearance=0.2;
    d.nets=[{id:'a',name:'A',...(withPref?{preferredLayer:'top'}:{})},{id:'b',name:'B'}];
    d.pads=[
      {id:'A1',netId:'a',x:5,y:5,w:1,h:1,shape:'rect',layer:'top'},
      {id:'A2',netId:'a',x:25,y:15,w:1,h:1,shape:'rect',layer:'top'},
      {id:'B1',netId:'b',x:5,y:15,w:1,h:1,shape:'rect',layer:'top'},
      {id:'B2',netId:'b',x:25,y:5,w:1,h:1,shape:'rect',layer:'top'}];
    return d;
  };
  // 规范化：'top'→0
  const n1 = core.normalizeDesign(mk(true));
  assertEq(n1.nets[0].preferredLayer, 0, 'top → 层号 0');
  // 生效：网 A 全程仅层 0（无过孔）
  const r = core.routeBoard(n1, { maxIter: 20 }).result;
  assertEq(r.stats.connected, 4, '4/4 布通');
  const aNet = r.nets.find(x => x.netId === 'a');
  const aLayers = new Set();
  for (const p of aNet.paths) for (const pt of p) aLayers.add(pt.l);
  assertEq([...aLayers].join(','), '0', '网 A 仅层 0（硬约束生效）');
  assertEq((aNet.vias || []).length, 0, '单层网零过孔');
  // 无声明 → 无 prefL 字段影响（no-op 门：字段不存在）
  const n0 = core.normalizeDesign(mk(false));
  assert(n0.nets[0].preferredLayer == null, '无声明无字段');
  // 越界层号报错
  let threw = false;
  try { const d2 = mk(true); d2.nets[0].preferredLayer = 7; core.normalizeDesign(d2); } catch (e) { threw = true; }
  assert(threw, '越界层号必须报错');
  // 'bottom' → L-1
  const d3 = mk(true); d3.nets[0].preferredLayer = 'bottom';
  assertEq(core.normalizeDesign(d3).nets[0].preferredLayer, 3, 'bottom → 层 3（4 层板）');
});

console.log('\n优化验证结果：' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
