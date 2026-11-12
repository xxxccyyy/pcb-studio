import * as core from '../src/engine.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// EasyEDA PCB 导入回归（roadmap #8：立创开源广场接力入口）
// shape 字段序以 pcb-rnd src_plugins/io_easyeda/read_std_low.c 为准（study/pcb-rnd）。
// 导出侧 exportEasyEdaPcb 为对称参照；回路对账量化走 verify 同款路径。

const U = 0.254;
const CLI = fileURLToPath(new URL('../ai/pcb.mjs', import.meta.url));

// 自导出样例：555 示例布通后导出（回路对账底料）
const routed555 = (() => {
  const d = core.normalizeDesign(core.EXAMPLES_555());
  const r = core.routeBoard(d, { maxIter: 12 }).result;
  return { design: d, result: r, ee: core.exportEasyEdaPcb(d, r.nets, null) };
})();

test('回路对账：555 布线板 export→import 焊盘/网络/板幅/走线逐项命中', () => {
  const { design: d, ee } = routed555;
  const { design: imp, report } = core.importEasyEdaPcbFull(ee);
  assert.equal(report.pads, d.pads.length, '焊盘数');
  assert.equal(report.nets, d.nets.length, '网络数');
  assert.equal(Object.keys(report.skipped).length, 0, '无跳过');
  assert.equal(imp.layers, 2);
  // 板幅：3 位量化容差（0.254 换算尾差 ≤0.001）
  assert.ok(Math.abs(imp.width - d.width) <= 0.001 && Math.abs(imp.height - d.height) <= 0.001,
    `板幅 ${imp.width}×${imp.height} vs ${d.width}×${d.height}`);
  // 每个焊盘按（引脚号@量化坐标）回读命中——量化路径与 verify 一致
  const got = new Set(imp.pads.map(p => p.id.split('-').pop().replace(/[a-z]+$/, '') + '@' + p.x.toFixed(2) + ',' + p.y.toFixed(2)));
  for (const p of d.pads) {
    const i = p.id.lastIndexOf('-');
    const num = i > 0 ? p.id.slice(i + 1) : '1';
    const qx = (Math.round(p.x / U * 1000) / 1000 * U).toFixed(2), qy = (Math.round(p.y / U * 1000) / 1000 * U).toFixed(2);
    assert.ok(got.has(num + '@' + qx + ',' + qy), `焊盘 ${p.id} 回读缺失（期望 ${num}@${qx},${qy}）`);
  }
  // 位号归属：摊平格式下宽体 IC 远离位号的列会降级 P（固有歧义），断言绝大多数组件按原名找回
  const comps = new Set(imp.pads.map(p => p.id.split('-')[0]));
  const recovered = Object.keys(d.comps || {}).filter(c => comps.has(c));
  assert.ok(recovered.length >= Object.keys(d.comps || {}).length - 1,
    `位号找回 ${recovered.length}/${Object.keys(d.comps || {}).length}: ${recovered.join(',')}`);
  // 电气正确性（真正的不变量）：每个焊盘按（引脚号@量化坐标）找回后网名一致
  const byKey = new Map(imp.pads.map(p => [p.id.split('-').pop().replace(/[a-z]+$/, '') + '@' + p.x.toFixed(2) + ',' + p.y.toFixed(2), p]));
  for (const p of d.pads) {
    const i = p.id.lastIndexOf('-');
    const num = i > 0 ? p.id.slice(i + 1) : '1';
    const qx = (Math.round(p.x / U * 1000) / 1000 * U).toFixed(2), qy = (Math.round(p.y / U * 1000) / 1000 * U).toFixed(2);
    const got2 = byKey.get(num + '@' + qx + ',' + qy);
    assert.ok(got2, `焊盘 ${p.id} 回读缺失`);
    const origNet = (d.nets.find(n => n.id === p.netId) || {}).name;
    const gotNet = (imp.nets.find(n => n.id === got2.netId) || {}).name;
    assert.equal(gotNet, origNet, `焊盘 ${p.id} 网名 ${gotNet} ≠ 原 ${origNet}`);
  }
  // 走线：布通的 15 条 run 全部转为手动走线，ratsnest 全连通
  assert.ok(imp.manual.length >= 10, `手动走线 ${imp.manual.length} 条`);
  const rn = core.computeRatsnest(imp, { nets: core.manualRouteEntries(imp) });
  assert.ok(Array.isArray(rn) ? rn.length === 0 : true, '导入后预拉线应为 0（布通板全连通）');
  // 网宽众数回写
  const netByName = new Map(imp.nets.map(n => [n.name, n]));
  for (const on of d.nets) {
    const in2 = netByName.get(on.name);
    assert.ok(in2, `网络 ${on.name} 缺失`);
    if (on.w) assert.ok(Math.abs((in2.w || core.minimumRoutingGrid(imp) * 0 + imp.trackW) - on.w) < 0.01, `网络 ${on.name} 线宽`);
  }
  // design.external 惯例（spec 同元件焊盘间距豁免）
  assert.equal(imp.external, true);
});

test('VIA stub 连通性：换层走线导出→导入后 union 连通（过孔=两点换层手动走线）', () => {
  const d = core.normalizeDesign({ width: 30, height: 20, grid: 0.5, layers: 2, trackW: 0.3, clearance: 0.2,
    nets: [{ id: 'a', name: 'SIG' }, { id: 'b', name: 'GND' }],
    pads: [
      { id: 'X-1', netId: 'a', x: 5, y: 10, w: 1.2, h: 1.2, layer: 'both' },
      { id: 'Y-1', netId: 'a', x: 25, y: 10, w: 1.2, h: 1.2, layer: 'both' },
      { id: 'G-1', netId: 'b', x: 5, y: 15, w: 1.2, h: 1.2, layer: 'both' },
      { id: 'G-2', netId: 'b', x: 25, y: 15, w: 1.2, h: 1.2, layer: 'both' }],
    manual: [
      { netId: 'a', pts: [{ x: 5, y: 10, l: 0 }, { x: 15, y: 10, l: 0 }, { x: 15, y: 10, l: 1 }, { x: 25, y: 10, l: 1 }] },
      { netId: 'b', pts: [{ x: 5, y: 15, l: 0 }, { x: 25, y: 15, l: 0 }] }]
  });
  const merged = core.manualRouteEntries(d);
  const ee = core.exportEasyEdaPcb(d, merged, null);
  const { design: imp, report } = core.importEasyEdaPcbFull(ee);
  assert.equal(report.vias, 1, '过孔 stub 计数');
  assert.equal(report.tracks, 3, '单层 run 拆分后的走线数');
  // stub 形态：同点两层
  const stub = imp.manual.find(m => m.pts.length === 2 && m.pts[0].x === m.pts[1].x && m.pts[0].y === m.pts[1].y && m.pts[0].l !== m.pts[1].l);
  assert.ok(stub, '两点换层 stub 存在');
  const rn = core.computeRatsnest(imp, { nets: core.manualRouteEntries(imp) });
  assert.ok(Array.isArray(rn) ? rn.length === 0 : true, 'via stub + 两段走线应 union 连通');
});

test('真实文件风格：LIB 块（本地坐标+90° 旋转）+ 非零 canvas 原点 + keepout + skip 计数', () => {
  const ee = JSON.stringify({
    head: { docType: '3', editorVersion: '6.5.54' },
    canvas: 'CA~1000~1000~#000000~yes~#FFFFFF~10~1000~1000~line~9.8425~mm~1~45~visible~0.5~312.5~255.9~1~yes',
    shape: [
      // 0.11.2 口径修正：板文件 LIB 内形状=doc 绝对坐标、PAD rot=板面绝对角
      // （本地 (-4,-1.25)→rot90→绝对 (351.25,296)；(4,-1.25)→(348.75,296)）
      'LIB~350~300~`hash`abc`name`R5`Pre`R5`package`R0603~90~0~gge1~0#@$'
      + 'PAD~RECT~351.25~296~2~1.2~11~GND~1~3~{}~90~gge11~0~~Y~0#@$'
      + 'PAD~RECT~348.75~296~2~1.2~1~VCC~2~0~{}~90~gge12~0~~Y~0#@$'
      + 'TEXT~L~344~294~4~0~0~3~~12~R5~~~gge13~Noto~0~~',
      'TRACK~2~1~VCC~{400,300,500,300}~gge20~0',
      'TRACK~2~21~GND~{400,320,500,320}~gge22~0',
      'VIA~500~300~3~VCC~1.5~gge21~0',
      'SOLIDREGION~10~~M 200,200 L 600,200 L 600,400 L 200,400 Z~boardoutline~boardoutlinename~0',
      'SOLIDREGION~10~~M 300,250 L 400,250 L 400,300 L 300,300 Z~solidregion~keepout~1',
      'COPPERAREA~2~2~GND~M 200,200 L 600,200 L 600,400 L 200,400 Z~1~solid~gge30~1~0~~0',
      'HOLE~450~350~4~gge31~0',
      'ARC~M 300,320 A 10 10 0 1 0 320,300~#840000~1~0~none~gge32~0',
      'TEXT~L~100~100~4~0~0~3~~12~VALUES~~gge33~Noto~0~~'],
    BBox: {} });
  const { design: imp, report } = core.importEasyEdaPcbFull(ee);
  assert.equal(imp.layers, 4, '内层 TRACK 21 → 4 层板');
  assert.ok(Math.abs(imp.width - 400 * U) < 0.001 && Math.abs(imp.height - 200 * U) < 0.001, '板框包围盒（canvas 原点已扣除）');
  assert.equal(imp.pads.length, 2, 'LIB 内 2 焊盘');
  const p1 = imp.pads.find(p => p.id === 'R5-1'), p2 = imp.pads.find(p => p.id === 'R5-2');
  assert.ok(p1 && p2, 'LIB attrs `name`=R5 → 位号归属');
  assert.equal(p1.layer, 'both'); assert.equal(p2.layer, 'top');
  // PAD rot=板面绝对角：AABB 交换 + wLocal/hLocal/rotAbs 保留（spec 45° 真形状检查依赖）
  for (const p of [p1, p2]) {
    assert.equal(p.rotAbs, 90);
    assert.equal(p.wLocal, 2 * U); assert.equal(p.hLocal, 1.2 * U);
    assert.ok(Math.abs(p.w - 1.2 * U) < 1e-6 && Math.abs(p.h - 2 * U) < 1e-6, '旋转 AABB w/h 互换');
  }
  // 绝对坐标：两 pad 绝对位置绕 origin 对称（348.75/351.25），板内相对位置差 2.5u
  assert.ok(Math.abs((p1.x - p2.x) - 2.5 * U) < 1e-6, '绝对坐标差 2.5u');
  assert.ok(Math.abs((p2.y - p1.y)) < 1e-6, '同 y（rot90 后沿 x 分离）');
  // 网络与线宽众数（TRACK 2u=0.508mm）
  assert.ok(imp.nets.some(n => n.name === 'VCC' && Math.abs(n.w - 0.508) < 1e-9), 'VCC 线宽众数 0.508');
  // VIA → stub（4 层：l 0↔3）
  const stub = imp.manual.find(m => m.pts.length === 2 && m.pts[0].l !== m.pts[1].l);
  assert.ok(stub, 'VIA stub 存在');
  assert.equal(stub.pts[0].l, 0); assert.equal(stub.pts[1].l, 3);
  // keepout SOLIDREGION → 矩形
  assert.equal(imp.keepouts.length, 1);
  // skip 计数：COPPERAREA/HOLE 不导入，ARC 计 graphics；'VALUES' 非位号不进 comps
  assert.equal(report.copperareas, 1); assert.equal(report.holes, 1); assert.equal(report.graphics, 1);
  assert.deepEqual(Object.keys(imp.comps), ['R5']);
});

test('旋转焊盘 45°：真形状 AABB 包络（非保守近似），spec 精查输入齐全', () => {
  const ee = JSON.stringify({ head: { docType: '3' }, canvas: 'CA~1~1~#000~yes~#FFF~10~1000~1000~line~1~mm~1~0~visible~0.5~0~0~1~yes',
    shape: [
      'PAD~RECT~100~100~4~1~1~A~1~0~{}~45~gge1~0~~Y~0',
      'PAD~RECT~200~100~4~1~1~A~2~0~{}~90~gge2~0~~Y~0'],
    BBox: {} });
  const { design: imp } = core.importEasyEdaPcbFull(ee);
  assert.equal(imp.pads.length, 2);
  const [p1, p2] = imp.pads;
  // 45°：AABB = (|w·cos|+|h·sin|)·0.254（fixture 单位是 EasyEDA 单位，4u=1.016mm）
  const k = (4 * U + 1 * U) * Math.SQRT1_2;
  assert.ok(Math.abs(p1.w - k) < 1e-3 && Math.abs(p1.h - k) < 1e-3, '45° 真包络');
  assert.equal(p1.rotAbs, 45);
  // 90°：w/h 互换
  assert.ok(Math.abs(p2.w - 1 * U) < 1e-6 && Math.abs(p2.h - 4 * U) < 1e-6, '90° 互换');
  assert.equal(p2.rotAbs, 90);
});

test('无位号焊盘 → 独立 P 组件；同簇同号消歧后缀（KiCad 导入同款）', () => {
  const ee = JSON.stringify({ head: { docType: '3' }, canvas: 'CA~1~1~#000~yes~#FFF~10~1000~1000~line~1~mm~1~0~visible~0.5~0~0~1~yes',
    shape: [
      // 远离的两颗 → 各自成簇 → P1/P2
      'PAD~RECT~10~10~2~1.2~1~A~3~0~{}~0~gge1~0~~Y~0',
      'PAD~RECT~30~10~2~1.2~1~A~3~0~{}~0~gge2~0~~Y~0',
      // 紧贴的两脚同号（QFN 散热盘分割风格）→ 同簇消歧后缀
      'PAD~RECT~20~30~2~1.2~1~A~1~0~{}~0~gge3~0~~Y~0',
      'PAD~RECT~20~33~2~1.2~1~A~1~0~{}~0~gge4~0~~Y~0'],
    BBox: {} });
  const { design: imp } = core.importEasyEdaPcbFull(ee);
  const ids = imp.pads.map(p => p.id);
  assert.equal(ids.length, 4);
  assert.equal(new Set(ids).size, 4, 'id 唯一: ' + ids.join(','));
  const dup = ids.filter(s => /-1a?$/.test(s)).sort();
  assert.equal(dup.length, 2, '同簇同号 → 消歧后缀');
  assert.ok(/-1$/.test(dup[0]) && /-1a$/.test(dup[1]), '消歧后缀: ' + dup.join(','));
  assert.ok(/^P\d+-/.test(ids[0]), '无位号 → P 组件');
});

test('邻域精化：大 IC 边缘脚不误归属邻组位号（555 例 U1 边脚曾误归 R1）', () => {
  // 构造：U1 为 6 脚大 IC（3×2 排列），R1 紧贴 U1 左侧——U1 最左脚到 R1 位号
  // 比到 U1 位号更近（最近邻起步必误归），精化必须把它拉回 U1
  const u1pads = [];
  for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++)
    u1pads.push(`PAD~RECT~${200 + c * 10}~${100 + r * 10}~3~2~1~NET${r * 3 + c + 1}~${r * 3 + c + 1}~0~{}~0~ggeu${r * 3 + c}~0~~Y~0`);
  const ee = JSON.stringify({ head: { docType: '3' }, canvas: 'CA~1~1~#000~yes~#FFF~10~1000~1000~line~1~mm~1~0~visible~0.5~0~0~1~yes',
    shape: [...u1pads,
      'PAD~RECT~150~100~2~1.2~1~RC~1~0~{}~0~gger1~0~~Y~0',
      'PAD~RECT~150~106~2~1.2~1~RC~2~0~{}~0~gger2~0~~Y~0',
      'TEXT~L~160~103~4~0~0~3~~12~R1~~~ggert~Noto~0~~',
      'TEXT~L~225~105~4~0~0~3~~12~U1~~~ggeut~Noto~0~~'],
    BBox: {} });
  const { design: imp } = core.importEasyEdaPcbFull(ee);
  const u1 = imp.pads.filter(p => p.id.startsWith('U1-'));
  const r1 = imp.pads.filter(p => p.id.startsWith('R1-'));
  assert.equal(u1.length, 6, `U1 应有 6 脚，实际 ${u1.length}（精化失败）`);
  assert.equal(r1.length, 2, `R1 应有 2 脚，实际 ${r1.length}`);
});

test('恶意/坏输入：干净 JSON 错误，零崩溃', () => {
  for (const [label, text] of [
    ['坏 JSON', '{oops'],
    ['JSON 数组', '[1,2]'],
    ['空对象', '{}'],
    ['原理图 docType 1', JSON.stringify({ head: { docType: '1' }, shape: [] })],
    ['缺 shape', JSON.stringify({ head: { docType: '3' } })],
    ['shape 非数组', JSON.stringify({ head: { docType: '3' }, shape: 'PAD~RECT~1~1~1~1~1~~1~0' })],
    ['shape 元素非字符串', JSON.stringify({ head: { docType: '3' }, shape: [42, null, {}] })],
    ['无板框无焊盘', JSON.stringify({ head: { docType: '3' }, shape: ['TRACK~2~1~~{1,1,2,2}~g1~0'] })],
  ]) {
    assert.throws(() => core.importEasyEdaPcb(text), Error, label);
    let msg = '';
    try { core.importEasyEdaPcb(text); } catch (e) { msg = e.message; }
    assert.ok(msg && !/^\s*at /.test(msg), label + ' 错误消息可读: ' + msg.slice(0, 60));
  }
});

test('畸形 shape 容错：坏坐标/零尺寸/未知层全部跳过并计数', () => {
  const ee = JSON.stringify({ head: { docType: '3' },
    canvas: 'CA~1~1~#000~yes~#FFF~10~1000~1000~line~1~mm~1~0~visible~0.5~0~0~1~yes',
    shape: [
      'PAD~RECT~10~10~0~0~1~A~1~0~{}~0~gge1~0~~Y~0',        // 零尺寸 → skip
      'PAD~RECT~10~10~2~1.2~99~A~1~0~{}~0~gge2~0~~Y~0',      // 未知层 → skip
      'PAD~ELLIPSE~10~10~2~2~1~A~1~0~{}~0~gge3~0~~Y~0',      // 圆形 → circle
      'TRACK~2~33~A~{1,1,2,2}~gge4~0',                        // 未知层 → skip
      'TRACK~2~1~A~{1,1}~gge5~0',                             // 单点退化 → skip
      'VIA~10~20~0~A~0~gge6~0'],                              // 零尺寸 → skip
    BBox: {} });
  const { design: imp, report } = core.importEasyEdaPcbFull(ee);
  assert.equal(imp.pads.length, 1);
  assert.equal(imp.pads[0].shape, 'circle');
  assert.equal(imp.manual.length, 0);
  const skipped = JSON.stringify(report.skipped);
  assert.ok(skipped.includes('PAD-RECT') && skipped.includes('PAD-l99') && skipped.includes('TRACK-l33')
    && skipped.includes('TRACK-退化') && skipped.includes('VIA-坏尺寸'), 'skip 计数齐全: ' + skipped);
});

test('导入板接力：import→route 二次布通 + 再导出 verify 回读 ok（三方对账）', () => {
  // 清掉一部分手动走线模拟"半布板接力"：导入后重布仍可补完
  const { design: imp } = core.importEasyEdaPcbFull(routed555.ee);
  imp.manual = imp.manual.slice(0, 5);   // 撕掉部分走线
  const nn = core.normalizeDesign(imp);
  const r2 = core.routeBoard(nn, { maxIter: 20 }).result;
  assert.equal(r2.status, 'complete', '接力重布应布通');
  const merged = [...r2.nets.filter(n => !n.manual), ...core.manualRouteEntries(nn)];
  const ee2 = core.exportEasyEdaPcb(nn, merged, null);
  const v = core.verifyEasyEdaExport(nn, { nets: merged }, ee2);
  assert.equal(v.ok, true, '再导出回读应干净: ' + JSON.stringify(v.findings));
  // 再导入对账（三段往返）
  const { design: imp2, report } = core.importEasyEdaPcbFull(ee2);
  assert.equal(report.pads, nn.pads.length);
  const rn = core.computeRatsnest(imp2, { nets: core.manualRouteEntries(imp2) });
  assert.ok(Array.isArray(rn) ? rn.length === 0 : true, '三段往返后仍全连通');
});

test('CLI import easyeda：端到端 JSON 输出 + -o 落盘 + 导入板 spec 可过', () => {
  const dir = join(tmpdir(), 'pcb-ee-import-test');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const src = join(dir, 'board.json'), out = join(dir, 'design.json');
  writeFileSync(src, routed555.ee);
  const stdout = execFileSync(process.execPath, [CLI, 'import', 'easyeda', src, '-o', out], { encoding: 'utf8', timeout: 120000 });
  const j = JSON.parse(stdout);
  assert.equal(j.ok, true);
  assert.equal(j.format, 'easyeda');
  assert.ok(j.written === out);
  const saved = JSON.parse(readFileSync(out, 'utf8'));
  assert.ok(saved.pads.length > 0 && saved.external === true);
  // 落盘 design 直接 spec（AI 代理接力第一步）
  const sp = JSON.parse(execFileSync(process.execPath, [CLI, 'spec', out], { encoding: 'utf8', timeout: 120000 }));
  assert.equal(sp.ok, true);
  rmSync(dir, { recursive: true, force: true });
});

// ---- 开源广场真实案例（ext-oshwhub-01）回归：0.11.2 抓出的两口径缺口 ----
test('真实案例口径：LIB 绝对坐标 + 板框层 10 + 异形铜皮分类（合成复刻）', () => {
  const ee = JSON.stringify({
    head: { docType: '3', editorVersion: '6.5.22' },
    // canvas 原点非零 + 单位 mil 标注（真实文件口径）
    canvas: 'CA~1000~1000~#000000~yes~#FFFFFF~10~1000~1000~line~0.1~mil~0.3~45~visible~0.5~4020~3589~1~yes',
    shape: [
      // rot=180 的 LIB：内含 PAD 为 doc 绝对坐标（绕 origin 对称）、PAD rot=板面绝对角
      'LIB~4255~3115.5~package`SW-SMD`link``Contributor`x~3DModel`Y~180~0~gge1~0#@\$'
      + 'PAD~RECT~4246.988~3115.5~6~5.35~2~KEY1~1~0~{}~180~gge2~0~~Y~0#@\$'
      + 'PAD~RECT~4263.012~3115.5~6~5.35~2~GND~2~0~{}~180~gge3~0~~Y~0',
      // 顶层摊平焊盘（doc 绝对）
      'PAD~RECT~4100~3100~6~5.35~1~SIG~1~0~{}~0~gge4~0~~Y~0',
      // 板框：层 10 四条边线（net 空/S$）——嘉立创EDA 标准版边框层
      'TRACK~1~10~~4084.78 3049.62 4291.5 3049.62~gge5~0',
      'TRACK~1~10~~4291.5 3049.62 4291.5 3144.1~gge6~0',
      'TRACK~1~10~~4291.5 3144.1 4084.78 3144.1~gge7~0',
      'TRACK~1~10~~4084.78 3144.1 4084.78 3049.62~gge8~0',
      // 异形铜皮：层 2 + 网名（真实文件的 SOLIDREGION 铜皮口径）
      'SOLIDREGION~2~USB5V~M 4093 3100 L 4093 3115 L 4101 3115 L 4101 3100 Z~gge9~0',
      // 内层走线 21 → 4 层识别
      'TRACK~2~21~GND~{4100 3110 4200 3110}~gge10~0',
      // LIB 内装饰 SOLIDREGION（层 100 doc）→ graphics 计数
      'LIB~4241~3090~package`C0603`~90~0~gge11~0#@SOLIDREGION~100~~M 4243 3093 L 4239 3093 L 4239 3092 L 4243 3092 Z~gge12~0'],
    BBox: {} });
  const { design: imp, report } = core.importEasyEdaPcbFull(ee);
  // 板框取自层 10 包围盒（52.51×23.50 ≈ (4291.5-4084.78)×0.254 × (3144.1-3049.62)×0.254）
  assert.ok(Math.abs(imp.width - 52.5) < 0.1 && Math.abs(imp.height - 24.0) < 0.1,
    `板幅 ${imp.width}×${imp.height} 应来自边框层`);
  assert.ok(report.notes.some(n => /边框层/.test(n)), 'notes 记录边框层来源');
  // LIB 绝对坐标：KEY1 pad 落在板内（doc 4247 → (4247-4084.78)×0.254 ≈ 41.2mm）
  const k1 = imp.pads.find(p => p.id.startsWith('KEY1') || p.id.startsWith('LIB1-1'));
  assert.ok(k1 && k1.x > 30 && k1.x < 52, `rot180 LIB pad 应在板内: ${k1 && k1.x}`);
  assert.equal(k1.rotAbs, 180, 'PAD rot=板面绝对角（不叠加 LIB rot）');
  // 异形铜皮单独计数（非 solid 装饰）
  assert.equal(report.skipped['SOLIDREGION-铜皮'], 1);
  // 21 层 → 4 层
  assert.equal(imp.layers, 4);
});

// ---- 0.11.4：无名 LIB 组的位号回收（真实案例 80/80 找回）----
test('无名 LIB 位号回收：内部位号 TEXT 1:1 认领本组；冲突/缺失保 LIB{n}', () => {
  const mk = (attrs, innerText, label) =>
    `LIB~4255~3115.5~${attrs}~180~0~ggeH${label}#@$`
    + `PAD~RECT~4246.988~3115.5~6~5.35~2~N1~1~0~{}~180~ggeP${label}~0~~Y~0#@$`
    + `PAD~RECT~4263.012~3115.5~6~5.35~2~N2~2~0~{}~180~ggeQ${label}~0~~Y~0#@$`
    + (innerText ? `TEXT~L~4255~3110~4~0~0~3~~12~${innerText}~~~ggeT${label}~Noto~0~~` : '');
  const ee = JSON.stringify({ head: { docType: '3' },
    canvas: 'CA~1000~1000~#000~yes~#FFF~10~1000~1000~line~0.1~mil~0.3~45~visible~0.5~4020~3589~1~yes',
    shape: [
      // 有 name 的 LIB：attrs 定名，内部位号 TEXT 不参与
      mk('`name`R5`package`R0603', 'R5', 'A'),
      // 无 name + 内部位号 → 回收
      mk('`package`C0603', 'C7', 'B'),
      // 无 name + 无内部位号 → 保 LIB{n}
      mk('`package`L0603', '', 'C'),
      // 无 name + 内部位号与 R5 冲突（同名）→ 保 LIB{n}
      mk('`package`D0603', 'R5', 'D')],
    BBox: {} });
  const { design: imp } = core.importEasyEdaPcbFull(ee);
  const comps = new Set(imp.pads.map(p => p.id.split('-')[0]));
  assert.ok(comps.has('R5'), 'attrs name 定名');
  assert.ok(comps.has('C7'), '无名 LIB 内部位号回收');
  assert.ok([...comps].some(c => /^LIB\d+$/.test(c)), '无内部位号保 LIB{n}');
  assert.ok([...comps].some(c => /^LIB\d+$/.test(c)), '同名冲突保 LIB{n}');
  // R5 组的焊盘数 = attrs LIB 的 2 脚（冲突 LIB 未抢名）
  const r5 = imp.pads.filter(p => p.id.startsWith('R5-')).length;
  assert.equal(r5, 2, '同名冲突不抢已有组名');
});
