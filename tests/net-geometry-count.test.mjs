import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as core from '../src/engine.mjs';

const source=readFileSync(new URL('../src/engine.mjs',import.meta.url),'utf8');
const start=source.indexOf('function countNetSegmentViolations(');
const end=source.indexOf('\nfunction routeBoardShape(',start);
assert.ok(start>=0&&end>start);
const count=vm.runInNewContext(source.slice(start,end)+'\ncountNetSegmentViolations;',{...core});
const reference=(d,entry,rest)=>core.auditGeometry(d,{nets:[entry,...rest]}).length
  -core.auditGeometry(d,{nets:rest}).length;
const line=(netId,x,y,dx,dy,l=0)=>({netId,paths:[[{x,y,l},{x:x+dx,y:y+dy,l}]],vias:[]});

test('candidate geometry count preserves manual, layer, zero-length and mixed-width semantics',()=>{
  const d=core.designDefaults();d.layers=4;d.trackW=.2;
  d.nets=[{id:'a',w:.2},{id:'b',w:2},{id:'c',w:.4}];
  const entry=line('a',5,5,0,1);
  entry.paths.push([{x:5,y:5,l:0},{x:5,y:5,l:1}],[],[{x:2,y:2,l:0},{x:2,y:2,l:0}]);
  const rest=[line('c',5.5,10,0,1),line('b',6,5,0,1),line('b',5,5,0,1,3)];
  d.manual=[{netId:'a',pts:entry.paths[0]},{netId:'c',pts:[{x:4,y:5.5,l:0},{x:7,y:5.5,l:0}]}];
  assert.equal(reference(d,entry,rest),2);
  assert.equal(count(d,entry,rest),2);
  assert.equal(count(d,{netId:'a',paths:[]},rest),0);
});

test('candidate geometry counts exactly match whole-board audit differences on seeded cases',()=>{
  let seed=137;
  const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let run=0;run<160;run++){
    const d=core.designDefaults();d.layers=4;d.clearance=.05+rnd()*.3;
    const ids=run%2?['a','b','c','d','e','f']:[1,2,3,4,5,6];
    d.nets=ids.map((id,i)=>({id,w:[.1,.2,.5,1,2,4][i]}));
    const nets=ids.map(id=>({netId:id,paths:[],vias:[]}));
    for(let i=0;i<60;i++){
      const x=Math.floor(rnd()*12)/2,y=Math.floor(rnd()*12)/2,l=Math.floor(rnd()*4);
      const path=line(ids[i%ids.length],x,y,(rnd()-.5)*5,(rnd()-.5)*5,l).paths[0];
      if(i%13===0)path[1]={...path[0]};
      if(i%17===0)path[1].l=(l+1)%4;
      if(i%11===0)path.reverse();
      nets[i%ids.length].paths.push(path);
    }
    d.manual=[{netId:ids[0],pts:line(ids[0],2,2,3,0).paths[0]},
      {netId:ids[1],pts:line(ids[1],0,3,6,0).paths[0]}];
    for(const entry of nets){
      const rest=nets.filter(n=>n.netId!==entry.netId);
      assert.equal(count(d,entry,rest),reference(d,entry,rest),'case '+run+' net '+entry.netId);
    }
  }
});

test('candidate geometry count respects exact clearance thresholds',()=>{
  const d=core.designDefaults();d.nets=[{id:'a',w:.2},{id:'b',w:2}];d.clearance=.2;
  const entry=line('a',1,1,4,0);
  for(const gap of [1.3,1.3-1e-8,1.3+1e-8]){
    const rest=[line('b',1,1+gap,4,0)];
    assert.equal(count(d,entry,rest),reference(d,entry,rest));
  }
});
