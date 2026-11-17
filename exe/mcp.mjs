/* exe/mcp.mjs —— MCP stdio 模式：让 Claude Desktop / ZCode 等 MCP 客户端直接驱动 PCB Studio。
   零依赖实现 MCP 2025-06-18 协议的必要子集（newline-delimited JSON-RPC over stdio）。
   计算层与 HTTP 桥同源（exe/board-info.mjs）——MCP 客户端拿到与 HTTP 桥一致的能力。
   会话：默认 <cwd>/pcb-session，PCB_SESSION_DIR 可覆盖；设计落在 _mcp-design.json/_mcp-result.json。 */
import { safeSessionPath, writeFileSync as atomicWrite, validateCliInvocation, validateFootprint } from '../ai/pcb.mjs';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { join, resolve, isAbsolute, relative, sep } from 'node:path';
import * as engine from '../src/engine.mjs';
import { pngEncode } from '../src/png.mjs';
import { fpPads, syncComps, applyEditOp, forensicWhy, estimateBoard, boardSummary, boardQuery, drcLive, diffResults } from './board-info.mjs';

/* ---------- 会话 ---------- */
function sessionDirOf() {
  const dir = resolve(process.env.PCB_SESSION_DIR || join(process.cwd(), 'pcb-session'));
  mkdirSync(dir, { recursive: true });
  return dir;
}
const inside = (root, target) => {
  const rel = relative(resolve(root), resolve(target));
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep);
};
const readSource = (dir, v) => {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  const p = safeSessionPath(dir, v);
  return JSON.parse(readFileSync(p, 'utf8'));
};
const DESIGN_FILE = '_mcp-design.json', RESULT_FILE = '_mcp-result.json';
const stateOrFile = (dir, kind, v) => {
  if (v != null) return readSource(dir, v);
  const f = join(dir, kind === 'design' ? DESIGN_FILE : RESULT_FILE);
  return existsSync(f) ? readSource(dir, f) : null;
};
const history = [];   // pcb_edit 前快照（pcb_undo 回滚，深度 20）

/* ---------- CLI 子进程（与桥同配方：exe 下 spawn 自身，dev 下带脚本路径） ---------- */
function runCli(dir, cmd, args = [], timeoutMs = 300000) {
  validateCliInvocation(cmd, args, dir);
  return new Promise((ok, bad) => {
    const selfScript = process.argv[1] && process.argv[1] !== process.execPath ? process.argv[1] : null;
    const child = spawn(process.execPath, [...(selfScript ? [selfScript] : []), cmd, ...args],
      { cwd: dir, windowsHide: true, env: { ...process.env, PCB_CLI_SESSION_DIR: dir } });
    let out = [], err = [], bytes = 0, timedOut = false, outputLimit = false;
    const collect = (dest,c) => { bytes += c.length; if (bytes <= 32*1024*1024) dest.push(c); else { outputLimit = true; child.kill(); } };
    child.stdout.on('data', c => collect(out,c));
    child.stderr.on('data', c => collect(err,c));
    const t = setTimeout(() => { timedOut = true; try { child.kill('SIGKILL'); } catch {} }, Math.min(Math.max(Number(timeoutMs) || 300000, 1000), 3600000));
    child.on('close', code => {
      clearTimeout(t);
      const stdout = Buffer.concat(out).toString('utf8').trim();
      let j = null; try { j = JSON.parse(stdout); } catch {}
      ok({ exitCode: timedOut || outputLimit ? -1 : code, timedOut, outputLimit, json: j, stdout: j ? undefined : stdout, stderr: Buffer.concat(err).toString('utf8').slice(-2000) });
    });
    child.on('error', e => { clearTimeout(t); bad(e); });
  });
}

/* ---------- MCP 协议必要子集 ---------- */
const TOOLS = [
  { name: 'pcb_info', description: '查看 PCB Studio 会话信息（版本/会话目录/已有文件）', inputSchema: { type: 'object', properties: {} } },
  { name: 'pcb_summary', description: '状态摘要（统计+每网连通）——轮询用这个，别拉全量', inputSchema: { type: 'object', properties: {} } },
  { name: 'pcb_load', description: '载入设计 JSON（design 必填，可带 result）到会话；对象或会话内文件名；comps 漏写自动补',
    inputSchema: { type: 'object', properties: { design: {}, result: {} }, required: ['design'] } },
  { name: 'pcb_cmd', description: '运行无头 CLI 命令（place/route/drc/pour/tune/advise/export/deliver/render…），cwd=会话目录，参数同 ai/pcb.mjs',
    inputSchema: { type: 'object', properties: { cmd: { type: 'string' }, args: { type: 'array', items: { type: 'string' } }, timeoutMs: { type: 'number' } }, required: ['cmd'] } },
  { name: 'pcb_query', description: '结构化查询：{net} / {comp} / {pad}（焊盘坐标/引脚表/网路由状态）',
    inputSchema: { type: 'object', properties: { net: { type: 'string' }, comp: { type: 'string' }, pad: { type: 'string' } } } },
  { name: 'pcb_why', description: '失败法医报告：partial 时逐未连通边 blockers+advice+partialReasons',
    inputSchema: { type: 'object', properties: { design: {}, result: {} } } },
  { name: 'pcb_estimate', description: '布线前预估：层数初判 ok2/tight/need4', inputSchema: { type: 'object', properties: { design: {} } } },
  { name: 'pcb_edit', description: '语义编辑：set-net/add-net/remove-net/move-comp/set-pad/add-pad/clear-net-tracks/add-keepout/sync-comps',
    inputSchema: { type: 'object', properties: { op: { type: 'string' }, net: { type: 'string' }, comp: { type: 'string' }, pad: { type: 'string' }, pads: { type: 'array' }, x: { type: 'number' }, y: { type: 'number' }, dx: { type: 'number' }, dy: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' }, padObj: { type: 'object' }, keepout: { type: 'object' } }, required: ['op'] } },
  { name: 'pcb_undo', description: '撤销最近一次 pcb_edit（快照深度 20）', inputSchema: { type: 'object', properties: {} } },
  { name: 'pcb_fp', description: '封装生成器：name=SOIC-8|QFP-32|DIP-14|hdr1… + n/x/y/prefix → 绝对坐标焊盘',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, n: { type: 'number' }, x: { type: 'number' }, y: { type: 'number' }, prefix: { type: 'string' } }, required: ['name'] } },
  { name: 'pcb_state', description: '读取当前会话的 design/result JSON',
    inputSchema: { type: 'object', properties: { design: {}, result: {} } } },
  { name: 'pcb_render', description: '渲染 PNG（多模态目检）。design/result 可省略=当前 pcb_load 的设计',
    inputSchema: { type: 'object', properties: { scale: { type: 'number' }, highlight: { type: 'string' }, design: {}, result: {} } } },
  { name: 'pcb_drc', description: 'DRC+fabChecklist，findings 带 where 坐标', inputSchema: { type: 'object', properties: { design: {}, result: {} } } },
  { name: 'pcb_diff', description: 'A/B 判分：{a, b} 两个 result（对象或文件名）→ routeScore 六维裁决',
    inputSchema: { type: 'object', properties: { a: {}, b: {}, design: {} }, required: ['a', 'b'] } },
  { name: 'pcb_files', description: '列出会话目录中的文件', inputSchema: { type: 'object', properties: {} } },
];

function text(s) { return { content: [{ type: 'text', text: String(s) }] }; }

async function callTool(dir, name, a = {}) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) throw new Error('arguments must be an object');
  const writeFileSync = (p,data) => atomicWrite(safeSessionPath(dir,p),data);
  if (name === 'pcb_info') {
    return text(JSON.stringify({ version: globalThis.__PCB_VERSION__, sessionDir: dir, files: readdirSync(dir) }, null, 1));
  }
  if (name === 'pcb_summary') {
    const d = stateOrFile(dir, 'design', a.design);
    if (!d) throw new Error('会话无设计——先 pcb_load');
    return text(JSON.stringify(boardSummary(d, stateOrFile(dir, 'result', a.result), { sessionResident: false }), null, 1));
  }
  if (name === 'pcb_load') {
    const d = readSource(dir, a.design);
    if (!d) throw new Error('缺少 design');
    engine.normalizeDesign(JSON.parse(JSON.stringify(d)));
    const result = a.result == null ? null : readSource(dir, a.result);
    if (result) engine.normalizeResult(result.result || result, engine.normalizeDesign(JSON.parse(JSON.stringify(d))));
    const prevD = stateOrFile(dir, 'design', null), prevR = stateOrFile(dir, 'result', null);
    if (prevD) { if (history.length >= 20) history.shift(); history.push({ design: prevD, result: prevR, op: 'load' }); }
    const compsAdded = syncComps(d);
    writeFileSync(join(dir, DESIGN_FILE), JSON.stringify(d, null, 1));
    let rPath = null;
    if (result) { const r = result; writeFileSync(join(dir, RESULT_FILE), JSON.stringify(r, null, 1)); rPath = RESULT_FILE; }
    else if (existsSync(join(dir, RESULT_FILE))) {   // 新设计无 result：删旧 result 防错配（summary/drc 拿旧连通数全错）
      rmSync(safeSessionPath(dir, RESULT_FILE));
    }
    return text(JSON.stringify({ ok: true, design: DESIGN_FILE, result: rPath, compsAutoSynced: compsAdded || undefined,
      pads: (d.pads || []).length, nets: (d.nets || []).length }, null, 1));
  }
  if (name === 'pcb_cmd') {
    const r = await runCli(dir, a.cmd, a.args || [], a.timeoutMs);
    return text(JSON.stringify({ ok: r.exitCode === 0 && (!r.json || r.json.ok !== false), ...r }, null, 1).slice(0, 100000));
  }
  if (name === 'pcb_query') {
    const d = stateOrFile(dir, 'design', a.design);
    if (!d) throw new Error('会话无设计');
    return text(JSON.stringify(boardQuery(d, stateOrFile(dir, 'result', a.result), a), null, 1));
  }
  if (name === 'pcb_why') {
    const d = stateOrFile(dir, 'design', a.design);
    if (!d) throw new Error('会话无设计');
    return text(JSON.stringify(forensicWhy(d, stateOrFile(dir, 'result', a.result)), null, 1));
  }
  if (name === 'pcb_estimate') {
    const d = stateOrFile(dir, 'design', a.design);
    if (!d) throw new Error('会话无设计');
    return text(JSON.stringify(estimateBoard(d), null, 1));
  }
  if (name === 'pcb_edit') {
    const d = stateOrFile(dir, 'design', null);
    if (!d) throw new Error('会话无设计——先 pcb_load');
    const r = stateOrFile(dir, 'result', null);
    const out = applyEditOp(JSON.parse(JSON.stringify(d)), r ? JSON.parse(JSON.stringify(r)) : null, a);
    engine.normalizeDesign(out.d);   // 非法即抛错，不落盘（也不消耗快照）
    if (history.length >= 20) history.shift();
    history.push({ design: JSON.parse(JSON.stringify(d)), result: r ? JSON.parse(JSON.stringify(r)) : null, op: a.op });
    writeFileSync(join(dir, DESIGN_FILE), JSON.stringify(out.d, null, 1));
    if (out.r) writeFileSync(join(dir, RESULT_FILE), JSON.stringify(out.r, null, 1));
    return text(JSON.stringify({ ok: true, op: a.op, summary: out.summary, prunedResult: out.pruned }, null, 1));
  }
  if (name === 'pcb_undo') {
    if (!history.length) throw new Error('没有可撤销的历史');
    const snap = history.pop();
    if (snap.design) writeFileSync(join(dir, DESIGN_FILE), JSON.stringify(snap.design, null, 1));
    if (snap.result) writeFileSync(join(dir, RESULT_FILE), JSON.stringify(snap.result, null, 1));
    else if (existsSync(join(dir, RESULT_FILE))) rmSync(safeSessionPath(dir, RESULT_FILE));
    return text(JSON.stringify({ ok: true, restored: snap.op, remaining: history.length }, null, 1));
  }
  if (name === 'pcb_fp') {
    if (!a.name) throw new Error('缺少 name');
    validateFootprint(a.name, a.n ?? 0, a.x ?? 0, a.y ?? 0);
    return text(JSON.stringify({ ok: true, ...fpPads(a.name, a.n ?? 0, a.x ?? 0, a.y ?? 0, String(a.prefix || 'U1')),
      note: 'netId 未分配——spec 里 nets[].pads 引用这些 id' }, null, 1));
  }
  if (name === 'pcb_state') {
    const d = stateOrFile(dir, 'design', a.design);
    const r = a.result ? stateOrFile(dir, 'result', a.result) : stateOrFile(dir, 'result', null);
    return text(JSON.stringify({ design: d, result: r }, null, 1).slice(0, 100000));
  }
  if (name === 'pcb_render') {
    const dd = stateOrFile(dir, 'design', a.design);
    if (!dd) throw new Error('先 pcb_load 或传入 design');
    const norm = engine.normalizeDesign(dd);
    const rv = stateOrFile(dir, 'result', a.result);
    const rr = rv ? engine.normalizeResult(rv.result || rv, norm) : { nets: [] };
    const img = engine.renderBoardPixels(norm, rr, { scale: Math.min(Math.max(Number(a.scale) || 8, 1), 32), ...(a.highlight ? { highlightNet: String(a.highlight) } : {}) });
    const png = pngEncode(img.width, img.height, img.px);
    return { content: [{ type: 'image', data: png.toString('base64'), mimeType: 'image/png' }] };
  }
  if (name === 'pcb_drc') {
    const d = stateOrFile(dir, 'design', a.design);
    if (!d) throw new Error('会话无设计');
    return text(JSON.stringify(drcLive(d, stateOrFile(dir, 'result', a.result)), null, 1));
  }
  if (name === 'pcb_diff') {
    const d = stateOrFile(dir, 'design', a.design);
    if (!d) throw new Error('会话无设计');
    return text(JSON.stringify(diffResults(d, readSource(dir, a.a), readSource(dir, a.b)), null, 1));
  }
  if (name === 'pcb_files') {
    return text(JSON.stringify({ sessionDir: dir, files: readdirSync(dir) }, null, 1));
  }
  throw new Error('未知工具：' + name);
}

export async function startMcp() {
  const dir = sessionDirOf();
  const reply = (id, result) => { if (id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n'); };
  const replyErr = (id, code, message) => { if (id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n'); };
  let buf = '', queue = Promise.resolve(), pending = 0;
  history.length = 0;
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', c => {
    buf += c;
    if (buf.length > 64 * 1024 * 1024) { replyErr(null, -32600, 'Input too large'); buf = ''; process.stdin.destroy(); return; }
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      let msg; try { msg = JSON.parse(line); } catch { replyErr(null,-32700,'Parse error'); continue; }
      if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') { replyErr(null,-32600,'Invalid Request'); continue; }
      const { id, method, params } = msg;
      if (method === 'initialize') reply(id, { protocolVersion: params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {} }, serverInfo: { name: 'pcb-studio', version: globalThis.__PCB_VERSION__ } });
      else if ((method || '').startsWith('notifications/')) { /* 无需回应 */ }
      else if (method === 'tools/list') reply(id, { tools: TOOLS });
      else if (method === 'tools/call') {
        if (pending >= 32) { replyErr(id,-32000,'Too many pending calls'); continue; }
        pending++;
        queue = queue.then(() => callTool(dir, params?.name, params?.arguments ?? {}))
          .then(r => reply(id, r)).catch(e => reply(id, { content: [{ type:'text', text:'错误：' + e.message }], isError:true }))
          .finally(() => { pending--; });
      }
      else if (method === 'ping') reply(id, {});
      else replyErr(id, -32601, '未知方法：' + method);
    }
  });
  process.stdin.resume();
}
