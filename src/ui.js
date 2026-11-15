'use strict';
/* ============================================================
   UI：画布编辑器 / 面板 / 布线驱动 / 文件导出
   ============================================================ */
(function(){
  const $=id=>document.getElementById(id);
  const cv=$('cv'), wrap=$('canvasWrap'), ctx=cv.getContext('2d');

  const routingClient=new RoutingWorkerClient();
  const escapeHtml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const NET_COLORS=['#f59e0b','#10b981','#3b82f6','#a78bfa','#f472b6','#fbbf24','#34d399','#60a5fa','#c084fc','#fb7185','#4ade80','#f97316'];
  const app={
    design:null, result:null, ratsCache:[], teardrops:[], pour:null, session:null,
    tool:'select', sel:null, selNet:null, draw:null, drawLayer:0, mseq:1,
    view:{scale:10, ox:0, oy:0},
    show:{top:true, bottom:true, inner1:true, inner2:true, rats:true, grid:true, teardrop:true, refs:true, padNumbers:true, netNames:true, contrast:false, highlight:false},
    dragging:null, routing:false, cancelFlag:false,
    seq:1, netSeq:1, dpr:1, dirty:true
  };

  // ---------------- 撤销 / 重做（设计 + 布线结果快照） ----------------
  // 阶段三 #14：快照必须同时含 result——此前只存 design，applySnapshot 会把
  // app.result 置 null，撤销一次手动操作就丢掉全部自动布线（用户要重跑数分钟）。
  // 现在 result 一并入快照；体积代价由 60 步上限 + 只在有变化时入栈约束。
  const hist={stack:[], idx:-1};
  function updateHistBtns(){
    $('btnUndo').disabled=hist.idx<=0;
    $('btnRedo').disabled=hist.idx>=hist.stack.length-1;
  }
  function pushHistorySnap(snap){
    hist.stack.length=hist.idx+1;
    hist.stack.push(snap);
    if(hist.stack.length>60) hist.stack.shift();
    hist.idx=hist.stack.length-1;
    updateHistBtns();
  }
  function snapshotState(){
    if(!app.design) return null;
    return JSON.stringify({design:app.design, result:app.result||null});
  }
  function pushHistory(){ const s=snapshotState(); if(s) pushHistorySnap(s); }
  function applySnapshot(snap){
    routingClient.dispose(); app.session=null;
    let parsed;
    try{ parsed=JSON.parse(snap); }catch(e){ return; }
    // 兼容旧快照（纯 design）与工程文件
    const d=parsed&&parsed.design?parsed.design:parsed;
    const r=parsed&&parsed.design?(parsed.result||null):null;
    app.design=d; app.result=r; app.sel=null; app.dragging=null;
    syncParamInputs(); sbMsg(); renderNets(); renderProps(); renderStats();
    $('drcList').innerHTML=r
      ? '<div class="d-ok">已撤销/重做（布线结果一并恢复），可重新检查。</div>'
      : '<div class="d-ok">已撤销/重做，重新布线后自动检查。</div>';
    computeDerived();
    if(r&&typeof runDRC==='function') runDRC();
    requestDraw();
    updateHistBtns();
  }
  function undo(){ if(hist.idx>0){ hist.idx--; applySnapshot(hist.stack[hist.idx]); } }
  function redo(){ if(hist.idx<hist.stack.length-1){ hist.idx++; applySnapshot(hist.stack[hist.idx]); } }

  // ---------------- 派生数据（预拉线/泪滴/覆铜） ----------------
  function computeDerived(){
    app.ratsCache=app.design?computeRatsnest(app.design,app.result):[];
    app.teardrops=(app.design&&app.result)?teardropPolys(app.design,app.result):[];
    updatePour();
  }
  function updatePour(){
    const d=app.design;
    if(!$('pourOn').checked || !d){ app.pour=null; requestDraw(); return; }
    const layer=$('pourLayer').value==='top'?0:d.layers-1;
    const netId=$('pourNet').value||null;
    app.pour=computePour(d, app.result, {layer, netId, thermal:$('pourThermal').checked, teardrops:app.teardrops||[]});
    requestDraw();
  }

  // ---------------- 小工具 ----------------
  function toast(msg){
    const t=$('toast'); t.textContent=msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t=setTimeout(()=>t.classList.remove('show'),2400);
  }
  function clampNum(v,a,b){ v=+v; if(!isFinite(v)) return a; return Math.min(b,Math.max(a,v)); }
  function num(v,def){ v=+v; return isFinite(v)?v:def; }
  function netColor(id){
    const i=app.design.nets.findIndex(n=>n.id===id);
    return i<0?'#64748b':NET_COLORS[i%NET_COLORS.length];
  }
  function snapHi(v,max){ // 吸附并限制在板内
    const g=app.design.grid;
    const iMax=Math.max(0, Math.floor(max/g-0.5));
    const x=(Math.round(v/g-0.5)+0.5)*g;
    return Math.min((iMax+0.5)*g, Math.max(0.5*g, x));
  }
  function snapAll(d){
    snapPadsPreserveGroups(d);

    for(const k of d.keepouts){
      const g=d.grid;
      k.w=Math.max(g, Math.round(k.w/g)*g); k.h=Math.max(g, Math.round(k.h/g)*g);
      k.x=clampNum(snapToGrid(k.x,g), k.w/2, d.width-k.w/2);
      k.y=clampNum(snapToGrid(k.y,g), k.h/2, d.height-k.h/2);
    }
  }
  function syncParamInputs(){
    const d=app.design;
    $('dW').value=d.width; $('dH').value=d.height; $('dGrid').value=d.grid;
    $('dTrack').value=d.trackW; $('dClr').value=d.clearance;
    $('dVia').value=d.viaOuter; $('dDrill').value=d.viaDrill; $('dLayers').value=String(d.layers);
    $('dCopper').value=String(d.copperWeight||'1');
    if($('dCopper').selectedIndex<0) $('dCopper').value='1';
  }
  function sbMsg(){ const d=app.design; if(!d) return;
    $('sbMsg').textContent='栅格 '+d.grid+'mm · 线宽 '+d.trackW+'mm · 间距 '+d.clearance+'mm · '+d.layers+' 层';
    syncCanvasUI();
  }
  const TOOL_HINTS={
    select:'选择 V · 单击选择 / 拖动移动 · 空白处拖动平移',
    pan:'平移 H · 拖动画布导航 · 滚轮缩放 · F 适应窗口',
    pad:'焊盘 P · 单击放置到当前网络',
    route:'布线 R · 单击添加转折 · 双击 / Enter 完成 · L 换层 · Esc 取消',
    keepout:'禁布 K · 拖出矩形区域',
    delete:'删除 X · 单击移除焊盘 / 走线 / 禁布区'
  };
  function syncCanvasUI(){
    const d=app.design;
    if(d&&app.drawLayer>=d.layers){app.drawLayer=0;app.draw=null;}
    if(d&&app.draw&&app.draw.l>=d.layers) app.draw=null;
    const layer=app.draw?app.draw.l:app.drawLayer;
    if($('zoomValue')) $('zoomValue').textContent=Math.round(app.view.scale/10*100)+'%';
    if($('boardMeta')&&d) $('boardMeta').textContent=d.width+' × '+d.height+' mm · '+d.layers+' 层 · '+d.pads.length+' 焊盘 · '+d.nets.length+' 网络';
    if($('canvasTitle')) $('canvasTitle').textContent='PCB 设计画布';
    if($('activeLayer')){
      $('activeLayer').value=d?layerKey(layer,d):'top';
      for(const option of $('activeLayer').options){
        option.disabled=!!d&&(option.value==='bottom'?d.layers<2:option.value.startsWith('inner')?d.layers<4:false);
        option.hidden=option.value.startsWith('inner')&&(!d||d.layers<4);
      }
      const dot=document.querySelector('.canvas-context .layer-dot');
      if(dot&&d) dot.style.background=CAD_PALETTE[layerKey(layer,d)];
    }
    document.querySelectorAll('[data-cad-color]').forEach(e=>{e.style.background=CAD_PALETTE[e.dataset.cadColor]||'';});
    for(const id of ['vInner1','vInner2']) if($(id)) $(id).closest('label').hidden=!d||d.layers<4;
    document.querySelectorAll('[data-tool]').forEach(b=>{
      const active=b.dataset.tool===app.tool;
      b.classList.toggle('active',active); b.setAttribute('aria-pressed',String(active));
    });
    document.querySelectorAll('#layerButtons [data-view]').forEach(b=>{
      const active=!!app.show[b.dataset.view];
      if(b.dataset.view.startsWith('inner')) b.hidden=!d||d.layers<4;
      b.classList.toggle('active',active); b.setAttribute('aria-pressed',String(active));
    });
    const hint=TOOL_HINTS[app.tool]||'';
    if($('toolHint')) $('toolHint').textContent=app.draw?hint+' · 当前层 '+(d?layerName(layer,d):'顶层'):hint;
    cv.style.cursor=app.dragging&&app.dragging.type==='pan'?'grabbing':app.tool==='pan'?'grab':app.tool==='select'?'default':'crosshair';
  }
  function setTool(t){
    if(!TOOL_HINTS[t]||app.routing) return;
    app.tool=t;
    if(t!=='route'&&app.draw) app.draw=null;
    $('sbTool').textContent=TOOL_HINTS[t];
    syncCanvasUI(); requestDraw();
  }
  function toggleFocus(){
    const focused=document.body.classList.toggle('canvas-focus');
    if($('focusCanvas')) $('focusCanvas').setAttribute('aria-pressed',String(focused));
    requestAnimationFrame(resize);
  }

  // ---------------- 设计变化 ----------------
  function designChanged(){
    routingClient.dispose();
    app.result=null; app.teardrops=[]; app.session=null;
    computeDerived();
    renderNets(); renderStats(); $('drcList').innerHTML='<div class="d-ok">设计已修改，重新布线后自动检查。</div>';
    requestDraw();
  }
  function loadDesign(d){
    d=normalizeDesign(d);
    routingClient.dispose();

    d.manual=Array.isArray(d.manual)?d.manual:[];
    d.stitching=Array.isArray(d.stitching)?d.stitching:[];
    d.copperWeight=String(d.copperWeight||'1');
    app.design=d; app.result=null; app.ratsCache=[]; app.sel=null; app.dragging=null;
    app.session=null; app.draw=null; app.mseq=1;
    if(app.drawLayer>=d.layers) app.drawLayer=0;
    app.seq=1; app.netSeq=1;
    for(const p of d.pads){ const m=/(\d+)$/.exec(p.id); if(m) app.seq=Math.max(app.seq,+m[1]+1); }
    for(const n of d.nets){ const m=/(\d+)$/.exec(n.id); if(m) app.netSeq=Math.max(app.netSeq,+m[1]+1); }
    app.selNet=d.nets.length?d.nets[0].id:null;
    syncParamInputs(); sbMsg();
    fitView(); renderNets(); renderProps(); renderStats();
    computeDerived();
    pushHistory();
    requestDraw();
  }

  // ---------------- 画布尺寸与视图 ----------------
  // CSS 像素决定视图，设备像素仅决定 backing store，避免高 DPI 下坐标偏移。
  cv.style.width='100%'; cv.style.height='100%';
  function resize(){ ensureCanvasSize(); requestDraw(); }
  window.addEventListener('resize',resize);
  if(typeof ResizeObserver!=='undefined'){
    const canvasObserver=new ResizeObserver(resize);
    canvasObserver.observe(wrap);
  }
  function ensureCanvasSize(){
    const r=cv.getBoundingClientRect();
    const dpr=Math.max(1,window.devicePixelRatio||1);
    const w=Math.max(1,Math.round(r.width*dpr)), h=Math.max(1,Math.round(r.height*dpr));
    if(cv.width!==w || cv.height!==h || app.dpr!==dpr){ app.dpr=dpr; cv.width=w; cv.height=h; requestDraw(); }
  }
  function canvasArea(){
    const r=cv.getBoundingClientRect();
    return {width:r.width,height:r.height,left:100,top:84,right:48,bottom:104};
  }
  function fitView(){
    const r=canvasArea(), d=app.design; if(!d||r.width<80||r.height<80) return;
    const s=Math.min(Math.max(20,r.width-r.left-r.right)/d.width,Math.max(20,r.height-r.top-r.bottom)/d.height);
    app.view.scale=clampNum(s,0.1,150);
    app.view.ox=r.left+(r.width-r.left-r.right-d.width*app.view.scale)/2;
    app.view.oy=r.top+(r.height-r.top-r.bottom-d.height*app.view.scale)/2;
    syncCanvasUI(); requestDraw();
  }
  function zoomAt(scale,x,y){
    const r=canvasArea();
    if(x==null) x=r.left+(r.width-r.left-r.right)/2;
    if(y==null) y=r.top+(r.height-r.top-r.bottom)/2;
    const ns=clampNum(scale,0.1,150), k=ns/app.view.scale;
    app.view.ox=x-(x-app.view.ox)*k;
    app.view.oy=y-(y-app.view.oy)*k;
    app.view.scale=ns;
    syncCanvasUI(); requestDraw();
  }
  function toMM(cx,cy){
    const r=cv.getBoundingClientRect();
    return {x:(cx-r.left-app.view.ox)/app.view.scale, y:(cy-r.top-app.view.oy)/app.view.scale};
  }
  function requestDraw(){ app.dirty=true; }
  (function loop(){ ensureCanvasSize(); if(app.dirty){ app.dirty=false; draw(); } requestAnimationFrame(loop); })();
  setInterval(()=>{ ensureCanvasSize(); if(app.dirty){ app.dirty=false; draw(); } }, 150);   // 后台标签页 rAF 暂停时兜底

  // ---------------- 绘制 ----------------
  function draw(){
    const d=app.design; if(!d) return;
    ctx.setTransform(1,0,0,1,0,0);
    ctx.fillStyle=CAD_PALETTE.desktop; ctx.fillRect(0,0,cv.width,cv.height);
    const s=app.view.scale;
    ctx.setTransform(app.dpr*s,0,0,app.dpr*s,app.dpr*app.view.ox,app.dpr*app.view.oy);
    const r=cv.getBoundingClientRect();
    renderScene(ctx,d,{pxPerMM:s, show:app.show, result:app.result, rats:app.ratsCache, teardrops:app.teardrops,
      pour:app.pour, sel:app.sel, grid:app.show.grid, drag:app.dragging, draw:app.draw, activeLayer:app.draw?.l??app.drawLayer, highlightNet:app.selNet,
      bounds:{x0:Math.max(0,-app.view.ox/s),y0:Math.max(0,-app.view.oy/s),x1:Math.min(d.width,(r.width-app.view.ox)/s),y1:Math.min(d.height,(r.height-app.view.oy)/s)}});
    drawNavigation(d,r.width,r.height);
  }
  function drawNavigation(d,w,h){
    const g=ctx, {scale:s,ox,oy}=app.view, edge=24;
    g.setTransform(app.dpr,0,0,app.dpr,0,0);
    g.save();
    g.font='10px "SFMono-Regular", Consolas, monospace';
    // 板框尺寸为屏幕空间标注，不写入任何设计或制造输出。
    const x1=ox, x2=ox+d.width*s, y1=oy, y2=oy+d.height*s;
    const dimY=y2+22, dimX=x2+22;
    g.strokeStyle='#52667e'; g.fillStyle='#9caea5'; g.lineWidth=1;
    g.textAlign='center'; g.textBaseline='middle';
    if(dimY>edge+16&&dimY<h-28&&x2>edge&&x1<w){
      g.beginPath(); g.moveTo(x1,y2+7); g.lineTo(x1,dimY+4); g.moveTo(x2,y2+7); g.lineTo(x2,dimY+4);
      g.moveTo(x1,dimY); g.lineTo(x2,dimY); g.stroke();
      const label=d.width+' mm', cx=(x1+x2)/2, tw=g.measureText(label).width+14;
      g.fillStyle=CAD_PALETTE.desktop; g.fillRect(cx-tw/2,dimY-7,tw,14); g.fillStyle='#96aac2'; g.fillText(label,cx,dimY);
    }
    if(dimX>edge+16&&dimX<w-12&&y2>edge&&y1<h){
      g.beginPath(); g.moveTo(x2+7,y1); g.lineTo(dimX+4,y1); g.moveTo(x2+7,y2); g.lineTo(dimX+4,y2);
      g.moveTo(dimX,y1); g.lineTo(dimX,y2); g.stroke();
      g.save(); g.translate(dimX,(y1+y2)/2); g.rotate(-Math.PI/2);
      const label=d.height+' mm', tw=g.measureText(label).width+14;
      g.fillStyle=CAD_PALETTE.desktop; g.fillRect(-tw/2,-7,tw,14); g.fillStyle='#96aac2'; g.fillText(label,0,0); g.restore();
    }
    // 自适应 1 / 2 / 5 十进制标尺，标签间隔至少约 64 CSS px。
    const raw=64/s, power=Math.pow(10,Math.floor(Math.log10(raw)));
    const major=[1,2,5,10].find(n=>n*power>=raw)*power, minor=major/5;
    const fmt=v=>Math.abs(v)<1e-8?'0':String(+v.toFixed(Math.max(0,-Math.floor(Math.log10(minor)))));
    g.fillStyle='#171f2b'; g.fillRect(0,0,w,edge); g.fillRect(0,0,edge,h);
    g.strokeStyle='#3d4651'; g.beginPath(); g.moveTo(edge,edge); g.lineTo(w,edge); g.moveTo(edge,edge); g.lineTo(edge,h); g.stroke();
    g.save(); g.beginPath(); g.rect(edge,0,Math.max(0,w-edge),edge); g.clip();
    const startX=Math.ceil((edge-ox)/s/minor), endX=Math.floor((w-ox)/s/minor);
    for(let i=startX;i<=endX;i++){
      const x=ox+i*minor*s, big=i%5===0;
      g.strokeStyle=big?'#7a8997':'#46515e'; g.beginPath(); g.moveTo(x,edge); g.lineTo(x,edge-(big?7:3)); g.stroke();
      if(big){ g.fillStyle='#a5b1bd'; g.fillText(fmt(i*minor),x,9); }
    }
    g.restore();
    g.save(); g.beginPath(); g.rect(0,edge,edge,Math.max(0,h-edge)); g.clip();
    const startY=Math.ceil((edge-oy)/s/minor), endY=Math.floor((h-oy)/s/minor);
    for(let i=startY;i<=endY;i++){
      const y=oy+i*minor*s, big=i%5===0;
      g.strokeStyle=big?'#7a8997':'#46515e'; g.beginPath(); g.moveTo(edge,y); g.lineTo(edge-(big?7:3),y); g.stroke();
      if(big){ g.save(); g.translate(9,y); g.rotate(-Math.PI/2); g.fillStyle='#a5b1bd'; g.fillText(fmt(i*minor),0,0); g.restore(); }
    }
    g.restore();
    g.fillStyle='#202d3e'; g.fillRect(0,0,edge,edge); g.fillStyle='#a5b1bd'; g.fillText('mm',12,12);
    g.restore();
    syncCanvasUI();
  }
  // CAD viewport palette: shared by geometry, layer chips and legend. No manufacturing data is changed.
  const CAD_PALETTE=Object.freeze({desktop:'#0b1018',board:'#111b29',edge:'#7e91a8',top:'#f07878',bottom:'#649bff',inner1:'#bc8cff',inner2:'#68c6b1',pad:'#d9b86c',drill:'#080d15',via:'#b5c7da',airwire:'#8c9bb1',selection:'#80e3ed',keepout:'#bb8ede',reference:'#8799ad'});
  function layerKey(l,d){ return l===0?'top':l===d.layers-1?'bottom':l===1?'inner1':'inner2'; }
  function layerIndex(key,d){ return key==='top'?0:key==='bottom'?d.layers-1:key==='inner1'?1:2; }
  function layerName(l,d){ return ({top:'顶层 · F.Cu',bottom:'底层 · B.Cu',inner1:'内层 1 · In1.Cu',inner2:'内层 2 · In2.Cu'})[layerKey(l,d)]; }
  function layerVisible(l,d,show){ return l>=0&&l<d.layers&&show[layerKey(l,d)]!==false; }
  function padVisible(p,d,show){ return p.layer==='both'?Array.from({length:d.layers},(_,l)=>l).some(l=>layerVisible(l,d,show)):layerVisible(p.layer==='top'?0:d.layers-1,d,show); }
  function copperPath(g,pts){
    if(!pts.length) return;
    g.moveTo(pts[0].x,pts[0].y);
    for(let i=1;i<pts.length;i++) g.lineTo(pts[i].x,pts[i].y);
  }
  function renderScene(g,d,opt){
    const s=opt.pxPerMM||10, show=opt.show||{}, P=CAD_PALETTE;
    const active=opt.activeLayer??0, selectedNet=opt.draw?.netId??opt.highlightNet??null;
    const highlight=!!show.highlight||!!opt.draw;
    const opacity=(l,netId)=>((show.contrast&&l!==active)?0.22:1)*((highlight&&selectedNet&&netId!==selectedNet)?0.2:1);
    const width=id=>netW(d,id);
    g.save();
    g.fillStyle=P.board; g.fillRect(0,0,d.width,d.height);
    g.strokeStyle=P.edge; g.lineWidth=1/s; g.strokeRect(0,0,d.width,d.height);
    if(opt.grid&&show.grid){
      const stride=Math.pow(2,Math.max(0,Math.ceil(Math.log2(10/(s*d.grid)))));
      const b=opt.bounds||{x0:0,y0:0,x1:d.width,y1:d.height};
      const ix=Math.max(0,Math.floor(b.x0/d.grid/stride)*stride), iy=Math.max(0,Math.floor(b.y0/d.grid/stride)*stride);
      const ex=Math.min(d.width/d.grid,Math.ceil(b.x1/d.grid)), ey=Math.min(d.height/d.grid,Math.ceil(b.y1/d.grid));
      for(let j=iy;j<ey;j+=stride) for(let i=ix;i<ex;i+=stride){
        const major=i%(stride*5)===0&&j%(stride*5)===0, r=(major?0.7:0.45)/s;
        g.fillStyle=major?'#405065':'#2a394d';
        g.fillRect((i+0.5)*d.grid-r,(j+0.5)*d.grid-r,2*r,2*r);
      }
    }
    // Origin and board corner ticks are screen-space drafting aids.
    g.strokeStyle='#6b829c'; g.lineWidth=1/s; g.beginPath();
    g.moveTo(0,6/s);g.lineTo(0,0);g.lineTo(6/s,0);g.stroke();
    // Reference envelopes use actual pad extents, not invented component bodies or exported silk.
    if(show.refs!==false){
      const occupied=(d.pads||[]).map(p=>({x:p.x-p.w/2-2/s,y:p.y-p.h/2-2/s,w:p.w+4/s,h:p.h+4/s}));
      const intersects=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
      const groups=new Map();
      for(const p of d.pads||[]){
        if(!padVisible(p,d,show)) continue;
        const name=p.id.includes('-')?p.id.slice(0,p.id.lastIndexOf('-')):null;
        if(!name) continue;
        if(!groups.has(name)) groups.set(name,[]); groups.get(name).push(p);
      }
      for(const [name,pads] of groups){
        if(pads.length<2) continue;
        const x0=Math.min(...pads.map(p=>p.x-p.w/2))-.5,y0=Math.min(...pads.map(p=>p.y-p.h/2))-.5;
        const x1=Math.max(...pads.map(p=>p.x+p.w/2))+.5,y1=Math.max(...pads.map(p=>p.y+p.h/2))+.5;
        g.save();g.strokeStyle='#42556d';g.lineWidth=.8/s;g.setLineDash([4/s,3/s]);g.strokeRect(x0,y0,x1-x0,y1-y0);g.restore();
        if((x1-x0)*s>26){
          g.font=(11/s)+'px Consolas, monospace';g.textAlign='left';g.textBaseline='bottom';
          const tw=g.measureText(name).width,th=13/s;
          const candidates=[[x0,y0-4/s],[x1-tw,y0-4/s],[x1+5/s,y0+th],[x0,y1+th+3/s],[x0,y0-20/s]];
          const label=candidates.map(([x,y])=>({x,y:y-th,w:tw,h:th})).find(r=>!occupied.some(b=>intersects(r,b)));
          if(label){occupied.push(label);g.fillStyle=P.board;g.fillRect(label.x-1/s,label.y,tw+2/s,th);g.fillStyle=P.reference;g.fillText(name,label.x,label.y+th);}
        }
      }
    }
    // Airwires are fine dashed guides; small open endpoints are never copper pads.
    if(show.rats&&opt.rats?.length){
      for(const a of opt.rats){
        const highlighted=highlight&&selectedNet===a.netId;
        g.save();g.globalAlpha=(highlight&&selectedNet&&!highlighted)?0.22:0.7;
        g.strokeStyle=highlighted?P.selection:P.airwire;g.lineWidth=(highlighted?1.25:.75)/s;
        g.setLineDash([3/s,4/s]);g.beginPath();g.moveTo(a.x1,a.y1);g.lineTo(a.x2,a.y2);g.stroke();g.setLineDash([]);
        if(s>=12){g.beginPath();g.arc(a.x1,a.y1,2/s,0,Math.PI*2);g.moveTo(a.x2+2/s,a.y2);g.arc(a.x2,a.y2,2/s,0,Math.PI*2);g.stroke();}
        g.restore();
      }
    }
    if(opt.pour?.polys?.length&&layerVisible(opt.pour.layer,d,show)){
      // 多边形覆铜：全部环（外环+孔）偶奇填充
      const ringD=f=>{const p2=new Path2D();p2.moveTo(f[0],f[1]);for(let k=2;k<f.length;k+=2)p2.lineTo(f[k],f[k+1]);p2.closePath();return p2;};
      g.save();g.globalAlpha=.12*opacity(opt.pour.layer,opt.pour.netId);g.fillStyle=P[layerKey(opt.pour.layer,d)];
      const pourPath=new Path2D();
      for(const poly of opt.pour.polys){pourPath.addPath(ringD(poly.outer));for(const h of poly.holes)pourPath.addPath(ringD(h));}
      g.fill(pourPath,'evenodd');
      g.restore();
    }
    // Teardrop polygons omit ownership in the engine; recover it from the two base vertices at the via.
    const viaOwners=new Map();
    for(const n of opt.result?.nets||[])for(const v of n.vias||[])viaOwners.set(v.x.toFixed(3)+','+v.y.toFixed(3),n.netId);
    const teardropOwner=td=>{
      if(td.netId!=null)return td.netId;
      if(td.p.length<4)return null;
      const a=td.p[td.p.length-2],b=td.p[td.p.length-1];
      return viaOwners.get(((a.x+b.x)/2).toFixed(3)+','+((a.y+b.y)/2).toFixed(3));
    };
    // Render each layer once, back to front, active layer last. Solid copper uses the exact polyline.
    const layers=Array.from({length:d.layers},(_,i)=>i).reverse().filter(l=>l!==active).concat(active);
    for(const l of layers){
      if(!layerVisible(l,d,show)) continue;
      const color=P[layerKey(l,d)];
      const strokeRun=(pts,netId)=>{
        g.save();g.globalAlpha=opacity(l,netId);g.strokeStyle=color;g.lineWidth=width(netId);g.lineCap='round';g.lineJoin='round';
        g.beginPath();copperPath(g,pts);g.stroke();g.restore();
      };
      const strokePath=(pts,netId)=>{
        let run=[];
        const flush=()=>{if(run.length>1) strokeRun(run,netId);run=[];};
        for(const p of pts){if(p.l===l) run.push(p);else flush();}flush();
      };
      for(const n of opt.result?.nets||[]) for(const path of n.paths||[]) strokePath(path,n.netId);
      for(const m of d.manual||[]) strokePath(m.pts,m.netId);
      if(show.teardrop) for(const td of opt.teardrops||[]){
        if(td.l!==l) continue;
        g.save();g.globalAlpha=opacity(l,teardropOwner(td));g.fillStyle=color;g.beginPath();copperPath(g,td.p);g.closePath();g.fill();g.restore();
      }
    }
    // Vias are visually distinct from component pads; holes use true board drill dimensions.
    const vias=new Map();
    const addVia=(x,y,netId,ls)=>{
      if(!ls.some(l=>layerVisible(l,d,show))) return;
      const key=x+','+y;if(!vias.has(key)) vias.set(key,{x,y,netId,ls});
    };
    for(const n of opt.result?.nets||[]) for(const v of n.vias||[]) addVia(v.x,v.y,n.netId,Array.from({length:d.layers},(_,l)=>l));
    for(const m of d.manual||[]) for(let i=1;i<m.pts.length;i++){
      const a=m.pts[i-1],b=m.pts[i];if(a.l!==b.l) addVia(a.x,a.y,m.netId,Array.from({length:d.layers},(_,l)=>l));
    }
    for(const v of d.stitching||[]) addVia(v.x,v.y,v.netId,Array.from({length:d.layers},(_,l)=>l));
    for(const v of vias.values()){
      g.save();g.globalAlpha=(highlight&&selectedNet&&selectedNet!==v.netId)?0.2:1;
      g.beginPath();g.arc(v.x,v.y,d.viaOuter/2,0,Math.PI*2);g.fillStyle=P.via;g.fill();
      g.strokeStyle='#e0e9f3';g.lineWidth=.6/s;g.stroke();
      if(d.viaDrill>0){g.beginPath();g.arc(v.x,v.y,d.viaDrill/2,0,Math.PI*2);g.fillStyle=P.drill;g.fill();}g.restore();
    }
    for(const p of d.pads||[]){
      if(!padVisible(p,d,show)) continue;
      const l=p.layer==='bottom'?d.layers-1:0, through=p.layer==='both';
      const selected=opt.sel?.type==='pad'&&opt.sel.obj===p;
      const fill=through?P.pad:P[layerKey(l,d)];
      g.save();g.globalAlpha=through?((highlight&&selectedNet&&p.netId!==selectedNet)?0.25:1):opacity(l,p.netId);
      g.fillStyle=selected?'#f5dfa8':fill;g.strokeStyle=through?'#f0d596':fill;g.lineWidth=.65/s;
      g.beginPath();
      // Rectangular and round pad geometry is not rounded/decorated into another land pattern.
      if(p.shape==='circle')g.arc(p.x,p.y,p.w/2,0,Math.PI*2);else g.rect(p.x-p.w/2,p.y-p.h/2,p.w,p.h);
      g.fill();g.stroke();
      const hole=through?(p.holeR??d.viaDrill/2):0;
      if(hole>0){g.fillStyle=P.drill;g.beginPath();g.arc(p.x,p.y,hole,0,Math.PI*2);g.fill();}
      const pin=p.id.includes('-')?p.id.slice(p.id.lastIndexOf('-')+1):p.id;
      if(show.padNumbers!==false&&s*Math.min(p.w,p.h)>=13){
        g.textAlign='center';g.textBaseline='middle';g.font=(Math.min(11,Math.min(p.w,p.h)*s*.45)/s)+'px Consolas, monospace';
        if(hole>0){
          // Pin number on annulus, not printed over the hole.
          if((p.h/2-hole)*s>=7){g.fillStyle='#433519';g.fillText(pin,p.x,p.y-p.h/2+(p.h/2-hole)/2);}
        }else {g.fillStyle='#111b29';g.fillText(pin,p.x,p.y);}
      }
      if(show.netNames!==false&&Math.min(p.w,p.h)*s>=32){
        const name=d.nets?.find(n=>n.id===p.netId)?.name||'NC';
        g.font=(9/s)+'px Consolas, monospace';g.textAlign='center';g.textBaseline='top';g.fillStyle='#aebdd0';
        g.fillText(name,p.x,p.y+p.h/2+4/s);
      }
      if(opt.draw&&p.netId===opt.draw.netId){
        const start=opt.draw.pts[0];
        if(Math.hypot(p.x-start.x,p.y-start.y)>0.01){
          g.save();g.globalAlpha=1;g.strokeStyle=P.selection;g.lineWidth=1/s;g.setLineDash([3/s,3/s]);g.beginPath();
          if(p.shape==='circle')g.arc(p.x,p.y,p.w/2+4/s,0,Math.PI*2);
          else g.rect(p.x-p.w/2-4/s,p.y-p.h/2-4/s,p.w+8/s,p.h+8/s);
          g.stroke();g.restore();
        }
      }
      if(pin==='1'&&s*Math.min(p.w,p.h)>=12){
        g.fillStyle='#c4d2e3';g.beginPath();const x=p.x-p.w/2-4/s,y=p.y-p.h/2;
        g.moveTo(x,y);g.lineTo(x-4/s,y);g.lineTo(x,y+4/s);g.closePath();g.fill();
      }
      g.restore();
    }
    // Keepouts have violet fine hatching, not electrical-layer colors.
    for(const k of d.keepouts||[]){
      const x=k.x-k.w/2,y=k.y-k.h/2;g.save();g.beginPath();g.rect(x,y,k.w,k.h);g.clip();
      g.fillStyle='#bb8ede10';g.fillRect(x,y,k.w,k.h);g.strokeStyle='#bb8ede50';g.lineWidth=.7/s;
      for(let t=-k.h;t<k.w;t+=10/s){g.beginPath();g.moveTo(x+t,y);g.lineTo(x+t+k.h,y+k.h);g.stroke();}g.restore();
      g.save();g.strokeStyle=P.keepout;g.lineWidth=1/s;g.setLineDash([5/s,3/s]);g.strokeRect(x,y,k.w,k.h);g.restore();
      if(k.w*s>=70&&k.h*s>=25){g.font=(9/s)+'px Consolas, monospace';g.fillStyle=P.keepout;g.textAlign='center';g.textBaseline='middle';g.fillText('KEEPOUT',k.x,k.y);}
    }
    if(opt.draw?.pts?.length){
      const dg=opt.draw, pts=dg.pts.concat((dg.preview||[]).map(p=>({...p,l:dg.l})));
      for(const l of layers){
        if(!layerVisible(l,d,show)) continue;
        // 冲突时把预览描成告警色（#14b 实时反馈）
        const conflict=dg.conflict&&dg.conflict.l===undefined?!!dg.conflict:false;
        const flush=run=>{
          if(run.length<2) return;
          g.save();g.strokeStyle=conflict?'#ff4d5e':P[layerKey(l,d)];g.lineWidth=width(dg.netId);g.lineJoin='round';g.lineCap='round';g.globalAlpha=.7;g.beginPath();copperPath(g,run);g.stroke();
          g.globalAlpha=.9;g.lineWidth=.8/s;g.strokeStyle=conflict?'#ffd0d5':'#f0f6ff';g.setLineDash([4/s,3/s]);g.beginPath();copperPath(g,run);g.stroke();g.restore();
        };
        let run=[];
        for(const pt of pts){if(pt.l===l)run.push(pt);else{flush(run);run=[];}}flush(run);
      }
      for(let i=1;i<dg.pts.length;i++){
        const a=dg.pts[i-1],b=dg.pts[i];
        if(a.l===b.l||!Array.from({length:d.layers},(_,l)=>l).some(l=>layerVisible(l,d,show)))continue;
        g.save();g.strokeStyle=P.via;g.lineWidth=1/s;g.beginPath();g.arc(a.x,a.y,d.viaOuter/2,0,Math.PI*2);g.stroke();g.fillStyle=P.drill;g.beginPath();g.arc(a.x,a.y,d.viaDrill/2,0,Math.PI*2);g.fill();g.restore();
      }
      if(layerVisible(dg.l,d,show)){
        const last=pts[pts.length-1];g.save();g.strokeStyle=P.selection;g.lineWidth=1/s;g.beginPath();g.arc(last.x,last.y,5/s,0,Math.PI*2);g.moveTo(last.x-9/s,last.y);g.lineTo(last.x+9/s,last.y);g.moveTo(last.x,last.y-9/s);g.lineTo(last.x,last.y+9/s);g.stroke();g.restore();
      }
      // 冲突点：告警色圆环 + 十字（#14b）
      if(dg.conflict){
        const c=dg.conflict;
        g.save();g.strokeStyle='#ff4d5e';g.lineWidth=1.6/s;
        g.beginPath();g.arc(c.x,c.y,6/s,0,Math.PI*2);g.stroke();
        g.beginPath();g.moveTo(c.x-9/s,c.y);g.lineTo(c.x+9/s,c.y);
        g.moveTo(c.x,c.y-9/s);g.lineTo(c.x,c.y+9/s);g.stroke();g.restore();
      }
    }
    if(opt.sel){
      const o=opt.sel.obj;g.save();g.strokeStyle=P.selection;g.lineWidth=1.25/s;
      if(opt.sel.type==='manual'){
        for(let i=1;i<o.pts.length;i++){const a=o.pts[i-1],b=o.pts[i];if(a.l!==b.l||!layerVisible(a.l,d,show))continue;
          g.lineWidth=width(o.netId)+3/s;g.globalAlpha=.55;g.beginPath();g.moveTo(a.x,a.y);g.lineTo(b.x,b.y);g.stroke();}
      }else if(opt.sel.type!=='pad'||padVisible(o,d,show)){
        const pad=4/s,x=o.x-o.w/2-pad,y=o.y-o.h/2-pad,w=o.w+pad*2,h=o.h+pad*2;
        g.setLineDash([3/s,2/s]);g.strokeRect(x,y,w,h);g.setLineDash([]);g.fillStyle=P.selection;
        for(const [cx,cy] of [[x,y],[x+w,y],[x,y+h],[x+w,y+h]])g.fillRect(cx-1.5/s,cy-1.5/s,3/s,3/s);
      }g.restore();
    }
    for(const o of opt.result?.overuse||[]){g.strokeStyle='#ffa769';g.lineWidth=1.5/s;g.beginPath();g.arc(o.x,o.y,7/s,0,Math.PI*2);g.stroke();}
    if(opt.drag?.type==='knew'){
      const a=opt.drag;g.save();g.fillStyle='#bb8ede18';g.strokeStyle=P.keepout;g.lineWidth=1/s;g.setLineDash([5/s,3/s]);
      const x=Math.min(a.x0,a.x1),y=Math.min(a.y0,a.y1),w=Math.abs(a.x1-a.x0),h=Math.abs(a.y1-a.y0);g.fillRect(x,y,w,h);g.strokeRect(x,y,w,h);g.restore();
    }
    g.restore();
  }

  // ---------------- 命中测试与编辑 ----------------
  function hitTest(m){
    const d=app.design;
    for(let i=d.pads.length-1;i>=0;i--){
      const p=d.pads[i];
      if(!padVisible(p,d,app.show)) continue;
      const hit=p.shape==='circle'
        ? Math.hypot(m.x-p.x,m.y-p.y)<=p.w/2
        : Math.abs(m.x-p.x)<=p.w/2 && Math.abs(m.y-p.y)<=p.h/2;
      if(hit) return {type:'pad',obj:p};
    }
    for(let i=(d.manual||[]).length-1;i>=0;i--){
      const m2=d.manual[i];
      for(let k=1;k<m2.pts.length;k++){
        if(m2.pts[k].l!==m2.pts[k-1].l) continue;
        if(!layerVisible(m2.pts[k].l,d,app.show)) continue;
        if(segDist(m.x,m.y,m2.pts[k-1].x,m2.pts[k-1].y,m2.pts[k].x,m2.pts[k].y)<=netW(d,m2.netId)/2+0.12)
          return {type:'manual',obj:m2};
      }
    }
    // 阶段三 #14：自动布线也参与命中——否则推挤/局部重布无从"选中要改的线"。
    // 只读命中，不改几何（改动走 manual 通道或窗口重布）。
    if(app.result){
      for(let i=app.result.nets.length-1;i>=0;i--){
        const rn=app.result.nets[i];
        for(const path of (rn.paths||[])) for(let k=1;k<path.length;k++){
          const a=path[k-1], b=path[k];
          if(a.l!==b.l) continue;
          if(!layerVisible(a.l,d,app.show)) continue;
          if(segDist(m.x,m.y,a.x,a.y,b.x,b.y)<=netW(d,rn.netId)/2+0.12)
            return {type:'auto',obj:rn,netId:rn.netId,path,l:a.l};
        }
      }
    }
    for(let i=d.keepouts.length-1;i>=0;i--){
      const k=d.keepouts[i];
      if(Math.abs(m.x-k.x)<=k.w/2 && Math.abs(m.y-k.y)<=k.h/2) return {type:'keepout',obj:k};
    }
    return null;
  }
  function select(hit){
    app.sel=hit; renderProps(); requestDraw();
  }
  // ---------------- 手动布线 ----------------
  /* 预览碰撞检查（阶段三 #14b）：与 DRC 同口径（clearance + per-net 半宽），
     但只查**局部**——候选段 bbox 预筛，不做全板两两。
     返回 null=合法，否则 {x,y} 首个冲突点（供绘制红标）。 */
  function checkPreviewConflict(netId, pts){
    const d=app.design;
    if(!d||!pts||pts.length<2) return null;
    const hw=netW(d,netId)/2, R=d.clearance;
    const pads=d.pads||[];
    const others=[];
    for(const n of (app.result&&app.result.nets)||[]){
      if(n.netId===netId) continue;
      for(const path of n.paths||[]) others.push({netId:n.netId,l:path[0]&&path[0].l,path,w:netW(d,n.netId)/2});
    }
    for(const m of d.manual||[]){
      if(m.netId===netId) continue;
      others.push({netId:m.netId,path:m.pts,w:netW(d,m.netId)/2});
    }
    for(let i=1;i<pts.length;i++){
      const a=pts[i-1], b=pts[i];
      if(a.l!==b.l) continue;
      const x0=Math.min(a.x,b.x), x1=Math.max(a.x,b.x);
      const y0=Math.min(a.y,b.y), y1=Math.max(a.y,b.y);
      // 异网焊盘
      for(const p of pads){
        if(p.netId===netId) continue;
        if(!padOnLayer(p,a.l,d.layers)) continue;
        if(p.x+p.w/2+R+1 < x0 || p.x-p.w/2-R-1 > x1) continue;
        if(p.y+p.h/2+R+1 < y0 || p.y-p.h/2-R-1 > y1) continue;
        if(segmentPadDistance(a,b,p) < hw+R-1e-9) return {x:(a.x+b.x)/2, y:(a.y+b.y)/2, what:'焊盘 '+p.id};
      }
      // 异网走线
      for(const o of others){
        const w=o.w||hw;
        for(let k=1;k<(o.path||[]).length;k++){
          const c=o.path[k-1], e=o.path[k];
          if(c.l!==e.l) continue;
          if(c.l!==a.l) continue;
          const lim=hw+w+R;
          if(Math.min(c.x,e.x)-lim>x1 || Math.max(c.x,e.x)+lim<x0) continue;
          if(Math.min(c.y,e.y)-lim>y1 || Math.max(c.y,e.y)+lim<y0) continue;
          if(segSegDist(a.x,a.y,b.x,b.y,c.x,c.y,e.x,e.y) < lim-1e-9)
            return {x:(a.x+b.x)/2, y:(a.y+b.y)/2, what:'网络 '+o.netId};
        }
      }
      // 禁布区（铜皮不得进入）
      for(const k of d.keepouts||[]){
        if(k.scope && netClassOf(d,netId)===k.scope) continue;
        if(segmentRectDistance(a,b,k) < hw-1e-9) return {x:(a.x+b.x)/2, y:(a.y+b.y)/2, what:'禁布区'};
      }
      // 板边
      if(a.x<hw||b.x<hw||a.y<hw||b.y<hw||a.x>d.width-hw||b.x>d.width-hw||a.y>d.height-hw||b.y>d.height-hw)
        return {x:(a.x+b.x)/2, y:(a.y+b.y)/2, what:'板边'};
    }
    return null;
  }
  function netClassOf(d, netId){
    const n=(d.nets||[]).find(x=>x.id===netId);
    return (n&&d.rules&&d.rules.netClass)?(d.rules.netClass[n.name]||null):null;
  }
  function octilinear(a, b){
    const dx=b.x-a.x, dy=b.y-a.y;
    if(Math.abs(dx)<1e-9||Math.abs(dy)<1e-9) return [b];
    if(Math.abs(dx)>Math.abs(dy)){
      return [{x:b.x-Math.sign(dx)*Math.abs(dy), y:a.y}, b];
    }
    return [{x:a.x, y:b.y-Math.sign(dy)*Math.abs(dx)}, b];
  }
  function routeSnap(m){
    const d=app.design;
    const ph=hitTest(m);
    if(ph&&ph.type==='pad'&&Math.hypot(m.x-ph.obj.x,m.y-ph.obj.y)<=Math.max(ph.obj.w,ph.obj.h))
      return {x:ph.obj.x, y:ph.obj.y};
    return {x:snapToGrid(clampNum(m.x,0,d.width),d.grid),
            y:snapToGrid(clampNum(m.y,0,d.height),d.grid)};
  }
  function toggleDrawLayer(){
    const d=app.design;
    if(d.layers<2){ toast('单层板无法换层'); return; }
    if(app.draw){
      const last=app.draw.pts[app.draw.pts.length-1];
      app.draw.l=(app.draw.l+1)%d.layers;
      app.draw.pts.push({x:last.x, y:last.y, l:app.draw.l});   // 换层 → 放置过孔
    } else {
      app.drawLayer=(app.drawLayer+1)%d.layers;
    }
    const curL=app.draw?app.draw.l:app.drawLayer;
    app.drawLayer=curL;
    setViewOption(layerKey(curL,d),true);
    $('sbTool').textContent='手动布线 · 当前层：'+layerName(curL,app.design);
    syncCanvasUI(); requestDraw();
  }
  function finishDraw(){
    const dg=app.draw;
    app.draw=null;
    if(!dg) return;
    const pts=[];
    for(const p of dg.pts){
      const q=pts[pts.length-1];
      if(q && Math.abs(q.x-p.x)<1e-9 && Math.abs(q.y-p.y)<1e-9 && q.l===p.l) continue;
      pts.push(p);
    }
    if(pts.length<2){ toast('走线太短，已取消'); requestDraw(); return; }
    // #14b：提交前做一次全段碰撞检查。预览已实时标红，这里防止"一路未移动鼠标
    // 直接回车/双击"绕过检查；冲突则拒绝提交并给出原因（而不是写进设计再报 DRC）。
    const conflict=checkPreviewConflict(dg.netId,pts);
    if(conflict){
      toast('走线冲突（'+conflict.what+'），未提交；Esc 取消后可改走线');
      requestDraw();
      return;
    }
    pushHistory();
    app.design.manual=app.design.manual||[];
    app.design.manual.push({id:'M'+(app.mseq++), netId:dg.netId, pts});
    // 手动走线不影响既有布线，只刷新派生数据与 DRC
    computeDerived();
    renderNets(); renderStats(); runDRC();
    requestDraw();
    // #14d：手动走线成了新障碍，栅格会话的 model 已陈旧——作废会话，
    // 避免下一次「单网重布」看不见这条线（worker 侧也会以 stale 拒绝兜底）。
    app.session=null;
    toast('手动走线已添加（网络 '+dg.netId+'），DRC 结果见左下；后续单网重布需整体重布');
  }
  async function rerouteOne(id){
    if(app.routing) return;
    // 空闲期 Worker 异常没有待决 request/catch；不能据旧 UI 标记重建一个无会话 Worker。
    if(!routingClient.worker) app.session=null;
    if(!app.session||!app.result){toast('请先执行一次自动布线');return;}
    routingBusy(true);
    try{
      const response=await routingClient.request('reroute',{netId:id,design:app.design,
        options:{beautify:$('rBeautify').checked}});
      // #14d：worker 检出设计已变（手动走线/禁布增删），拒绝用陈旧 model 重布
      if(response&&response.type==='stale'){
        app.session=null;
        toast('设计已修改，单网重布需整体重布（旧会话的障碍集已失效）');
        return;
      }
      app.result=response.result;
      computeDerived(); renderNets(); renderStats(); runDRC(); requestDraw();
      toast(response.outcome.ok?'网络已单独重布 ✓':'单独重布失败，请查看 DRC');
    }catch(error){invalidateRoutingSession();toast(error.name==='AbortError'?'已停止重布':error.message);}
    finally{routingBusy(false);}
  }
  function clearNetRoutes(id){
    routingClient.dispose(); app.session=null;
    if(!app.result){ toast('当前没有自动布线'); return; }
    app.result={...app.result, nets:app.result.nets.filter(n=>n.netId!==id)};
    computeDerived(); renderNets(); renderStats(); runDRC(); requestDraw();
  }
  function placePad(m){
    const p={id:'P'+(app.seq++), netId:app.selNet,
      x:snapHi(m.x,app.design.width), y:snapHi(m.y,app.design.height),
      w:1.2, h:1.2, shape:'rect', layer:'both'};
    pushHistory();
    app.design.pads.push(p);
    select({type:'pad',obj:p}); designChanged();
  }
  function removeObj(hit){
    const d=app.design;
    // 自动走线不能被 Delete 直接删（它是布线器的产物，删掉会与 result 不一致）；
    // 正确操作是「清除该网布线」或「清除布线」。
    if(hit.type==='auto'){ toast('自动走线请用网络行的 ⌫ 清除该网，或「清除布线」'); return; }
    pushHistory();
    if(hit.type==='pad'){ d.pads=d.pads.filter(p=>p!==hit.obj); }
    else if(hit.type==='manual'){ d.manual=d.manual.filter(x=>x!==hit.obj); }
    else d.keepouts=d.keepouts.filter(k=>k!==hit.obj);
    select(null);
    if(hit.type==='manual'){
      // 删除手动走线不影响自动布线
      computeDerived(); renderNets(); renderStats(); runDRC(); requestDraw();
    } else designChanged();
  }

  // ---------------- 指针事件 ----------------
  cv.addEventListener('pointerdown',e=>{
    if(!app.design||![0,1].includes(e.button)) return;
    if(app.routing&&app.tool!=='pan'&&e.button!==1) return;
    try{ cv.setPointerCapture(e.pointerId); }catch(err){}
    const m=toMM(e.clientX,e.clientY);
    if(app.tool==='pan'||e.button===1){
      e.preventDefault(); app.dragging={type:'pan',sx:e.clientX,sy:e.clientY,ox:app.view.ox,oy:app.view.oy};
      syncCanvasUI(); return;
    }
    if(m.x<0||m.y<0||m.x>app.design.width||m.y>app.design.height){
      app.dragging={type:'pan',sx:e.clientX,sy:e.clientY,ox:app.view.ox,oy:app.view.oy}; syncCanvasUI(); return;
    }
    if(app.tool==='pad'){ placePad(m); return; }
    if(app.tool==='route'){
      const p=routeSnap(m);
      const ph=hitTest(m);
      if(!app.draw){
        const netId=(ph&&ph.type==='pad'&&ph.obj.netId)?ph.obj.netId:app.selNet;
        if(!netId){ toast('请先在网络列表中选择要布线的网络'); return; }
        if(ph?.type==='pad'&&ph.obj.layer!=='both') app.drawLayer=ph.obj.layer==='top'?0:app.design.layers-1;
        setViewOption(layerKey(app.drawLayer,app.design),true);
        app.draw={netId, pts:[{x:p.x,y:p.y,l:app.drawLayer}], l:app.drawLayer, preview:null};
        const curL=app.drawLayer;
        $('sbTool').textContent='布线中（网络 '+netId+'，当前层：'+layerName(curL,app.design)+'）· 单击加转折点，双击/回车结束，L 换层，Esc 取消';
      } else {
        for(const q of octilinear(app.draw.pts[app.draw.pts.length-1], p))
          app.draw.pts.push({x:q.x, y:q.y, l:app.draw.l});
        app.draw.preview=null;
      }
      requestDraw(); return;
    }
    if(app.tool==='delete'){ const hit=hitTest(m); if(hit) removeObj(hit); return; }
    if(app.tool==='keepout'){
      app.dragging={type:'knew', x0:snapToGrid(clampNum(m.x,0,app.design.width),app.design.grid),
        y0:snapToGrid(clampNum(m.y,0,app.design.height),app.design.grid),
        x1:snapToGrid(clampNum(m.x,0,app.design.width),app.design.grid), y1:snapToGrid(clampNum(m.y,0,app.design.height),app.design.grid)};
      requestDraw(); return;
    }
    const hit=hitTest(m);
    if(hit){
      select(hit);
      if(hit.type!=='manual') app.dragging={type:'obj',hit,obj:hit.obj,dx:hit.obj.x-m.x,dy:hit.obj.y-m.y,moved:false,pre:snapshotState()};
    }else { select(null); app.dragging={type:'pan',sx:e.clientX,sy:e.clientY,ox:app.view.ox,oy:app.view.oy}; }
    syncCanvasUI();
  });
  cv.addEventListener('pointermove',e=>{
    if(!app.design) return;
    const m=toMM(e.clientX,e.clientY);
    $('sbPos').textContent='X '+m.x.toFixed(2)+'  Y '+m.y.toFixed(2)+' mm';
    if(app.draw&&!(app.dragging&&app.dragging.type==='pan')){
      app.draw.preview=octilinear(app.draw.pts[app.draw.pts.length-1], routeSnap(m));
      // 实时碰撞反馈：预览段与异网铜/焊盘/禁布区/板边冲突时标红并给出原因
      try{
        const pts=app.draw.pts.concat(app.draw.preview.map(p=>({...p,l:app.draw.l})));
        app.draw.conflict=checkPreviewConflict(app.draw.netId,pts);
      }catch(e){ app.draw.conflict=null; }
      requestDraw();
      return;
    }
    const dg=app.dragging; if(!dg) return;
    if(dg.type==='pan'){
      app.view.ox=dg.ox+(e.clientX-dg.sx); app.view.oy=dg.oy+(e.clientY-dg.sy); requestDraw();
    } else if(dg.type==='obj'){
      dg.obj.x=snapHi(m.x+dg.dx,app.design.width);
      dg.obj.y=snapHi(m.y+dg.dy,app.design.height);
      dg.moved=true; requestDraw();
    } else if(dg.type==='knew'){
      dg.x1=snapToGrid(clampNum(m.x,0,app.design.width),app.design.grid);
      dg.y1=snapToGrid(clampNum(m.y,0,app.design.height),app.design.grid);
      requestDraw();
    }
  });
  cv.addEventListener('pointerup',e=>{
    const dg=app.dragging; app.dragging=null;
    syncCanvasUI();
    if(!dg) return;
    if(dg.type==='knew'){
      const g=app.design.grid;
      let w=Math.abs(dg.x1-dg.x0), h=Math.abs(dg.y1-dg.y0);
      w=Math.max(g,Math.round(w/g)*g); h=Math.max(g,Math.round(h/g)*g);
      if(w>=g&&h>=g){
        pushHistory();
        app.design.keepouts.push({x:Math.min(dg.x0,dg.x1)+w/2, y:Math.min(dg.y0,dg.y1)+h/2, w, h});
        designChanged(); toast('已添加禁布区');
      }
      requestDraw();
    } else if(dg.type==='obj'&&dg.moved){
      pushHistorySnap(dg.pre);
      designChanged();
    }
  });
  cv.addEventListener('wheel',e=>{
    e.preventDefault();
    const r=cv.getBoundingClientRect();
    const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?r.height:1);
    zoomAt(app.view.scale*Math.exp(clampNum(-delta*0.0016,-2,2)),e.clientX-r.left,e.clientY-r.top);
  },{passive:false});
  function hasOpenPopup(){
    return [...document.querySelectorAll('dialog[open], [aria-modal="true"], [role="dialog"], .modal, .modalOverlay, .modal-overlay')]
      .some(el=>!el.hidden&&el.getClientRects().length>0&&getComputedStyle(el).visibility!=='hidden');
  }
  window.addEventListener('keydown',e=>{
    if(e.defaultPrevented||e.isComposing) return;
    const target=e.target, key=e.key.toLowerCase();
    if(target.closest&&target.closest('input,select,textarea,[contenteditable]:not([contenteditable="false"])')) return;
    if(hasOpenPopup()) return;
    if(e.key==='Tab'&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!e.shiftKey&&!(target.closest&&target.closest('.menu'))){
      e.preventDefault(); toggleFocus(); return;
    }
    if((e.ctrlKey||e.metaKey)&&!e.altKey){
      if(app.routing) return;
      if(key==='z'&&!e.shiftKey){ e.preventDefault(); undo(); }
      else if(key==='y'||(e.shiftKey&&key==='z')){ e.preventDefault(); redo(); }
      return;
    }
    if(e.altKey||e.ctrlKey||e.metaKey) return;
    if(key==='f'){ e.preventDefault(); fitView(); return; }
    if(key==='1'){ e.preventDefault(); zoomAt(10); return; }
    if(key==='+'||key==='='){ e.preventDefault(); zoomAt(app.view.scale*1.2); return; }
    if(key==='-'){ e.preventDefault(); zoomAt(app.view.scale/1.2); return; }
    if(app.routing){ if(e.key==='Escape') invalidateRoutingSession(); return; }
    if(app.draw){
      if(e.key==='Enter'){ e.preventDefault(); finishDraw(); return; }
      if(e.key==='Escape'){ app.draw=null; syncCanvasUI(); requestDraw(); return; }
      if(key==='l'){ toggleDrawLayer(); return; }
      return;   // 布线中保留导航，屏蔽工具切换以免误丢走线
    }
    if(key==='l'&&app.tool==='route'){ e.preventDefault(); toggleDrawLayer(); return; }
    const tools={v:'select',h:'pan',p:'pad',x:'delete',r:'route',k:'keepout'};
    if(tools[key]){ e.preventDefault(); setTool(tools[key]); return; }
    if(e.key==='Escape') select(null);
    if((e.key==='Delete'||e.key==='Backspace')&&app.sel){ e.preventDefault(); removeObj(app.sel); }
  });
  cv.addEventListener('contextmenu',e=>{
    e.preventDefault();
    if(app.draw) finishDraw();
  });
  cv.addEventListener('dblclick',()=>{ if(app.draw) finishDraw(); });

  // ---------------- 工具栏按钮 ----------------
  document.querySelectorAll('[data-tool]').forEach(b=>{
    b.addEventListener('click',()=>{ if(!b.disabled) setTool(b.dataset.tool); });
  });
  for(const [id,fn] of [
    ['zoomOut',()=>zoomAt(app.view.scale/1.2)], ['zoomIn',()=>zoomAt(app.view.scale*1.2)],
    ['zoomFit',fitView], ['focusCanvas',toggleFocus],
    ['quickRoute',()=>{ if(!app.routing) $('btnRoute').click(); }],
    ['quickDrc',()=>{ if(!app.routing) $('btnDrc').click(); }],
    ['quickStop',()=>{ if(app.routing) $('btnStop').click(); }]
  ]) if($(id)) $(id).addEventListener('click',fn);
  if($('quickStop')) $('quickStop').disabled=true;
  if($('activeLayer')) $('activeLayer').addEventListener('change',()=>{
    if(!app.design||app.routing) return;
    const desired=layerIndex($('activeLayer').value,app.design);
    if(desired>=app.design.layers){ syncCanvasUI(); return; }
    const current=app.draw?app.draw.l:app.drawLayer;
    if(app.draw&&current!==desired){
      const last=app.draw.pts[app.draw.pts.length-1];
      app.draw.l=desired; app.draw.pts.push({x:last.x,y:last.y,l:desired});
    }
    app.drawLayer=desired;
    setViewOption(layerKey(desired,app.design),true);
    syncCanvasUI(); requestDraw();
  });
  setTool('select');

  // ---------------- 属性表单 ----------------
  function renderProps(){
    const f=$('propsForm'), emp=$('propsEmpty');
    if(!app.sel||app.sel.type==='manual'||app.sel.type==='auto'){
      f.style.display='none'; emp.style.display='block';
      if(app.sel&&app.sel.type==='auto'){
        const n=(app.design.nets||[]).find(x=>x.id===app.sel.netId);
        emp.textContent='已选择自动走线 · 网络 '+(n?n.name:app.sel.netId)+' · 第 '+(app.sel.l+1)+' 层 · '
          +'用「⟳」单独重布该网络，或用「形状补线」重布失败网。';
      } else {
        emp.textContent=app.sel?'已选择手动走线 '+app.sel.obj.id+' · 网络 '+app.sel.obj.netId+' · Delete 删除；走线几何通过重新绘制调整。':'单击选择焊盘或禁布区以编辑属性 · V 选择 · H 平移 · 滚轮缩放';
      }
      return;
    }
    f.style.display='flex'; emp.style.display='none';
    const isPad=app.sel.type==='pad', o=app.sel.obj;
    $('rowNet').style.display=isPad?'flex':'none';
    $('rowShape').style.display=isPad?'flex':'none';
    $('rowLayer').style.display=isPad?'flex':'none';
    if(isPad){
      $('pNet').innerHTML='<option value="__none">— 独立焊盘 —</option>'+
        app.design.nets.map(n=>'<option value="'+escapeHtml(n.id)+'">'+escapeHtml(n.name)+'</option>').join('');
      $('pNet').value=o.netId==null?'__none':o.netId;
      if($('pNet').selectedIndex<0) $('pNet').value='__none';
      $('pShape').value=o.shape; $('pLayer').value=o.layer;
    }
    $('pW').value=o.w; $('pH').value=isPad?(o.shape==='circle'?o.w:o.h):o.h;
    $('pX').value=o.x; $('pY').value=o.y;
  }
  $('pNet').addEventListener('change',()=>{ if(app.sel&&app.sel.type==='pad'){
    pushHistory();
    const v=$('pNet').value; app.sel.obj.netId=(v==='__none')?null:v; designChanged(); }});
  $('pShape').addEventListener('change',()=>{ if(app.sel&&app.sel.type==='pad'){
    pushHistory();
    app.sel.obj.shape=$('pShape').value; designChanged(); renderProps(); }});
  $('pLayer').addEventListener('change',()=>{ if(app.sel&&app.sel.type==='pad'){
    pushHistory();
    app.sel.obj.layer=$('pLayer').value; designChanged(); }});
  for(const [id,fn] of [['pW','w'],['pH','h'],['pX','x'],['pY','y']]){
    $(id).addEventListener('change',()=>{ if(!app.sel) return;
      pushHistory();
      const o=app.sel.obj; let v=num($(id).value,o[fn]);
      if(fn==='x') v=snapHi(v,app.design.width);
      else if(fn==='y') v=snapHi(v,app.design.height);
      else v=Math.max(0.2,v);
      if(fn==='h'&&app.sel.type==='pad'&&o.shape==='circle') o.w=v;
      o[fn]=v; designChanged(); renderProps();
    });
  }
  $('pDel').addEventListener('click',()=>{ if(app.sel) removeObj(app.sel); });

  // ---------------- 网络面板 ----------------
  function createNetGeometryCache(lowerBound){
    let currentDesign=null, cache=new Map();
    return d=>{
      // 撤销/导入会更换 design；缓存不持有历史设计或已删除网络。
      if(d!==currentDesign){ currentDesign=d; cache=new Map(); }
      const groups=new Map(d.nets.map(n=>[n.id,{pads:[]}]));
      for(const p of d.pads) groups.get(p.netId)?.pads.push(p);
      const next=new Map();
      for(const [id,group] of groups){
        // 下界仅取决于本网焊盘坐标；选网、名字、DRC/布线结果不改变它。
        const signature=JSON.stringify(group.pads.map(p=>[p.x,p.y]));
        const old=cache.get(id);
        const entry=old?.signature===signature?old:{signature,value:lowerBound(group.pads)};
        group.lowerBound=entry.value;
        next.set(id,entry);
      }
      cache=next;
      return groups;
    };
  }
  const netGeometryCache=createNetGeometryCache(netLowerBound);
  function renderNets(){
    const d=app.design, list=$('netList'); list.innerHTML='';
    const geometry=netGeometryCache(d);
    for(const n of d.nets){
      const group=geometry.get(n.id), cnt=group.pads.length;
      let st=['','未布'], cls='', lnTxt='';
      const lb=group.lowerBound;
      if(app.result){
        const rn=app.result.nets.find(x=>x.netId===n.id);
        if(rn){ if(!rn.total){ st=['','空']; }
          else if(rn.connected>=rn.total){ st=['ok','✓']; cls='ok'; }
          else { st=['bad','✗ '+rn.connected+'/'+rn.total]; cls='bad'; }
          if(lb>0.01){
            let len=0;
            for(const p of rn.paths) for(let k=1;k<p.length;k++)
              if(p[k].l===p[k-1].l) len+=Math.hypot(p[k].x-p[k-1].x,p[k].y-p[k-1].y);
            if(len>0.01){
              const det=len/lb;
              lnTxt=len.toFixed(1)+'mm'+(det>1.02?' ↗'+det.toFixed(2):'');
            }
          }
        }
      }
      if(!lnTxt && lb>0.01) lnTxt='≥'+lb.toFixed(1)+'mm';
      const row=document.createElement('div');
      row.className='netRow'+(app.selNet===n.id?' sel':'');
      row.innerHTML='<span class="netDot" style="background:'+netColor(n.id)+'"></span>'+
        '<span class="nm">'+escapeHtml(n.name)+(n.hs?' <span style="color:var(--accent2)" title="已标记为高速网络">⚡</span>':'')+
        (n.pair?' <span style="color:var(--ok)" title="差分对组：等长 DRC + 3W 对内豁免">⇄'+escapeHtml(n.pair)+'</span>':'')+
        (n.tr?' <span style="color:var(--dim)" title="上升时间（10%~90%）——配合⚡启用 1/6 传输线判据">T:'+n.tr+'ns</span>':'')+'</span>'+
        '<span class="ln" title="布线长度 / 理论下界（直角斯坦纳树）；↗倍数=绕行比（toporouter detour 思想）">'+lnTxt+'</span>'+
        '<span class="st '+cls+'" title="焊盘 '+cnt+' 个">'+st[1]+'</span>'+
        '<span class="netActions" role="group" aria-label="网络操作"><button class="mini'+(n.hs?' primary':'')+'" data-a="hs" title="标记/取消高速网络（启用 3W 检查）">⚡</button>'+
        '<button class="mini" data-a="cfg" title="高速属性：上升时间 tr（ns）/ 差分对组">⚙</button>'+
        '<button class="mini" data-a="reroute" title="单独重布该网络">⟳</button>'+
        '<button class="mini" data-a="clr" title="清除该网络的自动走线">⌫</button>'+
        '<button class="mini" data-a="w" title="设置该网线宽 mm（网络类：电源 0.5/信号默认；留空清除）">W</button>'+
        '<button class="mini" data-a="ren" title="重命名网络">✎</button><button class="mini" data-a="del" title="删除网络">🗑</button></span>';
      row.tabIndex=0; row.title=n.name;
      row.addEventListener('keydown',ev=>{
        if(ev.target===row&&(ev.key==='Enter'||ev.key===' ')){
          ev.preventDefault(); if(!app.routing){ app.selNet=n.id; renderNets(); requestDraw(); }
        }
      });
      row.addEventListener('click',ev=>{
        if(app.routing||ev.target.closest('button')) return;
        app.selNet=n.id; renderNets(); requestDraw();
      });
      row.querySelector('[data-a=hs]').addEventListener('click',()=>{
        n.hs=!n.hs; renderNets();
        if(app.result||app.design.manual.length) runDRC();
        toast(n.hs?'已标记 '+n.name+' 为高速网络（DRC 启用 3W 检查）':'已取消 '+n.name+' 的高速标记');
      });
      row.querySelector('[data-a=cfg]').addEventListener('click',()=>{
        app.netEd=(app.netEd===n.id)?null:n.id; renderNets();
      });
      row.querySelector('[data-a=reroute]').addEventListener('click',()=>rerouteOne(n.id));
      row.querySelector('[data-a=clr]').addEventListener('click',()=>clearNetRoutes(n.id));
      row.querySelector('[data-a=w]').addEventListener('click',()=>{
        const cur=n.w!=null?String(n.w):'';
        const inp=prompt('设置网络「'+n.name+'」线宽 mm（电源建议 0.5；留空恢复默认 '+app.design.trackW+'）：',cur);
        if(inp===null) return;
        pushHistory();
        const v=parseFloat(inp);
        if(isFinite(v)&&v>0) n.w=v; else delete n.w;
        designChanged(); renderNets();
        toast(isFinite(v)&&v>0?'已设置 '+n.name+' 线宽 '+v+'mm（导出/检查全链生效）':'已恢复 '+n.name+' 默认线宽');
      });
      row.querySelector('[data-a=ren]').addEventListener('click',()=>{
        const name=prompt('重命名网络：',n.name);
        if(name&&name.trim()){ pushHistory(); n.name=name.trim(); designChanged(); renderProps(); }
      });
      row.querySelector('[data-a=del]').addEventListener('click',()=>{
        if(!confirm('删除网络「'+n.name+'」？其焊盘将变为独立焊盘。')) return;
        pushHistory();
        d.nets=d.nets.filter(x=>x!==n);
        for(const p of d.pads) if(p.netId===n.id) p.netId=null;
        if(app.selNet===n.id) app.selNet=d.nets.length?d.nets[0].id:null;
        designChanged(); renderProps();
      });
      list.appendChild(row);
      // 高速属性内联编辑器（tr：1/6 传输线判据；pair：差分等长 + 3W 对内豁免）
      if(app.netEd===n.id){
        const ed=document.createElement('div');
        ed.className='netEdit';
        ed.innerHTML='<div class="row"><label>tr ns</label><input data-a="tr" type="number" step="0.1" min="0.01" value="'+(n.tr!=null?n.tr:'')+'" placeholder="上升时间 10%~90%"></div>'+
          '<div class="row"><label>差分对组</label><input data-a="pair" class="grow" value="'+(n.pair?escapeHtml(n.pair):'')+'" placeholder="如 usb（两网标同组名成对）"></div>'+
          '<div class="row"><button class="mini primary" data-a="apply">应用</button><button class="mini" data-a="cancel">取消</button>'+
          '<span class="about grow">tr+⚡ → 1/6 传输线判据；同组两网 → 等长检查 + 3W 对内豁免</span></div>';
        list.appendChild(ed);
        ed.querySelector('[data-a=apply]').addEventListener('click',()=>{
          pushHistory();
          const tv=parseFloat(ed.querySelector('[data-a=tr]').value);
          if(isFinite(tv)&&tv>0){ n.tr=tv; if(!n.hs){ n.hs=true; toast('已自动标记 '+n.name+' 为高速网络'); } }
          else delete n.tr;
          const pv=ed.querySelector('[data-a=pair]').value.trim();
          if(pv) n.pair=pv; else delete n.pair;
          app.netEd=null; designChanged(); renderNets(); runDRC();
          toast('已更新 '+n.name+' 高速属性（tr/pair 全链生效：等长 DRC、端接判据、3W 对内豁免）');
        });
        ed.querySelector('[data-a=cancel]').addEventListener('click',()=>{ app.netEd=null; renderNets(); });
      }
    }
    if(!d.nets.length) list.innerHTML='<div class="about">暂无网络。上方输入名称添加，或载入示例电路。</div>';
    // 同步覆铜网络下拉（保留原选择，缺省 GND）
    const pn=$('pourNet'), prev=pn.value;
    pn.innerHTML=d.nets.map(n=>'<option value="'+escapeHtml(n.id)+'">'+escapeHtml(n.name)+'</option>').join('')||'<option value="">（无网络）</option>';
    if([...pn.options].some(o=>o.value===prev)) pn.value=prev;
    else if(d.nets.some(n=>n.id==='gnd')) pn.value='gnd';
  }
  $('btnAddNet').addEventListener('click',()=>{
    const name=$('newNetName').value.trim();
    if(!name){ toast('请输入网络名称'); return; }
    pushHistory();
    const id='n'+(app.netSeq++);
    app.design.nets.push({id,name}); app.selNet=id;
    $('newNetName').value=''; renderNets(); renderProps();
  });

  // ---------------- 设计参数 ----------------
  function bindParam(id,fn,geometric){
    $(id).addEventListener('change',()=>{
      const d=app.design; if(!d) return;
      pushHistory();
      fn(d);
      clampDesign(d);
      if(geometric) snapAll(d);
      syncParamInputs(); sbMsg(); designChanged();
    });
  }
  function clampDesign(d){
    d.grid=clampNum(d.grid,0.1,5); d.trackW=clampNum(d.trackW,0.05,5);
    d.clearance=clampNum(d.clearance,0.05,5);
    d.viaOuter=clampNum(d.viaOuter,0.3,5); d.viaDrill=clampNum(d.viaDrill,0.1,d.viaOuter);
    d.width=clampNum(d.width,10,500); d.height=clampNum(d.height,10,500);
    d.layers=Math.max(1,Math.min(4,Math.round(d.layers)));
  }
  bindParam('dW',d=>{ d.width=num($('dW').value,60); });
  bindParam('dH',d=>{ d.height=num($('dH').value,40); });
  bindParam('dGrid',d=>{ d.grid=num($('dGrid').value,0.5); },true);
  bindParam('dTrack',d=>{ d.trackW=num($('dTrack').value,0.3); });
  bindParam('dClr',d=>{ d.clearance=num($('dClr').value,0.2); });
  bindParam('dVia',d=>{ d.viaOuter=num($('dVia').value,0.8); });
  bindParam('dDrill',d=>{ d.viaDrill=num($('dDrill').value,0.4); });
  bindParam('dLayers',d=>{ d.layers=Math.round(num($('dLayers').value,2)); });
  bindParam('dCopper',d=>{ d.copperWeight=$('dCopper').value; });
  // 嘉立创规则模板（数值来源：官网加工能力参数表）
  // 封装库：常用封装一键放置（尺寸为参考值，放置后可编辑）
  const FP_LIST=['0402','0603','0805','1206','SOT-23','SOT-223','SOIC-8','SOIC-14','SOIC-16','DIP-N','排针 1×N','排针 2×N'];
  $('fpSel').innerHTML=FP_LIST.map(f=>'<option value="'+f+'">'+f+'</option>').join('');
  $('fpPlace').addEventListener('click',()=>{
    if(!app.design) return;
    const name=$('fpSel').value;
    let n=Math.max(2, Math.round(num($('fpN').value,8)));
    let pads;
    try{ pads=footprintPads(name, n); }
    catch(err){ toast(err.message); return; }
    if(name==='DIP-N' && n%2) n++;    // DIP 需偶数引脚
    if(name==='SOT-23'||name==='SOT-223') n=(name==='SOT-23'?3:4);
    // 元件前缀编号：U<序>-<引脚>（自动布局按前缀分组、EasyEDA/DSN 导出按元件组织）
    if(!app.fpSeq) app.fpSeq=1;
    const prefix='U'+(app.fpSeq++);
    // 视图中心（板坐标），吸附栅格；画布不可见（宽度 0）时回退板中心；
    // 若该处已有焊盘则向右/向下自动避让，最后钳位到板内
    const wrap=$('canvasWrap').getBoundingClientRect();
    let cx=snapHi(wrap.width>0 ? (wrap.width/2-app.view.ox)/app.view.scale : app.design.width/2, app.design.width);
    let cy=snapHi(wrap.height>0 ? (wrap.height/2-app.view.oy)/app.view.scale : app.design.height/2, app.design.height);
    const span=Math.max(...pads.map(f=>Math.max(f.w,f.h)));
    const occupied=()=>{
      const r=span/2+2;
      return app.design.pads.some(p=>Math.abs(p.x-cx)<r && Math.abs(p.y-cy)<r);
    };
    let guard=0;
    while(occupied() && guard++<40){
      cx+=8;
      if(cx>app.design.width-2){ cx=snapHi(app.design.width/2,app.design.width); cy+=8; }
    }
    cx=Math.min(Math.max(cx, span/2+0.5), app.design.width-span/2-0.5);
    cy=Math.min(Math.max(cy, span/2+0.5), app.design.height-span/2-0.5);
    pushHistory();
    let pinNo=0;
    for(const f of pads){
      app.design.pads.push({
        id:prefix+'-'+(++pinNo), netId:app.selNet,
        x:snapHi(Math.min(Math.max(cx+f.dx,0),app.design.width),app.design.width),
        y:snapHi(Math.min(Math.max(cy+f.dy,0),app.design.height),app.design.height),
        w:f.w, h:f.h, shape:f.shape, layer:f.layer, holeR:f.holeR
      });
    }
    select(null); designChanged();
    toast('已放置 '+name+'（'+pads.length+' 焊盘'+(app.selNet?'，入当前网络':'，独立焊盘')+'）');
  });
  $('fpSel').addEventListener('change',()=>{
    const f=$('fpSel').value;
    $('fpN').value=f.startsWith('SOIC-')?parseInt(f.slice(5)):(f==='SOT-223'?8:(f==='SOT-23'?3:8));
    $('fpN').disabled=!/DIP|排针/.test(f);
  });
  $('fpSel').dispatchEvent(new Event('change'));

  const PRESETS={
    jlc2:  { label:'嘉立创双层 1oz（信号 0.25/间距 0.15）', v:{layers:2, copperWeight:'1', trackW:0.25, clearance:0.15, viaOuter:0.6, viaDrill:0.3, grid:0.45} },
    fine:  { label:'精细双层（细线密脚）',                  v:{layers:2, copperWeight:'1', trackW:0.15, clearance:0.15, viaOuter:0.6, viaDrill:0.3, grid:0.3} },
    jlc4:  { label:'嘉立创四层（SIG-GND-PWR-SIG）',        v:{layers:4, copperWeight:'1', trackW:0.15, clearance:0.12, viaOuter:0.6, viaDrill:0.3, grid:0.3} },
    power: { label:'大电流（粗线）',                        v:{layers:2, copperWeight:'2', trackW:0.6, clearance:0.3, viaOuter:1.2, viaDrill:0.6, grid:1.0} },
    // 板厂预设：参数取各厂公开工艺规格的安全值之上（OSHPark docs.oshpark.com/services/two-layer；
    // PCBWay capabilities.html：极限 0.1mm/0.15mm，建议 6mil 以上），DFM 检查表仍按嘉立创参数
    oshpark2:{ label:'OSHPark 双层（紫板，min 0.15/0.15/孔 0.33）', v:{layers:2, copperWeight:'1', trackW:0.25, clearance:0.2, viaOuter:0.7, viaDrill:0.4, grid:0.45} },
    pcbway2:{ label:'PCBWay 双层（min 0.1/0.1/孔 0.15）',   v:{layers:2, copperWeight:'1', trackW:0.2, clearance:0.2, viaOuter:0.6, viaDrill:0.3, grid:0.4} }
  };
  $('dPreset').addEventListener('change',()=>{
    const v=$('dPreset').value;
    if(!v||!app.design) return;
    const P=PRESETS[v];
    if(!P) return;
    pushHistory();
    Object.assign(app.design, P.v);
    snapAll(app.design); syncParamInputs(); sbMsg(); designChanged();
    toast('已应用预设：'+P.label);
    $('dPreset').value='';
  });

  // ---------------- 视图选项 ----------------
  const VIEW_INPUTS={top:'vTop',bottom:'vBottom',inner1:'vInner1',inner2:'vInner2',rats:'vRats',grid:'vGrid',teardrop:'vTeardrop',refs:'vRefs',padNumbers:'vPadNumbers',netNames:'vNetNames',contrast:'vContrast',highlight:'vHighlight'};
  function setViewOption(key,visible){
    if(!(key in VIEW_INPUTS)) return;
    app.show[key]=visible;
    if($(VIEW_INPUTS[key])) $(VIEW_INPUTS[key]).checked=visible;
    syncCanvasUI(); requestDraw();
  }
  for(const [key,id] of Object.entries(VIEW_INPUTS)){
    if($(id)) $(id).addEventListener('change',()=>setViewOption(key,$(id).checked));
  }
  document.querySelectorAll('#layerButtons [data-view]').forEach(b=>{
    b.addEventListener('click',()=>setViewOption(b.dataset.view,!app.show[b.dataset.view]));
  });
  $('pourOn').addEventListener('change',updatePour);
  $('pourLayer').addEventListener('change',updatePour);
  $('pourNet').addEventListener('change',updatePour);
  $('pourThermal').addEventListener('change',updatePour);
  $('btnStitch').addEventListener('click',()=>{
    if(!app.design) return;
    if(!app.pour||!app.pour.polys?.length){ toast('请先启用覆铜（布线后铜皮更准确）'); return; }
    pushHistory();
    const pts=planStitching(app.design, app.result, app.pour, num($('stitchSp').value,5));
    app.design.stitching=(app.design.stitching||[]).concat(pts);
    updatePour(); requestDraw(); runDRC();
    toast('已生成 '+pts.length+' 个缝合孔（自动避让其它导体）');
  });
  $('btnStitchClr').addEventListener('click',()=>{
    if(!app.design||!(app.design.stitching||[]).length){ toast('当前没有缝合孔'); return; }
    pushHistory();
    app.design.stitching=[];
    requestDraw(); runDRC();
    toast('已清除缝合孔');
  });
  $('btnAutoReturn').addEventListener('click',()=>{
    if(!app.design) return;
    let r;
    try{ r=autoReturnVias(app.design, exportResult(), {reach:1.6}); }
    catch(e){ toast('回流孔配对失败：'+e.message); return; }
    if(!r.ok){ toast(r.reason||'无法自动配对回流孔'); return; }
    if(!r.added.length){ toast('所有高速换层过孔旁已有地导体（reach 1.6mm 内），无需补孔'); return; }
    pushHistory();
    app.design.stitching=(app.design.stitching||[]).concat(r.added.map(v=>({x:v.x,y:v.y,netId:v.netId})));
    updatePour(); requestDraw(); runDRC();
    toast('已为 '+r.added.length+' 个高速换层孔配对回流地孔（reach 1.6mm≈孔长，互感抵消有效）'+
      (r.skipped.length?'；'+r.skipped.length+' 个位置间距不足已跳过':''));
  });

  // 载流线宽计算器（锚点来自嘉立创/IPC-2152 量级表，按电流与温升内插）
  const AMP_OZ={outer:['1','2'], inner:['0.5','1']};
  function ampFillOz(){
    const pos=$('ampLayer').value;
    $('ampOz').innerHTML=AMP_OZ[pos].map(o=>'<option value="'+o+'">'+o+' oz</option>').join('');
    if(pos==='inner') $('ampOz').value='0.5';
    ampUpdate();
  }
  function ampWidth(){
    const pos=$('ampLayer').value, oz=$('ampOz').value;
    const anchor=JLC.amp[pos][oz] || JLC.amp.outer['1'];
    const I=Math.max(0.1,num($('ampI').value,1)), dt=Math.max(1,num($('ampDT').value,10));
    const w=anchor.t*Math.pow(I,1.113)*Math.pow(10/dt,0.607);   // 1A/ΔT10℃ 锚点内插
    return { t:anchor.t, s:anchor.s, w:Math.ceil(w*20)/20 };
  }
  function ampUpdate(){
    const a=ampWidth();
    $('ampOut').textContent='理论 '+a.t.toFixed(2)+' mm → 建议 '+Math.max(a.s,a.w).toFixed(2)+' mm（按 −20% 线宽公差自行校核）';
  }
  $('ampI').addEventListener('input',ampUpdate);
  $('ampDT').addEventListener('change',ampUpdate);
  $('ampLayer').addEventListener('change',ampFillOz);
  $('ampOz').addEventListener('change',ampUpdate);
  $('ampApply').addEventListener('click',()=>{
    if(!app.design) return;
    pushHistory();
    const a=ampWidth();
    app.design.trackW=Math.max(app.design.trackW, a.s, a.w);
    snapAll(app.design); syncParamInputs(); sbMsg(); designChanged();
    toast('线宽已按载流要求调整');
  });
  ampFillOz();
  // 阻抗计算器：随线宽/铜厚联动，支持按目标阻抗反算
  function impUpdate(){
    if(!app.design) return;
    const t=String(app.design.copperWeight||'1')==='2'?0.07:0.035;
    const z=impedance($('impW').value,$('impH').value,$('impEr').value,t,$('impType').value);
    $('impOut').textContent=z.ok?('估算 Z₀ ≈ '+z.z0.toFixed(1)+' Ω（线宽 '+(+$('impW').value).toFixed(2)+' mm，铜厚 '+t+' mm）'):'参数不合法';
  }
  function impCalc(target){
    if(!app.design) return;
    const t=String(app.design.copperWeight||'1')==='2'?0.07:0.035;
    const w=widthForZ0(target,$('impH').value,$('impEr').value,t,$('impType').value);
    if(!isFinite(w)){ toast('反算失败：参数不合法'); return; }
    $('impW').value=w; impUpdate();
    pushHistory();
    app.design.trackW=Math.max(app.design.trackW, Math.ceil(w*20)/20);
    snapAll(app.design); syncParamInputs(); sbMsg(); designChanged();
    toast(target+'Ω 建议线宽 '+w.toFixed(2)+' mm（已应用为当前线宽下限）');
  }
  $('impW').addEventListener('input',impUpdate);
  $('impH').addEventListener('input',impUpdate);
  $('impEr').addEventListener('input',impUpdate);
  $('impType').addEventListener('change',impUpdate);
  $('imp50').addEventListener('click',()=>impCalc(50));
  $('imp90').addEventListener('click',()=>impCalc(90));
  $('btnUndo').addEventListener('click',undo);
  $('btnRedo').addEventListener('click',redo);
  $('btnFit').addEventListener('click',fitView);

  // ---------------- 自动布线 ----------------
  function invalidateRoutingSession(){
    // Worker 是会话的唯一持有者；取消或失败时同步清标记，不能等 Promise catch。
    // 保留已显示的 result/design：重布与形状补线失败不应抹掉原有成果。
    app.session=null;
    routingClient.dispose();
  }
  function routingBusy(busy){
    app.routing=busy;
    if(busy){
      app.disabledControls=[...document.querySelectorAll('button,input,select')]
        .filter(el=>!['btnStop','quickStop','btnFit','zoomOut','zoomIn','zoomFit','focusCanvas'].includes(el.id)
          &&!/^v(Top|Bottom|Inner1|Inner2|Rats|Grid|Teardrop|Refs|PadNumbers|NetNames|Contrast|Highlight)$/.test(el.id)&&!el.closest('#layerButtons'))
        .map(el=>[el,el.disabled]);
      for(const [el] of app.disabledControls) el.disabled=true;
    }else{
      for(const [el,disabled] of app.disabledControls||[]) el.disabled=disabled;
      app.disabledControls=null;
      updateHistBtns();
    }
    $('btnStop').disabled=!busy;
    if($('quickStop')){ $('quickStop').disabled=!busy; $('quickStop').hidden=!busy; }
    syncCanvasUI();
  }
  async function runRoute(options={}){
    if(app.routing||!app.design) return;
    app.draw=null; app.dragging=null; app.result=null; app.session=null; app.ratsCache=[]; app.teardrops=[]; select(null);
    routingClient.dispose();
    renderStats();
    $('drcList').textContent='布线中……完成后自动检查。';
    routingBusy(true);
    $('progressWrap').style.display='block';
    try{
      const response=await routingClient.request('route',{
        design:app.design,options:{
          viaCost:Math.max(1,num($('rVia').value,15)),
          turnPen:Math.max(0,num($('rTurn').value,0.3)),
          maxIter:Math.max(1,Math.round(num($('rIter').value,30))),
          diag:$('rDiag').checked,beautify:$('rBeautify').checked,
          optimize:$('rOptimize').checked,...options
        }
      },update=>{
        $('progressText').textContent=update.text;
        $('progressFill').style.width=Math.round(update.frac*100)+'%';
      });
      app.design=response.design; app.result=response.result; app.session=true;
      syncParamInputs(); sbMsg(); computeDerived();
      renderNets(); renderStats(); runDRC(); requestDraw();
      toast(app.result.status==='complete'&&!app.result.drcErrors
        ? '✅ 布线完成：全部网络连通，无间距冲突'
        : '⚠ 请查看统计与 DRC 结果');
    }catch(error){
      invalidateRoutingSession();
      if(error.name==='AbortError') toast('已停止布线');
      else{toast('布线失败：'+error.message);$('drcList').textContent=error.message;}
    }finally{
      routingBusy(false); $('progressWrap').style.display='none'; requestDraw();
    }
  }
  $('btnRoute').addEventListener('click',()=>runRoute());
  $('btnStop').addEventListener('click',()=>invalidateRoutingSession());
  $('btnAutopcb').addEventListener('click',async()=>{
    if(app.routing||!app.design) return;
    if(!confirm('将自动布局（会移动未锚定元件）并完整布线，继续？')) return;
    pushHistory();
    await runRoute({place:true});
  });
  // 形状补线（阶段三 #12）：只对仍有未连通焊盘的网做连续空间重布。
  // 默认路径不变——没有结果时先提示布线；补线失败不改动既有结果（引擎侧字典序接受）。
  $('btnShape').addEventListener('click',async()=>{
    if(app.routing||!app.design) return;
    if(!app.result){ toast('请先自动布线，再补线失败网'); return; }
    const fails=app.result.stats.total-app.result.stats.connected;
    if(fails<=0&&!app.result.overuse.length){ toast('当前已全部连通且无冲突，无需补线'); return; }
    pushHistory();
    routingBusy(true);
    $('progressWrap').style.display='block';
    $('drcList').textContent='形状补线中……';
    try{
      const response=await routingClient.request('shapePatch',{
        design:app.design,result:app.result,
        options:{viaCost:Math.max(1,num($('rVia').value,15)),
                 turnPen:Math.max(0,num($('rTurn').value,0.3))}
      },update=>{
        $('progressText').textContent=update.text;
        $('progressFill').style.width=Math.round((update.frac||0)*100)+'%';
      });
      app.result=response.result; app.session=null;   // 几何已变，栅格会话作废
      computeDerived(); renderNets(); renderStats(); runDRC(); requestDraw();
      const sh=response.shape||{};
      toast(sh.applied
        ? '形状补线：接受 '+sh.accepted+'/'+sh.attempted+' 网（连通 '+app.result.stats.connected+'/'+app.result.stats.total+'）'
        : '形状补线未改动（'+(sh.reason||'无失败网')+'）');
    }catch(error){
      invalidateRoutingSession();
      if(error.name==='AbortError'){
        toast('已停止形状补线，保留原布线结果');
        $('drcList').textContent='形状补线已停止，保留原布线结果，可重新检查 DRC。';
      }else{
        toast('形状补线失败：'+error.message);
        $('drcList').textContent=error.message;
      }
    }finally{
      routingBusy(false); $('progressWrap').style.display='none'; requestDraw();
    }
  });

  // ---------------- 统计与 DRC ----------------
  function renderStats(){
    const el=$('stats'), r=app.result;
    if(!r){ el.innerHTML='<span style="color:var(--dim)">尚未布线。点击「⚡ 自动布线」开始。</span>'; return; }
    const s=r.stats, rate=s.total?Math.round(100*s.connected/s.total):100;
    el.innerHTML=
      '状态：<b>'+(r.status==='complete'?'✅ 全部连通':'⚠ 部分连通')+'</b><br>'+
      '连通网络：<b>'+s.connected+'</b> / '+s.total+'（'+rate+'%）<br>'+
      '走线总长：<b>'+s.trackLen.toFixed(1)+' mm</b>（顶层 '+s.trackTop.toFixed(1)+' / 底层 '+s.trackBot.toFixed(1)+(s.trackInner?' / 内层 '+s.trackInner.toFixed(1):'')+'）<br>'+
      '过孔：<b>'+s.vias+'</b> 个　迭代：<b>'+r.iterations+'</b> 轮　用时 <b>'+r.timeMs+'</b> ms'+
      (r.overuse.length?'<br><span style="color:var(--err)">间距冲突 '+r.overuse.length+' 处（图中橙色圈）</span>':'');
  }
  const manualNetEntries=manualRouteEntries;
  function exportResult(){
    return {nets:[...(app.result?app.result.nets:[]), ...manualNetEntries(app.design)],
            overuse:app.result?app.result.overuse:[]};
  }
  function runDRC(){
    const el=$('drcList');
    if(!app.result && !(app.design&&app.design.manual.length)){
      el.innerHTML='<div class="d-warn">请先布线，再执行 DRC。</div>'; return;
    }
    const issues=checkDRC(app.design, exportResult(), {pour:app.pour});
    if(!issues.length){ el.innerHTML='<div class="d-ok">✔ 未发现问题：所有网络连通，间距合规。</div>'; return; }
    el.innerHTML=issues.map(i=>'<div class="d-'+(i.sev==='error'?'err':i.sev==='info'?'info':'warn')+'">['+escapeHtml(i.type)+'] '+escapeHtml(i.msg)+'</div>').join('');
  }
  $('btnDrc').addEventListener('click',runDRC);
  $('btnClear').addEventListener('click',()=>{
    routingClient.dispose(); app.session=null;
    app.result=null; app.teardrops=[];
    computeDerived();
    renderNets(); renderStats();
    $('drcList').innerHTML='<div class="d-ok">布线已清除。</div>'; requestDraw();
  });

  $('btnFab').addEventListener('click',()=>{
    if(!app.design) return;
    const rows=fabChecklist(app.design, exportResult(), {pour:app.pour});
    const color={ok:'var(--ok)', warn:'var(--warn)', fail:'var(--err)', info:'var(--dim)'};
    const icon={ok:'✔', warn:'⚠', fail:'✗', info:'·'};
    let html='<div style="color:var(--ok);font-weight:600;margin-bottom:4px">投板前检查表 · 嘉立创参数（下单前以官网 DFM 为准）</div>';
    html+='<table class="fabTable"><tbody>';
    let lastGroup='';
    for(const r of rows){
      if(r.group!==lastGroup){
        html+='<tr><td colspan="4" style="color:var(--accent);font-weight:600;padding-top:6px">'+r.group+'</td></tr>';
        lastGroup=r.group;
      }
      html+='<tr><td style="color:'+color[r.status]+';width:16px">'+icon[r.status]+'</td><td>'+escapeHtml(r.item)+'</td><td style="white-space:nowrap">'+escapeHtml(r.value)+'</td><td style="color:var(--dim)">'+escapeHtml(r.limit)+(r.note?' · '+escapeHtml(r.note):'')+'</td></tr>';
    }
    html+='</tbody></table><div style="margin-top:6px"><button class="mini" id="btnFabBack">← 返回 DRC 列表</button></div>';
    $('drcList').innerHTML=html;
    $('btnFabBack').addEventListener('click',runDRC);
  });

  // ---------------- 文件 ----------------
  function download(blob,name){
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob); a.download=name; a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),3000);
  }
  $('btnSave').addEventListener('click',()=>{
    const data={app:'pcb-autorouter',version:1,design:app.design,result:app.result};
    download(new Blob([JSON.stringify(data,null,1)],{type:'application/json'}),'pcb-design.json');
  });
  $('btnOpen').addEventListener('click',()=>$('fileInput').click());
  // KiCad .kicad_pcb 导入：解析网络/焊盘/板框（走线不导入，本工具自己布）
  $('btnKiCad').addEventListener('click',()=>$('kicadInput').click());
  $('kicadInput').addEventListener('change',e=>{
    const f=e.target.files[0]; if(!f) return;
    const rd=new FileReader();
    rd.onload=()=>{
      try{
        const d=importKiCadPcb(rd.result,{margin:1.0});
        const np=d.pads.length, nn=d.nets.length;
        loadDesign(d);
        app.result=null; app.teardrops=[]; app.pour=null;
        computeDerived(); renderNets(); renderProps(); renderStats(); requestDraw(); fitView();
        $('drcList').innerHTML='<div class="d-ok">已导入 '+escapeHtml(f.name)+'：'+np+' 个焊盘、'+nn+' 个网络。点击「⚡ 自动布线」开始。</div>';
        toast('已导入 KiCad 设计：'+np+' 焊盘 / '+nn+' 网络（走线不导入）');
      }catch(err){ toast('导入失败：'+err.message); }
    };
    rd.readAsText(f); e.target.value='';
  });
  $('fileInput').addEventListener('change',e=>{
    const f=e.target.files[0]; if(!f) return;
    const rd=new FileReader();
    rd.onload=()=>{
      try{
        const j=JSON.parse(rd.result);
        if(!j.design) throw new Error('缺少 design 字段');
        const design=normalizeDesign(j.design);
        const result=j.result?normalizeResult(j.result,design):null;
        loadDesign(design);
        if(result){ app.result=result; computeDerived();
          renderNets(); renderStats(); requestDraw(); }
        toast('已载入 '+f.name);
      }catch(err){ toast('载入失败：'+err.message); }
    };
    rd.readAsText(f); e.target.value='';
  });
  // 嘉立创EDA PCB JSON 导入（roadmap #8）：走线/过孔→手动走线（接力），覆铜不导入
  $('btnEasyEda').addEventListener('click',()=>$('easyedaInput').click());
  $('easyedaInput').addEventListener('change',e=>{
    const f=e.target.files[0]; if(!f) return;
    const rd=new FileReader();
    rd.onload=()=>{
      try{
        const {design:d,report}=importEasyEdaPcbFull(rd.result);
        const np=d.pads.length, nn=d.nets.length;
        loadDesign(d);
        app.result=null; app.teardrops=[]; app.pour=null;
        computeDerived(); renderNets(); renderProps(); renderStats(); requestDraw(); fitView();
        const skipN=Object.entries(report.skipped||{}).map(([k,v])=>k+'×'+v).join('、');
        $('drcList').innerHTML='<div class="d-ok">已导入 '+escapeHtml(f.name)+'：'+np+' 个焊盘、'+nn+' 个网络、'
          +report.tracks+' 条走线、'+report.vias+' 个过孔（转为手动走线）'
          +(skipN?'；跳过：'+escapeHtml(skipN):'')
          +(report.copperareas?('；覆铜 '+report.copperareas+' 块未导入，请用「铺铜」重铺'):'')
          +'。点击「⚡ 自动布线」补完剩余走线。</div>';
        toast('已导入 EasyEDA 设计：'+np+' 焊盘 / '+nn+' 网络 / '+report.tracks+' 走线');
      }catch(err){ toast('导入失败：'+err.message); }
    };
    rd.readAsText(f); e.target.value='';
  });
  // Freerouting 互通：导出 DSN（Specctra 格式，Freerouting 可直接打开布线）
  $('btnDsn').addEventListener('click',()=>{
    if(!app.design) return;
    const dsn=exportDSN(app.design);
    download(new Blob([dsn],{type:'text/plain'}),'design.dsn');
    toast('已导出 design.dsn——用 Freerouting 打开它布线，完成后「导入 SES」回读');
  });
  // 回读 Freerouting 的 SES 会话：布线转为手动走线（换层点即过孔）
  $('btnSes').addEventListener('click',()=>$('sesInput').click());
  $('sesInput').addEventListener('change',e=>{
    const f=e.target.files[0]; if(!f) return;
    const rd=new FileReader();
    rd.onload=()=>{
      try{
        const r=importSES(rd.result, app.design);
        if(!r.entries.length && !r.vias){
          toast('未从 SES 读到布线'+(r.errors.length?'：'+r.errors[0]:''));
          return;
        }
        pushHistory();
        let k=0;
        for(const en of r.entries){
          app.design.manual.push({id:'SES'+(app.mseq++)+'_'+(k++), netId:en.netId, pts:en.pts});
        }
        designChanged(); renderNets(); renderStats(); runDRC(); requestDraw();
        toast('已导入 SES：'+r.entries.length+' 条走线、'+r.vias+' 个过孔'+(r.errors.length?('（'+r.errors.length+' 项跳过）'):''));
      }catch(err){ toast('SES 导入失败：'+err.message); }
    };
    rd.readAsText(f); e.target.value='';
  });
  $('btnSvg').addEventListener('click',()=>{
    download(new Blob([buildSVG(app.design,exportResult(),{pour:app.pour, teardrops:$('vTeardrop').checked})],{type:'image/svg+xml'}),'pcb.svg');
  });
  $('btnGbr').addEventListener('click',()=>{
    const g=buildGerber(app.design, exportResult(), app.pour, app.teardrops);
    const files=gerberFiles(g);
    files.forEach((f,i)=>setTimeout(()=>download(new Blob([f[1]],{type:'text/plain'}),f[0]), i*350));
    toast('已导出 Gerber 与钻孔文件（'+files.length+' 个文件）');
  });
  $('btnIpc').addEventListener('click',()=>{
    try{
      const text=exportIPC356(app.design, exportResult());
      download(new Blob([text],{type:'text/plain'}),'pcb-netlist.356');
      toast('已导出 IPC-D-356A 电测网表（含过孔与缝合孔；板厂飞针/针床测试基准）');
    }catch(e){ toast('导出失败：'+e.message); }
  });
  $('btnPng').addEventListener('click',()=>{
    const d=app.design, s=Math.max(8,Math.min(40,1200/d.width));
    const off=document.createElement('canvas');
    off.width=Math.round(d.width*s); off.height=Math.round(d.height*s);
    const g=off.getContext('2d'); g.scale(s,s);
    renderScene(g,d,{show:app.show, result:app.result, rats:app.ratsCache, teardrops:app.teardrops,
      pour:app.pour, sel:null, grid:false, pxPerMM:s, activeLayer:app.drawLayer, highlightNet:app.selNet});
    off.toBlob(b=>download(b,'pcb.png'));
  });
  $('btnNew').addEventListener('click',()=>{
    if(app.design&&(app.design.pads.length||app.design.nets.length)&&!confirm('新建将清空当前设计，确定？')) return;
    loadDesign(designDefaults());
  });

  // ---------------- 示例 ----------------
  const sel=$('exampleSel');
  for(const ex of EXAMPLES){
    const o=document.createElement('option'); o.value=ex.id; o.textContent=ex.name; sel.appendChild(o);
  }
  sel.addEventListener('change',()=>{
    const ex=EXAMPLES.find(x=>x.id===sel.value);
    if(ex){ loadDesign(ex.build()); toast('已载入示例：'+ex.name); }
    sel.value='';
  });

  // ---------------- 启动 ----------------
  resize();
  loadDesign(EXAMPLES[0].build());
  setTimeout(fitView,50);
  window.__pcbViewTest=Object.freeze({palette:CAD_PALETTE,renderScene});
  window.__pcbApp=app;   // 调试/自动化钩子（只读使用）
})();
