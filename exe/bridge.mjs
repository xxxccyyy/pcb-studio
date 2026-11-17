/* AI 控制桥（exe/bridge.mjs）
   本地 HTTP 服务：浏览器工作台 + AI 代理双端接入。
   - 浏览器端：SSE 实时接收 AI 推送的 design/result，界面即时刷新
   - AI 端（curl/脚本）：/api/load 推送设计、/api/cmd 跑无头 CLI、/api/render 渲染 PNG 目检
   安全口径：仅绑 127.0.0.1；带 Origin/Sec-Fetch-Site 的请求必须同源（防浏览器 drive-by）；
   token 仅用于拦截配错的客户端（不装 token 也能用——本机进程本就可读 bridge.json）。
   设计沿用 server.mjs 的防护惯用法（inside/realpath 思路 + 纯 node:http）。 */
import http from 'node:http';
import { safeSessionPath, writeFileSync as atomicWrite, validateCliInvocation, validateFootprint } from '../ai/pcb.mjs';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { mkdirSync, readFileSync, readdirSync, lstatSync, existsSync, rmSync } from 'node:fs';
import { resolve, join, isAbsolute, relative, sep } from 'node:path';
import * as engine from '../src/engine.mjs';
import { pngEncode } from '../src/png.mjs';
import { fpPads, syncComps, applyEditOp, forensicWhy, estimateBoard, boardSummary, boardQuery, drcLive, diffResults } from './board-info.mjs';

  function markFindings(img, findings, scale) {
    const W = img.width, H = img.height, px = img.px;
    const setp = (x, y, c) => {
      x = Math.round(x); y = Math.round(y);
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      const i = (y * W + x) * 4;
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
    };
    const C_MARK = [255, 64, 64];
    for (const f of findings) {
      if (!f.where) continue;
      const r = 1.6 * scale, cx = f.where.x * scale, cy = f.where.y * scale;
      const steps = Math.max(24, Math.round(r * 2));
      for (let i = 0; i <= steps; i++) {
        const a = i / steps * Math.PI * 2;
        for (const th of [0, scale * 0.15]) setp(cx + Math.cos(a) * (r + th), cy + Math.sin(a) * (r + th), C_MARK);
      }
      for (const d of [[0, 0]]) setp(cx + d[0], cy + d[1], C_MARK);
    }
    return img;
  }

  /* ---------- /api/help：自描述 API 目录（AI 冷启动第一站） ---------- */
  function helpPayload(meta) {
    const { version, sessionPort, sessionDir, token } = meta;
    return {
      ok: true, version, port: sessionPort, sessionDir, token: token.slice(0, 4) + '…（完整 token 见 bridge.json）',
      busy: !!meta.busy, sessionResident: !!meta.sessionResident, uiClients: meta.uiClients,
      read: '完整规程见 docs/AI-桥接手册.md（实时桥）与 docs/AI-使用手册.md（布线决策）；本目录只列接口速查',
      endpoints: [
        { p: 'GET /api/help', d: '本目录' },
        { p: 'GET /api/health', d: '版本/端口/忙碌/界面数/screenshotAt' },
        { p: 'GET /api/summary', d: '状态摘要——日常轮询用这个，别拉全量 state' },
        { p: 'GET /api/state', d: '全量 design+result+uiState（大板 MB 级，慎用）' },
        { p: 'GET /api/query?net=|comp=|pad=', d: '结构化单对象查询（焊盘坐标/引脚表/网路由状态）' },
        { p: 'POST /api/load', d: '载入 {design, result?}（对象或会话内路径）→ 界面实时刷新；comps 漏写自动补' },
        { p: 'GET /api/examples', d: '内置示例板（design JSON 直接喂 /api/load）——快速验证全流程' },
        { p: 'POST /api/cmd', d: '跑无头 CLI：{cmd, args[], timeoutMs?, autoLoad?}；place/route 自动 --save-design' },
        { p: 'POST /api/route-live', d: '进程内布线 {options?}：SSE progress 直播+可取消+会话驻留（推荐路径）' },
        { p: 'POST /api/reroute-net', d: '{net} 会话内秒级单网重布（需先 route-live）' },
        { p: 'POST /api/cancel', d: '中断 route-live' },
        { p: 'POST /api/why', d: '失败法医报告：逐未连通边 blockers+advice；partialReasons 分解' },
        { p: 'POST|GET /api/estimate', d: '布线前预估：层数初判 ok2/tight/need4' },
        { p: 'POST /api/edit', d: '语义编辑：set-net/add-net/remove-net/move-comp/set-pad/add-pad/clear-net-tracks/add-keepout/sync-comps' },
        { p: 'POST /api/drc-live', d: 'DRC+fabChecklist，findings 带 where 坐标' },
        { p: 'GET /api/drc-live/mark.png', d: 'DRC 违规红圈叠加渲染（配合 drc-live 的 where）' },
        { p: 'GET /api/render', d: '引擎几何渲染 PNG：?scale=&crop=x,y,w,h&highlight=网1,网2&design=&result=' },
        { p: 'GET /api/view', d: '镜头控制：?net=&region=x,y,w,h&pad=&fit=1 → 界面聚焦截图（需浏览器在线）' },
        { p: 'GET /api/screenshot.png', d: '工作台真实截图（界面自动回传）' },
        { p: 'GET /api/files', d: '列会话目录' },
        { p: 'GET /api/events', d: 'SSE：hello/state/busy/log/cmd-done/ui-state/screenshot/view-cmd/progress' },
        { p: 'POST /api/diff', d: 'A/B 判分 {a, b}（result 对象或路径）→ routeScore 六维裁决' },
        { p: 'POST /api/undo | GET /api/history', d: '编辑快照回滚/轨迹' },
        { p: 'GET /api/fp', d: '封装生成器 ?name=SOIC-8|QFP-32|DIP-14|hdr1&n=&x=&y=&prefix=' },
      ],
      cmdCommands: ['schema', 'rules', 'spec', 'fp', 'place', 'route', 'tune', 'diffz', 'drc', 'drop', 'pdn', 'currents',
        'thermal', 'advise', 'export', 'device', 'schem', 'pour', 'bom', 'pos', 'erc', 'autopcb', 'import', 'deliver', 'part', 'verify', 'render'],
      routeLiveOptions: { place: '先自动布局再布线', viaCost: '过孔代价（默认 30）', maxIter: '协商轮数上限',
        blindVias: '盲孔开关', fanoutFirst: 'off/auto/inner/outer', obstacleH: 'false 回退盲口径启发式' },
      workflows: {
        快速全流程: ['POST /api/load {design}', 'POST /api/estimate', 'POST /api/route-live',
          'GET /api/summary 或 /api/query?net=X', 'GET /api/render?highlight=GND&crop=…',
          'POST /api/drc-live', 'POST /api/cmd {cmd:"deliver",…}'],
        partial修复环: ['POST /api/why → 看 blockers/partialReasons', 'POST /api/edit 拆障（move-comp/clear-net-tracks）',
          'POST /api/reroute-net 或重新 route-live', 'POST /api/diff 判分确认改善'],
        目检三通道: ['GET /api/screenshot.png（人所见，需浏览器）', 'GET /api/render?highlight=&crop=（确定性几何）',
          'GET /api/view?net=&region=（界面聚焦特写，需浏览器）'],
      },
      tips: ['轮询用 summary/query，别拉全量 state', '焊盘坐标用 /api/fp，别手算',
        'partial 先看 why（partialReasons：连通满格≠布线失败，可能是 DRC）', '改参重跑必 diff 判分',
        '改坏了 /api/undo', 'BOM/坐标/Gerber 交付走 /api/cmd deliver（三道门禁）'],
    };
  }

/* server.mjs 同款防逃逸：目标必须落在根目录内 */
const inside = (root, target) => {
  const rel = relative(resolve(root), resolve(target));
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep);
};

const json = (res, code, obj) => {
  const body = JSON.stringify(obj, null, 1);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
};

/* 解析 AI 传入的「对象或会话相对路径」；路径必须落在会话目录内 */
function readSource(sessionDir, v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  if (typeof v !== 'string' || !v.trim()) return null;
  const p = safeSessionPath(sessionDir, v);
  return JSON.parse(readFileSync(p, 'utf8'));
}

export function createBridgeServer({ indexHtml, version, sessionDir, token, selfScript, engineSrc, workerSrc, log = () => {} }) {
  sessionDir = resolve(sessionDir);
  mkdirSync(sessionDir, { recursive: true });
  const writeFileSync = (p, data) => atomicWrite(safeSessionPath(sessionDir, p), data);
  let activeChild = null, commandPending = false, closed = false;

  const clients = new Set();          // SSE 连接
  const state = { design: null, result: null, name: null, source: null };
  let uiState = { raw: null, hash: null, at: 0 };
  let shot = { buf: null, hash: null, at: 0 };   // 界面画布截图（POST /api/ui-screenshot 自动更新）
  let busy = null;                    // {cmd, startedAt}
  let queueTail = Promise.resolve();
  let sessionPort = 0;                // listen 后由 entry 回填（/api/help 显示用）

  /* ---------- 持久布线 worker（复用 UI 同款 route-worker 协议：route/reroute/进度/stale 拒绝） ----------
     engine 源码 + route-worker 源码拼接成 eval worker（build.mjs 内联同款剥壳）；
     会话驻留 worker 内存 → /api/reroute-net 秒级单网重布；terminate 即取消。 */
  let routeWorker = null, routeWorkerReq = null, routeSeq = 0;
  const history = [];                 // edit/load 前的 {design,result} 快照（/api/undo 用）
  const workerShim = "const __pp=require('node:worker_threads').parentPort;" +
    "const self={postMessage:m=>__pp.postMessage(m),set onmessage(fn){__pp.on('message',m=>fn({data:m}));}};";
  const workerCode = engineSrc && workerSrc
    ? workerShim + engineSrc.replace(/^export \{[^]*?\};\s*$/m, '') + '\n'
      + workerSrc.replace(/^import [^\n]*;[ \t]*$/gm, '')
    : null;
  function disposeRoutingWorker(cancelMsg) {
    const req = routeWorkerReq;
    routeWorkerReq = null;
    if (routeWorker) { try { routeWorker.terminate(); } catch {} routeWorker = null; }
    if (req) req.resolve({ cancelled: true, error: cancelMsg || '布线被中断（会话/设计变更）' });
  }
  function ensureRoutingWorker() {
    if (!workerCode) throw new Error('worker 源码未注入（engineSrc/workerSrc 缺失）');
    if (routeWorker) return routeWorker;
    routeWorker = new Worker(workerCode, { eval: true });
    const thisWorker = routeWorker;
    routeWorker.on('message', msg => {
      if (routeWorker !== thisWorker) return;
      const req = routeWorkerReq; if (!req || msg.id !== req.id) return;
      if (msg.type === 'progress') broadcast('progress', { text: msg.text, frac: msg.frac, cmd: 'route-live' });
      else if (msg.type === 'result') { routeWorkerReq = null; req.resolve(msg); }
      else if (msg.type === 'stale') { routeWorkerReq = null; req.resolve({ stale: true }); }
      else if (msg.type === 'error') { routeWorkerReq = null; req.resolve({ error: msg.error }); }
    });
    routeWorker.on('error', e => { if (routeWorker !== thisWorker) return; const req = routeWorkerReq; routeWorker = null; routeWorkerReq = null;
      if (req) req.resolve({ error: String((e && e.message) || e) }); });
    routeWorker.on('exit', () => { if (routeWorker !== thisWorker) return; const req = routeWorkerReq; routeWorker = null; routeWorkerReq = null;
      if (req) req.resolve({ cancelled: true, error: '布线 worker 已终止（取消或崩溃）' }); });
    return routeWorker;
  }
  /* edit/load 前快照（覆盖现有设计时才记），/api/undo 回滚 */
  function snapshot(op) {
    if (!state.design) return;
    history.push({ design: JSON.parse(JSON.stringify(state.design)),
      result: state.result ? JSON.parse(JSON.stringify(state.result)) : null, at: Date.now(), op });
    if (history.length > 20) history.shift();
  }

  const broadcast = (type, data) => {
    const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) { try { if (res.writableLength > 1024 * 1024) { res.destroy(); clients.delete(res); } else res.write(payload); } catch { clients.delete(res); } }
  };

  const guard = (req, res) => {
    const hosts = ['127.0.0.1:' + req.socket.localPort, 'localhost:' + req.socket.localPort];
    const host = req.headers.host;
    let allowed = hosts.includes(host);
    const origin = req.headers.origin;
    if (origin !== undefined) allowed &&= origin === 'http://' + host;
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'none') allowed = false;
    if (!allowed) { json(res, 403, { ok:false, error:'跨站请求或 Host 被拒绝（仅限本机同源）' }); return false; }
    const sent = req.headers['x-pcb-token'];
    if (sent !== undefined && sent !== token) { json(res, 403, { ok:false, error:'token 不符' }); return false; }
    return true;
  };

  const body = (req) => new Promise((ok, bad) => {
    const chunks = []; let size = 0;
    req.on('data', c => { chunks.push(c); size += c.length; if (size > 64 * 1024 * 1024) { bad(new Error('请求体过大')); req.destroy(); } });
    req.on('end', () => ok(Buffer.concat(chunks)));
    req.on('error', bad);
    req.on('aborted', () => bad(new Error('请求中断')));
  });

  /* ---------- /api/cmd：spawn 自身跑无头 CLI（串行队列 + 超时 kill） ---------- */
  const runCmd = ({ cmd, args = [], timeoutMs = 300000, autoLoad = null }) => new Promise((ok, bad) => {
    if (typeof cmd !== 'string' || /[\\\s]/.test(cmd)) { bad(new Error('cmd 必须是不带路径/空白的命令名')); return; }
    if (!Array.isArray(args) || args.some(a => typeof a !== 'string')) { bad(new Error('args 必须是字符串数组')); return; }
    let parsed;
    try { parsed = validateCliInvocation(cmd, args, sessionDir); } catch (e) { bad(e); return; }
    if (commandPending || busy || routeWorkerReq || closed) { bad(new Error('会话忙碌或已关闭')); return; }
    commandPending = true;
    const t = Math.min(Math.max(Number(timeoutMs) || 300000, 1000), 3600000);
    queueTail = queueTail.then(async () => {
      const startedAt = Date.now();
      busy = { cmd, startedAt };
      broadcast('busy', { cmd, pid: null });
      log(`[cmd] ${cmd} ${args.join(' ')}`);
      const base = selfScript ? [selfScript] : [];
      // place/route 会原地改 design（栅格抬高/焊盘 snap/布局旋转）：会话内文件自动 --save-design
      // 写回，保证后续 why/drc/render 与 result 的坐标系一致（幻影边根因的根治）
      disposeRoutingWorker();
      const args2 = [...args], designFile = parsed.args[0];
      if ((cmd === 'place' || cmd === 'route') && designFile && !args2.includes('--save-design')) {
        const dp = safeSessionPath(sessionDir, designFile);
        if (inside(sessionDir, dp) && existsSync(dp)) args2.push('--save-design');
      }
      if (closed) throw new Error('Bridge closed');
      const child = activeChild = spawn(process.execPath, [...base, cmd, ...args2], { cwd: sessionDir, windowsHide: true,
        env: { ...process.env, PCB_CLI_SESSION_DIR: sessionDir } });
      busy.pid = child.pid;
      let outBuf = [], errTail = [], outputBytes = 0, outputLimit = false, timedOut = false;
      child.stdout.on('data', c => { outputBytes += c.length; if (outputBytes <= 32 * 1024 * 1024) outBuf.push(c); else { outputLimit = true; child.kill(); } });
      child.stderr.on('data', c => {
        for (const line of c.toString('utf8').split(/\r?\n/)) if (line.trim()) {
          errTail.push(line.slice(-4000)); if (errTail.length > 80) errTail.shift();
          broadcast('log', { cmd, line });
        }
      });
      let timer = setTimeout(() => { timedOut = true; try { child.kill('SIGKILL'); } catch {} }, t);
      const code = await new Promise(rc => { child.on('close', rc); child.on('error', () => rc(-1)); });
      clearTimeout(timer);
      busy = null; activeChild = null;
      const stdout = Buffer.concat(outBuf).toString('utf8').trim();
      let j = null; try { j = JSON.parse(stdout); } catch {}
      const result = { ok: !outputLimit && !timedOut && code === 0 && (!j || j.ok !== false), exitCode: code, durationMs: Date.now() - startedAt,
        json: j || undefined, stdout: j ? undefined : stdout || undefined,
        stderrTail: errTail.length ? errTail.slice(-20) : undefined, timeout: timedOut, outputLimit };
      log(`[cmd] ${cmd} → exit ${code}（${result.durationMs}ms）`);
      if (result.ok && autoLoad) {
        try { applyLoad({ ...autoLoad, name: autoLoad.design || state.name, source: `cmd:${cmd}` }, true); result.loaded = true; }
        catch (e) { result.loadError = e.message; }
      }
      // place/route 自动 --save-design 写回了磁盘：内存 state 回读，避免 summary/why 用旧 design 配新 result。
      // place 的 -o 是布好布局的 design（result 置 null——布局变了旧走线全失效）；route 的 -o 才是 result。
      if (result.ok && args2.includes('--save-design') && existsSync(safeSessionPath(sessionDir, designFile))) {
        try {
          const dNew = readSource(sessionDir, designFile);
          const outFile = parsed.options.get('-o');
          const rNew = cmd === 'route' ? (outFile ? readSource(sessionDir, outFile) : j?.result) : null;
          state.design = dNew;
          state.result = cmd === 'route' ? (rNew || null) : null;
          broadcast('state', { design: dNew, result: state.result, name: state.name, source: 'cmd-save-design' });
        } catch { /* 回读失败不阻断 */ }
      }
      broadcast('cmd-done', { cmd, exitCode: code, ok: result.ok });
      ok(result);
    }).catch(bad).finally(() => { commandPending = false; busy = null; activeChild = null; });
  });

  /* ---------- /api/load：应用 design(+result) → 落成会话文件 → SSE 推给界面 ----------
     内联对象写入约定名（design.json / result.json，body.name 可覆盖设计文件名）；
     传路径则原样保留。返回实际文件名，AI 后续 /api/cmd 直接引用。 */
  function applyLoad({ design, result, name, source }, respond = true) {
    const d = readSource(sessionDir, design);
    engine.normalizeDesign(JSON.parse(JSON.stringify(d)));
    if (!d) throw new Error('缺少 design（对象或会话目录内路径）');
    const r = readSource(sessionDir, result);
    const dPath = typeof design === 'string' ? design : (name || 'design.json');
    let rPath = null;
    if (r) rPath = typeof result === 'string' ? result : 'result.json';
    const pathKey = p => { const abs = safeSessionPath(sessionDir, p); return process.platform === 'win32' ? abs.toLowerCase() : abs; };
    if (!rPath && pathKey(dPath) === pathKey('result.json')) throw new Error('design 不能使用保留的 result.json 文件名');
    if (rPath && pathKey(rPath) === pathKey(dPath)) throw new Error('design 与 result 必须使用不同文件');
    pathKey(dPath);
    if (r) engine.normalizeResult(r.result || r, engine.normalizeDesign(JSON.parse(JSON.stringify(d))));
    const compsAdded = syncComps(d);      // AI 漏写 comps 时自动补（ERC/BOM/CPL/丝印依赖它）
    if (!r && existsSync(join(sessionDir, 'result.json'))) safeSessionPath(sessionDir, 'result.json');
    writeFileSync(safeSessionPath(sessionDir, dPath), JSON.stringify(d, null, 1));
    if (r) writeFileSync(safeSessionPath(sessionDir, rPath), JSON.stringify(r, null, 1));
    else if (existsSync(join(sessionDir, 'result.json'))) rmSync(safeSessionPath(sessionDir, 'result.json'));
    snapshot('load:' + dPath);
    state.design = d; state.result = r || null;
    state.name = name || (typeof design === 'string' ? design : dPath);
    state.source = source || 'api';
    disposeRoutingWorker();               // 新设计 → 布线会话作废
    if (respond) broadcast('state', { design: d, result: state.result, name: state.name, source: state.source });
    return { ok: true, pads: (d.pads || []).length, nets: (d.nets || []).length,
      hasResult: !!state.result, designPath: dPath, resultPath: rPath, name: state.name,
      compsAutoSynced: compsAdded || undefined };
  }

  /* ---------- /api/view：AI 镜头控制 —— 让界面聚焦某网络/区域并回传截图 ----------
     广播 view-cmd（客户端同步改视图 + draw() + 截图上传），等 shot 更新后把 PNG 返给 AI。
     无界面连接或超时则返回 JSON + fallback 提示（AI 改用 /api/render）。 */
  async function viewShot(query) {
    const cmd = {
      net: query.get('net') != null ? String(query.get('net')) : null,
      pad: query.get('pad') != null ? String(query.get('pad')) : null,
      region: (query.get('region') || '').split(',').map(Number).filter(n => Number.isFinite(n)),
      fit: query.get('fit') === '1',
      scale: Number(query.get('scale')) || null,
      nonce: Date.now() + Math.random(),
    };
    if (cmd.region.length !== 4) cmd.region = null;
    if (!cmd.net && !cmd.pad && !cmd.region && !cmd.fit && !cmd.scale) throw new Error('需要 net/pad/region/fit/scale 至少一个参数');
    if (!clients.size) return { fallback: true, error: '没有浏览器界面连接——打开工作台或改用 /api/render' };
    const before = shot.at;
    broadcast('view-cmd', cmd);
    const end = Date.now() + 3500;
    while (Date.now() < end && shot.at <= before) await new Promise(r => setTimeout(r, 80));
    if (shot.at > before) return { png: shot.buf };
    return { fallback: true, error: '界面未在 3.5s 内回传截图（标签页可能隐藏或断开）' };
  }

  /* 会话文件兜底：内存无状态时自动用 design.json/result.json（服务重启后 AI 无需重新 load） */
  function stateOrFile(kind, bodyVal) {
    if (bodyVal != null) return readSource(sessionDir, bodyVal);
    // 内存里有设计时以内存为准（result 为 null 就是 null——磁盘旧文件与内存设计不配套，读了反而配错对）
    const haveState = state.design != null;
    if (kind === 'design') return state.design || (existsSync(join(sessionDir, 'design.json')) ? readSource(sessionDir, 'design.json') : null);
    return haveState ? state.result : (existsSync(join(sessionDir, 'result.json')) ? readSource(sessionDir, 'result.json') : null);
  }
  /* 需要可变内存态的端点（edit）先把会话文件恢复进内存 */
  function ensureState() {
    if (!state.design && existsSync(join(sessionDir, 'design.json'))) {
      try {
        state.design = readSource(sessionDir, 'design.json');
        if (existsSync(join(sessionDir, 'result.json'))) state.result = readSource(sessionDir, 'result.json');
      } catch { /* 文件损坏则维持无状态 */ }
    }
    if (!state.design) throw new Error('当前没有设计——先 POST /api/load');
  }


  function applyEdit(b) {
    ensureState();
    const d = JSON.parse(JSON.stringify(state.design));
    const r = state.result ? JSON.parse(JSON.stringify(state.result)) : null;
    const out = applyEditOp(d, r, b);
    try { engine.normalizeDesign(JSON.parse(JSON.stringify(out.d))); }
    catch (e) { throw new Error('编辑后设计非法（未提交）：' + e.message); }
    safeSessionPath(sessionDir, 'design.json');
    if (out.r) safeSessionPath(sessionDir, 'result.json');
    writeFileSync(join(sessionDir, 'design.json'), JSON.stringify(out.d, null, 1));
    if (out.r) writeFileSync(join(sessionDir, 'result.json'), JSON.stringify(out.r, null, 1));
    snapshot('edit:' + b.op);
    state.design = out.d; if (out.r || r) state.result = out.r;
    disposeRoutingWorker();               // 设计已变：布线会话的 model 不再可信
    broadcast('state', { design: out.d, result: out.r, name: state.name, source: 'edit:' + b.op });
    return { ok: true, op: b.op, summary: out.summary, prunedResult: out.pruned };
  }

  function renderPng(query) {
    let d, r;
    if (query.get('design')) {
      d = engine.normalizeDesign(readSource(sessionDir, query.get('design')));
      const rv = query.get('result') ? readSource(sessionDir, query.get('result')) : null;
      r = rv ? engine.normalizeResult(rv.result || rv, d) : { nets: [] };
    } else {
      if (!state.design) throw new Error('当前没有已载入的设计——先 POST /api/load');
      d = engine.normalizeDesign(state.design);
      r = state.result ? engine.normalizeResult(state.result, d) : { nets: [] };
    }
    const scale = Math.min(Math.max(Number(query.get('scale')) || 8, 1), 32);
    const highlight = query.get('highlight');
    const img = engine.renderBoardPixels(d, r, { scale, ...(highlight ? { highlightNet: highlight } : {}) });
    let { width: W, height: H, px } = img;
    // crop=x,y,w,h（mm）：像素级裁剪——AI 看局部不必拉全板大图
    const cropRaw = (query.get('crop') || '').split(',').map(Number).filter(n => Number.isFinite(n));
    if (cropRaw.length === 4) {
      const [cx0, cy0, cw, ch] = cropRaw;
      if (cw <= 0 || ch <= 0) throw new Error('crop dimensions must be positive');
      const x0 = Math.max(0, Math.min(W - 1, Math.round(cx0 * scale))), y0 = Math.max(0, Math.min(H - 1, Math.round(cy0 * scale)));
      const w = Math.max(1, Math.min(W - x0, Math.round(cw * scale))), h = Math.max(1, Math.min(H - y0, Math.round(ch * scale)));
      const out = new Uint8Array(w * h * 4);
      for (let y = 0; y < h; y++) out.set(px.subarray(((y0 + y) * W + x0) * 4, ((y0 + y) * W + x0) * 4 + w * 4), y * w * 4);
      W = w; H = h; px = out;
    }
    return pngEncode(W, H, px);
  }

  const server = http.createServer(async (req, res) => {
    try {
      if (!guard(req, res)) return;
      const url = new URL(req.url, 'http://x');
      const p = url.pathname;
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
      const mutation = ['/api/load','/api/edit','/api/undo','/api/route-live','/api/reroute-net'];
      const assertIdle = () => { if (mutation.includes(p) && (commandPending || busy || routeWorkerReq)) { const e = new Error('会话忙碌（先取消或等待）'); e.status = 409; throw e; } };
      assertIdle();
      const readBody = async () => { const raw = (await body(req)).toString('utf8'); assertIdle(); const obj = JSON.parse(raw || '{}'); if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('请求体必须为对象'); return obj; };
      if (p === '/' || p === '/index.html') {
        if (req.method !== 'GET' && req.method !== 'HEAD') { json(res, 405, { ok: false, error: 'method not allowed' }); return; }
        // 注入点：第一个 head 闭合标签前（indexOf——页面脚本注释里可能出现同样的字面量，
        // lastIndexOf 会命中注释；模板未显式闭合 head 时插到 <body> 前）
        const boot = `<script>window.__PCB_BRIDGE={token:${JSON.stringify(token)},version:${JSON.stringify(version)},events:"/api/events"};</script>\n`;
        let cut = indexHtml.indexOf('</head>');
        if (cut < 0) { const b = indexHtml.indexOf('<body'); cut = b >= 0 ? b : 0; }
        const html = indexHtml.slice(0, cut) + boot + indexHtml.slice(cut);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
        res.end(req.method === 'HEAD' ? undefined : html);
        return;
      }
      if (p === '/api/events') {
        if (clients.size >= 32) { json(res, 429, { ok:false, error:'SSE client limit' }); return; }
        if (!guard(req, res)) return;
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        const beat = setInterval(() => { try { res.write(':beat\n\n'); } catch { clearInterval(beat); clients.delete(res); } }, 15000);
        res.on('error', () => { clearInterval(beat); clients.delete(res); });
        res.write(`event: hello\ndata: ${JSON.stringify({ version, sessionDir, busy })}\n\n`);
        clients.add(res);
        res.on('error', () => { clearInterval(beat); clients.delete(res); });
        req.on('close', () => { clearInterval(beat); clients.delete(res); });
        return;
      }
      if (p === '/api/health') {
        json(res, 200, { ok: true, mode: 'bridge', version, sessionDir, busy, name: state.name,
          hasDesign: !!state.design, hasResult: !!state.result, uiStateAt: uiState.at || null,
          screenshotAt: shot.at || null, clients: clients.size });
        return;
      }
      if (p === '/api/help') {
        json(res, 200, helpPayload({ version, sessionPort, sessionDir, token, busy, sessionResident: !!routeWorker, uiClients: clients.size }));
        return;
      }
      if (p === '/api/examples' && req.method === 'GET') {
        json(res, 200, { ok: true, items: engine.EXAMPLES.map((e, i) => ({ index: i, id: e.id, name: e.name, design: e.build() })),
          note: '取 items[k].design 作为 POST /api/load 的 design 即可载入（AI 快速验证全流程）' });
        return;
      }
      if (p === '/api/drc-live/mark.png' && req.method === 'GET') {
        if (!guard(req, res)) return;
        const dRaw = stateOrFile('design', null);
        if (!dRaw) throw new Error('当前无设计——先 POST /api/load');
        const d = engine.normalizeDesign(dRaw);
        const r = stateOrFile('result', null) ? engine.normalizeResult(stateOrFile('result', null), d) : { nets: [] };
        const scale = Math.min(Math.max(Number(url.searchParams.get('scale')) || 8, 1), 32);
        const img = engine.renderBoardPixels(d, r, { scale });
        const findings = drcLive(d, r).findings;
        markFindings(img, findings, scale);
        const cropRaw = (url.searchParams.get('crop') || '').split(',').map(Number).filter(n => Number.isFinite(n));
        let { width: W, height: H, px } = img;
        if (cropRaw.length === 4) {
          const [cx0, cy0, cw, ch] = cropRaw;
          if (cw <= 0 || ch <= 0) throw new Error('crop dimensions must be positive');
          const x0 = Math.max(0, Math.min(W - 1, Math.round(cx0 * scale))), y0 = Math.max(0, Math.min(H - 1, Math.round(cy0 * scale)));
          const w = Math.max(1, Math.min(W - x0, Math.round(cw * scale))), h = Math.max(1, Math.min(H - y0, Math.round(ch * scale)));
          const out2 = new Uint8Array(w * h * 4);
          for (let y = 0; y < h; y++) out2.set(px.subarray(((y0 + y) * W + x0) * 4, ((y0 + y) * W + x0) * 4 + w * 4), y * w * 4);
          W = w; H = h; px = out2;
        }
        res.writeHead(200, { 'Content-Type': 'image/png', 'X-Marked': String(findings.filter(f => f.where).length), 'Cache-Control': 'no-cache' });
        res.end(pngEncode(W, H, px));
        return;
      }
      if (!guard(req, res)) return;
      if (p === '/api/state' && req.method === 'GET') {
        json(res, 200, { ok: true, design: state.design, result: state.result, name: state.name, source: state.source,
          uiState: uiState.raw ? JSON.parse(uiState.raw) : null });
        return;
      }
      if (p === '/api/load' && req.method === 'POST') {
        json(res, 200, applyLoad(await readBody()));
        return;
      }
      if (p === '/api/cmd' && req.method === 'POST') {
        json(res, 200, await runCmd(await readBody()));
        return;
      }
      if (p === '/api/render' && req.method === 'GET') {
        const png = await renderPng(url.searchParams);
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' });
        res.end(png);
        return;
      }
      if (p === '/api/files' && req.method === 'GET') {
        const items = readdirSync(sessionDir).filter(f => f !== '_bridge').map(f => {
          const st = lstatSync(join(sessionDir, f));
          return { name: f, bytes: st.size, mtime: st.mtime.toISOString() };
        });
        json(res, 200, { ok: true, sessionDir, items });
        return;
      }
      if (p === '/api/ui-state' && req.method === 'POST') {
        const raw = (await body(req)).toString('utf8');
        JSON.parse(raw);   // 非法 JSON 直接 400——坏快照进了 uiState 会毒化每次 /api/state
        uiState = { raw, hash: crypto.createHash('sha1').update(raw).digest('hex').slice(0, 12), at: Date.now() };
        broadcast('ui-state', { at: uiState.at, hash: uiState.hash });   // AI 订阅即知「人改了」，再按需拉 /api/state
        json(res, 200, { ok: true });
        return;
      }
      if (p === '/api/ui-screenshot' && req.method === 'POST') {
        const buf = await body(req);
        if (buf.length < 8 || buf[0] !== 0x89 || buf[1] !== 0x50) { json(res, 400, { ok: false, error: '需要 PNG 字节' }); return; }
        const hash = crypto.createHash('sha1').update(buf).digest('hex');
        const changed = hash !== shot.hash;
        if (changed) { shot = { buf, hash, at: Date.now() }; broadcast('screenshot', { at: shot.at, bytes: buf.length }); }
        json(res, 200, { ok: true, bytes: buf.length, at: shot.at, changed });
        return;
      }
      if (p === '/api/screenshot.png' && req.method === 'GET') {
        if (!shot.buf) { json(res, 404, { ok: false, error: '还没有界面截图——浏览器工作台打开后自动回传' }); return; }
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' });
        res.end(shot.buf);
        return;
      }
      if (p === '/api/view' && req.method === 'GET') {
        const out = await viewShot(url.searchParams);
        if (out.png) { res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' }); res.end(out.png); return; }
        json(res, 200, { ok: false, ...out });
        return;
      }
      if (p === '/api/why' && req.method === 'POST') {
        const b = await readBody();
        const dRaw = stateOrFile('design', b.design);
        if (!dRaw) throw new Error('缺少 design（当前无状态且会话目录无 design.json）');
        const rRaw = stateOrFile('result', b.result);
        json(res, 200, forensicWhy(dRaw, rRaw));
        return;
      }
      if (p === '/api/summary' && req.method === 'GET') {
        const dRaw = stateOrFile('design', null);
        if (!dRaw) throw new Error('当前无设计——先 POST /api/load');
        json(res, 200, boardSummary(dRaw, stateOrFile('result', null), { name: state.name, sessionResident: !!routeWorker }));
        return;
      }
      if (p === '/api/query' && req.method === 'GET') {
        const dRaw = stateOrFile('design', null);
        if (!dRaw) throw new Error('当前无设计——先 POST /api/load');
        json(res, 200, boardQuery(dRaw, stateOrFile('result', null), Object.fromEntries(url.searchParams)));
        return;
      }
      if (p === '/api/drc-live' && req.method === 'POST') {
        const b = await readBody();
        const dRaw = stateOrFile('design', b.design);
        if (!dRaw) throw new Error('缺少 design（当前无状态且会话目录无 design.json）');
        json(res, 200, drcLive(dRaw, stateOrFile('result', b.result)));
        return;
      }
      if (p === '/api/edit' && req.method === 'POST') {
        json(res, 200, applyEdit(await readBody()));
        return;
      }
      if (p === '/api/fp' && req.method === 'GET') {
        const name = url.searchParams.get('name');
        if (!name) throw new Error('缺少 name（0402/0603/0805/1206/SOT-23/SOT-223/SOIC-8|14|16/DIP-14/QFP-32|44|64|100/QFN-48/BGA-64/XTAL-3225/hdr1/hdr2）');
        const n = Number(url.searchParams.get('n') ?? 0), x = Number(url.searchParams.get('x') ?? 0), y = Number(url.searchParams.get('y') ?? 0);
        validateFootprint(name, n, x, y);
        const out = fpPads(name, n, x, y,
          url.searchParams.get('prefix') || 'U1');
        json(res, 200, { ok: true, ...out, note: 'netId 未分配——spec 里 nets[].pads 引用这些 id，或 /api/edit add-net 挂网' });
        return;
      }
      if (p === '/api/route-live' && req.method === 'POST') {
        const b = await readBody();
        if (routeWorkerReq) { json(res, 409, { ok: false, error: 'worker 忙碌中（先 /api/cancel 或等待）' }); return; }
        const dRaw = stateOrFile('design', b.design);
        if (!dRaw) throw new Error('缺少 design');
        const worker = ensureRoutingWorker();
        snapshot('route-live');
        busy = { cmd: 'route-live', startedAt: Date.now() };
        broadcast('busy', { cmd: 'route-live' });
        const id = ++routeSeq;
        let timer;
        const msg = await Promise.race([
          new Promise(res => { routeWorkerReq = { id, resolve: res }; worker.postMessage({ id, command: 'route', design: dRaw, options: b.options || {} }); }),
          new Promise(res => { timer = setTimeout(() => res({ timeout: true }), 1800000); }),
        ]).finally(() => clearTimeout(timer));
        busy = null;
        if (msg.timeout) { disposeRoutingWorker(); json(res, 200, { ok: false, timeout: true, error: 'route-live 超 30 分钟被终止' }); return; }
        if (msg.cancelled || msg.error) { json(res, 200, { ok: false, cancelled: !!msg.cancelled, error: msg.error }); return; }
        if (msg.stale) { json(res, 200, { ok: false, stale: true, error: '会话指纹不符——重新 POST /api/route-live' }); return; }
        state.design = msg.design; state.result = msg.result;   // worker 返回变异后的 design（栅格/布局已就位）
        state.name = state.name || 'design.json'; state.source = 'route-live';
        writeFileSync(join(sessionDir, 'design.json'), JSON.stringify(msg.design, null, 1));
        writeFileSync(join(sessionDir, 'result.json'), JSON.stringify(msg.result, null, 1));
        busy = null;
        broadcast('state', { design: msg.design, result: msg.result, name: state.name, source: 'route-live' });
        json(res, 200, { ok: true, status: msg.result.status, stats: msg.result.stats, timeMs: msg.result.timeMs, session: true,
          note: '会话已驻留——/api/reroute-net 可秒级单网重布；/api/cancel 可中断' });
        return;
      }
      if (p === '/api/reroute-net' && req.method === 'POST') {
        const b = await readBody();
        if (!routeWorker || !state.design) throw new Error('没有活动布线会话——先 POST /api/route-live');
        if (routeWorkerReq) { json(res, 409, { ok: false, error: 'worker 忙碌中' }); return; }
        if (!b.net) throw new Error('缺少 net');
        const id = ++routeSeq;
        let timer;
        const msg = await Promise.race([
          new Promise(res => { routeWorkerReq = { id, resolve: res }; routeWorker.postMessage({ id, command: 'reroute', design: state.design, netId: b.net, options: {} }); }),
          new Promise(res => { timer = setTimeout(() => res({ timeout: true }), 300000); }),
        ]).finally(() => clearTimeout(timer));
        if (msg.timeout) { disposeRoutingWorker(); json(res, 200, { ok: false, timeout: true, error: 'reroute 超 5 分钟被终止' }); return; }
        if (msg.stale) { json(res, 200, { ok: false, stale: true, error: '设计已变（与布线会话指纹不符）——重新 POST /api/route-live' }); return; }
        if (msg.cancelled || msg.error) { json(res, 200, { ok: false, cancelled: !!msg.cancelled, error: msg.error }); return; }
        if (msg.design) state.design = msg.design;   // reroute 的 beautify 可能改写 design——保持对称
        state.result = msg.result;
        writeFileSync(join(sessionDir, 'result.json'), JSON.stringify(msg.result, null, 1));
        broadcast('state', { design: state.design, result: state.result, name: state.name, source: 'reroute-net' });
        json(res, 200, { ok: true, net: b.net, outcome: msg.outcome, stats: msg.result.stats, timeMs: msg.result.timeMs });
        return;
      }
      if (p === '/api/cancel' && req.method === 'POST') {
        const had = !!routeWorkerReq;
        disposeRoutingWorker();
        json(res, 200, { ok: true, cancelled: had, note: had ? '布线已中断（会话丢弃）' : '没有进行中的布线' });
        return;
      }
      if (p === '/api/diff' && req.method === 'POST') {
        const b = await readBody();
        const dRaw = stateOrFile('design', b.design);
        if (!dRaw) throw new Error('缺少 design');
        if (b.a == null || b.b == null) throw new Error('需要 a 与 b（result 对象或会话内路径）');
        json(res, 200, diffResults(dRaw, readSource(sessionDir, b.a), readSource(sessionDir, b.b)));
        return;
      }
      if (p === '/api/undo' && req.method === 'POST') {
        if (!history.length) throw new Error('没有可撤销的历史');
        const snap = history.pop();
        state.design = snap.design; state.result = snap.result;
        disposeRoutingWorker();
        writeFileSync(join(sessionDir, 'design.json'), JSON.stringify(snap.design, null, 1));
        if (snap.result) writeFileSync(join(sessionDir, 'result.json'), JSON.stringify(snap.result, null, 1));
        else if (existsSync(join(sessionDir, 'result.json'))) rmSync(join(sessionDir, 'result.json'));
        broadcast('state', { design: snap.design, result: snap.result, name: state.name, source: 'undo:' + snap.op });
        json(res, 200, { ok: true, restored: snap.op, at: snap.at, remaining: history.length });
        return;
      }
      if (p === '/api/history' && req.method === 'GET') {
        json(res, 200, { ok: true, count: history.length, items: history.map((h, i) => ({ seq: i + 1, at: h.at, op: h.op })) });
        return;
      }
      if (p === '/api/estimate' && (req.method === 'POST' || req.method === 'GET')) {
        let b = {};
        if (req.method === 'POST') { const raw = (await body(req)).toString('utf8'); if (raw.trim()) b = JSON.parse(raw); }
        const dRaw = stateOrFile('design', b.design);
        if (!dRaw) throw new Error('缺少 design（当前无状态且会话目录无 design.json）');
        json(res, 200, estimateBoard(dRaw));
        return;
      }
      json(res, 404, { ok: false, error: '未知端点：' + p });
    } catch (e) {
      if (!res.headersSent) json(res, e.status || 400, { ok: false, error: e.message });
      else res.destroy();
    }
  });
  server.on('close', () => { closed = true; disposeRoutingWorker(); if (activeChild) activeChild.kill(); for (const res of clients) res.end(); clients.clear(); });
  return { server, broadcast, state, setPort: p => { sessionPort = p; } };
}

/* 供 entry.mjs 使用：挑端口（默认 8931，被占自动 +1）并监听 127.0.0.1 */
export function listenBridge(server, port) {
  return new Promise((ok, bad) => {
    server.once('error', bad);
    server.listen(port, '127.0.0.1', () => ok(server.address().port));
  });
}

