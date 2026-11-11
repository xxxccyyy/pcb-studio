// Optional browser QA. Supply PCB_PLAYWRIGHT_MODULE when Playwright is not on the module path.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { createPreviewServer } from '../server.mjs';
import { EXAMPLES } from '../src/engine.mjs';
const {chromium}=await import(process.env.PCB_PLAYWRIGHT_MODULE?pathToFileURL(process.env.PCB_PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true});
const server=createPreviewServer();
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let passed=0;
const check=message=>{passed++;console.log('✓ '+message);};
try{
  for(const url of [`http://127.0.0.1:${server.address().port}`,new URL('../index.html',import.meta.url).href]){
    const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(url);await page.waitForFunction(()=>window.__pcbApp?.design);
    check('startup '+new URL(url).protocol);
    await page.evaluate(()=>{window.__ticks=0;window.__timer=setInterval(()=>window.__ticks++,10);});
    await page.locator('#btnRoute').click();
    await page.waitForFunction(()=>window.__pcbApp.routing);
    assert.equal(await page.locator('#btnNew').isDisabled(),true);
    await page.waitForFunction(()=>!window.__pcbApp.routing,{},{timeout:60000});
    const outcome=await page.evaluate(()=>({status:window.__pcbApp.result?.status,errors:window.__pcbApp.result?.drcErrors,ticks:window.__ticks}));
    assert.equal(outcome.status,'complete');assert.equal(outcome.errors,0);assert.ok(outcome.ticks>5,JSON.stringify(outcome));
    check('routing keeps the browser responsive and returns a DRC-clean result');
    await page.locator('[data-a=reroute]').first().click();
    await page.waitForFunction(()=>!window.__pcbApp.routing&&document.querySelector('.toast').textContent.includes('单独重布'));
    assert.equal(await page.evaluate(()=>!!window.__pcbApp.session),true);
    check('persistent worker supports single-net rerouting');
    await page.locator('#btnRoute').click();await page.locator('#btnStop').click();
    await page.waitForFunction(()=>!window.__pcbApp.routing);
    assert.equal(await page.locator('#btnRoute').isEnabled(),true);
    assert.equal(await page.locator('#btnNew').isEnabled(),true);
    check('Stop cancels a running search and restores controls');
    // Intercept a real worker progress message to stop specifically during optimization.
    await page.evaluate(()=>{
      const Native=window.Worker;
      window.Worker=class extends Native{
        constructor(...args){super(...args);this.addEventListener('message',event=>{
          if(event.data.type==='progress'&&event.data.text.startsWith('逐网优化')){
            window.__cancelledOptimization=true;document.getElementById('btnStop').click();
          }
        });}
      };
    });
    await page.locator('#btnRoute').click();
    await page.waitForFunction(()=>window.__cancelledOptimization&&!window.__pcbApp.routing,{},{timeout:60000});
    assert.equal(await page.evaluate(()=>window.__pcbApp.result),null);
    check('cancellation during optimization discards late results');
    await page.reload();await page.waitForFunction(()=>window.__pcbApp?.design);
    page.once('dialog',dialog=>dialog.accept());
    await page.locator('#btnAutopcb').click();
    await page.waitForFunction(()=>window.__pcbApp.routing);
    await page.waitForFunction(()=>!window.__pcbApp.routing,{},{timeout:60000});
    assert.equal(await page.evaluate(()=>window.__pcbApp.result?.status),'complete');
    check('automatic placement and routing complete in the background');
    const d=EXAMPLES[0].build();d.nets[0].name='<img src=x onerror="window.__injected=true">';
    d.pads[1].y=d.pads[0].y+2.54;
    await page.locator('#fileInput').setInputFiles({name:'literal.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({design:d}))});
    await page.waitForFunction(()=>window.__pcbApp.design.nets[0].name.startsWith('<img'));
    assert.equal(await page.locator('#netList img').count(),0);
    assert.equal(await page.evaluate(()=>window.__injected),undefined);
    assert.ok(Math.abs(await page.evaluate(()=>window.__pcbApp.design.pads[1].y-window.__pcbApp.design.pads[0].y)-2.54)<1e-8);
    check('import preserves pad pitch and renders names as literal text');
    const before=await page.evaluate(()=>JSON.stringify(window.__pcbApp.design));
    await page.locator('#fileInput').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{"design":{"grid":0}}')});
    await page.waitForFunction(()=>document.querySelector('.toast').textContent.includes('失败'));
    assert.equal(await page.evaluate(()=>JSON.stringify(window.__pcbApp.design)),before);
    check('malformed import leaves the active project intact');
    assert.deepEqual(errors,[]);await page.close();
  }
  console.log(`Browser QA: ${passed} checks passed.`);
}finally{
  await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
