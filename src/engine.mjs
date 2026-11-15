'use strict';
/* ============================================================
   PCB 自动布线工具 —— 算法核心（纯逻辑，无 DOM 依赖，可独立测试）
   ============================================================ */
// ==== ROUTER CORE START ====

function designDefaults(){
  return {
    width:60, height:40, grid:0.5, layers:2,
    trackW:0.3, clearance:0.2, viaOuter:0.8, viaDrill:0.4,
    copperWeight:'1',
    nets:[], pads:[], keepouts:[], manual:[], stitching:[]
  };
}

// Normalize at external boundaries; placement may intentionally start with out-of-board pads.
function normalizeDesign(input){
  if(!input||typeof input!=='object'||Array.isArray(input)) throw new Error('Design must be an object');
  const d={...designDefaults(),...input};
  for(const key of ['width','height','grid','trackW','viaOuter','viaDrill'])
    if(!Number.isFinite(d[key])||d[key]<=0) throw new Error(key+' must be a positive finite number');
  if(!Number.isFinite(d.clearance)||d.clearance<0) throw new Error('clearance must be a nonnegative finite number');
  if(![1,2,4].includes(d.layers)) throw new Error('layers must be 1, 2 or 4');
  if(d.viaDrill>d.viaOuter) throw new Error('viaDrill must not exceed viaOuter');
  if(d.coating!=null&&d.coating!=='bare'&&d.coating!=='coated')
    throw new Error('design.coating 必须是 "bare"|"coated"（缺省 bare=外层无涂层，IPC-2221B B4 最严档）');
  for(const key of ['nets','pads','keepouts','manual','stitching']){
    if(!Array.isArray(d[key])) throw new Error(key+' must be an array');
  }
  if(d.nets.length>32766) throw new Error('Too many nets (maximum 32766)');
  for(const key of ['nets','pads']){
    const ids=new Set();
    for(const item of d[key]){
      if(!item||typeof item.id!=='string'||!item.id||ids.has(item.id)) throw new Error(key+' requires unique, nonempty string ids');
      ids.add(item.id);
    }
  }
  d.nets=d.nets.map(n=>{
    if(n.w!=null&&(!Number.isFinite(n.w)||n.w<=0)) throw new Error('Invalid net width: '+n.id);
    if(n.tr!=null&&(!Number.isFinite(n.tr)||n.tr<=0)) throw new Error('Invalid net rise time (ns): '+n.id);
    if(n.pair!=null&&(typeof n.pair!=='string'||!n.pair)) throw new Error('Invalid pair (expect nonempty string group name): '+n.id);
    if(n.lenGroup!=null&&(typeof n.lenGroup!=='string'||!n.lenGroup)) throw new Error('Invalid lenGroup (expect nonempty string group name): '+n.id);
    // preferredLayer（0.14.7 批次5 探针级）：'top'/'bottom'/层号整数 → 规范化层号。
    // 语义 = 硬层位约束（该网 A* 扩展限制在指定层）。代价偏好变体未实现（批次4 留档）。
    const q={...n,name:n.name==null?n.id:String(n.name)};
    if(q.preferredLayer!=null){
      const L=Math.max(1,d.layers|0);
      const pl=q.preferredLayer==='top'?0
        :(q.preferredLayer==='bottom'?L-1
        :(Number.isInteger(q.preferredLayer)?q.preferredLayer:null));
      if(pl==null||pl<0||pl>=L) throw new Error('Invalid preferredLayer (expect "top"|"bottom"|integer layer index): '+n.id);
      q.preferredLayer=pl;
    }
    return q;
  });
  const rect=(p,label)=>{
    if(!p||!['x','y','w','h'].every(k=>Number.isFinite(p[k]))||p.w<=0||p.h<=0) throw new Error('Invalid geometry: '+label);
  };
  d.pads=d.pads.map(p=>{
    const q={shape:'rect',layer:'both',...p};
    if(q.shape==='circle') q.h=q.w;
    rect(q,p.id);
    if(!['rect','circle'].includes(q.shape)||!['top','bottom','both'].includes(q.layer)) throw new Error('Invalid pad shape/layer: '+p.id);
    if(q.holeR!=null&&(!Number.isFinite(q.holeR)||q.holeR<0)) throw new Error('Invalid pad hole: '+p.id);
    return q;
  });
  d.keepouts.forEach((k,i)=>rect(k,'keepout '+i));
  const point=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
  for(const s of d.stitching) if(!point(s)) throw new Error('Invalid stitching point');
  for(const m of d.manual){
    if(!m||!Array.isArray(m.pts)||m.pts.length<2||m.pts.some(p=>!point(p)||!Number.isInteger(p.l)||p.l<0||p.l>=d.layers))
      throw new Error('Invalid manual route');
  }
  applyConstraintRules(d);
  return d;
}

/* ---------- 约束系统 rules schema（roadmap #10：生成器惯用法错误的根治）----------
   design.rules 声明式约束在 normalizeDesign 单向展开为扁平字段——扁平模型
   （nets[].w/tr/pair/lenGroup/diffZ + keepouts[].scope）仍是唯一事实源，全部
   消费方零改动。展开幂等（重复 normalize 结果一致）。**冲突即错误**：网字段与
   class 不一致、引用悬空、pair 非 2 成员——报错而非静默取优先级（生成器必须
   改 spec，惯用法错误家族在 spec 阶段即拦截）。

   rules = {
     classes:  { 类名: { w?, tr? } },                     // 网类线宽/上升时间
     netClass: { 网名: 类名 },                            // 网归类
     pairs:    [ { group, nets:[A,B], z?, gap? } ],       // 差分对 → nets[].pair/diffZ
     lengths:  [ { group, nets:[...], tolerance?, target? } ],  // 等长组 → nets[].lenGroup
     keepouts: [ { x,y,w,h } | { rects:[...], class?, } ] // class keepout：仅阻挡非本类网
   }
   keepout 作用域语义（KiCad zone 限制网类同思想）：scope=类名的 keepout 对该类
   网自由、对异类网是障碍——路由 passable/过孔 viaLegal/DRC/美化/布局罚分全链
   同口径。 */
function applyConstraintRules(d){
  const R=d.rules;
  if(R==null) return d;
  if(typeof R!=='object'||Array.isArray(R)) throw new Error('rules 必须是对象');
  const classes=R.classes!=null?R.classes:{};
  if(typeof classes!=='object'||Array.isArray(classes)) throw new Error('rules.classes 必须是对象');
  for(const [cn,c] of Object.entries(classes)){
    if(!c||typeof c!=='object'||Array.isArray(c)) throw new Error('rules.classes.'+cn+' 必须是对象');
    for(const key of ['w','tr','clr'])
      if(c[key]!=null&&(!Number.isFinite(c[key])||c[key]<=0))
        throw new Error('rules.classes.'+cn+'.'+key+' 必须是正数');
  }
  const netClass=R.netClass!=null?R.netClass:{};
  if(typeof netClass!=='object'||Array.isArray(netClass)) throw new Error('rules.netClass 必须是对象（网名→类名）');
  const byName=new Map(d.nets.map(n=>[n.name,n]));
  for(const [nm,cn] of Object.entries(netClass)){
    if(typeof cn!=='string'||!cn) throw new Error('rules.netClass.'+nm+' 类名必须是非空字符串');
    if(!classes[cn]) throw new Error('rules.netClass.'+nm+' 引用未定义的 class「'+cn+'」（classes 键：'+Object.keys(classes).join(',')+'）');
    const n=byName.get(nm);
    if(!n) throw new Error('rules.netClass.'+nm+' 引用不存在的网络「'+nm+'」（现有网：'+d.nets.map(x=>x.name).join(',')+'）');
    // 冲突即错误（幂等安全：已展开值与 class 一致 → 放行）
    if(classes[cn].w!=null&&n.w!=null&&Math.abs(n.w-classes[cn].w)>1e-12)
      throw new Error('网络 '+nm+' 线宽 '+n.w+' 与 class '+cn+' 的 w='+classes[cn].w+' 冲突——删掉一处（二选一）');
    if(classes[cn].w!=null&&n.w==null) n.w=classes[cn].w;
    if(classes[cn].tr!=null&&n.tr!=null&&Math.abs(n.tr-classes[cn].tr)>1e-12)
      throw new Error('网络 '+nm+' 上升时间 '+n.tr+' 与 class '+cn+' 的 tr='+classes[cn].tr+' 冲突——删掉一处');
    if(classes[cn].tr!=null&&n.tr==null) n.tr=classes[cn].tr;
    // 类级间距（0.14.7 批次2 D2）：netClr 第三来源——经 netClr 进入影响区/DRC/检查表
    if(classes[cn].clr!=null&&n.clr!=null&&Math.abs(n.clr-classes[cn].clr)>1e-12)
      throw new Error('网络 '+nm+' 间距 '+n.clr+' 与 class '+cn+' 的 clr='+classes[cn].clr+' 冲突——删掉一处（二选一）');
    if(classes[cn].clr!=null&&n.clr==null) n.clr=classes[cn].clr;
  }
  // 差分对：{ group, nets:[A,B], z? } → 成员网 pair=group、diffZ=z（KiCad/Altium 同语义）
  if(R.pairs!=null){
    if(!Array.isArray(R.pairs)) throw new Error('rules.pairs 必须是数组');
    const pairSeen=new Map();   // 网名 → 组名（查重）
    for(const p of R.pairs){
      if(!p||typeof p.group!=='string'||!p.group) throw new Error('rules.pairs[] 缺 group（非空字符串）');
      if(!Array.isArray(p.nets)||p.nets.length!==2)
        throw new Error('rules.pairs.'+p.group+' 的 nets 必须是恰好 2 个网名的数组（差分对定义）');
      for(const nm of p.nets){
        if(typeof nm!=='string') throw new Error('rules.pairs.'+p.group+'.nets 成员必须是网名');
        const n=byName.get(nm);
        if(!n) throw new Error('rules.pairs.'+p.group+' 引用不存在的网络「'+nm+'」');
        if(n.pair!=null&&n.pair!==p.group)
          throw new Error('网络 '+nm+' 已属于差分对「'+n.pair+'」，不能同时加入「'+p.group+'」');
        if(pairSeen.has(nm)&&pairSeen.get(nm)!==p.group)
          throw new Error('网络 '+nm+' 出现在两个差分对里（'+pairSeen.get(nm)+' 与 '+p.group+'）');
        pairSeen.set(nm,p.group);
        n.pair=p.group;
        if(p.z!=null){
          if(!Number.isFinite(p.z)||p.z<=0) throw new Error('rules.pairs.'+p.group+'.z 必须是正数（目标差分阻抗 Ω）');
          if(n.diffZ!=null&&Math.abs(n.diffZ-p.z)>1e-12)
            throw new Error('网络 '+nm+' 的 diffZ='+n.diffZ+' 与 rules.pairs.'+p.group+'.z='+p.z+' 冲突');
          n.diffZ=p.z;
        }
        // 显式耦合间隙（批次 3）：用叠层工具算得的 mm 间隙直接覆写反查值——
        // 成员两网必须一致（差分对单间隙），冲突即错误（幂等安全同 z）
        if(p.gap!=null){
          if(!Number.isFinite(p.gap)||p.gap<=0) throw new Error('rules.pairs.'+p.group+'.gap 必须是正数（mm 耦合间隙）');
          // gap 语义 = 对内边到边间隙（与 sFor 同口径；bandCenter=(wM+wO)/2+gap）。
          // 下界是 DRC 间距而非线宽（0.3mm 线 0.15mm 缝完全合法），低于间距必 DRC 违规。
          if(p.gap<d.clearance) throw new Error('rules.pairs.'+p.group+'.gap='+p.gap+' < 间距 '+d.clearance+'（对内间隙边到边，低于全局间距必 DRC 违规）');
          if(n.pairGap!=null&&Math.abs(n.pairGap-p.gap)>1e-12)
            throw new Error('网络 '+nm+' 的 pairGap='+n.pairGap+' 与 rules.pairs.'+p.group+'.gap='+p.gap+' 冲突');
          n.pairGap=p.gap;
        }
      }
    }
  }
  // 等长组：{ group, nets:[...] } → 成员网 lenGroup（tolerance/target 留在 rules 上，
  // tune 命令按组读取）
  if(R.lengths!=null){
    if(!Array.isArray(R.lengths)) throw new Error('rules.lengths 必须是数组');
    const lenSeen=new Map();
    for(const g of R.lengths){
      if(!g||typeof g.group!=='string'||!g.group) throw new Error('rules.lengths[] 缺 group');
      if(!Array.isArray(g.nets)||g.nets.length<1)
        throw new Error('rules.lengths.'+g.group+' 的 nets 必须是非空网名数组');
      for(const nm of g.nets){
        const n=byName.get(nm);
        if(!n) throw new Error('rules.lengths.'+g.group+' 引用不存在的网络「'+nm+'」');
        if(n.lenGroup!=null&&n.lenGroup!==g.group)
          throw new Error('网络 '+nm+' 已属于等长组「'+n.lenGroup+'」，不能同时加入「'+g.group+'」');
        if(lenSeen.has(nm)&&lenSeen.get(nm)!==g.group)
          throw new Error('网络 '+nm+' 出现在两个等长组里');
        lenSeen.set(nm,g.group);
        n.lenGroup=g.group;
      }
    }
  }
  // class keepout：{ rects:[{x,y,w,h}] | x,y,w,h, class? } → keepouts[].scope
  // 幂等：先移除上次展开物化的条目（fromRules 标记），再重新 push
  if(R.keepouts!=null){
    if(!Array.isArray(R.keepouts)) throw new Error('rules.keepouts 必须是数组');
    d.keepouts=d.keepouts.filter(k=>!k.fromRules);
    for(const k of R.keepouts){
      if(!k||typeof k!=='object') throw new Error('rules.keepouts[] 必须是对象');
      const rects=Array.isArray(k.rects)?k.rects:[k];
      if(k.class!=null){
        if(typeof k.class!=='string'||!k.class) throw new Error('rules.keepouts[].class 必须是非空字符串');
        if(!classes[k.class]) throw new Error('rules.keepouts[].class 引用未定义的 class「'+k.class+'」');
      }
      for(const r of rects){
        if(!r||['x','y','w','h'].some(key=>!Number.isFinite(r[key]))||r.w<=0||r.h<=0)
          throw new Error('rules.keepouts 矩形几何无效（需要 x/y/w/h 且 w,h>0）');
        d.keepouts.push({x:r.x,y:r.y,w:r.w,h:r.h,scope:k.class||null,fromRules:true});
      }
    }
  }
  return d;
}

function minimumRoutingGrid(design){
  return Math.ceil((maxTrackW(design)+design.clearance-1e-9)*20)/20;
}

function assertGridBudget(design){
  const states=Math.max(1,Math.round(design.width/design.grid))*Math.max(1,Math.round(design.height/design.grid))*design.layers;
  if(!Number.isSafeInteger(states)||states>4_000_000) throw new Error('Routing grid exceeds 4000000 states; increase grid spacing or reduce board size');
}

/* 过孔层跨度归一化（阶段三 #15 HDI）：
   记录形如 {x,y}（通孔，贯穿全部层——0.13.0 之前的全部数据）或
   {x,y,layers:[from,to],drill?,outer?}（盲/埋孔，from<to）。
   无 span 时等价于 [0, L-1]；这是向后兼容的唯一口径，所有消费方都走本函数。 */
function viaSpan(v, layers){
  const L=Math.max(1,layers|0);
  if(v && Array.isArray(v.layers) && v.layers.length===2){
    let a=v.layers[0]|0, b=v.layers[1]|0;
    if(a>b){ const t=a; a=b; b=t; }
    return [Math.max(0,Math.min(L-1,a)), Math.max(0,Math.min(L-1,b))];
  }
  return [0, L-1];
}
// 过孔是否贯穿（=与全部层相交）——IPC/DSN/EasyEDA 只支持通孔的判据
function viaThrough(v, layers){ const [a,b]=viaSpan(v,layers); return a===0 && b===(Math.max(1,layers|0)-1); }
// 过孔与某层是否有铜相交
function viaOnLayer(v, l, layers){ const [a,b]=viaSpan(v,layers); return l>=a && l<=b; }
// 焊盘是否与某层跨度相交（焊盘层归属 × span）
function shpLayerInSpan(p, span, L){
  if(p.layer==='both') return true;
  const l=p.layer==='top'?0:L-1;
  return l>=span[0] && l<=span[1];
}
// 固定过孔的物理钻孔间距与网络无关。仅等价的同网钻孔可复用；
// 铜环/走线间距放行同网，不等于可在同网固定孔边再钻一个过近的新孔。
function fixedViaDrillConflict(x,y,r,netId,fromL,toL,holes,maxReach){
  // 会话按 x 排序并传入安全半径，只查邻域；单独调用时也支持未排序孔表。
  let start=0;
  if(maxReach!=null){
    let hi=holes.length;
    const left=x-maxReach;
    while(start<hi){const mid=(start+hi)>>>1;if(holes[mid].x<left) start=mid+1;else hi=mid;}
  }
  for(let i=start;i<holes.length;i++){
    const h=holes[i];
    if(maxReach!=null&&h.x>x+maxReach) break;
    if(fromL>h.span[1]||h.span[0]>toL) continue;
    if(netId!=null&&netId===h.net&&x===h.x&&y===h.y&&r===h.r&&fromL===h.span[0]&&toL===h.span[1]) continue;
    if(Math.hypot(x-h.x,y-h.y)<r+h.r+JLC.viaEdgeMin-1e-9) return true;
  }
  return false;
}
// 两过孔的层跨度是否相交（孔边距/间距判据：不相交的 blind vs buried 可同 XY）
function viaSpanOverlap(a, b, layers){
  const [a0,a1]=viaSpan(a,layers), [b0,b1]=viaSpan(b,layers);
  return a0<=b1 && b0<=a1;
}
/* ---------- BGA 阵列判定 + 环深（0.13.20 扇出优先 F1）----------
   Freerouting BallFields/BallEscapeOrder/TwoLayerBga 语义移植（源码实证，
   见 docs/Freerouting源码研读.md 与 0.13.20 记录）：
   - 判定：≥16 球、单层同层、行列（pitch/4 容差聚类）≥3×3、填充 ≥50%、
     圆焊盘 ≥16 且占比 ≥75%（排除 QFN/QFP 周边焊盘与 LGA 矩形焊盘）
   - 环深 ring = round(球心到包围盒四边最小距离 / pitch)，0=最外圈
   - 组件 = pad id 的 '-' 前缀（与 advise 的 FANOUT 检测同口径，ai/pcb.mjs）
   返回 { ringByNetId:Map(netId→最内圈 ring), comps:[comp 名] }；非阵列板
   返回空 Map。pitch 用排序去重坐标的相邻最小差（规则网格与 O(n²) 等价；
   错排阵列记边界）。 */
function detectBallArrays(design){
  const ringByNetId=new Map(), comps=[];
  const byComp=new Map();
  for(const p of design.pads||[]){
    const c=p.id.split('-')[0];
    if(!byComp.has(c)) byComp.set(c,[]);
    byComp.get(c).push(p);
  }
  for(const [comp,ps] of byComp){
    if(ps.length<16) continue;                              // MIN_BALLS（Freerouting 同款，"no QFN"）
    const layer=ps[0].layer;
    if(ps.some(p=>p.layer!==layer)) continue;               // 单层同层——排除通孔件
    const xs=[...new Set(ps.map(p=>+p.x.toFixed(3)))].sort((a,b)=>a-b);
    const ys=[...new Set(ps.map(p=>+p.y.toFixed(3)))].sort((a,b)=>a-b);
    if(xs.length<4||ys.length<4) continue;                  // 行列 ≥4（16 球下 3×3 已被球数挡住）
    const pitch=Math.min(minAdjDiff(xs),minAdjDiff(ys));
    if(!Number.isFinite(pitch)||pitch<=0) continue;
    if(xs.length<3||ys.length<3||ps.length*2<xs.length*ys.length) continue;   // 填充 ≥50%（QFP 周边约 1/5）
    let round=0;
    for(const p of ps) if(p.shape==='circle') round++;
    if(round<16||round*4<ps.length*3) continue;             // 圆焊盘 ≥16 且 ≥75%（排除 LGA/连接器）
    // 环深：球心到阵列包围盒四边的最小距离 ÷ pitch
    const x0=xs[0],x1=xs[xs.length-1],y0=ys[0],y1=ys[ys.length-1];
    for(const p of ps){
      if(p.netId==null) continue;
      const edge=Math.min(p.x-x0,x1-p.x,p.y-y0,y1-p.y);
      const ring=Math.round(edge/pitch);
      const prev=ringByNetId.get(p.netId);
      ringByNetId.set(p.netId, prev==null?ring:Math.max(prev,ring));   // 网的最内圈球
    }
    comps.push(comp);
  }
  return {ringByNetId, comps};
}
function minAdjDiff(sorted){
  let m=Infinity;
  for(let i=1;i<sorted.length;i++){
    const d=sorted[i]-sorted[i-1];
    if(d>1e-9&&d<m) m=d;
  }
  return m;
}
// Freerouting BallEscapeOrder.moveToFront：阵列网提到队首（inner_first=环深降序，
// outer_first=升序；同环稳定按 net.i），非阵列网保持原序在后。纯函数可测。
function fanoutMoveToFront(queue, mode){
  const ballNets=queue.filter(n=>n.fanoutRing!=null);
  if(!ballNets.length) return queue;
  ballNets.sort((a,b)=>(mode==='inner_first'?b.fanoutRing-a.fanoutRing
                                           :a.fanoutRing-b.fanoutRing)||a.i-b.i);
  const ballSet=new Set(ballNets.map(n=>n.i));
  return [...ballNets,...queue.filter(n=>!ballSet.has(n.i))];
}
function manualRouteEntries(design){
  return (design.manual||[]).map(m=>({netId:m.netId,name:'手动',manual:true,connected:1,total:1,
    paths:[m.pts.map(p=>({...p}))],cells:[],
    // 换层点：span = 相邻两层（起止层即相邻层的两个端点）
    vias:m.pts.filter((p,i)=>i>0&&p.l!==m.pts[i-1].l)
      .map(p=>{ const i=m.pts.indexOf(p); const prev=m.pts[i-1];
        return {x:p.x,y:p.y,layers:[Math.min(prev.l,p.l),Math.max(prev.l,p.l)]}; })}));
}
function normalizeResult(input,design){
  if(!input||typeof input!=='object'||!Array.isArray(input.nets)) throw new Error('Result must contain a nets array');
  for(const n of input.nets){
    if(!n||!Array.isArray(n.paths)||!Array.isArray(n.vias)) throw new Error('Invalid result net');
    for(const path of n.paths){
      if(!Array.isArray(path)||path.some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||!Number.isInteger(p.l)||p.l<0||p.l>=design.layers)) throw new Error('Invalid result path');
    }
    if(n.vias.some(v=>!v||!Number.isFinite(v.x)||!Number.isFinite(v.y))) throw new Error('Invalid result via');
    // 盲埋孔跨度（#15）：可选字段，但一旦给出必须合法（from≤to、在层范围内、
    // 逐孔钻/盘尺寸正有限）——畸形输入必须干净报错，不能静默降级
    for(const v of n.vias){
      if(v.layers!==undefined){
        if(!Array.isArray(v.layers)||v.layers.length!==2) throw new Error('Invalid via span');
        const [a,b]=v.layers;
        if(!Number.isInteger(a)||!Number.isInteger(b)||a<0||b>=design.layers||a>b)
          throw new Error('Invalid via span: '+JSON.stringify(v.layers));
      }
      for(const k of ['drill','outer'])
        if(v[k]!==undefined&&(!Number.isFinite(v[k])||v[k]<=0)) throw new Error('Invalid via '+k);
      if(v.drill!==undefined&&v.outer!==undefined&&v.drill>v.outer) throw new Error('Via drill must not exceed outer');
    }
  }
  if(input.overuse!=null&&(!Array.isArray(input.overuse)||input.overuse.some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||!Number.isInteger(p.l)||p.l<0||p.l>=design.layers))) throw new Error('Invalid result conflicts');
  return {...input,overuse:input.overuse||[]};
}

// 点到矩形（中心 rx,ry，宽高 rw,rh）的距离
function distToRect(px,py, rx,ry,rw,rh){
  const dx=Math.max(Math.abs(px-rx)-rw/2, 0);
  const dy=Math.max(Math.abs(py-ry)-rh/2, 0);
  return Math.hypot(dx,dy);
}

function padOnLayer(p,l,layers){
  return p.layer==='both'||(p.layer==='top'&&l===0)||(p.layer==='bottom'&&l===layers-1);
}
function pointPadDistance(x,y,p){
  return p.shape==='circle'?Math.max(0,Math.hypot(x-p.x,y-p.y)-p.w/2):distToRect(x,y,p.x,p.y,p.w,p.h);
}
function segmentRectDistance(a,b,r){
  const x0=r.x-r.w/2,x1=r.x+r.w/2,y0=r.y-r.h/2,y1=r.y+r.h/2;
  return Math.min(distToRect(a.x,a.y,r.x,r.y,r.w,r.h),distToRect(b.x,b.y,r.x,r.y,r.w,r.h),
    segSegDist(a.x,a.y,b.x,b.y,x0,y0,x1,y0),segSegDist(a.x,a.y,b.x,b.y,x1,y0,x1,y1),
    segSegDist(a.x,a.y,b.x,b.y,x1,y1,x0,y1),segSegDist(a.x,a.y,b.x,b.y,x0,y1,x0,y0));
}
function segmentPadDistance(a,b,p){
  return p.shape==='circle'?Math.max(0,segDist(p.x,p.y,a.x,a.y,b.x,b.y)-p.w/2):segmentRectDistance(a,b,p);
}
function padGap(a,b){
  if(a.shape==='circle'&&b.shape==='circle') return Math.hypot(a.x-b.x,a.y-b.y)-(a.w+b.w)/2;
  if(a.shape==='circle') return distToRect(a.x,a.y,b.x,b.y,b.w,b.h)-a.w/2;
  if(b.shape==='circle') return distToRect(b.x,b.y,a.x,a.y,a.w,a.h)-b.w/2;
  const dx=Math.abs(a.x-b.x)-(a.w+b.w)/2,dy=Math.abs(a.y-b.y)-(a.h+b.h)/2;
  return dx<=0&&dy<=0?Math.max(dx,dy):Math.hypot(Math.max(0,dx),Math.max(0,dy));
}

// 吸附到栅格单元中心
function snapToGrid(v, grid){
  const i=Math.round(v/grid-0.5);
  return (i+0.5)*grid;
}

// 距离下界：先在各层做单位权 BFS，再沿层轴传播过孔代价。
// 平面步与换层可交换，因此分离计算与全场加权松弛等价，每个单元只入队一次。
// 0.14.9 障碍感知启发式（质量车道，CHANGELOG 有专段）：mask 给定时只松弛
// "对本网无条件可通行"的格（掩码与 astar passable/enterOK 逐字段同源，由
// computeH 每次调用构建）。
// 【0.14.9b 一致场重构】mask 模式改为"组合图单元 BFS"：平面 8 邻 + 换层 2 邻
// （双端 mask 门控）全部计 1——场 = 组合图精确最短路度量。可采纳：每条场路径对应
// 一条放松的真实路径（平面步 mask 恰=真实可通行、diag 计 1 ≤ √2、换层计 1 ≤
// viaCost，前提 viaCost ≥ 1——viaCost<1 为既有退化域，盲口径 viaH=1 同样越界）；
// 一致：A* 全部可遍历边（平面双 mask=1 / 换层双端 mask=1 / diag 附带正交格检查）
// ⊆ 场图边集且真实权重 ≥ 1 → 对 A* 代价函数 Lipschitz → first-pop 终止即每边最优
// （0.14.9 分离场在跨层掩码不对称处非一致，见深度检查报告-0.14.9.md 探针 B2）。
// 不可通行种子（目标格自身不可入）只置 0 不向外松弛——进入该格本就非法，经它中转
// 的路径不存在，跳过仍可采纳且更紧；A* 亦无法遍历进入该格，Lipschitz 链无缺口。
// mask=null 保持旧"分离场"口径逐位不变（导出兼容/基准对照/默认路径）。
function fillDistanceMap(model, goals, viaCost, diag, distances, queue, mask){
  const {GW,NC,L,TS}=model, BIG=1e9;
  distances.fill(BIG);
  let head=0, tail=0;
  for(const s of goals){ distances[s]=0; queue[tail++]=s; }
  const useMask=mask!=null;
  // 第十轮深度优化：visit 闭包内联（剖析 28% 热点——每格 1M+ 次闭包调用）；
  // 邻居访问顺序与原实现逐位一致（左/右/上/下/四斜角）
  while(head<tail){
    const s=queue[head++], c=s%NC, d=distances[s]+1;
    if(useMask && distances[s]===0 && !mask[s]) continue;   // 种子（波前中 dist 0 ⟺ 种子）
    const left=c%GW>0, right=c%GW<GW-1, up=c>=GW, down=c<NC-GW;
    if(left){ const t=s-1; if(distances[t]===BIG&&(!useMask||mask[t])){ distances[t]=d; queue[tail++]=t; } }
    if(right){ const t=s+1; if(distances[t]===BIG&&(!useMask||mask[t])){ distances[t]=d; queue[tail++]=t; } }
    if(up){ const t=s-GW; if(distances[t]===BIG&&(!useMask||mask[t])){ distances[t]=d; queue[tail++]=t; } }
    if(down){ const t=s+GW; if(distances[t]===BIG&&(!useMask||mask[t])){ distances[t]=d; queue[tail++]=t; } }
    if(diag){
      if(left&&up){ const t=s-GW-1; if(distances[t]===BIG&&(!useMask||mask[t])){ distances[t]=d; queue[tail++]=t; } }
      if(right&&up){ const t=s-GW+1; if(distances[t]===BIG&&(!useMask||mask[t])){ distances[t]=d; queue[tail++]=t; } }
      if(left&&down){ const t=s+GW-1; if(distances[t]===BIG&&(!useMask||mask[t])){ distances[t]=d; queue[tail++]=t; } }
      if(right&&down){ const t=s+GW+1; if(distances[t]===BIG&&(!useMask||mask[t])){ distances[t]=d; queue[tail++]=t; } }
    }
    if(useMask){
      // 0.14.9b：换层边内联进 BFS（分离场的传播改在此处）——双端 mask 门控
      //（展开格自身 mask=1 已由种子门/松弛门保证），计 1 ≤ 真实 viaCost
      if(s>=NC && mask[s-NC] && distances[s-NC]===BIG){ distances[s-NC]=d; queue[tail++]=s-NC; }
      if(s<TS-NC && mask[s+NC] && distances[s+NC]===BIG){ distances[s+NC]=d; queue[tail++]=s+NC; }
    }
  }
  if(!useMask){
    const viaH=Math.max(1,viaCost*0.1);
    for(let l=1;l<L;l++) for(let c=0;c<NC;c++){
      const s=l*NC+c, d=distances[s-NC]+viaH;
      if(d<distances[s]) distances[s]=d;
    }
    for(let l=L-2;l>=0;l--) for(let c=0;c<NC;c++){
      const s=l*NC+c, d=distances[s+NC]+viaH;
      if(d<distances[s]) distances[s]=d;
    }
  }
  return distances;
}

// 过孔影响区：索引拆成列/行，半径始终以 mm 输入，再换算为格数。
function markViaInfluence(model, cell, radius, owner, owners, multi){
  const {GW,GH,grid}=model, gx=cell%GW, gy=(cell-gx)/GW;
  const r=radius/grid, ri=Math.ceil(r);
  const x0=Math.max(0,gx-ri), x1=Math.min(GW-1,gx+ri);
  const y0=Math.max(0,gy-ri), y1=Math.min(GH-1,gy+ri);
  for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++){
    if(Math.hypot(x-gx,y-gy)>=r) continue;
    const s=y*GW+x;
    if(owners[s]===0) owners[s]=owner;
    else if(owners[s]!==owner) multi[s]=1;
  }
}

// 由设计数据构建路由模型（静态障碍、焊盘归属、覆盖单元）
function buildModel(design){
  assertGridBudget(design);
  const grid=design.grid, L=Math.max(1, design.layers|0);
  const GW=Math.max(1, Math.round(design.width/grid));
  const GH=Math.max(1, Math.round(design.height/grid));
  const NC=GW*GH, TS=NC*L;
  const netIdx=new Map();
  (design.nets||[]).forEach((n,i)=>netIdx.set(n.id,i));
  // 网类（roadmap #10 class keepout）：netId → rules.netClass[网名]
  const netCls=new Map();
  const _nc=(design.rules&&design.rules.netClass)||null;
  if(_nc) for(const n of (design.nets||[])) if(_nc[n.name]) netCls.set(n.id,_nc[n.name]);
  // 作用域禁布（class keepout）：scope 类名的 keepout 对异类网是障碍、本类网自由
  const scopedBlocked=[];
  const blocked=new Uint8Array(TS);     // 禁布区（全层）
  const padOwner=new Int16Array(TS);    // 焊盘影响区：0 无 / -1 独立焊盘 / k>0 属于网络 k-1
  const copperOwner=new Int32Array(TS); // 真铜格属主（0 无 / -1 异网真铜冲突 / k>0 属于网络 k-1）
  const padCells=new Map();             // pad.id -> [stateIdx...]
  const padsByNet=new Map();            // 网络序号 -> [pad...]
  const viaPadOwner=new Int16Array(NC);
  const viaPadOwnerL=new Int16Array(TS);   // 层感知版（0.13.18 #15b B3）：盲埋孔只查 span 内层的异网焊盘
  const fixedOwner=new Int16Array(TS);
  const halfClr=design.clearance+maxTrackW(design)/2;
  // 逐网电压间距（第十一轮后批次1，L48）：声明 nets[].voltage 的网 → IPC-2221B 安全间距
  // 半径 = netClr(design, netId) + maxTrackW/2（影响区扩展到安全间距覆盖范围）
  const _vMap=new Map();
  for(const n of (design.nets||[])){
    const c=netClr(design, n.id);
    if(c>design.clearance+1e-9) _vMap.set(n.id, c);   // voltage 查表或 classClr 抬高的网 → 影响区加宽
  }
  const padClr=p=>{ const v=_vMap.get(p.netId); return v!=null ? v + maxTrackW(design)/2 : halfClr; };

  for(const p of (design.pads||[])){
    const ni=(p.netId!=null && netIdx.has(p.netId)) ? netIdx.get(p.netId) : -1;
    const ls = p.layer==='top' ? [0] : (p.layer==='bottom'&&L>1 ? [L-1] : Array.from({length:L},(_,k)=>k));
    const hw=p.w/2, hh=(p.shape==='circle'?p.w/2:p.h/2), r=p.w/2;
    const pClr=padClr(p);   // 该焊盘的影响区半径（= per-net clearance + maxTrackW/2）
    const iLo=Math.max(0, Math.ceil((p.x-hw-pClr)/grid-0.5));
    const iHi=Math.min(GW-1, Math.floor((p.x+hw+pClr)/grid-0.5));
    const jLo=Math.max(0, Math.ceil((p.y-hh-pClr)/grid-0.5));
    const jHi=Math.min(GH-1, Math.floor((p.y+hh+pClr)/grid-0.5));
    const states=[];
    for(let j=jLo;j<=jHi;j++)for(let i=iLo;i<=iHi;i++){
      const cx=(i+0.5)*grid, cy=(j+0.5)*grid;
      // 圆焊盘的影响区用外接方形（distToRect）而非圆弧：格点中心采样在弧线两格之间
      // 留出弦缺口，走线可从缺口穿过造成格点合法但段违规（第八轮 n103 教训，
      // L21"采样 vs 精确"家族）。方形享受矩形斜移防切角保护 → 布线合法 ⊆ DRC 合法。
      // 起始格（padCells，d<=1e-9）保持圆真值——格心必须真落在铜上才算连通。
      const dCircle=(p.shape==='circle') ? Math.max(0, Math.hypot(cx-p.x,cy-p.y)-r) : 0;
      const d=(p.shape==='circle') ? distToRect(cx,cy,p.x,p.y,p.w,p.w)
                                   : distToRect(cx,cy,p.x,p.y,p.w,p.h);
      if(d>=pClr) continue;               // 影响区之外（per-net clearance，批次1 L48）
      const own=(ni>=0? ni+1 : -1);
      for(const l of ls){
        const s=l*NC+j*GW+i,previous=padOwner[s];
        padOwner[s]=previous===0||previous===own?own:-1;
      }
      const onCopper=(p.shape==='circle') ? dCircle<=1e-9 : d<=1e-9;
      if(onCopper){
        for(const l of ls){
          const s=l*NC+j*GW+i;
          states.push(s);
          // 真铜属主登记（第十轮 n59 教训）：铜格被异网影响区重叠压成 -1 会封死本网
          // 进入自己的焊盘——铜属主优先，循环结束后统一恢复。异网真铜真重叠（物理
          // 重叠，DRC 会报）仍保持 -1 不可通行。
          const prevC=copperOwner[s];
          copperOwner[s]=prevC===0||prevC===own?own:-1;
        }
      }
    }
    padCells.set(p.id, states);
    if(ni>=0){
      if(!padsByNet.has(ni)) padsByNet.set(ni,[]);
      padsByNet.get(ni).push(p);
    }
    const vr=design.viaOuter/2+design.clearance;
    const vx0=Math.max(0,Math.ceil((p.x-hw-vr)/grid-0.5)),vx1=Math.min(GW-1,Math.floor((p.x+hw+vr)/grid-0.5));
    const vy0=Math.max(0,Math.ceil((p.y-hh-vr)/grid-0.5)),vy1=Math.min(GH-1,Math.floor((p.y+hh+vr)/grid-0.5));
    const owner=ni<0?-1:ni+1;
    for(let y=vy0;y<=vy1;y++)for(let x=vx0;x<=vx1;x++){
      if(pointPadDistance((x+0.5)*grid,(y+0.5)*grid,p)>=vr-1e-9) continue;
      const c=y*GW+x,previous=viaPadOwner[c];
      viaPadOwner[c]=previous===0||previous===owner?owner:-1;
      for(const l of ls){
        const sl=l*NC+c, prevL=viaPadOwnerL[sl];
        viaPadOwnerL[sl]=prevL===0||prevL===owner?owner:-1;
      }
    }
  }
  // 真铜属主恢复（第十轮 n59 教训）：影响区重叠不得封死焊盘本体——
  // 循环内影响区标记可能把别家真铜格压成 -1，这里按 copperOwner 统一回写。
  for(let s=0;s<TS;s++){
    if(copperOwner[s]!==0) padOwner[s]=copperOwner[s];
  }
  // 插件孔孔边距（同网不豁免——与 DRC 孔边距检查同口径，第六轮 n66 教训：
  // viaLegal 只查异网 → 布线器把过孔钻孔贴到同网 THT 焊盘孔上，DRC 判违规）。
  // 过孔钻孔中心到 THT 焊盘孔心 < holeR + viaDrill/2 + viaEdgeMin 即不可放（恰界 = 允许，L7 容差）。
  const viaHoleBlocked=new Uint8Array(NC);
  {
    const edgeMin=JLC.viaEdgeMin;
    for(const p of (design.pads||[])){
      const hr=p.holeR||0;
      if(hr<=0) continue;
      const R=hr+design.viaDrill/2+edgeMin;
      const x0=Math.max(0,Math.ceil((p.x-R)/grid-0.5)),x1=Math.min(GW-1,Math.floor((p.x+R)/grid-0.5));
      const y0=Math.max(0,Math.ceil((p.y-R)/grid-0.5)),y1=Math.min(GH-1,Math.floor((p.y+R)/grid-0.5));
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)
        if(Math.hypot((x+0.5)*grid-p.x,(y+0.5)*grid-p.y)<R-1e-9) viaHoleBlocked[y*GW+x]=1;
    }
  }
  const markFixed=(a,b,netId,via=false)=>{
    const ni=netIdx.get(netId),owner=ni==null?-1:ni+1;
    const radius=(via?design.viaOuter/2:netW(design,netId)/2)+design.clearance+maxTrackW(design)/2;
    const vr=(via?design.viaOuter/2:netW(design,netId)/2)+design.clearance+design.viaOuter/2;
    const reach=Math.max(radius,vr);
    const x0=Math.max(0,Math.ceil((Math.min(a.x,b.x)-reach)/grid-0.5));
    const x1=Math.min(GW-1,Math.floor((Math.max(a.x,b.x)+reach)/grid-0.5));
    const y0=Math.max(0,Math.ceil((Math.min(a.y,b.y)-reach)/grid-0.5));
    const y1=Math.min(GH-1,Math.floor((Math.max(a.y,b.y)+reach)/grid-0.5));
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
      const c=y*GW+x,dist=segDist((x+0.5)*grid,(y+0.5)*grid,a.x,a.y,b.x,b.y);
      if(dist<vr-1e-9){const old=viaPadOwner[c];viaPadOwner[c]=old===0||old===owner?owner:-1;}
      if(dist>=radius-1e-9) continue;
      for(let l=0;l<L;l++)if(via||l===a.l){
        const s=l*NC+c,old=fixedOwner[s];fixedOwner[s]=old===0||old===owner?owner:-1;
      }
    }
  };
  for(const m of design.manual||[])for(let i=1;i<m.pts.length;i++){
    const a=m.pts[i-1],b=m.pts[i];
    if(a.l===b.l)markFixed(a,b,m.netId);else markFixed(b,b,m.netId,true);
  }
  for(const v of design.stitching||[])markFixed(v,v,v.netId,true);
  const padCopper=new Set();   // 焊盘真铜格（d≤1e-9 的起始格）——禁布缓冲带豁免用
  for(const sts of padCells.values()) for(const s of sts) padCopper.add(s%NC);
  for(const k of (design.keepouts||[])){
    // 第十轮 n145 教训：禁布区此前只阻挡自身格点，没有 pad 那样的影响区缓冲——
    // 格心距禁布区边缘 0.1mm 的行"合法"，但走线铜皮（半宽 w/2）入侵禁布区 → DRC 判违规。
    // 修复：阻挡区外扩 maxTrackW/2 缓冲带（格心 ≥ maxTrackW/2 ≥ 任意网 w/2 → 铜皮不出界，
    // 与 DRC「线段-矩形距离 < w/2 判违规」同口径）；焊盘真铜格豁免（pad 本体可达性由 spec/DRC 负责）。
    // 作用域（roadmap #10 class keepout）：k.scope 类名 → 对异类网是障碍、本类网自由
    // ——进 scopedBlocked（按类分位图），passable/viaLegal/DRC/美化按网类查询。
    const bx=k.w/2+maxTrackW(design)/2, by=k.h/2+maxTrackW(design)/2;
    const iLo=Math.max(0, Math.ceil((k.x-bx)/grid-0.5));
    const iHi=Math.min(GW-1, Math.floor((k.x+bx)/grid-0.5));
    const jLo=Math.max(0, Math.ceil((k.y-by)/grid-0.5));
    const jHi=Math.min(GH-1, Math.floor((k.y+by)/grid-0.5));
    const cells=k.scope?(()=>{ let a=scopedBlocked.find(x=>x.cls===k.scope);
      if(!a){ a={cls:k.scope, cells:new Uint8Array(NC)}; scopedBlocked.push(a); } return a.cells; })():null;
    for(let j=jLo;j<=jHi;j++)for(let i=iLo;i<=iHi;i++){
      const cx=(i+0.5)*grid, cy=(j+0.5)*grid;
      if(Math.abs(cx-k.x)<=bx+1e-9 && Math.abs(cy-k.y)<=by+1e-9){
        const c=j*GW+i;
        if(padCopper.has(c)) continue;   // 焊盘真铜格豁免
        if(cells) cells[c]=1;
        else for(let l=0;l<L;l++) blocked[l*NC+c]=1;
      }
    }
  }
  // 板边禁布 0.2mm（嘉立创极限；不含焊盘格——焊盘已有自身位置）
  {
    const eb=Math.ceil(0.2/grid);
    if(eb>0&&eb<GW/2&&eb<GH/2){
      for(let l=0;l<L;l++)for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){
        if(x<eb||x>=GW-eb||y<eb||y>=GH-eb){
          if(padOwner[l*NC+y*GW+x]===0) blocked[l*NC+y*GW+x]=1;
        }
      }
    }
  }
  return {grid,GW,GH,L,NC,TS,blocked,scopedBlocked,netCls,padOwner,padCells,padsByNet,netIdx,viaPadOwner,viaPadOwnerL,fixedOwner,viaHoleBlocked,design};
}

// class keepout 查询（roadmap #10）：cls=null 的网受所有作用域禁布约束；
// cls=类名 的网仅受 scope≠自身类 的禁布约束。c 为层内格号（0..NC-1）。
// scopedBlocked 为空（绝大多数设计）时零开销。
function _scopedHit(model, cls, c){
  const sb=model.scopedBlocked;
  if(!sb||!sb.length) return false;
  for(const s of sb) if(cls!==s.cls && s.cells[c]) return true;
  return false;
}
// 设计级网类映射（无 model 的消费方：DRC/布局）netId → class 名
function netClsMap(design){
  const m=new Map();
  const nc=design.rules&&design.rules.netClass;
  if(nc) for(const n of (design.nets||[])) if(nc[n.name]) m.set(n.id,nc[n.name]);
  return m;
}

/* 创建布线会话：反复调用 step() 直到返回 {done:true}，再调用 buildResult()。
   第 0 阶段：按序硬约束布线（不允许与其它网络重叠）；
   若有失败网络，进入 PathFinder 协商拥塞阶段：每轮拆掉全部网络重布，
   被占用单元代价 = presFac×占用数，冲突单元累积历史代价，直至收敛。 */
function createSession(design, opts){
  opts=opts||{};
  // 深度优化（0.11.1）：可共享 model——buildModel 是 design 的纯函数且 model 在
  // 会话生命周期内只读（fixedOwner/padOwner/blocked 等写点全部在 buildModel 内，
  // 已逐字段审计）；routeBoard 的候选重跑×5 可复用一次构建。
  const model=opts.model||buildModel(design);
  // 0.14.8 深优：fixedOwner/viaHoleBlocked 提升为会话级绑定——astar 每邻居/viaLegal 每孔
  // 尝试不再走 model 属性链读（IC 两跳→typed 直读）。model 会话内只读（:642-644 审计注），
  // design 会话内只读已有先例（ringR/netMeta 同批一次性读取）。
  const {grid,GW,GH,L,NC,TS,blocked,padOwner,padCells,padsByNet,fixedOwner}=model;
  const viaHoleBlk=model.viaHoleBlocked;
  const viaCost = opts.viaCost!=null?opts.viaCost:15;
  const turnPen = opts.turnPen!=null?opts.turnPen:0.3;
  const histInc = opts.histInc!=null?opts.histInc:1.0;
  const histDecay = opts.histDecay!=null?opts.histDecay:0.99;  // 每轮历史代价衰减（借鉴 FlexDR marker decay 0.95~0.999）
  const maxIter = opts.maxIter!=null?opts.maxIter:30;
  const diagOn = opts.diag!==false;   // 45° 斜向布线（默认开启）
  let layerDirOn = opts.layerDir!==false;  // 分层首选方向：偶数层横走、奇数层竖走（默认开启；优化器奇偶轮切换）
  const offDir = opts.offDir!=null?opts.offDir:0.35;  // 违背首选方向的每格代价
  // #15b 相邻层盲埋孔（opt-in）：opts.blindVias 优先，其次 design.hdi.blindVias。
  // 缺省关——过孔仍记全层 span（输出无 layers 字段，位级不变）
  const blindVias=opts.blindVias!=null?opts.blindVias===true:!!(design.hdi&&design.hdi.blindVias);
  const allLayers=Array.from({length:L},(_,q)=>q);   // 通孔 span（避免逐孔分配）
  // 扇出优先（0.13.20 F1，Freerouting BallEscapeOrder 语义）：auto→2 层 inner_first
  //（出路最少的球先拿走自己的出路），其它层数 off；缺省 off 位级不变
  const fanoutRaw=opts.fanoutFirst!=null?String(opts.fanoutFirst)
    :(design.hdi&&design.hdi.fanoutFirst!=null?String(design.hdi.fanoutFirst):'off');
  if(!['off','auto','inner_first','outer_first'].includes(fanoutRaw))
    throw new Error('fanoutFirst must be off|auto|inner_first|outer_first');
  const fanoutEff=fanoutRaw==='auto'?(L===2?'inner_first':'off'):fanoutRaw;
  const fanoutRing=fanoutEff==='off'?new Map():detectBallArrays(design).ringByNetId;
  // 借道阵列网铜的每格附加罚（0.13.22 F3，仅 fanoutFirst 开启时消费）。
  // 必须非负有限——负值会使 A* 边权为负破坏 Dijkstra 不变量，NaN 毒化代价
  //（0.13.24 深检修复；F3b 精确计数器实验更差 13→30/14→17，如实撤销）
  const fanoutBorrowPen=opts.fanoutBorrowPen!=null?opts.fanoutBorrowPen:10;
  if(!Number.isFinite(fanoutBorrowPen)||fanoutBorrowPen<0)
    throw new Error('fanoutBorrowPen must be a nonnegative finite number');
  let presFac = 2;               // 协商阶段占用代价系数（每轮翻倍）

  const usage=new Int16Array(TS);        // 每单元当前被几个网络占用
  const cellOwner=new Int32Array(TS);    // 每单元首个占用者（net.i+1，0=无）——差分对豁免/回流配对用
  const hist=new Float32Array(TS);       // 历史拥塞代价
  const viaCore=new Int16Array(NC);      // 过孔所在单元：0 无 / k>0 网络 k-1
  // 过孔影响区双口径（0.13.16）：viaInf=走线口径（挡异网走线），viaInfV=过孔口径（挡异网过孔落点）。
  // 旧实现单半径取 max(两者)——对走线在 (via-trace, via-via) 带内过度保守
  //（BGA-64 的 0.38-0.53mm 带正是内圈球的逃逸通道，封死它 = 138 个 DRC 的主因）。
  const viaInf=new Int16Array(TS);        // 走线口径（挡异网走线）：0 无 / -2 多网络 / k>0 网络 k-1；TS 化（0.13.18 #15b）——盲埋孔只挡 span 内层
  const viaInfV=new Int16Array(NC);       // 过孔口径（挡异网过孔落点）：同上
  const tmpOwner=new Int16Array(TS), tmpMulti=new Uint8Array(TS);   // 走线口径缓冲（TS 化同步 viaInf）
  const tmpOwnerV=new Int16Array(NC), tmpMultiV=new Uint8Array(NC);
  // 邻近罚逐格缓存（gen 戳）：TS ≤4M 状态才启用（内存 8B/状态；大板回退直算）
  const nearPenCache=TS<=4_000_000?new Float32Array(TS):null;
  const nearPenStamp=nearPenCache?new Int32Array(TS):null;
  // 网络元数据：hs（高速）与 pair（差分对组名）——Bogatin ch10/11 行为级布线偏置用
  // 网络元数据：hs（高速）与 pair（差分对组名）——Bogatin ch11 行为级布线偏置用。
  // pairGapMM：奇偶模阻抗口径的设计间隙（90Ω 默认，nets[].diffZ 可覆写）——
  // 耦合走廊按此间隙带构建（roadmap 阶段一 #3）。
  const netMeta=(design.nets||[]).map(n=>{
    return { hs:!!n.hs, pair:n.pair||null, pairGapMM:pairGapFor(design,n) };
  });
  // 过孔间距环偏移（走线中心距过孔中心须 ≥ viaOuter/2+clearance+trackW/2）
  const ringR=(design.viaOuter/2+design.clearance+maxTrackW(design)/2)/grid;
  const ringOffs=[];
  {
    const ri=Math.ceil(ringR);
    for(let dy=-ri;dy<=ri;dy++)for(let dx=-ri;dx<=ri;dx++)
      if(dx===0&&dy===0) continue;
      else if(Math.hypot(dx,dy)<ringR) ringOffs.push([dx,dy]);
  }
  // 过孔位置合法性：板边、其它网络焊盘间距（几何硬约束）。
  // keepout 位图会话级懒构建（每过孔尝试一次 distToRect×keepouts → 一次数组读）
  let keepoutViaBlocked=null;
  // 仅静态固定过孔：动态新孔之间的间距仍由现有搜索/审计处理。
  // 没有 stitching 或手动换层时不构造孔表；THT 继续走原 viaHoleBlocked 位图。
  const hasFixedVias=(design.stitching||[]).length||(design.manual||[]).some(m=>m.pts.some((p,i)=>i>0&&p.l!==m.pts[i-1].l));
  const fixedViaHoles=hasFixedVias?manufacturingHoles(design,{nets:manualRouteEntries(design)}).filter(h=>h.hasVia).sort((a,b)=>a.x-b.x):null;
  let fixedViaReach=0;
  if(fixedViaHoles) for(const h of fixedViaHoles) fixedViaReach=Math.max(fixedViaReach,design.viaDrill/2+h.r+JLC.viaEdgeMin);
  // 0.14.8 深优：viaLegal 每孔尝试的常量提升——viaOuter/2 等在会话内不变（design 只读），
  // 每次调用省多次属性链读与除法；IEEE 除法结果复用，算式逐位一致
  const voHalf=design.viaOuter/2, viaDrillHalf=design.viaDrill/2,
    boardW=design.width, boardH=design.height;
  function viaLegal(net, c, fromL, toL){
    const cx=cxOf(c), cy=cyOf(c);
    if(cx-voHalf<-1e-9 || cx+voHalf>boardW+1e-9 ||
       cy-voHalf<-1e-9 || cy+voHalf>boardH+1e-9) return false;
    // 焊盘阻挡按 span 查（0.13.18 #15b B3）：通孔走列位图快路径（位级不变）；
    // 盲埋孔只查 span 内层——span 外层的异网焊盘无铜相交，不阻挡
    const sa=fromL!=null?fromL:0, sb=toL!=null?toL:L-1;
    if(sa===0&&sb===L-1){
      const owner=model.viaPadOwner[c];
      if(owner!==0&&owner!==net.i+1) return false;
    } else {
      for(let l=sa;l<=sb;l++){
        const o=model.viaPadOwnerL[l*NC+c];
        if(o!==0&&o!==net.i+1) return false;
      }
    }
    // 过孔口径影响区（0.13.16 拆分）：异网过孔的 via-via DRC 盘内不得落新孔
    // ——旧实现靠单半径影响区在 passable 里顺带挡住；拆分后走线口径放开
    // (via-trace, via-via) 带，此检查必须补上（n150 实测：单半径 0.425 时
    // +3 过孔间距）。
    const vOwner=viaInfV[c];
    if(vOwner!==0&&vOwner!==net.i+1) return false;
    if(viaHoleBlk&&viaHoleBlk[c]) return false;   // 同网 THT 孔边距（DRC 同口径）
    if(fixedViaHoles&&fixedViaDrillConflict(cx,cy,viaDrillHalf,net.id,sa,sb,fixedViaHoles,fixedViaReach)) return false;
    if(keepoutViaBlocked===null){
      keepoutViaBlocked=new Uint8Array(NC);
      for(const k of design.keepouts||[]){
        const x0=Math.max(0, Math.floor((k.x-k.w/2-voHalf)/grid-0.5));
        const x1=Math.min(GW-1, Math.ceil((k.x+k.w/2+voHalf)/grid-0.5));
        const y0=Math.max(0, Math.floor((k.y-k.h/2-voHalf)/grid-0.5));
        const y1=Math.min(GH-1, Math.ceil((k.y+k.h/2+voHalf)/grid-0.5));
        for(let gy=y0;gy<=y1;gy++)for(let gx=x0;gx<=x1;gx++)
          if(distToRect((gx+0.5)*grid,(gy+0.5)*grid,k.x,k.y,k.w,k.h)<voHalf-1e-9) keepoutViaBlocked[gy*GW+gx]=1;
      }
    }
    if(keepoutViaBlocked){ if(keepoutViaBlocked[c]) return false; }
    else for(const k of design.keepouts||[]) if(distToRect(cx,cy,k.x,k.y,k.w,k.h)<voHalf-1e-9) return false;
    if(_scopedHit(model,net.cls,c)) return false;   // class keepout 同口径（roadmap #10）
    return true;
  }

  const nets=(design.nets||[]).map((n,i)=>({
    i, id:n.id, name:n.name, cls:((design.rules&&design.rules.netClass||{})[n.name])||null,
    prefL:n.preferredLayer!=null?n.preferredLayer:null,
    cells:new Set(), viaSet:new Map(), paths:[],
    failed:0, connected:0, total:0, prio:0, failedLast:0, conflicted:false,
    fanoutRing:fanoutRing.get(n.id)!=null?fanoutRing.get(n.id):null   // 阵列网的最内圈环深（0.13.20 F1）
  }));

  // 3W 偏置的环带偏移预计算（切比雪夫距离恰为 2 的 12 格）——热循环不再逐格算 max/abs
  const ring2Offs=[];
  for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)
    if(Math.max(Math.abs(dx),Math.abs(dy))===2) ring2Offs.push([dx,dy]);
  // 会话级单实例的邻近罚函数（热循环不建闭包）
  // 深优 2026-11-14：net.cells.has → ownStamp===gen（O(1) 类型化读，语义等价——
  // ownStamp 在 astar 入口对 net.cells 全量置 gen 戳 :932，adjPenAt 仅在 astar
  // 邻域扩展内被调用，生命周期覆盖）
  function adjPenAt(net, s2, myPair){
    if(usage[s2]<=0 || ownStamp[s2]===gen) return 0;
    if(myPair){
      const oi=cellOwner[s2]-1;
      if(oi>=0 && netMeta[oi] && netMeta[oi].pair===myPair && usage[s2]<=2) return 0;
    }
    return 3;
  }

  /* ---- 差分对耦合走廊（Bogatin ch11 成对贴近走线的布线器实现） ----
     已布的 pair 网成功后，给其走线贴邻格（同层 4 邻、空闲格）建 0.5 的成本折扣走廊；
     伙伴网布线时 A* 会自然沿该走廊平行走线（绕障时尤其明显）。
     代价地板 0.5 保持所有边权 >0——不破坏 Dijkstra 不变量；ripNet 时同步回收走廊。
     opts.pairBias===false 可关闭（默认开启，仅影响显式标记 pair 的网络）。 */
  // 耦合走廊折扣：Map → 懒分配类型化数组（A* 每条边一次 get，数组索引远快于
  // 哈希；TS >8M 状态回退 Map 防内存）。位级同值：写入/读取/清理同语义。
  // val 存千分比（Int16：500/750/900）——F32 存 0.9 会丢精度破坏与 Map 路径的
  // 位级一致；读取时 /1000（IEEE 除法正确舍入回与字面量相同的 double）
  const pairBonusTyped=TS<=8_000_000?{val:new Int16Array(TS), src:new Int32Array(TS)}:null;
  const pairBonus=new Map();        // 状态索引 -> 折扣（typed 不可用时回退）
  const pairBonusSrc=new Map();     // 状态索引 -> 建廊者 net.i
  const pairBonusGet=s2=>pairBonusTyped?pairBonusTyped.val[s2]:(pairBonus.get(s2)||0);
  const pairBonusSet=(s2,v,src)=>{
    if(pairBonusTyped){ pairBonusTyped.val[s2]=Math.round(v*1000); pairBonusTyped.src[s2]=src; }
    else { pairBonus.set(s2,v); pairBonusSrc.set(s2,src); }
  };
  const pairBonusDel=(s2,src)=>{
    if(pairBonusTyped){ if(pairBonusTyped.src[s2]===src){ pairBonusTyped.val[s2]=0; pairBonusTyped.src[s2]=0; } }
    else { if(pairBonusSrc.get(s2)===src){ pairBonus.delete(s2); pairBonusSrc.delete(s2); } }
  };
  function buildPairBonus(net){
    if(opts.pairBias===false) return;
    const myMeta=netMeta[net.i];
    if(!myMeta||!myMeta.pair) return;
    const mark=[];
    // 耦合走廊转正（roadmap #3）：设计间隙带取代贴邻折扣——伙伴网沿
    // "中心距 (W1+W2)/2 + S" 的环形带（±1 格容差）平行走线，S 为 90Ω
    // 口径解出的边到边间隙。无设计间隙（叠层不可达/未布线）回退贴邻。
    const S=myMeta.pairGapMM;
    const partner=design.nets.find(x=>x.pair===myMeta.pair&&x.id!==net.id)||null;
    if(S!=null&&partner){
      const g=grid, Wc=(netW(design,net.id)+netW(design,partner.id))/2;
      const steps=Math.max(1, Math.round((Wc+S)/g));
      // 合法下界：间隙带不得包含边距 < clr 的环（量化最近格可能非法——实测教训）
      const dLegalMin=Math.max(1, Math.ceil((Wc+design.clearance)/g-1e-9));
      const dLo=Math.max(steps-1, dLegalMin), dHi=steps+1;
      const dist=new Map(); const q=[];
      for(const s0 of net.cells){ dist.set(s0,0); q.push(s0); }
      for(let head=0; head<q.length; head++){
        const cur=q[head], d0=dist.get(cur);
        if(d0>=dHi) continue;
        const l=(cur/NC)|0, c=cur%NC, gx=c%GW, gy=(c-gx)/GW;
        for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
          const x=gx+dx, y=gy+dy;
          if(x<0||y<0||x>=GW||y>=GH) continue;
          const s2=l*NC+y*GW+x;
          if(dist.has(s2)) continue;
          dist.set(s2,d0+1); q.push(s2);
        }
      }
      // 梯度折扣：设计偏移（d0==steps）最强 0.5，容差环较弱 0.9——
      // 等额折扣会让伙伴骑在带的外沿（离它自己的焊盘最近）而非设计间隙；
      // 0.5 是收敛坡道的经济阈值（坡道成本 ≈ 折扣收益才会真正收敛）
      for(const [s2,d0] of dist){
        if(d0<dLo||d0>dHi) continue;
        if(usage[s2]>0) continue;
        if(model.padOwner[s2]!==0||model.blocked[s2]) continue;   // 不得把伙伴引向焊盘/禁布区
        if(_scopedHit(model,net.cls,s2%NC)) continue;             // class keepout 同口径
        if(pairBonusGet(s2)!==0) continue;
        pairBonusSet(s2, d0===steps?0.5:0.9, net.i); mark.push(s2);
      }
      pairBonusByNet.set(net.i, mark);
      return;
    }
    for(const s of net.cells){
      const l=(s/NC)|0, c=s%NC, gx=c%GW, gy=(c-gx)/GW;
      for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
        const x=gx+dx, y=gy+dy;
        if(x<0||y<0||x>=GW||y>=GH) continue;
        const s2=l*NC+y*GW+x;
        if(usage[s2]>0) continue;                 // 只给空闲格建廊（含自身占用格跳过）
        if(model.padOwner[s2]!==0||model.blocked[s2]) continue;   // 同上：不引向焊盘/禁布区
        if(_scopedHit(model,net.cls,s2%NC)) continue;             // class keepout 同口径
        if(pairBonusGet(s2)!==0) continue;
        pairBonusSet(s2,0.75,net.i); mark.push(s2);
      }
    }
    pairBonusByNet.set(net.i, mark);
  }
  const pairBonusByNet=new Map();   // 建廊者 net.i -> [状态索引]
  function clearPairBonus(net){
    const mark=pairBonusByNet.get(net.i);
    if(!mark) return;
    for(const s of mark) pairBonusDel(s, net.i);
    pairBonusByNet.delete(net.i);
  }

  const cxOf=c=>((c%GW)+0.5)*grid, cyOf=c=>((Math.floor(c/GW))+0.5)*grid;
  const stateOf=(x,y,l)=>l*NC+y*GW+x;

  // ---- 过孔影响区重建（从全部过孔精确重算） ----
  let viaInfEmpty=true;
  // 深优 2026-11-14：via 快照——patchViaInf 的差分基线。每次全量重建后刷新全部网；
  // routeNet 尾部用增量补丁时只刷新变化网。快照口径保证「自上次重建以来所有
  // viaSet 变化」（含 optimize 接受等不触发重建的路径）都进补丁区。
  const _viaSnap=new Map();
  // 双口径半径（纯函数，session 生命周期内恒定——原 rebuild 内联算式原样外提）
  const _vDdT=design.viaOuter/2+design.clearance+maxTrackW(design)/2;
  const _vRadiusT=Math.sqrt(_vDdT*_vDdT+grid*grid/2);
  const _vRadiusV=design.viaOuter+design.clearance;
  function rebuildViaInf(){
    passMaskEpoch++;
    // No vias is common on small boards. Clear once when the last via disappears,
    // including after rip-up or snapshot restoration; skip repeated full-grid work.
    if(!nets.some(net=>net.viaSet.size)){
      if(!viaInfEmpty){ viaInf.fill(0); viaInfV.fill(0); }   // viaInf TS fill
      viaInfEmpty=true;
      for(const n of nets) _viaSnap.set(n.i,[...n.viaSet]);
      return;
    }
    viaInfEmpty=false;
    // viaInf is overwritten for every cell below; only the accumulation buffers need clearing.
    tmpOwner.fill(0); tmpMulti.fill(0);
    tmpOwnerV.fill(0); tmpMultiV.fill(0);
    // 双口径（0.13.16），各与自己 DRC 距离同尺并含拐角切割余量——
    //   走线口径 radiusT = sqrt(D_trace² + grid²/2)，其中
    //     D_trace = viaOuter/2+clearance+W/2（DRC via-trace，:5592）
    //     余量项 = 相邻格连线对 DRC 盘的最大弦矢差（格心距 ≥ radiusT 的
    //     相邻格连线，最近点距过孔心 ≥ D_trace——无此余量时对角相邻格的
    //     连线可切入 DRC 盘 0.02~0.12mm，n142 实测 +2 间距冲突）。
    //   过孔口径 radiusV = viaOuter+clearance（DRC via-via，:5563）——点对点
    //     无弦矢差，精确值即可。
    // 旧实现单半径取 max(两者)：过孔口径正确，走线口径在 (via-trace, via-via)
    // 带内过度封锁（BGA-64 的 0.42-0.53mm 带是内圈球的逃逸通道，封死它
    // = 138 个 DRC 主因）。
    const radiusT=_vRadiusT, radiusV=_vRadiusV;
    for(const net of nets){
      const o=net.i+1;
      for(const [c,via] of net.viaSet){
        // span 感知（0.13.18 #15b）：盲埋孔只在其跨度层标记走线影响区
        const layers=via.layers||allLayers;
        const gx=c%GW, gy=(c-gx)/GW;
        const rT=radiusT/grid, riT=Math.ceil(rT);
        const tx0=Math.max(0,gx-riT), tx1=Math.min(GW-1,gx+riT);
        const ty0=Math.max(0,gy-riT), ty1=Math.min(GH-1,gy+riT);
        for(const l of layers){
          const off=l*NC;
          for(let y=ty0;y<=ty1;y++) for(let x=tx0;x<=tx1;x++){
            if(Math.hypot(x-gx,y-gy)>=rT) continue;
            const s=off+y*GW+x;
            if(tmpOwner[s]===0) tmpOwner[s]=o;
            else if(tmpOwner[s]!==o) tmpMulti[s]=1;
          }
        }
        // 过孔口径（列索引保守——DRC via-via 盘在 barrel 的最宽点）
        markViaInfluence(model,c,radiusV,o,tmpOwnerV,tmpMultiV);
      }
    }
    for(let t=0;t<TS;t++) viaInf[t]=tmpMulti[t]? -2 : tmpOwner[t];
    for(let t=0;t<NC;t++) viaInfV[t]=tmpMultiV[t]? -2 : tmpOwnerV[t];
    for(const n of nets) _viaSnap.set(n.i,[...n.viaSet]);
  }
  // 增量补丁：只重算「自上次重建以来 viaSet 有变化的网」的旧∪新过孔盘覆盖区。
  // 位级一致论证：区域外格的贡献从未变化（补丁不触碰）；区域内格先清零再重放
  // 全部相交过孔盘——重放与 rebuild 的标记算式逐行同构，owner/multi 终值与
  // 标记次序无关（0→o；≠o→-2；===o 保持），故区域内终值=全量重建值。
  // stale 窗口语义不变：rip 后、补丁前 viaInf 保持旧态（与原 rebuild 时序一致）。
  function patchViaInf(){
    passMaskEpoch++;
    const changed=[];
    for(const net of nets){
      const snap=_viaSnap.get(net.i);
      const cur=net.viaSet;
      if(!snap){ if(cur.size) changed.push({net, old:[]}); continue; }
      if(snap.length!==cur.size){ changed.push({net, old:snap}); continue; }
      let same=true, idx=0;
      for(const [c,via] of cur){
        const sv=snap[idx++];
        if(sv[0]!==c){ same=false; break; }
        const la=via.layers||allLayers, lb=sv[1].layers||allLayers;
        if(la!==lb&&(la.length!==lb.length||la[0]!==lb[0]||la[1]!==lb[1])){ same=false; break; }
      }
      if(!same) changed.push({net, old:snap});
    }
    if(!changed.length) return;
    const rT=_vRadiusT/grid, riT=Math.ceil(rT), rV=_vRadiusV/grid, riV=Math.ceil(rV);
    // 区域 bbox（T/V 两口径各自收集）
    let tx0=Infinity,tx1=-Infinity,ty0=Infinity,ty1=-Infinity;
    let vx0=Infinity,vx1=-Infinity,vy0=Infinity,vy1=-Infinity;
    for(const ch of changed){
      for(const [c] of ch.old) {
        const gx=c%GW, gy=(c-gx)/GW;
        tx0=Math.min(tx0,gx-riT); tx1=Math.max(tx1,gx+riT);
        ty0=Math.min(ty0,gy-riT); ty1=Math.max(ty1,gy+riT);
        vx0=Math.min(vx0,gx-riV); vx1=Math.max(vx1,gx+riV);
        vy0=Math.min(vy0,gy-riV); vy1=Math.max(vy1,gy+riV);
      }
      for(const [c] of ch.net.viaSet){
        const gx=c%GW, gy=(c-gx)/GW;
        tx0=Math.min(tx0,gx-riT); tx1=Math.max(tx1,gx+riT);
        ty0=Math.min(ty0,gy-riT); ty1=Math.max(ty1,gy+riT);
        vx0=Math.min(vx0,gx-riV); vx1=Math.max(vx1,gx+riV);
        vy0=Math.min(vy0,gy-riV); vy1=Math.max(vy1,gy+riV);
      }
    }
    tx0=Math.max(0,tx0); tx1=Math.min(GW-1,tx1); ty0=Math.max(0,ty0); ty1=Math.min(GH-1,ty1);
    vx0=Math.max(0,vx0); vx1=Math.min(GW-1,vx1); vy0=Math.max(0,vy0); vy1=Math.min(GH-1,vy1);
    if(tx0>tx1||ty0>ty1){ /* 不可能：changed 非空 */ }
    // 清零区域（T：全层区域列；V：区域格）——区域内旧贡献全部抹除
    for(const ch of changed){
      for(const [c,via] of ch.old){
        const gx=c%GW, gy=(c-gx)/GW;
        const ax0=Math.max(0,gx-riT), ax1=Math.min(GW-1,gx+riT);
        const ay0=Math.max(0,gy-riT), ay1=Math.min(GH-1,gy+riT);
        for(const l of (via.layers||allLayers)){
          const off=l*NC;
          for(let y=ay0;y<=ay1;y++) for(let x=ax0;x<=ax1;x++) viaInf[off+y*GW+x]=0;
        }
        const bx0=Math.max(0,gx-riV), bx1=Math.min(GW-1,gx+riV);
        const by0=Math.max(0,gy-riV), by1=Math.min(GH-1,gy+riV);
        for(let y=by0;y<=by1;y++) for(let x=bx0;x<=bx1;x++) viaInfV[y*GW+x]=0;
      }
      for(const [c,via] of ch.net.viaSet){
        const gx=c%GW, gy=(c-gx)/GW;
        const ax0=Math.max(0,gx-riT), ax1=Math.min(GW-1,gx+riT);
        const ay0=Math.max(0,gy-riT), ay1=Math.min(GH-1,gy+riT);
        for(const l of (via.layers||allLayers)){
          const off=l*NC;
          for(let y=ay0;y<=ay1;y++) for(let x=ax0;x<=ax1;x++) viaInf[off+y*GW+x]=0;
        }
        const bx0=Math.max(0,gx-riV), bx1=Math.min(GW-1,gx+riV);
        const by0=Math.max(0,gy-riV), by1=Math.min(GH-1,gy+riV);
        for(let y=by0;y<=by1;y++) for(let x=bx0;x<=bx1;x++) viaInfV[y*GW+x]=0;
      }
    }
    // 重放：全部网的现役过孔，与区域 bbox 相交者整盘重标（区域外幂等）
    const anyVias=nets.some(n=>n.viaSet.size);
    if(anyVias){
      for(const net of nets){
        const o=net.i+1;
        for(const [c,via] of net.viaSet){
          const gx=c%GW, gy=(c-gx)/GW;
          if(gx+riT<tx0||gx-riT>tx1||gy+riT<ty0||gy-riT>ty1) continue;
          const ax0=Math.max(0,gx-riT), ax1=Math.min(GW-1,gx+riT);
          const ay0=Math.max(0,gy-riT), ay1=Math.min(GH-1,gy+riT);
          for(const l of (via.layers||allLayers)){
            const off=l*NC;
            for(let y=ay0;y<=ay1;y++) for(let x=ax0;x<=ax1;x++){
              if(Math.hypot(x-gx,y-gy)>=rT) continue;
              const s=off+y*GW+x;
              if(viaInf[s]===0) viaInf[s]=o;
              else if(viaInf[s]!==o) viaInf[s]=-2;
            }
          }
          if(gx+riV<vx0||gx-riV>vx1||gy+riV<vy0||gy-riV>vy1) continue;
          const bx0=Math.max(0,gx-riV), bx1=Math.min(GW-1,gx+riV);
          const by0=Math.max(0,gy-riV), by1=Math.min(GH-1,gy+riV);
          for(let y=by0;y<=by1;y++) for(let x=bx0;x<=bx1;x++){
            if(Math.hypot(x-gx,y-gy)>=rV) continue;
            const s=y*GW+x;
            if(viaInfV[s]===0) viaInfV[s]=o;
            else if(viaInfV[s]!==o) viaInfV[s]=-2;
          }
        }
      }
    }
    viaInfEmpty=!anyVias;
    for(const ch of changed) _viaSnap.set(ch.net.i,[...ch.net.viaSet]);
  }

  // ---- 单元通行判断 ----
  function passable(net, s){
    if(net.prefL!=null && ((s/NC)|0)!==net.prefL) return false;   // 批次5 探针：硬层位约束
    if(blocked[s]) return false;
    // class keepout（roadmap #10）：scope 类名的禁布对异类网阻挡、本类网自由
    if(model.scopedBlocked.length){
      const c=s%NC;
      for(const sb of model.scopedBlocked)
        if(net.cls!==sb.cls && sb.cells[c]) return false;
    }
    const fixed=model.fixedOwner[s];
    if(fixed!==0&&fixed!==net.i+1) return false;
    const po=padOwner[s];
    if(po!==0 && po!==net.i+1) return false;
    const vi=viaInf[s];   // TS 索引（0.13.18 span 化：盲埋孔只挡 span 内层走线）
    if(vi!==0 && vi!==net.i+1) return false;
    return true;
  }
  function enterOK(net, s, hard){
    if(S.pairBand && !S.pairBand.has(s)) return false;   // 差分压实限带（0.13.27；null=关闭零开销）
    if(!passable(net,s)) return false;
    if(hard){
      const own=net.cells.has(s)?1:0;
      if(usage[s]-own>0) return false;
    }
    return true;
  }

  // ---- A* 迷宫搜索（多起点 → 目标集合） ----
  const BIG=1e9;
  const gVal=new Float32Array(TS), gStamp=new Int32Array(TS);
  const par=new Int32Array(TS), dirA=new Int8Array(TS);
  const closed=new Int32Array(TS);
  let gen=0;
  const hMap=new Float32Array(TS);
  const hQueue=new Int32Array(TS);
  // Search is synchronous: reuse numeric heap/neighbor buffers across expansions and searches.
  // Keep insertion order and strict tie comparisons identical to the allocating implementation.
  // 第十轮深度优化（R9 剖析 roadmap①）：堆改预分配类型化数组（普通数组 push/pop 的扩容与
  // 装箱开销在 pop 14% + astar 46% 的热路径里占比可观）——筛选算法逐行保持一致 → 弹出顺序逐位一致。
  let heapStates=new Int32Array(8192), heapCosts=new Float64Array(8192), heapSize=0;
  const heapGrow=()=>{
    const ns2=new Int32Array(heapStates.length*2), nc2=new Float64Array(heapCosts.length*2);
    ns2.set(heapStates); nc2.set(heapCosts);
    heapStates=ns2; heapCosts=nc2;
  };
  // 同一次 A* 的 usage/ownStamp/hard/presFac 固定；环偏移不含中心，扫描与换层层对无关。
  // Float64 保存原序累加的罚分，不引入 Float32 舍入。最多额外 12MB，大板直算回退。
  const viaRingPenalty=NC<=1_000_000?new Float64Array(NC):null;
  const viaRingStamp=viaRingPenalty?new Int32Array(NC):null;
  const ownStamp=new Int32Array(TS);   // 本网格成员戳（gen 同周期）——替代热路径 net.cells.has
  const nbStates=new Int32Array(10), nbKinds=new Int8Array(10), nbDirs=new Int8Array(10);

  // 目标集合到全场的下界距离（忽略障碍 BFS，保证可采纳）
  // 第九轮剖析：fillDistanceMap 占 28%。缓存假设经 A/B 证伪（命中率 1.3%——RMST 逐边
  // 目标集含动态布线格，键几乎不重复；收益在机器噪声内）→ 回退，留档为 roadmap
  // （方向：按网的目标焊盘集缓存 + 对动态格的松弛修正，或 A* 内环类型化堆）。
  const DIAGD=[null,null,null,null,[-1,-1],[1,-1],[-1,1],[1,1]];   // 方向4..7 = 左上/右上/左下/右下
  // 0.14.9 障碍感知启发式：本网"无条件可通行"掩码（会话级复用，TS ≤8M 才启用——
  // 内存 1B/状态；超限回退旧盲口径）。每次 computeH 全量重建（写点均为逐格无条件
  // 赋值，无跨调用残留）。判定链与 passable/enterOK 逐字段同源：
  // prefL → blocked → scoped(cls) → fixedOwner → padOwner → viaInf → pairBand →
  // hard-usage（usage 快照=本次 astar 调用时刻，call 内一致）。
  // 排除项（有意不 gate，保持可采纳）：viaLegal（过孔可用性被高估→h 更小）、
  // 软阶段 usage（可借道付罚）、hist/nearPen/presFac（软代价，h 是下界）。
  const passMask=TS<=8_000_000?new Uint8Array(TS):null;
  // 0.14.9b 障碍感知启发式转正：默认开（组合一致场，见 fillDistanceMap 头注——
  // 一致性可证 + 五板 A/B 质量全面 ≥ 盲口径：h2 DRC 39→12、fable/icebreaker 连通
  // 持平且 1.37-1.88× 提速）；opts.obstacleH===false / CLI --no-obstacle-h 回退盲口径
  //（0.14.8 位级一致逃生门）。0.14.9 分离场版本的质量回归（fable −1/icebreaker −11）
  // 已由深检定位为非一致场次优路径机制，组合场根除——见深度检查报告-0.14.9.md。
  const obstacleH=opts.obstacleH!==false;
  function buildPassMask(net, hard){
    const own=net.i+1, cls=net.cls, prefL=net.prefL==null?-1:net.prefL;
    const band=S.pairBand, hard2=!!hard;
    const scopedArr=model.scopedBlocked, hasScoped=scopedArr.length>0;
    const fx=fixedOwner, po=padOwner, vi=viaInf, bl=blocked, us=usage, os=ownStamp;
    if(prefL>=0){
      // 硬层位约束：非 prefL 层整体置 0（省逐格 (t/NC)|0 除法）
      const off=prefL*NC;
      for(let t=0;t<off;t++) passMask[t]=0;
      for(let t=off;t<off+NC;t++){
        let ok=1;
        if(bl[t]) ok=0;
        else if(hasScoped){ const c=t%NC;
          for(let si=0;si<scopedArr.length;si++){ const sb=scopedArr[si];
            if(cls!==sb.cls&&sb.cells[c]){ ok=0; break; } } }
        if(ok){ const f=fx[t]; if(f!==0&&f!==own) ok=0; }
        if(ok){ const p=po[t]; if(p!==0&&p!==own) ok=0; }
        if(ok){ const v=vi[t]; if(v!==0&&v!==own) ok=0; }
        if(ok&&band&&!band.has(t)) ok=0;
        if(ok&&hard2&&us[t]-(os[t]===gen?1:0)>0) ok=0;
        passMask[t]=ok;
      }
      for(let t=off+NC;t<TS;t++) passMask[t]=0;
    } else {
      for(let t=0;t<TS;t++){
        let ok=1;
        if(bl[t]) ok=0;
        else if(hasScoped){ const c=t%NC;
          for(let si=0;si<scopedArr.length;si++){ const sb=scopedArr[si];
            if(cls!==sb.cls&&sb.cells[c]){ ok=0; break; } } }
        if(ok){ const f=fx[t]; if(f!==0&&f!==own) ok=0; }
        if(ok){ const p=po[t]; if(p!==0&&p!==own) ok=0; }
        if(ok){ const v=vi[t]; if(v!==0&&v!==own) ok=0; }
        if(ok&&band&&!band.has(t)) ok=0;
        if(ok&&hard2&&us[t]-(os[t]===gen?1:0)>0) ok=0;
        passMask[t]=ok;
      }
    }
  }
  // 0.14.9b 掩码缓存：mask 是 {net 恒等字段, model 静态, viaInf, usage-异网, pairBand,
  // hard} 的纯函数。routeNet(N) 内部：pairBand 不变、viaInf 只在尾部 patch、usage 只有
  // N 自己的 commit（own 提交经 usage+1/ownStamp=gen 配对抵消——缓存构造时该格
  // usage-0、真值 usage-1=同值，可采纳判定逐格一致），故 routeNet 内跨 astar 调用
  // 掩码逐位不变 → 以 (epoch, net.i, hard) 缓存。失效点（passMaskEpoch++）= 全部
  // 异网 usage/viaInf/pairBand 写点：ripNet/rebuildViaInf/patchViaInf/restore/
  // adoptShared/commitRoutes/optimize 回滚/compactPairs pairBand 置位。多失效无害，
  // 漏失效为正确性 bug——探针逐 astar 重算比对验证完备性（.scratch probe）。
  let passMaskEpoch=0, maskCacheEpoch=-1, maskCacheNet=-1, maskCacheHard=null;
  function computeH(goalSet, net, hard){
    if(obstacleH && passMask){
      if(maskCacheEpoch!==passMaskEpoch || maskCacheNet!==net.i || maskCacheHard!==hard){
        buildPassMask(net, hard);
        maskCacheEpoch=passMaskEpoch; maskCacheNet=net.i; maskCacheHard=hard;
      }
      fillDistanceMap(model,goalSet,viaCost,diagOn,hMap,hQueue,passMask);
    }else{
      fillDistanceMap(model,goalSet,viaCost,diagOn,hMap,hQueue);
    }
  }

  function astar(net, sources, goalSet, hard){
    const _prefL=net.prefL==null?-1:net.prefL;   // 批次5 探针：硬层位约束（-1=无约束零开销）
    // pair 网：走廊边权地板 0.25 → 启发式 ×0.25 保持可采纳性（否则 A* 会剪掉折扣走廊分支）
    const netHScale=(netMeta[net.i]&&netMeta[net.i].pair)?0.25:1;
    const myPair=netMeta[net.i] ? netMeta[net.i].pair : null;    // 热循环外提取（每邻居不再读对象）
    const myHs=netMeta[net.i] ? netMeta[net.i].hs : false;
    // 2026-11-15 深优二段：热点名提升为 astar 局部别名——presFac/layerDirOn 是轮边界外
    // 变写的 let（V8 无法常量化，只能逐次上下文槽读），usage/ownStamp/hist/hMap 是逐邻居
    // 多次访问的 typed 数组引用。全部在本次调用内不变（轮间变化发生在 astar 之外），
    // 逐位一致。netMeta/hMap 在 :1070-1072 已有同款先例。
    // 0.14.8 深优：别名块扩展——blocked/padOwner/viaInf/cellOwner/gVal/gStamp/par/dirA/
    // closed/nearPenCache/nearPenStamp/pairBonusTyped/fixedOwner 全部提升为 astar 局部
    // const（此前仅 usage/ownStamp/hist/hMap 四个）。这些数组在本次调用内不变（写点
    // 均在 astar 之外：commit/rip/hist 更新/patchViaInf），每邻居省多次上下文槽读。
    const pf=presFac, ldOn=layerDirOn,
      usageA=usage, ownStampA=ownStamp, histA=hist, hMapA=hMap,
      blkA=blocked, poA=padOwner, viA=viaInf, coA=cellOwner, fxO=fixedOwner,
      gVA=gVal, gSA=gStamp, parA=par, dirAA=dirA, closedA=closed,
      npC=nearPenCache, npS=nearPenStamp, pbT=pairBonusTyped,
      vrS=viaRingStamp, vrP=viaRingPenalty;
    const hScale=netHScale||1;   // push 逐次 `||1` 提升到环外（每次调用内不变）
    if(!goalSet.size) return null;
    // 0.14.9：gen++/戳位前移到 computeH 之前——障碍感知掩码的 hard-usage 判定需要
    // 本网成员戳（ownStamp[s]===gen ⟺ s∈net.cells）。gen 只被 gVal/gStamp/closed/
    // ownStamp 四个戳数组消费，computeH 只写 hMap（无戳），先后顺序交换无交互。
    gen++;
    heapSize=0;
    // 本网成员戳：热路径 net.cells.has → ownStamp[s]===gen（O(1) 类型化读；
    // gen 一次自增覆盖 gVal/gStamp/closed/ownStamp 同生命周期，调用结束即失效）
    for(const s of net.cells) ownStamp[s]=gen;
    computeH(goalSet, net, hard);
    // swap 内联（V8 对捕获多外层变量的闭包常不内联——堆占档案 17.8%）
    // 2026-11-15 深优：堆数组/大小拷贝进局部（heapSize 在筛化期间只读快照 hs——
    // push/pop 各自入口一次增减后筛化循环内无写入），消除热循环逐层的上下文槽读。
    // 0.14.8 深优：筛化改 hole 法（携带元素留寄存器、空洞下移/上移）——每层 4 读 4 写
    // → 2 读 2 写；子选择（平手取左）、终止条件与最终布局与 swap 法逐位一致：
    // 筛上=父>携带元素才下移父；筛下=先取较小子（b 严格小才取 b，同原 m 选择序），
    // 较小子 ≥ 携带元素即停。堆最终布局逐位一致 → 后续弹出序逐位一致。
    const push=(f,i)=>{
      if(heapSize===heapStates.length) heapGrow();
      const hsA=heapStates, hcA=heapCosts;
      let j=heapSize; heapSize=j+1;
      while(j>0){ const p=(j-1)>>1; if(hcA[p]<=f) break;
        hsA[j]=hsA[p]; hcA[j]=hcA[p]; j=p; }
      hsA[j]=i; hcA[j]=f; };
    const pop=()=>{ const hsA=heapStates, hcA=heapCosts;
      const top=hsA[0]; heapSize--;
      const hs=heapSize;
      if(hs){ const lastS=hsA[hs], lastC=hcA[hs];
        let j=0;
        for(;;){ const a=2*j+1; if(a>=hs) break;
          const b=a+1, m=(b<hs&&hcA[b]<hcA[a])?b:a;
          if(hcA[m]>=lastC) break;
          hsA[j]=hsA[m]; hcA[j]=hcA[m]; j=m; }
        hsA[j]=lastS; hcA[j]=lastC; }
      return top; };

    const own=net.i+1;
    for(const s of sources){
      if(!enterOK(net,s,hard)) continue;
      if(hMap[s]>=BIG) continue;
      gVal[s]=0; gStamp[s]=gen; par[s]=-1; dirA[s]=-1;
      push(hMap[s], s);
    }
    let found=-1;
    // 2026-11-15 深优：会话级常量外提（原逐邻居经闭包上下文读）——会话内不变，
    // 与 enterOK/passable 逐字段同源（内联见下方 nbr 环，字段序保持原判定序）
    const pairBand=S.pairBand;
    const scopedArr=model.scopedBlocked, hasScoped=scopedArr.length>0;
    while(heapSize){
      const cur=pop();
      if(closedA[cur]===gen) continue;
      closedA[cur]=gen;
      if(goalSet.has(cur)){ found=cur; break; }
      const gc=gSA[cur]===gen? gVA[cur] : BIG;
      const pd=dirAA[cur];
      const c=cur%NC, l=(cur/NC)|0;
      // 邻居：[状态, 是否过孔, 方向]
      const canL=c%GW>0, canR=c%GW<GW-1, canU=c>=GW, canD=c<GW*(GH-1);
      let nbCount=0;
      if(canL){ nbStates[nbCount]=cur-1; nbKinds[nbCount]=0; nbDirs[nbCount++]=0; }
      if(canR){ nbStates[nbCount]=cur+1; nbKinds[nbCount]=0; nbDirs[nbCount++]=1; }
      if(canU){ nbStates[nbCount]=cur-GW; nbKinds[nbCount]=0; nbDirs[nbCount++]=2; }
      if(canD){ nbStates[nbCount]=cur+GW; nbKinds[nbCount]=0; nbDirs[nbCount++]=3; }
      if(diagOn){
        if(canL&&canU){ nbStates[nbCount]=cur-GW-1; nbKinds[nbCount]=2; nbDirs[nbCount++]=4; }
        if(canR&&canU){ nbStates[nbCount]=cur-GW+1; nbKinds[nbCount]=2; nbDirs[nbCount++]=5; }
        if(canL&&canD){ nbStates[nbCount]=cur+GW-1; nbKinds[nbCount]=2; nbDirs[nbCount++]=6; }
        if(canR&&canD){ nbStates[nbCount]=cur+GW+1; nbKinds[nbCount]=2; nbDirs[nbCount++]=7; }
      }
      if(l>0){ nbStates[nbCount]=cur-NC; nbKinds[nbCount]=1; nbDirs[nbCount++]=-1; }
      if(l<L-1){ nbStates[nbCount]=cur+NC; nbKinds[nbCount]=1; nbDirs[nbCount++]=-1; }
      nbr:
      for(let ni=0;ni<nbCount;ni++){
        const ns=nbStates[ni], kind=nbKinds[ni], nd=nbDirs[ni];
        if(_prefL>=0 && ((ns/NC)|0)!==_prefL) continue nbr;   // 批次5 探针（passable 同源内联）
        // enterOK 内联（2026-11-15 深优）：passable/enterOK 为 (net,s) 纯函数，逐字段
        // 同序拷贝（pairBand → blocked → scoped → fixed → pad → viaInf → hard），
        // 短路结果逐位一致；hard 段 own 判定 net.cells.has(s) 与 ownStamp[s]===gen
        // 在本次 astar 生命周期内恒等（ownStamp 入口自 net.cells 全量置位，调用期间
        // net.cells 不变——commit/rip 均发生在 astar 之外）
        if(pairBand&&!pairBand.has(ns)) continue nbr;
        if(blkA[ns]) continue nbr;
        if(hasScoped){ const cc2=ns%NC;
          for(let si=0;si<scopedArr.length;si++){ const sb=scopedArr[si];
            if(net.cls!==sb.cls&&sb.cells[cc2]) continue nbr; } }
        { const fx=fxO[ns]; if(fx!==0&&fx!==own) continue nbr; }
        { const po=poA[ns]; if(po!==0&&po!==own) continue nbr; }
        { const vi=viA[ns]; if(vi!==0&&vi!==own) continue nbr; }
        if(hard&&usageA[ns]-(ownStampA[ns]===gen?1:0)>0) continue nbr;
        const hn=hMapA[ns]; if(hn>=BIG) continue;   // 0.14.8：复用到 push（省一次 typed 读）
        let ec=1+histA[ns];
        if(!hard){
          const o=usageA[ns]-(ownStampA[ns]===gen?1:0);
          if(o>0){
            // 借鉴 Freerouting MazeRipupResolver 的 ALREADY_RIPPED_COSTS：跨障按“障碍”计费
            // 而非按格计费——路径正在连续穿越同一拥塞区时只付一次全额，之后每格折扣，
            // 避免长距离借用被拆走线被逐格全额罚导致代价失真（index.html 源码研读笔记）。
            const prevOver = usageA[cur]-(ownStampA[cur]===gen?1:0) > 0;
            ec += prevOver ? 1+pf*(o-1) : pf*o;
            // 扇出借道附加罚（0.13.22 F3）：占用者为阵列网时加罚——0.13.21 冻结
            // 证伪（单向冻结阻断全局重排）的"价格版"后手：只抬价格不动属主，
            // 借道者在有余路时绕开逃逸通道，无余路时仍可冲突协商（与
            // Freerouting 拆扇出铜 ×139 软保护同构——差别只在我们按格计价）。
            // 仅 fanoutFirst 开启时生效；缺省 off 路径零改动。
            if(fanoutEff!=='off'){
              const foi=coA[ns]-1;
              if(foi>=0&&foi!==net.i&&nets[foi].fanoutRing!=null) ec+=fanoutBorrowPen;
            }
          }
        }
        if(kind===1){
          // 过孔几何合法性 + 间距环占用检查（span=相邻层，0.13.18 #15b B3）
          const cc=ns%NC;
          if(blindVias){
            // 盲埋孔：过孔物理 span=换层过渡的相邻两层——只查 span 内层焊盘
            const nsL=l+((ns-cur)/NC);
            if(!viaLegal(net, cc, Math.min(l,nsL), Math.max(l,nsL))) continue;
          } else {
            // 通孔：物理 span=全层——必须查全部层的异网焊盘（传相邻层会漏查
            // span 外层焊盘，BGA-64 4 层实测 +3 过孔压焊盘）
            if(!viaLegal(net, cc)) continue;
          }
          let bad=false, rpen=0;
          if(vrS&&vrS[cc]===gen){
            rpen=vrP[cc]; bad=rpen<0;
          }else{
            const gx=cc%GW, gy=(cc-gx)/GW;
            for(const [dx,dy] of ringOffs){
              const x=gx+dx, y=gy+dy;
              if(x<0||y<0||x>=GW||y>=GH) continue;
              const c2=y*GW+x;
              for(let l2=0;l2<L;l2++){
                const rs=l2*NC+c2;
                if(rs===ns||rs===cur) continue;
                const o=usageA[rs]-(ownStampA[rs]===gen?1:0);
                if(o>0){ if(hard){ bad=true; break; } rpen+=pf*o; }
              }
              if(bad) break;
            }
            if(vrS){ vrP[cc]=bad?-1:rpen; vrS[cc]=gen; }
          }
          if(bad) continue;
          ec+=viaCost+rpen;
        } else {
          if(kind===2){
            // 斜向移动：两个正交格必须可通行且未被其它网络占用
            //（防止斜切穿越、并保证平行斜线间距 ≥ 2 格对角距）
            const dd=DIAGD[nd], l0=(cur/NC)|0, c0=cur%NC;
            const s1=l0*NC+(c0+dd[0]), s2=l0*NC+(c0+dd[1]*GW);
            // passable 内联（同 nbr 环口径，passable 段无 pairBand/hard）
            { if(blkA[s1]) continue;
              if(hasScoped){ const c1=s1%NC;
                for(let si=0;si<scopedArr.length;si++){ const sb=scopedArr[si];
                  if(net.cls!==sb.cls&&sb.cells[c1]) continue nbr; } }
              const fx1=fxO[s1]; if(fx1!==0&&fx1!==own) continue;
              const po1=poA[s1]; if(po1!==0&&po1!==own) continue;
              const vi1=viA[s1]; if(vi1!==0&&vi1!==own) continue; }
            { if(blkA[s2]) continue;
              if(hasScoped){ const c2=s2%NC;
                for(let si=0;si<scopedArr.length;si++){ const sb=scopedArr[si];
                  if(net.cls!==sb.cls&&sb.cells[c2]) continue nbr; } }
              const fx2=fxO[s2]; if(fx2!==0&&fx2!==own) continue;
              const po2=poA[s2]; if(po2!==0&&po2!==own) continue;
              const vi2=viA[s2]; if(vi2!==0&&vi2!==own) continue; }
            if(hard){
              if(usageA[s1]-(ownStampA[s1]===gen?1:0)>0) continue;
              if(usageA[s2]-(ownStampA[s2]===gen?1:0)>0) continue;
            } else {
              const o1=usageA[s1]-(ownStampA[s1]===gen?1:0);
              const o2=usageA[s2]-(ownStampA[s2]===gen?1:0);
              if(o1>0) ec+=pf*o1;
              if(o2>0) ec+=pf*o2;
            }
            ec+=Math.SQRT2-1;   // 斜向基础代价 √2
          }
          if(pd>=0 && nd!==pd) ec+=turnPen;
          if(ldOn){
            // 分层首选方向：相邻层正交（偶数层横走、奇数层竖走）
            const prefH=(l%2)===0;
            const horiz=(nd===0||nd===1);
            if(kind===2) ec+=offDir*0.5;
            else if(prefH!==horiz) ec+=offDir;
          }
        }
        if(!hard) {
          // 邻近占用罚逐格缓存（gen 戳）：同一格的 nearPen 与入边数无关地重复计算
          // 至 4 次（斜向再多）——每生成格算一次即可，位级同值
          let nearPen;
          if(npC && npS[ns]===gen) nearPen=npC[ns];
          else{
            const cell2=ns%NC, tc2=cell2%GW, nr2=(cell2-tc2)/GW;
            nearPen=0;
            if(tc2+1<GW) nearPen+=adjPenAt(net, ns+1, myPair);
            if(tc2-1>=0) nearPen+=adjPenAt(net, ns-1, myPair);
            if(nr2+1<GH) nearPen+=adjPenAt(net, ns+GW, myPair);
            if(nr2-1>=0) nearPen+=adjPenAt(net, ns-GW, myPair);
            // 3W 偏置（Bogatin B.74-79/ch10）：高速网在 2 格内遇其它网占用格加软罚
            // （只加代价不阻塞；同对豁免。栅格≈线宽+间距，2 格≈3W 量级）
            if(myHs){
              const lN=(ns/NC)|0;
              for(let k=0;k<ring2Offs.length;k++){
                const x=tc2+ring2Offs[k][0], y=nr2+ring2Offs[k][1];
                if(x<0||y<0||x>=GW||y>=GH) continue;
                const s3=lN*NC+y*GW+x;
                if(usageA[s3]<=0 || ownStampA[s3]===gen) continue;
                const oi=coA[s3]-1;
                if(myPair && oi>=0 && netMeta[oi] && netMeta[oi].pair===myPair) continue;
                nearPen+=1;
              }
            }
            if(npC){ npC[ns]=nearPen; npS[ns]=gen; }
          }
          ec+=nearPen;
        }
        // 差分对耦合走廊：伙伴已布走线的贴邻格成本折扣（0.5 地板保持边权>0；
        // 硬/软两阶段均生效——硬阶段无拥塞代价，正是走廊引导窗口）
        {
          // pairBonusGet 内联（2026-11-15 深优）：逐邻居闭包调用 → typed 直读；
          // 语义逐位一致（pairBonusTyped 会话内只增不减，非空性可在环外判定）。
          // 0.14.8 深优：先整判后除——pb=0（绝大多数格）跳过浮点除法；
          // pb≠0 时 b=pb/1000 必非零，判定结果与原式逐位一致
          const pb=pbT?pbT.val[ns]:(pairBonus.get(ns)||0);
          if(pb){ const b=pb/1000; if(b) ec=Math.max(0.25, ec-b); } // 折扣：走廊格实付边权=基础−折扣（地板 0.25）
        }
        const ng=gc+ec;
        if(!(gSA[ns]===gen) || ng<gVA[ns]){
          gVA[ns]=ng; gSA[ns]=gen; parA[ns]=cur; dirAA[ns]=nd;
          push(ng+hn*hScale, ns);
        }
      }
    }
    if(found<0) return null;
    const path=[]; let s=found;
    while(s!==-1){ path.push(s); s=parA[s]; }
    path.reverse();
    return path;
  }

  // ---- 路径提交 / 拆除 ----
  function addVia(net, c, tree, fromL, toL){
    let from=fromL!=null?fromL:0, to=toL!=null?toL:L-1;
    if(from>to){ const t=from; from=to; to=t; }   // 防御排序——反序 span 会毒化加宽的 min/max（[1,1] 实测）
    const full=(from===0&&to===L-1);
    const existing=net.viaSet.get(c);
    if(existing){
      // 同格重入：扩展 span（跨轮或同网路径的多段换层共享一颗过孔）。
      // 替换而非原地改——snapshot/restore 共享值对象，原地改会污染快照。
      const [ef,et]=existing.layers||[0,L-1];
      const nf=Math.min(ef,from), nt=Math.max(et,to);
      const nfull=(nf===0&&nt===L-1);
      if(nf!==ef||nt!==et)
        net.viaSet.set(c, nfull?{x:existing.x,y:existing.y}
                              :{x:existing.x,y:existing.y,layers:[nf,nt]});
      for(let l=nf;l<=nt;l++){
        const s=l*NC+c;
        if(!net.cells.has(s)){ net.cells.add(s); usage[s]++; cellOwner[s]=net.i+1; }
        tree.add(s);
      }
      return;
    }
    // layers 字段仅在非全层 span 时落盘（缺省通孔输出与 0.13.17 位级一致）
    net.viaSet.set(c, full?{x:cxOf(c),y:cyOf(c)}
                          :{x:cxOf(c),y:cyOf(c),layers:[from,to]});
    viaCore[c]=net.i+1;
    for(let l=from;l<=to;l++){
      const s=l*NC+c;
      if(!net.cells.has(s)){ net.cells.add(s); usage[s]++; cellOwner[s]=net.i+1; }
      tree.add(s);
    }
  }
  function commitPath(net, path, tree){
    let prev=-1;
    for(const s of path){
      if(prev>=0){
        const pc=prev%NC, cc=s%NC;
        if(pc===cc && prev!==s){
          if(blindVias){
            const pl=(prev/NC)|0;
            addVia(net, cc, tree, pl, (s/NC)|0);   // 换层 → 相邻层盲埋孔（#15b）
          } else addVia(net, cc, tree);   // 通孔（缺省，输出位级不变）
        }
        else if(((prev/NC)|0)===((s/NC)|0)){
          // 斜向移动：占用两个正交格作为间距排除区（拆线时随 net.cells 一并释放）
          const g0=prev%NC, l0=(prev/NC)|0;
          const dx=(cc%GW)-(g0%GW), dy=((cc-(cc%GW))/GW)-((g0-(g0%GW))/GW);
          if(dx!==0 && dy!==0){
            for(const c3 of [g0+dx, g0+dy*GW]){
              const s3=l0*NC+c3;
              if(!net.cells.has(s3)){ net.cells.add(s3); usage[s3]++; cellOwner[s3]=net.i+1; }
            }
          }
        }
      }
      if(!net.cells.has(s)){ net.cells.add(s); usage[s]++; cellOwner[s]=net.i+1; }
      tree.add(s);
      prev=s;
    }
    net.paths.push(path.map(s=>{
      const c=s%NC, l=(s/NC)|0;
      return {x:cxOf(c), y:cyOf(c), l};
    }));
  }
  function ripNet(net){
    passMaskEpoch++;
    clearPairBonus(net);
    for(const s of net.cells){
      usage[s]--;
      if(usage[s]<=0) cellOwner[s]=0;
    }
    net.cells.clear();
    for(const [c] of net.viaSet) if(viaCore[c]===net.i+1) viaCore[c]=0;
    net.viaSet.clear(); net.paths=[];
  }

  // ---- 布一个网络：RMST（Hanan 网格斯坦纳树）分解优先，失败回退 Prim 逐焊盘接入 ----
  const rmstCache=new Map();
  function routeNet(net, hard){
    const pads=padsByNet.get(net.i)||[];
    net.failed=0; net.total=pads.length;
    if(pads.length<2){ net.connected=pads.length; return; }
    // 连通判定：焊盘覆盖单元与已布单元有交集
    const countConn=()=>{
      let c=0;
      for(const p of pads){
        const cs=padCells.get(p.id)||[];
        if(cs.some(s=>net.cells.has(s))) c++;
      }
      return c;
    };
    const primRoute=()=>{
      let root=-1;
      for(let k=0;k<pads.length;k++) if((padCells.get(pads[k].id)||[]).length){ root=k; break; }
      if(root<0){ net.failed=pads.length; net.connected=0; return; }
      const inT=new Array(pads.length).fill(false); inT[root]=true;
      const order=[root];
      // 深优 2026-11-14：Prim 选序 O(p³)→O(p²)——维护各未接盘到树的当前最近距离。
      // 每对距离只算一次（算式逐位相同），min 语义与严格 < 的扫描序不变 → 选中序位级一致
      const minD=new Float64Array(pads.length).fill(Infinity);
      for(let i=0;i<pads.length;i++){ if(inT[i]) continue;
        const dx=pads[i].x-pads[root].x, dy=pads[i].y-pads[root].y; minD[i]=dx*dx+dy*dy; }
      while(order.length<pads.length){
        let bi=-1, bd=Infinity;
        for(let i=0;i<pads.length;i++){
          if(inT[i]) continue;
          if(minD[i]<bd){ bd=minD[i]; bi=i; }
        }
        inT[bi]=true; order.push(bi);
        for(let i=0;i<pads.length;i++){ if(inT[i]) continue;
          const dx=pads[i].x-pads[bi].x, dy=pads[i].y-pads[bi].y, d=dx*dx+dy*dy;
          if(d<minD[i]) minD[i]=d;
        }
      }
      const tree=new Set();
      for(const s of (padCells.get(pads[root].id)||[])) tree.add(s);
      for(let k=0;k<pads.length;k++){
        if(k===root) continue;
        const p=pads[order[k]];
        const cells=padCells.get(p.id)||[];
        if(!cells.length) continue;
        let touching=false;
        for(const s of cells) if(tree.has(s)){ touching=true; break; }
        if(touching){
          // 天然连通（pad cells 与树共享格）：cells 必须并入 net.cells——
          // countConn 以 net.cells 判定，不并入则天然连通网每轮被误计为失败
          // （M1 生成器实测：同网相邻脚 pad 距 < 格+盘径即触发，connected 恒 0）
          for(const s of cells) net.cells.add(s);
          continue;
        }
        const src=cells.filter(s=>enterOK(net,s,hard));
        if(!src.length) continue;
        const path=astar(net, src, tree, hard);
        if(!path) continue;
        commitPath(net, path, tree);
      }
      net.connected=countConn();
      net.failed=net.total-net.connected;
      patchViaInf();   // 深优 2026-11-14：routeNet 尾部增量补丁（快照差分口径，位级一致）
    };
    // RMST 分解（Hanan 网格直角斯坦纳树；引脚过多时 rmstTasks 返回 null）
    // Prim 未全连 → RMST 回退（同尺重试；RMST goal=dst 语义 0.6.3 已修复）
    ripNet(net);
    // Prim 为主（外部板实测更快且质量同级：iCEBreaker 4 层 Prim 156.7s/419 vs RMST 293.6s/413）
    primRoute();
    if(net.failed===0){ buildPairBonus(net); return; }
    // Prim 未全连 → RMST 回退（同尺重试；RMST goal=dst 语义 0.6.3 已修复）
    ripNet(net);
    if(pads.length<=48){
      let tasks=null;
      if(rmstCache.has(net.i)) tasks=rmstCache.get(net.i);
      else{
        try{ tasks=rmstTasks(pads.map(p=>({x:p.x,y:p.y}))); }catch(e){ tasks=null; }
        rmstCache.set(net.i,tasks);
      }
            if(tasks && tasks.length){
        const padAt=c=>pads.find(p=>Math.abs(p.x-c.x)<1e-9&&Math.abs(p.y-c.y)<1e-9)||null;
        const nodeStates=c=>{
          const p=padAt(c);
          if(p) return (padCells.get(p.id)||[]).slice();
          const i=Math.max(0,Math.min(GW-1,Math.floor(c.x/grid-0.5)));
          const j=Math.max(0,Math.min(GH-1,Math.floor(c.y/grid-0.5)));
          return Array.from({length:L},(_,l)=>l*NC+j*GW+i);
        };
        const tree=new Set();
        for(const s of (padCells.get(pads[0].id)||[])) tree.add(s);
        const steiner=new Map();   // 斯坦纳节点 -> 实际到达的状态
        let anyFail=false;
        for(const tk of tasks){
          const dst=nodeStates(tk.to);
          if(dst.some(s=>tree.has(s))) continue;      // 目标已在树中（重叠焊盘等）
          const src=(steiner.get(tk.from.x+'_'+tk.from.y) || nodeStates(tk.from))
            .filter(s=>enterOK(net,s,hard));
          if(!src.length){ anyFail=true; break; }
          // goal=dst（本边的目标焊盘格）：0.1.0 的 goal=tree∪dst 会"触树即终止"——
          // 源∈tree ⊆ goal → A* 在起点退化成单格路径 → RMST 永远失败、全部走
          // Prim 回退（外部板 iCEBreaker 实测定位的潜伏缺陷）。每条边路由到
          // 自己的目标；树保持仅用于碰撞/重布协商。
          const goal=new Set(dst);
          const path=astar(net, src, goal, hard);
          if(!path){ anyFail=true; break; }
          commitPath(net, path, tree);
                    if(!padAt(tk.to)) steiner.set(tk.to.x+'_'+tk.to.y, [path[path.length-1]]);
        }
        net.connected=countConn();
        net.failed=net.total-net.connected;
                patchViaInf();   // 深优 2026-11-14：RMST 尾部同款增量补丁
        // RMST 成功口径（0.6.3 修订）：goal=dst 修复后 RMST 语义正确，但外部板实测
        // Prim 顺序布线更快且质量同级（iCEBreaker 4 层：Prim 156.7s/419 vs RMST 293.6s/413）
        // → Prim 为主、RMST 仅在 Prim 未全连时作回退
        if(net.failed===0){ buildPairBonus(net); return; }
                ripNet(net);                                   // Prim 未全连 → RMST 回退
      }
    }
    if(net.failed===0) buildPairBonus(net);
    // RMST 也未全连：保留残局交协商阶段（failed 网优先重布 + 邻域拆除）
  }

  function scanOveruse(){
    const set=new Set();
    for(let s=0;s<TS;s++) if(usage[s]>1) set.add(s);
    // 过孔间距环与其它网络走线的冲突（协商阶段“先线后孔”遗留）
    for(const net of nets)for(const [c,via] of net.viaSet){
      const span=via.layers||allLayers;
      const gx=c%GW, gy=(c-gx)/GW;
      for(const [dx,dy] of ringOffs){
        const x=gx+dx, y=gy+dy;
        if(x<0||y<0||x>=GW||y>=GH) continue;
        const c2=y*GW+x;
        for(const l of span){
          const s=l*NC+c2;
          if(usage[s]-(net.cells.has(s)?1:0)>0) set.add(s);
        }
      }
    }
    for(const state of checkGeoSpacing()) set.add(state);
    return [...set];
  }
  function sortNets(failedFirst){
    for(const net of nets){
      const pads=padsByNet.get(net.i)||[];
      if(!pads.length){ net.prio=1e9; continue; }
      let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
      for(const p of pads){ x0=Math.min(x0,p.x); y0=Math.min(y0,p.y); x1=Math.max(x1,p.x); y1=Math.max(y1,p.y); }
      net.prio=(x1-x0)+(y1-y0)+2*(pads.length-2);
    }
    const arr=nets.slice().sort((a,b)=>a.prio-b.prio);
    if(failedFirst) arr.sort((a,b)=>((b.failedLast?1:0)-(a.failedLast?1:0))||((b.conflicted?1:0)-(a.conflicted?1:0))||(a.prio-b.prio));
    // 差分对相邻布线：伙伴紧跟其后（Bogatin ch11——第二网布线时第一网已就位，
    // nearPen 的对内豁免/平行倾向才能生效）
    const pairOf=n=>netMeta[n.i]&&netMeta[n.i].pair;
    const out=[]; const done=new Set();
    for(const n of arr){
      if(done.has(n.i)) continue;
      done.add(n.i); out.push(n);
      const pk=pairOf(n);
      if(pk){
        const partner=arr.find(m=>!done.has(m.i) && pairOf(m)===pk);
        if(partner){ done.add(partner.i); out.push(partner); }
      }
    }
    return out;
  }

  // ---- 会话状态机 ----
  const S={
    phase:'hard', queue:[], iter:0, hard:true,
    done:false, overuse:[], t0:Date.now(), processed:0, totalNets:0,
    lastFails:-1, stall:0,
    bestMetric:Infinity, bestSnap:null   // 历史最优协商状态（第五轮教训：迭代扰动会劣化）
  };
  function startQueue(failedFirst){
    let q=sortNets(failedFirst);
    // 扇出优先（0.13.20 F1）：仅 pass-1 首队列——阵列网按环深提到队首
    //（Freerouting BallEscapeOrder.moveToFront：内圈球在空板独占 claim 逃逸缝，
    // 外圈球总有自己的边缘出路；协商轮队列不动）
    if(!failedFirst&&fanoutEff!=='off') q=fanoutMoveToFront(q,fanoutEff);
    S.queue=q;
    S.processed=0; S.totalNets=S.queue.length;
  }
  /* 空间分片（阶段三 #13b）：把队列按"网的 bbox 落在哪个分片"分组。
     跨分片的网归**面积重叠最大**的分片（唯一属主）——这是与"时间维切批"
     的本质差别：同一分片内的网空间相邻，冲突才会在同一 worker 内串行可见。
     shards=0/1 时返回 null（调用方走原路径，位级不变）。
     分片是**软亲和**：只改变批内顺序，不改变 A* 与接受准则。 */
  function shardQueue(shards){
    const k=Math.max(0, shards|0);
    if(k<2 || S.queue.length<k) return null;
    const bbox=n=>{
      const ps=padsByNet.get(n.i)||[];
      if(!ps.length) return null;
      let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
      for(const p of ps){
        const hw=p.w/2, hh=(p.shape==='circle'?p.w:p.h)/2;
        x0=Math.min(x0,p.x-hw); x1=Math.max(x1,p.x+hw);
        y0=Math.min(y0,p.y-hh); y1=Math.max(y1,p.y+hh);
      }
      return {x0,x1,y0,y1};
    };
    // 分片网格：按板幅切成 ⌈√k⌉×⌈√k⌉（纵横比接近板幅，避免细长分片）
    const cols=Math.ceil(Math.sqrt(k)), rows=Math.ceil(k/cols);
    const sw=design.width/cols, sh=design.height/rows;
    const bucket=new Map();
    for(const n of S.queue){
      const b=bbox(n);
      let bi=0,bj=0;
      if(b){
        // 面积重叠最大：枚举所有分片，取交集面积最大者（确定性的 tie → 先小 index）
        let bestA=-1;
        for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){
          const ix0=Math.max(b.x0, i*sw), ix1=Math.min(b.x1,(i+1)*sw);
          const iy0=Math.max(b.y0, j*sh), iy1=Math.min(b.y1,(j+1)*sh);
          const a=Math.max(0,ix1-ix0)*Math.max(0,iy1-iy0);
          if(a>bestA+1e-12){ bestA=a; bi=i; bj=j; }
        }
      }
      const key=bj*cols+bi;
      if(!bucket.has(key)) bucket.set(key,[]);
      bucket.get(key).push(n);
    }
    // 相邻分片合并成 k 组（列优先蛇形），保证每组网数尽量均衡
    const keys=[...bucket.keys()].sort((a,b)=>a-b);
    const groups=Array.from({length:k},()=>[]);
    keys.sort((a,b)=>bucket.get(b).length-bucket.get(a).length);
    for(const key of keys){
      let mi=0;
      for(let i=1;i<k;i++) if(groups[i].length<groups[mi].length) mi=i;
      groups[mi].push(...bucket.get(key));
    }
    const expanded=groups.filter(g=>g.length);
    return {groups:expanded, cols, rows, sw, sh};
  }
  function checkGeoSpacing(){
    // 几何间距审查：采样走线段，查不同网走线实际间距 < trackW + clearance
    // （2026-11-14 深优：两段式保序排序扫描——先按层+x0 排序收集 bbox 通过的候选对
    // （auditGeometry/checkDRC 同款提前 break），再按 (i,j) 字典序回排逐对原判定，
    // 输出顺序与原 O(S²) 双循环完全一致（位级守门），热成本从全对降到候选对）
    const allSegs=[];
    for(const net of nets)
      for(const rawPath of net.paths)
        for(const path of [mergePathPts(rawPath)])
        for(let k=1;k<path.length;k++){
          const a=path[k-1], b=path[k];
          if(a.l!==b.l) continue;
          const s={net:net.i, x1:a.x, y1:a.y, x2:b.x, y2:b.y, l:a.l};
          s.x0=Math.min(s.x1,s.x2); s.x1m=Math.max(s.x1,s.x2);
          s.y0=Math.min(s.y1,s.y2); s.y1m=Math.max(s.y1,s.y2);
          allSegs.push(s);
        }
    const maxNeed=design.clearance+maxTrackW(design);
    const N=allSegs.length;
    // 段 0 或 1 时无对可查（原双循环同样不产出）
    if(N<2) return [];
    // ---- 阶段 A：按层分组排序扫描，收集候选对（bbox 通过对的超集）----
    const byLayer=new Map();
    for(let i=0;i<N;i++){
      const s=allSegs[i];
      let a=byLayer.get(s.l); if(!a){ a=[]; byLayer.set(s.l,a); }
      a.push(i);
    }
    const cand=[];
    for(const arr of byLayer.values()){
      arr.sort((p,q)=>allSegs[p].x0-allSegs[q].x0);
      for(let ii=0;ii<arr.length;ii++){
        const a=allSegs[arr[ii]];
        const rx2=a.x1m+maxNeed, ry1=a.y0-maxNeed, ry2=a.y1m+maxNeed;
        for(let jj=ii+1;jj<arr.length;jj++){
          const bi=arr[jj], b=allSegs[bi];
          if(b.x0>rx2) break;                      // 左边界已超出可能间距（x 升序）
          if(a.net===b.net) continue;
          if(b.y0>ry2||b.y1m<ry1) continue;        // y 快筛
          cand.push(arr[ii]<bi?arr[ii]*N+bi:bi*N+arr[ii]);
        }
      }
    }
    // ---- 阶段 B：按 (i,j) 字典序回排，逐对原判定（输出序=原双循环发现序）----
    cand.sort((p,q)=>p-q);
    const netWs=new Array(nets.length);
    for(const net of nets) netWs[net.i]=netW(design,net.id);
    const vios=[];
    for(const k of cand){
      const i=(k/N)|0, j=k-i*N;
      const a=allSegs[i], b=allSegs[j];
      const d=segSegDist(a.x1,a.y1,a.x2,a.y2,b.x1,b.y1,b.x2,b.y2);
      const need=design.clearance+(netWs[a.net]+netWs[b.net])/2;
      if(d<need-1e-9){
        const midX=((a.x1+a.x2+b.x1+b.x2)/4), midY=((a.y1+a.y2+b.y1+b.y2)/4);
        const ci=Math.max(0,Math.min(GW-1,Math.floor(midX/grid)));
        const cj=Math.max(0,Math.min(GH-1,Math.floor(midY/grid)));
        vios.push(a.l*NC+cj*GW+ci);
      }
    }
    return vios;
  }
  function finish(){
    // 回滚到历史最优协商状态：后期迭代扰动可能劣化（第五轮 n42/i150 实测 over 99→240）
    if(S.bestSnap){
      const fN=nets.reduce((a,n2)=>a+(n2.failed>0?1:0),0);
      const base=fN*1e8+S.overuse.length;
      let m=base;
      if(base<=S.bestMetric) m=base+checkGeoSpacing().length*1e4;
      if(m>S.bestMetric) restore(S.bestSnap);
    }
    S.done=true;
    S.overuse=scanOveruse();
    // 容量停滞签名（roadmap #4 诊断）：迭代耗尽 + 高 overuse + 仍有失败 →
    // 容量上限的典型特征（h2-stm32 实测：2 层 75/77 卡死，4 层同板 77/77 全通）
    S.capacityStall = S.iter>=maxIter && S.overuse.length>=10 &&
      nets.some(n2=>n2.failed>0);
  }
  // 迭代边界逻辑（从 step 提取，供串行 step 与并行驱动共用——逐字搬移）
  function beginIteration(){
      S.overuse=scanOveruse();
      const anyFailed=nets.some(n=>n.failed>0);
      if(S.phase==='hard'){
        if(!anyFailed && !S.overuse.length){ finish(); return {done:true}; }
        S.phase='negotiate'; S.iter=0;
      }
      if(S.phase==='negotiate'){
        // 历史最优跟踪：全网重布+历史代价单调增长可能让后期迭代更差（第五轮实测）。
        // 指标序与 routeScore 一致：失败 > 几何违规 > overuse（1e8/1e4 加权编码）。
        const fN=anyFailed?nets.reduce((a,n2)=>a+(n2.failed>0?1:0),0):0;
        const cellClean=!anyFailed && !S.overuse.length;
        const base=fN*1e8+S.overuse.length;
        let geoVio=null;
        if(base<=S.bestMetric || cellClean){
          geoVio=checkGeoSpacing();
          const m=base+geoVio.length*1e4;
          if(m<S.bestMetric){ S.bestMetric=m; S.bestSnap=snapshot(); }
        }
        if(S.iter>=maxIter || (cellClean && geoVio!==null && geoVio.length===0)){
          finish(); return {done:true};
        }
        if(cellClean){
          // 几何间距审查：格点无冲突 ≠ 几何间距合规
          if(geoVio.length && S.iter<maxIter){
            for(const cv of geoVio) hist[cv]=Math.min(hist[cv]+5,1e6);
            S.iter++;
            presFac=Math.min(presFac*2,1e6);
            S.hard=false;
            S.bestMetric=Infinity; S.bestSnap=null;   // 几何修正要离开当前状态，不回滚
            startQueue(true);
            return {done:false, text:'几何间距修正 第'+S.iter+'轮 · '+geoVio.length+'处', frac:Math.min(0.95,0.15+0.85*S.iter/maxIter)};
          }
          finish(); return {done:true};
        }
        S.iter++;
        const tf=totalFails();
        if(tf===S.lastFails) S.stall=(S.stall||0)+1; else S.stall=0;
        S.lastFails=tf;
        if(histDecay<1){ for(let i=0;i<TS;i++) if(hist[i]>0) hist[i]*=histDecay; }
        // 冲突驱动排序（FlexDR DRC-driven ripup）：占用冲突格的网络也进入优先重布集
        for(const n2 of nets) n2.conflicted=false;
        for(const os of S.overuse){
          for(const n2 of nets) if(n2.cells.has(os)) n2.conflicted=true;
        }
        for(const o of S.overuse) hist[o]=Math.min(hist[o]+histInc,1e6);
        presFac=Math.min(presFac*2,1e6);
        // 邻域拆除（freerouting RetryNeighbourhood 思想，roadmap #4 收敛加速）：
        // 连续失败的网，其开放焊盘邻域的阻挡者先行拆除并标记 conflicted——
        // 队列里失败网（failedLast 优先）先看到清空的空间，阻挡者排后绕行重布。
        // 半径/上限随连续失败次数渐进放宽（1.5→12mm / 3→12 个），首次失败只观察。
        if(opts.neighbourhoodRipup!==false){
          for(const n2 of nets){
            if(n2.failed<=0){ n2.nbAttempt=0; continue; }
            n2.nbAttempt=(n2.nbAttempt||0)+1;
            if(n2.nbAttempt<2) continue;
            const R=Math.min(1.5*n2.nbAttempt, 12), cap=Math.min(3*n2.nbAttempt, 12);
            const pads=padsByNet.get(n2.i)||[];
            const R2=R*R;
            const openPads=pads.filter(p=>{
              const cells=model.padCells.get(p.id)||[];
              for(const st of cells) if(n2.cells.has(st)) return false;
              return true;
            });
            if(!openPads.length) continue;
            const contenders=new Map();
            for(const n3 of nets){
              if(n3.i===n2.i||n3.cells.size===0) continue;
              let inR=0;
              for(const s3 of n3.cells){
                const c3=s3%NC, l3=(s3/NC)|0;
                const cx3=(c3%GW+0.5)*grid, cy3=((c3/GW|0)+0.5)*grid;
                for(const p of openPads){
                  const dx=cx3-p.x, dy=cy3-p.y;
                  if(dx*dx+dy*dy<=R2){ inR++; break; }
                }
                if(inR) break;
              }
              if(inR) contenders.set(n3.i, inR);
            }
            const list=[...contenders.entries()].sort((a,b)=>b[1]-a[1]||a[0]-b[0]).slice(0,cap);
            for(const [ni3] of list){
              const n3=nets[ni3];
              ripNet(n3);              // 拆除（本网随队列自然重布——step 本就每网 ripNet）
              n3.conflicted=true;      // 排到失败网之后
            }
          }
        }
        S.hard=false;
        startQueue(true);
        if(S.stall>=2) detShuffle(S.queue, S.iter*1000003+nets.length);  // 停滞解僵局
      }
      return null;   // 迭代边界完成，进入逐网路由
  }
  function step(){
    if(S.done) return {done:true};
    if(!S.queue.length){
      const it=beginIteration();
      if(it) return it;
    }
    const net=S.queue.shift();
    if(!net){ finish(); return {done:true}; }
    ripNet(net);
    routeNet(net, S.hard);
    net.failedLast=net.failed>0;
    S.processed++;
    return {done:false,
      text:(S.phase==='hard'?'初始布线':'协商第 '+S.iter+' 轮')+' · 网络 '+S.processed+'/'+S.totalNets,
      frac:(S.phase==='hard'?0.15:0.15+0.85*Math.min(1,S.iter/maxIter))*(S.processed/Math.max(1,S.totalNets))};
  }

  function buildResult(){
    const overuse=S.overuse.map(s=>{
      const c=s%NC, l=(s/NC)|0;
      return {x:cxOf(c), y:cyOf(c), l};
    });
    // 容量停滞签名（S 作用域内打标；advise 升级建议用）
    const capacityStall=S.capacityStall===true;
    let lenTop=0, lenBot=0, viaCount=0;
    const trackLayers=new Array(L).fill(0);
    const netOut=[];
    for(const net of nets){
      for(const p of net.paths) for(let k=1;k<p.length;k++){
        if(p[k].l===p[k-1].l){
          const dd=Math.hypot(p[k].x-p[k-1].x, p[k].y-p[k-1].y);
          trackLayers[p[k].l]+=dd;
          if(p[k].l===0) lenTop+=dd;
          else if(p[k].l===L-1) lenBot+=dd;
        }
      }
      viaCount+=net.viaSet.size;
      netOut.push({
        netId:net.id, name:net.name,
        paths:net.paths.map(p=>p.map(pt=>({x:pt.x,y:pt.y,l:pt.l}))),
        vias:[...net.viaSet.values()],
        cells:[...net.cells],
        connected:net.connected, total:net.total
      });
    }
    let tc=0, tt=0;
    for(const n of netOut){ tc+=n.connected; tt+=n.total; }
    return {
      ...(S.capacityStall?{capacityStall:true}:{}),
      ...(S.compact?{compact:S.compact}:{}),
      ...(S.joint?{joint:S.joint}:{}),
      status:(tt===0||tc===tt)&&!overuse.length ? 'complete':'partial',
      iterations:S.iter, timeMs:Date.now()-S.t0,
      nets:netOut, overuse,
      stats:{connected:tc, total:tt, trackTop:lenTop, trackBot:lenBot, vias:viaCount,
             trackLen:trackLayers.reduce((a,b)=>a+b,0),trackLayers,trackInner:trackLayers.slice(1,-1).reduce((a,b)=>a+b,0)}
    };
  }

  // 单网络重布：拆除指定网络后按当前占用（软约束）重新布线
  function rerouteSingle(id){
    const net=nets.find(n=>n.id===id);
    if(!net) return {ok:false, msg:'网络不存在'};
    const saved=snapshot(),beforeFails=totalFails(),beforeConflicts=scanOveruse().length;
    ripNet(net);
    net.failedLast=true;
    routeNet(net, false);
    S.overuse=scanOveruse();
    if(totalFails()>beforeFails||S.overuse.length>beforeConflicts){
      restore(saved);
      return {ok:false,connected:net.connected,total:net.total,conflicts:S.overuse.length,rolledBack:true};
    }
    return {ok:net.failed===0, connected:net.connected, total:net.total,
            conflicts:S.overuse.length};
  }

  function snapshot(){
    return {nets:nets.map(n=>({...n,cells:new Set(n.cells),viaSet:new Map(n.viaSet),
      paths:n.paths.map(p=>p.map(pt=>({...pt})))})),overuse:S.overuse.slice()};
  }
  function restore(saved){
    passMaskEpoch++;
    usage.fill(0);viaCore.fill(0);
    for(let i=0;i<nets.length;i++){
      const from=saved.nets[i];
      Object.assign(nets[i],from,{cells:new Set(from.cells),viaSet:new Map(from.viaSet),paths:from.paths.map(p=>p.map(pt=>({...pt})))});
      for(const s of nets[i].cells)usage[s]++;
      for(const c of nets[i].viaSet.keys())viaCore[c]=nets[i].i+1;
    }
    S.overuse=saved.overuse.slice();rebuildViaInf();
  }

  // ---- 协商内并行（roadmap #4 完成增量，TritonRoute per-iteration 模式）----
  // 共享拥塞状态是串行依赖 → 迭代串行；并行的单元=批次内互不相见的网。
  // export/adopt 走类型化数组直传（transferable 语义），worker 持久镜像会话。
  function exportShared(){
    return { usage:usage.slice(), hist:hist.slice(), cellOwner:cellOwner.slice(),
      viaCore:viaCore.slice(), viaInf:viaInf.slice(), viaInfV:viaInfV.slice(),
      pbVal:pairBonusTyped?pairBonusTyped.val.slice():null,
      pbSrc:pairBonusTyped?pairBonusTyped.src.slice():null,
      netMeta:nets.map(n=>({i:n.i, failed:n.failed, connected:n.connected,
        conflicted:!!n.conflicted, failedLast:!!n.failedLast})),
      presFac, hardPhase:!!S.hard };
  }
  function adoptShared(sh){
    passMaskEpoch++;
    usage.set(sh.usage); hist.set(sh.hist); cellOwner.set(sh.cellOwner);
    viaCore.set(sh.viaCore); viaInf.set(sh.viaInf);
    if(pairBonusTyped&&sh.pbVal){ pairBonusTyped.val.set(sh.pbVal); pairBonusTyped.src.set(sh.pbSrc); }
    for(const nm of sh.netMeta){ const n=nets[nm.i];
      n.failed=nm.failed; n.connected=nm.connected;
      n.conflicted=nm.conflicted; n.failedLast=nm.failedLast; }
    presFac=sh.presFac; S.hard=sh.hardPhase;
    rebuildViaInf();
  }
  function routeList(ids){
    const out=[];
    for(const id of ids){
      const net=nets[id];
      ripNet(net);
      routeNet(net, S.hard);
      net.failedLast=net.failed>0;
      out.push({ i:id, failed:net.failed, connected:net.connected,
        cells:[...net.cells], viaSet:[...net.viaSet.entries()],
        paths:net.paths.map(p=>p.map(pt=>({...pt}))) });
    }
    return out;
  }
  /* 串行提交（并行驱动的唯一合并点）。
     mergePolicy（#13c）：
       'last'（默认）  按传入顺序覆写——现行语义，位级不变。
       'better'        同一网出现多份结果时按字典序（连通→冲突→过孔→线长）
                       取优，再按传入顺序提交。用于分片模式下同一网被多个
                       分片覆盖（理论上不应发生，但作为防御性口径）或 worker
                       重试产生多份结果的场景。两份比较**只依赖几何**，与
                       worker 完成次序无关 ⇒ 确定性。 */
  function commitRoutes(results, clearQueue, mergePolicy){
    let list=results;
    if(mergePolicy==='better'){
      const byNet=new Map();
      for(const res of results){
        const prev=byNet.get(res.i);
        if(!prev){ byNet.set(res.i,res); continue; }
        const score=r=>{
          // routeList 产物没有 overuse 字段（占用冲突由 usage 决定，提交后才存在）——
          // 字典序键用 [failed, viaSet, len]；failed 是硬冲突口径（连通数=total-failed）。
          const paths=r.paths||[];
          let len=0;
          for(const p of paths) for(let k=1;k<p.length;k++)
            if(p[k].l===p[k-1].l) len+=Math.hypot(p[k].x-p[k-1].x,p[k].y-p[k-1].y);
          return [r.failed||0, (r.viaSet||[]).length, Math.round(len*10)];
        };
        const a=score(prev), b=score(res);
        let better=false;
        for(let k=0;k<a.length;k++){ if(a[k]!==b[k]){ better=b[k]<a[k]; break; } }
        if(better) byNet.set(res.i,res);
      }
      // 按 net.i 升序提交——确定性，不依赖 results 的到达顺序
      list=[...byNet.values()].sort((x,y)=>x.i-y.i);
    }
    for(const res of list){
      const net=nets[res.i];
      ripNet(net);
      net.cells=new Set(res.cells);
      net.viaSet=new Map(res.viaSet);
      net.paths=res.paths;
      for(const s of net.cells){ usage[s]++; cellOwner[s]=net.i+1; }
      for(const c of net.viaSet.keys()) viaCore[c]=net.i+1;
      net.failed=res.failed; net.connected=res.connected;
      net.total=(padsByNet.get(net.i)||[]).length;   // 串行路径在 routeNet 开头设置——并行 commit 同口径
      net.failedLast=net.failed>0;
      if(net.failed===0) buildPairBonus(net);
    }
    rebuildViaInf();
    S.overuse=scanOveruse();   // 提交铜后过孔态已变——S.overuse 必须反映现实（0.14.1：摄档口径修复，并行路径在下轮 beginIteration 反正重算）
    if(clearQueue!==false){ S.queue.length=0; S.processed=0; }   // 并行驱动的 commit 契约：清空队列 → beginIteration 再评估（波次模式最后波才清）
  }
  // ---- 确定性洗牌（借鉴 Freerouting AutoroutePassRunner：协商停滞 ≥2 轮时
  //      用种子=轮次×1000003+网络数打乱重布顺序打破振荡，可复现）----
  function detShuffle(arr, seed){
    let s=(seed>>>0)||1;
    for(let i=arr.length-1;i>0;i--){
      s=(Math.imul(s,1664525)+1013904223)>>>0;
      const j=s%(i+1);
      const t=arr[i]; arr[i]=arr[j]; arr[j]=t;
    }
    return arr;
  }

  const pathLen=paths=>{
    let s=0;
    for(const p of paths) for(let k=1;k<p.length;k++)
      if(p[k].l===p[k-1].l) s+=Math.hypot(p[k].x-p[k-1].x,p[k].y-p[k-1].y);
    return s;
  };
  const totalFails=()=>nets.reduce((a,n)=>a+Math.max(0,(n.total||0)-(n.connected||0)),0);

  // ---- 逐网拆-重布优化（借鉴 Freerouting BatchOptimizer 的核心操作）----
  // 过孔多的网络优先重布（消孔优先）；每网拆除后按当前占用软约束重布，
  // 接受准则为字典序且绝不退步：连通数不降 → 冲突不增 →
  // (总未连减少) 或 (过孔严格减少) 或 (过孔不变且线长严格减少)；
  // 否则整网回滚快照。奇数轮沿用层首选方向、偶数轮各向同性（制造几何多样性）。
  // 连续无改进熔断（第 1 轮 12 网 / 之后 50 网），整轮无改进即提前结束。
  function optimize(maxPasses, onStep){
    maxPasses=Math.max(1,maxPasses|0);
    let ovBase=scanOveruse().length, fBase=totalFails(), improvedAny=0;
    const lowerBounds=new Map(nets.map(n=>[n.i,Math.max(0.001,netLowerBound(padsByNet.get(n.i)||[]))]));
    for(let pass=1;pass<=maxPasses;pass++){
      const saved=layerDirOn;
      layerDirOn=(pass%2===1)?saved:!saved;          // 奇偶轮切换首选方向
      // 排序：过孔多者优先（消孔优先），同孔数按绕行比降序
      //（toporouter detour 思想：当前长/斯坦纳下界 越大越值得重布）
      const lbOf=n=>lowerBounds.get(n.i);
      const detOf=n=>pathLen(n.paths)/lbOf(n);
      const order=nets.filter(n=>n.cells.size).map(net=>({net,det:detOf(net)}))
        .sort((a,b)=>b.net.viaSet.size-a.net.viaSet.size || b.det-a.det || a.net.i-b.net.i).map(a=>a.net);
      const cap=pass===1?12:50;
      let failStreak=0, passImproved=0, done=0;
      for(const net of order){
        if(failStreak>=cap) break;
        const sCells=new Set(net.cells), sVia=new Map(net.viaSet), sPaths=net.paths,
              sConn=net.connected, sFail=net.failed, sLast=net.failedLast;
        // A2d（0.13.17）：盘内孔（落在自身焊盘铜上的过孔）不计入过孔消除
        // 比较——它们是口袋球的唯一逃逸出口（车道预留），不是绕行脂肪；
        // optimize 的"消孔优先"曾把它们当冗余拆掉，BGA 口袋球因此失去逃逸。
        const nonPadVia=set=>{ let c=0;
          for(const [cell] of set)
            if(model.viaPadOwner[cell%NC]!==net.i+1 && model.padOwner[cell]!==net.i+1) c++;
          return c; };
        const vB=nonPadVia(sVia), lB=pathLen(net.paths);
        ripNet(net);
        routeNet(net,false);
        const vA=nonPadVia(net.viaSet), lA=pathLen(net.paths), fNow=totalFails();
        const ov=scanOveruse().length;
        const accept = net.connected>=sConn && ov<=ovBase &&
          ( fNow<fBase || (fNow===fBase && ov<ovBase) ||
            (fNow===fBase && ov===ovBase && (vA<vB || (vA===vB && lA<lB-1e-9))) );
        if(accept){
          improvedAny++; passImproved++; failStreak=0;
          ovBase=ov; fBase=fNow;
        } else {
          ripNet(net);
          net.cells=sCells; net.viaSet=sVia; net.paths=sPaths;
          for(const s of net.cells) usage[s]++;
          for(const [c] of net.viaSet) viaCore[c]=net.i+1;
          net.connected=sConn; net.failed=sFail; net.failedLast=sLast;
          rebuildViaInf();
          failStreak++;
        }
        done++;
        if(onStep) onStep({pass, done, total:order.length, improved:passImproved});
      }
      layerDirOn=saved;
      S.overuse=scanOveruse();
      if(!passImproved) break;
    }
    return {improved:improvedAny, overuse:S.overuse.length, fails:totalFails()};
  }

  /* ---- 差分对强制压实（0.13.27，0.4.0 留档后续项"route 后成对重构"）----
     偏置式走廊（0.4.0）不保证收敛；本方法对每对 partner 真正重构：拆掉
     partner，在"master 偏移环带 ∪ partner 焊盘 escape 区"的限带 A* 里重布，
     验收=耦合占比提升 + DRC error 不增 + 连通满，否则快照回滚。
     serpentineTune 的三层合法性在此天然获得——A* 产出即模型合法，验收再
     加 DRC 门。环带数学复用 buildPairBonus（steps=round((Wc+S)/grid)，容差
     ±1 格）。 */
  function compactPairs(opts2){
    opts2=opts2||{};
    const target=opts2.pairCoupleTarget!=null?opts2.pairCoupleTarget:0.6;
    if(!Number.isFinite(target)||target<0||target>1)
      throw new Error('pairCoupleTarget must be between 0 and 1');
    const groups=new Map();
    for(const n of nets){
      const p=netMeta[n.i]&&netMeta[n.i].pair;
      if(!p) continue;
      if(!groups.has(p)) groups.set(p,[]);
      groups.get(p).push(n);
    }
    const pairGroups=[...groups.entries()].filter(([,ms])=>ms.length===2)
      .sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
    const report={pairs:[], compacted:0, skipped:0, drcBefore:0, drcAfter:0};
    if(!pairGroups.length) return report;   // 无 pair：不落 compact 字段（输出位级不变）
    const drcErrs=()=>{
      const r=buildResult();
      return checkDRC(design,{...r,nets:[...r.nets,...manualRouteEntries(design)]},{dfm:false})
        .filter(i=>i.sev==='error').length;
    };
    report.drcBefore=drcErrs();
    for(const [gname,[A,B]] of pairGroups){
      if(A.connected!==A.total||B.connected!==B.total){
        report.pairs.push({group:gname,action:'skip-unrouted'}); report.skipped++; continue;
      }
      const gEff=pairGapFor(design,A);
      if(gEff==null){
        report.pairs.push({group:gname,action:'skip-unreachable-impedance'}); report.skipped++; continue;
      }
      const gStep=Math.max(design.grid, 0.25);
      const bandCenter=(netW(design,A.id)+netW(design,B.id))/2+gEff;
      const stats=()=>{ let c=0,t=0;
        for(const m of [A,B]){
          const o=m===A?B:A;
          const st=pairCoupleStats([m.paths],[o.paths],bandCenter,gStep);
          c+=st.coupledLen; t+=st.totalLen;
        }
        return {ratio:t>0?c/t:0};
      };
      const before=stats();
      const buildBand=(M,P)=>{
        const steps=Math.round(bandCenter/grid);
        const band=new Set();
        // 列→master 实际有铜的层——环带只标这些层（耦合 DRC 只数同层段，
        // 异层平行不占比，跨层环带只会浪费带宽）
        const colLayers=new Map();
        for(const s of M.cells){
          const l=(s/NC)|0, c=s%NC;
          if(!colLayers.has(c)) colLayers.set(c,[]);
          if(!colLayers.get(c).includes(l)) colLayers.get(c).push(l);
        }
        for(const [c,ls] of colLayers){
          const gx=c%GW, gy=(c-gx)/GW;
          for(const l2 of ls){
            for(let dy=-steps-1;dy<=steps+1;dy++)for(let dx=-steps-1;dx<=steps+1;dx++){
              const d2=Math.hypot(dx,dy);
              if(Math.abs(d2-steps)>1) continue;
              const x=gx+dx, y=gy+dy;
              if(x<0||y<0||x>=GW||y>=GH) continue;
              band.add(l2*NC+y*GW+x);
            }
          }
        }
        // partner 焊盘格 + escape 区（R 步内全层放开——partner 从自己焊盘
        // 出发 joining 带；跨层逃逸也放开）
        const R=opts2.pairEscapeSteps!=null?opts2.pairEscapeSteps:12;
        for(const p of padsByNet.get(P.i)||[]){
          for(const st of (model.padCells.get(p.id)||[])){
            band.add(st);
            const l=(st/NC)|0, c=st%NC, gx=c%GW, gy=(c-gx)/GW;
            for(let l2=0;l2<L;l2++) for(let dy=-R;dy<=R;dy++) for(let dx=-R;dx<=R;dx++){
              if(Math.hypot(dx,dy)>R) continue;
              const x=gx+dx, y=gy+dy;
              if(x<0||y<0||x>=GW||y>=GH) continue;
              band.add(l2*NC+y*GW+x);
            }
          }
        }
        return band;
      };
      const attempt=(M,P)=>{
        const saved=snapshot();
        ripNet(P);
        S.pairBand=buildBand(M,P); passMaskEpoch++;
        let okConn=false;
        try{ routeNet(P,false); okConn=P.connected===P.total; }
        finally{ S.pairBand=null; passMaskEpoch++; }
        if(!okConn){ restore(saved); return null; }
        S.overuse=scanOveruse();
        const after=stats();
        const drcA=drcErrs();
        if(after.ratio>before.ratio+1e-9 && drcA<=report.drcBefore) return {after,drcA};
        restore(saved);
        return null;
      };
      const ratioOf=m=>pairCoupleStats([m.paths],[(m===A?B:A).paths],bandCenter,gStep).ratio;
      const first=ratioOf(A)>=ratioOf(B)?[A,B]:[B,A];
      let res=attempt(first[0],first[1]);
      if(!res) res=attempt(first[1],first[0]);
      if(res){
        report.compacted++;
        report.pairs.push({group:gname, ratioBefore:+before.ratio.toFixed(3),
          ratioAfter:+res.after.ratio.toFixed(3), action:'compacted'});
      }else{
        report.skipped++;
        report.pairs.push({group:gname, ratioBefore:+before.ratio.toFixed(3), action:'skipped'});
      }
    }
    S.overuse=scanOveruse();
    report.drcAfter=drcErrs();
    S.compact=report;   // 有 pair 板才附 compact 报告
    return report;
  }

  /* ---- 多网联合重布（0.14.1，#12b 多网联合规划的栅格侧落地）----
     Fable 三板诊断（0.14.0 后）：残留网的形状补线拒绝原因以 no-path 为主——
     在现有协商铜的障碍下轴图真无路，但隔离实验证明个体可达（0.11.7 实证）。
     单网重布对固定障碍无能为力；救法 = 拆掉阻塞者 → 失败网先布（独占清空的
     走廊）→ 阻塞者绕行重布，按"哪个阻塞者子集参与"做 mask 枚举，全板
     [-drcE, conn] 权威计分取最优，平手保守回滚。
     骨架镜像形状侧级联（0.13.6，:4293-4332 原设计）：快照对 + mask 枚举 +
     权威计分，已证明不依赖形状专属结构。 */
  function jointReroute(opts2){
    opts2=opts2||{};
    const maxNets=opts2.jointRerouteMaxNets!=null?opts2.jointRerouteMaxNets:8;
    if(!Number.isInteger(maxNets)||maxNets<0||maxNets>64)
      throw new Error('jointRerouteMaxNets must be an integer from 0 to 64');
    const R=opts2.jointR!=null?opts2.jointR:2.5;
    if(!Number.isFinite(R)||R<=0) throw new Error('jointR must be a positive finite number');
    const failed=nets.filter(n=>n.total>0&&n.connected<n.total).sort((a,b)=>a.i-b.i).slice(0,maxNets);
    const report={nets:[], improved:0, drcBefore:0, drcAfter:0};
    if(!failed.length) return report;   // 无失败网：不落 joint 字段（输出位级不变）
    const score=()=>{
      // 口径与 deliver/测试一致：计入 manualRouteEntries（手动布线也是铜）
      const r=buildResult();
      const drcE=checkDRC(design,{...r,nets:[...r.nets,...manualRouteEntries(design)]},{dfm:false})
        .filter(i=>i.sev==='error').length;
      return [-drcE, r.stats.connected];
    };
    report.drcBefore=-score()[0];
    for(const F of failed){
      // 阻塞者探测（neighborhoodRipup 的 openPads 语义：未被 F.cells 覆盖的焊盘）
      const openPads=(padsByNet.get(F.i)||[]).filter(p=>{
        const cells=model.padCells.get(p.id)||[];
        for(const st of cells) if(F.cells.has(st)) return false;
        return true;
      });
      if(!openPads.length){ report.nets.push({net:F.id,action:'skip-no-open-pads'}); continue; }
      const contenders=new Map();
      const R2=R*R;
      for(const n3 of nets){
        if(n3.i===F.i||n3.cells.size===0) continue;
        let inR=0;
        for(const s3 of n3.cells){
          const c3=s3%NC;
          const cx3=(c3%GW+0.5)*grid, cy3=(((c3/GW)|0)+0.5)*grid;
          for(const p of openPads){
            const dx=cx3-p.x, dy=cy3-p.y;
            if(dx*dx+dy*dy<=R2){ inR++; break; }
          }
          if(inR) break;
        }
        if(inR) contenders.set(n3.i, inR);
      }
      // 选择按重叠计数降序（top-3，2^n 爆炸防护），mask 枚举按 net.i 序（确定性）
      const work=[...contenders.entries()].sort((a,b)=>b[1]-a[1]||a[0]-b[0]).slice(0,3)
        .map(([i3])=>nets[i3]).sort((a,b)=>a.i-b.i);
      if(!work.length){ report.nets.push({net:F.id,action:'skip-no-contenders'}); continue; }
      const connBefore=nets.reduce((a,n)=>a+n.connected,0);
      const saved=snapshot();            // 每个失败网重取快照——前一个网的改进必须生效
      const baseScore=score();
      let bestMask=0, bestScore=baseScore;
      const applyMask=m=>{
        restore(saved);
        ripNet(F);
        for(let k=0;k<work.length;k++) if((m>>k)&1) ripNet(work[k]);
        routeNet(F, true);              // 独占清空后的走廊
        for(let k=0;k<work.length;k++) if((m>>k)&1) routeNet(work[k], false);   // net.i 序软重布
        S.overuse=scanOveruse();
      };
      for(let m=1;m<(1<<work.length);m++){
        applyMask(m);
        const sc=score();
        if(sc[0]>bestScore[0]||(sc[0]===bestScore[0]&&sc[1]>bestScore[1])){
          bestMask=m; bestScore=sc;
        }
      }
      if(bestMask!==0){
        applyMask(bestMask);
        report.improved++;
        report.nets.push({net:F.id, contenders:work.map(c=>c.id), action:'improved',
          connBefore, connAfter:nets.reduce((a,n)=>a+n.connected,0),
          drcAfter:-bestScore[0]});
      }else{
        restore(saved);
        S.overuse=scanOveruse();
        report.nets.push({net:F.id, contenders:work.map(c=>c.id), action:'no-gain',
          connBefore});
      }
    }
    report.drcAfter=-score()[0];
    S.joint=report;
    return report;
  }

  startQueue(false);
  return {step, buildResult, rerouteSingle, optimize, compactPairs, jointReroute, snapshot, restore, session:S,
    beginIteration, exportShared, adoptShared, routeList, commitRoutes,
    startQueue, detShuffle, shardQueue};
}

/* ---------- KiCad .kicad_pcb 导入 ----------
   解析 S 表达式，提取：板框（Edge.Cuts 包围盒）、网络、封装焊盘
   （层归属/旋转/尺寸），平移到原点并外扩板边余量。走线/覆铜/丝印
   不导入（本工具自己布线、自己铺铜）。返回 design 对象。 */
function parseSexpr(text){
  const toks=[]; let i=0;
  while(i<text.length){
    const c=text[i];
    if(c==='('||c===')'){ toks.push(c); i++; }
    else if(c==='"'){
      let j=i+1, s='';
      while(j<text.length){ if(text[j]==='\\'){ s+=text[j+1]; j+=2; }
        else if(text[j]==='"'){ break; } else { s+=text[j++]; } }
      toks.push({str:s}); i=j+1;
    } else if(/\s/.test(c)){ i++; }
    else {
      let j=i; while(j<text.length && !/[\s()"]/.test(text[j])) j++;
      toks.push(text.slice(i,j)); i=j;
    }
  }
  let p=0;
  function node(){
    if(toks[p]===')') return null;
    if(toks[p]==='('){ p++; const arr=[];
      while(p<toks.length && toks[p]!==')') arr.push(node());
      p++; return arr; }
    return toks[p++];
  }
  if(toks[p]!=='(') return null;
  return node();
}
const _sxHead=n=>Array.isArray(n)?String(n[0]):'';
const _sxNum=(n,d)=>{ const v=parseFloat(n); return isFinite(v)?v:d; };
function _sxFind(node,head,out){
  out=out||[];
  if(!Array.isArray(node)) return out;
  if(_sxHead(node)===head) out.push(node);
  for(const c of node) if(Array.isArray(c)) _sxFind(c,head,out);
  return out;
}
function _sxChild(node,head){
  for(const c of node) if(Array.isArray(c)&&_sxHead(c)===head) return c;
  return null;
}
function importKiCadPcb(text, opts){
  opts=opts||{};
  const root=parseSexpr(text);
  if(!root || _sxHead(root)!=='kicad_pcb') throw new Error('不是 kicad_pcb 文件（缺少 kicad_pcb 头）');
  const margin=opts.margin!=null?opts.margin:1.0;
  const design=designDefaults();
  // 网络：KiCad net 0 是""（未连接），跳过
  const netNum=new Map();
  for(const nn of _sxFind(root,'net')){
    const num=_sxNum(nn[1],0), name=nn[2]!==undefined?String(nn[2]&&nn[2].str!==undefined?nn[2].str:nn[2]):'';
    if(num<=0||!name) continue;
    netNum.set(num,name);
  }
  const netId=new Map();
  for(const [num,name] of netNum){
    if(!design.nets.some(n=>n.name===name)) design.nets.push({id:'k'+design.nets.length+1,name});
    netId.set(num, design.nets.find(n=>n.name===name).id);
  }
  // 板框：Edge.Cuts 上的线/矩形/圆/弧/多边形 的包围盒（弧取外接圆，略保守）
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity, hasEdge=false;
  const grow=(a,b,c,d)=>{ x0=Math.min(x0,a); y0=Math.min(y0,b); x1=Math.max(x1,c); y1=Math.max(y1,d); hasEdge=true; };
  const onEdge=n=>{ const l=_sxChild(n,'layer'); return l&&l[1]&&l[1].str==='Edge.Cuts'; };
  const pt=n=>({x:_sxNum(n[1],0), y:_sxNum(n[2],0)});
  for(const g of _sxFind(root,'gr_line')) if(onEdge(g)){ const s=_sxChild(g,'start'), e=_sxChild(g,'end');
    if(s&&e){ const a=pt(s),b=pt(e); grow(a.x,a.y,a.x,a.y); grow(b.x,b.y,b.x,b.y); } }
  for(const g of _sxFind(root,'gr_rect')) if(onEdge(g)){ const s=_sxChild(g,'start'), e=_sxChild(g,'end');
    if(s&&e){ const a=pt(s),b=pt(e); grow(Math.min(a.x,b.x),Math.min(a.y,b.y),Math.max(a.x,b.x),Math.max(a.y,b.y)); } }
  for(const g of _sxFind(root,'gr_circle')) if(onEdge(g)){ const c=_sxChild(g,'center'), e=_sxChild(g,'end');
    if(c&&e){ const a=pt(c),b=pt(e); const r=Math.hypot(b.x-a.x,b.y-a.y); grow(a.x-r,a.y-r,a.x+r,a.y+r); } }
  for(const g of _sxFind(root,'gr_arc')) if(onEdge(g)){ const s=_sxChild(g,'start'), e=_sxChild(g,'end'), m=_sxChild(g,'mid');
    if(s&&e&&m){ // 三点定圆（外接圆包围盒，保守）
      const a=pt(s),b=pt(e),c=pt(m);
      const d=2*(a.x*(b.y-c.y)+b.x*(c.y-a.y)+c.x*(a.y-b.y));
      if(Math.abs(d)>1e-9){
        const ux=((a.x**2+a.y**2)*(b.y-c.y)+(b.x**2+b.y**2)*(c.y-a.y)+(c.x**2+c.y**2)*(a.y-b.y))/d;
        const uy=((a.x**2+a.y**2)*(c.x-b.x)+(b.x**2+b.y**2)*(a.x-c.x)+(c.x**2+c.y**2)*(b.x-a.x))/d;
        const r=Math.max(Math.hypot(a.x-ux,a.y-uy),Math.hypot(b.x-ux,b.y-uy),Math.hypot(c.x-ux,c.y-uy));
        grow(ux-r,uy-r,ux+r,uy+r);
      } else grow(a.x,a.y,b.x,b.y), grow(c.x,c.y,c.x,c.y);
    } }
  for(const g of _sxFind(root,'gr_poly')) if(onEdge(g)){ const pts=_sxChild(g,'pts');
    if(pts) for(const xy of pts) if(Array.isArray(xy)&&_sxHead(xy)==='xy') grow(_sxNum(xy[1],0),_sxNum(xy[2],0),_sxNum(xy[1],0),_sxNum(xy[2],0)); }
  if(!hasEdge){ // 无板框：焊盘包围盒外扩 5mm
    let bx0=Infinity,by0=Infinity,bx1=-Infinity,by1=-Infinity;
    for(const fp of [..._sxFind(root,'footprint'),..._sxFind(root,'module')]){
      const at=_sxChild(fp,'at'); if(!at) continue;
      bx0=Math.min(bx0,_sxNum(at[1],0)); by0=Math.min(by0,_sxNum(at[2],0));
      bx1=Math.max(bx1,_sxNum(at[1],0)); by1=Math.max(by1,_sxNum(at[2],0));
    }
    if(!isFinite(bx0)) throw new Error('文件中未找到焊盘或板框');
    grow(bx0-5,by0-5,bx1+5,by1+5);
  }
  design.width=Math.ceil((x1-x0)+2*margin); design.height=Math.ceil((y1-y0)+2*margin);
  const ox=x0-margin, oy=y0-margin;
  // 封装 → 焊盘
  for(const fp of [..._sxFind(root,'footprint'),..._sxFind(root,'module')]){
    let ref='';
    for(const pr of _sxFind(fp,'property')) if(pr[1]&&pr[1].str==='Reference'&&pr[2]) ref=pr[2].str;
    if(!ref){ const fpAt=_sxChild(fp,'at'); ref='FP'; }
    const fat=_sxChild(fp,'at');
    const frot=fat&&fat[3]!==undefined?_sxNum(fat[3],0):0;
    const fr=Math.cos(frot*Math.PI/180), fi=Math.sin(frot*Math.PI/180);
    for(const pd of _sxFind(fp,'pad')){
      const num=pd[1]!==undefined?String(pd[1]&&pd[1].str!==undefined?pd[1].str:pd[1]):'';
      const type=pd[2];           // smd / thru_hole / np_thru_hole / connect
      const shape=pd[3];          // rect/circle/oval/roundrect/trapezoid/custom
      const at=_sxChild(pd,'at'), sz=_sxChild(pd,'size'), ls=_sxChild(pd,'layers'), nt=_sxChild(pd,'net');
      if(!at||!sz) continue;
      let px=_sxNum(at[1],0), py=_sxNum(at[2],0), prot=at[3]!==undefined?_sxNum(at[3],0):0;
      // 封装旋转下的焊盘位置
      // KiCad 板文件惯例（U1 SOT-23-6 实测对拍定论，混合惯例）：
      // pad 位置 = 封装本地坐标（未旋转，需按 frot 旋转到板坐标）；
      // pad 角度 = 板坐标绝对角（w/h 按 prot 奇×90 交换）——
      // comb 惯例的 rot=normAng(frot+prot) 在 90+270=360→0 处丢失交换（U1 实测）
      const wx=px*fr-py*fi, wy=px*fi+py*fr;
      // pad 角度语义（外部板 R_0402 三旋转/SOT-23-6 物理对拍定论）：
      // 文件 pad 角 = 绝对角（板坐标）；文件 pad 位置 = 封装本地坐标（上面已按 frot 旋转）
      // ——SOT-23-6 fp90+file270：按绝对角交换 → 板面 0.65 宽不重叠；
      //   按 frot+prot(=360→0) 不交换 → 1.06 宽 > 0.95 节距自重叠（物理排除）
      const rotAbs=((prot%360)+360)%360;   // 原始角（normAng 会量化到 90 倍数——毁 45° 焊盘真形状）
      const _rad=rotAbs*Math.PI/180, _c=Math.abs(Math.cos(_rad)), _si=Math.abs(Math.sin(_rad));
      let wLocal=_sxNum(sz[1],0.5), hLocal=_sxNum(sz[2],wLocal);
      if(shape==='circle'){ wLocal=Math.max(wLocal,hLocal); hLocal=wLocal; }
      // 路由/DRC 模型 w/h：真旋转形状的板坐标 AABB（各轴 |w·cos|+|h·sin|——
      // 90/270 与旧交换一致；45° 等任意角给真包络，非保守近似）
      let w=+(wLocal*_c+hLocal*_si).toFixed(4), h=+(wLocal*_si+hLocal*_c).toFixed(4);
      let layer='both';
      if(type==='smd'){
        const lay=ls?ls.slice(1).map(x=>x&&x.str).filter(Boolean):[];
        const hasF=lay.some(l=>l==='F.Cu'||l==='*.Cu'), hasB=lay.some(l=>l==='B.Cu'||l==='*.Cu');
        layer=hasB?(hasF?'both':'bottom'):'top';
        if(!hasF&&!hasB) continue;
      }
      const netn=nt?_sxNum(nt[1],0):0;
      const nid=netn>0?netId.get(netn):null;
      // 孔径：(drill 1.0) / (drill oval 1 1.6) → 第一个数值/2 为半径；SMD 无 drill
      let holeR;
      if(type!=='smd'){
        const dr=_sxChild(pd,'drill');
        if(dr) for(const tok of dr.slice(1)){ const v=parseFloat(tok); if(isFinite(v)){ holeR=+(v/2).toFixed(4); break; } }
      }
      // 同号焊盘消歧（外部板实测缺口）：拨码开关公共脚/QFN 散热焊盘分割在
      // KiCad 里是同 (ref, number) 的多个 pad——后缀 b/c/d 保持分组语义
      // （split('-')[0] 与 lastIndexOf('-') 两种分组约定都不破坏）
      let id=(ref||'FP')+'-'+(num||design.pads.length+1);
      for(let k=1; design.pads.some(q=>q.id===id); k++) id=(ref||'FP')+'-'+(num||design.pads.length+1)+String.fromCharCode(96+k);
      design.pads.push({
        id,
        rot: rotAbs, rotAbs,
        wLocal, hLocal,
        netId:nid||null,
        x:+(wx+_sxNum(fat?fat[1]:0,0)-ox).toFixed(4),
        y:+(wy+_sxNum(fat?fat[2]:0,0)-oy).toFixed(4),
        w:Math.max(w,0.1), h:Math.max(h,0.1),
        shape:(shape==='circle')?'circle':'rect',
        layer, holeR
      });
    }
  }
  // 删除无焊盘的网络（导入的 net 列表常含未用项）
  const used=new Set(design.pads.map(p=>p.netId).filter(Boolean));
  design.nets=design.nets.filter(n=>used.has(n.id));
  for(const k of (design.keepouts||[])) void k;
  // 外部板标记：同元件焊盘间距 spec 检查豁免——真实封装自带同封装焊盘交叠
  // （QFN-48-1EP 散热焊盘/pkl SOT-23-6 实测），封装作者几何是 ground truth；
  // 本工具的该检查针对自产 generator 规格
  design.external=true;
  return design;
}

/* ---------- 网络布线长度下界（RMST，>10 引脚退化 Prim 曼哈顿 MST）---------- */
function netLowerBound(pads){
  const pts=(pads||[]).map(p=>({x:p.x,y:p.y}));
  if(pts.length<2) return 0;
  const t=rmstTasks(pts);
  if(t) return t.reduce((a,k)=>a+Math.abs(k.to.x-k.from.x)+Math.abs(k.to.y-k.from.y),0);
  // Prim：未入树点缓存到当前树的最近距离，只与新入树点比较，O(P²)/O(P)。
  // 索引升序扫描 + 严格 < 保留旧 rest×inT 的同距选点顺序及浮点累加次序；
  // 不去重坐标，不改变 <=10 点的精确 RMST 分支或其求和表达式。
  const used=new Uint8Array(pts.length), nearest=new Float64Array(pts.length).fill(Infinity);
  used[0]=1;
  let len=0, last=0;
  for(let left=pts.length-1;left>0;left--){
    let bi=0, bd=Infinity;
    const p=pts[last];
    for(let i=1;i<pts.length;i++) if(!used[i]){
      const d=Math.abs(pts[i].x-p.x)+Math.abs(pts[i].y-p.y);
      if(d<nearest[i]) nearest[i]=d;
      if(nearest[i]<bd){ bd=nearest[i]; bi=i; }
    }
    len+=bd; used[bi]=1; last=bi;
  }
  return len;
}

/* ---------- 特性阻抗估算（IPC-2141 量级经验公式，FR-4 常用）----------
   microstrip: Z0 = 87/√(Er+1.41) × ln(5.98h/(0.8w+t))
   stripline : Z0 = 60/√Er × ln(4h/(0.67π(0.8w+t)))，h 为单侧介质厚
   返回 {z0, er, ok}；参数不合法时 ok=false。 */
function impedance(w,h,Er,t,type){
  w=+w; h=+h; Er=+Er; t=+t;
  if(!(w>0&&h>0&&Er>0&&t>=0)) return {z0:NaN,ok:false};
  const weff=0.8*w+t;
  let z0;
  if(type==='stripline') z0=60/Math.sqrt(Er)*Math.log(4*h/(0.67*Math.PI*weff));
  else z0=87/Math.sqrt(Er+1.41)*Math.log(5.98*h/weff);
  return {z0, ok:isFinite(z0)&&z0>0};
}
// 反算线宽：目标阻抗 → 线宽（二分，10 步内收敛）
function widthForZ0(target,h,Er,t,type){
  let lo=0.02, hi=Math.max(h*3,2);
  if(!impedance(lo,h,Er,t,type).ok) return NaN;
  for(let i=0;i<40;i++){
    const mid=(lo+hi)/2;
    if(impedance(mid,h,Er,t,type).z0>target) lo=mid; else hi=mid;
  }
  return +(((lo+hi)/2).toFixed(3));
}

/* ---------- 差分对奇偶模阻抗口径（roadmap 阶段一 #3）----------
   边耦合微带近似（IPC-2141/业界通用经验式）：
   Zdiff(S) = 2·Z0·(1 − 0.48·e^(−0.96·S/H))
   Z0=单端微带（impedance()），S=边到边间隙，H=介质厚。
   奇模 Zodd=Zdiff/2；偶模 Zeven≈Z0（微带偶模随 S 变化弱——近似口径）。
   间隙求解：S = −(H/0.96)·ln((1 − Zt/(2·Z0))/0.48)，要求 Zt ≥ 2·Z0·0.52
   （S→0 下界）且 Zt < 2·Z0，否则当前叠层不可达——如实报告。
   经验式误差大于带状线式，仅作量级口径（与 impedance() 同一免责层级）。 */
function diffPairZ(w, h, er, t, target, opts){
  opts=opts||{};
  const se=impedance(w, h, er, t, 'microstrip');
  if(!se.ok) return { ok:false, reason:'参数不合法' };
  // 阻焊一阶修正（0.14.7 批次3 A3，Bogatin B.43/44 口径）：阻焊覆盖微带线抬高
  // 有效介电常数 → Z0 下降，约每 1mil（0.0254mm）−2Ω。一阶线性外推，缺省
  // maskMm=0 完全不修正（位级兼容）；z0<10Ω 截断保护并标注截断。
  let z0=se.z0, corrected=false, clamped=false;
  if(opts.maskMm!=null&&Number.isFinite(opts.maskMm)&&opts.maskMm>0){
    const dz=-2*(opts.maskMm/0.0254);
    z0=Math.max(10, se.z0+dz);
    corrected=true; clamped=z0===10&&se.z0+dz<10;
  }
  const twoZ0=2*z0;
  const zdiffAt=S=>twoZ0*(1-0.48*Math.exp(-0.96*S/h));
  const sMin=0.1;
  const zMin=zdiffAt(sMin);
  const achievable=isFinite(target)&&target>0&&target<twoZ0&&zMin<=target;
  const sFor=achievable?+(-h/0.96*Math.log((1-target/twoZ0)/0.48)).toFixed(3):null;
  return { ok:true, w:+w.toFixed(3), h, er, z0:+z0.toFixed(2),
    zdiffUncoupled:+twoZ0.toFixed(2), zdiffMinAtSmin:+zMin.toFixed(2),
    achievable, sFor, target:target>0?+target:null,
    corrected, clamped, maskMm:opts.maskMm||0,
    zoddAt:S=>+(zdiffAt(S)/2).toFixed(2), zevenAt:S=>+z0.toFixed(2), zdiffAt:S=>+zdiffAt(S).toFixed(2) };
}
// 设计级包装：叠层口径（4 层=0.2 平面介质，与 pdnPlaneCapPf 同假设；2 层=1.5 core）
function diffPairZFor(design, w, target){
  const h=(design.layers||2)>=4?0.2:1.5;
  const er=DIELECTRICS.fr4.er, t=copperThickUm(design.copperWeight)/1000;
  const mask=design.solderMask!=null&&Number.isFinite(+design.solderMask)&&+design.solderMask>0?+design.solderMask:0;
  const r=diffPairZ(w, h, er, t, target, {maskMm:mask});
  r.stackup={ layers:design.layers||2, h, er, t, mask,
    note:(design.layers||2)>=4
      ?'4 层：微带参考内层平面，h=0.2（与 PDN 平面电容同假设）'+(r.corrected?'；阻焊 '+mask+'mm 一阶修正（−2Ω/mil，Bogatin B.43/44），精确控阻须板厂层压结构复算':'')
      :'2 层：参考对层铜皮，h≈1.5 core——经典口径下 90Ω 难达成（如实报告）'+(r.corrected?'；阻焊 '+mask+'mm 一阶修正':'') };
  return r;
}
/* 差分对有效耦合间隙（批次 3：阻抗自动定档单一事实源）：
   显式 rules.pairs[].gap（展开为 nets[].pairGap）优先——用户用叠层工具算得的
   间隙直接生效；否则 nets[].diffZ（缺省 90Ω）→ diffPairZFor 反查 sFor。
   不可达（2 层板 90Ω 等）返回 null——调用方按各自口径诚实报告。 */
function pairGapFor(design, net){
  if(!net) return null;
  // 调用方可能传 design.nets 成员（netMeta/fabChecklist/spec 门），也可能传会话
  // 内部网对象（compactPairs——只有 id/i，无 pair/diffZ 字段）——按 id 归位到
  // design 网再读声明，两种口径单一事实源。
  const dn=(design.nets||[]).find(x=>x.id===net.id)||net;
  if(!dn.pair) return null;
  if(dn.pairGap!=null&&Number.isFinite(dn.pairGap)&&dn.pairGap>0) return dn.pairGap;
  const zt=dn.diffZ>0?dn.diffZ:90;
  const r=diffPairZFor(design, netW(design, dn.id), zt);
  return (r.ok&&r.achievable&&r.sFor!=null)?r.sFor:null;
}
/* 差分对耦合占比（0.13.27 从 checkDRC 逐行等价提取——DRC 与压实器单一事实源）：
   本网各同层段按 gStep 采样中点，到伙伴同层段最近距离落在设计间隙带
   |d−bandCenter|≤gStep 内的长度占比。bandCenter=(wM+wO)/2+sFor（中心距口径）。 */
function pairCoupleStats(mPathLists, oPathLists, bandCenter, gStep){
  const oSegs=[];
  for(const paths of oPathLists) for(const path of paths) for(let k=1;k<path.length;k++){
    const a=path[k-1], b=path[k];
    if(a.l===b.l) oSegs.push({ax:a.x,ay:a.y,bx:b.x,by:b.y,l:a.l,
      x0:Math.min(a.x,b.x),x1:Math.max(a.x,b.x),y0:Math.min(a.y,b.y),y1:Math.max(a.y,b.y)});
  }
  let coupledLen=0, totalLen=0;
  for(const paths of mPathLists) for(const path of paths) for(let k=1;k<path.length;k++){
    const a=path[k-1], b=path[k];
    if(a.l!==b.l) continue;
    const segLen=Math.hypot(b.x-a.x, b.y-a.y);
    const steps=Math.max(1, Math.ceil(segLen/gStep));
    for(let q=0;q<steps;q++){
      const t=(q+0.5)/steps, sx=a.x+(b.x-a.x)*t, sy=a.y+(b.y-a.y)*t;
      let dMin=1e9;
      for(const os of oSegs){
        if(os.l!==a.l) continue;
        // 深优 2026-11-14：bbox 轴距快筛——轴距 ≥ 当前 dMin 的段不可能改进 min
        //（bboxDist ≥ max 轴距 ≥ dMin ⇒ segDist ≥ dMin；min 无舍入，跳过者位级同值）
        const gx=Math.max(os.x0-sx, sx-os.x1, 0), gy=Math.max(os.y0-sy, sy-os.y1, 0);
        if(Math.max(gx,gy)>=dMin) continue;
        dMin=Math.min(dMin, segDist(sx,sy,os.ax,os.ay,os.bx,os.by));
      }
      totalLen+=segLen/steps;
      if(Math.abs(dMin-bandCenter)<=gStep) coupledLen+=segLen/steps;
    }
  }
  return { ratio: totalLen>0?coupledLen/totalLen:0, coupledLen, totalLen };
}

/* ============================================================
   书籍知识函数库（权威书籍研读成果落地；出处见各函数注释与
   docs/书籍研读/ 笔记。全部为确定性计算，零依赖。）
   ============================================================ */

// 常见板材介电常数预设（行业标称值；正式阻抗控制须以板厂层压结构实测为准——见 fabChecklist 人工确认项。
// RTF2 ch4.6/ch5 警示：er 随树脂/玻璃构造与频率变化（FR-4 实测 3.63~4.69 @1GHz），
// 且表层微带经验公式误差大于带状线——工具公式仅作量级估算。df=耗散因子（Bogatin ch9：FR-4≈0.02）。
const DIELECTRICS = {
  fr4:         { name: 'FR-4 普通玻纤板',        er: 4.5,  df: 0.02,   note: '常用标称值；随构造与频率 3.63~4.69@1GHz（RTF2 ch5）' },
  'fr4-hi':    { name: 'FR-4 高速板(中/低损耗)', er: 3.9,  df: 0.01,   note: '高速 FR4 标称 3.8~4.0，Df 0.008~0.012' },
  rogers4350b: { name: 'Rogers RO4350B',        er: 3.48, df: 0.0037, note: '射频常用，损耗低' },
  ptfe:        { name: 'PTFE (F4)',             er: 2.1,  df: 0.0002, note: '高频板材' },
  air:         { name: '空气',                  er: 1.0,  df: 0,      note: '外层空气参考' }
};

// 介质损耗（dB/in）：α_diel≈2.3·f(GHz)·Df·√εr（Bogatin ch9，与几何无关）。
// FR-4 @1GHz≈0.1dB/in 量级；导线损 α_cond≈36·√f/(w·Z0)（f GHz, w mil）通常更小。
function dielectricLossDbPerIn(fGhz, df, er){
  fGhz=+fGhz; df=+df; er=+er;
  if(!(fGhz>0&&df>=0&&er>0)) return NaN;
  return 2.3*fGhz*df*Math.sqrt(er);
}

// 微带有效介电常数：介质未完全包裹导体，场一半在空气里（Bogatin 第7章 / 黑魔书第4章思路）。
// εeff=(εr+1)/2+(εr−1)/2·1/√(1+12h/w)。用于理解/显示，impedance() 的 IPC-2141 经验式已内含此修正。
function effectiveEr(er, h, w){
  er=+er; h=+h; w=+w;
  if(!(er>0&&h>0&&w>0)) return NaN;
  return (er+1)/2+(er-1)/2/Math.sqrt(1+12*h/w);
}

// 铜趋肤深度 δ=√(ρ/(πfμ))，返回 mm（f: Hz）。铜 ρ=1.72e-8Ω·m。
// 1GHz≈2.1µm、100MHz≈6.6µm、10MHz≈21µm——高频回流电流集中在导体表层（PEI p183/p291 趋肤效应）。
function skinDepth(f){
  if(!(f>0)) return NaN;
  const rho=1.72e-8, mu0=4*Math.PI*1e-7;
  return Math.sqrt(rho/(Math.PI*f*mu0))*1000;
}

// 走线单位长度交流电阻（Ω/mm）：δ≪导体尺寸时按"周长×δ"有效导电面积近似，
// 否则退回直流电阻 ρ/(w·t)——取两者较大值（实际电阻上限）。
function acTraceR(w, t, f){
  w=+w; t=+t;
  if(!(w>0&&t>0&&f>0)) return NaN;
  const rho=1.72e-8;
  const rDC=rho/(w*1e-3*t*1e-3)/1000;              // Ω/mm
  const d=skinDepth(f)*1e-3;                        // m
  const rAC=rho/(2*(w+t)*1e-3*d)/1000;              // 周长≈2(w+t)
  return Math.max(rAC, rDC);
}

// 拐点频率（黑魔书第1章）：Fknee=0.5/Tr，Tr 为 10%~90% 上升时间（秒），返回 Hz。
function fknee(tr){
  return tr>0 ? 0.5/tr : NaN;
}

// 传输线临界长度（黑魔书 1/6 判据）：Lcrit=Tr·v/6，v=c/√εr。返回 mm。
// 走线长于它，反射未及衰减就返回源端——必须按传输线处理（端接/控制阻抗）。
// 例：FR-4 (εr≈4.5)、Tr=1ns → ≈23.6mm。
function criticalLineLen(tr, er){
  if(!(tr>0&&er>0)) return NaN;
  return 299792458/Math.sqrt(er)*tr/6*1000;
}

// 某网络已布走线总长（mm）：自动+手动，同层段按几何长度累加，换层段是过孔不计线长。
function netRoutedLen(design, result, netId){
  let len=0;
  const nets=[...((result&&result.nets)||[]), ...manualRouteEntries(design)];
  for(const n of nets){
    if(n.netId!==netId) continue;
    for(const path of (n.paths||[])) for(let k=1;k<path.length;k++){
      const a=path[k-1], b=path[k];
      if(a.l!==b.l) continue;
      len+=Math.hypot(b.x-a.x, b.y-a.y);
    }
  }
  return len;
}

/* ---------- 高速网串扰并行扫描（Bogatin 附录B.70-89 量化依据） ----------
   对每个标记 hs 的网络：沿其走线每 1mm 采样，统计与其它网络同层并行贴行
   （中心距 < 3W，W=两网最大线宽）的累计并行长度。近端串扰量化参考：
   微带线 1W/2W/3W 间距 ≈ 5%/2%/1%，带状线 6%/2%/0.5%；总线 <5% 须 ≥2W。
   并行长且无法拉开间距时，插入两端接地的 GND 保护线可把串扰再降
   （微带约再降 50%，带状线约降至 10%——B.88-89）。 */
function hsCrosstalkScan(design, result, opts){
  opts=opts||{};
  const step=opts.step||1;                       // 采样步长 mm
  const nets=[...((result&&result.nets)||[]), ...manualRouteEntries(design)].filter(n=>(n.paths||[]).length);
  const geom=new Map();                          // netId -> 同层折线段列表（结果+手动统一几何）
  for(const n of nets) for(const path of n.paths)
    for(let k=1;k<path.length;k++){
      const a=path[k-1], b=path[k];
      if(a.l!==b.l) continue;
      if(!geom.has(n.netId)) geom.set(n.netId, []);
      geom.get(n.netId).push([a, b]);
    }
  const wOf=id=>{ const n=design.nets.find(nn=>nn.id===id); return (n&&n.w)||design.trackW; };
  const report=[];
  for(const h of design.nets.filter(n=>n.hs)){
    const hSegs=geom.get(h.id)||[];
    if(!hSegs.length) continue;
    const per=new Map();                          // otherNetId -> {runMm, minDist}
    for(const [netId, segs] of geom){
      if(netId===h.id || !segs.length) continue;
      let run=0, minD=Infinity;
      for(const [a,b] of segs){
        const L=Math.hypot(b.x-a.x,b.y-a.y);
        const ns=Math.max(1, Math.round(L/step));
        for(let s=0;s<=ns;s++){
          const px=a.x+(b.x-a.x)*s/ns, py=a.y+(b.y-a.y)*s/ns, pl=a.l;
          // 该采样点到 hs 网同层几何的最近距离
          let d=Infinity;
          for(const [c,e] of hSegs){
            if(c.l!==pl) continue;
            d=Math.min(d, segDist(px,py,c.x,c.y,e.x,e.y));
          }
          if(d<Infinity){
            minD=Math.min(minD, d);
            const W=Math.max(wOf(h.id), wOf(netId));
            if(d < 3*W + design.clearance) run+=L/ns;
          }
        }
      }
      const other=design.nets.find(nn=>nn.id===netId);
      if(run>0) per.set(netId, { net: other?other.name:netId, netId, runMm: +run.toFixed(1), minDist: +minD.toFixed(2) });
    }
    const others=[...per.values()].sort((a,b)=>b.runMm-a.runMm);
    // 饱和长度（Bogatin ch10：Len_sat=½×RT×v）——并行超过它之后近端串扰幅度不再增长
    //（RT 未知时省略；仅 tr 标注的高速网可算）
    const dn=design.nets.find(nn=>nn.id===h.id);
    const satLenMm=(dn&&dn.tr>0)?+(dn.tr*1e-9/2*299792458/Math.sqrt(4.5)*1000).toFixed(1):null;
    if(others.length) report.push({ net: h.name, netId: h.id, satLenMm, offenders: others.slice(0,5) });
  }
  return { ok:true, scanned: design.nets.filter(n=>n.hs).length, report,
    note:'并行长度=与其它网同层中心距<3W 的累计走线长度（1mm 采样近似）' };
}

// 微带/带状线平面电容（pF）：C=0.0885·εr·A/d（A cm²，d cm）——Bogatin B.17 口径
// （FR-4 1mil 介质≈1nF/in²）。A 用 mm²、d 用 mm，内部换算。
function pdnPlaneCapPf(areaMm2, dielectricMm, er){
  const A=+areaMm2, d=+dielectricMm, er_=+er;
  if(!(A>0&&d>0&&er_>0)) return NaN;
  const aCm2=A/100, dCm=d/10;
  return 0.0885*er_*aCm2/dCm;
}

// 成品铜厚（µm）：1oz≈35µm，每 0.5oz≈17.5µm
function copperThickUm(oz){
  return {'0.5':17.5,'1':35,'1.5':52.5,'2':70,'3':105,'4':140}[String(oz)]||35;
}

// 过孔回路电感近似（nH）：L=5.08·h·[ln(4h/d)+1]，h=孔长(mm)、d=孔径(mm)。
// 黑魔书 ch7（式7.9 口径，h/d 换算成 inch 后计算）。0.3mm 孔、1.6mm 板≈1.3nH——
// 每颗过孔都是串在回流路径上的电感，这是"换层配回流地孔"的物理量。
function viaLoopInductanceNanohenry(hMm, dMm){
  const h=+hMm/25.4, d=+dMm/25.4;               // mm → inch
  if(!(h>0&&d>0&&d<h)) return NaN;
  return 5.08*h*(Math.log(4*h/d)+1);
}

/* ---------- PDN 回路电感解析式族（Bogatin ch13，单位 mil，结果 pH，均已按书中算例验算） ----------
   这些一阶式构成缝合孔/去耦电容布局的 ESL 打分引擎原料——全部线性/对数运算，零依赖可算。 */
// 走线回路电感（信号-返回成对）：L=32·h·Len/w pH（h=介质厚、Len=线长、w=线宽，mil）
function traceLoopInductancePh(hMil, lenMil, wMil){
  if(!(hMil>0&&lenMil>0&&wMil>0)) return NaN;
  return 32*hMil*lenMil/wMil;
}
// 过孔对回路电感：L=10.16·Len·ln(2s/d) pH（Len=孔长、s=孔距、d=孔径，mil）
function viaPairLoopInductancePh(lenMil, sMil, dMil){
  if(!(lenMil>0&&sMil>0&&dMil>0&&2*sMil>dMil)) return NaN;
  return 10.16*lenMil*Math.log(2*sMil/dMil);
}
// 平面对方块回路电感：L=32·h pH/sq（h=介质厚 mil）——33pH/mil 口径的同源式
function planeSquareLoopInductancePh(hMil){
  if(!(hMil>0)) return NaN;
  return 32*hMil;
}
// 径向扩散电感（从过孔外缘扩到半径 b）：L=5.14·h·ln(b/a) pH
function radialSpreadingInductancePh(hMil, aMil, bMil){
  if(!(hMil>0&&aMil>0&&bMil>aMil)) return NaN;
  return 5.14*hMil*Math.log(bMil/aMil);
}
// 两过孔间扩散电感：L=21·h·ln(B/D) pH（B=孔间距、D=孔径）
function betweenViasSpreadingInductancePh(hMil, bMil, dMil){
  if(!(hMil>0&&bMil>0&&dMil>0&&bMil>dMil)) return NaN;
  return 21*hMil*Math.log(bMil/dMil);
}

/* ---------- 结果-设计同步检查 ----------
   result.json 是某个 design 状态下布出来的；设计再被编辑（挪焊盘/改栅格）后，
   旧 result 与新 design 的"组合"会产生幽灵分析（实测事故：atmega 项目 result
   与 design 不同步，IR-drop 全部误报孤立）。判据：某网全部路径顶点没有一个
   落在该网任一焊盘铜内 → 该网路径与当前焊盘完全脱节，几乎必然是旧结果。 */
function staleResultCheck(design, result){
  const stale=[];
  const nets=[...((result&&result.nets)||[]), ...manualRouteEntries(design)].filter(n=>(n.paths||[]).length);
  for(const n of (design.nets||[])){
    const rn=nets.filter(x=>x.netId===n.id);
    if(!rn.length) continue;                        // 该网未布线，谈不上脱节
    const pads=(design.pads||[]).filter(p=>p.netId===n.id);
    if(!pads.length) continue;
    let touch=false;
    outer: for(const x of rn) for(const path of x.paths) for(const v of path)
      for(const p of pads)
        if(padOnLayer(p, v.l, design.layers) && pointPadDistance(v.x, v.y, p)<=1e-9){ touch=true; break outer; }
    if(!touch) stale.push(n.name);
  }
  return { ok: stale.length===0, staleNets: stale,
    note:'检查每个已布网络的路径是否至少有一点接触其焊盘铜区；零接触=结果与设计大概率不同步（design 在布线后被编辑过）' };
}

/* ---------- 自动回流地孔配对（黑魔书 ch7 对策③ / Bogatin A.55-57） ----------
   高速网换层过孔若 reach 内没有地导体，自动在其旁补一颗 GND 缝合孔。
   reach 默认 1.6mm——回流孔有效条件是"间距 < 过孔长度"（Bogatin ch6）。
   候选位置按 16 角度 × 半径梯度搜索，逐一过间距审查
   （异网焊盘/走线/过孔/缝合孔/禁布区/板边），放不下则如实报告。 */
function autoReturnVias(design, result, opts){
  opts=opts||{};
  const reach=opts.reach||1.6;
  const gnd=(design.nets||[]).find(n=>/^(gnd|agnd|dgnd|pgnd)/i.test(n.name));
  if(!gnd) return { ok:false, reason:'无地网络', added:[], checked:0 };
  const isGndNet=id=>id===gnd.id;
  const allNets=[...((result&&result.nets)||[]), ...manualRouteEntries(design)].filter(Boolean);
  const hsVias=[];
  for(const n of allNets){
    const dn=(design.nets||[]).find(x=>x.id===n.netId);
    if(dn&&dn.hs) for(const v of (n.vias||[])) hsVias.push(v);
  }
  // 地导体采样（reach 判定用）
  const gndStitch=(design.stitching||[]).filter(s=>s.netId===gnd.id);
  const gndVias=[];
  for(const n of allNets) if(isGndNet(n.netId)) for(const v of (n.vias||[])) gndVias.push(v);
  const gndSegs=[];
  for(const n of allNets) if(isGndNet(n.netId))
    for(const path of (n.paths||[])) for(let k=1;k<path.length;k++){
      const a=path[k-1], b=path[k];
      if(a.l!==b.l) continue;
      gndSegs.push([a,b]);
    }
  const gndPads=(design.pads||[]).filter(p=>p.netId===gnd.id);
  const gndCovered=(x,y)=>{
    for(const s of gndStitch) if(Math.hypot(s.x-x,s.y-y)<=reach+1e-9) return true;
    for(const v of gndVias) if(Math.hypot(v.x-x,v.y-y)<=reach+1e-9) return true;
    for(const p of gndPads) if(pointPadDistance(x,y,p)<=reach+1e-9) return true;
    for(const [a,b] of gndSegs) if(segDist(x,y,a.x,a.y,b.x,b.y)<=reach+1e-9) return true;
    if(result){
      const gp=(result.pours||[]).concat(result.pour?[result.pour]:[])
        .find(p=>p&&p.netId===gnd.id);
      if(gp&&pourNear(gp,x,y,reach+1e-9)) return true;
    }
    return false;
  };
  // 异网导体清单（候选间距审查用）
  const oVias=[], oStitch=(design.stitching||[]).filter(s=>s.netId!==gnd.id), oSegs=[];
  for(const n of allNets) if(!isGndNet(n.netId)){
    for(const v of (n.vias||[])) oVias.push(v);
    for(const path of (n.paths||[])) for(let k=1;k<path.length;k++){
      const a=path[k-1], b=path[k];
      if(a.l!==b.l) continue;
      oSegs.push([a,b,netW(design,n.netId)]);
    }
  }
  const oPads=(design.pads||[]).filter(p=>!(p.netId!=null&&p.netId===gnd.id));
  const okPos=(x,y)=>{
    const r=design.viaOuter/2;
    if(x-r<0||x+r>design.width||y-r<0||y+r>design.height) return false;
    for(const k of (design.keepouts||[])) if(distToRect(x,y,k.x,k.y,k.w,k.h)<r-1e-9) return false;
    for(const p of oPads) if(pointPadDistance(x,y,p)<r+design.clearance-1e-9) return false;
    for(const v of oVias) if(Math.hypot(v.x-x,v.y-y)<design.viaOuter+design.clearance-1e-9) return false;
    for(const s of oStitch) if(Math.hypot(s.x-x,s.y-y)<design.viaOuter+design.clearance-1e-9) return false;
    for(const [a,b,w] of oSegs) if(segDist(x,y,a.x,a.y,b.x,b.y)<r+design.clearance+w/2-1e-9) return false;
    for(const s of gndStitch) if(Math.hypot(s.x-x,s.y-y)<design.viaOuter-1e-9) return false;
    for(const v of gndVias) if(Math.hypot(v.x-x,v.y-y)<design.viaOuter-1e-9) return false;
    for(const p of gndPads){
      if(pointPadDistance(x,y,p)<r-1e-9) return false;
      if((p.holeR||0)>0&&Math.hypot(x-p.x,y-p.y)<p.holeR+design.viaDrill/2+JLC.viaEdgeMin-1e-9) return false;   // 同网孔边距（DRC 同口径）
    }
    for(const v of hsVias) if(Math.hypot(v.x-x,v.y-y)<design.viaOuter+design.clearance-1e-9) return false;
    return true;
  };
  const added=[];
  const skipped=[];
  for(const v of hsVias){
    if(gndCovered(v.x,v.y)) continue;
    let placed=null;
    const r0=design.viaOuter+design.clearance;
    for(let r=r0; r<=reach && !placed; r+=0.15){
      for(let a=0;a<16 && !placed;a++){
        const th=a*Math.PI/8;
        const x=v.x+r*Math.cos(th), y=v.y+r*Math.sin(th);
        if(okPos(x,y)) placed={x:+x.toFixed(3), y:+y.toFixed(3), netId:gnd.id, forVia:{x:v.x,y:v.y}};
      }
    }
    if(placed) added.push(placed);
    else skipped.push({x:v.x,y:v.y});
  }
  return { ok:true, checked:hsVias.length, added, skipped,
    note:'reach 内已有地导体（缝合孔/地过孔/地焊盘/地走线/铺铜）的换层过孔不重复配对；reach 默认 1.6mm≈过孔长度（Bogatin ch6）' };
}

/* ---------- PDN 一阶阻抗求解器（Bogatin ch13 目标阻抗法 + 黑魔书 ch8 库仑桶 + RTF2 附录2 流程） ----------
   全部为代数级一阶估算（ch12 明确的"工具级近似够用"边界内）：
   ① 目标阻抗 Ztarget=纹波%×V/I（13.4）
   ② 体电容下限（库仑桶）C=I·Δt/ΔV（黑魔书 ch8；Δt=VRM 响应时间，默认 10µs）
   ③ 平面电容（B.17：C=0.0885·εr·A/d；仅四层板有真平面对，双层按 0 计并注明）
   ④ 去耦电容库：N 颗同容值并联——C_total=N·C、ESL_total=ESL/N、SRF 不变（159/√(L_nH·C_nF) MHz）
   ⑤ 电容库→平面交接频率 f=1/(2π√(L_total·C_plane))，交接处阻抗 Z=√(L_total/C_plane)
   ⑥ 判定：Z_handoff ≤ Ztarget → 一阶达标；否则建议（降 ESL 第一——A.72-75，其次加颗数）
   可选 pkgLnH 给出封装电感上限 Fmax=Ztarget/(2π·L_pkg)——封装以上无可为（13.10）。
   电容参数未知时按 100nF/1nH 假设（0402 装连量级，B.24 典型 2nH、低装连 <1nH）并诚实标注。 */
function pdnEstimate(design, result, opts){
  opts=opts||{};
  const vdd=+opts.vdd||3.3, itrans=+opts.itrans||1, ripplePct=+opts.ripplePct||5;
  const dtUs=+opts.dtUs||10, eslNh=+opts.eslNh||1.0, capUf=+opts.capUf||0.1;
  const notes=[];
  const ztarget=ripplePct/100*vdd/itrans;
  // 电容库存：电源网上的 C* 元件（去耦电容按元件计数）
  const isPower=n=>/^(gnd|agnd|dgnd|vcc|vdd|v\+|v-|\+?[35]v3?|\+?5v|avcc|vbat|vsys|pwr|vin)/i.test(n||'');
  const caps=new Set();
  for(const p of (design.pads||[])){
    const net=(design.nets||[]).find(nn=>nn.id===p.netId);
    if(net&&isPower(net.name)){
      const comp=p.id.split('-')[0];
      if(/^c/i.test(comp)) caps.add(comp);
    }
  }
  const N=caps.size;
  const cTotalNf=N*capUf*1000, eslTotalNh=N>0?eslNh/N:Infinity;
  const srfMhz=N>0?159/Math.sqrt(eslNh*capUf*1000):null;   // 并联同容值：SRF 与单颗相同
  // 平面电容：四层板按内层平面对 0.2mm 介质假设；双层无平面对
  const four=(design.layers||2)>=4;
  const areaMm2=design.width*design.height;
  const planeCapPf=four?pdnPlaneCapPf(areaMm2, 0.2, DIELECTRICS.fr4.er):0;
  if(!four) notes.push('双层板无连续平面对，平面电容按 0 计（底层铺铜有贡献但一阶模型不采信）');
  if(N===0) notes.push('未发现电源网上的去耦电容（C* 元件）——电容库项无法评估');
  notes.push(`电容参数未知，按 ${capUf*1000}nF/ESL ${eslNh}nH 假设（0402 装连量级；B.24 典型 2nH、低装连 <1nH）——有 BOM 实值时以 pdn --esl-nh/--cap-uf 传入`);
  // 库仑桶体电容下限
  const dv=ripplePct/100*vdd;
  const bulkCuf=itrans*(dtUs*1e-6)/dv*1e6;
  // 交接频率与交接处阻抗（电容库感性段 vs 平面容性段）
  let handoffMhz=null, zHandoff=null, pass=null;
  if(four&&N>0){
    const L=eslTotalNh*1e-9, C=planeCapPf*1e-12;
    const fHand=1/(2*Math.PI*Math.sqrt(L*C));
    handoffMhz=fHand/1e6;
    zHandoff=+(Math.sqrt(L/C)).toPrecision(4);
    pass=zHandoff<=ztarget;
    if(!pass) notes.push(`交接处 ${zHandoff}Ω > 目标 ${ztarget}Ω：优先降安装电感（A.72-75——焊盘-过孔短而宽/多过孔），其次加颗数（ESL_total=ESL/N）`);
    else notes.push('交接处阻抗一阶达标——正式设计仍须按 RTF2 附录2 实测验证（裸板平面电容→装电容阻抗曲线→最坏工况纹波）');
  }
  let fmaxPkg=null;
  if(opts.pkgLnH>0){
    fmaxPkg=+(ztarget/(2*Math.PI*opts.pkgLnH*1e-9)/1e6).toPrecision(4);
    notes.push(`封装电感 ${opts.pkgLnH}nH 时板级 PDN 有效上限 ≈${fmaxPkg}MHz——封装以上无可为（13.10）`);
  }
  // ESL 敏感性扫描（ch13.22：初始条件任何一项变了整个组合作废）——装连电感 +50% 的悲观判定
  let sensitivity=null;
  if(four&&N>0){
    const zPess=Math.sqrt((eslTotalNh*1.5)*1e-9/(planeCapPf*1e-12));
    const passPess=zPess<=ztarget;
    sensitivity={ eslX15Zohm:+zPess.toPrecision(4), passPess };
    if(pass&&!passPess) notes.push(`ESL 敏感：装连电感增大 50% 即不达标（悲观 ${zPess}Ω）——安装电感必须严格控制（短而宽/多过孔，A.72-75）`);
  }
  return { ok:true, vdd, itrans, ripplePct, ztargetOhm:+ztarget.toPrecision(4),
    bulkCuf:+bulkCuf.toPrecision(4), dtUs,
    planeCapPf:four?+planeCapPf.toPrecision(4):0,
    caps:{ count:N, cTotalNf:+cTotalNf.toPrecision(4), eslTotalNh:N>0?+eslTotalNh.toPrecision(4):null, srfMhz:srfMhz?+srfMhz.toPrecision(4):null },
    handoffMhz:handoffMhz?+handoffMhz.toPrecision(4):null, zHandoffOhm:zHandoff, pass,
    sensitivity, fmaxPkgMhz:fmaxPkg, notes,
    scope:'代数级一阶估算（Bogatin ch12 工具级边界）：不含 SPICE/频谱/封装模型；正式设计按 RTF2 附录2 三步实测' };
}

/* ---------- FDTIM 电容选型计划（Bogatin 13.16-13.22，Larry Smith 频域目标阻抗法） ----------
   每颗电容建 ESR+ESL+C 串联支路，全部支路导纳并行相加后逐频点扫频——
   异容值组合的并联反谐振峰（PRF）从模型中自然涌现，而非近似式（13.16 明言 PRF 解析难精算）。
   逐档贪心：标准容值阶梯（1.0/1.5/2.2/3.3/4.7/6.8×10ⁿ，nF）从大容值起，
   每档加颗直到全频段 Z≤Ztarget（该档无改善则进下一档——其频段已尽）。
   ESR 默认 max(20, 180/√C[nF]) mΩ——180/√C 为 13.16 对 MLCC 的拟合（10nF≈57 vs 书 70mΩ 同数量级），
   但对大容值严重低估（47µF 拟合 0.83mΩ vs 实际电解 30~100mΩ），故设 20mΩ 工艺地板（opts.esrFloorMohm 可覆盖）。
   最小档容值 ≈ 平面电容的 1/3（13.22：40in² 板→平面 9~10nF→最小档 2.2nF）。
   理论最少颗数 n=⌈2π·Fmax·ESL/Ztarget⌉（13.21：0.1Ω/0.1GHz/2nH→13 颗）——
   输出实际总颗数与之对比（分布不唯一，总颗数接近理论最少最经济）。 */
function fdtimPlan(opts){
  const ztarget=+opts.ztarget;
  const fminMhz=+opts.fminMhz||1, fmaxMhz=+opts.fmaxMhz||100;
  const eslNh=+opts.eslNh||2;
  const planeCapPf=Math.max(0,+opts.planeCapPf||0);
  const esrCoef=+opts.esrCoef||180;
  const esrFloorMohm=opts.esrFloorMohm!=null?+opts.esrFloorMohm:20;
  const esrOf=cNf=>Math.max(esrFloorMohm, esrCoef/Math.sqrt(cNf))/1000;   // mΩ→Ω
  const ladder=(opts.ladderNf||[1000,470,220,100,47,22,10,4.7,2.2]).slice().sort((a,b)=>b-a);
  const maxPerTier=+opts.maxPerTier||30, maxTotal=+opts.maxTotal||120;
  if(!(ztarget>0)||!(fmaxMhz>fminMhz)||!(eslNh>0)) return { ok:false, reason:'参数需 ztarget>0、fmax>fmin、esl>0' };
  // 最小档：≤平面电容 1/3 的最大标准档（无平面对时用全阶梯）
  let smallestTier=ladder[ladder.length-1];
  if(planeCapPf>0){
    const lim=planeCapPf/3/1000;                                    // pF→nF 再取 1/3
    const cand=ladder.filter(v=>v<=lim);
    smallestTier=cand.length?cand[0]:smallestTier;
  }
  const tiers=ladder.filter(v=>v>=smallestTier);
  // 频点：61 个对数点
  const NPTS=61;
  const freqs=[];
  for(let i=0;i<NPTS;i++) freqs.push(fminMhz*Math.pow(fmaxMhz/fminMhz,i/(NPTS-1)));
  // 每颗电容支路导纳：y=(r-jx)/(r²+x²)，r=ESR(Ω)、x=ωL−1/(ωC)；count 颗并联=导纳×count
  const branchY=(cNf,count,fMhz)=>{
    const c=cNf*1e-9, l=eslNh*1e-9, r=esrOf(cNf);
    const w=2*Math.PI*fMhz*1e6;
    const x=w*l-1/(w*c);
    const g0=r/(r*r+x*x), b0=-x/(r*r+x*x);
    return { g:g0*count, b:b0*count };
  };
  const evalSweep=(sched)=>{
    let maxZ=0, fWorst=fminMhz; const sweep=[];
    for(const f of freqs){
      let G=0, B=0;
      for(const [cNf,count] of sched){
        if(!count) continue;
        const y=branchY(cNf,count,f); G+=y.g; B+=y.b;
      }
      if(planeCapPf>0){ B+=2*Math.PI*f*1e6*planeCapPf*1e-12; }   // 平面按纯容性一阶（13.24：位置/扩散另一层）
      const Z=1/Math.sqrt(G*G+B*B);
      sweep.push({ fMhz:+f.toPrecision(4), zOhm:+Z.toPrecision(4) });
      if(Z>maxZ){ maxZ=Z; fWorst=f; }
    }
    return { maxZ:+maxZ.toPrecision(4), fWorst:+fWorst.toPrecision(4), sweep };
  };
  const theoryMin=Math.ceil(2*Math.PI*fmaxMhz*1e6*eslNh*1e-9/ztarget);
  const schedule=new Map();
  const cloneSched=s=>{ const m=new Map(); for(const [k,v] of s) m.set(k,v); return m; };
  const totalOf=s=>{ let t=0; for(const v of s.values()) t+=v; return t; };
  let sweep=evalSweep(schedule);
  // 逐档贪心（档级最优状态采用）：每档试加颗，只采纳本档扫频最优状态——
  // 保证全局 maxZ 单调不增（某档加颗在别处造新峰时自动回退跳档）。
  for(const cNf of tiers){
    if(sweep.maxZ<=ztarget) break;
    let bestMax=sweep.maxZ, bestSched=null, count=0;
    while(count<maxPerTier && totalOf(schedule)<maxTotal){
      schedule.set(cNf,(schedule.get(cNf)||0)+1); count++;
      const sw=evalSweep(schedule);
      if(sw.maxZ < bestMax-1e-12){ bestMax=sw.maxZ; bestSched=cloneSched(schedule); }
      if(sw.maxZ<=ztarget) break;
    }
    if(bestSched){
      for(const k of [...schedule.keys()]){
        const want=bestSched.get(k)||0;
        if(schedule.get(k)!==want) schedule.set(k,want);
      }
      sweep=evalSweep(schedule);
    }
  }
  // 达标后瘦身裁剪：从小档起逐颗试减，保持达标的前提下逼近理论最少（13.22"接近理论最少最经济"）
  if(sweep.maxZ<=ztarget){
    for(const cNf of [...tiers].reverse()){
      while((schedule.get(cNf)||0)>0){
        schedule.set(cNf, schedule.get(cNf)-1);
        const sw=evalSweep(schedule);
        if(sw.maxZ<=ztarget){ sweep=sw; }
        else { schedule.set(cNf, schedule.get(cNf)+1); break; }
      }
    }
  }
  const scheduleOut=tiers.filter(v=>(schedule.get(v)||0)>0).map(v=>{
    const c=v, n=schedule.get(v);
    return { cNf:v, count:n, esrMohm:+(esrOf(v)*1000).toPrecision(3),
      srfMhz:+(159/Math.sqrt(eslNh*v)).toPrecision(4) };
  });
  return { ok:true, ztargetOhm:+ztarget.toPrecision(4), fminMhz, fmaxMhz, eslNh,
    planeCapPf:planeCapPf||null, smallestTierNf:smallestTier,
    theoryMin, total: totalOf(schedule), pass: sweep.maxZ<=ztarget,
    maxZOhm:sweep.maxZ, fWorstMhz:sweep.fWorst, schedule:scheduleOut, sweep:sweep.sweep,
    notes:[
      '扫频为并联导纳精确模型（含 ESR 阻尼）——反谐振峰自然涌现；每档频段贪心加颗',
      '分布不唯一：总颗数接近理论最少最经济（13.22）；初始条件（ESL/平面/目标线）任何一项变了须重算',
      '正式设计仍须带每颗真实 ESR 全链仿真并按 RTF2 附录2 实测验证',
    ] };
}

/* ---------- 电源网 IR-drop 求解器（PEI p276-278 SPICE 节点电导矩阵原理） ----------
   把布线后的走线段当电阻网络：r=ρ·L/(w·t)（w=每网线宽，t=成品铜厚），
   换层段叠加过孔电阻 viaR。供电入口固定 0V：
   ① opts.entries 指定的焊盘 id；② 有铺铜时该网全部过孔（铺铜平面≈理想 0V，
   平面电阻远小于走线电阻——近似声明）；③ 缺一不可时返回 ok:false 并说明。
   其余焊盘均分负载电流 opts.current，解 G·v=i 得各焊盘压降与等效电阻 rEff。
   供电路径之外的孤立焊盘单独报告（布线未连通本应被 DRC 拦下）。 */
function powerDrop(design, result, netId, opts){
  opts=opts||{};
  const net=(design.nets||[]).find(n=>n.id===netId);
  if(!net) throw new Error('powerDrop: 未知 netId '+netId);
  const pads=(design.pads||[]).filter(p=>p.netId===netId);
  if(!pads.length) throw new Error('powerDrop: 该网络没有焊盘');
  const w=netW(design, netId), tUm=copperThickUm(design.copperWeight);
  const rho=1.72e-8, viaR=5e-4;                     // 0.3mm 通孔 barrel 量级，取保守 0.5mΩ
  const segR=(a,b)=>rho*Math.hypot(b.x-a.x,b.y-a.y)*1e-3/(w*1e-3*tUm*1e-6)+((a.l!==b.l)?viaR:0);

  // 路径顶点 → 节点（T 型分支处其它路径的顶点若落在某段上须把该段切开，
  // 否则分支接触点丢失。全部坐标在栅格上，做"顶点落段"切分足够覆盖 RMST 树分支。）
  const verts=[];                                    // {x,y,l}
  const nodeIdx=new Map();                           // 'x,y' -> index
  const nodeOf=p=>{
    const key=p.x.toFixed(3)+','+p.y.toFixed(3);
    if(!nodeIdx.has(key)){ nodeIdx.set(key, verts.length); verts.push({x:p.x,y:p.y,l:p.l}); }
    return nodeIdx.get(key);
  };
  const paths=[];
  const nres=((result&&result.nets)||[]).find(n=>n.netId===netId);
  for(const n of [nres, ...manualRouteEntries(design)].filter(Boolean))
    for(const path of (n.paths||[])) if(path.length>1) paths.push(path);
  // 规模护栏：稠密高斯消元 O(n³)——超大网络如实降级（>3000 节点即 900 万级运算+72MB 矩阵）
  let vertCount=0;
  for(const path of paths) vertCount+=path.length;
  if(vertCount>3000)
    return { ok:false, net:net.name, reason:`网络路径节点 ${vertCount} 个，超出 IR-drop 求解器规模上限（3000，稠密消元 O(n³)）`,
      hint:'拆分电源域或分层评估；大规模平面级 PDN 请用专用工具' };
  for(const path of paths) for(const p of path) nodeOf(p);
  const segs=[];                                     // {i,j,r} 节点对
  const onSeg=(p,a,b)=>{
    const cross=(b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);
    const L=Math.hypot(b.x-a.x,b.y-a.y);
    if(L<1e-9) return false;
    return Math.abs(cross)/L<1e-6 && (p.x-Math.min(a.x,b.x))*(p.x-Math.max(a.x,b.x))<=1e-9
                                  && (p.y-Math.min(a.y,b.y))*(p.y-Math.max(a.y,b.y))<=1e-9;
  };
  for(const path of paths){
    for(let k=1;k<path.length;k++){
      const a=path[k-1], b=path[k];
      if(Math.abs(a.x-b.x)<1e-9&&Math.abs(a.y-b.y)<1e-9) continue;   // 纯换层：r=viaR，在下方按段处理
      // 收集落在该段上的其它顶点（含端点重合者——按坐标判断），按投影参数排序后串成子段
      const seen=new Set([a.x.toFixed(3)+','+a.y.toFixed(3), b.x.toFixed(3)+','+b.y.toFixed(3)]);
      const cuts=[];
      for(const q of verts){
        const key=q.x.toFixed(3)+','+q.y.toFixed(3);
        if(seen.has(key)) continue;
        if(!onSeg(q,a,b)) continue;
        seen.add(key);
        cuts.push(q);
      }
      const L2=Math.hypot(b.x-a.x,b.y-a.y);
      cuts.sort((p,q)=>Math.hypot(p.x-a.x,p.y-a.y)-Math.hypot(q.x-a.x,q.y-a.y));
      let prev=a;
      for(const q of [...cuts, b]){ segs.push({i:nodeOf(prev), j:nodeOf(q), r:segR(prev,q)+(prev.l!==q.l?viaR:0)}); prev=q; }
    }
  }
  // 焊盘铜区是等电位：把落在焊盘铜内（层归属匹配）的路径顶点与焊盘中心节点相连。
  // 布线端点落在焊盘覆盖格上而非焊盘中心——不接这一步图就是断的。
  for(const p of pads){
    const ni=nodeOf(p);
    for(const q of verts){
      if(!padOnLayer(p, q.l, design.layers)) continue;
      if(pointPadDistance(q.x, q.y, p)<=1e-9 && nodeIdx.get(q.x.toFixed(3)+','+q.y.toFixed(3))!==ni)
        segs.push({i:ni, j:nodeOf(q), r:1e-6});          // 1µΩ 近似等电位
    }
  }
  // 入口集合
  const entryIdx=new Set();
  for(const id of (opts.entries||[])){
    const p=pads.find(pp=>pp.id===id);
    if(!p) throw new Error('powerDrop: entries 里的 '+id+' 不是该网络焊盘');
    entryIdx.add(nodeOf(p));
  }
  const vias=[];
  for(const n of [nres, ...manualRouteEntries(design)].filter(Boolean)) for(const v of (n.vias||[])) vias.push(v);
  // 该网任一铜皮存在即视为铺铜供电（多铜皮流程下主铜皮 r.pour 可能是别的网；
  // 宽松 netId 口径——退化 pour 对象（无 polys）与旧结果兼容，几何由使用处自守卫）
  const pourOk=!!(result&&[...(result.pours||[]), ...(result.pour?[result.pour]:[])]
    .find(p=>p&&p.netId===netId));
  if(pourOk){                                        // 铺铜≈理想0V：该网全部过孔+缝合孔视为入口
    for(const v of vias) entryIdx.add(nodeOf(v));
    for(const s of (design.stitching||[])) if(s.netId===netId) entryIdx.add(nodeOf(s));
  }
  if(!entryIdx.size){
    // 启发式默认：把连接器/电源入口类焊盘当供电入口（J1/CN/DC/PWR/BAT/USB/TYPEC 前缀）
    for(const p of pads)
      if(/^(j\d+|cn|dc|pwr|bat|usb|typec)[-_]/i.test(p.id)) entryIdx.add(nodeOf(p));
  }
  if(!entryIdx.size)
    return { ok:false, net:net.name, reason:'无供电入口：没有铺铜过孔，也没找到连接器类焊盘（J1/CN/DC/BAT/USB 前缀）——请用 entries 显式指定',
      hint:'drop 命令 --entries J1-1,V1-3', pads:(pads.slice(0,8).map(p=>p.id)) };

  // 连通性：与入口同分量的才可解；孤立焊盘单独报告
  const parent=Array.from({length:verts.length},(_,i)=>i);
  const find=i=>{ while(parent[i]!==i){ parent[i]=parent[parent[i]]; i=parent[i]; } return i; };
  for(const s of segs) parent[find(s.i)]=find(s.j);
  const rootEntry=find([...entryIdx][0]);
  const padNode=p=>nodeOf(p);
  const isolated=[], loads=[];
  for(const p of pads){
    const ni=padNode(p);
    if(entryIdx.has(ni)) continue;
    if(find(ni)!==rootEntry){ isolated.push(p.id); continue; }
    loads.push(p);
  }
  if(!loads.length)
    return { ok:true, net:net.name, current:0, maxR:0, maxDropV:0, drops:[], isolated, entries:[...entryIdx].map(i=>verts[i]),
      note:'除入口外无负载焊盘' };

  // 组装 G·v=i（入口行/列删除=强制 0V；gmin 防奇异）
  const N=verts.length;
  const G=Array.from({length:N},()=>new Float64Array(N));
  const b=new Float64Array(N);
  const gmin=1e-9;
  for(const s of segs){
    if(s.r<=0) continue;
    const g=1/s.r;
    G[s.i][s.i]+=g; G[s.j][s.j]+=g; G[s.i][s.j]-=g; G[s.j][s.i]-=g;
  }
  for(const i of entryIdx){ G[i][i]+=1; b[i]=0; }    // 入口对地强导通
  const I=(opts.current>0?opts.current:1)/loads.length;
  for(const p of loads) b[padNode(p)]+=I;
  for(let i=0;i<N;i++) G[i][i]+=gmin;

  // 高斯消元（列主元）——只解非入口未知数
  const idxMap=[]; for(let i=0;i<N;i++) if(!entryIdx.has(i)) idxMap.push(i);
  const M=idxMap.length;
  const A=idxMap.map(i=>Array.from(G[i]).filter((_,c)=>!entryIdx.has(c)));
  const rhs=idxMap.map(i=>b[i]);
  for(let c=0;c<M;c++){
    let piv=c;
    for(let r=c+1;r<M;r++) if(Math.abs(A[r][c])>Math.abs(A[piv][c])) piv=r;
    if(Math.abs(A[piv][c])<1e-18) continue;
    [A[c],A[piv]]=[A[piv],A[c]]; [rhs[c],rhs[piv]]=[rhs[piv],rhs[c]];
    for(let r=c+1;r<M;r++){
      const f=A[r][c]/A[c][c];
      if(!f) continue;
      for(let k=c;k<M;k++) A[r][k]-=f*A[c][k];
      rhs[r]-=f*rhs[c];
    }
  }
  const v=new Float64Array(N);
  const x=new Float64Array(M);
  for(let r=M-1;r>=0;r--){
    let s=rhs[r];
    for(let k=r+1;k<M;k++) s-=A[r][k]*x[k];
    x[r]=Math.abs(A[r][r])>1e-18? s/A[r][r] : 0;
  }
  idxMap.forEach((ni,k)=>{ v[ni]=x[k]; });

  const drops=loads.map(p=>{
    const ni=padNode(p);
    return { pad:p.id, dropV:+(v[ni]).toPrecision(6), rEff:+(v[ni]/I).toPrecision(6) };
  }).sort((a,b)=>b.rEff-a.rEff);
  const worst=drops[0];
  return { ok:true, net:net.name, current:opts.current>0?opts.current:1,
    maxR:worst.rEff, maxDropV:worst.dropV, worstPad:worst.pad, drops,
    isolated, entries:[...entryIdx].map(i=>({x:verts[i].x,y:verts[i].y})),
    approx:'走线段 r=ρ·L/(w·t)，换层叠加过孔 0.5mΩ；铺铜平面按理想 0V；孤立焊盘不计入求解' };
}

/* ---------- 常用封装焊盘生成器 ----------
   返回相对封装中心的焊盘数组 [{dx,dy,w,h,shape,layer}]。
   贴片阻容为 IPC-7351 nominal 参考值（来源：JLCPCB SMD 封装尺寸指南 +
   DigiKey 推荐布局），SOIC/SOT/DIP/排针为业界通用值；放置后可逐项编辑。
   引脚编号：贴片阻容 1 左 2 右；SOIC/SOT/DIP 逆时针（1 在左上）；
   排针 1×N / 2×N 从左到右、逐行。 */
function footprintPads(name, n){
  n=Math.max(2, Math.round(n||0));
  const R=(dx,dy,w,h,layer)=>({dx,dy,w,h,shape:'rect',layer:layer||'top'});
  const C=(dx,dy,d,hole)=>({dx,dy,w:d,h:d,shape:'circle',layer:'both',holeR:hole!=null?hole:0.45});
  const P=[];
  const chip=(c2c,pw,ph)=>{ P.push(R(-c2c/2,0,ph,pw),R(c2c/2,0,ph,pw)); };
  if(name==='0402')  chip(0.95,0.60,0.55);
  else if(name==='0603') chip(1.60,0.80,0.90);
  else if(name==='0805') chip(1.95,0.95,1.15);
  else if(name==='1206') chip(2.80,1.25,1.45);
  else if(name==='SOT-23'){
    // 1/2 在下排（间距 0.95），3 在上排中线；跨度 2.4
    P.push(R(-0.475,1.2,0.6,1.0), R(0.475,1.2,0.6,1.0), R(0,-1.2,0.6,1.0));
  }
  else if(name==='SOT-223'){
    // 1/2/3 下排间距 2.3，tab(4) 上排居中
    P.push(R(-2.3,1.75,1.2,1.8), R(0,1.75,1.2,1.8), R(2.3,1.75,1.2,1.8), R(0,-1.75,2.6,1.8));
  }
  else if(name.startsWith('SOIC-')){
    const per=Math.round((parseFloat(name.slice(5))||8)/2);   // SOIC-8/14/16 参数化
    for(let k=0;k<per;k++){          // 左列 1..per：上→下（pin1 左上）
      const y=(k-(per-1)/2)*1.27;
      P.push(R(-2.7,y,1.5,0.6));
    }
    for(let k=per-1;k>=0;k--){       // 右列 per+1..n：下→上（逆时针）
      const y=(k-(per-1)/2)*1.27;
      P.push(R(2.7,y,1.5,0.6));
    }
  }
  else if(name==='DIP-N'){
    if(n%2) n++;
    const per=n/2;
    for(let k=0;k<per;k++){          // 左列 1..per：上→下（pin1 左上，7.62mm 排距）
      const y=(k-(per-1)/2)*2.54;
      P.push(C(-3.81,y,1.7));
    }
    for(let k=per-1;k>=0;k--){       // 右列 per+1..n：下→上（逆时针）
      const y=(k-(per-1)/2)*2.54;
      P.push(C(3.81,y,1.7));
    }
  }
  else if(name==='排针 1×N'){
    for(let k=0;k<n;k++) P.push(C((k-(n-1)/2)*2.54,0,1.7));
  }
  else if(name==='排针 2×N'){
    for(let k=0;k<n;k++)for(const dy of [-1.27,1.27]) P.push(C((k-(n-1)/2)*2.54,dy,1.7));
  }
  else throw new Error('未知封装：'+name);
  return P;
}

/* ---------- Specctra DSN 导出 / SES 回读（与 Freerouting 互通）----------
   语法依据 freerouting-master\io\specctra 源码逐行核实（DsnReader/SesReader/SesWriter）：
   - DSN 坐标以 (resolution um 10) 声明、数值直接写 µm；
   - SES 数值 = 板内部坐标/R = DSN 数值 × R（mm = SES / R / 1000）；
   - SES 只认 (wire (path 层 宽 x y ...))，via 需落在整数板坐标；
   - net 引用 pin 的格式为 "元件名-引脚名"（按第一个 - 拆分）。
   工作流：本工具导出 DSN → Freerouting 布线 → 回读 SES 成手动走线 →
   铺铜 / DRC / 导出 Gerber。 */
const _DSN_LAYER_NAMES = L => Array.from({length: L}, (_, i) =>
  i === 0 ? 'Top' : (i === L - 1 && L > 1 ? 'Bottom' : 'In' + i));
const _dsnEsc = s => /[-_(\s;{}~]/.test(s) || /^\d/.test(s) ? '"' + s + '"' : s;
/* ---------- IPC-D-356A 裸板测试网表导出（RTF2 附录3：交付件增加电测网表） ----------
   格式逐列对齐真实样例（artwork.com 公开样例记录）：
   · 记录 55 字符：317=带孔径（插件/过孔，D0000~9999 = 0.0001" 单位 4 位）、327=表贴
   · 4-17 列 网名（14 字符，数字开头需 + 前缀）；19-28 列 组件（refdes 左对齐 6 + "-引脚" 4；VIA 无引脚）
   · 317: 31-35 D孔径 36-39 PA00（镀通双面可达）；327: 37-39 A<层>（A01 顶层 / A0L 底层）
   · 40-55 坐标 X±6 位/Y±6 位，单位 0.0001 英寸；原点左下、Y 向上（与 pos.csv 同约定）
   · P 参数头（JOB/UNITS/VER/IMAGE）+ 999 结束记录
   超出 6 位坐标（单坐标 >2540mm）时如实报错——换毫公制口径是路线图项。 */
function exportIPC356(design, result){
  const L=design.layers||2;
  const UNITS=mm=>{ const u=Math.round(mm/25.4*10000); if(Math.abs(u)>999999) throw new Error('IPC-356: 坐标超出 0.0001 英寸 6 位字段（单坐标 >2540mm），毫公制口径待支持'); return u; };
  const fmtC=(axis,v)=>axis+(v>=0?'+':'-')+String(Math.abs(v)).padStart(6,'0');
  const net14=n=>{ let s=String(n).slice(0,14); if(/[0-9]/.test(s[0])) s='+'+s.slice(0,13); return s.padEnd(15,' '); };
  const comp10=(ref,pin)=> (String(ref).slice(0,6).padEnd(6,' ')+((pin!=null)?('-'+pin).slice(0,4).padEnd(4,' '):'    ').slice(0,4)).padEnd(10,' ');
  const rec=(type,net,comp,tail)=> (type+net14(net)+comp10(comp.comp,comp.pin)+tail).slice(0,60);
  const yUp=mm=>UNITS(design.height-mm);
  const lines=[];
  lines.push('C  IPC-D-356A bare-board test netlist');
  lines.push('C  origin bottom-left, Y up; units 0.0001 inch');
  lines.push('P  JOB   PCB-AUTOROUTER');
  lines.push('P  UNITS CUST 0');
  lines.push('P  VER IPC-D-356A');
  lines.push('P  IMAGE PRIMARY');
  const nets=[...(design.nets||[])].sort((a,b)=>String(a.name).localeCompare(String(b.name)));
  const viaRecs=[];
  for(const n of nets){
    const pads=(design.pads||[]).filter(p=>p.netId===n.id);
    const drillRadius=p=>p.layer==='both'?(p.holeR??design.viaDrill/2):0;
    const th=pads.filter(p=>drillRadius(p)>0);
    const smd=pads.filter(p=>!(drillRadius(p)>0));
    for(const p of th){
      const hole=Math.round(drillRadius(p)*2/25.4*10000);
      lines.push(rec('317',n.name,{comp:p.id.split('-')[0],pin:p.id.split('-')[1]},
        '  D'+String(hole).padStart(4,'0')+'PA00'+fmtC("X",UNITS(p.x))+fmtC("Y",yUp(p.y))).slice(0,55));
    }
    for(const p of smd){
      const lay=p.layer==='bottom'?('A0'+L):'A01';
      lines.push(rec('327',n.name,{comp:p.id.split('-')[0],pin:p.id.split('-')[1]},
        '        '+lay+fmtC("X",UNITS(p.x))+fmtC("Y",yUp(p.y))).slice(0,55));
    }
    // 过孔：result 走线过孔 + 缝合孔，记 VIA 孔位
    if(result&&result.nets) for(const rn of result.nets) if(rn.netId===n.id)
      for(const v of (rn.vias||[])) viaRecs.push({net:n.name,x:v.x,y:v.y,hole:design.viaDrill});
    for(const s of (design.stitching||[])) if(s.netId===n.id) viaRecs.push({net:n.name,x:s.x,y:s.y,hole:design.viaDrill});
  }
  for(const v of viaRecs){
    const hole=Math.round((v.hole||design.viaDrill*2)/25.4*10000);
    lines.push(rec('317',v.net,{comp:'VIA',pin:null},
      '  D'+String(hole).padStart(4,'0')+'PA00'+fmtC("X",UNITS(v.x))+fmtC("Y",yUp(v.y))).slice(0,55));
  }
  lines.push('999');
  return lines.join('\n')+'\n';
}

function exportDSN(design){
  const L = Math.max(1, design.layers|0);
  const names = _DSN_LAYER_NAMES(L);
  const um = v => Math.round(v * 1000);
  const out = [];
  out.push('(pcb "' + (design.name || 'design') + '.dsn"');
  out.push('  (parser (string_quote ") (space_in_quoted_tokens on) (host_cad "PCB自动布线工具"))');
  out.push('  (resolution um 10)');
  out.push('  (unit um)');
  out.push('  (structure');
  for(const nm of names) out.push('    (layer ' + _dsnEsc(nm) + ' (type signal))');
  out.push('    (boundary (path pcb 0 ' + um(0) + ' ' + um(0) + ' ' + um(design.width) + ' ' + um(0) +
           ' ' + um(design.width) + ' ' + um(design.height) + ' ' + um(0) + ' ' + um(design.height) +
           ' ' + um(0) + ' ' + um(0) + '))');
  out.push('    (via VIA_DEFAULT)');
  out.push('    (rule (width ' + um(design.trackW) + ') (clearance ' + um(design.clearance) + '))');
  out.push('  )');
  // 封装分组：焊盘 id "U1-3" → 元件 U1 / 引脚 3；无 "-" 的独立成元件
  const comps = new Map();   // compName -> [{pad, pinName}]
  for(const p of design.pads){
    const i = p.id.lastIndexOf('-');
    const comp = i > 0 ? p.id.slice(0, i) : p.id;
    const pin = i > 0 ? p.id.slice(i + 1) : '1';
    if(!comps.has(comp)) comps.set(comp, []);
    comps.get(comp).push({p, pin});
  }
  // padstack 去重：按 形状/尺寸/层 签名
  const stackDefs = new Map();   // 签名 -> 名字
  const stackOf = p => {
    const kind = p.shape === 'circle' ? 'C' : (p.layer === 'both' ? 'TC' : 'S');
    const sig = kind + '_' + um(p.w) + '_' + um(p.layer === 'circle' ? p.w : p.h);
    if(!stackDefs.has(sig)){
      const nm = 'PAD_' + stackDefs.size;
      let body;
      if(p.shape === 'circle')
        body = '      (shape (circle signal ' + um(p.w) + '))';
      else if(p.layer === 'both')
        body = '      (shape (rect signal ' + um(-p.w/2) + ' ' + um(-p.h/2) + ' ' + um(p.w/2) + ' ' + um(p.h/2) + '))';
      else{
        const ln = p.layer === 'bottom' ? 'Bottom' : 'Top';
        body = '      (shape (rect ' + ln + ' ' + um(-p.w/2) + ' ' + um(-p.h/2) + ' ' + um(p.w/2) + ' ' + um(p.h/2) + '))';
      }
      stackDefs.set(sig, {name:nm, body});
    }
    return stackDefs.get(sig).name;
  };
  out.push('  (placement');
  for(const [comp, pins] of comps){
    out.push('    (component ' + _dsnEsc(comp));
    out.push('      (place ' + _dsnEsc(comp) + ' 0 0 front 0)');
    out.push('    )');
  }
  out.push('  )');
  out.push('  (library');
  const usedStacks = new Set();
  for(const [comp, pins] of comps){
    out.push('    (image ' + _dsnEsc(comp));
    for(const {p, pin} of pins){
      const sn = stackOf(p);
      usedStacks.add(sn);
      out.push('      (pin ' + _dsnEsc(sn) + ' ' + _dsnEsc(pin) + ' ' + um(p.x) + ' ' + um(p.y) + ')');
    }
    out.push('    )');
  }
  for(const [, def] of stackDefs){
    if(!usedStacks.has(def.name)) continue;
    out.push('    (padstack ' + def.name);
    out.push(def.body);
    out.push('      (attach off)');
    out.push('    )');
  }
  out.push('    (padstack VIA_DEFAULT');
  out.push('      (shape (circle signal ' + um(design.viaOuter) + '))');
  out.push('      (attach off)');
  out.push('    )');
  out.push('  )');
  out.push('  (network');
  const pinIndex = new Map();
  for(const [comp, pins] of comps) for(const {p, pin} of pins) pinIndex.set(p.id, comp + '-' + pin);
  for(const n of design.nets){
    const pins = design.pads.filter(p => p.netId === n.id).map(p => pinIndex.get(p.id)).filter(Boolean);
    out.push('    (net ' + _dsnEsc(n.name) + ' 1');
    if(pins.length) out.push('      (pins ' + pins.join(' ') + ')');
    if(n.w && Math.abs(n.w-design.trackW)>1e-9) out.push('      (rule (width ' + um(n.w) + '))');
    out.push('    )');
  }
  out.push('  )');
  // 已有约束：手动走线 + 缝合孔写成 wiring（Freerouting 导入后视为固定）
  const wiring = [];
  for(const m of design.manual || []){
    const pts = m.pts.filter((pt, k) => k === 0 || Math.hypot(pt.x - m.pts[k-1].x, pt.y - m.pts[k-1].y) > 1e-9);
    if(pts.length < 2) continue;
    // 换层处拆成多条单层 wire（SES/DSN 的 path 是单层的）
    let seg = [pts[0]];
    for(let k = 1; k < pts.length; k++){
      if(pts[k].l !== pts[k-1].l){
        if(seg.length > 1) wiring.push({l: seg[0].l, pts: seg});
        seg = [pts[k]];
      } else seg.push(pts[k]);
    }
    if(seg.length > 1) wiring.push({l: seg[0].l, pts: seg});
  }
  if(wiring.length || (design.stitching || []).length){
    out.push('  (wiring');
    for(const w of wiring)
      out.push('    (wire (path ' + _dsnEsc(names[Math.min(w.l, L-1)]) + ' ' + um(netW(design, w.netId)) + ' ' +
               w.pts.map(pt => um(pt.x) + ' ' + um(pt.y)).join(' ') + ') (net ' + _dsnEsc((design.nets.find(n => n.id === w.netId) || {}).name || '') + ' 1) (type fix))');
    for(const s of design.stitching || []){
      const nm = (design.nets.find(n => n.id === s.netId) || {}).name;
      if(nm) out.push('    (via VIA_DEFAULT ' + um(s.x) + ' ' + um(s.y) + ' (net ' + _dsnEsc(nm) + ' 1) (type fix))');
    }
    out.push('  )');
  }
  out.push(')');
  return out.join('\n');
}

// 解析 SES：返回 {entries:[{netId, pts:[{x,y,l}]}], vias:n, errors:[...]}（via 已合并进折线换层点）
function importSES(text, design){
  // string_quote 自指修复（同 importDSN：Freerouting/KiCad 的 SES 可能带 `(string_quote ")`）
  const root = parseSexpr(String(text).replace(/\(string_quote "\)/,'(string_quote "")'));
  if(!root || root[0] !== 'session') throw new Error('不是 SES 文件（缺少 session 头）');
  const routes = root.find(n => Array.isArray(n) && n[0] === 'routes');
  if(!routes) throw new Error('SES 中没有 routes');
  // 单位与分辨率 → 换算系数（mm = v / R * unitToMm）
  const res = routes.find(n => Array.isArray(n) && n[0] === 'resolution');
  let R = 10, unit = 'um';
  if(res){
    unit = String(res[1]).toLowerCase();
    R = parseFloat(res[2]) || 1;
  }
  const unitToMm = {um:0.001, mm:1, mil:0.0254, inch:25.4}[unit];
  if(!unitToMm) throw new Error('不支持的单位：' + unit);
  const toMM = v => (parseFloat(v) / R) * unitToMm;
  const L = Math.max(1, design.layers|0);
  const names = _DSN_LAYER_NAMES(L);
  const layerOf = nm => {
    const s = String(nm);
    let i = names.indexOf(s);
    if(i >= 0) return i;
    if(/top/i.test(s)) return 0;
    if(/bottom/i.test(s)) return L - 1;
    if(/in(\d+)/i.test(s)) return Math.min(L - 1, parseInt(RegExp.$1) || 1);
    return -1;
  };
  const netOut = routes.find(n => Array.isArray(n) && n[0] === 'network_out');
  if(!netOut) throw new Error('SES 中没有 network_out');
  const errors = [];
  const entries = [];
  let viaCount = 0;
  for(const nn of netOut){
    if(!Array.isArray(nn) || nn[0] !== 'net') continue;
    // 网名可能带引号（Freerouting 对含下划线/特殊字符的网名加引号——parseSexpr 返回 {str} 对象）
    const netName = (nn[1]&&typeof nn[1]==='object'&&nn[1].str!==undefined)?nn[1].str:String(nn[1]);
    const net = design.nets.find(n => n.name === netName);
    if(!net){ errors.push('未知网络 ' + netName); continue; }
    // 收集该网的 wire（分段折线）与 via
    const wires = [];   // {l, pts:[{x,y}]}
    const vias = [];    // {x,y}
    for(const item of nn){
      if(!Array.isArray(item)) continue;
      if(item[0] === 'wire'){
        const path = item.find(c => Array.isArray(c) && (c[0] === 'path' || c[0] === 'polyline_path'));
        if(!path) continue;                       // 铜皮型 wire 跳过
        const li = layerOf(path[1]);
        if(li < 0){ errors.push('未知层 ' + path[1]); continue; }
        const vals = path.slice(3).map(parseFloat);
        const pts = [];
        for(let k = 0; k + 1 < vals.length; k += 2)
          pts.push({x:+toMM(vals[k]).toFixed(4), y:+toMM(vals[k+1]).toFixed(4), l:li});
        if(pts.length >= 2) wires.push({l:li, pts});
      } else if(item[0] === 'via'){
        const x = toMM(item[2]), y = toMM(item[3]);
        if(isFinite(x) && isFinite(y)) vias.push({x:+x.toFixed(4), y:+y.toFixed(4)});
      }
    }
    // via 合并：端点重合的两条 wire 接成一条折线（换层点即过孔）
    const used = new Array(wires.length).fill(false);
    for(const v of vias){
      let a = -1, b = -1;
      for(let i = 0; i < wires.length && b < 0; i++){
        if(used[i]) continue;
        for(const [end, other] of [[wires[i].pts[0], wires[i].pts[wires[i].pts.length-1]], [wires[i].pts[wires[i].pts.length-1], wires[i].pts[0]]]){
          if(Math.hypot(end.x - v.x, end.y - v.y) < 0.02){
            if(a < 0){ a = i; }
            else { b = i; break; }
          }
        }
      }
      if(a >= 0 && b >= 0){
        const wa = wires[a], wb = wires[b];
        used[b] = true; viaCount++;   // wb 并入 wa；wa 保持可用，继续参与后续合并与输出
        if(wa.pts[wa.pts.length-1].x !== v.x || wa.pts[wa.pts.length-1].y !== v.y) wa.pts.reverse();
        if(wb.pts[0].x !== v.x || wb.pts[0].y !== v.y) wb.pts.reverse();
        wa.pts.push({x:v.x, y:v.y, l:wb.l});   // 换层点 = 过孔
        for(const p of wb.pts){
          const q = wa.pts[wa.pts.length-1];
          if(Math.abs(p.x-q.x) < 1e-9 && Math.abs(p.y-q.y) < 1e-9 && p.l === q.l) continue;  // 去重
          wa.pts.push({x:p.x, y:p.y, l:p.l});
        }
      }
    }
    for(let i = 0; i < wires.length; i++){
      if(used[i]) continue;
      entries.push({netId: net.id, pts: wires[i].pts.map(p => ({x:p.x, y:p.y, l:(p.l != null ? p.l : wires[i].l)}))});
    }
  }
  return {entries, vias:viaCount, errors};
}

/* ---------- Specctra DSN 导入（roadmap #7：KiCad 内一键布线的入口半边）----------
   解析两种 dialect：
   - 本工具 exportDSN：place 名==image 名且 place 在 (0,0,0)——pin 坐标即板坐标（恒等变换自然覆盖）
   - KiCad pcbnew ExportSpecctraDSN：image=封装名、place=位号在板坐标+旋转——pin 为封装本地
     坐标，板坐标 = 旋转(rot) + place 位置（统一公式两种方言都对）
   back 元件：DSN 惯例 pin 本地坐标在导出侧已镜像（坐标系不翻、padstack 层翻）——
   pin 板坐标公式不变，padstack 层归属 Top/Bottom 决定焊盘层。
   支持元素：resolution/unit、structure(layer/boundary/via/rule)、placement/component/place、
   library/image/pin/padstack(shape rect|circle 的 Top/Bottom/signal 层)、network/net/pins/rule。
   不导入：wiring（DSN 是布前网表；已有走线走 SES 通路——本工具 exportDSN 的 (wiring) 是
   给 Freerouting 的固定约束，导入侧丢弃不影响接力场景）、regions/keepouts（DSN 表达力
   远超本模型，如实跳过）。 */
function importDSN(dsnText){
  // string_quote 自指坑位（docs/Freerouting源码研读.md 第二轮）：`(string_quote ")`
  // 的引号字符就是字面值本身——通用 S 表达式解析器会把后续全文吞进未闭合字符串
  // （Freerouting reader 对此特判）。把该构造替换为空串字面值即可整体修复词法。
  const root=parseSexpr(String(dsnText).replace(/\(string_quote "\)/,'(string_quote "")'));
  if(!root||_sxHead(root)!=='pcb') throw new Error('不是 Specctra DSN 文件（缺少 pcb 头）');
  const design=designDefaults();
  const sxStr=v=>(v&&typeof v==='object'&&v.str!==undefined)?v.str:String(v);
  const _headMatch=String(dsnText).match(/\(pcb\s+"([^"]*)"/);   // pcb 头的引号串（含未转义反斜杠路径）
  design.name=(_headMatch?_headMatch[1]:sxStr(root[1]||'design')).replace(/\\/g,'/').split('/').pop().replace(/\.dsn$/i,'') || 'design';   // 原始文本提取（KiCad 10 写完整未转义路径；parseSexpr 的 Specctra 转义会吃掉反斜杠——basename 不得依赖它）
  design.dsnLayers=null;   // structure 解析后填充（exportSES 回用时层名须与 DSN 一致，KiCad 10 实测）
  const parser=_sxChild(root,'parser');
  let unit='um', hostCad='';
  if(parser){
    const res=_sxChild(parser,'resolution');
    if(res) unit=sxStr(res[1]).toLowerCase();
    const hc=_sxChild(parser,'host_cad');
    if(hc) hostCad=sxStr(hc[1]);
  }
  const unitToMm={um:0.001,mm:1,mil:0.0254,inch:25.4}[unit];
  if(!unitToMm) throw new Error('不支持的 DSN 单位：'+unit);
  const structure=_sxChild(root,'structure');
  if(!structure) throw new Error('DSN 缺少 structure');
  const library=_sxChild(root,'library');
  // 层：signal 类型层序列 → 层数（≥2；KiCad 4 层导 Top/In1/In2/Bottom）
  const sigLayers=_sxFind(structure,'layer').filter(l=>{
    const t=_sxChild(l,'type'); return !t||sxStr(t[1])==='signal';
  }).map(l=>sxStr(l[1]));
  if(sigLayers.length<1) throw new Error('DSN structure 中没有 signal 层');
  const L=Math.max(2, sigLayers.length);
  design.layers=(L===1||L===2||L===4)?L:4;
  design.dsnLayers=sigLayers.map(x=>String(x));
  // ---- 刻度自适应（两种 dialect 差 10×）----
  // 本工具 exportDSN 与 Freerouting 实样（Issue026 交叉验证，docs/研读 line128）：
  //   raw=µm（mm×1000）；KiCad pcbnew ExportSpecctraDSN：raw=0.1µm（mm×10000，
  //   内部 nm/100）。host_cad 直接识别；否则按「典型尺寸合理性」打分——焊盘/
  //   过孔/线宽/间距落在 [0.05,2.5]mm 者得分（µm 口径全中，0.1µm 口径全偏小 10×）。
  let F=1000;
  {
    // 刻度判定全靠典型尺寸合理性打分（KiCad 10 实测教训：host_cad="KiCad's
    // Pcbnew" 但刻度是 µm 口径——host 字符串与刻度无可靠绑定，不能短路）
    const sizes=[];
    if(library) for(const ps of _sxFind(library,'padstack')){
      const shp=_sxChild(ps,'shape');
      const cir=shp&&_sxChild(shp,'circle');
      const rect=shp&&_sxChild(shp,'rect');
      if(cir) sizes.push(_sxNum(cir[2],0));
      else if(rect) sizes.push(_sxNum(rect[4],0)-_sxNum(rect[2],0));
    }
    for(const r of _sxFind(structure,'rule')){
      const w=_sxChild(r,'width'); if(w) sizes.push(_sxNum(w[1],0));
      const c=_sxChild(r,'clearance'); if(c) sizes.push(_sxNum(c[1],0));
    }
    const judge=mm=>mm>=0.05&&mm<=2.5?1:0;
    let s1=0, s2=0;
    for(const raw of sizes) if(isFinite(raw)&&raw>0){ s1+=judge(raw/1000); s2+=judge(raw/10000); }   // raw/1000=µm口径的mm、raw/10000=0.1µm口径的mm
    if(s2>s1) F=10000;
  }
  const toMM=v=>_sxNum(v,0)*unitToMm*1000/F;   // F=1000: raw×0.001（µm）；F=10000: raw×0.0001（0.1µm）
  // 板框：boundary path/rect 的包围盒
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(const b of _sxFind(structure,'boundary')){
    for(const p of _sxFind(b,'path')){
      const vals=p.slice(3).map(toMM).filter(Number.isFinite);   // (path 层 线宽 x y ...)——p[2] 是线宽
      for(let k=0;k+1<vals.length;k+=2){
        x0=Math.min(x0,vals[k]); y0=Math.min(y0,vals[k+1]);
        x1=Math.max(x1,vals[k]); y1=Math.max(y1,vals[k+1]);
      }
    }
    for(const rc of _sxFind(b,'rect')){
      if(rc.length>=5){
        const a=toMM(rc[1]),b2=toMM(rc[2]),c=toMM(rc[3]),d2=toMM(rc[4]);
        x0=Math.min(x0,a,c); y0=Math.min(y0,b2,d2); x1=Math.max(x1,a,c); y1=Math.max(y1,b2,d2);
      }
    }
  }
  if(!isFinite(x0)) throw new Error('DSN structure 中没有 boundary（板框）');
  design.width=+((x1-x0).toFixed(3)); design.height=+((y1-y0).toFixed(3));
  if(!(design.width>0&&design.height>0)) throw new Error('DSN 板幅无效（'+design.width+'×'+design.height+'mm）');
  const ox=x0, oy=y0;   // 平移到 (0,0)
  for(const r of _sxFind(structure,'rule')){
    const w=_sxChild(r,'width'); if(w) design.trackW=+toMM(w[1]).toFixed(4);
    const c=_sxChild(r,'clearance'); if(c) design.clearance=+toMM(c[1]).toFixed(4);
  }
  // padstack：名 → {shape, w, h, layer}（mm）
  const stackInfo=new Map();
  if(library) for(const ps of _sxFind(library,'padstack')){
    const nm=sxStr(ps[1]);
    const shp=_sxChild(ps,'shape');
    if(!shp) continue;
    const cir=_sxChild(shp,'circle');
    if(cir){
      const d=Math.max(toMM(cir[2]),0.1);
      stackInfo.set(nm,{shape:'circle', w:d, h:d, layer:'both'});
      continue;
    }
    const rect=_sxChild(shp,'rect');
    if(rect&&rect.length>=6){
      const a=toMM(rect[2]),b2=toMM(rect[3]),c=toMM(rect[4]),d2=toMM(rect[5]);   // (rect 层 x1 y1 x2 y2)
      const ln=sxStr(rect[1]).toLowerCase();
      stackInfo.set(nm,{shape:'rect', w:Math.max(c-a,0.1), h:Math.max(d2-b2,0.1),
        layer:ln==='top'?'top':(ln==='bottom'?'bottom':'both')});
    }
  }
  // 过孔 padstack：structure (via <名>) → library 定义外径
  const viaRef=_sxChild(structure,'via');
  if(viaRef){
    for(const nm of viaRef.slice(1)){
      const st=stackInfo.get(sxStr(nm));
      if(st&&st.shape==='circle'){
        design.viaOuter=+st.w.toFixed(4);
        design.viaDrill=+Math.min(st.w/2,design.viaOuter).toFixed(4);
        break;
      }
    }
  }
  // image：封装名 → pin 列表（本地坐标 raw，后统一换算）
  const images=new Map();
  if(library) for(const img of _sxFind(library,'image')){
    const pins=[];
    for(const pin of _sxFind(img,'pin')){
      if(pin.length<5) continue;
      pins.push({stack:sxStr(pin[1]), pinName:sxStr(pin[2]), x:_sxNum(pin[3],0), y:_sxNum(pin[4],0)});
    }
    images.set(sxStr(img[1]),pins);
  }
  // placement：place 位号 → {image, x, y(raw), side, rot}
  const places=new Map();
  const placement=_sxChild(root,'placement');
  if(placement) for(const comp of _sxFind(placement,'component')){
    const img=sxStr(comp[1]);
    for(const pl of _sxFind(comp,'place')){
      const ref=sxStr(pl[1]);
      const side=pl[4]!==undefined?sxStr(pl[4]).toLowerCase():'front';
      places.set(ref,{image:img, x:_sxNum(pl[2],0), y:_sxNum(pl[3],0), side, rot:pl[5]!==undefined?_sxNum(pl[5],0):0});
    }
  }
  // network：net 名 → pin 引用集合（"ref-pin"）+ 每网线宽
  const network=_sxChild(root,'network');
  const netPinNames=new Map();
  const netWidths=[];
  if(network) for(const nn of _sxFind(network,'net')){
    const nm=sxStr(nn[1]);
    const set=new Set();
    for(const pk of _sxFind(nn,'pins')) for(const tok of pk.slice(1)) set.add(sxStr(tok));
    netPinNames.set(nm,set);
    const r=_sxChild(nn,'rule');
    if(r){ const w=_sxChild(r,'width'); if(w) netWidths.push({name:nm, w:toMM(w[1])}); }
  }
  // 焊盘实例：统一公式 板坐标 = rotate(pin 本地, place.rot) + place 位置
  //（本工具方言 place=(0,0,0) 恒等；KiCad 方言 place=板坐标+旋转。back 元件的
  // pin 本地坐标按 DSN 惯例导出侧已镜像，此处不再翻转）
  const netIds=new Map();
  const getNetId=name=>{
    if(!netIds.has(name)){ const id='d'+(netIds.size+1); design.nets.push({id, name}); netIds.set(name,id); }
    return netIds.get(name);
  };
  const used=new Set();
  for(const [ref,pl] of places){
    const pins=images.get(pl.image)||[];
    const rr=pl.rot*Math.PI/180, cr=Math.cos(rr), sr=Math.sin(rr);
    const px=toMM(pl.x), py=toMM(pl.y);
    for(const pin of pins){
      const lx=toMM(pin.x), ly=toMM(pin.y);
      const wx=lx*cr-ly*sr+px, wy=lx*sr+ly*cr+py;
      const st=stackInfo.get(pin.stack)||{shape:'rect', w:0.6, h:0.3, layer:pl.side==='back'?'bottom':'top'};
      let layer=st.layer;
      if(pl.side==='back'&&layer!=='both') layer='bottom';
      const id=ref+'-'+pin.pinName;
      let pid=id;
      for(let k=1;used.has(pid);k++) pid=id+String.fromCharCode(96+k);
      used.add(pid);
      const nmKey=ref+'-'+pin.pinName;
      let netName='';
      for(const [nm,set] of netPinNames) if(set.has(nmKey)){ netName=nm; break; }
      design.pads.push({id:pid, x:+(wx-ox).toFixed(4), y:+(wy-oy).toFixed(4),
        w:+st.w.toFixed(4), h:+st.h.toFixed(4),
        shape:st.shape==='circle'?'circle':'rect', layer,
        netId:netName?getNetId(netName):null});
    }
  }
  // 删无焊盘网 + 每网线宽
  const usedNets=new Set(design.pads.map(p=>p.netId).filter(Boolean));
  design.nets=design.nets.filter(n=>usedNets.has(n.id));
  for(const nw of netWidths){
    const n=design.nets.find(x=>x.name===nw.name);
    if(n&&Math.abs(nw.w-design.trackW)>1e-9) n.w=+nw.w.toFixed(4);
  }
  design.external=true;
  return design;
}

/* ---------- Specctra SES 导出（roadmap #7：布线结果回 KiCad 的出口半边）----------
   与 importSES 对称（本项目的 SES 解析器即正确性锚点）：network_out 逐网 wire
   （换层拆单层 run）+ via；resolution um 10 与 exportDSN 同尺。KiCad pcbnew
   ImportSpecctraSES 可直接回读。 */
function exportSES(design, result){
  const L=Math.max(1, design.layers|0);
  // 层名：DSN 导入板携带原始层名（KiCad 10 的 F.Cu/B.Cu——SES 层名须与 DSN 一致
  // 否则 ImportSpecctraSES 拒绝）；自产板/EasyEDA 板用 Top/In/Bottom 惯例
  const names=(Array.isArray(design.dsnLayers)&&design.dsnLayers.length>=L)?design.dsnLayers:_DSN_LAYER_NAMES(L);
  // SES 数值刻度 = DSN×R = mm×10000（resolution um 10 的 0.1µm 单位；Issue026 实样
  // 交叉验证 DSN 250 ↔ SES 2500——与 importSES 的 v/R×0.001 对称）
  const um=v=>Math.round(v*10000);
  const out=[];
  const base=(design.name||'design').replace(/\.dsn$/i,'');
  // 结构对齐 Freerouting SesWriter / KiCad 10 ImportSpecctraSES 真机实测（0.11.3）：
  // base_design（下划线非驼峰）、placement 段含 resolution、routes 内必须带
  // library_out（via padstack 形状定义——缺失则 KiCad 静默拒绝）、via 行 padstack
  // 名带引号。
  out.push('(session '+_dsnEsc(base)+'.ses');
  out.push('  (base_design '+_dsnEsc(base)+'.dsn)');
  out.push('  (placement');
  out.push('    (resolution um 10)');
  out.push('  )');
  out.push('  (routes');
  out.push('    (resolution um 10)');
  out.push('    (parser (string_quote ") (space_in_quoted_tokens on))');   // KiCad 同款自指引号（importSES 有词法修复）
  out.push('    (library_out');
  out.push('      (padstack ' + _dsnEsc('VIA_DEFAULT'));
  for(const nm of names.slice(0, L))
    out.push('        (shape (circle '+_dsnEsc(nm)+' '+um(design.viaOuter)+' 0 0))');
  out.push('      )');
  out.push('    )');   // library_out 闭合（0.11.3 真机实测：缺失则 KiCad 括号不配平静默拒绝）
  out.push('    (network_out');
  const merged=[...((result&&result.nets)||[])];
  for(const n of merged){
    const nm=(design.nets.find(x=>x.id===n.netId)||{}).name||'';
    if(!nm) continue;
    const items=[];
    for(const path of (n.paths||[])){
      let run=[path[0]];
      for(let k=1;k<path.length;k++){
        if(path[k].l===path[k-1].l) run.push(path[k]);
        else{
          if(run.length>1) items.push({type:'wire', l:run[0].l, pts:run});
          run=[path[k]];
        }
      }
      if(run.length>1) items.push({type:'wire', l:run[0].l, pts:run});
    }
    for(const v of (n.vias||[])) items.push({type:'via', x:v.x, y:v.y});
    if(!items.length) continue;
    out.push('      (net '+_dsnEsc(nm));
    for(const it of items){
      if(it.type==='wire')
        out.push('        (wire (path '+_dsnEsc(names[Math.min(it.l,L-1)])+' '+um(netW(design,n.netId))+' '+
          it.pts.map(pt=>um(pt.x)+' '+um(pt.y)).join(' ')+'))');
      else
        out.push('        (via '+_dsnEsc('VIA_DEFAULT')+' '+um(it.x)+' '+um(it.y)+' )');
    }
    out.push('      )');
  }
  out.push('    )');
  out.push('  )');
  // 无 (nets ...) 尾行——KiCad 10 ImportSpecctraSES 因它静默拒绝（真机实测 0.11.3；
  // Freerouting SesWriter 也不写此行）
  out.push(')');
  return out.join('\n')+'\n';
}

/* ---------- 自动布局（模拟退火，连接代价比最小化）----------
   组件 = 焊盘 id 共享前缀（"U3-1"/"U3-2" 前缀 "U3"）；无 "-" 的焊盘各自成组。
   代价 = Σ(各网络焊盘中心两两曼哈顿距离，MST 代理) + 异组焊盘重叠/出板/禁布区重罚。
   退火收敛后整组平移并吸附栅格。借鉴 Konnect refine_placement_force_directed 与
   easyeda-agent "先布局后布线" 门禁：布局是布线质量的先决条件。
   返回 {before, after, groups, iterations}。 */
/* ---------- 自动布局 v2（模拟退火 + 元件旋转 + 布通率热点反馈）----------
   组件状态 = {x,y,rot}：rel 为入口时相对 bbox 中心的相对坐标（rot=0 基准）。
   rot∈{0,90,180,270}，奇数旋转交换焊盘有效宽高（写回 design.pads）。
   opts.hotspots=[{x0,y0,x1,y1,owners}] —— 布通率反馈（placeAndRoute 生成）：
   非属主组件的包围盒压到热点区即受罚，退火把"挡路者"推离拥塞走廊。
   opts.warmStart=true 从当前焊盘位置出发（反馈迭代第二轮起用）。 */
function autoPlace(design, opts){
  opts=opts||{};
  let rngState=(opts.seed??42)>>>0;
  const random=()=>{rngState=(Math.imul(rngState,1664525)+1013904223)>>>0;return rngState/4294967296;};
  const iters=opts.iterations!=null?opts.iterations:4000;
  const pads=design.pads||[];
  const _apCls=netClsMap(design);   // class keepout 罚分豁免（roadmap #10）
  if(pads.length<2) return {before:0, after:0, groups:0, iterations:0};
  const grid=design.grid;
  const groups=new Map();
  for(const p of pads){
    const i=p.id.lastIndexOf('-');
    const g=i>0?p.id.slice(0,i):p.id;
    if(!groups.has(g)) groups.set(g,[]);
    groups.get(g).push(p);
  }
  const comps=[...groups.entries()].map(([name,ps])=>{
    let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
    for(const p of ps){ x0=Math.min(x0,p.x-p.w/2); y0=Math.min(y0,p.y-p.h/2); x1=Math.max(x1,p.x+p.w/2); y1=Math.max(y1,p.y+p.h/2); }
    const cx=(x0+x1)/2, cy=(y0+y1)/2;
    return {name, ps, rel:ps.map(p=>({p, dx:p.x-cx, dy:p.y-cy, w:p.w, h:p.h})),
            x:cx, y:cy, rot:0, w:x1-x0, h:y1-y0};
  });
  // 锚定组件（opts.anchor=前缀数组）：位置与旋转锁定——晶振/去耦/连接器等
  // 需要 AI 把关布局的关键件；spec 位置即最终位置
  const anchorSet=new Set(opts.anchor||[]);
  const movable=comps.filter(c=>!anchorSet.has(c.name));
  const compOf=new Map();
  comps.forEach(c=>c.ps.forEach(p=>compOf.set(p,c)));
  const W=new Map();   // p -> {x,y,w,h}：变换后有效位置与尺寸（奇数旋转交换宽高）
  for(const p of pads) W.set(p,{x:p.x,y:p.y,w:p.w,h:p.h});
  const applyComp=c=>{
    const anchored=anchorSet.has(c.name);
    const cx=anchored?c.x:snapToGrid(c.x,grid),cy=anchored?c.y:snapToGrid(c.y,grid);
    for(const r of c.rel){
      let tx,ty,tw=r.w,th=r.h;
      if(c.rot===0){ tx=r.dx; ty=r.dy; }
      else if(c.rot===90){ tx=-r.dy; ty=r.dx; tw=r.h; th=r.w; }
      else if(c.rot===180){ tx=-r.dx; ty=-r.dy; }
      else { tx=r.dy; ty=-r.dx; tw=r.h; th=r.w; }
      if(r.p.shape==='circle'){ tw=r.w; th=r.w; }   // 圆形焊盘 w=直径，旋转不变
      const w=W.get(r.p);
      w.x=cx+tx; w.y=cy+ty; w.w=tw; w.h=th;
    }
    if(!anchored){
      let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
      for(const r of c.rel){const w=W.get(r.p);x0=Math.min(x0,w.x-w.w/2);y0=Math.min(y0,w.y-w.h/2);x1=Math.max(x1,w.x+w.w/2);y1=Math.max(y1,w.y+w.h/2);}
      let dx=Math.max(0,0.3-x0),dy=Math.max(0,0.3-y0);
      if(x1+dx>design.width-0.3)dx=design.width-0.3-x1;
      if(y1+dy>design.height-0.3)dy=design.height-0.3-y1;
      for(const r of c.rel){const w=W.get(r.p);w.x+=dx;w.y+=dy;}
    }
  };
  comps.forEach(applyComp);
  // 代价一律按"吸附+钳位后"的坐标评估（所见即所得），避免吸附量化制造碰撞
  // （深优 2026-11-14：原 SX/SY 闭包由 WA 活对象数组替代，见 cost() 前置改造）
  const hots=(opts.hotspots||[]).map(h=>({x0:h.x0,y0:h.y0,x1:h.x1,y1:h.y1,own:new Set(h.owners||[])}));
  const compBox=c=>{
    let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
    for(const r of c.rel){ const w=W.get(r.p);
      x0=Math.min(x0,w.x-w.w/2); y0=Math.min(y0,w.y-w.h/2); x1=Math.max(x1,w.x+w.w/2); y1=Math.max(y1,w.y+w.h/2); }
    return {x0,y0,x1,y1};
  };
  const byNet=new Map();
  for(let pi=0;pi<pads.length;pi++){
    const p=pads[pi];
    if(p.netId==null) continue;
    if(!byNet.has(p.netId)) byNet.set(p.netId,[]);
    byNet.get(p.netId).push(pi);
  }
  // 深优 2026-11-14：代价函数热点改造（位级一致——同一批 W 活对象、同一求和顺序，
  // 只消热循环里的 Map.get 与每步重复外提）：
  //  ① W.get 闭包 → 按焊盘下标的活对象数组 WA（W.set 的就是这些对象引用）
  //  ② maxTrackW(design) 出 cost() 外提（design.nets 布局期不变，纯函数值恒定）
  //  ③ dirBlk 缓冲外提复用（每步 fill(0)）
  const WA=pads.map(p=>W.get(p));
  const SXi=i=>WA[i].x, SYi=i=>WA[i].y;
  const _apKos=design.keepouts||[];
  const _apPocket=design.clearance+maxTrackW(design)/2+2*design.grid;
  const _apDirBlk=new Uint8Array(pads.length);   // bit0=N bit1=E bit2=S bit3=W
  // 贴边罚权重：固定 20000（第五轮 A/B：n51/n45 上 0/20000/自适应三档结果完全相同——
  // 有效成分是货架初始边距 1.5，梯度罚保留作防护，可用 opts.edgeWeight 覆盖）
  const edgeW=opts.edgeWeight!=null ? opts.edgeWeight : 20000;
  function cost(){
    let s=0;
    for(const [,idx] of byNet)
      for(let i=0;i<idx.length;i++)for(let j=i+1;j<idx.length;j++)
        s+=Math.abs(SXi(idx[i])-SXi(idx[j]))+Math.abs(SYi(idx[i])-SYi(idx[j]));
    for(let i=0;i<pads.length;i++)for(let j=i+1;j<pads.length;j++){
      const a=i,b=j;
      if(compOf.get(pads[a])===compOf.get(pads[b])) continue;
      const wa=WA[a], wb=WA[b];
      const ox=(wa.w+wb.w)/2-Math.abs(SXi(a)-SXi(b)), oy=(wa.h+wb.h)/2-Math.abs(SYi(a)-SYi(b));
      // 焊盘重叠 = 硬约束；常数下限 0.1 防止"恰好接触"时比例罚金归零（浮点边界教训）
      if(ox>0&&oy>0) s+=1000000*(0.1+Math.min(ox,oy));
      // 边缘间距罚：不重叠但铜边距 < clearance 同样违规（Q1 嵌进 U1 引脚间隙的教训）
      else if(Math.abs(SXi(a)-SXi(b))<(wa.w+wb.w)/2+design.clearance && Math.abs(SYi(a)-SYi(b))<(wa.h+wb.h)/2+design.clearance)
        s+=200000;
    }
    for(let pi=0;pi<pads.length;pi++){
      const p=pads[pi];
      const w=WA[pi];   // 出板检查用未钳位坐标：漂出板外必须受罚
      if(w.x-w.w/2<-0.01||w.x+w.w/2>design.width+0.01||w.y-w.h/2<-0.01||w.y+w.h/2>design.height+0.01) s+=100000;
      // 贴边梯度罚：焊盘边缘距板边 < 1.2mm 每毫米罚 edgeW——留出逃逸走廊
      // （纯线性梯度，不封死：连接器等贴边器件仍可由 spec 指定）
      // edgeW 默认按板密度自适应（第五轮 L9）：密板权重衰减（贴边走廊是小板的最后空间），
      // 疏板全额罚。opts.edgeWeight 可强制覆盖。
      { const dEdge=Math.min(w.x-w.w/2, design.width-(w.x+w.w/2), w.y-w.h/2, design.height-(w.y+w.h/2));
        if(dEdge<1.2) s+=edgeW*(1.2-dEdge); }
      const x=SXi(pi), y=SYi(pi);
      for(const k of _apKos){
        if(k.scope&&_apCls.get(p.netId)===k.scope) continue;   // class keepout 本类网焊盘自由
        if(Math.abs(x-k.x)<(k.w+w.w)/2 && Math.abs(y-k.y)<(k.h+w.h)/2) s+=100000;
      }
    }
    // 逃逸口袋检测（第六轮 n54/n59 教训）：焊盘 4 个正交方向全被堵 = 不可逃逸口袋——
    // 布局"合法"（无重叠/不出板/间距够）但布线必然 unreachable，参数/种子/锚定均不可救。
    // 判据与布线器一致：b 阻挡 a 的某正交方向 ⇔ 边距 < halfClr + 2*grid（影响区盖住逃逸格，恰界不算）；
    // 斜向不算独立方向（布线器斜向移动需两个正交格空闲，正交堵死则斜向不可用）。
    // 板边同判。空网焊盘可作阻挡者但不计罚（不参与布线）。罚 300000：高于线长项，低于重叠硬罚。
    {
      const pocketReach=_apPocket, dirBlk=_apDirBlk;
      dirBlk.fill(0);
      for(let i=0;i<pads.length;i++)for(let j=i+1;j<pads.length;j++){
        const a=pads[i],b=pads[j];
        if(a.netId!=null&&b.netId!=null&&a.netId===b.netId) continue;
        const wa=WA[i],wb=WA[j];
        const ax=Math.abs(SXi(j)-SXi(i))-(wa.w+wb.w)/2, ay=Math.abs(SYi(j)-SYi(i))-(wa.h+wb.h)/2;
        if(ax>=pocketReach&&ay>=pocketReach) continue;
        if(ax>ay){ if(SXi(j)>SXi(i)){dirBlk[i]|=2;dirBlk[j]|=8;}else{dirBlk[i]|=8;dirBlk[j]|=2;} }
        else if(ay>ax){ if(SYi(j)>SYi(i)){dirBlk[i]|=4;dirBlk[j]|=1;}else{dirBlk[i]|=1;dirBlk[j]|=4;} }
      }
      for(let i=0;i<pads.length;i++){
        const w=WA[i];
        if(w.x-w.w/2<pocketReach) dirBlk[i]|=8;
        else if(design.width-(w.x+w.w/2)<pocketReach) dirBlk[i]|=2;
        if(w.y-w.h/2<pocketReach) dirBlk[i]|=1;
        else if(design.height-(w.y+w.h/2)<pocketReach) dirBlk[i]|=4;
        if(dirBlk[i]===15&&pads[i].netId!=null) s+=300000;
      }
    }
    // 布通率热点：非属主组件压到拥塞区 → 罚（把挡路者推离拥塞走廊）。
    // 权重可调（opts.hotspotWeight）：过猛会把元件推离后制造新冲突，逐轮衰减更稳。
    const hw=opts.hotspotWeight!=null?opts.hotspotWeight:50000;
    if(hots.length&&hw>0) for(const c of movable){
      const b=compBox(c);
      for(const h of hots){
        if(h.own.has(c.name)) continue;
        const ox=Math.min(b.x1,h.x1)-Math.max(b.x0,h.x0), oy=Math.min(b.y1,h.y1)-Math.max(b.y0,h.y0);
        if(ox>0&&oy>0) s+=hw;
      }
    }
    return s;
  }
  const stateOf=()=>comps.map(c=>({x:c.x,y:c.y,rot:c.rot}));
  const setState=st=>{
    comps.forEach((c,i)=>{ c.x=st[i].x; c.y=st[i].y; c.rot=st[i].rot; });
    // Cost reads W, not component coordinates: restore both at every restart.
    comps.forEach(applyComp);
  };
  const initial=cost(), initialState=stateOf();
  // 初始排布：货架式装箱（FFDH）或 warmStart（反馈迭代第二轮起从当前位置出发）
  if(opts.warmStart){
    comps.forEach(applyComp);
  } else {
    const shelf=comps.slice().sort((a,b)=>Math.max(b.h,b.w)-Math.max(a.h,a.w));
    const margin=1.5, gap=1.5;   // 1.5：贴板边起排会饿死第一排引脚的逃逸走廊（n39 教训）
    const usableW=design.width-2*margin, usableH=design.height-2*margin;
    let curX=margin, curY=margin, rowH=0;
    for(const c of shelf){
      if(anchorSet.has(c.name)) continue;   // 锚定组件：spec 位置即最终位置
      if(curX+c.w>usableW+1e-9 && curX>margin){ curX=margin; curY+=rowH+gap; rowH=0; }
      c.x+=curX-(c.x-c.w/2); c.y+=curY-(c.y-c.h/2);
      applyComp(c);
      curX+=c.w+gap; rowH=Math.max(rowH,c.h);
    }
  }
  const syncComp=applyComp;
  // 多重启退火：移动（平移/旋转/交换）+ 栅格量化 + 字典序保留最优
  const shelfCost=cost();
  // A good imported placement is a candidate too; shelf initialization must not discard it.
  let gBest=Math.min(initial,shelfCost), gState=initial<=shelfCost?initialState:stateOf();
  const rowState=stateOf();
  const restarts=opts.restarts||4;
  for(let rs=0;rs<restarts;rs++){
    setState(rs===0?rowState:gState);
    let cur=cost(), best=cur, bestState=stateOf();
    let T=Math.max(1, design.width*0.4/(rs+1));
    for(let it=0;it<iters;it++){
      if(!movable.length) break;
      const c=movable[(random()*movable.length)|0];
      const x0=c.x, y0=c.y, r0=c.rot;
      let swapped=null, sx0=0, sy0=0, sr0=0;
      const dice=random();
      if(dice<0.10 && movable.length>1){
        const d=movable[(random()*movable.length)|0];
        if(d!==c){ swapped=d; sx0=d.x; sy0=d.y; sr0=d.rot;
          const tx=d.x,ty=d.y,tr=d.rot; d.x=c.x; d.y=c.y; d.rot=c.rot; c.x=tx; c.y=ty; c.rot=tr; }
      } else if(dice<0.22){
        c.rot=(c.rot+90)%360;                                    // 旋转 90°
      } else {
        c.x+=(random()*2-1)*design.width*0.15;
        c.y+=(random()*2-1)*design.height*0.15;
      }
      c.x=Math.round(c.x/grid)*grid; c.y=Math.round(c.y/grid)*grid;   // 量化：所见即所得
      if(swapped){ swapped.x=Math.round(swapped.x/grid)*grid; swapped.y=Math.round(swapped.y/grid)*grid; }
      applyComp(c); if(swapped) applyComp(swapped);
      const nc=cost();
      if(nc<=cur || random()<Math.exp((cur-nc)/Math.max(T,1e-6))){
        cur=nc;
        if(cur<best){ best=cur; bestState=stateOf(); }
      } else {
        c.x=x0; c.y=y0; c.rot=r0;
        if(swapped){ swapped.x=sx0; swapped.y=sy0; swapped.rot=sr0; }   // 被拒：两组都要还原
        applyComp(c); if(swapped) applyComp(swapped);
      }
      T*=0.999;
    }
    if(best<gBest){ gBest=best; gState=bestState; }
  }
  setState(gState);
  comps.forEach(applyComp);
  // 应用：吸附栅格 + 板边余量 0.3mm（嘉立创 DFM 建议 0.3~0.5）+ 写回有效宽高（旋转）
  const EM=0.3;
  for(const c of comps) for(const r of c.rel){
    // Anchors are exact constraints, not merely exempt from annealing moves.
    // Preserve imported precision instead of quantizing locked pads on writeback.
    if(anchorSet.has(c.name)) continue;
    const p=r.p, w=W.get(p);
    p.x=+w.x.toFixed(4);
    p.y=+w.y.toFixed(4);
    p.w=+w.w.toFixed(4); p.h=+w.h.toFixed(4);
    // 薄焊盘格心保障（第十轮 n59 教训，影响区家族第三例）：元件中心量化到 0.6 格界，
    // 焊盘偏移固定——薄于栅格的轴向（SOIC 旋转后 0.5 短边 < 0.6 格）可能不包含任何格心
    // → padCells 为空 → 焊盘对本网完全不可达（RMST/Prim 的 src 均为空）。半格微移
    // （≤grid/2，制造上无差异）把中心落到最近格心线上。含格心判定：到最近格心线的
    // 相位距离 ≤ 半宽。
    const half=grid/2;
    const needsX=p.w<grid-1e-9, needsY=p.h<grid-1e-9;
    if(needsX||needsY){
      const phase=v=>{ const m=((v/grid-0.5)%1+1)%1; return Math.min(m,1-m)*grid; };  // 到最近格心线的距离
      if(needsX && phase(p.x)>p.w/2-1e-9){
        const line=(Math.floor(p.x/grid-0.5)+1)*grid+half;   // 右侧最近格心线
        p.x=+(p.x + (line-p.x) - grid*Math.round((line-p.x)/grid)).toFixed(4);
      }
      if(needsY && phase(p.y)>p.h/2-1e-9){
        const line=(Math.floor(p.y/grid-0.5)+1)*grid+half;
        p.y=+(p.y + (line-p.y) - grid*Math.round((line-p.y)/grid)).toFixed(4);
      }
    }
  }
  for(const p of pads){ const w=W.get(p); w.x=p.x; w.y=p.y; }   // 吸附后重同步世界坐标
  // 重叠修复：吸附后仍有异组焊盘重叠时，沿较浅重叠轴把整组推开一格（贪心，≤80 轮）
  for(let guard=0; guard<80; guard++){
    let fixed=false;
    const tryMove=(c,delta,axis)=>{
      const before=axis==='x'?c.ps[0].x:c.ps[0].y;
      let min=Infinity,max=-Infinity;
      for(const p of c.ps){const pos=p[axis],half=(axis==='x'?p.w:p.h)/2;min=Math.min(min,pos-half);max=Math.max(max,pos+half);}
      delta=Math.min(Math.max(delta,EM-min),(axis==='x'?design.width:design.height)-EM-max);
      for(const p of c.ps){
        p[axis]=+(p[axis]+delta).toFixed(4);
      }
      return (axis==='x'?c.ps[0].x:c.ps[0].y)!==before;   // 全组被钳位=没动
    };
    for(let i=0;i<pads.length&&!fixed;i++)for(let j=i+1;j<pads.length&&!fixed;j++){
      const a=pads[i],b=pads[j];
      if(compOf.get(a)===compOf.get(b)) continue;
      const ox=(a.w+b.w)/2-Math.abs(a.x-b.x), oy=(a.h+b.h)/2-Math.abs(a.y-b.y);
      if(ox>1e-6&&oy>1e-6){
        const ca=compOf.get(a), cb=compOf.get(b);
        const axis=oy<=ox?'y':'x';
        const sign=axis==='y'?(a.y>=b.y?1:-1):(a.x>=b.x?1:-1);
        const step=(axis==='y'?oy:ox)+grid;    // 推开 重叠量+一格，一次脱离
        // 只推可移动组（锚定组件位置是 AI 的布局决策，不许修复循环挪动）
        const mvA=!anchorSet.has(ca.name), mvB=!anchorSet.has(cb.name);
        if(mvA && tryMove(ca,sign*step,axis)) fixed=true;
        else if(mvB && tryMove(cb,-sign*step,axis)) fixed=true;
        else if(mvA && tryMove(ca,-sign*step,axis)) fixed=true;
        else if(mvB && tryMove(cb,sign*step,axis)) fixed=true;
      }
    }
    if(!fixed) break;
  }
  // Greedy overlap repair moves the written pads directly; refresh the cost cache too.
  for(const p of pads) Object.assign(W.get(p),{x:p.x,y:p.y,w:p.w,h:p.h});
  const after=cost();
  // 同步组件元数据（design.comps）：位置=焊盘 bbox 中心、层=多数焊盘层；
  // rot：锚定组件保留 spec 值，移动组件写实际旋转
  design.comps=design.comps||{};
  for(const c of comps){
    let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9,top=0,bot=0;
    for(const p of c.ps){
      x0=Math.min(x0,p.x-p.w/2); y0=Math.min(y0,p.y-p.h/2); x1=Math.max(x1,p.x+p.w/2); y1=Math.max(y1,p.y+p.h/2);
      if(p.layer==='bottom') bot++; else top++;
    }
    const prev=design.comps[c.name]||{};
    design.comps[c.name]={...prev,
      x:+((x0+x1)/2).toFixed(4), y:+((y0+y1)/2).toFixed(4),
      rot:anchorSet.has(c.name)?(prev.rot||0):((prev.rot||0)+c.rot)%360,
      layer:prev.layer||(bot>top?'bottom':'top')};
  }
  return {before:+initial.toFixed(1), after:+after.toFixed(1), groups:comps.length, iterations:iters};
}

/* ---------- 布通率驱动布局-布线循环 ----------
   place → 试探布线 → 从冲突/失败网络提取"拥塞热点"→ 热点反馈进布局代价
   （非属主组件压到热点区受罚 → 退火把挡路者推离走廊）→ 再布线。
   实战中"AI 多轮人工修复循环"的算法化：布局修对，协商立刻收敛。 */
/* 栅格吸附（组保持）：独立焊盘逐个吸附；多焊盘组件整体平移到中心吸附，
   封装内部节距（如 DIP 2.54mm）在栅格变化时保持不漂移。 */
function snapPadsPreserveGroups(design){
  const g=design.grid;
  const groups=new Map();
  for(const p of design.pads||[]){
    const i=p.id.lastIndexOf('-');
    const gname=i>0?p.id.slice(0,i):p.id;
    if(!groups.has(gname)) groups.set(gname,[]);
    groups.get(gname).push(p);
  }
  for(const [name,ps] of groups){
    let cx=0, cy=0;
    for(const p of ps){ cx+=p.x; cy+=p.y; }
    cx/=ps.length; cy/=ps.length;
    const dx=+ (snapToGrid(cx,g)-cx).toFixed(4), dy=+(snapToGrid(cy,g)-cy).toFixed(4);
    for(const p of ps){ p.x=+(p.x+dx).toFixed(4); p.y=+(p.y+dy).toFixed(4); }
    const comp=design.comps?.[name];
    if(comp){if(Number.isFinite(comp.x))comp.x=+(comp.x+dx).toFixed(4);if(Number.isFinite(comp.y))comp.y=+(comp.y+dy).toFixed(4);}
  }
}
function computeHotspots(design, result){
  const boxes=[];
  const addBox=(cx,cy,r)=>boxes.push({x0:cx-r,y0:cy-r,x1:cx+r,y1:cy+r,owners:[]});
  for(const o of (result&&result.overuse)||[]) addBox(o.x,o.y,2);
  for(const n of (result&&result.nets)||[]) if(n.connected<n.total)
    for(const p of design.pads||[]) if(p.netId===n.netId) addBox(p.x,p.y,1.5);
  // 合并重叠盒
  for(let i=0;i<boxes.length;i++)for(let j=boxes.length-1;j>i;j--){
    const a=boxes[i],b=boxes[j];
    if(Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0)>0 && Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0)>0){
      a.x0=Math.min(a.x0,b.x0); a.y0=Math.min(a.y0,b.y0);
      a.x1=Math.max(a.x1,b.x1); a.y1=Math.max(a.y1,b.y1);
      boxes.splice(j,1);
    }
  }
  // 属主：焊盘中心在盒内的组件（它们不受该热点罚——要连的就是它们）
  for(const b of boxes){
    b.owners=[];
    for(const p of design.pads||[])
      if(p.x>b.x0&&p.x<b.x1&&p.y>b.y0&&p.y<b.y1){
        const i=p.id.lastIndexOf('-');
        b.owners.push(i>0?p.id.slice(0,i):p.id);
      }
  }
  return boxes.slice(0,40);
}
// 布线结果字典序评分与比较（连通 > 冲突 > 过孔 > 线长）
function routeScore(r){
  const fails=r.stats.total-r.stats.connected;
  return [fails===0&&r.status==='complete'?0:1, fails, r.drcErrors||0, r.overuse.length, r.stats.vias, Math.round(r.stats.trackLen*10)];
}
function scoreBetter(a,b){ for(let i=0;i<a.length;i++) if(a[i]!==b[i]) return a[i]<b[i]; return false; }
// Shared CLI/Worker routing policy; all candidate acceptance uses the same score.
function resultHash(r){
  // 走线几何哈希（djb2）：坐标 3 位小数 + 层 + 过孔——重放一致性判据
  let h = 5381;
  const feed = t => { for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) >>> 0; };
  for (const n of r.nets) for (const p of n.paths) for (const pt of p)
    feed(pt.x.toFixed(3) + ',' + pt.y.toFixed(3) + ',' + pt.l + ';');
  for (const n of r.nets) for (const v of n.vias) feed('V' + v.x.toFixed(3) + ',' + v.y.toFixed(3) + ';');
  return h.toString(16).padStart(8, '0');
}
function routeBoard(design,opts={}){
  const started=Date.now(),onProgress=opts.onProgress||(()=>{});
  const minGrid=minimumRoutingGrid(design);
  if(design.grid<minGrid-1e-9){design.grid=minGrid;snapPadsPreserveGroups(design);}
  const netIds=new Set(design.nets.map(n=>n.id));
  for(const p of design.pads) if(p.netId!=null&&!netIds.has(p.netId)) throw new Error('Unknown netId on pad '+p.id);
  const viaCost=opts.viaCost??15,maxIter=opts.maxIter??30;
  if(!Number.isFinite(viaCost)||viaCost<0||!Number.isInteger(maxIter)||maxIter<1||maxIter>1000) throw new Error('Invalid routing options');
  const prepare=r=>{
    if(opts.beautify!==false) beautifyResult(design,r);
    r.drcErrors=checkDRC(design,{...r,nets:[...r.nets,...manualRouteEntries(design)]},{dfm:false}).filter(i=>i.sev==='error').length;
    if(r.drcErrors) r.status='partial';
    return r;
  };
  const sharedModel=opts.model||buildModel(design);   // design 全程不变——候选重跑共享（0.11.1）
  const run=(vc,label,extra={})=>{
    const session=createSession(design,{...opts,viaCost:Math.max(1,vc),maxIter,...extra,model:sharedModel});
    let step;
    while(!(step=session.step()).done) onProgress({text:label+' · '+step.text,frac:step.frac||0});
    const result=prepare(session.buildResult());
    // 会话重放基建（路线图阶段一 #5）：onStage 钩子逐阶段留痕（可选，缺省零开销）——
    // 几何哈希 + DRC 计数，用于 p10 类"不可复现违规"的时序定位
    if(opts.onStage) opts.onStage({ stage:(opts.stagePrefix?opts.stagePrefix+' ':'')+label,
      viaCost:vc, extra:extra||{}, status:result.status,
      connected:result.stats.connected, total:result.stats.total,
      vias:result.stats.vias, drcErrors:result.drcErrors||0,
      hash:resultHash(result) });
    return {session,result};
  };
  let best=run(viaCost,'初始布线');
  if(opts.optimize!==false){
    const candidates=best.result.status==='complete'
      ? [{vc:viaCost*4},{vc:viaCost*10},{vc:viaCost,extra:{layerDir:false}}]
      : [{vc:viaCost*0.3},{vc:viaCost*0.1}];
    for(let i=0;i<candidates.length;i++){
      const at=candidates[i],next=run(at.vc,'优化 '+(i+1)+'/'+candidates.length,at.extra);
      if(scoreBetter(routeScore(next.result),routeScore(best.result))) best=next;
    }
    const saved=best.session.snapshot();
    best.session.optimize(2,st=>onProgress({text:'逐网优化 · '+st.pass+' · '+st.done+'/'+st.total,frac:0.95}));
    // 差分对强制压实（0.13.27，0.4.0 留档后续项）：无 pair 板 no-op 位级不变
    if(opts.compactPairs!==false){
      const cp=best.session.compactPairs({pairCoupleTarget: opts.pairCoupleTarget});
      if(opts.onStage) opts.onStage({stage:'compact-pairs', compacted:cp.compacted, skipped:cp.skipped});
    }
    // 多网联合重布（0.14.1）：失败网的阻塞者子集枚举重排；全连通板 no-op 位级不变
    if(opts.jointReroute!==false){
      const jr=best.session.jointReroute({jointRerouteMaxNets: opts.jointRerouteMaxNets, jointR: opts.jointR});
      if(opts.onStage) opts.onStage({stage:'joint-reroute', improved:jr.improved, nets:jr.nets.length});
    }
    const next=prepare(best.session.buildResult());
    if(!scoreBetter(routeScore(best.result),routeScore(next))) best.result=next;
    else{
      best.session.restore(saved);
      // 全阶段回滚不能丢失压实报告，也不能把已回滚的尝试宣称为压实成功。
      // 比例以最终保留的（美化后）几何重算；会话后续 buildResult 同步该报告。
      if(next.compact){
        const pairs=next.compact.pairs.map(({group})=>{
          const members=design.nets.filter(n=>n.pair===group),ids=new Set(members.map(n=>n.id));
          const routes=best.result.nets.filter(n=>ids.has(n.netId));
          const pair={group,action:'skipped',reason:'postroute-score-rollback'};
          if(members.length===2&&routes.length===2){
            const gEff=pairGapFor(design,members[0]);
            if(gEff!=null){
              const center=(netW(design,members[0].id)+netW(design,members[1].id))/2+gEff;
              let coupled=0,total=0;
              for(let i=0;i<2;i++){
                const st=pairCoupleStats([routes[i].paths],[routes[1-i].paths],center,Math.max(design.grid,0.25));
                coupled+=st.coupledLen;total+=st.totalLen;
              }
              pair.ratioBefore=+(total>0?coupled/total:0).toFixed(3);
            }
          }
          return pair;
        });
        const errors=best.result.drcErrors||0;
        best.result.compact={pairs,compacted:0,skipped:pairs.length,drcBefore:errors,drcAfter:errors,rolledBack:true};
        best.session.session.compact=best.result.compact;
      }
    }
    if(opts.onStage) opts.onStage({ stage:(opts.stagePrefix?opts.stagePrefix+' ':'')+'逐网优化',
      status:best.result.status, connected:best.result.stats.connected, total:best.result.stats.total,
      vias:best.result.stats.vias, drcErrors:best.result.drcErrors||0, hash:resultHash(best.result) });
  }
  best.result.timeMs=Date.now()-started;
  onProgress({text:'完成',frac:1});
  return best;
}

/* ---------- 形状补线：对栅格失败的网做连续空间重布（阶段三 #12） ----------
   补充式共存（架构定案）：栅格仍是默认路径且位级不变；本驱动只接管 routeBoard
   之后仍 `connected<total` 的网（BGA/0.4mm 密集/走廊拥塞），结果并回同一
   result，下游 DRC/Gerber/EasyEDA/SVG/铺铜全部零改动。

   为什么必须独立入口而不在 routeBoard 里加开关：routeBoard 开头会**上抬
   design.grid 并 snapPadsPreserveGroups 移动焊盘**（line 3383-3384），而形状
   布线的卖点正是"不受栅格约束"——必须先于该突变定格原始布局。

   接受准则与栅格引擎同一把尺（字典序，绝不退步）：
   连通数↑ → 几何冲突↓ → 过孔↓ → 线长↓。重布失败则整网回滚。 */
function auditGeometry(design, result, opts){
  opts=opts||{};
  // 脱离栅格的几何冲突审计：产出与 result.overuse 同形的 {x,y,l} 点集。
  // 栅格 overuse 是"格点被多网占用"，这里给出的是"线段几何真违规"——
  // 形状布线结果没有栅格占用可言，必须由几何审计替代该口径。
  const nets=[...((result&&result.nets)||[]), ...manualRouteEntries(design)];
  const segs=[];
  for(const n of nets){
    const hw=netW(design,n.netId)/2;
    for(const path of n.paths||[]) for(let i=1;i<path.length;i++){
      const a=path[i-1], b=path[i];
      if(a.l!==b.l) continue;
      if(Math.abs(a.x-b.x)<1e-12 && Math.abs(a.y-b.y)<1e-12) continue;
      segs.push({net:n.netId,l:a.l,hw,a,b,
        x0:Math.min(a.x,b.x),x1:Math.max(a.x,b.x),
        y0:Math.min(a.y,b.y),y1:Math.max(a.y,b.y)});
    }
  }
  // 按层 + 左边界排序扫描（与 checkDRC 4945-4975 同法，保序且避免全场两两）
  const out=[];
  const byLayer=new Map();
  for(const s of segs){ let a=byLayer.get(s.l); if(!a){ a=[]; byLayer.set(s.l,a); } a.push(s); }
  for(const [l,arr] of byLayer){
    arr.sort((p,q)=>p.x0-q.x0||p.y0-q.y0||p.net-q.net);
    let maxHalf=0;
    for(const s of arr) if(s.hw>maxHalf) maxHalf=s.hw;
    for(let i=0;i<arr.length;i++){
      const s=arr[i];
      const scanReach=s.hw+maxHalf+design.clearance;
      for(let j=i+1;j<arr.length;j++){
        const t=arr[j];
        if(t.x0>s.x1+scanReach) break; // 后续段可能更宽，终止界必须覆盖本层最大半宽
        if(t.net===s.net) continue;
        const reach=s.hw+t.hw+design.clearance;
        if(t.x0>s.x1+reach||t.y0>s.y1+reach||t.y1<s.y0-reach) continue;
        const d=segSegDist(s.a.x,s.a.y,s.b.x,s.b.y,t.a.x,t.a.y,t.b.x,t.b.y);
        if(d<reach-1e-9) out.push({x:(s.a.x+s.b.x)/2,y:(s.a.y+s.b.y)/2,l});
      }
    }
  }
  return out;
}

// 只计算候选网参与的段-段违规，等价于两次全板审计的计数差。
// 避免在每次试探接受/回滚时重新扫描与该网无关的全部段对。
function countNetSegmentViolations(design, entry, rest){
  const byLayer=new Map(), hw=netW(design,entry.netId)/2;
  for(const path of entry.paths||[]) for(let i=1;i<path.length;i++){
    const a=path[i-1],b=path[i];
    if(a.l!==b.l||(Math.abs(a.x-b.x)<1e-12&&Math.abs(a.y-b.y)<1e-12)) continue;
    const s={net:entry.netId,hw,a,b,x0:Math.min(a.x,b.x),x1:Math.max(a.x,b.x),
      y0:Math.min(a.y,b.y),y1:Math.max(a.y,b.y)};
    let group=byLayer.get(a.l); if(!group){group=[];byLayer.set(a.l,group);} group.push(s);
  }
  if(!byLayer.size) return 0;
  let count=0;
  for(const n of [...rest,...manualRouteEntries(design)]){
    if(n.netId===entry.netId) continue;
    const otherHalf=netW(design,n.netId)/2, reach=hw+otherHalf+design.clearance;
    for(const path of n.paths||[]) for(let i=1;i<path.length;i++){
      const a=path[i-1],b=path[i],group=byLayer.get(a.l);
      if(a.l!==b.l||!group||(Math.abs(a.x-b.x)<1e-12&&Math.abs(a.y-b.y)<1e-12)) continue;
      const t={net:n.netId,a,b,x0:Math.min(a.x,b.x),x1:Math.max(a.x,b.x),
        y0:Math.min(a.y,b.y),y1:Math.max(a.y,b.y)};
      for(const own of group){
        // 与全板 sweep 保持完全相同的参数方向及边界算式（稳定排序时 entry 在先）。
        let s=own,o=t;
        if((s.x0-o.x0||s.y0-o.y0||s.net-o.net)>0){s=t;o=own;}
        if(o.x0>s.x1+reach||o.y0>s.y1+reach||o.y1<s.y0-reach) continue;
        if(segSegDist(s.a.x,s.a.y,s.b.x,s.b.y,o.a.x,o.a.y,o.b.x,o.b.y)<reach-1e-9) count++;
      }
    }
  }
  return count;
}

function routeBoardShape(design, opts={}){
  const started=Date.now(), onProgress=opts.onProgress||(()=>{});
  const log=opts.onLog||(()=>{});
  // 1) 栅格基线（可选跳过——调用方已有 result 时传 opts.base）
  let base=opts.base;
  if(!base){
    onProgress({text:'栅格基线布线',frac:0.02});
    base=routeBoard(design,{...opts,onProgress:undefined}).result;
  }
  if(opts.shapePatch===false) return {result:base, shape:{applied:false,reason:'disabled'}};
  const L=Math.max(1,design.layers|0);
  // 2) 只为"未连通"的网做形状重布。overuse（几何冲突）也在补线范围内：
  //    栅格残留违规常与失败网同源，重布可能同时消掉。
  // 目标网两类：① 未连通 ② 卷入 DRC 间距错误的网（栅格残留违规常与布局量化
  // 同源，重布可能同时消掉）。第二类只在 opts.shapeFixDrc!==false 时启用。
  const drcNets=new Set();
  if(opts.shapeFixDrc!==false){
    const issues=checkDRC(design,base,{dfm:false}).filter(i=>i.sev==='error');
    const padNetOf=new Map((design.pads||[]).map(p=>[p.id,p.netId]));
    for(const it of issues){
      const m=/焊盘 ([^ ]+)/.exec(it.msg||'');
      if(m && padNetOf.has(m[1])) drcNets.add(padNetOf.get(m[1]));
    }
  }
  // 3) 外层收敛循环（room-gate 完整版契约，0.13.8）：协商落盘 → 修复轮 →
  //    级联裁决改变板面 → **被借道的网在新板态下可能获得新的可达性/违规
  //    归属**——BGA 实测借道违规 4~74 个单轮消不掉，需要"再协商"迭代。
  //    每轮 target 基于当前板态重算；轮末全板裁决 [-drcErrors, connected]
  //    无改进即停；连续两轮进级联又回滚的网剔除（防抖，防 A/B 互换振荡）。
  const merged={...base, nets:base.nets.map(n=>({...n, paths:(n.paths||[]).map(p=>p.slice()),
    vias:(n.vias||[]).slice(), cells:(n.cells||[]).slice()})), overuse:(base.overuse||[]).slice()};
  const winMargin=opts.shapeWindow!=null?opts.shapeWindow:Math.max(4,2*design.grid);
  const cls=netClsMap(design);
  const notes=[];
  const cascade=[];   // 级联候选：借道已落盘、待修复轮后全板裁决
  // 协商历史（room-gate v3）：软借道落盘后的争议点计数，跨轮保留、跨网共享
  // key = 层|0.25mm 量化格，value = 该格的争议次数
  const crossHist=new Map();
  // geo 口径（0.13.4 修正三，对称三查）：该网与全板的交互违规数
  // = 段-段 + 段-异网焊盘 + 过孔间距（对异网焊盘/走线/过孔）。
  // 三个盲区都是 Fable/BGA 实测抓出的：①单网传 auditGeometry 恒 0；
  // ②过孔类违规完全不在段审计里；③段-异网焊盘不在段-段审计里。
  // before/after 用同一函数（对称），存量违规自动抵消，只剩净增量。
  const netGeoVio=(netEntry)=>{
    const rest=merged.nets.filter(x=>x.netId!==netEntry.netId);
    let vio=countNetSegmentViolations(design,netEntry,rest);   // 段-段（只审计候选网）
    const hw=netW(design,netEntry.netId)/2;
    for(const path of netEntry.paths||[]) for(let k=1;k<path.length;k++){
      const a=path[k-1], b=path[k];
      if(a.l!==b.l) continue;
      for(const p of (design.pads||[])){
        if(p.netId===netEntry.netId||!shpLayerInSpan(p,[a.l,a.l],L)) continue;
        if(segmentPadDistance(a,b,p)<hw+design.clearance-1e-9) vio++;   // 段-焊盘
      }
    }
    for(const v of netEntry.vias||[]){
      const outer=v.outer!=null?v.outer:design.viaOuter;
      const span=viaSpan(v,L);
      for(const p of (design.pads||[])){
        if(p.netId===netEntry.netId||!shpLayerInSpan(p,span,L)) continue;
        if(pointPadDistance(v.x,v.y,p)<outer/2+design.clearance-1e-9) vio++;
      }
      for(const n of rest){
        const hwN=netW(design,n.netId)/2;
        for(const path of n.paths||[]) for(let k=1;k<path.length;k++){
          const a=path[k-1], b=path[k];
          if(a.l!==b.l) continue;
          if(!viaOnLayer(v,a.l,L)) continue;
          if(segDist(v.x,v.y,a.x,a.y,b.x,b.y)<outer/2+design.clearance+hwN-1e-9){ vio++; break; }
        }
        for(const ov of n.vias||[]){
          if(!viaSpanOverlap(v,ov,L)) continue;
          if(Math.hypot(v.x-ov.x,v.y-ov.y)<(outer+(ov.outer!=null?ov.outer:design.viaOuter))/2+design.clearance-1e-9){ vio++; break; }
        }
      }
    }
    return vio;
  };

  // 深优 2026-11-14：全板违规归属扫描——一次遍历产出每网 netGeoVio 等值计数。
  // 修复轮的归属循环原实现对每网调 netGeoVio（=2×全板段审计）→ O(N×S²)；
  // 收敛为 1 次共享排序扫描（auditGeometry 同款 sweep 产出违规对）+ 四族
  // 逐网遍历各一次。归属规则与 netGeoVio 的对称差口径逐族对齐：
  //   族1 段-段（audit 对称差）：违规对两侧各 +1（含 manualRouteEntries 参与——
  //       auditGeometry 内部拼入 manual，对称差里与 entry 成对者计入 entry）
  //   族2 段-焊盘 / 族3 过孔-焊盘 / 族4 过孔-段：只记"被评网"一侧
  //   族5 过孔-过孔：两侧各 +1（每网作为被评网各计一次）
  const allNetGeoVio=()=>{
    const counts=new Map();
    const bump=(id,n)=>counts.set(id,(counts.get(id)||0)+n);
    // —— 族1：段-段（auditGeometry 同款排序扫描，产出对归属）——
    const netsAll=[...merged.nets, ...manualRouteEntries(design)];
    const segs=[];
    for(const n of netsAll){
      const hw=netW(design,n.netId)/2;
      for(const path of n.paths||[]) for(let i=1;i<path.length;i++){
        const a=path[i-1], b=path[i];
        if(a.l!==b.l) continue;
        if(Math.abs(a.x-b.x)<1e-12 && Math.abs(a.y-b.y)<1e-12) continue;
        segs.push({net:n.netId,l:a.l,hw,a,b,
          x0:Math.min(a.x,b.x),x1:Math.max(a.x,b.x),
          y0:Math.min(a.y,b.y),y1:Math.max(a.y,b.y)});
      }
    }
    let segsegAll=0;
    const byLayer=new Map();
    for(const s of segs){ let a=byLayer.get(s.l); if(!a){ a=[]; byLayer.set(s.l,a); } a.push(s); }
    for(const [l,arr] of byLayer){
      arr.sort((p,q)=>p.x0-q.x0||p.y0-q.y0||p.net-q.net);
      let maxHalf=0;
      for(const s of arr) if(s.hw>maxHalf) maxHalf=s.hw;
      for(let i=0;i<arr.length;i++){
        const s=arr[i];
        const scanReach=s.hw+maxHalf+design.clearance;
        for(let j=i+1;j<arr.length;j++){
          const t=arr[j];
          if(t.x0>s.x1+scanReach) break; // 与 auditGeometry 同口径：不能用当前候选的半宽终止
          if(t.net===s.net) continue;
          const reach=s.hw+t.hw+design.clearance;
          if(t.x0>s.x1+reach||t.y0>s.y1+reach||t.y1<s.y0-reach) continue;
          if(segSegDist(s.a.x,s.a.y,s.b.x,s.b.y,t.a.x,t.a.y,t.b.x,t.b.y)<reach-1e-9){
            segsegAll++; bump(s.net,1); bump(t.net,1);
          }
        }
      }
    }
    // —— 族2~5：与 netGeoVio 的逐网循环同构，按属主一侧归属 ——
    const padsAll=design.pads||[];
    for(const n of merged.nets){
      const hw=netW(design,n.netId)/2;
      for(const path of n.paths||[]) for(let k=1;k<path.length;k++){
        const a=path[k-1], b=path[k];
        if(a.l!==b.l) continue;
        for(const p of padsAll){
          if(p.netId===n.netId||!shpLayerInSpan(p,[a.l,a.l],L)) continue;
          if(segmentPadDistance(a,b,p)<hw+design.clearance-1e-9) bump(n.netId,1);   // 族2
        }
      }
      for(const v of n.vias||[]){
        const outer=v.outer!=null?v.outer:design.viaOuter;
        const span=viaSpan(v,L);
        for(const p of padsAll){
          if(p.netId===n.netId||!shpLayerInSpan(p,span,L)) continue;
          if(pointPadDistance(v.x,v.y,p)<outer/2+design.clearance-1e-9) bump(n.netId,1);   // 族3
        }
        for(const o2 of merged.nets){
          if(o2.netId===n.netId) continue;
          const hwN=netW(design,o2.netId)/2;
          for(const path of o2.paths||[]) for(let k=1;k<path.length;k++){
            const a=path[k-1], b=path[k];
            if(a.l!==b.l) continue;
            if(!viaOnLayer(v,a.l,L)) continue;
            if(segDist(v.x,v.y,a.x,a.y,b.x,b.y)<outer/2+design.clearance+hwN-1e-9){ bump(n.netId,1); break; }   // 族4
          }
          for(const ov of o2.vias||[]){
            if(!viaSpanOverlap(v,ov,L)) continue;
            if(Math.hypot(v.x-ov.x,v.y-ov.y)<(outer+(ov.outer!=null?ov.outer:design.viaOuter))/2+design.clearance-1e-9){ bump(n.netId,1); bump(o2.netId,1); }   // 族5
          }
        }
      }
    }
    return {counts, segsegAll};
  };

  // 外层循环状态
  const maxRounds=Math.max(1, opts.shapeRounds!=null?opts.shapeRounds:3);
  const cascadeRollCount=new Map();   // netId → 连续级联回滚次数（防抖）
  const exhausted=new Set();          // 防抖剔除集
  let target=[];                      // 每轮重算
  let attemptedTotal=0, roundsUsed=0, applied=0, repairTried=0, repairFixed=0,
      cascadeKept=0, cascadeRolled=0;
  let repaired=new Set();   // 单轮内已修复集（每轮清空——板面变化后应允许重试）
  let prevScore=null;
  for(let round=0; round<maxRounds; round++){
    // —— target 重算：基于当前板态 merged（协商/修复/级联改变可达性与违规归属）
    if(opts.shapeNets && opts.shapeNets.length){
      target=design.nets.filter(n=>opts.shapeNets.indexOf(n.name)>=0||opts.shapeNets.indexOf(n.id)>=0);
    } else {
      const drcNetsNow=new Set();
      if(opts.shapeFixDrc!==false){
        const issues=checkDRC(design,merged,{dfm:false}).filter(i=>i.sev==='error');
        const padNetOf=new Map((design.pads||[]).map(p=>[p.id,p.netId]));
        for(const it of issues){
          // ① 焊盘型违规：从消息里的焊盘 id 直接取网
          const m=/焊盘 ([^ ]+)/.exec(it.msg||'');
          if(m && padNetOf.has(m[1])) drcNetsNow.add(padNetOf.get(m[1]));
          // ② 走线/坐标型违规（间距冲突/走线间距/过孔间距）：消息里带
          //    "(x, y)" 或 "走线段 (x, y)"——用坐标反查该处附近的网。
          //    0.13.14 补：p43-single-layer 与 n148 的违规全是这型，此前
          //    target 抓不到 → rounds=0 静默跳过（批量回归抓出的缺口）。
          const cm=/\(([\d.]+),\s*([\d.]+)\)/.exec(it.msg||'');
          if(cm){
            const x=parseFloat(cm[1]), y=parseFloat(cm[2]);
            if(Number.isFinite(x)&&Number.isFinite(y)){
              for(const n of merged.nets){
                const hw=netW(design,n.netId)/2;
                let hit=false;
                for(const path of n.paths||[]){
                  for(let k=1;k<path.length&&!hit;k++){
                    const a=path[k-1], b=path[k];
                    if(a.l!==b.l) continue;
                    if(segDist(x,y,a.x,a.y,b.x,b.y)<=hw+design.clearance+1e-6){ hit=true; }
                  }
                  if(hit) break;
                }
                if(!hit) for(const v of n.vias||[])
                  if(Math.hypot(v.x-x,v.y-y)<=design.viaOuter+design.clearance){ hit=true; break; }
                if(hit) drcNetsNow.add(n.netId);
              }
            }
          }
        }
      }
      target=design.nets.filter(n=>{
        if(exhausted.has(n.id)) return false;
        const rn=merged.nets.find(x=>x.netId===n.id);
        if(!rn) return false;
        return rn.connected<rn.total || drcNetsNow.has(n.id);
      });
    }
    if(!target.length) break;
    roundsUsed++; attemptedTotal+=target.length;
    cascade.length=0;
    repaired=new Set();   // 板面已变：允许上轮修复过的网重试   // 每轮独立级联集（跨轮保留会让修复轮面对过期的落盘态）
    // —— 协商（原逐网 forEach 体，改为 for 以便 break 语义保持）
  target.forEach((n,k)=>{
    onProgress({text:'形状补线 '+n.name,frac:0.1+0.85*(k/target.length)});
    const pads=(design.pads||[]).filter(p=>p.netId===n.id);
    if(pads.length<2){ notes.push({net:n.name,skip:'pads<2'}); return; }
    // 大网护栏（0.13.7 修订）：软 Prim（room-gate v1）推翻了 0.13.4 的
    // "大网必然失败"定性——fable-01 GND 40 盘软协商 40/40 零重叠。护栏
    // 语义改为纯耗时保护：缺省 40（约千万级节点图的尝试上限），超过才跳过。
    const maxPads=opts.shapeMaxPads!=null?opts.shapeMaxPads:40;
    if(pads.length>maxPads){
      notes.push({net:n.name,skip:'pads>'+maxPads+'（超时保护，建议铺铜）'});
      return;
    }
    let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
    for(const p of pads){
      const hw=p.w/2, hh=(p.shape==='circle'?p.w:p.h)/2;
      x0=Math.min(x0,p.x-hw); x1=Math.max(x1,p.x+hw);
      y0=Math.min(y0,p.y-hh); y1=Math.max(y1,p.y+hh);
    }
    const win={x0:Math.max(0,x0-winMargin), x1:Math.min(design.width,x1+winMargin),
               y0:Math.max(0,y0-winMargin), y1:Math.min(design.height,y1+winMargin)};
    // 障碍集：其它所有网的铜（本网被剔除，重布时旧铜不算障碍）
    const OBS=shpCollectObstacles(design, merged.nets, n.id);
    const baseOpt={viaCost:opts.viaCost,turnPen:opts.turnPen,cls:cls.get(n.id)||null,
      crossHist, histScale:opts.shapeHistScale!=null?opts.shapeHistScale:8};
    // 预检（BGA-64 实测省 19s/22s）：已全连通且自身零违规的网，协商唯一可能
    // 的产出是"减过孔/线长但引入新违规"——对称准则必拒，直接跳过。
    const curEntry=merged.nets.find(x=>x.netId===n.id);
    const curVio=curEntry?netGeoVio(curEntry):0;
    const preSkip = curEntry && curEntry.connected>=curEntry.total && curVio===0 &&
      !(opts.shapeOptimizePaths===true);
    // 第一遍：硬约束（布线合法 ⊆ DRC 合法）
    let r=preSkip?null:shpRouteNet(design, n, OBS, win, baseOpt);
    let usedSoft=false;
    if(preSkip){ notes.push({net:n.name,skip:'已连通且零违规（协商无收益）'}); return; }
    // 软后备的触发条件（0.13.7 修订）：网整体 no-path **或重布连通数低于
    // 现状**——大网的硬 Prim 会"部分接入后卡死"（33/40 < 基线 38/40），
    // 有路径但更差；此时软 Prim（图放开擦边边）往往能全连（实测 40/40），
    // 不试就等于放弃大网。
    if(!r || !r.paths.length ||
       (curEntry && (r.connected-(r.total||0))<=(curEntry.connected-(curEntry.total||0)))){   // <=：相等也试软（软可能全连而硬卡死，fable-03 GND 37→38 实测）
      // 第二遍：软障碍协商（#12b）——异网铜记惩罚可借道。接受方按几何违规
      // 数裁决：违规比"连通增益"更贵时不接受。禁布区/板边/孔边距仍是硬墙。
      const r2=shpRouteNet(design, n, OBS, win, {...baseOpt, soft:true,
        penScale:opts.shapePenScale!=null?opts.shapePenScale:40});
      if(r2 && (!r || (r2.connected-(r2.total||0))>(r.connected-(r.total||0)))){   // 软结果未连更少才采纳
        r=r2; usedSoft=true;
      }
    }
    if(!r || !r.paths.length){ notes.push({net:n.name,skip:'no-path',obs:OBS.copper.length}); return; }
    const candIdx=merged.nets.findIndex(x=>x.netId===n.id);
    const saved=JSON.parse(JSON.stringify(merged.nets[candIdx]));
    merged.nets[candIdx].paths=r.paths;
    merged.nets[candIdx].vias=r.vias;
    merged.nets[candIdx].connected=r.connected;
    merged.nets[candIdx].total=r.total;
    merged.nets[candIdx].cells=[];
    // 字典序：连通优先，其次几何冲突，再次过孔，最后线长。
    const before={conn:saved.connected,total:saved.total,
      geo:netGeoVio(saved),
      vias:(saved.vias||[]).length,len:pathLenOf(saved.paths||[])};
    const after={conn:r.connected,total:r.total,
      geo:netGeoVio(merged.nets[candIdx]),
      vias:r.vias.length,len:pathLenOf(r.paths)};
    // 协商接受准则：每 1 个新增几何违规至少要换回 shapeNegotiateGain 个连通
    // 焊盘（缺省 1:1）——violation 不是免费的，防止"借道把别的网搞挂"的净损失。
    const gainPerVio=opts.shapeNegotiateGain!=null?opts.shapeNegotiateGain:1;
    const dConn=after.conn-before.conn, dGeo=after.geo-before.geo;
    let better;
    if(dGeo<=0){
      better = dConn>0 ||
        (dConn===0 && after.vias<before.vias) ||
        (dConn===0 && after.vias===before.vias && after.len<before.len-1e-9);
    } else {
      better = dConn>=dGeo*gainPerVio && dConn>0;
    }
    // 级联候选（12b-5）：借道有连通增益但净违规为正、且 shapeCascade!==false
    // 时，**暂不回滚**——先保留借道路径，交给后面的修复轮去消除被侵权侧的
    // 违规（修复轮会尝试重布卷入违规的网），最终在修复轮结束后做全板裁决：
    // 级联净收益 = Δ连通 - k×Δ全板违规，为正才保留，否则整组回滚。
    // 这与 0.13.4 的"直接拒绝"的本质差别：修复轮可能把违规消掉，借道就
    // 从"违规换连通"变成"零违规换连通"——只有试过才知道。
    if(!better && dConn>0 && dGeo>0 && opts.shapeCascade!==false){
      cascade.push({candIdx, netId:n.id, saved, viaState:{...merged.nets[candIdx]}, netName:n.name, dConn, dGeo, kept:false});
      notes.push({net:n.name,cascade:true,conn:after.conn+'/'+after.total,
        geo:before.geo+'→'+after.geo,wait:'待级联修复后全板裁决'});
      return;
    }
    if(better){
      applied++;
      // 软借道落盘后记录争议点（room-gate v3）：该网新路径与异网铜的每个
      // 违规段中点计入 crossHist——后续网在同点位借道时代价递增，迫使
      // 网摊开到未被争夺的缝隙（PathFinder history cost 语义）。
      if(usedSoft){
        const hwX=netW(design,n.id)/2;
        for(const path of r.paths) for(let k=1;k<path.length;k++){
          const a=path[k-1], b=path[k];
          if(a.l!==b.l) continue;
          for(const o of OBS.copper){
            if(o.net===n.id || o.layers.indexOf(a.l)<0) continue;
            const g=shpSegGap(o,a,b);
            if(g < design.clearance + hwX - 1e-9){
              const key=a.l+'|'+Math.round(((a.x+b.x)/2)*4)+'|'+Math.round(((a.y+b.y)/2)*4);
              crossHist.set(key,(crossHist.get(key)||0)+1);
              break;
            }
          }
        }
      }
      notes.push({net:n.name,ok:true,soft:usedSoft,conn:after.conn+'/'+after.total,
      geo:before.geo+'→'+after.geo,vias:before.vias+'→'+after.vias,len:+(after.len-before.len).toFixed(2)});
    }
    else{
      merged.nets[candIdx]=saved;
      notes.push({net:n.name,skip:'worse',soft:usedSoft,conn:after.conn+'/'+after.total,geo:after.geo,vias:after.vias});
    }
  });
  // 3b) 拆-重布修复轮（12b-3）：对**卷入几何违规**的网逐个形状重布——
  //     违规来源两类：① 协商借道新引入的 ② 栅格协商的存量残留。
  //     接受准则（比协商轮更严）：净违规必须**严格下降**且连通数不降，
  //     否则回滚——修复轮的目的是消违规，不是借违规换连通。
  //     迭代至无改进（最多 shapeRepairPasses 轮，缺省 3）；每轮把"本轮被
  //     修复的网"从候选集剔除，防止 A/B 网互换违规的无限循环。
  const repairPasses=Math.max(1, opts.shapeRepairPasses!=null?opts.shapeRepairPasses:3);
  let repairFixed=0, repairTried=0;
  for(let pass=0;pass<repairPasses;pass++){
    // 全板违规归属：哪几个网卷入？（对称差——用 netGeoVio 的全板版）
    // 深优 2026-11-14：一次全板归属扫描替代 reduce(netGeoVio)+逐网重算——
    // 原口径每网 2×全板段审计（O(N×S²)），收敛为 1 次共享排序扫描 + 四族单遍
    const _vioAll=allNetGeoVio();
    // 触发条件含段-焊盘/过孔类违规（auditGeometry 只查段-段——Fable-01 实测
    // 其违规全是段-焊盘型，allVio 为空导致修复轮从不触发）
    let _vioSum=0; for(const v of _vioAll.counts.values()) _vioSum+=v;
    const totalVio=_vioAll.segsegAll+_vioSum;
    if(!totalVio) break;
    const involved=new Set();
    {
      // 归属：每网等值计数 >0 即卷入（与逐网 netGeoVio>0 逐位同值）
      for(const net of merged.nets){
        if(repaired.has(net.netId)) continue;
        if((_vioAll.counts.get(net.netId)||0)>0) involved.add(net.netId);
      }
    }
    if(!involved.size) break;
    let passFixed=0;
    const orderInv=[...involved].sort((a,b)=>a<b?-1:1);   // 确定性
    for(const netId of orderInv){
      const net=design.nets.find(x=>x.id===netId);
      if(!net) continue;
      const candIdx=merged.nets.findIndex(x=>x.netId===netId);
      if(candIdx<0) continue;
      const saved=JSON.parse(JSON.stringify(merged.nets[candIdx]));
      const pads=(design.pads||[]).filter(p=>p.netId===netId);
      if(pads.length<2) continue;
      let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
      for(const p of pads){
        const hw=p.w/2, hh=(p.shape==='circle'?p.w:p.h)/2;
        x0=Math.min(x0,p.x-hw); x1=Math.max(x1,p.x+hw);
        y0=Math.min(y0,p.y-hh); y1=Math.max(y1,p.y+hh);
      }
      const win={x0:Math.max(0,x0-winMargin), x1:Math.min(design.width,x1+winMargin),
                 y0:Math.max(0,y0-winMargin), y1:Math.min(design.height,y1+winMargin)};
      // 重布障碍 = 其它网当前铜（注意：被修复网的旧路径不在障碍里，但它
      // 正在被整体替换，故正确）；允许软借道（修复轮可能需要挪别人的位置
      // 换取自己的合法性？不——修复轮目标是消违规，软借道会引入新违规，
      // 故**只跑硬模式**；若硬模式无法消除违规，如实保留原状）
      const OBS=shpCollectObstacles(design, merged.nets, netId);
      const rr=shpRouteNet(design, net, OBS, win,
        {viaCost:opts.viaCost,turnPen:opts.turnPen,cls:cls.get(netId)||null});
      repairTried++;
      if(!rr || !rr.paths.length) continue;
      merged.nets[candIdx].paths=rr.paths;
      merged.nets[candIdx].vias=rr.vias;
      merged.nets[candIdx].connected=rr.connected;
      merged.nets[candIdx].total=rr.total;
      merged.nets[candIdx].cells=[];
      const before={conn:saved.connected, geo:netGeoVio(saved)};
      const after={conn:rr.connected, geo:netGeoVio(merged.nets[candIdx])};
      if(after.geo<before.geo && after.conn>=before.conn){
        passFixed++; repairFixed++; repaired.add(netId);
        notes.push({net:net.name,ok:true,repair:true,geo:before.geo+'→'+after.geo,
          conn:after.conn+'/'+after.total});
      } else {
        merged.nets[candIdx]=saved;
      }
    }
    if(!passFixed) break;   // 本轮零改进 → 熔断
  }
  // 3c) 级联裁决（12b-5，子集枚举）：借道候选之间可能互相违规——逐个裁决
  //     存在合成谬误（fable-01 实测：两个借道单独看各 +1 连通优于回滚，
  //     合在一起互相违规，全保留后 DRC +5）。候选数通常 ≤3，直接 2^n 子集
  //     枚举取全板字典序最优（连通优先，其次 -净违规）；全 0 子集 = 全回滚。
  if(cascade.length){
    // 裁决口径用 checkDRC 权威计数（0.13.6）：netGeoVio 三查与 DRC 的
    // 完整违规家族仍有口径差（擦边借道的段-焊盘/过孔-焊盘组合——
    // netGeoVio 数到 N 而 DRC 报 M，逐项追口径差是打地鼠）。DRC 慢
    // （每子集一次全板检查）但候选数 ≤ 2^n 且 n≤3，代价可控。
    const boardScore=r=>{
      const conn=r.nets.reduce((a,n)=>a+(n.connected||0),0);
      const drcE=checkDRC(design,r,{dfm:false}).filter(i=>i.sev==='error').length;
      // 字典序：DRC error 优先于连通（deliver 门禁 errors=0 是可交付硬线，
      // 未连通只是 partial——1 个连通焊盘不值得换 4 个 DRC。0.13.6 定案）
      return [-drcE, conn];
    };
    const nC=cascade.length, nMask=1<<nC;
    let bestMask=0, bestScore=null;
    for(let m=0;m<nMask;m++){
      // 应用子集 m
      for(let k=0;k<nC;k++){
        const c=cascade[k];
        merged.nets[c.candIdx]=(m>>k)&1 ? c.viaState : c.saved;
      }
      const sc=boardScore({nets:merged.nets});
      if(bestScore===null || sc[0]>bestScore[0] ||
         (sc[0]===bestScore[0] && sc[1]>bestScore[1])){
        bestScore=sc; bestMask=m;
      }
    }
    // 应用最优子集
    for(let k=0;k<nC;k++){
      const c=cascade[k];
      const kept=(bestMask>>k)&1;
      c.kept=kept;
      merged.nets[c.candIdx]=kept?c.viaState:c.saved;
      if(kept){ cascadeKept++;
        notes.push({net:c.netName,ok:true,cascade:true,kept:true,
          conn:'+'+c.dConn, geo:'+'+c.dGeo+'（级联子集裁决净收益）'});
      } else { cascadeRolled++;
        notes.push({net:c.netName,cascade:true,kept:false,
          reason:'级联子集裁决：保留子集不含此网（含互相违规的组合裁剪）'});
      }
    }
    }
    // —— 轮末：全板裁决 + 防抖 + 熔断
    const roundDrc=checkDRC(design,merged,{dfm:false}).filter(i=>i.sev==='error').length;
    const roundConn=merged.nets.reduce((a,n)=>a+(n.connected||0),0);
    const roundScore=[-roundDrc, roundConn];
    // 本轮 cascade 的 kept 标记直接取（不靠 notes 反查——同网名跨轮会污染）
    let roundKept=0, roundRolled=0;
    for(const c of cascade) (c.kept?roundKept++:roundRolled++);
    if(roundKept===0 && roundRolled>0){
      // 本轮级联全军覆没：这些网记一次回滚，连续 2 次剔除（防抖）
      for(const c of cascade){
        const cnt=(cascadeRollCount.get(c.netId)||0)+1;
        cascadeRollCount.set(c.netId,cnt);
        if(cnt>=2) exhausted.add(c.netId);
      }
    } else {
      for(const c of cascade) cascadeRollCount.set(c.netId,0);
    }
    // 熔断：全板 [-drc, conn] **不优于**上轮即停（相等或更差都停）
    if(prevScore){
      const noGain = roundScore[0]<prevScore[0] ||
        (roundScore[0]===prevScore[0] && roundScore[1]<=prevScore[1]);
      if(noGain){ log('形状补线：第'+(round+1)+'轮无改进，熔断'); break; }
    }
    prevScore=roundScore;
  }   // —— 外层 for(round) 结束
  // 4) 统计重算（beautify 已被栅格基线做过；形状补线是正交折线，无需再美化）
  const tc=merged.nets.reduce((a,n)=>a+(n.connected||0),0);
  const tt=merged.nets.reduce((a,n)=>a+(n.total||0),0);
  const overuse=auditGeometry(design,merged);
  merged.overuse=overuse.map(o=>({x:+o.x.toFixed(4),y:+o.y.toFixed(4),l:o.l}));
  recalcStats(merged, L);
  const drc=checkDRC(design,merged,{dfm:false}).filter(i=>i.sev==='error');
  merged.drcErrors=drc.length;
  merged.status=(tt===0||tc===tt)&&!merged.overuse.length?'complete':'partial';
  merged.timeMs=Date.now()-started;
  onProgress({text:'完成',frac:1});
  log('形状补线：'+applied+'/'+attemptedTotal+' 网接受（'+roundsUsed+' 轮）');
  if(!roundsUsed) return {result:base, shape:{applied:false,reason:'no-failed-nets',checked:0}};
  return {result:merged, shape:{applied:true,attempted:attemptedTotal,accepted:applied,
    rounds:roundsUsed, repaired:repairFixed, repairTried, cascadeKept, cascadeRolled, notes, window:winMargin}};
}
function pathLenOf(paths){
  let s=0;
  for(const p of paths) for(let k=1;k<p.length;k++)
    if(p[k].l===p[k-1].l) s+=Math.hypot(p[k].x-p[k-1].x,p[k].y-p[k-1].y);
  return s;
}
// 与 buildResult 同口径重算走线长度/过孔统计
function recalcStats(r, L){
  let lt=0, lb=0, viaCount=0;
  const trackLayers=new Array(L).fill(0);
  for(const n of r.nets){
    for(const p of n.paths||[]) for(let k=1;k<p.length;k++){
      if(p[k].l!==p[k-1].l) continue;
      const d=Math.hypot(p[k].x-p[k-1].x,p[k].y-p[k-1].y);
      trackLayers[p[k].l]+=d;
      if(p[k].l===0) lt+=d; else if(p[k].l===L-1) lb+=d;
    }
    viaCount+=(n.vias||[]).length;
  }
  r.stats={connected:r.nets.reduce((a,n)=>a+(n.connected||0),0),
    total:r.nets.reduce((a,n)=>a+(n.total||0),0),
    trackTop:lt, trackBot:lb, vias:viaCount, trackLen:trackLayers.reduce((a,b)=>a+b,0),
    trackLayers, trackInner:trackLayers.slice(1,-1).reduce((a,b)=>a+b,0)};
  return r;
}

/* ---------- 并行协商布线（roadmap 阶段一 #4 完成增量）----------
   TritonRoute FlexDR per-iteration 模式的架构对应物：
   迭代串行（共享拥塞状态=串行依赖），每迭代的网批量并行——
   主会话 beginIteration（阶段机器/历史增量/邻域拆除/排序）→ exportShared
   广播给 K 个持久镜像会话 → 各 worker routeList 分到的网批（对快照软冲突，
   PathFinder 语义：批内互不见=预期冲突，后续迭代协商解决）→ 主会话按
   队列 prio 序串行 commitRoutes → 下一迭代。
   worker 持久镜像会话（创建一次，跨迭代 adoptShared——零重建开销）；
   worker 失败的批次主线程串行补跑（并行永不劣于串行）；
   分批=队列 prio 序 round-robin（确定性），commit 按队列序（tie 语义保持）。
   语义演进：批内互不见 → 位级路径与串行不同（协商收敛性不变）——iterWorkers
   模式的 digest 独立于串行基线。 */
async function routeBoardIterParallel(design, opts={}){
  const started=Date.now(), onProgress=opts.onProgress||(()=>{});
  const minGrid=minimumRoutingGrid(design);
  if(design.grid<minGrid-1e-9){design.grid=minGrid;snapPadsPreserveGroups(design);}
  const netIds=new Set(design.nets.map(n=>n.id));
  for(const p of design.pads) if(p.netId!=null&&!netIds.has(p.netId)) throw new Error('Unknown netId on pad '+p.id);
  const viaCost=opts.viaCost??15, maxIter=opts.maxIter??30;
  const plainOpts={...opts, onProgress:undefined, onStage:undefined};
  const K=Math.min(Math.max(1, opts.iterWorkers||0), 16);
  if(K<2){ const best=routeBoard(design, {...opts, onProgress});
    return { result:best.result, session:best.session, fallback:true, timeMs:Date.now()-started }; }
  const prepare=r=>{
    if(opts.beautify!==false) beautifyResult(design,r);
    r.drcErrors=checkDRC(design,{...r,nets:[...r.nets,...manualRouteEntries(design)]},{dfm:false}).filter(i=>i.sev==='error').length;
    if(r.drcErrors) r.status='partial';
    return r;
  };
  const wt=await import('node:worker_threads').catch(()=>null);
  const Worker=wt&&wt.Worker;
  if(!Worker||K<2){
    // 回退：串行协商
    const best=routeBoard(design, {...opts, onProgress});
    return { result:best.result, session:best.session, fallback:true, timeMs:Date.now()-started };
  }
  const engineUrl=opts.engineUrl||null;
  if(!engineUrl) throw new Error('routeBoardIterParallel requires opts.engineUrl (worker 无法定位引擎)');
  // ---- 池初始化：K 个持久镜像会话 ----
  const pool=[];
  let poolId=0;
  const ready=await Promise.all(Array.from({length:K},(_,i)=>new Promise(res=>{
    const w=new Worker(`const {workerData,parentPort}=require('node:worker_threads');
      (async()=>{
        try{
          const core=await import(workerData.engineUrl);
          const session=core.createSession(workerData.design, workerData.opts);
          parentPort.on('message', msg=>{
            try{
              if(msg.cmd==='adopt'){ session.adoptShared(msg.shared); parentPort.postMessage({cmd:'ok', reqId:msg.reqId}); }
              else if(msg.cmd==='route'){ parentPort.postMessage({cmd:'results', reqId:msg.reqId, results:session.routeList(msg.ids)}); }
              else if(msg.cmd==='exit'){ parentPort.postMessage({cmd:'bye'}); }
            }catch(e){ parentPort.postMessage({cmd:'error', reqId:msg.reqId, error:String(e&&e.stack||e)}); }
          });
          parentPort.postMessage({cmd:'ready'});
        }catch(e){ parentPort.postMessage({cmd:'error', error:String(e&&e.stack||e)}); }
      })();`, {eval:true, workerData:{engineUrl, design, opts:plainOpts}});
    let readyDone=false;
    w.on('message', msg=>{
      if(msg.cmd==='ready'&&!readyDone){ readyDone=true; res(); }
      else if(msg.cmd==='error'){ console.error('iterParallel worker:', msg.error); if(!readyDone) res(); }
    });
    w.on('error', e=>{ console.error('iterParallel worker:', e); if(!readyDone) res(); });
    pool.push({w, i, lastError:null});
    w.on('message', msg=>{ if(msg.cmd==='error') pool[i].lastError=msg.error; });
  })));
  // ---- 主会话（权威状态）+ 并行迭代循环（finally 终止池——事件循环退出保证）----
  const mainSession=createSession(design, {...plainOpts, viaCost, maxIter});
  try{
  let reqSeq=0;
  const send=(w, sendMsg, expect, timeoutMs)=>{
    return new Promise(res=>{
      let done=false;
      const finish=v=>{ if(!done){ done=true; cleanup(); res(v); } };
      const reqId=++reqSeq;
      // 全路径收敛：应答 / 错误回复 / worker 崩溃 / 进程退出 / （仅 adopt）超时
      // ——漏一条就是永久挂起（iterWorkers 冒烟实测两次挂死教训）
      const onMsg=mm=>{
        if(mm.reqId!==reqId) return;
        if(mm.cmd===expect) finish(mm);
        else if(mm.cmd==='error') finish(null);   // worker 内部异常 → 调用方串行补跑
      };
      const onErr=()=>finish(null);
      const onExit=()=>finish(null);
      const cleanup=()=>{ w.off('message', onMsg); w.off('error', onErr); w.off('exit', onExit); };
      w.on('message', onMsg); w.once('error', onErr); w.once('exit', onExit);
      w.postMessage({...sendMsg, reqId});
      if(timeoutMs){
        const t=setTimeout(()=>finish(null), timeoutMs);
        if(t.unref) t.unref();
      }
    });
  };
  const broadcastAdopt=async shared=>{
    // postMessage 的 structured clone 自身可拷贝类型化数组（可加 transfer list 归零拷贝）
    // ——严禁 JSON 往返（5M 元素×6 数组×K worker×每迭代 = 挂死，实测教训）
    // 广播 adopt。任一 worker 未确认即视为该 worker 不可用——**必须剔除**，
    // 否则它会带着上一轮快照继续 route，产出对陈旧拥塞状态的结果（静默质量污染）。
    // adopt 失败不重试：60s 超时通常意味着 worker 已挂；剔除后由主线程补跑其份额。
    // **已剔除的 worker 不再发 adopt**：exit 事件不可靠（unref 计时器下进程可能
    // 先于事件退出），若仍对死 worker 等超时，每轮迭代都会白等 60s
    //（0.13.3 深度检查抓出的延迟 bug——死亡只发生一次，开销不能逐轮重复）。
    const liveNow=pool.filter(p=>p.alive!==false);
    const verdicts=await Promise.all(liveNow.map(p=>send(p.w, {cmd:'adopt', shared}, 'ok', 60000)));
    for(let i=0;i<liveNow.length;i++) if(!verdicts[i]&&liveNow[i].alive!==false){
      liveNow[i].alive=false;
      liveNow[i].lastError='adopt 未确认（剔除该 worker，其份额由主线程确定性补跑）';
    }
  };
  // 波次批处理（Jacobi→部分 Gauss-Seidel）：全网只见迭代起始快照时，协商收敛
  // 慢于串行（同迭代数 DRC 残留更多）——队列按 prio 切 W 个波次，波间提交可见
  // （部分 Gauss-Seidel），波内保持并行。W=1 即原 Jacobi 口径。
  // 默认 2 波：overuse 较 Jacobi 减半（254→119 实测）而时间 +25%；4 波丢连通（实测 74/77）
  const W=Math.max(1, Math.min(opts.iterWaves!=null?opts.iterWaves:2, 8));
  let iterCount=0;
  for(;;){
    const queueIds=mainSession.session.queue.map(n=>n.i);
    if(queueIds.length){
      const nWaves=Math.min(W, queueIds.length);
      for(let wv=0; wv<nWaves; wv++){
        const waveIds=queueIds.slice(Math.floor(queueIds.length*wv/nWaves), Math.floor(queueIds.length*(wv+1)/nWaves));
        if(!waveIds.length) continue;
        const shared=mainSession.exportShared();   // 含此前波次的提交（增量可见性）
        await broadcastAdopt(shared);
        // LPT 负载均衡（最长优先）：prio 序=短跨度在前，反转后长网先入各 worker
        // ——修尾部延迟（round-robin 下最后一批拿全是最长网）
        // 死掉的 worker 不参与分成：其份额直接归主线程（确定性补跑），
        // 而不是"分给它再超时补跑"（那是时序相关的，digest 会随负载漂移）。
        const order=[...waveIds].reverse();
        const live=pool.filter(p=>p.alive!==false);
        const batches=new Map(live.map(p=>[p.i,[]]));
        const dead=[];
        if(!live.length) dead.push(...order);
        else {
          // 空间分片（#13b）：按区域亲和分批，让同一分片内的网在同一 worker 内
          // 串行可见（冲突立刻暴露），而不是被摊到所有 worker 后靠多轮协商收敛。
          // shard<2 或分片不可用 → 原 LPT 路径（位级不变）。
          const sr=mainSession.shardQueue(opts.shard||0);
          if(sr && sr.groups.length>1 && live.length>1){
            sr.groups.forEach((g,gi)=>{
              const ids=g.map(n=>n.i).filter(id=>waveIds.indexOf(id)>=0);
              if(ids.length) batches.get(live[gi%live.length].i).push(...ids);
            });
            const covered=new Set();
            for(const a of batches.values()) for(const id of a) covered.add(id);
            const rest=order.filter(id=>!covered.has(id));
            if(rest.length){
              let mi=live[0].i, mn=Infinity;
              for(const p of live){ const n=batches.get(p.i).length; if(n<mn){ mn=n; mi=p.i; } }
              batches.get(mi).push(...rest);
            }
          } else {
            order.forEach((id,idx)=>{
              const p=live[idx%live.length];
              batches.get(p.i).push(id);
            });
          }
        }
        const results=new Map();
        // 死 worker 的份额：主线程按 id 升序确定性补跑（与完成时序无关）
        if(dead.length) for(const r of mainSession.routeList(dead.sort((a,b)=>a-b))) results.set(r.i,r);
        await Promise.all(live.map(async p=>{
          const ids=batches.get(p.i);
          if(!ids||!ids.length) return;
          // 120s 兜底超时：正常远小于此；超时走串行补跑（worker 晚到的结果按 reqId 丢弃）
          const mm=await send(p.w, {cmd:'route', ids}, 'results', 120000);
          if(mm&&mm.results){ for(const r of mm.results) results.set(r.i, r); }
          if(!mm||!mm.results){
            // worker 失败：剔除并串行补跑该批（按 id 升序，确定性）
            p.alive=false;
            for(const r of mainSession.routeList([...ids].sort((a,b)=>a-b))) results.set(r.i, r);
          }
        }));
        // 串行 commit（按队列 prio 序，tie 语义保持）；末波才清队列
        const ordered=waveIds.map(id=>results.get(id)).filter(Boolean);
        mainSession.commitRoutes(ordered, wv===nWaves-1, 'better');
      }
    }
    // 迭代边界评估（阶段转换/几何修正/历史增量/邻域拆除/完成判定/队列重建）
    const it=mainSession.beginIteration();
    if(it&&it.done) break;
    iterCount++;
    // 会话重放（onStage 一致性：串行模式有逐阶段留痕，并行同口径）
    if(opts.onStage){
      const st=mainSession.session;
      const fN=[...st.nets].reduce((a,n2)=>a+(n2.failed>0?1:0),0);
      opts.onStage({ stage:'并行协商 第'+iterCount+'轮', iter:iterCount,
        overuse:st.overuse.length, failedNets:fN,
        workers:K, waves:W });
    }
    onProgress({text:'并行协商 · 第'+iterCount+'轮 · '+queueIds.length+'网 · '+K+'worker×'+W+'波',
      frac:Math.min(0.9, 0.15+0.85*iterCount/maxIter)});
  }
  // 与串行 routeBoard 同语义：协商后逐网优化（否则质量对照不公平）
  mainSession.optimize(2, ()=>{});
    const result=prepare(mainSession.buildResult());
    result.timeMs=Date.now()-started;
    onProgress({text:'完成',frac:1});
    return { result, session:mainSession, workers:pool.length, iterations:iterCount, timeMs:result.timeMs };
  }finally{
    for(const p of pool){ try{ p.w.postMessage({cmd:'exit'}); p.w.terminate(); }catch{} }
  }
}
/* ---------- 并行候选布线（roadmap 阶段一 #4 的可落地增量）----------
   借鉴（源码研读）：freerouting BatchOptimizer——协商串行、optimizer 按候选项并行
   （固定线程池 + ThreadLocal 私有板深拷贝 + 串行合并赢家 + 连续失败早停）；
   OpenROAD FlexDR——迭代串行、每迭代 worker 批次并行 + 串行 applyUpdates。
   共同原则：共享拥塞状态是串行依赖，并行的单元=彼此无共享写的独立候选评估。
   我们的对应物：routeBoard 的多配置候选重跑——每候选=独立完整会话 →
   worker_threads 并行（Node），浏览器无 worker_threads 自动回退串行。
   语义演进：串行版只优化最优候选；并行版每候选都优化再取最优（质量 ≥ 串行）。 */
async function routeBoardParallel(design, opts={}){
  const started=Date.now();
  const first=routeBoard(design, {...opts, optimize:false});
  let bestResult=first.result, bestFrom='初始布线';
  if(opts.optimize!==false){
    const viaCost=opts.viaCost??15;
    const candidates=first.result.status==='complete'
      ?[{vc:viaCost*4},{vc:viaCost*10},{vc:viaCost,extra:{layerDir:false}}]
      :[{vc:viaCost*0.3},{vc:viaCost*0.1}];
    const plainOpts={...opts, onProgress:undefined, onStage:undefined};
    const finishWith=(session, design2)=>{
      session.optimize(2, ()=>{});
      const r=session.buildResult();
      beautifyResult(design2, r);
      r.drcErrors=checkDRC(design2, {...r, nets:[...r.nets, ...manualRouteEntries(design2)]}, {dfm:false}).filter(i=>i.sev==='error').length;
      if(r.drcErrors) r.status='partial';
      return r;
    };
    // worker_threads 可用性（浏览器构建自动回退串行）。
    // engineUrl 必须由调用方传入（Node ESM 的模块元属性在经典 <script> 内联构建里
    // 是解析期语法错误——引擎本体不得出现该语法，实测 GUI 全灭教训）：
    // CLI/测试用 pathToFileURL 构造传入；缺省 → 串行回退。
    let Worker=null;
    try{ const wt=await import('node:worker_threads'); Worker=wt.Worker; }catch{ Worker=null; }
    let hw=4;
    try{ const os=await import('node:os'); hw=os.cpus().length; }catch{ hw=4; }
    const engineUrl=opts.engineUrl||null;
    const K=Math.max(1, Math.min(opts.parallel||Math.max(1,hw-1), 8, candidates.length));
    if(Worker&&engineUrl&&K>1){
      // 候选分桶到 K 个 worker（桶内串行），结果按提交序收集（tie 保持候选序）
      const buckets=Array.from({length:Math.min(K,candidates.length)},()=>[]);
      candidates.forEach((c,i)=>buckets[i%buckets.length].push({i,c}));
      const results=new Array(candidates.length).fill(null);
      const candWorkers=[];
      await Promise.all(buckets.map(bucket=>new Promise(res=>{
        const w=new Worker(`const {workerData,parentPort}=require('node:worker_threads');
          (async()=>{
            try{
              const core=await import(workerData.engineUrl);
              for(const job of workerData.jobs){
                const design2=workerData.design;
                const {session}=core.routeBoard(design2, {...workerData.opts, viaCost:job.c.vc, ...(job.c.extra||{}), optimize:false});
                session.optimize(2, ()=>{});
                const r=session.buildResult();
                core.beautifyResult(design2, r);
                r.drcErrors=core.checkDRC(design2, {...r, nets:[...r.nets, ...core.manualRouteEntries(design2)]}, {dfm:false}).filter(i=>i.sev==='error').length;
                if(r.drcErrors) r.status='partial';
                parentPort.postMessage({i:job.i, result:r, score:core.routeScore(r)});
              }
              parentPort.postMessage({done:true});
            }catch(e){ parentPort.postMessage({error:String(e&&e.stack||e)}); }
          })();`, {eval:true, workerData:{engineUrl, design:design, opts:plainOpts, jobs:bucket}});
        let pending=bucket.length;
        w.on('message', msg=>{
          if(msg.error){ console.error('routeParallel worker:', msg.error); return; }
          if(msg.done){ res(); return; }
          results[msg.i]={result:msg.result, score:msg.score};
        });
        w.on('error', e=>{ console.error('routeParallel worker:', e); res(); });
        w.on('exit', ()=>res());   // 兜底：消息丢失也要 resolve
        candWorkers.push(w);
      })));
      for(const b of buckets) for(const j of b){ /* 全部结果已收集 */ }
      for(const cw of candWorkers){ try{ cw.terminate(); }catch{} }   // 事件循环退出保证
      // worker 失败的候选项自动串行补跑（URL 错误/worker 崩溃等）——并行永不劣于串行
      for(let i=0;i<results.length;i++){
        if(results[i]) continue;
        const c=candidates[i];
        const {session}=routeBoard(design, {...opts, viaCost:c.vc, ...(c.extra||{}), optimize:false});
        results[i]={result:finishWith(session, design), score:null};
        results[i].score=routeScore(results[i].result);
      }
      for(let i=0;i<results.length;i++){
        const r2=results[i];
        if(r2&&scoreBetter(r2.score, routeScore(bestResult))){ bestResult=r2.result; bestFrom='并行候选 '+(i+1); }
      }
    }else{
      for(let i=0;i<candidates.length;i++){
        const c=candidates[i];
        const {session}=routeBoard(design, {...opts, viaCost:c.vc, ...(c.extra||{}), optimize:false});
        const r2=finishWith(session, design);
        if(scoreBetter(routeScore(r2), routeScore(bestResult))){ bestResult=r2; bestFrom='串行候选 '+(i+1); }
      }
    }
  }
  if(!bestResult.timeMs) bestResult.timeMs=Date.now()-started;
  return { result:bestResult, session:null, from:bestFrom,
    parallel:{ enabled:!!(opts.optimize!==false), timeMs:Date.now()-started } };
}
function placeAndRoute(design, opts){
  opts=opts||{};
  const rounds=Math.max(1, opts.rounds||3);
  // 栅格前提：grid ≥ 最大线宽 + clearance（电源网加宽后可能需要调大）
  const minGrid=minimumRoutingGrid(design);
  if(design.grid<minGrid-1e-9){
    design.grid=minGrid;
    snapPadsPreserveGroups(design);
  }
  let best=null; const log=[];
  const specPads=JSON.parse(JSON.stringify(design.pads)), specComps=JSON.parse(JSON.stringify(design.comps||{}));
  let hotspots=[]; let prevScore=null;
  // 种子/起始策略（n40/n49/n51 三案例验证）：
  // 默认：warmStart 延续 + 同种子（n49/n51 的翻盘依赖 warmStart+热点反馈+同 RNG 延续）；
  // 停滞（上轮相对历史最优无改进）：下一轮**全新起始**（非 warm）+ 换种子
  // ——warm 状态下换 RNG 逃不出盆地（n40 r3 实测 34/35），fresh+换种子才能（n40 exp-seed 实测）。
  let divergeNext=false;
  for(let round=0;round<rounds;round++){
    if(divergeNext){ design.pads=JSON.parse(JSON.stringify(specPads)); design.comps=JSON.parse(JSON.stringify(specComps)); hotspots=[]; }
    autoPlace(design,{iterations:opts.iterations||4000, anchor:opts.anchor,
                      hotspots, warmStart:round>0&&!divergeNext, restarts:round>0&&!divergeNext?2:4,
                      hotspotWeight:round>0&&!divergeNext?Math.max(8000, 50000/round):0,
                      seed:(opts.seed??42)+(divergeNext?round+1:0)});
    if(typeof process!=='undefined'&&process.env.PCB_DBG) process.stderr.write(`DBG round=${round} seed=${(opts.seed??42)+(divergeNext?round+1:0)} warm=${round>0&&!divergeNext} hs=${hotspots.length}
`);
    const {result:r}=routeBoard(design,{...opts,viaCost:opts.viaCost??15,maxIter:opts.maxIter??60,stagePrefix:'R'+(round+1)});
    const score=routeScore(r);
    log.push({round:round+1, status:r.status, connected:r.stats.connected, total:r.stats.total,
              overuse:r.overuse.length, vias:r.stats.vias, score});
    const improved=!prevScore||scoreBetter(score.slice(0,4),prevScore.slice(0,4));   // 只看布通/失败/DRC/拥塞——过孔与线长的化妆性改进不算（否则停滞永远检不出）
    prevScore=score;
    if(!best||scoreBetter(score,best.score))
      best={score, pads:JSON.parse(JSON.stringify(design.pads)),
            comps:JSON.parse(JSON.stringify(design.comps||{})), result:r};
    divergeNext=!improved;   // 相邻轮无改进 → 下轮全新起始+换种子（停滞自适应）
    if(r.status==='complete'&&!r.overuse.length) break;
    hotspots=computeHotspots(design,r);
    // 第十一轮重放工具发现：100% 连通但 DRC 脏的板（如 p10 走线-焊盘贴边）在此提前退出，
    // DRC 违规从未获得后续轮次的修复机会。改为 DRC 脏时继续轮次——diverge 机制（换种子
    // 全新起始）提供布局多样性，routeScore 的 drcErrors 位保证更干净的轮胜出。
    if(!hotspots.length && !r.drcErrors) break;
  }
  if(best){ design.pads=best.pads; design.comps=best.comps; }
  return {best:best?best.result:null, log};
}

/* ---------- 嘉立创EDA（标准版）PCB JSON 导出 ----------
   文件 = {head(docType:"3"), canvas, shape[], BBox}；图元为 ~ 分隔字符串。
   格式依据 docs.easyeda.com Document Format + easyeda2kicad 解析器 + KiCad
   DOC_TYPE 枚举交叉核实：单位 1 = 10 mil (0.254mm)；层号 1=顶层 2=底层
   3=顶丝印 4=底丝印 10=边框 11=多层(通孔)；板框 = SOLIDREGION layer 10
   type boardoutline（SVG M/L/Z 路径）。坐标不翻转（同为屏幕 y 向下）。 */
function exportEasyEdaPcb(design, nets, pour){
  const pourList=Array.isArray(pour)?pour.filter(Boolean):(pour?[pour]:[]);
  const u=mm=>+(mm/0.254).toFixed(3);
  const L=Math.max(1,design.layers|0);
  // 层号：1=顶层 2=底层；4 层板内层 In1=21 / In2=22（嘉立创标准版层表核实）
  const layerOf=l=>{
    if(l<=0) return '1';
    if(l>=L-1) return '2';
    if(L>=4) return String(21+(l-1));
    return '3';
  };
  const layerOfPad=p=> p.layer==='both'?'11':(p.layer==='bottom'?'2':'1');
  // 网名消毒：EasyEDA 的 ~ 分隔格式容不下网名里的 ~ 和 |（KiCad 层级网名
  // 如 /FLASH_~{WP}|IO2 实测会错位整个 shape 字段）——替换为 _
  const netName=id=> ((design.nets.find(n=>n.id===id)||{}).name||'').replace(/[~|]/g,'_');
  let gid=1; const nid=()=>'gge'+(gid++);
  const shapes=[];
  const w=u(design.width), h=u(design.height);
  shapes.push(`SOLIDREGION~10~~M 0,0 L ${w},0 L ${w},${h} L 0,${h} Z~boardoutline~boardoutlinename~0`);
  for(const p of design.pads||[]){
    const net=p.netId!=null?netName(p.netId):'';
    const i=p.id.lastIndexOf('-');
    const number=i>0?p.id.slice(i+1):'1';
    const th=p.layer==='both';
    const holeR=th?u(p.holeR!=null?p.holeR:design.viaDrill/2):0;
    const shape=p.shape==='circle'?'ELLIPSE':'RECT';
    shapes.push(`PAD~${shape}~${u(p.x)}~${u(p.y)}~${u(p.w)}~${u(p.h)}~${layerOfPad(p)}~${net}~${number}~${holeR}~{}~0~${nid()}~0~~Y~0`);
  }
  // 丝印位号：design.comps 元数据优先；无元数据按焊盘 bbox 中心推导
  design.comps=design.comps||{};
  const compGroups=new Map();
  for(const p of design.pads||[]){
    const i=p.id.lastIndexOf('-');
    const g=i>0?p.id.slice(0,i):p.id;
    if(!compGroups.has(g)) compGroups.set(g,[]);
    compGroups.get(g).push(p);
  }
  for(const [comp,ps] of compGroups){
    const meta=design.comps[comp]||{};
    let cx=meta.x, cy=meta.y;
    if(cx==null||cy==null){
      let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
      for(const p of ps){ x0=Math.min(x0,p.x-p.w/2); y0=Math.min(y0,p.y-p.h/2); x1=Math.max(x1,p.x+p.w/2); y1=Math.max(y1,p.y+p.h/2); }
      cx=(x0+x1)/2; cy=(y0+y1)/2;
    }
    const layer=(meta.layer==='bottom'||(!meta.layer&&ps.every(p=>p.layer==='bottom')))?'4':'3';   // 3=顶丝印 4=底丝印
    const rot=meta.rot||0;
    // 丝印防碰撞：字高 ≈1.0mm（fontSize 4 单位）；位号压到焊盘（油墨上焊盘是
    // 嘉立创 DFM 警告项）或出板时，沿 8 方向逐环外移找空位；找不到则保中心
    const hMM=4*0.254, wMM=Math.max(hMM, comp.length*hMM*0.62);
    const collides=(tx,ty)=>{
      if(tx-wMM/2<0.2||ty-hMM/2<0.2||tx+wMM/2>design.width-0.2||ty+hMM/2>design.height-0.2) return true;
      for(const p of design.pads||[]){
        if(layer==='3'&&p.layer==='bottom') continue;   // 顶丝印不撞底层焊盘
        if(layer==='4'&&p.layer==='top') continue;
        if(Math.abs(tx-p.x)<(wMM+p.w)/2+0.25 && Math.abs(ty-p.y)<(hMM+p.h)/2+0.25) return true;
      }
      return false;
    };
    let sx=cx, sy=cy;
    if(collides(sx,sy)){
      const half=Math.max(...ps.map(p=>Math.max(p.w,p.h)))/2+0.8;
      silkOuter:
      for(let ring=0;ring<3;ring++){
        const rad=half+ring*1.0;
        for(const [dx,dy] of [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]])
          if(!collides(cx+dx*rad, cy+dy*rad)){ sx=cx+dx*rad; sy=cy+dy*rad; break silkOuter; }
      }
    }
    // 字段序核自真实导出：TEXT~L~x~y~fontSize~rot~mirror~layerid~net~height~text~path~fill~id~font~locked~source
    shapes.push(`TEXT~L~${u(sx)}~${u(sy)}~4~${rot}~0~${layer}~~12~${comp}~~~${nid()}~NotoSerifCJKsc-Medium~0~~`);
  }
  for(const n of nets||[]){
    const net=netName(n.netId);
    for(const path of n.paths||[]){
      // 换层处拆成单层 TRACK
      let run=[path[0]];
      for(let k=1;k<path.length;k++){
        if(path[k].l===path[k-1].l) run.push(path[k]);
        else{
          if(run.length>1)
            shapes.push(`TRACK~${u(netW(design, n.netId))}~${layerOf(run[0].l)}~${net}~${run.map(pt=>`${u(pt.x)} ${u(pt.y)}`).join(' ')}~${nid()}~0`);   // 官方格式：空格分隔点串（2026-11-15 修正：花括号+逗号格式 Pro 导入不识别）
          run=[path[k]];
        }
      }
      if(run.length>1)
        shapes.push(`TRACK~${u(netW(design, n.netId))}~${layerOf(run[0].l)}~${net}~${run.map(pt=>`${u(pt.x)} ${u(pt.y)}`).join(' ')}~${nid()}~0`);   // 官方格式：空格分隔点串（2026-11-15 修正：花括号+逗号格式 Pro 导入不识别）
    }
    for(const v of n.vias||[])
      shapes.push(`VIA~${u(v.x)}~${u(v.y)}~${u(design.viaOuter)}~${net}~${u(design.viaDrill/2)}~${nid()}~0`);
  }
  // 覆铜：COPPERAREA 存"区域+参数"（字段序经 pcb-rnd io_easyeda 解析器核实：
  // stroke_width~layer~net~path~clearance~fill~id~thermal~keep_island~zone~locked），
  // 嘉立创EDA打开后按参数自行重铺。fill=solid/grid（EasyEDA fillStyle 同名值）；
  // keep_island：islandMode=never 时置 1。路径给板框区域；支持多块铜皮逐条导出。
  for(const po of pourList){
    if(!po||!po.polys||!po.polys.length) continue;
    const net=netName(po.netId);
    const fillStyle=po.fill==='grid'?'grid':'solid';
    const keepIsland=po.islandMode==='never'?'1':'0';
    // thermalActive=false（筋条窄于最小铜宽退化为实心）时 EasyEDA 侧也按无热焊盘导出
    const th=(po.thermalActive!=null?po.thermalActive:po.thermal!==false)?'1':'0';
    shapes.push(`COPPERAREA~2~${layerOf(po.layer||0)}~${net}~M 0,0 L ${w},0 L ${w},${h} L 0,${h} Z~${u(design.clearance)}~${fillStyle}~${nid()}~${th}~${keepIsland}~~0`);
  }
  return JSON.stringify({
    head:{docType:'3', editorVersion:'6.5.54', x:0, y:0, title:'pcb'},
    // canvas 对齐真实导出（CA 前缀 + ~ 分隔 20 字段；[16]/[17] 为画布原点，坐标自 (0,0) 绝对）
    canvas:'CA~1000~1000~#000000~yes~#FFFFFF~10~1000~1000~line~9.8425~mm~1~45~visible~0.5~0~0~1~yes',
    shape:shapes,
    BBox:{x:0, y:0, w, h}
  });
}

/* ---------- 每网线宽（网络类）----------
   nets[].w 覆盖全板 design.trackW：电源网加宽（如 VCC/GND 设 0.5）、信号网默认。
   栅格前提与间距审计按最大线宽校验（grid ≥ maxW + clearance，保守保证）。 */
const _netWCache=new WeakMap();   // 深度优化（0.11.0）：netW 热路径缓存——存 net 对象引用（w 现读，原地改 nets[i].w 立即生效；nets 数组换代即重建）
function netW(design, netId){
  if(netId!=null){
    let c=_netWCache.get(design);
    if(!c||c.nets!==design.nets){
      const map=new Map();
      // 载流感知自动定档（第十一轮后用户指令：根据电流大小调线粗）：
      // nets[].current（A, RMS）→ IPC-2152 反查（w = base_s × I^1.113）→ 原地抬宽
      // （仅抬不降）。maxTrackW 下次调用自然读到新值 → 栅格/影响区/布线全链生效。
      // 一次性计算（缓存在 _netWCache 生命周期内），热路径零额外开销。
      for(const n of (design.nets||[])){
        if(n.current!=null&&Number.isFinite(+n.current)&&+n.current>0){
          const need=ampWidthFor(design,+n.current).width;
          if((n.w||0)<need) n.w=need;
        }
      }
      for(const n of (design.nets||[])) map.set(n.id,n);
      c={nets:design.nets, map};
      _netWCache.set(design,c);
    }
    const n=c.map.get(netId);
    if(n&&n.w) return n.w;
  }
  return design.trackW;
}
function maxTrackW(design){
  return Math.max(design.trackW, ...((design.nets||[]).map(n=>n.w||0)));
}

/* ---------- 载流感知线宽定档（IPC-2152 锚点插值）----------
   用户在规格书里读到某网走 3A → 声明 nets[].current=3（A, RMS）→
   ampWidthFor 按 铜厚/层位/公差 反查所需线宽（s=建议口径缺省）。
   正向公式（投板检查表在用）：I = (w/base)^(1/1.113)；反向：w = base × I^1.113。
   maxTrackW 全板生效（L37）：线宽加大 → 栅格变粗 → 调用方必须报告节距冲突
   （minimumRoutingGrid 自动调整 + L37 节距公式由 spec 门/检查表输出）。 */
/* 过孔载流孔径折算（0.14.7 批次1 A1）：barrel 铜截面 ≈ π·D·t（镀铜厚 t 固定），
   载流一阶 ∝ 孔径——锚点 (0.3mm, 1A) 线性折算。0.4→1.33A、0.2→0.67A。
   一阶口径：未含纵横比/温升二阶效应，检查表行如实标注锚点与折算式。 */
function viaAmpFor(design){
  const d=design.viaDrill>0?design.viaDrill:JLC.viaAmpRef;
  return JLC.viaAmp*(d/JLC.viaAmpRef);
}
function ampWidthFor(design, amps, opts={}){
  const oz=String(design.copperWeight||1);
  const inner=opts.layer==='inner';
  const bank=inner?(JLC.amp.inner[oz]||JLC.amp.inner['0.5']):(JLC.amp.outer[oz]||JLC.amp.outer['1']);
  const anchor=opts.anchor==='t'?'t':'s';    // s=建议口径（缺省，保守）
  const base=bank[anchor]!=null?bank[anchor]:bank.t;
  const tol=opts.tolerance!=null?opts.tolerance:1;   // 1=足宽；0.8=按 −20% 线宽公差校核
  if(!Number.isFinite(amps)||amps<=0) throw new Error('amps must be a positive number');
  const width=+(base*Math.pow(amps,1.113)/tol).toFixed(3);
  return { width, anchor, oz, layer:inner?'inner':'outer', tolerance:tol, viaCount:Math.max(1,Math.ceil(amps/viaAmpFor(design))) };
}
function netCurrentDecls(design){
  // 声明了 current 的网（A, RMS）：[{netId,name,current,w,required,requiredLimit,vias}]
  // required=s 建议口径；requiredLimit=t 理论极限 + −20% 公差（低于则 fail）
  const out=[];
  for(const n of (design.nets||[])){
    if(n.current==null||!Number.isFinite(+n.current)||+n.current<=0) continue;
    const req=ampWidthFor(design,+n.current,{});
    const lim=ampWidthFor(design,+n.current,{anchor:'t',tolerance:0.8});
    out.push({netId:n.id,name:n.name,current:+n.current,w:netW(design,n.id),
      required:req.width,requiredLimit:lim.width,vias:req.viaCount});
  }
  return out;
}
/* ---------- IPC-2221B 电压→安全间距（第十一轮后 L48）----------
   规格/数据手册里读到某网走 170V → 声明 nets[].voltage=170 → 自动查表得
   该网的最低安全间距。正反关系是"声明→标准查表→max(全局,标准)"。
   三档：B1 内层 / B2 外层有涂层 / B4 外层无涂层（打样默认最严格）。 */
function ipc2221Clr(voltage, table){
  // IPC-2221B Table 6-1 阶梯查表：V[i] 是档位上界，≤V[i] 用 C[i]（线性插值不适用——
  // 标准本身是阶梯表）；>500V 按标准线性外推（perV mm/V）。缺省 B2=外层无涂层
  // ≤3050m（打样缺省最严外层口径）。
  const T=table||'B2';
  const TBL=JLC.ipc2221b;
  const V=TBL.V, C=TBL[T]||TBL.B2;
  if(!Number.isFinite(voltage)||voltage<=0) return C[0];
  for(let i=0;i<V.length;i++){
    if(voltage<=V[i]) return C[i];
  }
  const pv=TBL.perV&&TBL.perV[T]!=null?TBL.perV[T]:(TBL.B2[TBL.B2.length-1]/TBL.V[TBL.V.length-1]);
  return +(pv*voltage).toFixed(3);   // >500V：标准线性外推（B2 0.005mm/V）
}
function netClrDecls(design){
  // 声明了 voltage 的网（V）：[{netId,name,voltage,w,clr,globalClr,status}]
  const out=[];
  for(const n of (design.nets||[])){
    if(n.voltage==null||!Number.isFinite(+n.voltage)||+n.voltage<=0) continue;
    const table=ipcTableFor(design);
    const need=ipc2221Clr(+n.voltage, table);
    const w=netW(design,n.id);
    out.push({netId:n.id,name:n.name,voltage:+n.voltage,w,
      clr:Math.max(need, netClr(design,n.id)),table,globalClr:design.clearance,
      status:w>0&&design.clearance+1e-9>=need?'ok':'under'});
  }
  return out;
}
/* IPC-2221B 档位选择（0.14.7 批次2 A2，标准列语义）：design.coating 声明
   三防漆（聚合物涂层）→ 外层走 B4（涂层）档，否则 B2（无涂层，最严）。
   简化声明：B1 内层间距恒 ≤ 无涂层外层档，外层口径对内层恒保守——不区分布线层位。 */
function ipcTableFor(design){
  return design&&design.coating==='coated'?'B4':'B2';
}
function netClr(design, netId){
  // 逐网有效间距：max(全局, IPC-2221B 电压查表[coating 档], classClr)——三来源单一事实源
  let clr=design.clearance;
  if(netId!=null){
    const n=(design.nets||[]).find(x=>x.id===netId);
    if(n){
      if(n.clr!=null&&Number.isFinite(n.clr)&&n.clr>clr) clr=n.clr;
      if(n.voltage!=null&&Number.isFinite(+n.voltage)&&+n.voltage>0)
        clr=Math.max(clr, ipc2221Clr(+n.voltage, ipcTableFor(design)));
    }
  }
  return clr;
}

/* ---------- 嘉立创器件库对接（LCSC/EasyEDA API）与原理图导出 ----------
   器件数据来自 easyeda.com/api/products/{C编号}/components（一次返回真符号 docType 2
   + 真封装 packageDetail.dataStr docType 4）。封装坐标减 canvas 原点（分隔符 ~ 或 |，
   取 [16]/[17]）后 ×0.254mm。符号 P 原语 7 段结构（P/settings^^dot^^path^^name^^
   number^^dotbis^^clock）与 LIB 多形状分隔（#@$/#$#）经 KiCad 解析器与真实 API
   样例双重核实。 */
function _eeCanvasOrigin(canvas){
  const parts=String(canvas||'').split(/[~|]/);
  const x=parseFloat(parts[16]), y=parseFloat(parts[17]);
  return {x:isFinite(x)?x:0, y:isFinite(y)?y:0};
}
// 解析嘉立创器件：symbolDoc/footprintDoc 为 API 返回的 dataStr 对象
function parseEasyEdaDevice(symbolDoc, footprintDoc){
  const U=0.254;   // 1 EasyEDA 单位 = 10 mil
  const pins=[], texts=[], graphics=[];
  let sx0=1e9, sy0=1e9, sx1=-1e9, sy1=-1e9;
  for(const sh of (symbolDoc&&symbolDoc.shape)||[]){
    const f=sh.split('~'), t=f[0];
    if(t==='P'){
      const seg=sh.split('^^').map(x=>x.split('~'));
      const st=seg[0];
      pins.push({ number:String(st[3]||''), x:parseFloat(seg[1][0]), y:parseFloat(seg[1][1]), rot:parseFloat(st[6])||0 });
    } else if(t==='T'){
      texts.push({ type:f[1], x:parseFloat(f[2]), y:parseFloat(f[3]), text:(f[12]||'').replace(/\\n/g,' ') });
    } else if(t==='PL'){
      const pts=f[1].trim().split(/[\s,]+/).map(Number);
      for(let k=0;k+1<pts.length;k+=2){ sx0=Math.min(sx0,pts[k]); sy0=Math.min(sy0,pts[k+1]); sx1=Math.max(sx1,pts[k]); sy1=Math.max(sy1,pts[k+1]); }
      graphics.push(sh);
    } else if(t==='R'){
      sx0=Math.min(sx0,parseFloat(f[1])); sy0=Math.min(sy0,parseFloat(f[2]));
      sx1=Math.max(sx1,parseFloat(f[1])+parseFloat(f[3])); sy1=Math.max(sy1,parseFloat(f[2])+parseFloat(f[4]));
      graphics.push(sh);
    }
  }
  for(const p of pins){ sx0=Math.min(sx0,p.x); sy0=Math.min(sy0,p.y); sx1=Math.max(sx1,p.x); sy1=Math.max(sy1,p.y); }
  // 封装：PAD 相对 canvas 原点换算 mm
  const pads=[];
  const fpDoc=(footprintDoc&&footprintDoc.shape)?footprintDoc:((footprintDoc&&footprintDoc.dataStr)?(typeof footprintDoc.dataStr==='string'?JSON.parse(footprintDoc.dataStr):footprintDoc.dataStr):null);
  const org=_eeCanvasOrigin(fpDoc&&fpDoc.canvas);
  for(const sh of (fpDoc&&fpDoc.shape)||[]){
    if(!sh.startsWith('PAD~')) continue;
    const f=sh.split('~');
    const layerId=f[6];
    pads.push({
      number:String(f[8]||''),
      x:+(((parseFloat(f[2])-org.x)*U)).toFixed(4),
      y:+(((parseFloat(f[3])-org.y)*U)).toFixed(4),
      w:+(parseFloat(f[4])*U).toFixed(4),
      h:+(parseFloat(f[5])*U).toFixed(4),
      shape:f[1]==='ELLIPSE'||f[1]==='CIRCLE'?'circle':'rect',
      layer:layerId==='11'?'both':(layerId==='2'?'bottom':'top'),
      holeR:+(parseFloat(f[9])*0.254).toFixed(4)
    });
  }
  let fx0=1e9,fy0=1e9,fx1=-1e9,fy1=-1e9;
  for(const p of pads){ fx0=Math.min(fx0,p.x-p.w/2); fy0=Math.min(fy0,p.y-p.h/2); fx1=Math.max(fx1,p.x+p.w/2); fy1=Math.max(fy1,p.y+p.h/2); }
  return { pins, texts, graphics, symbolBBox:{x0:sx0,y0:sy0,x1:sx1,y1:sy1},
           pads, footprintBBox:{w:+(fx1-fx0).toFixed(3), h:+(fy1-fy0).toFixed(3)} };
}

// 原理图 SVG 路径平移（M/L/H/V 绝对命令平移，小写相对命令不动）
function _eeTransPath(path, dx, dy){
  return path.replace(/[MLHVmlhv][^MLHVmlhv]*/g, cmd=>{
    const c=cmd[0], nums=cmd.slice(1).trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if(c==='M'||c==='L'){ for(let i=0;i+1<nums.length;i+=2){ nums[i]+=dx; nums[i+1]+=dy; } }
    else if(c==='H'){ for(let i=0;i<nums.length;i++) nums[i]+=dx; }
    else if(c==='V'){ for(let i=0;i<nums.length;i++) nums[i]+=dy; }
    else return cmd;
    return c+' '+nums.join(' ');
  });
}
function _eeTransShape(sh, dx, dy){
  const f=sh.split('~'), t=f[0];
  if(t==='P'){
    const seg=sh.split('^^').map(x=>x.split('~'));
    seg[0][4]=+(parseFloat(seg[0][4])+dx).toFixed(4); seg[0][5]=+(parseFloat(seg[0][5])+dy).toFixed(4);
    seg[1][0]=+(parseFloat(seg[1][0])+dx).toFixed(4); seg[1][1]=+(parseFloat(seg[1][1])+dy).toFixed(4);
    if(seg[2]&&seg[2][0]) seg[2][0]=_eeTransPath(seg[2][0],dx,dy);
    if(seg[3]){ seg[3][1]=+(parseFloat(seg[3][1])+dx).toFixed(4); seg[3][2]=+(parseFloat(seg[3][2])+dy).toFixed(4); }
    if(seg[4]){ seg[4][1]=+(parseFloat(seg[4][1])+dx).toFixed(4); seg[4][2]=+(parseFloat(seg[4][2])+dy).toFixed(4); }
    if(seg[5]&&seg[5].length>1){ seg[5][0]=+(parseFloat(seg[5][0])+dx).toFixed(4); seg[5][1]=+(parseFloat(seg[5][1])+dy).toFixed(4); }
    if(seg[6]&&seg[6].length>1&&seg[6][1]) seg[6][1]=_eeTransPath(seg[6][1],dx,dy);
    return seg.map(x=>x.join('~')).join('^^');
  }
  if(t==='PL'){
    const pts=f[1].trim().split(/[\s,]+/).map(Number);
    for(let k=0;k+1<pts.length;k+=2){ pts[k]+=dx; pts[k+1]+=dy; }
    f[1]=pts.join(' ');
    return f.join('~');
  }
  if(t==='R'){ f[1]=+(parseFloat(f[1])+dx).toFixed(4); f[2]=+(parseFloat(f[2])+dy).toFixed(4); return f.join('~'); }
  if(t==='T'){ f[2]=+(parseFloat(f[2])+dx).toFixed(4); f[3]=+(parseFloat(f[3])+dy).toFixed(4); return f.join('~'); }
  return sh;
}
// 通用符号（无嘉立创库数据时的兜底）：矩形 + 左右两排引脚
function _eeGenericSymbol(comp, pinNums){
  const perSide=Math.ceil(pinNums.length/2);
  const W=40, H=Math.max(30, perSide*15+10);
  const shapes=[], pins=[];
  pinNums.forEach((num,idx)=>{
    const left=idx<perSide, k=left?idx:idx-perSide;
    const py=(k-(perSide-1)/2)*15;
    const px=left?-W/2-10:W/2+10, bx=left?-W/2:W/2;
    const rot=left?180:0;
    shapes.push(`P~show~0~${num}~${px}~${py}~${rot}~gge${comp}${num}~0^^${px}~${py}^^M ${bx} ${py} h ${left?-10:10}~#800^^0~${bx+(left?6:-6)}~${py}~0~${num}~start~~~#800^^0~${bx+(left?4:-4)}~${py-4}~0~${num}~end~~~#800^^0~0~0^^0~M 0 0 L 0 0`);
    pins.push({ number:String(num), x:px, y:py });
  });
  shapes.push(`PL~${-W/2} ${-H/2} ${W/2} ${-H/2} ${W/2} ${H/2} ${-W/2} ${H/2} ${-W/2} ${-H/2}~#840000~1~0~none~ggebox~0`);
  shapes.push(`T~P~${-W/2-6}~${-H/2-6}~0~#840000~~7~1~1~start~${comp}~~start`);
  shapes.push(`T~N~${W/2+6}~${H/2+6}~0~#840000~~7~1~1~start~${comp}~~start`);
  return { shapes, pins, w:W, h:H };
}
// 原理图导出：docType 1。devices = {组件名: parseEasyEdaDevice 结果}（可缺省→通用符号）
function exportEasyEdaSch(design, devices){
  devices=devices||{};
  const comps=new Map();
  for(const p of design.pads||[]){
    const i=p.id.lastIndexOf('-');
    const g=i>0?p.id.slice(0,i):p.id;
    if(!comps.has(g)) comps.set(g, new Map());
    comps.get(g).set(String(p.id.slice(i+1)), p);
  }
  const netName=id=>(design.nets.find(n=>n.id===id)||{}).name||'';
  const shapes=[];
  let gid=1; const nid=()=>'gge'+(gid++);
  // 布局：按引脚数降序 + 货架式装箱（2026-11-15 重写：原 3 列网格让 109 脚的
  // ML307R 符号（高 ~560 单位）压住后续十几行——按符号高度估算分行，行高=行内
  // 最大符号高，宽度货架推进，页宽 ~1700 上限）
  const list=[...comps.entries()].map(([name,padMap])=>({name, pinNums:[...padMap.keys()], padMap}))
    .sort((a,b)=>b.pinNums.length-a.pinNums.length);
  const symSize=c=>{
    // generic 符号：引脚分两列，高 ≈ ceil(N/2)*10+40，宽 ≈ 80；
    // 有 symbolBBox 的真符号用实测 bbox
    const dev=devices[c.name];
    if(dev&&dev.symbolBBox){
      const bb=dev.symbolBBox;
      return {w:Math.max(60,bb.x1-bb.x0), h:Math.max(40,bb.y1-bb.y0)};
    }
    return {w:80, h:Math.max(40, Math.ceil(c.pinNums.length/2)*10+40)};
  };
  for(const c of list) c.size=symSize(c);
  // 货架装箱
  const shelfW=1700, marginX=40, marginY=40, gapX=30, gapY=36;
  let curX=marginX, curY=marginY, rowH=0;
  for(const c of list){
    if(curX+c.size.w>shelfW){ curX=marginX; curY+=rowH+gapY; rowH=0; }
    c.ox=curX; c.oy=curY;
    curX+=c.size.w+gapX; rowH=Math.max(rowH,c.size.h);
  }
  const pageW=Math.max(shelfW, curX)+marginX, pageH=curY+rowH+marginY;
  list.forEach((c, idx)=>{
    const ox=c.ox, oy=c.oy;   // EasyEDA 单位
    const dev=devices[c.name];
    let libShapes=[], pins=[];
    if(dev&&dev.pins&&dev.pins.length){
      // 真符号：全部原始形状平移到 (ox,oy) 为中心
      const bb=dev.symbolBBox;
      const cx=(bb.x0+bb.x1)/2, cy=(bb.y0+bb.y1)/2;
      const dx=ox-cx, dy=oy-cy;
      const all=[...dev.graphics, ...dev.texts.map(t=>`T~${t.type||'P'}~${t.x}~${t.y}~0~#840000~~7~1~1~start~${t.text}~~start`)];
      // 为每个引脚重建 P 原语（符号电气核心；图形/文字之外必须补上）
      for(const p of dev.pins){
        const rot=((p.rot%360)+360)%360;
        const dir=rot===0?[1,0]:(rot===180?[-1,0]:(rot===90?[0,1]:[0,-1]));
        const bx=p.x-dir[0]*10, by=p.y-dir[1]*10;
        const cmd=dir[1]!==0?'v':'h', dlen=dir[0]*10+dir[1]*10;
        const nx=bx+dir[0]*4, ny=by+dir[1]*4-4;
        all.push(`P~show~0~${p.number}~${p.x}~${p.y}~${rot}~ggep${p.number}~0^^${p.x}~${p.y}^^M ${bx} ${by} ${cmd} ${dlen}~#800^^0~${bx+dir[0]*3}~${by+dir[1]*3-3}~0~${p.number}~start~~~#800^^0~${nx}~${ny}~0~${p.number}~end~~~#800^^0~0~0^^0~M 0 0 L 0 0`);
      }
      libShapes=all.map(sh=>_eeTransShape(sh, dx, dy));
      pins=dev.pins.map(p=>({number:p.number, x:p.x+dx, y:p.y+dy}));
    } else {
      const g=_eeGenericSymbol(c.name, c.pinNums);
      libShapes=g.shapes.map(sh=>_eeTransShape(sh, ox, oy));
      pins=g.pins.map(p=>({number:p.number, x:p.x+ox, y:p.y+oy}));
    }
    // LIB：首段 LIB 头，其余形状以 #@$ 分行、#$# 分形状（KiCad 解析器约定）
    const para='`name`'+c.name+'`Pre`'+c.name;
    shapes.push([`LIB~${ox}~${oy}~${para}~1`, ...libShapes].join('#@$'));
    // 每个引脚：短导线 + 网络标签（电源网络用电源旗）
    const padNet=pin=>{
      const p=c.padMap.get(String(pin));
      return p&&p.netId!=null?netName(p.netId):'';
    };
    for(const pin of pins){
      const net=padNet(pin.number);
      if(!net) continue;
      const isLeft=pin.x<ox;
      const sx2=isLeft?pin.x-10:pin.x+10;
      shapes.push(`W~${pin.x} ${pin.y} ${sx2} ${pin.y}~#800080~1~0~none~${nid()}~0`);
      if(/^gnd$/i.test(net))
        shapes.push(`F~part_netLabel_gnD~${sx2}~${pin.y}~0~~${nid()}~0^^0~0~~#5A5A5A~~1.27~1~1~start~${net}~${net}`);
      else if(/^(vcc|vdd|\+?[35]v3?|\+?5v|avcc|vbat)$/i.test(net))
        shapes.push(`F~part_netLabel_VCC~${sx2}~${pin.y}~0~~${nid()}~0^^0~0~~#5A5A5A~~1.27~1~1~start~${net}~${net}`);
      else
        shapes.push(`N~${sx2}~${pin.y}~0~${nid()}~${net}~0~start~${sx2+2}~${pin.y-2}~Consolas~5`);
    }
  });
  return JSON.stringify({
    head:{docType:'1', editorVersion:'6.4.25', x:0, y:0, title:'schematic'},
    canvas:'CA~1000~1000~#FFFFFF~yes~#CCCCCC~5~1000~1000~line~5~pixel~5~0~0',
    shape:shapes,
    BBox:{x:0, y:0, w:pageW, h:pageH}
  });
}

/* ---------- EasyEDA 导出回读自检 ----------
   解析自己导出的 docType 3 JSON（PAD/TRACK/TEXT/SOLIDREGION），与设计、
   布线结果对账——交付前发现导出回归（Konnect"写后回读"契约的落地）。
   findings 风格：severity error = 导出与设计不符，禁止交付。 */
function verifyEasyEdaExport(design, result, eeText){
  const F=[];
  const push=(severity,id,msg)=>F.push({severity,id,msg});
  // 网名消毒（与导出侧 netName 同口径：~ 和 | 会错位 EasyEDA 字段）
  const sanitizeNet=nm=>String(nm||'').replace(/[~|]/g,'_');
  // eeText 可选：检查给定的导出文件（否则现场导出做自一致性对账）
  const ee=JSON.parse(eeText||exportEasyEdaPcb(design, (result&&result.nets)||[],
    (result&&(result.pours||(result.pour?[result.pour]:null)))||null));
  const U=0.254;
  // PAD：数量 + 每个焊盘（引脚号@坐标）回读命中
  const padShapes=ee.shape.filter(sh=>sh.startsWith('PAD~')).map(sh=>sh.split('~'));
  if(padShapes.length!==(design.pads||[]).length)
    push('error','VRF-PAD-COUNT',`PAD 数不符：导出 ${padShapes.length} vs 设计 ${(design.pads||[]).length}`);
  const got=new Set(padShapes.map(f=>`${f[8]}@${(parseFloat(f[2])*U).toFixed(2)},${(parseFloat(f[3])*U).toFixed(2)}`));
  for(const p of design.pads||[]){
    const i=p.id.lastIndexOf('-');
    const num=i>0?p.id.slice(i+1):'1';
    // 期望值走与导出相同的量化路径（canvas 三位小数往返）——设计侧直接 toFixed(2)
    // 会在 .005 边界产生不对称取整（外部板实测：5.225 → 设计侧 5.22 / 往返侧 5.23）
    const qx=(Math.round(p.x/U*1000)/1000*U).toFixed(2), qy=(Math.round(p.y/U*1000)/1000*U).toFixed(2);
    const k=`${num}@${qx},${qy}`;
    if(!got.has(k)) push('error','VRF-PAD',`焊盘 ${p.id} 回读缺失（期望 ${k}）`);
  }
  // TRACK：每网 run 数（换层拆分逻辑与导出一致）
  const trkNets=new Map();
  for(const sh of ee.shape.filter(sh=>sh.startsWith('TRACK~'))){
    const nm=sh.split('~')[3];
    trkNets.set(nm,(trkNets.get(nm)||0)+1);
  }
  const expNets=new Map();
  for(const n of (result&&result.nets)||[]){
    const nm=sanitizeNet((design.nets.find(x=>x.id===n.netId)||{}).name||'');
    let runs=0;
    for(const path of n.paths||[]){
      let runLen=0, prevL=null;
      for(const pt of path){
        if(prevL===null||pt.l!==prevL){ if(runLen>1) runs++; runLen=1; prevL=pt.l; }
        else runLen++;
      }
      if(runLen>1) runs++;   // 末段 run（与导出的拆分逻辑逐点一致）
    }
    if(runs) expNets.set(nm,(expNets.get(nm)||0)+runs);
  }
  for(const [nm,c] of expNets)
    if(trkNets.get(nm)!==c)
      push('error','VRF-TRACK',`网络 ${nm} 走线段不符：导出 ${trkNets.get(nm)||0} vs 期望 ${c}`);
  // TEXT：位号数量
  const texts=ee.shape.filter(sh=>sh.startsWith('TEXT~')).length;
  const comps=new Set((design.pads||[]).map(p=>p.id.split('-')[0])).size;
  if(texts!==comps) push('error','VRF-SILK',`丝印位号 ${texts} vs 组件 ${comps}`);
  // 板框存在
  if(!ee.shape.some(sh=>sh.startsWith('SOLIDREGION~10'))) push('error','VRF-OUTLINE','板框缺失');
  // 覆铜：结果带铜皮时导出必须逐块含 COPPERAREA（字段序与 pcb-rnd io_easyeda 解析器一致）
  const ca=ee.shape.filter(sh=>sh.startsWith('COPPERAREA~')).map(sh=>sh.split('~'));
  const expPours=[...((result&&result.pours)||[]), ...((result&&result.pour&&!((result.pours||[]).some(p=>p.netId===result.pour.netId&&p.layer===result.pour.layer)))?[result.pour]:[])]
    .filter(p=>p&&p.polys&&p.polys.length);
  if(expPours.length){
    if(ca.length!==expPours.length)
      push('error','VRF-POUR',`覆铜数量不符：导出 ${ca.length} vs 结果 ${expPours.length}`);
    for(const p of expPours){
      const pourNet=(design.nets.find(n=>n.id===p.netId)||{}).name||'';
      if(!ca.some(f=>f[3]===pourNet))
        push('error','VRF-POUR-NET',`覆铜缺失或网络不符：结果铜皮 ${pourNet} 无对应 COPPERAREA`);
    }
  } else if(ca.length) push('error','VRF-POUR-EXTRA','导出含 COPPERAREA 但结果无铜皮');
  // 过孔
  const viaExp=(result&&result.nets||[]).reduce((a,n)=>a+(n.vias||[]).length,0);
  const viaGot=ee.shape.filter(sh=>sh.startsWith('VIA~')).length;
  if(viaExp!==viaGot) push('error','VRF-VIA',`过孔数不符：导出 ${viaGot} vs 结果 ${viaExp}`);
  return { ok:F.length===0, findings:F,
    summary:{ pads:padShapes.length, tracks:ee.shape.filter(sh=>sh.startsWith('TRACK~')).length,
      texts, vias:viaGot } };
}

/* ---------- EasyEDA PCB JSON 导入（roadmap #8：立创开源广场接力入口）----------
   解析 docType 3 标准 PCB JSON——本工具 exportEasyEdaPcb 输出与嘉立创EDA真实文件
   两口径。shape 字段序经 pcb-rnd src_plugins/io_easyeda/read_std_low.c 逐字段交叉
   核实（study/pcb-rnd 源码）：PAD~shape~x~y~w~h~layer~net~number~holeR~points~rot~
   id~…（points=f[10]、rot=f[11]）；TRACK~w~layer~net~{points}~id~locked；
   VIA~x~y~dia~net~holeR(半径)~id~locked；TEXT~type~x~y~strokeW~rot~mirror~layer~
   net~height~string~…；LIB~x~y~attrs~rot~import~id~locked#@内含形状（#@$ 分隔）。
   **LIB 内含形状坐标两口径（开源广场实样 599 shape 对拍修正 0.11.2）**：嘉立创EDA
   板文件的 LIB 内形状是 **doc 绝对坐标、PAD rot=板面绝对角**（LIB rot 仅描述朝向，
   形状已按绝对位置/角度展开——实样：rot=180 的 LIB 内 PAD raw 绕 origin 对称
   ±8 units、SOLIDREGION/TEXT 同为绝对）；pcb-rnd read_std 的 subc 本地坐标语义
   （subc_finalize 在 x,y,rot 整体放置）适用于其 footprint 库流（docType 4/5），
   与板文件不同——本导入器按板文件口径取 raw 坐标、不叠加 LIB 变换、rot 不加
   libRot。层号：1/2=顶/底铜、11=通孔、21..52=内层、3/4=丝印、5/6=阻焊、
   99..101=doc（easystd_layertab + LAYERTAB_INNER 21..52）；**10=边框层**（开源
   广场实样：板框线画在层 10 的 TRACK，net 空或 S$ 计数线——兜底板框）。
   语义映射：TRACK→design.manual（计入连通/DRC/全部导出，netW 取各网众数线宽）；
   VIA→两点换层 stub（buildModel 惯例：换层点=全层过孔影响区，engine.mjs markFixed）；
   COPPERAREA/HOLE(NPTH) 不导入——design 无铜皮多边形/裸孔存储，接力用 pour 重铺，
   报告如实计数；位号归属：LIB attrs `name` 精确；摊平焊盘「簇优先、位号后贴」
   （几何单链聚簇 2.6mm → 位号认领含其最近焊盘的簇）——宽体 IC 远离位号的列会
   降级 P 组件（摊平格式固有歧义），只影响 pad id 命名与 BOM/pos 分组，不改变
   电气连通（netId 才是事实源）。 */
function _eeParseNums(str){
  const m=String(str||'').match(/-?\d*\.?\d+(?:[eE][-+]?\d+)?/g);
  return m?m.map(Number):[];
}
function _eeLibAttrName(attr){
  const tk=String(attr||'').split('`');
  for(let k=0;k+1<tk.length;k++)
    if(tk[k]==='name'||tk[k]==='Pre'||tk[k]==='pre') return tk[k+1]||null;
  return null;
}
function importEasyEdaPcbFull(eeText){
  const U=0.254;
  let ee;
  try{ ee=JSON.parse(typeof eeText==='string'?eeText:String(eeText)); }
  catch(e){ throw new Error('不是有效的 EasyEDA JSON（JSON 解析失败：'+e.message+'）'); }
  if(!ee||typeof ee!=='object'||Array.isArray(ee)) throw new Error('EasyEDA 文件必须是 JSON 对象');
  if(String(ee.head&&ee.head.docType)!=='3')
    throw new Error('不是 EasyEDA PCB 文件（head.docType='+JSON.stringify(ee.head&&ee.head.docType)
      +'，应为 "3"；原理图 docType 1 / 器件库 docType 2、4 不走 PCB 导入）');
  if(!Array.isArray(ee.shape)) throw new Error('EasyEDA PCB 文件缺少 shape 数组');
  const org=_eeCanvasOrigin(ee.canvas);
  const report={pads:0,nets:0,tracks:0,vias:0,texts:0,copperareas:0,holes:0,graphics:0,skipped:{},notes:[]};
  const skip=k=>{report.skipped[k]=(report.skipped[k]||0)+1;};
  const pads=[],tracks=[],vias=[],refTexts=[],keepRects=[];
  let outline=null, outline2=null, sawInner=false;   // outline2 = 边框层(10)兜底候选
  const num=v=>{const n=parseFloat(v);return Number.isFinite(n)?n:0;};
  // LIB 本地→doc 坐标（EasyEDA 屏幕坐标 y 向下，标准旋转矩阵）
  const trX=(x,y,tf)=>tf?(tf.dx+x*tf.c-y*tf.s):x;
  const trY=(x,y,tf)=>tf?(tf.dy+x*tf.s+y*tf.c):y;
  const pathBBox=str=>{
    const n=_eeParseNums(str);
    if(n.length<4) return null;
    let a=1e9,b=1e9,c=-1e9,d=-1e9;
    for(let k=0;k+1<n.length;k+=2){ a=Math.min(a,n[k]); b=Math.min(b,n[k+1]); c=Math.max(c,n[k]); d=Math.max(d,n[k+1]); }
    return {a,b,c,d};
  };

  function parseShapes(list, tf, libComp, libSyn){
    for(const raw of list){
      if(!raw||typeof raw!=='string'||!raw.trim()) continue;
      if(raw.startsWith('LIB~')){
        const parts=raw.split('#@$');
        const h=parts[0].split('~');
        const _attr=_eeLibAttrName(h[3]);
        const _comp=libComp||_attr||('LIB'+(pads.length+tracks.length+1));
        const _syn=libComp!=null?libSyn:(_attr==null);   // 合成标记：attrs 无 name 才是合成组（沿嵌套传播）
        parseShapes(parts.slice(1), null, _comp, _syn);   // 板文件口径：LIB 内形状已按绝对坐标展开（见头部注释）
        continue;
      }
      const f=raw.split('~'), t=f[0];
      if(t==='PAD'&&f.length>=10){
        const layerId=String(f[6]||'').trim();
        if(layerId!=='1'&&layerId!=='2'&&layerId!=='11'){ skip('PAD-l'+(layerId||'?')); continue; }
        const shape=(f[1]||'').toUpperCase();
        let wU=num(f[4]), hU=num(f[5]);
        if(wU<=0||hU<=0){   // POLYGON 等异形：points 字段 bbox 兜底
          const bb=pathBBox(f[10]);
          if(bb){ wU=bb.c-bb.a; hU=bb.d-bb.b; }
        }
        if(wU<=0||hU<=0){ skip('PAD-'+(f[1]||'nosize')); continue; }
        const xU=num(f[2]), yU=num(f[3]);
        const rot=((num(f[11]))%360+360)%360;   // PAD rot=板面绝对角（真实文件对拍，不叠加 LIB rot）
        pads.push({ libSyn:!!libSyn, x:trX(xU,yU,tf)*U, y:trY(xU,yU,tf)*U,
          w:wU*U, h:hU*U, wLocal:wU*U, hLocal:hU*U, rot,
          shape:(shape==='ELLIPSE'||shape==='CIRCLE')?'circle':'rect',
          layer:layerId==='1'?'top':(layerId==='2'?'bottom':'both'),
          holeR:Math.max(0,num(f[9]))*U,
          net:String(f[7]||''), number:String(f[8]===undefined?'':f[8]).trim()||'1', comp:libComp });
        continue;
      }
      if(t==='TRACK'&&f.length>=5){
        const layerId=String(f[2]||'').trim();
        // 嘉立创EDA 标准版边框层=10（开源广场实测：4 条闭合矩形边线，net 空或 S$ 计数线）
        // ——记入板框候选（仅在无 SOLIDREGION boardoutline 时兜底使用）
        const _tNet=String(f[3]||'').trim();
        if(layerId==='10'&&(_tNet===''||_tNet.startsWith('S$'))){
          const n2=_eeParseNums(f[4]);
          for(let k=0;k+1<n2.length;k+=2){
            const gx=trX(n2[k],n2[k+1],tf)*U, gy=trY(n2[k],n2[k+1],tf)*U;
            if(!outline2) outline2={x0:gx,y0:gy,x1:gx,y1:gy};
            else{ outline2.x0=Math.min(outline2.x0,gx); outline2.y0=Math.min(outline2.y0,gy);
                  outline2.x1=Math.max(outline2.x1,gx); outline2.y1=Math.max(outline2.y1,gy); }
          }
          continue;
        }
        if(!['1','2','21','22'].includes(layerId)){ skip('TRACK-l'+(layerId||'?')); continue; }
        if(layerId==='21'||layerId==='22') sawInner=true;
        const pv=_eeParseNums(f[4]);
        if(pv.length<4){ skip('TRACK-退化'); continue; }
        const pts=[];
        for(let k=0;k+1<pv.length;k+=2) pts.push({x:trX(pv[k],pv[k+1],tf)*U, y:trY(pv[k],pv[k+1],tf)*U});
        tracks.push({ net:String(f[3]||''), w:num(f[1])*U, layerId, pts });
        continue;
      }
      if(t==='VIA'&&f.length>=6){
        const dia=num(f[3])*U, drill=num(f[5])*U*2;
        if(dia<=0||drill<=0){ skip('VIA-坏尺寸'); continue; }
        vias.push({ x:trX(num(f[1]),num(f[2]),tf)*U, y:trY(num(f[1]),num(f[2]),tf)*U,
          net:String(f[4]||''), outer:dia, drill:Math.min(drill,dia) });
        continue;
      }
      if(t==='TEXT'&&f.length>=11){
        const s=String(f[10]||'').trim();
        const layerId=String(f[7]||'').trim();
        if(/^[A-Za-z]+\d+$/.test(s))
          refTexts.push({ x:trX(num(f[2]),num(f[3]),tf)*U, y:trY(num(f[2]),num(f[3]),tf)*U,
            text:s, layer:layerId==='4'?'bottom':'top', rot:num(f[5]), lib:!!tf, owner:libComp||null });
        continue;
      }
      if(t==='SOLIDREGION'){
        const pathField=f.find((x,k)=>k>0&&typeof x==='string'&&x.trim().startsWith('M '));
        // 真实文件口径（开源广场实测）：SOLIDREGION~层~网名~path——层 1/2 带网名 =
        // 异形铜皮区域（与 COPPERAREA 同语义：design 无铜皮存储，接力用 pour 重铺）
        if(['1','2','11'].includes(String(f[1]||'').trim())&&String(f[2]||'').trim()&&pathField&&
           !f.includes('boardoutline')&&!f.includes('keepout')){
          skip('SOLIDREGION-铜皮'); continue;
        }
        if(f.includes('boardoutline')&&pathField){
          const bb=pathBBox(pathField);
          if(bb&&!outline) outline={x0:bb.a*U,y0:bb.b*U,x1:bb.c*U,y1:bb.d*U};
          else if(bb) outline={x0:Math.min(outline.x0,bb.a*U),y0:Math.min(outline.y0,bb.b*U),
                               x1:Math.max(outline.x1,bb.c*U),y1:Math.max(outline.y1,bb.d*U)};
        }
        else if(f.some((x,k)=>k>0&&typeof x==='string'&&/keepout|禁布/.test(x))&&pathField){
          const bb=pathBBox(pathField);
          if(bb) keepRects.push({x:(bb.a+bb.c)/2*U, y:(bb.b+bb.d)/2*U, w:(bb.c-bb.a)*U, h:(bb.d-bb.b)*U});
        }
        else skip('SOLIDREGION-'+(f[4]||f[1]||'?'));
        continue;
      }
      if(t==='COPPERAREA'){ report.copperareas++; continue; }
      if(t==='HOLE'){ report.holes++; continue; }
      report.graphics++;
    }
  }
  parseShapes(ee.shape, null, null, false);

  // 板幅：boardoutline 包围盒精确取值；缺失则焊盘包围盒外扩 5mm（KiCad 导入同款回退）
  let bb;
  if(outline&&outline.x1-outline.x0>1e-6&&outline.y1-outline.y0>1e-6) bb=outline;
  else if(outline2&&outline2.x1-outline2.x0>1e-6&&outline2.y1-outline2.y0>1e-6){
    bb=outline2;   // 边框层兜底（开源广场实测：板框画在层 10 的线条）
    report.notes.push('板框取自边框层(10)线条包围盒');
  }
  else{
    if(!pads.length) throw new Error('文件中既无板框（SOLIDREGION boardoutline）也无焊盘，无法确定板幅');
    let a=1e9,b=1e9,c=-1e9,d=-1e9;
    for(const p of pads){ a=Math.min(a,p.x-p.w/2); b=Math.min(b,p.y-p.h/2); c=Math.max(c,p.x+p.w/2); d=Math.max(d,p.y+p.h/2); }
    bb={x0:a-5,y0:b-5,x1:c+5,y1:d+5};
    report.notes.push('无板框记录：按焊盘包围盒外扩 5mm 作为板幅');
  }
  const W=+((bb.x1-bb.x0).toFixed(3)), H=+((bb.y1-bb.y0).toFixed(3));   // 3 位量化：消 0.254 换算尾差（50u→49.9999→50）
  if(!(W>0&&H>0&&Number.isFinite(W)&&Number.isFinite(H))) throw new Error('板幅无效（'+W+'×'+H+'mm）');
  const ddx=-bb.x0, ddy=-bb.y0;   // 平移到 (0,0) 起点（design 坐标系）
  const layers=sawInner?4:2;
  for(const p of pads){ p.x+=ddx; p.y+=ddy; }
  for(const t of tracks) for(const pt of t.pts){ pt.x+=ddx; pt.y+=ddy; }
  for(const v of vias){ v.x+=ddx; v.y+=ddy; }
  for(const t of refTexts){ t.x+=ddx; t.y+=ddy; }
  for(const k of keepRects){ k.x+=ddx; k.y+=ddy; }

  const design=designDefaults();
  // 网格磁吸：量化漂移(<0.001mm)的坐标吸附回 grid/2 格点。路由器路径点原本就
  // 在格点上，导出量化(±0.00013mm)会让 floor(x/grid-0.5) 翻到邻格——整条走线
  // 与焊盘格错开一格且无 4 邻接，连通性假断、路由模型 markFixed 固定格错位
  // （555 回路实测）。外来文件坐标（0.254mm 步进）距 0.25 格点 ≥0.004mm，
  // 不会被误吸。
  {
    const q=design.grid/2;
    const snap=v=>{ const m=Math.round(v/q)*q; return Math.abs(v-m)<0.001?m:v; };
    for(const p of pads){ p.x=snap(p.x); p.y=snap(p.y); }
    for(const t of tracks) for(const pt of t.pts){ pt.x=snap(pt.x); pt.y=snap(pt.y); }
    for(const v of vias){ v.x=snap(v.x); v.y=snap(v.y); }
  }
  design.layers=layers; design.width=W; design.height=H; design.external=true;
  // 网络：名字去重（EasyEDA 格式本身容不下 ~|，导入侧无需再消毒）
  const netNames=new Set();
  for(const p of pads) if(p.net) netNames.add(p.net);
  for(const t of tracks) if(t.net) netNames.add(t.net);
  for(const v of vias) if(v.net) netNames.add(v.net);
  design.nets=[...netNames].map((n,i)=>({id:'e'+(i+1),name:n}));
  const netId=new Map(design.nets.map(n=>[n.name,n.id]));
  // 焊盘归属 v3：LIB 名精确（attrs `name`）；摊平焊盘「簇优先、位号后贴」——
  // 几何单链聚簇（阈值 2.6mm≈THT 2.54 节距上限；0.5~1.27 SMD 节距更小必成链），
  // 再由位号认领「含其最近焊盘」的簇（位号在组件中心，其最近焊盘必属本组件）。
  // 弃用最近邻起步+贴邻精化：宽体 IC 边缘脚到邻组位号比到本组位号更近
  // （555 实测 DIP-8 左列 3.95 < 5.3mm），且列间距 7.5 > 到邻组 5.0，贴邻
  // 精化同样反水——几何最近类算法在宽体 IC 场景本质不可靠。
  // 已知边界（如实）：宽体 IC 左右列会裂成两簇，远离位号的一列降级 P 组件；
  // 密集 0402 农场（间距 <2.6mm）可能链成大簇共享位号——均只影响 pad id
  // 命名与 BOM/pos 分组，电气连通以 netId 为准；LIB 块文件不受影响。
  let pseq=0;
  const groups=new Map();   // label → pads
  for(const p of pads){
    if(p.comp!=null){
      if(!groups.has(p.comp)) groups.set(p.comp,[]);
      groups.get(p.comp).push(p);
    }
  }
  // 无名 LIB 组的位号回收（0.11.4，开源广场实测：80 个封装 attrs 全无 `name`，
  // 但每个 LIB 内部恰好有一个位号样式 TEXT——所有权 1:1 明确，直接回收为组名；
  // 顶层 PA12 类网名/引脚名不参与（所有权不明，防误配））
  {
    const renamed=new Set();
    for(const [lbl,ps] of [...groups]){
      if(!ps.length||!ps[0].libSyn) continue;
      const cand=refTexts.filter(t=>t.owner===lbl&&/^[A-Za-z]+\d+$/.test(t.text));
      if(cand.length!==1||groups.has(cand[0].text)||renamed.has(cand[0].text)) continue;
      groups.set(cand[0].text, ps);
      groups.delete(lbl);
      renamed.add(cand[0].text);
      for(const p of ps) p.comp=cand[0].text;
    }
  }
  {
    const loose=pads.filter(p=>!p.comp);
    const parent=new Map();
    const find=x=>{ while(parent.get(x)!==x){ const up=parent.get(x); parent.set(x,parent.get(up)); x=parent.get(x); } return x; };
    for(const p of loose) parent.set(p,p);
    for(let i=0;i<loose.length;i++)for(let j=i+1;j<loose.length;j++){
      const a=loose[i],b=loose[j];
      if(Math.hypot(a.x-b.x,a.y-b.y)<=2.6){ const ra=find(a),rb=find(b); if(ra!==rb) parent.set(ra,rb); }
    }
    const clusters=new Map();
    for(const p of loose){ const r=find(p); if(!clusters.has(r)) clusters.set(r,[]); clusters.get(r).push(p); }
    // 位号认领（LIB 内部位号不参与——其组件已由 attrs 定名）：
    // 位号 → 其最近摊平焊盘所在簇；一簇只认一个（先到先得）；距离 >15mm 不认领
    // （防游离文字抢簇）
    const claimed=new Set();
    for(const t of refTexts){
      if(t.lib) continue;
      let bd=Infinity, bp=null;
      for(const [,ps] of clusters) for(const p of ps){
        const dd=Math.hypot(t.x-p.x,t.y-p.y);
        if(dd<bd){ bd=dd; bp=p; }
      }
      if(!bp||bd>15) continue;
      const root=find(bp);
      if(claimed.has(root)) continue;
      claimed.add(root);
      if(!groups.has(t.text)) groups.set(t.text,[]);
      groups.get(t.text).push(...clusters.get(root));
    }
    for(const [root,ps] of clusters){
      if(claimed.has(root)) continue;
      const label='P'+(++pseq);
      if(!groups.has(label)) groups.set(label,[]);
      groups.get(label).push(...ps);
    }
  }
  const used=new Set();
  for(const [label,ps] of groups){
    for(const p of ps){
      let id=label+'-'+p.number;
      for(let k=1;used.has(id);k++) id=label+'-'+p.number+String.fromCharCode(96+k);
      used.add(id);
      // 旋转焊盘：路由/DRC 模型取真旋转形状的板坐标 AABB（KiCad 导入器同款）
      let w=p.w, h=p.h;
      if(p.shape!=='circle'&&p.rot>1e-9){
        const r=p.rot*Math.PI/180, c=Math.abs(Math.cos(r)), s=Math.abs(Math.sin(r));
        w=p.wLocal*c+p.hLocal*s; h=p.wLocal*s+p.hLocal*c;
      }
      if(p.shape==='circle') h=w;
      const pad={id, x:+p.x.toFixed(4), y:+p.y.toFixed(4),
        w:+Math.max(w,0.1).toFixed(4), h:+Math.max(h,0.1).toFixed(4),
        shape:p.shape, layer:p.layer, netId:p.net?(netId.get(p.net)||null):null};
      if(p.rot>1e-9&&p.shape!=='circle'){ pad.rotAbs=p.rot; pad.wLocal=p.wLocal; pad.hLocal=p.hLocal; }
      if(p.holeR>0) pad.holeR=p.holeR;
      design.pads.push(pad);
    }
  }
  // 位号 → comps 元数据（导出丝印用）
  design.comps={};
  for(const t of refTexts)
    if(!design.comps[t.text]) design.comps[t.text]={x:+t.x.toFixed(4),y:+t.y.toFixed(4),layer:t.layer,rot:t.rot||0};
  // TRACK → 手动走线（换层拆分由导出侧负责；线宽进 nets[].w 众数）
  const widthCount=new Map();
  for(const t of tracks){
    const nid=netId.get(t.net);
    if(!nid){ skip('TRACK-无网'); continue; }
    const li=t.layerId==='1'?0:(t.layerId==='2'?layers-1:(t.layerId==='21'?1:2));
    design.manual.push({netId:nid, pts:t.pts.map(pt=>({x:+pt.x.toFixed(4),y:+pt.y.toFixed(4),l:li}))});
    report.tracks++;
    const w=+t.w.toFixed(3);
    if(w>0){
      const key=nid+'\u0000'+w;
      widthCount.set(key,(widthCount.get(key)||0)+1);
    }
  }
  const bestW=new Map();   // netId → {w,count}（众数；平票取更宽——载流保守）
  for(const [key,c] of widthCount){
    const [nid,w]=key.split('\u0000');
    const cur=bestW.get(nid);
    if(!cur||c>cur.count||(c===cur.count&&+w>cur.w)) bestW.set(nid,{w:+w,count:c});
  }
  for(const [nid,b] of bestW){
    const n=design.nets.find(x=>x.id===nid);
    if(n&&Math.abs(b.w-design.trackW)>1e-9) n.w=b.w;
  }
  // VIA → 两点换层 stub（buildModel：换层点=全层过孔影响区）
  const viaSizes=new Map();
  for(const v of vias){
    const nid=netId.get(v.net);
    if(!nid){ skip('VIA-无网'); continue; }
    if(layers<2){ skip('VIA-单层'); continue; }
    design.manual.push({netId:nid, pts:[
      {x:+v.x.toFixed(4),y:+v.y.toFixed(4),l:0},{x:+v.x.toFixed(4),y:+v.y.toFixed(4),l:layers-1}]});
    report.vias++;
    const key=+v.outer.toFixed(3)+'/'+(+v.drill.toFixed(3));
    viaSizes.set(key,(viaSizes.get(key)||0)+1);
  }
  let vBest=null, vC=-1;
  for(const [k,c] of viaSizes){
    const [o,d]=k.split('/').map(Number);
    if(c>vC||(c===vC&&o>(vBest?vBest.o:0))){ vC=c; vBest={o,d}; }
  }
  if(vBest){
    design.viaOuter=+Math.max(0.2,vBest.o).toFixed(4);
    design.viaDrill=+Math.min(Math.max(0.2,vBest.d),design.viaOuter).toFixed(4);
  }
  // 禁布区（SOLIDREGION keepout）→ 矩形近似
  for(const k of keepRects)
    if(k.w>0&&k.h>0) design.keepouts.push({x:+k.x.toFixed(4),y:+k.y.toFixed(4),w:+k.w.toFixed(4),h:+k.h.toFixed(4)});
  // 孤立网清理（KiCad 导入同款）：无焊盘引用的网及其走线丢弃
  const usedNets=new Set(design.pads.map(p=>p.netId).filter(Boolean));
  const keepIds=new Set(design.nets.filter(n=>usedNets.has(n.id)).map(n=>n.id));
  const droppedTracks=design.manual.length;
  design.manual=design.manual.filter(m=>keepIds.has(m.netId));
  design.nets=design.nets.filter(n=>keepIds.has(n.id));
  if(design.manual.length<droppedTracks)
    report.notes.push('丢弃无焊盘引用的孤立走线 '+(droppedTracks-design.manual.length)+' 条');
  report.pads=design.pads.length; report.nets=design.nets.length;
  report.texts=refTexts.length;
  return {design, report};
}
function importEasyEdaPcb(eeText){
  return importEasyEdaPcbFull(eeText).design;
}

/* ---------- 板级栅格化渲染（AI 视觉自检用，纯计算零依赖）----------
   返回 {width,height,px:Uint8Array(RGBA)}。绘制顺序：画布底 → 板区 → 覆铜 →
   底层走线 → 顶层走线 → 焊盘（含孔）→ 过孔/缝合孔。走线宽度取每网线宽。
   CLI 的 render 命令把它编码成 PNG；GUI 画布另有矢量渲染不受影响。 */
function renderBoardPixels(design, result, opts){
  opts=opts||{};
  const pour=(result&&result.pour)||(result&&result.pours)||opts.pour||opts.pours||null;   // 覆铜：单块或数组
  const scale=opts.scale||8;
  const W=Math.ceil(design.width*scale), H=Math.ceil(design.height*scale);
  if(!Number.isFinite(scale)||scale<=0||!Number.isSafeInteger(W*H)||W*H>16_000_000) throw new Error('Render exceeds 16000000 pixels; reduce scale or board size');
  const px=new Uint8Array(W*H*4);
  const set=(x,y,c)=>{
    if(x<0||y<0||x>=W||y>=H) return;
    const i=(y*W+x)*4;
    px[i]=c[0]; px[i+1]=c[1]; px[i+2]=c[2]; px[i+3]=255;
  };
  for(let i=0;i<W*H;i++){ px[i*4]=13; px[i*4+1]=17; px[i*4+2]=23; px[i*4+3]=255; }
  const rect=(x0,y0,x1,y1,c)=>{
    const a=Math.max(0,Math.round(x0*scale)), b=Math.max(0,Math.round(y0*scale));
    const u=Math.min(W,Math.round(x1*scale)), v=Math.min(H,Math.round(y1*scale));
    for(let y=b;y<v;y++)for(let x=a;x<u;x++) set(x,y,c);
  };
  const disc=(cx,cy,rad,c)=>{
    const a=Math.max(0,Math.floor((cx-rad)*scale)), b=Math.max(0,Math.floor((cy-rad)*scale));
    const u=Math.min(W,Math.ceil((cx+rad)*scale)), v=Math.min(H,Math.ceil((cy+rad)*scale));
    const r2=rad*rad*scale*scale;
    for(let y=b;y<v;y++)for(let x=a;x<u;x++){
      const dx=(x+0.5)/scale-cx, dy=(y+0.5)/scale-cy;
      if(dx*dx+dy*dy<=r2) set(x,y,c);
    }
  };
  const seg=(x1,y1,x2,y2,rad,c)=>{
    const a=Math.max(0,Math.floor((Math.min(x1,x2)-rad)*scale)), b=Math.max(0,Math.floor((Math.min(y1,y2)-rad)*scale));
    const u=Math.min(W,Math.ceil((Math.max(x1,x2)+rad)*scale)), v=Math.min(H,Math.ceil((Math.max(y1,y2)+rad)*scale));
    const r2=rad*rad*scale*scale;
    const dx=x2-x1, dy=y2-y1, L2=dx*dx+dy*dy;
    for(let y=b;y<v;y++)for(let x=a;x<u;x++){
      const px2=(x+0.5)/scale, py2=(y+0.5)/scale;
      let t=L2>0?((px2-x1)*dx+(py2-y1)*dy)/L2:0;
      t=Math.max(0,Math.min(1,t));
      const ex=x1+t*dx-px2, ey=y1+t*dy-py2;
      if(ex*ex+ey*ey<=r2) set(x,y,c);
    }
  };
  const C_BOARD=[0,16,35], C_POUR0=[0,80,0], C_POUR1=[64,64,0],
        C_TOP=[200,82,82], C_BOT=[77,127,196], C_PAD=[227,183,46], C_HOLE=[13,17,23];
  rect(0,0,design.width,design.height,C_BOARD);
  if(pour){
    // 多边形覆铜：逐像素行偶奇填充全部环（外环+孔），与 Gerber 渲染同源；支持多块铜皮
    const pourList=Array.isArray(pour)?pour.filter(Boolean):[pour];
    for(const po of pourList){
      if(!po||!po.polys||!po.polys.length) continue;
      const pc=po.layer===0?C_POUR0:C_POUR1;
      const rings=[];
      for(const poly of po.polys) rings.push(poly.outer, ...poly.holes);
      for(let py=0;py<H;py++){
        const y=(py+0.5)/scale, xs=[];
        for(const ring of rings) for(let i=0;i<ring.length;i+=2){
          const k=(i+2)%ring.length, y1=ring[i+1], y2=ring[k+1];
          if((y1>y)!==(y2>y)) xs.push(ring[i]+(y-y1)*(ring[k]-ring[i])/(y2-y1));
        }
        if(xs.length<2) continue;
        xs.sort((a,b)=>a-b);
        for(let m=0;m+1<xs.length;m+=2){
          const a=Math.max(0, Math.round(xs[m]*scale)), b=Math.min(W, Math.round(xs[m+1]*scale));
          for(let x=a;x<b;x++) set(x, py, pc);
        }
      }
    }
  }
  const layers=design.layers||2;
  for(const l of [layers-1, 0]){
    for(const n of (result&&result.nets)||[]) for(const path of n.paths) for(let k=1;k<path.length;k++){
      const a=path[k-1], b=path[k];
      if(a.l!==l||b.l!==l) continue;
      seg(a.x,a.y,b.x,b.y, netW(design,n.netId)/2, l===0?C_TOP:C_BOT);
    }
  }
  for(const p of design.pads||[]){
    if(p.shape==='circle') disc(p.x,p.y,p.w/2,C_PAD);
    else rect(p.x-p.w/2,p.y-p.h/2,p.x+p.w/2,p.y+p.h/2,C_PAD);
    const hr=p.layer==='both'?(p.holeR!=null?p.holeR:design.viaDrill/2):0;
    if(hr>0) disc(p.x,p.y,hr,C_HOLE);
  }
  // 俯视合成图：所有过孔都画（含盲埋孔——AI 目检需要看到全部物理孔；
  // 分层视图的 span 语义由 buildSVG/Gerber 承担）。孔径用逐孔 outer/drill。
  for(const n of (result&&result.nets)||[]) for(const v of n.vias){
    disc(v.x,v.y,(v.outer!=null?v.outer:design.viaOuter)/2,C_PAD);
    disc(v.x,v.y,(v.drill!=null?v.drill:design.viaDrill)/2,C_HOLE);
  }
  for(const sv of design.stitching||[]){
    disc(sv.x,sv.y,design.viaOuter/2,C_PAD);
    disc(sv.x,sv.y,design.viaDrill/2,C_HOLE);
  }
  return {width:W, height:H, px};
}

/* ---------- 嘉立创工艺参数表（来源：jlc.com/portal/vtechnology.html，投板前以官网最新为准） ---------- */
const JLC = {
  // 最小线宽/线距极限（mm），按成品铜厚；single=单双面板，multi=多层板
  trackLimit: {
    '1':   { single: 0.10, multi: 0.09 },
    '1.5': { multi: 0.13 },
    '2':   { single: 0.16, multi: 0.15 },
    '2.5': { single: 0.20 },
    '3.5': { single: 0.25 },
    '4.5': { single: 0.30 },
    '5':   { single: 0.35 },
    '6':   { single: 0.45 }
  },
  trackSuggest: { '1': 0.15, '2': 0.20 },       // 建议设计值（1oz/2oz）
  via: { single: { drill: 0.30, outer: 0.50 }, double: { drill: 0.15, outer: 0.25 } },   // 极限
  viaSuggest: { drill: 0.30, outer: 0.60 },     // 建议设计值
  // 激光微孔（HDI，阶段三 #15）：嘉立创 HDI 工艺口径的安全值——机械钻孔极限
  // 0.15 不适用于激光孔，但激光孔受**深径比**约束（孔径 : 介质厚 ≤ 1:1，
  // RTF2 p148-155），且只能跨相邻层（盲孔）或相邻内层组（埋孔）。
  microvia: { drill: 0.10, outer: 0.25, ringMin: 0.075, aspectMax: 1.0, adjacentOnly: true },
  viaRingMin: 0.10,        // 过孔 外径−内径 极限（推荐 0.15）
  viaEdgeMin: 0.20,        // 孔边到孔边 极限（建议 0.30）
  padToTrackMin: 0.10,     // 焊盘边到线边 极限（BGA 0.09）
  boardEdgeMin: 0.20,      // 锣边处走线/焊盘距板边 极限（建议 0.3~0.5）
  annular: { suggest: 0.25, min: 0.18 },   // 有铜插件孔焊环（双面）
  // 载流锚点（IPC-2152 量级）：1A/ΔT10℃ 的理论/建议宽度 mm
  amp: {
    outer: { '1': { t: 0.40, s: 0.50 }, '2': { t: 0.20, s: 0.30 } },
    inner: { '0.5': { t: 1.50, s: 1.60 }, '1': { t: 0.80, s: 1.00 } }
  },
  viaAmp: 1.0,             // 0.3mm 过孔保守载流 1A/孔锚点，大电流多孔并联
  viaAmpRef: 0.3,          // viaAmp 的锚定孔径 mm——实际按 design.viaDrill 线性折算（viaAmpFor）
  solderBridge: { std: 0.10, bw: 0.13, oz2: 0.20 },   // 阻焊桥极限：绿/彩油、黑白油、2oz
  // IPC-2221B Table 6-1 电压→导线间距（mm）——按工作电压查安全间距
  // V 断点（V）→ 三档间距（mm）
  ipc2221b: {
    // IPC-2221B Table 6-1（0.14.7 批次2 修正：0.14.6 存表列语义与标准相反、数值为
    // 旧 IPC-2221A 口径——经 EMA Design Automation 与 SF Circuits 两份独立复现一致核对）：
    // B1=内层导线；B2=外层无涂层 ≤3050m（裸板最严，打样缺省档）；B4=外层聚合物涂层。
    // V = 电压上界（≤V[i] 用 C[i]）；>500V 线性外推（perV，mm/V）。
    V: [15, 30, 50, 100, 150, 170, 250, 300, 500],
    B1: [0.05, 0.05, 0.1, 0.1, 0.2, 0.2, 0.2, 0.2, 0.25],
    B2: [0.1, 0.1, 0.6, 0.6, 0.6, 1.25, 1.25, 1.25, 2.5],
    B4: [0.05, 0.05, 0.13, 0.13, 0.4, 0.4, 0.4, 0.4, 0.8],
    perV: { B1: 0.0025, B2: 0.005, B4: 0.00305 }
  }
};
// 铜厚感知的线宽/线距极限与建议值
function jlcTrackRule(design){
  const oz = String(design.copperWeight || 1);
  const multi = (design.layers || 2) >= 4;
  const lim = (JLC.trackLimit[oz] || JLC.trackLimit['1']);
  const limit = multi ? (lim.multi != null ? lim.multi : lim.single) : lim.single;
  const suggest = JLC.trackSuggest[oz] || 0.15;
  return { limit, suggest };
}

/* ---------- 直角斯坦纳树（RMST）：Hanan 网格 + Dreyfus–Wagner 精确求解 ----------
   多引脚网络先分解为"哪些点两两连接"再逐段布线；分解质量直接决定布通率与线长。
   Hanan 定理保证最优直角斯坦纳树落在 (引脚x)×(引脚y) 网格上；
   Dreyfus–Wagner 子集 DP 在该网格图上精确求解（引脚 ≤10 时毫秒级）。
   返回按树遍历顺序排列的布线任务 [{from:{x,y}, to:{x,y}}]（from 侧总已连通）；
   引脚 >10 或网格过大返回 null，调用方退化为普通分解。 */
function rmstTasks(points){
  const N=points.length;
  if(N<2 || N>10) return null;
  const xs=[...new Set(points.map(p=>p.x))].sort((a,b)=>a-b);
  const ys=[...new Set(points.map(p=>p.y))].sort((a,b)=>a-b);
  if(xs.length*ys.length>1600) return null;
  const key=(x,y)=>x+'_'+y;
  const pts=[], idx=new Map();
  for(const x of xs)for(const y of ys){ idx.set(key(x,y),pts.length); pts.push({x,y}); }
  const V=pts.length;
  const adj=pts.map(()=>[]);
  for(let i=0;i<xs.length;i++)for(let j=1;j<ys.length;j++){
    const a=idx.get(key(xs[i],ys[j-1])), b=idx.get(key(xs[i],ys[j])), w=ys[j]-ys[j-1];
    adj[a].push([b,w]); adj[b].push([a,w]);
  }
  for(let j=0;j<ys.length;j++)for(let i=1;i<xs.length;i++){
    const a=idx.get(key(xs[i-1],ys[j])), b=idx.get(key(xs[i],ys[j])), w=xs[i]-xs[i-1];
    adj[a].push([b,w]); adj[b].push([a,w]);
  }
  const termNode=points.map(p=>idx.get(key(p.x,p.y)));
  const K=N, FULL=(1<<K)-1;
  // 全对最短路（含前驱，供基础路径重建）
  const INF=1e15;
  const dist=[], prev=[];
  for(let s=0;s<V;s++){
    const dd=new Float64Array(V).fill(INF), pp=new Int32Array(V).fill(-1), done=new Uint8Array(V);
    dd[s]=0;
    for(;;){
      let u=-1, best=INF;
      for(let i=0;i<V;i++) if(!done[i]&&dd[i]<best){ best=dd[i]; u=i; }
      if(u<0) break;
      done[u]=1;
      for(const [v,w] of adj[u]) if(!done[v]&&dd[u]+w<dd[v]){ dd[v]=dd[u]+w; pp[v]=u; }
    }
    dist.push(dd); prev.push(pp);
  }
  // Dreyfus–Wagner 子集 DP
  const dp=new Map(), chType=new Map(), chA=new Map();
  const dkey=(v,S)=>v*(FULL+1)+S;
  const SINGLE_IDX={}; for(let i=0;i<K;i++) SINGLE_IDX[1<<i]=i;
  for(let S=1;S<=FULL;S++){
    const single=(S&(S-1))===0;
    // 1) 合并：dp[v][S] = min_T dp[v][T] + dp[v][S\T]
    const init=new Float64Array(V).fill(INF);
    for(let v=0;v<V;v++){
      if(single){ init[v]=dist[v][termNode[SINGLE_IDX[S]]]; chType.set(dkey(v,S),'base'); continue; }
      let best=INF, bT=0;
      for(let T=(S-1)&S; T; T=(T-1)&S){
        const c1=dp.get(dkey(v,T)), c2=dp.get(dkey(v,S^T));
        if(c1!=null&&c2!=null&&c1+c2<best){ best=c1+c2; bT=T; }
      }
      init[v]=best;
      if(bT){ chType.set(dkey(v,S),'merge'); chA.set(dkey(v,S),bT); }
    }
    // 2) 生长：以 init 为初始势的多源 Dijkstra
    const fin=new Float64Array(init), gpar=new Int32Array(V).fill(-1);
    const done=new Uint8Array(V);
    if(!single){
      for(;;){
        let u=-1, best=INF;
        for(let i=0;i<V;i++) if(!done[i]&&fin[i]<best){ best=fin[i]; u=i; }
        if(u<0) break;
        done[u]=1;
        for(const [v,w] of adj[u]){
          if(!done[v]&&fin[u]+w<fin[v]){ fin[v]=fin[u]+w; gpar[v]=u; }
        }
      }
      for(let v=0;v<V;v++) if(gpar[v]>=0){ chType.set(dkey(v,S),'grow'); chA.set(dkey(v,S),gpar[v]); }
    }
    for(let v=0;v<V;v++) dp.set(dkey(v,S), fin[v]);
  }
  // 最优根
  let bestV=0, bestC=Infinity;
  for(let v=0;v<V;v++){
    const c=dp.get(dkey(v,FULL));
    if(c<bestC){ bestC=c; bestV=v; }
  }
  // 回溯收集树边
  const edges=[];
  const rebuild=(v,S)=>{
    for(;;){
      const t=chType.get(dkey(v,S));
      if(t==='base'){
        const end=termNode[SINGLE_IDX[S]];
        let cur=end;
        while(cur!==v){ const p=prev[v][cur]; edges.push([p,cur]); cur=p; }
        return;
      }
      if(t==='grow'){ const u=chA.get(dkey(v,S)); rebuild(u,S); edges.push([u,v]); return; }
      const T=chA.get(dkey(v,S));
      rebuild(v,T); rebuild(v,S^T); return;
    }
  };
  rebuild(bestV,FULL);
  // 树边 → 邻接 → 从终端 0 DFS 生成有序任务
  const tadj=pts.map(()=>[]);
  for(const [a,b] of edges){ tadj[a].push(b); tadj[b].push(a); }
  const tasks=[];
  const root=termNode[0];
  const vis=new Uint8Array(V);
  const st=[[root,-1]];
  while(st.length){
    const [u,from]=st.pop();
    if(vis[u]) continue;
    vis[u]=1;
    if(from>=0) tasks.push({from:pts[from], to:pts[u]});
    for(const c of tadj[u]) if(!vis[c]) st.push([c,u]);
  }
  return tasks;
}

// Physical drill edges are independent of net identity and copper annulus diameter.
// Match the per-pad drill fallback used by manufacturing exports.
function manufacturingHoles(design,result){
  const holes=[],byDrill=new Map();
  const L=Math.max(1,design.layers|0);
  const add=h=>{
    // Merge only equivalent drills on a known shared net. Keep every pad for
    // annular-ring checks; unlike coordinates alone, this cannot hide shorts or
    // conflicting concentric drill diameters.
    // #15：合并键必须含层跨度——同一 XY 的埋孔与通孔是**两块不同的物理钻**
    //（埋孔只钻内层，通孔贯穿），合并会丢失其一并伪造孔边距豁免。
    const span=h.span||[0,L-1];
    // 深优 2026-11-14：数值逗号拼接键替代 JSON.stringify（同唯一性、免数组分配与序列化）
    const key=h.net!=null?h.x+','+h.y+','+h.r+','+h.net+','+span[0]+','+span[1]:null;
    const prev=key!=null?byDrill.get(key):null;
    if(prev){
      if(h.pad){prev.pads.push(h.pad);prev.pad=prev.pad||h.pad;}
      prev.hasVia=prev.hasVia||h.hasVia;
      return;
    }
    h.pads=h.pad?[h.pad]:[];
    h.span=span;
    h.through=span[0]===0&&span[1]===L-1;
    holes.push(h);
    if(key!=null)byDrill.set(key,h);
  };
  for(const p of design.pads||[]){
    const r=p.holeR!=null?p.holeR:design.viaDrill/2;
    // 焊盘孔贯穿（PTH）；span 全层
    if(p.layer==='both'&&r>0) add({x:p.x,y:p.y,r,net:p.netId,pad:p,label:'焊盘 '+p.id,span:[0,L-1]});
  }
  for(const n of result?.nets||[]) for(const v of n.vias||[]){
    const span=viaSpan(v,L);
    add({x:v.x,y:v.y,r:(v.drill!=null?v.drill/2:design.viaDrill/2),net:n.netId,hasVia:true,
      span,outer:v.outer,
      label:(span[0]===0&&span[1]===L-1?'过孔':'盲埋孔')+' ('+v.x.toFixed(2)+','+v.y.toFixed(2)+')'});
  }
  for(const v of design.stitching||[])
    add({x:v.x,y:v.y,r:design.viaDrill/2,net:v.netId,hasVia:true,span:[0,L-1],label:'缝合孔 ('+v.x.toFixed(2)+','+v.y.toFixed(2)+')'});
  return holes;
}
function padBoardEdgeGap(design,p){
  const hx=p.w/2,hy=(p.shape==='circle'?p.w:p.h)/2;
  return Math.min(p.x-hx,design.width-p.x-hx,p.y-hy,design.height-p.y-hy);
}

/* ---------- DRC 设计规则检查 ---------- */
function checkDRC(design, result, opts){
  opts=opts||{};
  // 覆铜来源归一化：opts 显式传入优先（GUI），否则取结果自带（CLI drc 不传 opts 也能审查铜皮）。
  // 按 netId@layer 去重——r.pours 与 r.pour 同时存在时不重复报告。
  const pourList=(()=>{
    const seen=new Set(), out=[];
    const take=p=>{
      if(!p||!p.polys||!p.polys.length) return;
      const k=(p.netId==null?'?':p.netId)+'@'+(p.layer==null?'?':p.layer);
      if(!seen.has(k)){ seen.add(k); out.push(p); }
    };
    (Array.isArray(opts.pour)?opts.pour:opts.pour?[opts.pour]:[]).forEach(take);
    (opts.pours||[]).forEach(take);
    ((result&&result.pours)||[]).forEach(take);
    if(result&&result.pour) take(result.pour);
    return out;
  })();
  const pourNetName=p=>{ const n=(design.nets||[]).find(x=>x.id===p.netId); return n?n.name:'?'; };
  result={...result,nets:(result?.nets||[]).map(n=>({...n,paths:(n.paths||[]).map(mergePathPts),vias:n.vias||[]}))};
  const widths=new Map((design.nets||[]).map(n=>[n.id,netW(design,n.id)]));
  const wOf=id=>widths.get(id)||design.trackW;
  // 逐对间距（0.14.7 批次2 A2）：声明网（voltage 查表/class clr）与异网导体的间距
  // 取 max(两网 netClr)——布线期影响区推开是必要条件，DRC 在此闭环复核。
  // 无声明设计 clrMap 全为全局值 → 所有点位级不变。
  const clrMap=new Map((design.nets||[]).map(n=>[n.id,netClr(design,n.id)]));
  const clrOf=id=>(id!=null&&clrMap.get(id))||design.clearance;
  const clrBetween=(a,b)=>Math.max(clrOf(a),clrOf(b));
  let _clrMax=design.clearance;
  for(const c of clrMap.values()) if(c>_clrMax) _clrMax=c;
  const issues=[];
  const add=(sev,type,msg)=>{ if(issues.length<200) issues.push({sev,type,msg}); };
  // 未连通（铺铜语义升级 0.11.7）：网内全部焊盘落入同网铜皮 = 已被铜皮接通，
  // 不计未连通（真实 EDA 同口径——GND 类网的连接方式就是铜皮）。部分落入仍如实报错。
  for(const n of result.nets){
    if(n.connected<n.total){
      const _ps=(design.pads||[]).filter(p=>p.netId===n.netId);
      const _mp=pourList.find(p=>p.netId===n.netId);
      if(_ps.length&&_mp&&_ps.every(p=>pourContains(_mp,p.x,p.y))) continue;
      add('error','未连通','网络 '+n.name+'：还有 '+(n.total-n.connected)+' 个焊盘未连通');
    }
  }
  for(const o of (result.overuse||[]).slice(0,60))
    add('error','间距冲突','(' + o.x.toFixed(2) + ', ' + o.y.toFixed(2) + ') mm 附近，第 ' + (o.l+1) + ' 层不同网络走线/过孔重叠');
  const pads=design.pads||[];
  // Different-net copper must meet the requested clearance, not merely avoid overlap.
  // external 同元件豁免（0.11.7，与 spec 对等）：真实封装密距/重叠=封装作者
  // ground truth（TYPE-C A6/A7 同位、ESP32-S3 模块 castellated 沿边 pad 1.5
  // 重叠节距 1.27——开源广场/器件库实样），仅豁免同元件对，异元件仍全查。
  const _extSameComp=design.external===true;
  // 深度优化（0.11.0）：外层格距快速过滤+层列表提升出热循环。保序充分性：
  // 焊盘边上任意点距中心 ≤ hypot(w,h)/2 ≤ maxPadR ⇒ 违规对中心距 < clearance+2·maxPadR，
  // 逐轴分量同界——轴距超界者必不违规，直接跳过（candidates 是保守超集，findings 不变）。
  let _maxPadR=0;
  for(const p of pads) _maxPadR=Math.max(_maxPadR, Math.hypot(p.w,p.h)/2);
  const _padR2=_clrMax+2*_maxPadR+1e-9;
  const _layerList=Array.from({length:design.layers},(_,l)=>l);
  for(let i=0;i<pads.length;i++)for(let j=i+1;j<pads.length;j++){
    const a=pads[i], b=pads[j];
    if(a.netId!=null && b.netId!=null && a.netId===b.netId) continue;
    if(_extSameComp && a.id.split('-')[0]===b.id.split('-')[0]) continue;   // external 同元件豁免
    if(Math.abs(a.x-b.x)>_padR2||Math.abs(a.y-b.y)>_padR2) continue;
    if(!_layerList.some(l=>padOnLayer(a,l,design.layers)&&padOnLayer(b,l,design.layers))) continue;
    const need=clrBetween(a.netId,b.netId);
    const gap=padGap(a,b);
    if(gap<-1e-9) add('error','焊盘重叠','焊盘 '+a.id+' 与 '+b.id+' 重叠');
    else if(gap<need-1e-9)
      add('error','焊盘间距','焊盘 '+a.id+' 与 '+b.id+' 铜边间距 '+Math.max(0,gap).toFixed(3)+'mm < 设计间距 '+need+'mm');
  }
  // 焊盘出板 / 落入禁布区（class keepout：本类网焊盘自由，roadmap #10）
  const _drcCls=netClsMap(design);
  for(const p of pads){
    if(padBoardEdgeGap(design,p)<-1e-9)
      add('warn','焊盘出板','焊盘 '+p.id+' 超出板框');
    for(const k of (design.keepouts||[])){
      if(k.scope&&_drcCls.get(p.netId)===k.scope) continue;
      if(Math.abs(p.x-k.x)<(p.w+k.w)/2 && Math.abs(p.y-k.y)<(p.h+k.h)/2)
        add('warn','禁布区冲突','焊盘 '+p.id+' 位于禁布区内');
    }
  }
  // 过孔间距 / 过孔与焊盘、走线的间距（不同网络）；缝合孔视作其网络过孔。
  // 阶段三 #15：盲埋孔带层跨度——只与**跨度相交**的对象比较（不相交则物理上
  // 不在同一层，间距无意义；DRC 放宽必须由 span 判定，而不是全局豁免）。
  const holes=manufacturingHoles(design,result);
  const L_=Math.max(1,design.layers|0);
  const vias=holes.filter(h=>h.hasVia).map(h=>({
    x:h.x,y:h.y,net:h.net,
    outer:h.outer!=null?h.outer:design.viaOuter,
    drill:2*h.r,
    span:h.span||[0,L_-1]
  }));
  const spanHit=(a,b)=>a[0]<=b[1]&&b[0]<=a[1];
  // 微孔（HDI，阶段三 #15）：激光孔受深径比与"只能跨相邻层"两条硬约束。
  // 判据：钻孔 ≤ microvia.drill 即按激光孔口径查（机械钻孔极限不适用），
  // 但必须满足 ringMin 且 span 跨度 ≤ 1（相邻层）。跨多层的"小孔"是伪 HDI。
  for(const v of vias){
    if(v.drill > JLC.microvia.drill+1e-9) continue;      // 机械孔，走既有 DFM
    const ring=v.outer-v.drill;
    if(ring < JLC.microvia.ringMin-1e-9)
      add('error','HDI 激光孔环宽','激光孔 ('+v.x.toFixed(2)+','+v.y.toFixed(2)+') 环宽 '+ring.toFixed(3)+'mm < '+JLC.microvia.ringMin+'mm');
    if(JLC.microvia.adjacentOnly && (v.span[1]-v.span[0])>1)
      add('error','HDI 激光孔跨度','激光孔 ('+v.x.toFixed(2)+','+v.y.toFixed(2)+') 跨 '+(v.span[1]-v.span[0])+' 层；激光孔只能跨相邻层（深径比 1:1）');
    if(v.drill < JLC.microvia.drill-1e-9)
      add('warn','HDI 激光孔孔径','激光孔钻孔 '+v.drill.toFixed(3)+'mm < 工艺口径 '+JLC.microvia.drill+'mm，需与板厂确认');
  }
  for(let i=0;i<vias.length;i++)for(let j=i+1;j<vias.length;j++){
    const a=vias[i], b=vias[j];
    if(a.net===b.net) continue;
    if(!spanHit(a.span,b.span)) continue;                 // 层跨度不相交：不比较
    if(Math.hypot(a.x-b.x,a.y-b.y) < (a.outer+b.outer)/2+clrBetween(a.net,b.net))
      add('error','过孔间距','(' + a.x.toFixed(2) + ',' + a.y.toFixed(2) + ') 与 (' + b.x.toFixed(2) + ',' + b.y.toFixed(2) + ') 过孔间距不足');
  }
  for(const v of vias){
    if(Math.min(v.x,design.width-v.x,v.y,design.height-v.y)<v.outer/2-1e-9)
      add('warn','过孔出板','过孔 ('+v.x.toFixed(2)+','+v.y.toFixed(2)+') 超出板框');
    const _vR=v.outer/2+_clrMax+_maxPadR;   // 过孔-焊盘违规对的最大轴距界（含声明网逐对口径）
    for(const p of pads){
      if(p.netId!=null && p.netId===v.net) continue;
      // 焊盘不在该过孔的跨度内 ⇒ 不同层，无间距约束
      if(!shpLayerInSpan(p, v.span, L_)) continue;
      if(Math.abs(v.x-p.x)>_vR||Math.abs(v.y-p.y)>_vR) continue;
      const d=pointPadDistance(v.x,v.y,p);
      const need=clrBetween(v.net,p.netId);
      if(d < v.outer/2+need-1e-9)   // -1e-9：恰在边界(=间距)不算违规，H1 教训
        add('error','过孔-焊盘间距','过孔 ('+v.x.toFixed(2)+','+v.y.toFixed(2)+') 距焊盘 ' + p.id + ' 过近');
    }
    for(const n of result.nets){
      if(n.netId===v.net) continue;
      let hit=false;
      const _nw2=wOf(n.netId)/2;   // 深优 2026-11-14：复用 widths 缓存，免逐段重复 netW 查找
      const _vsR=v.outer/2+_clrMax+_nw2+1e-9;   // 违规时 via 中心距段 bbox ≤ 此界（含声明网逐对口径）
      for(const path of n.paths){
        for(let k=1;k<path.length;k++){
          const a=path[k-1], b=path[k];
          if(a.l!==b.l) continue;
          if(!(a.l>=v.span[0]&&a.l<=v.span[1])) continue;   // 走线层不在跨度内
          if(v.x<Math.min(a.x,b.x)-_vsR||v.x>Math.max(a.x,b.x)+_vsR||
             v.y<Math.min(a.y,b.y)-_vsR||v.y>Math.max(a.y,b.y)+_vsR) continue;
          const d=segDist(v.x,v.y,a.x,a.y,b.x,b.y);
          if(d < design.viaOuter/2+clrBetween(v.net,n.netId)+_nw2-1e-9){ hit=true; break; }
        }
        if(hit) break;
      }
      if(hit){ add('error','过孔-走线间距','过孔 (' + v.x.toFixed(2) + ',' + v.y.toFixed(2) + ') 距网络 ' + n.name + ' 的走线过近'); break; }
    }
  }
  // 插件孔：环宽与物理孔边距；同网不豁免，焊盘孔与过孔/缝合孔也须比较。
  // 机械安装孔豁免（外部板实测缺口）：无网 THT 焊盘 = 无铜环的机械孔（NPTH），
  // 环宽/孔径检查不适用——板上是钻孔本体，障碍语义保留（route 绕行）。
  {
    for(const h of holes) for(const p of h.pads){
      const dpad=(design.pads||[]).find(q=>q.id===p.id);
      if(dpad && dpad.netId==null) continue;   // 机械孔：无铜环
      const ring=Math.min(p.w,p.shape==='circle'?p.w:p.h)/2-h.r;
      if(ring<JLC.annular.min-1e-9) add('error','插件孔环宽','焊盘 '+p.id+' 环宽 '+ring.toFixed(2)+'mm < 极限 '+JLC.annular.min+'mm');
      else if(ring<JLC.annular.suggest-1e-9) add('warn','插件孔环宽','焊盘 '+p.id+' 环宽 '+ring.toFixed(2)+'mm < 建议 '+JLC.annular.suggest+'mm');
      // 每焊盘钻孔直径下限：全局 viaDrill 检查盖不住逐焊盘 holeR——
      // holeR 0.04 → 钻孔 0.08mm 低于机械钻孔极限却曾随全局值放行（正确性复查留档缺口）
      if(h.r*2<JLC.via.double.drill-1e-9)
        add('error','插件孔孔径','焊盘 '+p.id+' 钻孔直径 '+(h.r*2).toFixed(2)+'mm < 机械钻孔极限 '+JLC.via.double.drill+'mm');
    }
    for(let i=0;i<holes.length;i++)for(let j=i+1;j<holes.length;j++){
      const a=holes[i], b=holes[j];
      if(!a.pad&&!b.pad) continue; // via-only DFM check below retains its warning severity.
      // #15：层跨度不相交的孔物理上不共存于同一层——同 XY 的埋孔与通孔合法
      //（埋孔只钻内层）。span 相同的仍必须满足孔边距（同网也不豁免）。
      if(a.span&&b.span&&!(a.span[0]<=b.span[1]&&b.span[0]<=a.span[1])) continue;
      const d=Math.hypot(a.x-b.x,a.y-b.y)-a.r-b.r;
      if(d<JLC.viaEdgeMin-1e-9)
        add('error','孔边距',a.label+' 与 '+b.label+' 孔边距 '+Math.max(0,d).toFixed(2)+'mm < '+JLC.viaEdgeMin+'mm');
    }
  }
  // Exact segment/shape tests: short obstacles must not disappear between samples.
  let _segMaxPadR=0;
  for(const p of pads) _segMaxPadR=Math.max(_segMaxPadR, Math.hypot(p.w,p.h)/2);
  for(const n of result.nets) for(const path of n.paths) for(let i=1;i<path.length;i++){
    const a=path[i-1],b=path[i];
    if(a.l!==b.l) continue;
    const half=wOf(n.netId)/2;
    const _sR=half+_clrMax+_segMaxPadR;   // 违规时焊盘中心距段 bbox ≤ 此界（保序快速过滤；含声明网逐对口径）
    const _sMinX=Math.min(a.x,b.x)-_sR, _sMaxX=Math.max(a.x,b.x)+_sR;
    const _sMinY=Math.min(a.y,b.y)-_sR, _sMaxY=Math.max(a.y,b.y)+_sR;
    for(const p of pads){
      if((p.netId!=null&&p.netId===n.netId)||!padOnLayer(p,a.l,design.layers)) continue;
      if(p.x<_sMinX||p.x>_sMaxX||p.y<_sMinY||p.y>_sMaxY) continue;
      if(segmentPadDistance(a,b,p)<half+clrBetween(n.netId,p.netId)-1e-9){
        add('error',n.manual?'手动布线冲突':'走线-焊盘间距','走线距焊盘 '+p.id+' 过近');break;
      }
    }
    for(const k of design.keepouts||[]){
      if(k.scope&&_drcCls.get(n.netId)===k.scope) continue;   // class keepout 本类网自由
      if(segmentRectDistance(a,b,k)<half-1e-9){
        add('error',n.manual?'手动布线冲突':'走线-禁布区冲突','走线穿越禁布区');break;
      }
    }
    if(a.x<half||b.x<half||a.y<half||b.y<half||a.x>design.width-half||b.x>design.width-half||a.y>design.height-half||b.y>design.height-half)
      add('warn',n.manual?'手动布线出板':'走线出板','走线超出板框或过于贴近板边');
  }
  // 全部同层线段的精确间距审计：包含正交交叉、斜线、手动线和每网线宽。
  // 按层、包围盒左边界排序，超出可能间距后提前结束，避免全场两两比较。
  if(result&&result.nets){
    const segs=[];
    for(const n of result.nets) for(const path of n.paths)
      for(let k=1;k<path.length;k++){
        const a=path[k-1], b=path[k];
        if(a.l!==b.l) continue;
        if(Math.abs(a.x-b.x)<1e-9 && Math.abs(a.y-b.y)<1e-9) continue;
        segs.push({net:n.netId, x1:a.x,y1:a.y,x2:b.x,y2:b.y, l:a.l,
          w:netW(design,n.netId), minX:Math.min(a.x,b.x), maxX:Math.max(a.x,b.x),
          minY:Math.min(a.y,b.y), maxY:Math.max(a.y,b.y)});
      }
    segs.sort((a,b)=>a.l-b.l || a.minX-b.minX);
    const maxW=segs.reduce((w,s)=>Math.max(w,s.w),design.trackW);
    for(let i=0;i<segs.length && issues.length<200;i++){
      const s=segs[i], reach=(s.w+maxW)/2+_clrMax;
      for(let j=i+1;j<segs.length;j++){
        const t=segs[j];
        if(t.l!==s.l || t.minX>s.maxX+reach) break;
        if(s.net===t.net) continue;
        const need=(s.w+t.w)/2+clrBetween(s.net,t.net);
        if(t.minX>s.maxX+need || t.minY>s.maxY+need || t.maxY<s.minY-need) continue;
        if(segSegDist(s.x1,s.y1,s.x2,s.y2, t.x1,t.y1,t.x2,t.y2)<need-1e-9){
          add('error','走线间距','走线段 ('+s.x1.toFixed(2)+','+s.y1.toFixed(2)+') 与其它网络走线间距不足');
          if(result.nets.some(n=>n.manual&&(n.netId===s.net||n.netId===t.net))) add('error','手动布线冲突','手动走线与其它网络走线间距不足');
          break;
        }
      }
    }
  }
  // ---- 嘉立创 DFM 工艺检查（阈值来自官网加工能力参数表，投板前以官网最新为准） ----
  if(opts.dfm!==false){
    const rule=jlcTrackRule(design);
    if(design.trackW<rule.limit-1e-9) add('error','DFM 线宽','线宽 '+design.trackW+'mm 低于'+(design.layers>=4?'多层':'单双面')+' '+design.copperWeight+'oz 极限 '+rule.limit+'mm');
    else if(design.trackW<rule.suggest-1e-9) add('warn','DFM 线宽','线宽 '+design.trackW+'mm 低于建议 '+rule.suggest+'mm（极限 '+rule.limit+'mm，±20% 公差）');
    for(const n of design.nets||[]) if(n.w){
      if(n.w<rule.limit-1e-9) add('error','DFM 线宽','网络 '+n.name+' 线宽 '+n.w+'mm 低于极限 '+rule.limit+'mm');
      else if(n.w<rule.suggest-1e-9) add('warn','DFM 线宽','网络 '+n.name+' 线宽 '+n.w+'mm 低于建议 '+rule.suggest+'mm');
    }
    if(design.clearance<rule.limit-1e-9) add('error','DFM 间距','间距 '+design.clearance+'mm 低于极限 '+rule.limit+'mm');
    else if(design.clearance<rule.suggest-1e-9) add('warn','DFM 间距','间距 '+design.clearance+'mm 低于建议 '+rule.suggest+'mm');
    if(design.viaDrill<JLC.via.double.drill-1e-9) add('error','DFM 钻孔','钻孔 '+design.viaDrill+'mm 低于极限 0.15mm（非常规且费用高）');
    else if(design.viaDrill<JLC.viaSuggest.drill-1e-9) add('warn','DFM 钻孔','钻孔 '+design.viaDrill+'mm 小于常规 0.3mm，可能加收');
    const ring=design.viaOuter-design.viaDrill;
    if(ring<JLC.viaRingMin-1e-9) add('error','DFM 过孔环宽','过孔外径−内径 '+ring.toFixed(2)+'mm < 0.10mm 极限（推荐 ≥0.15mm）');
    else if(ring<0.15-1e-9) add('warn','DFM 过孔环宽','过孔外径−内径 '+ring.toFixed(2)+'mm，推荐 ≥0.15mm');
    if(design.viaOuter<JLC.via.double.outer-1e-9) add('warn','DFM 过孔','过孔外径 '+design.viaOuter+'mm 低于极限 0.25mm（双层）');
    // 孔边到孔边 ≥0.20mm（含同网络过孔；缝合孔同样计入）
    // #15：层跨度不相交的孔不共存于一层——埋孔与通孔同 XY 合法，不报警；
    // 孔径用各自实际钻径（支持微孔），而非全局 design.viaDrill。
    const edgeD=(x,y)=>Math.min(x, design.width-x, y, design.height-y);
    let viaEdgeWarned=0;
    for(let i=0;i<vias.length && viaEdgeWarned<5;i++)for(let j=i+1;j<vias.length;j++){
      if(!spanHit(vias[i].span, vias[j].span)) continue;
      const gap=Math.hypot(vias[i].x-vias[j].x, vias[i].y-vias[j].y)
        -(vias[i].drill/2+vias[j].drill/2);
      if(gap<JLC.viaEdgeMin-1e-9){
        add('warn','DFM 过孔间距','过孔孔边距 '+Math.max(0,gap).toFixed(2)+'mm < 0.20mm（建议 0.30mm），位置 ('+vias[i].x.toFixed(1)+','+vias[i].y.toFixed(1)+')');
        viaEdgeWarned++; break;
      }
    }
    // 焊盘边到线边 ≥0.10mm（不同网络）
    if(result&&result.nets){
      let ptWarned=0;
      for(const n of result.nets){ if(ptWarned>=5) break;
        for(const path of n.paths){ if(ptWarned>=5) break;
          for(let k=1;k<path.length;k++){
            const a=path[k-1], b=path[k];
            if(a.l!==b.l) continue;
            for(const p of pads){
              if(p.netId!=null && p.netId===n.netId) continue;
              if(p.x<Math.min(a.x,b.x)-2 || p.x>Math.max(a.x,b.x)+2 ||
                 p.y<Math.min(a.y,b.y)-2 || p.y>Math.max(a.y,b.y)+2) continue;
              if(!padOnLayer(p,a.l,design.layers)) continue;
              const g=segmentPadDistance(a,b,p)-wOf(n.netId)/2;
              if(g<JLC.padToTrackMin-1e-9){
                add('warn','DFM 焊盘到线','焊盘 '+p.id+' 到线边 '+Math.max(0,g).toFixed(2)+'mm < 0.10mm（BGA 局部 0.09mm）');
                ptWarned++; break;
              }
            }
          }
        }
      }
    }
    for(const p of (design.pads||[])){
      const d0=padBoardEdgeGap(design,p);
      if(d0<0.2-1e-9) add('warn','DFM 板边','焊盘 '+p.id+' 距板边 '+Math.max(0,d0).toFixed(2)+'mm < 0.2mm（建议 0.3~0.5mm）');
    }
    for(const v of vias){
      if(edgeD(v.x,v.y)-design.viaOuter/2<JLC.boardEdgeMin-1e-9)
        add('warn','DFM 板边','过孔 ('+v.x.toFixed(2)+','+v.y.toFixed(2)+') 距板边不足 '+JLC.boardEdgeMin+'mm（建议 0.3~0.5mm）');
    }
    if(result&&result.nets){
      let edgeHit=false;
      for(const n of result.nets){ if(edgeHit) break;
        for(const path of n.paths){ if(edgeHit) break;
          for(const pt of path){
            if(edgeD(pt.x,pt.y)-wOf(n.netId)/2<JLC.boardEdgeMin-1e-9){
              add('warn','DFM 板边','走线点 ('+pt.x.toFixed(1)+','+pt.y.toFixed(1)+') 距板边不足 0.2mm（建议 0.3~0.5mm）');
              edgeHit=true; break;
            }
          }
        }
      }
    }
    // 不同网络焊盘间距 ≥0.10mm
    for(let i=0;i<pads.length;i++)for(let j=i+1;j<pads.length;j++){
      const a=pads[i], b=pads[j];
      if(a.netId!=null && b.netId!=null && a.netId===b.netId) continue;
      if(!Array.from({length:design.layers},(_,l)=>l).some(l=>padOnLayer(a,l,design.layers)&&padOnLayer(b,l,design.layers))) continue;
      const gap=padGap(a,b);
      if(gap<0.10-1e-9) add('warn','DFM 焊盘间距','焊盘 '+a.id+' 与 '+b.id+' 间距 '+Math.max(0,gap).toFixed(2)+'mm < 0.10mm');
    }
  }
  // ---- 3W 检查：标记为高速的网络与其它网络同层中心距 ≥ 3×线宽 ----
  // 同差分对（nets[].pair 同组）内部豁免——对内两线本来就要靠近走线
  const pairOf=id=>{ const n=(design.nets||[]).find(nn=>nn.id===id); return (n&&n.pair)||null; };
  const hsIds=new Set((design.nets||[]).filter(n=>n.hs).map(n=>n.id));
  if(hsIds.size && result && result.nets){
    const w3=3*design.trackW;
    const segs3w=[];
    for(const n of result.nets) for(const path of n.paths) for(let k=1;k<path.length;k++){
      const a=path[k-1], b=path[k];
      if(a.l!==b.l || (Math.abs(a.x-b.x)<1e-9&&Math.abs(a.y-b.y)<1e-9)) continue;
      segs3w.push({net:n.netId, x1:a.x,y1:a.y,x2:b.x,y2:b.y, l:a.l,
        bx:[Math.min(a.x,b.x),Math.min(a.y,b.y),Math.max(a.x,b.x),Math.max(a.y,b.y)]});
    }
    let warned3w=0;
    for(const a of segs3w){
      if(!hsIds.has(a.net) || warned3w>=8) continue;
      for(const b of segs3w){
        if(a.net===b.net || a.l!==b.l) continue;
        const pa=pairOf(a.net), pb=pairOf(b.net);
        if(pa && pa===pb) continue;                       // 同对豁免
        if(b.bx[2]<a.bx[0]-w3||a.bx[2]<b.bx[0]-w3||b.bx[3]<a.bx[1]-w3||a.bx[3]<b.bx[1]-w3) continue;
        const dd=segSegDist(a.x1,a.y1,a.x2,a.y2, b.x1,b.y1,b.x2,b.y2);
        if(dd<w3-1e-9){
          add('warn','3W 间距','高速网络走线与其它网络中心距 '+dd.toFixed(2)+'mm < 3W（'+w3.toFixed(2)+'mm）——注意串扰（两层板此规则常不适用，按 3H~4H 评估）');
          warned3w++; break;
        }
      }
    }
  }
  // ---- 差分对 lite 等长检查：pair 组内两网走线长度差 > 0.2×UI 预算则告警 ----
  // 预算口径：有 tr 的对按 ΔL≤0.2×tr×v（Bogatin ch11 错位预算）；无 tr 按 ≤5% 相对差（提醒级）。
  // lenGroup（等长组）同口径评差——蛇形生成器（serpentineTune）以同尺补齐。
  {
    const groups=new Map();
    for(const n of (design.nets||[])){
      if(n.pair){ if(!groups.has('p:'+n.pair)) groups.set('p:'+n.pair, {label:n.pair, kind:'差分对', members:[]}); groups.get('p:'+n.pair).members.push(n); }
      if(n.lenGroup){ if(!groups.has('l:'+n.lenGroup)) groups.set('l:'+n.lenGroup, {label:n.lenGroup, kind:'等长组', members:[]}); groups.get('l:'+n.lenGroup).members.push(n); }
    }
    for(const [, {label:g, kind:gkind, members}] of groups){
      if(members.length<2) continue;
      const lens=members.map(m=>({net:m, len:netRoutedLen(design, result, m.id)+(m.padToDie>0?m.padToDie:0)}));
      if(lens.some(x=>x.len<=0)) continue;                 // 未布线的对不评
      lens.sort((a,b)=>b.len-a.len);
      const dLen=lens[0].len-lens[lens.length-1].len;
      const trs=members.map(m=>m.tr).filter(t=>t>0);
      let budget=null, basis='';
      if(trs.length===members.length){
        const trMin=Math.min(...trs);
        budget=0.2*trMin*1e-9*299792458/Math.sqrt(4.5)*1000;   // mm：0.2×tr×v（FR-4）
        basis='0.2×UI 错位预算（Tr='+trMin+'ns，Bogatin ch11）';
      } else {
        budget=Math.max(0.05*lens[0].len, 2);
        basis='≤5% 相对差（无 tr，提醒级）';
      }
      if(dLen>budget+1e-9)
        add('warn','差分等长',gkind+' '+g+' 两网长度差 '+dLen.toFixed(1)+'mm 超预算 '+budget.toFixed(1)+'mm（'+basis+'）——长度失配转化为共模（Archambeault：1% 失配即显著抬升共模）；蛇形补偿节距 ≥3H（Altium 教材）');
      // ---- 差分耦合度（roadmap #3，奇偶模口径）：对内平行段处于设计间隙带的长度占比 ----
      if(gkind==='差分对'&&result&&result.nets){
        const zt=members[0].diffZ>0?members[0].diffZ:90;
        const zi=diffPairZFor(design, netW(design, members[0].id), zt);
        const gEff=pairGapFor(design, members[0]);
        if(gEff==null){
          // 反查不可达且无显式 gap → 诚实报告（显式 gap = 用户用叠层工具覆写，不拦）
          add('warn','差分耦合','差分对 '+g+' 目标 '+zt+'Ω 在当前叠层不可达（'+zi.stackup.note+'，最低可达 '+zi.zdiffMinAtSmin+'Ω @ S=0.1mm）——建议 4 层或放宽目标/接受不控阻抗');
        }else{
          const gStep=Math.max(design.grid, 0.25);
          let coupledLen=0, totalLen=0;
          for(const m of members){
            const other=members.find(x=>x.id!==m.id);
            const oNets=[...((result&&result.nets)||[]), ...manualRouteEntries(design)].filter(x=>x.netId===other.id);
            const mNets=[...((result&&result.nets)||[]), ...manualRouteEntries(design)].filter(x=>x.netId===m.id);
            const wM=netW(design, m.id), wO=netW(design, other.id);
            const bandCenter=(wM+wO)/2+(gEff!=null?gEff:zi.sFor);
            // 耦合采样（0.13.27 提取为 pairCoupleStats——DRC 与压实器单一事实源）
            const st=pairCoupleStats(mNets.map(n=>n.paths||[]), oNets.map(n=>n.paths||[]), bandCenter, gStep);
            coupledLen+=st.coupledLen; totalLen+=st.totalLen;
          }
          const ratio=totalLen>0?coupledLen/totalLen:0;
          if(totalLen>0&&ratio<0.6)
            add('warn','差分耦合','差分对 '+g+' 对内耦合占比 '+Math.round(ratio*100)+'%（目标间隙 S='+(gEff!=null?gEff:zi.sFor)+'mm @ '+zt+'Ω，Z0='+zi.z0+'Ω）——未耦合段差模阻抗偏高、抗共模弱（Bogatin ch11）；建议清除对内障碍后重布（耦合走廊已按设计间隙建偏置）');
        }
      }
    }
  }
  // ---- 换层跨参考平面检查（Archambeault 换层组合白名单）：过孔直跨中间参考平面 → 告警 ----
  // 四层 SIG-GND-PWR-SIG 中 0↔3 直跨（隔 GND+PWR 双平面）即"3-9 型禁用组合"；
  // 双层板无中间平面，永不触发。回流须经平面间电容桥接——就近配置桥接电容/缝合孔。
  if((design.layers||2)>=4 && result && result.nets){
    let spanWarned=0;
    for(const n of result.nets) for(const path of n.paths){
      for(let k=1;k<path.length;k++){
        const a=path[k-1], b=path[k];
        if(a.l===b.l) continue;
        const lo=Math.min(a.l,b.l), hi=Math.max(a.l,b.l);
        if(hi-lo>1 && spanWarned<8){
          add('warn','换层跨参考平面','过孔 ('+a.x.toFixed(2)+','+a.y.toFixed(2)+') 从第 '+(lo+1)+' 层直跨到第 '+(hi+1)+' 层，中间隔 '+(hi-lo-1)+' 个参考平面——回流须经平面间电容桥接（换层组合白名单：跨双平面型需就近桥接电容/缝合孔）');
          spanWarned++;
        }
      }
    }
  }
  // ---- 回流地孔检查：信号过孔 2mm 内应有地网络导体（有地网络+覆铜时启用） ----
  const gndNet=(design.nets||[]).find(n=>/^(gnd|GND|地|AGND|DGND|PGND)/.test(n.name));
  const gndPour=gndNet?pourList.find(p=>p.netId===gndNet.id):null;
  if(gndPour && gndNet){
    const gndId=gndNet.id;
    const gndPts=(design.stitching||[]).filter(s=>s.netId===gndId).map(s=>({x:s.x,y:s.y}));
    for(const v of vias){
      if(v.net===gndId) continue;
      let near=pourNear(gndPour, v.x, v.y, 2+1e-9);
      if(!near) for(const q of gndPts)
        if(Math.hypot(v.x-q.x,v.y-q.y)<=2+1e-9){ near=true; break; }
      if(!near) for(const v2 of vias)
        if(v2.net===gndId && Math.hypot(v.x-v2.x,v.y-v2.y)<=2+1e-9){ near=true; break; }
      if(!near) for(const p of (design.pads||[]))
        if(p.netId===gndId && distToRect(v.x,v.y,p.x,p.y,p.w,p.shape==='circle'?p.w:p.h)<=2+1e-9){ near=true; break; }
      if(!near) add('warn','回流地孔','过孔 ('+v.x.toFixed(1)+','+v.y.toFixed(1)+') 2mm 内无地网络铜皮/缝合孔——换层处回流不连续，建议补地孔');
    }
  }
  // ---- 覆铜报告（逐块铜皮：孤岛统计/保留孤岛/接入失败） ----
  for(const po of pourList){
    if(po.islands>0)
      add('info','覆铜孤岛','铜皮 '+pourNetName(po)+' 已自动去除 '+po.islands+' 块孤岛铜（共 '+po.islandArea.toFixed(1)+'mm²）——孤岛铜不接地会成为天线，建议调整布局减少切地');
    if(po.islandsKept>0)
      add('warn','保留孤岛','铜皮 '+pourNetName(po)+' 按孤岛策略（'+(po.islandMode||'always')+'）保留 '+po.islandsKept+' 块孤岛铜（共 '+(po.keptIslandArea||0).toFixed(1)+'mm²）——未接地孤铜有天线与 EMI 风险，建议加缝合孔或改 islandMode=area');
    if(po.unconnectedPads && po.unconnectedPads.length)
      add('warn','铜皮接入失败','铜皮 '+pourNetName(po)+'：焊盘 '+po.unconnectedPads.slice(0,6).join('、')+(po.unconnectedPads.length>6?' 等 '+po.unconnectedPads.length+' 个':'')+' 在覆铜层邻域内无本网铜——筋条全被截断或四周被挖空，焊盘可能仅靠其它层连通');
  }
  return issues;
}
function segDist(px,py, ax,ay, bx,by){
  const dx=bx-ax, dy=by-ay, L2=dx*dx+dy*dy;
  if(L2<1e-12) return Math.hypot(px-ax,py-ay);
  let t=((px-ax)*dx+(py-ay)*dy)/L2;
  t=Math.max(0,Math.min(1,t));
  return Math.hypot(px-(ax+t*dx), py-(ay+t*dy));
}

/* ---------- 预拉线（未连通部分虚线显示） ---------- */
function computeRatsnest(design, result){
  const model=buildModel(design);
  const {GW,GH,L,NC}=model;
  const out=[];
  const netIdx=model.netIdx;
  for(const net of (design.nets||[])){
    const ni=netIdx.get(net.id);
    if(ni==null) continue;
    const pads=model.padsByNet.get(ni)||[];
    if(pads.length<2) continue;
    // 每个焊盘的覆盖单元
    const padStates=pads.map(p=>model.padCells.get(p.id)||[]);
    // 已布线单元集合与过孔集合
    const cells=new Set(), viaCells=new Set();
    if(result){
      const rn=result.nets.find(r=>r.netId===net.id);
      if(rn){
        if(rn.cells && rn.cells.length){
          for(const s of rn.cells) cells.add(s);   // 精确布线单元（切角后仍正确）
        } else for(const path of rn.paths) for(const pt of path){
          const i=Math.max(0,Math.min(GW-1,Math.floor(pt.x/model.grid-0.5)));
          const j=Math.max(0,Math.min(GH-1,Math.floor(pt.y/model.grid-0.5)));
          cells.add(pt.l*NC+j*GW+i);
        }
        for(const v of rn.vias){
          const i=Math.max(0,Math.min(GW-1,Math.floor(v.x/model.grid-0.5)));
          const j=Math.max(0,Math.min(GH-1,Math.floor(v.y/model.grid-0.5)));
          viaCells.add(j*GW+i);
        }
      }
    }
    // 手动布线单元（走廊标记：与线段相交的格全标记）。此前沿折线细步采样，
    // 但 45° 斜线恰好沿格角穿越（x+y=格点常数）时采样会从格 (i,j) 直接跳到
    // (i±1,j±1)，4 邻域并查断链——EasyEDA 导入手动走线的预拉线假断（回路实测）。
    // 走廊标记与 buildModel markFixed 的段距离口径同源，几何完整。
    for(const m of (design.manual||[])){
      if(m.netId!==net.id) continue;
      const mark=(x,y,l)=>{
        const i=Math.max(0,Math.min(GW-1,Math.floor(x/model.grid-0.5)));
        const j=Math.max(0,Math.min(GH-1,Math.floor(y/model.grid-0.5)));
        cells.add(l*NC+j*GW+i);
      };
      const r=netW(design,m.netId)/2+model.grid*0.71+1e-6;   // 半线宽+半格对角：格方块与段相交即标记
      for(let k=0;k<m.pts.length;k++){
        const a=m.pts[k];
        mark(a.x,a.y,a.l);
        const b=m.pts[k+1];
        if(!b) continue;
        if(a.l!==b.l){
          const i=Math.max(0,Math.min(GW-1,Math.floor(a.x/model.grid-0.5)));
          const j=Math.max(0,Math.min(GH-1,Math.floor(a.y/model.grid-0.5)));
          viaCells.add(j*GW+i);
          continue;
        }
        const x0=Math.max(0,Math.floor((Math.min(a.x,b.x)-r)/model.grid-0.5));
        const x1=Math.min(GW-1,Math.floor((Math.max(a.x,b.x)+r)/model.grid-0.5));
        const y0=Math.max(0,Math.floor((Math.min(a.y,b.y)-r)/model.grid-0.5));
        const y1=Math.min(GH-1,Math.floor((Math.max(a.y,b.y)+r)/model.grid-0.5));
        for(let yy=y0;yy<=y1;yy++)for(let xx=x0;xx<=x1;xx++){
          const cx=(xx+0.5)*model.grid, cy=(yy+0.5)*model.grid;
          if(segDist(cx,cy,a.x,a.y,b.x,b.y)<=r) cells.add(a.l*NC+yy*GW+xx);
        }
      }
    }
    // 连通分量：4 邻域 + 过孔换层 + 同一焊盘的覆盖单元互连
    const comp=new Map();
    let cid=0;
    const cellPads=new Map();   // state -> [pad序号...]（同焊盘互连）
    padStates.forEach((sts,pi)=>{ for(const s of sts){
      if(!cellPads.has(s)) cellPads.set(s,[]);
      cellPads.get(s).push(pi);
    }});
    const relevant=new Set(cells);
    for(const sts of padStates) for(const s of sts) relevant.add(s);
    for(const s0 of relevant){
      if(comp.has(s0)) continue;
      cid++;
      const q=[s0]; comp.set(s0,cid);
      for(let qi=0;qi<q.length;qi++){
        const cur=q[qi], c=cur%NC, l=(cur/NC)|0;
        const nbs=[];
        if(c%GW>0) nbs.push(cur-1);
        if(c%GW<GW-1) nbs.push(cur+1);
        if(c>=GW) nbs.push(cur-GW);
        if(c<GW*(GH-1)) nbs.push(cur+GW);
        if(viaCells.has(c)){
          for(let ll=0;ll<L;ll++) if(ll!==l) nbs.push(ll*NC+c);
        }
        for(const pi of (cellPads.get(cur)||[]))
          for(const s of padStates[pi]) nbs.push(s);
        for(const nb of nbs) if(relevant.has(nb) && !comp.has(nb)){ comp.set(nb,cid); q.push(nb); }
      }
    }
    // 焊盘按分量分组
    const groups=new Map();
    for(let pi=0;pi<pads.length;pi++){
      let g=++cid; // 无单元的焊盘单独成组
      for(const s of padStates[pi]) if(comp.has(s)){ g=comp.get(s); break; }
      if(!groups.has(g)) groups.set(g,[]);
      groups.get(g).push(pads[pi]);
    }
    const gs=[...groups.values()];
    if(gs.length<2) continue;
    // 组心顺序连接
    const cents=gs.map(arr=>({x:arr.reduce((s,p)=>s+p.x,0)/arr.length, y:arr.reduce((s,p)=>s+p.y,0)/arr.length}));
    const used=new Array(gs.length).fill(false); used[0]=true;
    let cur=0;
    for(let k=1;k<gs.length;k++){
      let bi=-1, bd=Infinity;
      for(let i=0;i<gs.length;i++){
        if(used[i]) continue;
        const d=(cents[i].x-cents[cur].x)**2+(cents[i].y-cents[cur].y)**2;
        if(d<bd){ bd=d; bi=i; }
      }
      out.push({x1:cents[cur].x, y1:cents[cur].y, x2:cents[bi].x, y2:cents[bi].y, netId:net.id});
      used[bi]=true; cur=bi;
    }
  }
  return out;
}

/* ---------- SVG 导出 ---------- */
const SVG_COLORS={top:'#f87171', bottom:'#60a5fa', pad:'#eab308', via:'#facc15', board:'#0f3d2e', keepout:'#a78bfa'};
function buildSVG(design, result, extras){
  const W=design.width, H=design.height;
  const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
  let s='<svg xmlns="http://www.w3.org/2000/svg" width="'+W+'mm" height="'+H+'mm" viewBox="0 0 '+W+' '+H+'">\n';
  s+='<rect x="0" y="0" width="'+W+'" height="'+H+'" fill="'+SVG_COLORS.board+'"/>\n';
  for(const k of (design.keepouts||[]))
    s+='<rect x="'+(k.x-k.w/2)+'" y="'+(k.y-k.h/2)+'" width="'+k.w+'" height="'+k.h+'" fill="none" stroke="'+SVG_COLORS.keepout+'" stroke-width="0.15" stroke-dasharray="0.8 0.4"/>\n';
  const layerG=l=>'<g id="'+(l===0?'top':'bottom')+'">\n';
  let topG=layerG(0), botG=layerG(1);
  if(extras){
    const pourList=[...(Array.isArray(extras.pour)?extras.pour:(extras.pour?[extras.pour]:[])),
      ...(Array.isArray(extras.pours)?extras.pours:[])];
    const ringD=f=>'M'+f[0].toFixed(3)+' '+f[1].toFixed(3)
      +Array.from({length:f.length/2-1},(_,k)=>'L'+f[k*2+2].toFixed(3)+' '+f[k*2+3].toFixed(3)).join('')+'Z';
    for(const po of pourList){
      if(!po||!po.polys||!po.polys.length) continue;
      const pc=po.layer===0?SVG_COLORS.top:SVG_COLORS.bottom;
      const dstr=po.polys.map(poly=>ringD(poly.outer)+poly.holes.map(ringD).join('')).join('');
      const pstr='<path d="'+dstr+'" fill="'+pc+'" fill-opacity="0.3" fill-rule="evenodd"/>\n';
      if(po.layer===0) topG+=pstr; else botG+=pstr;
    }
  }
  if(result){
    for(const n of result.nets){
      for(const path of n.paths){
        const emit=(l,pts)=>{
          if(pts.length<2) return;
          const dstr=roundedPathD(pts,0.22);
          const str='<path d="'+dstr
            +'" fill="none" stroke="'+(l===0?SVG_COLORS.top:SVG_COLORS.bottom)+'" stroke-width="'+netW(design, n.netId)+'" stroke-linecap="round" stroke-linejoin="round"/>\n';
          if(l===0) topG+=str; else botG+=str;
        };
        let curL=null, pts=[];
        for(const pt of path){
          if(pt.l!==curL){ if(curL!==null) emit(curL,pts); pts=[]; curL=pt.l; }
          pts.push(pt);
        }
        if(curL!==null) emit(curL,pts);
      }
      for(const v of n.vias){
        // #15：盲埋孔只画在其 span 覆盖的层组——SVG 只有顶层/底层组（内层无组），
        // span 不含 0/L-1 的孔在两视图都不出现（图纸不再出现不存在的孔）。
        // 通孔（无 span）照旧两视图都画。孔径用逐孔 outer/drill（支持微孔）。
        const c='<circle cx="'+v.x.toFixed(3)+'" cy="'+v.y.toFixed(3)+'" r="'+((v.outer!=null?v.outer:design.viaOuter)/2)+'" fill="'+SVG_COLORS.via+'"/>'+
                '<circle cx="'+v.x.toFixed(3)+'" cy="'+v.y.toFixed(3)+'" r="'+((v.drill!=null?v.drill:design.viaDrill)/2)+'" fill="'+SVG_COLORS.board+'"/>\n';
        if(viaOnLayer(v,0,design.layers)) topG+=c;
        if(viaOnLayer(v,design.layers-1,design.layers)) botG+=c;
      }
    }
  }
  if(result&&(!extras||extras.teardrops!==false)){
    for(const td of teardropPolys(design,result)){
      const el='<polygon points="'+td.p.map(q=>q.x.toFixed(3)+','+q.y.toFixed(3)).join(' ')
        +'" fill="'+(td.l===0?SVG_COLORS.top:SVG_COLORS.bottom)+'"/>\n';
      if(td.l===0) topG+=el; else botG+=el;
    }
  }
  for(const s of (design.stitching||[])){
    const el='<circle cx="'+s.x.toFixed(3)+'" cy="'+s.y.toFixed(3)+'" r="'+(design.viaOuter/2)+'" fill="'+SVG_COLORS.via+'"/>'
      +'<circle cx="'+s.x.toFixed(3)+'" cy="'+s.y.toFixed(3)+'" r="'+(design.viaDrill/2)+'" fill="'+SVG_COLORS.board+'"/>\n';
    topG+=el; botG+=el;
  }
  for(const p of (design.pads||[])){
    const shape=(p.shape==='circle')
      ? '<circle cx="'+p.x+'" cy="'+p.y+'" r="'+(p.w/2)+'"'
      : '<rect x="'+(p.x-p.w/2)+'" y="'+(p.y-p.h/2)+'" width="'+p.w+'" height="'+p.h+'" rx="'+(Math.min(p.w,p.h)*0.2)+'"';
    let el=shape+' fill="'+SVG_COLORS.pad+'"/>';
    const drill=(p.layer==='both') ? '<circle cx="'+p.x+'" cy="'+p.y+'" r="'+(design.viaDrill/2)+'" fill="'+SVG_COLORS.board+'"/>' : '';
    if(p.layer==='top') topG+=el+drill+'\n';
    else if(p.layer==='bottom') botG+=el+drill+'\n';
    else { topG+=el+drill+'\n'; botG+=el+'\n'; }
  }
  topG+='</g>\n'; botG+='</g>\n';
  s+=botG+topG+'</svg>\n';
  return s;
}

/* ---------- 45° 拐角美化（保证间距的斜切角后处理） ---------- */
function segSegDist(ax,ay,bx,by, cx,cy,dx,dy){
  const cr=(x1,y1,x2,y2)=>x1*y2-y1*x2;
  const d1=cr(dx-cx,dy-cy, ax-cx,ay-cy), d2=cr(dx-cx,dy-cy, bx-cx,by-cy);
  const d3=cr(bx-ax,by-ay, cx-ax,cy-ay), d4=cr(bx-ax,by-ay, dx-ax,dy-ay);
  if(((d1>0&&d2<0)||(d1<0&&d2>0)) && ((d3>0&&d4<0)||(d3<0&&d4>0))) return 0;
  return Math.min(
    segDist(ax,ay,cx,cy,dx,dy), segDist(bx,by,cx,cy,dx,dy),
    segDist(cx,cy,ax,ay,bx,by), segDist(dx,dy,ax,ay,bx,by));
}

/* 合并共线单元点（保留换层过孪点） */
function mergePathPts(pts){
  const out=[];
  for(const pt of pts){
    const n=out.length;
    if(n && out[n-1].l===pt.l){
      const q=out[n-1];
      if(Math.abs(q.x-pt.x)<1e-9 && Math.abs(q.y-pt.y)<1e-9) continue;
      if(n>=2 && out[n-2].l===pt.l){
        const r0=out[n-2];
        const cross=(q.x-r0.x)*(pt.y-q.y)-(q.y-r0.y)*(pt.x-q.x);
        const dot=(q.x-r0.x)*(pt.x-q.x)+(q.y-r0.y)*(pt.y-q.y);
        if(Math.abs(cross)<1e-6 && dot>0){ out[n-1]={x:pt.x,y:pt.y,l:pt.l}; continue; }
      }
    }
    out.push({x:pt.x,y:pt.y,l:pt.l});
  }
  return out;
}

/* 拐角代价（KiCad pns_optimizer.cpp:44-57 的 COST_ESTIMATOR 角度表）：
   直行 5 / 45° 10 / 90° 30 / 135° 折返 50 / 180° 掉头 60 */
function cornerTurnCost(ax,ay,bx,by,cx,cy){
  const u1=bx-ax, u2=by-ay, v1=cx-bx, v2=cy-by;
  const cross=u1*v2-u2*v1, dot=u1*v1+u2*v2;
  const ang=Math.abs(Math.atan2(cross, dot))*180/Math.PI;
  if(ang<15) return 5;
  if(ang<67.5) return 10;
  if(ang<112.5) return 30;
  if(ang<157.5) return 50;
  return 60;
}

/* 对布线结果做 45° 斜切角。逐网络处理：切角段先对其它网络
   的导体（走线随切角实时更新/焊盘/过孔/禁布区）做几何间距检查。 */
function beautifyResult(design, result){
  if(!result||!result.nets) return result;
  const g=design.grid;
  const maxCh=Math.min(2*g, 1.2);
  const clr=design.clearance, tw=design.trackW, vo=design.viaOuter/2, eps=1e-6;
  const pads=(design.pads||[]).map(p=>{
    const hh=p.shape==='circle'?p.w/2:p.h/2;
    return {box:[p.x-p.w/2, p.y-hh, p.x+p.w/2, p.y+hh], net:p.netId};
  });
  const kos=(design.keepouts||[]).map(k=>[k.x-k.w/2,k.y-k.h/2,k.x+k.w/2,k.y+k.h/2]);
  const vias=[];
  for(const n of result.nets) for(const v of n.vias) vias.push({x:v.x,y:v.y,net:n.netId});
  const collect=paths=>{
    const segs=[];
    for(const path of paths) for(let k=1;k<path.length;k++){
      const a=path[k-1], b=path[k];
      if(a.l!==b.l) continue;
      if(Math.abs(a.x-b.x)<1e-9 && Math.abs(a.y-b.y)<1e-9) continue;
      segs.push({x1:a.x,y1:a.y,x2:b.x,y2:b.y,l:a.l,
        bx:[Math.min(a.x,b.x),Math.min(a.y,b.y),Math.max(a.x,b.x),Math.max(a.y,b.y)]});
    }
    return segs;
  };
  const store=new Map();
  for(const n of result.nets) store.set(n.netId, collect(n.paths));

  // 深优 2026-11-14：谓词型检查的空间索引（chamferOK/segClearOK 只返回真/假，
  // 违规命中次序不影响结果 → 排序扫描的候选集语义与全扫逐位一致）。
  // pads/vias 按左界排序 + 提前 break；异网段按层分组按左界排序 + 提前 break。
  const padsX=[...pads].sort((a,b)=>a.box[0]-b.box[0]);
  const viasX=[...vias].sort((a,b)=>a.x-b.x);
  const segsByLayer=new Map();
  for(const [oid,segs] of store) for(const s2 of segs){
    let a2=segsByLayer.get(s2.l); if(!a2){ a2=[]; segsByLayer.set(s2.l,a2); }
    a2.push({oid, s:s2});
  }
  for(const a2 of segsByLayer.values()) a2.sort((u,v)=>u.s.bx[0]-v.s.bx[0]);
  // bbox 轴距下界（段到矩形 bbox 的距离 ≥ max 轴距）——超过阈值者必不违规，免 segRect 调用
  const boxFar=(box,ax,ay,bx,by,th)=>{
    const dx=Math.max(box[0]-Math.max(ax,bx), Math.min(ax,bx)-box[2], 0);
    const dy=Math.max(box[1]-Math.max(ay,by), Math.min(ay,by)-box[3], 0);
    return Math.max(dx,dy)>=th;
  };

  function chamferOK(netId, ax,ay,bx,by, l){
    const w=netW(design,netId);
    const m=w+clr+vo+g;
    const bx1=Math.min(ax,bx)-m, bx2=Math.max(ax,bx)+m;
    const by1=Math.min(ay,by)-m, by2=Math.max(ay,by)+m;
    // 精确线段距离（第六轮 n72 教训：固定 5 点采样对擦边接触漏检——
    // 凹陷区可以比采样间距短任意多，必须用闭式解）
    const segRect=(box)=>segmentRectDistance({x:ax,y:ay},{x:bx,y:by},
      {x:(box[0]+box[2])/2, y:(box[1]+box[3])/2, w:box[2]-box[0], h:box[3]-box[1]});
    for(const k of kos){
      if(k[2]<bx1||k[0]>bx2||k[3]<by1||k[1]>by2) continue;
      if(segRect(k)<w/2-eps) return false;
    }
    const padTh=clr+w/2-eps;
    for(const p of padsX){
      if(p.box[0]>bx2) break;
      if(p.box[2]<bx1||p.box[3]<by1||p.box[1]>by2) continue;
      if(segRect(p.box)<padTh) return false;
    }
    const viaTh=vo+clr+w/2-eps;
    for(const v of viasX){
      if(v.x>bx2) break;
      if(v.net===netId) continue;
      if(v.x<bx1||v.y<by1||v.y>by2) continue;
      if(segDist(v.x,v.y,ax,ay,bx,by)<viaTh) return false;
    }
    const segTh=w+clr-eps;
    const arr=segsByLayer.get(l);
    if(arr) for(const e of arr){
      if(e.s.bx[0]>bx2) break;
      if(e.oid===netId) continue;
      if(e.s.bx[2]<bx1||e.s.bx[3]<by1||e.s.bx[1]>by2) continue;
      if(segSegDist(ax,ay,bx,by, e.s.x1,e.s.y1,e.s.x2,e.s.y2)<segTh) return false;
    }
    return true;
  }

  // ---- 弦拉直（借鉴 KiCad pns_optimizer mergeStep/mergeColinear，网格化）----
  // 跨度内全部同层且含 ≥2 个拐角时，用直连或 2 段狗腿替换；接受准则=拐角代价
  // 严格下降（狗腿长=曼哈顿下界，线长必然不增）。检查：其它网络间距、焊盘/
  // 禁布区/过孔避让（segOK 密采样）、本网接触保持（被替换跨度上接触的本网
  // 焊盘/过孔替换后必须仍被接触，防止视觉断连）、同网自交。
  function segClearOK(netId, ax,ay,bx,by, l){
    const w=netW(design,netId);
    // 精确线段距离（第六轮 n72 教训：步进采样对擦边接触漏检，与 chamferOK 同修）
    const segRect=(box)=>segmentRectDistance({x:ax,y:ay},{x:bx,y:by},
      {x:(box[0]+box[2])/2, y:(box[1]+box[3])/2, w:box[2]-box[0], h:box[3]-box[1]});
    const mnX=Math.min(ax,bx), mxX=Math.max(ax,bx), mnY=Math.min(ay,by), mxY=Math.max(ay,by);
    for(const k of kos)
      if(segRect(k)<w/2-eps) return false;
    const padTh=clr+w/2-eps;
    for(const p of padsX){
      if(p.net===netId) continue;   // 同网焊盘允许接触（连接保持由 contactOK 负责）
      // bbox 轴距下界 ≥ 阈值者 segRect 必 ≥ 阈值（矩形在 bbox 内）→ 安全跳过
      if(boxFar(p.box,ax,ay,bx,by,padTh)) continue;
      if(segRect(p.box)<padTh) return false;
    }
    const viaTh=vo+clr+w/2-eps;
    for(const v of viasX){
      if(v.net===netId) continue;
      // 点到段 bbox 的距离 ≥ max 轴距 → 超阈值者 segDist 必 ≥ 阈值 → 安全跳过
      const dx0=Math.max(mnX-v.x, v.x-mxX, 0), dy0=Math.max(mnY-v.y, v.y-mxY, 0);
      if(Math.max(dx0,dy0)>=viaTh) continue;
      if(segDist(v.x,v.y,ax,ay,bx,by)<viaTh) return false;
    }
    const segTh=w+clr-eps;
    const arr=segsByLayer.get(l);
    if(arr) for(const e of arr){
      if(e.s.bx[0]>mxX+1) break;
      if(e.oid===netId) continue;
      if(e.s.bx[2]<mnX-1||e.s.bx[3]<mnY-1||e.s.bx[1]>mxY+1) continue;
      if(segSegDist(ax,ay,bx,by, e.s.x1,e.s.y1,e.s.x2,e.s.y2)<segTh) return false;
    }
    return true;
  }
  const contactOK=(segs,tx,ty,rad)=>{
    for(const [ax,ay,bx,by] of segs){
      const len=Math.hypot(bx-ax,by-ay);
      const nS=Math.max(1, Math.ceil(len/(g/2)));
      for(let t=0;t<=nS;t++){
        const px=ax+(bx-ax)*t/nS, py=ay+(by-ay)*t/nS;
        if(Math.hypot(px-tx,py-ty)<rad+1e-6) return true;
      }
    }
    return false;
  };
  function straightenPath(netId, ownSegs, exPathIdx, pts){
    for(let guard=0; guard<8; guard++){
      let done=true;
      outer:
      for(let step=pts.length-1; step>=2; step--){
        for(let i=0;i+step<pts.length;i++){
          const j=i+step, l0=pts[i].l;
          let sameL=true;
          for(let k=i;k<=j;k++) if(pts[k].l!==l0){ sameL=false; break; }
          if(!sameL) continue;
          const dx=Math.abs(pts[j].x-pts[i].x), dy=Math.abs(pts[j].y-pts[i].y);
          if(dx<1e-9&&dy<1e-9) continue;
          let oldC=0, oldLen=0;
          for(let k=i;k<j;k++) oldLen+=Math.hypot(pts[k+1].x-pts[k].x, pts[k+1].y-pts[k].y);
          for(let k=i+1;k<j;k++) oldC+=cornerTurnCost(pts[k-1].x,pts[k-1].y,pts[k].x,pts[k].y,pts[k+1].x,pts[k+1].y);
          // 接受准则（字典序）：线长严格不增；等长时拐角代价须从 ≥60 降到 30。
          // 原始路径可能含 45° 斜段（斜段楼梯比曼哈顿狗腿更短），故线长是第一优先。
          if(oldC<60) continue;
          const newLen=dx+dy;
          if(newLen>oldLen+1e-9) continue;
          const straight=(dx<1e-9||dy<1e-9);
          const cands=straight?[]:[{x:pts[i].x,y:pts[j].y,l:l0},{x:pts[j].x,y:pts[i].y,l:l0}];
          const ok=m=>{
            const segs=straight?[[pts[i].x,pts[i].y,pts[j].x,pts[j].y]]
                               :[[pts[i].x,pts[i].y,m.x,m.y],[m.x,m.y,pts[j].x,pts[j].y]];
            for(const [ax,ay,bx,by] of segs) if(!segClearOK(netId,ax,ay,bx,by,l0)) return false;
            const oldSegs=[];
            for(let k=i;k<j;k++) oldSegs.push([pts[k].x,pts[k].y,pts[k+1].x,pts[k+1].y]);
            for(const p of pads){
              if(p.net!==netId||p.net==null) continue;
              const wOwn=netW(design,netId)/2;
              if(!contactOK(oldSegs,(p.box[0]+p.box[2])/2,(p.box[1]+p.box[3])/2,wOwn)) continue;
              if(!contactOK(segs,(p.box[0]+p.box[2])/2,(p.box[1]+p.box[3])/2,wOwn)) return false;
            }
            for(const v of vias){
              if(v.net!==netId) continue;
              if(!contactOK(oldSegs,v.x,v.y,vo)) continue;
              if(!contactOK(segs,v.x,v.y,vo)) return false;
            }
            for(let p2=0;p2<ownSegs.length;p2++)for(let k2=0;k2<ownSegs[p2].length;k2++){
              if(p2===exPathIdx && k2>=i && k2<j) continue;   // 被替换跨度自身
              const s=ownSegs[p2][k2];
              for(const [ax,ay,bx,by] of segs){
                if(segSegDist(ax,ay,bx,by,s.x1,s.y1,s.x2,s.y2)>=0.01) continue;
                const joint=Math.hypot(s.x1-pts[i].x,s.y1-pts[i].y)<1e-9||Math.hypot(s.x1-pts[j].x,s.y1-pts[j].y)<1e-9||
                            Math.hypot(s.x2-pts[i].x,s.y2-pts[i].y)<1e-9||Math.hypot(s.x2-pts[j].x,s.y2-pts[j].y)<1e-9;
                if(!joint) return false;   // 与同网其它段的非端点接触 = 自交
              }
            }
            return true;
          };
          if(straight){
            if(ok(null)){ pts.splice(i+1,j-i-1); done=false; break outer; }
          } else for(const mid of cands){
            if(ok(mid)){ pts.splice(i+1,j-i-1,mid); done=false; break outer; }
          }
        }
      }
      if(done) break;
    }
    return pts;
  }

  for(const n of result.nets){
    const ownSegs=n.paths.map(pp=>collect([pp]));
    const paths2=[];
    let pIdx=0;
    for(const path of n.paths){
      let pts=mergePathPts(path);
      pts=straightenPath(n.netId, ownSegs, pIdx, pts);
      const out=pts.length?[pts[0]]:pts;
      let i=1;
      while(pts.length && i<pts.length-1){
        const P=out[out.length-1], V=pts[i], N=pts[i+1];
        if(P.l!==V.l||V.l!==N.l){ out.push(V); i++; continue; }
        const dVx=V.x-P.x, dVy=V.y-P.y, dNx=N.x-V.x, dNy=N.y-V.y;
        const lV=Math.hypot(dVx,dVy), lN=Math.hypot(dNx,dNy);
        if(lV<1e-9||lN<1e-9){ out.push(V); i++; continue; }
        const d=Math.min(maxCh, lV/2, lN/2);
        if(d<g*0.4){ out.push(V); i++; continue; }
        const A={x:V.x-dVx/lV*d, y:V.y-dVy/lV*d, l:V.l};
        const B={x:V.x+dNx/lN*d, y:V.y+dNy/lN*d, l:V.l};
        if(chamferOK(n.netId, A.x,A.y,B.x,B.y, V.l)){
          out.push(A,B);   // 斜切替换直角点 V
        } else out.push(V);
        i++;
      }
      if(pts.length) out.push(pts[pts.length-1]);
      paths2.push(out);
      pIdx++;
    }
    n.paths=paths2;
    store.set(n.netId, collect(paths2));   // 后续网络按最新几何检查
  }
  // 重算走线长度统计
  let lt=0, lb=0; const L=design.layers||2,trackLayers=new Array(L).fill(0);
  for(const nn of result.nets) for(const p of nn.paths) for(let k=1;k<p.length;k++){
    if(p[k].l!==p[k-1].l) continue;
    const dd=Math.hypot(p[k].x-p[k-1].x, p[k].y-p[k-1].y);
    trackLayers[p[k].l]+=dd;
    if(p[k].l===0) lt+=dd; else if(p[k].l===L-1) lb+=dd;
  }
  result.stats.trackTop=lt; result.stats.trackBot=lb;
  result.stats.trackLayers=trackLayers;result.stats.trackInner=trackLayers.slice(1,-1).reduce((a,b)=>a+b,0);
  result.stats.trackLen=trackLayers.reduce((a,b)=>a+b,0);
  return result;
}

/* ---------- 泪滴：过孔与走线衔接处的楔形加宽 ---------- */
function teardropPolys(design, result){
  if(!result||!result.nets) return [];
  const r=design.viaOuter/2, len=Math.min(1.0, r*2.2);
  const out=[];
  for(const n of result.nets){
    const hw=netW(design, n.netId)/2;
    const vmap=new Map();
    for(const v of n.vias) vmap.set(v.x.toFixed(3)+'_'+v.y.toFixed(3), v);
    if(!vmap.size) continue;
    const seen=new Set();
    for(const path of n.paths){
      for(let i=0;i<path.length;i++){
        const pt=path[i];
        const key=pt.x.toFixed(3)+'_'+pt.y.toFixed(3);
        if(!vmap.has(key)) continue;
        const dirs=[];
        if(i>0 && path[i-1].l===pt.l){
          const dx=path[i-1].x-pt.x, dy=path[i-1].y-pt.y;
          if(Math.abs(dx)+Math.abs(dy)>1e-9){
            const m=Math.hypot(dx,dy);
            dirs.push({dx:dx/m, dy:dy/m});
          }
        }
        if(i<path.length-1 && path[i+1].l===pt.l){
          const dx=path[i+1].x-pt.x, dy=path[i+1].y-pt.y;
          if(Math.abs(dx)+Math.abs(dy)>1e-9){
            const m=Math.hypot(dx,dy);
            dirs.push({dx:dx/m, dy:dy/m});
          }
        }
        for(const d0 of dirs){
          const sk=key+'|'+d0.dx.toFixed(2)+'_'+d0.dy.toFixed(2);
          if(seen.has(sk)) continue;
          seen.add(sk);
          const px=-d0.dy, py=d0.dx;
          out.push({l:pt.l, p:[
            {x:pt.x+d0.dx*len+px*hw, y:pt.y+d0.dy*len+py*hw},
            {x:pt.x+d0.dx*len-px*hw, y:pt.y+d0.dy*len-py*hw},
            {x:pt.x-px*r,            y:pt.y-py*r},
            {x:pt.x+px*r,            y:pt.y+py*r}
          ]});
        }
      }
    }
  }
  return out;
}

/* ============================================================
   等长蛇形生成（roadmap 阶段一 #2，补齐"检查已有，缺生成器"）
   口径：与 DRC 等长检查同一把尺（netRoutedLen，同层段欧氏和）；
   目标 = 组内最长网；短网沿线插入 90° 方波 bump 精确补差。
   几何契约：bump 顶点替换直线段中部，段端点不动 → 连通性/焊盘接触不变；
   水平覆盖不变（bump 顶边+段间基线 = 原跨度），垂直增量 = 2A/bump
   → 补长 2kA 可精确命中 Δ。自耦合节距：所有平行段边到边 ≥ serpGap
   （默认 3W；有叠层信息时建议 max(3W,3H)——Altium 教材口径）。
   空间检查：bump 铜包络对异网/本网其它铜/焊盘 ≥ clearance，对禁布区
   （模型 blocked 含板边带）不侵入；free(A) 单调 → 二分求最大振幅。
   ============================================================ */
function _padRectGap(p, x0, y0, x1, y1){   // 焊盘铜到矩形 [x0,y0,x1,y1] 的边距（负=重叠）
  if(p.shape==='circle') return distToRect(p.x, p.y, (x0+x1)/2, (y0+y1)/2, x1-x0, y1-y0) - p.w/2;
  const px0=p.x-p.w/2, px1=p.x+p.w/2, py0=p.y-p.h/2, py1=p.y+p.h/2;
  const dx=Math.max(x0-px1, px0-x1), dy=Math.max(y0-py1, py0-y1);
  if(dx<=0&&dy<=0) return Math.max(dx, dy);
  return (dx>0&&dy>0)?Math.hypot(dx,dy):Math.max(dx,dy);
}
// 组等长口径 = 走线长度 + padToDie（封装内走线，KiCad pad-to-die 同概念；
// 数据手册可查，AI 代理可填）——仅等长检查/蛇形生成使用，不污染统计长度
function _groupLen(design, result, netId){
  const n=(design.nets||[]).find(x=>x.id===netId);
  return netRoutedLen(design, result, netId) + (n&&n.padToDie>0?n.padToDie:0);
}
function _segPadGap(p, ax, ay, bx, by){   // 焊盘铜到线段的边距（负=相交）
  if(p.shape==='circle') return segDist(p.x, p.y, ax, ay, bx, by) - p.w/2;
  const x0=p.x-p.w/2, y0=p.y-p.h/2, x1=p.x+p.w/2, y1=p.y+p.h/2;
  if((ax>=x0&&ax<=x1&&ay>=y0&&ay<=y1)||(bx>=x0&&bx<=x1&&by>=y0&&by<=y1)) return -1;
  let d=segSegDist(ax,ay,bx,by,x0,y0,x1,y0);
  d=Math.min(d,segSegDist(ax,ay,bx,by,x1,y0,x1,y1));
  d=Math.min(d,segSegDist(ax,ay,bx,by,x1,y1,x0,y1));
  d=Math.min(d,segSegDist(ax,ay,bx,by,x0,y1,x0,y0));
  return d;
}
// 两个可能旋转的矩形（{x,y,w,h,rot}）的真最小距离：各取 4 边，min segSegDist；
// 相交/包含 → 0。用于 spec 旋转焊盘间距（AABB 会把 45° 合规几何误报为 0）。
function _rotRectGap(a, b){
  const corners=r=>{
    const rad=(r.rot||0)*Math.PI/180, c=Math.cos(rad), si=Math.sin(rad);
    const hw=r.w/2, hh=r.h/2;
    return [[r.x-hw*c-r.hh*si*0, r.y-hw*si+0] , [0,0]].slice(0,0).concat(
      [[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]].map(([lx,ly])=>[
        r.x+lx*c-ly*si, r.y+lx*si+ly*c]));
  };
  const ca=corners(a), cb=corners(b);
  let m=Infinity;
  for(let i=0;i<4;i++){
    const a1=ca[i], a2=ca[(i+1)%4];
    for(let j=0;j<4;j++){
      const b1=cb[j], b2=cb[(j+1)%4];
      m=Math.min(m, segSegDist(a1[0],a1[1],a2[0],a2[1], b1[0],b1[1], b2[0],b2[1]));
    }
  }
  // 点在对方内部（重叠）→ 0
  const inside=(p, r)=>{
    const rad=-((r.rot||0)*Math.PI/180), c=Math.cos(rad), si=Math.sin(rad);
    const dx=p[0]-r.x, dy=p[1]-r.y;
    const lx=dx*c-dy*si, ly=dx*si+dy*c;
    return Math.abs(lx)<=r.w/2+1e-9 && Math.abs(ly)<=r.h/2+1e-9;
  };
  if(inside(ca[0], b) || inside(cb[0], a)) return 0;
  return m;
}
function serpentineTune(design, result, opts){
  opts=opts||{};
  const report={ tuned:[], skipped:[], groups:[] };
  if(!result||!Array.isArray(result.nets)) return report;
  const clr=design.clearance;
  // ---- 收集组：pair（差分对）与 lenGroup（等长组，可选字段）----
  const collect=(field, kind)=>{
    const map=new Map();
    for(const n of (design.nets||[])) if(n[field]){
      if(!map.has(n[field])) map.set(n[field], []);
      map.get(n[field]).push(n);
    }
    return [...map].filter(([,ms])=>ms.length>=2).map(([name,ms])=>({name, kind, members:ms}));
  };
  let groups=[...collect('pair','pair'), ...collect('lenGroup','lenGroup')];
  if(opts.pair) groups=groups.filter(g=>g.kind==='pair'&&g.name===opts.pair);
  if(opts.group) groups=groups.filter(g=>g.kind==='lenGroup'&&g.name===opts.group);
  const model=buildModel(design);   // design 全程不变 → 每次调用建一次（原每轮重建，profile 17.8%）
  const drcErrBefore=checkDRC(design, result, {}).filter(i=>i.sev==='error').length;   // 脏板基线（audit 口径 before/after）
  for(const g of groups){
    const lens=g.members.map(m=>({ net:m, len:_groupLen(design, result, m.id) }));
    if(lens.some(x=>x.len<=0)) continue;   // 未布线的组不评（与 DRC 同口径）
    // 目标：--target 显式指定（Altium 固定 Length 规则），否则组内最长（Allegro match group 口径）
    const target=opts.target>0?opts.target:Math.max(...lens.map(x=>x.len));
    report.groups.push({ name:g.name, kind:g.kind, target:+target.toFixed(3),
      members:lens.map(x=>({ netId:x.net.id, name:x.net.name, len:+x.len.toFixed(3) })) });
    const tol=opts.tol!=null?opts.tol:0.05;
    const shortNets=lens.filter(x=>x.len<target-tol).sort((a,b)=>a.len-b.len);
    for(const sn of shortNets){
      const entry={ netId:sn.net.id, name:sn.net.name, from:+sn.len.toFixed(3), target:+target.toFixed(3),
        insertions:[], added:0 };
      const W=netW(design, sn.net.id);
      const serpGap=opts.serpGap!=null&&opts.serpGap>0?opts.serpGap:Math.max(3*W, clr);
      const wMin=W+serpGap;                 // 平行段最小中心距（边到边 serpGap）
      const minAmp=W;                       // 振幅下限：矮于线宽的 bump 几何退化
      const marg=W/2+clr;                   // bump 区离段端的最小退让
      let deficit=target-sn.len, skipLowDeficit=false;
      for(let iter=0; iter<(opts.maxIter||12) && deficit>tol; iter++){
        // ---- 候选段（每轮重扫：插入后路径已变）----
        const cands=[];
        const allNets=[...((result&&result.nets)||[]), ...manualRouteEntries(design)];
        for(const n of allNets){
          if(n.netId!==sn.net.id) continue;
          (n.paths||[]).forEach((path, pi)=>{
            const mp=mergePathPts(path);   // 磁盘结果常是未合并的逐步点（beautify 粒度）——
            for(let k=1;k<mp.length;k++){  // 合并后才有可用载体；插入时整条写回合并版
              const a=mp[k-1], b=mp[k];
              if(a.l!==b.l) continue;
              const horiz=Math.abs(a.y-b.y)<1e-9, vert=Math.abs(a.x-b.x)<1e-9;
              const diag=!horiz&&!vert&&Math.abs(Math.abs(b.x-a.x)-Math.abs(b.y-a.y))<1e-6;   // 纯 45°（美化后常态）
              if(!horiz&&!vert&&!diag) continue;
              const segLen=Math.hypot(b.x-a.x, b.y-a.y);
              if(diag){
                // 45° 载体：步长 √2·g，端部退让与自耦合都按步数计
                const g=design.grid, nsteps=Math.round(Math.abs(b.x-a.x)/g);
                const stepLen=diag?Math.SQRT2*g:g;
                const endSteps=Math.ceil(marg/stepLen-1e-9), minRunSteps=Math.ceil(wMin/stepLen-1e-9);
                const spanS=nsteps-2*endSteps;
                if(spanS<minRunSteps) continue;
                cands.push({ n, pi, si:k, a, b, l:a.l, horiz:false, diag:true, sx:Math.sign(b.x-a.x), sy:Math.sign(b.y-a.y),
                  nsteps, endSteps, spanS, stepLen, base:0, u0:0, u1:0, span:spanS*stepLen,
                  k_max:Math.floor((spanS/minRunSteps+1)/2), segLen, mp });
                continue;
              }
              if(segLen<2*marg+wMin) continue;
              const u0=(horiz?Math.min(a.x,b.x):Math.min(a.y,b.y))+marg;
              const u1=(horiz?Math.max(a.x,b.x):Math.max(a.y,b.y))-marg;
              const span=u1-u0;
              if(span<wMin) continue;
              const k_max=Math.floor((span/wMin+1)/2);
              if(k_max<1) continue;
              cands.push({ n, pi, si:k, a, b, l:a.l, horiz, base:horiz?a.y:a.x, u0, u1, span, k_max, segLen, mp });
            }
          });
        }
        cands.sort((x,y)=>y.segLen-x.segLen);
        // ---- 障碍清单（本轮快照）----
        const segs=[], viaList=[], pads=(design.pads||[]).slice();
        for(const n of allNets) (n.paths||[]).forEach((path, pi)=>{
          const mp=mergePathPts(path);
          for(let k=1;k<mp.length;k++){
            const a=mp[k-1], b=mp[k];
            if(a.l!==b.l) continue;
            segs.push({x1:a.x,y1:a.y,x2:b.x,y2:b.y,l:a.l,nid:n.netId,pi,si:k,
              bx0:Math.min(a.x,b.x), by0:Math.min(a.y,b.y), bx1:Math.max(a.x,b.x), by1:Math.max(a.y,b.y)});
          }
        });
        for(const n of allNets) for(const v of (n.vias||[])) viaList.push({x:v.x,y:v.y,nid:n.netId});
        for(const s of (design.stitching||[])) viaList.push({x:s.x,y:s.y,nid:s.netId});
        // ---- bump 空间检查（侧向 s：水平段 s=−1 上/+1 下；垂直段 −1 左/+1 右）----
        // 两区域口径：B=新增铜（bump 包络减基线条带）从严——pair 伙伴 serpGap（3W，保对内
        // 几何纪律）、其余 clr；L=既有基线条带（路由已合法）维持 clr 现状。禁布区按全域包络。
        const myPair=(design.nets.find(x=>x.id===sn.net.id)||{}).pair||null;
        // 深优 2026-11-14：pair 查表 Map 化——原 pairOf 每次线性扫 design.nets，
        // 被 corridorFree/diagFit 每障碍每二分轮调用
        const _pairMap=new Map(design.nets.map(x=>[x.id,x.pair||null]));
        const pairOf=id=>id==null?null:(_pairMap.get(id)||null);
        const reqClr=nid=>(myPair&&nid!=null&&nid!==sn.net.id&&pairOf(nid)===myPair)?serpGap:clr;
        const corridorFree=(cd, A, s, local)=>{
          const W2=W/2;
          // B：新增铜区
          const bx0=cd.horiz?cd.u0-W2:cd.base-(s<0?A+W2:W2);
          const bx1=cd.horiz?cd.u1+W2:cd.base+(s<0?W2:A+W2);
          const by0=cd.horiz?cd.base-(s<0?A+W2:W2):cd.u0-W2;
          const by1=cd.horiz?cd.base+(s<0?W2:A+W2):cd.u1+W2;
          // L：既有基线条带（含端部半宽）
          const lx0=cd.horiz?cd.u0-W2:cd.base-W2, lx1=cd.horiz?cd.u1+W2:cd.base+W2;
          const ly0=cd.horiz?cd.base-W2:cd.u0-W2, ly1=cd.horiz?cd.base+W2:cd.u1+W2;
          const ecx=(bx0+bx1)/2, ecy=(by0+by1)/2, ew=bx1-bx0, eh=by1-by0;
          const lcx=(lx0+lx1)/2, lcy=(ly0+ly1)/2, lw=lx1-lx0, lh=ly1-ly0;
          for(const sg of local.segs){
            if(sg.l!==cd.l) continue;
            if(sg.nid===cd.n.netId&&sg.pi===cd.pi&&sg.si===cd.si) continue;   // 被替换段自身（就在 L 内）
            const fw=netW(design, sg.nid)/2;   // 异网走线自身半宽（中心线口径）
            const dB=segmentRectDistance({x:sg.x1,y:sg.y1},{x:sg.x2,y:sg.y2},{x:ecx,y:ecy,w:ew,h:eh});
            if(dB<fw+reqClr(sg.nid)-1e-9) return false;
            const dL=segmentRectDistance({x:sg.x1,y:sg.y1},{x:sg.x2,y:sg.y2},{x:lcx,y:lcy,w:lw,h:lh});
            if(dL<fw+clr-1e-9) return false;
          }
          for(const v of local.vias){
            if(distToRect(v.x,v.y,ecx,ecy,ew,eh)<design.viaOuter/2+reqClr(v.nid)-1e-9) return false;
            if(distToRect(v.x,v.y,lcx,lcy,lw,lh)<design.viaOuter/2+clr-1e-9) return false;
          }
          for(const p of local.pads){
            if(!padOnLayer(p, cd.l, design.layers||2)) continue;
            if(p.netId!=null&&p.netId===cd.n.netId) continue;   // 本网焊盘=连接形态，不算障碍
            const rq=reqClr(p.netId);
            if(_padRectGap(p, bx0,by0,bx1,by1)<rq-1e-9) return false;
            if(_padRectGap(p, lx0,ly0,lx1,ly1)<clr-1e-9) return false;
          }
          const g=design.grid;
          const iLo=Math.max(0, Math.floor((bx0-clr)/g-0.5)), iHi=Math.min(model.GW-1, Math.floor((bx1+clr)/g-0.5));
          const jLo=Math.max(0, Math.floor((by0-clr)/g-0.5)), jHi=Math.min(model.GH-1, Math.floor((by1+clr)/g-0.5));
          for(let j=jLo;j<=jHi;j++)for(let i=iLo;i<=iHi;i++) if(model.blocked[cd.l*model.NC+j*model.GW+i]) return false;
          if(model.scopedBlocked.length && cd.n){
            const _cls=model.netCls.get(cd.n.netId)||null;
            for(let j=jLo;j<=jHi;j++)for(let i=iLo;i<=iHi;i++)
              if(_scopedHit(model,_cls,j*model.GW+i)) return false;   // class keepout 同口径
          }
          return true;
        };
        // ---- 每候选每侧二分求最大振幅 → 选容量最大的插入 ----
        let best=null;
        // 候选取舍：exact（extra≥deficit）按过冲最小（过冲=超出目标的补偿长度）；
        // partial 按 extra 最大（吸得越多越好）；exact 胜 partial
        const consider=cand=>{
          if(!cand) return;
          const ov=cand.extra>=deficit-1e-9?cand.extra-deficit:-1;
          const bov=best?(best.extra>=deficit-1e-9?best.extra-deficit:-1):-2;
          let take;
          if(!best) take=true;
          else if(ov>=0&&bov>=0) take=ov<bov-1e-9-1e-9||(Math.abs(ov-bov)<=1e-9&&cand.Amax>best.Amax+1e-9);
          else if(ov>=0) take=true;
          else if(bov>=0) take=false;
          else take=cand.extra>best.extra+1e-9||(Math.abs(cand.extra-best.extra)<1e-9&&cand.Amax>best.Amax+1e-9);
          if(take) best=cand;
        };
        for(const cd of cands){
          for(const s of [-1, 1]){
            // ---- 45° 载体：振幅=整数步 m（jog 位移 (−sy·s·m·g, sx·s·m·g) 轴对齐保格点），
            //      A=m·√2·g；段级精确碰撞检查（beautify 后全板几乎无轴对齐直段——
            //      无此分支真实板 tune 完全失效）。过冲 ≤2 步粒度否则部分吸收。----
            if(cd.diag){
              const g=design.grid, stepAmp=Math.SQRT2*g;
              const minRunSteps=Math.ceil(wMin/stepAmp-1e-9);   // 自耦合：平行斜段边距 ≥ serpGap
              if(cd.k_max<1) continue;
              // 板边可达步数：jog 位移分量逐轴解线性界
              const maxX=Math.max(cd.a.x,cd.b.x), minX=Math.min(cd.a.x,cd.b.x);
              const maxY=Math.max(cd.a.y,cd.b.y), minY=Math.min(cd.a.y,cd.b.y);
              const jxSign=-cd.sy*s, jySign=cd.sx*s;
              let mCap=Math.floor((opts.maxAmp>0?opts.maxAmp:20)/stepAmp);
              if(jxSign>0) mCap=Math.min(mCap, Math.floor((design.width-0.2-maxX)/g));
              if(jxSign<0) mCap=Math.min(mCap, Math.floor((minX-0.2)/g));
              if(jySign>0) mCap=Math.min(mCap, Math.floor((design.height-0.2-maxY)/g));
              if(jySign<0) mCap=Math.min(mCap, Math.floor((minY-0.2)/g));
              if(mCap<Math.ceil((W+serpGap)/stepAmp-1e-9)) continue;
              // 局部障碍（载体 bbox 外扩最大可达）
              const reach=mCap*stepAmp+W/2+clr;
              const bx0=Math.min(cd.a.x,cd.b.x)-reach, bx1=Math.max(cd.a.x,cd.b.x)+reach;
              const by0=Math.min(cd.a.y,cd.b.y)-reach, by1=Math.max(cd.a.y,cd.b.y)+reach;
              const local={
                segs:segs.filter(sg=>sg.bx1>=bx0&&sg.bx0<=bx1&&sg.by1>=by0&&sg.by0<=by1),
                vias:viaList.filter(v=>v.x>=bx0&&v.x<=bx1&&v.y>=by0&&v.y<=by1),
                pads:pads.filter(p=>p.x+p.w/2>=bx0&&p.x-p.w/2<=bx1&&p.y+p.h/2>=by0&&p.y-p.h/2<=by1)
              };
              const diagFit=(m, k)=>{
                const jx=-cd.sy*s*m*g, jy=cd.sx*s*m*g;
                const pts=[];
                for(let t=0;t<k;t++){
                  const su=cd.endSteps+t*(minRunSteps*2), eu=su+minRunSteps;
                  const P0x=cd.a.x+cd.sx*su*g, P0y=cd.a.y+cd.sy*su*g;
                  const P1x=cd.a.x+cd.sx*eu*g, P1y=cd.a.y+cd.sy*eu*g;
                  pts.push([P0x,P0y],[P0x+jx,P0y+jy],[P1x+jx,P1y+jy],[P1x,P1y]);
                }
                for(let i=0;i<pts.length;i++){
                  const A2=pts[i], B2=pts[(i+1)%pts.length];
                  for(const sg of local.segs){
                    if(sg.l!==cd.l) continue;
                    if(sg.nid===cd.n.netId&&sg.pi===cd.pi&&sg.si===cd.si) continue;
                    // 中心线口径：线到线中心距 ≥ W + reqClr（含走线半宽）
                    if(segSegDist(A2[0],A2[1],B2[0],B2[1], sg.x1,sg.y1, sg.x2,sg.y2)<(W+netW(design, sg.nid))/2+reqClr(sg.nid)-1e-9) return false;
                  }
                  for(const v of local.vias)
                    if(segDist(v.x,v.y,A2[0],A2[1],B2[0],B2[1])-design.viaOuter/2-W/2<reqClr(v.nid)-1e-9) return false;
                  for(const p of local.pads){
                    if(!padOnLayer(p, cd.l, design.layers||2)) continue;
                    if(p.netId!=null&&p.netId===cd.n.netId) continue;
                    if(_segPadGap(p, A2[0],A2[1],B2[0],B2[1])<W/2+reqClr(p.netId)-1e-9) return false;
                  }
                  const qs=Math.max(1, Math.ceil(Math.hypot(B2[0]-A2[0],B2[1]-A2[1])/(g/2)));
                  for(let q=0;q<=qs;q++){
                    const qx=A2[0]+(B2[0]-A2[0])*q/qs, qy=A2[1]+(B2[1]-A2[1])*q/qs;
                    const gi=Math.floor(qx/g-0.5), gj=Math.floor(qy/g-0.5);
                    if(gi<0||gj<0||gi>=model.GW||gj>=model.GH) return false;
                    if(model.blocked[cd.l*model.NC+gj*model.GW+gi]) return false;
                    if(model.scopedBlocked.length && _scopedHit(model, model.netCls.get(cd.n.netId)||null, gj*model.GW+gi)) return false;
                  }
                }
                return true;
              };
              // m 从大到小（少弯优先）。量化振幅的接受口径：
              // 粒度 C=2m·stepAmp ≤ 2×缺口（否则 round 会产生 ≥ 缺口级的过冲）；
              // k=round(Δ/C) → |extra−Δ| ≤ C/2 自动成立；过冲另设硬顶
              // max(4 步粒度, 10%Δ+2 步)。无合格 exact 时取最大部分吸收兜底。
              const mMinSteps=Math.ceil((W+serpGap)/stepAmp-1e-9);
              const ovCap=Math.max(stepAmp*4, deficit*0.1+stepAmp*2);
              let exact=null, partial=null;
              for(let m=mCap; m>=mMinSteps; m--){
                const C=2*m*stepAmp;
                if(C>2*deficit+1e-9) continue;          // 粒度过粗：过冲会吞掉缺口本体
                const k=Math.max(1, Math.min(cd.k_max, Math.round(deficit/C)));
                if(!diagFit(m, k)) continue;
                const extra=2*k*m*stepAmp;
                if(extra>=deficit-1e-9){
                  // 过冲超硬顶的 exact 直接弃选（宁可不调也不 +15mm）——否则它会在
                  // 选择时压过合格的 partial（实测 3V3 被塞了 +14.7mm）
                  if(extra-deficit<=ovCap+1e-9){ exact={m, k, extra}; break; }
                }else if(!partial||extra>partial.extra) partial={m, k, extra};
              }
              const pickD=exact||(partial&&partial.extra>=2*minAmp-1e-9?partial:null);
              if(pickD){
                consider({cd, s, k:pickD.k, A:pickD.m*stepAmp, extra:pickD.extra,
                  Amax:pickD.m*stepAmp, diagM:pickD.m});
              }
              continue;
            }
            const maxA=Math.min(opts.maxAmp>0?opts.maxAmp:20, cd.horiz
              ?(s<0?cd.base:design.height-cd.base)
              :(s<0?cd.base:design.width-cd.base));
            if(maxA<minAmp) continue;
            // bbox 预筛选：二分 18 轮只扫局部障碍（大板数百段 → 10× 量级）
            const mx0=cd.horiz?cd.u0-W/2:cd.base-(s<0?maxA+W/2:W/2);
            const mx1=cd.horiz?cd.u1+W/2:cd.base+(s<0?W/2:maxA+W/2);
            const my0=cd.horiz?cd.base-(s<0?maxA+W/2:W/2):cd.u0-W/2;
            const my1=cd.horiz?cd.base+(s<0?W/2:maxA+W/2):cd.u1+W/2;
            const px0=mx0-serpGap-clr, px1=mx1+serpGap+clr, py0=my0-serpGap-clr, py1=my1+serpGap+clr;
            const local={
              segs:segs.filter(sg=>sg.bx1>=px0&&sg.bx0<=px1&&sg.by1>=py0&&sg.by0<=py1),
              vias:viaList.filter(v=>v.x>=px0&&v.x<=px1&&v.y>=py0&&v.y<=py1),
              pads:pads.filter(p=>p.x+p.w/2>=px0&&p.x-p.w/2<=px1&&p.y+p.h/2>=py0&&p.y-p.h/2<=py1)
            };
            // 快速通道：整段走廊直接精确命中 → 跳过列扫描（开阔场景零列扫描开销）
            {
              let lo=0, hi=maxA;
              for(let it=0;it<18;it++){ const mid=(lo+hi)/2; if(corridorFree(cd, mid, s, local)) lo=mid; else hi=mid; }
              const AmaxF=lo;
              if(AmaxF>=minAmp&&2*cd.k_max*AmaxF>=2*minAmp){
                let k=Math.max(1, Math.min(cd.k_max, Math.ceil(deficit/(2*AmaxF))));
                let A=deficit/(2*k);
                if(A>AmaxF) A=AmaxF;
                while(A<minAmp&&k>1){ k--; A=deficit/(2*k); }
                if(A>AmaxF) A=AmaxF;
                if(A>=minAmp&&2*k*A>=deficit-1e-9){
                  consider({cd, s, k, A, extra:2*k*A, Amax:AmaxF});
                  continue;   // 本侧精确命中完成
                }
              }
            }
            // 列扫描找自由子区间（Allegro void avoidance 思想）：整段走廊里一个局部
            // 障碍（partner 焊盘/过孔）不该废掉全部容量——按 minAmp 振幅逐列探测，
            // 取最长自由子区间（≤2 个）分别二分振幅
            const st=design.grid/2;
            const runs=[];
            let rs=null;
            for(let x=cd.u0; x<=cd.u1+1e-9; x+=st){
              const xc=Math.min(x, cd.u1);
              if(corridorFree({...cd, u0:xc, u1:xc}, minAmp, s, local)){
                if(!rs) rs={a:xc, b:xc}; else rs.b=xc;
              }else if(rs){ runs.push(rs); rs=null; }
            }
            if(rs) runs.push(rs);
            runs.sort((r1,r2)=>(r2.b-r2.a)-(r1.b-r1.a));
            for(const run of runs.slice(0, 2)){
              const span=run.b-run.a;
              if(span<wMin) continue;
              const k_max=Math.floor((span/wMin+1)/2);
              if(k_max<1) continue;
              const cd2={...cd, u0:run.a, u1:run.b, span, k_max};
              let lo=minAmp, hi=maxA;          // run 在 minAmp 已知自由 → 从那里向上二分
              for(let it=0;it<18;it++){
                const mid=(lo+hi)/2;
                if(corridorFree(cd2, mid, s, local)) lo=mid; else hi=mid;
              }
              const Amax=lo;
              if(Amax<minAmp) continue;
              if(2*k_max*Amax<2*minAmp) continue;
              let k=Math.max(1, Math.min(k_max, Math.ceil(deficit/(2*Amax))));
              let A=deficit/(2*k);
              if(A>Amax) A=Amax;               // 部分吸收，剩余交下一轮/下一候选
              while(A<minAmp&&k>1){ k--; A=deficit/(2*k); }
              if(A>Amax) A=Amax;
              if(A<minAmp) continue;           // Δ<2W：本就在预算内，不补
              const extra=2*k*A;
              consider({cd:cd2, s, k, A, extra, Amax});
            }
          }
        }
        if(!best||best.extra<2*minAmp-1e-9){
          skipLowDeficit=deficit<2*minAmp-1e-9;   // 缺口小于最小合法 bump：预算内，非空间问题
          break;
        }
        // ---- 插入 bump 顶点（路径中段替换，端点不动）----
        const bc=best.cd, s=best.s, k=best.k, A=best.A;
        if(best.diagM!=null){
          // 45° 载体插入：jog 位移轴对齐、顶点全在格点（与 diagFit 同一布局数学）
          const g=design.grid, m=best.diagM;
          const minRunSteps=Math.ceil(wMin/(Math.SQRT2*g)-1e-9);
          const jx=-bc.sy*s*m*g, jy=bc.sx*s*m*g;
          const pts=[];
          for(let t=0;t<k;t++){
            const su=bc.endSteps+t*(minRunSteps*2), eu=su+minRunSteps;
            const P0x=bc.a.x+bc.sx*su*g, P0y=bc.a.y+bc.sy*su*g;
            const P1x=bc.a.x+bc.sx*eu*g, P1y=bc.a.y+bc.sy*eu*g;
            pts.push({x:P0x, y:P0y, l:bc.l}, {x:P0x+jx, y:P0y+jy, l:bc.l},
                     {x:P1x+jx, y:P1y+jy, l:bc.l}, {x:P1x, y:P1y, l:bc.l});
          }
          bc.n.paths[bc.pi]=[...bc.mp.slice(0, bc.si), ...pts, ...bc.mp.slice(bc.si)];
          entry.insertions.push({ seg:[{x:+bc.a.x.toFixed(3),y:+bc.a.y.toFixed(3)},{x:+bc.b.x.toFixed(3),y:+bc.b.y.toFixed(3)}],
            layer:bc.l, side:s, bumps:k, amplitude:+A.toFixed(3), added:+best.extra.toFixed(3), carrier:'diag' });
          entry.added=+(entry.added+best.extra).toFixed(3);
          deficit=target-_groupLen(design, result, sn.net.id);
          continue;
        }
        const w=(bc.span-(k-1)*wMin)/k;
        const pts=[];
        for(let t=0;t<k;t++){
          const L=bc.u0+t*(w+wMin), R=L+w;
          if(bc.horiz){
            pts.push({x:L, y:bc.base, l:bc.l}, {x:L, y:bc.base+s*A, l:bc.l},
                     {x:R, y:bc.base+s*A, l:bc.l}, {x:R, y:bc.base, l:bc.l});
          }else{
            pts.push({x:bc.base, y:L, l:bc.l}, {x:bc.base+s*A, y:L, l:bc.l},
                     {x:bc.base+s*A, y:R, l:bc.l}, {x:bc.base, y:R, l:bc.l});
          }
        }
        // 顶点按"u 递增"生成——段遍历方向相反（b<a）时整串反转，否则产生回头折线
        const fwd=bc.horiz?(bc.b.x>=bc.a.x):(bc.b.y>=bc.a.y);
        if(!fwd) pts.reverse();
        // slice(0,si) 以 a 结尾、slice(si) 以 b 开头——段两端点都必须保留（丢 b 会断连）
        bc.n.paths[bc.pi]=[...bc.mp.slice(0, bc.si), ...pts, ...bc.mp.slice(bc.si)];
        entry.insertions.push({ seg:[{x:+bc.a.x.toFixed(3),y:+bc.a.y.toFixed(3)},{x:+bc.b.x.toFixed(3),y:+bc.b.y.toFixed(3)}],
          layer:bc.l, side:s, bumps:k, amplitude:+A.toFixed(3), added:+best.extra.toFixed(3) });
        entry.added=+(entry.added+best.extra).toFixed(3);
        deficit=target-_groupLen(design, result, sn.net.id);
      }
      if(entry.insertions.length){
        const now=_groupLen(design, result, sn.net.id);
        entry.to=+now.toFixed(3);
        entry.residual=+(target-now).toFixed(3);
        report.tuned.push(entry);
      } else {
        report.skipped.push({ netId:sn.net.id, name:sn.net.name, deficit:+deficit.toFixed(3),
          reason:skipLowDeficit
            ?'缺口 '+deficit.toFixed(3)+'mm 小于最小合法 bump（2W='+(2*minAmp).toFixed(2)+'mm），在等长预算内不补偿'
            :'无可用的直段空间（需 ≥'+(2*marg+wMin).toFixed(2)+'mm 直段且侧向净空 ≥'+minAmp.toFixed(2)+'mm）' });
      }
    }
  }
  // ---- 自审计（证据分级 philosophy：报告自带验收数据）----
  // eqClean：调后等长 DRC 是否清零；minParallelGap：调谐网全部平行段的最小边到边距离
  if(report.tuned.length){
    const drcAll=checkDRC(design, result, {});
    const eqDrc=drcAll.filter(i=>i.type==='差分等长');
    report.audit={ eqDrcClean:eqDrc.length===0, eqDrcMsg:eqDrc.length?eqDrc[0].msg:null,
      drcErrorsBefore:drcErrBefore,
      drcErrorsAfter:drcAll.filter(i=>i.sev==='error').length,
      staleOk:staleResultCheck(design, result).ok };
    let minGap=Infinity;
    for(const t of report.tuned){
      const lines=[];
      // 插入区 bbox（外扩 2mm）——既有扇出线的同网间距不属于蛇形合规口径
      const zones=t.insertions.map(ins=>({x0:Math.min(ins.seg[0].x,ins.seg[1].x)-2, x1:Math.max(ins.seg[0].x,ins.seg[1].x)+2,
        y0:Math.min(ins.seg[0].y,ins.seg[1].y)-2, y1:Math.max(ins.seg[0].y,ins.seg[1].y)+2}));
      const inZone=(x,y)=>zones.some(z=>x>=z.x0&&x<=z.x1&&y>=z.y0&&y<=z.y1);
      for(const n of [...((result&&result.nets)||[]), ...manualRouteEntries(design)])
        if(n.netId===t.netId) for(const path of (n.paths||[])) for(let k=1;k<path.length;k++){
          const a=path[k-1], b=path[k];
          if(a.l!==b.l) continue;
          if(!inZone(a.x,a.y)&&!inZone(b.x,b.y)) continue;
          lines.push({horiz:Math.abs(a.y-b.y)<1e-9, u0:Math.min(a.x,b.x), u1:Math.max(a.x,b.x), c:Math.abs(a.y-b.y)<1e-9?a.y:a.x, l:a.l});
        }
      const W=netW(design, t.netId);
      const serpGap=(opts.serpGap!=null&&opts.serpGap>0)?opts.serpGap:Math.max(3*W, design.clearance);
      const gapOf=(x,y)=>{ if(x.l!==y.l) return Infinity;
        if(x.horiz!==y.horiz) return Infinity;
        if(Math.abs(x.c-y.c)<1e-9) return Infinity;   // 同线共线段=相连铜，非耦合平行线
        if(x.horiz){ const ov=Math.min(x.u1,y.u1)-Math.max(x.u0,y.u0); return ov>1e-9?Math.abs(x.c-y.c)-W:Infinity; }
        const ov=Math.min(x.u1,y.u1)-Math.max(x.u0,y.u0); return ov>1e-9?Math.abs(x.c-y.c)-W:Infinity; };
      for(let i=0;i<lines.length;i++)for(let j=i+2;j<lines.length;j++){
        const gp=gapOf(lines[i], lines[j]);
        if(gp<minGap) minGap=gp;
      }
      t.serpGap=serpGap;
    }
    report.audit.minParallelGap=Number.isFinite(minGap)?+minGap.toFixed(4):null;
    report.audit.finalLens=report.groups.map(g=>({ name:g.name, kind:g.kind,
      members:g.members.map(m=>({ netId:m.netId, name:m.name, len:+_groupLen(design, result, m.netId).toFixed(3) })) }));
  }
  // 铺铜时效性：tune 改了走线路径 → 既有铜皮多边形不再避让新 bump 铜
  // （Gerber 里铺铜压线=制造缺陷）。检测并报警，CLI 侧提示重跑 pour。
  if(report.tuned.length&&(result.pour||(result.pours&&result.pours.length)))
    report.audit.stalePour=true;
  return report;
}

/* ============================================================
   多边形覆铜（roadmap 阶段一 #1，替代栅格条带近似）
   流水线：细栅格精确距离场（导体 ⊕ clearance 的 Minkowski 偏移）
   → 洪泛定拓扑（连通性/孤岛/热焊盘筋条）→ 活动边轮廓跟踪出环
   → Douglas-Peucker 简化 → 外环/孔分组输出真实多边形。

   精度契约：挖空阈值 T=clearance+0.707·cell（细格对角可达半径），
   保证铜皮任意点到异网导体距离 ≥ clearance（绝不侵入，方向保守）；
   典型富余 ≤1.2·cell，cell=clamp(min(clearance,grid)/5, 0.015, 0.1)mm。
   热焊盘：本网焊盘环形挖空（thermalGap）+ 4 条实宽筋条（spokeW，
   不再受布线栅格量化），筋条被异网导体截断方向自动放弃。
   输出 pour.polys=[{outer:[x,y,...], holes:[[...]]}]，环坐标 µm 取整；
   贯通渲染/DRC/Gerber（LPD 外环 + LPC 孔）/EasyEDA（COPPERAREA）。
   ============================================================ */
const POUR_CELL_CAP=12_000_000;   // 细格总量上限，超出自动放粗 cell（内存 ~5×NF 字节）
function _pourIvFill(mask, WF, cell, a, b, j){   // 行 j 上把中心落在 [a,b]mm 的细格置 1
  let i0=Math.ceil(a/cell-0.5), i1=Math.floor(b/cell-0.5);
  if(i0<0) i0=0;
  if(i1>WF-1) i1=WF-1;
  const base=j*WF;
  for(let i=i0;i<=i1;i++) mask[base+i]=1;
}
function _pourFillDisc(mask, WF, HF, cell, cx, cy, R){
  const j0=Math.max(0, Math.ceil((cy-R)/cell-0.5)), j1=Math.min(HF-1, Math.floor((cy+R)/cell-0.5));
  for(let j=j0;j<=j1;j++){
    const dy=(j+0.5)*cell-cy, s2=R*R-dy*dy;
    if(s2<=0) continue;
    const s=Math.sqrt(s2);
    _pourIvFill(mask, WF, cell, cx-s, cx+s, j);
  }
}
// 矩形 ⊕ 圆盘（圆角偏移）；R=0 即矩形本体
function _pourFillRect(mask, WF, HF, cell, cx, cy, w, h, R){
  const hw=w/2, hh=h/2;
  const j0=Math.max(0, Math.ceil((cy-hh-R)/cell-0.5)), j1=Math.min(HF-1, Math.floor((cy+hh+R)/cell-0.5));
  for(let j=j0;j<=j1;j++){
    const dy=Math.max(0, Math.abs((j+0.5)*cell-cy)-hh), s2=R*R-dy*dy;
    if(s2<0) continue;
    const s=Math.sqrt(Math.max(0,s2));
    _pourIvFill(mask, WF, cell, cx-hw-s, cx+hw+s, j);
  }
}
// 线段 ⊕ 圆盘（胶囊）：行扫描取两端帽圆与两条侧边交点的 min/max（凸区域行区间恰为两端点）
function _pourFillStadium(mask, WF, HF, cell, ax, ay, bx, by, R){
  const dx=bx-ax, dy=by-ay, L=Math.hypot(dx,dy);
  if(L<1e-12){ _pourFillDisc(mask, WF, HF, cell, ax, ay, R); return; }
  const nx=-dy/L*R, ny=dx/L*R;
  const s1x=ax+nx, s1y=ay+ny, s2x=bx+nx, s2y=by+ny, s3x=ax-nx, s3y=ay-ny, s4x=bx-nx, s4y=by-ny;
  const j0=Math.max(0, Math.ceil((Math.min(ay,by)-R)/cell-0.5));
  const j1=Math.min(HF-1, Math.floor((Math.max(ay,by)+R)/cell-0.5));
  for(let j=j0;j<=j1;j++){
    const y=(j+0.5)*cell, xs=[];
    for(const [x1,y1,x2,y2] of [[s1x,s1y,s2x,s2y],[s3x,s3y,s4x,s4y]]){
      if(Math.abs(y2-y1)>1e-12){
        if(y>=Math.min(y1,y2)-1e-12 && y<=Math.max(y1,y2)+1e-12)
          xs.push(x1+(y-y1)/(y2-y1)*(x2-x1));
      } else if(Math.abs(y-y1)<=1e-12){ xs.push(Math.min(x1,x2), Math.max(x1,x2)); }
    }
    for(const [ccx,ccy] of [[ax,ay],[bx,by]]){
      const dyc=y-ccy, q=R*R-dyc*dyc;
      if(q>1e-12){ const s=Math.sqrt(q); xs.push(ccx-s, ccx+s); }
    }
    if(xs.length<2) continue;
    let lo=xs[0], hi=xs[0];
    for(let k=1;k<xs.length;k++){ if(xs[k]<lo) lo=xs[k]; if(xs[k]>hi) hi=xs[k]; }
    _pourIvFill(mask, WF, cell, lo, hi, j);
  }
}
function _pourShoelace(flat){
  let s=0;
  for(let i=0;i<flat.length;i+=2){
    const j=(i+2)%flat.length;
    s+=flat[i]*flat[j+1]-flat[j]*flat[i+1];
  }
  return s/2;   // y 向下坐标系：外环（保持右规则）为正，孔为负
}
// Douglas-Peucker 简化（闭合环，容差 mm）；保形去台阶，弧段呈弦线（误差 ≤ tol）
function _pourSimplify(flat, tol){
  const n=flat.length/2;
  if(n<=4) return flat.slice();
  const keep=new Uint8Array(n); keep[0]=keep[n-1]=1;
  const st=[[0,n-1]];
  while(st.length){
    const [a,b]=st.pop();
    const ax=flat[a*2], ay=flat[a*2+1], bx=flat[b*2], by=flat[b*2+1];
    const dx=bx-ax, dy=by-ay, L2=dx*dx+dy*dy;
    let mid=-1, dmax=tol;
    for(let i=a+1;i<b;i++){
      const px=flat[i*2], py=flat[i*2+1];
      let d;
      if(L2<1e-18) d=Math.hypot(px-ax,py-ay);
      else{
        let t=((px-ax)*dx+(py-ay)*dy)/L2;
        t=Math.max(0,Math.min(1,t));
        d=Math.hypot(px-(ax+t*dx), py-(ay+t*dy));
      }
      if(d>dmax){ dmax=d; mid=i; }
    }
    if(mid>=0){ keep[mid]=1; st.push([a,mid],[mid,b]); }
  }
  const out=[];
  for(let i=0;i<n;i++) if(keep[i]) out.push(flat[i*2], flat[i*2+1]);
  return out;
}
// 凸多边形 ⊕ 圆盘（异网泪滴楔形挖空）：本体行填充 + 各边胶囊
function _pourFillConvex(mask, WF, HF, cell, pts, R){
  let ylo=1e9, yhi=-1e9;
  for(const p of pts){ if(p.y<ylo) ylo=p.y; if(p.y>yhi) yhi=p.y; }
  const j0=Math.max(0, Math.ceil((ylo-R)/cell-0.5)), j1=Math.min(HF-1, Math.floor((yhi+R)/cell-0.5));
  for(let j=j0;j<=j1;j++){
    const y=(j+0.5)*cell, xs=[];
    for(let k=0;k<pts.length;k++){
      const a=pts[k], b=pts[(k+1)%pts.length];
      if(Math.abs(b.y-a.y)>1e-12){
        if(y>=Math.min(a.y,b.y)-1e-12 && y<=Math.max(a.y,b.y)+1e-12)
          xs.push(a.x+(y-a.y)/(b.y-a.y)*(b.x-a.x));
      } else if(Math.abs(y-a.y)<=1e-12) xs.push(Math.min(a.x,b.x), Math.max(a.x,b.x));
    }
    if(xs.length>=2){
      let lo=xs[0], hi=xs[0];
      for(let k=1;k<xs.length;k++){ if(xs[k]<lo) lo=xs[k]; if(xs[k]>hi) hi=xs[k]; }
      _pourIvFill(mask, WF, cell, lo, hi, j);
    }
  }
  for(let k=0;k<pts.length;k++){
    const a=pts[k], b=pts[(k+1)%pts.length];
    _pourFillStadium(mask, WF, HF, cell, a.x, a.y, b.x, b.y, R);
  }
}
// 环自交检测（DP 弦线在零宽夹缝/鞍点附近可能交叉）：
// ≤1500 点全查；大环窗口查（DP 弦线只偏离局部楼梯 ≤tol，远处相交要求真边界相距 <2·tol，
// 网格条纹间距 ≥0.5mm ≫ 2·tol 不可能——局部窗口已覆盖现实失效模式）
function _pourSelfX(flat){
  const n=flat.length/2;
  const full=n<=1500;
  for(let a=0;a<n;a++){
    const ax=flat[a*2], ay=flat[a*2+1], bx=flat[((a+1)%n)*2], by=flat[((a+1)%n)*2+1];
    const xlo=Math.min(ax,bx), xhi=Math.max(ax,bx), ylo=Math.min(ay,by), yhi=Math.max(ay,by);
    const cMax=full?n:Math.min(n, a+201);
    for(let c=a+2;c<cMax;c++){
      if(a===0&&c===n-1) continue;
      const cx=flat[c*2], cy=flat[c*2+1], dx=flat[((c+1)%n)*2], dy=flat[((c+1)%n)*2+1];
      if(Math.max(cx,dx)<xlo||Math.min(cx,dx)>xhi||Math.max(cy,dy)<ylo||Math.min(cy,dy)>yhi) continue;
      const d1=(bx-ax)*(cy-ay)-(by-ay)*(cx-ax);
      const d2=(bx-ax)*(dy-ay)-(by-ay)*(dx-ax);
      const d3=(dx-cx)*(ay-cy)-(dy-cy)*(ax-cx);
      const d4=(dx-cx)*(by-cy)-(dy-cy)*(bx-cx);
      if(((d1>0)!==(d2>0))&&((d3>0)!==(d4>0))) return true;
    }
  }
  return false;
}
// 可分离盒结构元的形态学单轴通过（腐蚀=窗口全 1 / 膨胀=窗口有 1）。
// 全部行优先 + 滑动计数器：垂直轴若按列扫描会产生 stride-WF 缓存缺失
// （5M 格每格一次 miss，实测占 morph 大头），改列计数器随行滑动后零跨步。
// 固定窗口 2rc+1（越界按 0）：板边带（0.2mm ≥ rc 时）保证对 vis 格与裁剪
// 窗口语义等价——窗口触及阵列边缘的 vis 格必然先触及边缘禁铺带。
function _pourMorphH(src, WF, HF, rc, erode){
  // 深度优化（0.11.1）：erode/dilate 拆成专用内层循环（分支提出热循环）
  const dst=new Uint8Array(src.length), W=2*rc+1;
  if(erode){
    for(let j=0;j<HF;j++){
      const base=j*WF;
      let cnt=0;
      for(let i=0;i<=rc&&i<WF;i++) if(src[base+i]) cnt++;
      for(let i=0;i<WF;i++){
        if(cnt===W) dst[base+i]=1;
        const out=i-rc, inn=i+rc+1;
        if(out>=0&&src[base+out]) cnt--;
        if(inn<WF&&src[base+inn]) cnt++;
      }
    }
  }else{
    for(let j=0;j<HF;j++){
      const base=j*WF;
      let cnt=0;
      for(let i=0;i<=rc&&i<WF;i++) if(src[base+i]) cnt++;
      for(let i=0;i<WF;i++){
        if(cnt>0) dst[base+i]=1;
        const out=i-rc, inn=i+rc+1;
        if(out>=0&&src[base+out]) cnt--;
        if(inn<WF&&src[base+inn]) cnt++;
      }
    }
  }
  return dst;
}
function _pourMorphV(src, WF, HF, rc, erode){
  const dst=new Uint8Array(src.length), W=2*rc+1;
  const cnt=new Int32Array(WF);
  for(let k=0;k<=rc&&k<HF;k++){
    const kb=k*WF;
    for(let i=0;i<WF;i++) if(src[kb+i]) cnt[i]++;
  }
  if(erode){
    for(let j=0;j<HF;j++){
      const base=j*WF;
      for(let i=0;i<WF;i++) if(cnt[i]===W) dst[base+i]=1;
      const ja=j+rc+1, jr=j-rc;
      if(ja<HF){ const ab=ja*WF; for(let i=0;i<WF;i++) if(src[ab+i]) cnt[i]++; }
      if(jr>=0){ const rb=jr*WF; for(let i=0;i<WF;i++) if(src[rb+i]) cnt[i]--; }
    }
  }else{
    for(let j=0;j<HF;j++){
      const base=j*WF;
      for(let i=0;i<WF;i++) if(cnt[i]>0) dst[base+i]=1;
      const ja=j+rc+1, jr=j-rc;
      if(ja<HF){ const ab=ja*WF; for(let i=0;i<WF;i++) if(src[ab+i]) cnt[i]++; }
      if(jr>=0){ const rb=jr*WF; for(let i=0;i<WF;i++) if(src[rb+i]) cnt[i]--; }
    }
  }
  return dst;
}
// 形态学开运算（腐蚀→膨胀，盒 SE 半径 rc）：窄于 2·rc 的铜颈/尖角坍缩消失。
// KiCad 收缩-再膨胀（Clipper2 InflatePaths 负/正 delta，默认 ZONE_THICKNESS_MM=0.25）
// 的栅格等价；Altium "Minimum Width"、EasyEDA "最小优化宽度" 同概念。
// 开运算结果 ⊆ 原集合——不会越界长出新铜，间距契约天然保持。
function _pourOpenMask(src, WF, HF, rc){
  const e1=_pourMorphH(src, WF, HF, rc, true);
  const e2=_pourMorphV(e1, WF, HF, rc, true);
  const d1=_pourMorphH(e2, WF, HF, rc, false);
  return _pourMorphV(d1, WF, HF, rc, false);
}
// 深优 2026-11-14：pour 查询的 y-slab 边索引（WeakMap 惰性构建；polys 构造后只读，
// computePour 是唯一写点 :8057）。查询只扫跨越该 y 带的边——同一批边、同一算式，
// 奇偶计数与次序无关 → 位级一致。
const _pourSlab=new WeakMap();
function _pourIndex(pour){
  let idx=_pourSlab.get(pour);
  if(idx) return idx;
  let ylo=Infinity, yhi=-Infinity;
  for(const poly of pour.polys) for(const ring of [poly.outer, ...poly.holes])
    for(let i=1;i<ring.length;i+=2){ const y=ring[i]; if(y<ylo)ylo=y; if(y>yhi)yhi=y; }
  if(ylo>yhi){ ylo=0; yhi=0; }
  const rows=Math.max(1,Math.min(256,Math.ceil((yhi-ylo)/1)||1));
  const h=((yhi-ylo)/rows)||1;
  const bins=Array.from({length:rows},()=>[]);
  for(const poly of pour.polys) for(const ring of [poly.outer, ...poly.holes]){
    for(let i=0;i<ring.length;i+=2){
      const j=(i+2)%ring.length;
      const y1=ring[i+1], y2=ring[j+1];
      // clamp 双侧（恰在 yhi 的水平边 floor(rows) 会双侧越界——r0 越界必须同样夹回，
      // 否则该边被分配进 0 个 bin，pourNear 漏检——pourprobe 差分实测抓出）
      let r0=Math.max(0,Math.min(rows-1,Math.floor((Math.min(y1,y2)-ylo)/h)));
      let r1=Math.max(0,Math.min(rows-1,Math.floor((Math.max(y1,y2)-ylo)/h)));
      if(r0>r1){ const tt=r0; r0=r1; r1=tt; }
      for(let r=r0;r<=r1;r++) bins[r].push(ring,i,j);
    }
  }
  idx={bins,ylo,yhi,h,rows};
  _pourSlab.set(pour,idx);
  return idx;
}
function pourContains(pour, x, y){   // 射线法（+x），跨全部环偶奇判定——无需环嵌套分组
  if(!pour||!pour.polys) return false;
  const idx=_pourIndex(pour);
  if(y<idx.ylo||y>idx.yhi) return false;   // 带外无跨越边 → cross=0 → 偶 → false（与全扫一致）
  const b=idx.bins[Math.max(0,Math.min(idx.rows-1,Math.floor((y-idx.ylo)/idx.h)))];
  let cross=0;
  for(let t=0;t<b.length;t+=3){
    const ring=b[t], i=b[t+1], j=b[t+2];
    const y1=ring[i+1], y2=ring[j+1];
    if((y1>y)!==(y2>y)){
      const xx=ring[i]+(y-y1)*(ring[j]-ring[i])/(y2-y1);
      if(x<xx) cross++;
    }
  }
  return (cross&1)===1;
}
function pourNear(pour, x, y, reach){   // 点在铜皮内或距其边界 ≤ reach（DRC 回流检查用）
  if(!pour||!pour.polys||!pour.polys.length) return false;
  if(pourContains(pour, x, y)) return true;
  const idx=_pourIndex(pour);
  const r2=reach*reach;
  // 边的 y 区间与 [y-reach,y+reach] 不相交者最近点距必 > reach（钳位投影 y 落在区间内）→ 安全跳过
  const r0=Math.max(0,Math.floor((y-reach-idx.ylo)/idx.h)), r1=Math.min(idx.rows-1,Math.floor((y+reach-idx.ylo)/idx.h));
  for(let r=r0;r<=r1;r++){
    const b=idx.bins[r];
    for(let t=0;t<b.length;t+=3){
      const ring=b[t], i=b[t+1], j=b[t+2];
      const ax=ring[i], ay=ring[i+1], bx=ring[j], by=ring[j+1];
      const dx=bx-ax, dy=by-ay, L2=dx*dx+dy*dy;
      let t2=L2>1e-18?((x-ax)*dx+(y-ay)*dy)/L2:0;
      t2=Math.max(0,Math.min(1,t2));
      const ex=ax+t2*dx-x, ey=ay+t2*dy-y;
      if(ex*ex+ey*ey<=r2) return true;
    }
  }
  return false;
}
// 任意（可含孔）多边形组偶奇填充：rings=全部环（外环+孔）的扁平坐标组，偶奇内部=区域
function _pourFillPolyEvenOdd(mask, WF, HF, cell, rings){
  let ylo=1e9, yhi=-1e9;
  for(const f of rings) for(let i=1;i<f.length;i+=2){ if(f[i]<ylo) ylo=f[i]; if(f[i]>yhi) yhi=f[i]; }
  const j0=Math.max(0, Math.ceil(ylo/cell-0.5)), j1=Math.min(HF-1, Math.floor(yhi/cell-0.5));
  for(let j=j0;j<=j1;j++){
    const y=(j+0.5)*cell, xs=[];
    for(const f of rings) for(let i=0;i<f.length;i+=2){
      const k=(i+2)%f.length, y1=f[i+1], y2=f[k+1];
      if((y1>y)!==(y2>y)) xs.push(f[i]+(y-y1)*(f[k]-f[i])/(y2-y1));
    }
    if(xs.length<2) continue;
    xs.sort((a,b)=>a-b);
    for(let m=0;m+1<xs.length;m+=2) _pourIvFill(mask, WF, cell, xs[m], xs[m+1], j);
  }
}
/* ---------- 多边形覆铜主入口：为指定网络在某层生成避让一切的多边形敷铜区 ---------- */
function computePour(design, result, opts){
  opts=opts||{};
  const L=Math.max(1, design.layers|0);
  const layer=Math.max(0, Math.min(L-1, opts.layer|0));
  const netId=opts.netId!=null?opts.netId:null;
  const thermal=opts.thermal!==false;
  const islandMode=['always','area','never'].includes(opts.islandMode)?opts.islandMode:'always';
  const minIslandArea=opts.minIslandArea!=null?opts.minIslandArea:2;   // mm²，islandMode='area' 时生效
  const fillMode=opts.fill==='grid'?'grid':'solid';
  // 嘉立创工艺口径：网格铜线宽/间距 ≥0.254mm（10mil），低于则钳制
  const gridW=Math.max(0.254, opts.gridW!=null?opts.gridW:0.254);
  const gridGap=Math.max(0.254, opts.gridGap!=null?opts.gridGap:0.254);
  const edgeMargin=opts.edgeMargin!=null?opts.edgeMargin:0.2;
  // 细颈消除最小铜宽：KiCad 默认 ZONE_THICKNESS_MM=0.25（zones.h:30，下限 0.025）；
  // 对应 Altium "Minimum Width"、EasyEDA "最小优化宽度"。窄于此的铜颈开运算消除。
  const minWidth=Math.max(0.025, opts.minWidth!=null?opts.minWidth:0.25);
  const empty={layer, netId, polys:[], area:0, islands:0, islandArea:0, islandsKept:0, keptIslandArea:0,
    unconnectedPads:[], cell:0, thermal, thermalActive:thermal, fill:fillMode, gridW, gridGap,
    clearance:design.clearance, edgeMargin, islandMode, minWidth};
  if(netId==null || !(design.nets||[]).some(n=>n.id===netId)) return empty;
  const clr=opts.clearance!=null?opts.clearance:design.clearance;
  // 细格尺寸：间距精度的主旋钮；大板自动放粗防爆内存
  let cell=Math.min(clr, design.grid)/5;
  cell=Math.max(0.015, Math.min(0.1, cell));
  if(design.width/cell*(design.height/cell)>POUR_CELL_CAP)
    cell=Math.max(cell, Math.sqrt(design.width*design.height/POUR_CELL_CAP));
  const WF=Math.max(1, Math.ceil(design.width/cell)), HF=Math.max(1, Math.ceil(design.height/cell)), NF=WF*HF;
  const T=clr+0.707*cell+1e-9;   // 挖空阈值：kept 格任意点距导体 ≥ clr（0.707·cell=对角可达半径）
  const foreign=new Uint8Array(NF);   // 异网导体 ⊕ clearance（圆角偏移）
  const ring=new Uint8Array(NF);      // 本网焊盘热焊盘环形挖空
  const spoke=new Uint8Array(NF);     // 筋条（从环里豁免回来）
  const seed=new Uint8Array(NF);      // 本网铜（焊盘/走线/过孔/筋条）洪泛种子
  const seedDisc=(x,y,r)=>_pourFillDisc(seed, WF, HF, cell, x, y, r);
  const seedStadium=(a,b,r)=>_pourFillStadium(seed, WF, HF, cell, a.x, a.y, b.x, b.y, r);
  const ownPads=(design.pads||[]).filter(p=>p.netId!=null&&p.netId===netId&&padOnLayer(p, layer, L));
  // ---- 异网导体挖空（含手工布线）+ 本网铜种子 ----
  const allNets=[...((result&&result.nets)||[]), ...manualRouteEntries(design)];
  for(const n of allNets){
    const own=n.netId===netId;
    const w=netW(design, n.netId);
    for(const path of n.paths||[]) for(let k=1;k<path.length;k++){
      const a=path[k-1], b=path[k];
      if(a.l!==layer||b.l!==layer) continue;
      if(Math.abs(a.x-b.x)<1e-12&&Math.abs(a.y-b.y)<1e-12) continue;
      if(own) seedStadium(a, b, w/2);
      else _pourFillStadium(foreign, WF, HF, cell, a.x, a.y, b.x, b.y, w/2+T);
    }
    for(const v of n.vias||[]){
      // #15：过孔按层跨度参与铜皮——span 不含本层的过孔在本层无铜，
      // 既不 seed（本网）也不挖空（异网），否则会产生"跨度外假避让"
      //（挖空本层铜皮却没有孔）或"跨度内假连接"。
      if(!viaOnLayer(v, layer, L)) continue;
      const vr=(v.outer!=null?v.outer/2:design.viaOuter/2);
      if(own) seedDisc(v.x, v.y, vr);
      else _pourFillDisc(foreign, WF, HF, cell, v.x, v.y, vr+T);
    }
  }
  for(const p of ownPads){
    if(p.shape==='circle') seedDisc(p.x, p.y, p.w/2);
    else _pourFillRect(seed, WF, HF, cell, p.x, p.y, p.w, p.h, 0);
  }
  for(const p of (design.pads||[])){
    if(p.netId!=null&&p.netId===netId||!padOnLayer(p, layer, L)) continue;
    if(p.shape==='circle') _pourFillDisc(foreign, WF, HF, cell, p.x, p.y, p.w/2+T);
    else _pourFillRect(foreign, WF, HF, cell, p.x, p.y, p.w, p.h, T);
  }
  for(const s of (design.stitching||[])){
    if(s.netId===netId) seedDisc(s.x, s.y, design.viaOuter/2);
    else _pourFillDisc(foreign, WF, HF, cell, s.x, s.y, design.viaOuter/2+T);
  }
  // ---- 异网泪滴楔形挖空（归属按楔形基边中点匹配过孔——与 ui 的 teardropOwner 同思路）----
  if((opts.teardrops||[]).length){
    const viaOwner=new Map();
    for(const n of allNets) for(const v of (n.vias||[]))
      viaOwner.set(v.x.toFixed(3)+'_'+v.y.toFixed(3), n.netId);
    for(const td of opts.teardrops){
      if(td.l!==layer||!td.p||td.p.length<3) continue;
      let own=false;
      for(let k=0;k<td.p.length&&!own;k++){
        const a=td.p[k], b=td.p[(k+1)%td.p.length];
        own=viaOwner.get(((a.x+b.x)/2).toFixed(3)+'_'+((a.y+b.y)/2).toFixed(3))===netId;
      }
      if(!own) _pourFillConvex(foreign, WF, HF, cell, td.p, T);
    }
  }
  // ---- 多铜皮处理（KiCad zone priority 思想：后铺避让先铺）----
  // 异网铜皮：本体偶奇填充 + 全部环边 ⊕ clearance 挖空。
  // 同网铜皮跳过（KiCad/Altium 同网 zone 各自独立填充，fill 层面无融合）：
  // 本次铺铜从当前板态全新计算，孤岛去留由本次 islandMode 统一裁决——
  // 若把旧铜皮并入种子，--islands always 重铺会救回旧保留孤岛（旗标失效）、
  // --fill grid 重铺会保住旧实心区域（输出混合铜皮），均为实测反例。
  for(const ap of (opts.avoidPours||[])){
    if(!ap||!ap.polys||!ap.polys.length||ap.netId===netId||ap.layer!==layer) continue;
    const rings=[];
    for(const poly of ap.polys){ rings.push(poly.outer); for(const h of poly.holes) rings.push(h); }
    _pourFillPolyEvenOdd(foreign, WF, HF, cell, rings);
    for(const f of rings) for(let i=0;i<f.length;i+=2){
      const k=(i+2)%f.length;
      _pourFillStadium(foreign, WF, HF, cell, f[i], f[i+1], f[k], f[k+1], T);
    }
  }
  // ---- 板边带（默认与布线模型同口径 0.2mm）与禁布区 ----
  for(let j=0;j<HF;j++){
    const y=(j+0.5)*cell;
    if(y<edgeMargin||y>design.height-edgeMargin) _pourIvFill(foreign, WF, cell, 0, design.width, j);
    else{
      _pourIvFill(foreign, WF, cell, 0, edgeMargin, j);
      _pourIvFill(foreign, WF, cell, design.width-edgeMargin, design.width, j);
    }
  }
  for(const k of (design.keepouts||[]))
    _pourFillRect(foreign, WF, HF, cell, k.x, k.y, k.w, k.h, T);
  // ---- 热焊盘：环形挖空 + 4 条轴向实宽筋条 ----
  // 筋条窄于最小铜宽时开窗必然产生不可靠连接（KiCad zone_filler："Cannot create
  // stubs having a width < zone min thickness"）→ 该铜皮退化为实心连接。
  const gap=thermal?(opts.thermalGap!=null?opts.thermalGap:clr+0.25):0;
  const spokeW=thermal?(opts.spokeW!=null?opts.spokeW:Math.max(netW(design, netId), 0.3)):0;
  const ext=spokeW*2;   // 筋条伸出环外的长度（穿环形挖空区后咬进海铜）
  const thermalActive=thermal&&spokeW>=minWidth-1e-9;
  if(thermalActive){
    for(const p of ownPads){
      const prx=p.w/2, pry=p.shape==='circle'?p.w/2:p.h/2;
      if(p.shape==='circle') _pourFillDisc(ring, WF, HF, cell, p.x, p.y, p.w/2+gap);
      else _pourFillRect(ring, WF, HF, cell, p.x, p.y, p.w, p.h, gap);
      for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
        let rx0, ry0, rx1, ry1;
        if(dx===1){ rx0=p.x+prx-0.02; rx1=p.x+prx+gap+ext; ry0=p.y-spokeW/2; ry1=p.y+spokeW/2; }
        else if(dx===-1){ rx0=p.x-prx-gap-ext; rx1=p.x-prx+0.02; ry0=p.y-spokeW/2; ry1=p.y+spokeW/2; }
        else if(dy===1){ rx0=p.x-spokeW/2; rx1=p.x+spokeW/2; ry0=p.y+pry-0.02; ry1=p.y+pry+gap+ext; }
        else{ rx0=p.x-spokeW/2; rx1=p.x+spokeW/2; ry0=p.y-pry-gap-ext; ry1=p.y-pry+0.02; }
        _pourFillRect(spoke, WF, HF, cell, (rx0+rx1)/2, (ry0+ry1)/2, rx1-rx0, ry1-ry0, 0);
      }
    }
  }
  // ---- 合成挖空场：foreign ∪ (ring ∧ ¬spoke ∧ ¬seed) —— 筋条救不回异网导体的挖空；
  //      环形挖空不作用于本网铜（焊盘本体/穿过环带的本网走线/过孔保持铜）----
  for(let c=0;c<NF;c++) if(ring[c]&&!spoke[c]&&!seed[c]) foreign[c]=1;
  // ---- 洪泛（内联邻居检查；q 复用为孤岛栈）----
  const vis=new Uint8Array(NF);
  const q=new Int32Array(NF);
  // ---- 扫描线洪泛（run-based）：入队/出队与邻居检查都以"行段"为单位，
  //      比逐格 BFS 少一个量级的操作；4-连通组件成员与逐格版严格一致。
  //      队列存 (row, x0, x1) 三元组，按需倍增（最坏交替格场景 run 数可达 O(N)）----
  const flood=keep=>{
    vis.fill(0);
    let rq=new Int32Array(4096), qh=0, qt=0;
    const push3=(a,b,c)=>{ if(qt+3>rq.length){ const n=new Int32Array(rq.length*2); n.set(rq); rq=n; } rq[qt++]=a; rq[qt++]=b; rq[qt++]=c; };
    const okCell=c=>!vis[c]&&!foreign[c]&&(!keep||keep[c]);
    // 初始种子 run：扫到种子格即取其所在的最大可填充连段（左右扩展）——
    // 若只吞并种子连段，同行相邻的空闲格永远等不到垂直发现（h2-stm32 实测漏 45 格）
    for(let j=0;j<HF;j++){
      const base=j*WF;
      for(let i=0;i<WF;i++){
        const c=base+i;
        if(!seed[c]||!okCell(c)) continue;
        vis[c]=1;
        let a=i-1, b=i+1;
        while(a>=0&&okCell(base+a)){ vis[base+a]=1; a--; }
        while(b<WF&&okCell(base+b)){ vis[base+b]=1; b++; }
        push3(j, a+1, b-1);
        i=b-1;
      }
    }
    // 传播：run 的上下两行发现未填格 → 左右扩段成新 run
    while(qh<qt){
      const j=rq[qh++], x0=rq[qh++], x1=rq[qh++];
      for(let jj=j-1;jj<=j+1;jj+=2){
        if(jj<0||jj>=HF) continue;
        const base=jj*WF;
        for(let i=x0;i<=x1;i++){
          const c=base+i;
          if(!okCell(c)) continue;
          vis[c]=1;
          let a=i-1, b=i+1;
          while(a>=0&&okCell(base+a)){ vis[base+a]=1; a--; }
          while(b<WF&&okCell(base+b)){ vis[base+b]=1; b++; }
          push3(jj, a+1, b-1);
          i=b-1;
        }
      }
    }
  };
  flood(null);
  // ---- 网格铜（EasyEDA fillStyle 'grid' / 嘉立创大铜面防起泡口径）：场区按条纹再挖空 ----
  // 焊盘/走线/过孔/筋条保持实心（KiCad hatch 同款），条纹断裂处重洪泛取真实连通性。
  if(fillMode==='grid'){
    const P=gridW+gridGap;
    for(let j=0;j<HF;j++){
      const y=(j+0.5)*cell, yOn=(y%P)<gridW-1e-9, base=j*WF;
      for(let i=0;i<WF;i++){
        const c=base+i;
        if(!vis[c]||seed[c]||spoke[c]) continue;
        if(!(yOn||(((i+0.5)*cell)%P)<gridW-1e-9)) foreign[c]=1;
      }
    }
    flood(null);
  }
  // ---- 细颈消除（KiCad shrink-then-grow / Altium Minimum Width / EasyEDA 最小优化宽度）----
  // 形态学开运算（盒 SE 半径 minWidth/2）：窄于 minWidth 的铜颈/酸角尖坍缩消失；
  // 开运算 ⊆ 原集合，间距契约与不越界性天然保持。仅实心模式——网格铜条纹以自身
  // 线宽为最小厚度（KiCad hatch 同口径）。焊盘/走线/过孔/缝合孔/筋条是本网真实铜，
  // 开运算后回填，再重洪泛：与种子失连的残余碎片交孤岛策略处理。
  if(fillMode==='solid'&&minWidth>=2*cell+1e-9){
    const rc=Math.max(1, Math.round(minWidth/(2*cell)));
    const opened=_pourOpenMask(vis, WF, HF, rc);
    for(let c=0;c<NF;c++) if((seed[c]||spoke[c])&&vis[c]) opened[c]=1;
    flood(opened);
  }
  // ---- 孤岛处理（KiCad ISLAND_REMOVAL_MODE 三档）----
  // always=全删；area=小于 minIslandArea 删、达到则保留；never=全保留（DRC 提醒天线风险）。
  // 注意用 BFS（qh/qt 单调前进）：q 的压入位置不复用，q[0..n-1] 恰为完整组件，
  // 保留时回填 vis 才不会漏格/错格（DFS 栈会复用位置，组件收集被覆盖——实测教训）。
  let islands=0, islandArea=0, islandsKept=0, keptIslandArea=0;
  const done=new Uint8Array(NF);   // 孤岛格标记（保留/删除都算）；接入检测复用作排除
  if(islandMode==='always'){
    // 深度优化（0.11.1）：always 快径——run-based 扫描线连通计数。负空间孤岛可达
    // 152 万格（大板面几乎全是），逐格 BFS 占 pour 的 40%。run 行段 + 行间重叠
    // 合并（单遍 label 传播 + 小型并查集）与 4 连通 BFS 的组件划分严格一致，
    // islands/islandArea 数值不变；总孤岛面积 = 负空间总格数×cell²（每个负空间格
    // 恰属一个组件）。always 不回填 vis——孤岛格必 !vis，后续 done 排除语义由
    // !vis 蕴含（done 保持全零，行为等价）。
    let lblNext=0;
    const lblPar=[];            // label → parent（并查集）
    const lblCount=[];          // root → 组件格数（run 合并时随父聚合）
    const lblMin=[];            // root → 组件最小格索引（行主序——BFS 发现顺序的同构量）
    const lfind=l=>{ while(lblPar[l]!==l){ lblPar[l]=lblPar[lblPar[l]]; l=lblPar[l]; } return l; };
    let prevX0=[], prevX1=[], prevL=[];   // 上一行 runs
    for(let j=0;j<HF;j++){
      const base=j*WF;
      const curX0=[], curX1=[], curL=[];
      for(let i=0;i<WF;i++){
        const c=base+i;
        if(foreign[c]||vis[c]){ continue; }
        let x1=i+1;
        while(x1<WF&&!foreign[base+x1]&&!vis[base+x1]) x1++;
        // 与上一行重叠 runs 合并标签
        let lbl=-1;
        for(let k=0;k<prevX0.length;k++){
          if(prevX0[k]<x1&&i<prevX1[k]){   // x 区间重叠 → 4 连通
            const pl=lfind(prevL[k]);
            if(lbl<0){ lbl=pl; }
            else if(pl!==lbl){   // 合并两分支：计数/最小格随并查集聚合（否则留在子 root 上的数会丢）
              lblPar[pl]=lbl;
              lblCount[lbl]+=lblCount[pl]; lblCount[pl]=0;
              if(lblMin[pl]<lblMin[lbl]) lblMin[lbl]=lblMin[pl];
            }
          }
        }
        if(lbl<0){ lbl=lblNext++; lblPar[lbl]=lbl; lblCount[lbl]=0; lblMin[lbl]=c; }
        const rt=lfind(lbl);
        lblCount[rt]+=x1-i;
        if(c<lblMin[rt]) lblMin[rt]=c;
        curX0.push(i); curX1.push(x1); curL.push(lbl);
        i=x1-1;
      }
      prevX0=curX0; prevX1=curX1; prevL=curL;
    }
    // islands/islandArea 与逐格 BFS 位级一致：组件按其最小格索引（=BFS 行主序
    // 发现顺序）排序，逐组件 a=格数×cell² 累加——浮点序列与 BFS 相同。
    const comps=[];
    for(let l=0;l<lblNext;l++) if(lfind(l)===l) comps.push(l);
    comps.sort((a,b)=>lblMin[a]-lblMin[b]);
    islands=comps.length;
    for(const rt of comps){ const a=lblCount[rt]*cell*cell; islandArea+=a; }
  }
  else{
    for(let c0=0;c0<NF;c0++){
      if(foreign[c0]||vis[c0]||done[c0]) continue;
      let qh=0, qt=0, n=0;
      q[qt++]=c0; done[c0]=1;
      while(qh<qt){
        const cc=q[qh++], x=cc%WF;
        n++;
        if(x>0&&!foreign[cc-1]&&!vis[cc-1]&&!done[cc-1]){ done[cc-1]=1; q[qt++]=cc-1; }
        if(x<WF-1&&!foreign[cc+1]&&!vis[cc+1]&&!done[cc+1]){ done[cc+1]=1; q[qt++]=cc+1; }
        if(cc>=WF&&!foreign[cc-WF]&&!vis[cc-WF]&&!done[cc-WF]){ done[cc-WF]=1; q[qt++]=cc-WF; }
        if(cc<NF-WF&&!foreign[cc+WF]&&!vis[cc+WF]&&!done[cc+WF]){ done[cc+WF]=1; q[qt++]=cc+WF; }
      }
      const a=n*cell*cell;
      if(islandMode==='area'&&a<minIslandArea){ islands++; islandArea+=a; }
      else{
        // 保留：回填进 vis，轮廓跟踪照常输出
        islandsKept++; keptIslandArea+=a;
        for(let k=0;k<n;k++){ const cc=q[k]; if(!vis[cc]) vis[cc]=1; }
      }
    }
  }
  // ---- 焊盘铜皮接入检测（KiCad 筋条末端测试点法的环带版）----
  // 证据 = 筋条末端以外环带 [R0,R1] 内的本网铜（海铜/走线/过孔/缝合孔）。
  // 焊盘本体与自身筋条走廊不算（筋条即使存在也未必接通海铜）；孤岛格（done）不算。
  const unconnectedPads=[];
  if(ownPads.length){
    const near=new Uint8Array(NF);
    for(const p of ownPads){   // 所有焊盘本体格先标记：孤立焊盘不得互为连接证据
      const half=p.shape==='circle'?p.w/2:p.w/2, halfY=p.shape==='circle'?p.w/2:p.h/2;
      const bi0=Math.max(0, Math.floor((p.x-half)/cell-0.5)), bi1=Math.min(WF-1, Math.ceil((p.x+half)/cell-0.5));
      const bj0=Math.max(0, Math.floor((p.y-halfY)/cell-0.5)), bj1=Math.min(HF-1, Math.ceil((p.y+halfY)/cell-0.5));
      for(let j=bj0;j<=bj1;j++) for(let i=bi0;i<=bi1;i++) near[j*WF+i]=1;
    }
    for(const p of ownPads){
      const half=p.shape==='circle'?p.w/2:Math.hypot(p.w,p.h)/2;
      const R0=half+(thermalActive?gap+ext:0)+cell;
      const R1=R0+spokeW/2+3*cell;
      const i0=Math.max(0, Math.floor((p.x-R1)/cell-0.5)), i1=Math.min(WF-1, Math.ceil((p.x+R1)/cell-0.5));
      const j0=Math.max(0, Math.floor((p.y-R1)/cell-0.5)), j1=Math.min(HF-1, Math.ceil((p.y+R1)/cell-0.5));
      const R02=R0*R0, R12=R1*R1;
      let connected=false;
      scan:
      for(let j=j0;j<=j1;j++){
        const base=j*WF, dy=(j+0.5)*cell-p.y;
        for(let i=i0;i<=i1;i++){
          const c=base+i;
          if(!vis[c]||near[c]||done[c]) continue;
          const d2=(i+0.5)*cell-p.x; const dd=d2*d2+dy*dy;
          if(dd>=R02&&dd<=R12){ connected=true; break scan; }
        }
      }
      if(!connected) unconnectedPads.push(p.id);
    }
  }
  // ---- 轮廓跟踪：vis 区域的边界面 → 有向环（铜在右 / y 向下）----
  const VN=(WF+1)*(HF+1);
  // 深度优化（0.11.0）：边界边两遍扫描 + 预分配 Int32Array（原 JS 数组 push 是
  // computePour 的 GC 大户；两遍 NF 扫描远 cheap 于动态扩容与装箱）。
  // 每铜格最多产 4 边：上空/下空/左空/右空 —— EN 上界 = 4·visCount，首遍计数。
  let EN=0;
  for(let j=0;j<HF;j++){
    const base=j*WF;
    for(let i=0;i<WF;i++){
      if(!vis[base+i]) continue;
      if(j===0||!vis[base+i-WF]) EN++;
      if(j===HF-1||!vis[base+i+WF]) EN++;
      if(i===0||!vis[base+i-1]) EN++;
      if(i===WF-1||!vis[base+i+1]) EN++;
    }
  }
  const eFrom=new Int32Array(EN), eTo=new Int32Array(EN);   // 有向边界边（顶点 = y*(WF+1)+x）
  {
    let ep=0;
    const addEdge=(vx1,vy1,vx2,vy2)=>{ eFrom[ep]=vy1*(WF+1)+vx1; eTo[ep]=vy2*(WF+1)+vx2; ep++; };
    for(let j=0;j<HF;j++)for(let i=0;i<WF;i++){
      if(!vis[j*WF+i]) continue;
      if(j===0||!vis[j*WF+i-WF]) addEdge(i, j, i+1, j);         // 上空下铜 → +x（右=下=铜）
      if(j===HF-1||!vis[j*WF+i+WF]) addEdge(i+1, j+1, i, j+1);  // 上铜下空 → −x
      if(i===0||!vis[j*WF+i-1]) addEdge(i, j+1, i, j);           // 左空右铜 → −y（右=右=铜）
      if(i===WF-1||!vis[j*WF+i+1]) addEdge(i+1, j, i+1, j+1);    // 左铜右空 → +y
    }
  }
  const head=new Int32Array(VN).fill(-1), eNext=new Int32Array(EN);
  for(let e=0;e<EN;e++){ eNext[e]=head[eFrom[e]]; head[eFrom[e]]=e; }
  // 方向编码 0:+x 1:+y 2:−x 3:−y；鞍点处取最右转，保证环不自交
  const dirOf=(f,t)=>{
    const fy=(f/(WF+1))|0, fx=f%(WF+1), ty=(t/(WF+1))|0, tx=t%(WF+1);
    return tx>fx?0:ty>fy?1:tx<fx?2:3;
  };
  const used=new Uint8Array(EN);
  const polys=[]; let area=0;
  for(let e0=0;e0<EN;e0++){
    if(used[e0]) continue;
    const ringPts=[];
    let e=e0;
    do{
      used[e]=1;
      const f=eFrom[e], t=eTo[e];
      ringPts.push(f%(WF+1)*cell, ((f/(WF+1))|0)*cell);
      if(t===eFrom[e0]) break;   // 回到起点顶点即闭合（鞍点处不吞并相邻环）
      // 选出边：候选中取最右转（右=1 优先，直=0 次之，左=3 最后），
      // 鞍点处按"保持右"配对拆环——取错方向会把两个环合并成自接触环（模糊测试 it20 实证）
      const d0=dirOf(f,t);
      let best=-1, bestScore=4;
      for(let c2=head[t]; c2>=0; c2=eNext[c2]){
        if(used[c2]) continue;
        const turn=(dirOf(t, eTo[c2])-d0+4)%4;
        const score=turn===1?0:turn===0?1:2;
        if(score<bestScore){ bestScore=score; best=c2; }
      }
      if(best<0) break;
      e=best;
    }while(true);
    if(ringPts.length<6) continue;
    const tol=Math.max(cell/3, 0.005);
    const round=f=>{ for(let i=0;i<f.length;i++) f[i]=Math.round(f[i]*1000)/1000; return f; };
    let flat=round(_pourSimplify(ringPts, tol));
    if(_pourSelfX(flat)){
      // 交点处重简化（容差逐级减半）；仍交则回退原始楼梯环（网格跟踪构造上简单）
      let fixed=null;
      for(const t2 of [tol/2, tol/4, tol/8]){
        const cand=round(_pourSimplify(ringPts, t2));
        if(!_pourSelfX(cand)){ fixed=cand; break; }
      }
      flat=fixed||round(ringPts.slice());
    }
    const sA=_pourShoelace(flat);
    if(Math.abs(sA)<1e-9) continue;
    polys.push({flat, hole:sA<0, area:Math.abs(sA)});
  }
  // ---- 外环/孔分组：孔归入包含它的最小外环 ----
  const outers=polys.filter(p=>!p.hole).sort((a,b)=>b.area-a.area);
  const pointIn=(flat, x, y)=>{
    let cross=0;
    for(let i=0;i<flat.length;i+=2){
      const j=(i+2)%flat.length;
      const y1=flat[i+1], y2=flat[j+1];
      if((y1>y)!==(y2>y)){
        const xx=flat[i]+(y-y1)*(flat[j]-flat[i])/(y2-y1);
        if(x<xx) cross++;
      }
    }
    return (cross&1)===1;
  };
  const groups=outers.map(o=>({outer:o.flat, holes:[]}));
  for(const p of polys){
    if(!p.hole) continue;
    const px=p.flat[0], py=p.flat[1];
    for(const g of groups)
      if(pointIn(g.outer, px, py)){ g.holes.push(p.flat); break; }
  }
  for(const g of groups) area+=_pourShoelace(g.outer)+g.holes.reduce((s,h)=>s+_pourShoelace(h),0);
  return {layer, netId, polys:groups, area, islands, islandArea, islandsKept, keptIslandArea,
    unconnectedPads, cell, thermal, thermalActive, fill:fillMode, gridW, gridGap,
    clearance:clr, edgeMargin, islandMode, minWidth};
}

/* ---------- 圆角走线路径（SVG 用；canvas 侧用 traceRounded） ---------- */
function roundedPathD(pts, r){
  if(!pts||pts.length<2) return '';
  let d='M'+pts[0].x.toFixed(3)+' '+pts[0].y.toFixed(3);
  for(let i=1;i<pts.length-1;i++){
    const p0=pts[i-1], p1=pts[i], p2=pts[i+1];
    const l1=Math.hypot(p1.x-p0.x,p1.y-p0.y), l2=Math.hypot(p2.x-p1.x,p2.y-p1.y);
    if(l1<1e-9||l2<1e-9) continue;
    const rr=Math.min(r, l1/2.5, l2/2.5);
    if(rr<0.01){ d+='L'+p1.x.toFixed(3)+' '+p1.y.toFixed(3); continue; }
    const ax=p1.x-(p1.x-p0.x)/l1*rr, ay=p1.y-(p1.y-p0.y)/l1*rr;
    const bx=p1.x+(p2.x-p1.x)/l2*rr, by=p1.y+(p2.y-p1.y)/l2*rr;
    d+='L'+ax.toFixed(3)+' '+ay.toFixed(3)
      +'Q'+p1.x.toFixed(3)+' '+p1.y.toFixed(3)+' '+bx.toFixed(3)+' '+by.toFixed(3);
  }
  const last=pts[pts.length-1];
  d+='L'+last.x.toFixed(3)+' '+last.y.toFixed(3);
  return d;
}

/* ---------- Gerber RS-274X 铜层 / 板框 与 Excellon 钻孔导出 ---------- */
function fmt6(v){ return String(Math.round(v*1e6)); }
function buildGerber(design, result, pour, teardrops){
  const pours=Array.isArray(pour)?pour.filter(Boolean):(pour?[pour]:[]);
  const layerCount=Math.max(1,design.layers||2);
  const drillPts=[];
  const Lc=Math.max(1,design.layers||2);
  for(const p of (design.pads||[]))
    if(p.layer==='both') drillPts.push({x:p.x,y:p.y,d:(p.holeR!=null?p.holeR:design.viaDrill/2)*2,span:[0,Lc-1]});
  if(result&&result.nets) for(const n of result.nets) for(const v of n.vias)
    drillPts.push({x:v.x,y:v.y,d:(v.drill!=null?v.drill:design.viaDrill),span:viaSpan(v,Lc)});
  for(const s of (design.stitching||[])) drillPts.push({x:s.x,y:s.y,d:design.viaDrill,span:[0,Lc-1]});

  function copperLayer(l){
    const desc=['C,'+design.trackW.toFixed(5),'C,'+design.viaOuter.toFixed(5)];
    const trackAp=10, viaAp=11;
    const netAp=new Map();   // 每网线宽光圈（网络类：电源粗/信号细）
    for(const n of (result&&result.nets)||[]){
      const w=netW(design, n.netId);
      if(Math.abs(w-design.trackW)>1e-9){
        const key='C,'+w.toFixed(5);
        if(!desc.includes(key)) desc.push(key);
        netAp.set(n.netId, 10+desc.indexOf(key));
      }
    }
    const padAp=new Map();
    for(const p of (design.pads||[])){
      const key=p.shape==='circle'?('C,'+p.w.toFixed(5)):('R,'+p.w.toFixed(5)+'X'+p.h.toFixed(5));
      if(!padAp.has(p.id)){ desc.push(key); padAp.set(p.id, 10+desc.length-1); }
    }
    let s='%FSLAX26Y26*%\n%MOMM*%\n%LPD*%\n';
    desc.forEach((d,i)=>{ s+='%ADD'+(10+i)+d+'*%\n'; });
    s+='G01*\n';
    // 覆铜区：多边形环（外环暗画 LPD，孔 Clear 画 LPC——KiCad 同款极性切换）；支持多块铜皮
    for(const po of pours){
      if(!po||po.layer!==l||!po.polys||!po.polys.length) continue;
      s+='D'+trackAp+'*\n';
      const region=flat=>{
        let r='';
        for(let i=0;i<flat.length;i+=2)
          r+='X'+fmt6(flat[i])+'Y'+fmt6(flat[i+1])+(i===0?'D02*':'D01*')+'\n';
        return r+'X'+fmt6(flat[0])+'Y'+fmt6(flat[1])+'D01*\n';
      };
      for(const poly of po.polys){
        s+='G36*\n'+region(poly.outer)+'G37*\n';
        for(const h of poly.holes)
          s+='%LPC*%\nG36*\n'+region(h)+'G37*\n%LPD*%\n';
      }
    }
    // 泪滴（制造化：楔形多边形写入铜层，与 GUI 渲染一致）
    if(teardrops) for(const td of teardrops){
      if(td.l!==l||!td.p||td.p.length<3) continue;
      s+='G36*\n';
      td.p.forEach((pt,i)=>{ s+=(i===0?'X'+fmt6(pt.x)+'Y'+fmt6(pt.y)+'D02*':'X'+fmt6(pt.x)+'Y'+fmt6(pt.y)+'D01*')+'\n'; });
      s+='X'+fmt6(td.p[0].x)+'Y'+fmt6(td.p[0].y)+'D01*\nG37*\n';
    }
    // 走线
    if(result&&result.nets){
      for(const n of result.nets){
        s+='D'+(netAp.get(n.netId)||trackAp)+'*\n';
        for(const path of n.paths)for(let k=1;k<path.length;k++){
          const a=path[k-1], b=path[k];
          if(a.l!==l) continue;
          if(Math.abs(a.x-b.x)<1e-9&&Math.abs(a.y-b.y)<1e-9) continue;
          s+='X'+fmt6(a.x)+'Y'+fmt6(a.y)+'D02*\nX'+fmt6(b.x)+'Y'+fmt6(b.y)+'D01*\n';
        }
      }
      // 过孔只在**其层跨度内**的层闪现（#15：盲埋孔不得在外层留铜环）+ 覆铜缝合孔
      s+='D'+viaAp+'*\n';
      for(const n of result.nets)for(const v of n.vias)
        if(viaOnLayer(v,l,layerCount))
          s+='X'+fmt6(v.x)+'Y'+fmt6(v.y)+'D03*\n';
      for(const sv of (design.stitching||[]))
        s+='X'+fmt6(sv.x)+'Y'+fmt6(sv.y)+'D03*\n';
    }
    // 焊盘
    for(const p of (design.pads||[])){
      const onThis = p.layer==='both' || (p.layer==='top'?l===0:l===layerCount-1);
      if(!onThis) continue;
      s+='D'+padAp.get(p.id)+'*\nX'+fmt6(p.x)+'Y'+fmt6(p.y)+'D03*\n';
    }
    s+='M02*\n';
    return s;
  }
  // 阻焊开窗层：焊盘形状每边外扩 0.05mm；过孔默认盖油不开窗（嘉立创惯例）
  function maskLayer(l){
    let s='%FSLAX26Y26*%\n%MOMM*%\n%LPD*%\n';
    const desc=[], aps=new Map();
    const apKey=p=>p.shape==='circle'?('C,'+(p.w+0.1).toFixed(5)):('R,'+(p.w+0.1).toFixed(5)+'X'+(p.h+0.1).toFixed(5));
    for(const p of (design.pads||[])){
      const onThis=p.layer==='both'||(p.layer==='top'?l===0:l===layerCount-1);
      if(!onThis) continue;
      const key=apKey(p);
      if(!aps.has(key)){ desc.push(key); aps.set(key, 10+desc.length-1); }
    }
    desc.forEach((d,i)=>{ s+='%ADD'+(10+i)+d+'*%\n'; });
    s+='G01*\n';
    for(const p of (design.pads||[])){
      const onThis=p.layer==='both'||(p.layer==='top'?l===0:l===layerCount-1);
      if(!onThis) continue;
      s+='D'+aps.get(apKey(p))+'*\nX'+fmt6(p.x)+'Y'+fmt6(p.y)+'D03*\n';
    }
    s+='M02*\n';
    return s;
  }
  // 丝印层：每组件 pin-1 外侧 Ø0.6mm 圆点标记（位号文字走 EasyEDA 路径）
  function silkLayer(l){
    let s='%FSLAX26Y26*%\n%MOMM*%\n%LPD*%\n%ADD10C,0.600000*%\nG01*\nD10*\n';
    const groups=new Map();
    for(const p of (design.pads||[])){
      const i=p.id.lastIndexOf('-');
      if(i<=0) continue;
      const gname=p.id.slice(0,i);
      if(!groups.has(gname)) groups.set(gname,[]);
      groups.get(gname).push(p);
    }
    for(const [,ps] of groups){
      const p1=ps.find(p=>p.id.endsWith('-1'))||ps[0];
      const onThis=p1.layer==='both'||(p1.layer==='top'?l===0:l===layerCount-1);
      if(!onThis) continue;
      let cx=0, cy=0;
      for(const p of ps){ cx+=p.x; cy+=p.y; }
      cx/=ps.length; cy/=ps.length;
      const dx=p1.x-cx, dy=p1.y-cy, m=Math.hypot(dx,dy)||1;
      s+='X'+fmt6(p1.x+dx/m*(p1.w/2+0.9))+'Y'+fmt6(p1.y+dy/m*(p1.h/2+0.9))+'D03*\n';
    }
    s+='M02*\n';
    return s;
  }
  const top=copperLayer(0);
  // 板框
  let outline='%FSLAX26Y26*%\n%MOMM*%\n%LPD*%\n%ADD10C,0.100000*%\nG01*\nD10*\n';
  const W=fmt6(design.width), H=fmt6(design.height), O=fmt6(0);
  outline+='X'+O+'Y'+O+'D02*\nX'+W+'Y'+O+'D01*\nX'+W+'Y'+H+'D01*\nX'+O+'Y'+H+'D01*\nX'+O+'Y'+O+'D01*\nM02*\n';
  // 钻孔（Excellon）
  // #15：去重必须含层跨度——同一 XY 同直径的通孔与埋孔是两次不同的机械/激光
  // 钻孔（埋孔只钻内层），按坐标+直径去重会把埋孔"吞掉"。同一 span 内的
  // 共位孔仍合并（共享焊盘/过孔孔）。#15b：同直径不同 span 分为不同刀具
  //（物理上是两次钻孔），非通孔刀具在刀表区以 ;Tnn span a-b 注释行标明
  //（体区保持纯坐标——板厂按注释分钻带程序；缺省全通孔时输出字节不变）。
  const tools=new Map(),drilled=new Set();
  for(const p of drillPts){
    if(p.d<=0) continue; // Explicit holeR:0 is solid copper, not a zero-diameter tool.
    const sp=p.span||[0,Lc-1];
    const k=p.d.toFixed(3),location=JSON.stringify([p.x.toFixed(3),p.y.toFixed(3),k,sp[0],sp[1]]);
    if(drilled.has(location)) continue;
    drilled.add(location);
    const tk=k+'#'+sp[0]+'-'+sp[1];
    if(!tools.has(tk)) tools.set(tk,{d:k,span:sp,hits:[]});
    tools.get(tk).hits.push({...p,span:sp});
  }
  const toolList=[...tools.values()].sort((a,b)=>parseFloat(a.d)-parseFloat(b.d)||a.span[0]-b.span[0]||a.span[1]-b.span[1]);
  let drill=';PCB 自动布线工具 钻孔文件\nM48\nMETRIC,TZ\n';
  toolList.forEach((t,i)=>{
    drill+='T'+String(i+1).padStart(2,'0')+'C'+t.d+'\n';
    if(!(t.span[0]===0&&t.span[1]===Lc-1))
      drill+=';T'+String(i+1).padStart(2,'0')+' span '+t.span[0]+'-'+t.span[1]+' (盲埋孔)\n';
  });
  drill+='%\nG90\nG05\n';
  toolList.forEach((t,i)=>{
    drill+='T'+String(i+1).padStart(2,'0')+'\n';
    for(const p of t.hits) drill+='X'+p.x.toFixed(3)+'Y'+p.y.toFixed(3)+'\n';
  });
  drill+='T00\nM30\n';
  return {top, bottom:copperLayer(layerCount-1), outline, drill,
    inner:Array.from({length:Math.max(0,layerCount-2)},(_,i)=>copperLayer(i+1)),
    fmask:maskLayer(0), bmask:maskLayer(layerCount-1), fsilk:silkLayer(0), bsilk:silkLayer(layerCount-1)};
}

function gerberFiles(g,base='pcb'){
  return [['-F_Cu.gbr',g.top],...(g.inner||[]).map((text,i)=>['-In'+(i+1)+'_Cu.gbr',text]),
    ['-B_Cu.gbr',g.bottom],['-F_Mask.gbr',g.fmask],['-B_Mask.gbr',g.bmask],
    ['-F_SilkS.gbr',g.fsilk],['-B_SilkS.gbr',g.bsilk],['-Edge_Cuts.gbr',g.outline],['.drl',g.drill]]
    .map(([suffix,text])=>[base+suffix,text]);
}

/* ---------- 投板前检查表：按嘉立创参数表逐项核对当前设计 ---------- */
function fabChecklist(design, result, opts){
  opts=opts||{};
  const rows=[];
  const R=(group,item,value,limit,status,note)=>rows.push({group,item,value,limit,status,note:note||''});
  const rule=jlcTrackRule(design);
  const oz=String(design.copperWeight||'1');
  const multi=(design.layers||2)>=4;
  const twOk=design.trackW>=rule.suggest-1e-9?'ok':(design.trackW>=rule.limit-1e-9?'warn':'fail');
  R('线宽/线距','信号线宽（'+oz+'oz '+(multi?'多层':'单双面')+'）', design.trackW.toFixed(2)+' mm',
    '建议 ≥'+rule.suggest+' / 极限 '+rule.limit, twOk, '按 −20% 线宽公差校核载流与阻抗');
  for(const n of design.nets||[]) if(n.w){
    const nwOk=n.w>=rule.suggest-1e-9?'ok':(n.w>=rule.limit-1e-9?'warn':'fail');
    R('线宽/线距','网络 '+n.name+' 线宽', n.w.toFixed(2)+' mm',
      '建议 ≥'+rule.suggest+' / 极限 '+rule.limit, nwOk, '每网线宽（网络类）');
  }
  const clOk=design.clearance>=rule.suggest-1e-9?'ok':(design.clearance>=rule.limit-1e-9?'warn':'fail');
  R('线宽/线距','线距', design.clearance.toFixed(2)+' mm', '建议 ≥'+rule.suggest+' / 极限 '+rule.limit, clOk);
  const vdOk=design.viaDrill>=JLC.viaSuggest.drill-1e-9?'ok':(design.viaDrill>=JLC.via.double.drill-1e-9?'warn':'fail');
  R('过孔','钻孔直径', design.viaDrill.toFixed(2)+' mm', '建议 0.30 / 极限 0.15', vdOk, design.viaDrill<0.3?'非常规孔径可能加收':'');
  const holes=manufacturingHoles(design,result);
  {
    const rings=holes.flatMap(h=>h.pads.map(p=>Math.min(p.w,p.shape==='circle'?p.w:p.h)/2-h.r));
    if(rings.length){
      const minRing=Math.min(...rings);
      const rOk=minRing>=JLC.annular.suggest-1e-9?'ok':(minRing>=JLC.annular.min-1e-9?'warn':'fail');
      R('过孔','插件孔环宽（最小）', minRing.toFixed(2)+' mm', '建议 '+JLC.annular.suggest+' / 极限 '+JLC.annular.min, rOk);
    }
  }
  const voOk=design.viaOuter>=JLC.viaSuggest.outer-1e-9?'ok':(design.viaOuter>=JLC.via.double.outer-1e-9?'warn':'fail');
  R('过孔','过孔外径', design.viaOuter.toFixed(2)+' mm', '建议 0.60 / 极限 0.25', voOk);
  // 盘中孔 VIPPO 检查（A2e，0.13.17）：过孔落在 SMD 焊盘铜内 ⇒ 需树脂塞孔
  {
    let vip=0; const vipPads=new Set();
    for(const n of result?.nets||[]) for(const v of n.vias||[]){
      for(const p of design.pads||[]){
        if(p.netId!==n.netId || p.layer==='both') continue;
        if(pointPadDistance(v.x,v.y,p)<=1e-9){ vip++; vipPads.add(p.id); break; }
      }
    }
    if(vip>0) R('过孔','盘中孔（VIPPO）', vip+' 颗（焊盘 '+vipPads.size+' 个）',
      '需树脂塞孔+电镀盖帽','人工确认',
      '盘中孔未塞孔会回流吸锡造成虚焊；按板厂口径确认塞孔工艺（通常 Ø≥0.3mm 或指定树脂塞孔，另行计费）');
  }
  const ring=design.viaOuter-design.viaDrill;
  R('过孔','外径−内径（环宽）', ring.toFixed(2)+' mm', '推荐 ≥0.15 / 极限 0.10',
    ring>=0.15-1e-9?'ok':(ring>=JLC.viaRingMin-1e-9?'warn':'fail'));
  {
    let minD=Infinity;
    for(let i=0;i<holes.length;i++)for(let j=i+1;j<holes.length;j++)
      minD=Math.min(minD,Math.hypot(holes[i].x-holes[j].x,holes[i].y-holes[j].y)-holes[i].r-holes[j].r);
    if(isFinite(minD)) R('过孔','孔边到孔边（最小）', Math.max(0,minD).toFixed(2)+' mm', '建议 0.30 / 极限 0.20',
      minD>=0.3-1e-9?'ok':(minD>=JLC.viaEdgeMin-1e-9?'warn':'fail'));
    let minE=Infinity;
    const eD=(x,y)=>Math.min(x,design.width-x,y,design.height-y);
    for(const p of design.pads||[]) minE=Math.min(minE,padBoardEdgeGap(design,p));
    for(const h of holes) if(h.hasVia) minE=Math.min(minE,eD(h.x,h.y)-design.viaOuter/2);
    for(const n of result?.nets||[]) for(const path of n.paths||[]) for(const pt of path)
      minE=Math.min(minE,eD(pt.x,pt.y)-netW(design,n.netId)/2);
    if(isFinite(minE)) R('板边','走线/焊盘/过孔距板边（最近）', Math.max(0,minE).toFixed(2)+' mm',
      '建议 0.3~0.5 / 极限 0.20', minE>=0.3-1e-9?'ok':(minE>=JLC.boardEdgeMin-1e-9?'warn':'fail'));
  }
  // 逐网载流声明校验（第十一轮后 L47）：nets[].current 声明 → 独立行判定
  for(const dc of netCurrentDecls(design)){
    const st = dc.w+1e-9>=dc.required?'ok':(dc.w+1e-9>=dc.requiredLimit?'warn':'fail');
    R('载流','网 '+dc.name+'：声明 '+dc.current+'A',
      dc.w.toFixed(2)+' mm', '需 '+dc.required.toFixed(2)+'（极限 '+dc.requiredLimit.toFixed(2)+'）',
      st, 'IPC-2152 外层 ΔT10℃'+(dc.vias>1?'；需 ≥'+dc.vias+' 个 0.3mm 过孔并联':''));
    // 过孔载流（批次 2）：0.3mm 过孔保守 1A/孔（JLC.viaAmp）——换层过孔是大电流
    // 路径的载流瓶颈（线宽自动抬宽管不住孔）。实际并联数 = 布线换层孔 + 同网
    // stitching（热过孔阵列计入并联）。布线器不自动加孔（几何约束复杂），报告给调用方。
    if(result&&result.nets&&dc.vias>1){
      const rn=result.nets.find(x=>x.netId===dc.netId);
      const act=(rn?(rn.vias||[]).length:0)
        +(design.stitching||[]).filter(s=>s.netId===dc.netId).length;
      const vNote='需 ≥'+dc.vias+' 孔 '+design.viaDrill+'mm';
      if(act>0) R('载流','网 '+dc.name+'：换层过孔并联', act+' 孔',
        vNote,
        act>=dc.vias?'ok':'warn',
        act>=dc.vias?'并联满足（布线换层孔 + stitching/热过孔阵列；'+design.viaDrill+'mm 孔 ≈'+viaAmpFor(design).toFixed(2)+'A/孔）'
          :'单孔 >'+viaAmpFor(design).toFixed(2)+'A 有过热失效风险——大电流走同层、加大孔径，或用 thermal 命令在换层处补并联孔');
      else R('载流','网 '+dc.name+'：换层过孔并联', '0 孔', vNote, 'ok',
        '同层走线，无过孔载流瓶颈');
    }
  }
  if(result&&result.nets){
    if(design.layers<4){
      const base=(JLC.amp.outer[oz]||JLC.amp.outer['1']).t;
      const maxI=Math.pow(design.trackW/base, 1/1.113);
      R('载流','当前线宽约可载（外层 ΔT10℃）', maxI.toFixed(1)+' A', '1A 建议 0.5mm（'+oz+'oz 外层）',
        maxI>=1?'ok':'warn', '按 I_RMS 计发热；'+design.viaDrill+'mm 过孔 ≈'+viaAmpFor(design).toFixed(2)+'A/孔（0.3mm 锚点 1A 线性折算），大电流多孔并联');
    } else {
      R('载流','内层铜厚常见 0.5oz', '1A 需 ≥1.6mm', '大电流走外层或升 1oz 内层', 'warn');
    }
    R('载流','高频载流（趋肤效应）', 'δ(1GHz)='+skinDepth(1e9).toFixed(3)+' mm', 'AC 电阻≈ρ/(周长×δ)',
      'info', '发热仍按 DC 载流；信号完整性主要看阻抗与端接（工具 skinDepth/acTraceR 可查）');
  }
  // 电压组（0.14.7 批次2 A2 补全）：netClrDecls 消费方——声明 voltage 的网逐行
  // 确认 per-net 间距已按 IPC-2221B 档位（coating → B2/B4）生效。
  for(const dc of netClrDecls(design)){
    R('电压','网 '+dc.name+'：'+dc.voltage+'V',
      dc.clr.toFixed(2)+' mm', '全局 '+dc.globalClr.toFixed(2)+' mm（IPC-2221B '+dc.table+'档）',
      'ok',
      dc.clr>dc.globalClr+1e-9
        ?'per-pad 影响区已按 '+dc.clr.toFixed(2)+'mm 推开异网（布线期生效）+ DRC 逐对 max(两网间距) 复检闭环'
        :'全局间距已覆盖标准需求，无需逐网加宽');
  }
  // 阻抗自动定档（批次 3）：差分对逐组行——目标 Zdiff / 线宽 / 有效耦合间隙 /
  // 可达性。反查不可达时如实 warn（2 层板 90Ω 经典口径不可达是物理事实）。
  {
    const pairsSeen=new Set();
    for(const n of design.nets||[]){
      if(!n.pair||pairsSeen.has(n.pair)) continue;
      pairsSeen.add(n.pair);
      const members=(design.nets||[]).filter(x=>x.pair===n.pair);
      if(members.length!==2) continue;
      const zt=members[0].diffZ>0?members[0].diffZ:90;
      const zi=diffPairZFor(design, netW(design, members[0].id), zt);
      const gEff=pairGapFor(design, members[0]);
      if(gEff==null){
        R('阻抗','差分对 '+n.pair+'：目标 '+zt+'Ω','w='+netW(design,members[0].id).toFixed(2)+' mm',
          '当前叠层不可达（最低 '+zi.zdiffMinAtSmin+'Ω @ S=0.1mm）','warn',
          zi.stackup.note+'——建议 4 层、放宽目标，或用 rules.pairs[].gap 显式给出叠层工具算得的间隙');
      } else {
        const st=zi.ok&&Math.abs(zt-zi.zdiffAt(gEff))<=zt*0.1+1e-9?'ok':'info';
        R('阻抗','差分对 '+n.pair+'：目标 '+zt+'Ω',
          'w='+netW(design,members[0].id).toFixed(2)+' mm / S='+gEff.toFixed(2)+' mm',
          'S 处 Zdiff≈'+zi.zdiffAt(gEff)+'Ω（±10%）', st,
          st==='ok'?'耦合间隙自动定档（奇偶模口径）：显式 gap 或 nets[].diffZ 反查'
            :'±10% 外——间隙按可达性反查，精确控阻须板厂层压结构复算');
      }
    }
  }
  // 热设计（批次 2）：大铜散热盘（≥6mm² 无孔 SMD）下应有散热过孔阵列——垂直
  // 热通道（DPAK/TO-220/QFN 散热盘）兼作大电流并联路径。阵列经 thermal 命令
  // 生成写入 stitching（路由避让/DRC/Gerber 钻孔全链复用缝合孔通道）。
  {
    const netNameOf=id=>{const n=(design.nets||[]).find(x=>x.id===id);return n?n.name:id;};
    const inPad=(x,y,p)=>p.shape==='circle'
      ? Math.hypot(x-p.x,y-p.y)<=p.w/2+1e-6
      : Math.abs(x-p.x)<=p.w/2+1e-6&&Math.abs(y-p.y)<=((p.shape==='circle'?p.w:p.h)/2)+1e-6;
    const curNetIds=new Set(netCurrentDecls(design).map(x=>x.netId));
    for(const p of design.pads||[]){
      const a=p.w*(p.shape==='circle'?p.w:p.h);
      const th=curNetIds.has(p.netId)?3:6;   // 载流声明网的焊盘阈值降为 3mm²——电源散热盘更该打孔（D1）
      if(a<th||(p.holeR||0)>0) continue;
      const same=(result&&result.nets||[]).filter(n=>n.netId===p.netId)
        .reduce((s,n)=>s+(n.vias||[]).filter(v=>inPad(v.x,v.y,p)).length,0)
        +(design.stitching||[]).filter(s=>s.netId===p.netId&&inPad(s.x,s.y,p)).length;
      R('热设计','散热盘 '+p.id+'（'+netNameOf(p.netId)+'）',
        same+' 孔', '建议 ≥9 孔（3×3 阵列 '+design.viaDrill+'mm）',
        same>=9?'ok':'warn',
        same===0?'大铜盘下无过孔：热阻高且换层载流受限——thermal 命令生成过孔阵列'
          :(same<9?'有散热孔但不足 3×3——热阻仍偏高，可加密阵列':''));
    }
  }
  R('人工确认','传输线判据：走线 > Tr·v/6（FR-4 1ns≈24mm）须端接/控阻（nets[].tr 标注后 advise 自动核对）','—','—','info');
  R('人工确认','板边装配净空 ≥2mm：连接器/把手/外壳干涉区；成排元件同向便于焊接','—','—','info');
  R('人工确认','PDN 验证（RTF2 附录2）：裸板平面电容→装电容阻抗曲线→最坏工况纹波；板内留低感测试点（禁热焊盘、≥2处、间距≥1in）','—','—','info');
  R('人工确认','阻焊桥：绿/彩油 ≥0.10，黑白油 ≥0.13，2oz ≥0.20 mm（极限）','—','建议各 +0.05','info');
  R('人工确认','字符：高 ≥1.0 / 粗 ≥0.1 / 离焊盘 ≥0.15 mm','—','建议 1.2 / 0.15 / 0.2','info');
  R('人工确认','拼板：V-CUT 距走线 ≥0.4 mm；工艺边 ≥3（SMT 5）mm；Mark 点距板边 ≥4~5 mm','—','—','info');
  R('人工确认','插件孔：0.64 方针画 1.0 mm 孔，0.5 引脚画 0.8 mm（公差 +0.13/−0.08）','—','—','info');
  R('人工确认','高压间距按 IEC 62368-1 / 60664-1 单独计算（板厂参数不含安规）','—','—','info');
  R('人工确认','阻抗：仅多层板支持，±10%，须用官方层压结构计算；铜厚/阻焊每 +1mil 约使阻抗 −2Ω（Bogatin B.43/44），估算器未含这两项修正', multi?'需要':'两层板不做阻抗控制','—','info');
  return rows;
}

/* ---------- 散热盘过孔阵列（批次 2：热过孔）----------
   DPAK/TO-220/QFN 散热盘下生成 N×M 过孔阵：垂直热通道 + 大电流并联路径。
   输出 [{x,y,netId}] 写入 design.stitching——固定孔/路由避让/DRC/Gerber 钻孔/
   IPC-356 全链复用缝合孔通道，零新增管线。
   几何约束（逐孔校验，不满足跳过并计入 skipped）：
   - 孔心收进 viaOuter/2：整颗过孔盘含在焊盘铜内（异网间距由焊盘既有间距保证）；
   - 距焊盘自身插件孔（holeR>0，TO-220 舌片）≥ holeR+drill/2+viaEdgeMin
     （DRC 孔边距同网不豁免——先滤掉再落盘）；
   - 阵内 pitch ≥ viaOuter+viaEdgeMin（过孔-过孔 DRC 间距）。 */
function thermalViaArray(design, compId, opts){
  opts=opts||{};
  const pads=(design.pads||[]).filter(p=>String(p.id||'').split('-')[0]===compId);
  if(!pads.length) throw new Error('元件 '+compId+' 无焊盘');
  // 散热盘 = 该元件面积最大的焊盘（DPAK 舌片/QFN 底盘远大于信号脚）
  let pad=null,area=-1;
  for(const p of pads){ const a=p.w*(p.shape==='circle'?p.w:p.h); if(a>area){area=a;pad=p;} }
  const drill=design.viaDrill;
  if(opts.drill!=null&&Math.abs(opts.drill-drill)>1e-9)
    throw new Error('drill '+opts.drill+' 与 design.viaDrill '+drill+' 不一致——缝合孔通道按 viaDrill 钻孔，请改 design.viaDrill');
  const pitch=opts.pitch!=null?opts.pitch:1.0;
  const minPitch=design.viaOuter+JLC.viaEdgeMin;
  if(pitch<minPitch-1e-9) throw new Error('pitch '+pitch+' < 孔边距要求 '+minPitch.toFixed(2)+'（viaOuter+viaEdgeMin）');
  const halfW=pad.w/2, halfH=(pad.shape==='circle'?pad.w:pad.h)/2;
  const inset=design.viaOuter/2;            // 孔心收进量
  const cols=opts.cols!=null?opts.cols:Math.max(3,Math.floor((2*(halfW-inset))/pitch)+1);
  const rows=opts.rows!=null?opts.rows:Math.max(3,Math.floor((2*(halfH-inset))/pitch)+1);
  if(!(cols>=1&&rows>=1)) throw new Error('cols/rows 必须 ≥1');
  const cap=opts.maxCount!=null?opts.maxCount:400;
  const vias=[];let skipped=0;
  const x0=pad.x-((cols-1)/2)*pitch, y0=pad.y-((rows-1)/2)*pitch;
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
    const x=+(x0+c*pitch).toFixed(3), y=+(y0+r*pitch).toFixed(3);
    const inPad=pad.shape==='circle'
      ? Math.hypot(x-pad.x,y-pad.y)<=halfW-inset+1e-6
      : Math.abs(x-pad.x)<=halfW-inset+1e-6&&Math.abs(y-pad.y)<=halfH-inset+1e-6;
    const hr=pad.holeR||0;
    const clearHole=hr<=0||Math.hypot(x-pad.x,y-pad.y)>=hr+drill/2+JLC.viaEdgeMin-1e-9;
    if(!inPad||!clearHole||vias.length>=cap){skipped++;continue;}
    vias.push({x,y,netId:pad.netId});
  }
  return {comp:compId,pad:pad.id,netId:pad.netId,drill,pitch,cols,rows,
    added:vias.length,skipped,vias};
}

/* ---------- 覆铜缝合孔自动规划：在地铜皮上按间距打地孔 ----------
   缝合孔 = {x,y,netId}，属于覆铜网络，由铜皮提供电气连接，
   不参与自动布线；放置时自动避让其它网络导体与禁布区/板边。 */
function planStitching(design, result, pour, spacing){
  spacing=Math.max(1.5, spacing||5);
  if(!pour || !pour.polys || !pour.polys.length || pour.netId==null) return [];
  const model=buildModel(design);
  const {GW,GH,NC}=model, g=design.grid;
  const netId=pour.netId;
  const ni=model.netIdx.get(netId);
  if(ni==null) return [];
  const segs=[], vias=[];
  if(result&&result.nets) for(const n of result.nets){
    if(n.netId===netId) continue;
    for(const path of n.paths) for(let k=1;k<path.length;k++){
      const a=path[k-1], b=path[k];
      if(a.l===b.l && (Math.abs(a.x-b.x)>1e-9||Math.abs(a.y-b.y)>1e-9))
        segs.push({x1:a.x,y1:a.y,x2:b.x,y2:b.y,l:a.l,
          bx:[Math.min(a.x,b.x),Math.min(a.y,b.y),Math.max(a.x,b.x),Math.max(a.y,b.y)]});
    }
    for(const v of n.vias) vias.push({x:v.x,y:v.y});
  }
  const pads=(design.pads||[]).filter(p=>!(p.netId!=null&&p.netId===netId));
  const vo=design.viaOuter/2, clr=design.clearance, tw=design.trackW;
  const pts=[];
  const ok=(x,y)=>{
    if(x<vo+0.2 || y<vo+0.2 || x>design.width-vo-0.2 || y>design.height-vo-0.2) return false;
    const i=Math.max(0,Math.min(GW-1,Math.floor(x/g-0.5)));
    const j=Math.max(0,Math.min(GH-1,Math.floor(y/g-0.5)));
    for(let l=0;l<(design.layers||2);l++) if(model.blocked[l*NC+j*GW+i]) return false;
    for(const p of pads)
      if(distToRect(x,y,p.x,p.y,p.w,p.shape==='circle'?p.w:p.h)<vo+clr-1e-9) return false;
    // 同网通孔焊盘的孔边距（DRC 孔边距同网不豁免——铺铜缝合孔也要同口径，第六轮口径统一）
    for(const p of (design.pads||[])){
      const hr=p.holeR||0;
      if(hr<=0) continue;
      if(p.netId!=null&&p.netId===netId&&Math.hypot(x-p.x,y-p.y)<hr+design.viaDrill/2+JLC.viaEdgeMin-1e-9) return false;
    }
    for(const v of vias)
      if(Math.hypot(x-v.x,y-v.y)<design.viaOuter+clr-1e-9) return false;
    for(const s of segs){
      if(s.bx[2]<x-vo-clr-tw/2||s.bx[0]>x+vo+clr+tw/2||s.bx[3]<y-vo-clr-tw/2||s.bx[1]>y+vo+clr+tw/2) continue;
      if(segDist(x,y,s.x1,s.y1,s.x2,s.y2)<vo+clr+tw/2-1e-9) return false;
    }
    for(const q of pts)
      if(Math.hypot(x-q.x,y-q.y)<design.viaOuter+clr-1e-9) return false;
    return true;
  };
  // 网格铜：候选点吸附到最近的条纹交点（k·P+gridW/2）——否则落空档的候选被静默
  // 丢弃，缝合覆盖率掉一半以上（50×40 板实测 45 vs 80）。吸附后去重。
  const gridSnap=pour&&pour.fill==='grid'&&pour.gridW&&pour.gridGap;
  const P=gridSnap?pour.gridW+pour.gridGap:0, GW2=gridSnap?pour.gridW/2:0;
  const seen=new Set();
  for(let y=spacing/2; y<design.height; y+=spacing)
    for(let x=spacing/2; x<design.width; x+=spacing){
      let cx=x, cy=y;
      if(gridSnap){
        cx=Math.round(x/P)*P+GW2; cy=Math.round(y/P)*P+GW2;
        if(cx<0||cy<0||cx>design.width||cy>design.height) continue;
        const key=Math.round(cx*100)+'_'+Math.round(cy*100);
        if(seen.has(key)) continue;
        seen.add(key);
      }
      if(inPour(pour,cx,cy) && ok(cx,cy)) pts.push({x:Math.round(cx*100)/100, y:Math.round(cy*100)/100, netId});
    }
  return pts;
}
function inPour(pour, x, y){
  return pourContains(pour, x, y);
}

// ==== ROUTER CORE END ====

/* ============================================================
   形状布线（阶段三 #12）：压缩坐标（非均匀）迷宫布线器

   问题：统一栅格把「障碍 + 间距」量化到格心采样——0.4mm 节距 QFN 在 0.5/0.2mm
   栅格下通道被压成 0~1 条（第五/六/十一轮实测）。Freerouting 的解法是 room-gate
   图（凸多边形代数，TileShape+IntBox/IntOctagon ≥1.5k LOC）；本实现主张**量化
   才是根因**：保持 A* 迷宫范式，只把搜索空间从均匀栅格换成**压缩坐标**——所有
   障碍边界 ± 需求间距构成非均匀坐标轴，通道宽度由真实几何决定而非栅格步长。

   这是可证伪假设（M3 度量）：0.4mm QFN 经形状补线后 DRC 全绿 ⇒ room-gate 对 M3
   非必需；不达成 ⇒ 以数据把 room-gate 立为 #12b。结论见
   docs/深度优化报告-阶段三.md。

   合法性契约：逐边精确几何判定（复用 segmentRectDistance/segmentPadDistance/
   segSegDist/segDist），口径与 checkDRC 同源（clearance 比较、per-net 线宽、
   viaOuter/viaDrill/JLC 孔边距/板边）——故「形状布线接受 ⇒ DRC 无间距 error」。
   同网障碍不阻挡（可与本网铜贴合、进入本网焊盘）。
   ============================================================ */
// ==== SHAPE CORE START ====
/* 内部整数单位 1e-4 mm（0.1µm）——对齐 KiCad 内部单位量级。坐标轴先量化再参与
   搜索，输出即精确量化值（无浮点往返漂移，resultHash/DRC 可复算）。 */
const SHP_SCALE=10000;
const SHP_EPS_U=1;             // 1 unit=0.1µm 安全余量（远低于制造公差，保证「≥间距」严格成立）
const SHP_NODE_CAP=400000;     // 单图节点上限（Nx×Ny×L）；超出走坐标降级，仍超则放弃

function shpU(mm){ return Math.round(mm*SHP_SCALE); }
function shpMm(u){ return u/SHP_SCALE; }

/* ---------------- 障碍收集 ----------------
   只收「铜」与「物理孔」，语义与 checkDRC 逐项对齐：
   · 焊盘（rect/circle，轴对齐——DRC 同样按 w×h 处理）
   · 走线段 + 半宽（result.nets 与 design.manual 合并，per-net 线宽）
   · 过孔/缝合孔：圆盘（阶段三 #15 再扩展 span；当前全层贯穿）
   · 禁布区（矩形；走线铜皮不得进入 ⇒ 中心线距 ≥ 半宽）
   物理孔单列：孔边距与网络无关（DRC 4911-4917 同口径，同网不豁免）。
   `skipNet` 的铜全部不收——同网铜不阻挡自己。 */
function shpCollectObstacles(design, extraNets, skipNet){
  const L=Math.max(1,design.layers|0), layersAll=Array.from({length:L},(_,i)=>i);
  const viaR=design.viaOuter/2, drillR=design.viaDrill/2;
  const skip=skipNet!=null;
  const copper=[], holes=[], keepouts=[];
  for(const p of design.pads||[]){
    if(skip && p.netId===skipNet) continue;
    const circle=p.shape==='circle';
    copper.push({kind:circle?'circle':'rect', x:p.x, y:p.y,
      w:circle?2*p.w:p.w, h:circle?2*p.w:p.h, net:p.netId,
      layers:p.layer==='top'?[0]:p.layer==='bottom'?[L-1]:layersAll});
    if(p.holeR>0) holes.push({x:p.x,y:p.y,r:p.holeR});
  }
  const addTraces=list=>{
    for(const n of list||[]){
      if(skip && n.netId===skipNet) continue;
      for(const path of n.paths||[]){
        const hw=netW(design,n.netId)/2;
        for(let i=1;i<path.length;i++){
          const a=path[i-1], b=path[i];
          if(a.l!==b.l) continue;                       // 换层点不是同层段
          if(Math.abs(a.x-b.x)<1e-12 && Math.abs(a.y-b.y)<1e-12) continue;
          copper.push({kind:'seg',ax:a.x,ay:a.y,bx:b.x,by:b.y,hw,net:n.netId,layers:[a.l]});
        }
      }
      for(const v of n.vias||[]){
        copper.push({kind:'circle',x:v.x,y:v.y,w:2*viaR,h:2*viaR,net:n.netId,layers:layersAll});
        holes.push({x:v.x,y:v.y,r:drillR});
      }
    }
  };
  addTraces(extraNets);
  addTraces(manualRouteEntries(design));
  for(const v of design.stitching||[]){
    if(skip && v.netId===skipNet) continue;
    copper.push({kind:'circle',x:v.x,y:v.y,w:2*viaR,h:2*viaR,net:v.netId,layers:layersAll});
    holes.push({x:v.x,y:v.y,r:drillR});
  }
  for(const k of design.keepouts||[])
    keepouts.push({x:k.x,y:k.y,w:k.w,h:k.h,scope:k.scope||null,
      // 区域通道属主（0.13.12）：only=['网名'...] ⇒ 该区域**只允许**这些网
      // 穿行，其余网视作硬障碍。用途：BGA 阵列这类逃逸瓶颈区，把通道留给
      // 需要逃逸的信号网，禁止大网（GND/V33）在阵列内穿行抢通道。
      // 与 scope（class keepout：对异类阻挡、本类自由）语义不同，故独立字段。
      only:Array.isArray(k.only)?k.only.slice():null});
  return {copper,holes,keepouts,L,viaR,drillR};
}

/* keepout 对某网是否构成障碍（统一口径，0.13.12）：
   · scope（class keepout）：异类网是障碍、本类网自由
   · only（区域通道属主）：不在白名单的网是障碍、白名单内自由
   两者可并存（先 scope 再 only），任一判定为障碍即阻挡。 */
const _netNameMaps=new WeakMap();
function netNameOf(design, netId){
  let m=_netNameMaps.get(design);
  if(!m){ m=new Map(); for(const n of design.nets||[]) m.set(n.id,n.name); _netNameMaps.set(design,m); }
  return m.has(netId)?m.get(netId):null;
}
function shpKeepoutBlocks(k, cls, netName){
  if(k.scope && cls && k.scope===cls) return false;       // 本类自由
  if(k.only && k.only.length){
    if(netName==null) return true;                        // 无网名 ⇒ 保守阻挡
    return k.only.indexOf(netName)<0;
  }
  return false;
}

// 线段到障碍铜的边距（负=相交）；口径同 DRC trace-pad / trace-trace
function shpSegGap(o,a,b){
  return o.kind==='seg' ? segSegDist(a.x,a.y,b.x,b.y,o.ax,o.ay,o.bx,o.by)-o.hw
                        : segmentPadDistance(a,b,o);
}
// 点到障碍铜的边距；口径同 DRC via-pad / via-trace
function shpPointGap(o,x,y){
  return o.kind==='seg' ? segDist(x,y,o.ax,o.ay,o.bx,o.by)-o.hw
                        : pointPadDistance(x,y,o);
}
function shpObsBox(o){
  if(o.kind==='seg'){
    return {x0:Math.min(o.ax,o.bx)-o.hw, x1:Math.max(o.ax,o.bx)+o.hw,
            y0:Math.min(o.ay,o.by)-o.hw, y1:Math.max(o.ay,o.by)+o.hw};
  }
  return {x0:o.x-o.w/2, x1:o.x+o.w/2, y0:o.y-o.h/2, y1:o.y+o.h/2};
}

/* ---------------- 坐标轴 ----------------
   每个障碍在轴上贡献「包围盒边界 ± (需求半径 + ε)」——这既是"贴着间距极限走"的
   中心线位置，也保证轴在障碍附近被细化（这是下面的完备性论证依赖的不变式）。
   再补障碍中心与本网焊盘中心（源/汇可达），最后按需插入相邻中点（走廊正中）。
   分级降级直到节点数进预算。 */
function shpBuildAxes(design, netPads, wHalf, win, OBS, cls, netId){
  const R=design.clearance+wHalf;
  const eps=SHP_EPS_U/SHP_SCALE;
  const ux0=shpU(win.x0), ux1=shpU(win.x1), uy0=shpU(win.y0), uy1=shpU(win.y1);
  const xsB=new Set(), ysB=new Set(), xsC=new Set(), ysC=new Set();
  const add=(set,mm,lo,hi)=>{ const u=shpU(mm); if(u>=lo&&u<=hi) set.add(u); };
  const addX=(set,mm)=>add(set,mm,ux0,ux1), addY=(set,mm)=>add(set,mm,uy0,uy1);
  addX(xsB,win.x0); addX(xsB,win.x1); addY(ysB,win.y0); addY(ysB,win.y1);
  // 本网焊盘必须在轴上有节点：中心 + 内缩边界（小焊盘只有中心点会因
  // 相邻坐标中点抽稀而落到铜外，实测 U5-3/U5-4 节点数为 0）。
  // 取焊盘铜范围的四分点位（保证总有一个真落在铜内，0.25/0.5/0.75）。
  for(const p of netPads){
    const hw=p.w/2, hh=(p.shape==='circle'?p.w:p.h)/2;
    addX(xsC,p.x); addY(ysC,p.y);
    if(hw>0.05){ addX(xsC,p.x-hw*0.5); addX(xsC,p.x+hw*0.5); }
    if(hh>0.05){ addY(ysC,p.y-hh*0.5); addY(ysC,p.y+hh*0.5); }
  }
  for(const o of OBS.copper){
    const b=shpObsBox(o);
    if(b.x1+R<win.x0||b.x0-R>win.x1||b.y1+R<win.y0||b.y0-R>win.y1) continue;
    addX(xsB,b.x0-R-eps); addX(xsB,b.x1+R+eps);
    addY(ysB,b.y0-R-eps); addY(ysB,b.y1+R+eps);
    addX(xsC,(b.x0+b.x1)/2); addY(ysC,(b.y0+b.y1)/2);
  }
  for(const k of OBS.keepouts){
    if(!shpKeepoutBlocks(k,cls,netNameOf(design,netId))) continue;
    const b=shpObsBox(k);
    if(b.x1+wHalf<win.x0||b.x0-wHalf>win.x1||b.y1+wHalf<win.y0||b.y0-wHalf>win.y1) continue;
    addX(xsB,b.x0-wHalf-eps); addX(xsB,b.x1+wHalf+eps);
    addY(ysB,b.y0-wHalf-eps); addY(ysB,b.y1+wHalf+eps);
  }
  const mid=a=>{ const out=new Set(a);
    for(let i=0;i<a.length-1;i++) out.add(Math.round((a[i]+a[i+1])/2)|0);
    return [...out].sort((p,q)=>p-q); };
  const merge=(...as)=>{ const s=new Set(); for(const a of as) for(const v of a) s.add(v);
    return [...s].sort((p,q)=>p-q); };
  // 降级阶梯（节点数= Nx·Ny·L 进预算）：
  //  ① 边界+中心+中点  ② 边界+中心  ③ 仅边界
  //  ④⑤⑥ 同前三级但 x/y 轴各抽稀一半（跨板长网 bbox 覆盖大半板时的最后手段）
  // 抽稀只删非本网焊盘所在的坐标，焊盘中心永远保留——否则源/汇节点消失。
  const Bx=merge(xsB), By=merge(ysB), Cx=merge(xsC), Cy=merge(ysC);
  const keepSet=new Set([...Cx,...Cy]);   // Cx/Cy 已含本网焊盘全部相关坐标
  const isKeep=v=>keepSet.has(v);         // 深优 2026-11-14：启用死代码 keepSet，替换 O(n) indexOf
  const thin=(arr)=>{ let k=0; return arr.filter(v=>isKeep(v)||((k++%2)===0)); };
  const cands=[
    {xs:mid(merge(Bx,Cx)), ys:mid(merge(By,Cy))},
    {xs:merge(Bx,Cx),      ys:merge(By,Cy)},
    {xs:Bx,                ys:By}
  ];
  for(const t of cands){
    if(!t.xs.length||!t.ys.length) continue;
    if(t.xs.length*t.ys.length*OBS.L<=SHP_NODE_CAP) return t;
  }
  for(const t of cands){
    const tx=thin(t.xs), ty=thin(t.ys);
    if(!tx.length||!ty.length) continue;
    if(tx.length*ty.length*OBS.L<=SHP_NODE_CAP) return {xs:tx,ys:ty};
  }
  // 仍超预算：只保留本网焊盘所在行列 + 窗口四边（最短路径只需这些的并集时才会
  // 成功；失败也是诚实结果，不伪造）
  const xs2=[...new Set([...Cx, shpU(win.x0), shpU(win.x1)])].sort((a,b)=>a-b);
  const ys2=[...new Set([...Cy, shpU(win.y0), shpU(win.y1)])].sort((a,b)=>a-b);
  if(xs2.length*ys2.length*OBS.L<=SHP_NODE_CAP) return {xs:xs2,ys:ys2};
  return null;
}

/* ---------------- 压缩图 ----------------
   边 = 相邻坐标间的直线段（跨度可变——压缩网格的"大步"正是优势）；
   过孔 = 同 (x,y) 的层间边（当前全层贯穿）。
   合法性用「障碍驱动标记」：轴在障碍边界 ±R 处细化，故任何与膨胀障碍相交的边
   必有一端落在 bbox±R 内 → 只测该范围内的边即完备（比逐边查询快一个量级）。

   soft 模式（#12b 协商）：硬障碍（焊盘铜/异网走线）不再删除边，而是按
   违规深度记惩罚（pen 单位=毫米等效长度，penScale 折算为代价）。走线可以
   "借道"已占用区域——协商语义与栅格引擎的 PathFinder enterOK 一致：
   硬阶段禁入，软阶段付代价可过。接受方（routeBoardShape）用 auditGeometry
   数真实违规，字典序里违规增加即拒绝——绝不把净违规写进结果。
   禁布区与板边在 soft 模式仍为**硬墙**（工艺边界不可协商）。 */
function shpBuildGraph(design, netPads, netId, wHalf, win, OBS, cls, soft, crossHist, histScale){
  const L=OBS.L, R=design.clearance+wHalf;
  const axes=shpBuildAxes(design,netPads,wHalf,win,OBS,cls,netId);
  if(!axes) return null;
  const xs=axes.xs.map(shpMm), ys=axes.ys.map(shpMm);
  const Nx=xs.length, Ny=ys.length, NN=Nx*Ny, LNN=NN*L;
  const hok=new Uint8Array(LNN), vok=new Uint8Array(LNN), viaOk=new Uint8Array(NN);
  const penH=soft?new Float32Array(LNN):null, penV=soft?new Float32Array(LNN):null,
        penVia=soft?new Float32Array(NN):null;
  for(let l=0;l<L;l++){ const off=l*NN;
    for(let j=0;j<Ny;j++)for(let i=0;i<Nx;i++){
      const c=j*Nx+i;
      if(i+1<Nx) hok[off+c]=1;
      if(j+1<Ny) vok[off+c]=1;
    }
  }
  viaOk.fill(1);
  // 轴区间 → 与之重叠的**边**下标区间（不是坐标下标区间）。
  // 关键：轴在障碍 bbox±R∓ε 处细化，跨界边的两端都比 [bbox±R] 更外一点——
  // 若按坐标下标取范围会漏掉这些边，而它们正是穿过膨胀区的那批
  //（契约「布线合法 ⊆ DRC 合法」的直接破坏点）。故按几何重叠判定。
  const edgeH=(a,b)=>{ const out=[];
    for(let i=0;i<Nx-1;i++) if(xs[i]<b-1e-12 && xs[i+1]>a+1e-12) out.push(i);
    return out; };
  const edgeV=(a,b)=>{ const out=[];
    for(let j=0;j<Ny-1;j++) if(ys[j]<b-1e-12 && ys[j+1]>a+1e-12) out.push(j);
    return out; };
  const rowsIn=(a,b)=>{ const out=[];
    for(let j=0;j<Ny;j++) if(ys[j]>=a-1e-9 && ys[j]<=b+1e-9) out.push(j);
    return out; };
  const colsIn=(a,b)=>{ const out=[];
    for(let i=0;i<Nx;i++) if(xs[i]>=a-1e-9 && xs[i]<=b+1e-9) out.push(i);
    return out; };
  const killEdges=(gap, ox0,ox1, oy0,oy1, layers)=>{
    const cols=edgeH(ox0,ox1), rows=edgeV(oy0,oy1);
    const hs=rowsIn(oy0,oy1), vs=colsIn(ox0,ox1);
    if(!cols.length&&!rows.length) return;
    for(const l of layers){
      const off=l*NN;
      for(const j of hs) for(const i of cols){
        const c=off+j*Nx+i;
        if(!hok[c]&&!soft) continue;
        const g=gap({x:xs[i],y:ys[j]},{x:xs[i+1],y:ys[j]});
        if(g>=R-1e-9) continue;
        // soft 红线（0.13.7）：g<=0 是真重叠（短路），任何模式硬拒——
        // 与过孔同口径（0.13.6 定案）。软协商只允许擦边（0<g<R）。
        if(soft && g>1e-9){ const depth=R-g; if(depth>penH[c]) penH[c]=depth; hok[c]=1; }
        else if(!soft || g<=1e-9) hok[c]=0;
      }
      for(const j of rows) for(const i of vs){
        const c=off+j*Nx+i;
        if(!vok[c]&&!soft) continue;
        const g=gap({x:xs[i],y:ys[j]},{x:xs[i],y:ys[j+1]});
        if(g>=R-1e-9) continue;
        if(soft && g>1e-9){ const depth=R-g; if(depth>penV[c]) penV[c]=depth; vok[c]=1; }
        else if(!soft || g<=1e-9) vok[c]=0;
      }
    }
  };
  for(const o of OBS.copper){
    const b=shpObsBox(o);
    killEdges((a,c)=>shpSegGap(o,a,c), b.x0-R,b.x1+R,b.y0-R,b.y1+R, o.layers);
  }
  for(const k of OBS.keepouts){
    if(!shpKeepoutBlocks(k,cls,netNameOf(design,netId))) continue;
    // soft 模式：禁布区仍硬墙（先跑 killEdges 的软逻辑再强行清零）
    killEdges((a,c)=>segmentRectDistance(a,c,k),
      k.x-k.w/2-wHalf,k.x+k.w/2+wHalf,k.y-k.h/2-wHalf,k.y+k.h/2+wHalf,
      Array.from({length:L},(_,i)=>i));
    if(soft){
      const cols=edgeH(k.x-k.w/2-wHalf,k.x+k.w/2+wHalf), rows=edgeV(k.y-k.h/2-wHalf,k.y+k.h/2+wHalf);
      for(const l of Array.from({length:L},(_,i)=>i)){
        const off=l*NN;
        for(const j of rowsIn(k.y-k.h/2-wHalf,k.y+k.h/2+wHalf)) for(const i of cols) hok[off+j*Nx+i]=0;
        for(const j of rows) for(const i of colsIn(k.x-k.w/2-wHalf,k.x+k.w/2+wHalf)) vok[off+j*Nx+i]=0;
      }
    }
    // only（区域通道属主，0.13.12）：白名单外的网**不得进入该区域**
    // ——区域是纯逃逸瓶颈（如 BGA 阵列），通道留给需要逃逸的信号网。
    // 注："允许访问自己焊盘但不穿行"的更细语义在压缩图上需要额外的
    // 焊盘内连通构造，实测收益不抵复杂度（0.13.12 留档），v1 只做整区禁入。
  }
  // 过孔合法性：全层贯穿 ⇒ 任一层异网铜都挡（圆盘口径）；禁布区同样阻挡（保守）。
  // soft 模式：异网铜的 via 侵权记惩罚（penVia=违规深度），仍可放；禁布区/板边/孔边距硬墙。
  {
    const vR=OBS.viaR, lim=design.clearance+vR;
    for(const o of OBS.copper){
      const b=shpObsBox(o);
      const cs=colsIn(b.x0-lim,b.x1+lim), rs=rowsIn(b.y0-lim,b.y1+lim);
      for(const j of rs)for(const i of cs){
        const c=j*Nx+i;
        const g=shpPointGap(o,xs[i],ys[j]);
        if(g>=lim-1e-9) continue;
        // soft 模式的红线：g<=0 是真重叠（短路），任何模式都必须硬拒——
        // 协商允许的是"间距不足的擦边借道"，不是"打穿异网铜"
        //（fable-01 实测：借道过孔打在异网焊盘中心，boardScore 计 5 个 DRC）
        if(soft && g>1e-9){ const depth=lim-g; if(depth>penVia[c]) penVia[c]=depth; }
        else viaOk[c]=0;
      }
    }
    for(const k of OBS.keepouts){
      if(!shpKeepoutBlocks(k,cls,netNameOf(design,netId))) continue;
const cs=colsIn(k.x-k.w/2-vR,k.x+k.w/2+vR), rs=rowsIn(k.y-k.h/2-vR,k.y+k.h/2+vR);
      for(const j of rs)for(const i of cs){
        const c=j*Nx+i;
        if(distToRect(xs[i],ys[j],k.x,k.y,k.w,k.h)<vR-1e-9) viaOk[c]=0;
      }
    }
    // 孔边距（同网不豁免，DRC 4911-4917 同口径）+ 板边——两模式都是硬墙
    const edgeMin=JLC.boardEdgeMin;
    for(let j=0;j<Ny;j++)for(let i=0;i<Nx;i++){
      const c=j*Nx+i;
      if(!viaOk[c]) continue;
      const x=xs[i], y=ys[j];
      if(x-vR<edgeMin-1e-9||x+vR>design.width-edgeMin+1e-9||
         y-vR<edgeMin-1e-9||y+vR>design.height-edgeMin+1e-9){ viaOk[c]=0; continue; }
      for(const h of OBS.holes)
        if(Math.hypot(x-h.x,y-h.y)<h.r+OBS.drillR+JLC.viaEdgeMin-1e-9){ viaOk[c]=0; break; }
    }
  }
  // 焊盘铜内的节点（源/汇）：落在焊盘铜上即属该焊盘所在层
  const padNodes=(p,l)=>{
    const hh=(p.shape==='circle'?p.w:p.h)/2, hw=p.w/2;
    const cs=colsIn(p.x-hw,p.x+hw), rs=rowsIn(p.y-hh,p.y+hh);
    const off=l*NN, out=[];
    for(const j of rs)for(const i of cs)
      if(pointPadDistance(xs[i],ys[j],p)<=1e-9) out.push(off+j*Nx+i);
    return out;
  };
  // 协商历史代价（room-gate v3，0.13.15）：把**已落盘的软借道争议点**折算为
  // 额外深度惩罚——后续网在同点位借道时代价递增，迫使网摊开到未被争夺的
  // 缝隙（PathFinder history cost 的连续空间对应物）。
  // 只对 pen>0 的边加（软边），量级 = 争议次数 × histScale（mm 深度口径）。
  const HS=histScale!=null?histScale:8;   // 每次争议的额外深度（mm 口径）
  if(soft && crossHist && crossHist.size){
    // 深优 2026-11-14：crossHist 键进图前一次性预解析——热路径免逐格 split/字符串转数
    const histParsed=[];
    for(const [key,cnt] of crossHist){
      const parts=key.split('|');
      histParsed.push([+parts[0], +parts[1], +parts[2], cnt]);
    }
    const histAt=(x,y,l)=>{
      let sum=0;
      const xi=Math.round(x*4), yi=Math.round(y*4);   // 0.25mm 量化格
      for(const [hl,hx,hy,cnt] of histParsed){
        if(hl!==l) continue;
        if(Math.abs(hx-xi)<=2 && Math.abs(hy-yi)<=2) sum+=cnt;
      }
      return sum;
    };
    for(let l=0;l<L;l++){ const off=l*NN;
      for(let j=0;j<Ny;j++) for(let i=0;i<Nx;i++){
        const c=off+j*Nx+i;
        if(penH[c]>0) penH[c]+=HS*histAt(xs[i],ys[j],l);
        if(penV[c]>0) penV[c]+=HS*histAt(xs[i],ys[j],l);
      }
    }
    for(let j=0;j<Ny;j++) for(let i=0;i<Nx;i++){
      const c=j*Nx+i;
      if(penVia[c]>0) penVia[c]+=HS*histAt(xs[i],ys[j],0);
    }
  }
  return {Nx,Ny,L,NN,xs,ys,hok,vok,viaOk,penH,penV,penVia,padNodes,wHalf,netId,soft:!!soft};
}

/* ---------------- 压缩图 A* ----------------
   状态 =(节点, 入向)，入向 ∈{左,右,上,下,过孔来}，用于拐弯罚。
   代价 = 线段长度 + 拐弯罚 + 过孔代价；启发式 = 到目标包围盒的曼哈顿下界
   （忽略过孔与非负拐弯罚 ⇒ 可采纳，故最优）。 */
// 深优 2026-11-14：shpAstar 会话级缓冲复用（同 SN 直接复用五套类型化数组，逐位一致——
// 每次调用照常 fill 重置语义状态，只省分配与 GC；栅格侧 astar 同款做法 :893-951）
let _shpAstBuf=null;
function shpAstBuffers(SN,LNN){
  if(_shpAstBuf&&_shpAstBuf.SN===SN) return _shpAstBuf;
  const b={SN,
    gv:new Float64Array(SN), par:new Int32Array(SN), closed:new Uint8Array(SN),
    dstSet:new Uint8Array(LNN), hc:new Float64Array(Math.max(64,SN>>2)), hs:new Int32Array(Math.max(64,SN>>2))};
  _shpAstBuf=b;
  return b;
}
function shpAstar(G, srcNodes, dstNodes, opts){
  opts=opts||{};
  const {Nx,Ny,L,NN,xs,ys,hok,vok,viaOk,penH,penV,penVia}=G;
  const viaCost=opts.viaCost!=null?opts.viaCost:15;
  const turnPen=opts.turnPen!=null?opts.turnPen:0.3;
  // 软障碍协商（#12b）：惩罚深度（mm）× penScale 折算为等效长度代价。
  // 缺省 40 = 1mm 侵权深度 ≈ 40mm 绕行——强烈偏好绕行，只在不绕行走不通时借道。
  const penScale=opts.penScale!=null?opts.penScale:40;
  const D=5, SN=L*NN*D;
  if(srcNodes.length){ let dx0=Infinity,dx1=-Infinity,dy0=Infinity,dy1=-Infinity;
    for(const n of dstNodes){
      const x=xs[n%Nx], y=ys[((n%NN)/Nx)|0];
      if(x<dx0)dx0=x; if(x>dx1)dx1=x; if(y<dy0)dy0=y; if(y>dy1)dy1=y;
    }
    if(!(dx0<=dx1)) return null;
    var NH=n=>{ const x=xs[n%Nx], y=ys[((n%NN)/Nx)|0];
      return (x<dx0?dx0-x:x>dx1?x-dx1:0)+(y<dy0?dy0-y:y>dy1?y-dy1:0); };
  } else return null;
  const B=shpAstBuffers(SN,L*NN);
  const gv=B.gv, par=B.par, closed=B.closed, dstSet=B.dstSet;
  gv.fill(Infinity); par.fill(-1); closed.fill(0); dstSet.fill(0);
  // 可增长二叉堆：同一状态可多次入堆（惰性删除），堆深 ≠ 状态数——
  // 定长数组会静默丢弃越界写入（类型化数组 OOB 写=无操作），进而破坏堆序，
  // 表现为找到的路径远劣于最优（压缩图单元实测抓出）。
  let hc=B.hc, hs=B.hs, hn=0;   // 堆内容无需清零：hn=0 即空堆（惰性删除语义不变）
  const hgrow=()=>{
    const nc=new Float64Array(hc.length*2), ns2=new Int32Array(hc.length*2);
    nc.set(hc); ns2.set(hs); hc=nc; hs=ns2;
  };
  const push=(cost,st)=>{
    if(hn>=hc.length) hgrow();
    let i=hn++;
    while(i>0){ const p=(i-1)>>1; if(hc[p]<=cost) break; hc[i]=hc[p]; hs[i]=hs[p]; i=p; }
    hc[i]=cost; hs[i]=st;
  };
  const pop=()=>{
    const top=hs[0], lc=hc[--hn], ls=hs[hn];
    // 空位下滤：孩子之间比较取小，不能拿已弹出的旧根值当基准
    //（定长数组 OOB 写与堆序破坏是本模块实测抓出的两个 A* 最优性失效点）
    if(hn>0){ let i=0;
      for(;;){ const l=2*i+1, r=l+1;
        if(l>=hn) break;
        const m=(r<hn&&hc[r]<hc[l])?r:l;
        hc[i]=hc[m]; hs[i]=hs[m]; i=m; }
      hc[i]=lc; hs[i]=ls; }
    return top;
  };
  for(const n of dstNodes) dstSet[n]=1;
  for(const n of srcNodes){ const st=n*D+4; if(closed[st]) continue;
    gv[st]=0; push(NH(n),st); }
  const DX=[-1,1,0,0], DY=[0,0,-1,1];
  let found=-1;
  while(hn>0){
    const s=pop();
    if(closed[s]) continue;
    closed[s]=1;
    const n=(s/D)|0, dir=s%D;
    if(dstSet[n]){ found=s; break; }
    const i=n%Nx, j=((n%NN)/Nx)|0, l=(n/NN)|0, c=n%NN;
    const x=xs[i], y=ys[j];
    for(let d=0;d<4;d++){
      const ni=i+DX[d], nj=j+DY[d];
      if(ni<0||nj<0||ni>=Nx||nj>=Ny) continue;
      const eIdx = d===0 ? (i>0 ? l*NN+j*Nx+i-1 : -1)
                 : d===1 ? (i+1<Nx ? l*NN+c : -1)
                 : d===2 ? (j>0 ? l*NN+(j-1)*Nx+i : -1)
                 :         (j+1<Ny ? l*NN+c : -1);
      if(eIdx<0 || !(d<2 ? hok[eIdx] : vok[eIdx])) continue;
      const nn=l*NN+nj*Nx+ni;
      let ec=Math.abs(xs[ni]-x)+Math.abs(ys[nj]-y);
      if(dir!==4 && dir!==d) ec+=turnPen;
      // 软障碍惩罚（按边）：这条边穿进膨胀障碍的深度 × penScale
      if(penH||penV) ec+=penScale*(d<2 ? penH[eIdx] : penV[eIdx]);
      const ns=nn*D+d, ng=gv[s]+ec;
      if(closed[ns]) continue;
      if(ng<gv[ns]-1e-12){ gv[ns]=ng; par[ns]=s; push(ng+NH(nn),ns); }
    }
    if(viaOk[c]){
      const vp=penVia?penScale*penVia[c]:0;
      for(let dl=-1;dl<=1;dl+=2){
        const nl=l+dl;
        if(nl<0||nl>=L) continue;
        const nn=nl*NN+c, ns=nn*D+4, ng=gv[s]+viaCost+vp;
        if(closed[ns]) continue;
        if(ng<gv[ns]-1e-12){ gv[ns]=ng; par[ns]=s; push(ng+NH(nn),ns); }
      }
    }
  }
  if(found<0) return null;
  const raw=[];
  for(let s=found;s>=0;s=par[s]){
    const n=(s/D)|0;
    raw.push({x:xs[n%Nx], y:ys[((n%NN)/Nx)|0], l:(n/NN)|0});
  }
  raw.reverse();
  // 共线合并：压缩网格一条长直段只留两端
  const out=[];
  for(const p of raw){
    const m=out.length;
    if(m>=2 && out[m-1].l===p.l && out[m-2].l===p.l){
      const a=out[m-2], b=out[m-1];
      if(Math.abs((b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x))<1e-9){ out[m-1]=p; continue; }
    }
    out.push(p);
  }
  return out;
}

/* ---------------- 单网布线 ----------------
   Prim 顺序（最近焊盘接入已布铜）——与栅格引擎实测更快的 Prim 主路径同构。
   接树目标是「已布铜的任一节点」，因此天然产生 T 型分支（斯坦纳语义）。
   连通判定与栅格引擎同口径：焊盘铜内存在已被铜覆盖的节点 ⇒ 该焊盘连通。 */
/* 整条路径的精确几何校验（0.13.9）：落盘前的最终防线。
   只查"硬冲突"——走线铜与异网铜重叠（gap<=0，短路），不查间距不足
   （那是软协商允许的擦边，由接受准则裁决）。禁布区/板边同样硬拒。 */
function shpPathClear(design, path, OBS, netId, hw){
  void hw;
  const L=OBS.L;
  for(let k=1;k<path.length;k++){
    const a=path[k-1], b=path[k];
    if(a.l!==b.l) continue;
    for(const o of OBS.copper){
      if(o.net===netId) continue;
      if(o.layers.indexOf(a.l)<0) continue;
      if(shpSegGap(o,a,b)<=1e-9) return false;
    }
    // 禁布区/板边不在此复核：它们在压缩图上已作为硬墙正确表达（killEdges
    // + viaOk），且不属于"短路"级别。此闸门只拦**铜-铜真重叠**——那是唯一
    // 会流出假绿（连通数虚高）的形态（fable-01/03 实测：跨轮残留路径的
    // 段与异网焊盘 gap=0，DRC 按段首命中漏报，连通数虚增）。
  }
  return true;
}

function shpRouteNet(design, net, OBS, win, opts){
  const L=OBS.L, hw=netW(design,net.id)/2;
  const pads=(design.pads||[]).filter(p=>p.netId===net.id);
  if(pads.length<2) return {paths:[],vias:[],connected:pads.length,total:pads.length};
  const G=shpBuildGraph(design,pads,net.id,hw,win,OBS,opts.cls||null,!!opts.soft,opts.crossHist,opts.histScale);
  if(!G) return null;
  const lay=p=>padLayersOfPad(p,L);
  const inTree=new Uint8Array(L*G.NN);
  // 深优 2026-11-14：dst 列表增量维护——原实现每接一个盘全扫 inTree O(L·NN)。
  // 标记点集中改道 markNode：置位时顺手入列。dst 仅喂 dstSet（顺序无关）与
  // shpAstar 的目标 bbox（min/max 归并，顺序无关）——位级一致。
  const dstList=[];
  const markNode=n=>{ if(!inTree[n]){ inTree[n]=1; dstList.push(n); } };
  const markPad=p=>{ for(const l of lay(p)) for(const n of G.padNodes(p,l)) markNode(n); };
  // 起点：焊盘铜节点最多的焊盘（并列取下标最小 → 确定性）
  let root=pads[0], rootN=-1;
  for(const p of pads){
    let cnt=0; for(const l of lay(p)) cnt+=G.padNodes(p,l).length;
    if(cnt>rootN){ rootN=cnt; root=p; }
  }
  if(rootN<=0) return null;
  markPad(root);
  const paths=[], vias=[];
  let viaMarked=0;   // 已回填进树的过孔数（增量处理游标）
  const reached=new Set([root]);
  const order=[root];
  // Prim：每次取与已接入集合最近的未接入焊盘。
  // 软接入（room-gate v1，0.13.7）：硬 A* 失败的盘**不放弃**——改用软 A*
  // （借道记惩罚）接入。诊断 B/E 实测：fable-01 GND 的 4 个"失败"盘每个
  // 都能单独软接入成功（零过孔），失败纯粹是 Prim 顺序——先接入的盘占掉
  // 通道后，后接入的盘在硬模式找不到锚点。这与栅格引擎 PathFinder 的
  // enterOK 软阶段同语义：硬约束布不通就付代价过。
  let softJoins=0;
  // 深优 2026-11-14：Prim 选序 O(p³)→O(p²)——维护各未接盘到树的当前最近距离平方。
  // 每对距离只算一次（算式逐位相同），严格 < 扫描序不变 → 选中序位级一致
  const minD=new Map();
  for(const p of pads) if(p!==root) minD.set(p,(p.x-root.x)**2+(p.y-root.y)**2);
  while(order.length<pads.length){
    let best=null, bd=Infinity;
    for(const p of pads){
      if(reached.has(p)) continue;
      const d=minD.get(p);
      if(d<bd){ bd=d; best=p; }
    }
    if(!best) break;
    const src=[];
    for(const l of lay(best)) for(const n of G.padNodes(best,l)) src.push(n);
    reached.add(best); order.push(best);
    for(const p of pads){
      if(reached.has(p)) continue;
      const d=(p.x-best.x)**2+(p.y-best.y)**2;
      if(d<minD.get(p)) minD.set(p,d);
    }
    if(!src.length) continue;                        // 零格焊盘：如实不可达
    const dst=dstList;
    if(!dst.length) continue;
    let pts=shpAstar(G,src,dst,{viaCost:opts.viaCost,turnPen:opts.turnPen});
    let softJoin=false;
    if(!pts && opts.soft){
      pts=shpAstar(G,src,dst,{viaCost:opts.viaCost,turnPen:opts.turnPen,penScale:opts.penScale});
      softJoin=true;
    }
    if(!pts) continue;                               // 软模式也失败：如实放弃该盘
    if(softJoin) softJoins++;
    // 落盘：换层点复制同坐标两次（DRC/SVG/泪滴按「同坐标不同层」识别过孔）
    const path=[{x:pts[0].x,y:pts[0].y,l:pts[0].l}];
    for(let k=1;k<pts.length;k++){
      const pr=pts[k-1], p=pts[k];
      if(pr.l!==p.l) vias.push({x:p.x,y:p.y});
      else if(Math.abs(pr.x-p.x)<1e-12 && Math.abs(pr.y-p.y)<1e-12) continue;
      path.push({x:p.x,y:p.y,l:p.l});
    }
    // 落盘前的最终几何校验（0.13.9 深度检查）：图边合法 ≠ 整条路径合法。
    // 多轮协商中 merged 里可能残留**上一轮轴**算出的路径，与本轮障碍集
    // 不兼容（fable-01 实测：3V3 的段与 U2-14 重叠 gap=0，端点甚至不在
    // 当前轴上）。这里逐段精确复核：任何 gap≤0 的重叠一律拒绝该段所属
    // 的整条接入，而不是让重叠流进结果等 DRC 兜底（DRC 按段首命中会漏）。
    if(!shpPathClear(design,path,OBS,net.id,hw)){ continue; }
    paths.push(path);
    // 新铜并入树：线段走廊内节点（含端点）+ 该焊盘铜节点 + 过孔全层
    for(let k=1;k<path.length;k++){
      const a=path[k-1], b=path[k];
      if(a.l!==b.l) continue;
      const l=a.l, off=l*G.NN;
      const x0=Math.min(a.x,b.x)-hw, x1=Math.max(a.x,b.x)+hw;
      const y0=Math.min(a.y,b.y)-hw, y1=Math.max(a.y,b.y)+hw;
      for(let j=0;j<G.Ny;j++){
        const y=G.ys[j];
        if(y<y0-1e-9||y>y1+1e-9) continue;
        for(let i=0;i<G.Nx;i++){
          const x=G.xs[i];
          if(x<x0-1e-9||x>x1+1e-9) continue;
          if(segDist(x,y,a.x,a.y,b.x,b.y)<=hw+1e-9) markNode(off+j*G.Nx+i);
        }
      }
    }
    markPad(best);
    // 深优 2026-11-14：过孔回填只处理本轮新增（原实现对迄今全部过孔重扫）——
    // 置位幂等，跳过已标记者不改变 inTree 终态
    for(let vi=viaMarked;vi<vias.length;vi++){
      const v=vias[vi];
      const i=G.xs.findIndex(x=>Math.abs(x-v.x)<1e-9);
      const j=G.ys.findIndex(y=>Math.abs(y-v.y)<1e-9);
      if(i<0||j<0) continue;
      for(let l=0;l<L;l++) markNode(l*G.NN+j*G.Nx+i);
    }
    viaMarked=vias.length;
  }
  // 连通统计：焊盘铜内是否有已覆盖节点（与栅格 countConn 同口径，诚实口径：
  // 多分量时仅计真正接入铜皮的焊盘）
  let conn=0;
  for(const p of pads){
    let ok=false;
    for(const l of lay(p)){ for(const n of G.padNodes(p,l)) if(inTree[n]){ ok=true; break; } if(ok) break; }
    if(ok) conn++;
  }
  return {paths,vias,connected:conn,total:pads.length,softJoins};
}
function padLayersOfPad(p,L){
  return p.layer==='top'?[0]:p.layer==='bottom'?[L-1]:Array.from({length:L},(_,i)=>i);
}
// ==== SHAPE CORE END ====


/* ============================================================
   示例电路（纯数据构造，全部坐标已对齐 0.5mm 栅格）
   ============================================================ */
// ==== EXAMPLES START ====
function padObj(id,netId,x,y,w,h,shape,layer){
  return {id, netId, x, y, w:w||1.2, h:h||w||1.2, shape:shape||'rect', layer:layer||'both'};
}
function EXAMPLES_555(){
  const d=designDefaults();
  d.width=50; d.height=35;
  d.nets=[
    {id:'vcc',name:'VCC'},{id:'gnd',name:'GND'},{id:'trig',name:'TRIG'},
    {id:'dis',name:'DISCH'},{id:'out',name:'OUT'},{id:'led',name:'LED_N'},{id:'ctrl',name:'CTRL'}
  ];
  d.pads=[
    // U1 NE555 DIP-8
    padObj('U1-1','gnd',11.25,13.75), padObj('U1-2','trig',11.25,16.25),
    padObj('U1-3','out',11.25,18.75), padObj('U1-4','vcc',11.25,21.25),
    padObj('U1-5','ctrl',18.75,21.25), padObj('U1-6','trig',18.75,18.75),
    padObj('U1-7','dis',18.75,16.25), padObj('U1-8','vcc',18.75,13.75),
    // R1 VCC-DISCH / R2 DISCH-TRIG
    padObj('R1-1','vcc',6.25,13.75), padObj('R1-2','dis',6.25,16.25),
    padObj('R2-1','dis',6.25,18.75), padObj('R2-2','trig',6.25,21.25),
    // C1 TRIG-GND
    padObj('C1-1','trig',6.25,24.25,1.2,1.2,'circle'), padObj('C1-2','gnd',6.25,26.75,1.2,1.2,'circle'),
    // R3 OUT-LED
    padObj('R3-1','out',23.75,18.75), padObj('R3-2','led',26.25,18.75),
    // D1 LED
    padObj('D1-A','led',30.25,16.25), padObj('D1-K','gnd',30.25,18.75),
    // C2 CTRL-GND
    padObj('C2-1','ctrl',23.75,23.75,1.2,1.2,'circle'), padObj('C2-2','gnd',26.25,23.75,1.2,1.2,'circle'),
    // J1 电源
    padObj('J1-1','vcc',38.75,12.75,1.5,1.5), padObj('J1-2','gnd',38.75,15.25,1.5,1.5)
  ];
  d.keepouts=[{x:44.5,y:28.5,w:5,h:5}];
  return d;
}
function EXAMPLES_LED(){
  const d=designDefaults();
  d.width=48; d.height=28;
  d.nets=[{id:'gnd',name:'GND'}];
  d.pads=[];
  const ys=[7.75,12.75,17.75,22.75];
  ys.forEach((y,i)=>{
    const n=i+1;
    d.nets.push({id:'s'+n,name:'SIG'+n},{id:'m'+n,name:'MID'+n});
    d.pads.push(padObj('J1-'+n,'s'+n,6.25,y,1.5,1.5));
    d.pads.push(padObj('R'+n+'-1','s'+n,17.75,y), padObj('R'+n+'-2','m'+n,20.25,y));
    d.pads.push(padObj('D'+n+'-A','m'+n,25.25,y), padObj('D'+n+'-K','gnd',27.75,y));
    d.pads.push(padObj('GND-'+n,'gnd',32.75,y));
  });
  d.pads.push(padObj('J2-1','gnd',40.25,15.25,1.5,1.5));
  return d;
}
function EXAMPLES_MCU(){
  const d=designDefaults();
  d.width=52; d.height=36;
  d.nets=[
    {id:'vcc',name:'VCC'},{id:'gnd',name:'GND'},{id:'rst',name:'RESET'},
    {id:'x1',name:'XTAL1'},{id:'x2',name:'XTAL2'},
    {id:'pb0',name:'PB0'},{id:'pb1',name:'PB1'},{id:'pb2',name:'PB2'},
    {id:'pb3',name:'PB3'},{id:'pb4',name:'PB4'},{id:'pb5',name:'PB5'}
  ];
  const ys=[15.25,17.75,20.25,22.75,25.25,27.75,30.25];
  d.pads=[];
  // U1 DIP-14：左 1-7 上→下，右 8-14 下→上
  const left=['rst','pb0','pb1','pb2','pb3','gnd','x1'];
  const right={8:'x2',9:'pb4',10:'pb5',11:'gnd',12:'vcc',13:null,14:'vcc'};
  left.forEach((net,i)=>d.pads.push(padObj('U1-'+(i+1),net,16.25,ys[i])));
  for(let pin=8;pin<=14;pin++) d.pads.push(padObj('U1-'+pin,right[pin],26.25,ys[14-pin]));
  // Y1 晶振
  d.pads.push(padObj('Y1-1','x1',7.25,17.75,1.2,1.2,'circle'), padObj('Y1-2','x2',7.25,20.25,1.2,1.2,'circle'));
  // C2/C3 负载电容
  d.pads.push(padObj('C2-1','x1',10.25,17.75,1.2,1.2,'circle'), padObj('C2-2','gnd',10.25,20.25,1.2,1.2,'circle'));
  d.pads.push(padObj('C3-1','x2',10.25,22.75,1.2,1.2,'circle'), padObj('C3-2','gnd',10.25,25.25,1.2,1.2,'circle'));
  // C1 去耦
  d.pads.push(padObj('C1-1','vcc',5.25,12.75,1.2,1.2,'circle'), padObj('C1-2','gnd',5.25,15.25,1.2,1.2,'circle'));
  // R1 复位上拉
  d.pads.push(padObj('R1-1','vcc',5.25,27.75), padObj('R1-2','rst',5.25,30.25));
  // SW1 复位按键
  d.pads.push(padObj('SW1-1','rst',7.25,33.25), padObj('SW1-2','gnd',9.75,33.25));
  // J1 排针 1x8
  const jn=['rst','pb0','pb1','pb2','pb3','pb4','pb5','gnd'];
  jn.forEach((net,i)=>d.pads.push(padObj('J1-'+(i+1),net,40.25,15.25+i*2.5,1.5,1.5)));
  return d;
}
const EXAMPLES=[
  {id:'e555', name:'555 LED 闪烁灯', build:EXAMPLES_555},
  {id:'eled', name:'LED 流水灯 (4路)', build:EXAMPLES_LED},
  {id:'emcu', name:'单片机最小系统 (DIP-14)', build:EXAMPLES_MCU}
];
// ==== EXAMPLES END ====





export { ampWidthFor, netCurrentDecls, thermalViaArray, pairGapFor, viaAmpFor, ipc2221Clr, netClrDecls, netClr, designDefaults, detectBallArrays, fanoutMoveToFront, pairCoupleStats, normalizeDesign, minimumRoutingGrid, assertGridBudget, manualRouteEntries, normalizeResult, distToRect, padOnLayer, pointPadDistance, segmentRectDistance, segmentPadDistance, padGap, snapToGrid, fillDistanceMap, markViaInfluence, buildModel, createSession, parseSexpr, _sxFind, _sxChild, importKiCadPcb, netLowerBound, impedance, widthForZ0, DIELECTRICS, effectiveEr, skinDepth, acTraceR, dielectricLossDbPerIn, pdnPlaneCapPf, pdnEstimate, fdtimPlan, exportIPC356, fknee, criticalLineLen, netRoutedLen, hsCrosstalkScan, autoReturnVias, copperThickUm, viaLoopInductanceNanohenry, traceLoopInductancePh, viaPairLoopInductancePh, planeSquareLoopInductancePh, radialSpreadingInductancePh, betweenViasSpreadingInductancePh, staleResultCheck, powerDrop, footprintPads, exportDSN, importSES, importDSN, exportSES, autoPlace, snapPadsPreserveGroups, computeHotspots, routeScore, scoreBetter, viaSpan, viaOnLayer, viaThrough, viaSpanOverlap, manufacturingHoles, routeBoard, routeBoardShape, auditGeometry, shpCollectObstacles, shpBuildAxes, shpBuildGraph, shpAstar, shpRouteNet, pathLenOf as __pathLen, placeAndRoute, exportEasyEdaPcb, netW, maxTrackW, _eeCanvasOrigin, parseEasyEdaDevice, _eeTransPath, _eeTransShape, _eeGenericSymbol, exportEasyEdaSch, verifyEasyEdaExport, importEasyEdaPcb, importEasyEdaPcbFull, renderBoardPixels, jlcTrackRule, _scopedHit, netClsMap, rmstTasks, checkDRC, segDist, computeRatsnest, buildSVG, segSegDist, mergePathPts, cornerTurnCost, beautifyResult, teardropPolys, serpentineTune, diffPairZ, diffPairZFor, routeBoardParallel, routeBoardIterParallel, _rotRectGap, computePour, roundedPathD, fmt6, buildGerber, gerberFiles, fabChecklist, planStitching, inPour, pourContains, pourNear, padObj, EXAMPLES_555, EXAMPLES_LED, EXAMPLES_MCU, JLC, EXAMPLES };
