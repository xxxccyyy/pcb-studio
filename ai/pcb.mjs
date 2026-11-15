#!/usr/bin/env node
/* ============================================================
   PCB 设计工具 · AI 无头接口（零依赖，node ai/pcb.mjs <命令>）
   供 AI 代理程序化调用：全部输出 JSON 到 stdout，exit 0=成功。
   使用手册（工作流/决策规程/证据分级）：docs/AI-使用手册.md
   ============================================================
   命令：
     schema                          设计 JSON 字段说明 + 常见错误（负面文档）
     rules                           布线知识库（可靠/有条件/勿信 + DFM 锚点 + 书籍研读规则）
     spec   <design.json>            校验并摘要设计
     place  <design.json> [-o out]   自动布局（模拟退火，改写焊盘坐标）
     route  <design.json> [-o r.json] [--via-cost N] [--max-iter N]
                                     完整布线（协商 + 整板重跑候选 + 逐网优化 + 弦拉直）
                                     [--shape-patch [--shape-window mm] [--shape-nets a,b]]
                                     **形状补线（阶段三 #12）**：栅格之后对仍失败的网用
                                     **压缩坐标**（障碍边界 ± 间距构成非均匀坐标轴，通道宽度
                                     由真实几何决定而非栅格步长）重布——BGA/0.4mm 密集板的
                                     量化根因对策。只补失败网、字典序接受（绝不退步），
                                     默认关闭；输出附 shape{attempted/accepted/notes}
                                     [--blind-vias] 相邻层盲埋孔生成（0.13.18，opt-in）
                                     （旗标/选项名是 blindVias 不是 hdi；design 侧写 design.hdi.blindVias）
                                     [--fanout-first auto|inner|outer] 扇出优先（0.13.20）
                                     [--no-compact-pairs] 关差分对强制压实（0.13.27
                                     缺省开启：route 后把 partner 重构到设计间隙带）
                                     [--no-joint-reroute] 关多网联合重布（0.14.1 缺省开启：
                                     失败网+阻塞者子集枚举重排，全板 [-DRC,连通] 计分）
                                     [--no-obstacle-h] 关障碍感知启发式（0.14.10 缺省
                                     开启：组合一致场，五板 A/B 质量全面 ≥ 盲口径，
                                     fable/icebreaker 1.37-1.88× 提速，h2 DRC 39→12；
                                     回退=0.14.8 盲口径位级一致；
                                     docs/深度优化报告-20261116c.md）
     drc    <design.json> [result.json]      DRC + 嘉立创投板检查表
     advise <design.json> [result.json]      按优先级给出可执行建议（经验层）
     export <easyeda|gerber|dsn|ses|svg|ipc356> <design.json> [result.json] [-o out]
                                             （ses=Specctra SES 会话，KiCad ImportSpecctraSES 可直接回读——roadmap #7）
     import <easyeda|kicad|dsn> <file> [-o design.json]
                                             外部设计导入（roadmap #8/#7）：easyeda=嘉立创EDA
                                             标准 PCB JSON（docType 3，开源广场接力入口——
                                             TRACK→手动走线、VIA→换层 stub、COPPERAREA 不导入
                                             用 pour 重铺、报告含 skipped 计数）；kicad=.kicad_pcb
                                             （走线不导入）；dsn=Specctra DSN（KiCad/Freerouting
                                             导出的板级文件）
     device <C编号> [-o device.json]          从嘉立创库拉取真符号+真封装（LCSC API）
     schem  <design.json> [-o sch.json] [--devices dir]
                                             生成嘉立创EDA原理图（docType 1，优先用已缓存的
                                             嘉立创真符号；design.devices={U1:'C1591'} 提供映射）
     diffz  <design.json> [--pair 名] [--z 90]
                                             差分对奇偶模阻抗口径（roadmap #3）：给定叠层与
                                             线宽解 90Ω 对应间隙 S、奇/偶模阻抗、可达性
                                             （2 层板如实报告不可达）；nets[].diffZ 可覆写目标
     tune   <design.json> <result.json> [-o result2.json] [--pair 名] [--group 名]
                                             [--serp-gap 0=自动3W] [--tol 0.05] [--target mm] [--max-amp mm]
                                             等长蛇形生成（roadmap #2）：对 pair/lenGroup 组内
                                             短网沿线插入 90° 方波 bump 精确补长（目标=组内最长），
                                             节距边到边 ≥3W 自耦合口径，空间不足自动换段/换侧/部分吸收；
                                             [--target mm]=固定目标（Altium Length 规则）；[--max-amp]振幅上限
                                             （KiCad/Altium 同参数）；nets[].padToDie=封装内走线长度进等长口径
                                             （KiCad pad-to-die 同概念）；报告含自审计 audit（等长 DRC+平行动距）
                                             在 route 之后运行，之后勿再 beautify（会削弯补偿长度）
     pour   <design.json> <result.json> [-o design2.json] [--net GND] [--layer bottom]
                                             [--stitch-spacing 5] [--no-stitch]
                                             [--islands always|area|never] [--min-island-area 2]
                                             [--fill solid|grid] [--grid-w 0.254] [--grid-gap 0.254]
                                             [--clearance 0.2] [--edge-margin 0.2] [--min-width 0.25]
                                             多边形铺铜（computePour）+ 缝合孔写入 design.stitching，
                                             铜皮写入 result.pour（Gerber LPD/LPC + EasyEDA COPPERAREA）；
                                             同层异网重复调用自动互避（r.pours 历史铜皮，KiCad 优先级思想）；
                                             grid=网格铜（线宽/间距钳制 ≥0.254mm 嘉立创工艺口径）；
                                             islands area/never 保留大孤岛（DRC 提醒天线风险）；
                                             筋条全被截断的焊盘输出 unconnectedPads（DRC 报警）；
                                             --min-width 细颈消除（开运算，KiCad/Altium/EasyEDA 同概念，
                                             默认 0.25mm，窄于它的铜颈/酸角尖自动消除）；
                                             同网重铺自动与旧铜皮合并（KiCad 同网 zone 融合）
     bom    <design.json> [-o bom.csv] [--check]  BOM（嘉立创 SMT 四列）；--check 逐行验证 C 编号库存/封装
     pos    <design.json> [-o pos.csv]        贴片坐标（CPL：左下原点 y 向上）
     erc    <design.json>                     网表 ERC（findings：悬空/单脚/坏引用/重名/电源孤岛）
     autopcb <design.json> [-o out] [--result r.json] [--rounds 3] [--anchor U1,...]
                                             布通率驱动布局-布线循环（含元件自动旋转）
     part   <C编号>                            嘉立创/LCSC 器件详情（型号/封装/库存；关键词搜索已加密，仅 C 编号明文可用）
     verify <design.json> [result.json] [--export f.json]
                                             EasyEDA 导出回读自检（PAD/TRACK/TEXT/VIA/板框对账）
     deliver <design.json> [result.json] -o 交付目录 [--project 名] [--force]
                                             一键交付包（roadmap #9）：verify+DRC 双门禁 ->
                                             EasyEDA/Gerber 套件/IPC-356/SVG/BOM/贴片坐标/
                                             渲染 PNG/投板检查表 + manifest.json（每个交付物
                                             带 evidence 证据级；--force 覆盖门禁并如实留痕）
     render <design.json> [result.json] [-o out.png] [--scale 8]
                                             栅格化渲染 PNG（AI 视觉自检）
     render <design.json> [result.json] [-o out.png] [--scale 8]
                                             栅格化渲染 PNG（AI 视觉自检：红=顶层线/蓝=底层线/
                                             金=焊盘过孔/深绿=板区/浅绿=覆铜）
   ============================================================ */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';

import * as core from '../src/engine.mjs';
import { parseArguments } from '../src/cli-args.mjs';

const out = (v, code = 0) => { process.stdout.write(typeof v === 'string' ? v : JSON.stringify(v, null, 1) + '\n'); process.exit(code); };
const die = msg => out({ ok: false, error: msg }, 1);
let args, options, outPath;
const argFlag = (argv,name,dflt) => options.has(name)?options.get(name):dflt;
const loadJson = f => JSON.parse(readFileSync(f, 'utf8'));

/* ---------- 完整布线流程（与 UI 的 runRoute 等价）：协商 → 候选重跑 → 逐网优化 → 弦拉直 ---------- */
/* PNG 编码：RGBA → IHDR/IDAT(deflate)/IEND，零外部依赖（node:zlib） */
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function pngEncode(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;   // 8bit RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}

/* ---------- erc：网表级规则检查（kicad-happy findings 风格）----------
   severity: error(必须修)/warning(需判断)/info；confidence: deterministic/heuristic */
function erc(design){
  const F=[];
  const push=(severity,id,msg,evidence='deterministic')=>F.push({severity,id,msg,evidence});
  const pads=design.pads||[], nets=design.nets||[];
  const dangling=pads.filter(p=>p.netId==null);
  if(dangling.length)
    push('warning','ERC-DANGLING',`${dangling.length} 个焊盘未赋网络（悬空）：${dangling.slice(0,5).map(p=>p.id).join(',')}${dangling.length>5?' …':''}`,
      '安装孔/工艺焊盘属正常；信号焊盘悬空=断路');
  const padCount=new Map();
  for(const p of pads) if(p.netId!=null) padCount.set(p.netId,(padCount.get(p.netId)||0)+1);
  for(const n of nets){
    const c=padCount.get(n.id)||0;
    if(c===1) push('error','ERC-SINGLE-PIN',`网络 ${n.name} 只有 1 个焊盘——没有回路的孤端`,
      '补上它的对端（另一器件引脚/过孔/测试点），或删除该网络');
    else if(c===0) push('warning','ERC-EMPTY-NET',`网络 ${n.name} 没有任何焊盘`,'删除或补焊盘');
  }
  const netIds=new Set(nets.map(n=>n.id));
  for(const p of pads)
    if(p.netId!=null && !netIds.has(p.netId))
      push('error','ERC-BAD-REF',`焊盘 ${p.id} 引用不存在的 netId ${p.netId}`,'netId 必须来自 nets[].id');
  const seen=new Set();
  for(const p of pads){
    if(seen.has(p.id)) push('error','ERC-DUP-ID',`焊盘 id 重复：${p.id}`,'id 必须唯一（元件名-引脚号）');
    seen.add(p.id);
  }
  const byName=new Map();
  for(const n of nets) byName.set(n.name,(byName.get(n.name)||0)+1);
  for(const [nm,c] of byName) if(c>1)
    push('warning','ERC-DUP-NAME',`${c} 个网络同名 "${nm}"（id 不同）——易混淆，建议合并或改名`,'name 仅作显示，连接以 id 为准');
  const isPower=n=>/^(gnd|vcc|vdd|[+]?[35]v3?|[+]?5v|avcc|vbat)/i.test(n);
  for(const n of nets) if(isPower(n.name)){
    const partners=new Set();
    for(const p of pads) if(p.netId===n.id) for(const q of pads)
      if(q!==p && Math.hypot(q.x-p.x,q.y-p.y)<3 && q.netId!=null && q.netId!==n.id) partners.add(q.netId);
    if(partners.size===0 && (padCount.get(n.id)||0)>1)
      push('warning','ERC-PWR-ISOLATED',`电源网络 ${n.name} 周围无其它网络焊盘——可能孤岛化`,'检查布局','heuristic');
  }
  const compsMeta=design.comps||{};
  const groups=new Set(pads.map(p=>p.id.split('-')[0]));
  const missing=[...groups].filter(g=>!compsMeta[g]);
  if(missing.length)
    push('warning','ERC-COMP-META',`${missing.length} 个组件缺 comps 元数据（${missing.slice(0,5).join(',')}…）`,
      'BOM/坐标文件/丝印将按推导值降级；spec 生成时请填 design.comps','heuristic');
  const minGrid=core.minimumRoutingGrid(design);
  if(design.grid<minGrid-1e-9) push('error','ERC-GRID',`栅格 ${design.grid} < 最大线宽+间距 ${minGrid}`,'调整 grid');
  if(design.trackW<core.jlcTrackRule(design).limit)
    push('error','ERC-TRACK-LIMIT',`线宽 ${design.trackW} 低于 ${design.copperWeight||1}oz 工艺极限`,'见 rules 的 DFM 锚点');
  const limE=core.jlcTrackRule(design);
  for(const n of (design.nets||[])) if(n.w && n.w<limE.limit)
    push('error','ERC-NETW-LIMIT',`网络 ${n.name} 线宽 ${n.w} 低于工艺极限 ${limE.limit}`,'加宽或去掉该网 w');
  return { ok:true, findings:F,
    summary:{ errors:F.filter(f=>f.severity==='error').length,
      warnings:F.filter(f=>f.severity==='warning').length,
      components:groups.size, nets:nets.length, pads:pads.length } };
}
/* ---------- advise：经验层，按优先级输出可执行建议 ---------- */
function advise(design, result) {
  const recs = [];
  const push = (prio, id, msg, action, evidence = 'heuristic') => recs.push({ prio, id, msg, action, evidence });
  const tw = design.trackW;
  // 1. 栅格 ≥ 线宽+间距（硬前提）
  const minGrid = core.minimumRoutingGrid(design);
  if (design.grid < minGrid - 1e-9)
    push(0, 'GRID', `栅格 ${design.grid} < 最大线宽+间距 ${minGrid}，不同网络间距必然违规`,
      `把 grid 设为 ${minGrid}（route 会自动吸附焊盘）`, 'deterministic');
  // 2. 载流：电源类网络线宽
  const oz = String(design.copperWeight || '1');
  const anchor = core.JLC.amp.outer[oz] || core.JLC.amp.outer['1'];
  const isPower = n => /^(gnd|agnd|dgnd|vcc|vdd|v\+|v-|\+?[35]v3?|\+?5v|avcc|vbat|vsys|pwr|vin)/i.test(n);
  for (const n of design.nets) {
    const cnt = design.pads.filter(p => p.netId === n.id).length;
    const wN = n.w || design.trackW;
    if (isPower(n.name) && cnt >= 2 && wN < anchor.s)
      push(1, 'CURRENT', `电源网络 ${n.name} 线宽 ${wN}mm 低于 ${oz}oz 外层 1A 建议值 ${anchor.s}mm`,
        `为该网设置线宽：nets 里加 w:${anchor.s}（网络类，只影响此网），或全板加宽 trackW`, 'datasheet-backed');
  }
  // 3. 过孔工艺建议值
  if (design.viaDrill < core.JLC.viaSuggest.drill && design.viaDrill >= core.JLC.via.double.drill)
    push(2, 'VIA', `钻孔 ${design.viaDrill}mm 为极限值（≥${core.JLC.via.double.drill}），成本与良率差`,
      `建议 ${core.JLC.viaSuggest.drill}/${core.JLC.viaSuggest.outer}（极限 ${core.JLC.via.double.drill}/${core.JLC.via.double.outer}）`, 'datasheet-backed');
  // 4. 高速网络未标记 3W
  for (const n of design.nets)
    if (!n.hs && /(clk|crystal|xtal|osc|mipi|usb|diff|d\+|d-|_p$|_n$)/i.test(n.name) && design.pads.some(p => p.netId === n.id))
      push(2, '3W', `网络 ${n.name} 疑似高速/敏感信号但未标记⚡`, '标记后启用 3W 提醒检查', 'heuristic');
  // 5. 去耦配置（启发式：电容数 vs IC 数）
  const des = (design.pads || []).map(p => p.id.split('-')[0]);
  const caps = new Set(des.filter(x => /^c/i.test(x)));
  const ics = new Set(des.filter(x => /^(u|q)/i.test(x)));
  if (ics.size > 0 && caps.size < ics.size)
    push(1, 'DECUPLE', `IC/晶体管 ${ics.size} 个但电容仅 ${caps.size} 个——去耦不足`,
      '每个 IC 电源引脚旁配 100nF＋视需要 10µF；去耦电容的地端就近入地平面', 'heuristic');
  // 5.5 细间距三参数联动（第五轮 L1：halfClr=clearance+maxTrackW/2 封死逃逸）
  // 检测同元件相邻焊盘最小中心距；<0.8mm 且线宽/间距未联动 → 告警并给对照表
  {
    const byComp = new Map();
    for (const p of design.pads) {
      const c = p.id.split('-')[0];
      if (!byComp.has(c)) byComp.set(c, []);
      byComp.get(c).push(p);
    }
    let minPitch = Infinity, worstComp = null;
    for (const [c, ps] of byComp) {
      if (ps.length < 4) continue;   // 电阻/电容/2~3 脚器件不算细间距源
      for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
        const d = Math.hypot(ps[i].x - ps[j].x, ps[i].y - ps[j].y);
        if (d < minPitch) { minPitch = d; worstComp = c; }
      }
    }
    if (minPitch < 0.8 && (tw > 0.25 || design.clearance > 0.12)) {
      const row = minPitch < 0.6 ? 'grid 0.25 / 线 0.15 / 距 0.1 / 孔 0.5·0.25'
        : minPitch < 0.7 ? 'grid 0.325 / 线 0.2 / 距 0.1 / 孔 0.6·0.3'
        : 'grid 0.25 / 线 0.2 / 距 0.1 / 孔 0.6·0.3';
      push(0, 'FINEPITCH', `${worstComp} 最小引脚间距 ${minPitch.toFixed(2)}mm，但线宽 ${tw}/间距 ${design.clearance} 未联动——影响区 halfClr=${(design.clearance + Math.max(tw, ...(design.nets.map(n => n.w || 0))) / 2).toFixed(2)}mm 会封死引脚逃逸`,
        `按对照表设置：${row}（注意全板不得有任何网 w 超过该线宽）`, 'deterministic');
    }
  }
  // 5.6 阵列扇出容量（0.13.13，BGA-64 实测驱动）
  // 几何算术：外圈相邻球之间的"缝"是内圈球唯一的逃逸通道。
  //   缝宽 = 球距 − 球径；每条缝可穿 ⌊缝宽 / (线宽+间距)⌋ 条线
  //   内圈需要逃逸的网数 ≤ 总缝容量，否则物理上不可能全布通
  // 2 层板尤其危险：没有内层可借用（4 层实测同板 DRC 138→108）。
  {
    const byComp = new Map();
    for (const p of design.pads) {
      const c = p.id.split('-')[0];
      if (!byComp.has(c)) byComp.set(c, []);
      byComp.get(c).push(p);
    }
    for (const [comp, ps] of byComp) {
      if (ps.length < 16) continue;                    // 小封装不算阵列
      const xs = [...new Set(ps.map(p => +p.x.toFixed(3)))].sort((a, b) => a - b);
      const ys = [...new Set(ps.map(p => +p.y.toFixed(3)))].sort((a, b) => a - b);
      if (xs.length < 4 || ys.length < 4) continue;    // 需至少 4×4 阵列
      const pitchX = xs.length > 1 ? xs[1] - xs[0] : 0;
      const pitchY = ys.length > 1 ? ys[1] - ys[0] : 0;
      const pitch = Math.min(pitchX || Infinity, pitchY || Infinity);
      if (!Number.isFinite(pitch) || pitch <= 0) continue;
      const ballW = ps[0].shape === 'circle' ? ps[0].w : Math.min(ps[0].w, ps[0].h);
      const gap = pitch - ballW;                       // 球边到球边
      const need = tw + design.clearance;              // 一条线占的宽度
      const perGap = gap > 0 ? Math.floor(gap / need + 1e-9) : 0;
      // 外圈球数 ≈ 2*(nx+ny) − 4
      const nx = xs.length, ny = ys.length;
      const edgeBalls = 2 * (nx + ny) - 4;
      const capacity = edgeBalls * perGap;
      // 内圈需要逃逸的"独立网"数（外圈球之外的网各需一条通道）
      const edgeSet = new Set();
      const isEdge = p => Math.abs(p.x - xs[0]) < 1e-3 || Math.abs(p.x - xs[nx - 1]) < 1e-3 ||
                          Math.abs(p.y - ys[0]) < 1e-3 || Math.abs(p.y - ys[ny - 1]) < 1e-3;
      for (const p of ps) if (!isEdge(p) && p.netId != null) edgeSet.add(p.netId);
      const demand = edgeSet.size;
      if (perGap === 0) {
        push(0, 'FANOUT', `${comp} 阵列 ${nx}×${ny} 节距 ${pitch.toFixed(2)}mm 球径 ${ballW.toFixed(2)}mm：缝宽 ${gap.toFixed(2)}mm < 走线需求 ${need.toFixed(2)}mm——**物理上无法从缝中引出任何线**`,
          `减小线宽/间距（如 线 0.1/距 0.08 ⇒ 需求 0.18）或用盘中孔/盲埋孔扇出；否则该阵列只能靠内层平面连接；也可先试 route --fanout-first inner（内圈球先占逃逸缝）`, 'deterministic');
      } else if (demand > capacity) {
        // 真正容量不足：内圈独立网数超过外圈缝容量（几何上不可能全引出）
        push(0, 'FANOUT', `${comp} 阵列 ${nx}×${ny} 节距 ${pitch.toFixed(2)}mm：外圈 ${edgeBalls} 条缝 × 每缝 ${perGap} 条 = 容量 ${capacity}，但内圈有 ${demand} 个网需逃逸——**物理容量不足**`,
          `加层（内层可直接逃逸，实测 BGA-64 同板 2→4 层 DRC 138→108）或改用盘中孔/盲埋孔扇出，或先试 route --fanout-first inner；也可把电源/地并到平面减少内圈独立网数`, 'deterministic');
      } else if (design.layers < 4 && demand > capacity * 0.5) {
        // 容量够但占用过半：几何可行、分配难度高，2 层板协商易在此卡住
        push(2, 'FANOUT_TIGHT', `${comp} 阵列 ${nx}×${ny}：逃逸容量 ${capacity}，内圈需 ${demand} 个网（占用 ${Math.round(100 * demand / capacity)}%）——容量够但占用过半，${design.layers} 层板协商易在此停滞`,
          `可加层让内层分流（实测 BGA-64 2→4 层 DRC 138→108）、减小线宽/间距提高每缝容量，或先试 route --fanout-first inner（0.13.20 扇出优先）`, 'deterministic');
      }
    }
  }
  // 6. 结果相关
  if (result) {
    const fails = result.stats.total - result.stats.connected;
    if (fails > 0 && result.capacityStall)
      push(0, 'CAPACITY_STALL', `协商在 ${result.overuse.length} 个争夺格停滞（迭代耗尽仍有 ${fails} 个焊盘未连通）——容量上限的典型特征`,
        '跳过逐网修复，直接加层数（实测同板 2→4 层：57→77/77 全连通）或加大板幅/改布局；本判定来自迭代耗尽+高争夺+仍失败的签名', 'deterministic');
    else if (fails > 0)
      push(0, 'CONNECT', `有 ${fails} 个焊盘未连通`,
        '依次尝试：① 单独重布失败网络 ② 降低过孔代价重跑 ③ 检查焊盘是否被禁布区/其它焊盘堵死 ④ 增加层数', 'deterministic');
    for (const n of result.nets) if (n.connected < n.total)
      push(0, 'NETFAIL', `网络 ${n.name}：${n.total - n.connected}/${n.total} 未连通`,
        '检查该网焊盘间距是否过密、是否存在更短拓扑', 'deterministic');
    if (result.overuse.length)
      push(0, 'OVERUSE', `仍有 ${result.overuse.length} 处间距冲突`, '增加最大迭代轮数（协商未收敛），或加宽板/改布局', 'deterministic');
  }
  // 7. 地网络铺铜提醒
  const gnd = design.nets.find(n => /^gnd/i.test(n.name));
  if (gnd && design.pads.some(p => p.netId === gnd.id))
    push(2, 'POUR', '底层建议铺 GND 铜并打缝合孔（大铜皮必须缝合才算地）', '布线完成后启用覆铜 → 生成缝合孔', 'heuristic');
  // 8. 传输线判据（黑魔书 Fknee=0.5/Tr 与 1/6 判据）：标了 ⚡ 与 tr(ns) 的高速网，布线后核对临界长度
  for (const n of design.nets) {
    if (!n.hs || !n.tr) continue;
    const lc = core.criticalLineLen(n.tr * 1e-9, core.DIELECTRICS.fr4.er);
    const len = core.netRoutedLen(design, result, n.id);
    if (lc > 0 && len > lc)
      push(1, 'TERMINATE', `网络 ${n.name} 走线 ${len.toFixed(0)}mm 超过临界长度 ${lc.toFixed(0)}mm（Tr=${n.tr}ns 的 1/6 判据，FR-4；与 Bogatin 式8.13 同口径且更保守）`,
        '优先源端串联端接（R≈Z0−驱动内阻，点到点拓扑标准做法，无静态功耗）；或缩短走线/放慢边沿', 'book-backed');
  }
  // 8.5 高速网串扰并行扫描（Bogatin 附录B.70-89 量化依据）：并行贴行过长建议保护线
  if (result) {
    const scan = core.hsCrosstalkScan(design, result);
    for (const rr of scan.report) {
      const worst = rr.offenders[0];
      if (worst && worst.runMm > 20)
        push(1, 'GUARD', `高速网 ${rr.net} 与 ${worst.net} 同层并行约 ${worst.runMm}mm（最近中心距 ${worst.minDist}mm，<3W）——近端串扰随并行长度累积（微带 3W≈1~1.2%/2W≈2%）`,
          '拉开到 3W 以上；或在两线间插防护线（GND，Bogatin ch10：微带短路防护≈−84%、带状线宽防护≈−99%；浮空防护线会恶化串扰——必须两端+沿途接地，上升边空间延伸内 ≥3 孔）；或改邻层正交', 'book-backed');
    }
  }
  // 8.6 结果-设计同步检查（旧 result 配新 design = 幽灵分析）
  if (result) {
    const st = core.staleResultCheck(design, result);
    if (!st.ok)
      push(0, 'STALE', `结果与设计可能不同步：网络 ${st.staleNets.join(',')} 的路径完全没有接触当前焊盘——design 在布线后已被编辑`,
        '重新 place/route 生成新结果再分析，不要拿旧 result 配新 design', 'deterministic');
  }
  // 8.7 差分对 lite：疑似差分对未标记 pair（USB_D±/D+-/MIPI _p/_n 等命名特征成对出现）
  {
    const stem = s => s.toLowerCase()
      .replace(/[_\-\s]*(p|n|pos|neg|plus|minus)$/, '')
      .replace(/[+\-]+$/, '')
      .replace(/[_\-\s]+$/, '');
    const byStem = new Map();
    for (const n of design.nets) {
      if (n.pair) continue;
      const m = /^(.+?)[_\-\s]?(\+|-|p|n|pos|neg|plus|minus)$/.exec(n.name);
      if (!m || !m[1]) continue;
      const k = stem(m[1]) + '|' + (n.hs ? 'hs' : 'x');
      if (!k.split('|')[0]) continue;
      if (!byStem.has(k)) byStem.set(k, []);
      byStem.get(k).push(n.name);
    }
    for (const [k, names] of byStem) {
      if (names.length !== 2) continue;
      push(2, 'PAIR-DETECT', `网络 ${names[0]} 与 ${names[1]} 疑似差分对但未标记 pair`,
        'nets 里给两网加相同 pair:"组名"（启用等长检查与 3W 对内豁免；布线仍各自进行，成对贴近走线需布局保证）', 'heuristic');
      break;
    }
  }
  // 8.8 去耦位置检查（PEI p374-375 三要素 + Archambeault ch8）：每个 IC 的电源引脚就近要有去耦电容
  {
    const byComp = new Map();
    for (const p of design.pads) {
      const c = p.id.split('-')[0];
      if (!byComp.has(c)) byComp.set(c, []);
      byComp.get(c).push(p);
    }
    const isGND = name => /^(gnd|agnd|dgnd|pgnd)/i.test(name || '');
    for (const [c, ps] of byComp) {
      if (ps.length < 4 || !/^(u|q|ic)/i.test(c)) continue;          // 只看 IC 类
      let worst = null;
      for (const p of ps) {
        const net = design.nets.find(n => n.id === p.netId);
        if (!net || !(isPower(net.name) || isGND(net.name))) continue;
        let best = Infinity;
        for (const [c2, ps2] of byComp) {
          if (c2 === c || !/^c/i.test(c2)) continue;
          for (const q of ps2) {
            if (q.netId !== p.netId) continue;
            best = Math.min(best, Math.hypot(p.x - q.x, p.y - q.y));
          }
        }
        if (best > (worst ? worst.dist : 0) && isFinite(best)) worst = { pad: p.id, net: net.name, dist: best };
      }
      if (worst && worst.dist > 6)
        push(1, 'DECUPLE-POS', `${c} 的 ${worst.net} 引脚（${worst.pad}）距最近同网去耦电容 ${worst.dist.toFixed(1)}mm——去耦三要素中"位置"不达标`,
          '把该网的去耦电容移到 IC 电源/地引脚旁（≤6mm 量级，越近越好，安装电感第一）', 'book-backed');
    }
  }
  // 8.9 损耗预算（Bogatin ch9）：有 tr 的高速网，介质损+导线损并列，>3dB 提醒
  for (const n of design.nets) {
    if (!n.hs || !n.tr || !result) continue;
    const fGhz = core.fknee(n.tr * 1e-9) / 1e9;
    const lenIn = core.netRoutedLen(design, result, n.id) / 25.4;
    const wMil = core.netW(design, n.id) / 0.0254;
    const aD = core.dielectricLossDbPerIn(fGhz, core.DIELECTRICS.fr4.df, core.DIELECTRICS.fr4.er) * lenIn;
    const aC = 36 * Math.sqrt(fGhz) / (wMil * 50) * lenIn;   // 导线损（ch9 验算式，按 50Ω 口径）
    const loss = aD + aC;
    const rtDeg = lenIn * 11.7;                              // 上升边退化 ps（B.67：BW≈30GHz/in 的倒数折算）
    if (loss > 3)
      push(1, 'LOSS', `网络 ${n.name} 在 Fknee=${fGhz.toFixed(1)}GHz 下走线 ${lenIn.toFixed(1)}in：介质损 ${aD.toFixed(1)}dB + 导线损 ${aC.toFixed(1)}dB ≈ ${loss.toFixed(1)}dB，上升边退化 ≈${rtDeg.toFixed(0)}ps（FR-4 一阶口径）——超过 3dB 提醒线（奈奎斯特 10dB 即眼图闭合）`,
        '换低损耗板材（fr4-hi/Rogers，见 rules DIELECTRICS 注释）、缩短走线、加宽走线（降导线损）或加均衡', 'book-backed');
  }
  // 8.10 PDN 平面电容估算（Bogatin B.17/ch13）：四层板有内层平面对时
  if (result && (design.layers || 2) >= 4) {
    const tmm = 0.2;                                    // 常见四层内层介质≈0.2mm——估算口径，非实测
    const areaMm2 = design.width * design.height;
    const cap = core.pdnPlaneCapPf(areaMm2, tmm, core.DIELECTRICS.fr4.er);
    if (isFinite(cap))
      push(2, 'PDN-EST', `四层板内层平面对电容估算 ≈${Math.round(cap)}pF（全板 ${areaMm2.toFixed(0)}mm²、介质按 ${tmm}mm 假设，C≈0.0885·εr·A/d）`,
        '该电容仅在数百 MHz 以上起作用；PDN 设计按目标阻抗走：Xmax=ΔV/ΔI → 体电容 C=I·Δt/ΔV → FDTIM 分档（rules 去耦_PDN）', 'book-backed');
  }
  // 9. IR-drop / 回流质量（确定性计算；电源/地网逐个评估）
  if (result) for (const n of design.nets) {
    if (!/^(gnd|vcc|vdd|v\+|v-|\+?[35]v3?|avcc|vbat|vsys|vin)/i.test(n.name)) continue;
    if (design.pads.filter(p => p.netId === n.id).length < 3) continue;
    const dr = core.powerDrop(design, result, n.id, { current: 1 });
    if (dr.ok && dr.maxDropV > 0.05)
      push(1, 'IRDROP', `网络 ${n.name} 1A 时最大压降 ${dr.maxDropV}V（焊盘 ${dr.worstPad}，等效电阻 ${dr.maxR}Ω）——供电/回流路径电阻过大`,
        '加宽该网线宽(nets[].w)、增加过孔/缝合孔并联、或把供电入口焊盘靠近负载', 'deterministic');
    else if (!dr.ok)
      push(2, 'IRDROP-HOW', `${n.name} 无法自动评估 IR-drop：${dr.reason}（该网焊盘如：${(dr.pads || []).join(',')}）`,
        'drop --entries 指定供电入口焊盘后评估；或先铺铜让平面过孔成为入口', 'deterministic');
  }
  return { ok: true, recommendations: recs };
}

/* ---------- deliver 公共片段（roadmap #9）：BOM/贴片坐标行生成，bom/pos/deliver 三处共用 ---------- */
function bomRowsOf(d) {
  const compsMeta = d.comps || {};
  const groups = new Map();
  for (const p of d.pads || []) {
    const g = p.id.split('-')[0];
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(p.id);
  }
  const rows = [];
  for (const [ref, ids] of groups) {
    const m = compsMeta[ref] || {};
    rows.push({ designator: ref, qty: ids.length,
      lcsc: m.lcsc || (d.devices || {})[ref] || '', value: m.value || '',
      footprint: m.footprint || '', layer: m.layer || (d.pads.find(p => p.id === ids[0]).layer) });
  }
  rows.sort((a, b) => a.designator.localeCompare(b.designator, undefined, { numeric: true }));
  return rows;
}
function bomCsvOf(rows) {
  return 'Comment,Designator,Footprint,LCSC Part #\n' +
    rows.map(r => `${r.value},${r.designator},${r.footprint},${r.lcsc}`).join('\n') + '\n';
}
function posRowsOf(d) {
  const compsMeta = d.comps || {};
  const groups = new Map();
  for (const p of d.pads || []) {
    const g = p.id.split('-')[0];
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(p);
  }
  const rows = [];
  for (const [ref, ps] of groups) {
    const m = compsMeta[ref] || {};
    let cx = m.x, cy = m.y;
    if (cx == null) {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const p of ps) { x0 = Math.min(x0, p.x - p.w / 2); y0 = Math.min(y0, p.y - p.h / 2); x1 = Math.max(x1, p.x + p.w / 2); y1 = Math.max(y1, p.y + p.h / 2); }
      cx = (x0 + x1) / 2; cy = (y0 + y1) / 2;
    }
    const side = m.layer || (ps.some(p => p.layer === 'bottom') && !ps.some(p => p.layer !== 'bottom') ? 'bottom' : 'top');
    const rot = side === 'bottom' ? (360 - (m.rot || 0)) % 360 : (m.rot || 0);
    rows.push({ designator: ref, midX: +cx.toFixed(3), midY: +(d.height - cy).toFixed(3),
      layer: side, rotation: rot });
  }
  rows.sort((a, b) => a.designator.localeCompare(b.designator, undefined, { numeric: true }));
  return rows;
}
function posCsvOf(rows) {
  return 'Designator,Mid X,Mid Y,Layer,Rotation\n' +
    rows.map(r => `${r.designator},${r.midX},${r.midY},${r.layer},${r.rotation}`).join('\n') + '\n';
}

/* ---------- 命令分发 ---------- */
const [, , cmd, ...rest] = process.argv;
const loadDesign = f => {
  const j = loadJson(f);
  return core.normalizeDesign(j?.design ?? j);   // 兼容工程文件 {design,...} 与纯 design
};
const loadResult = (f,d) => {
  const j=f?loadJson(f):{nets:[],overuse:[]};
  const result=core.normalizeResult(j.result||j,d);
  return {...result,nets:[...result.nets.filter(n=>!n.manual),...core.manualRouteEntries(d)]};
};

async function main(){
  ({args,options}=parseArguments(cmd,rest));
  outPath=options.get('-o');
switch (cmd) {
  case 'currents': {
    // 载流感知线宽定档（规格书 → 线宽）：读取 nets[].current 声明（A, RMS），
    // 逐网报告 声明值/当前线宽/所需线宽（s 建议 + t 极限含公差）/所需过孔数/判定。
    // --apply：把 nets[].w 抬到 required（仅抬不降——显式手宽不受罚），并回写 -o。
    // 输出附带 maxTrackW 全板后果（L37）：新 minimumRoutingGrid 与细节距冲突预警。
    const d = loadDesign(args[0]);
    const apply = rest.includes('--apply');   // 裸旗标（无值）
    const decls = core.netCurrentDecls(d);
    const rows = [];
    let under = 0;
    for (const r of decls) {
      const okLimit = r.w + 1e-9 >= r.requiredLimit;
      const okReq = r.w + 1e-9 >= r.required;
      if (!okReq) under++;
      rows.push({ net: r.name, current: r.current, width: r.w, required: r.required,
        limit: r.requiredLimit, vias: r.vias,
        status: okReq ? 'ok' : (okLimit ? 'warn（低于建议但高于 −20% 公差极限）' : 'under（低于 −20% 公差极限——载流不足）') });
    }
    const maxTrack = core.maxTrackW(d);
    const newGrid = Math.max(d.grid, core.minimumRoutingGrid(d));
    let appliedN = 0;
    if (apply) {
      for (const r of decls) {
        const net = d.nets.find(x => x.id === r.netId);
        if (net && (net.w == null || net.w < r.required - 1e-9)) { net.w = r.required; appliedN++; }
      }
      // 声明网抬宽后重算 maxTrackW 并同步最小栅格（L37：所见即所得）
      d.grid = Math.max(d.grid, core.minimumRoutingGrid(d));
      const outP = outPath || args[0];
      writeFileSync(outP, JSON.stringify(d, null, 1));
    }
    const maxTrack2 = core.maxTrackW(d);
    out({ ok: true, declared: rows.length, under, rows, applied: apply ? appliedN : null,
      written: (apply && outPath) || (apply ? args[0] : null),
      maxTrackW: +maxTrack2.toFixed(3),
      minimumRoutingGrid: +core.minimumRoutingGrid(d).toFixed(3),
      pitchWarning: core.minimumRoutingGrid(d) > d.grid ? 'L37：线宽加大 → 栅格/影响区变粗——全板节距需 ≥ 2×(padR + maxTrackW/2 + clearance)，细间距焊盘可能被影响区封死，见手册 L37' : null });
    break;
  }
  case 'thermal': {
    // 散热盘过孔阵列（批次 2）：thermal <design> <compId> [--pitch 1] [--cols N] [--rows M] [--apply]
    // 找该元件面积最大焊盘（散热盘）生成 0.3mm 过孔阵（缺省按焊盘尺寸自适应、3×3 起），
    // 写入 design.stitching（固定孔/路由避让/DRC/Gerber/IPC-356 全链复用缝合孔通道）。
    // --apply 回写 -o（或原地）。行载流口径：0.3mm 孔 1A/孔（JLC.viaAmp）。
    if (!args[0] || !args[1]) throw new Error('用法：thermal <design> <compId> [--pitch 1] [--cols 3] [--rows 3] [--apply]');
    const d = loadDesign(args[0]);
    const apply = rest.includes('--apply');
    const opts = {};
    if (options.has('--pitch')) opts.pitch = parseFloat(options.get('--pitch'));
    if (options.has('--cols')) opts.cols = parseInt(options.get('--cols'), 10);
    if (options.has('--rows')) opts.rows = parseInt(options.get('--rows'), 10);
    const arr = core.thermalViaArray(d, args[1], opts);
    const netName = (d.nets || []).find(n => n.id === arr.netId);
    let written = null;
    if (apply) {
      d.stitching = [...(d.stitching || []), ...arr.vias];
      // 孔数变化可能改变固定孔表 → 重算最小栅格（L37 所见即所得口径与 currents 一致）
      d.grid = Math.max(d.grid, core.minimumRoutingGrid(d));
      const outP = outPath || args[0];
      writeFileSync(outP, JSON.stringify(d, null, 1));
      written = outP;
    }
    out({ ok: true, comp: arr.comp, pad: arr.pad, net: netName ? netName.name : arr.netId,
      drill: arr.drill, pitch: arr.pitch, cols: arr.cols, rows: arr.rows,
      added: arr.added, skipped: arr.skipped,
      perViaAmp: +core.viaAmpFor(d).toFixed(3), parallelAmp: +(arr.added * core.viaAmpFor(d)).toFixed(2),
      vias: arr.vias, applied: apply, written,
      note: arr.skipped > 0 ? (arr.skipped + ' 个位置越界/触孔被跳过（收进 viaOuter/2 + 孔边距滤除）') : null });
    break;
  }
  case 'schema': {
    out({
      ok: true,
      design: {
        width: '板宽 mm（坐标单位一律 mm，y 向下为正）',
        height: '板高 mm',
        grid: '栅格 mm；必须 ≥ trackW+clearance（否则 route 自动调大）',
        layers: '层数 1/2/4',
        trackW: '线宽 mm（按载流选，见 rules 的 CURRENT 锚点）',
        clearance: '间距 mm（≥ 嘉立创极限，见 rules 的 DFM）',
        viaOuter: '过孔外径 mm', viaDrill: '钻孔 mm',
        copperWeight: '铜厚 "1"|"2"|…', coating: '可选 "bare"（缺省，外层无涂层 IPC-2221B B4 最严）|"coated"（三防漆，外层 B2 档——170V 间距 1.27→0.64mm）', solderMask: '可选，mm：阻焊厚度——差分阻抗一阶修正（每 0.0254mm ≈ −2Ω，Bogatin B.43/44 口径），缺省 0 不修正',
        nets: [{ id: '网络 id（引用用 id 不是名字）', name: '显示名', hs: '可选 true=高速（启用 3W 检查）', w: '可选，每网线宽 mm（网络类：电源 0.5/信号默认）', tr: '可选，上升时间 ns（10%~90%）：高速网配合 hs 启用传输线 1/6 临界长度判据（端接提醒）', pair: '可选，差分对组名：同组两网启用等长检查（ΔL≤0.2×UI）与 3W 对内豁免（差分对 lite）', lenGroup: '可选，等长组名：组内各网与最长网做等长（tune 命令自动蛇形补长，DRC 同口径评差）', diffZ: '可选，差分对目标差分阻抗 Ω（默认 90）——奇偶模口径解耦合间隙（diffz 命令查看），耦合走廊与耦合度 DRC 按此工作', voltage: '可选，V：该网工作电压 → IPC-2221B 表 6-1 查最低安全间距（B4 外层无涂层口径，max(全局,标准) 自动生效——per-pad 影响区/布线/DRC/检查表全链）', pairGap: '可选，mm：差分对内边到边间隙显式覆写（用叠层工具算得的值；须 ≥ clearance）——优先于 diffZ 反查', clr: '可选，mm：该网安全间距（一般经 rules.classes[].clr + netClass 展开）——netClr 三来源之一，影响区/DRC/检查表全链', preferredLayer: '可选，"top"|"bottom"|层号：硬层位约束（探针级 0.14.7）——该网 A* 扩展限制在指定层；实测中等拥塞板有连通劣化风险（p05 仅 3 网→−6 连通 +3 DRC +61% 耗时，见批次5 探针报告），密板慎用', padToDie: '可选，mm：封装内走线长度（数据手册可查）——计入等长口径（KiCad pad-to-die 同概念）' }],
        pads: [{ id: '"U1-2" 前缀分组=同一封装；独立焊盘无 "-"', netId: 'nets[].id 或 null', x: 'mm', y: 'mm', w: 'mm', h: 'mm', shape: '"rect"|"circle"（circle 用 w 作直径）', layer: '"both"=通孔 | "top" | "bottom"' }],
        keepouts: [{ x: '中心 mm', y: '中心 mm', w: '宽 mm', h: '高 mm', scope: '（rules.keepouts 展开产物）class 名：仅阻挡异类网，本类网自由' }],
        rules: {
          classes: '{ 类名: { w?: 线宽 mm, tr?: 上升时间 ns } }',
          netClass: '{ 网名: 类名 }——归类；成员网的 w/tr 自动取 class 值（已有值且不一致=报错）',
          pairs: '[{ group: 组名, nets: [网A, 网B], z?: 目标差分阻抗 Ω, gap?: 显式耦合间隙 mm（边到边，≥clearance；优先于 z 反查） }]——展开为成员网 pair/diffZ/pairGap',
        classesClr: 'rules.classes.<类>.clr 可选 mm：类级安全间距——经 netClass 展开为成员网 nets[].clr，netClr 第三来源（影响区/DRC 逐对/检查表全链）',
          lengths: '[{ group: 组名, nets: [网名...] }]——展开为成员网 lenGroup（tune 按组补长）',
          keepouts: '[{ x,y,w,h | rects:[...] , class?: 类名 }]——class keepout：对异类网是障碍、本类网自由（路由/过孔/DRC/美化/布局全链同口径）；无 class=全局禁布'
        },
        manual: '手动走线（由 route/importSES 生成，一般不手填）',
        stitching: '缝合孔 [{x,y,netId}]'
      },
      常见错误: [
        '坐标单位是 mm，不是 mil 也不是 EasyEDA 的 10mil 单位',
        'pad.id 加 "-" 前缀（如 U1-1）才会被当作同一封装参与自动布局分组',
        'netId 引用 nets[].id 而非 name；name 可重复，id 不行',
        'grid ≥ 最大线宽 + clearance 是间距合规的硬前提（电源网加宽用 nets[].w）',
        '通孔焊盘 layer 必须是 "both"；表贴顶层 "top"、底层 "bottom"',
        'circle 焊盘只用 w（直径），h 被忽略',
        'keepouts 是 {x,y,w,h} 中心+宽高，不是角点',
        'rules.netClass 引用的网名/class 必须存在；netClass 与 nets[].w/tr 双写不一致=报错（冲突即错误，不静默取优先级）',
        'rules.pairs 的 nets 必须恰好 2 个网名；一个网不能同属两个 pair/lengths 组',
        'rules.keepouts[].class 引用的 class 必须在 classes 里定义过'
      ],
      示例: core.EXAMPLES[0].build()
    });
    break;
  }
  case 'rules': {
    out({
      ok: true,
      可靠_硬规则: [
        '回流路径优先：换层信号过孔旁 1~2mm 内应有地孔（工具内置检查）——提醒级最佳实践：RTF2 ch6 实测四种换层结构 TDR 无差异，前提是参考平面贴近+旁路电容充分；平面拉远或去耦不足时配对地孔是硬要求（Bogatin A.55-57、黑魔书 ch7）',
        '大铜皮必须缝合才算地（缝合孔按间距自动生成）',
        '孤岛铜是天线：覆铜自动去孤岛并报告',
        '载流按 IPC-2152：1oz 外层 ΔT10℃ 1A≈0.4mm（建议 0.5）；内层 0.5oz 1A 需 1.6mm；0.3mm 过孔 1A/孔',
        'DFM 以板厂参数表为准（嘉立创：1oz 双面线宽极限 0.10/多层 0.09；过孔极限 0.15/0.25；线宽公差 ±20%）',
        '接口防护顺序：连接器→TVS→滤波→芯片，TVS 地脚就近入平面',
        '晶振：短、近、包地、下方完整地'
      ],
      有条件_别当教条: [
        '3W：两层板常常不够、差分内不适用——仅对⚡高速网络做提醒级检查；完整口径（Altium 教材）：边沿间距 ≥2W、距板边 >3W',
        '直角：1GHz 以下 EMI 无差别；45° 为一致性与空间；RTF2 ch4 实测直角亦无酸陷阱；>10GHz 才需要圆角（Altium 教材）',
        '铺铜≠屏蔽：未缝合的铜皮不是地',
        '跨平面割缝：RTF2 ch6 实测条件性无害——条件是两端共地网络且 PDN 目标阻抗达标（≤10mΩ@1GHz 量级）；单端信号跨缝仍是硬禁（Bogatin A.36）',
        '回流地孔间距"λ/20"等公式化口径：无普适依据，按换层结构和平面耦合评估（RTF2 ch7 已证伪清单成员）；λ/20 本义是搭接/接地的等电位判据（Ott ch2），射频专项才用',
        '双面板无法铺完整地平面时的下限做法（Altium 教材）：信号网格化地+环路面积 <1.5in²——有条件优于无地，但完整平面永远优先'
      ],
      勿信_谣言: [
        '走直角产生 EMI', '模拟地数字地必须分开', '电容离引脚 2mm 就无效', '小容值必须最靠近引脚', '差分必须紧耦合', '信号线不能打过孔', '地线越粗越好', '1A/mm 是规范', '晶振两脚等长控阻抗',
        '20H 规则（RTF2 ch7 实验证伪）', '过孔桩线在 <3.125Gb/s 时致命（RTF2 ch4：250mil 过孔仅 λ/4 的 1/3，过孔寄生的主项是电容不是 stub）',
        'EMI 主要来自时钟线（RTF2 ch7：实测主要来自 Vdd 纹波，平面电容 AC bonding 才是关键）',
        '磁珠隔数字电源是必选项（RTF2 ch3：数字 PDN 30 年未用）',
        '"100Ω 差分必须紧耦合"（RTF2 ch8：实为两根 50Ω 各自端接；松耦合线更宽、损耗更低）'
      ],
      // —— 书籍研读新增（出处见 docs/书籍研读/，页码为准）——
      高速判据: [
        'Fknee=0.5/Tr：信号带宽由上升时间决定而非时钟频率（黑魔书 ch1）——nets[].tr 以 ns 记录上升时间后，工具按 1/6 判据（走线 > Tr·v/6 须端接）检查',
        '带宽口径对照：BW=0.35/RT（Bogatin ch2，10%-90%）与 Fknee=0.5/Tr（黑魔书，保守）；只知时钟频率时 BW≈5×F_clock（7% 边沿假设）',
        '上升边按 RSS 合成：RT_out²=RT_in²+RT_IC²；互连带宽应 ≥2×信号带宽（Bogatin ch2）——换更慢工艺的器件会让旧布线露出新问题',
        '低/高速边界三口径（RTF2 ch1）：经验 1/4~1/6 电长度、仿真严格 1/12——工具取 1/6 居中口径；0.2ns 边沿的串扰临界长度仅约 0.75in',
        '短截线约束两口径：A.7 桩线时延 <20% 上升边（严）、Altium 教材 Tstub≤tr/3（松）——取严用 20%',
        '串扰=容性耦合+感性耦合，与 1/Tr 成正比；感性耦合（回流路径互感）通常占主导且随耦合长度线性增长（黑魔书 ch1）——3W 的物理内核是耦合随间距快速衰减',
        '地弹 V=L·dI/dt 来自回流路径电感而非走线本身（黑魔书 ch2）——换层必配回流地孔、地平面开槽是大忌',
        '边沿速率比传播延时更值得优化：慢边沿降低串扰/地弹/EMI（黑魔书 ch2）'
      ],
      回流_换层对策层级: [
        '优先级从高到低（黑魔书 ch7）：①尽量不换层 ②换层但两侧同参考平面 ③每个信号过孔旁配回流地孔 ④提高全板地孔缝密度——对策③已自动化：pour --auto-return 对高速网换层孔自动配对',
        '地弹公式用净电感：V=(L−M)·dI/dt（Bogatin ch6）——回流孔靠近信号孔就是在增大互感 M、减小净电感',
        '回流孔间距阈值挂钩孔长（Bogatin ch6）：两孔间距小于过孔长度时互感抵消才有效——0.3mm 孔/1.6mm 板即地孔要在 ~1.6mm 内；同向缝合孔间距大于孔长即可',
        '换层组合白名单（Archambeault）：相邻参考面换层（1-2/3-4/5-6 型）最简；隔一对平面的 3-5/5-7/7-9 型要靠去耦电容桥接；跨到远端平面的 3-9 型禁用',
        '过孔回路电感可用 viaLoopInductanceNanohenry(h,d) 估算：0.3mm 孔/1.6mm 板≈1.3nH（Bogatin 25nH/in 局部自感口径互证）——每颗信号过孔都是回流路径上的串联电感',
        '换层贯通孔旁的去耦电容必须低 ESR（有损耗电容不能给高频回流用）；远端分布电容反而可用有损耗电容阻尼平面谐振（65%损耗+35%低ESR 可降 20dB——Archambeault ch8/ch11）',
        '保护线不能当作回流路径（黑魔书 ch7）——回流必须走平面或地孔',
        '连接器/封装引脚中把最短引线给地，空引脚全部接地（Bogatin A.46-52/黑魔书 ch9）'
      ],
      工程方法论: [
        '信号完整性 10+1 条基本原则的总纲（Bogatin 前言/ch1）：瞬时阻抗恒定是一切的根本；返回路径、地弹、串扰、轨道塌陷、EMI 都由此派生——工具的全部检查项都是这条总纲的具体化',
        '"技能在工程师不在工具"：自动布线器布得好坏取决于约束规则给得对不对（RTF2 ch2）——给本工具喂 rules 知识库+锚定+禁布区就是这条路',
        'Technology Table（RTF2 ch2）：设计前先定逻辑族/边沿/阻抗/层叠一张表——本工具的 design JSON+预设即其轻量版',
        '设计规则的四元组模型（Altium Day2）：类型+作用域+min/preferred/max+优先级——本工具的 nets[].w（网络类线宽）是其轻量实现；二元规则（如间距）需要两个作用域',
        '规则=独立对象而非对象属性；编译验证体系（Altium Day1）：规则矩阵可配等级、每条警告须显式处置（No-ERC 白名单）、"Nets with no driving source"是标准校验项——本工具 erc 的单焊盘网络/坏引用同源',
        '"预布线+锁定+自动布线"是 EDA 正统工作流（Altium Day2）——本工具的手动走线固定+单网重布同构',
        '铺铜四清理参数（Altium Day3）：死铜/孤岛/窄颈/圆弧逼近——本工具已做孤岛去除；窄颈与圆弧逼近未做，栅格条带近似不受布尔抵消影响（泪滴安全性已回归测试固化）',
        '磁珠隔电源不是万能药：Ritchey 自述数字 PDN 上 30 年未用磁珠；仅敏感模拟/射频域隔离才考虑（RTF2 ch3）',
        'Y5V/Z5V 高介电常数电容偏压失容严重：50% 额定电压只剩约 10% 容量——去耦选 X7R/X5R 起步（RTF2 ch3）',
        '库仑桶：电容按 C=I·Δt/ΔV 供电荷；平面电容 C_plane≈C_swl·V/ΔV 与信号层覆铜都可计入（RTF2 ch3，500pF→4nF 修复 EMI 实例）',
        '去耦电容 ESL 按封装量级（RTF2 ch10）：0402≈270pH、0603 更低工艺可达 ~150pH、倒装/LICA 类≈25pH——同容值不同封装的 PDN 高频表现差一个量级',
        '封装电源引脚电感决定 PDN 上限：焊球 1.0mm 球距≈1.06nH/球；好坏封装纹波可差 7 倍（RTF2 ch10 实测 21% vs 3%）',
        'PDN 验证要测不要猜（RTF2 附录2）：裸板平面电容→装电容后阻抗-频率曲线→最坏工况纹波三步；板内留低感测试点（禁热焊盘、两处以上、间距 ≥1in）',
        '全频段低阻抗 PDN 是"信号可走电源平面上方"的前提（RTF2 附录2）；不达标就只走 GND 平面上方'
      ],
      去耦_PDN: [
        '去耦四要素：数量、位置（紧贴电源/地引脚）、安装电感（孔距/盘距最小化）、容值组合（Bogatin ch13；PEI p374-375）',
        '实际电容=ESL/ESR/C 四元件模型，自谐振频率 SRF 以上呈感性——大容值电解/钽与小容值陶瓷并联覆盖宽频（PEI p141/p182）',
        '电源/地平面电容在数百 MHz 以上接管去耦；铺铜平面是 PDN 的一部分，不是装饰（Bogatin ch13）',
        '平面电容速查：FR-4 0.01in 介质≈100pF/in²，与介质厚度成反比（黑魔书 ch8）',
        'PDN 三频段：低频体电容补 VRM、中频 MLCC 阵列、高频靠平面+片上（黑魔书 ch8 五步法：Xmax=ΔV/ΔI → Fbypass=Xmax/(2πL) 分频 → 按电荷定数量）',
        '大小容值并联有并联反谐振风险：混用容值的"高频小电容"方案在 75-200MHz 可能反而恶化（Archambeault ch8 实测）——分布式去耦倾向统一容值+封装内取最大，峰值靠 FDTIM/目标阻抗管理',
        '去耦电容密度上限受安装电感限制：即使 1个/in²，改善上限也只到 400-600MHz——更高频段只能靠平面电容与片上电容（Archambeault ch8）',
        '过孔电容典型 0.5pF（黑魔书 ch7）——1ns 边沿仅 27ps 影响；过孔的敌人是电感不是电容（深宽比 ≤6:1）',
        'IR-drop 用节点电导矩阵可解（SPICE 原理，PEI p276-278）——工具 drop 命令直接算每焊盘压降'
      ],
      载流_发热: [
        '载流按 I_RMS 计算发热（RMS 是热等效）；峰值电流另计（PEI p117-119）',
        '趋肤深度 δ=√(ρ/πfμ)：铜 1GHz≈2.1µm、100MHz≈6.6µm——高频电流走导体表层，AC 电阻按周长×δ 估（PEI p183/p291，工具内置 skinDepth/acTraceR）',
        '1oz 铜约 20MHz 起呈现趋肤效应（R∝√f，Bogatin ch4/ch9）——acTraceR 的 DC/AC 转折量级',
        '方块电阻口径（Bogatin ch4）：1oz 铜 0.5mΩ/sq、0.5oz 1mΩ/sq，R=R_sq·L/w——powerDrop 精确几何计算的心算校核',
        '热阻 ℜ=L/(kA) 串联相加：铜皮是散热器，覆铜+缝合孔改善热路径（PEI p63-68）',
        '铜电阻温度系数 α≈0.0039/℃：温升→电阻升→压降升（PEI p52-56）'
      ],
      布局规程: [
        'LED 不宜直接并联（VF 差异电流失衡，须各自限流）（PEI p524-553）',
        '感性负载（继电器/电机/蜂鸣器）必须配续流二极管或 RC snubber（PEI p173-176/p442）',
        '接口防护链：连接器→TVS→共模滤波→芯片；TVS 钳位电压须低于芯片耐压（PEI p470-473）',
        '板边装配净空 ≥2mm：连接器/把手/外壳干涉区（PEI p580-600）',
        '成排同向元件布局便于焊接与检验（PEI p580-600）',
        '555/模拟 IC：控制脚(pin5) 0.01µF 旁路、电源脚 0.1µF 去耦、触发/阈值走线短（PEI p716-720）',
        '去耦电容地端与电源端就近入平面；环路面积（电源-地-信号回流）越小 EMI 越低（PEI p402-403）'
      ],
      EMC_布局: [
        '返回路径是 EMC 第一考量，三大中断源（Archambeault）：跨平面割缝、换层换参考平面、跨板连接器——对应补救：缝补电容跨缝（0.5in 内）/换层不换参考/连接器安排返回引脚',
        'I/O 隔离壕策略：I/O 区可去平面（仅数百 MHz 以下有效）；跨壕信号用磁珠而非电容跨缝（Archambeault）',
        'I/O 滤波器贴连接器 ≤1cm；π 型最佳（C1 接数字地、C2 接机壳地）；单元件滤波选串联磁珠（Archambeault ch9）',
        '共模滤波器外侧的参考平面应挖空（Archambeault ch9）——覆铜需支持区域级禁铜，当前工具暂无此粒度，人工在 EDA 内处理',
        '护卫线接地过孔每英寸 ≥1 个（Archambeault/黑魔书 ch7）——GUARD 建议的工艺口径',
        '散热器要 ≥8 个接地点才不 become 天线（Archambeault）；板边/缝隙 >50mil 宽时要重点评估',
        '机壳通风孔：金属条宽 ≥ 孔径 25%；板边接地围栏孔距按最高干扰频率波长参数化（Archambeault ch12）',
        '意图信号频谱控制：放慢边沿比降低幅度更有效——梯形波谱包络 1/(πd) 与 1/(πt) 转折（Archambeault）',
        'I/O 噪声预算量级：约 100µV（Archambeault）——接口滤波以此为目标'
      ],
      // —— Bogatin《信号完整性与电源完整性分析 第3版》附录A(102条设计规则)/B(100条经验法则) 速查 ——
      Bogatin附录速查: {
        串扰与间距: [
          'A.34：相邻信号线间距至少 2 倍线宽（微带/带状线）；B.74-79：50Ω 线近端串扰——微带 1W/2W/3W≈5%/2%/1%，带状线 6%/2%/0.5%',
          '第10章正文实测（与附录B互校）：微带 NEXT 6.5%/1.9%/1.2%、带状线 4.4%/1.2%/0.57%——1W 口径两处差 1.5 个百分点，2W/3W 一致；"5% 安全门槛"是含两侧攻击线的总线最坏值（2.1×单条），单对应 ≤2%（s≥2w）',
          'B.84：总线最坏近端噪声 <5% 须间距 ≥2W；B.85-87：1W 间距时 75% 串扰来自左右相邻各 1 条线',
          'B.83：带状线/完全嵌入式微带没有远端串扰——长并行敏感对改内层（A.37-39）',
          'B.88-89：防护线接地后微带约再降 50%+（第10章实测微带短路防护≈−84%、带状线宽防护≈−99%）；浮空防护线会恶化串扰——必须两端+沿途接地，上升边空间延伸内 ≥3 孔（GUARD 建议依据）',
          'B.90：可接受的开关噪声要求互感 < 2.5nH×上升边(ns)；最大可用时钟 f≈250MHz/(n·Lm)（n=同回路线数）'
        ],
        传输线与端接: [
          'B.47：时延 < 20% 上升边可不端接（黑魔书 1/6 判据更保守，两者取严）',
          'B.1：不知上升边时按周期 10% 估（100MHz→1ns）；B.4：带宽≈5×时钟频率',
          'B.3：BW=0.35/RT（高斯）；黑魔书 Fknee=0.5/Tr（保守）——工具 criticalLineLen 用 1/6 判据',
          'B.30-31：FR4 信号速度≈6in/ns（150ps/in）；B.36/37：50Ω 微带介质厚≈线宽一半，带状线平面间隔=2×线宽',
          'A.7：桩线时延 < 20% 上升边；本工具全通孔无桩线，背钻不适用',
          'A.5/6：点对点串阻端接；多点总线端接所有节点'
        ],
        回流与平面: [
          'A.10：每个信号下方都要有返回路径，宽 ≥3×线宽（B.41-42：返回路径 3W 内阻抗偏差 <1%）',
          'A.11/A.36：绝不跨返回路径缝隙（单端）；跨缝只能差分',
          'A.55-57：换返回平面的信号：平面靠近+就近打过孔连接两平面；多信号换层时过孔分散不要扎堆',
          'A.81：走线距板边至少 5×线宽（EMI）；A.83：高速/大电流器件远离 I/O 接口',
          'A.87：平面边沿打缝合短接过孔；A.88：尽量让地平面做外层'
        ],
        PDN_去耦: [
          'A.59/60：电源地平面相邻、靠近、用高介电常数介质；A.63：电源过孔与地过孔尽量靠近',
          'A.72-75：去耦电容安装电感第一——焊盘-过孔走线短而宽；A.77/B.24：SMT 电容回路电感典型 2nH，<1nH 要下功夫',
          'B.16-17：1nF 去耦约撑 0.5µs（1W 芯片 5% 下沉）；平面电容≈1nF/in²/mil 介质厚',
          'B.25：平面对每方块回路电感≈33pH×介质厚(mil)；A.78：FDTIM 频域目标阻抗法选容值'
        ],
        载流_损耗: [
          'B.10：1oz 铜方块电阻≈0.5mΩ/sq——工具 powerDrop 按几何精确算，此值可心算校核',
          'B.27/57：趋肤深度 1GHz≈2µm（10MHz≈20µm）；1GHz 下 1oz 铜线电阻≈DC 的 15 倍',
          'B.64-67：FR4 耗散因子≈0.02；FR4 互连带宽≈30GHz/长度(in)——长线高频损耗按此估算'
        ],
        差分_预留: [
          '差分对 lite（已支持）：nets[].pair 同组两网 → 等长检查（ΔL≤0.2×UI×v，无 tr 按 ≤5% 提醒）+ 3W 对内豁免；布线仍各自进行，成对贴近走线由布局保证（完整耦合布线在路线图）',
          'A.23：板级差分对尽量紧耦合；B.92-100：LVDS 共模分量大于差分分量、紧耦合差分串扰敏感度变化等',
          '第11章量化（数值均经算例复算）：Zdiff=2×Zodd、Zcomm=½Zeven；带状线最紧间距 Zdiff 仅降约 12%、微带约 10%（最大相对耦合度 <14%）——"紧耦合阻抗剧变"是误解',
          '等长双口径：错位预算 ΔL≤0.2×UI×v（5Gbps→240mil，Bogatin ch11）；1% 长度失配即显著抬升共模（Archambeault ch10）——按信号速率取更严者',
          'RTF2 ch8 实务修正："100Ω 差分"实为两根 50Ω 各自端接；松耦合（10/15mil 间距单线 54Ω）比紧耦合线更宽、损耗更低；扇出区阻抗跳变（140Ω）不可避免',
          '差分对同样禁跨参考平面裂缝；蛇形绕线间距 S≥3H、对内间距 D>2S（Altium 教材）；跨缝隙"单端需缝合孔桥接、紧耦合差分可自持"双口径（Bogatin ch11）',
          'DM 辐射天然比 CM 低约 2500:1 数量级（Ott/论文算例）——差分的价值在控共模；共模扼流器约 −40dB',
          '完整差分阻抗布线（奇偶模耦合）留作路线图（4 参数理想模型 Zodd/Zeven/TDodd/TDeven 为最小数据结构雏形）'
        ],
      },
      DFM_嘉立创锚点: core.JLC,
      依据: '三层分级整理自 README《布线规则速查》；文献基准 Henry Ott《Electromagnetic Compatibility Engineering》等；'
        +'高速判据/去耦/载流/布局规程四组来自 2026-11 书籍逐页研读（docs/书籍研读/00-总览.md 有书目与页码索引）'
    });
    break;
  }
  case 'spec': {
    const d = loadDesign(args[0]);
    const groups = new Map();
    for (const p of d.pads || []) { const g = p.id.split('-')[0]; groups.set(g, (groups.get(g) || 0) + 1); }
    const problems = [];
    const minGrid = core.minimumRoutingGrid(d);
    if (d.grid < minGrid - 1e-9) problems.push(`grid ${d.grid} < 最大线宽+clearance ${minGrid}（route 会自动调大）`);
    const lim = core.jlcTrackRule(d);
    for (const n of (d.nets || [])) if (n.w && n.w < lim.limit)
      problems.push(`网络 ${n.name} 线宽 ${n.w} 低于工艺极限 ${lim.limit}mm`);
    const netIds = new Set((d.nets || []).map(n => n.id));
    for (const p of d.pads || []) if (p.netId != null && !netIds.has(p.netId)) problems.push(`焊盘 ${p.id} 引用了不存在的 netId ${p.netId}`);
    const padCount = new Map();
    for (const p of d.pads || []) if (p.netId != null) padCount.set(p.netId, (padCount.get(p.netId) || 0) + 1);
    const single = (d.nets || []).filter(n => (padCount.get(n.id) || 0) === 1).map(n => n.name);
    if (single.length) problems.push(`单焊盘网络（布线会跳过）：${single.join(',')}`);
    // 空网（第七轮：生成器漏 nets 键 → 空网"假绿"暴露）
    const empty = (d.nets || []).filter(n => !padCount.has(n.id)).map(n => n.name);
    if (empty.length) problems.push(`空网络（无焊盘引用）：${empty.join(',')}`);
    // 同元件焊盘间距（DRC padGap 同口径——第七轮 PLCC 四角：L∞ 分离 0.125 ≥0 通过、
    // 欧氏角距 0.177 < 0.2 才是真违规；同网焊盘豁免）
    {
      // 外部板豁免（design.external）：真实封装自带同封装焊盘交叠（散热焊盘等），
      // 封装作者几何是 ground truth——本检查针对自产 generator 规格
      if (d.external) { /* skipped: external footprint geometry is ground truth */ }
      else {
      const byComp = new Map();
      for (const p of d.pads || []) { const g = p.id.split('-')[0]; if (!byComp.has(g)) byComp.set(g, []); byComp.get(g).push(p); }
      for (const [, ps] of byComp)
        for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
          const a = ps[i], b = ps[j];
          if (a.netId != null && b.netId != null && a.netId === b.netId) continue;
          // 旋转焊盘（45° 等非 90 倍数）：L∞/AABB 会把合规旋转几何误报为 0 间距
          // （QFN-48-1EP 实测）——用真旋转矩形边对边距离
          // rotAbs=板坐标绝对角；wLocal/hLocal=未交换本地尺寸——_rotRectGap 的真形状输入
          const rotA = ((a.rotAbs ?? 0) % 90 + 90) % 90, rotB = ((b.rotAbs ?? 0) % 90 + 90) % 90;
          const rotated = (rotA > 1e-9 && Math.abs(rotA - 90) > 1e-9) || (rotB > 1e-9 && Math.abs(rotB - 90) > 1e-9);
          if (!((a.layer === 'both' || b.layer === 'both') || a.layer === b.layer)) continue;
          const gap = core.padGap(a, b);
          let bad;
          if (rotated) {
            bad = core._rotRectGap(a, b) < d.clearance - 1e-9;
          } else {
            bad = gap < d.clearance - 1e-9;
          }
          if (bad) problems.push(`同元件焊盘间距 ${a.id}/${b.id} ${Math.max(0, (rotated ? core._rotRectGap(
            {x:a.x,y:a.y,w:a.wLocal??a.w,h:a.hLocal??a.h,rot:a.rotAbs??0},
            {x:b.x,y:b.y,w:b.wLocal??b.w,h:b.hLocal??b.h,rot:b.rotAbs??0}) : gap)).toFixed(3)}mm < ${d.clearance}mm`);
        }
      }
    }
    // 出板（铜边超板框；贴边=0 合法——金手指类；铸铜半孔豁免——圆形带孔且圆心距板边 < 孔半径，
    // 与生成器自检同口径，第十轮审计补齐：R8 曾声称"两处同步"但此处遗漏）
    for (const p of d.pads || []) {
      const hw = p.w / 2, hh = p.shape === 'circle' ? p.w / 2 : p.h / 2;
      if (p.x - hw < -1e-9 || p.x + hw > d.width + 1e-9 || p.y - hh < -1e-9 || p.y + hh > d.height + 1e-9) {
        const cast = p.shape === 'circle' && (p.holeR || 0) > 0 &&
          Math.min(p.x, d.width - p.x, p.y, d.height - p.y) < p.holeR;
        if (!cast) problems.push(`焊盘 ${p.id} 出板 @(${p.x},${p.y})`);
      }
    }
    // THT 环宽（L15：孔径-环宽-间隙三联动，spec 阶段即拦截）
    // 机械安装孔豁免（外部板实测缺口）：无网 THT = 无铜环 NPTH，环宽不适用
    for (const p of d.pads || []) {
      if (!(p.holeR > 0)) continue;
      if (p.netId == null) continue;
      const ring = Math.min(p.w, p.shape === 'circle' ? p.w : p.h) / 2 - p.holeR;
      if (ring < 0.18 - 1e-9) problems.push(`焊盘 ${p.id} 环宽 ${Math.max(0, ring).toFixed(2)}mm < 0.18mm（孔 ${(p.holeR * 2).toFixed(2)} 太大或盘太小）`);
    }
    // 零格焊盘（第十轮 L39：薄于栅格的焊盘落在格界上 → padCells 空 → 本网不可达）
    {
      const g = d.grid;
      const phaseDist = v => { const m = ((v / g - 0.5) % 1 + 1) % 1; return Math.min(m, 1 - m) * g; };
      for (const p of d.pads || []) {
        if (p.w >= g - 1e-9 && p.h >= g - 1e-9) continue;   // 双轴 ≥ grid 必含格心
        if (phaseDist(p.x) <= p.w / 2 + 1e-9 || phaseDist(p.y) <= (p.shape === 'circle' ? p.w : p.h) / 2 + 1e-9) continue;
        problems.push(`焊盘 ${p.id} 零格覆盖（薄于栅格 ${g} 且两轴均不在格心线）——布线器不可达，移到 (i+0.5)*grid 格心线或加大焊盘`);
      }
    }
    // 载流声明校验（规格书 → 线宽）：nets[].current 声明后线宽必须 ≥ IPC-2152 需求
    {
      const decls = core.netCurrentDecls(d);
      for (const r of decls) {
        if (r.w + 1e-9 < r.requiredLimit)
          problems.push(`网络 ${r.name} 声明 ${r.current}A 但线宽 ${r.w}mm < 载流需求 ${r.required}mm（−20% 公差极限 ${r.requiredLimit}mm）——用 currents --apply 抬宽或加大声明铜厚/层位`);
        else if (r.w + 1e-9 < r.required)
          problems.push(`网络 ${r.name} 线宽 ${r.w}mm 低于建议 ${r.required}mm（满足 −20% 公差极限 ${r.requiredLimit}mm）——可接受但建议加宽`);
      }
    }
    // 差分对阻抗可达性（规格书 → 定档）：rules.pairs[].z 或 nets[].diffZ 声明后，
    // 反查不可达即报告建议路径（4 层 / 放宽 / 显式 gap）——spec 阶段拦截而非布线后惊讶
    {
      const seen = new Set();
      for (const n of d.nets || []) {
        if (!n.pair || seen.has(n.pair)) continue;
        seen.add(n.pair);
        if (n.pairGap != null && n.pairGap > 0) continue;   // 显式 gap = 用户已定档
        const zt = n.diffZ > 0 ? n.diffZ : 90;
        const zi = core.diffPairZFor(d, core.netW(d, n.id), zt);
        if (!zi.ok || !zi.achievable)
          problems.push(`差分对 ${n.pair} 目标 ${zt}Ω 在 ${d.layers} 层叠层不可达（最低 ${zi.zdiffMinAtSmin}Ω @ S=0.1mm）——建议 ${d.layers >= 4 ? '复核线宽或放宽目标' : '升 4 层、放宽目标，或用 rules.pairs[].gap 显式给出叠层工具算得的间隙'}`);
      }
    }
    const limit = core.jlcTrackRule(d);
    if (d.trackW < limit.limit) problems.push(`线宽 ${d.trackW} 低于 ${d.copperWeight}oz 工艺极限 ${limit.limit}mm`);
    // rules 约束摘要 + class 工艺极限（roadmap #10：引用/冲突类错误已在 normalize 即抛；
    // 这里补工艺极限与可见性）
    let rulesSummary = null;
    if (d.rules) {
      const classes = d.rules.classes || {};
      for (const [cn, c] of Object.entries(classes)) {
        if (c.w && c.w < limit.limit) problems.push(`class ${cn} 线宽 ${c.w}mm 低于 ${d.copperWeight}oz 工艺极限 ${limit.limit}mm`);
        if (c.w && c.w < d.clearance) problems.push(`class ${cn} 线宽 ${c.w}mm 小于间距 ${d.clearance}mm（同网自碰）`);
      }
      const nc = d.rules.netClass || {};
      rulesSummary = {
        classes: Object.keys(classes).length,
        classified: Object.keys(nc).length,
        pairs: (d.rules.pairs || []).length,
        lengthGroups: (d.rules.lengths || []).length,
        keepouts: (d.keepouts || []).filter(k => k.scope).length
      };
    }
    out({ ok: true, width: d.width, height: d.height, grid: d.grid, layers: d.layers,
      trackW: d.trackW, clearance: d.clearance, via: [d.viaOuter, d.viaDrill],
      nets: (d.nets || []).length, pads: (d.pads || []).length, components: groups.size,
      keepouts: (d.keepouts || []).length, rules: rulesSummary, problems });
    break;
  }
  case 'place': {
    const d = loadDesign(args[0]);
    const r = core.autoPlace(d, { iterations: parseInt(argFlag(rest, '--iterations', '4000')),
      anchor: (argFlag(rest, '--anchor', '') || '').split(',').filter(Boolean) });
    if (outPath) writeFileSync(outPath, JSON.stringify(d, null, 1));
    out({ ok: true, ...r, written: outPath || null, design: outPath ? undefined : d });
    break;
  }
  case 'route': {
    const d = loadDesign(args[0]);
    const viaCost = Number(argFlag(rest, '--via-cost', '15'));
    const maxIter = parseInt(argFlag(rest, '--max-iter', '30'));
    const parallel = parseInt(argFlag(rest, '--parallel', '0'));
    const iterWorkers = parseInt(argFlag(rest, '--iter-workers', '0'));
    const iterWavesRaw = argFlag(rest, '--iter-waves', '');
    const iterWaves = iterWavesRaw === '' ? undefined : parseInt(iterWavesRaw);
    const nbRipup = !argFlag(rest, '--no-nb-ripup', '');
    // #15b 相邻层盲埋孔（opt-in）：开启后布线器换层自动记相邻层 span
    const blindVias = !!argFlag(rest, '--blind-vias', '');
    // 差分对强制压实（0.13.27）：缺省开启，--no-compact-pairs 关闭
    const compactPairs = !argFlag(rest, '--no-compact-pairs', '');
    // 多网联合重布（0.14.1）：缺省开启，--no-joint-reroute 关闭
    const jointReroute = !argFlag(rest, '--no-joint-reroute', '');
    // 扇出优先（0.13.20 F1）：--fanout-first [auto|inner|outer]，缺省不带 = off
    const ffRaw = argFlag(rest, '--fanout-first', '');
    const fanoutFirst = ffRaw === '' ? undefined
      : ({ auto: 'auto', inner: 'inner_first', outer: 'outer_first' }[ffRaw] || ffRaw);
    // 障碍感知启发式（0.14.9，opt-in）：协商重搜索 2.2-2.5×，代价是协商路径多样性
    // 下降（等代价路径趋同进最短走廊）——保证可解板质量持平偏好，截断态硬板不动点
    // 可能变差（实测 fable-03 −1 / icebreaker −11 连通，加迭代不恢复）。默认关=位级
    // 一致；速度敏感或以 DRC 为先的板可开启（h2-stm32 实测 DRC 错误 39→25）。
    // 权衡表见 docs/深度优化报告-20261116.md
    // 0.14.9b 转正：缺省开启（组合一致场），--no-obstacle-h 回退盲口径
    const obstacleH = argFlag(rest, '--no-obstacle-h', '') ? false : true;
    let result, via;
    if (iterWorkers > 0) {
      const engineUrl = new URL('../src/engine.mjs', import.meta.url).href;
      const shard = parseInt(argFlag(rest, '--shard', '0'));
      const par = await core.routeBoardIterParallel(d, { viaCost, maxIter, iterWorkers, iterWaves, shard, blindVias, fanoutFirst, compactPairs, jointReroute, obstacleH,
        engineUrl, neighbourhoodRipup: nbRipup });
      result = par.result; via = { mode: 'iter-parallel', blind: blindVias || undefined, fanout: fanoutFirst, compact: compactPairs ? undefined : 'off', workers: par.workers,
        iterations: par.iterations, waves: iterWaves ?? 2, shard: shard || 0 };
      if (outPath) writeFileSync(outPath, JSON.stringify(result, null, 1));
      out({ ok: true, status: result.status, stats: result.stats, overuse: result.overuse.length,
        timeMs: result.timeMs, via, written: outPath || null, result: outPath ? undefined : result });
      break;
    }
    if (parallel > 0) {
      const engineUrl = new URL('../src/engine.mjs', import.meta.url).href;
      const par = await core.routeBoardParallel(d, { viaCost, maxIter, parallel, engineUrl, neighbourhoodRipup: nbRipup, blindVias, fanoutFirst, compactPairs, jointReroute, obstacleH });
      result = par.result; via = { mode: 'parallel', blind: blindVias || undefined, fanout: fanoutFirst, from: par.from, workers: parallel };
    } else {
      result = core.routeBoard(d, { viaCost, maxIter, neighbourhoodRipup: nbRipup, blindVias, fanoutFirst, compactPairs, jointReroute, obstacleH }).result;
      via = { mode: 'serial' };
    }
    if (outPath) writeFileSync(outPath, JSON.stringify(result, null, 1));
    // 形状补线（阶段三 #12，补充式）：只接管栅格仍失败的网；默认关闭，行为位级不变
    let shape = null;
    if (argFlag(rest, '--shape-patch', '')) {
      const window = argFlag(rest, '--shape-window', '');
      const nets = (argFlag(rest, '--shape-nets', '') || '').split(',').map(s => s.trim()).filter(Boolean);
      const sp = core.routeBoardShape(d, { base: result, viaCost, maxIter,
        shapeWindow: window === '' ? undefined : Number(window),
        shapeNets: nets.length ? nets : undefined });
      result = sp.result; shape = sp.shape;
      if (outPath) writeFileSync(outPath, JSON.stringify(result, null, 1));
    }
    out({ ok: true, status: result.status, stats: result.stats, overuse: result.overuse.length,
      iterations: result.iterations, timeMs: result.timeMs, via, shape, written: outPath || null,
      result: outPath ? undefined : result });
    break;
  }
  case 'drc': {
    const d = loadDesign(args[0]);
    const result = loadResult(args[1],d);
    const issues = core.checkDRC(d, result);
    const fab = core.fabChecklist(d, result, {});
    out({ ok: true, drc: issues, fabChecklist: fab,
      summary: { errors: issues.filter(i => i.sev === 'error').length,
        warnings: issues.filter(i => i.sev === 'warn').length,
        fabFail: fab.filter(f => f.status === 'fail').length,
        fabWarn: fab.filter(f => f.status === 'warn').length } });
    break;
  }
  case 'drop': {
    // 电源网 IR-drop / 回流质量：节点电导矩阵求解（PEI p276-278 原理）
    const d = loadDesign(args[0]);
    const r = loadResult(args[1], d);
    const key = argFlag(rest, '--net', '');
    if (!key) die('用法：drop <design.json> <result.json> --net <netId或名称> [--current 1] [--entries J1-1,V1-3]');
    const n = d.nets.find(nn => nn.id === key) || d.nets.find(nn => nn.name.toLowerCase() === key.toLowerCase());
    if (!n) die('未知网络：' + key + '（已有：' + d.nets.map(nn => nn.name).join(', ') + '）');
    out(core.powerDrop(d, r, n.id, {
      current: Number(argFlag(rest, '--current', '1')),
      entries: (argFlag(rest, '--entries', '') || '').split(',').filter(Boolean)
    }));
    break;
  }
  case 'pdn': {
    // PDN 一阶阻抗评估（Bogatin ch13 目标阻抗法 + 黑魔书 ch8 库仑桶 + RTF2 附录2 流程）
    const d = loadDesign(args[0]);
    const r = args[1] ? loadResult(args[1], d) : null;
    const est = core.pdnEstimate(d, r, {
      vdd: Number(argFlag(rest, '--vdd', '3.3')),
      itrans: Number(argFlag(rest, '--itrans', '1')),
      ripplePct: Number(argFlag(rest, '--ripple', '5')),
      dtUs: Number(argFlag(rest, '--dt-us', '10')),
      eslNh: Number(argFlag(rest, '--esl-nh', '1')),
      capUf: Number(argFlag(rest, '--cap-uf', '0.1')),
      pkgLnH: Number(argFlag(rest, '--pkg-lnh', '0'))
    });
    // --plan：FDTIM 频域扫描电容选型计划（13.16-13.22；平面电容取估算值或 --plane-pf 显式覆盖）
    let plan = null;
    if (argFlag(rest, '--plan', '')) {
      plan = core.fdtimPlan({
        ztarget: est.ztargetOhm,
        planeCapPf: Number(argFlag(rest, '--plane-pf', est.planeCapPf || 0)),
        fminMhz: Number(argFlag(rest, '--fmin', '1')),
        fmaxMhz: Number(argFlag(rest, '--fmax', '100')),
        eslNh: Number(argFlag(rest, '--plan-esl-nh', '2'))
      });
    }
    out({ ok: est.ok, pdn: est, plan });
    break;
  }
  case 'advise': {
    const d = loadDesign(args[0]);
    const r = args[1] ? loadResult(args[1], d) : null;
    out(advise(d, r));
    break;
  }
  case 'export': {
    const fmt = args[0];
    const d = loadDesign(args[1]);
    const r = loadResult(args[2],d);
    if (fmt === 'gerber') {
      const g = core.buildGerber(d, r, (r.pours || (r.pour ? [r.pour] : null)), core.teardropPolys(d, r));
      const base = (outPath || 'pcb').replace(/\.(gbr|drl|zip)$/, '');
      mkdirSync(dirname(base), { recursive: true });
      const files = core.gerberFiles(g,base);
      for (const [file, text] of files) writeFileSync(file, text);
      out({ ok: true, format: 'gerber', layers: d.layers, files: files.map(f => f[0]) });
    }
    let text, format;
    if (fmt === 'easyeda') { text = core.exportEasyEdaPcb(d, r.nets, (r.pours || (r.pour ? [r.pour] : null))); format = 'easyeda-pcb-json'; }
    else if (fmt === 'dsn') { text = core.exportDSN(d); format = 'specctra-dsn'; }
    else if (fmt === 'ses') { text = core.exportSES(d, r); format = 'specctra-ses'; }
    else if (fmt === 'ipc356') { text = core.exportIPC356(d, r); format = 'ipc-d-356a'; }
    else if (fmt === 'svg') { text = core.buildSVG(d, r, { pours: (r.pours || (r.pour ? [r.pour] : null)) }); format = 'svg'; }
    else if (fmt !== 'gerber' && fmt !== 'ses') die('未知格式：' + fmt + '（支持 easyeda|gerber|dsn|ses|svg|ipc356）');
    if (fmt === 'gerber') break;
    if (outPath) writeFileSync(outPath, text);
    out({ ok: true, format, bytes: text.length, written: outPath || null, content: outPath ? undefined : text });
    break;
  }
  case 'device': {
    const lcsc = (args[0]||'').trim();
    if(!/^C\d+/i.test(lcsc)) die('用法：device <C编号>，如 device C1591');
    const res = await fetch(`https://easyeda.com/api/products/${lcsc}/components`);
    const j = await res.json();
    if(!j.success || !j.result || !j.result.dataStr) die('嘉立创 API 未找到器件 '+lcsc);
    const parsed = core.parseEasyEdaDevice(j.result.dataStr, j.result.packageDetail && j.result.packageDetail.dataStr);
    const dev = { lcsc: lcsc.toUpperCase(), title: j.result.title, package: j.result.packageDetail ? j.result.packageDetail.title : '',
                  symbolDoc: j.result.dataStr, footprintDoc: j.result.packageDetail ? j.result.packageDetail.dataStr : null, ...parsed };
    if(outPath) writeFileSync(outPath, JSON.stringify(dev, null, 1));
    out({ ok:true, lcsc: dev.lcsc, title: dev.title, package: dev.package,
          pins: dev.pins.length, pads: dev.pads.length, footprintBBox: dev.footprintBBox,
          written: outPath||null, content: outPath?undefined:dev });
    break;
  }
  case 'schem': {
    const d = loadDesign(args[0]);
    const dir = argFlag(rest, '--devices', '');
    const devices = {};
    for(const comp of Object.keys(d.devices||{})){
      const lcsc = d.devices[comp];
      try{ devices[comp] = loadJson(`${dir}/${lcsc}.json`); }catch(e){ /* 无缓存→通用符号兜底 */ }
    }
    if(!dir) for(const comp of Object.keys(d.devices||{})){
      try{ devices[comp] = loadJson(`devices/${(d.devices[comp]||'').toUpperCase()}.json`); }catch(e){}
    }
    const text = core.exportEasyEdaSch(d, devices);
    if(outPath) writeFileSync(outPath, text);
    out({ ok:true, format:'easyeda-schematic-json', bytes:text.length, written:outPath||null,
          content: outPath?undefined:JSON.parse(text) });
    break;
  }
  case 'diffz': {
    const d = loadDesign(args[0]);
    const target = parseFloat(argFlag(rest, '--z', '90'));
    const onlyPair = argFlag(rest, '--pair', null) || undefined;
    const pairs = new Map();
    for (const n of d.nets) if (n.pair) {
      if (!pairs.has(n.pair)) pairs.set(n.pair, []);
      pairs.get(n.pair).push(n);
    }
    const rows = [];
    for (const [name, members] of pairs) {
      if (onlyPair && name !== onlyPair) continue;
      if (members.length < 2) continue;
      const w = members.reduce((s, m) => s + core.netW(d, m.id), 0) / members.length;
      const zt = members[0].diffZ > 0 ? members[0].diffZ : target;
      const r = core.diffPairZFor(d, w, zt);
      rows.push({ pair: name, nets: members.map(m => m.name || m.id), target: zt,
        w: r.w, stackup: r.stackup, z0: r.z0, zdiffUncoupled: r.zdiffUncoupled,
        zdiffMinAtSmin: r.zdiffMinAtSmin, achievable: r.achievable, sFor: r.sFor,
        corrected: r.corrected, maskMm: r.maskMm,
        note: r.achievable
          ? `间隙 S=${r.sFor}mm 时 Zdiff=${zt}Ω（奇模 ${r.zoddAt(r.sFor)}Ω / 偶模 ${r.zevenAt(r.sFor)}Ω）——耦合走廊与耦合度 DRC 已按此间隙工作`
          : `当前叠层不可达（最低 ${r.zdiffMinAtSmin}Ω @ S=0.1mm）——建议 4 层或接受不控阻抗` });
    }
    out({ ok: true, pairs: rows, disclaimer: 'IPC-2141 量级经验公式，正式阻抗控制以板厂层压实测为准（与 impedance() 同一免责层级）' + (rows.some(r => r.corrected) ? '；solderMask 修正为一阶口径（−2Ω/mil，Bogatin B.43/44），精确控阻须板厂层压结构复算' : '') });
    break;
  }
  case 'tune': {
    const d = loadDesign(args[0]);
    const r = loadResult(args[1], d);
    const report = core.serpentineTune(d, r, {
      pair: argFlag(rest, '--pair', null) || undefined,
      group: argFlag(rest, '--group', null) || undefined,
      serpGap: parseFloat(argFlag(rest, '--serp-gap', '0')),
      tol: parseFloat(argFlag(rest, '--tol', '0.05')),
      target: parseFloat(argFlag(rest, '--target', '0')),      // Altium 固定 Length 规则口径
      maxAmp: parseFloat(argFlag(rest, '--max-amp', '0')),     // KiCad/Altium Max Amplitude
    });
    const resultOut = outPath || args[1];
    writeFileSync(resultOut, JSON.stringify(r, null, 1));
    const pourStale = !!(r.pour || (r.pours && r.pours.length));
    out({ ok: true, tuned: report.tuned.length, skipped: report.skipped.length,
      groups: report.groups, detail: report,
      pourStale, note: pourStale && report.tuned.length
        ? '结果含旧铜皮：tune 已改走线路径，铺铜多边形未避让新 bump 铜——必须重跑 pour 刷新后再交付'
        : null,
      written: { result: resultOut } });
    break;
  }
  case 'pour': {
    const d = loadDesign(args[0]);
    const r = loadResult(args[1], d);
    const netName = argFlag(rest, '--net', 'GND');
    const net = d.nets.find(n => n.name.toLowerCase() === netName.toLowerCase());
    if(!net) die('网络不存在：'+netName);
    const layer = argFlag(rest, '--layer', 'bottom') === 'top' ? 0 : ((d.layers||2)-1);
    // 孤岛策略（KiCad ISLAND_REMOVAL_MODE 三档）：always 全删 / area 按面积 / never 保留
    const islandMode = ['always','area','never'].includes(argFlag(rest, '--islands', 'always')) ? argFlag(rest, '--islands', 'always') : 'always';
    // 多铜皮避让（KiCad zone priority 思想：后铺避让先铺）——历史铜皮取 r.pours/r.pour
    const prevPours = [ ...((r.pours || []).filter(Boolean)), ...((r.pour && !(r.pours||[]).some(p => p.netId === r.pour.netId && p.layer === r.pour.layer)) ? [r.pour] : []) ];
    const tds = core.teardropPolys(d, r);   // 异网泪滴楔形也参与覆铜避让
    const pourOpts = {
      netId: net.id, layer, thermal: true, teardrops: tds,
      islandMode, minIslandArea: parseFloat(argFlag(rest, '--min-island-area', '2')),
      fill: argFlag(rest, '--fill', 'solid'),                    // solid | grid（嘉立创：网格线宽/间距≥0.254）
      gridW: parseFloat(argFlag(rest, '--grid-w', '0.254')),
      gridGap: parseFloat(argFlag(rest, '--grid-gap', '0.254')),
      clearance: parseFloat(argFlag(rest, '--clearance', String(d.clearance))),
      edgeMargin: parseFloat(argFlag(rest, '--edge-margin', '0.2')),
      minWidth: parseFloat(argFlag(rest, '--min-width', '0.25')),   // KiCad ZONE_THICKNESS_MM 同默认
      avoidPours: prevPours,
    };
    const pour = core.computePour(d, r, pourOpts);
    const stitches = argFlag(rest, '--no-stitch') ? [] : core.planStitching(d, r, pour, parseFloat(argFlag(rest, '--stitch-spacing', '5')));
    d.stitching = stitches;
    r.pour = pour;
    r.pours = [...prevPours.filter(p => !(p.netId === net.id && p.layer === layer)), pour];
    // 自动回流地孔配对（--auto-return）：高速网换层过孔 reach 内无地导体时补缝合孔
    // （黑魔书 ch7 对策③ / Bogatin A.55-57；reach 默认 1.6mm≈过孔长度）
    let returnVias = null;
    if (argFlag(rest, '--auto-return', '')) {
      returnVias = core.autoReturnVias(d, r, { reach: parseFloat(argFlag(rest, '--return-reach', '1.6')) });
      if (returnVias.ok && returnVias.added.length) {
        d.stitching = [...d.stitching, ...returnVias.added.map(v => ({ x: v.x, y: v.y, netId: v.netId }))];
        // 缝合孔变化需重写 pour（新孔会融入铜皮）——重新规划铺铜保持一致性
        const pour2 = core.computePour(d, r, pourOpts);
        r.pour = pour2;
        r.pours = [...r.pours.filter(p => !(p.netId === net.id && p.layer === layer)), pour2];
      }
    }
    const designOut = outPath || args[0];
    writeFileSync(designOut, JSON.stringify(d, null, 1));
    const resultOut = args[1];
    if(resultOut) writeFileSync(resultOut, JSON.stringify(r, null, 1));
    out({ ok:true, net: net.name, layer, pourAreaMM2: +(pour.area||0).toFixed(1),
          fill: pour.fill, minWidth: pour.minWidth, thermalActive: pour.thermalActive,
          islandsRemoved: pour.islands, islandsKept: pour.islandsKept,
          unconnectedPads: pour.unconnectedPads, pours: r.pours.length,
          stitches: stitches.length,
          returnVias: returnVias ? { added: returnVias.added.length, skipped: (returnVias.skipped||[]).length } : null,
          written: { design: designOut, result: resultOut || null } });
    break;
  }
  case 'bom': {
    const d = loadDesign(args[0]);
    const rows = bomRowsOf(d);
    const csv = bomCsvOf(rows);
    if (rest.includes('--check')) {
      for (const row of rows) {
        if (!row.lcsc) { row.check = { ok: false, msg: '缺 LCSC 编号——从嘉立创库选型后填入' }; continue; }
        try {
          const res = await fetch(`https://wmsc.lcsc.com/ftps/wm/product/detail?productCode=${row.lcsc}`);
          const j = await res.json();
          if (!j.result) { row.check = { ok: false, msg: '未找到 ' + row.lcsc }; continue; }
          const rr = j.result;
          row.check = { ok: true, stock: rr.stockNumber, encap: rr.encapStandard || rr.encap || '' };
          const fp = (row.footprint || '').toUpperCase();
          const en = (row.check.encap || '').toUpperCase();
          if (en && fp && !fp.includes(en) && !en.includes(fp))
            row.check.msg = `封装可疑：器件 ${row.check.encap} vs footprint ${row.footprint}`;
        } catch (e) { row.check = { ok: false, msg: '查询失败：' + e.message }; }
      }
    }
    if (outPath) writeFileSync(outPath, csv);
    out({ ok: true, rows, csv: outPath ? undefined : csv, written: outPath || null,
      note: '缺 lcsc/footprint 的行需补齐后才能交嘉立创 SMT 贴片；--check 逐行验证 C 编号存在性/库存/封装' });
    break;
  }
  case 'part': {
    const code = (args[0] || '').trim().toUpperCase();
    if (!/^C\d+$/.test(code)) die('用法：part <C编号>，如 part C1591');
    const res = await fetch(`https://wmsc.lcsc.com/ftps/wm/product/detail?productCode=${code}`);
    const j = await res.json();
    if (!j.result) die('未找到 ' + code);
    const rr = j.result;
    out({ ok: true, lcsc: rr.productCode, model: rr.productModel,
          encap: rr.encapStandard || rr.encap || '', stock: rr.stockNumber,
          hint: '确认选型后：device ' + code + ' 拉取真符号+真封装' });
    break;
  }
  case 'render': {
    const d = loadDesign(args[0]);
    const r = args[1] ? loadResult(args[1], d) : { nets: [] };
    const img = core.renderBoardPixels(d, r, { scale: Number(argFlag(rest, '--scale', '8')) });
    const png = pngEncode(img.width, img.height, img.px);
    const outP = outPath || 'board.png';
    writeFileSync(outP, png);
    out({ ok: true, width: img.width, height: img.height, bytes: png.length, written: outP });
    break;
  }
  case 'verify': {
    const d = loadDesign(args[0]);
    const r = args[1] ? loadResult(args[1], d) : { nets: [] };
    // --export file.json：检查给定的导出文件与设计/结果是否一致
    const eeText = argFlag(rest, '--export') ? readFileSync(argFlag(rest, '--export'), 'utf8') : undefined;
    out(core.verifyEasyEdaExport(d, r, eeText));
    break;
  }
  case 'deliver': {
    // 一键交付包（roadmap #9，AI 手册 v2 交付步的门禁化收敛）：
    // verify 回读 + DRC 双门禁 -> 交付目录（EasyEDA/Gerber 套件/IPC-356/SVG/BOM/pos/
    // render PNG/投板检查表）+ manifest.json（每个交付物带 bytes 与 evidence 证据级）。
    // 门禁不过 -> ok:false 中止（--force 覆盖时在 manifest 如实记录 override）。
    const d = loadDesign(args[0]);
    const r = loadResult(args[1] || null, d);
    const force = !!argFlag(rest, '--force', '');
    const projRaw = argFlag(rest, '--project', '') || (d.name || 'board');
    const proj = String(projRaw).replace(/[\/:*?"<>|\s]+/g, '_').replace(/^\.+/, '_') || 'board';
    const dir = outPath || ('交付包-' + proj);
    mkdirSync(dir, { recursive: true });
    const arts = [];
    const emit = (file, kind, text, evidence) => {
      writeFileSync(file, text);
      arts.push({ file: file.slice(dir.length + 1), kind, bytes: Buffer.byteLength(text), evidence });
    };
    // ---- 门禁 ----
    const ver = core.verifyEasyEdaExport(d, r);
    const drc = core.checkDRC(d, r, { dfm: true });
    const drcErrors = drc.filter(x => x.sev === 'error');
    const fabFail = drc.filter(x => x.sev === 'error' && x.fab);
    // 第三道门禁：连通性——total>0 且 100% 布通（无 result/空板不放行）
    const total = r.nets.reduce((a, n) => a + (n.total || 0), 0);
    const connectedSum = r.nets.reduce((a, n) => a + (n.connected || 0), 0);
    const gatesOk = ver.ok && drcErrors.length === 0 && (total > 0 && connectedSum === total);
    const gates = {
      verify: { ok: ver.ok, findings: ver.findings },
      drc: { errors: drcErrors.length, warnings: drc.filter(x => x.sev === 'warn').length,
             fabFail: fabFail.length,
             detail: drcErrors.slice(0, 12).map(x => x.msg) },
      connectivity: { total, connected: connectedSum, ok: total > 0 && connectedSum === total }
    };
    if (!gatesOk && !force) {
      out({ ok: false, error: '交付门禁未通过（--force 可覆盖，但会如实留痕）',
        gates, hint: 'verify findings 非空=导出与设计不符；DRC errors 必须清零；fabFail=违反嘉立创工艺极限不可交付' }, 1);
      break;
    }
    // ---- 交付物 ----
    // EasyEDA：导出后写前回读（verify 已对账）——evidence 升级为 roundtrip-verified
    const eeText = core.exportEasyEdaPcb(d, r.nets, (r.pours || (r.pour ? [r.pour] : null)));
    emit(join(dir, proj + '.嘉立创EDA.json'), 'easyeda-pcb', eeText, ver.ok ? 'roundtrip-verified' : 'deterministic');
    // Gerber 套件
    const g = core.buildGerber(d, r, (r.pours || (r.pour ? [r.pour] : null)), core.teardropPolys(d, r));
    mkdirSync(join(dir, 'gerber'), { recursive: true });
    for (const [file, text] of core.gerberFiles(g, join(dir, 'gerber', proj)))
      emit(file, 'gerber', text, 'deterministic');
    // 其余单文件交付物
    emit(join(dir, proj + '.ipc356.txt'), 'ipc-d-356a', core.exportIPC356(d, r), 'deterministic');
    emit(join(dir, proj + '.svg'), 'svg', core.buildSVG(d, r, { pours: (r.pours || (r.pour ? [r.pour] : null)) }), 'deterministic');
    emit(join(dir, proj + '.BOM.csv'), 'bom', bomCsvOf(bomRowsOf(d)), 'datasheet-backed');
    emit(join(dir, proj + '.贴片坐标.csv'), 'pos', posCsvOf(posRowsOf(d)), 'datasheet-backed');
    const img = core.renderBoardPixels(d, r, { scale: 8 });
    const png = pngEncode(img.width, img.height, img.px);
    writeFileSync(join(dir, proj + '.渲染.png'), png);
    arts.push({ file: proj + '.渲染.png', kind: 'render-png', bytes: png.length, evidence: 'deterministic' });
    const checklist = core.fabChecklist(d, r, { pour: (r.pours || r.pour || null) });
    emit(join(dir, proj + '.投板检查表.json'), 'fab-checklist', JSON.stringify(checklist, null, 1), 'datasheet-backed');
    // manifest：交付物清单 + 门禁结果 + 证据级（AI 手册 §4 的贯彻）
    // 版本回退读 package.json——硬编码 '0.9.0' 曾让 0.13.27 的重交付 manifest 仍写 0.9.0（审计 F-b 成因）
    const engineVersion = process.env.npm_package_version
      || JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
    const manifest = {
      ok: true, project: proj, generatedBy: 'pcb-autorouter@' + engineVersion,
      design: { nets: d.nets.length, pads: d.pads.length, components: new Set(d.pads.map(p => p.id.split('-')[0])).size,
        layers: d.layers, width: d.width, height: d.height, external: !!d.external },
      result: { nets: r.nets.length,
        total: r.nets.reduce((a, n) => a + (n.total || 0), 0),
        connectedSum: r.nets.reduce((a, n) => a + (n.connected || 0), 0),
        vias: r.nets.reduce((a, n) => a + (n.vias || []).length, 0) },
      gates, override: !gatesOk ? { forced: true, reason: '--force' } : { forced: false },
      evidenceLevels: { 'roundtrip-verified': '写后回读对账通过（最强自证）', deterministic: '工具几何/文件生成（可机器复算）',
        'datasheet-backed': '厂商参数表口径（BOM/检查表——人工复核 C 编号与封装）' },
      artifacts: arts
    };
    const manifestPath = join(dir, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
    out({ ok: true, dir, project: proj, gates, override: manifest.override.forced,
      artifacts: arts.length, bytes: arts.reduce((a, x) => a + x.bytes, 0), written: manifestPath });
    break;
  }
  case 'pos': {
    const d = loadDesign(args[0]);
    const rows = posRowsOf(d);
    const csv = posCsvOf(rows);
    if (outPath) writeFileSync(outPath, csv);
    out({ ok: true, rows, csv: outPath ? undefined : csv, written: outPath || null,
      note: '坐标已翻转为 CPL 约定（左下原点 y 向上）；JLC 不需镜像（EasyEDA 官方文档核实）；rotation 已按所在面换算（bottom=360-rot）' });
    break;
  }
  case 'erc': {
    out(erc(loadDesign(args[0])));
    break;
  }
  case 'autopcb': {
    const d = loadDesign(args[0]);
    const r = core.placeAndRoute(d, {
      rounds: parseInt(argFlag(rest, '--rounds', '3')),
      iterations: parseInt(argFlag(rest, '--iterations', '4000')),
      maxIter: parseInt(argFlag(rest, '--max-iter', '60')),
      viaCost: Number(argFlag(rest, '--via-cost', '15')),
      // 与 route 一致：已接受的策略开关不能在布局-布线循环中被静默忽略。
      blindVias: !!options.get('--blind-vias'),
      compactPairs: !options.get('--no-compact-pairs'),
      jointReroute: !options.get('--no-joint-reroute'),
      obstacleH: !options.get('--no-obstacle-h'),
      fanoutFirst: ({inner:'inner_first',outer:'outer_first'}[options.get('--fanout-first')]
        || options.get('--fanout-first')),
      anchor: (argFlag(rest, '--anchor', '') || '').split(',').filter(Boolean)
    });
    // 形状补线（阶段三 #12）：对最终布局再做一轮失败网重布；默认关闭
    let shape = null;
    if (argFlag(rest, '--shape-patch', '') && r.best) {
      const window = argFlag(rest, '--shape-window', '');
      const nets = (argFlag(rest, '--shape-nets', '') || '').split(',').map(s => s.trim()).filter(Boolean);
      const sp = core.routeBoardShape(d, { base: r.best,
        shapeWindow: window === '' ? undefined : Number(window),
        shapeNets: nets.length ? nets : undefined });
      r.best = sp.result; shape = sp.shape;
    }
    const designOut = outPath || args[0];
    writeFileSync(designOut, JSON.stringify(d, null, 1));
    const resultOut = argFlag(rest, '--result');
    if (resultOut && r.best) writeFileSync(resultOut, JSON.stringify(r.best, null, 1));
    out({ ok: true, log: r.log, best: r.best ? { status: r.best.status, stats: r.best.stats, overuse: r.best.overuse.length } : null,
          shape, written: { design: designOut, result: resultOut || null } });
    break;
  }
  case 'import': {
    const fmt = args[0];
    const file = args[1];
    if (!file) die('用法：import <easyeda|kicad|dsn> <file> [-o design.json]');
    const text = readFileSync(file, 'utf8');
    let d, report;
    if (fmt === 'easyeda') {
      ({ design: d, report } = core.importEasyEdaPcbFull(text));
    } else if (fmt === 'kicad') {
      d = core.importKiCadPcb(text, { margin: 1.0 });
      report = { pads: d.pads.length, nets: d.nets.length, tracks: 0, vias: 0, notes: ['KiCad 导入不带走线（本工具自己布）'] };
    } else if (fmt === 'dsn') {
      d = core.importDSN(text);
      report = { pads: d.pads.length, nets: d.nets.length, tracks: 0, vias: 0, notes: ['DSN 导入不带走线（布线由 route 生成）'] };
    } else die('未知格式：' + fmt + '（支持 easyeda|kicad|dsn）');
    d = core.normalizeDesign(d);
    if (outPath) writeFileSync(outPath, JSON.stringify(d, null, 1));
    out({ ok: true, format: fmt, ...report, layers: d.layers, width: d.width, height: d.height,
          written: outPath || null, design: outPath ? undefined : d });
    break;
  }
  default:
    die('未知命令：' + cmd + '（可用：schema rules spec place route tune diffz drc drop pdn currents thermal advise export device schem pour bom pos erc autopcb import deliver part verify render）');
}
}
main().catch(e => die(e && e.message ? e.message : String(e)));
