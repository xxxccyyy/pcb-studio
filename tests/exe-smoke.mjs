// Run only after npm run exe on Windows. Exercises the actual SEA, not the CJS bundle.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXAMPLES } from '../src/engine.mjs';
const exe=process.argv[2]?resolve(process.argv[2]):fileURLToPath(new URL('../dist/pcb-studio.exe',import.meta.url));
const dir=mkdtempSync(join(tmpdir(),'pcb-sea-smoke-'));
const run=(args)=>{
  const child=spawnSync(exe,args,{cwd:dir,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024,windowsHide:true});
  assert.equal(child.status,0,child.error?.message||child.stdout+child.stderr);
  const data=JSON.parse(child.stdout);assert.equal(data.ok,true,child.stdout);return data;
};
try{
  run(['schema']);console.log('✓ actual SEA schema argument dispatch');
  assert.equal(run(['fp','QFP-32','--x','12','--prefix','U1']).pads.length,32);
  console.log('✓ actual SEA parameterized footprint command');
  const invalid=spawnSync(exe,['serve','--port','1.5','--no-open'],{cwd:dir,encoding:'utf8',timeout:10000,windowsHide:true});
  assert.equal(invalid.status,1,invalid.error?.message);console.log('✓ actual SEA rejects invalid serve flags before listening');
  writeFileSync(join(dir,'design.json'),JSON.stringify(EXAMPLES[0].build()));
  run(['route','design.json','-o','result.json','--parallel','2']);
  assert.ok(JSON.parse(readFileSync(join(dir,'result.json'),'utf8')).nets.length>0);
  console.log('✓ actual SEA parallel routing loads private extracted engine source');
  run(['render','design.json','result.json','-o','board.png','--scale','8']);
  assert.deepEqual([...readFileSync(join(dir,'board.png')).subarray(0,8)],[137,80,78,71,13,10,26,10]);
  console.log('✓ actual SEA render writes a valid PNG');
}finally{rmSync(dir,{recursive:true,force:true});}
