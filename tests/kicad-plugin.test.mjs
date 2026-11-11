// KiCad 插件 mock 测试的 node 驱动器：spawn python 跑 unittest。
// python 不可用时如实 SKIP（零依赖项目的 python 是可选件——py_compile/mock 测试
// 属插件侧，缺 python 不阻塞主测试链，但会在输出中明示）。
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const test = fileURLToPath(new URL('./kicad-plugin.test.py', import.meta.url));

const py = ['python', 'python3', 'py'].find(cmd => {
  try {
    const r = spawnSync(cmd, ['--version'], { encoding: 'utf8', timeout: 15000 });
    return r.status === 0;
  } catch { return false; }
});

if (!py) {
  console.log('SKIP: python 不可用——kicad-plugin mock 测试未运行（安装 python 后重跑 npm test）');
  process.exit(0);
}

try {
  const out = execFileSync(py, [test], { encoding: 'utf8', timeout: 300000, stdio: ['ignore', 'pipe', 'pipe'] });
  console.log(out.trim().split('\n').filter(l => /ok$|Ran |OK/.test(l)).join('\n'));
  console.log('KiCad 插件 mock 测试：通过');
} catch (e) {
  console.error((e.stdout || '') + (e.stderr || ''));
  console.error('KiCad 插件 mock 测试：失败');
  process.exit(1);
}
