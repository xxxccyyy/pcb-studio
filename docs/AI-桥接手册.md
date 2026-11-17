# AI 桥接手册（exe 实时控制接口的操作规程）

> 本文面向**要实时操控 PCB Studio 的 AI 代理**（ZCode/Claude/任意能跑 shell 的代理）与 MCP 客户端。
> 批处理式工作流（一次一条命令跑完）见《[AI-使用手册](AI-使用手册.md)》——两者用同一个引擎、同一套命令，
> 桥接模式多了「人在浏览器看、AI 实时推」的同屏协作能力。

## 0. 这是什么

`pcb-studio.exe` 是整个工具的单文件打包（免装 Node，约 93MB）。双击 = 启动内置服务 + 自动打开浏览器工作台，
同时开放**本地 HTTP 控制桥**：AI 通过 HTTP 接口推设计、跑引擎命令、渲染 PNG 目检；界面通过 SSE 实时收到
AI 的每一步操作并即时刷新。人可以随时插手（手动布线、调参数），AI 也能回读人的改动——双向可见。

同一个 exe 三种用法：

| 用法 | 形态 |
|---|---|
| `pcb-studio.exe`（双击/`serve`） | 界面 + AI 控制桥（本文） |
| `pcb-studio.exe route design.json -o result.json …` | 无头 CLI，与 `node ai/pcb.mjs` 完全同参 |
| `pcb-studio.exe mcp` | MCP stdio 服务（§6） |

## 1. 启动与发现

```
pcb-studio.exe [--port N] [--session-dir D] [--no-open]
```

- 默认端口 8931（被占自动 +1），默认会话目录 `<cwd>/pcb-session/`
- 启动即写 **`<会话目录>/bridge.json`**——AI 的第一站：

```json
{ "ok": true, "mode": "serve", "version": "0.15.0", "port": 8931,
  "url": "http://127.0.0.1:8931", "token": "…", "sessionDir": "…", "pid": 1234 }
```

- 控制台窗口 = 服务日志；关闭窗口即停止服务
- 所有接口仅监听 127.0.0.1；带 `Origin` 的浏览器跨站请求一律 403（防 drive-by）

## 2. 接口一览（全部本地 HTTP，返回 JSON）

| 端点 | 方法 | 作用 |
|---|---|---|
| `/api/health` | GET | 版本/端口/会话目录/忙碌状态/在线界面数 |
| `/api/load` | POST | 载入 design(+result)：对象或会话内文件名 → 存盘 + SSE 推给界面 |
| `/api/cmd` | POST | 跑无头 CLI 命令（place/route/drc/pour/tune/advise/export/deliver/render/…），cwd=会话目录 |
| `/api/state` | GET | 当前 design+result + 界面回传的最新快照（含人的手动编辑） |
| `/api/render?scale=8` | GET | 渲染当前（或指定文件）状态 PNG——引擎几何栅格化，不受界面视图影响 |
| `/api/screenshot.png` | GET | **工作台画布真实截图**（界面自动回传，AI 所见即人所见，含视图缩放/图层开关/选中态） |
| `/api/files` | GET | 列会话目录文件（名字/大小/时间） |
| `/api/events` | GET | SSE 事件流：`hello`/`state`/`busy`/`log`/`cmd-done`/`ui-state`/`screenshot`/`view-cmd`/`progress` |
| `/api/ui-state` | POST | 界面端自动回传快照（防抖 800ms + hash 去重，AI 只读） |
| `/api/ui-screenshot` | POST | 界面端自动回传画布截图（防抖 1.2s + hash 去重，AI 只读） |
| `/api/view` | GET | **镜头控制**：`?net=GND&region=40,0,20,20&pad=U1-1&fit=1` → 界面聚焦+高亮并回传截图（§6） |
| `/api/why` | POST | **失败法医报告**：逐未连通边采样，报告被谁挡住+建议（§6） |
| `/api/edit` | POST | **语义编辑**：set-net/add-net/move-comp/clear-net-tracks… 细粒度改设计（§6） |
| `/api/estimate` | POST/GET | **布线前预估**：理论线长下界 vs 容量 → 层数初判（§6） |
| `/api/fp` | GET | **封装生成器**：`?name=SOIC-8&x=40&y=20&prefix=U1` → 绝对坐标焊盘数组（§6） |
| `/api/route-live` | POST | **进程内布线**：SSE `progress` 直播进度、可取消、会话驻留（§6） |
| `/api/reroute-net` | POST | **单网重布**：会话内秒级重布一根网，不动其它走线（§6） |
| `/api/cancel` | POST | 中断进行中的 route-live（会话丢弃） |
| `/api/diff` | POST | **A/B 判分**：两个 result 的 routeScore 分项 delta 与裁决（§6） |
| `/api/summary` | GET | **状态摘要**：统计+每网连通状态——日常轮询用这个，别拉全量 /api/state |
| `/api/help` | GET | **自描述接口目录**（AI 冷启动第一站）：全部端点速查+工作流配方+tips |
| `/api/examples` | GET | 内置示例板（design JSON 直接喂 /api/load，快速验证全流程） |
| `/api/query` | GET | **结构化查询**：`?net=GND` / `?comp=U1` / `?pad=U1-3`（§6） |
| `/api/drc-live` | POST | **DRC+定位**：findings 带 where 坐标（msg 解析），可配合 /api/view 目检（§6） |
| `/api/drc-live/mark.png` | GET | DRC 违规**红圈叠加渲染**（X-Marked 头=定位数）——AI 一眼看到违规在哪 |
| `/api/undo` | POST | 撤销最近一次 edit/load（快照恢复，深度 20） |
| `/api/history` | GET | 快照历史列表 |

约定：`POST /api/load` 传内联对象时自动落成 `design.json`/`result.json`（`name` 可覆盖设计文件名），
响应带回 `designPath`/`resultPath`——后续 `/api/cmd` 直接引用这些文件名。
服务重启后内存态清空时，`why`/`estimate`/`edit` 自动回退读会话目录的 `design.json`/`result.json`。

## 3. 标准实时工作流（每步看输出再决定下一步）

> **⓪ 先问观众（硬性交互规则，AGENTS.md 同款）**：开始实时画图前必须先问用户
> 「要不要在浏览器里看着 AI 画图」——要 → 确认 serve 已起、浏览器已开工作台（默认自动开，
> 已在看就别重开）；不要 → 改走无头 CLI（不开界面）静默完成，只交付结果。

```bash
B=http://127.0.0.1:8931   # 读 bridge.json 拿端口
# ⓪ 画图前先问观众：用户要看 → 确认浏览器已开工作台；不看 → 改走无头 CLI（见 AI-使用手册）

# ① 推设计（内联 JSON 或会话内路径均可）——浏览器界面立刻刷新
curl -s -X POST $B/api/load -d '{"design":{…spec…}}'

# ② 跑命令（子进程执行，cwd=会话目录；长命令调大 timeoutMs）
curl -s -X POST $B/api/cmd -d '{"cmd":"spec","args":["design.json"]}'
curl -s -X POST $B/api/estimate -d '{}'                       # 布线前 1 秒预估：层数初判（§6）
curl -s -X POST $B/api/cmd -d '{"cmd":"place","args":["design.json","-o","placed.json"],"timeoutMs":120000,"autoLoad":{"design":"placed.json"}}'
# 布线推荐 route-live（进度直播/可取消/会话驻留，§6.6）；要并行旗标才用 /api/cmd route
curl -s -X POST $B/api/route-live -d '{}'
# partial 时先看法医报告再动手（§6）：谁挡的、在哪、怎么办——别盲目重跑
curl -s -X POST $B/api/why -d '{}'

# ③ 渲染目检（多模态 AI 直接看图：红=顶层线/蓝=底层线/金=焊盘过孔/深绿=板区/浅绿=覆铜）
curl -s -o board.png "$B/api/render?scale=8"

# ④ 检查与交付
curl -s -X POST $B/api/cmd -d '{"cmd":"drc","args":["placed.json","result.json"]}'
curl -s -X POST $B/api/cmd -d '{"cmd":"deliver","args":["placed.json","result.json","-o","交付","--project","demo"]}'

# ⑤ 视觉确认（AI 亲眼验收）：工作台真实截图 + 引擎几何渲染各看一眼；局部特写用镜头控制
curl -s -o board-ui.png  "$B/api/screenshot.png"
curl -s -o board-eng.png "$B/api/render?scale=8"
curl -s -o gnd-zoom.png  "$B/api/view?net=GND&region=40,0,20,20"
```

- `autoLoad`：命令成功后自动把产物推给界面（省一次 /api/load）
- `/api/cmd` 串行执行（队列），`busy` 期间再提交会排队；响应带 `exitCode`/`json`/`stderrTail`/`durationMs`
- stderr 逐行经 SSE `log` 事件直播，界面上能看到 AI 正在跑什么
- 命令失败先看 `stderrTail` 与 `json.error`；决策规程/修复循环与批处理模式完全一致（《AI-使用手册》§3.1）

## 4. AI 怎么「实时知道画了什么」（双通道 + 双目检）

**数据通道**（AI 知道设计内容）：
- AI 自己的动作：/api/load、/api/cmd(autoLoad) 每一步都有响应 JSON；`busy`/`log` SSE 事件直播命令进度
- 人的动作：界面每次视觉/数据变更自动回传——SSE `ui-state` 事件通知 + `GET /api/state` 的
  `uiState` 字段（含手动布线、拖焊盘、改参数后的人端最新状态）

**视觉通道**（AI 亲眼确认，双口径互补）：

| | `GET /api/screenshot.png` | `GET /api/render?scale=8` |
|---|---|---|
| 内容 | **工作台画布真实截图**——人所见即 AI 所见（视图缩放、图层开关、选中态、标签） | 引擎几何栅格化——确定性，含全部铜层/覆铜，不受视图影响 |
| 时效 | 界面变更后 ~1.2s 自动更新（`health.screenshotAt` 是时间戳；SSE `screenshot` 事件通知） | 随时现算，永远新鲜 |
| 依赖 | 浏览器工作台开着且标签页可见（后台标签页 rAF 暂停时保持最后一张好的，`screenshotAt` 不更新） | 无（无浏览器也能用） |

**AI 目检规程**：画完/改完先拉 `/api/screenshot.png` 对照「人看到的」；`screenshotAt` 过旧
（如标签页在后台）或需要几何裁决时用 `/api/render`；两者矛盾时以 DRC/verify 输出为准。

## 5. 渲染目检口径（/api/render）

`/api/render` 与 CLI `render` 同一管线（`renderBoardPixels` + 同一 PNG 编码器）。scale=8 时
60×40mm 板 → 480×320px。建议交付前必看：连通预拉线是否清零、有无明显绕行/拥塞、覆铜是否成型。
PNG 是栅格化近似，几何裁决以 DRC/verify 输出为准（证据分级同 AI-使用手册）。
与 `/api/screenshot.png`（界面真实截图）的分工见 §4 双通道表。

## 6. AI 布线增强四件套（view / why / edit / estimate）

### 6.1 镜头控制 `GET /api/view` —— AI 的变焦眼睛

整板截图看密集板是一团浆糊。`/api/view` 让**界面**聚焦后截图返回 PNG：

| 参数 | 作用 |
|---|---|
| `net=GND` | 高亮该网络（其它网络与焊盘淡化），配合 `region`/`pad` 使用 |
| `region=x,y,w,h` | 镜头推近到该 mm 矩形（自动留边距） |
| `pad=U1-1` | 居中到某焊盘（配 `scale=` 指定 px/mm） |
| `fit=1` | 适应整板（复位镜头） |

机制：服务端经 SSE `view-cmd` 通知界面 → 客户端**同步**改视图 + 直绘 + 截图上传（不经 rAF 防抖，后台标签页也可用）→ 服务端等截图更新后把 PNG 返给 AI。无界面连接或 3.5s 超时返回 `{ok:false, fallback:'/api/render'}`——AI 收到 fallback 改用引擎渲染。

### 6.2 失败法医报告 `POST /api/why`

route `partial` 时**别盲目重跑**。`/api/why` 对每条未连通边沿直连路径采样 21 点，报告：

```json
{ "ok": true, "status": "partial", "unroutedEdges": 2,
  "fails": [{ "net": "GND", "lbMm": 40.0, "pads": ["J1-2","U1-4"],
    "edges": [{ "from": {"x":8,"y":12}, "to": {"x":48,"y":12}, "lenMm": 40.0,
      "blockedSamples": 9, "samples": 21,
      "blockers": [{"kind":"pad","id":"U1-8","x":48,"y":16,"dist":0.31},
                   {"kind":"track","net":"VCC","x":28,"y":12}],
      "worstPoint": {"x":28,"y":12} }],
    "advice": ["直连被固定障碍挡住——挪开阻挡者或改层改走法"] }],
  "hotspots": [{"x0":26,"y0":10,"x1":31,"y1":14,"owners":["U1"]}] }
```

- `blockers`：异网焊盘/异网走线（含手动）/禁布区，按命中次数排序——**挪谁一目了然**
- `advice` 三档：全阻挡→挪障碍/改层；无阻挡→拥塞问题（单独重布/降 viaCost/加层）；部分→优先处理高频阻挡者
- `hotspots`：协商拥塞热点合并盒（owners=涉事元件）
- 口径：直连采样是几何近似，跨层连接的边（需换层）会误报「被挡」——结合 `pad` 层位判断

### 6.3 语义编辑 `POST /api/edit` —— 别再为改一个线宽重推整块 JSON

| op | 参数 | 说明 |
|---|---|---|
| `set-net` | `net`, `w?`,`hs?`,`preferredLayer?`,`clr?`,`pair?` | 改网络属性 |
| `add-net` | `net`, `pads:[id…]`, `w?` | 建网并挂焊盘 |
| `remove-net` | `net` | 删网+摘焊盘+清走线 |
| `move-comp` | `comp`, `dx?`,`dy?` 或 `x?`,`y?` | 平移元件（bbox 中心口径，同步 comps 元数据） |
| `set-pad` | `pad`, `x?`,`y?`,`w?`,`h?`,`net?` | 改焊盘（换网自动维护 nets 引用） |
| `add-pad` | `pad:{id,x,y,w,h,netId?,shape?,layer?}` | 加测试点/焊盘 |
| `clear-net-tracks` | `net` | 只清该网走线（配合 route 单网重布） |
| `add-keepout` | `x,y,w,h` | 加禁布区 |

每次编辑：先在副本上过 `normalizeDesign` 校验（非法拒绝提交）→ 落盘 `design.json`（+`result.json`）→ SSE `state` 推给界面实时刷新 → 返回 summary。**所有细粒度操作都看得见**。

### 6.4 布线前预估 `POST /api/estimate`

route 一跑几十秒到几分钟——先花 1 秒预估，别烧在注定失败的尝试上：

```json
{ "ok": true, "grid": 0.8, "netRows": [{"net":"VCC","pads":2,"lbMm":48,"w":0.5}, …],
  "totalLbMm": 136.0,
  "capacity": {"perLayerMm": 3000, "usableMm": 2100, "model": "满铺/栅格 × 0.35 利用率（经验口径）"},
  "verdict": {"verdict":"2 层可行", "code":"ok2", "margin":1.86, "demandMm":170, "disclaimer":"启发式预估，仅供参考"},
  "trackRule": {"limit":0.15, "suggest":0.2, "thinNets":[]} }
```

- `totalLbMm`：各网 RMST 理论线长下界之和（`netLowerBound`）
- `verdict.code`：`ok2`（margin≥2.5）/ `tight`（1.5–2.5，评估 4 层）/ `need4`（<1.5）
- `trackRule.thinNets`：低于嘉立创工艺极限线宽的网络名单

### 6.5 封装生成器 `GET /api/fp` —— 规格阶段别再手算焊盘坐标

`?name=<封装>&n=<脚数>&x=<mm>&y=<mm>&prefix=U1` → 绝对坐标焊盘数组（含通孔 holeR），直接粘进 spec：

```json
{ "ok": true, "name": "SOIC-8", "count": 8,
  "pads": [{"id":"U1-1","x":37.3,"y":18.095,"w":1.5,"h":0.6,"shape":"rect","layer":"top"}, …] }
```

支持：`0402/0603/0805/1206`、`SOT-23/SOT-223`、`SOIC-8|14|16`、`DIP-14`、`QFP-32/44/64/100`（0.8 间距）、`QFN-48`（0.5 间距）、`BGA-64`（0.8 阵列）、`XTAL-3225`、`hdr1/hdr2`（排针，配 `n=`）。QFP/QFN 从名字解析脚数；更精确/异形封装用嘉立创 `device` 命令拉真封装。CLI 同款：`node ai/pcb.mjs fp SOIC-8 --x 40 --y 20 --prefix U1`。netId 不自动分配——spec 里 `nets[].pads` 引用这些 id（或 `/api/edit add-net` 挂网）。

### 6.6 进程内布线 `POST /api/route-live`：进度直播 + 可取消 + 会话驻留

`/api/cmd route` 是子进程黑盒（大板几分钟无输出）。`/api/route-live` 在桥进程内的**持久 worker** 里跑同一引擎：

- **进度直播**：SSE `progress` 事件（`{text:"逐网优化 · 1 · 3/3", frac:0.95}`）实时推送
- **可取消**：`POST /api/cancel` 随时中断（会话丢弃）
- **会话驻留**：布线完成后会话留在内存——`/api/reroute-net {net:"GND"}` **秒级单网重布**（只动一根网，其它走线原样）；配合 `/api/edit clear-net-tracks` 或直接 reroute 修局部
- 设计变更保护：`/api/edit`、`/api/load` 会使会话失效（reroute 返回 `stale:true`，提示重新 route-live）——宁可靠重建模也不出「看起来成功」的旧结果
- 返回的 design 已含 routeBoard 的原地修改（栅格抬高/焊盘 snap），自动落盘——与 `--save-design` 同效
- 并行旗标（`--parallel/--iter-workers`）不支持，需要并行走 `/api/cmd`

### 6.7 A/B 判分 `POST /api/diff`

两个 result 谁更好，别凭感觉：

```json
{ "ok": true, "scoreLabels": ["complete(0/1)","fails","drcErrors","overuse","vias","trackLen×10mm"],
  "a": {"status":"partial","vias":12,"trackLenMm":482.1,"score":[1,2,0,0,12,4821]},
  "b": {"status":"complete","vias":9,"trackLenMm":495.7,"score":[0,0,0,0,9,4957]},
  "delta": {"complete(0/1)": -1, "fails": -2, "vias": -3},
  "verdict": "b 更优", "tiebreak": "字典序 routeScore：连通→失败→DRC→overuse→过孔→线长" }
```

`a`/`b` 传 result 对象或会话内路径。改参重跑后 diff 一下，修复是否真有效一目了然。

### 6.8 撤销 `POST /api/undo` + `GET /api/history`

每次 `/api/edit`、覆盖式 `/api/load` 前自动快照（深度 20）。`/api/undo` 回滚最近一步（design+result 一起恢复、布线会话作废、界面实时刷新）。AI 改坏了随时回退，大胆试错。load 还会**自动补 comps 元数据**（从焊盘前缀聚合，只补缺失不覆盖）——AI 漏写 comps 不再炸 ERC/BOM/CPL；`edit sync-comps` 可显式触发。

### 6.9 摘要/查询/定位 —— token 效率三件套

**`GET /api/summary`**：状态摘要（统计 + 每网 connected/total + stale/session 状态）——AI 日常轮询用这个，**别拉全量 /api/state**（大板 MB 级）。

**`GET /api/query?net=GND`**（或 `?comp=U1` / `?pad=U1-3`）：结构化单对象查询——
- net：焊盘坐标清单 + lbMm/routedLenMm/vias + 未连通边（替代手工翻全量 JSON）
- comp：引脚表、所属网、bbox、comps 元数据
- pad：焊盘详情 + 所属网路由状态

**`POST /api/drc-live`**：进程内 checkDRC + fabChecklist，findings 每条带 **where 坐标**（从 msg 解析，`located` 计数报告成功率）——配合 `GET /api/view?region=<x-2>,<y-2>,5,5` 目检违规特写，DRC 修复闭环不再靠猜。

**`GET /api/render` 新参数**：`crop=x,y,w,h`（mm 像素裁剪——看局部不必拉全板大图）+ `highlight=<网>`（该网亮绿重画在最上层，走线/过孔/焊盘全高亮）——与界面镜头 `/api/view` 互补：render 版确定性、无浏览器也可用。

**`GET /api/drc-live/mark.png`**：DRC 违规**红圈叠加渲染**（where 坐标画红圈，响应头 `X-Marked`=定位数）——AI 一眼看到违规在哪，修复后重拉对比。`highlight` 支持逗号分隔多网（如差分对 `highlight=USB_P,USB_N`）。

## 7. MCP 接入（Claude Desktop / ZCode 等）

`pcb-studio.exe mcp` 以 stdio 运行 MCP 服务（协议 2025-06-18 必要子集，零依赖实现）。客户端配置示例：

```json
{ "mcpServers": { "pcb-studio": { "command": "D:\\…\\pcb-studio.exe", "args": ["mcp"],
  "env": { "PCB_SESSION_DIR": "D:\\…\\pcb-session" } } } }
```

| 工具 | 作用 |
|---|---|
| `pcb_info` / `pcb_files` | 版本/会话目录/文件列表 |
| `pcb_summary` | 状态摘要（轮询用） |
| `pcb_load` | 载入 design(+result)，comps 漏写自动补 |
| `pcb_query` | 结构化查询：{net}/{comp}/{pad} |
| `pcb_cmd` | 跑无头 CLI 命令（同 /api/cmd） |
| `pcb_why` | 失败法医报告 |
| `pcb_estimate` | 布线前层数初判 |
| `pcb_edit` | 语义编辑（9 个 op） |
| `pcb_undo` | 撤销最近一次 pcb_edit |
| `pcb_fp` | 封装生成器 |
| `pcb_state` | 读当前 design/result |
| `pcb_render` | 渲染 PNG（支持 highlight，多模态直接看） |
| `pcb_drc` | DRC+fabChecklist，findings 带 where |
| `pcb_diff` | A/B 判分 |

MCP 模式与 HTTP 桥共用会话目录与命令配方——两种接入方式可以混用。

## 8. 开发者（不装 exe 也能跑桥）

```bash
npm i -d esbuild postject   # 构建期依赖（运行时仍零依赖）
npm run exe -- --no-exe     # 只产 dist/main.cjs（约 2MB）
npm run bridge              # node dist/main.cjs serve —— 与 exe serve 行为一致
npm run test:bridge         # 58 项端到端（health/load/SSE/cmd/render/越界/MCP）
npm run exe                 # 完整打包 → dist/pcb-studio.exe
```

## 9. 边界与注意

- 未签名 exe 首次运行触发 Windows Defender 扫描（约 10s，仅一次）与 SmartScreen 提示（「更多信息→仍要运行」）
- exe 内并行布线（`--parallel/--iter-workers`）首次使用时把引擎解包到 `%TEMP%/pcb-studio/`——一次性，随后正常
- `/api/cmd` 的会话目录就是 cwd：相对路径全部落在里面；越界路径（`../`）被拒绝
- 桥只影响本机 127.0.0.1；**双击 `index.html` 的原有用法完全不变**（桥客户端只在 http 服务下激活）
- token 在 `bridge.json`；错误 token 的请求会被 403。无 token 头的本地请求放行（本机进程本可读到 token）
