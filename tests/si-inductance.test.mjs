import assert from 'node:assert/strict';
import test from 'node:test';
import * as core from '../src/engine.mjs';

// SI 电感/参数套件锚点测试（2026-11-15 外围收口轮补缺口——此前 tests/ 下零引用，
// 数值正确性完全没锁）。口径：每个锚点 = 文档公式 + 独立手算值，非引擎复算；
// 出处注释与 engine.mjs 内函数头注释一致（黑魔书 ch7 / Bogatin ch13）。

const near=(got,want,tol,msg)=>assert.ok(Math.abs(got-want)<=tol,`${msg}: got ${got}, want ${want}±${tol}`);

test('copperThickUm 成品铜厚表（1oz≈35µm，线性 17.5/oz）',()=>{
  assert.equal(core.copperThickUm('0.5'),17.5);
  assert.equal(core.copperThickUm('1'),35);
  assert.equal(core.copperThickUm('1.5'),52.5);
  assert.equal(core.copperThickUm('2'),70);
  assert.equal(core.copperThickUm('4'),140);
  assert.equal(core.copperThickUm('9'),35,'未知铜厚回退 1oz');
  assert.equal(core.copperThickUm(1),35,'数字键按字符串口径');
});

test('viaLoopInductanceNanohenry 黑魔书式 7.9 口径：0.3mm 孔 1.6mm 板 ≈1.3nH',()=>{
  // 手算：h=1.6/25.4 in，d=0.3/25.4 in；4h/d=6.4/0.3=21.3333（尺度不变量），
  // ln(21.3333)=3.06025；L=5.08×0.062992×(3.06025+1)=1.29929 nH
  near(core.viaLoopInductanceNanohenry(1.6,0.3),1.2993,0.0005,'via 1.6/0.3');
  // h/d 减半后 ln 项 -ln2，L 随 h 线性缩放的组合：h=2.0,d=0.2 → 4h/d=40，ln=3.6889
  // L=5.08×(2.0/25.4)×4.6889=1.87562
  near(core.viaLoopInductanceNanohenry(2.0,0.2),1.8756,0.0005,'via 2.0/0.2');
  assert.ok(Number.isNaN(core.viaLoopInductanceNanohenry(0.3,0.3)),'d≥h 无效');
  assert.ok(Number.isNaN(core.viaLoopInductanceNanohenry(1.6,0)),'d=0 无效');
  assert.ok(Number.isNaN(core.viaLoopInductanceNanohenry(0,0.3)),'h=0 无效');
});

test('Bogatin ch13 pH 解析式族：锚点=公式手算值',()=>{
  // 走线回路：L=32·h·Len/w = 32×4×1000/8 = 16000 pH = 16 nH
  assert.equal(core.traceLoopInductancePh(4,1000,8),16000);
  assert.equal(core.planeSquareLoopInductancePh(4),128,'平面对 32pH/mil×4mil');
  // 过孔对：L=10.16·Len·ln(2s/d)=10.16×63×ln(100/12)=10.16×63×2.120264=1357.14 pH
  near(core.viaPairLoopInductancePh(63,50,12),1357.14,0.05,'viaPair');
  // 径向扩散：L=5.14·h·ln(b/a)=5.14×4×ln(4)=20.56×1.386294=28.502 pH
  near(core.radialSpreadingInductancePh(4,13,52),28.502,0.01,'radial');
  // 两孔间扩散：L=21·h·ln(B/D)=84×ln(10)=84×2.302585=193.417 pH
  near(core.betweenViasSpreadingInductancePh(4,100,10),193.417,0.05,'between');
  // 物理可行性守卫：几何倒置一律 NaN（不是 0 也不是负值——静默错误比崩溃更危险）
  assert.ok(Number.isNaN(core.traceLoopInductancePh(0,1000,8)));
  assert.ok(Number.isNaN(core.viaPairLoopInductancePh(63,5,12)),'2s≤d 无效');
  assert.ok(Number.isNaN(core.radialSpreadingInductancePh(4,52,13)),'b≤a 无效');
  assert.ok(Number.isNaN(core.betweenViasSpreadingInductancePh(4,10,100)),'B≤D 无效');
  assert.ok(Number.isNaN(core.planeSquareLoopInductancePh(0)));
});

test('jlcTrackRule 嘉立创线宽极限表（2/4 层 × 铜厚矩阵）',()=>{
  assert.deepEqual(core.jlcTrackRule({layers:2,copperWeight:'1'}),{limit:0.10,suggest:0.15});
  assert.deepEqual(core.jlcTrackRule({layers:4,copperWeight:'1'}),{limit:0.09,suggest:0.15},'多层 1oz 收紧到 0.09');
  assert.deepEqual(core.jlcTrackRule({layers:2,copperWeight:'2'}),{limit:0.16,suggest:0.20});
  assert.deepEqual(core.jlcTrackRule({layers:4,copperWeight:'2'}),{limit:0.15,suggest:0.20},'多层 2oz 收紧到 0.15');
  assert.deepEqual(core.jlcTrackRule({layers:4,copperWeight:'1.5'}),{limit:0.13,suggest:0.15},'1.5oz 仅有多层值，4 层取 multi');
  assert.deepEqual(core.jlcTrackRule({layers:4}),{limit:0.09,suggest:0.15},'缺省 copperWeight=1oz');
  assert.deepEqual(core.jlcTrackRule({layers:2,copperWeight:'9'}),{limit:0.10,suggest:0.15},'未知铜厚回退 1oz');
  // 已知缺口如实锁定（勿当 bug 误报，也不要在此"修绿"）：
  // JLC.trackLimit 表 1.5oz/2.5oz+ 无 single 值 → 单面板（或 2.5oz+ 的 4 层）limit 字段缺失，
  // spec 的"线宽低于工艺极限"检查对这类组合静默跳过（ai/pcb.mjs:183 `trackW<undefined`=false）。
  // 修复属引擎侧（补表或回退口径），待外部轮收口后随引擎轮落地；届时本断言应反转为 limit 存在。
  const r15=core.jlcTrackRule({layers:2,copperWeight:'1.5'});
  assert.equal(r15.limit,undefined,'1.5oz 单面板 limit 缺失——已知缺口，修复时反转本断言');
});
