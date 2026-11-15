import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as core from '../src/engine.mjs';
import {searchCases,runSearchCase} from './search-cases.mjs';

// Keep search-baseline.json as the historical allocating-search reference. The
// corrected row/column cost model intentionally changes some negotiated routes;
// its golden was recorded twice and is guarded separately by a coordinate oracle.
const baseline=JSON.parse(readFileSync(new URL('./search-neighborhood-baseline.json',import.meta.url),'utf8'));
const digest=s=>createHash('sha256').update(s).digest('hex');
for(const fixture of searchCases(core)) test('A* preserves corrected-neighborhood baseline: '+fixture.name,()=>{
  assert.deepEqual(runSearchCase(core,fixture,digest),baseline.cases[fixture.name]);
});

test('via map is cleared when restoring a no-via snapshot, then rebuilt on reroute',()=>{
  const d=core.designDefaults();
  Object.assign(d,{width:20,height:14,layers:2});
  d.nets=[{id:'a',name:'A'}];
  d.pads=[{id:'p1',netId:'a',x:3.25,y:6.25,w:1,h:1,shape:'circle',layer:'top'},
    {id:'p2',netId:'a',x:16.25,y:6.25,w:1,h:1,shape:'circle',layer:'bottom'}];
  const s=core.createSession(d,{}),empty=s.snapshot();
  while(!s.step().done){}
  const {timeMs,...before}=s.buildResult();
  assert.ok(before.stats.vias>0);
  const occupied=s.snapshot();
  s.restore(empty);
  assert.equal(s.buildResult().stats.vias,0);
  s.restore(empty); // Repeated empty rebuild must be harmless.
  assert.equal(s.rerouteSingle('a').ok,true);
  const {timeMs:ignored,...after}=s.buildResult();
  assert.deepEqual(after,before);
  s.restore(empty);
  s.restore(occupied); // Empty -> occupied must also rebuild, not reuse cleared influence cells.
  const {timeMs:restoredTime,...restored}=s.buildResult();
  assert.deepEqual(restored,before);
  assert.equal(s.rerouteSingle('a').ok,true);
});
