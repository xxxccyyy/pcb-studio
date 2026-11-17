import * as core from '../src/engine.mjs';
// 弦拉直效果验证：示例板 beautify 前后长度对比 + DRC + 间距审计
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function extract(mark) {
  const m = html.match(new RegExp('// ==== ' + mark + ' START ====([\\s\\S]*?)// ==== ' + mark + ' END ===='));
  return m[1];
}


function auditSpacing(d, r) {
  const segs = [];
  for (const n of r.nets) for (const p of n.paths) for (let k = 1; k < p.length; k++) {
    const a = p[k - 1], b = p[k];
    if (a.l !== b.l || (Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9)) continue;
    segs.push({ net: n.netId, l: a.l, x1: a.x, y1: a.y, x2: b.x, y2: b.y,
      bx: [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)] });
  }
  const need = d.trackW + d.clearance;
  let worst = 1e9;
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const a = segs[i], b = segs[j];
    if (a.net === b.net || a.l !== b.l) continue;
    if (b.bx[2] < a.bx[0] - need || a.bx[2] < b.bx[0] - need ||
        b.bx[3] < a.bx[1] - need || a.bx[3] < b.bx[1] - need) continue;
    const dd = core.segSegDist(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1, b.x2, b.y2);
    if (dd < worst) worst = dd;
  }
  return worst;
}

for (const ex of core.EXAMPLES) {
  const d = ex.build();
  const s = core.createSession(d, {});
  for (;;) { if (s.step().done) break; }
  const before = s.buildResult();
  const lenBefore = before.stats.trackLen;
  const cornersBefore = before.nets.reduce((a, n) => a + n.paths.reduce((b, p) => b + Math.max(0, p.length - 2), 0), 0);
  core.beautifyResult(d, before);
  const after = before;
  const issues = core.checkDRC(d, after);
  const worst = auditSpacing(d, after);
  const need = d.trackW + d.clearance;
  console.log(`${ex.id}: len ${lenBefore.toFixed(1)} -> ${after.stats.trackLen.toFixed(1)}` +
    `  DRCerr=${issues.filter(i => i.sev === 'error').length}` +
    `  minSpc=${worst.toFixed(3)} (need ${need})` +
    (worst >= need - 1e-6 ? ' ✓' : ' ✗✗✗'));
}
