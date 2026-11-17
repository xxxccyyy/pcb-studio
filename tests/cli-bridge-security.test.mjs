import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, symlinkSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { main, safeSessionPath, validateCliInvocation, writeFileSync as atomicWrite } from '../ai/pcb.mjs';
import { createBridgeServer, listenBridge } from '../exe/bridge.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = join(root, 'ai', 'pcb.mjs');
const design = { width:20, height:15, grid:0.5, layers:2, trackW:0.3, clearance:0.3, viaOuter:0.6, viaDrill:0.3,
  nets:[{id:'N',pads:['J1-1','J2-1']}], pads:[{id:'J1-1',netId:'N',x:4,y:4,w:1,h:1},{id:'J2-1',netId:'N',x:16,y:10,w:1,h:1}] };
const temp = () => mkdtempSync(join(tmpdir(), 'pcb-security-'));
async function run(script, args, dir, input) {
  const child=spawn(process.execPath,[script,...args],{cwd:dir,env:{...process.env,PCB_SESSION_DIR:dir,PCB_CLI_SESSION_DIR:dir},stdio:['pipe','pipe','pipe']});
  let out='',err=''; child.stdout.on('data',c=>out+=c); child.stderr.on('data',c=>err+=c);
  child.stdin.end(input); const [code]=await once(child,'close'); return {code,out,err};
}
function http(port,path='/',headers={},data) {
  return new Promise((ok,bad)=>{
    const req=request({host:'127.0.0.1',port,path,method:data===undefined?'GET':'POST',headers},res=>{
      let raw='';res.setEncoding('utf8');res.on('data',c=>raw+=c);res.on('end',()=>ok({status:res.statusCode,raw,json:()=>JSON.parse(raw)}));
    });req.on('error',bad); req.end(data===undefined?undefined:JSON.stringify(data));
  });
}

test('CLI validates command, arity, bounded pin counts and session paths',()=>{
  const dir=temp();
  try {
    for(const cmd of ['--eval','-e','serve','mcp','toString']) assert.throws(()=>validateCliInvocation(cmd,[],dir));
    assert.throws(()=>validateCliInvocation('spec',[],dir));
    assert.throws(()=>validateCliInvocation('fp',['hdr1','100000000'],dir));
    assert.throws(()=>validateCliInvocation('fp',['DIP-10000000'],dir));
    for(const path of ['../x.json','x.json:stream','NUL.json','nested/CON','bad.','bad ']) assert.throws(()=>safeSessionPath(dir,path));
    assert.equal(safeSessionPath(dir,'new.json'),join(dir,'new.json'));
    assert.throws(() => validateCliInvocation('spec', ['../outside.json'], dir));
    assert.throws(()=>validateCliInvocation('place',['design.json','-o','../outside.json'],dir));
    assert.throws(()=>validateCliInvocation('route',['design.json','-o','design.json'],dir));
    assert.throws(()=>validateCliInvocation('autopcb',['design.json','--result','design.json'],dir));
    assert.throws(()=>validateCliInvocation('pour',['design.json','result.json','-o','result.json'],dir));
    assert.throws(()=>validateCliInvocation('tune',['design.json','result.json','-o','design.json'],dir));
    assert.throws(()=>validateCliInvocation('export',['svg','design.json','-o','design.json'],dir));
    assert.throws(()=>validateCliInvocation('fp',['SOIC-1000000'],dir));
    if (process.platform === 'win32') assert.throws(()=>validateCliInvocation('route',['design.json','-o','DESIGN.JSON'],dir));
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('session paths reject junctions and atomic writes preserve destination on failure',()=>{
  const dir=temp(),outside=temp();
  try {
    mkdirSync(join(outside,'nested'));symlinkSync(outside,join(dir,'link'),'junction');
    assert.throws(()=>safeSessionPath(dir,'link/nested/new.json'));
    const file=join(dir,'design.json');writeFileSync(file,'original');
    assert.throws(()=>atomicWrite(file,undefined));
    assert.equal(readFileSync(file,'utf8'),'original');
    assert.deepEqual(readdirSync(dir).sort(),['design.json','link']);
    atomicWrite(file,'updated');assert.equal(readFileSync(file,'utf8'),'updated');
  } finally {rmSync(dir,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
});

test('library main is reusable and returns status without terminating host',async()=>{
  const original=process.stdout.write, chunks=[];
  process.stdout.write=function(c){chunks.push(String(c));return true;};
  try {
    assert.deepEqual(await Promise.all([main(['fp','SOIC-8','--prefix','A']),main(['fp','DIP-14','--prefix','B'])]),[0,0]);
    assert.equal(await main(['spec']),1);
  } finally {process.stdout.write=original;}
  assert.equal(JSON.parse(chunks[0]).pads[0].id,'A-1');
  assert.equal(JSON.parse(chunks[1]).pads[0].id,'B-1');
  assert.equal(JSON.parse(chunks[2]).ok,false);
});

test('CLI flushes large stdout and saves parallel-iteration design coordinates',async()=>{
  const dir=temp();
  try {
    const fp=await run(cli,['fp','hdr2','512'],dir);
    assert.equal(fp.code,0,fp.err);assert.equal(JSON.parse(fp.out).pads.length,1024);
    writeFileSync(join(dir,'design.json'),JSON.stringify(design));
    const r=await run(cli,['route','design.json','-o','result.json','--iter-workers','1','--max-iter','1','--iter-waves','1','--save-design'],dir);
    assert.equal(r.code,0,r.out+r.err);
    assert.ok(JSON.parse(readFileSync(join(dir,'design.json'),'utf8')).grid>0.5);
    assert.ok(existsSync(join(dir,'result.json')));
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('bridge rejects rebinding, cross-origin, path escape and Node command injection',async()=>{
  const dir=temp(),outside=temp();
  const bridge=createBridgeServer({indexHtml:'<head></head>',version:'test',sessionDir:dir,token:'test-token',selfScript:cli});
  const port=await listenBridge(bridge.server,0);bridge.setPort(port);
  try {
    for(const path of ['/','/api/health','/api/help','/api/state']) {
      assert.equal((await http(port,path,{Host:`evil.example:${port}`})).status,403);
      assert.equal((await http(port,path,{Origin:`https://127.0.0.1:${port}`})).status,403);
      assert.equal((await http(port,path,{'Sec-Fetch-Site':'cross-site'})).status,403);
      assert.equal((await http(port,path,{'x-pcb-token':'wrong'})).status,403);
    }
    assert.equal((await http(port,'/api/health')).status,200);
    assert.equal((await http(port,'/api/fp?name=hdr1&n=100000000')).status,400);
    assert.equal((await http(port,'/api/fp?name=SOIC-8&x=Infinity')).status,400);
    assert.equal((await http(port,'/api/fp?name=hdr1&n=nope')).status,400);
    assert.equal((await http(port,'/api/load',{}, {design,name:'result.json'})).status,400);
    assert.equal((await http(port,'/api/load',{}, {design,name:'same.json',result:{nets:[]}})).status,200);
    assert.equal((await http(port,'/api/load',{}, {design,name:'result.json',result:{nets:[]}})).status,400);
    assert.equal((await http(port,'/api/load',{}, {design,name:'../escape.json'})).status,400);
    assert.equal((await http(port,'/api/load',{}, {design:null})).status,400);
    symlinkSync(outside,join(dir,'link'),'junction');
    assert.equal((await http(port,'/api/load',{}, {design,name:'link/escape.json'})).status,400);
    assert.equal((await http(port,'/api/cmd',{}, {cmd:'--eval',args:['process.exit(0)']})).status,400);
    assert.equal((await http(port,'/api/cmd',{}, {cmd:'spec',args:['../escape.json']})).status,400);
    assert.equal((await http(port,'/api/load',{}, {design})).json().ok,true);
    const result=await http(port,'/api/cmd',{}, {cmd:'spec',args:['design.json']});
    assert.equal(result.json().ok,true,result.raw);
    assert.equal(existsSync(join(outside,'escape.json')),false);
  } finally {bridge.server.closeAllConnections();await new Promise(r=>bridge.server.close(r));rmSync(dir,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
});

test('bridge blocks interleaved mutations and recovers after cancelling worker',async()=>{
  const dir=temp();
  const bridge=createBridgeServer({indexHtml:'',version:'test',sessionDir:dir,token:'t',selfScript:cli,
    engineSrc:' ',workerSrc:'self.onmessage = () => {};'});
  const port=await listenBridge(bridge.server,0);bridge.setPort(port);
  try {
    await http(port,'/api/load',{}, {design});
    const pending=http(port,'/api/route-live',{},{});
    // Observe server acknowledgement rather than using a timing assumption.
    for(let i=0;i<100;i++) {if((await http(port,'/api/health')).json().busy)break;await new Promise(r=>setImmediate(r));}
    assert.equal((await http(port,'/api/edit',{}, {op:'set-net',net:'N',w:0.5})).status,409);
    assert.equal((await http(port,'/api/load',{}, {design})).status,409);
    assert.equal((await http(port,'/api/cmd',{}, {cmd:'schema'})).json().ok,false);
    assert.equal((await http(port,'/api/cancel',{},{})).json().ok,true);
    assert.equal((await pending).json().cancelled,true);
    assert.equal((await http(port,'/api/edit',{}, {op:'set-net',net:'N',w:0.5})).json().ok,true);
  } finally {bridge.server.closeAllConnections();await new Promise(r=>bridge.server.close(r));rmSync(dir,{recursive:true,force:true});}
});

test('MCP handles malformed JSON-RPC, rejects injected command and serializes load/undo',async()=>{
  const dir=temp();
  try {
    const runner=join(dir,'mcp-runner.mjs');
    writeFileSync(runner,`if(process.argv.length>2){const {main}=await import(${JSON.stringify(pathToFileURL(cli).href)});process.exitCode=await main();}else{const {startMcp}=await import(${JSON.stringify(new URL('../exe/mcp.mjs',import.meta.url).href)});await startMcp();}`);
    const call=(id,name,a)=>JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:a}})+'\n';
    const input='null\n{bad\n'+call(1,'pcb_load',{design})+call(2,'pcb_cmd',{cmd:'--eval',args:['throw 0']})
      +call(3,'pcb_load',{design,result:{nets:[]}})+call(4,'pcb_undo',{})+call(5,'pcb_state',{});
    const r=await run(runner,[],dir,input);assert.equal(r.code,0,r.err);
    const rows=r.out.trim().split('\n').map(JSON.parse);
    assert.ok(rows.some(x=>x.error?.code===-32600));assert.ok(rows.some(x=>x.error?.code===-32700));
    assert.equal(rows.find(x=>x.id===2).result.isError,true);
    assert.equal(JSON.parse(rows.find(x=>x.id===5).result.content[0].text).result,null);
    assert.equal(existsSync(join(dir,'_mcp-result.json')),false);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
