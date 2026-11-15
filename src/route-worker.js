import { routeBoard, routeBoardShape, autoPlace, normalizeDesign, beautifyResult } from './engine.mjs';

let session=null;
// 会话捕获建模时的障碍和规则；任何设计变化都保守地要求重新建模。
// 保存完整的规范化设计，而非字段白名单：漏掉 stitching、间距/过孔参数、
// 网络元数据或 rules 会让单网重布静默使用旧 model，后续新增约束也不能漏检。
let sessionKey=null;
const fingerprint=d=>JSON.stringify(d);
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
