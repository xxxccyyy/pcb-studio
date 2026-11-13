import { routeBoard, routeBoardShape, autoPlace, normalizeDesign, beautifyResult } from './engine.mjs';

let session=null;
self.onmessage=event=>{
  const {id,command,design,options={},netId,result:prevResult}=event.data;
  const progress=update=>self.postMessage({id,type:'progress',...update});
  try{
    if(command==='route'){
      const d=normalizeDesign(design);
      if(options.place){ progress({text:'自动布局',frac:0}); autoPlace(d,{iterations:6000}); }
      const best=routeBoard(d,{...options,onProgress:progress});
      session=best.session;
      self.postMessage({id,type:'result',result:best.result,design:d});
    }else if(command==='shapePatch'){
      // 形状补线（阶段三 #12）：在已有结果上对失败网做连续空间重布。
      // 会话是栅格模型的，补线后几何已变——作废会话（下次 reroute 需整体重布），
      // 避免用陈旧 model 做单网重布（这正是 #14 里 worker 陈旧 model 的同源问题）。
      const d=normalizeDesign(design);
      const sp=routeBoardShape(d,{base:prevResult,...options,onProgress:progress});
      session=null;
      self.postMessage({id,type:'result',result:sp.result,shape:sp.shape,design:d});
    }else if(command==='reroute'){
      if(!session) throw new Error('请先执行自动布线');
      const outcome=session.rerouteSingle(netId),result=session.buildResult();
      if(options.beautify!==false) beautifyResult(design,result);
      self.postMessage({id,type:'result',result,outcome});
    }else throw new Error('Unknown worker command: '+command);
  }catch(error){ self.postMessage({id,type:'error',error:error.message||String(error)}); }
};
