import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createPreviewServer } from '../server.mjs';
import { mkdir } from 'node:fs/promises';
const {chromium}=await import(process.env.PCB_PLAYWRIGHT_MODULE?pathToFileURL(process.env.PCB_PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true});
const server=createPreviewServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let checks=0;const check=s=>{checks++;console.log('✓ '+s);};
try{
  const page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.__pcbViewTest);
  const results=await page.evaluate(()=>{
    const {palette:P,renderScene}=window.__pcbViewTest, s=20;
    const d={width:40,height:28,layers:4,grid:.5,trackW:.3,viaOuter:.8,viaDrill:.3,nets:[{id:'thin',name:'SIGNAL',w:.3},{id:'thick',name:'POWER',w:1}],pads:[
      {id:'J1-1',netId:'thin',x:5,y:20,w:2,h:2,shape:'circle',layer:'both',holeR:.45},
      {id:'J1-2',netId:'thin',x:9,y:20,w:2,h:2,shape:'rect',layer:'both',holeR:0},
      {id:'U1-1',netId:'thin',x:14,y:20,w:2,h:1,shape:'rect',layer:'top'},
      {id:'U2-1',netId:'thin',x:19,y:20,w:2,h:1,shape:'rect',layer:'bottom'}],manual:[{netId:'thick',pts:[{x:25,y:18,l:3},{x:35,y:18,l:3}]},{netId:'thin',pts:[{x:35,y:23,l:0},{x:35,y:23,l:1}]}],keepouts:[],stitching:[]};
    const result={nets:[{netId:'thin',paths:Array.from({length:4},(_,l)=>[{x:4,y:3+l*3,l},{x:35,y:3+l*3,l}]),vias:[{x:30,y:23}]}],overuse:[]};
    const show={top:true,bottom:true,inner1:true,inner2:true,rats:false,grid:false,teardrop:true,refs:false,padNumbers:false,netNames:false,contrast:false,highlight:false};
    const original=JSON.stringify({d,result});
    const draw=(override={},extras={})=>{const c=document.createElement('canvas');c.width=d.width*s;c.height=d.height*s;const g=c.getContext('2d');g.scale(s,s);renderScene(g,d,{pxPerMM:s,show:{...show,...override},result,rats:[],...extras});return g;};
    const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
    const pixel=(g,x,y)=>[...g.getImageData(Math.round(x*s),Math.round(y*s),1,1).data].slice(0,3);
    const same=(a,b)=>a.every((v,i)=>Math.abs(v-b[i])<=2);
    const base=draw(), layerKeys=['top','inner1','inner2','bottom'];
    const out={};
    out.palette=['desktop','board','edge','top','bottom','inner1','inner2','pad','drill','via','airwire','selection','keepout','reference'].every(k=>/^#[0-9a-f]{6}$/i.test(P[k]))&&new Set(layerKeys.map(k=>P[k])).size===4;
    out.layers=layerKeys.every((k,l)=>same(pixel(base,20,3+l*3),rgb(P[k])));
    out.hidden=layerKeys.every((k,l)=>same(pixel(draw({[k]:false}),20,3+l*3),rgb(P.board)));
    out.width=same(pixel(base,30,18.35),rgb(P.bottom))&&same(pixel(base,30,12.35),rgb(P.board));
    out.drill=same(pixel(base,5.35,20),rgb(P.drill))&&same(pixel(base,5.65,20),rgb(P.pad));
    out.solid=same(pixel(base,9,20),rgb(P.pad));
    out.smd=same(pixel(base,14,20),rgb(P.top))&&same(pixel(base,19,20),rgb(P.bottom));
    out.hiddenPads=same(pixel(draw({top:false}),14,20),rgb(P.board))&&same(pixel(draw({bottom:false}),19,20),rgb(P.board));
    out.via=same(pixel(base,30,23),rgb(P.drill))&&same(pixel(base,30.28,23),rgb(P.via));
    out.throughVia=same(pixel(draw({top:false,inner1:false,inner2:false}),35.28,23),rgb(P.via));
    const extras={pour:{layer:3,netId:'thin',polys:[{outer:[23,20.5,26,20.5,26,21.5,23,21.5],holes:[]}]},teardrops:[{l:3,p:[{x:23,y:20},{x:24,y:20},{x:23.5,y:21}]}]};
    const hidden=draw({bottom:false},extras), visible=draw({},extras);
    out.hiddenExtras=same(pixel(hidden,24.5,21.5),rgb(P.board))&&same(pixel(hidden,23.5,20.25),rgb(P.board))&&!same(pixel(visible,23.5,20.25),rgb(P.board));
    const focused=draw({contrast:true},{activeLayer:0});
    out.contrast=same(pixel(focused,20,3),rgb(P.top))&&!same(pixel(focused,20,12),rgb(P.bottom))&&!same(pixel(focused,20,12),rgb(P.board));
    const selected=draw({highlight:true},{highlightNet:'thick'});
    out.highlight=same(pixel(selected,30,18),rgb(P.bottom))&&!same(pixel(selected,20,3),rgb(P.top));
    const selectedTeardrop=draw({highlight:true},{highlightNet:'thin',teardrops:[{l:0,p:[{x:28,y:22.8},{x:28,y:23.2},{x:30,y:23.4},{x:30,y:22.6}]}]});
    out.teardropOwnership=same(pixel(selectedTeardrop,28.5,23),rgb(P.top));
    const preview={netId:'thin',l:3,pts:[{x:2,y:25,l:0},{x:10,y:25,l:0},{x:10,y:25,l:3},{x:20,y:25,l:3}],preview:[{x:30,y:25}]};
    const hideTopPreview=draw({top:false},{draw:preview}),hideBottomPreview=draw({bottom:false},{draw:preview});
    out.previewLayers=same(pixel(hideTopPreview,5,25.1),rgb(P.board))&&!same(pixel(hideBottomPreview,5,25.1),rgb(P.board))&&same(pixel(hideBottomPreview,25,25.1),rgb(P.board));
    out.immutable=JSON.stringify({d,result})===original;
    return out;
  });
  for(const [name,value] of Object.entries(results)){assert.equal(value,true,name);check('geometry/pixel regression: '+name);}
  const design=await page.evaluate(()=>structuredClone(window.__pcbApp.design));design.layers=4;
  await page.locator('#fileInput').setInputFiles({name:'four-layers.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({design}))});
  await page.waitForFunction(()=>window.__pcbApp.design.layers===4);
  for(const [key,l] of [['top',0],['inner1',1],['inner2',2],['bottom',3]]){
    await page.locator('#activeLayer').selectOption(key);assert.equal(await page.evaluate(()=>window.__pcbApp.drawLayer),l);
    if(key.startsWith('inner')){
      await page.locator(`[data-view=${key}]`).click();assert.equal(await page.locator('#v'+(key==='inner1'?'Inner1':'Inner2')).isChecked(),false);
      await page.locator(`[data-view=${key}]`).click();
    }
  }
  check('four-layer dropdown uses real copper-layer indices and inner chips sync');
  await page.locator('[data-tool=route]').click();await page.keyboard.press('l');assert.equal(await page.evaluate(()=>window.__pcbApp.drawLayer),0);
  await page.keyboard.press('l');assert.equal(await page.locator('#activeLayer').inputValue(),'inner1');
  await page.keyboard.press('v');check('L cycles through all four physical layers');
  await page.locator('details').filter({has:page.locator('#dLayers')}).locator('summary').first().click();
  await page.locator('#activeLayer').selectOption('inner2');await page.locator('#dLayers').selectOption('2');
  assert.equal(await page.evaluate(()=>window.__pcbApp.drawLayer),0);assert.equal(await page.locator('#activeLayer').inputValue(),'top');
  await page.locator('#dLayers').selectOption('4');
  await page.locator('details').filter({has:page.locator('#dLayers')}).locator('summary').first().click();
  check('reducing four layers to two cannot leave an invalid active layer');
  await page.locator('details').filter({has:page.locator('#pourOn')}).locator('summary').first().click();
  await page.locator('#pourLayer').selectOption('bottom');
  await page.locator('#pourOn').check();
  await page.waitForFunction(()=>window.__pcbApp.pour?.layer===3);check('four-layer bottom copper pour belongs to layer 3, not inner layer 1');
  await page.locator('#pourOn').uncheck();
  await page.locator('#activeLayer').selectOption('top');
  await page.locator('#vContrast').check();assert.equal(await page.evaluate(()=>window.__pcbApp.show.contrast),true);
  await page.locator('#vContrast').uncheck();
  await page.locator('#vRefs').uncheck();assert.equal(await page.evaluate(()=>window.__pcbApp.show.refs),false);await page.locator('#vRefs').check();
  check('reference and contrast controls change real display state');
  // Detailed screenshot uses a routed example and a selected real pad, not mocked geometry.
  await page.locator('#fileInput').setInputFiles({name:'two-layers.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({design:{...design,layers:2}}))});
  await page.waitForFunction(()=>window.__pcbApp.design.layers===2);
  await page.locator('#quickRoute').click();await page.waitForFunction(()=>!window.__pcbApp.routing&&window.__pcbApp.result,{},{timeout:60000});
  await page.waitForFunction(()=>!document.getElementById('toast').classList.contains('show'));
  await page.locator('#focusCanvas').click();await page.locator('#zoomFit').click();
  const pad=await page.evaluate(()=>{const a=window.__pcbApp,p=a.design.pads[0],r=document.getElementById('cv').getBoundingClientRect();return {x:r.left+a.view.ox+p.x*a.view.scale,y:r.top+a.view.oy+p.y*a.view.scale};});
  await page.mouse.click(pad.x,pad.y);
  await mkdir(new URL('../docs/workbench/',import.meta.url),{recursive:true});
  await page.screenshot({path:fileURLToPath(new URL('../docs/workbench/canvas-detail.png',import.meta.url))});
  const beforePreview=await page.evaluate(()=>JSON.stringify(window.__pcbApp.design));
  await page.locator('[data-tool=route]').click();await page.mouse.click(pad.x,pad.y);
  await page.waitForFunction(()=>window.__pcbApp.draw);
  const target=await page.evaluate(()=>{const a=window.__pcbApp,start=a.draw.pts[0],p=a.design.pads.find(p=>p.netId===a.draw.netId&&Math.hypot(p.x-start.x,p.y-start.y)>.1),r=document.getElementById('cv').getBoundingClientRect();return p?{x:r.left+a.view.ox+p.x*a.view.scale,y:r.top+a.view.oy+p.y*a.view.scale}:null;});
  assert.ok(target);await page.mouse.move(target.x,target.y,{steps:4});
  await page.screenshot({path:fileURLToPath(new URL('../docs/workbench/canvas-routing.png',import.meta.url))});
  await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>window.__pcbApp.draw),null);
  assert.equal(await page.evaluate(()=>JSON.stringify(window.__pcbApp.design)),beforePreview);
  check('routing preview highlights target pads and cancels without changing board data');
  assert.deepEqual(errors,[]);console.log(`Canvas visual QA: ${checks} checks passed.`);
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
