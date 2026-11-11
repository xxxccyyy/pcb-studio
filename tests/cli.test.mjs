import * as core from '../src/engine.mjs';
// CLI 端到端回归测试：子进程运行 ai/pcb.mjs，断言 JSON 输出。
// 这个工具的主要用户是走 CLI 的 AI 代理——命令面必须有回归保护。
// 运行：node tests/cli.test.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.error('  ✗ ' + name + '\n     ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n     ')); }
}
function assert(c, msg) { if (!c) throw new Error(msg || '断言失败'); }
function assertEq(a, b, msg) { if (a !== b) throw new Error((msg || '不相等') + `：实际 ${a}，期望 ${b}`); }

import { fileURLToPath } from 'node:url';
const CLI = fileURLToPath(new URL('../ai/pcb.mjs', import.meta.url));
const run = (args, opts) => {
  const stdout = execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 180000, ...opts });
  return JSON.parse(stdout);
};
const dir = join(tmpdir(), 'pcb-cli-test');
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const fix = join(dir, 'design.json');

// 小型 fixture：SOIC-8 + 排针（快）
{

  const d = core.designDefaults();
  d.width = 40; d.height = 30;
  d.nets = [{ id: 'a', name: 'DATA' }, { id: 'b', name: 'GND' }];
  const soic = core.footprintPads('SOIC-8');
  const hdr = core.footprintPads('排针 1×N', 4);
  d.pads = [
    ...soic.map((f, i) => ({ id: 'U1-' + (i + 1), netId: i % 2 ? 'a' : 'b', x: 12 + f.dx, y: 15 + f.dy, w: f.w, h: f.h, shape: f.shape, layer: f.layer })),
    ...hdr.map((f, i) => ({ id: 'J1-' + (i + 1), netId: i % 2 ? 'a' : 'b', x: 32 + f.dx, y: 15 + f.dy, w: f.w, h: f.h, shape: f.shape, layer: 'both' }))
  ];
  d.comps = { U1: { x: 12, y: 15, rot: 0, layer: 'top', value: 'DEMO', footprint: 'SOIC-8' },
              J1: { x: 32, y: 15, rot: 90, layer: 'top', value: 'HDR', footprint: 'HDR-4P' } };
  writeFileSync(fix, JSON.stringify(d, null, 1));
}

console.log('— CLI：知识/校验命令 —');

t('schema：字段说明 + 负面清单 + 示例', () => {
  const j = run(['schema']);
  assert(j.ok && j.design && j.常见错误.length >= 5, '结构');
  assert(j.示例 && j.示例.pads, '内嵌示例');
});

t('rules：三层规则 + DFM 锚点', () => {
  const j = run(['rules']);
  assert(j.可靠_硬规则.length >= 5 && j.勿信_谣言.length >= 5, '三层');
  assert(j.DFM_嘉立创锚点.trackLimit, 'DFM 锚点');
});

t('spec：校验 + problems', () => {
  const j = run(['spec', fix]);
  assertEq(j.ok, true, 'ok');
  assertEq(j.pads, 12, '焊盘数');
  assertEq(j.problems.length, 0, '无问题');
});

console.log('— CLI：设计命令 —');

t('erc：findings 结构', () => {
  const j = run(['erc', fix]);
  assert(j.ok && Array.isArray(j.findings) && j.summary.components === 2, '结构');
});

t('place：布局后 comps 同步 + 焊盘在板内', () => {
  const placed = join(dir, 'placed.json');
  const j = run(['place', fix, '-o', placed, '--iterations', '1500']);
  assert(j.ok && j.after < j.before, '代价下降');
  const d = JSON.parse(readFileSync(placed, 'utf8'));
  assert(d.comps && d.comps.U1 && d.comps.U1.x != null, 'comps 同步');
  for (const p of d.pads) assert(p.x >= 0 && p.x <= d.width && p.y >= 0 && p.y <= d.height, '板内');
});

t('route：布通 + result.json 写盘', () => {
  const placed = join(dir, 'placed.json');
  const result = join(dir, 'result.json');
  const j = run(['route', placed, '-o', result, '--max-iter', '40']);
  assertEq(j.status, 'complete', '布通（' + JSON.stringify(j.stats) + '）');
  assert(j.written === result, '写盘路径');
  const r = JSON.parse(readFileSync(result, 'utf8'));
  assert(r.stats && r.nets, 'result 文件可读');
});

t('drc：复检布线结果', () => {
  const j = run(['drc', join(dir, 'placed.json'), join(dir, 'result.json')]);
  assert(j.ok && j.summary.errors === 0, 'DRC 干净（' + JSON.stringify(j.summary) + '）');
  assert(j.fabChecklist.length > 5, '检查表');
});

console.log('— CLI：交付命令 —');

t('pour：铺铜 + 缝合孔写入 design', () => {
  const placed = join(dir, 'placed.json');
  const result = join(dir, 'result.json');
  const j = run(['pour', placed, result, '--net', 'GND', '--layer', 'bottom', '--stitch-spacing', '5']);
  assert(j.ok && j.pourAreaMM2 > 0, '铺铜面积');
  assert(j.stitches > 0, '缝合孔');
  const d = JSON.parse(readFileSync(placed, 'utf8'));
  assert((d.stitching || []).length === j.stitches, 'stitching 已写回 design');
});

t('bom：嘉立创 SMT 四列 CSV', () => {
  const j = run(['bom', join(dir, 'placed.json')]);
  assertEq(j.rows.length, 2, '组件数');
  assert(j.csv.startsWith('Comment,Designator,Footprint,LCSC Part #'), '表头');
  assert(j.rows.some(r => r.designator === 'U1'), '含 U1');
});

t('pos：CPL 坐标（y 已翻转）', () => {
  const j = run(['pos', join(dir, 'placed.json')]);
  assertEq(j.rows.length, 2, '组件数');
  assert(j.csv.startsWith('Designator,Mid X,Mid Y,Layer,Rotation'), '表头');
  for (const r of j.rows) { assert(r.midY >= 0 && r.midY <= 30, '翻转后 y 在板内'); assert(['top', 'bottom'].includes(r.layer), '层'); }
});

t('schem：原理图 JSON（docType 1）', () => {
  const out = join(dir, 'sch.json');
  const j = run(['schem', join(dir, 'placed.json'), '-o', out]);
  assertEq(j.format, 'easyeda-schematic-json', '格式');
  const doc = JSON.parse(readFileSync(out, 'utf8'));
  assertEq(doc.head.docType, '1', 'docType');
  assert(doc.shape.filter(s => s.startsWith('LIB~')).length === 2, '两个 LIB');
});

t('export easyeda/svg/dsn：三种格式可写盘', () => {
  const placed = join(dir, 'placed.json'), result = join(dir, 'result.json');
  const e = run(['export', 'easyeda', placed, result, '-o', join(dir, 'pcb.json')]);
  assertEq(e.format, 'easyeda-pcb-json', 'easyeda');
  const doc = JSON.parse(readFileSync(join(dir, 'pcb.json'), 'utf8'));
  assertEq(doc.head.docType, '3', 'PCB docType');
  assert(doc.shape.some(s => s.startsWith('TEXT~')), '含丝印位号');
  const s = run(['export', 'svg', placed, result, '-o', join(dir, 'b.svg')]);
  assert(s.ok && s.bytes > 1000, 'svg');
  const d2 = run(['export', 'dsn', placed, result, '-o', join(dir, 'b.dsn')]);
  assert(d2.ok && d2.bytes > 500, 'dsn');
});

t('export gerber：八件套写盘（含铺铜/阻焊/丝印）', () => {
  const j = run(['export', 'gerber', join(dir, 'placed.json'), join(dir, 'result.json'), '-o', join(dir, 'g/atk')]);
  assertEq(j.files.length, 8, '八件套');
  for (const f of j.files) {
    const txt = readFileSync(f, 'utf8');
    assert(txt.length > 50, f + ' 非空');
  }
});

t('render：PNG 视觉自检（magic + 尺寸）', () => {
  const out = join(dir, 'board.png');
  const j = run(['render', join(dir, 'placed.json'), join(dir, 'result.json'), '-o', out, '--scale', '8']);
  assert(j.ok && j.width > 100 && j.height > 60, '尺寸合理');
  const buf = readFileSync(out);
  assert(buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47, 'PNG magic');
  assertEq((buf[16] << 24 | buf[17] << 16 | buf[18] << 8 | buf[19]) >>> 0, j.width, 'IHDR 宽一致');
});

t('autopcb：布局-布线循环一次到位', () => {
  const out = join(dir, 'auto.json');
  const j = run(['autopcb', fix, '-o', out, '--rounds', '3', '--max-iter', '40', '--iterations', '1500']);
  assert(j.ok && j.log.length >= 1, 'log');
  assert(j.best && j.best.status === 'complete', 'best 布通（' + JSON.stringify(j.log.map(l => l.connected + '/' + l.total)) + '）');
  const d = JSON.parse(readFileSync(out, 'utf8'));
  assertEq(d.pads.length, 12, '焊盘数不变');
});

t('deliver：一键交付包（门禁过 + 交付物 + manifest 证据级）', () => {
  const outDir = join(dir, '交付包');
  const j = run(['deliver', join(dir, 'placed.json'), join(dir, 'result.json'), '-o', outDir, '--project', 'demo 板']);
  assert(j.ok && j.override === false, '门禁通过无覆盖');
  assertEq(j.gates.verify.ok, true, 'verify 门禁');
  assertEq(j.gates.drc.errors, 0, 'DRC 门禁');
  assertEq(j.gates.connectivity.ok, true, '连通性门禁');
  assert(j.artifacts >= 15, '交付物数量（' + j.artifacts + '）');
  const manifest = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8'));
  assertEq(manifest.project, 'demo_板', '项目名消毒（空格→_）');
  assertEq(manifest.override.forced, false);
  const ev = manifest.artifacts.map(a => a.evidence);
  assert(ev.includes('roundtrip-verified'), 'EasyEDA 证据级=写后回读验证');
  assert(ev.includes('datasheet-backed'), 'BOM/检查表证据级');
  for (const a of manifest.artifacts) assert(a.bytes > 0 && a.evidence, '每件带 bytes+evidence');
});

t('deliver：门禁中止（无 result 空板拒绝）+ --force 留痕', () => {
  let caught = false;
  try {
    run(['deliver', join(dir, 'placed.json'), '-o', join(dir, '拒')]);
  } catch (e) {
    caught = true;
    const m = ((e.stdout || '') + (e.stderr || '')).match(/\{[\s\S]*\}/);
    assert(m, '拒绝输出 JSON');
    const j = JSON.parse(m[0]);
    assertEq(j.ok, false);
    assert(/门禁/.test(j.error), '门禁语义');
    assertEq(j.gates.connectivity.ok, false, '连通性门禁拦截空板');
  }
  assert(caught, '无 result 必须拒绝');
  // --force 覆盖：manifest 如实记录 override
  const j = run(['deliver', join(dir, 'placed.json'), '-o', join(dir, '强'), '--force', '--project', 'forced']);
  assert(j.ok && j.override === true, 'force 放行');
  const manifest = JSON.parse(readFileSync(join(dir, '强', 'manifest.json'), 'utf8'));
  assertEq(manifest.override.forced, true, 'override 如实留痕');
  assertEq(manifest.gates.connectivity.ok, false, '门禁原始结果保留（不粉饰）');
});

console.log('\nCLI 结果：' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
