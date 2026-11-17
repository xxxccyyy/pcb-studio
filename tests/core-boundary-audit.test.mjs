import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as core from '../src/engine.mjs';
import { pngEncode } from '../src/png.mjs';
import { parseArguments } from '../src/cli-args.mjs';
import { applyEditOp, fpPads, syncComps, boardQuery, forensicWhy } from '../exe/board-info.mjs';

test('shared fp validates coordinates and alias counts without coercion or truncation',()=>{
  for(const args of [ ['0603',0,Infinity,0,'R1'], ['0603',0,'2',0,'R1'],
    ['hdr1',NaN,0,0,'J1'], ['hdr1',2.5,0,0,'J1'], ['hdr1',2001,0,0,'J1'],
    ['DIP-1000000000',0,0,0,'U1'], ['0603',0,0,0,''] ]) assert.throws(()=>fpPads(...args));
  const fp=fpPads('DIP-14',0,-3,5,'U2');
  assert.equal(fp.count,14);assert.equal(fp.pads[0].id,'U2-1');
  assert.ok(fp.pads.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
});

function editBoard(){
  return {...core.designDefaults(),width:30,height:20,nets:[{id:'a',pads:['U1-1']},{id:'b',pads:[]}],
    pads:[{id:'U1-1',netId:'a',x:4,y:5,w:2,h:2,shape:'rect',layer:'top'},
      {id:'U1-2',netId:null,x:8,y:5,w:4,h:2,shape:'rect',layer:'top'}]};
}

test('semantic edit failures are atomic and do not sanitize invalid dimensions through defaults',()=>{
  const requests=[{op:'set-net',net:'a',w:-1}, {op:'set-net',net:'a',w:Infinity},
    {op:'add-net',net:'c',pads:'U1-2'}, {op:'add-net',net:'c',pads:['U1-2','missing']},
    {op:'add-pad',pad:{id:'P3',x:1,y:2,w:0}}, {op:'add-pad',pad:{id:'P3',x:1,y:2,layer:'invalid'}},
    {op:'set-pad',pad:'U1-1',net:'b',w:-1}, {op:'move-comp',comp:'U1',dx:'2'},
    {op:'move-comp',comp:'U1',dx:Infinity}, {op:'add-keepout',x:3,y:3,w:-2,h:2}];
  for(const request of requests){
    const d=editBoard(),r={nets:[{netId:'a',paths:[],vias:[]}],stale:false};
    const beforeD=structuredClone(d), beforeR=structuredClone(r), pad=d.pads[0];
    assert.throws(()=>applyEditOp(d,r,request),undefined,JSON.stringify(request));
    assert.deepEqual(d,beforeD);assert.deepEqual(r,beforeR);assert.equal(d.pads[0],pad);
  }
});

test('successful edits do not retain caller request arrays or nested objects',()=>{
  const d=editBoard(),request={op:'add-net',net:'c',pads:['U1-2']};
  const out=applyEditOp(d,null,request);
  assert.equal(out.d,d);
  request.pads.push('missing');
  assert.deepEqual(d.nets.find(n=>n.id==='c').pads,['U1-2']);
  assert.equal(d.pads[1].netId,'c');
});

test('pad edits retain drill metadata and stricter net clearance invalidates existing routes',()=>{
  const d=editBoard();
  applyEditOp(d,null,{op:'add-pad',pad:{id:'J1-1',x:15,y:10,w:2,h:2,holeR:0.2,compId:'J1',netId:'b'}});
  assert.equal(d.pads.at(-1).holeR,0.2);assert.equal(d.pads.at(-1).compId,'J1');
  const r={nets:[{netId:'b',paths:[[{x:15,y:10,l:0},{x:20,y:10,l:0}]],vias:[]}]};
  assert.equal(applyEditOp(d,r,{op:'set-net',net:'b',clr:1}).pruned,true);
  assert.equal(r.nets.length,0);assert.equal(r.stale,true);
});

test('move-comp absolute placement uses physical pad centres and updates component metadata',()=>{
  const d=editBoard();d.comps={U1:{x:6.5,y:5}};
  applyEditOp(d,null,{op:'move-comp',comp:'U1',x:20,y:10});
  assert.equal(d.pads[0].x,17.5);assert.equal(d.pads[1].x,21.5);
  assert.equal(d.pads[0].y,10);assert.equal(d.comps.U1.x,20);assert.equal(d.comps.U1.y,10);
  const q=boardQuery(d,null,{comp:'U1'});
  assert.deepEqual(q.bbox,{x0:16.5,y0:9,x1:23.5,y1:11});
});

test('component edits respect exact inferred ids and explicit ownership instead of prefix matching',()=>{
  const d=editBoard();
  d.pads.push({id:'U1-extra-1',x:15,y:5,w:1,h:1,shape:'rect',layer:'top'},
    {id:'U1-3',compId:'U2',x:20,y:5,w:1,h:1,shape:'rect',layer:'top'});
  applyEditOp(d,null,{op:'move-comp',comp:'U1',dx:2});
  assert.equal(d.pads[0].x,6);assert.equal(d.pads[1].x,10);
  assert.equal(d.pads[2].x,15);assert.equal(d.pads[3].x,20);
  assert.deepEqual(boardQuery(d,null,{comp:'U1'}).pads.map(p=>p.id),['U1-1','U1-2']);
});

test('keepout edits prune crossing segments and vias, including per-net widths, not just vertices',()=>{
  const d=editBoard();d.nets.push({id:'wide',w:4},{id:'far'});
  const path=y=>[[{x:2,y,l:0},{x:28,y,l:0}]];
  const r={nets:[{netId:'a',paths:path(10),vias:[]},
    {netId:'b',paths:[],vias:[{x:15,y:10}]},
    {netId:'wide',paths:path(13),vias:[]},{netId:'far',paths:path(16),vias:[]}]};
  const out=applyEditOp(d,r,{op:'add-keepout',x:15,y:10,w:2,h:2});
  assert.equal(out.pruned,true);assert.equal(r.stale,true);
  assert.deepEqual(r.nets.map(n=>n.netId),['far']);
});

test('centered keepout pruning does not shift its exclusion rectangle to the lower right',()=>{
  const d=editBoard(),r={nets:[{netId:'a',paths:[[{x:2,y:7.5,l:0},{x:28,y:7.5,l:0}]],vias:[]}]};
  assert.equal(applyEditOp(d,r,{op:'add-keepout',x:15,y:10,w:2,h:6}).pruned,true);
});

test('sync-comps handles prototype-like component ids and large pad groups without spread calls',()=>{
  const d={pads:[{id:'__proto__-1',x:2,y:3,w:2,h:2,layer:'top'},
    {id:'constructor-1',x:5,y:3,w:2,h:2,layer:'top'}]};
  assert.equal(syncComps(d),2);
  assert.ok(Object.hasOwn(d.comps,'__proto__'));assert.ok(Object.hasOwn(d.comps,'constructor'));
  assert.equal(Object.getPrototypeOf(d.comps),Object.prototype);
  assert.equal(syncComps(d),0);
  const large={pads:new Array(150000).fill({id:'U1-1',x:4,y:6,w:2,h:2,layer:'top'})};
  assert.equal(syncComps(large),1);assert.deepEqual(large.comps.U1,{x:4,y:6,rot:0,layer:'top'});
});

test('forensic why uses the same centered keepout geometry as the routing engine',()=>{
  const d=editBoard();d.pads[0].x=3;d.pads[0].y=7.5;
  d.pads[1].netId='a';d.pads[1].x=26;d.pads[1].y=7.5;
  d.keepouts=[{x:15,y:10,w:6,h:6}];
  const why=forensicWhy(d,null);
  assert.ok(why.fails.flatMap(n=>n.edges).flatMap(e=>e.blockers).some(b=>b.kind==='keepout'));
});

const pixel=(img,x,y)=>Array.from(img.px.slice((y*img.width+x)*4,(y*img.width+x)*4+3));
const background=[0,16,35], gold=[227,183,46], green=[94,232,140], red=[200,82,82];
const board=()=>({...core.designDefaults(),width:12,height:12});

for(const name of ['QFP-32','QFN-48']) test(name+' pads point outwards and have positive gaps',()=>{
  const pads=core.footprintPads(name), per=pads.length/4;
  assert.equal(pads.length,Number(name.slice(4)));
  for(let i=0;i<pads.length;i++){
    const p=pads[i];
    assert.equal(p.layer,'top');
    assert.ok(i<per||i>=2*per&&i<3*per?p.w>p.h:p.h>p.w);
    for(let j=i+1;j<pads.length;j++)
      assert.ok(core.padGap({...p,x:p.dx,y:p.dy},{...pads[j],x:pads[j].dx,y:pads[j].dy})>0,
        'pads '+(i+1)+' and '+(j+1)+' must not touch');
  }
  assert.ok(pads[0].dx<0&&pads[0].dy<0,'pin 1 is upper left');
});

test('named footprint counts reject malformed, fractional and oversized input before loops',()=>{
  // Isolate the old SOIC-Infinity infinite loop so a regression fails rather than hanging the suite.
  const url=new URL('../src/engine.mjs',import.meta.url).href;
  const script=`import {footprintPads} from ${JSON.stringify(url)};
    for(const name of ['SOIC-Infinity','SOIC-1000000000','QFP-1000000000','BGA-1000000000']){
      let rejected=false;try{footprintPads(name);}catch{rejected=true;}
      if(!rejected) process.exit(2);
    }`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',script],{timeout:3000,encoding:'utf8'});
  assert.equal(child.status,0,child.error?.message||child.stderr);
  for(const name of ['SOIC-8junk','SOIC-7','SOIC-8.5','QFP-32junk','QFN-0','QFP-6','BGA--4','BGA-4.5'])
    assert.throws(()=>core.footprintPads(name),undefined,name);
  assert.throws(()=>core.footprintPads('DIP-N',Infinity));
  assert.equal(core.footprintPads('SOIC-2000').length,2000);
  assert.equal(core.footprintPads('QFP-2000').length,2000);
  assert.equal(core.footprintPads('BGA-2000').length,2000);
  assert.equal(core.footprintPads('排针 1×N',1e9).length,2000);
});

test('render rejects nonpositive/nonfinite dimensions and scale before allocation',()=>{
  for(const width of [0,-1,NaN,Infinity]) assert.throws(()=>core.renderBoardPixels({...board(),width},null),/pixels/);
  for(const height of [0,-1,NaN,Infinity]) assert.throws(()=>core.renderBoardPixels({...board(),height},null),/pixels/);
  for(const scale of [0,-1,NaN,Infinity]) assert.throws(()=>core.renderBoardPixels(board(),null,{scale}),/pixels/);
  assert.throws(()=>core.renderBoardPixels({...board(),width:1e9},null),/pixels/);
});

for(const scale of [0.5,2,8]) test('circle and trace radii remain physical millimetres at scale '+scale,()=>{
  const d=board();
  d.pads=[{id:'P',netId:'a',x:4,y:4,w:4,h:4,shape:'circle',layer:'top'}];
  const r={nets:[{netId:'a',paths:[[{x:4,y:8,l:0},{x:8,y:8,l:0}]],vias:[]}]};
  d.nets=[{id:'a',name:'DATA',w:4}];
  const img=core.renderBoardPixels(d,r,{scale});
  for(let y=0;y<img.height;y++) for(let x=0;x<img.width;x++){
    const px=(x+0.5)/scale, py=(y+0.5)/scale;
    const discInside=Math.hypot(px-4,py-4)<=2;
    const traceInside=Math.hypot(px-Math.max(4,Math.min(8,px)),py-8)<=2;
    assert.deepEqual(pixel(img,x,y),discInside?gold:traceInside?red:background,`pixel ${x},${y}`);
  }
});

test('highlight resolves both names and ids and preserves circular pad/hole geometry',()=>{
  const d=board();d.nets=[{id:'a',name:'DATA'}];
  d.pads=[{id:'P',netId:'a',x:4,y:4,w:4,h:4,shape:'circle',layer:'both',holeR:0.5}];
  const plain=core.renderBoardPixels(d,null,{scale:8});
  const byName=core.renderBoardPixels(d,null,{scale:8,highlightNet:' DATA '});
  const byId=core.renderBoardPixels(d,null,{scale:8,highlightNet:'a'});
  assert.deepEqual(byName.px,byId.px);
  assert.deepEqual(pixel(plain,32,24),gold);
  assert.deepEqual(pixel(byName,32,24),green);
  assert.deepEqual(pixel(byName,32,32),[13,17,23]);
  assert.deepEqual(pixel(byName,46,46),background,'circle corner stays outside highlight');
  assert.deepEqual(core.renderBoardPixels(d,null,{scale:8,highlightNet:'missing'}).px,plain.px);
});

function chunks(png){
  assert.deepEqual(Array.from(png.subarray(0,8)),[137,80,78,71,13,10,26,10]);
  const out=[];
  for(let pos=8;pos<png.length;){
    const size=png.readUInt32BE(pos), type=png.toString('ascii',pos+4,pos+8);
    out.push({type,data:png.subarray(pos+8,pos+8+size)});pos+=size+12;
    assert.ok(pos<=png.length);
  }
  return out;
}

test('PNG encodes an offset view byte-for-byte, with RGBA row filters',()=>{
  const backing=Buffer.alloc(40,0xee), rgba=backing.subarray(5,21);
  for(let i=0;i<rgba.length;i++) rgba[i]=i*13;
  const out=chunks(pngEncode(2,2,rgba));
  assert.deepEqual(out.map(c=>c.type),['IHDR','IDAT','IEND']);
  assert.equal(out[0].data.readUInt32BE(0),2);assert.equal(out[0].data.readUInt32BE(4),2);
  assert.deepEqual(Array.from(inflateSync(out[1].data)),[0,...rgba.subarray(0,8),0,...rgba.subarray(8)]);
});

test('PNG rejects invalid dimensions and truncated views without reading adjacent backing bytes',()=>{
  for(const [w,h] of [[0,1],[1,0],[-1,1],[1.5,1],[NaN,1],[Infinity,1],[100000,100000],[1,0x80000000]])
    assert.throws(()=>pngEncode(w,h,new Uint8Array()),/dimensions/);
  const backing=new Uint8Array(32).fill(0xab);
  for(const rgba of [backing.subarray(0,3),backing.subarray(8,11),new Uint16Array(2),[],null,new DataView(backing.buffer)])
    assert.throws(()=>pngEncode(1,1,rgba),/RGBA/);
});

test('new CLI flags retain scope, negative coordinates, duplicates and terminator semantics',()=>{
  const parsed=parseArguments('fp',['QFN-48','--x','-12.5','--y','5000','--prefix','U2']);
  assert.deepEqual(parsed.args,['QFN-48']);assert.equal(parsed.options.get('--x'),'-12.5');
  for(const cmd of ['route','place']){
    assert.equal(parseArguments(cmd,['--save-design','board.json']).options.get('--save-design'),true);
    assert.throws(()=>parseArguments(cmd,['--save-design','--save-design']),/Duplicate/);
  }
  for(const value of ['NaN','Infinity','-5000.01','5000.01','']) assert.throws(()=>parseArguments('fp',['--x',value]));
  assert.throws(()=>parseArguments('fp',['--x','--prefix','U']),/Missing value/);
  assert.throws(()=>parseArguments('render',['--save-design']),/Unknown option/);
  assert.throws(()=>parseArguments('route',['--x','1']),/Unknown option/);
  assert.deepEqual(parseArguments('fp',['--','--x']).args,['--x']);
});

test('near-duplicate cleanup preserves endpoints and both exact layer-transition twins',()=>{
  const p=(x,y,l)=>({x,y,l});
  for(const path of [
    [p(2,2,0),p(2.00005,2,0),p(2.00005,2,1),p(5,2,1)],
    [p(2,2,0),p(2.00005,2,0)]
  ]){
    const original=structuredClone(path);
    const r={nets:[{netId:'a',vias:[],paths:[path]}],stats:{}};
    core.beautifyResult(board(),r);
    const out=r.nets[0].paths[0];
    assert.deepEqual(out[0],original[0]);
    assert.deepEqual(out.at(-1),original.at(-1));
    for(let i=1;i<out.length;i++) if(out[i].l!==out[i-1].l){
      assert.equal(out[i].x,out[i-1].x,'layer change must not acquire an XY displacement');
      assert.equal(out[i].y,out[i-1].y);
    }
  }
});

test('worker reroute beautifies and returns the same normalized design as the captured model',()=>{
  const source=readFileSync(new URL('../src/route-worker.js',import.meta.url),'utf8').replace(/^import[^\n]*\n/,'');
  const messages=[], self={postMessage(m){messages.push(structuredClone(m));}};
  vm.runInNewContext(source,{...core,self});
  const d={...board(),nets:[{id:'a'}],pads:[
    {id:'P1',netId:'a',x:2.25,y:2.25,w:1,h:1,shape:'rect',layer:'top'},
    {id:'P2',netId:'a',x:9.25,y:9.25,w:1,h:1,shape:'rect',layer:'top'}]};
  self.onmessage({data:{id:1,command:'route',design:d,options:{optimize:false,maxIter:2,beautify:false}}});
  const initial=messages.findLast(m=>m.id===1&&m.type!=='progress');
  assert.equal(initial.type,'result',initial.error);
  const minimal=structuredClone(initial.design);
  for(const [key,value] of Object.entries(core.designDefaults()))
    if(JSON.stringify(minimal[key])===JSON.stringify(value)) delete minimal[key];
  minimal.nets[0].name=undefined;
  self.onmessage({data:{id:2,command:'reroute',design:minimal,netId:'a'}});
  const rerouted=messages.findLast(m=>m.id===2&&m.type!=='progress');
  assert.equal(rerouted.type,'result',rerouted.error);
  assert.deepEqual(rerouted.design,initial.design);
  assert.ok(Number.isFinite(rerouted.result.stats.trackLen));
});
