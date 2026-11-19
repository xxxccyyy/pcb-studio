/* exe/board-info.mjs —— 桥与 MCP 共用的纯计算层（只依赖 engine，不碰状态/文件）。
   状态管理（快照/落盘/广播）留在 exe/bridge.mjs 与 exe/mcp.mjs 各自的会话层。 */
import * as engine from '../src/engine.mjs';

/* fp 别名 → 引擎封装名（CLI fp 与 /api/fp 共用） */
export function fpPads(name, n = 0, x = 0, y = 0, prefix = 'U1') {
  if (typeof name !== 'string' || !name || typeof prefix !== 'string' || !prefix)
    throw new Error('封装名和 prefix 必须是非空字符串');
  if (![x, y].every(v => Number.isFinite(v) && Math.abs(v) <= 5000))
    throw new Error('封装坐标必须是 -5000 到 5000 的有限数值');
  if (!Number.isInteger(n) || n < 0 || n > 2000) throw new Error('封装数量必须是 0 到 2000 的整数');
  if (/^DIP-\d+$/.test(name)) {
    n = Number(name.slice(4));
    if (!Number.isInteger(n) || n < 2 || n > 2000) throw new Error('DIP 引脚数必须是 2 到 2000 的整数');
    name = 'DIP-N';
  }
  if (name === 'hdr1') name = '排针 1×N';
  if (name === 'hdr2') name = '排针 2×N';
  const rel = engine.footprintPads(name, Math.max(2, Math.round(n || 0)));
  return { name, count: rel.length,
    pads: rel.map((p, i) => ({ id: prefix + '-' + (i + 1), x: +(x + p.dx).toFixed(3), y: +(y + p.dy).toFixed(3),
      w: p.w, h: p.h, shape: p.shape, layer: p.layer, ...(p.holeR ? { holeR: p.holeR } : {}) })) };
}

const componentId=p=>p.compId || (p.id.includes('-') ? p.id.slice(0,p.id.lastIndexOf('-')) : p.id);

// 焊盘 x/y 是中心坐标；不用 Math.min(...pads)，以免大数组触发参数栈上限。
function padBounds(pads) {
  let x0=Infinity, y0=Infinity, x1=-Infinity, y1=-Infinity;
  for (const p of pads) {
    x0=Math.min(x0,p.x-p.w/2); y0=Math.min(y0,p.y-p.h/2);
    x1=Math.max(x1,p.x+p.w/2); y1=Math.max(y1,p.y+p.h/2);
  }
  return {x0,y0,x1,y1};
}

/* comps 元数据自动同步：从焊盘前缀聚合（AI 漏写 comps → ERC/BOM/CPL/丝印全挂）。
   只补缺失项，绝不覆盖用户已写的数据。返回补建数量。 */
export function syncComps(d) {
  const byComp = new Map();
  for (const p of (d.pads || [])) {
    const c = componentId(p);
    if (!c) continue;
    if (!byComp.has(c)) byComp.set(c, []);
    byComp.get(c).push(p);
  }
  d.comps = d.comps || {};
  let added = 0;
  for (const [c, pads] of byComp) {
    if (Object.hasOwn(d.comps,c) && d.comps[c]) continue;
    const bounds=padBounds(pads);
    const lc = Object.create(null);
    for (const p of pads) lc[p.layer || 'top'] = (lc[p.layer || 'top'] || 0) + 1;
    const layer = Object.entries(lc).sort((a, b) => b[1] - a[1])[0][0];
    Object.defineProperty(d.comps,c,{value:{ x: +((bounds.x0+bounds.x1)/2).toFixed(3),
      y: +((bounds.y0+bounds.y1)/2).toFixed(3), rot: 0,
      layer: layer === 'both' ? 'top' : layer },writable:true,enumerable:true,configurable:true});
    added++;
  }
  return added;
}

/* DRC msg 里解析坐标（checkDRC 的间距类 finding 带 "(12.40, 8.40) mm 附近"） */
export function parseWhere(msg) {
  const S = String(msg);
  const m = /\((\d+\.?\d+),\s*(\d+\.?\d+)\)\s*mm/.exec(S);
  if (m) return { x: +m[1], y: +m[2] };
  const m2 = /\((\d+\.?\d+),\s*(\d+\.?\d+)\)\s*与/.exec(S);   // 过孔间距双坐标格式，取第一个
  return m2 ? { x: +m2[1], y: +m2[2] } : null;
}

/* 语义编辑核心（纯函数）：mutate 传入的 d/r 副本，返回 summary 与修剪信息。
   几何变更自动修剪受影响的走线（result.stale 标记），否则 result 与新坐标错位。 */
export function applyEditOp(d, r, b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new Error('编辑参数必须是对象');
  // 在私有草稿上执行并验证，失败时调用者的对象和嵌套引用完全不变。
  // structuredClone 保留 NaN/Infinity，不能 JSON 往返把非法数值洗成 null。
  const draft=engine.normalizeDesign(structuredClone(d));
  for (const n of draft.nets) if (n.pads!=null && !Array.isArray(n.pads)) throw new Error('网络 pads 必须是数组');
  const request=structuredClone(b), result=r ? structuredClone(r) : null;
  validateEdit(request);
  const out=mutateEditOp(draft,result,request);
  const normalized=engine.normalizeDesign(out.d);
  const commit=(target,source)=>{
    for (const [key,value] of Object.entries(source)) Object.defineProperty(target,key,
      {value,writable:true,enumerable:true,configurable:true});
  };
  commit(d,normalized);
  if (r && out.r) commit(r,out.r);
  return {...out,d,r:r ? r : out.r};
}

function validateEdit(b) {
  const finite=(v,label)=>{if(!Number.isFinite(v)) throw new Error(label+' 必须是有限数值');};
  const id=(v,label)=>{if(typeof v!=='string'||!v) throw new Error(label+' 必须是非空字符串');};
  if (['set-net','add-net','remove-net','clear-net-tracks'].includes(b.op)) id(b.net,'net');
  if (b.op==='move-comp') {
    id(b.comp,'comp');
    for (const k of ['x','y','dx','dy']) if (Object.hasOwn(b,k)) finite(b[k],k);
  }
  if (b.op==='add-net' && b.pads!=null && (!Array.isArray(b.pads) ||
      b.pads.some(v=>typeof v!=='string'||!v) || new Set(b.pads).size!==b.pads.length))
    throw new Error('pads 必须是无重复的焊盘 id 数组');
  if (b.op==='set-pad') id(b.pad,'pad');
  if (b.op==='set-net' && Object.hasOwn(b,'hs') && typeof b.hs!=='boolean') throw new Error('hs 必须是布尔值');
  if (b.op==='set-net' && Object.hasOwn(b,'clr')) {finite(b.clr,'clr');if(b.clr<0) throw new Error('clr 必须非负');}
  const geometry=b.op==='add-pad' ? b.pad : ['set-pad','add-keepout'].includes(b.op) ? b : null;
  if (b.op==='add-pad' && (!geometry || typeof geometry!=='object' || Array.isArray(geometry))) throw new Error('pad 必须是对象');
  if (geometry) for (const k of ['x','y','w','h']) if (Object.hasOwn(geometry,k)) {
    finite(geometry[k],k);
    if ((k==='w'||k==='h') && geometry[k]<=0) throw new Error(k+' 必须大于零');
  }
}

function mutateEditOp(d, r, b) {
  const op = b.op;
  let summary = {};
  const findNet = id => d.nets.find(n => n.id === id);
  const prune = { clearIds: new Set(), rects: [] };   // 几何变更 → 需失效的走线范围
  if (op === 'set-net') {
    const net = findNet(b.net); if (!net) throw new Error('网络不存在：' + b.net);
    const keys = ['w', 'hs', 'preferredLayer', 'clr', 'pair', 'lenGroup'];
    for (const k of keys) if (k in b) net[k] = b[k];
    if ('w' in b || 'preferredLayer' in b || 'clr' in b) prune.clearIds.add(b.net);   // 已有走线与新口径不符
    summary = { net: b.net, changed: keys.filter(k => k in b) };
  } else if (op === 'add-net') {
    if (findNet(b.net)) throw new Error('网络已存在：' + b.net);
    const padIds = b.pads || [];
    for (const id of padIds) {
      const p = d.pads.find(p => p.id === id);
      if (!p) throw new Error('焊盘不存在：' + id);
      if (p.netId && p.netId !== b.net) throw new Error('焊盘 ' + id + ' 已属网络 ' + p.netId + '——先 remove/set-pad 或换焊盘');
    }
    d.nets.push({ id: b.net, pads: padIds, ...(b.w != null ? { w: b.w } : {}) });
    for (const id of padIds) d.pads.find(p => p.id === id).netId = b.net;
    summary = { net: b.net, pads: padIds.length };
  } else if (op === 'remove-net') {
    if (!findNet(b.net)) throw new Error('网络不存在：' + b.net);
    d.nets = d.nets.filter(n => n.id !== b.net);
    for (const p of d.pads) if (p.netId === b.net) p.netId = null;
    prune.clearIds.add(b.net);   // 走线随网清除 + result.stale 标记（与其它几何 op 同口径）
    d.manual = (d.manual || []).filter(m => m.netId !== b.net);
    summary = { net: b.net, removed: true };
  } else if (op === 'move-comp') {
    const pads = d.pads.filter(p => componentId(p) === b.comp);
    if (!pads.length) throw new Error('元件不存在或无焊盘：' + b.comp);
    // bbox 中心口径（与 design.comps[comp].x/y 一致）
    const bounds=padBounds(pads);
    const bcx = (bounds.x0+bounds.x1)/2, bcy = (bounds.y0+bounds.y1)/2;
    const dx = b.x != null ? b.x - bcx : (b.dx || 0);
    const dy = b.y != null ? b.y - bcy : (b.dy || 0);
    const oldBbox = { x: bounds.x0, y: bounds.y0, w: bounds.x1-bounds.x0, h: bounds.y1-bounds.y0 };
    for (const p of pads) { p.x += dx; p.y += dy; }
    prune.rects.push(oldBbox, { x: oldBbox.x + dx, y: oldBbox.y + dy, w: oldBbox.w, h: oldBbox.h });
    for (const p of pads) if (p.netId) prune.clearIds.add(p.netId);
    if (d.comps && Object.hasOwn(d.comps,b.comp) && d.comps[b.comp]) {
      d.comps[b.comp].x = bcx + dx; d.comps[b.comp].y = bcy + dy;
    }
    summary = { comp: b.comp, dx: +dx.toFixed(2), dy: +dy.toFixed(2), pads: pads.length };
  } else if (op === 'set-pad') {
    const p = d.pads.find(p => p.id === b.pad); if (!p) throw new Error('焊盘不存在：' + b.pad);
    const oldNet = p.netId;
    prune.rects.push({x:p.x-p.w/2,y:p.y-p.h/2,w:p.w,h:p.h});
    if (b.net != null && b.net !== p.netId) {
      const on = d.nets.find(n => n.id === p.netId); const nn = findNet(b.net);
      if (!nn) throw new Error('目标网络不存在：' + b.net);
      if (on) on.pads = (on.pads || []).filter(id => id !== p.id);
      nn.pads = [...(nn.pads || []), p.id];
      p.netId = b.net;
    }
    for (const k of ['x', 'y', 'w', 'h']) if (b[k] != null) p[k] = b[k];
    if (oldNet) prune.clearIds.add(oldNet);
    if (p.netId) prune.clearIds.add(p.netId);
    prune.rects.push({ x: p.x - (p.w || 1), y: p.y - (p.h || 1), w: (p.w || 1) * 2, h: (p.h || 1) * 2 });
    summary = { pad: b.pad };
  } else if (op === 'add-pad') {
    const bp = b.pad || {};
    if (!bp.id || bp.x == null || bp.y == null) throw new Error('add-pad 需要 pad:{id,x,y,…}');
    if (d.pads.some(p => p.id === bp.id)) throw new Error('焊盘 id 已存在：' + bp.id);
    if (bp.netId && !findNet(bp.netId)) throw new Error('网络不存在：' + bp.netId);
    // 保留 holeR/compId 等焊盘元数据；padObj 只负责缺省几何字段。
    d.pads.push({...bp,...engine.padObj(bp.id, bp.netId || null, bp.x, bp.y, bp.w, bp.h, bp.shape, bp.layer)});
    if (bp.netId) { const n = findNet(bp.netId); n.pads = [...(n.pads || []), bp.id]; prune.clearIds.add(bp.netId); }
    prune.rects.push({ x: bp.x - (bp.w || 1), y: bp.y - (bp.h || 1), w: (bp.w || 1) * 2, h: (bp.h || 1) * 2 });
    summary = { pad: bp.id };
  } else if (op === 'clear-net-tracks') {
    if (!r) throw new Error('当前没有布线结果');
    r.nets = r.nets.filter(n => n.netId !== b.net);
    d.manual = (d.manual || []).filter(m => m.netId !== b.net);
    r.stale = true;
    summary = { net: b.net, cleared: true };
  } else if (op === 'add-keepout') {
    if (b.x == null || b.y == null || !b.w || !b.h) throw new Error('add-keepout 需要 x,y,w,h');
    d.keepouts = d.keepouts || [];
    d.keepouts.push({ x: b.x, y: b.y, w: b.w, h: b.h });
    prune.rects.push({ x: b.x-b.w/2, y: b.y-b.h/2, w: b.w, h: b.h });
    summary = { keepouts: d.keepouts.length };
  } else if (op === 'sync-comps') {
    summary = { compsAdded: syncComps(d) };
  } else throw new Error('未知 op：' + op + '（可用：set-net/add-net/remove-net/move-comp/set-pad/add-pad/clear-net-tracks/add-keepout/sync-comps）');
  const pruned = pruneResultNets(d, r, prune.clearIds, prune.rects);
  if (pruned && r && !r.stale) r.stale = true;
  return { d, r, summary, pruned };
}

/* 几何编辑后修剪受影响的布线结果：直接清指定网的走线，或清路径落入影响矩形的网。 */
function pruneResultNets(d, r, clearIds, rects) {
  if (!r || (!clearIds.size && !rects.length)) return false;
  const margin = (d.trackW || 0.3) + (d.clearance || 0.3) + 0.1;
  const doomed = new Set();
  for (const n of (r.nets || [])) {
    if (clearIds.has(n.netId)) { doomed.add(n); continue; }
    const trackMargin=Math.max(margin,engine.netW(d,n.netId)/2+d.clearance);
    const hit = rects.some(rc=>{
      const box={x:rc.x+rc.w/2,y:rc.y+rc.h/2,w:rc.w,h:rc.h};
      return (n.paths || []).some(poly=>poly.some((pt,i)=>
        engine.segmentRectDistance(i ? poly[i-1] : pt,pt,box)<=trackMargin)) ||
        (n.vias || []).some(v=>engine.distToRect(v.x,v.y,box.x,box.y,box.w,box.h)<=
          Math.max(margin,(v.outer??d.viaOuter)/2+d.clearance));
    });
    if (hit) doomed.add(n);
  }
  if (!doomed.size) return false;
  r.nets = r.nets.filter(n => !doomed.has(n));
  r.stale = true;
  return true;
}

/* ---------- /api/why：失败法医报告 ---------- */
export function forensicWhy(dRaw, rRaw) {
  const d = engine.normalizeDesign(dRaw);
  // 与 routeBoard 入口同款（engine.mjs:4442）：grid 不足时抬高+焊盘 snap——
  // 否则 result.cells（布线时的新栅格索引）与本 design 的 buildModel 索引错位，ratsnest 出幻影边
  const minGrid = engine.minimumRoutingGrid(d);
  if (d.grid < minGrid - 1e-9) { d.grid = minGrid; engine.snapPadsPreserveGroups(d); }
  const r = rRaw ? engine.normalizeResult(rRaw, d) : { nets: [] };
  const clr = (d.clearance ?? 0.3);
  const tracks = [];
  for (const n of (r.nets || [])) for (const poly of (n.paths || [])) {
    for (let i = 1; i < poly.length; i++) tracks.push({ x1: poly[i-1].x, y1: poly[i-1].y, x2: poly[i].x, y2: poly[i].y, net: n.name || n.netId });
  }
  for (const m of engine.manualRouteEntries(d)) for (const poly of (m.paths || [])) {
    for (let i = 1; i < poly.length; i++) tracks.push({ x1: poly[i-1].x, y1: poly[i-1].y, x2: poly[i].x, y2: poly[i].y, net: (m.name || m.netId) + '（手动）' });
  }
  const edges = engine.computeRatsnest(d, r);
  const byNet = new Map();
  for (const e of edges) { if (!byNet.has(e.netId)) byNet.set(e.netId, []); byNet.get(e.netId).push(e); }
  const wOf = id => { const n = d.nets.find(n => n.id === id); return (n && n.w) || d.trackW; };
  const fails = [];
  for (const [netId, es] of byNet) {
    const net = d.nets.find(n => n.id === netId) || { id: netId };
    const w = wOf(netId);
    const pads = d.pads.filter(p => p.netId === netId);
    const lb = engine.netLowerBound(pads);
    const netTracks = tracks.filter(t => t.net !== (net.name || netId));
    const edgesOut = [];
    for (const e of es.slice(0, 6)) {
      const N = 20, blockedPts = [], blockerMap = new Map();
      for (let i = 0; i <= N; i++) {
        const px = e.x1 + (e.x2 - e.x1) * i / N, py = e.y1 + (e.y2 - e.y1) * i / N;
        const hit = whyHit(d, r, netId, net.name || netId, w, clr, px, py, e, netTracks);
        if (hit) { blockedPts.push({ x: px, y: py, ...hit }); const key = hit.kind + ':' + (hit.id || hit.net);
          if (!blockerMap.has(key)) blockerMap.set(key, { ...hit, hits: 0 }); blockerMap.get(key).hits++; }
      }
      const blockers = [...blockerMap.values()].sort((a, b) => b.hits - a.hits);
      edgesOut.push({ from: { x: +e.x1.toFixed(2), y: +e.y1.toFixed(2) }, to: { x: +e.x2.toFixed(2), y: +e.y2.toFixed(2) },
        lenMm: +(Math.abs(e.x2-e.x1)+Math.abs(e.y2-e.y1)).toFixed(1),
        blockedSamples: blockedPts.length, samples: N + 1,
        blockers: blockers.slice(0, 4),
        worstPoint: blockedPts.length ? { x: +blockedPts[Math.floor(blockedPts.length/2)].x.toFixed(2), y: +blockedPts[Math.floor(blockedPts.length/2)].y.toFixed(2) } : null });
    }
    const fullBlock = edgesOut.filter(e2 => e2.blockedSamples > e2.samples * 0.6).length;
    const clean = edgesOut.filter(e2 => e2.blockedSamples === 0).length;
    const advice = [];
    if (fullBlock) advice.push('直连被固定障碍挡住——挪开阻挡者（见 blockers）或为该网改层/改走法');
    else if (clean === edgesOut.length) advice.push('直连路径无阻挡仍未布通——多为拥塞/换层代价：单独重布该网、降 viaCost 或加层数');
    else advice.push('部分受阻——优先处理 blockers 出现最多的障碍物');
    fails.push({ net: netId, pads: pads.map(p => p.id), lbMm: +lb.toFixed(1), edges: edgesOut, advice });
  }
  fails.sort((a, b) => b.lbMm - a.lbMm);
  const hotspots = r.status ? engine.computeHotspots(d, r) : [];
  // partial 语义分解：全连通+无 overuse 的 partial 来自 route 内部 DRC 错误（drcErrors 注入）——
  // AI 不该把「连通满格的 partial」当失败
  const drcErrCount = Array.isArray(r.drcErrors) ? r.drcErrors.length : ((r.stats && r.stats.drcErrors) || 0);
  const failsN = (r.nets || []).filter(n => n.connected < n.total).length;
  const overN = (r.overuse || []).length;
  const partialReasons = r.status && r.status !== 'complete' ? { fails: failsN, overuse: overN, drcErrors: drcErrCount,
    note: failsN ? failsN + ' 个网未连通' : overN ? '全部连通但存在 ' + overN + ' 个协商冲突格（overuse）'
      : drcErrCount ? '全部连通且无冲突，但 route 内部 DRC 报 ' + drcErrCount + ' 项——跑 drc 看明细'
      : 'route 未标 complete（无 fails/overuse/drcErrors 记录）' } : null;
  return { ok: true, status: r.status || 'unrouted', partialReasons, unroutedEdges: edges.length, fails: fails.slice(0, 8),
    hotspots: hotspots.slice(0, 8), summary: fails.length ? ('共 ' + edges.length + ' 条未连通，最贵的前 ' + Math.min(fails.length, 8) + ' 个网已按理论线长排序') : '全部连通' };
}

/* 单采样点命中检测：异网焊盘 / 异网走线段 / 禁布区 */
function whyHit(d, r, netId, netName, w, clr, px, py, e, netTracks) {
  const need = clr + w / 2;
  let best = null;
  const consider = (kind, id, dist, x, y) => { if (dist < need && (!best || dist < best.dist)) best = { kind, id, dist: +dist.toFixed(3), x: +x.toFixed(2), y: +y.toFixed(2) }; };
  for (const p of d.pads) {
    if (p.netId === netId) continue;
    if (Math.abs(p.x - px) > need + (p.w || 1) || Math.abs(p.y - py) > need + (p.h || 1)) continue;
    const dist = engine.pointPadDistance(px, py, p);
    consider('pad', p.id, dist, p.x, p.y);
  }
  for (const t of netTracks) {
    if (px < Math.min(t.x1, t.x2) - need || px > Math.max(t.x1, t.x2) + need
      || py < Math.min(t.y1, t.y2) - need || py > Math.max(t.y1, t.y2) + need) continue;   // bbox 预滤
    const dist = engine.segDist(px, py, t.x1, t.y1, t.x2, t.y2);
    consider('track', t.net, dist, (t.x1 + t.x2) / 2, (t.y1 + t.y2) / 2);
  }
  for (const k of (d.keepouts || [])) {
    const dx = Math.max(k.x-k.w/2-px,0,px-(k.x+k.w/2)), dy = Math.max(k.y-k.h/2-py,0,py-(k.y+k.h/2));
    const dist = Math.sqrt(dx*dx + dy*dy);
    consider('keepout', '禁布区', dist, px, py);
  }
  return best;
}

/* ---------- connected 重算：manual 注入/编辑后 result.nets 的静态快照会过期 ----------
   2026-11-19 假绿整改：旧实现「逐点落走廊」只判焊盘是否落在某段走廊上，不判各段
   彼此是否连通——n5/n6/n18 三网各断成 2 分量仍报 95/95（审计实锤）。现替换为
   连通分量判定，与引擎 computeRatsnest 同口径：
     铜格 = result.cells（权威）或 paths 走廊标记 ∪ manual 走廊 ∪ 铜皮逐格心判定
     分量 = 4 邻域 BFS + 过孔跨层 + 同焊盘覆盖单元互连（engine.mjs:7360 同式）
   connected = 最大分量的焊盘数（物理诚实口径，多组断链绝不虚高）；
   另记 rn.groups = 分量数、rn.split = 各组焊盘清单（/api/why 断链定位用）。
   无任何铜格的网报 0（与引擎路由统计 countConn 口径一致，unrouted 不虚报 1）。 */
export function refreshConn(dRaw, rRaw) {
  const d = engine.normalizeDesign(dRaw);
  const minGrid = engine.minimumRoutingGrid(d);
  if (d.grid < minGrid - 1e-9) { d.grid = minGrid; engine.snapPadsPreserveGroups(d); }
  const r = engine.normalizeResult(rRaw, d);
  const manualEntries = engine.manualRouteEntries(d);
  const pourList = [...(Array.isArray(r.pours) ? r.pours : r.pour ? [r.pour] : [])].filter(Boolean);
  const model = engine.buildModel(d);
  const { GW, GH, L, NC } = model;
  const grid = model.grid;
  const cellOf = (x, y) => {
    const i = Math.max(0, Math.min(GW - 1, Math.floor(x / grid - 0.5)));
    const j = Math.max(0, Math.min(GH - 1, Math.floor(y / grid - 0.5)));
    return j * GW + i;
  };
  // 走廊标记：段矩形遍历 + segDist ≤ 半线宽+半格对角（格方块与段相交即标记，
  // 45° 斜线沿格角穿越不断链——engine computeRatsnest manual 标记同式）
  const markCorridor = (cells, netId, a, b, l) => {
    if (a.l !== b.l || a.l !== l) return;
    const r2 = engine.netW(d, netId) / 2 + grid * 0.71 + 1e-6;
    const x0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - r2) / grid - 0.5));
    const x1 = Math.min(GW - 1, Math.floor((Math.max(a.x, b.x) + r2) / grid - 0.5));
    const y0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - r2) / grid - 0.5));
    const y1 = Math.min(GH - 1, Math.floor((Math.max(a.y, b.y) + r2) / grid - 0.5));
    for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
      const cx = (xx + 0.5) * grid, cy = (yy + 0.5) * grid;
      if (engine.segDist(cx, cy, a.x, a.y, b.x, b.y) <= r2) cells.add(l * NC + yy * GW + xx);
    }
  };
  for (const net of d.nets) {
    const rn = (r.nets || []).find(x => x.netId === net.id);
    const pads = d.pads.filter(p => p.netId === net.id);
    if (!rn || !pads.length) continue;
    rn.total = pads.length;
    if (pads.length < 2) { rn.connected = pads.length; continue; }
    let vouchedIds = null;   // 每网重置——var 提升跨网残留会把别网的背书盘塞进本网组（实测回归）

    // —— 本网铜格：result.cells 权威；无则 paths 端点+走廊标记（外部导入结果）——
    const cells = new Set(), viaCells = new Set();
    if (rn.cells && rn.cells.length) for (const s of rn.cells) cells.add(s);
    else {
      for (const poly of rn.paths || []) for (const pt of poly) cells.add(pt.l * NC + cellOf(pt.x, pt.y));
      for (const poly of rn.paths || []) for (let k = 1; k < poly.length; k++) markCorridor(cells, net.id, poly[k - 1], poly[k], poly[k].l);
    }
    // manual 走廊（换层点按过孔计）
    for (const m of manualEntries) {
      if (m.netId !== net.id) continue;
      for (const poly of m.paths || []) {
        for (const pt of poly) cells.add(pt.l * NC + cellOf(pt.x, pt.y));
        for (let k = 1; k < poly.length; k++) markCorridor(cells, m.netId, poly[k - 1], poly[k], poly[k].l);
      }
      for (const v of m.vias || []) viaCells.add(cellOf(v.x, v.y));
    }
    for (const v of rn.vias || []) viaCells.add(cellOf(v.x, v.y));
    // 缝合/回流孔在 design.stitching（pour 命令写入，不进 rn.vias）——GND 顶层盘
    // 靠它们接入底层铜皮，漏计会把已接好判成断链
    for (const v of (d.stitching || [])) {
      if (v.netId === net.id) viaCells.add(cellOf(v.x, v.y));
    }
    // 铜皮：逐格心 pourContains（含避让孔洞，焊盘落入即接入）
    const mp = pourList.find(p => p.netId === net.id);
    if (mp && Number.isInteger(mp.layer)) {
      for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
        if (engine.pourContains(mp, (i + 0.5) * grid, (j + 0.5) * grid)) cells.add(mp.layer * NC + j * GW + i);
      }
      // 热焊盘辐条语义（2026-11-20）：pour 自己的连通判定（unconnectedPads）认辐条
      // 接触——格心采样会漏掉细辐条。背书盘（非 unconnectedPads）直接并入铜皮
      // 主分量：BFS 后把背书盘指到铜格最多的分量（= pour 主片）。
      const vouched = Array.isArray(mp.unconnectedPads)
        ? pads.filter(p => !mp.unconnectedPads.includes(p.id))
        : pads;
      vouchedIds = new Set(vouched.map(p => p.id));
    }

    if (!cells.size) { rn.connected = 0; rn.groups = pads.length; continue; }

    // —— 连通分量：4 邻域 BFS + viaCells 跨层 + 同焊盘覆盖单元互连 ——
    const padStates = pads.map(p => model.padCells.get(p.id) || []);
    const cellPads = new Map();
    padStates.forEach((sts, pi) => { for (const s of sts) { if (!cellPads.has(s)) cellPads.set(s, []); cellPads.get(s).push(pi); } });
    const relevant = new Set(cells);
    for (const sts of padStates) for (const s of sts) relevant.add(s);
    const comp = new Map();
    let cid = 0;
    for (const s0 of relevant) {
      if (comp.has(s0)) continue;
      cid++;
      const q = [s0]; comp.set(s0, cid);
      for (let qi = 0; qi < q.length; qi++) {
        const cur = q[qi], c = cur % NC, l = (cur / NC) | 0;
        const nbs = [];
        if (c % GW > 0) nbs.push(cur - 1);
        if (c % GW < GW - 1) nbs.push(cur + 1);
        if (c >= GW) nbs.push(cur - GW);
        if (c < GW * (GH - 1)) nbs.push(cur + GW);
        if (viaCells.has(c)) for (let ll = 0; ll < L; ll++) if (ll !== l) nbs.push(ll * NC + c);
        for (const pi of (cellPads.get(cur) || [])) for (const s of padStates[pi]) nbs.push(s);
        for (const nb of nbs) if (relevant.has(nb) && !comp.has(nb)) { comp.set(nb, cid); q.push(nb); }
      }
    }
    const groups = new Map();
    for (let pi = 0; pi < pads.length; pi++) {
      let g = 'iso' + pi;   // 无铜格交叠的焊盘自成一组
      for (const s of padStates[pi]) if (comp.has(s)) { g = comp.get(s); break; }
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(pads[pi].id);
    }
    // 背书盘并入铜皮主分量（铜格数最多的组 = pour 主片；辐条接触的物理事实）。
    // 并查合并语义（2026-11-20 fable-02 实测教训）：只做组间 UNION——背书盘若已在
    // 某走线组里，把该组整个并进 pour 组，绝不把盘从既有连线组里拽出来。
    if (vouchedIds && vouchedIds.size) {
      const compCellCount = new Map();
      for (const s of cells) {
        const c = comp.get(s);
        if (c != null) compCellCount.set(c, (compCellCount.get(c) || 0) + 1);
      }
      let pourComp = null, best = 0;
      for (const [c, n] of compCellCount) if (n > best) { best = n; pourComp = c; }
      if (pourComp != null) {
        const pourKey = String(pourComp);
        if (!groups.has(pourKey)) groups.set(pourKey, []);
        const groupOf = new Map();
        for (const [g, members] of groups) for (const id of members) groupOf.set(id, g);
        const mergeInto = (from, to) => {
          if (from === to || !groups.has(from)) return;
          const fromArr = groups.get(from);
          groups.set(to, [...groups.get(to), ...fromArr]);
          groups.delete(from);
          for (const id of fromArr) groupOf.set(id, to);
        };
        for (const id of vouchedIds) {
          const g = groupOf.get(id);
          if (g != null) mergeInto(g, pourKey);
          else groups.get(pourKey).push(id);
        }
      }
    }
    let largest = 0;
    for (const members of groups.values()) if (members.length > largest) largest = members.length;
    rn.connected = largest;
    rn.groups = groups.size;
    if (groups.size > 1) rn.split = [...groups.values()].filter(g => g.length > 0);
    else delete rn.split;
  }
  let connected = 0, total = 0;
  for (const n of (r.nets || [])) { connected += n.connected || 0; total += n.total || 0; }
  r.stats = { ...(r.stats || {}), connected, total };
  r.manualTouched = true;
  return r;
}

/* ---------- /api/verify-path：候选手工走线验证（视觉布线的安全网） ----------
   逐点检查候选折线与异网焊盘/走线/禁布区的间距（层匹配；端点 1.5mm 近邻豁免——
   逃逸的物理现实）。全部干净才允许注入。 */
export function validatePath(dRaw, rRaw, netId, pts) {
  const d = engine.normalizeDesign(dRaw);
  const minGrid = engine.minimumRoutingGrid(d);
  if (d.grid < minGrid - 1e-9) { d.grid = minGrid; engine.snapPadsPreserveGroups(d); }
  const r = rRaw ? engine.normalizeResult(rRaw, d) : { nets: [] };
  const net = d.nets.find(n => n.id === netId);
  if (!net) throw new Error('未知网络：' + netId);
  const w = net.w || d.trackW;
  const need = (d.clearance ?? 0.3) + w / 2;
  const violations = [];
  const segs = [];
  for (let i = 1; i < pts.length; i++) segs.push([pts[i - 1], pts[i]]);
  for (const [a, b] of segs) {
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    const N = Math.max(2, Math.ceil(L / 0.25));
    for (let k = 0; k <= N; k++) {
      const px = a.x + (b.x - a.x) * k / N, py = a.y + (b.y - a.y) * k / N;
      const nearEndpoint = Math.hypot(px - pts[0].x, py - pts[0].y) < 1.5
        || Math.hypot(px - pts[pts.length - 1].x, py - pts[pts.length - 1].y) < 1.5;
      // 异网焊盘（层匹配：top 段撞 top/both；非顶层段撞 bottom/both）
      for (const p of d.pads || []) {
        if (p.netId === netId) continue;
        const padTop = p.layer === 'top' || p.layer === 'both';
        const padBottom = p.layer === 'bottom' || p.layer === 'both';
        if (a.l === 0 && !padTop) continue;
        if (a.l !== 0 && !padBottom) continue;
        if (nearEndpoint) continue;
        if (px > p.x - p.w / 2 - need && px < p.x + p.w / 2 + need && py > p.y - p.h / 2 - need && py < p.y + p.h / 2 + need)
          violations.push({ kind: 'pad', id: p.id, net: p.netId, at: { x: +px.toFixed(2), y: +py.toFixed(2) } });
      }
      // 异网走线（同层）
      for (const n2 of (r.nets || [])) {
        if (n2.netId === netId) continue;
        for (const poly of n2.paths || []) for (let s2 = 1; s2 < poly.length; s2++) {
          const c = poly[s2 - 1], e = poly[s2];
          if (c.l !== a.l) continue;
          const dx = e.x - c.x, dy = e.y - c.y, L2 = dx * dx + dy * dy;
          let t = L2 > 0 ? ((px - c.x) * dx + (py - c.y) * dy) / L2 : 0;
          t = Math.max(0, Math.min(1, t));
          const dist = Math.hypot(c.x + t * dx - px, c.y + t * dy - py) - w / 2 - ((d.nets.find(nn => nn.id === n2.netId) || {}).w || d.trackW) / 2;
          if (dist < (d.clearance ?? 0.3))
            violations.push({ kind: 'track', net: n2.netId, at: { x: +px.toFixed(2), y: +py.toFixed(2) }, dist: +dist.toFixed(3) });
        }
      }
      // 禁布区
      for (const kk of (d.keepouts || [])) {
        if (px > kk.x - need && px < kk.x + kk.w + need && py > kk.y - need && py < kk.y + kk.h + need)
          violations.push({ kind: 'keepout', at: { x: +px.toFixed(2), y: +py.toFixed(2) } });
      }
    }
  }
  // 去重（同一障碍物多点命中只留一条）
  const seen = new Set();
  const uniq = violations.filter(v => { const k = v.kind + ':' + (v.id || v.net) + ':' + v.at.x + ',' + v.at.y; if (seen.has(k)) return false; seen.add(k); return true; });
  return { ok: uniq.length === 0, netId, violations: uniq.slice(0, 20), total: uniq.length,
    hint: uniq.length ? '调整航点绕开违规点（换层/换走廊）；端点近邻已豁免' : '路径干净——可注入 design.manual' };
}

/* ---------- /api/estimate：布线前预估 ---------- */
export function estimateBoard(dRaw) {
  const d = engine.normalizeDesign(dRaw);
  const grid = engine.minimumRoutingGrid(d);
  const perLayer = (d.width * d.height) / Math.max(grid, 1e-6);
  const usable = perLayer * 0.35 * (d.layers || 2);   // 经验利用率：焊盘/过孔/换向损耗
  let totalLB = 0; const rows = [];
  for (const n of d.nets) {
    const pads = d.pads.filter(p => p.netId === n.id);
    const lb = pads.length >= 2 ? engine.netLowerBound(pads) : 0;
    totalLB += lb;
    rows.push({ net: n.id, pads: pads.length, lbMm: +lb.toFixed(1), w: n.w || d.trackW });
  }
  rows.sort((a, b) => b.lbMm - a.lbMm);
  const demand = totalLB * 1.25;                       // 绕行系数
  const margin = demand > 0 ? usable / demand : Infinity;
  const verdict = margin >= 2.5 ? { verdict: '2 层可行', code: 'ok2', advice: '容量余量大，直接布。' }
    : margin >= 1.5 ? { verdict: '2 层紧张', code: 'tight', advice: '考虑缩小板框浪费、优先 4 层，或接受多轮协商。' }
    : { verdict: '建议 4 层', code: 'need4', advice: '理论线长已接近 2 层容量——加层（SIG-GND-PWR-SIG）或加大板框。' };
  const jlc = engine.jlcTrackRule(d);
  const thin = rows.filter(x => x.w < jlc.limit);
  return { ok: true, width: d.width, height: d.height, layers: d.layers, grid,
    netRows: rows.slice(0, 12), totalLbMm: +totalLB.toFixed(1),
    capacity: { perLayerMm: +perLayer.toFixed(0), usableMm: +usable.toFixed(0), model: '满铺/栅格 × 0.35 利用率（经验口径）' },
    verdict: { ...verdict, margin: Number.isFinite(margin) ? +margin.toFixed(2) : null, demandMm: +demand.toFixed(0), disclaimer: '启发式预估，仅供参考——最终以真实 route 为准' },
    trackRule: { ...jlc, thinNets: thin.map(x => x.net) } };
}

/* ---------- /api/summary：状态摘要 ---------- */
export function boardSummary(dRaw, rRaw, meta = {}) {
  const d = engine.normalizeDesign(dRaw);
  // 2026-11-20 假绿整改：摘要的连通口径必须实时诚实重算（连通分量 + 铜皮背书 +
  // 缝合孔）——CLI recount 发生在 pour 之前，result.stats 里的旧值会把已接入的
  // 铜皮网报成断链（fable-02 实测 63/112 vs 实际 109/112）。
  const r = rRaw ? refreshConn(dRaw, rRaw) : null;
  const nets = d.nets.map(n => {
    const rn = r ? (r.nets || []).find(x => x.netId === n.id) : null;
    return { id: n.id, pads: (n.pads && n.pads.length ? n.pads : d.pads.filter(p => p.netId === n.id).map(p => p.id)).length,
      w: n.w || d.trackW, pair: n.pair || undefined,
      connected: rn ? rn.connected : null, total: rn ? rn.total : null };
  });
  return { ok: true, name: meta.name, width: d.width, height: d.height, layers: d.layers, grid: d.grid,
    trackW: d.trackW, clearance: d.clearance,
    counts: { pads: d.pads.length, nets: d.nets.length, comps: Object.keys(d.comps || {}).length,
      keepouts: (d.keepouts || []).length, manual: (d.manual || []).length, stitching: (d.stitching || []).length },
    status: r ? r.status : 'unrouted', stale: !!(r && r.stale),
    connected: r && r.stats ? r.stats.connected + '/' + r.stats.total : null,
    overuse: r ? (r.overuse || []).length : null,
    drcErrors: r ? (Array.isArray(r.drcErrors) ? r.drcErrors.length : 0) : null,
    sessionResident: !!meta.sessionResident, nets };
}

/* ---------- /api/query：结构化查询 ---------- */
export function boardQuery(dRaw, rRaw, q) {
  const d = engine.normalizeDesign(dRaw);
  const r = rRaw ? engine.normalizeResult(rRaw, d) : null;
  if (q.net) {
    const n = d.nets.find(x => x.id === q.net || x.name === q.net);
    if (!n) throw new Error('未知网络：' + q.net);
    const pads = d.pads.filter(p => p.netId === n.id)
      .map(p => ({ id: p.id, x: p.x, y: p.y, w: p.w, h: p.h, layer: p.layer, holeR: p.holeR || undefined,
        comp: componentId(p) }));
    const rn = r ? (r.nets || []).find(x => x.netId === n.id) : null;
    const lb = engine.netLowerBound(d.pads.filter(p => p.netId === n.id));
    const routedLen = rn && rn.paths ? (rn.paths || []).reduce((s, poly) =>
      s + poly.slice(1).reduce((a, pt, i) => a + Math.hypot(pt.x - poly[i].x, pt.y - poly[i].y), 0), 0) : 0;
    const unrouted = engine.computeRatsnest(d, r || undefined).filter(e => e.netId === n.id)
      .map(e => ({ from: { x: +e.x1.toFixed(2), y: +e.y1.toFixed(2) }, to: { x: +e.x2.toFixed(2), y: +e.y2.toFixed(2) },
        lenMm: +(Math.abs(e.x2 - e.x1) + Math.abs(e.y2 - e.y1)).toFixed(1) }));
    return { ok: true, kind: 'net', id: n.id, w: n.w || d.trackW, hs: n.hs || undefined, pair: n.pair || undefined,
      pads, lbMm: +lb.toFixed(1), routedLenMm: +routedLen.toFixed(1), vias: rn ? (rn.vias || []).length : 0,
      connected: rn ? rn.connected : null, total: rn ? rn.total : null, unroutedEdges: unrouted };
  }
  if (q.comp) {
    const pads = d.pads.filter(p => (componentId(p)) === q.comp);
    if (!pads.length) throw new Error('未知元件：' + q.comp);
    return { ok: true, kind: 'comp', id: q.comp,
      pads: pads.map(p => ({ id: p.id, netId: p.netId, x: p.x, y: p.y, w: p.w, h: p.h, layer: p.layer, holeR: p.holeR || undefined })),
      nets: [...new Set(pads.map(p => p.netId).filter(Boolean))],
      bbox: padBounds(pads),
      meta: (d.comps || {})[q.comp] || null };
  }
  if (q.pad) {
    const p = d.pads.find(x => x.id === q.pad);
    if (!p) throw new Error('未知焊盘：' + q.pad);
    const rn = r ? (r.nets || []).find(x => x.netId === p.netId) : null;
    return { ok: true, kind: 'pad', pad: p, net: p.netId,
      comp: componentId(p),
      netRouted: rn ? { connected: rn.connected, total: rn.total, paths: (rn.paths || []).length, vias: (rn.vias || []).length } : null };
  }
  throw new Error('需要 net/comp/pad 查询参数之一');
}

/* ---------- /api/drc-live：进程内 DRC + 违规坐标定位 ---------- */
export function drcLive(dRaw, rRaw) {
  const d = engine.normalizeDesign(dRaw);
  const r = rRaw ? engine.normalizeResult(rRaw, d) : { nets: [] };
  const findings = engine.checkDRC(d, r).map(f => {
    let where = parseWhere(f.msg);
    if (!where) {   // msg 不带坐标时回退：引用的焊盘 id → 焊盘中心（如「焊盘 X1-1 与 X2-1 重叠」）
      const m = /焊盘\s+([A-Za-z0-9_-]+)/.exec(String(f.msg));
      const p = m && (d.pads || []).find(x => x.id === m[1]);
      if (p) where = { x: p.x, y: p.y };
    }
    return { ...f, where };
  });
  const fab = engine.fabChecklist(d, r, {});
  return { ok: true,
    errors: findings.filter(f => f.sev === 'error').length, warnings: findings.filter(f => f.sev === 'warn').length,
    findings, fabChecklist: fab, located: findings.filter(f => f.where).length,
    hint: 'where 有坐标的违规可 GET /api/view?region=<x-2>,<y-2>,5,5 目检特写；fabFail 不可交付' };
}

/* ---------- /api/diff：A/B 判分 ---------- */
export function diffResults(dRaw, aRaw, bRaw) {
  const d = engine.normalizeDesign(dRaw);
  const prep = x => { const r = engine.normalizeResult(x, d);
    return { status: r.status, connected: r.stats ? r.stats.connected : null, total: r.stats ? r.stats.total : null,
      vias: r.stats ? r.stats.vias : 0, trackLenMm: +(r.stats ? r.stats.trackLen : 0).toFixed(1), score: engine.routeScore(r) }; };
  const A = prep(aRaw), B = prep(bRaw);
  const aBetter = engine.scoreBetter(A.score, B.score), bBetter = engine.scoreBetter(B.score, A.score);
  const labels = ['complete(0/1)', 'fails', 'drcErrors', 'overuse', 'vias', 'trackLen×10mm'];
  const delta = {}; labels.forEach((k, i) => { delta[k] = +(B.score[i] - A.score[i]); });
  return { ok: true, scoreLabels: labels, a: A, b: B, delta,
    verdict: aBetter && !bBetter ? 'a 更优' : bBetter && !aBetter ? 'b 更优' : '平手',
    tiebreak: '字典序 routeScore：连通→失败→DRC→overuse→过孔→线长' };
}
