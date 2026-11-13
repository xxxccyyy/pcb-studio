// M1 里程碑永久门（抽样口径）：projects/m1-4layer/ 20 板 ≥200 焊盘 × 4 层全绿。
// 全量 20 板复跑 ~54s（.scratch/gen-m1.mjs）；此处抽样 4 板活复现 + 存档对账，
// 兼作生成器回归（0603 填充器/占用检查的产物在当前引擎下仍须全绿）。
import * as core from '../src/engine.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SUMMARY = JSON.parse(readFileSync(new URL('../projects/m1-4layer/M1-summary.json', import.meta.url), 'utf8'));

test('M1 存档对账：summary 记录 20 板全绿且逐板 ≥200 焊盘 × 4 层', () => {
  assert.equal(SUMMARY.length, 20, 'M1 项目数应为 20');
  for (const r of SUMMARY) {
    assert.ok(r.ok, r.name + ' 存档未绿');
    assert.ok(r.pads >= 200, r.name + ' 焊盘 ' + r.pads + ' < 200');
    const d = JSON.parse(readFileSync(new URL('../projects/m1-4layer/' + r.name + '/design.json', import.meta.url), 'utf8'));
    assert.equal(d.layers, 4, r.name + ' 非 4 层');
    assert.equal(d.pads.length, r.pads, r.name + ' 焊盘数与 summary 不符');
  }
});

test('M1 活复现抽样：4 板在当前引擎下重跑完整管线仍全绿', { timeout: 600000 }, () => {
  // 管线与生成器一致：routeBoard → 未绿时 routeBoardShape 兜底（p20 的存档
  // 绿即形状补线救回：栅格 partial 192/256 → shape complete + DRC 0）
  const sample = ['p01-lqfp144-mcu', 'p09-0603-farm', 'p17-broadcast-200', 'p20-quad-lqfp64'];
  for (const name of sample) {
    const d = core.normalizeDesign(JSON.parse(readFileSync(
      new URL('../projects/m1-4layer/' + name + '/design.json', import.meta.url), 'utf8')));
    let r = core.routeBoard(d, { maxIter: 30 }).result;
    const drcPre = core.checkDRC(d, { ...r, nets: [...r.nets, ...core.manualRouteEntries(d)] }, { dfm: false })
      .filter(i => i.sev === 'error').length;
    if (r.status !== 'complete' || drcPre > 0) {
      const sp = core.routeBoardShape(d, { base: r, maxIter: 12 });
      const drcPost = core.checkDRC(d, { ...sp.result, nets: [...sp.result.nets, ...core.manualRouteEntries(d)] }, { dfm: false })
        .filter(i => i.sev === 'error').length;
      if ((sp.result.status === 'complete' && drcPost === 0) || drcPost < drcPre ||
          (sp.result.stats.connected > r.stats.connected && drcPost <= drcPre)) r = sp.result;
    }
    assert.equal(r.status, 'complete', name + ' 状态 ' + r.status);
    assert.equal(r.stats.connected, r.stats.total, name + ' 连通 ' + r.stats.connected + '/' + r.stats.total);
    const errs = core.checkDRC(d, { ...r, nets: [...r.nets, ...core.manualRouteEntries(d)] }, { dfm: false })
      .filter(i => i.sev === 'error');
    assert.deepEqual(errs, [], name + ' DRC 残留');
  }
});
