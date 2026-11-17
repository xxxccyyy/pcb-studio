import assert from 'node:assert/strict';
import test from 'node:test';
import { parseServeOptions } from '../exe/serve-options.mjs';

test('serve accepts explicit/implicit mode, equal-sign values and the full port range',()=>{
  assert.deepEqual(parseServeOptions([]),{port:8931,noOpen:false,sessionDir:null});
  assert.deepEqual(parseServeOptions(['serve','--port=0','--session-dir','a=b','--no-open']),{port:0,noOpen:true,sessionDir:'a=b'});
  assert.equal(parseServeOptions(['--port','65535']).port,65535);
});
test('serve rejects malformed, missing, duplicated and unknown options before listening',()=>{
  for(const args of [['--port'],['--port','--no-open'],['--port','-1'],['--port','1.5'],['--port','65536'],['--port','Infinity'],['--port','0x10'],['--session-dir'],['--session-dir='],['--no-open=true'],['--port=1','--port=2'],['--typo']]){
    assert.throws(()=>parseServeOptions(args),undefined,JSON.stringify(args));
  }
});
