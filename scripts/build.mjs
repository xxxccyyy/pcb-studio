import { readFileSync, writeFileSync } from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8').replace(/\r\n/g,'\n');
const script=(id,source,type='')=>`<script id="${id}"${type?` type="${type}"`:''}>\n${source.replace(/<\/script/gi,'<\\/script')}\n</script>`;
const engine=read('src/engine.mjs').replace(/^export \{[^]*?\};\s*$/m,'').trim();
const worker=read('src/route-worker.js').replace(/^import .*;\s*$/gm,'').trim();
const output=read('src/index.template.html')
  .replace('{{ENGINE}}',()=>script('pcb-engine',engine))
  .replace('{{WORKER}}',()=>script('pcb-worker',worker,'text/plain'))
  .replace('{{WORKER_CLIENT}}',()=>script('pcb-worker-client',read('src/worker-client.js').trim()))
  .replace('{{UI}}',()=>script('pcb-ui',read('src/ui.js').trim()));
const target=new URL('../index.html',import.meta.url);
if(process.argv.includes('--check')){
  // 行尾守门：read() 的 CRLF 归一化会把源码行尾问题掩盖——7 个源码锚点测试
  // 直接 readFileSync 原始字节，工作区混入 CRLF 时它们全灭而本检查全绿
  // （0.14.4 实测教训，见 .gitattributes 头注）。
  for(const p of ['src/engine.mjs','src/route-worker.js','src/worker-client.js','src/ui.js','src/index.template.html']){
    if(/\r/.test(readFileSync(new URL('../'+p,import.meta.url),'utf8'))){
      console.error(`${p} 含 CR 行尾。归一化: python -c "import pathlib;p=pathlib.Path('${p}');p.write_bytes(p.read_bytes().replace(b'\\r\\n',b'\\n'))"`); process.exitCode=1;
    }
  }
  if(readFileSync(target,'utf8').replace(/\r\n/g,'\n')!==output){
    console.error('index.html is stale. Run npm run build.'); process.exitCode=1;
  }else console.log('Standalone HTML matches the source files.');
  // 经典 <script> 解析守卫：引擎以经典脚本内联，ESM-only 语法会解析期炸掉整个
  // GUI（0.5.1 实测教训：import.meta 进了引擎，浏览器全灭而 CLI 全绿）
  const vm=await import('node:vm');
  for(const id of ['pcb-engine','pcb-worker','pcb-worker-client','pcb-ui']){
    const inline=output.match(new RegExp('<script id="'+id+'"[^>]*>([\\s\\S]*?)<\\/script>'));
    try{
      if(!inline) throw new Error('Missing embedded script: '+id);
      new vm.Script(inline[1],{filename:id});
      console.log('Classic-script parse guard: '+id+' OK');
    }catch(e){ console.error('Classic-script parse FAILS (GUI 不可用):', e.message); process.exitCode=1; }
  }
}else{
  writeFileSync(target,output);
  console.log(`Built standalone index.html (${Buffer.byteLength(output)} bytes).`);
}
