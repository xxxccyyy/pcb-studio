import { routeBoard, routeBoardShape, autoPlace, normalizeDesign, beautifyResult } from './engine.mjs';

let session=null;
// 建会话时的设计指纹（#14d）：手动走线/禁布增删会让既有 model 变陈旧——
// 单网重布必须用与新设计一致的门禁，否则新加的障碍对重布不可见（静默冲突）。
let sessionKey=null;
const fingerprint=d=>JSON.stringify({
  pads:d.pads,p:1,
  manual:(d.manual||[]).map(m=>({n:m.netId,pts:m.pts})),
  keepouts:d.keepouts,tracks:d.nets.map(n=>[n.id,n.w,n.tr]),
  g:d.grid,w:d.width,h:d.height,l:d.layers
});
self.onmessage=event=>{
  const {id,command,design,options={},netId,result:prevResult}=event.data;
  const progress=update=>self.postMessage({id,type:'progress',...update});
  try{
    if(command==='route'){
      const d=normalizeDesign(design);
      if(options.place){ progress({text:'自动布局',frac:0}); autoPlace(d,{iterations:6000}); }
      const best=routeBoard(d,{...options,onProgress:progress});
      session=best.session;
      sessionKey=fingerprint(d);
      self.postMessage({id,type:'result',result:best.result,design:d});
    }else if(command==='shapePatch'){
      // 形状补线（阶段三 #12）：在已有结果上对失败网做连续空间重布。
      // 会话是栅格模型的，补线后几何已变——作废会话（下次 reroute 需整体重布）。
      const d=normalizeDesign(design);
      const sp=routeBoardShape(d,{base:prevResult,...options,onProgress:progress});
      session=null; sessionKey=null;
      self.postMessage({id,type:'result',result:sp.result,shape:sp.shape,design:d});
    }else if(command==='reroute'){
      if(!session) throw new Error('请先执行自动布线');
      // 设计已变（手动走线/禁布/焊盘增删）⇒ 旧 model 的障碍集与现行设计不符。
      // 如实拒绝并提示整体重布，而不是用陈旧 model 产出一个"看起来成功"的结果。
      const d=normalizeDesign(design);
      if(sessionKey!==fingerprint(d)){
        self.postMessage({id,type:'stale'});
        return;
      }
      const outcome=session.rerouteSingle(netId),result=session.buildResult();
      if(options.beautify!==false) beautifyResult(design,result);
      self.postMessage({id,type:'result',result,outcome});
    }else throw new Error('Unknown worker command: '+command);
  }catch(error){ self.postMessage({id,type:'error',error:error.message||String(error)}); }
};
