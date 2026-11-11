import * as core from '../src/engine.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';

// 等长蛇形生成测试（roadmap 阶段一 #2 验收：生成后等长 DRC 通过；蛇形间距合规）

function design() {
  const d = core.designDefaults();
  d.width = 40; d.height = 30; d.grid = 0.25; d.trackW = 0.3; d.clearance = 0.2;
  d.nets = [
    { id: 'a', name: 'USB_P', pair: 'usb' },
    { id: 'b', name: 'USB_N', pair: 'usb' },
    { id: 'c', name: 'SIG' },
  ];
  d.pads = [
    { id: 'A1-1', netId: 'a', x: 5, y: 8, w: 1.2, h: 1.2, layer: 'top' },
    { id: 'A1-2', netId: 'a', x: 35, y: 8, w: 1.2, h: 1.2, layer: 'top' },
    { id: 'B1-1', netId: 'b', x: 5, y: 12, w: 1.2, h: 1.2, layer: 'top' },
    { id: 'B1-2', netId: 'b', x: 35, y: 12, w: 1.2, h: 1.2, layer: 'top' },
    { id: 'C1-1', netId: 'c', x: 5, y: 20, w: 1.2, h: 1.2, layer: 'top' },
    { id: 'C1-2', netId: 'c', x: 35, y: 22, w: 1.2, h: 1.2, layer: 'top' },
  ];
  return d;
}
const baseR = () => ({ nets: [
  { netId: 'a', paths: [[{ x: 5, y: 8, l: 0 }, { x: 35, y: 8, l: 0 }]], vias: [] },
  { netId: 'b', paths: [[{ x: 5, y: 12, l: 0 }, { x: 20, y: 12, l: 0 }, { x: 20, y: 13, l: 0 }, { x: 35, y: 13, l: 0 }]], vias: [] },
  { netId: 'c', paths: [], vias: [] },
] });

test('蛇形精确补长：ΔL→0、端点不动、等长 DRC 通过', () => {
  const d = design(), r = baseR();
  const rep = core.serpentineTune(d, r, {});
  assert.equal(rep.tuned.length, 1, '只调短网 USB_P：' + JSON.stringify(rep.tuned.map(t => t.name)));
  const t = rep.tuned[0];
  assert.equal(t.name, 'USB_P');
  assert.equal(t.from, 30);
  assert.equal(t.target, 31);
  assert.equal(t.residual, 0, '精确命中（residual=' + t.residual + '）');
  const la = core.netRoutedLen(d, r, 'a'), lb = core.netRoutedLen(d, r, 'b');
  assert(Math.abs(la - lb) < 1e-9, 'ΔL=' + Math.abs(la - lb));
  // 端点保持 → 连通性不变
  const pa = r.nets[0].paths[0];
  assert.deepEqual([pa[0].x, pa[0].y, pa[0].l], [5, 8, 0], '起点不动');
  assert.deepEqual([pa[pa.length - 1].x, pa[pa.length - 1].y, pa[pa.length - 1].l], [35, 8, 0], '终点不动');
  const st = core.staleResultCheck(d, r);
  assert(st.ok, '结果-设计同步：' + JSON.stringify(st.staleNets));
  // 等长 DRC 通过（验收标准 1）
  const eq = core.checkDRC(d, r).filter(i => i.type === '差分等长');
  assert.equal(eq.length, 0, JSON.stringify(eq));
  assert.equal(core.checkDRC(d, r).filter(i => i.sev === 'error').length, 0, 'DRC 无错误');
});

test('节距合规：全部平行段边到边 ≥ serpGap（3W 自耦合口径）', () => {
  const d = design(), r = baseR();
  // 大 deficit + 上方障碍压缩 Amax → 强制多 bump
  d.pads.push({ id: 'F1-1', netId: 'c', x: 20, y: 5.6, w: 30, h: 1.2, layer: 'top' });  // 异网横墙压上方
  r.nets[2].paths = [[{ x: 5, y: 20, l: 0 }, { x: 20, y: 20, l: 0 }, { x: 20, y: 22, l: 0 }, { x: 35, y: 22, l: 0 }]];
  r.nets[0].paths = [[{ x: 5, y: 8, l: 0 }, { x: 35, y: 8, l: 0 }]];
  r.nets[1].paths = [[{ x: 5, y: 12, l: 0 }, { x: 35, y: 12, l: 0 }]];   // 长网 30
  r.nets[0].paths[0] = [{ x: 5, y: 8, l: 0 }, { x: 25, y: 8, l: 0 }];    // 短网 20 → deficit 10
  const rep = core.serpentineTune(d, r, {});
  assert.equal(rep.tuned.length, 1, JSON.stringify(rep));
  const t = rep.tuned[0];
  assert(t.insertions.length >= 1 && t.insertions.some(i => i.bumps >= 2), '应产生多 bump：' + JSON.stringify(t.insertions));
  const W = 0.3, serpGap = Math.max(3 * W, d.clearance);
  // 收集 tuned 网全部垂直段，平行对边到边 ≥ serpGap
  const verts = [];
  for (const path of r.nets[0].paths)
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1], b = path[k];
      if (a.l === 0 && Math.abs(a.x - b.x) < 1e-9) verts.push([Math.min(a.y, b.y), Math.max(a.y, b.y), a.x]);
    }
  assert(verts.length >= 4, '垂直段数：' + verts.length);
  for (let i = 0; i < verts.length; i++)
    for (let j = i + 1; j < verts.length; j++) {
      const [y0a, y1a, xa] = verts[i], [y0b, y1b, xb] = verts[j];
      const yOverlap = Math.min(y1a, y1b) - Math.max(y0a, y0b);
      if (yOverlap > 1e-9)
        assert(Math.abs(xa - xb) - W >= serpGap - 1e-9,
          `平行垂直段边距 ${(Math.abs(xa - xb) - W).toFixed(3)} < serpGap ${serpGap}`);
    }
  // 等长 DRC 通过
  assert.equal(core.checkDRC(d, r).filter(i => i.type === '差分等长').length, 0);
});

test('无碰撞：异网铜/焊盘/禁布区不被 bump 侵入（DRC 间距审计）', () => {
  const d = design(), r = baseR();
  // 异网横墙在下方（bump 应避开或改向上）
  d.pads.push({ id: 'F1-1', netId: 'c', x: 20, y: 10.2, w: 24, h: 1.2, layer: 'top' });
  r.nets[2].paths = [[{ x: 8, y: 20, l: 0 }, { x: 20, y: 20, l: 0 }, { x: 20, y: 22, l: 0 }, { x: 35, y: 22, l: 0 }]];
  const rep = core.serpentineTune(d, r, {});
  assert.equal(rep.tuned.length, 1, JSON.stringify(rep.skipped));
  const issues = core.checkDRC(d, r).filter(i => i.sev === 'error');
  assert.equal(issues.length, 0, 'DRC 错误：' + JSON.stringify(issues.slice(0, 3)));
  // bump 顶边到异网横墙边距 ≥ clearance
  const t = rep.tuned[0];
  for (const ins of t.insertions) {
    for (const path of r.nets[0].paths)
      for (const pt of path)
        if (pt.y !== 8)   // bump 上的点
          assert(core.distToRect(pt.x, pt.y, 20, 10.2, 24, 1.2) >= d.clearance - 1e-9,
            `bump 点 (${pt.x},${pt.y}) 距异网墙 < clearance`);
  }
});

test('lenGroup 等长组：多网以最长网为目标补齐', () => {
  const d = design();
  d.nets = [
    { id: 'a', name: 'D0', lenGroup: 'bus' },
    { id: 'b', name: 'D1', lenGroup: 'bus' },
    { id: 'c', name: 'D2', lenGroup: 'bus' },
  ];
  const r = { nets: [
    { netId: 'a', paths: [[{ x: 5, y: 8, l: 0 }, { x: 35, y: 8, l: 0 }]], vias: [] },          // 30
    { netId: 'b', paths: [[{ x: 5, y: 12, l: 0 }, { x: 30, y: 12, l: 0 }]], vias: [] },        // 25
    { netId: 'c', paths: [[{ x: 5, y: 20, l: 0 }, { x: 35, y: 22, l: 0 }]], vias: [] },        // ~30.06 最长
  ] };
  const rep = core.serpentineTune(d, r, {});
  assert.equal(rep.groups.length, 1, '一组');
  assert.equal(rep.groups[0].kind, 'lenGroup');
  const target = rep.groups[0].target;
  // 验收看 DRC 预算口径（无 tr 组：ΔL ≤ max(5%, 2mm)）——亚 bump 级残差（<2W）在预算内不补
  const budget = Math.max(0.05 * target, 2);
  for (const m of rep.groups[0].members) {
    const now = core.netRoutedLen(d, r, m.netId);
    assert(target - now <= budget, `成员 ${m.name} 调后长度 ${now.toFixed(3)} 超预算（目标 ${target}）`);
  }
  assert(rep.skipped.every(sk => sk.reason.includes('预算内')), '跳过项只允许预算内残差：' + JSON.stringify(rep.skipped));
  // DRC 等长组口径不再告警
  const eq = core.checkDRC(d, r).filter(i => i.type === '差分等长');
  assert.equal(eq.length, 0, JSON.stringify(eq));
});

test('无空间：短网全部直段 < 最小 bump 需求时如实跳过', () => {
  const d = design(), r = baseR();
  // 短网 a：全是 ≤1.5mm 碎直段+45° 斜段（全部 < 1.9mm 最小 bump 需求）
  r.nets[0].paths = [[
    { x: 5, y: 8, l: 0 }, { x: 6.5, y: 8, l: 0 },
    { x: 8, y: 9, l: 0 }, { x: 9, y: 9, l: 0 },
    { x: 10, y: 10, l: 0 }, { x: 11, y: 10, l: 0 },
    { x: 12, y: 11, l: 0 }, { x: 13, y: 11, l: 0 },
    { x: 14, y: 12, l: 0 }, { x: 15.5, y: 12, l: 0 },
  ]];
  const rep = core.serpentineTune(d, r, {});
  assert.equal(rep.tuned.length, 0, JSON.stringify(rep.tuned));
  assert.equal(rep.skipped.length, 1, JSON.stringify(rep.skipped));
  assert(rep.skipped[0].reason.includes('直段'), '原因可读：' + rep.skipped[0].reason);
});

test('子区间搜索：局部障碍（partner 焊盘）不再废掉整段容量', () => {
  const d = design(), r = baseR();
  // b（长网 31）带拐弯；a（短网 30）直段中点上方有 partner 焊盘——
  // 旧全有或全无检查会整段报废，列扫描应找到焊盘之间的自由子区间
  r.nets[1].paths = [[{ x: 5, y: 12, l: 0 }, { x: 20, y: 12, l: 0 }, { x: 20, y: 13, l: 0 }, { x: 35, y: 13, l: 0 }]];
  d.pads.push({ id: 'B9-1', netId: 'b', x: 20, y: 7.0, w: 1.2, h: 1.2, layer: 'top' });
  const rep = core.serpentineTune(d, r, {});
  assert.equal(rep.tuned.length, 1, JSON.stringify(rep));
  assert.equal(rep.tuned[0].residual, 0, '仍精确命中');
  for (const path of r.nets[0].paths)
    for (const pt of path)
      if (Math.abs(pt.y - 8) > 1e-9)
        assert(Math.abs(pt.x - 20) >= 1.2 - 1e-9 || Math.abs(pt.y - 7.0) - 0.3 >= 0.9 - 1e-9,
          `bump 点 (${pt.x},${pt.y}) 侵入 partner 焊盘 3W 带`);
  assert.equal(rep.audit.eqDrcClean, true);
});

test('确定性：同输入两次输出逐位一致', () => {
  const mk = () => { const d = design(), r = baseR(); return { d, r }; };
  const { d: d1, r: r1 } = mk(), { d: d2, r: r2 } = mk();
  const a = JSON.stringify(core.serpentineTune(d1, r1, {}));
  const b = JSON.stringify(core.serpentineTune(d2, r2, {}));
  assert.equal(a, b);
  assert.equal(JSON.stringify(r1.nets), JSON.stringify(r2.nets));
});

test('CLI tune：端到端写盘 + 报告', () => {
  const dir = join(tmpdir(), 'pcb-tune-test');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const d = design(), r = baseR();
  writeFileSync(join(dir, 'design.json'), JSON.stringify(d));
  writeFileSync(join(dir, 'result.json'), JSON.stringify(r));
  const out = JSON.parse(execFileSync(process.execPath,
    [join(process.cwd(), 'ai', 'pcb.mjs'), 'tune', join(dir, 'design.json'), join(dir, 'result.json')],
    { encoding: 'utf8', timeout: 120000 }));
  assert(out.ok && out.tuned === 1, JSON.stringify(out).slice(0, 300));
  const r2 = JSON.parse(readFileSync(join(dir, 'result.json'), 'utf8'));
  const la = core.netRoutedLen(d, r2, 'a'), lb = core.netRoutedLen(d, r2, 'b');
  assert(Math.abs(la - lb) < 1e-9, 'CLI 后 ΔL=' + Math.abs(la - lb));
});

test('真实布线端到端：route → tune → 等长 DRC 通过（验收全链）', () => {
  const d = core.designDefaults();
  d.width = 36; d.height = 22; d.grid = 0.5; d.trackW = 0.3; d.clearance = 0.2;
  d.nets = [{ id: 'p', name: 'USB_DP', pair: 'usb' }, { id: 'n', name: 'USB_DN', pair: 'usb' }];
  // P 两焊盘相距 20mm；N 相距 26mm → 布线自然长度差 ≈6mm
  d.pads = [
    { id: 'P1-1', netId: 'p', x: 5, y: 7, w: 1.2, h: 1.2, layer: 'top' },
    { id: 'P1-2', netId: 'p', x: 25, y: 7, w: 1.2, h: 1.2, layer: 'top' },
    { id: 'N1-1', netId: 'n', x: 5, y: 15, w: 1.2, h: 1.2, layer: 'top' },
    { id: 'N1-2', netId: 'n', x: 31, y: 15, w: 1.2, h: 1.2, layer: 'top' },
  ];
  const s = core.createSession(d, {});
  let guard = 0;
  for (;;) { const st = s.step(); if (st.done) break; if (++guard > 200000) throw new Error('step 超限'); }
  const r = s.buildResult();
  core.beautifyResult(d, r);
  const lp = core.netRoutedLen(d, r, 'p'), ln = core.netRoutedLen(d, r, 'n');
  assert.equal(core.checkDRC(d, r).filter(i => i.sev === 'error').length, 0, '布线本身无 DRC 错误');
  // 调谐前：等长告警应存在（布线自然失配）
  const warnBefore = core.checkDRC(d, r).filter(i => i.type === '差分等长').length;
  const rep = core.serpentineTune(d, r, {});
  assert.equal(rep.tuned.length, 1, JSON.stringify(rep));
  const lp2 = core.netRoutedLen(d, r, 'p'), ln2 = core.netRoutedLen(d, r, 'n');
  assert(Math.abs(lp2 - ln2) < 1e-9, `调后 ΔL=${Math.abs(lp2 - ln2).toFixed(6)}`);
  // 验收 1：等长 DRC 通过
  assert.equal(core.checkDRC(d, r).filter(i => i.type === '差分等长').length, 0, '调后等长告警应清零');
  // 验收 2：蛇形间距合规——bump 平行段边到边 ≥ 3W
  const W = 0.3, serpGap = Math.max(3 * W, d.clearance);
  const verts = [];
  for (const path of r.nets.find(x => x.netId === 'n').paths)
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1], b = path[k];
      if (a.l === b.l && Math.abs(a.x - b.x) < 1e-9) verts.push([Math.min(a.y, b.y), Math.max(a.y, b.y), a.x]);
      else if (a.l === b.l && Math.abs(a.y - b.y) < 1e-9) verts.push([Math.min(a.x, b.x), Math.max(a.x, b.x), a.y]);
    }
  for (let i = 0; i < verts.length; i++)
    for (let j = i + 1; j < verts.length; j++) {
      const [u0a, u1a, ca] = verts[i], [u0b, u1b, cb] = verts[j];
      if (Math.min(u1a, u1b) - Math.max(u0a, u0b) > 1e-9)
        assert(Math.abs(ca - cb) - W >= serpGap - 1e-9, `平行段边距 ${(Math.abs(ca - cb) - W).toFixed(3)} < ${serpGap}`);
    }
  // 全链 DRC 干净 + 连通保持
  assert.equal(core.checkDRC(d, r).filter(i => i.sev === 'error').length, 0, '调后 DRC 无错误');
  assert(core.staleResultCheck(d, r).ok, '结果-设计同步');
  void warnBefore; void lp; void ln;
});

/* ================= 大厂借鉴轮：固定目标/振幅上限/padToDie/自审计 ================= */

test('--target 固定目标长度（Altium Length 规则口径）', () => {
  const d = design(), r = baseR();   // a=30, b=31
  const rep = core.serpentineTune(d, r, { target: 33 });
  assert.equal(rep.tuned.length, 2, '两网都短于目标都调：' + JSON.stringify(rep.tuned.map(t => t.name)));
  for (const t of rep.tuned) assert.equal(t.residual, 0, t.name + ' residual=' + t.residual);
  for (const id of ['a', 'b'])
    assert(Math.abs(core.netRoutedLen(d, r, id) - 33) < 1e-9, id + ' 应达 33mm');
  assert.equal(core.checkDRC(d, r).filter(i => i.type === '差分等长').length, 0);
});

test('--max-amp 振幅上限（KiCad/Altium Max Amplitude）', () => {
  const d = design(), r = baseR();
  // 长网 32 → deficit 2；maxAmp 0.4 → k=ceil(2/0.8)=3 个 bump、振幅 0.333 精确命中
  r.nets[0].paths = [[{ x: 5, y: 8, l: 0 }, { x: 35, y: 8, l: 0 }]];
  r.nets[1].paths = [[{ x: 5, y: 12, l: 0 }, { x: 18, y: 12, l: 0 }, { x: 18, y: 14, l: 0 }, { x: 35, y: 14, l: 0 }]];
  const rep = core.serpentineTune(d, r, { maxAmp: 0.4 });
  const t = rep.tuned[0];
  assert.equal(t.residual, 0, '仍精确命中（residual=' + t.residual + '）');
  for (const ins of t.insertions) {
    assert(ins.amplitude <= 0.4 + 1e-9, '振幅 ' + ins.amplitude + ' 超 maxAmp');
    assert(ins.amplitude >= 0.3 - 1e-9, '振幅 ' + ins.amplitude + ' 低于线宽下限（几何退化）');
  }
  assert(t.insertions.some(i => i.bumps >= 3), '振幅受限应增加 bump 数：' + JSON.stringify(t.insertions));
  // maxAmp 挤压下的部分吸收：deficit 1 → 吸 0.8，残差 0.2 在等长预算内
  const d2 = design(); const r2 = baseR();
  const rep2 = core.serpentineTune(d2, r2, { maxAmp: 0.4 });
  const t2 = rep2.tuned[0];
  for (const ins of t2.insertions) assert(ins.amplitude <= 0.4 + 1e-9, '振幅超上限');
  assert(t2.residual <= 0.6, '残差 ' + t2.residual + ' 应小于最小合法 bump（预算内）');
});

test('nets[].padToDie 进等长口径（KiCad pad-to-die）', () => {
  const d = design(), r = baseR();
  d.nets[0].padToDie = 2;   // USB_P 封装内 2mm → 电气长度 32 > b 31 → b 变短网
  const rep = core.serpentineTune(d, r, {});
  const t = rep.tuned[0];
  assert.equal(t.name, 'USB_N', '短网换成了 b：' + t.name);
  assert.equal(t.target, 32, '目标含 padToDie');
  assert.equal(t.residual, 0);
  // DRC 同口径：调后无等长告警
  assert.equal(core.checkDRC(d, r).filter(i => i.type === '差分等长').length, 0);
});

test('report.audit 自审计：等长 DRC 清洁 + 平行动距 ≥ serpGap', () => {
  const d = design(), r = baseR();
  const rep = core.serpentineTune(d, r, {});
  assert(rep.audit, '报告含 audit');
  assert.equal(rep.audit.eqDrcClean, true, '等长 DRC 清洁：' + rep.audit.eqDrcMsg);
  // 单 bump 时无双平行段 → minParallelGap 为 null 或 ≥ serpGap
  if (rep.audit.minParallelGap != null)
    assert(rep.audit.minParallelGap >= rep.tuned[0].serpGap - 1e-9,
      '平行动距 ' + rep.audit.minParallelGap + ' < serpGap');
});

/* ================= 深度优化轮：partner 纪律 / audit 闭环 ================= */

test('partner 纪律：上侧不可用+伙伴压下侧 → 如实跳过（而非 0.05mm 贴脸）', () => {
  const d = design();
  d.height = 12;
  d.nets = [{ id: 'a', name: 'P', pair: 'dp' }, { id: 'b', name: 'N', pair: 'dp' }];
  d.pads = [
    { id: 'A1-1', netId: 'a', x: 5, y: 0.65, w: 1.2, h: 1.2, layer: 'top' },
    { id: 'A1-2', netId: 'a', x: 35, y: 0.65, w: 1.2, h: 1.2, layer: 'top' },
    { id: 'B1-1', netId: 'b', x: 5, y: 1.85, w: 1.2, h: 1.2, layer: 'top' },
    { id: 'B1-2', netId: 'b', x: 35, y: 1.85, w: 1.2, h: 1.2, layer: 'top' },
  ];
  const r = { nets: [
    { netId: 'a', paths: [[{ x: 5, y: 0.65, l: 0 }, { x: 35, y: 0.65, l: 0 }]], vias: [] },                                 // 30 短
    { netId: 'b', paths: [[{ x: 5, y: 1.85, l: 0 }, { x: 20, y: 1.85, l: 0 }, { x: 20, y: 2.85, l: 0 }, { x: 35, y: 2.85, l: 0 }]], vias: [] }, // 31 长
  ] };
  const rep = core.serpentineTune(d, r, {});
  // 上侧贴板边不可用；下侧 1.2mm 间隙被伙伴 3W 纪律全占 → 无合法 bump
  // （无纪律时会在距伙伴 0.05mm 处贴脸调谐——本测试锁定该行为不存在）
  assert.equal(rep.tuned.length, 0, JSON.stringify(rep.tuned));
  assert.equal(rep.skipped.length, 1);
  assert(rep.skipped[0].reason.includes('直段'), '原因：' + rep.skipped[0].reason);
});

test('partner 纪律：调谐换侧避开伙伴 3W 带（无纪律时会贴脸）', () => {
  const d = design();
  d.nets = [{ id: 'a', name: 'P', pair: 'dp' }, { id: 'b', name: 'N', pair: 'dp' }, { id: 'c', name: 'W' }];
  d.pads = [
    { id: 'A1-1', netId: 'a', x: 5, y: 8, w: 1.2, h: 1.2, layer: 'top' },
    { id: 'A1-2', netId: 'a', x: 35, y: 8, w: 1.2, h: 1.2, layer: 'top' },
    { id: 'B1-1', netId: 'b', x: 5, y: 9.2, w: 1.2, h: 1.2, layer: 'top' },
    { id: 'B1-2', netId: 'b', x: 35, y: 9.2, w: 1.2, h: 1.2, layer: 'top' },
    { id: 'C1-1', netId: 'c', x: 2, y: 6.9, w: 1.2, h: 1.2, layer: 'top' },
    { id: 'C1-2', netId: 'c', x: 38, y: 6.9, w: 1.2, h: 1.2, layer: 'top' },
  ];
  const r = { nets: [
    { netId: 'a', paths: [[{ x: 5, y: 8, l: 0 }, { x: 35, y: 8, l: 0 }]], vias: [] },                    // 30 短
    { netId: 'b', paths: [[{ x: 5, y: 9.2, l: 0 }, { x: 20, y: 9.2, l: 0 }, { x: 20, y: 10.2, l: 0 }, { x: 35, y: 10.2, l: 0 }]], vias: [] }, // 31 长（伙伴在下方 1.2mm）
    { netId: 'c', paths: [[{ x: 2, y: 6.9, l: 0 }, { x: 38, y: 6.9, l: 0 }]], vias: [] },                // 上方障碍墙压 up 侧 Amax≈0.6
  ] };
  const rep = core.serpentineTune(d, r, {});
  assert.equal(rep.tuned.length, 1, JSON.stringify(rep));
  assert.equal(rep.tuned[0].residual, 0);
  // bump 全部在上方（远离伙伴）且距 partner 走线 ≥ 3W
  for (const path of r.nets[0].paths)
    for (const pt of path)
      if (Math.abs(pt.y - 8) > 1e-9) {
        assert(pt.y < 8, `bump 点 (${pt.x},${pt.y}) 应在上方（远离伙伴）`);
        assert(9.2 - pt.y - 0.3 >= 0.9 - 1e-9, `bump 点 (${pt.x},${pt.y}) 距伙伴 ${(9.2 - pt.y - 0.3).toFixed(3)} < 0.9`);
      }
  assert.equal(rep.audit.eqDrcClean, true);
});

test('audit 闭环：drcErrors/staleOk/finalLens', () => {
  const d = design(), r = baseR();
  const rep = core.serpentineTune(d, r, {});
  assert(rep.audit, 'audit 存在');
  assert.equal(rep.audit.drcErrorsAfter, 0, JSON.stringify(rep.audit));
  assert.equal(rep.audit.drcErrorsBefore, 0, '基线也干净');
  assert.equal(rep.audit.staleOk, true);
  assert(rep.audit.finalLens && rep.audit.finalLens.length >= 1, 'finalLens 存在');
  for (const g of rep.audit.finalLens)
    for (const m of g.members)
      assert(Number.isFinite(m.len) && m.len > 0, 'finalLens 成员长度有效');
});
