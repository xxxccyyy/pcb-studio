// 模糊测试：畸形输入到所有消费文件的 CLI 命令——要求 JSON 错误输出而非堆栈崩溃
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../ai/pcb.mjs', import.meta.url));
const dir = tmpdir() + '/pcb-fuzz';
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

let pass = 0;
const bad = [];
function fuzz(name, fileContent, cmd, extra = []) {
  process.stderr.write('  · ' + name + '\n');
  const f = join(dir, name.replace(/[^\w.-]/g, '_') + '.json');
  writeFileSync(f, typeof fileContent === 'string' ? fileContent : JSON.stringify(fileContent));
  try {
    const stdout = execFileSync(process.execPath, [CLI, cmd, f, ...extra], { encoding: 'utf8', timeout: 60000 });
    try {
      const j = JSON.parse(stdout);
      if (!j.ok && !j.error && !j.findings && !j.problems) bad.push(name + ': 输出无 error 字段');
    } catch { bad.push(name + ': 输出不是 JSON'); }
  } catch (e) {
    const errText = (e.stderr || '') + (e.stdout || '');
    if (errText.includes('\n    at ') || errText.includes('ReferenceError') || errText.includes('TypeError')) {
      bad.push(name + ': 崩溃 ' + errText.split('\n')[0].slice(0, 80));
    } else {
      const m = errText.match(/\{[\s\S]*\}/);
      if (m && (() => { try { return JSON.parse(m[0]).ok === false; } catch { return false; } })()) {
        // 干净 JSON 错误 → OK
      } else bad.push(name + ': 非 JSON 错误输出');
    }
  }
  pass++;
  console.log('  ✓ ' + name);
}

console.log('— 畸形设计文件 × 消费命令 —');
fuzz('empty-file', '', 'spec');
fuzz('not-json', '这是一个坏文件', 'spec');
fuzz('json-array', [1, 2], 'spec');
fuzz('empty-obj', {}, 'spec');
fuzz('no-pads', { width: 30, height: 20, nets: [{ id: 'a', name: 'A' }] }, 'spec');
fuzz('null-pads', { width: 30, height: 20, pads: null, nets: null }, 'erc');
fuzz('zero-board', { width: 0, height: 0, pads: [], nets: [] }, 'place', ['-o', join(dir, 'out0.json')]);
fuzz('neg-coords', { width: 30, height: 20, grid: 0.5, trackW: 0.3, clearance: 0.2,
  nets: [{ id: 'a', name: 'A' }],
  pads: [{ id: 'U1-1', netId: 'a', x: -50, y: -50, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' }] }, 'place', ['-o', join(dir, 'out1.json')]);
fuzz('huge-coords', { width: 30, height: 20, grid: 0.5, trackW: 0.3, clearance: 0.2,
  nets: [{ id: 'a', name: 'A' }],
  pads: [{ id: 'U1-1', netId: 'a', x: 1e9, y: 1e9, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' }] }, 'route');
fuzz('zero-size-pad', { width: 30, height: 20, grid: 0.5, trackW: 0.3, clearance: 0.2,
  nets: [{ id: 'a', name: 'A' }],
  pads: [{ id: 'U1-1', netId: 'a', x: 10, y: 10, w: 0, h: 0, shape: 'rect', layer: 'both' }] }, 'drc');
fuzz('bad-netref', { width: 30, height: 20, grid: 0.5, trackW: 0.3, clearance: 0.2,
  nets: [{ id: 'a', name: 'A' }],
  pads: [{ id: 'U1-1', netId: 'ghost', x: 10, y: 10, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' }] }, 'erc');
fuzz('dup-ids', { width: 30, height: 20, grid: 0.5, trackW: 0.3, clearance: 0.2,
  nets: [{ id: 'a', name: 'A' }],
  pads: [
    { id: 'U1-1', netId: 'a', x: 10, y: 10, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' },
    { id: 'U1-1', netId: 'a', x: 20, y: 10, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' }] }, 'bom');
fuzz('weird-layer', { width: 30, height: 20, grid: 0.5, trackW: 0.3, clearance: 0.2,
  nets: [{ id: 'a', name: 'A' }],
  pads: [{ id: 'U1-1', netId: 'a', x: 10, y: 10, w: 1.2, h: 1.2, shape: 'rect', layer: 'middle' }] }, 'pos');
fuzz('neg-width', { width: 30, height: 20, grid: 0.5, trackW: -3, clearance: 0.2,
  nets: [{ id: 'a', name: 'A', w: -1 }],
  pads: [{ id: 'U1-1', netId: 'a', x: 10, y: 10, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' }] }, 'advise');
fuzz('many-pads-overlap', { width: 10, height: 10, grid: 0.5, trackW: 0.3, clearance: 0.2,
  nets: Array.from({ length: 20 }, (_, i) => ({ id: 'n' + i, name: 'N' + i })),
  pads: Array.from({ length: 40 }, (_, i) => ({ id: 'U' + (i % 20) + '-1', netId: 'n' + (i % 20), x: 5, y: 5, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' })) }, 'place', ['-o', join(dir, 'out2.json'), '--iterations', '200']);

console.log('— EasyEDA 导入（roadmap #8）畸形输入 —');
const eeFuzz = (name, content, extra = []) => {
  process.stderr.write('  · ' + name + '\n');
  const f = join(dir, 'ee_' + name.replace(/[^\w.-]/g, '_') + '.json');
  writeFileSync(f, typeof content === 'string' ? content : JSON.stringify(content));
  try {
    const stdout = execFileSync(process.execPath, [CLI, 'import', 'easyeda', f, ...extra], { encoding: 'utf8', timeout: 60000 });
    try {
      const j = JSON.parse(stdout);
      if (!j.ok && !j.error) bad.push(name + ': 输出无 error 字段');
    } catch { bad.push(name + ': 输出不是 JSON'); }
  } catch (e) {
    const errText = (e.stderr || '') + (e.stdout || '');
    if (errText.includes('\n    at ') || errText.includes('ReferenceError') || errText.includes('TypeError')) {
      bad.push(name + ': 崩溃 ' + errText.split('\n')[0].slice(0, 80));
    } else {
      const m = errText.match(/\{[\s\S]*\}/);
      if (m && (() => { try { return JSON.parse(m[0]).ok === false; } catch { return false; } })()) {
        // 干净 JSON 错误 → OK
      } else bad.push(name + ': 非 JSON 错误输出');
    }
  }
  pass++;
  console.log('  ✓ ' + name);
};
eeFuzz('ee-empty', '');
eeFuzz('ee-not-json', ' EasyEDA 坏文件 ');
eeFuzz('ee-docType-1', { head: { docType: '1' }, shape: [] });
eeFuzz('ee-docType-num', { head: { docType: 3 }, shape: ['PAD~RECT~10~10~2~1.2~11~A~1~0~{}~0~g~0~~Y~0'] });   // 数字 docType 应接受
eeFuzz('ee-no-shape', { head: { docType: '3' } });
eeFuzz('ee-shape-garbage', { head: { docType: '3' }, shape: [null, 42, {}, 'PAD', 'TRACK~x~y', 'LIB~'] });
eeFuzz('ee-huge-coords', { head: { docType: '3' }, canvas: 'CA~1~1~#000~yes~#FFF~10~1000~1000~line~1~mm~1~0~visible~0.5~0~0~1~yes',
  shape: ['PAD~RECT~1e15~1e15~2~1.2~1~A~1~0~{}~0~g~0~~Y~0',
          'SOLIDREGION~10~~M 1e15,1e15 L 1e16,1e15 L 1e16,1e16 L 1e15,1e16 Z~boardoutline~b~0'] });
eeFuzz('ee-neg-outline', { head: { docType: '3' }, canvas: 'CA~1~1~#000~yes~#FFF~10~1000~1000~line~1~mm~1~0~visible~0.5~0~0~1~yes',
  shape: ['SOLIDREGION~10~~M 10,10 L 5,10 L 5,5 L 10,5 Z~boardoutline~b~0',
          'PAD~RECT~7~7~2~1.2~1~A~1~0~{}~0~g~0~~Y~0'] });   // 倒序路径 bbox 仍应成立
eeFuzz('ee-lib-deep', { head: { docType: '3' }, canvas: 'CA~1~1~#000~yes~#FFF~10~1000~1000~line~1~mm~1~0~visible~0.5~0~0~1~yes',
  shape: ['LIB~1~1~~0~0~g~0#@LIB~2~2~~0~0~g2~0#@PAD~RECT~1~1~1~1~1~~1~0'] });   // LIB 嵌 LIB

console.log('— rules 约束 schema（roadmap #10）畸形输入 —');
const baseDesign = { width: 30, height: 20, grid: 0.5, layers: 2, trackW: 0.3, clearance: 0.2,
  nets: [{ id: 'a', name: 'SIG' }, { id: 'b', name: 'GND' }],
  pads: [{ id: 'X-1', netId: 'a', x: 5, y: 10, w: 1.2, h: 1.2, layer: 'both' },
         { id: 'G-1', netId: 'b', x: 5, y: 15, w: 1.2, h: 1.2, layer: 'both' }] };
const rulesFuzz = (name, rules) => rulesFuzzRaw(name, { ...baseDesign, rules });
function rulesFuzzRaw(name, content) {
  process.stderr.write('  · ' + name + '\n');
  const f = join(dir, 'ru_' + name.replace(/[^\w.-]/g, '_') + '.json');
  writeFileSync(f, JSON.stringify(content));
  try {
    const stdout = execFileSync(process.execPath, [CLI, 'spec', f], { encoding: 'utf8', timeout: 60000 });
    try {
      const j = JSON.parse(stdout);
      if (!j.ok && !j.error && !j.problems) bad.push(name + ': 输出无 error/problems 字段');
    } catch { bad.push(name + ': 输出不是 JSON'); }
  } catch (e) {
    const errText = (e.stderr || '') + (e.stdout || '');
    if (errText.includes('\n    at ') || errText.includes('ReferenceError') || errText.includes('TypeError')) {
      bad.push(name + ': 崩溃 ' + errText.split('\n')[0].slice(0, 80));
    } else {
      const m = errText.match(/\{[\s\S]*\}/);
      if (m && (() => { try { return JSON.parse(m[0]).ok === false; } catch { return false; } })()) {
        // 干净 JSON 错误 → OK
      } else bad.push(name + ': 非 JSON 错误输出');
    }
  }
  pass++;
  console.log('  ✓ ' + name);
}
rulesFuzz('ru-rules-array', []);
rulesFuzz('ru-classes-array', { rules: { classes: [] } });
rulesFuzz('ru-netclass-dangling-net', { rules: { classes: { p: { w: 0.5 } }, netClass: { GHOST: 'p' } } });
rulesFuzz('ru-netclass-dangling-class', { rules: { classes: {}, netClass: { SIG: 'x' } } });
rulesFuzz('ru-pair-single', { rules: { pairs: [{ group: 'U', nets: ['SIG'] }] } });
rulesFuzz('ru-pair-dangling', { rules: { pairs: [{ group: 'U', nets: ['SIG', 'NOPE'] }] } });
rulesFuzz('ru-pair-conflict', { rules: { pairs: [{ group: 'U', nets: ['SIG', 'GND'] }, { group: 'V', nets: ['SIG', 'GND'] }] } });
rulesFuzz('ru-lengths-dangling', { rules: { lengths: [{ group: 'A', nets: ['NOPE'] }] } });
rulesFuzz('ru-keepout-dangling-class', { rules: { classes: {}, keepouts: [{ x: 1, y: 1, w: 2, h: 2, class: 'zz' }] } });
rulesFuzz('ru-keepout-zero-rect', { rules: { classes: { p: { w: 0.5 } }, keepouts: [{ x: 1, y: 1, w: 0, h: 2, class: 'p' }] } });
rulesFuzz('ru-class-neg-w', { rules: { classes: { p: { w: -0.5 } } } });
rulesFuzzRaw('ru-null', { ...baseDesign, rules: null });   // null → 无 rules，正常 spec
rulesFuzz('ru-w-conflict', { ...baseDesign, nets: [{ id: 'a', name: 'SIG', w: 0.3 }], rules: { classes: { c: { w: 0.5 } }, netClass: { SIG: 'c' } } });

console.log('— 不存在的文件 / 未知值 —');try {
  execFileSync(process.execPath, [CLI, 'spec', join(dir, '不存在.json')], { encoding: 'utf8', timeout: 30000 });
  bad.push('missing-file: 未报错');
} catch (e) {
  if ((e.stdout || '').includes('"error"')) { pass++; console.log('  ✓ 不存在的文件 → 干净 JSON 错误'); }
  else bad.push('missing-file: 错误输出不友好');
}
try {
  const f = join(dir, 'one.json');
  writeFileSync(f, JSON.stringify({ width: 30, height: 20, grid: 0.5, trackW: 0.3, clearance: 0.2, nets: [{ id: 'a', name: 'A' }], pads: [{ id: 'U1-1', netId: 'a', x: 10, y: 10, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' }] }));
  execFileSync(process.execPath, [CLI, 'pour', f, f, '--net', '不存在的网'], { encoding: 'utf8', timeout: 30000 });
  bad.push('pour-bad-net: 未报错');
} catch (e) {
  if ((e.stdout || '').includes('"error"')) { pass++; console.log('  ✓ pour 未知网络 → 干净 JSON 错误'); }
  else bad.push('pour-bad-net: 错误输出不友好');
}

console.log('\n模糊测试结果：' + pass + ' 通过, ' + (bad.length ? bad.length + ' 可疑' : '0 可疑'));
if (bad.length) { for (const b of bad) console.error('  ✗ ' + b); process.exit(1); }
