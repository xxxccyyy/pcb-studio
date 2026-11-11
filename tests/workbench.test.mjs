// Visual / interaction regression for the PCB Studio workbench.
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { createPreviewServer } from '../server.mjs';
const {chromium}=await import(process.env.PCB_PLAYWRIGHT_MODULE?pathToFileURL(process.env.PCB_PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true});
const server=createPreviewServer();
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}`;
const output=new URL('../docs/workbench/',import.meta.url);
await mkdir(output,{recursive:true});
let checks=0;
const check=msg=>{checks++;console.log('✓ '+msg);};
try{
  const page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:1.5});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.waitForFunction(()=>window.__pcbApp?.design);
  assert.deepEqual(await page.evaluate(()=>{const ids=[...document.querySelectorAll('[id]')].map(e=>e.id);return ids.filter((id,i)=>ids.indexOf(id)!==i);}),[]);
  check('all legacy controls and new workbench controls have unique IDs');
  await page.locator('#zoomFit').click();
  const scale=await page.evaluate(()=>window.__pcbApp.view.scale);
  await page.locator('#zoomIn').click();
  assert.ok(await page.evaluate(()=>window.__pcbApp.view.scale)>scale);
  await page.locator('#zoomOut').click();
  assert.ok(Math.abs(await page.evaluate(()=>window.__pcbApp.view.scale)-scale)<1e-6);
  await page.keyboard.press('1');assert.equal(await page.evaluate(()=>window.__pcbApp.view.scale),10);
  await page.keyboard.press('f');
  check('zoom controls and 1/F shortcuts change the real canvas transform');
  for(const [key,tool] of [['p','pad'],['r','route'],['k','keepout'],['x','delete'],['h','pan'],['v','select']]){
    await page.keyboard.press(key);assert.equal(await page.evaluate(()=>window.__pcbApp.tool),tool);
    assert.equal(await page.locator(`[data-tool="${tool}"]`).getAttribute('aria-pressed'),'true');
  }
  await page.locator('#newNetName').fill('RPKVX');assert.equal(await page.evaluate(()=>window.__pcbApp.tool),'select');
  await page.locator('#newNetName').fill('');await page.locator('#newNetName').blur();
  check('tool shortcuts update active buttons without stealing text input');
  for(const [view,id] of [['top','vTop'],['bottom','vBottom'],['rats','vRats'],['grid','vGrid']]){
    await page.locator(`[data-view="${view}"]`).click();
    assert.equal(await page.evaluate(v=>window.__pcbApp.show[v],view),false);
    assert.equal(await page.locator('#'+id).isChecked(),false);
    await page.locator('#'+id).check();
    await page.waitForFunction(v=>document.querySelector(`[data-view="${v}"]`).getAttribute('aria-pressed')==='true',view);
  }
  check('canvas layer shortcuts and inspector visibility checkboxes stay in sync');
  await page.locator('#activeLayer').selectOption('bottom');await page.locator('#activeLayer').blur();assert.equal(await page.evaluate(()=>window.__pcbApp.drawLayer),1);
  await page.locator('[data-tool="route"]').click();assert.equal(await page.evaluate(()=>window.__pcbApp.tool),'route');await page.keyboard.press('l');
  assert.equal(await page.locator('#activeLayer').inputValue(),'top');
  await page.keyboard.press('v');
  check('active-layer select and L layer switching share the same state');
  const before=await page.locator('#canvasWrap').boundingBox();
  await page.locator('#focusCanvas').click();
  await page.waitForFunction(()=>document.body.classList.contains('canvas-focus'));
  await page.waitForFunction(()=>Math.abs(document.querySelector('#cv').width-document.querySelector('#canvasWrap').clientWidth*devicePixelRatio)<2);
  const after=await page.locator('#canvasWrap').boundingBox();assert.ok(after.width>before.width+400);
  await page.keyboard.press('Tab');assert.equal(await page.locator('body').evaluate(e=>e.classList.contains('canvas-focus')),false);
  check('focus mode reflows and resizes the high-DPI canvas without stale dimensions');
  await page.keyboard.press('h');
  const pos=await page.evaluate(()=>({...window.__pcbApp.view}));
  const box=await page.locator('#cv').boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+50,box.y+box.height/2+30,{steps:5});await page.mouse.up();
  assert.ok(Math.abs(await page.evaluate(()=>window.__pcbApp.view.ox)-pos.ox-50)<2);
  await page.keyboard.press('v');await page.keyboard.press('f');
  check('hand tool pans the viewport independently of board objects');
  const pad=await page.evaluate(()=>{const p=window.__pcbApp.design.pads[0],v=window.__pcbApp.view,r=document.getElementById('cv').getBoundingClientRect();return {x:p.x,y:p.y,sx:r.left+v.ox+p.x*v.scale,sy:r.top+v.oy+p.y*v.scale,step:v.scale*1.5};});
  await page.mouse.move(pad.sx,pad.sy);await page.mouse.down();await page.mouse.move(pad.sx+pad.step,pad.sy+pad.step,{steps:5});await page.mouse.up();
  assert.ok(await page.evaluate(()=>window.__pcbApp.design.pads[0].x)!==pad.x);
  await page.keyboard.press('Control+z');
  assert.equal(await page.evaluate(()=>window.__pcbApp.design.pads[0].x),pad.x);
  check('pad dragging updates geometry without crashing and remains undoable');
  await page.locator('#quickRoute').click();await page.waitForFunction(()=>window.__pcbApp.routing);
  assert.equal(await page.locator('#quickRoute').isDisabled(),true);assert.equal(await page.locator('#quickStop').isVisible(),true);
  await page.locator('#quickStop').click();await page.waitForFunction(()=>!window.__pcbApp.routing);
  check('quick routing controls expose progress and cancel the actual worker');
  await page.locator('#quickRoute').click();await page.waitForFunction(()=>!window.__pcbApp.routing&&window.__pcbApp.result,{},{timeout:60000});
  assert.equal(await page.evaluate(()=>window.__pcbApp.result.status),'complete');
  assert.equal(await page.evaluate(()=>window.__pcbApp.result.drcErrors),0);
  await page.locator('#quickDrc').click();
  check('redesigned workbench still routes and validates the sample without DRC errors');
  await page.waitForFunction(()=>!document.getElementById('toast').classList.contains('show'));
  for(const [width,height] of [[1600,1000],[1920,1080],[1100,800],[800,900],[390,844]]){
    await page.setViewportSize({width,height});await page.locator('#zoomFit').click();
    await page.waitForFunction(()=>Math.abs(document.querySelector('#cv').width-document.querySelector('#canvasWrap').clientWidth*devicePixelRatio)<2);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const bounds=await page.locator('#canvasWrap').boundingBox();assert.ok(bounds.width>250,JSON.stringify(bounds));
    await page.screenshot({path:fileURLToPath(new URL(`${width}.png`,output))});
    check(`layout stays contained and canvas renders at ${width}×${height}`);
  }
  await page.locator('#inspectorToggle').click();assert.equal(await page.locator('.inspector-sidebar').isVisible(),true);
  await page.locator('#focusCanvas').click();assert.equal(await page.locator('.inspector-sidebar').isVisible(),false);
  assert.ok((await page.locator('#canvasWrap').boundingBox()).width>350);
  await page.locator('#focusCanvas').click();assert.equal(await page.locator('.inspector-sidebar').isVisible(),true);
  await page.locator('#inspectorToggle').click();
  check('focus mode overrides mobile inspector layout and restores the previous panel state');
  assert.deepEqual(errors,[]);await page.close();
  console.log(`Workbench QA: ${checks} checks passed.`);
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
