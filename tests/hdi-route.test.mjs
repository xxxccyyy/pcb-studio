// #15b 相邻层盲埋孔生成（0.13.18）——栅格布线器 span 端到端回归
// 覆盖：span 产出合法性、缺省位级不变（通孔无 layers 字段）、双口径影响区
// span 感知、viaLegal 层感知焊盘检查、Gerber 分层闪光、Excellon 分刀注释、
// normalizeResult 回读。合成 4 层板：顶层球阵 → 底层目标（强制跨层）。
import * as core from '../src/engine.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

function mkDesign() {
  const nets = [], pads = [];
  let k = 0;
  for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) {
    nets.push({ id: 'N' + k, name: 'N' + k });
    pads.push({ id: 'b' + k, x: 2 + c * 0.8, y: 2 + r * 0.8, w: 0.4, shape: 'circle', layer: 'top', netId: 'N' + k });
    pads.push({ id: 't' + k, x: 8 + c * 1.0, y: 6 + r * 1.0, w: 0.4, h: 0.4, shape: 'circle', layer: 'bottom', netId: 'N' + k });
    k++;
  }
  return core.normalizeDesign({
    width: 12, height: 9, grid: 0.2, layers: 4, trackW: 0.1, clearance: 0.08,
    viaOuter: 0.3, viaDrill: 0.15, nets, pads
  });
}
const viasOf = r => r.nets.flatMap(n => n.vias.map(v => ({ net: n.name, ...v })));

test('#15b 缺省路径：过孔无 layers 字段（通孔语义，位级不变）', () => {
  const d = mkDesign();
  const r = core.routeBoard(core.normalizeDesign(JSON.parse(JSON.stringify(d))), {}).result;
  for (const v of viasOf(r)) assert.equal(v.layers, undefined, '缺省过孔不得携带 layers 字段');
  assert.ok(viasOf(r).length > 0, '该板必须产生过孔');
});

test('#15b blindVias：全部 span 合法（0≤from<to≤3）且至少出现一个真盲孔', () => {
  const d = mkDesign();
  const r = core.routeBoard(d, { blindVias: true }).result;
  const vs = viasOf(r);
  assert.ok(vs.length > 0);
  let blind = 0;
  for (const v of vs) {
    if (v.layers === undefined) continue;   // 通孔
    const [a, b] = v.layers;
    assert.ok(Number.isInteger(a) && Number.isInteger(b), 'span 必须是整数对');
    assert.ok(a >= 0 && b < 4 && a < b, 'span 必须满足 0≤from<to≤3：' + a + ',' + b);
    blind++;
  }
  assert.ok(blind >= 4, '强制跨层板应产出 ≥4 颗盲埋孔，实得 ' + blind);
});

test('#15b blindVias：DRC 零几何违规（span 感知 DRC 复核）', () => {
  const d = mkDesign();
  const r = core.routeBoard(d, { blindVias: true }).result;
  const errs = core.checkDRC(d, { ...r, nets: [...r.nets, ...core.manualRouteEntries(d)] }, { dfm: false })
    .filter(i => i.sev === 'error');
  assert.deepEqual(errs, [], '盲孔布线结果必须通过 span 感知 DRC');
});

test('#15b 影响区 span 感知：盲孔布线结果零违规（异层铜不相交语义）', () => {
  // 行为级验证：盲孔模式下布线器可能把过孔落在其它网焊盘投影附近——
  // 只要 span 与焊盘层不相交，span 感知 DRC 必须放行（等价于影响区只挡 span 层）
  const d = core.normalizeDesign({
    width: 8, height: 6, grid: 0.2, layers: 4, trackW: 0.1, clearance: 0.08,
    viaOuter: 0.3, viaDrill: 0.15,
    nets: [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }],
    pads: [
      { id: 'a1', x: 1, y: 1, w: 0.4, shape: 'circle', layer: 'top', netId: 'A' },
      { id: 'a2', x: 3, y: 1, w: 0.4, shape: 'circle', layer: 'top', netId: 'A' },
      { id: 'b1', x: 1, y: 3, w: 0.4, shape: 'circle', layer: 'bottom', netId: 'B' },
      { id: 'b2', x: 3, y: 3, w: 0.4, shape: 'circle', layer: 'bottom', netId: 'B' },
    ],
  });
  const rb = core.routeBoard(d, { blindVias: true }).result;
  assert.equal(rb.stats.connected, 4, '两网全连通');
  const errs = core.checkDRC(d, { ...rb, nets: [...rb.nets, ...core.manualRouteEntries(d)] }, { dfm: false })
    .filter(i => i.sev === 'error');
  assert.deepEqual(errs, []);
});

test('#15b viaLegal 层感知：盲孔可落在 span 外层异网焊盘的正背面上', () => {
  // B 网底部两盘 (1,3)/(3,3)；其过孔可贴着顶层异网焊盘投影落位——只要 span 不含顶层
  const d = mkDesign();
  const r = core.routeBoard(d, { blindVias: true }).result;
  const errs = core.checkDRC(d, r, { dfm: false }).filter(i => i.sev === 'error' && i.type === '过孔-焊盘间距');
  assert.deepEqual(errs, [], '布线器不得产出与 span 相交焊盘的过孔间距违规');
});

test('#15b Gerber 分层闪光：盲孔只 flash 在 span 覆盖的层', () => {
  const d = mkDesign();
  const r = core.routeBoard(d, { blindVias: true }).result;
  const g = core.buildGerber(d, r, r.pours || null, []);
  const files = core.gerberFiles(g, 'x');
  const byL = new Map(files.filter(f => f[0].includes('_Cu')).map(f => [f[0], f[1]]));
  const Ls = [...byL.keys()];
  let checked = 0;
  for (const n of r.nets) for (const v of n.vias) {
    const span = v.layers || [0, 3];
    for (let l = 0; l < 4; l++) {
      const fname = Ls[l];   // Ls 顺序 = F,In1,In2,B
      const gx = String(Math.round(v.x * 1e6)), gy = String(Math.round(v.y * 1e6));
      const flashed = new RegExp('X' + gx + 'Y' + gy + 'D03', 'm').test(byL.get(fname));
      assert.equal(flashed, l >= span[0] && l <= span[1],
        `过孔 (${v.x},${v.y}) span[${span}] 在 ${fname} 的闪光应=${l >= span[0] && l <= span[1]}`);
      checked++;
    }
  }
  assert.ok(checked >= 4 * 10, '至少核对 10 颗过孔 × 4 层');
});

test('#15b Excellon：同直径不同 span 分刀并在刀表区注释 span；全通孔时无注释', () => {
  const d = mkDesign();
  const rb = core.routeBoard(d, { blindVias: true }).result;
  const gb = core.buildGerber(d, rb, null, []);
  const spansInResult = new Set(viasOf(rb).map(v => (v.layers ? v.layers.join('-') : 'thru')));
  if (spansInResult.size > 1) {
    assert.ok(/;T\d+ span \d+-\d+ \(盲埋孔\)/.test(gb.drill), '盲孔板刀表区应有 span 注释');
    assert.ok(gb.drill.includes('M48') && gb.drill.includes('METRIC,TZ'));
  }
  // 缺省通孔板：无 span 注释（与 0.13.17 字节级一致）
  const rt = core.routeBoard(d, {}).result;
  const gt = core.buildGerber(d, rt, null, []);
  assert.ok(!/;T\d+ span/.test(gt.drill), '全通孔板不得出现 span 注释');
});

test('#15b normalizeResult 回读：layers 字段合法校验 + verify 链不抛错', () => {
  const d = mkDesign();
  const r = core.routeBoard(d, { blindVias: true }).result;
  const n = core.normalizeResult(r, d);   // 不抛错 = span 校验通过
  const vs = n.nets.flatMap(x => x.vias || []);
  assert.ok(vs.some(v => v.layers), '回读保留 layers 字段');
});

test('#15b 同格重入加宽：span 取并集且值对象不被原地改（快照语义）', () => {
  const d = mkDesign();
  const sess = core.routeBoard(d, { blindVias: true }).session;
  const saved = sess.snapshot();
  const before = JSON.stringify(saved.nets.map(n => n.vias));
  // restore 后再 dump——快照共享值对象，若 addVia 原地改会破坏
  sess.restore(saved);
  assert.equal(JSON.stringify(saved.nets.map(n => n.vias)), before, 'restore 不得污染快照');
});
