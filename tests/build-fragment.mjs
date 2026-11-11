// 构建 inline 预览片段：把 index.html 转成作用域化的 visualize fragment
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const css = src.match(/<style>([\s\S]*?)<\/style>/)[1];
const body = src.match(/<body>([\s\S]*?)<\/body>/)[1];

// 1) CSS 作用域化：所有选择器加 #pcbar-root 前缀；按来源调整根与 toast
const scoped = css.replace(/([^{}]+)\{([^{}]*)\}/g, (m, sels, body2) => {
  const parts = sels.split(',').map(s => s.trim()).filter(Boolean);
  const out = [];
  for (let sel of parts) {
    if (sel === 'html,body' || sel === 'html') continue;          // 丢弃
    if (sel === ':root') { out.push('#pcbar-root'); continue; }   // 变量挂到根
    if (sel === '*') { out.push('#pcbar-root'); continue; }
    if (sel === 'body') {
      out.push('#pcbar-root');
      body2 = body2
        .replace('height:100vh', 'height:840px')
        .replace('overflow:hidden;', 'overflow:hidden; position:relative; box-shadow:0 10px 40px rgba(0,0,0,.35); border-radius:10px;');
      continue;
    }
    if (sel === '.toast') body2 = body2.replace('position:fixed', 'position:absolute');
    out.push('#pcbar-root ' + sel);
  }
  if (!out.length) return '';
  return out.join(',') + '{' + body2 + '}';
});

const css2 = scoped;

// 3) 组装 fragment（body 内容去掉最后一个多余换行）
const frag = `<div id="pcbar-root">
<style>
${css2}
</style>
${body.trim()}
</div>`;

const out = process.argv[2];
writeFileSync(out, frag);
console.log('written', out, (frag.length / 1024).toFixed(1) + ' KB');
