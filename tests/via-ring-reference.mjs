// Same current engine with only via-ring memoization disabled. No historical
// algorithm copy: coordinate/correctness fixes are automatically shared.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
export const engineSource=readFileSync(new URL('../src/engine.mjs',import.meta.url),'utf8');
export async function uncachedEngine(){
  const needle='const viaRingPenalty=NC<=1_000_000?';
  assert.equal(engineSource.split(needle).length,2,'cache gate must remain identifiable');
  const source=engineSource.replace(needle,'const viaRingPenalty=false?');
  return import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
}
export const cleanResult=result=>JSON.parse(JSON.stringify(result,(k,v)=>k==='timeMs'?undefined:v));
