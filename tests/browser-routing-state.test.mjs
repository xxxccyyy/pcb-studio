// Real browser/Worker coverage for preserving partial results when cancelling.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createPreviewServer} from '../server.mjs';
import {designDefaults} from '../src/engine.mjs';
const {chromium}=await import(process.env.PCB_PLAYWRIGHT_MODULE?pathToFileURL(process.env.PCB_PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true}),server=createPreviewServer();
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const d=designDefaults();d.width=20;d.height=15;d.layers=1;
d.nets=[{id:'a',name:'A'}];
d.pads=[{id:'P1',netId:'a',x:3,y:7.5,w:1,h:1,shape:'rect',layer:'top'},
  {id:'P2',netId:'a',x:17,y:7.5,w:1,h:1,shape:'rect',layer:'top'}];
d.keepouts=[{x:10,y:7.5,w:2,h:15}];
let checks=0;
try{
  for(const url of [`http://127.0.0.1:${server.address().port}`,new URL('../index.html',import.meta.url).href]){
    const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url);await page.waitForFunction(()=>window.__pcbApp?.design);
    await page.evaluate(()=>{const Native=window.Worker;window.__workerCount=0;
      window.Worker=class extends Native{constructor(...args){super(...args);window.__workerCount++;}};});
    await page.locator('#fileInput').setInputFiles({name:'partial.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({design:d}))});
    await page.waitForFunction(()=>window.__pcbApp.design.nets[0]?.id==='a');
    // Fixture configuration lives in the collapsed parameters panel; set its real controls.
    await page.evaluate(()=>{document.getElementById('rIter').value='2';document.getElementById('rOptimize').checked=false;});
    for(const cancel of ['stop','quickStop','escape']){
      await page.locator('#btnRoute').click();
      await page.waitForFunction(()=>!window.__pcbApp.routing&&window.__pcbApp.result,{},{timeout:60000});
      const initial=await page.evaluate(()=>({session:window.__pcbApp.session,stats:window.__pcbApp.result.stats}));
      assert.equal(initial.session,true);assert.ok(initial.stats.connected<initial.stats.total,'fixture must really be partial');
      const immediate=await page.evaluate(cancel=>{
        const app=window.__pcbApp;window.__keptResult=app.result;window.__keptDesign=app.design;
        window.__workersBefore=window.__workerCount;
        document.getElementById('btnShape').click();const running=app.routing;
        if(cancel==='escape')window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
        else document.getElementById(cancel==='stop'?'btnStop':'quickStop').click();
        return {running,session:app.session};
      },cancel);
      assert.equal(immediate.running,true);assert.equal(immediate.session,null);
      await page.waitForFunction(()=>!window.__pcbApp.routing);
      const final=await page.evaluate(()=>({sameResult:window.__pcbApp.result===window.__keptResult,
        sameDesign:window.__pcbApp.design===window.__keptDesign,session:window.__pcbApp.session,
        stop:document.getElementById('btnStop').disabled,message:document.querySelector('.toast').textContent}));
      assert.equal(final.sameResult,true);assert.equal(final.sameDesign,true);assert.equal(final.session,null);
      assert.equal(final.stop,true);assert.match(final.message,/已停止形状补线/);
      await page.locator('[data-a=reroute]').first().click();
      assert.equal(await page.evaluate(()=>window.__workerCount===window.__workersBefore),true,'must not create a sessionless worker');
      assert.match(await page.locator('.toast').textContent(),/请先执行一次自动布线/);
      checks++;console.log('✓ real worker shape cancellation preserves partial result: '+cancel+' '+new URL(url).protocol);
    }
    assert.deepEqual(errors,[]);await page.close();
  }
  console.log('Routing-state browser QA: '+checks+' checks passed.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
