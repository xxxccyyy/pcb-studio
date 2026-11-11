import { routeBoard, autoPlace, normalizeDesign, beautifyResult } from './engine.mjs';

let session=null;
self.onmessage=event=>{
  const {id,command,design,options={},netId}=event.data;
  const progress=update=>self.postMessage({id,type:'progress',...update});
  try{
    if(command==='route'){
      const d=normalizeDesign(design);
      if(options.place){ progress({text:'自动布局',frac:0}); autoPlace(d,{iterations:6000}); }
      const best=routeBoard(d,{...options,onProgress:progress});
      session=best.session;
      self.postMessage({id,type:'result',result:best.result,design:d});
    }else if(command==='reroute'){
      if(!session) throw new Error('请先执行自动布线');
      const outcome=session.rerouteSingle(netId),result=session.buildResult();
      if(options.beautify!==false) beautifyResult(design,result);
      self.postMessage({id,type:'result',result,outcome});
    }else throw new Error('Unknown worker command: '+command);
  }catch(error){ self.postMessage({id,type:'error',error:error.message||String(error)}); }
};
