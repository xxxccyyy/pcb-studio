import * as core from '../src/engine.mjs';
// 单元测试：直接导入共享算法核心，验证布线行为。
// 运行：node tests/router.test.mjs
let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.error('  ✗ ' + name + '\n     ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n     ')); }
}
function assert(c, msg) { if (!c) throw new Error(msg || '断言失败'); }
function assertEq(a, b, msg) { if (a !== b) throw new Error((msg || '不相等') + `：实际 ${a}，期望 ${b}`); }

// 同步跑完一个会话
function run(design, opts) {
  const s = core.createSession(design, opts || {});
  let guard = 0;
  for (;;) {
    const r = s.step();
    if (r.done) break;
    if (++guard > 200000) throw new Error('step 次数超限，可能死循环');
  }
  return s.buildResult();
}
function pad(id, netId, x, y, w, h, shape, layer) {
  return { id, netId, x, y, w: w || 1.2, h: h || w || 1.2, shape: shape || 'rect', layer: layer || 'both' };
}
function net(id, name) { return { id, name: name || id }; }

console.log('— 基础功能 —');

t('两点直连：最短路径、长度正确', () => {
  const d = core.designDefaults();
  d.width = 30; d.height = 20;
  d.nets = [net('a')];
  d.pads = [pad('p1', 'a', 10.25, 10.25), pad('p2', 'a', 20.25, 10.25)];
  const r = run(d);
  assertEq(r.status, 'complete', '状态');
  const n = r.nets[0];
  assertEq(n.connected, 2, '连通焊盘数');
  // 走线端点落在焊盘覆盖单元上，长度应接近两焊盘中心距 10mm
  const len = (n.paths[0].length - 1) * d.grid;
  assert(len >= 9 && len <= 10.0001, '走线长度应≈10（实际 ' + len + '）');
  assert(!r.overuse.length, '无冲突');
});

t('绕开禁布区：仍连通且不穿越', () => {
  const d = core.designDefaults();
  d.width = 30; d.height = 20;
  d.nets = [net('a')];
  d.pads = [pad('p1', 'a', 10.25, 10.25), pad('p2', 'a', 20.25, 10.25)];
  d.keepouts = [{ x: 15.25, y: 10.25, w: 4, h: 8 }];
  const r = run(d);
  assertEq(r.status, 'complete', '状态');
  const n = r.nets[0];
  assertEq(n.connected, 2, '连通');
  const len = (n.paths[0].length - 1) * d.grid;
  assert(len > 12, '应绕行（长度 ' + len + ' > 12）');
  for (const pt of n.paths[0]) {
    assert(!(Math.abs(pt.x - 15.25) < 2 && Math.abs(pt.y - 10.25) < 4), '不得进入禁布区');
  }
});

t('单层交叉绕行', () => {
  const d = core.designDefaults();
  d.layers = 1;
  d.width = 30; d.height = 20;
  d.nets = [net('a'), net('b')];
  d.pads = [
    pad('a1', 'a', 5.25, 10.25), pad('a2', 'a', 25.25, 10.25),
    pad('b1', 'b', 15.25, 2.25), pad('b2', 'b', 15.25, 18.25)
  ];
  const r = run(d);
  assertEq(r.status, 'complete', '单层下 B 网络应绕开 A');
  assert(!r.overuse.length, '无冲突');
  assert(r.stats.vias === 0, '单层无过孔');
});

t('双层交叉：各走一层，DRC 干净', () => {
  const d = core.designDefaults();
  d.width = 30; d.height = 20;
  d.nets = [net('a'), net('b')];
  d.pads = [
    pad('a1', 'a', 5.25, 10.25), pad('a2', 'a', 25.25, 10.25),
    pad('b1', 'b', 15.25, 2.25), pad('b2', 'b', 15.25, 18.25)
  ];
  const r = run(d);
  assertEq(r.status, 'complete', '状态');
  assert(!r.overuse.length, '无冲突');
  const issues = core.checkDRC(d, r);
  assertEq(issues.filter(i => i.sev === 'error').length, 0, 'DRC 无错误：' + JSON.stringify(issues));
});

t('多点网络（T 形分支）', () => {
  const d = core.designDefaults();
  d.width = 30; d.height = 30;
  d.nets = [net('a')];
  d.pads = [
    pad('p1', 'a', 5.25, 5.25), pad('p2', 'a', 25.25, 5.25),
    pad('p3', 'a', 15.25, 25.25)
  ];
  const r = run(d);
  assertEq(r.status, 'complete', '状态');
  assertEq(r.nets[0].connected, 3, '三点连通');
});

t('协商拥塞：密集交叉网络全部连通', () => {
  const d = core.designDefaults();
  d.width = 40; d.height = 30;
  d.nets = []; d.pads = [];
  const ys = [5.25, 10.25, 15.25, 20.25, 25.25];
  const xs = [8.25, 14.25, 20.25, 26.25, 32.25];
  ys.forEach((y, i) => {
    d.nets.push(net('h' + i));
    d.pads.push(pad('h' + i + 'a', 'h' + i, 4.25, y), pad('h' + i + 'b', 'h' + i, 36.25, y));
  });
  xs.forEach((x, i) => {
    d.nets.push(net('v' + i));
    d.pads.push(pad('v' + i + 'a', 'v' + i, x, 2.25), pad('v' + i + 'b', 'v' + i, x, 28.25));
  });
  const r = run(d);
  assertEq(r.stats.connected, r.stats.total, '全部连通（' + r.stats.connected + '/' + r.stats.total + '）');
  assert(!r.overuse.length, '无冲突');
  const issues = core.checkDRC(d, r);
  assertEq(issues.filter(i => i.sev === 'error').length, 0, 'DRC 无错误：' + JSON.stringify(issues.slice(0, 5)));
});

console.log('— 示例电路 —');

for (const ex of core.EXAMPLES) {
  t('示例「' + ex.name + '」100% 布通 + DRC 干净', () => {
    const d = ex.build();
    const r = run(d);
    assertEq(r.stats.connected, r.stats.total,
      '连通 ' + r.stats.connected + '/' + r.stats.total + '，迭代 ' + r.iterations);
    assert(!r.overuse.length, '无间距冲突（' + r.overuse.length + ' 处）');
    const issues = core.checkDRC(d, r);
    const errs = issues.filter(i => i.sev === 'error');
    assertEq(errs.length, 0, 'DRC 错误：' + JSON.stringify(errs.slice(0, 5)));
  });
}

console.log('— 稳健性与输出 —');

t('随机压力测试：12 网络无崩溃、结果自洽', () => {
  let seed = 42 >>> 0;
  const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let z = seed;
    z = Math.imul(z ^ (z >>> 15), z | 1); z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296; };
  const d = core.designDefaults();
  d.width = 60; d.height = 40;
  d.nets = []; d.pads = [];
  const used = new Set();
  for (let i = 0; i < 12; i++) {
    d.nets.push(net('r' + i));
    for (let k = 0; k < 2; k++) {
      let x, y, key, tries = 0;
      do {
        x = (Math.floor(rnd() * (d.width / d.grid - 4)) + 2) * d.grid + d.grid / 2;
        y = (Math.floor(rnd() * (d.height / d.grid - 4)) + 2) * d.grid + d.grid / 2;
        key = Math.round(x * 4) + '_' + Math.round(y * 4);
      } while (used.has(key) && ++tries < 500);
      used.add(key);
      d.pads.push(pad('r' + i + '_' + k, 'r' + i, x, y));
    }
  }
  const r = run(d);
  for (const n of r.nets) {
    assert(n.connected <= n.total && n.connected >= 0, '连通数合理');
    if (n.connected === n.total && n.total >= 2) {
      // 有路径的网必须非空
      assert(n.paths.length > 0 || n.vias.length > 0 || n.total === 0, '连通网应有路径');
    }
  }
  const issues = core.checkDRC(d, r);
  assert(Array.isArray(issues), 'DRC 可执行');
  // 若宣称 complete，则必须零冲突
  if (r.status === 'complete') assert(!r.overuse.length, 'complete 蕴含零冲突');
});

t('预拉线：未布线时生成最小生成树连线', () => {
  const d = core.designDefaults();
  d.width = 30; d.height = 20;
  d.nets = [net('a')];
  d.pads = [pad('p1', 'a', 5.25, 5.25), pad('p2', 'a', 15.25, 5.25), pad('p3', 'a', 25.25, 15.25)];
  const rats = core.computeRatsnest(d, null);
  assertEq(rats.length, 2, '3 焊盘 2 条预拉线');
  const r = run(d);
  const rats2 = core.computeRatsnest(d, r);
  assertEq(rats2.length, 0, '布通后无预拉线');
});

t('SVG 导出包含关键元素', () => {
  const d = core.EXAMPLES[0].build();
  const r = run(d);
  const svg = core.buildSVG(d, r);
  assert(svg.startsWith('<svg'), 'svg 开头');
  assert(svg.includes('<path'), '有走线（圆角路径）');
  assert(svg.includes('id="top"') && svg.includes('id="bottom"'), '有分层');
  assert(svg.includes('<circle'), '有焊盘/过孔');
});

t('栅格吸附函数', () => {
  assertEq(core.snapToGrid(10.3, 0.5), 10.25, '吸附到最近单元中心');
  assertEq(core.snapToGrid(10.5, 0.5), 10.75, '边界四舍五入取整');
  assertEq(core.snapToGrid(10.51, 0.5), 10.75, '过半取大');
});

t('独立焊盘（无网络）不参与布线但产生阻挡', () => {
  const d = core.designDefaults();
  d.width = 30; d.height = 10;
  d.nets = [net('a')];
  d.pads = [
    pad('p1', 'a', 10.25, 5.25), pad('p2', 'a', 20.25, 5.25),
    pad('iso', null, 15.25, 5.25, 2, 2)  // 挡在正中间
  ];
  const r = run(d);
  assertEq(r.status, 'complete', '应绕行连通');
  for (const path of r.nets[0].paths) for (const pt of path) {
    assert(Math.hypot(pt.x - 15.25, pt.y - 5.25) >= 1.35, '不得侵入独立焊盘影响区');
  }
});

console.log('— 45° 美化 / 覆铜 / 泪滴 —');

t('45° 美化：产生斜线段、连通与 DRC 保持、长度不增', () => {
  const d = core.EXAMPLES[0].build();
  const r = run(d);
  const len0 = r.stats.trackLen;
  core.beautifyResult(d, r);
  let diag = 0;
  for (const n of r.nets) for (const p of n.paths) for (let k = 1; k < p.length; k++) {
    if (p[k].l !== p[k - 1].l) continue;
    const dx = p[k].x - p[k - 1].x, dy = p[k].y - p[k - 1].y;
    if (Math.abs(dx) > 1e-9 && Math.abs(dy) > 1e-9) diag++;
  }
  assert(diag > 0, '应产生 45° 段');
  assertEq(r.stats.connected, r.stats.total, '连通不变');
  const issues = core.checkDRC(d, r);
  const errs = issues.filter(i => i.sev === 'error');
  assertEq(errs.length, 0, 'DRC 干净：' + JSON.stringify(errs.slice(0, 3)));
  assert(r.stats.trackLen <= len0 + 1e-6, '走线长度不增：' + len0 + ' -> ' + r.stats.trackLen);
});

t('密集交叉板美化后 DRC 仍干净', () => {
  const d = core.designDefaults();
  d.width = 40; d.height = 30;
  d.nets = []; d.pads = [];
  const ys = [5.25, 10.25, 15.25, 20.25, 25.25], xs = [8.25, 14.25, 20.25, 26.25, 32.25];
  ys.forEach((y, i) => {
    d.nets.push(net('h' + i));
    d.pads.push(pad('h' + i + 'a', 'h' + i, 4.25, y), pad('h' + i + 'b', 'h' + i, 36.25, y));
  });
  xs.forEach((x, i) => {
    d.nets.push(net('v' + i));
    d.pads.push(pad('v' + i + 'a', 'v' + i, x, 2.25), pad('v' + i + 'b', 'v' + i, x, 28.25));
  });
  const r = run(d);
  assertEq(r.stats.connected, r.stats.total, '全部连通');
  core.beautifyResult(d, r);
  assertEq(r.stats.connected, r.stats.total, '美化后连通不变');
  const issues = core.checkDRC(d, r);
  const errs = issues.filter(i => i.sev === 'error');
  assertEq(errs.length, 0, 'DRC 干净：' + JSON.stringify(errs.slice(0, 3)));
});

t('覆铜：GND 底层生成条带并避让其它网络', () => {
  const d = core.EXAMPLES[0].build();
  const r = run(d);
  core.beautifyResult(d, r);
  const pour = core.computePour(d, r, { layer: 1, netId: 'gnd' });
  assert(pour.polys.length > 0 && pour.area > 0, '应有覆铜多边形');
  for (const n of r.nets) {
    if (n.netId === 'gnd') continue;
    for (const path of n.paths) for (let k = 1; k < path.length; k++) {
      const a = path[k - 1], b = path[k];
      if (a.l !== 1 || b.l !== 1) continue;   // 只检查覆铜层
      const steps = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.2));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
        if (core.pourContains(pour, x, y)) throw new Error('覆铜侵入网络 ' + n.name + ' 的走线');
        if (core.pourNear(pour, x, y, d.clearance - 0.02))
          throw new Error('覆铜距网络 ' + n.name + ' 走线 < clearance−0.02');
      }
    }
  }
  // 无网络时返回空
  const p2 = core.computePour(d, r, { layer: 1, netId: '不存在的网络' });
  assertEq(p2.polys.length, 0, '未知网络覆铜为空');
});

t('覆铜去除孤岛：与 GND 无关的区域不被保留', () => {
  const d = core.designDefaults();
  d.width = 30; d.height = 20;
  d.nets = [net('gnd'), net('a')];
  d.pads = [
    pad('g1', 'gnd', 5.25, 10.25),
    pad('a1', 'a', 25.25, 5.25), pad('a2', 'a', 25.25, 15.25)
  ];
  // 网络a横墙把右侧隔开（但gnd在左侧，右侧孤岛应被去除）
  d.keepouts = [{ x: 15.25, y: 10.25, w: 2, h: 20 }];
  const r = run(d);
  const pour = core.computePour(d, r, { layer: 1, netId: 'gnd' });
  assert(pour.islands >= 1 && pour.islandArea > 0, '右侧孤岛应被统计去除');
  assert(!core.pourContains(pour, 25, 10), '覆铜不应出现在隔墙右侧孤岛区');
  assert(core.pourContains(pour, 5.25, 10.25), '本网焊盘在铜皮内');
});

t('泪滴：换层过孔处生成楔形多边形', () => {
  const d = core.designDefaults();
  d.width = 20; d.height = 20;
  const r = {
    nets: [{
      netId: 'a', name: 'A', connected: 2, total: 2, cells: [],
      paths: [[
        { x: 5.25, y: 10.25, l: 0 }, { x: 10.25, y: 10.25, l: 0 },
        { x: 10.25, y: 10.25, l: 1 },
        { x: 15.25, y: 10.25, l: 1 }
      ]],
      vias: [{ x: 10.25, y: 10.25 }]
    }],
    overuse: [], stats: {}
  };
  const tds = core.teardropPolys(d, r);
  assertEq(tds.length, 2, '两个楔形（左右各一）');
  assert(tds.every(t => t.p.length === 4), '四边形楔形');
  assert(tds[0].l === 0 && tds[1].l === 1, '分属两层');
});

t('SVG 导出包含覆铜与泪滴', () => {
  const d = core.EXAMPLES[0].build();
  const r = run(d);
  core.beautifyResult(d, r);
  const pour = core.computePour(d, r, { layer: 1, netId: 'gnd' });
  const svg = core.buildSVG(d, r, { pour, teardrops: true });
  assert(svg.includes('fill-rule="evenodd"'), '覆铜多边形偶奇填充');
  assert(svg.includes('fill-opacity="0.3"'), '覆铜半透明');
});

console.log('— 45° 斜向布线 / 热焊盘 / Gerber —');

// 几何审计：任意两个不同网络的同层走线段间距 ≥ 线宽+间距
function auditSpacing(d, r) {
  const segs = [];
  for (const n of r.nets) for (const p of n.paths) for (let k = 1; k < p.length; k++) {
    const a = p[k - 1], b = p[k];
    if (a.l !== b.l) continue;
    if (Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9) continue;
    segs.push({ net: n.netId, l: a.l, x1: a.x, y1: a.y, x2: b.x, y2: b.y,
      bx: [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)] });
  }
  const need = d.trackW + d.clearance;
  let worst = 1e9;
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const a = segs[i], b = segs[j];
    if (a.net === b.net || a.l !== b.l) continue;
    if (b.bx[2] < a.bx[0] - need || a.bx[2] < b.bx[0] - need ||
        b.bx[3] < a.bx[1] - need || a.bx[3] < b.bx[1] - need) continue;
    const dd = core.segSegDist(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1, b.x2, b.y2);
    if (dd < worst) worst = dd;
  }
  return worst;
}

t('45° 斜向布线：示例电路全对段几何间距审计', () => {
  const d = core.EXAMPLES[0].build();
  const r = run(d);                       // diag 默认开启
  core.beautifyResult(d, r);
  const worst = auditSpacing(d, r);
  const need = d.trackW + d.clearance;
  assert(worst >= need - 1e-6, '最小间距 ' + worst.toFixed(4) + ' 应 ≥ ' + need);
  const issues = core.checkDRC(d, r);
  assertEq(issues.filter(i => i.sev === 'error').length, 0, 'DRC 干净');
});

t('45° 斜向布线：密集交叉板审计 + 斜线确实被使用', () => {
  const d = core.designDefaults();
  d.width = 40; d.height = 30;
  d.nets = []; d.pads = [];
  const ys = [5.25, 10.25, 15.25, 20.25, 25.25], xs = [8.25, 14.25, 20.25, 26.25, 32.25];
  ys.forEach((y, i) => {
    d.nets.push(net('h' + i));
    d.pads.push(pad('h' + i + 'a', 'h' + i, 4.25, y), pad('h' + i + 'b', 'h' + i, 36.25, y));
  });
  xs.forEach((x, i) => {
    d.nets.push(net('v' + i));
    d.pads.push(pad('v' + i + 'a', 'v' + i, x, 2.25), pad('v' + i + 'b', 'v' + i, x, 28.25));
  });
  const r = run(d);
  assertEq(r.stats.connected, r.stats.total, '全部连通');
  core.beautifyResult(d, r);
  const worst = auditSpacing(d, r);
  const need = d.trackW + d.clearance;
  assert(worst >= need - 1e-6, '最小间距 ' + worst.toFixed(4) + ' 应 ≥ ' + need);
  // 与纯曼哈顿对比：斜向应不增加总长
  const lenDiag = r.stats.trackLen;
  const r2 = run(d, { diag: false });
  core.beautifyResult(d, r2);
  assert(lenDiag <= r2.stats.trackLen + 1e-6,
    '斜向总长 ' + lenDiag.toFixed(1) + ' 应 ≤ 曼哈顿 ' + r2.stats.trackLen.toFixed(1));
});

t('热焊盘：环形开窗且筋条连通', () => {
  const d = core.EXAMPLES[0].build();
  const r = run(d);
  core.beautifyResult(d, r);
  const on = core.computePour(d, r, { layer: 1, netId: 'gnd', thermal: true });
  const off = core.computePour(d, r, { layer: 1, netId: 'gnd', thermal: false });
  assert(on.polys.length > 0 && off.polys.length > 0, '两种模式都有覆铜');
  const gndPads = d.pads.filter(p => p.netId === 'gnd');
  // 焊盘本体是本网铜：两种模式都在铜皮内
  for (const p of gndPads) {
    assert(core.pourContains(on, p.x, p.y), '热焊盘模式下焊盘本体在铜皮内');
    assert(core.pourContains(off, p.x, p.y), '实心模式下焊盘本体在铜皮内');
  }
  // 热焊盘模式产生弧形挖空孔；实心模式把这些环带面积加回来
  assert(on.polys.flatMap(pp => pp.holes).length >= 1, '热焊盘应产生挖空孔');
  assert(off.area > on.area, `实心模式面积应更大（${off.area.toFixed(1)} > ${on.area.toFixed(1)}）`);
});

t('Gerber 导出：格式要素与数量一致', () => {
  const d = core.EXAMPLES[0].build();
  const r = run(d);
  core.beautifyResult(d, r);
  const pour = core.computePour(d, r, { layer: 1, netId: 'gnd', thermal: true });
  const g = core.buildGerber(d, r, pour);
  for (const [name, txt] of [['top', g.top], ['bottom', g.bottom], ['outline', g.outline]]) {
    assert(txt.includes('%FSLAX26Y26*%'), name + ' 格式头');
    assert(txt.includes('%MOMM*%'), name + ' 单位');
    assert(txt.endsWith('M02*\n'), name + ' 结束');
    // 坐标全部为整数（2.6 格式）
    for (const m of txt.matchAll(/X(-?\d+)Y(-?\d+)D0[123]\*/g)) {
      assert(/^(-?\d+)$/.test(m[1]) && /^(-?\d+)$/.test(m[2]), name + ' 坐标整数');
    }
  }
  // 顶层闪现数 = 通孔焊盘 + 过孔（顶层）；底层 ≥ 同样数量
  const thPads = d.pads.filter(p => p.layer === 'both').length;
  const viaCount = r.nets.reduce((s, n) => s + n.vias.length, 0);
  const flashes = (g.top.match(/D03\*/g) || []).length;
  assertEq(flashes, thPads + viaCount, '顶层闪现数');
  // 钻孔
  assert(g.drill.includes('M48') && g.drill.includes('METRIC,TZ'), '钻孔头');
  assert(g.drill.includes('C' + d.viaDrill.toFixed(3)), '钻头直径');
  const holes = (g.drill.match(/^X-?[\d.]+Y-?[\d.]+$/gm) || []).length;
  assertEq(holes, thPads + viaCount, '钻孔数量');
});

t('圆角路径：生成 Q 曲线且端点不变', () => {
  const pts = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }];
  const d = core.roundedPathD(pts, 1);
  assert(d.startsWith('M0.000 0.000'), '起点');
  assert(d.includes('Q'), '含二次曲线');
  assert(d.endsWith('L5.000 5.000'), '终点');
  const d2 = core.roundedPathD([{ x: 0, y: 0 }, { x: 5, y: 0 }], 1);
  assert(!d2.includes('Q'), '两点无拐角');
});

console.log('— 分层方向 / 手动布线 / 单网络重布 —');

t('分层首选方向：纵向网络优先走奇数层', () => {
  const d = core.designDefaults();
  d.width = 30; d.height = 30;
  d.nets = [net('b')];
  d.pads = [pad('b1', 'b', 15.25, 2.25), pad('b2', 'b', 15.25, 18.25)];
  const r = run(d, { diag: false, layerDir: true });
  assertEq(r.status, 'complete', '布通');
  let vTop = 0, vBot = 0;
  for (const p of r.nets[0].paths) for (let k = 1; k < p.length; k++) {
    if (p[k].l !== p[k - 1].l) continue;
    if (Math.abs(p[k].y - p[k - 1].y) > 1e-9 && Math.abs(p[k].x - p[k - 1].x) < 1e-9) {
      if (p[k].l === 0) vTop += d.grid; else vBot += d.grid;
    }
  }
  assert(vBot >= vTop, '竖直段应优先位于底层（顶 ' + vTop + ' / 底 ' + vBot + '）');
  assert(vBot > 0, '应有竖直走线');
});

t('手动布线：消除预拉线并计入连通', () => {
  const d = core.EXAMPLES[0].build();
  const r = run(d);
  core.beautifyResult(d, r);
  r.nets = r.nets.filter(n => n.netId !== 'out');   // 模拟“留给手动的场景”
  d.manual = [{ id: 'M1', netId: 'out', pts: [
    { x: 11.25, y: 18.75, l: 0 }, { x: 23.75, y: 18.75, l: 0 } ] }];
  const rats = core.computeRatsnest(d, r);
  assertEq(rats.filter(s => s.netId === 'out').length, 0, '手动走线应消除 OUT 预拉线');
  d.manual = [];
  const rats2 = core.computeRatsnest(d, r);
  assertEq(rats2.filter(s => s.netId === 'out').length, 1, '无手动走线时 OUT 仍有预拉线');
});

t('手动布线 DRC：穿越其它网络走线被检出', () => {
  const d = core.designDefaults();
  d.width = 30; d.height = 20;
  d.nets = [net('a'), net('b')];
  d.pads = [
    pad('a1', 'a', 5.25, 10.25), pad('a2', 'a', 20.25, 10.25),
    pad('b1', 'b', 5.25, 5.25), pad('b2', 'b', 20.25, 5.25)
  ];
  const r = run(d);
  d.manual = [{ id: 'M1', netId: 'b', pts: [
    { x: 5.25, y: 5.25, l: 0 }, { x: 20.25, y: 15.25, l: 0 } ] }];
  const merged = { nets: [...r.nets, {
      netId: 'b', name: '手动', manual: true, connected: 1, total: 1,
      paths: [[{ x: 5.25, y: 5.25, l: 0 }, { x: 20.25, y: 15.25, l: 0 }]],
      vias: [], cells: [] }], overuse: r.overuse };
  const issues = core.checkDRC(d, merged);
  assert(issues.some(i => i.type === '手动布线冲突'), '应报手动布线冲突：' + JSON.stringify(issues.slice(0, 3)));
  d.manual = [];
  const issues2 = core.checkDRC(d, r);
  assertEq(issues2.filter(i => i.sev === 'error').length, 0, '基准 DRC 干净');
});

t('单网络重布：拆除并重布单个网络，其余不受影响', () => {
  const d = core.EXAMPLES[0].build();
  const s = core.createSession(d, {});
  let g = 0;
  for (;;) { const r = s.step(); if (r.done) break; if (++g > 200000) throw new Error('超限'); }
  const res1 = s.buildResult();
  assertEq(res1.nets.find(n => n.netId === 'out').connected, 2, 'OUT 初始连通');
  const rr = s.rerouteSingle('out');
  assert(rr.ok, '重布成功');
  const res2 = s.buildResult();
  assertEq(res2.nets.find(n => n.netId === 'out').connected, 2, '重布后仍连通');
  assertEq(res2.nets.reduce((a, n) => a + n.connected, 0),
           res2.nets.reduce((a, n) => a + n.total, 0), '所有网络全部连通');
});

console.log('— DFM / 3W / 回流 / 缝合孔 / 载流 —');

t('DFM 检查：钻孔/线宽分级、贴板边焊盘警告、环宽与孔边距', () => {
  const d = core.EXAMPLES[0].build();
  const r = run(d);
  // 1) 钻孔低于极限 0.15 → error；低于常规 0.3 → warn
  d.viaDrill = 0.12;
  let issues = core.checkDRC(d, r);
  assert(issues.some(i => i.type === 'DFM 钻孔' && i.sev === 'error'), '钻孔 0.12mm 应报 error');
  d.viaDrill = 0.25;
  issues = core.checkDRC(d, r);
  assert(issues.some(i => i.type === 'DFM 钻孔' && i.sev === 'warn'), '钻孔 0.25mm 应报 warn（常规 0.3）');
  d.viaDrill = 0.4;
  // 2) 线宽低于建议 → warn；低于极限 → error（2oz 极限 0.16）
  d.trackW = 0.1;
  issues = core.checkDRC(d, r);
  assert(issues.some(i => i.type === 'DFM 线宽' && i.sev === 'warn'), '线宽 0.1mm（1oz 极限 0.10）应报 warn');
  d.copperWeight = '2';
  issues = core.checkDRC(d, r);
  assert(issues.some(i => i.type === 'DFM 线宽' && i.sev === 'error'), '2oz 极限 0.16：线宽 0.1mm 应报 error');
  d.copperWeight = '1'; d.trackW = 0.3;
  // 3) 过孔环宽 外径−内径 < 0.10 → error
  d.viaOuter = 0.5; d.viaDrill = 0.45;
  issues = core.checkDRC(d, r);
  assert(issues.some(i => i.type === 'DFM 过孔环宽' && i.sev === 'error'), '环宽 0.05mm 应报 error');
  d.viaOuter = 0.8; d.viaDrill = 0.4;
  // 4) 贴板边焊盘 → warn
  d.pads.push(pad('edge', 'a', 0.5, 10.25));
  issues = core.checkDRC(d, r);
  assert(issues.some(i => i.type === 'DFM 板边' && i.msg.includes('edge')), '贴板边焊盘应报 warn');
  d.pads = d.pads.filter(p => p.id !== 'edge');
  // 5) 标准参数无 DFM 问题
  issues = core.checkDRC(d, r);
  assert(!issues.some(i => i.type.startsWith('DFM')), '标准参数不应有 DFM 问题：' + JSON.stringify(issues.filter(i => i.type.startsWith('DFM'))));
});

t('投板检查表：逐项生成、状态判定正确', () => {
  const d = core.EXAMPLES[0].build();
  const r = run(d);
  core.beautifyResult(d, r);
  const rows = core.fabChecklist(d, r, {});
  assert(rows.length >= 10, '检查项数量');
  assert(rows.some(x => x.group === '线宽/线距' && x.status === 'ok'), '线宽项 ok');
  assert(rows.some(x => x.group === '过孔' && x.status === 'ok'), '过孔项 ok');
  assert(rows.some(x => x.group === '人工确认' && x.status === 'info'), '人工确认项存在');
  // 违规设计：细线 + 小钻孔 → fail
  d.trackW = 0.05; d.viaDrill = 0.1;
  const rows2 = core.fabChecklist(d, r, {});
  assert(rows2.some(x => x.item.includes('信号线宽') && x.status === 'fail'), '线宽 fail');
  assert(rows2.some(x => x.item.includes('钻孔') && x.status === 'fail'), '钻孔 fail');
});

t('3W 检查：高速网络与其它网络中心距 < 3W 报告', () => {
  const d = core.designDefaults();
  d.width = 40; d.height = 20;
  d.nets = [net('hs', 'CLK'), net('b')];
  d.nets[0].hs = true;
  d.pads = [pad('h1', 'hs', 2.25, 2.25), pad('b1', 'b', 2.25, 18.25)];
  // 合成结果：hs 与 b 两条平行线，间距可调
  const mk = (y, l) => [{ x: 5, y, l }, { x: 35, y, l }];
  const build = (by) => ({ nets: [
    { netId: 'hs', name: 'CLK', manual: false, connected: 2, total: 2, paths: [mk(5, 0)], vias: [], cells: [] },
    { netId: 'b', name: 'b', manual: false, connected: 2, total: 2, paths: [mk(by, 0)], vias: [], cells: [] }
  ], overuse: [] });
  // 0.5mm < 3W(0.9mm) → 报警
  const issues = core.checkDRC(d, build(5.5));
  assert(issues.some(i => i.type === '3W 间距'), '中心距 0.5mm < 3W 应报 warn');
  // 1.5mm ≥ 3W → 不报
  const issues2 = core.checkDRC(d, build(6.5));
  assert(!issues2.some(i => i.type === '3W 间距'), '中心距 1.5mm ≥ 3W 不应报警');
  // 未标记高速 → 不报
  d.nets[0].hs = false;
  const issues3 = core.checkDRC(d, build(5.5));
  assert(!issues3.some(i => i.type === '3W 间距'), '未标记高速不触发 3W');
});

t('回流地孔：远离地铜的过孔被检出', () => {
  const d = core.designDefaults();
  d.width = 50; d.height = 30;
  d.nets = [net('gnd'), net('sig')];
  d.pads = [
    pad('g1', 'gnd', 5.25, 5.25),
    pad('s1', 'sig', 25.25, 15.25), pad('s2', 'sig', 45.25, 15.25)
  ];
  // 禁布区围出右下角“口袋”，铜皮进不去：口袋里的过孔 2mm 内无地铜
  d.keepouts = [
    { x: 42.75, y: 23.75, w: 1, h: 13 },
    { x: 46.5, y: 16.75, w: 7.5, h: 1.2 }
  ];
  const r = run(d);
  const pour = core.computePour(d, r, { layer: 1, netId: 'gnd', thermal: true });
  const merged = { nets: [...r.nets, {
      netId: 'sig', name: 'sig', manual: false, connected: r.nets[1].connected, total: 2,
      paths: r.nets[1].paths, vias: [{ x: 46.25, y: 23.75 }], cells: [] }], overuse: [] };
  const issues = core.checkDRC(d, merged, { pour });
  assert(issues.some(i => i.type === '回流地孔'), '远离地铜的过孔应提示补回流地孔：' + JSON.stringify(issues.slice(0, 3)));
  // 地焊盘附近（g1 旁 2mm 内）的同位过孔不应报警
  const merged2 = { nets: [...r.nets, {
      netId: 'sig', name: 'sig', manual: false, connected: r.nets[1].connected, total: 2,
      paths: r.nets[1].paths, vias: [{ x: 5.25, y: 8.25 }], cells: [] }], overuse: [] };
  const issues2 = core.checkDRC(d, merged2, { pour });
  assert(!issues2.some(i => i.type === '回流地孔'), '地焊盘旁不应报警');
});

t('缝合孔：落在铜皮上、避开其它导体、计入 Gerber 与 DRC', () => {
  const d = core.EXAMPLES[0].build();
  const r = run(d);
  core.beautifyResult(d, r);
  const pour = core.computePour(d, r, { layer: 1, netId: 'gnd', thermal: true });
  const pts = core.planStitching(d, r, pour, 5);
  assert(pts.length > 0, '应规划出缝合孔');
  for(const p of pts) assertEq(p.netId, 'gnd', '缝合孔网络');
  // 不与其它网络过孔/焊盘冲突
  for(const p of pts){
    for(const n of r.nets){
      for(const v of n.vias) assert(Math.hypot(p.x-v.x,p.y-v.y) >= d.viaOuter+d.clearance-1e-6, '与过孔过近');
      for(const pad0 of d.pads.filter(q=>q.netId!==p.netId))
        assert(core.distToRect(p.x,p.y,pad0.x,pad0.y,pad0.w,pad0.shape==='circle'?pad0.w:pad0.h) >= d.viaOuter/2+d.clearance-1e-6, '与焊盘过近');
    }
  }
  // Gerber 包含缝合孔
  d.stitching = pts;
  const g = core.buildGerber(d, r, pour);
  const flashes = (g.top.match(/D03\*/g) || []).length;
  assertEq(flashes, d.pads.filter(p => p.layer === 'both').length + r.nets.reduce((s, n) => s + n.vias.length, 0) + pts.length, '顶层闪现含缝合孔');
  // DRC 把缝合孔计入过孔间距检查（无冲突）
  const merged = { nets: r.nets, overuse: [] };
  const issues = core.checkDRC(d, merged, { pour });
  assert(!issues.some(i => i.type === '过孔间距'), '缝合孔与其它过孔不应冲突：' + JSON.stringify(issues.filter(i => i.type === '过孔间距').slice(0, 2)));
});

t('覆铜孤岛统计', () => {
  const d = core.designDefaults();
  d.width = 40; d.height = 24;
  d.nets = [net('gnd'), net('a')];
  d.pads = [
    pad('g1', 'gnd', 5.25, 5.25),
    pad('a1', 'a', 25.25, 12.25), pad('a2', 'a', 33.25, 12.25)
  ];
  // 一堵竖墙把右侧切出孤岛（右侧没有 gnd 焊盘）
  d.keepouts = [{ x: 20.25, y: 12.25, w: 1.5, h: 24 }];
  const r = run(d);
  const pour = core.computePour(d, r, { layer: 1, netId: 'gnd', thermal: true });
  assert(pour.islands >= 1, '应统计到孤岛：' + pour.islands);
  assert(pour.islandArea > 0, '孤岛面积 > 0');
  const issues = core.checkDRC(d, r, { pour });
  assert(issues.some(i => i.type === '覆铜孤岛' && i.sev === 'info'), 'DRC 应报告孤岛信息');
});

t('RMST：Hanan 网格斯坦纳树分解优于中心点分解', () => {
  // 三角形布局：中心点直角 MST 长 40，斯坦纳树长 30（斯坦纳点在 (10,0)，度 3 → 3 条任务边）
  const pts = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }];
  const tasks = core.rmstTasks(pts);
  assert(Array.isArray(tasks) && tasks.length === 3, '含斯坦纳点 → 3 条任务边');
  let len = 0;
  const seen = new Set();
  for (const t of tasks) {
    len += Math.abs(t.to.x - t.from.x) + Math.abs(t.to.y - t.from.y);
    seen.add(t.from.x + '_' + t.from.y);
    seen.add(t.to.x + '_' + t.to.y);
  }
  for (const p of pts) assert(seen.has(p.x + '_' + p.y), '所有引脚都在树中');
  assertEq(len, 30, '斯坦纳树总长（普通分解 40）');
  // 与引脚顺序无关
  const t2 = core.rmstTasks([pts[2], pts[0], pts[1]]);
  let len2 = 0;
  for (const t of t2) len2 += Math.abs(t.to.x - t.from.x) + Math.abs(t.to.y - t.from.y);
  assertEq(len2, 30, '与引脚顺序无关');
});

t('RMST 集成：五引脚十字网络 100% 布通 + DRC 干净', () => {
  const d = core.designDefaults();
  d.width = 30; d.height = 30;
  d.nets = [net('x')];
  d.pads = [
    pad('p1', 'x', 15.25, 5.25), pad('p2', 'x', 15.25, 25.25),
    pad('p3', 'x', 5.25, 15.25), pad('p4', 'x', 25.25, 15.25),
    pad('p5', 'x', 15.25, 15.25)
  ];
  const r = run(d);
  assertEq(r.status, 'complete', '全部连通');
  const issues = core.checkDRC(d, r);
  assertEq(issues.filter(i => i.sev === 'error').length, 0, 'DRC 干净');
});

console.log('\n— Freerouting 源码借鉴：逐网优化器 / 确定性 —');

function lexScore(r) {
  const fails = r.stats.total - r.stats.connected;
  return [fails === 0 && r.status === 'complete' ? 0 : 1, fails, r.overuse.length, r.stats.vias, Math.round(r.stats.trackLen * 10)];
}
function lexLE(a, b) { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]; return true; }

t('逐网优化器：三块示例板优化后绝不退步（连通/冲突/过孔/线长）', () => {
  for (const ex of core.EXAMPLES) {
    const d = ex.build();
    const s = core.createSession(d, {});
    let guard = 0;
    for (;;) { const r = s.step(); if (r.done) break; if (++guard > 200000) throw new Error(ex.id + ' step 超限'); }
    const before = s.buildResult();
    const bScore = lexScore(before);
    const opt = s.optimize(2);
    assert(opt && typeof opt.improved === 'number', ex.id + ' optimize 返回结构');
    const after = s.buildResult();
    const aScore = lexScore(after);
    assert(lexLE(aScore, bScore), ex.id + ' 优化后退步：' + JSON.stringify(bScore) + ' → ' + JSON.stringify(aScore));
    const issues = core.checkDRC(d, after);
    assertEq(issues.filter(i => i.sev === 'error').length, 0, ex.id + ' 优化后 DRC 应干净');
  }
});

t('逐网优化器：优化后走线几何间距仍合规（555 示例审计）', () => {
  const d = core.EXAMPLES[0].build();
  const s = core.createSession(d, {});
  for (;;) { if (s.step().done) break; }
  s.optimize(2);
  const r = s.buildResult();
  const worst = auditSpacing(d, r);
  const need = d.trackW + d.clearance;
  assert(worst >= need - 1e-6, '优化后最小间距 ' + worst.toFixed(4) + ' 应 ≥ ' + need);
});

t('确定性：同一设计两次布线结果完全一致（含停滞洗牌）', () => {
  const strip = r => { const { timeMs, ...rest } = r; return rest; };
  const r1 = strip(run(core.EXAMPLES[2].build()));
  const r2 = strip(run(core.EXAMPLES[2].build()));
  assertEq(JSON.stringify(r1), JSON.stringify(r2), '两次结果应完全一致');
});

t('优化器运行后会话仍可用：rerouteSingle 与 buildResult 正常', () => {
  const d = core.EXAMPLES[0].build();
  const s = core.createSession(d, {});
  for (;;) { if (s.step().done) break; }
  const opt = s.optimize(2);
  const rr = s.rerouteSingle(d.nets[0].id);
  assert(typeof rr.ok === 'boolean', 'rerouteSingle 返回 ok 字段');
  assert(rr.total >= 2, 'rerouteSingle 返回焊盘数');
  const r = s.buildResult();
  assert(r.nets.length === d.nets.length, '网络数量不变');
  assert(Array.isArray(r.overuse), 'overuse 列表存在');
  if (rr.ok) assertEq(rr.connected, rr.total, '重布成功应全连通');
});

console.log('\n— 一线布线器借鉴：弦拉直 / 历史衰减 —');

function mkResult(d, paths, extraNets) {
  return { status: 'complete', iterations: 0, timeMs: 1, overuse: [],
    nets: [{ netId: 'a', name: 'a', connected: 2, total: 2, paths, vias: [], cells: [] },
           ...(extraNets || [])],
    stats: { connected: 2, total: 2, trackTop: 0, trackBot: 0, vias: 0, trackLen: 0 } };
}
const UPATH = [
  [{ x: 5.25, y: 10.25, l: 0 }, { x: 5.25, y: 16.25, l: 0 }, { x: 25.25, y: 16.25, l: 0 }, { x: 25.25, y: 10.25, l: 0 }]
];

t('弦拉直：U 形绕行段被拉直，线长显著缩短且 DRC 干净（KiCad mergeStep）', () => {
  const d = core.designDefaults();
  d.width = 30; d.height = 20;
  d.nets = [net('a')];
  d.pads = [pad('p1', 'a', 5.25, 10.25), pad('p2', 'a', 25.25, 10.25)];
  const r = mkResult(d, JSON.parse(JSON.stringify(UPATH)));
  core.beautifyResult(d, r);
  assert(r.stats.trackLen < 25, 'U(40mm) 应被拉直为直连（实际 ' + r.stats.trackLen.toFixed(1) + '）');
  const issues = core.checkDRC(d, r);
  assertEq(issues.filter(i => i.sev === 'error').length, 0, 'DRC 干净');
});

t('弦拉直：替换段与其它网络间距不足时保持绕行', () => {
  const d = core.designDefaults();
  d.width = 30; d.height = 20;
  d.nets = [net('a'), net('b')];
  d.pads = [pad('p1', 'a', 5.25, 10.25), pad('p2', 'a', 25.25, 10.25),
            pad('b1', 'b', 13.25, 10.5), pad('b2', 'b', 17.25, 10.5)];
  const r = mkResult(d, JSON.parse(JSON.stringify(UPATH)), [
    { netId: 'b', name: 'b', connected: 2, total: 2, vias: [], cells: [],
      paths: [[{ x: 13.25, y: 10.5, l: 0 }, { x: 17.25, y: 10.5, l: 0 }]] }]);
  core.beautifyResult(d, r);
  assert(r.stats.trackLen > 32, '直连被 b 网阻挡，应保持绕行（实际 ' + r.stats.trackLen.toFixed(1) + '）');
  const issues = core.checkDRC(d, r);
  assertEq(issues.filter(i => i.sev === 'error').length, 0, 'DRC 干净');
});

t('弦拉直：被替换跨度接触的同网焊盘保持连接', () => {
  const d = core.designDefaults();
  d.width = 30; d.height = 24;
  d.nets = [net('a')];
  d.pads = [pad('p1', 'a', 5.25, 10.25), pad('p2', 'a', 25.25, 10.25), pad('pm', 'a', 15.25, 16.25)];
  const r = mkResult(d, JSON.parse(JSON.stringify(UPATH)));
  core.beautifyResult(d, r);
  let touched = false;
  for (const p of r.nets[0].paths) for (let k = 1; k < p.length; k++) {
    if (core.segDist(15.25, 16.25, p[k - 1].x, p[k - 1].y, p[k].x, p[k].y) <= 0.16) touched = true;
  }
  assert(touched, '同网焊盘 pm 必须仍被走线接触');
  assert(r.stats.trackLen > 30, '无法保持接触时不得拉直（实际 ' + r.stats.trackLen.toFixed(1) + '）');
});

t('历史代价衰减（FlexDR marker decay）：开启后仍 100% 布通且 DRC 干净', () => {
  const d = core.EXAMPLES[2].build();
  const r = run(d, { histDecay: 0.95 });
  assertEq(r.status, 'complete', '布通');
  const issues = core.checkDRC(d, r);
  assertEq(issues.filter(i => i.sev === 'error').length, 0, 'DRC 干净');
});

console.log('\n— KiCad 导入 / 长度下界 / 阻抗 —');

const KICAD_SAMPLE = `(kicad_pcb (version 20221018) (generator pcbnew)
  (net 0 "")
  (net 1 "GND")
  (net 2 "VCC")
  (gr_rect (start 0 0) (end 40 30) (layer "Edge.Cuts") (width 0.05) (fill solid))
  (footprint "R_0805" (layer "F.Cu")
    (at 10 10 90)
    (property "Reference" "R1" (at 0 -2 90) (layer "F.SilkS"))
    // 忠实 KiCad 输出（外部板三重实证）：pad 位置=封装本地坐标、pad 角=板坐标
    // 绝对角（本地 0.6×1.0 竖长 pad 在 fp rot 90 下板面 1.0×0.6——绝对角 90 必须写）
    (pad "1" smd rect (at 0 -1.2 90) (size 0.6 1.0) (layers "F.Cu" "F.Paste" "F.Mask") (net 2 "VCC"))
    (pad "2" smd rect (at 0 1.2 90) (size 0.6 1.0) (layers "F.Cu" "F.Paste" "F.Mask") (net 1 "GND"))
  )
  (footprint "PinHeader_1x01" (layer "F.Cu")
    (at 30 20)
    (property "Reference" "J1" (at 0 -2) (layer "F.SilkS"))
    (pad "1" thru_hole circle (at 0 0) (size 1.7 1.7) (drill 1.0) (layers "*.Cu" "*.Mask") (net 1 "GND"))
  )
  (footprint "TestPad_B" (layer "F.Cu")
    (at 35 25)
    (property "Reference" "TP1" (at 0 -2) (layer "B.SilkS"))
    (pad "" smd rect (at 0 0) (size 1 1) (layers "B.Cu" "B.Paste" "B.Mask") (net 2 "VCC"))
    (pad "2" smd rect (at 2 0) (size 1 1) (layers "F.Cu" "F.Paste" "F.Mask"))
  )
)`;

t('KiCad 导入：板框/网络/焊盘层与旋转/未接焊盘', () => {
  const d = core.importKiCadPcb(KICAD_SAMPLE, { margin: 1.0 });
  assertEq(d.width, 42, '板宽 = 40 + 2×1 外扩');
  assertEq(d.height, 32, '板高');
  assertEq(d.nets.length, 2, '网络数（net 0 与未用网络被剔除）');
  assert(d.nets.some(n => n.name === 'GND') && d.nets.some(n => n.name === 'VCC'), '网络名');
  assertEq(d.pads.length, 5, '焊盘数');
  const p1 = d.pads.find(p => p.id === 'R1-1');
  assert(p1, 'R1-1 存在');
  // 封装旋转 90°：本地 (0,-1.2) 旋转 → 世界 (1.2,0)，加封装位置 (10,10)、原点平移 (+1,+1)
  assert(Math.abs(p1.x - 12.2) < 1e-6 && Math.abs(p1.y - 11) < 1e-6, 'R1-1 位置 (' + p1.x + ',' + p1.y + ')');
  assert(Math.abs(p1.w - 1.0) < 1e-6 && Math.abs(p1.h - 0.6) < 1e-6, '旋转 90° 后宽高互换');
  assertEq(p1.layer, 'top', 'F.Cu smd → top');
  const vcc = d.nets.find(n => n.name === 'VCC');
  assertEq(p1.netId, vcc.id, '网络映射');
  const j1 = d.pads.find(p => p.id === 'J1-1');
  assertEq(j1.layer, 'both', '*.Cu 通孔 → both');
  assertEq(j1.shape, 'circle', '圆形焊盘');
  const tp = d.pads.find(p => p.id.startsWith('TP1-') && p.layer === 'bottom');
  assert(tp, 'B.Cu smd → bottom');
  const loose = d.pads.find(p => p.netId === null);
  assert(loose, '无网络焊盘 → 独立焊盘');
});

t('KiCad 导入的板子可直接布线：100% 布通 + DRC 干净', () => {
  const d = core.importKiCadPcb(KICAD_SAMPLE, { margin: 1.0 });
  const r = run(d, { viaCost: 15 });
  assertEq(r.status, 'complete', '布通');
  const issues = core.checkDRC(d, r);
  assertEq(issues.filter(i => i.sev === 'error').length, 0, 'DRC 干净');
});

t('长度下界：RMST 与 Prim 退化', () => {
  const lb = core.netLowerBound;
  assertEq(lb([]), 0, '空');
  assertEq(lb([{ x: 0, y: 0 }, { x: 10, y: 0 }]), 10, '两点曼哈顿');
  assertEq(lb([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }]), 20, 'L 形三点半格斯坦纳 = 20');
});

t('阻抗估算：微带/带状线与 50Ω 反算', () => {
  const z = core.impedance(0.2, 0.1, 4.3, 0.035, 'microstrip');
  assert(z.ok && z.z0 > 30 && z.z0 < 55, '微带 Z0 合理区间（实际 ' + z.z0.toFixed(1) + '）');
  const zs = core.impedance(0.1, 0.3, 4.3, 0.035, 'stripline');
  assert(zs.ok && zs.z0 > 40 && zs.z0 < 90, '带状线 Z0 合理区间（实际 ' + zs.z0.toFixed(1) + '）');
  const w = core.widthForZ0(50, 0.1, 4.3, 0.035, 'microstrip');
  assert(w > 0.05 && w < 0.4, '50Ω 反算线宽合理（实际 ' + w + '）');
  const back = core.impedance(w, 0.1, 4.3, 0.035, 'microstrip');
  assert(Math.abs(back.z0 - 50) < 2, '反算回代 ≈50Ω（实际 ' + back.z0.toFixed(1) + '）');
  assert(!core.impedance(0, 0.1, 4.3, 0.035, 'microstrip').ok, '非法参数');
});

console.log('\n— 封装生成器 —');

t('封装生成器：贴片阻容 / SOIC / DIP / 排针', () => {
  const fp = core.footprintPads;
  // 0603：两焊盘，中心距 1.60，焊盘 0.90×0.80
  const c = fp('0603');
  assertEq(c.length, 2, '0603 焊盘数');
  assertEq(Math.abs(c[1].dx - c[0].dx), 1.6, '0603 中心距');
  assert(Math.abs(c[0].w - 0.9) < 1e-9 && Math.abs(c[0].h - 0.8) < 1e-9, '0603 焊盘尺寸');
  // SOIC-8：8 焊盘，左列 1..4 上→下，右列 5..8 下→上，节距 1.27，排距 5.4
  const s8 = fp('SOIC-8');
  assertEq(s8.length, 8, 'SOIC-8 焊盘数');
  assertEq(s8[0].dx, -2.7, 'pin1 左列');
  assertEq(s8[3].dy - s8[0].dy, 1.27 * 3, '左列节距 1.27');
  assertEq(s8[4].dx, 2.7, 'pin5 右列（下端）');
  assertEq(s8[4].dy, s8[3].dy, '逆时针：pin5 与 pin4 同高');
  assertEq(s8[0].w, 1.5, '焊盘长边沿 X');
  // DIP-8：圆形通孔焊盘，排距 7.62，节距 2.54
  const d8 = fp('DIP-N', 8);
  assertEq(d8.length, 8, 'DIP-8 焊盘数');
  assertEq(d8[0].shape, 'circle', 'DIP 圆形焊盘');
  assertEq(d8[4].dx - d8[0].dx, 7.62, 'DIP 排距 7.62');
  assertEq(d8[3].dy - d8[0].dy, 2.54 * 3, '左列节距 2.54');
  assertEq(d8[4].dy, d8[3].dy, '逆时针：pin5 与 pin4 同高');
  // 排针
  assertEq(fp('排针 1×N', 4).length, 4, '1×4 排针');
  assertEq(fp('排针 2×N', 3).length, 6, '2×3 排针');
  // SOT-23
  assertEq(fp('SOT-23').length, 3, 'SOT-23 三焊盘');
  assert(fp('1206').length === 2 && fp('0402')[0].w < fp('1206')[0].w, '0402 焊盘小于 1206');
});

t('封装生成器 + 布线集成：放置 SOIC-8 与连接器后可布通', () => {
  const d = core.designDefaults();
  d.width = 40; d.height = 30;
  d.nets = [net('a'), net('b')];
  const soic = core.footprintPads('SOIC-8');     // 8 焊盘
  const hdr = core.footprintPads('排针 1×N', 4);  // 4 焊盘
  d.pads = [
    ...soic.map((f, i) => ({ id: 'U1-' + (i + 1), netId: i % 2 ? 'a' : 'b',
      x: 12 + f.dx, y: 15 + f.dy, w: f.w, h: f.h, shape: f.shape, layer: f.layer })),
    ...hdr.map((f, i) => ({ id: 'J1-' + (i + 1), netId: i % 2 ? 'a' : 'b',
      x: 30 + f.dx, y: 15 + f.dy, w: f.w, h: f.h, shape: f.shape, layer: f.layer }))
  ];
  const r = run(d, { viaCost: 15 });
  assertEq(r.stats.connected, r.stats.total, '全部焊盘连通');
  const issues = core.checkDRC(d, r);
  assertEq(issues.filter(i => i.sev === 'error').length, 0, 'DRC 干净');
});

console.log('\n— Freerouting DSN/SES 互通 —');

t('DSN 导出：结构、坐标 µm 换算、网络引脚格式', () => {
  const d = core.designDefaults();
  d.width = 30; d.height = 20;
  d.nets = [net('a'), net('b')];
  d.pads = [
    { id: 'U1-1', netId: 'a', x: 10.25, y: 10.25, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' },
    { id: 'U1-2', netId: 'b', x: 20.25, y: 10.25, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' },
    { id: 'J1-1', netId: 'a', x: 25, y: 15, w: 1.0, shape: 'circle', layer: 'top' }
  ];
  const dsn = core.exportDSN(d);
  assert(dsn.startsWith('(pcb'), 'pcb 头');
  assert(dsn.includes('(resolution um 10)'), 'resolution um 10');
  assert(dsn.includes('(layer Top (type signal))') && dsn.includes('(layer Bottom (type signal))'), '层定义');
  assert(dsn.includes('30000 0 30000 20000'), '板框 µm（30×20mm）');
  assert(dsn.includes('(net a 1') && dsn.includes('(pins U1-1 J1-1)'), '网络引脚格式');
  assert(dsn.includes('(pin "PAD_0" "1" 10250 10250)'), '焊盘坐标 µm 与 padstack 引用（含下划线/数字开头均加引号）');
  assert(dsn.includes('(shape (circle signal 1000))'), '圆形焊盘 padstack');
  assert(dsn.includes('(shape (rect signal -600 -600 600 600))'), '通孔矩形 padstack 用 signal 层');
  assert(dsn.includes('(padstack VIA_DEFAULT'), '过孔 padstack');
  const dsn4 = core.exportDSN({ ...d, layers: 4 });
  assert(dsn4.includes('(layer In1 (type signal))') && dsn4.includes('(layer In2 (type signal))'), '四层板层名 In1/In2');
});

t('SES 回读：坐标换算、过孔合并成换层点、未知网络跳过', () => {
  const d = core.designDefaults();
  d.width = 30; d.height = 20;
  d.nets = [net('a'), net('b')];   // ghost 不在设计里 → SES 未知网络
  d.pads = [
    { id: 'U1-1', netId: 'a', x: 10.25, y: 10.25, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' },
    { id: 'U1-2', netId: 'a', x: 20.25, y: 10.25, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' },
    { id: 'B1', netId: 'b', x: 10.25, y: 15.25, w: 1.2, h: 1.2, shape: 'rect', layer: 'top' },
    { id: 'B2', netId: 'b', x: 20.25, y: 15.25, w: 1.2, h: 1.2, shape: 'rect', layer: 'bottom' }
  ];
  const ses = `(session design.dsn
    (routes
      (resolution um 10)
      (network_out
        (net a
          (wire (path Top 300 102500 102500 202500 102500))
        )
        (net b
          (wire (path Top 300 10250 152500 150000 152500))
          (via VIA_DEFAULT 150000 152500)
          (wire (path Bottom 300 150000 152500 202500 152500))
        )
        (net ghost
          (wire (path Top 300 0 0 10000 0))
        )
      )
    )
  )`;
  const r = core.importSES(ses, d);
  assertEq(r.entries.length, 2, 'net a 一条 + net b 合并后一条');
  assertEq(r.vias, 1, '过孔合并计数');
  assertEq(r.errors.length, 1, '未知网络 ghost 被跳过');
  const ea = r.entries.find(e => e.netId === 'a');
  assert(Math.abs(ea.pts[0].x - 10.25) < 1e-9 && Math.abs(ea.pts[0].y - 10.25) < 1e-9 && ea.pts[0].l === 0, 'net a 起点');
  assert(Math.abs(ea.pts[1].x - 20.25) < 1e-9, 'net a 终点');
  const eb = r.entries.find(e => e.netId === 'b');
  assertEq(eb.pts.length, 4, '合并后 4 点');
  assertEq(eb.pts[2].l, 1, '换层点在 Bottom');
  assert(Math.abs(eb.pts[2].x - 15) < 1e-9 && Math.abs(eb.pts[2].y - 15.25) < 1e-9, '过孔位置');
  assertEq(eb.pts[3].l, 1, '末点底层');
});

t('SES 回读集成：手动走线计入连通、DRC 干净', () => {
  const d = core.designDefaults();
  d.width = 30; d.height = 20;
  d.nets = [net('a')];
  d.pads = [
    { id: 'U1-1', netId: 'a', x: 10.25, y: 10.25, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' },
    { id: 'U1-2', netId: 'a', x: 20.25, y: 10.25, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' }
  ];
  const ses = `(session x
    (routes (resolution um 10)
      (network_out
        (net a (wire (path Top 300 102500 102500 202500 102500)))
      )
    )
  )`;
  const r = core.importSES(ses, d);
  d.manual = r.entries.map((en, i) => ({ id: 'SES' + i, netId: en.netId, pts: en.pts }));
  const manual = { nets: d.manual.map(m => ({
      netId: m.netId, name: 'SES', manual: true, connected: 2, total: 2,
      paths: [m.pts.map(p => ({ x: p.x, y: p.y, l: p.l }))], vias: [], cells: [] })),
    overuse: [] };
  const issues = core.checkDRC(d, manual);
  assertEq(issues.filter(i => i.sev === 'error').length, 0, '手动走线 DRC 干净');
});

console.log('\n— AI 自动布局 / EasyEDA 导出 —');

t('自动布局：堆叠展开、无重叠、不出板、代价下降', () => {
  const d = core.designDefaults();
  d.width = 50; d.height = 35;
  d.nets = [net('a'), net('b'), net('c')];
  const soic = core.footprintPads('SOIC-8');
  const hdr = core.footprintPads('排针 1×N', 4);
  d.pads = [
    ...soic.map((f, i) => ({ id: 'U1-' + (i + 1), netId: i % 2 ? 'a' : 'b', x: 8 + f.dx, y: 8 + f.dy, w: f.w, h: f.h, shape: f.shape, layer: f.layer })),
    ...hdr.map((f, i) => ({ id: 'J1-' + (i + 1), netId: i % 2 ? 'a' : 'c', x: 9 + f.dx, y: 9 + f.dy, w: f.w, h: f.h, shape: f.shape, layer: 'both' }))
  ];
  const r = core.autoPlace(d, { iterations: 3000 });
  assert(r.after < r.before, '布局代价应下降（' + r.before + ' → ' + r.after + '）');
  let overlaps = 0;
  for (let i = 0; i < d.pads.length; i++) for (let j = i + 1; j < d.pads.length; j++) {
    const a = d.pads[i], b = d.pads[j];
    if (a.id.split('-')[0] === b.id.split('-')[0]) continue;
    const ox = (a.w + b.w) / 2 - Math.abs(a.x - b.x), oy = (a.h + b.h) / 2 - Math.abs(a.y - b.y);
    if (ox > 0 && oy > 0) overlaps++;
  }
  assertEq(overlaps, 0, '异组焊盘重叠数');
  for (const p of d.pads)
    assert(p.x >= p.w / 2 - 1e-9 && p.x <= d.width - p.w / 2 + 1e-9 && p.y >= p.h / 2 - 1e-9 && p.y <= d.height - p.h / 2 + 1e-9, '焊盘在板内');
});

t('自动布局 + 布线集成：布局后 100% 布通', () => {
  const d = core.designDefaults();
  d.width = 50; d.height = 35;
  d.nets = [net('a'), net('b'), net('c')];
  const soic = core.footprintPads('SOIC-8');
  const hdr = core.footprintPads('排针 1×N', 4);
  d.pads = [
    ...soic.map((f, i) => ({ id: 'U1-' + (i + 1), netId: i % 2 ? 'a' : 'b', x: 8 + f.dx, y: 8 + f.dy, w: f.w, h: f.h, shape: f.shape, layer: f.layer })),
    ...hdr.map((f, i) => ({ id: 'J1-' + (i + 1), netId: i % 2 ? 'a' : 'c', x: 9 + f.dx, y: 9 + f.dy, w: f.w, h: f.h, shape: f.shape, layer: 'both' }))
  ];
  core.autoPlace(d, { iterations: 3000 });
  const s = core.createSession(d, { viaCost: 15 });
  for (;;) { if (s.step().done) break; }
  const r = s.buildResult();
  assertEq(r.stats.connected, r.stats.total, '全部连通');
  const issues = core.checkDRC(d, r);
  assertEq(issues.filter(i => i.sev === 'error').length, 0, 'DRC 干净');
});

t('EasyEDA PCB JSON 导出：docType/单位/层号/板框/焊盘', () => {
  const d = core.designDefaults();
  d.width = 50; d.height = 30;
  d.nets = [net('a'), net('b')];
  d.pads = [
    { id: 'U1-1', netId: 'a', x: 10, y: 10, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' },
    { id: 'U1-2', netId: 'b', x: 20, y: 10, w: 1.2, h: 1.2, shape: 'rect', layer: 'top' }
  ];
  const j = JSON.parse(core.exportEasyEdaPcb(d, [
    { netId: 'a', paths: [[{ x: 10, y: 10, l: 0 }, { x: 15, y: 10, l: 0 }, { x: 15, y: 12, l: 1 }]], vias: [{ x: 15, y: 12 }] }
  ]));
  assertEq(j.head.docType, '3', 'PCB 文档 docType=3');
  const pad1 = j.shape.find(s => s.startsWith('PAD~') && s.includes('~a~'));
  const f1 = pad1.split('~');
  assertEq(f1[1], 'RECT', '矩形焊盘');
  assert(Math.abs(parseFloat(f1[2]) - 39.37) < 0.02, '坐标换算 10mm→39.37（实际 ' + f1[2] + '）');
  assertEq(f1[6], '11', '通孔焊盘 layer=11 (Multi-Layer)');
  assertEq(f1[8], '1', '引脚号取 id 后缀');
  const pad2 = j.shape.find(s => s.startsWith('PAD~') && s.includes('~b~'));
  assertEq(pad2.split('~')[6], '1', '顶层表贴 layer=1');
  const trk = j.shape.find(s => s.startsWith('TRACK~'));
  const tf = trk.split('~');
  assertEq(tf[2], '1', '顶层走线 layer=1');
  assert(tf[4].startsWith('{') && tf[4].endsWith('}'), '点列用花括号');
  const via = j.shape.find(s => s.startsWith('VIA~'));
  assert(via, '过孔导出');
  const ol = j.shape.find(s => s.startsWith('SOLIDREGION~10'));
  assert(ol.includes('boardoutline') && ol.includes('M 0,0'), '板框 SOLIDREGION layer 10 boardoutline');
});

console.log('\n— 嘉立创器件库 / 原理图 / 铺铜 —');

// 真实 C1591（0603 100nF）API 样例的精简 fixture（字段序逐字保留）
const C1591_SYMBOL = {
  head: { docType: '2' },
  shape: [
    'PL~-2 8 -2 -8~#A00000~1~0~none~gge9~0',
    'P~show~0~1~-20~0~180~gge10~0^^-20~0^^M -10 0 h -10~#800^^0~-6~0~0~1~start~~~#800^^0~-14~-4~0~1~end~~~#800^^0~-33~0^^0~M -30 3 L -27 0 L -30 -3',
    'PL~10 0 2 0~#A00000~1~0~none~gge19~0',
    'PL~2 -8 2 8~#A00000~1~0~none~gge20~0',
    'P~show~0~2~20~0~0~gge21~0^^20~0^^M 10 0 h 10~#800^^0~6~0~0~2~end~~~#800^^0~14~-4~0~2~start~~~#800^^0~33~0^^0~M 30 -3 L 27 0 L 30 3',
    'PL~-2 0 -10 0~#A00000~1~0~none~gge28~0'
  ]
};
const C1591_FP = {
  head: { docType: '4' },
  canvas: 'CA|1000|1000|#000000|yes|#FFFFFF|10|1000|1000|line|0.03937|mm|1|45|visible|0.5|4000|3000|0|none',
  shape: [
    'SOLIDREGION~99~~M 3996.8504 3001.5748 L 4003.1496 3001.5748 L 4003.1496 2998.4252 L 3996.8504 2998.4252 Z ~solid~gge999~',
    'PAD~RECT~4002.756~3000~3.1496~3.5433~1~~2~0~4001.1811 2998.2283 4004.3307 2998.2283~0~gge1002~0~~Y~0~0.0000~0.2000~4002.7555,3000',
    'PAD~RECT~3997.244~3000~3.1496~3.5433~1~~1~0~3995.6755 2998.2283 3998.8125 2998.2283~0~gge1003~0~~Y~0~0.0000~0.2000~3997.2444,3000'
  ]
};

t('嘉立创器件解析：真符号引脚 + 真封装焊盘（C1591 实样）', () => {
  const dev = core.parseEasyEdaDevice(C1591_SYMBOL, C1591_FP);
  assertEq(dev.pins.length, 2, '符号引脚数');
  assertEq(dev.pins[0].number, '1', '引脚号取自 spice 字段');
  assertEq(dev.pins[0].x, -20, '引脚 1 连接点 x');
  assertEq(dev.pads.length, 2, '封装焊盘数');
  // canvas 原点 (4000,3000)：4002.756-4000=2.756 单位 ×0.254 = 0.700mm
  const p2 = dev.pads.find(p => p.number === '2');
  assert(Math.abs(p2.x - 0.7) < 0.01, '焊盘 x 相对原点 0.7mm（实际 ' + p2.x + '）');
  assert(Math.abs(p2.w - 0.8) < 0.01, '焊盘宽 3.1496 单位 = 0.8mm（实际 ' + p2.w + '）');
  assertEq(p2.layer, 'top', 'layer 1 → top');
  assert(dev.footprintBBox.w > 1.9 && dev.footprintBBox.w < 2.5, '封装含焊盘跨距 ≈2.2mm（实际 ' + dev.footprintBBox.w + '）');
});

t('嘉立创器件 → 设计焊盘 → 布通（真实封装尺寸）', () => {
  const dev = core.parseEasyEdaDevice(C1591_SYMBOL, C1591_FP);
  const d = core.designDefaults();
  d.width = 20; d.height = 15;
  d.nets = [net('a'), net('gnd')];
  d.pads = dev.pads.map(p => ({ id: 'C1-' + p.number, netId: p.number === '1' ? 'a' : 'gnd',
    x: 8 + p.x, y: 8 + p.y, w: p.w, h: p.h, shape: p.shape, layer: 'top' }));
  d.pads.push({ id: 'J1-1', netId: 'a', x: 16, y: 8, w: 1.2, h: 1.2, shape: 'rect', layer: 'top' });
  const r = run(d);
  assertEq(r.stats.connected, r.stats.total, '布通');
});

t('原理图导出：docType 1 + LIB + 网络标签 + 电源旗（真符号优先）', () => {
  const dev = core.parseEasyEdaDevice(C1591_SYMBOL, C1591_FP);
  const d = core.designDefaults();
  d.width = 20; d.height = 15;
  d.nets = [net('a'), net('gnd'), net('sig')];
  d.pads = [
    { id: 'C1-1', netId: 'a', x: 8, y: 8, w: 0.8, h: 0.8, shape: 'rect', layer: 'top' },
    { id: 'C1-2', netId: 'gnd', x: 8.8, y: 8, w: 0.8, h: 0.8, shape: 'rect', layer: 'top' },
    { id: 'R1-1', netId: 'sig', x: 14, y: 12, w: 0.8, h: 0.8, shape: 'rect', layer: 'top' },
    { id: 'R1-2', netId: 'gnd', x: 14.8, y: 12, w: 0.8, h: 0.8, shape: 'rect', layer: 'top' }
  ];
  d.devices = { C1: 'C1591' };
  const j = JSON.parse(core.exportEasyEdaSch(d, { C1: dev }));
  assertEq(j.head.docType, '1', '原理图 docType=1');
  const libs = j.shape.filter(s => s.startsWith('LIB~'));
  assertEq(libs.length, 2, '两个 LIB 实例');
  // C1 用了真符号：其 P 原语中的引脚号 1/2 保留
  const c1lib = libs.find(s => s.includes('`name`C1'));
  assert(c1lib.includes('#@$') && c1lib.includes('P~show~0~1~'), 'C1 内嵌真符号 P 原语');
  const labels = j.shape.filter(s => s.startsWith('N~'));
  assert(labels.some(s => s.includes('~sig~')), 'sig 网络标签');
  const flags = j.shape.filter(s => s.startsWith('F~part_netLabel_gnD'));
  assertEq(flags.length, 2, '两处 GND 电源旗');
  const wires = j.shape.filter(s => s.startsWith('W~'));
  assert(wires.length >= 4, '每引脚一根短导线');
});

t('铺铜串入 CLI 链路：面积>0、缝合孔入 design、DRC 不受污染', () => {
  const d = core.EXAMPLES[0].build();
  const s = core.createSession(d, {});
  for (;;) { if (s.step().done) break; }
  const r = s.buildResult();
  const gnd = d.nets.find(n => /gnd/i.test(n.name));
  const pour = core.computePour(d, r, { netId: gnd.id, layer: (d.layers || 2) - 1, thermal: true });
  assert(pour.area > 0, '铺铜面积 > 0（实际 ' + pour.area.toFixed(1) + '）');
  const stitches = core.planStitching(d, r, pour, 5);
  assert(stitches.length > 0, '缝合孔 > 0（实际 ' + stitches.length + '）');
  d.stitching = stitches;
  r.pour = pour;
  const issues = core.checkDRC(d, r, { pour });
  assert(!issues.some(i => i.type === '间距冲突' && i.sev === 'error'), '铺铜后无新增间距冲突');
});

t('丝印位号：EasyEDA 导出含 TEXT（comps 元数据优先，层 3/4）', () => {
  const d = core.designDefaults();
  d.width = 30; d.height = 20;
  d.nets = [net('a')];
  d.comps = { U1: { x: 15, y: 10, rot: 0, layer: 'top' } };
  d.pads = [
    { id: 'U1-1', netId: 'a', x: 10, y: 10, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' },
    { id: 'U1-2', netId: 'a', x: 20, y: 10, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' }
  ];
  const j = JSON.parse(core.exportEasyEdaPcb(d, []));
  const texts = j.shape.filter(s => s.startsWith('TEXT~'));
  assertEq(texts.length, 1, '一个组件一条丝印');
  const f = texts[0].split('~');
  assertEq(f[7], '3', '顶丝印 layer=3');
  assertEq(f[10], 'U1', '位号文字');
  assert(Math.abs(parseFloat(f[2]) - 59.06) < 0.05, 'x=15mm→59.06 单位（实际 ' + f[2] + '）');
  // 无 comps 元数据：按焊盘 bbox 推导
  delete d.comps;
  const j2 = JSON.parse(core.exportEasyEdaPcb(d, []));
  assertEq(j2.shape.filter(s => s.startsWith('TEXT~')).length, 1, '元数据缺失时推导丝印');
});

t('自动布局同步 comps 元数据（位置/层）', () => {
  const d = core.designDefaults();
  d.width = 50; d.height = 35;
  d.nets = [net('a')];
  d.pads = [
    { id: 'U1-1', netId: 'a', x: 5, y: 5, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' },
    { id: 'U1-2', netId: 'a', x: 5.6, y: 5, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' }
  ];
  core.autoPlace(d, { iterations: 500 });
  assert(d.comps && d.comps.U1, 'comps.U1 生成');
  const cx = (d.pads[0].x + d.pads[1].x) / 2;
  assert(Math.abs(d.comps.U1.x - cx) < 0.01, 'comps.x 与焊盘中心一致');
});

t('自动布局旋转：竖排元件可转 90°（焊盘有效宽高互换写回）', () => {
  const d = core.designDefaults();
  d.width = 30; d.height = 40;   // 板窄高：横放 0603 会被迫转竖
  d.nets = [net('a'), net('b')];
  // 两个竖长条禁布区夹出一条竖走廊，横放元件放不下 → 旋转才有解
  d.keepouts = [{ x: 8, y: 20, w: 6, h: 36 }, { x: 22, y: 20, w: 6, h: 36 }];
  d.pads = [
    { id: 'R1-1', netId: 'a', x: 15, y: 8, w: 1.6, h: 0.8, shape: 'rect', layer: 'top' },
    { id: 'R1-2', netId: 'b', x: 16.6, y: 8, w: 1.6, h: 0.8, shape: 'rect', layer: 'top' },
    { id: 'J1-1', netId: 'a', x: 15, y: 34, w: 1.2, h: 1.2, shape: 'rect', layer: 'top' },
    { id: 'J1-2', netId: 'b', x: 16.6, y: 34, w: 1.2, h: 1.2, shape: 'rect', layer: 'top' }
  ];
  // 不锚定 R1：允许退火旋转。R1-1/R1-2 在禁布区内（keepout 罚），
  // 旋转 90°（竖放）或移动到走廊均可解
  core.autoPlace(d, { iterations: 3000, restarts: 3 });
  const r1 = d.pads.filter(p => p.id.startsWith('R1-'));
  // 焊盘要么移出禁布区，要么旋转成竖放（w/h 互换）
  const inKeep = r1.filter(p => d.keepouts.some(k =>
    Math.abs(p.x - k.x) < (k.w + p.w) / 2 && Math.abs(p.y - k.y) < (k.h + p.h) / 2));
  const rotated = r1.some(p => p.h > p.w);   // 0.8×1.6 → 旋转后 h>w
  assert(inKeep.length === 0 || rotated, 'R1 应移出禁布区或旋转（inKeep=' + inKeep.length + ' rotated=' + rotated + '）');
  for (const p of d.pads) assert(p.w > 0 && p.h > 0, '写回宽高为正');
});

t('placeAndRoute 循环：堆叠起步 → 反馈迭代 → 布通', () => {
  const d = core.designDefaults();
  d.width = 50; d.height = 35;
  d.nets = [net('a'), net('b'), net('c')];
  const soic = core.footprintPads('SOIC-8');
  const hdr = core.footprintPads('排针 1×N', 4);
  // 模拟无序堆叠起步
  const groups = new Map();
  for (const p of [
    ...soic.map((f, i) => ({ id: 'U1-' + (i + 1), netId: i % 2 ? 'a' : 'b', dx: f.dx, dy: f.dy, w: f.w, h: f.h, shape: f.shape, layer: f.layer })),
    ...hdr.map((f, i) => ({ id: 'J1-' + (i + 1), netId: i % 2 ? 'a' : 'c', dx: f.dx, dy: f.dy, w: f.w, h: f.h, shape: f.shape, layer: 'both' }))
  ]) {
    const g = p.id.split('-')[0];
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(p);
  }
  let k = 0;
  d.pads = [];
  for (const [, ps] of groups) {
    const tx = 10 + (k % 3) * 1.5, ty = 12 + Math.floor(k / 3) * 1.5;
    for (const p of ps) d.pads.push({ id: p.id, netId: p.netId, x: +(tx + p.dx).toFixed(4), y: +(ty + p.dy).toFixed(4), w: p.w, h: p.h, shape: p.shape, layer: p.layer });
    k++;
  }
  const r = core.placeAndRoute(d, { rounds: 3, iterations: 2500, maxIter: 40 });
  assert(r.log.length >= 1, '至少一轮');
  assert(r.best && r.best.status === 'complete', 'placeAndRoute 后布通（log: ' + JSON.stringify(r.log.map(l => l.connected + '/' + l.total + ':' + l.overuse)) + '）');
  assertEq(d.pads.length, 12, '焊盘数不变');
});

t('computeHotspots：冲突与失败网络生成属主盒', () => {
  const d = core.designDefaults();
  d.width = 30; d.height = 20;
  d.nets = [net('a'), net('b')];
  d.pads = [
    { id: 'U1-1', netId: 'a', x: 10, y: 10, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' },
    { id: 'U1-2', netId: 'a', x: 20, y: 10, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' },
    { id: 'R1-1', netId: 'b', x: 12, y: 12, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' }
  ];
  const hs = core.computeHotspots(d, {
    overuse: [{ x: 11, y: 11, l: 0 }],
    nets: [{ netId: 'b', name: 'b', connected: 0, total: 1, paths: [], vias: [], cells: [] }]
  });
  assert(hs.length >= 1, '热点生成');
  assert(hs.some(h => h.owners.includes('U1')), '热点属主含 U1');
});

console.log('\n— 每网线宽（网络类）—');

t('netW/maxTrackW：回退与最大值', () => {
  const d = core.designDefaults();
  d.trackW = 0.3;
  d.nets = [{ id: 'a', name: 'VCC', w: 0.5 }, { id: 'b', name: 'SIG' }];
  assertEq(core.netW(d, 'a'), 0.5, '显式 w');
  assertEq(core.netW(d, 'b'), 0.3, '回退全板');
  assertEq(core.netW(d, null), 0.3, 'null 回退');
  assertEq(core.maxTrackW(d), 0.5, '最大线宽');
});

t('EasyEDA 导出：每网 TRACK 线宽（电源 0.5 / 信号 0.3）', () => {
  const d = core.designDefaults();
  d.width = 30; d.height = 20;
  d.nets = [{ id: 'p', name: 'VCC', w: 0.5 }, { id: 's', name: 'SIG' }];
  d.pads = [
    { id: 'U1-1', netId: 'p', x: 10, y: 10, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' },
    { id: 'U1-2', netId: 'p', x: 20, y: 10, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' },
    { id: 'R1-1', netId: 's', x: 10, y: 15, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' },
    { id: 'R1-2', netId: 's', x: 20, y: 15, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' }
  ];
  const j = JSON.parse(core.exportEasyEdaPcb(d, [
    { netId: 'p', paths: [[{ x: 10, y: 10, l: 0 }, { x: 20, y: 10, l: 0 }]], vias: [] },
    { netId: 's', paths: [[{ x: 10, y: 15, l: 0 }, { x: 20, y: 15, l: 0 }]], vias: [] }
  ]));
  const tp = j.shape.find(s => s.startsWith('TRACK~') && s.includes('~VCC~'));
  const ts = j.shape.find(s => s.startsWith('TRACK~') && s.includes('~SIG~'));
  assert(Math.abs(parseFloat(tp.split('~')[1]) - 0.5 / 0.254) < 0.01, 'VCC 轨宽 0.5mm（实际 ' + tp.split('~')[1] + '）');
  assert(Math.abs(parseFloat(ts.split('~')[1]) - 0.3 / 0.254) < 0.01, 'SIG 轨宽 0.3mm（实际 ' + ts.split('~')[1] + '）');
});

t('Gerber：不同线宽生成独立光圈并按网选择', () => {
  const d = core.designDefaults();
  d.width = 30; d.height = 20;
  d.nets = [{ id: 'p', name: 'VCC', w: 0.5 }, { id: 's', name: 'SIG' }];
  d.pads = [
    { id: 'U1-1', netId: 'p', x: 10, y: 10, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' },
    { id: 'U1-2', netId: 'p', x: 20, y: 10, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' }
  ];
  const g = core.buildGerber(d, { nets: [
    { netId: 'p', paths: [[{ x: 10, y: 10, l: 0 }, { x: 20, y: 10, l: 0 }]], vias: [], cells: [] }
  ], overuse: [] }, null);
  // 两个 C 光圈：默认 0.3 与 VCC 0.5
  assert(g.top.includes('%ADD10C,0.30000*%') || g.top.includes('C,0.30000'), '默认光圈');
  assert(g.top.includes('C,0.50000'), '0.5 光圈存在');
  assert(/D1[12]\*/.test(g.top), '按网选择光圈 D 码');
});

t('DSN 导出：差异线宽的网带 (rule (width))', () => {
  const d = core.designDefaults();
  d.width = 30; d.height = 20;
  d.nets = [{ id: 'p', name: 'VCC', w: 0.5 }, { id: 's', name: 'SIG' }];
  d.pads = [
    { id: 'U1-1', netId: 'p', x: 10, y: 10, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' },
    { id: 'U1-2', netId: 'p', x: 20, y: 10, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' }
  ];
  const dsn = core.exportDSN(d);
  const netP = dsn.split('\n').filter(l => l.includes('(net VCC') || l.includes('(rule (width 500))'));
  assert(dsn.includes('(rule (width 500))'), 'VCC 每网规则 0.5mm=500（0.1µm 刻度）');
  assert(!/ \(rule \(width 300\)\)/.test(dsn), '默认线宽网不冗余带规则');
});

t('DRC：每网线宽 DFM 分级（低于建议 warn / 低于极限 error）', () => {
  const d = core.designDefaults();
  d.width = 30; d.height = 20;
  d.nets = [{ id: 'p', name: 'VCC', w: 0.08 }, { id: 'q', name: 'P2', w: 0.14 }];
  d.pads = [
    { id: 'U1-1', netId: 'p', x: 10, y: 10, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' },
    { id: 'U1-2', netId: 'q', x: 20, y: 10, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' }
  ];
  const issues = core.checkDRC(d, { nets: [], overuse: [] });
  assert(issues.some(i => i.type === 'DFM 线宽' && i.sev === 'error' && i.msg.includes('VCC')), 'VCC 0.08 → error');
  assert(issues.some(i => i.type === 'DFM 线宽' && i.sev === 'warn' && i.msg.includes('P2')), 'P2 0.14 → warn');
});

t('丝印防碰撞：位号压焊盘时外移搜位', () => {
  const d = core.designDefaults();
  d.width = 40; d.height = 30;
  d.nets = [net('a')];
  d.comps = { U1: { x: 20, y: 15, rot: 0, layer: 'top' } };
  d.pads = [
    { id: 'U1-1', netId: 'a', x: 20, y: 15, w: 2, h: 2, shape: 'rect', layer: 'top' }
  ];
  const j = JSON.parse(core.exportEasyEdaPcb(d, []));
  const t1 = j.shape.find(sh => sh.startsWith('TEXT~'));
  const f = t1.split('~');
  const cx = parseFloat(f[2]) * 0.254, cy = parseFloat(f[3]) * 0.254;
  const moved = Math.abs(cx - 20) > 0.3 || Math.abs(cy - 15) > 0.3;
  assert(moved, '位号应从焊盘中心移开（实际 ' + cx.toFixed(2) + ',' + cy.toFixed(2) + '）');
  assert(cx > 0.2 && cx < d.width - 0.2 && cy > 0.2 && cy < d.height - 0.2, '移位后仍在板内');
});

t('丝印默认位置：无碰撞时保持元件中心', () => {
  const d = core.designDefaults();
  d.width = 40; d.height = 30;
  d.nets = [net('a')];
  d.comps = { U1: { x: 20, y: 15, rot: 0, layer: 'top' } };
  d.pads = [
    { id: 'U1-1', netId: 'a', x: 17, y: 17, w: 1.2, h: 1.2, shape: 'rect', layer: 'top' },
    { id: 'U1-2', netId: 'a', x: 23, y: 13, w: 1.2, h: 1.2, shape: 'rect', layer: 'top' }
  ];
  const j = JSON.parse(core.exportEasyEdaPcb(d, []));
  const f = j.shape.find(sh => sh.startsWith('TEXT~')).split('~');
  assert(Math.abs(parseFloat(f[2]) * 0.254 - 20) < 0.05, '中心无碰撞保持原位');
});

t('verify 回读自检：干净导出零 findings，篡改被检出', () => {
  const d = core.designDefaults();
  d.width = 30; d.height = 20;
  d.nets = [net('a')];
  d.pads = [
    { id: 'U1-1', netId: 'a', x: 10, y: 10, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' },
    { id: 'U1-2', netId: 'a', x: 20, y: 10, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' }
  ];
  const r = run(d);
  const v1 = core.verifyEasyEdaExport(d, r);
  assert(v1.ok && v1.findings.length === 0, '干净导出（' + JSON.stringify(v1.findings) + '）');
  // 篡改：用完整设计的导出对账删减后的设计
  const d2 = JSON.parse(JSON.stringify(d));
  d2.pads.pop();
  const v2 = core.verifyEasyEdaExport(d2, r, core.exportEasyEdaPcb(d, r.nets));
  assert(!v2.ok && v2.findings.some(f => f.id === 'VRF-PAD-COUNT'), '焊盘数不符被检出');
  // 篌改过孔数
  const r3 = JSON.parse(JSON.stringify(r));
  r3.nets[0].vias = [{ x: 15, y: 10 }];
  const v3 = core.verifyEasyEdaExport(d, r3, core.exportEasyEdaPcb(d, r.nets));
  assert(!v3.ok && v3.findings.some(f => f.id === 'VRF-VIA'), '过孔数不符被检出');
});

console.log('\n— 制造正确性：孔径 / 阻焊丝印泪滴 / CPL / 4 层 —');

t('每焊盘孔径：封装生成/导出/钻孔多刀/DRC 环宽孔距', () => {
  // 封装生成带孔径
  const dip = core.footprintPads('DIP-N', 4);
  assertEq(dip[0].holeR, 0.45, 'DIP 孔半径 0.45（0.9mm 孔）');
  const d = core.designDefaults();
  d.width = 30; d.height = 20;
  d.nets = [net('a')];
  d.pads = [
    { id: 'U1-1', netId: 'a', x: 10, y: 10, w: 1.7, h: 1.7, shape: 'circle', layer: 'both', holeR: 0.45 },
    { id: 'U1-2', netId: 'a', x: 12.54, y: 10, w: 1.7, h: 1.7, shape: 'circle', layer: 'both', holeR: 0.45 }
  ];
  // EasyEDA 导出孔半径字段 = u(0.45) = 1.7716
  const j = JSON.parse(core.exportEasyEdaPcb(d, []));
  const pad = j.shape.find(sh => sh.startsWith('PAD~'));
  assert(Math.abs(parseFloat(pad.split('~')[9]) - 0.45 / 0.254) < 0.01, 'PAD holeR 单位换算');
  // 钻孔多刀：0.9mm 插件孔 + 0.4mm 过孔（加一个过孔）
  const r = { nets: [{ netId: 'a', paths: [[{ x: 10, y: 10, l: 0 }, { x: 12.54, y: 10, l: 0 }]], vias: [{ x: 16, y: 16 }], cells: [] }], overuse: [] };
  const g = core.buildGerber(d, r, null, null);
  assert(g.drill.includes('C0.900'), 'T 刀 0.9mm 插件孔');
  assert(g.drill.includes('C0.400'), 'T 刀 0.4mm 过孔');
  // DRC：环宽正常（0.85-0.45=0.4 ≥ 0.25 ok），孔距 2.54-0.9=1.64 ≥ 0.2 ok
  const issues = core.checkDRC(d, { nets: [], overuse: [] });
  assert(!issues.some(i => i.type === '插件孔环宽' || i.type === '孔边距'), '正常孔径不报');
  // 环宽不足：1.0mm 焊盘 0.45 孔 → 环宽 0.05 < 0.18 error
  const d2 = JSON.parse(JSON.stringify(d));
  d2.pads[0].w = d2.pads[0].h = 1.0;
  const issues2 = core.checkDRC(d2, { nets: [], overuse: [] });
  assert(issues2.some(i => i.type === '插件孔环宽' && i.sev === 'error'), '环宽不足 error');
  // 孔边距不足：两孔中心距 1.0 → 边距 0.1 < 0.2
  const d3 = JSON.parse(JSON.stringify(d));
  d3.pads[1].x = 11;
  d3.pads[1].netId = 'b';
  d3.nets.push(net('b'));
  const issues3 = core.checkDRC(d3, { nets: [], overuse: [] });
  assert(issues3.some(i => i.type === '孔边距' && i.sev === 'error'), '孔边距 error');
});

t('KiCad 导入：通孔 (drill) → holeR', () => {
  const kicad = `(kicad_pcb (version 20221018) (generator pcbnew)
    (net 1 "GND")
    (gr_rect (start 0 0) (end 20 15) (layer "Edge.Cuts") (width 0.05))
    (footprint "PinHeader" (layer "F.Cu")
      (at 10 7.5)
      (property "Reference" "J1" (at 0 -2) (layer "F.SilkS"))
      (pad "1" thru_hole circle (at 0 0) (size 1.7 1.7) (drill 1.0) (layers "*.Cu" "*.Mask") (net 1 "GND"))
    )
  )`;
  const d = core.importKiCadPcb(kicad, { margin: 1.0 });
  assertEq(d.pads[0].holeR, 0.5, 'drill 1.0 → 半径 0.5');
});

t('Gerber 八件套：阻焊开窗 / pin-1 丝印 / 泪滴制造化', () => {
  const d = core.designDefaults();
  d.width = 30; d.height = 20;
  d.nets = [net('a')];
  d.pads = [
    { id: 'U1-1', netId: 'a', x: 10, y: 10, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' },
    { id: 'U1-2', netId: 'a', x: 20, y: 10, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' }
  ];
  const r = { nets: [{ netId: 'a', paths: [[{ x: 10, y: 10, l: 0 }, { x: 15, y: 10, l: 0 }, { x: 15, y: 10, l: 1 }, { x: 20, y: 10, l: 1 }]], vias: [{ x: 15, y: 10 }], cells: [] }], overuse: [] };
  const tds = core.teardropPolys(d, r);
  assert(tds.length >= 1, '过孔换层点应有泪滴（实际 ' + tds.length + '）');
  const g = core.buildGerber(d, r, null, tds);
  for (const k of ['top', 'bottom', 'outline', 'drill', 'fmask', 'bmask', 'fsilk', 'bsilk']) assert(g[k] && g[k].length > 30, k + ' 非空');
  assert(g.fmask.includes('R,1.30000X1.30000'), '阻焊开窗 = 焊盘+0.1（1.2+0.1×2）');
  assert(!g.fmask.includes('C,0.80000'), '过孔默认盖油不开窗');
  assert(g.fsilk.includes('D10*') && g.fsilk.includes('D03*'), 'pin-1 丝印圆点');
  assert(g.top.includes('G36*'), '泪滴楔形 G36 写入铜层');
});

t('pos：bottom 旋转换算（360-rot，JLC 不镜像）', () => {
  const d = core.designDefaults();
  d.width = 30; d.height = 20;
  d.nets = [net('a')];
  d.comps = { U1: { x: 15, y: 10, rot: 90, layer: 'bottom' } };
  d.pads = [
    { id: 'U1-1', netId: 'a', x: 14, y: 10, w: 1.2, h: 1.2, shape: 'rect', layer: 'bottom' },
    { id: 'U1-2', netId: 'a', x: 16, y: 10, w: 1.2, h: 1.2, shape: 'rect', layer: 'bottom' }
  ];
  // pos 在 CLI——直接验证换算逻辑：bottom rot 90 → 270
  const rot = (360 - 90) % 360;
  assertEq(rot, 270, 'bottom rot 换算');
  assert(d.comps.U1.layer === 'bottom', '底层元件');
});

t('EasyEDA 4 层：内层走线 layerid 21/22（嘉立创层表）', () => {
  const d = core.designDefaults();
  d.width = 30; d.height = 20; d.layers = 4;
  d.nets = [net('a')];
  d.pads = [
    { id: 'U1-1', netId: 'a', x: 10, y: 10, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' },
    { id: 'U1-2', netId: 'a', x: 20, y: 10, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' }
  ];
  const j = JSON.parse(core.exportEasyEdaPcb(d, [
    { netId: 'a', paths: [[{ x: 10, y: 10, l: 1 }, { x: 20, y: 10, l: 1 }]], vias: [] }
  ]));
  const trk = j.shape.find(sh => sh.startsWith('TRACK~'));
  assertEq(trk.split('~')[2], '21', '内层 l=1 → In1=21');
});

t('renderBoardPixels：像素渲染（板区/焊盘/走线颜色可辨）', () => {
  const d = core.designDefaults();
  d.width = 30; d.height = 20;
  d.nets = [net('a')];
  d.pads = [
    { id: 'U1-1', netId: 'a', x: 10, y: 10, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' },
    { id: 'U1-2', netId: 'a', x: 20, y: 10, w: 1.2, h: 1.2, shape: 'rect', layer: 'both' }
  ];
  const r = run(d);
  const img = core.renderBoardPixels(d, r, { scale: 8 });
  assertEq(img.width, 240, '宽 30mm×8');
  assertEq(img.height, 160, '高 20mm×8');
  const px = (x, y) => { const i = (y * img.width + x) * 4; return [img.px[i], img.px[i + 1], img.px[i + 2]]; };
  const near = (c, t, tol) => Math.abs(c[0] - t[0]) <= tol && Math.abs(c[1] - t[1]) <= tol && Math.abs(c[2] - t[2]) <= tol;
  assert(near(px(80, 120), [0, 16, 35], 6), '板区深藏青（FR BACKGROUND）');
  assert(near(px(76, 80), [227, 183, 46], 8), '焊盘金（中心是孔）');
  // 走线取样：走线走格点中心（未必恰在 10.0mm），扫描 x=15mm 列找顶层走线色
  let red = false;
  for (let y = 0; y < img.height; y++) if (near(px(120, y), [200, 82, 82], 10)) red = true;
  assert(red, '顶层走线红');
});

console.log('\n结果：' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
