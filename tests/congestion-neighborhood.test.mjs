import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Execute the real soft-search penalty block. The oracle uses explicit (layer,row,col)
// triples rather than the engine's linear-index arithmetic.
const source=readFileSync(new URL('../src/engine.mjs',import.meta.url),'utf8');
const start=source.indexOf('          let nearPen;'),end=source.indexOf('\n          ec+=nearPen;',start);
assert.ok(start>=0&&end>start);
function harness({cached=true}={}){
  const GW=7,GH=5,L=4,NC=GW*GH,TS=NC*L;
  const usage=new Int16Array(TS),ownStamp=new Int32Array(TS),cellOwner=new Int32Array(TS);
  const netMeta=[{pair:'D'},{pair:'D'},{pair:null}];
  const ring2Offs=[];for(let y=-2;y<=2;y++)for(let x=-2;x<=2;x++)if(Math.max(Math.abs(x),Math.abs(y))===2)ring2Offs.push([x,y]);
  const npCacheArr=cached?new Float32Array(TS):null, npStampArr=cached?new Int32Array(TS):null;
  const context={GW,GH,NC,usage,ownStamp,cellOwner,netMeta,ring2Offs,gen:1,
    // 0.14.5 深优二段：引擎热点名提升为 astar 局部别名（usage→usageA、ownStamp→ownStampA），
    // vm 脚手架同步绑定同一数组——语义不变。
    // 0.14.8 深优：别名块扩展（nearPenCache→npC、nearPenStamp→npS、cellOwner→coA），
    // 脚手架同款同步绑定同一对象（npC/npS 与 nearPenCache/nearPenStamp 同一数组——
    // 测试以 nearPenStamp.fill(0) 失效缓存，别名必须指向同一存储）
    usageA:usage,ownStampA:ownStamp,coA:cellOwner,
    nearPenCache:npCacheArr,nearPenStamp:npStampArr,
    npC:npCacheArr,npS:npStampArr,
    adjPenAt(net,s,pair){
      if(usage[s]<=0||ownStamp[s]===context.gen)return 0;
      if(pair&&cellOwner[s]>0&&netMeta[cellOwner[s]-1].pair===pair&&usage[s]<=2)return 0;
      return 3;
    }};
  const penalty=vm.runInNewContext('((ns,myHs=false,myPair=null)=>{const net={};'+source.slice(start,end)+';return nearPen;})',context);
  const index=(l,x,y)=>l*NC+y*GW+x;
  function oracle(l,x,y,hs,pair){
    let value=0;
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const a=x+dx,b=y+dy;if(a<0||a>=GW||b<0||b>=GH)continue;
      value+=context.adjPenAt({},index(l,a,b),pair);
    }
    if(hs)for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
      if(Math.max(Math.abs(dx),Math.abs(dy))!==2)continue;
      const a=x+dx,b=y+dy;if(a<0||a>=GW||b<0||b>=GH)continue;
      const s=index(l,a,b);if(usage[s]<=0||ownStamp[s]===context.gen)continue;
      if(pair&&cellOwner[s]>0&&netMeta[cellOwner[s]-1].pair===pair)continue;
      value++;
    }
    return value;
  }
  return {context,penalty,index,oracle,GW,GH,L,usage,ownStamp,cellOwner};
}

test('soft congestion uses true grid rows/columns and never wraps rows or layers',()=>{
  const h=harness();h.usage.fill(1);h.cellOwner.fill(3);
  for(let l=0;l<h.L;l++)for(let y=0;y<h.GH;y++)for(let x=0;x<h.GW;x++){
    const s=h.index(l,x,y);
    assert.equal(h.penalty(s),h.oracle(l,x,y,false,null),`cell ${l}/${x}/${y}`);
  }
  h.context.gen++;
  h.usage.fill(0);h.usage[h.index(0,6,0)]=1;
  assert.equal(h.penalty(h.index(0,0,1)),0,'end of previous row is not a left neighbor');
  h.context.gen++;h.usage.fill(0);h.usage[h.index(1,0,0)]=1;
  assert.equal(h.penalty(h.index(0,0,4)),0,'next copper layer is not a downward neighbor');
});

test('3W congestion ring preserves own-net and differential-partner exemptions at every boundary',()=>{
  const h=harness();
  for(let s=0;s<h.usage.length;s++){
    h.usage[s]=s%4===0?0:s%3+1;h.cellOwner[s]=s%3+1;if(s%5===0)h.ownStamp[s]=h.context.gen;
  }
  for(const pair of [null,'D']){
    for(let l=0;l<h.L;l++)for(let y=0;y<h.GH;y++)for(let x=0;x<h.GW;x++){
      h.context.nearPenStamp.fill(0);
      const s=h.index(l,x,y),expected=h.oracle(l,x,y,true,pair);
      assert.equal(h.penalty(s,true,pair),expected);
      assert.equal(h.penalty(s,true,pair),expected,'cache-hit must agree');
    }
  }
});

test('large-board no-cache fallback computes penalties without dereferencing null buffers',()=>{
  const h=harness({cached:false});h.usage.fill(1);h.cellOwner.fill(3);
  for(const [l,x,y] of [[0,0,0],[0,3,2],[3,6,4]])for(const hs of [false,true])
    assert.equal(h.penalty(h.index(l,x,y),hs),h.oracle(l,x,y,hs,null));
});
