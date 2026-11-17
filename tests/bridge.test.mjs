/* AI 控制桥端到端测试：spawn dist/main.cjs serve（--port 0 临时端口）→
   health / 页面注入 / load / SSE state / cmd 子进程 / files / render PNG / 跨站拒绝 / MCP 握手。
   dist/main.cjs 缺失时自动用 esbuild 构建（scripts/build-exe.mjs --no-exe）。 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mainCjs = join(root, 'dist', 'main.cjs');
let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } };

if (!existsSync(mainCjs)) {
  console.log('dist/main.cjs 缺失，先构建…');
  const built = await spawnWait(spawn(process.execPath, [join(root, 'scripts', 'build-exe.mjs'), '--no-exe'],
    { cwd: root, windowsHide: true, stdio: 'inherit' }), 180000);
  if (!built) { console.log('  ✗ 构建失败'); process.exit(1); }
}
function spawnWait(child, timeoutMs) {
  return new Promise(res => {
    const timer = setTimeout(() => { try { child.kill(); } catch {} res(false); }, timeoutMs);
    child.on('error', () => { clearTimeout(timer); res(false); });
    child.on('exit', c => { clearTimeout(timer); res(c === 0); });
  });
}

const sessionDir = mkdtempSync(join(tmpdir(), 'pcb-bridge-test-'));
const server = spawn(process.execPath, [mainCjs, 'serve', '--port', '0', '--session-dir', sessionDir, '--no-open'],
  { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let serverOut = '';
server.stdout.on('data', c => serverOut += c.toString());
server.stderr.on('data', c => serverOut += c.toString());
server.on('error', e => serverOut += 'SPAWN ERROR: ' + e.message);

/* 等 bridge.json 出现（服务写好的连接信息，含实际端口） */
async function waitInfo(ms = 15000) {
  const p = join(sessionDir, 'bridge.json');
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (existsSync(p)) { try { return JSON.parse(readFileSync(p, 'utf8')); } catch {} }
    await new Promise(r => setTimeout(r, 150));
  }
  return null;
}
const api = async (path, opts = {}) => {
  const r = await fetch('http://127.0.0.1:' + info.port + path, opts);
  return r;
};

const info = await waitInfo();
try {
  t('服务启动并写出 bridge.json', !!info && !!info.port && !!info.token);

  if (!info) throw new Error('Bridge startup failed: ' + serverOut);
  const health = await (await api('/api/health')).json();
  t('health: ok/mode/version', health.ok === true && health.mode === 'bridge' && !!health.version);

  const page = await (await api('/')).text();
  t('页面注入 __PCB_BRIDGE（head 闭合标签前）', page.indexOf('window.__PCB_BRIDGE') >= 0
    && page.indexOf('window.__PCB_BRIDGE') < page.indexOf('</head>'));

  const design = { width: 60, height: 40, grid: 0.5, layers: 2, trackW: 0.3, clearance: 0.3, viaOuter: 0.6, viaDrill: 0.3,
    nets: [ { id: 'VCC', pads: ['J1-1', 'U1-8'] }, { id: 'GND', pads: ['J1-2', 'U1-4'] }, { id: 'SIG', pads: ['J1-3', 'U1-1'] } ],
    pads: [ { id: 'J1-1', x: 8, y: 8, w: 1.2, h: 1.2, netId: 'VCC', compId: 'J1', holeR: 0.45 },
      { id: 'J1-2', x: 8, y: 12, w: 1.2, h: 1.2, netId: 'GND', compId: 'J1', holeR: 0.45 },
      { id: 'J1-3', x: 8, y: 16, w: 1.2, h: 1.2, netId: 'SIG', compId: 'J1', holeR: 0.45 },
      { id: 'U1-1', x: 48, y: 8, w: 0.6, h: 0.6, netId: 'SIG', compId: 'U1' },
      { id: 'U1-4', x: 48, y: 12, w: 0.6, h: 0.6, netId: 'GND', compId: 'U1' },
      { id: 'U1-8', x: 48, y: 16, w: 0.6, h: 0.6, netId: 'VCC', compId: 'U1' } ] };

  /* SSE：先订阅，再推送，等 state 事件 */
  const sseBody = await api('/api/events').then(r => r.body);
  let sseBuf = '';
  const sseDone = (async () => {
    const dec = new TextDecoder();
    for await (const chunk of sseBody) { sseBuf += dec.decode(chunk); if (sseBuf.includes('event: state')) return true; }
    return false;
  })();

  const load = await (await api('/api/load', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ design }) })).json();
  t('load: 内联对象落成会话文件 design.json', load.ok === true && load.designPath === 'design.json'
    && existsSync(join(sessionDir, 'design.json')));
  t('SSE 收到 state 事件', await Promise.race([sseDone.then(Boolean), new Promise(r => setTimeout(() => r(false), 8000))]));
  sseBody.cancel().catch(() => {});

  const st = await (await api('/api/state')).json();
  t('state: design 可取回', st.ok === true && (st.design?.pads || []).length === 6);

  const cmd = await (await api('/api/cmd', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmd: 'place', args: ['design.json', '-o', 'placed.json'], timeoutMs: 60000 }) })).json();
  t('cmd place: 子进程执行成功', cmd.ok === true && cmd.exitCode === 0 && cmd.json?.ok === true);
  t('cmd 产物在会话目录', existsSync(join(sessionDir, 'placed.json')));

  const files = await (await api('/api/files')).json();
  t('files: 列出会话文件', files.ok === true && files.items.some(f => f.name === 'placed.json'));

  const png = Buffer.from(await (await api('/api/render?scale=8')).arrayBuffer());
  t('render: PNG 魔数', png.length > 100 && png[0] === 137 && png[1] === 80 && png[2] === 78 && png[3] === 71);

  /* 界面截图通道（AI 的眼睛）：POST PNG → GET 回读一致 + health.screenshotAt + 去重 */
  const { pngEncode } = await import(pathToFileURL(join(root, 'src', 'png.mjs')).href);
  const tiny = pngEncode(4, 4, new Uint8Array(4 * 4 * 4).fill(200));
  const up = await (await api('/api/ui-screenshot', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: tiny })).json();
  t('ui-screenshot: PNG 接收', up.ok === true && up.bytes === tiny.length && up.changed === true);
  const back = Buffer.from(await (await api('/api/screenshot.png')).arrayBuffer());
  t('screenshot.png 回读与上传一致', back.equals(tiny));
  const up2 = await (await api('/api/ui-screenshot', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: tiny })).json();
  t('相同截图去重（changed=false）', up2.ok === true && up2.changed === false);
  const h3 = await (await api('/api/health')).json();
  t('health 带 screenshotAt', h3.ok === true && h3.screenshotAt > 0);

  /* AI 超能力四件套：estimate / why / edit / view */
  const est = await (await api('/api/estimate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
  t('estimate: 下界+容量+判定', est.ok === true && est.totalLbMm > 0 && est.capacity.usableMm > 0
    && est.verdict && ['ok2', 'tight', 'need4'].includes(est.verdict.code) && est.netRows.length >= 3);

  const why0 = await (await api('/api/why', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
  t('why: 未布状态全算失败网', why0.ok === true && why0.unroutedEdges >= 3 && why0.fails.length >= 1
    && why0.fails[0].lbMm > 0 && Array.isArray(why0.fails[0].edges));

  const ed1 = await (await api('/api/edit', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'set-net', net: 'VCC', w: 0.6 }) })).json();
  t('edit set-net 改线宽', ed1.ok === true && ed1.summary.changed.includes('w'));
  const st2 = await (await api('/api/state')).json();
  t('edit 后 state 中 VCC.w=0.6', st2.design.nets.find(n => n.id === 'VCC').w === 0.6);

  const j1 = st2.design.pads.filter(p => p.compId === 'J1' || p.id.startsWith('J1-'));
  const jx0 = j1[0].x;
  const ed2 = await (await api('/api/edit', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'move-comp', comp: 'J1', dx: 2, dy: 0 }) })).json();
  const st3 = await (await api('/api/state')).json();
  const jx1 = st3.design.pads.find(p => p.id === j1[0].id).x;
  t('edit move-comp 平移元件', ed2.ok === true && Math.abs(jx1 - jx0 - 2) < 1e-6);

  const ed3 = await (await api('/api/edit', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'add-pad', pad: { id: 'TP1-1', netId: 'GND', x: 30, y: 30, w: 1, h: 1 } }) })).json();
  const st4 = await (await api('/api/state')).json();
  t('edit add-pad 加测试点', ed3.ok === true && st4.design.pads.some(p => p.id === 'TP1-1'));

  const ed4 = await (await api('/api/edit', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'nope' }) })).json();
  t('edit 未知 op 报错', ed4.ok === false && /未知 op/.test(ed4.error));

  const view0 = await api('/api/view?net=GND');
  const view0j = await view0.json();
  t('view: 无浏览器连接时给 fallback 提示', view0j.ok === false && view0j.fallback === true
    && /api\/render/.test(view0j.error + (view0j.fallback || '')));

  /* fp 封装生成器 */
  const fp = await (await api('/api/fp?name=SOIC-8&x=40&y=20&prefix=U1')).json();
  t('fp SOIC-8: 8 个绝对坐标焊盘', fp.ok === true && fp.count === 8 && fp.pads[0].id === 'U1-1' && Math.abs(fp.pads[0].x - 37.3) < 0.01);
  const fp2 = await (await api('/api/fp?name=DIP-14')).json();
  t('fp DIP-14: 14 焊盘全部带孔', fp2.ok === true && fp2.count === 14 && fp2.pads.every(p => p.holeR > 0));
  const fp3 = await (await api('/api/fp?name=hdr2&n=4')).json();
  t('fp hdr2 别名 → 排针 2×N', fp3.ok === true && fp3.count === 8 && fp3.name === '排针 2×N');

  /* save-design：桥自动附加 flag，place/route 后 design 与 result 坐标系一致 */
  const rt = await (await api('/api/cmd', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmd: 'route', args: ['design.json', '-o', 'result.json'], timeoutMs: 60000,
      autoLoad: { design: 'design.json', result: 'result.json' } }) })).json();
  t('route cmd（自动 --save-design + autoLoad）', rt.ok === true && rt.loaded === true);
  const st5 = await (await api('/api/state')).json();
  t('route 后 design.grid 已写回（幻影边根治）', st5.design.grid > 0.5 && st5.result != null);

  /* partialReasons */
  const why1 = await (await api('/api/why', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
  t('why 带 partialReasons 分解', why1.ok === true && why1.partialReasons != null
    && Number.isInteger(why1.partialReasons.fails) && Number.isInteger(why1.partialReasons.drcErrors));

  /* edit 几何变更 → result 修剪 + stale 标记 */
  const moved2 = await (await api('/api/edit', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'move-comp', comp: 'J1', dx: 3, dy: 0 }) })).json();
  t('move-comp 触发 result 修剪', moved2.ok === true && moved2.prunedResult === true);
  const st6 = await (await api('/api/state')).json();
  t('修剪后 result.stale=true', st6.result != null && st6.result.stale === true);

  /* undo 回滚编辑 */
  const hist0 = await (await api('/api/history')).json();
  const undo = await (await api('/api/undo', { method: 'POST' })).json();
  t('undo 回滚编辑（快照恢复）', undo.ok === true && undo.remaining === hist0.count - 1);

  /* route-live：进程内布线 + 会话驻留 + 单网重布 + 会话失效拒绝 */
  const rl = await (await api('/api/route-live', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
  t('route-live: 进程内布线 + 会话驻留', rl.ok === true && rl.session === true && rl.stats != null);
  const rr = await (await api('/api/reroute-net', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ net: 'GND' }) })).json();
  t('reroute-net: 会话内单网重布', rr.ok === true && rr.outcome != null);
  const ed5 = await (await api('/api/edit', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'set-net', net: 'SIG', w: 0.4 }) })).json();
  const rr2 = await (await api('/api/reroute-net', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ net: 'GND' }) })).json();
  t('edit 后 reroute-net 拒绝（会话已失效）', rr2.ok === false);
  const cancel = await (await api('/api/cancel', { method: 'POST' })).json();
  t('cancel 端点冒烟', cancel.ok === true);

  /* diff A/B 判分 */
  const diff = await (await api('/api/diff', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ a: 'result.json', b: 'result.json' }) })).json();
  t('diff: 同结果判平手 + 分项 delta', diff.ok === true && diff.verdict === '平手' && diff.scoreLabels.length === 6);

  /* history */
  const hist = await (await api('/api/history')).json();
  t('history 快照记录', hist.ok === true && hist.count >= 1);


  /* 深度优化批次：summary/query/drc-live/render crop+highlight/新封装 */
  const summ = await (await api('/api/summary')).json();
  t('summary: 摘要替代全量 state', summ.ok === true && summ.counts.pads > 0 && summ.nets.length >= 3 && summ.status && summ.connected !== undefined && summ.sessionResident !== undefined);

  const qn = await (await api('/api/query?net=GND')).json();
  t('query net: 焊盘+下界+路由详情', qn.ok === true && qn.kind === 'net' && qn.pads.length >= 2 && qn.lbMm > 0 && qn.routedLenMm > 0 && qn.connected === qn.total);

  const qc = await (await api('/api/query?comp=U1')).json();
  t('query comp: 引脚+网络+bbox', qc.ok === true && qc.kind === 'comp' && qc.pads.length === 3 && qc.nets.length === 3);

  const qp = await (await api('/api/query?pad=U1-8')).json();
  t('query pad: 单焊盘+所属网状态', qp.ok === true && qp.kind === 'pad' && qp.net === 'VCC' && qp.netRouted.total === 2);

  const drc = await (await api('/api/drc-live', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
  t('drc-live: findings+fabChecklist+where 定位', drc.ok === true && drc.findings.length > 0
    && drc.fabChecklist.length > 0 && drc.findings.every(f => 'where' in f));

  const crop = Buffer.from(await (await api('/api/render?scale=8&crop=4,6,12,14')).arrayBuffer());
  const full = Buffer.from(await (await api('/api/render?scale=8')).arrayBuffer());
  t('render crop: 裁剪图小于全图且是合法 PNG', crop.length < full.length && crop[0] === 137 && crop[1] === 80);

  const hl = await api('/api/render?scale=8&highlight=GND');
  t('render highlight: 高亮渲染 200 PNG', hl.status === 200 && (await hl.arrayBuffer()).byteLength > 100);

  /* 新封装（QFP/QFN/BGA/XTAL）走 /api/fp */
  const fq = await (await api('/api/fp?name=QFP-32&x=30&y=20&prefix=U2')).json();
  t('fp QFP-32: 32 焊盘四边分布', fq.ok === true && fq.count === 32
    && fq.pads.filter(p => p.x < 30 - 3.7).length === 8 && fq.pads.filter(p => p.x > 30 + 3.7).length === 8
    && fq.pads.filter(p => p.y < 20 - 3.7).length === 8 && fq.pads.filter(p => p.y > 20 + 3.7).length === 8);
  const fb = await (await api('/api/fp?name=BGA-64')).json();
  t('fp BGA-64: 64 球无孔', fb.ok === true && fb.count === 64 && fb.pads.every(p => !p.holeR));
  const fx = await (await api('/api/fp?name=XTAL-3225&prefix=Y1')).json();
  t('fp XTAL-3225: 4 焊盘', fx.ok === true && fx.count === 4 && fx.pads[0].id === 'Y1-1');

  /* comps 自动同步：load 无 comps 的设计 → 自动补齐 */
  const load2 = await (await api('/api/load', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ design: { width: 20, height: 15, grid: 0.5, layers: 2, trackW: 0.3, clearance: 0.3, viaOuter: 0.6, viaDrill: 0.3,
      nets: [{ id: 'N1', pads: ['X1-1', 'X2-1'] }],
      pads: [{ id: 'X1-1', x: 4, y: 4, w: 1, h: 1, netId: 'N1' }, { id: 'X2-1', x: 16, y: 10, w: 1, h: 1, netId: 'N1' }] } }) })).json();
  t('load 自动补 comps 元数据', load2.ok === true && load2.compsAutoSynced === 2);
  const sc = await (await api('/api/edit', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'sync-comps' }) })).json();
  t('edit sync-comps 幂等', sc.ok === true && sc.summary.compsAdded === 0);

  /* AI 工效批次：help / examples / drc-mark / 多网高亮 */
  const help = await (await api('/api/help')).json();
  t('help: 自描述接口目录', help.ok === true && help.endpoints.length >= 20
    && help.workflows && help.cmdCommands.length >= 25 && help.tips.length >= 3);

  const ex = await (await api('/api/examples')).json();
  t('examples: 内置示例板可直接喂 load', ex.ok === true && ex.items.length === 3 && ex.items[0].design.width > 0);

  /* drc 违规叠加渲染：异网焊盘重叠（DRC 焊盘重叠 error）→ mark.png 有 X-Marked */
  const badDesign = { width: 20, height: 15, grid: 0.5, layers: 2, trackW: 0.3, clearance: 0.3, viaOuter: 0.6, viaDrill: 0.3,
    nets: [{ id: 'N1', pads: ['X1-1'] }, { id: 'N2', pads: ['X2-1'] }],
    pads: [{ id: 'X1-1', x: 6, y: 6, w: 2, h: 2, netId: 'N1', compId: 'X1' },
      { id: 'X2-1', x: 7.2, y: 6, w: 2, h: 2, netId: 'N2', compId: 'X2' }] };
  await (await api('/api/load', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ design: badDesign }) })).json();
  const mark = await api('/api/drc-live/mark.png?scale=10');
  t('drc mark.png: 违规红圈叠加渲染', mark.status === 200 && Number(mark.headers.get('x-marked')) >= 1
    && (await mark.arrayBuffer()).byteLength > 200);

  const hl2 = await api('/api/render?scale=8&highlight=N1');
  t('render highlight 单网', hl2.status === 200);

  const cross = await api('/api/load', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
    body: JSON.stringify({ design: badDesign }) });
  t('跨站 Origin 请求被拒绝（403）', cross.status === 403);

  const badPath = await (await api('/api/load', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ design: '../escape.json' }) })).json();
  t('路径越界被拒绝', badPath.ok === false);

  /* MCP 握手 */
  const mcpDir = mkdtempSync(join(tmpdir(), 'pcb-mcp-test-'));
  const mcp = spawn(process.execPath, [mainCjs, 'mcp'], { cwd: root, windowsHide: true,
    env: { ...process.env, PCB_SESSION_DIR: mcpDir }, stdio: ['pipe', 'pipe', 'pipe'] });
  let mcpBuf = '';
  mcp.stdout.on('data', c => mcpBuf += c.toString());
  mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test' } } }) + '\n');
  mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
  mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'pcb_info', arguments: {} } }) + '\n');
  const mcpEnd = Date.now() + 8000;
  while (Date.now() < mcpEnd && (mcpBuf.match(/\n/g) || []).length < 3) await new Promise(r => setTimeout(r, 100));
  const mcpLines = mcpBuf.trim().split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  t('MCP initialize 应答', mcpLines.some(m => m.id === 1 && m.result?.serverInfo?.name === 'pcb-studio'));
  t('MCP tools/list 包含全部公开工具（与桥能力同步）', mcpLines.some(m => m.id === 2
    && ['pcb_info','pcb_summary','pcb_load','pcb_cmd','pcb_query','pcb_why','pcb_estimate','pcb_edit','pcb_undo','pcb_fp','pcb_state','pcb_render','pcb_drc','pcb_diff','pcb_files']
      .every(name => (m.result?.tools || []).some(tool => tool.name === name))));
  t('MCP tools/call pcb_info 返回会话', mcpLines.some(m => m.id === 3 && (m.result?.content || []).some(c => (c.text || '').includes('sessionDir'))));
  mcp.kill();

  console.log('桥接结果：' + pass + ' 通过, ' + fail + ' 失败');
} finally {
  try { server.kill(); } catch {}
  try { rmSync(sessionDir, { recursive: true, force: true }); } catch {}
}
process.exitCode = fail ? 1 : 0;
