// Real browser + HTTP bridge integration (no visible browser, no routing).
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createBridgeServer, listenBridge } from '../exe/bridge.mjs';
import { EXAMPLES } from '../src/engine.mjs';
const {chromium}=await import(process.env.PCB_PLAYWRIGHT_MODULE?pathToFileURL(process.env.PCB_PLAYWRIGHT_MODULE).href:'playwright');
const sessionDir=mkdtempSync(join(tmpdir(),'pcb-browser-bridge-'));
const bridge=createBridgeServer({indexHtml:readFileSync(new URL('../index.html',import.meta.url),'utf8'),version:'test',sessionDir,token:'browser-test',selfScript:null});
let browser;
try{
  const port=await listenBridge(bridge.server,0);bridge.setPort(port);
  const base=`http://127.0.0.1:${port}`;
  const api=async(path,body)=>{
    const response=await fetch(base+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});
    assert.ok(response.ok,`${path}: ${response.status}`);return response.json();
  };
  const design=EXAMPLES[0].build();design.width=75;
  await api('/api/load',{design,name:'browser integration'});
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage();const errors=[];let posts=0;
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',req=>{if(req.method()==='POST'&&/\/api\/ui-(state|screenshot)$/.test(req.url()))posts++;});
  await page.addInitScript(()=>{Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Storage disabled','SecurityError');}});});
  await page.goto(base);
  await page.waitForFunction(()=>window.__pcbBridge?.connected&&window.__pcbApp.design.width===75);
  await page.waitForFunction(async()=>{const s=await fetch('/api/state').then(r=>r.json());return s.uiState?.design?.width===75;});
  console.log('✓ browser bridge bootstraps server design even with storage disabled');
  const updated=structuredClone(design);updated.width=90;
  await api('/api/load',{design:updated,name:'SSE update'});
  await page.waitForFunction(()=>window.__pcbApp.design.width===90);
  console.log('✓ real SSE load updates the visible project');
  const chip=page.getByText('⬤ AI 桥',{exact:true});await chip.click();
  const before=posts;
  await page.evaluate(()=>{window.__pcbBridge.push();window.__pcbBridge.applyView({fit:true});});
  // Wait longer than both debounce windows; this is an explicit negative assertion.
  await page.waitForTimeout(2300);
  assert.equal(posts,before,'opt-out must stop both state and forced screenshot uploads');
  assert.deepEqual(errors,[]);
  console.log('✓ real browser opt-out prevents queued/forced uploads with no uncaught errors');
}finally{
  if(browser)await browser.close();
  bridge.server.closeAllConnections();await new Promise(resolve=>bridge.server.close(resolve));
  rmSync(sessionDir,{recursive:true,force:true});
}
