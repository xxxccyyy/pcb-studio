import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/engine.mjs';
import { readFileSync, existsSync, readdirSync } from 'node:fs';

/* ============================================================
   形状补线批量普适性回归（0.13.14）

   来历：0.13.0~0.13.13 的形状补线只在 4 块板上验证过（Fable 三板 + BGA-64）。
   本文件用 projects/ 里的现成项目做批量回归，锁住两条不变量：

   1. **绝不劣化**：任何项目补线后 连通数不降、DRC error 不增
      （接受准则的字典序保证，但需要跨项目验证，不只是单板）
   2. **有失败网时必须尝试**：有未连通或有 DRC 的项目，补线必须跑过
      （rounds>0），不得静默跳过

   首轮实测（70 项目）：7 个有问题，5 个 DRC 改善、零变差。
   p10-grid-08 DRC 4→1、p27-cnc-shield 15→13 是"已全连但纯消违规"的典型。
   ============================================================ */

const ROOTS=['projects/round11/out','projects/round10/out'];

function loadProjects(){
  const out=[];
  for(const root of ROOTS){
    if(!existsSync(root)) continue;
    for(const name of readdirSync(root)){
      const dp=root+'/'+name+'/design.json', rp=root+'/'+name+'/result.json';
      if(!existsSync(dp)||!existsSync(rp)) continue;
      try{
        out.push({
          name,
          design:core.normalizeDesign(JSON.parse(readFileSync(dp,'utf8'))),
          base:JSON.parse(readFileSync(rp,'utf8'))
        });
      }catch(e){ /* 坏文件跳过 */ }
    }
  }
  return out;
}

const PROJECTS=loadProjects();

test('批量：项目集非空（回归有效性的前提）',()=>{
  assert.ok(PROJECTS.length>=20,'可用项目太少（'+PROJECTS.length+'）——批量回归失去意义');
});

test('批量：补线绝不劣化（连通不降 + DRC 不增），跨 70 项目',()=>{
  const bad=[];
  for(const p of PROJECTS){
    if(!p.base.nets||!p.base.stats) continue;
    const base=JSON.parse(JSON.stringify(p.base));
    base.drcErrors=core.checkDRC(p.design,base,{dfm:false}).filter(i=>i.sev==='error').length;
    let sp;
    try{ sp=core.routeBoardShape(p.design,{base}); }
    catch(e){ bad.push(p.name+' 抛错: '+e.message); continue; }
    const r=sp.result;
    if(r.stats.connected<base.stats.connected)
      bad.push(p.name+' 连通下降 '+base.stats.connected+'→'+r.stats.connected);
    if(r.drcErrors>base.drcErrors)
      bad.push(p.name+' DRC 增加 '+base.drcErrors+'→'+r.drcErrors);
  }
  assert.deepEqual(bad,[],'劣化项目：\n  '+bad.join('\n  '));
});

test('批量：有失败网/违规的项目必须实际跑过补线（不得静默跳过）',()=>{
  const skipped=[];
  for(const p of PROJECTS){
    if(!p.base.nets||!p.base.stats) continue;
    const base=JSON.parse(JSON.stringify(p.base));
    base.drcErrors=core.checkDRC(p.design,base,{dfm:false}).filter(i=>i.sev==='error').length;
    const hasWork=base.stats.connected<base.stats.total || base.drcErrors>0;
    if(!hasWork) continue;
    const sp=core.routeBoardShape(p.design,{base});
    if(!sp.shape.applied || !(sp.shape.rounds>0))
      skipped.push(p.name+'（conn '+base.stats.connected+'/'+base.stats.total+
        ' DRC '+base.drcErrors+'）rounds='+(sp.shape.rounds||0));
  }
  assert.deepEqual(skipped,[],'应跑未跑：\n  '+skipped.join('\n  '));
});

test('批量：已全绿的项目如实不动作（no-failed-nets 契约）',()=>{
  for(const p of PROJECTS){
    if(!p.base.nets||!p.base.stats) continue;
    const base=JSON.parse(JSON.stringify(p.base));
    base.drcErrors=core.checkDRC(p.design,base,{dfm:false}).filter(i=>i.sev==='error').length;
    if(base.stats.connected<base.stats.total || base.drcErrors>0) continue;
    const sp=core.routeBoardShape(p.design,{base});
    assert.equal(sp.shape.applied,false,p.name+' 全绿却动作了');
    assert.equal(sp.shape.reason,'no-failed-nets',p.name+' 原因应为 no-failed-nets');
  }
});

test('批量：DRC 改善（本回归的价值证据，至少 3 个项目受益）',()=>{
  let better=0, totalDelta=0;
  for(const p of PROJECTS){
    if(!p.base.nets||!p.base.stats) continue;
    const base=JSON.parse(JSON.stringify(p.base));
    base.drcErrors=core.checkDRC(p.design,base,{dfm:false}).filter(i=>i.sev==='error').length;
    if(base.drcErrors===0 && base.stats.connected===base.stats.total) continue;
    const sp=core.routeBoardShape(p.design,{base});
    const d=sp.result.drcErrors-base.drcErrors;
    if(d<0){ better++; totalDelta+=d; }
  }
  assert.ok(better>=3,'DRC 改善的项目仅 '+better+' 个（回归价值不足，检查修复轮是否失效）');
  assert.ok(totalDelta<0,'DRC 总变化应为负，实得 '+totalDelta);
});
