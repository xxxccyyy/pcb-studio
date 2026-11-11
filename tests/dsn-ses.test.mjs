import * as core from '../src/engine.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Specctra DSN 导入 + SES 导出回归（roadmap #7：KiCad 双向插件的引擎半边）
// 刻度锚点（docs/Freerouting源码研读.md line128，Issue026 实样交叉验证）：
// 本工具/Freerouting DSN 数值=µm（mm×1000）；SES 数值=DSN×R=mm×10000；
// KiCad pcbnew ExportSpecctraDSN 数值=0.1µm（mm×10000）——importDSN 自适应判别。

const CLI = fileURLToPath(new URL('../ai/pcb.mjs', import.meta.url));

// 自导出底料：555 示例（含布通布线供 SES 链）
const routed555 = (() => {
  const d = core.normalizeDesign(core.EXAMPLES_555());
  d.name = 'myboard';
  const r = core.routeBoard(d, { maxIter: 12 }).result;
  return { design: d, result: r, dsn: core.exportDSN(d) };
})();

test('DSN 本工具方言往返：exportDSN→importDSN 焊盘/网络/板幅/线宽逐项命中', () => {
  const { design: d, dsn } = routed555;
  const imp = core.importDSN(dsn);
  assert.equal(imp.pads.length, d.pads.length, '焊盘数');
  assert.equal(imp.nets.length, d.nets.length, '网络数');
  assert.ok(Math.abs(imp.width - d.width) < 0.01 && Math.abs(imp.height - d.height) < 0.01,
    `板幅 ${imp.width}×${imp.height} vs ${d.width}×${d.height}`);
  for (const p of d.pads) {
    const q = imp.pads.find(x => x.id === p.id);
    assert.ok(q, `焊盘 ${p.id} 回读缺失`);
    assert.ok(Math.abs(q.x - p.x) < 0.01 && Math.abs(q.y - p.y) < 0.01, `焊盘 ${p.id} 坐标`);
    const origNet = (d.nets.find(n => n.id === p.netId) || {}).name;
    const gotNet = (imp.nets.find(n => n.id === q.netId) || {}).name;
    assert.equal(gotNet, origNet, `焊盘 ${p.id} 网名 ${gotNet} ≠ 原 ${origNet}`);
  }
  assert.equal(imp.external, true, 'external 惯例');
  // DSN 不带走线（布线走 SES 通路）
  assert.equal(imp.manual.length, 0);
});

test('KiCad dialect：image/place 分离 + 90°/270° 旋转 + front/back + 0.1µm 刻度', () => {
  const dsn = `
(pcb "kicad_test.dsn"
  (parser (string_quote ") (space_in_quoted_tokens on) (host_cad "pcbnew"))
  (resolution um 10)
  (unit um)
  (structure
    (layer Top (type signal)) (layer In1 (type signal))
    (layer In2 (type signal)) (layer Bottom (type signal))
    (boundary (path pcb 0  0 0  400000 0  400000 300000  0 300000  0 0))
    (via VIA_DEFAULT)
    (rule (width 2500) (clearance 2000))
  )
  (placement
    (component SOT-23-6
      (place "U7" 100000 150000 front 90)
      (place "U3" 200000 100000 back 270)
    )
  )
  (library
    (image SOT-23-6
      (pin PAD_SMD_TOP "1" -9525 14288)
      (pin PAD_SMD_TOP "2" 9525 14288)
      (pin PAD_SMD_TOP "3" 0 -9525)
    )
    (padstack PAD_SMD_TOP (shape (rect Top -3000 -3000 3000 3000)) (attach off))
    (padstack VIA_DEFAULT (shape (circle signal 8000)) (attach off))
  )
  (network
    (net "GND" (pins "U7-1" "U3-2") (rule (width 5000)))
    (net "SIG" (pins "U7-3" "U3-1"))
  )
)`;
  const imp = core.importDSN(dsn);
  assert.equal(imp.layers, 4, '4 signal 层');
  assert.equal(imp.trackW, 0.25, '0.1µm 刻度：2500→0.25mm');
  assert.equal(imp.clearance, 0.2);
  assert.equal(imp.viaOuter, 0.8, 'via padstack 8000→0.8mm');
  assert.ok(Math.abs(imp.width - 40) < 0.01 && Math.abs(imp.height - 30) < 0.01, '板幅 40×30');
  // 旋转公式：板坐标 = rotate(pin 本地, place.rot) + place 位置
  const u71 = imp.pads.find(p => p.id === 'U7-1');
  assert.ok(u71, 'U7-1 存在');
  // pin1 本地 (-0.9525,1.4288) 旋转 90° → (-1.4288,-0.9525) + (10,15) = (8.5712,14.0475)
  assert.ok(Math.abs(u71.x - 8.5712) < 0.01 && Math.abs(u71.y - 14.0475) < 0.01,
    `U7-1 @${u71.x},${u71.y}（front 90° 旋转）`);
  assert.equal(u71.layer, 'top');
  assert.equal(u71.w, 0.6, 'rect Top ±3000 → 0.6mm');
  const u31 = imp.pads.find(p => p.id === 'U3-1');
  // pin1 旋转 270° → (1.4288,0.9525) + (20,10) = (21.4288,10.9525)；back→bottom
  assert.ok(Math.abs(u31.x - 21.4288) < 0.01 && Math.abs(u31.y - 10.9525) < 0.01, `U3-1 @${u31.x},${u31.y}（back 270°）`);
  assert.equal(u31.layer, 'bottom');
  // 网名映射（带引号的 net 名）
  assert.equal((imp.nets.find(n => n.id === u71.netId) || {}).name, 'GND');
  // 每网线宽 rule：GND 5000→0.5mm
  assert.equal(imp.nets.find(n => n.name === 'GND').w, 0.5, 'net rule width 0.5mm');
});

test('刻度自适应：无 host_cad 时按典型尺寸合理性识别 0.1µm 口径', () => {
  const dsn = `
(pcb "guess.dsn"
  (parser (string_quote ") (space_in_quoted_tokens on))
  (resolution um 10)
  (unit um)
  (structure
    (layer Top (type signal)) (layer Bottom (type signal))
    (boundary (path pcb 0  0 0  300000 0  300000 200000  0 200000  0 0))
    (rule (width 1600) (clearance 2000))
  )
  (placement (component R0402 (place "R1" 50000 50000 front 0)))
  (library
    (image R0402
      (pin P1 "1" -2000 0) (pin P1 "2" 2000 0))
    (padstack P1 (shape (rect Top -3000 -1500 3000 1500)) (attach off))
    (padstack VIA_DEFAULT (shape (circle signal 8000)) (attach off))
  )
  (network (net "A" (pins "R1-1" "R1-2")))
)`;
  const imp = core.importDSN(dsn);
  assert.equal(imp.trackW, 0.16, '1600→0.16mm（0.1µm 口径）');
  assert.equal(imp.viaOuter, 0.8);
  const r11 = imp.pads.find(p => p.id === 'R1-1');
  assert.ok(Math.abs(r11.x - 4.8) < 0.01 && Math.abs(r11.y - 5) < 0.01, `R1-1 @${r11.x},${r11.y}`);
});

test('SES 回读链：route→exportSES→importSES 逐点对账（含引号网名 LED_N）', () => {
  const { design: d, result: r } = routed555;
  const ses = core.exportSES(d, { nets: r.nets });
  assert.ok(ses.includes('(session "myboard"'), 'session 头带板名');
  assert.ok(ses.includes('(net "LED_N"'), '下划线网名按 Freerouting 规则加引号');
  const back = core.importSES(ses, d);
  assert.equal(back.errors.length, 0, '回读零跳过: ' + JSON.stringify(back.errors));
  // 无 via 时各 wire run 独立成 entry——逐网 run 数与原 paths 的单层 run 数一致
  let expRuns = 0;
  for (const n of r.nets) for (const path of n.paths) {
    let runLen = 0, prev = null;
    for (const pt of path) { if (prev === null || pt.l !== prev) { if (runLen > 1) expRuns++; runLen = 1; prev = pt.l; } else runLen++; }
    if (runLen > 1) expRuns++;
  }
  assert.equal(back.entries.length, expRuns, 'run 数一致（换层拆分对称）');
  let miss = 0;
  for (const e of back.entries) {
    const orig = r.nets.find(n => n.netId === e.netId);
    if (!orig) { miss++; continue; }
    const key = p => p.x.toFixed(3) + '_' + p.y.toFixed(3) + '_L' + p.l;
    const origPts = new Set();
    for (const path of orig.paths) for (const p of path) origPts.add(key(p));
    for (const p of e.pts) if (!origPts.has(key(p))) miss++;
  }
  assert.equal(miss, 0, '回读点集与原布线逐点一致');
});

test('SES 换层合并：两段单层 wire + via → 回读为一条折线（换层点=过孔）', () => {
  const d = core.designDefaults();
  d.width = 30; d.height = 20; d.nets = [{ id: 'a', name: 'A_NET' }];
  d.pads = [
    { id: 'U1-1', netId: 'a', x: 5, y: 10, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' },
    { id: 'U1-2', netId: 'a', x: 25, y: 10, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' }];
  // 构造含换层的布线结果（manual 形态与 route 输出同构）
  const result = { nets: [{ netId: 'a', paths: [
    [{ x: 5, y: 10, l: 0 }, { x: 15, y: 10, l: 0 }],
    [{ x: 15, y: 10, l: 1 }, { x: 25, y: 10, l: 1 }]],
    vias: [{ x: 15, y: 10 }], overuse: [] }], overuse: [] };
  const ses = core.exportSES(d, result);
  const back = core.importSES(ses, d);
  assert.equal(back.errors.length, 0);
  assert.equal(back.vias, 1, '过孔合并计数');
  assert.equal(back.entries.length, 1, '两段 wire 合并为一条折线');
  const pts = back.entries[0].pts;
  assert.equal(pts.length, 4, '5(L0)→15(L0)→15(L1,过孔)→25(L1)——去重按 x+y+l');
  assert.equal(pts[1].l, 0, 'via 前段顶层');
  assert.equal(pts[2].l, 1, '换层点层号=Bottom');
});

test('CLI 端到端：export ses 落盘 + import dsn 回读', () => {
  const dir = join(tmpdir(), 'pcb-dsn-ses-test');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const dj = join(dir, 'design.json'), rj = join(dir, 'result.json');
  const { design: d, result: r } = routed555;
  writeFileSync(dj, JSON.stringify(d, null, 1));
  writeFileSync(rj, JSON.stringify(r, null, 1));
  const outSes = join(dir, 'out.ses');
  const j = JSON.parse(execFileSync(process.execPath, [CLI, 'export', 'ses', dj, rj, '-o', outSes],
    { encoding: 'utf8', timeout: 120000 }));
  assert.equal(j.ok, true);
  assert.equal(j.format, 'specctra-ses');
  assert.ok(readFileSync(outSes, 'utf8').includes('network_out'), 'SES 落盘');
  // DSN 落盘 + CLI 导入
  const outDsn = join(dir, 'out.dsn');
  execFileSync(process.execPath, [CLI, 'export', 'dsn', dj, '-o', outDsn], { encoding: 'utf8', timeout: 120000 });
  const imp = JSON.parse(execFileSync(process.execPath, [CLI, 'import', 'dsn', outDsn, '-o', join(dir, 'imp.json')],
    { encoding: 'utf8', timeout: 120000 }));
  assert.equal(imp.ok, true);
  assert.equal(imp.pads, d.pads.length);
  rmSync(dir, { recursive: true, force: true });
});

test('坏输入：干净 JSON 错误零崩溃', () => {
  assert.throws(() => core.importDSN('(kicad_pcb (version 1))'), /Specctra DSN/, 'KiCad 文件误投 DSN 通道');
  assert.throws(() => core.importDSN('(pcb "x" (parser (string_quote "")) )'), /structure/, '缺 structure');
  assert.throws(() => core.importDSN(`(pcb "x" (parser (string_quote "")) (structure (layer Top (type signal)) (layer Bottom (type signal)))))`),
    /boundary/, '缺板框');
  assert.throws(() => core.importDSN(`(pcb "x" (parser (string_quote "") (resolution furlong 3)) (structure (layer Top (type signal)) (boundary (path pcb 0 0 0 100 0 100 100 0 0)))))`),
    /单位/, '未知单位');
  // KiCad dialect 的 DSN 内嵌 string_quote 自指不再毒化解析（修复回归）
  const ok = core.importDSN(`(pcb "t.dsn"
    (parser (string_quote ") (space_in_quoted_tokens on) (host_cad "pcbnew"))
    (resolution um 10) (unit um)
    (structure (layer Top (type signal)) (layer Bottom (type signal))
      (boundary (path pcb 0 0 0 100000 0 100000 100000 0 0)))
    (placement (component C (place "C1" 0 0 front 0)))
    (library (image C (pin P "1" 0 0)) (padstack P (shape (rect Top -1500 -750 1500 750)) (attach off)))
    (network (net "N" (pins "C1-1"))))`);
  assert.equal(ok.pads.length, 1);
});
