// 生成"未布局"测试规范：把 555 示例的所有焊盘堆到原点附近，模拟 AI 从网表起步
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const mA = html.match(new RegExp('// ==== ROUTER CORE START ====([\\s\\S]*?)// ==== ROUTER CORE END ===='));
const mB = html.match(new RegExp('// ==== EXAMPLES START ====([\\s\\S]*?)// ==== EXAMPLES END ===='));
const core = new Function(mA[1] + '\n' + mB[1] + '\nreturn {EXAMPLES};')();
const d = core.EXAMPLES[0].build();
// 模拟"AI 从网表起步"：保持封装内部几何，把各元件整体堆到板中心附近（组件间无序）
{
  const groups = new Map();
  for (const p of d.pads) {
    const i = p.id.lastIndexOf('-');
    const g = i > 0 ? p.id.slice(0, i) : p.id;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(p);
  }
  let k = 0;
  for (const [, ps] of groups) {
    const tx = 8 + (k % 4) * 1.2, ty = 10 + Math.floor(k / 4) * 1.2;   // 互相重叠地堆放
    const ax = ps[0].x, ay = ps[0].y;
    for (const p of ps) { p.x = +(p.x - ax + tx).toFixed(4); p.y = +(p.y - ay + ty).toFixed(4); }
    k++;
  }
}
d.name = 'ai-555';
const { mkdirSync } = await import('node:fs');
mkdirSync(tmpdir() + '/aiflow', { recursive: true });
writeFileSync(tmpdir() + '/aiflow/design.json', JSON.stringify(d, null, 1));
console.log('spec written:', tmpdir() + '/aiflow/design.json', '| pads:', d.pads.length, 'nets:', d.nets.length);
