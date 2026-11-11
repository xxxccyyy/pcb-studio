'use strict';
// Owns one persistent routing session; terminating it also interrupts an active A* search.
class RoutingWorkerClient{
  constructor(factory){
    this.factory=factory||(()=>{
      const code=document.getElementById('pcb-engine').textContent+'\n'+document.getElementById('pcb-worker').textContent;
      const url=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));
      try{return new Worker(url);}finally{URL.revokeObjectURL(url);}
    });
    this.worker=null; this.pending=null; this.seq=0;
  }
  request(command,payload={},onProgress){
    if(this.pending) return Promise.reject(new Error('Routing operation already running'));
    return new Promise((resolve,reject)=>{
      try{
        if(!this.worker){
          this.worker=this.factory();
          this.worker.onmessage=event=>{
            const p=this.pending,m=event.data;
            if(!p||m.id!==p.id) return;
            if(m.type==='progress'){p.onProgress?.(m);return;}
            this.pending=null;
            if(m.type==='error') p.reject(new Error(m.error)); else p.resolve(m);
          };
          this.worker.onerror=event=>{
            const error=new Error(event.message||'Routing worker failed');
            this.dispose(error);
          };
          this.worker.onmessageerror=()=>this.dispose(new Error('Invalid routing worker message'));
        }
        const id=++this.seq;
        this.pending={id,resolve,reject,onProgress};
        this.worker.postMessage({id,command,...payload});
      }catch(error){ this.dispose(error); reject(error); }
    });
  }
  dispose(error=new DOMException('Routing cancelled','AbortError')){
    this.worker?.terminate(); this.worker=null;
    const p=this.pending; this.pending=null; p?.reject(error);
  }
}
