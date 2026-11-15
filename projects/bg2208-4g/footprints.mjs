// BG2208-4G 封装库构建：EasyEDA docType4 真封装转换 + datasheet 自建封装
// 单位约定：mm；层 0=正面(top) 1=背面(bottom)；pad shape: rect/circle/oval
import { readFileSync } from 'node:fs';

const U = 0.254;                       // EasyEDA 10mil/unit
const M = v => +(v * U).toFixed(4);    // unit -> mm

// ---- EasyEDA docType4 封装转换（device JSON → {name, pads:[...]}，bbox 居中归零）----
export function eeFootprint(devJson, name) {
  const fp = devJson.content.footprintDoc;
  const shapes = fp.shape;
  const canvas = fp.canvas || '1000~1000~1.5~0';
  // bbox 归零中心：先收集全部 PAD 坐标
  const raw = [];
  for (const str of shapes) {
    const t = str.split('~');
    if (t[0] !== 'PAD') continue;
    const shape = t[1];
    const x = M(+t[2]), y = M(+t[3]);
    let w = M(+t[4]), h = M(+t[5]);
    const layer = +t[6];               // 1=top 2=bottom 11=multilayer(通孔)
    const num = t[8];
    // EasyEDA PAD 字段序：[10]=轮廓点 [11]=旋转度数（此前误读 [10] 为 rot——
    // 导致全部 rot=90 焊盘未做宽高互换，模块铸 Election 边列焊盘横竖颠倒）
    const pts = t[10] && t[10].includes(' ') ? t[10].split(' ').map(p => p.split(',').map(v => M(+v))) : null;
    const rot = +(t[11] || 0);
    raw.push({ shape, x, y, w, h, layer, num, pts, rot, hole: 0 });   // 库内均为 SMD，孔在自建封装处理
  }
  if (!raw.length) throw new Error(name + ': 无 PAD');
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const p of raw) {
    const hw = p.shape === 'CIRCLE' ? p.w / 2 : p.w / 2, hh = p.shape === 'CIRCLE' ? p.w / 2 : p.h / 2;
    x0 = Math.min(x0, p.x - hw); x1 = Math.max(x1, p.x + hw);
    y0 = Math.min(y0, p.y - hh); y1 = Math.max(y1, p.y + hh);
  }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const pads = raw.map(p => {
    let w = p.w, h = p.h;
    if (p.rot === 90 || p.rot === 270) { const t2 = w; w = h; h = t2; }   // 旋转的宽高互换
    const pl = (p.layer === 2) ? 1 : (p.layer === 11 ? 'both' : 0);
    return {
      num: p.num,
      x: +(p.x - cx).toFixed(3), y: +(p.y - cy).toFixed(3),
      w: +w.toFixed(3), h: +h.toFixed(3),
      shape: p.shape === 'CIRCLE' ? 'circle' : (p.pts ? 'rect' : (p.shape === 'OVAL' ? 'oval' : 'rect')),
      layer: pl,
      holeR: p.hole > 0.05 ? p.hole : 0
    };
  });
  return { name, pads, w: +(x1 - x0).toFixed(3), h: +(y1 - y0).toFixed(3) };
}

// ---- 自建封装工厂（全部 mm，datasheet/IPC-7351 nominal）----
export const manual = {};

// 0603（IPC-7351 nominal：pad 0.85×0.9 @ ±0.875）
manual['R0603'] = () => fp2('R0603', 0.85, 0.9, 1.75, 'rect', 0);
manual['C0603'] = () => fp2('C0603', 0.85, 0.9, 1.75, 'rect', 0);
manual['LED0603'] = () => fp2('LED0603', 0.85, 0.9, 1.75, 'rect', 0);
// 0805（220Ω / 自恢复 1812 另做）
manual['R0805'] = () => fp2('R0805', 1.05, 1.2, 2.6, 'rect', 0);
// 1206（MP2451 Cin 10µF/50V）
manual['C1206'] = () => fp2('C1206', 1.2, 1.5, 3.1, 'rect', 0);
// 1812 自恢复保险
manual['F1812'] = () => fp2('F1812', 2.0, 1.6, 4.4, 'rect', 0);
// 钽电容 D7343（220µF/6.3V B3528? 220µF 钽通常是 D 型 7.3×4.3）——KEMET T495D227K006ATE250: 7.3×4.3
manual['TANT-D'] = () => fp2('TANT-D', 2.4, 2.4, 5.4, 'rect', 0);   // 极性：1=阳(+) 2=阴(见 build 端标注)
// 电解/聚合物 6.3×7.7（LM2596 Cin/Cout 220µF）snap-in 不行——用 SMD 聚合物 SVPC 系列 6.3×7.7
manual['CAP-SVP6'] = () => ({
  name: 'CAP-SVP6', w: 6.8, h: 6.8, pads: [
    { num: '1', x: -2.5, y: 0, w: 2.6, h: 3.0, shape: 'rect', layer: 0, holeR: 0 },
    { num: '2', x: 2.5, y: 0, w: 2.6, h: 3.0, shape: 'rect', layer: 0, holeR: 0 }
  ]
});
// 功率电感 CD75/SPS 8×8（33µH LM2596）
manual['IND-8x8'] = () => ({
  name: 'IND-8x8', w: 8.8, h: 8.8, pads: [
    { num: '1', x: -3.4, y: 0, w: 2.6, h: 3.4, shape: 'rect', layer: 0, holeR: 0 },
    { num: '2', x: 3.4, y: 0, w: 2.6, h: 3.4, shape: 'rect', layer: 0, holeR: 0 }
  ]
});
// 功率电感 6.8µH CD54/SPS 5×5（MP2451）
manual['IND-5x5'] = () => ({
  name: 'IND-5x5', w: 5.8, h: 5.8, pads: [
    { num: '1', x: -2.15, y: 0, w: 2.2, h: 2.8, shape: 'rect', layer: 0, holeR: 0 },
    { num: '2', x: 2.15, y: 0, w: 2.2, h: 2.8, shape: 'rect', layer: 0, holeR: 0 }
  ]
});
// 直插电解 470µF/50V（8×10mm，脚距 3.5mm）—— LM2596 Cin
manual['CAP-RAD'] = () => ({
  name: 'CAP-RAD', w: 8, h: 9, pads: [
    { num: '1', x: -1.75, y: 0, w: 2.4, h: 2.4, shape: 'circle', layer: 'both', holeR: 0.5 },
    { num: '2', x: 1.75, y: 0, w: 2.4, h: 2.4, shape: 'circle', layer: 'both', holeR: 0.5 }
  ]
});
// SOD-123（1N5819W）
manual['SOD123'] = () => fp2('SOD123', 1.2, 1.15, 3.2, 'rect', 0);
// SMA（SS14/SS54）
manual['SMA'] = () => fp2('SMA', 2.1, 1.7, 4.7, 'rect', 0);
// SOT-23（S8050/S8550）：1=B 2=E 3=C
manual['SOT23'] = () => ({
  name: 'SOT23', w: 3.0, h: 2.9, pads: [
    { num: '1', x: -0.95, y: 1.1, w: 0.7, h: 1.25, shape: 'rect', layer: 0, holeR: 0 },
    { num: '2', x: 0, y: 1.1, w: 0.7, h: 1.25, shape: 'rect', layer: 0, holeR: 0 },
    { num: '3', x: 0.95, y: 1.1, w: 0.7, h: 1.25, shape: 'rect', layer: 0, holeR: 0 }
  ]
});
// SOT23-6（MP2451，datasheet 封装）
manual['SOT23-6'] = () => ({
  name: 'SOT23-6', w: 3.0, h: 3.0, pads: [
    { num: '1', x: -0.95, y: 1.15, w: 0.65, h: 1.25, shape: 'rect', layer: 0, holeR: 0 },
    { num: '2', x: 0, y: 1.15, w: 0.65, h: 1.25, shape: 'rect', layer: 0, holeR: 0 },
    { num: '3', x: 0.95, y: 1.15, w: 0.65, h: 1.25, shape: 'rect', layer: 0, holeR: 0 },
    { num: '4', x: 0.95, y: -1.15, w: 0.65, h: 1.25, shape: 'rect', layer: 0, holeR: 0 },
    { num: '5', x: 0, y: -1.15, w: 0.65, h: 1.25, shape: 'rect', layer: 0, holeR: 0 },
    { num: '6', x: -0.95, y: -1.15, w: 0.65, h: 1.25, shape: 'rect', layer: 0, holeR: 0 }
  ]
});
// SOT-89（78L05：1=IN 2=GND/tab 3=OUT）
manual['SOT89'] = () => ({
  name: 'SOT89', w: 4.6, h: 4.5, pads: [
    { num: '1', x: -1.55, y: 1.85, w: 0.75, h: 2.0, shape: 'rect', layer: 0, holeR: 0 },
    { num: '2', x: 0, y: 0.15, w: 1.5, h: 2.6, shape: 'rect', layer: 0, holeR: 0 },
    { num: '3', x: 1.55, y: 1.85, w: 0.75, h: 2.0, shape: 'rect', layer: 0, holeR: 0 }
  ]
});
// SSOP28 0.635 pitch（HC89F303C，datasheet 21.2 本体 9.8×3.8 跨距 6.15——与 TM1640 LCSC 封装同族）
// pad 0.55×1.35 @ pitch 0.635，跨排 ±2.45
manual['SSOP28'] = () => {
  // 0.635 pitch SSOP28（datasheet 21.2：本体 9.8×3.8，跨距 6.15）：左右列焊盘
  // 水平长轴 1.5×0.4（IPC-7351 nominal），pitch 0.635 相邻焊盘 y 向间隙 0.235 ✓
  const pads = [];
  for (let i = 0; i < 14; i++) {
    pads.push({ num: String(i + 1), x: -2.45, y: -4.1275 + i * 0.635, w: 1.5, h: 0.4, shape: 'rect', layer: 0, holeR: 0 });
  }
  for (let i = 0; i < 14; i++) {
    pads.push({ num: String(15 + i), x: 2.45, y: 4.1275 - i * 0.635, w: 1.5, h: 0.4, shape: 'rect', layer: 0, holeR: 0 });
  }
  return { name: 'SSOP28', w: 6.0, h: 9.8, pads };
};
// 8530 无源蜂鸣器 8.5×5.0
manual['BUZZ-8530'] = () => fp2('BUZZ-8530', 2.2, 1.6, 7.0, 'rect', 0);
// XHB2.54 立贴 12P（接线座，pad Ø1.6 通孔? XHB 立贴是插针座——直插式 pad 圆孔。布置说明"接线座子"→ 立贴插针
function xhbTop(n, pitch = 2.54, hole = 0.8, pad = 1.7) {
  const pads = [];
  const x0 = -(n - 1) * pitch / 2;
  for (let i = 0; i < n; i++) pads.push({ num: String(i + 1), x: +(x0 + i * pitch).toFixed(3), y: 0, w: pad, h: pad, shape: 'circle', layer: 'both', holeR: hole / 2 });
  return { name: 'XHB' + n, w: (n - 1) * pitch + pad + 1.2, h: pad + 1.6, pads };
}
manual['XHB12'] = () => xhbTop(12);
manual['XHB4'] = () => xhbTop(4);
manual['XHB2-2P'] = () => xhbTop(2, 2.5, 0.8, 1.7);   // XHB2.5*2P
manual['HDR3'] = () => xhbTop(3, 2.54, 0.8, 1.7);     // 2.54 排针 3P
// 触摸弹簧焊盘（Ø8 圆 + 定位）——通孔用于弹簧锡焊固定
manual['SPRING'] = () => ({
  name: 'SPRING', w: 9, h: 9, pads: [
    { num: '1', x: 0, y: 0, w: 8, h: 8, shape: 'circle', layer: 0, holeR: 0 }
  ]
});
// 测试点 Ø1.6
manual['TP'] = () => ({
  name: 'TP', w: 2.0, h: 2.0, pads: [{ num: '1', x: 0, y: 0, w: 1.6, h: 1.6, shape: 'circle', layer: 0, holeR: 0 }]
});
// IPEX 阴影：真封装来自 C88374（RF-SMD 3 pad）
// LM2596 TO-263-5：真封装 C963385（6 pads 含 tab）
// SIM-114：真封装 C266627（8 pads）
// RU3030M2：真封装 C180957（PDFN3333-8，9 pads 含 exposed）

function fp2(name, w, h, span, shape, holeR) {
  return {
    name, w: span + w, h: h + 0.6, pads: [
      { num: '1', x: -span / 2, y: 0, w, h, shape, layer: 0, holeR },
      { num: '2', x: span / 2, y: 0, w, h, shape, layer: 0, holeR }
    ]
  };
}

// ---- 从 device JSON 读取真封装的便捷入口 ----
export function devFootprint(path, name) {
  return eeFootprint(JSON.parse(readFileSync(path, 'utf8')), name);
}
