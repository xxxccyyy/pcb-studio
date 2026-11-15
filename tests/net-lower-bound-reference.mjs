// Frozen pre-optimization netLowerBound implementation (0.14.3, 6259860).
// Only this function is copied, not the engine. rmstTasks is deliberately shared:
// this change optimizes only the fallback, and the exact small-net solver is unchanged.
import { rmstTasks } from '../src/engine.mjs';

export function referenceNetLowerBound(pads){
  const pts=(pads||[]).map(p=>({x:p.x,y:p.y}));
  if(pts.length<2) return 0;
  const t=rmstTasks(pts);
  if(t) return t.reduce((a,k)=>a+Math.abs(k.to.x-k.from.x)+Math.abs(k.to.y-k.from.y),0);
  const inT=[0], rest=pts.slice(1).map((_,i)=>i+1); let len=0;
  while(rest.length){
    let bi=0, bd=Infinity;
    for(const i of rest) for(const j of inT){
      const d=Math.abs(pts[i].x-pts[j].x)+Math.abs(pts[i].y-pts[j].y);
      if(d<bd){ bd=d; bi=i; }
    }
    len+=bd; inT.push(bi); rest.splice(rest.indexOf(bi),1);
  }
  return len;
}

// Deterministic, non-quantized coordinates make rounding/order regressions visible.
export function seededPads(count,seed=42){
  let state=seed>>>0;
  const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  return Array.from({length:count},(_,i)=>({id:'P'+i,x:random()*160-80,y:random()*120-60}));
}
