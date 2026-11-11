import * as core from '../src/engine.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rmSync } from 'node:fs';

// KiCad 导入回归测试（外部案例 01 iCEBreaker 的 6 项缺口反哺——防退化）
// 每项对应 docs/案例-外部板01-iCEBreaker.md §4 的一条真实缺口。

let seq = 0;
function kicadFile({ footprints = [], size = [40, 30], nets = null } = {}) {
  seq++;
  const netLines = (nets ?? [
    [1, 'GND'], [2, 'SIG'], [3, '/FLASH_~{WP}|IO2'],   // 3 号默认带层级网名（缺口 5）
  ]).map(([n, name]) => `  (net ${n} "${name}")`).join('\n');
  const [W, H] = size;
  const edges = [
    `  (gr_line (start 0 0) (end ${W} 0) (layer "Edge.Cuts") (width 0.1))`,
    `  (gr_line (start ${W} 0) (end ${W} ${H}) (layer "Edge.Cuts") (width 0.1))`,
    `  (gr_line (start ${W} ${H}) (end 0 ${H}) (layer "Edge.Cuts") (width 0.1))`,
    `  (gr_line (start 0 ${H}) (end 0 0) (layer "Edge.Cuts") (width 0.1))`,
  ].join('\n');
  const fps = footprints.map(f => {
    const pads = f.pads.map(p =>
      `    (pad "${p.num}" ${p.type || 'smd'} ${p.shape || 'rect'} (at ${p.x ?? 0} ${p.y ?? 0}${p.rot != null ? ' ' + p.rot : ''})` +
      ` (size ${p.w} ${p.h})${p.drill ? ` (drill ${p.drill})` : ''} (layers "${p.layers || 'F.Cu'}")` +
      (p.net != null ? ` (net ${p.net} "${p.netName || 'GND'}")` : '') + `)`
    ).join('\n');
    return `  (footprint "test:${f.ref}" (at ${f.x} ${f.y}${f.rot != null ? ' ' + f.rot : ''})\n` +
      `    (property "Reference" "${f.ref}")\n${pads}\n  )`;
  }).join('\n');
  return `(kicad_pcb (version 20240108) (generator "regression-test")\n${netLines}\n${edges}\n${fps}\n)`;
}

test('缺口1 同号焊盘消歧：后缀唯一 + 分组语义保持', () => {
  const txt = kicadFile({ footprints: [
    { ref: 'SW1', x: 10, y: 10, rot: 0, pads: [
      { num: '1', x: -2.3, y: -1.125, w: 1, h: 0.7, net: 1 },
      { num: '1', x: 2.3, y: -1.125, w: 1, h: 0.7, net: 1 },      // 同号（拨码公共脚）
      { num: '2', x: -2.3, y: 1.125, w: 1, h: 0.7, net: 2 },
      { num: '2', x: 2.3, y: 1.125, w: 1, h: 0.7, net: 2 },
    ]},
  ]});
  const d = core.importKiCadPcb(txt);
  const ids = d.pads.map(p => p.id);
  assert.equal(new Set(ids).size, ids.length, 'id 全唯一');
  for (const id of ids) {
    assert(id.split('-')[0] === 'SW1', `split('-')[0] 分组保持：${id}`);
    assert(id.slice(0, id.lastIndexOf('-')) === 'SW1', `lastIndexOf('-') 分组保持：${id}`);
  }
  assert(ids.some(id => id.endsWith('1a')), '同号第二只后缀 a：' + ids.join(','));
});

test('缺口2 旋转焊盘：normAng 环绕回归（U1 案例）+ 45° 真形状（U6 案例）', () => {
  // U1 复刻：fp rot 90 + pad prot 270 + size(1.06,0.65)——
  // 回归点：rotAbs=normAng(90+270)=360→0 曾丢交换（板面 1.06 宽 > 0.95 节距自重叠）
  const txt = kicadFile({ footprints: [
    { ref: 'U1', x: 20, y: 15, rot: 90, pads: [
      { num: '1', x: 1.1, y: 0.95, rot: 270, w: 1.06, h: 0.65, net: 1 },
      { num: '2', x: 1.1, y: 0, rot: 270, w: 1.06, h: 0.65, net: 1 },
    ]},
    // U6 复刻：fp rot 45 + pad prot 45 + size(0.6,0.3)——
    // 回归点：rotAbs 曾被 normAng 量化到 90（45° 真形状丢失）
    { ref: 'U6', x: 30, y: 15, rot: 45, pads: [
      { num: '5', x: -3.4, y: -0.75, rot: 45, w: 0.6, h: 0.3, net: 2 },
    ]},
  ]});
  const d = core.importKiCadPcb(txt);
  const u11 = d.pads.find(p => p.id === 'U1-1');
  assert.equal(u11.w, 0.65, '板面宽 0.65（交换生效）：' + u11.w);
  assert.equal(u11.h, 1.06, '板面高 1.06');
  assert.equal(u11.rotAbs, 270, 'rotAbs 保留 270（不被 normAng 环绕吞掉）');
  // 位置：本地 (1.1,0.95) 按 fp rot 90 旋转 → (−0.95,1.1)+fp 原点(20,15)+margin(1)
  assert.equal(u11.x, 20.05, '位置按 frot 旋转：' + u11.x);
  assert.equal(u11.y, 17.1, '位置 y：' + u11.y);
  const u65 = d.pads.find(p => p.id === 'U6-5');
  assert.equal(u65.rotAbs, 45, '45° 焊盘 rotAbs 不被量化到 90');
  assert.equal(u65.w, 0.6364, '45° 真旋转 AABB（0.6364）');
  assert.equal(u65.h, 0.6364, '45° 真旋转 AABB');
});

test('缺口3 机械安装孔：无网 THT 环宽豁免（checkDRC）', () => {
  const txt = kicadFile({ footprints: [
    { ref: 'H1', x: 5, y: 5, rot: 0, pads: [
      { num: '1', type: 'np_thru_hole', x: 0, y: 0, w: 3.4, h: 3.4, drill: 3.2, layers: '*.Cu' },   // 无网机械孔
    ]},
    { ref: 'R1', x: 15, y: 5, rot: 0, pads: [
      { num: '1', x: -0.5, y: 0, w: 0.5, h: 0.6, net: 1 },
      { num: '2', x: 0.5, y: 0, w: 0.5, h: 0.6, net: 2 },
    ]},
  ]});
  const d = core.importKiCadPcb(txt);
  assert.equal(d.external, true, 'external 标记');
  const mech = d.pads.find(p => p.id === 'H1-1');
  assert.equal(mech.netId, null, '机械孔无网');
  assert.equal(mech.holeR, 1.6, '孔半径解析');
  const issues = core.checkDRC(d, { nets: [], overuse: [] }, {});
  const ringErrs = issues.filter(i => i.type === '插件孔环宽' && i.msg.includes('H1-1'));
  assert.equal(ringErrs.length, 0, '机械孔环宽豁免（DRC）：' + JSON.stringify(ringErrs));
});

test('缺口4 design.external：spec 同元件焊盘间距豁免（CLI 集成）', async () => {
  const { execFileSync } = await import('node:child_process');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const dir = join(tmpdir(), 'pcb-kicad-ext-test');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const txt = kicadFile({ footprints: [
    { ref: 'U6', x: 20, y: 15, rot: 45, pads: [
      { num: '5', x: -3.4, y: -0.75, rot: 45, w: 0.6, h: 0.3, net: 2 },
      { num: '49', x: 0, y: 0, rot: 45, w: 5.6, h: 5.6, net: 1 },   // EP 与边脚几何贴近（真实封装形态）
    ]},
  ]});
  writeFileSync(join(dir, 'design.json'), JSON.stringify(core.importKiCadPcb(txt)));
  const out = JSON.parse(execFileSync(process.execPath,
    [join(process.cwd(), 'ai', 'pcb.mjs'), 'spec', join(dir, 'design.json')],
    { encoding: 'utf8', timeout: 120000 }));
  const spacing = out.problems.filter(p => p.startsWith('同元件焊盘间距'));
  assert.equal(spacing.length, 0, '外部板豁免：' + JSON.stringify(spacing));
  // 对照：自产规格（无 external 标记）同样几何 → 拦截
  const hand = core.designDefaults();
  hand.width = 30; hand.height = 20;
  hand.nets = [{ id: 'n1', name: 'GND' }, { id: 'n2', name: 'SIG' }];
  hand.pads = [
    { id: 'A1-1', netId: 'n1', x: 10, y: 10, w: 2, h: 2, layer: 'top' },
    { id: 'A1-2', netId: 'n2', x: 11.5, y: 10, w: 2, h: 2, layer: 'top' },   // 重叠异网
  ];
  writeFileSync(join(dir, 'hand.json'), JSON.stringify(hand));
  const out2 = JSON.parse(execFileSync(process.execPath,
    [join(process.cwd(), 'ai', 'pcb.mjs'), 'spec', join(dir, 'hand.json')],
    { encoding: 'utf8', timeout: 120000 }));
  assert(out2.problems.some(p => p.startsWith('同元件焊盘间距')), '对照：自产规格仍拦截');
});

test('缺口5 EasyEDA 网名消毒：层级网名 ~/| 不错位字段', () => {
  const d = core.designDefaults();
  d.width = 30; d.height = 20;
  d.nets = [
    { id: 'n1', name: '/FLASH_~{WP}|IO2' },   // KiCad 层级网名（含 ~ 和 |）
    { id: 'n2', name: 'GND' },
  ];
  d.pads = [
    { id: 'U1-1', netId: 'n1', x: 10, y: 10, w: 1, h: 1, layer: 'top' },
    { id: 'U1-2', netId: 'n1', x: 20, y: 10, w: 1, h: 1, layer: 'top' },
    { id: 'G1-1', netId: 'n2', x: 5, y: 5, w: 1, h: 1, layer: 'both' },
    { id: 'G1-2', netId: 'n2', x: 25, y: 5, w: 1, h: 1, layer: 'both', holeR: 0.4 },
  ];
  const r = { nets: [
    { netId: 'n1', paths: [[{ x: 10, y: 10, l: 0 }, { x: 20, y: 10, l: 0 }]], vias: [] },
    { netId: 'n2', paths: [[{ x: 5, y: 5, l: 0 }, { x: 25, y: 5, l: 0 }]], vias: [] },
  ] };
  const ee = JSON.parse(core.exportEasyEdaPcb(d, r.nets));
  // PAD 字段：net 含 ~ 时 split('~') 会错位——消毒后 f[8]（引脚号）必须可对齐
  const pads = ee.shape.filter(s => s.startsWith('PAD~')).map(s => s.split('~'));
  for (const f of pads) {
    assert(!f.some(x => String(x).includes('~')), '字段内无残留 ~');
    assert(/^(1|2)$/.test(f[8]), `引脚号字段对齐：got ${f[8]}`);
  }
  // TRACK 网名同样消毒
  const trk = ee.shape.filter(s => s.startsWith('TRACK~')).map(s => s.split('~'));
  for (const f of trk) assert(!f[3].includes('~'), 'TRACK 网名消毒');
  // verify 全绿（键对齐 + 无 VRF-PAD）
  const v = core.verifyEasyEdaExport(d, r);
  assert.equal(v.ok, true, 'verify：' + JSON.stringify(v.findings.slice(0, 3)));
});

test('缺口6 verify 往返取整：.005 边界坐标不误报 VRF-PAD', () => {
  const d = core.designDefaults();
  d.width = 30; d.height = 20;
  d.nets = [{ id: 'n1', name: 'GND' }];
  d.pads = [
    { id: 'U1-1', netId: 'n1', x: 5.225, y: 18.25, w: 1, h: 1, layer: 'top' },   // .005 边界（外部板实测）
    { id: 'U1-2', netId: 'n1', x: 25.225, y: 18.25, w: 1, h: 1, layer: 'top' },
  ];
  const r = { nets: [{ netId: 'n1', paths: [[{ x: 5.225, y: 18.25, l: 0 }, { x: 25.225, y: 18.25, l: 0 }]], vias: [] }] };
  const v = core.verifyEasyEdaExport(d, r);
  assert.equal(v.ok, true, 'verify：' + JSON.stringify(v.findings.slice(0, 3)));
});
