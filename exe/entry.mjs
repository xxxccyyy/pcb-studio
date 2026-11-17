/* exe/entry.mjs —— 单文件 exe 的入口：三模式分发
   pcb-studio.exe [serve|--port N|--no-open|--session-dir D]  → 内置服务 + AI 控制桥 + 自动开浏览器
   pcb-studio.exe mcp                                          → MCP stdio 服务（AI 客户端接入）
   pcb-studio.exe <ai/pcb.mjs 命令…>                           → 无头 CLI（route/drc/export/…）

   打包说明（scripts/build-exe.mjs）：
   - 'engine-src' / 'index-html-src' / 'version-src' 是构建期虚拟模块（text 内嵌），本文件不直接跑
   - ai/pcb.mjs 在打包时被打补丁：engineUrl/版本号改走 globalThis 钩子（见 build-exe.mjs）
   - 引擎源码同时以文本内嵌：并行布线 worker 需要真实文件 URL，首次用时惰性解包到 %TEMP% */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { isSea } from 'node:sea';
import { parseServeOptions } from './serve-options.mjs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import INDEX_HTML from 'index-html-src';
import ENGINE_SRC from 'engine-src';
import WORKER_SRC from 'worker-src';
import VERSION from 'version-src';

/* ---------- 打包补丁对应的 globalThis 钩子（CLI 命令运行时才求值） ---------- */
globalThis.__PCB_VERSION__ = VERSION.trim();
let engineUrlPromise = null;
globalThis.__PCB_ENGINE_URL = () => {
  if (!engineUrlPromise) {
    engineUrlPromise = (async () => {
      // Never execute a predictable shared temp file: another local user could replace it.
      const dir = mkdtempSync(join(tmpdir(), 'pcb-studio-engine-'));
      const file = join(dir, 'engine.mjs');
      writeFileSync(file, ENGINE_SRC, { flag: 'wx', mode: 0o600 });
      process.once('exit', () => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });
      return pathToFileURL(file).href;
    })();
  }
  return engineUrlPromise;
};

/* ---------- argv 归一化：SEA 与 node 直跑统一为 [exec, exec, cmd, ...rest] ---------- */
const a = process.argv;
const a1 = a[1];
// Node SEA repeats the executable in argv[1] on current Node releases; tolerate
// runtimes without that slot too. Never infer the mode from a user's file existing.
const userArgs = isSea() ? a.slice(a1 === process.execPath ? 2 : 1) : a.slice(2);
const head = userArgs[0];

async function startServe() {
  const { createBridgeServer, listenBridge } = await import('./bridge.mjs');
  const { port, noOpen, sessionDir: requestedDir } = parseServeOptions(userArgs);
  const sessionDir = resolve(requestedDir ?? join(process.cwd(), 'pcb-session'));
  const token = randomBytes(16).toString('hex');

  const stamp = () => new Date().toISOString().slice(11, 19);
  const log = (...m) => console.log(stamp(), ...m);
  const bridge = createBridgeServer({
    indexHtml: INDEX_HTML, version: globalThis.__PCB_VERSION__, sessionDir, token,
    engineSrc: ENGINE_SRC, workerSrc: WORKER_SRC,
    // dev 直跑 bundle 时 argv[1] 是 main.cjs（子进程需带上，取绝对路径）；SEA 时 argv[1]=exe 自身，不带
    selfScript: !isSea() && a1 ? resolve(a1) : null,
    log,
  });
  const server = bridge.server;
  let stopping = false;
  const stop = () => {
    if(stopping) return;
    stopping = true;
    server.closeAllConnections();
    server.close(); // bridge close hook cancels worker and direct CLI child.
  };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  server.once('close', () => { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); });
  let bound = 0, lastErr = null;
  if (port === 0) {
    try { bound = await listenBridge(server, 0); } catch (e) { lastErr = e; }
  } else {
    for (let p = port, tries = 0; tries < 20 && p <= 65535; tries++, p++) {
      try { bound = await listenBridge(server, p); break; } catch (e) { lastErr = e; server.removeAllListeners('error'); }
    }
  }
  bridge.setPort(bound);
  if (!bound) { console.error('端口监听失败：' + (lastErr && lastErr.message)); process.exit(1); }
  const info = { ok: true, mode: 'serve', version: globalThis.__PCB_VERSION__, port: bound,
    url: `http://127.0.0.1:${bound}`, token, sessionDir, pid: process.pid, startedAt: new Date().toISOString() };
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, 'bridge.json'), JSON.stringify(info, null, 1));
  console.log('PCB Studio（AI 控制桥）v' + info.version);
  console.log('  界面    : ' + info.url);
  console.log('  AI 接口 : ' + info.url + '/api/health（AI 冷启动第一站：GET /api/help——自描述接口目录）');
  console.log('  连接信息: ' + join(sessionDir, 'bridge.json'));
  console.log('  会话目录: ' + sessionDir);
  console.log('  关闭本窗口即停止服务。');
  if (!noOpen) {
    try { const { spawn } = await import('node:child_process');
      const [command, args] = process.platform === 'win32' ? ['cmd.exe', ['/c', 'start', '', info.url]]
        : process.platform === 'darwin' ? ['open', [info.url]] : ['xdg-open', [info.url]];
      const opener = spawn(command, args, { detached: true, stdio: 'ignore' });
      opener.on('error', () => {}); // Missing opener must not terminate the bridge.
      opener.unref();
    } catch { /* 无浏览器环境（如 SSH）就只打印 URL */ }
  }
}

async function startCli() {
  // 先归一化 argv（pcb.mjs 顶层按 [, , cmd, ...rest] 切片），再动态导入
  process.argv = [process.execPath, a1 || process.execPath, ...userArgs];
  const { main } = await import('../ai/pcb.mjs');
  process.exitCode = await main();
}

(async () => {
  if (!head || head === 'serve' || head.startsWith('--port') || head.startsWith('--no-open') || head.startsWith('--session-dir')) await startServe();
  else if (head === 'mcp') { const { startMcp } = await import('./mcp.mjs'); await startMcp(); }
  else await startCli();
})().catch(e => { console.error(e && e.stack ? e.stack : String(e)); process.exit(1); });
