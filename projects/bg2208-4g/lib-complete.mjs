// BG2208-4G 无源器件库身份补齐：按值+封装检索系统库，映射到设计位号
// 用法：node lib-complete.mjs  → 更新 devices-lib.json（追加 passives 段）
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const CLI = 'D:/PCB软件设计/study/easyeda-agent/easyeda-cli.exe';
function call(action, payload) {
  return JSON.parse(execFileSync(CLI, ['call', action, '--payload', JSON.stringify(payload)], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
}
function search(q) {
  const r = call('schematic.library.search', { query: q });
  return (r.result && r.result.components) || [];
}
const pick = (comps, prefer) => {
  if (prefer) {
    const pf = comps.filter(c => (c.footprintName || '').toUpperCase().includes(prefer.toUpperCase()));
    if (pf.length) return pf;
  }
  return comps;
};

// 唯一值清单：key → {q, prefer, package}
const VALUES = [
  { key: 'R10K',  q: '10K 0603',  prefer: '0603' },
  { key: 'R1K',   q: '1K 0603',   prefer: '0603' },
  { key: 'R124K', q: '124K 0603', prefer: '0603' },
  { key: 'R32K4', q: '32.4K 0603', prefer: '0603' },
  { key: 'R22K6', q: '22.6K 0603', prefer: '0603' },
  { key: 'R910',  q: '910R 0603', prefer: '0603' },
  { key: 'R100K', q: '100K 0603', prefer: '0603' },
  { key: 'R10',   q: '10R 0603',  prefer: '0603' },
  { key: 'R220',  q: '220R 0805', prefer: '0805' },
  { key: 'C100N', q: '100nF 0603', prefer: '0603' },
  { key: 'C33P',  q: '33pF 0603',  prefer: '0603' },
  { key: 'C1U',   q: '1uF 0603',   prefer: '0603' },
  { key: 'C22U',  q: '22uF 1206',  prefer: '1206' },
  { key: 'C10U',  q: '10uF 0805',  prefer: '0805' },
  { key: 'C10U50', q: '10uF 50V 1206', prefer: '1206' },
  { key: 'LED0603', q: 'LED 0603 红', prefer: '0603' },
  { key: 'TANT220', q: '220uF 钽电容 D', prefer: 'TANT' },
  { key: 'SVP220',  q: '220uF 固态电容 6.3', prefer: 'SVD' },
  { key: 'RAD470',  q: '470uF 50V 电解', prefer: '' },
  { key: 'L33U',  q: '33uH 功率电感', prefer: '' },
  { key: 'L6U8',  q: '6.8uH 功率电感', prefer: '' },
  { key: 'CON12P', q: 'XHB2.54 12P 卧贴', prefer: '12P' },
  { key: 'HDR3P',  q: '2.54 排针 1x3P', prefer: '3P' }
];

const cache = {};
const out = {};
let searches = 0;
for (const v of VALUES) {
  try {
    if (!cache[v.q]) { cache[v.q] = search(v.q); searches++; }
    const comps = pick(cache[v.q], v.prefer);
    const best = comps[0];
    out[v.key] = best ? {
      query: v.q, name: best.name, lcsc: best.lcsc,
      footprintName: best.footprintName, symbolName: best.symbolName,
      libraryUuid: best.libraryUuid, uuid: best.uuid
    } : { query: v.q, error: '无候选' };
    console.log(v.key, '→', best ? `${best.name} (${best.footprintName} / ${best.lcsc || '-'})` : '无');
  } catch (e) {
    out[v.key] = { query: v.q, error: String(e).slice(0, 100) };
    console.log(v.key, '失败:', String(e).slice(0, 80));
  }
}
writeFileSync('passives-lib.json', JSON.stringify(out, null, 1));
console.log('检索调用:', searches, '次；写入 passives-lib.json');
