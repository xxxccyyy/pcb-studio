/* scripts/build-exe.mjs —— 打包单文件 exe（Node SEA）
   用法：
     node scripts/build-exe.mjs --no-exe   → 只产 dist/main.cjs（dev/测试用）
     node scripts/build-exe.mjs            → dist/main.cjs + dist/pcb-studio.exe（SEA 注入）
   esbuild/postject 仅构建期依赖；运行时保持零依赖。
   打补丁（仅对 ai/pcb.mjs 的 bundle 副本，源文件不动）：
     - 并行布线 engineUrl（pcb.mjs 两处 new URL('../src/engine.mjs', import.meta.url)）
       → globalThis.__PCB_ENGINE_URL()（entry 惰性把内嵌引擎源码解包到 %TEMP%）
     - deliver 版本号 fallback（new URL('../package.json', …)）→ globalThis.__PCB_VERSION__ */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import esbuild from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const noExe = process.argv.includes('--no-exe');
if (!noExe && process.platform !== 'win32') {
  throw new Error('Windows executable packaging requires Windows. Use --no-exe for the portable CLI bundle.');
}
const newUrlEngine = /new URL\('\.\.\/src\/engine\.mjs', import\.meta\.url\)\.href/g;
const versionFallback = /JSON\.parse\(readFileSync\(new URL\('\.\.\/package\.json', import\.meta\.url\), 'utf8'\)\)\.version/g;

mkdirSync(dist, { recursive: true });

/* 构建期虚拟模块：引擎源码文本 / index.html 文本 / 版本号 */
const textSources = {
  'engine-src': readFileSync(join(root, 'src', 'engine.mjs'), 'utf8'),
  'worker-src': readFileSync(join(root, 'src', 'route-worker.js'), 'utf8'),
  'index-html-src': readFileSync(join(root, 'index.html'), 'utf8'),
  'version-src': readFileSync(join(root, 'package.json'), 'utf8').match(/"version":\s*"([^"]+)"/)[1],
};
const virtualText = {
  name: 'pcb-virtual-text',
  setup(build) {
    build.onResolve({ filter: /^(engine-src|worker-src|index-html-src|version-src)$/ }, a => ({ path: a.path, namespace: 'pcb-text' }));
    build.onLoad({ filter: /.*/, namespace: 'pcb-text' }, a => ({ contents: textSources[a.path], loader: 'text' }));
  },
};
const patchPcb = {
  name: 'pcb-patch',
  setup(build) {
    build.onLoad({ filter: /ai[\\\/]pcb\.mjs$/ }, a => {
      const src = readFileSync(a.path, 'utf8')
        .replace(newUrlEngine, 'await globalThis.__PCB_ENGINE_URL()')
        .replace(versionFallback, 'globalThis.__PCB_VERSION__')
        // The bundle is invoked by entry.mjs, never by pcb.mjs's ESM main guard.
        .replace(/pathToFileURL\(resolve\(process\.argv\[1\]\)\)\.href === import\.meta\.url/g, 'false');
      if (src.includes('import.meta')) throw new Error('Unpatched import.meta in bundled pcb.mjs');
      // 补丁命中数断言：ai/pcb.mjs 格式变化会让 replace 静默零命中 → exe 运行时才炸，构建期先拦
      if ((src.match(/__PCB_ENGINE_URL\(\)/g) || []).length !== 2) throw new Error('pcb.mjs engineUrl 补丁未命中 2 处——源码格式变了，请同步 scripts/build-exe.mjs 的正则');
      if (!src.includes('__PCB_VERSION__')) throw new Error('pcb.mjs 版本补丁未命中');
      return { contents: src, loader: 'js' };
    });
  },
};

const result = await esbuild.build({
  entryPoints: [join(root, 'exe', 'entry.mjs')],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node24',
  outfile: join(dist, 'main.cjs'),
  external: ['node:*'],
  plugins: [virtualText, patchPcb],
  legalComments: 'none',
  logLevel: 'warning',
});
const banner = readFileSync(join(dist, 'main.cjs'), 'utf8');
console.log('dist/main.cjs 完成（' + (banner.length / 1048576).toFixed(1) + ' MB 文本）');

if (noExe) process.exit(0);

/* ---------- SEA：blob → 复制 node.exe → postject 注入 ---------- */
writeFileSync(join(dist, 'sea-config.json'), JSON.stringify({
  main: join(dist, 'main.cjs'),
  output: join(dist, 'sea-prep.blob'),
  disableExperimentalSEAWarning: true,
  useCodeCache: true,
}, null, 1));
const { spawnSync } = await import('node:child_process');
const sea = spawnSync(process.execPath, ['--experimental-sea-config', join(dist, 'sea-config.json')], { stdio: 'inherit' });
if (sea.status !== 0) { console.error('sea-config 失败'); process.exit(1); }

const exePath = join(dist, 'pcb-studio.exe');
copyFileSync(process.execPath, exePath);
const { inject } = await import('postject');
await inject(exePath, 'NODE_SEA_BLOB', readFileSync(join(dist, 'sea-prep.blob')), {
  sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
});
rmSync(join(dist, 'sea-prep.blob'), { force: true });
console.log('dist/pcb-studio.exe 完成（' + (statSync(exePath).size / 1048576).toFixed(1) + ' MB）');
