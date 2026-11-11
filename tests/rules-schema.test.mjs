import * as core from '../src/engine.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 约束系统 rules schema 回归（roadmap #10：生成器惯用法错误的根治）
// 展开幂等、冲突即错误、引用悬空拦截、class keepout 路由/DRC/布局全链、向后兼容。

const CLI = fileURLToPath(new URL('../ai/pcb.mjs', import.meta.url));

const mk = () => ({
  width: 30, height: 20, grid: 0.5, layers: 2, trackW: 0.3, clearance: 0.2,
  nets: [{ id: 'a', name: 'SIG' }, { id: 'b', name: 'GND' }, { id: 'c', name: 'CLK' }],
  pads: [
    { id: 'X-1', netId: 'a', x: 5, y: 10, w: 1.2, h: 1.2, layer: 'both' },
    { id: 'Y-1', netId: 'a', x: 25, y: 10, w: 1.2, h: 1.2, layer: 'both' },
    { id: 'G-1', netId: 'b', x: 5, y: 15, w: 1.2, h: 1.2, layer: 'both' },
    { id: 'G-2', netId: 'b', x: 25, y: 15, w: 1.2, h: 1.2, layer: 'both' },
    { id: 'C-1', netId: 'c', x: 5, y: 5, w: 1.2, h: 1.2, layer: 'both' },
    { id: 'C-2', netId: 'c', x: 25, y: 5, w: 1.2, h: 1.2, layer: 'both' }],
  rules: {
    classes: { pwr: { w: 0.5 }, hs: { w: 0.3, tr: 1.5 } },
    netClass: { GND: 'pwr', CLK: 'hs' },
    pairs: [{ group: 'USB', nets: ['SIG', 'CLK'], z: 90 }],
    lengths: [{ group: 'BUS', nets: ['SIG', 'CLK'] }],
    keepouts: [{ rects: [{ x: 15, y: 12, w: 2, h: 8 }], class: 'pwr' }]
  }
});

test('展开：classes/netClass→w/tr、pairs→pair/diffZ、lengths→lenGroup、keepouts→scope', () => {
  const d = core.normalizeDesign(mk());
  assert.equal(d.nets.find(n => n.name === 'GND').w, 0.5, 'class pwr.w → GND.w');
  assert.equal(d.nets.find(n => n.name === 'CLK').tr, 1.5, 'class hs.tr → CLK.tr');
  assert.equal(d.nets.find(n => n.name === 'SIG').pair, 'USB', 'rules.pairs → SIG.pair');
  assert.equal(d.nets.find(n => n.name === 'CLK').pair, 'USB');
  assert.equal(d.nets.find(n => n.name === 'CLK').diffZ, 90, 'rules.pairs.z → diffZ');
  assert.equal(d.nets.find(n => n.name === 'SIG').lenGroup, 'BUS', 'rules.lengths → lenGroup');
  assert.equal(d.keepouts.length, 1);
  assert.equal(d.keepouts[0].scope, 'pwr', 'class keepout → keepouts[].scope');
  assert.equal(d.keepouts[0].fromRules, true, '物化标记（幂等用）');
  // 未归类网不被动（SIG 无 class → 无 w/tr）
  assert.equal(d.nets.find(n => n.name === 'SIG').w, undefined);
  assert.equal(d.nets.find(n => n.name === 'SIG').tr, undefined);
  // rules 原样保留（tune 后续按组读取 tolerance/target）
  assert.deepEqual(d.rules.lengths, [{ group: 'BUS', nets: ['SIG', 'CLK'] }]);
});

test('幂等：重复 normalize 结果一致（keepouts 不重复物化、已展开字段不冲突）', () => {
  const d1 = core.normalizeDesign(mk());
  const d2 = core.normalizeDesign(d1);
  const d3 = core.normalizeDesign(d2);
  assert.equal(d3.keepouts.length, 1, 'keepouts 不重复物化');
  assert.equal(d3.nets.find(n => n.name === 'GND').w, 0.5);
  assert.equal(d3.nets.find(n => n.name === 'SIG').pair, 'USB');
  assert.equal(d3.nets.find(n => n.name === 'CLK').diffZ, 90);
});

test('冲突即错误：netClass 与 nets[].w/tr 双写不一致（生成器惯用法 #1）', () => {
  const bad = mk();
  bad.nets.find(n => n.name === 'GND').w = 0.3;
  assert.throws(() => core.normalizeDesign(bad), /冲突/, 'w 双写不一致必须报错');
  const bad2 = mk();
  bad2.nets.find(n => n.name === 'CLK').tr = 2.0;
  assert.throws(() => core.normalizeDesign(bad2), /冲突/, 'tr 双写不一致必须报错');
  // 一致双写（幂等场景）放行
  const ok = mk();
  ok.nets.find(n => n.name === 'GND').w = 0.5;
  assert.doesNotThrow(() => core.normalizeDesign(ok));
});

test('引用悬空拦截（惯用法 #2~#5）：未知网/未知 class/pair 成员缺失/网重复归组', () => {
  assert.throws(() => core.normalizeDesign({ ...mk(), rules: { classes: { pwr: { w: 0.5 } }, netClass: { GHOST: 'pwr' } } }),
    /不存在的网络/, 'netClass 引用不存在的网');
  assert.throws(() => core.normalizeDesign({ ...mk(), rules: { classes: {}, netClass: { GND: 'ghost' } } }),
    /未定义的 class/, 'netClass 引用未定义的 class');
  assert.throws(() => core.normalizeDesign({ ...mk(), rules: { pairs: [{ group: 'U', nets: ['SIG', '不存在'] }] } }),
    /不存在的网络/, 'pairs 引用不存在的网');
  assert.throws(() => core.normalizeDesign({ ...mk(), rules: { pairs: [{ group: 'U', nets: ['SIG'] }] } }),
    /恰好 2 个/, 'pair 成员必须恰好 2 个');
  assert.throws(() => core.normalizeDesign({ ...mk(), rules: { pairs: [{ group: 'U', nets: ['SIG', 'GND'] }, { group: 'V', nets: ['SIG', 'CLK'] }] } }),
    /差分对/, '一个网不能同属两个 pair');
  assert.throws(() => core.normalizeDesign({ ...mk(), rules: { lengths: [{ group: 'A', nets: ['SIG'] }, { group: 'B', nets: ['SIG'] }] } }),
    /等长组/, '一个网不能同属两个 lengths 组');
  assert.throws(() => core.normalizeDesign({ ...mk(), rules: { classes: { pwr: { w: 0.5 } }, netClass: { GND: 'pwr' }, keepouts: [{ x: 1, y: 1, w: 1, h: 1, class: 'ghost' }] } }),
    /未定义的 class/, 'keepout class 引用悬空');
  assert.throws(() => core.normalizeDesign({ ...mk(), rules: { classes: { pwr: { w: 0.5 } }, netClass: { GND: 'pwr' }, keepouts: [{ x: 1, y: 1, w: 0, h: 1 }] } }),
    /几何无效/, 'keepout 零尺寸拦截');
  assert.throws(() => core.normalizeDesign({ ...mk(), rules: { classes: { pwr: { w: -1 } } } }),
    /正数/, 'class w 非法值拦截');
});

test('class keepout 路由端到端：异类网绕行、本类网直穿、布通', () => {
  const d = core.normalizeDesign(mk());
  const model = core.buildModel(d);
  assert.equal(model.scopedBlocked.length, 1, 'scope 位图构建');
  assert.ok(model.scopedBlocked[0].cells.filter(Boolean).length > 0, '阻挡格非空');
  assert.equal(model.netCls.get('b'), 'pwr', 'GND → pwr');
  const r = core.routeBoard(d, { maxIter: 30 }).result;
  assert.equal(r.status, 'complete');
  const ko = d.keepouts[0];
  const segCross = n => n.paths.some(path => {
    for (let i = 1; i < path.length; i++)
      if (core.segmentRectDistance(path[i - 1], path[i], ko) < 0.2) return true;
    return false;
  });
  const sig = r.nets.find(n => n.netId === d.nets.find(x => x.name === 'SIG').id);
  const gnd = r.nets.find(n => n.netId === d.nets.find(x => x.name === 'GND').id);
  assert.equal(segCross(sig), false, 'SIG（异类）绕行禁区');
  assert.equal(segCross(gnd), true, 'GND（本类 pwr）直穿禁区');
});

test('class keepout DRC：异类网穿越报 error、本类网穿越不报', () => {
  const manual = netName => {
    const dd = core.normalizeDesign(mk());
    const nid = dd.nets.find(n => n.name === netName).id;
    dd.manual = [{ netId: nid, pts: [
      { x: 5, y: netName === 'SIG' ? 10 : 15, l: 0 },
      { x: 15, y: netName === 'SIG' ? 10 : 15, l: 0 },
      { x: 25, y: netName === 'SIG' ? 10 : 15, l: 0 } ] }];
    return dd;
  };
  const dg = manual('GND'), ds = manual('SIG');
  const drcG = core.checkDRC(dg, { nets: core.manualRouteEntries(dg) }, { dfm: false });
  const drcS = core.checkDRC(ds, { nets: core.manualRouteEntries(ds) }, { dfm: false });
  const kee = f => f.filter(x => x.sev === 'error' && /禁布/.test(x.msg || ''));
  assert.equal(kee(drcG).length, 0, 'GND（本类）穿越不报');
  assert.ok(kee(drcS).length >= 1, 'SIG（异类）穿越报 error');
});

test('无 rules 设计行为不变（向后兼容）：路由/DRC 与基线一致', () => {
  const plain = mk();
  delete plain.rules;
  const d = core.normalizeDesign(plain);
  assert.equal(d.keepouts.length, 0);
  assert.equal(d.nets.find(n => n.name === 'GND').w, undefined, '无 rules 不注入 w');
  const r = core.routeBoard(d, { maxIter: 30 }).result;
  assert.equal(r.status, 'complete');
  // 全局 keepout（无 scope）照旧全局阻挡：SIG 也绕行
  const d2 = core.normalizeDesign({ ...plain, keepouts: [{ x: 15, y: 10, w: 2, h: 12 }] });
  const r2 = core.routeBoard(d2, { maxIter: 30 }).result;
  assert.equal(r2.status, 'complete');
  const sig = r2.nets.find(n => n.netId === d2.nets.find(x => x.name === 'SIG').id);
  assert.equal(sig.paths.some(path => {
    for (let i = 1; i < path.length; i++)
      if (core.segmentRectDistance(path[i - 1], path[i], d2.keepouts[0]) < 0.2) return true;
    return false;
  }), false, '全局 keepout 阻挡所有网');
});

test('CLI spec：rules 摘要输出 + class 工艺极限拦截', () => {
  const dir = join(tmpdir(), 'pcb-rules-test');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const f = join(dir, 'design.json');
  writeFileSync(f, JSON.stringify(core.normalizeDesign(mk()), null, 1));
  const j = JSON.parse(execFileSync(process.execPath, [CLI, 'spec', f], { encoding: 'utf8', timeout: 120000 }));
  assert.equal(j.ok, true);
  assert.equal(j.rules.classes, 2);
  assert.equal(j.rules.classified, 2);
  assert.equal(j.rules.pairs, 1);
  assert.equal(j.rules.keepouts, 1);
  // class w=0.3 的 hs 低于 1oz 极限？0.3 ≥ 0.10 → 不拦。造一个低于极限的：
  const bad = mk();
  bad.rules.classes.pwr.w = 0.05;
  writeFileSync(f, JSON.stringify(core.normalizeDesign(bad), null, 1));
  const j2 = JSON.parse(execFileSync(process.execPath, [CLI, 'spec', f], { encoding: 'utf8', timeout: 120000 }));
  assert.ok(j2.problems.some(p => /class pwr.*工艺极限/.test(p)), 'class 线宽低于工艺极限被 spec 拦截: ' + JSON.stringify(j2.problems));
  rmSync(dir, { recursive: true, force: true });
});

test('CLI spec 惯用法错误家族：normalize 抛错以干净 JSON error 呈现', () => {
  const dir = join(tmpdir(), 'pcb-rules-bad');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const f = join(dir, 'bad.json');
  const bad = mk();
  bad.nets.find(n => n.name === 'GND').w = 0.3;   // 与 class 冲突
  writeFileSync(f, JSON.stringify(bad));
  let stderrText = '';
  try {
    execFileSync(process.execPath, [CLI, 'spec', f], { encoding: 'utf8', timeout: 120000 });
    assert.fail('spec 应失败');
  } catch (e) {
    stderrText = (e.stdout || '') + (e.stderr || '');
  }
  const m = stderrText.match(/\{[\s\S]*\}/);
  assert.ok(m, '错误输出含 JSON');
  const j = JSON.parse(m[0]);
  assert.equal(j.ok, false);
  assert.ok(/冲突/.test(j.error), '冲突语义保留在错误消息: ' + j.error);
  rmSync(dir, { recursive: true, force: true });
});
