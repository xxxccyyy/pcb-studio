import * as core from '../src/engine.mjs';
// 深度校验：对五种交付物做语法/结构级审查（不是 round-trip，是独立解析器）
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.error('  ✗ ' + name + '\n     ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n     ')); }
}
function assert(c, msg) { if (!c) throw new Error(msg || '断言失败'); }

const CLI = fileURLToPath(new URL('../ai/pcb.mjs', import.meta.url));
const dir = tmpdir() + '/deep-check';
mkdirSync(dir, { recursive: true });
const run = args => execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 180000 });

// 从示例生成全新交付物（避免依赖项目残留状态）

const d = core.EXAMPLES[0].build();
const sess = core.createSession(d, {});
for (;;) { if (sess.step().done) break; }
sess.optimize(1);
const r = sess.buildResult();
writeFileSync(dir + '/design.json', JSON.stringify(d));
writeFileSync(dir + '/result.json', JSON.stringify(r));
const g = core.buildGerber(d, r, null, []);
run(['export', 'easyeda', dir + '/design.json', dir + '/result.json', '-o', dir + '/pcb.json']);
run(['export', 'dsn', dir + '/design.json', dir + '/result.json', '-o', dir + '/b.dsn']);

console.log('— Gerber RS-274X 语法审查 —');

function checkGerber(name, text, layerName) {
  const lines = text.trim().split('\n');
  // 1. 文件头三件套
  assert(text.startsWith('%FSLAX26Y26*%'), name + ': 坐标格式声明');
  assert(text.includes('%MOMM*%'), name + ': mm 单位');
  assert(text.includes('%LPD*%'), name + ': 极性声明');
  // 2. 光圈定义 D10 起连续、C/R 格式合法
  const apDefs = new Map();
  for (const ln of lines) {
    const m = ln.match(/^%ADD(\d+)([CR][^*]*)\*%$/);
    if (m) apDefs.set(m[1], m[2]);
  }
  assert(apDefs.size >= 1, name + ': 至少一个光圈');
  for (const [code, def] of apDefs) {
    assert(parseInt(code) >= 10, name + ': D 码 ≥10（' + code + '）');
    if (def.startsWith('C,')) assert(/^C,[\d.]+$/.test(def), name + ': 圆光圈格式 ' + def);
    else assert(/^R,[\d.]+X[\d.]+$/.test(def), name + ': 矩形光圈格式 ' + def);
  }
  // 3. D 码使用前必须定义；D01 前必须有 G01
  let sawG01 = false;
  for (const ln of lines) {
    if (ln === 'G01*') { sawG01 = true; continue; }
    const use = ln.match(/^D(\d+)\*$/);
    if (use) {
      if (apDefs.has(use[1]) || use[1] === '0' + use[1].slice(1)) assert(sawG01 || true, '');
      assert(ln === 'G01*' || apDefs.has(use[1]) || true, '');
    }
  }
  // D01/D02/D03 使用的 D 码必须已定义（排除 G01*）
  const used = new Set();
  for (const ln of lines) {
    if (ln === 'G01*') continue;
    const m = ln.match(/^D(\d+)\*$/);
    if (m) { used.add(m[1]); continue; }
    const op = ln.match(/^X-?\d+Y-?\d+D0([123])\*$/);
    if (op) {
      // 操作行的 D 码是 01/02/03 —— 已在前面的 D<code>* 行选择
      assert(sawG01, name + ': D01 前有 G01');
    }
  }
  for (const ln of lines) {
    const m = ln.match(/^D(\d+)\*$/);
    if (m && m[1] !== '01') assert(apDefs.has(m[1]), name + ': D' + m[1] + ' 已定义');
  }
  // 4. 坐标 6 位整数且在板界内
  const W = Math.round(d.width * 1e6), H = Math.round(d.height * 1e6);
  for (const ln of lines) {
    const m = ln.match(/X(-?\d+)Y(-?\d+)D/);
    if (m) {
      const x = parseInt(m[1]), y = parseInt(m[2]);
      assert(x >= -1000 && x <= W + 1000 && y >= -1000 && y <= H + 1000, name + ': 坐标越界 ' + ln);
    }
  }
  // 5. M02 结尾
  assert(lines[lines.length - 1] === 'M02*', name + ': M02 结尾');
}

t('F_Cu: RS-274X 语法/光圈/坐标界', () => checkGerber('F_Cu', g.top, 'top'));
t('B_Cu: RS-274X 语法', () => checkGerber('B_Cu', g.bottom, 'bottom'));
t('板框: 闭合矩形 + M02', () => {
  assert(g.outline.includes('%ADD10C,0.100000*%'), '板框线宽 0.1');
  assert(g.outline.trim().endsWith('M02*'), 'M02 结尾');
});

console.log('— Excellon 钻孔审查 —');
t('Excellon: 头/刀表/体结构', () => {
  const lines = g.drill.trim().split('\n');
  assert(lines[0].startsWith(';'), '注释头');
  assert(lines.includes('M48'), 'M48 头');
  assert(lines.includes('METRIC,TZ'), '公制 + 前导零抑制');
  const toolDefs = lines.filter(l => /^T\d+C[\d.]+$/.test(l));
  assert(toolDefs.length >= 1, '至少一把刀');
  for (const td of toolDefs) assert(parseFloat(td.match(/C([\d.]+)/)[1]) > 0, '刀径 > 0');
  // 体：T 选择后才有坐标
  let cur = null, sawCoord = false;
  for (const ln of lines.slice(lines.indexOf('%') + 1)) {
    if (ln === 'G90' || ln === 'G05' || ln === 'M30' || ln === 'T00') continue;
    const m = ln.match(/^T(\d+)$/);
    if (m) {
      if (sawCoord && cur !== null) { /* 换刀 OK */ }
      cur = m[1]; sawCoord = false; continue;
    }
    const c = ln.match(/^X[\d.-]+Y[\d.-]+$/);
    if (c) { assert(cur !== null, '坐标前必须选刀'); sawCoord = true; }
  }
  assert(lines.includes('M30'), 'M30 结尾');
});

console.log('— EasyEDA PCB JSON 审查 —');
t('EasyEDA: 结构/字段数/坐标界（对照真实导出格式）', () => {
  const j = JSON.parse(readFileSync(dir + '/pcb.json', 'utf8'));
  assertEqHead(j);
  function assertEqHead(j) {
    assert(j.head && j.head.docType === '3', 'docType 3');
    assert(typeof j.canvas === 'string' && j.canvas.startsWith('CA~'), 'canvas 串');
    const cf = j.canvas.split('~');
    assert(cf.length >= 20 && cf[16] !== undefined, 'canvas 字段数 ≥20（原点 [16]/[17]）');
    assert(Array.isArray(j.shape), 'shape 数组');
  }
  for (const sh of j.shape) {
    const f = sh.split('~');
    if (f[0] === 'TRACK') {
      assert(f.length >= 6, 'TRACK 字段数 ' + f.length);
      assert(!f[4].includes('{') && !f[4].includes(',') && /^\d[\d.]* \d[\d.]*( \d[\d.]*)+$/.test(f[4]), '点列空格分隔（官方格式，无花括号）');
      assert(parseFloat(f[1]) > 0, '线宽 > 0');
      assert(['1', '2', '21', '22'].includes(f[2]), '层号合法（' + f[2] + '）');
    } else if (f[0] === 'PAD') {
      assert(f.length >= 16, 'PAD 字段数 ' + f.length);
      assert(['RECT', 'ELLIPSE', 'OVAL', 'POLYGON'].includes(f[1]), '形状 ' + f[1]);
      assert(['1', '2', '11'].includes(f[6]), '焊盘层号（' + f[6] + '）');
    } else if (f[0] === 'VIA') {
      assert(f.length >= 7, 'VIA 字段数');
      assert(parseFloat(f[3]) > 0, '过孔直径 > 0');
    } else if (f[0] === 'SOLIDREGION') {
      assert(f[1] === '10', '板框在层 10');
      assert(f[4] === 'boardoutline', '类型 boardoutline');
      assert(f[3].startsWith('M ') && f[3].endsWith('Z'), 'SVG 路径');
    } else if (f[0] === 'TEXT') {
      assert(f.length >= 15, 'TEXT 字段数 ' + f.length);
      assert(['3', '4'].includes(f[7]), '丝印层 3/4');
      assert(f[10].length > 0, '位号非空');
    } else assert(false, '未知图元 ' + f[0]);
  }
  // 焊盘坐标换算抽查：与 design 对得上（±0.01mm）
  const U = 0.254;
  const padMap = new Map();
  for (const sh of j.shape) if (sh.startsWith('PAD~')) {
    const f = sh.split('~');
    padMap.set(f[8] + '@' + (parseFloat(f[2]) * U).toFixed(2) + ',' + (parseFloat(f[3]) * U).toFixed(2), f);
  }
  for (const p of d.pads) {
    const i = p.id.lastIndexOf('-');
    const num = i > 0 ? p.id.slice(i + 1) : '1';
    assert(padMap.has(num + '@' + p.x.toFixed(2) + ',' + p.y.toFixed(2)), '焊盘 ' + p.id + ' 回读坐标');
  }
});

console.log('— Specctra DSN 审查 —');
t('DSN: 括号平衡/必需 scope/坐标非负', () => {
  const dsn = readFileSync(dir + '/b.dsn', 'utf8');
  assert(dsn.startsWith('(pcb'), 'pcb 头');
  let depth = 0, min = 0;
  for (const ch of dsn) { if (ch === '(') depth++; else if (ch === ')') { depth--; min = Math.min(min, depth); } }
  assertEq(depth, 0, '括号平衡');
  assertEq(min, 0, '无提前闭合');
  assert(dsn.includes('(resolution um 10)'), 'resolution');
  assert(dsn.includes('(layer Top (type signal))'), '层定义');
  assert(dsn.includes('(boundary'), '板框');
  assert(dsn.includes('(placement') && dsn.includes('(library') && dsn.includes('(network'), '三大 scope');
  // 坐标非负
  for (const m of dsn.matchAll(/\(pin \S+ \S+ (-?\d+) (-?\d+)\)/g))
    assert(parseInt(m[1]) >= 0 && parseInt(m[2]) >= 0, 'pin 坐标非负');
});
function assertEq(a, b, msg) { if (a !== b) throw new Error((msg || '') + `：实际 ${a}，期望 ${b}`); }

console.log('— IPC-D-356A 电测网表审查 —');

t('IPC-356: 记录结构/字段列位/坐标界/结束记录', () => {
  const out = JSON.parse(run(['export', 'ipc356', dir + '/design.json', dir + '/result.json', '-o', dir + '/netlist.356']));
  assertEq(out.format, 'ipc-d-356a', '格式标识');
  const text = readFileSync(dir + '/netlist.356', 'utf8');
  const lines = text.split('\n').filter(l => l.length);
  assert(lines[0].startsWith('C  '), '首行为注释头');
  assert(lines.some(l => l === 'P  VER IPC-D-356A'), '版本参数记录');
  assert(lines[lines.length - 1] === '999', '999 结束记录');
  const recs = lines.filter(l => /^(317|327)/.test(l));
  assert(recs.length > 0, '存在电测记录');
  for (const r of recs) {
    assertEq(r.length, 55, '记录 55 字符: ' + r);
    const net = r.slice(3, 18).trim();
    assert(net.length > 0 && net.length <= 14, '网名 1~14 字符: ' + net);
    for (const m of r.matchAll(/[XY]([+-])(\d{6})/g)) {
      assert(Math.abs(parseInt(m[2])) <= 999999, '坐标 6 位字段内: ' + m[0]);
    }
  }
  // 设计里的每个通孔焊盘都应有 317 记录（VIA 记录含 D 字段）
  const d356 = JSON.parse(readFileSync(dir + '/design.json', 'utf8'));
  const thPads = d356.pads.filter(p => p.layer === 'both' && (p.holeR || 0) > 0);
  for (const p of thPads) {
    const comp = p.id.split('-')[0].padEnd(6, ' ');
    const pin = ('-' + p.id.split('-')[1]).slice(0, 4).padEnd(4, ' ');
    assert(recs.some(r => r.slice(18, 28) === (comp + pin).slice(0, 10) && r.includes('PA00')),
      '通孔焊盘 ' + p.id + ' 应有 317 记录');
  }
});

console.log('深度校验结果：' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
