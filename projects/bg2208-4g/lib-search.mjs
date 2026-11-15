// BG2208-4G 器件库身份批量检索：从嘉立创EDA系统库找每个器件的放置身份
// 用法：node lib-search.mjs  → devices-lib.json
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { execSync } from 'node:child_process';

const CLI = 'D:/PCB软件设计/study/easyeda-agent/easyeda-cli.exe';
function call(action, payload) {
  const out = execFileSync(CLI, ['call', action, '--payload', JSON.stringify(payload)], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return JSON.parse(out);
}

// 需求清单（DESIGN.md）：ref → 检索词/数量/候选偏好
const NEEDS = [
  { key: 'U5',  q: 'ML307R-DC',    want: 1, prefer: 'LGA-109' },
  { key: 'U6',  q: 'HC89F303C',    want: 1 },
  { key: 'U7',  q: 'TM1640',       want: 1, prefer: 'SSOP' },
  { key: 'U3',  q: 'RU3030M2',     want: 2, prefer: 'PDFN' },
  { key: 'U1',  q: 'MP2451',       want: 1, prefer: 'SOT23-6' },
  { key: 'U8',  q: '78L05',        want: 1, prefer: 'SOT-89' },
  { key: 'Q1',  q: 'S8550',        want: 1, prefer: 'SOT-23' },
  { key: 'Q2',  q: 'S8050',        want: 3, prefer: 'SOT-23' },
  { key: 'D73', q: 'SS14',         want: 1, prefer: 'SMA' },
  { key: 'D74', q: 'SS54',         want: 2, prefer: 'SMA' },
  { key: 'D76', q: '1N5819W',      want: 1, prefer: 'SOD-123' },
  { key: 'CON1', q: 'XHB2.54 12P', want: 1, prefer: '12P' },
  { key: 'J2',  q: 'XHB2.54 4P',   want: 1, prefer: '4P' },
  { key: 'J3',  q: 'XHB2.54 2P',   want: 1, prefer: '2P' },
  { key: 'J4',  q: 'XHB2.5 2P',    want: 2, prefer: '2P' },
  { key: 'J1',  q: '排针 2.54 3P', want: 1 },
  { key: 'CON2', q: 'SIM-114',     want: 1, prefer: 'SIM' },
  { key: 'X1',  q: 'IPEX U.FL',    want: 1, prefer: 'U.FL' },
  { key: 'BUZ', q: '无源蜂鸣器 8530', want: 1, prefer: '8530' },
  { key: 'F1',  q: '自恢复保险 1812', want: 1, prefer: '1812' }
];

const out = {};
for (const need of NEEDS) {
  try {
    const r = call('schematic.library.search', { query: need.q });
    const comps = (r.result && r.result.components) || [];
    let picks = comps;
    if (need.prefer) {
      const pf = comps.filter(c => (c.footprintName || '').toUpperCase().includes(need.prefer.toUpperCase())
        || (c.name || '').toUpperCase().includes(need.prefer.toUpperCase()));
      if (pf.length) picks = pf;
    }
    picks = picks.slice(0, need.want);
    out[need.key] = { query: need.q, found: comps.length, picks: picks.map(p => ({
      name: p.name, lcsc: p.lcsc, footprintName: p.footprintName, symbolName: p.symbolName,
      libraryUuid: p.libraryUuid, uuid: p.uuid
    })) };
    console.log(need.key, need.q, '→', comps.length, '个，取', picks.length, picks[0] ? `(${picks[0].footprintName} / ${picks[0].lcsc || '-'})` : '');
  } catch (e) {
    out[need.key] = { query: need.q, error: String(e).slice(0, 120) };
    console.log(need.key, '检索失败:', String(e).slice(0, 100));
  }
}
writeFileSync('devices-lib.json', JSON.stringify(out, null, 1));
console.log('写入 devices-lib.json');
