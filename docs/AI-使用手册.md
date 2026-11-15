# AI PCB 设计手册（给 AI 代理的操作规程）

> 本工具的目标用户是 **AI 代理**，不是人。人机界面（index.html）只是同一内核的可视化外壳；
> AI 应通过无头接口 `ai/pcb.mjs` 完成全部工作。本手册 = 工作流 + 决策规程 + 证据分级。
> 设计哲学借鉴三个一线项目：easyeda-agent 的 typed action 与写后回读、kicad-happy 的
> "脚本算事实、LLM 做判断" 与证据分级、Konnect 的可靠性契约（Complete/Partial/Refused）。

## 0. 你能做什么

输入：用户给的资料（需求描述、芯片型号、参考电路、BOM、引脚表）。
输出：**可制造的 PCB**——嘉立创EDA（标准版）可直接打开的 JSON、或 Specctra DSN（交给 Freerouting）+ Gerber。
中途所有决策（器件选型、原理图连接、封装、布局、布线、检查）由你（AI）做出并为此负责。

## 1. 命令一览（`node ai/pcb.mjs <命令>`，全部输出 JSON）

| 命令 | 作用 | 输出要点 |
|---|---|---|
| `device <C编号> [-o device.json]` | **从嘉立创库拉取真符号+真封装**（LCSC API，按 C 编号） | pins/pads/footprintBBox |
| `schem <design.json> [-o sch.json] [--devices dir]` | **生成嘉立创EDA原理图**（docType 1）：有器件缓存用真符号，否则通用框图符号 | LIB/W/N/F 图元 |
| `pour <design> <result> [-o d2.json] [--net GND] [--layer bottom] [--stitch-spacing 5] [--auto-return] [--islands always\|area\|never] [--fill solid\|grid] [--clearance 0.2] [--edge-margin 0.2] [--min-width 0.25]` | **多边形铺铜+缝合孔**（间距 ≥clearance；同层多块铜皮自动互避；孤岛三档；网格铜 fill=grid 线宽/间距≥0.254；筋条截断焊盘输出 unconnectedPads；min-width 细颈消除——窄铜颈/酸角尖自动消失，KiCad/Altium 同概念；同网重铺独立计算、islandMode 旗标获胜）：写入 design.stitching 与 result.pour；`--auto-return` 对高速网换层过孔自动配对回流地孔（reach 内无地导体才补，默认 1.6mm≈过孔长度） | 面积/缝合孔数/returnVias |
| `bom <design.json> [-o bom.csv] [--check]` | **BOM**（嘉立创 SMT 格式）+ 可选逐行验证 C 编号存在性/库存/封装匹配 | rows/csv |
| `pos <design.json> [-o pos.csv]` | **贴片坐标文件**（CPL：Designator,Mid X,Mid Y,Layer,Rotation，左下原点 y 向上） | rows/csv |
| `erc <design.json>` | **网表 ERC**：悬空焊盘/单脚网络/坏引用/重名/电源孤岛/工艺前提 | findings（severity+id） |
| `autopcb <design.json> [-o out] [--result r.json] [--rounds 3] [--anchor ...]` | **布局-布线一键循环**：place → 试探布线 → 拥塞热点反馈 → 再布局（元件可自动旋转）→ 再布线，保留字典序最优 | 每轮 log + best |
| `part <C编号>` | 嘉立创/LCSC 器件详情（型号/封装/库存）——选型确认 | lcsc/model/encap/stock |
| `verify <design.json> [result.json] [--export f.json]` | **导出回读自检**：PAD/TRACK/TEXT/VIA/板框逐项对账，findings 非空禁止交付 | ok/findings |
| `render <design.json> [result.json] [-o out.png] [--scale 8]` | **渲染 PNG**：AI 视觉自检——交付前用读图能力目检自己的作品 | width/height/bytes |
| `schema` | 设计 JSON 字段说明 + **常见错误负面清单**（含 rules 约束 schema：classes/netClass/pairs/lengths/keepouts） | 先读它再写 spec，能避免 90% 的字段错误 |
| `rules` | 布线知识库（可靠/有条件/勿信 + 嘉立创 DFM 锚点） | 设计决策与检查的依据 |
| `spec <design.json>` | 校验设计：字段引用、栅格前提、工艺极限 | `problems[]` 非空必须先修复 |
| `place <design.json> -o placed.json` | 自动布局（多重启模拟退火，连接代价最小化） | before/after 代价 |
| `route <design.json> -o result.json` | 完整布线（协商 + 候选重跑 + 逐网优化 + 弦拉直）；**邻域拆除收敛加速**（roadmap #4）：连续失败 ≥2 轮的网自动拆除其开放焊盘邻域的阻挡者（半径/上限渐进放宽，h2-stm32 实测同预算 57→75/77 连通），`neighbourhoodRipup:false` 可关 | status/stats |
| `route <design.json> -o result.json --iter-workers K` | **并行协商**（roadmap #4）：每迭代把网批分给 K 个持久镜像会话并行路由（TritonRoute FlexDR 同构），真实板 5.08×；波次批处理（iterWaves=2 默认，overuse 较 Jacobi 减半）；批内并发微差由逐网优化收敛；重板适用（<1s 的板别用） | via.mode/workers/iters |
| `route <design.json> -o result.json --parallel K` | 并行候选布线：K 个 worker 各跑一套配置候选（每候选独立优化后取最优，质量 ≥ 串行）；重板 1.5× 实测，小板被 worker 启动开销淹没（<1s 的板别用） | via.mode/workers |
| `diffz <design.json> [--pair 名] [--z 90]` | **差分对奇偶模阻抗口径**（roadmap #3）：给定叠层与线宽解目标差分阻抗（默认 90Ω，`nets[].diffZ` 覆写）对应间隙 S、奇/偶模阻抗、可达性——2 层板如实报不可达；耦合走廊与耦合度 DRC 自动按此工作 | pairs[]（S/Z0/奇偶模/可达性/建议）+ 免责声明 |
| `tune <design.json> <result.json> [-o result2] [--pair 名] [--group 名] [--serp-gap 0=自动3W] [--tol 0.05] [--target mm] [--max-amp mm]` | **等长蛇形生成**（roadmap #2）：pair/lenGroup 组内短网沿线插入 90° 方波 bump 精确补长（与 DRC 同尺，支持 45° 载体）；节距 ≥3W；`nets[].padToDie` 计入口径；报告含 audit 自审计；route 之后、drc 之前运行，之后勿再 beautify | groups/tuned/skipped/audit |
| `currents <design.json> [--apply]` | **载流→线宽报告**：nets[].current 逐网 报告/所需线宽（s 建议 + t 极限）/所需过孔数；`--apply` 抬宽回写并同步最小栅格（内核 netW 自动抬宽已默认生效，此命令用于显式核对） | rows/maxTrackW/minimumRoutingGrid |
| `thermal <design> <compId> [--pitch 1] [--cols 3] [--rows 3] [--apply]` | **散热盘过孔阵列**：找该元件面积最大焊盘生成 0.3mm 过孔阵（自适应 3×3 起；收进 viaOuter/2；TO-220 舌孔按孔边距滤除），写入 stitching 全链复用（路由避让/DRC/Gerber/IPC-356） | cols/rows/added/skipped/parallelAmp |
| `drc <design.json> [result.json]` | DRC + 嘉立创投板检查表 | errors/warnings/fabFail |
| `drop <design.json> [result.json] --net <网>` | **电源网 IR-drop**：节点电导矩阵解每焊盘压降/等效电阻（--current 1 --entries J1-1；连接器焊盘或铺铜过孔自动当入口） | maxDropV/worstPad/drops |
| `pdn <design.json> [--vdd 3.3 --itrans 1 --ripple 5 --esl-nh 1 --cap-uf 0.1 --pkg-lnh 0]` | **PDN 一阶阻抗评估**：目标阻抗/库仑桶体电容/平面电容/电容库 SRF/交接频率与阻抗/一阶达标判定（Bogatin ch13 口径） | ztargetOhm/caps/handoffMhz/pass |
| `advise <design.json> [result.json]` | 按优先级输出可执行建议（带证据等级） | recommendations[] |
| `export easyeda\|dsn\|ses\|svg\|ipc356 <design.json> [result.json] -o out` | 导出交付物（ipc356=IPC-D-356A 裸板电测网表，含过孔与缝合孔，RTF2 附录3） | bytes/written |
| `import easyeda\|kicad\|dsn <file> [-o design.json]` | **外部设计导入**（roadmap #8）：easyeda=嘉立创EDA标准 PCB JSON（docType 3，开源广场接力入口——TRACK→手动走线、VIA→换层 stub、COPPERAREA 不导入（用 pour 重铺）、报告含 skipped 计数与 notes）；kicad=.kicad_pcb（走线不导入）；dsn=Specctra DSN（KiCad/Freerouting 导出，µm 与 0.1µm 双刻度自适应）。导入后 `external:true`（spec 同元件焊盘间距豁免），摊平焊盘按「簇优先、位号后贴」归属位号——宽体 IC 远离位号的列可能降级 P 组件（只影响 id 命名/BOM 分组，网名逐焊盘保全） | pads/nets/tracks/vias/skipped/notes |

约定：exit 0 = 成功；所有 JSON 顶层有 `ok`；写文件用 `-o`，否则内容随 JSON 返回。

## 2. 标准工作流（每步都要看输出再决定下一步）

```
资料 → 器件选型(device) → 连接关系 spec（含 rules 约束 schema）→ spec 校验 → place → route
   → tune → drc → advise → 修复循环 → pour → deliver（一键交付包）→ render 目检
```

**接力工作流（已有外部工程时，roadmap #8）**：
`import easyeda 开源广场导出.json -o design.json` → 看 report（tracks/vias 已转手动走线、skipped 计数）→ `spec` 校验 → `route`（自动只补未连通部分，已有手动走线保留）→ `pour` 重铺铜皮 → `drc` → `export`/`verify` 交付。

1. **读资料，列器件清单**：主控、电源、接口、被动器件。每个器件决定封装
   （用内置封装库：0402/0603/0805/1206/SOT-23/SOT-223/SOIC/DIP/排针；特殊封装手工展开焊盘）。
2. **写连接关系 spec**（design JSON）：`nets` 定义网络，`pads` 给出每个焊盘
   （**id 用 `元件名-引脚号`**，如 `U1-1`——布局按前缀分组、导出按元件组织）。
   先跑 `node ai/pcb.mjs schema` 看字段与常见错误。
3. **`spec` 校验**：`problems[]` 非空（栅格过小、单焊盘网络、线宽低于工艺极限、坏引用，以及第七轮新增的
   **空网/同元件焊盘间距（与 DRC 同口径）/出板/THT 环宽**）→ 修复再继续。这四类是 R5-R7 实测最高频的
   spec 失败，现在在布线前即拦截。
4. **`place`**：元件互相重叠地起步也没关系，退火会展开。看 `after` 代价——若仍很大
   （>1000），通常是板太小或器件太多，考虑加大板框。
5. **`route`**：`status:"complete"` 即全部连通。`partial` → 看 `advise` 的 CONNECT/NETFAIL 建议
   （按顺序：单独重布失败网 → 降过孔代价重跑 → 查禁布区/焊盘堵死 → 加层数）。
6. **`tune`**（可选）：差分对/等长组（`nets[].pair`/`lenGroup`）在 route 后接
   `tune placed.json result.json` 补长（90° 方波 bump 精确补至组内最长，节距 ≥3W，
   报告自带 audit 自审计）——之后勿再 beautify（45° 切角会削弯补偿长度）。
7. **`drc`**：errors 必须清零；warnings 逐条判断；`fabFail` = 违反嘉立创工艺极限，**不可交付**。
7. **`advise`**：按 `prio`（0 最高）执行。注意 `evidence` 字段——
   `deterministic`=工具几何计算，可信；`datasheet-backed`=厂商参数表；`heuristic`=经验法则，需你复核。
9. **修复循环**：advise → 改 design（线宽/层数/布局）→ 重跑受影响步骤 → 直到 drc 干净。
10. **铺铜**：`pour placed.json result.json --net GND --layer bottom --stitch-spacing 5`
   —— GND 多边形铜皮（真实多边形：圆角挖空间距精确、热焊盘实宽筋条、孤岛去除）+ 缝合孔自动写入 design.stitching；DRC 自动含缝合孔与铜皮检查；Gerber 以 LPD/LPC 极性区域输出、EasyEDA 以 COPPERAREA 输出。
11. **deliver 一键交付包**（roadmap #9，替代此前散装的交付步骤）：
   `node ai/pcb.mjs deliver placed.json result.json -o 交付目录 --project 板名`
   —— **三道门禁**内置：verify 回读 ok（导出与设计逐项一致）、DRC errors=0
   （fabFail=工艺极限违规）、连通性 100% 布通（空板/半通不放行）；门禁不过即
   ok:false 中止并列出 findings（`--force` 可覆盖但 manifest 如实记 override）。
   产出交付目录：**嘉立创EDA.json**（回读验证级）+ **Gerber 八件套**（gerber/）+
   **IPC-356 电测网表** + **SVG 图纸** + **BOM.csv**（嘉立创 SMT 格式）+
   **贴片坐标.csv**（CPL 左下原点）+ **渲染 PNG**（目检用）+ **投板检查表.json** +
   **manifest.json**——每个交付物带 `bytes` 与 `evidence` 证据级
   （roundtrip-verified > deterministic > datasheet-backed，口径见 manifest 自带说明），
   AI 复核时按证据级引用。原理图支线不变：`device C编号` 拉真符号 → `schem` 生成
   嘉立创EDA原理图 JSON。散装命令仍可用（export easyeda/gerber/ipc356、bom --check、
   pos、verify、render——deliver 是它们的门禁化编排，产物一致）。

## 3. 决策规程（AI 自主决策时的默认值与依据）

| 决策点 | 默认 | 依据 |
|---|---|---|
| **通孔孔径** | pad.holeR（半径 mm）：DIP/排针/晶振/按键由封装生成器自动带 0.45（0.9mm 孔）；自定义通孔焊盘必须显式填 holeR——孔径错=实物插不进针；DRC 自动查环宽（≥0.18）与孔边距（≥0.20） | 嘉立创 annular/孔边距规范 |
| **每网线宽** | 电源网（VCC/GND/±5V…）在 nets 里加 `w:0.5`（1oz 1A 建议值），信号默认；栅格会自动按最大线宽调整（≥0.7） | 载流锚点；`nets[].w` 贯穿全部导出与检查 |
|---|---|---|
| 板层数 | 先试 2 层；布通失败或电源/高速复杂 → 4 层（SIG-GND-PWR-SIG；平面贴近信号层——50Ω 微带介质厚≈线宽一半、带状线平面间隔≈2×线宽，地平面尽量朝外层） | 成本优先；四层地平面解决回流（Bogatin B.36/37、A.88） |
| 栅格 | `≥ 线宽+间距` 的 0.05mm 整数倍（工具自动强制） | 间距合规的硬前提 |
| 线宽 | 信号 0.25~0.3mm；电源网络按载流（1oz 1A→0.5mm） | `rules` 的 CURRENT 锚点 |
| 过孔 | 0.6/0.3（外径/钻孔），极限 0.25/0.15 | 嘉立创建议值 vs 极限值 |
| **design.comps 元数据** | 每个 `{前缀:{x,y,rot,layer,value,footprint,lcsc}}` 必填——BOM/CPL/丝印/ ERC 都依赖它；autoPlace 会自动同步位置 | 交付四件套的数据基础 |
| 布局 | **器件封装优先用嘉立创库**（device 命令按 C 编号拉取真封装）；电源→接口→去耦→晶振次序把关；关键件用 `--anchor` 锚定，体区加禁布 | 回流路径与 EMI（可靠档规则）；封装尺寸以嘉立创库为准 |
| **锚定决策（第七轮 L23 细化）** | 位置带**产品级几何约束**的元件（金手指/卡槽对位/面板接口/安装孔）**必须锚定**——退火的贴边罚会主动把它们推离板边。它们的位置是规格输入，不是可优化变量。实测金手指：锚定后 2.8× 快、过孔减半。其余元件先看退火布局诊断再决定（第五轮 L16） | 第七轮 n89 A/B |
| 布线 | 默认参数；失败才降 viaCost；仍失败查布局 | route 的多候选机制已内置 |
| 铺铜 | 底层 GND + 缝合孔（交付后在 EDA 内完成） | 大铜皮必须缝合才算地 |
| 高速网络 | 名字含 CLK/USB/MIPI/D±/XTAL → nets 里标 `hs:true`；差分对（USB_D±/D+-/_p/_n 成对）→ 两网标相同 `pair:"组名"`（启用等长检查 ΔL≤0.2×UI 与 3W 对内豁免） | 3W 提醒 + 差分等长 DRC + PAIR-DETECT 命名侦测 |

**禁止事项**（防 AI 走捷径，参照 easyeda-agent AGENTS.md）：不得宣称"已验证"除非 drc 输出证明；
不得跳过 spec 校验直接 route；partial 结果不得交付；fabFail 不得交付；
对 datasheet 里查得到的参数（引脚定义、封装尺寸）必须以 datasheet 为准，工具经验只作交叉检查。

### 3.1 故障排查 checklist（按症状对号入座，固定排查顺序防绕圈）

此前失败处理指引散落在 §2 第 5 步、§3 布线行与 §6 复盘三处，本节收拢为单一清单。
原则：**先查布局，再调参数，最后才动层数**（§6 复盘的实证结论：前几轮卡点全是布局瓶颈，
布局修对后协商立即收敛）。

**症状 A：`spec` problems[] 非空**
1. 逐条修复后重跑 spec，直至 `problems:[]`——这是唯一"必须清零"的前置门（R5-R7 实测最高频失败）。
2. 栅格过小 → 不要手调栅格迁就线宽，改线宽或层数；线宽低于工艺极限 → 按 `rules` 锚点改。

**症状 B：`place` 代价 >1000 或含大额罚项（>1 万）**
1. 大额罚项=残留重叠/出板/禁布冲突——先解决再 route，否则布线在坏布局上空转。
2. 代价大且无罚项 → 板太小或器件太多：加大板框（板幅是最便宜的资源）。
3. 有位置带产品级约束的元件（金手指/面板接口/安装孔）→ `--anchor` 锚定（§3 锚定决策行）。

**症状 C：`route` status:"partial"**
按顺序执行，每步看输出再决定下一步：
1. **看 `advise`**：CONNECT/NETFAIL 建议按 prio 执行（`evidence:deterministic` 的建议可信执行）。
2. **单独重布失败网**（GUI 网络行 ⟳ / `rerouteSingle`）——协商是逐网接序，失败网往往差一个让路机会。
3. **降过孔代价重跑**：`route --via-cost 8`（缺省 15）。仍失败 → 不是过孔问题，回布局侧。
4. **查失败网焊盘是否被堵死**：焊盘落在禁布带/芯片体区/板边钳位带内（§6 复盘第 4 条：先查这个，
   再考虑加迭代）。0 overuse 但未连通=典型堵死特征。
5. **`capacityStall:true` 字段** → 迭代耗尽+高冲突+仍有失败=容量上限特征（h2-stm32 实测：
   2 层卡死 75/77，4 层同板 77/77）。直接升 4 层，不要再扫参数。
6. **DRC error 里有同网名** → 该网与"阻挡者"联合卡死：加层数或改布局把两者分开，不要反复单网重布。

**症状 D：`drc` errors 不为 0**
1. **spacing 类**：多为栅格量化边界——确认 `grid ≥ 线宽+间距`（工具在 route 时自动校验，
   手改 design 后可能失配）；45° 段专项违规 → 重跑 route 让美化轮消化。
2. **fabFail**（嘉立创工艺极限）→ **不可交付**：改线宽/过孔参数后整体重布。
3. **回流地孔/3W** 是提醒级：逐条判断（两层板 3W 常不适用，见 rules 的"有条件"档），不是清零对象。
4. **孤岛**：`pour` 的 islandMode 三档已裁决；DRC 只报告"保留档"的天线风险。

**症状 E：`verify` 失败（导出回读对账不符）**
1. verify 是写后回读契约的守门——失败=导出链路 bug 或设计含未支持字段，**不要 --force 跳过**，
   如实报告并减导出面（先 easyeda 再 gerber 定位是哪件导出物对不上）。

**症状 F：`deliver` 门禁拒绝**
门禁三道（verify/DRC/连通性）逐一看 findings——门禁是交付质量的最后防线，
`--force` 仅用于"明确知道且接受风险"的场景，manifest 会如实记 override 留痕。

**不要浪费轮次的场景（§5 已知边界速查）**
- 0.4mm BGA 强行 2 层 → 工具诚实报告不可达，直接 4 层+扇出优先。
- 差分对内强制 0 间距 → 压实是"设计间隙带"口径，不是紧耦合；等长用 `tune` 不用手绕。
- KiCad 导入板含内层平面效应 → 不在工具口径（如实缺口），按 2/4 层重布口径评估结果。
- 编辑 design 后想局部重布 → 手动走线增删后单网重布会被 worker 指纹拒绝，整体重布。

## 4. 证据分级（引用结论时的自证义务）

| 等级 | 含义 | 例子 |
|---|---|---|
| `deterministic` | 工具几何/连通计算，可复算 | DRC 结果、连通统计、过孔数、IR-drop 求解 |
| `datasheet-backed` | 厂商官方参数 | 嘉立创工艺极限、载流锚点 |
| `book-backed` | 权威书籍逐页研读结论（页码可查，见 docs/书籍研读/） | Fknee 1/6 端接判据、去耦四要素 |
| `heuristic` | 经验法则，方向正确但需个案判断 | 去耦比例、布局次序 |

报告/交付说明中引用结论时标注等级；`heuristic` 级结论不得写成"必须/一定"。

## 5. 已知边界（诚实声明）

### 5.0 JS API 并行入口（CLI 之外的编程接口，0.13.x 审计补记 F-a）

- `routeBoardParallel(design, opts)` → `{result, session:null, from}`：候选级并行
  （viaCost 候选分给 K 个 worker，`from`=胜出候选名）。`opts.engineUrl` **可选**——
  缺省或无 Worker 环境自动降级为串行候选链（返回形状不变）。
- `routeBoardIterParallel(design, opts)` → 双态返回：`iterWorkers≥2` 且传了
  `opts.engineUrl` → `{result, session:null, from, iterations, ...}`（协商内波次并行）；
  否则回退 `{result, session, fallback:true, timeMs}`（串行口径）。**`engineUrl` 必传**：
  worker 用它 import 引擎（浏览器内联构建里模块元属性不可用，缺省 throw）。
  两入口都会原地改写 design（grid 提升 + 焊盘吸附，与 routeBoard 同款）；
  调用方按返回对象的 `fallback` 字段判别走了哪条路。

- **原理图**：工具不画原理图。连接关系以 design JSON 的 nets 表达（等价于网表）。
  交付物是 PCB；若用户要原理图，需在嘉立创EDA内按 nets 表手绘或由 AI 生成 EasyEDA 原理图 JSON（路线图）。
- ~~铺铜/缝合孔~~：已串入 CLI（pour 命令）；泪滴已进 Gerber 铜层（制造化）。
- ~~4 层板 EasyEDA 导出~~：已支持（内层 layerid 21/22，嘉立创标准版层表核实）。
- **单文件工具不校验器件真伪**：引脚定义、封装尺寸的正确性由 AI 对照 datasheet 负责（反循环警告：
  不能用器件库验证器件库，只有 datasheet 是 ground truth）。
- **细间距三参数联动（第五轮验证，第六轮扩展）**：`halfClr = clearance + maxTrackW/2` 是焊盘影响区半径，
  细间距下参数不联动会把引脚"封死"。对照表：0.8mm TQFP→grid 0.25/线 0.2/距 0.1/孔 0.6·0.3；
  0.65mm SSOP→grid 0.325/线 0.2/距 0.1/孔 0.6·0.3；0.5mm QFN/LQFP→grid 0.25/线 0.15/距 0.1/孔 0.5·0.25；
  0.4mm QFN→grid 0.2/线 0.1/距 0.05/孔 0.45·0.2（**工艺边界外**：距 0.05 < 嘉立创 0.1 极限，可制造需 4 层；
  实测放宽到 0.1 反而 6.8× 时长+不收敛——细间距下 halfClr 耦合占主导，勿凭感觉放宽）。
  **降参数前实算**：`边间隙 = (pitch − padW)/2`，≥ halfClr 就不必再降（0.95mm SOT-23-6 实算 0.2 > 0.175，0.1 即可）。
  诊断特征：`overuse=0` 却大量未连通 = 被堵死（先查三参数，不要加迭代）。
- **细间距板上不要给任何网设宽走线**：maxTrackW 取全板最大，一根加宽电源线会封死所有细间距逃逸。
- **spec 先过自检再布线**：`spec` 命令已内置全量自检门（坏引用/单脚网/空网/同元件焊盘间距/出板/THT 环宽，
  第七轮 L25）。残缺 spec 会"假绿"——布线器只对实际存在的焊盘负责（第五轮 mk 透传事故）。
  自检的距离口径与 DRC 完全同源（引擎 padGap），不会再出现"自检过、DRC 挂"（第七轮 L22）。
- **密板残留拥塞的处置顺序（第五轮 L9 修正）**：先 `rounds=3`（布局-布线反馈循环多一轮热点反馈，
  n51 实测 102 错→23 错），再查器件间距，最后才考虑调参。`advise` 会自动检测细间距并给出对照表
  （FINEPITCH 告警）。
- **布局-布线循环的种子策略（第五轮 L10）**：引擎自动执行"round 1-2 保持基础种子（延续性，
  warmStart+热点反馈翻盘），round 3 起换种子（多样性，逃局部盆地）"——n40 五轮 34/35 卡死
  → round 3 换种子后 35/35。不要改回"每轮同种子"。
- **逃逸口袋已由引擎自动规避（第六轮 L12）**：退火代价含"焊盘 4 正交方向全堵 = 不可逃逸"
  罚（与布线器影响区同口径）。若仍见 `overuse=0 且少数焊盘未连通`：用格点占有图诊断
  （参考 projects/round6/diag-seal.mjs 的 5×5 图——`o`=本网 `O`=他网 `x`=禁行），确认是
  「影响区墙 1 格 slalom」（L17，参数不可救，记录残留）还是布局可改。
- **锚定先看退火布局再决定（第六轮 L16 反例）**：n59 五种锚定变体全部 ≤ 退火自由布局
  （41/47 最优是"不锚"）。锚定只在 spec 布局有明确优势（晶振旁路、板边连接器避开 IC 逃逸区）
  时使用；先跑一次无锚布局看诊断，再决定锚谁。
- **THT 封装三约束联立（第六轮 L15）**：孔径/环宽/间隙必须同时满足
  `pad ≥ hole_d + 0.36`、`pad ≤ pitch − clearance`。TO-92 在 1.27mm 间距 +
  0.2 clearance 下唯一解是孔 0.6/盘 1.0。封装助手（fp 帮手）应内置校验。
- **GND 连通别依赖铺铜兜底（第六轮 L18）**：连通性契约只认走线，铺铜热焊盘连接不计入
  未连通统计——电源/地 highway 的焊盘要在 route 阶段连通主干，铺铜只作回流改善。
- **宽走线与节距联动（第十轮 L37）**：maxTrackW 是全板量——nets[].w=1.2 时 grid ≥1.4 且
  影响半径=padR+0.8，**全板节距必须 ≥ 2×(padR + maxTrackW/2 + clearance)** 才能逃逸；
  5mm 端子可配 w1.2，2.54 排针最多配到 w0.4。宽线汇流板全部用 ≥5mm 端子。
- **性能预期（第九轮剖析）**：细间距大板（0.25 grid、13 万格、>100 焊盘）单次全流程 10-30 分钟
  属正常（热点：A* 内环 46% + 堆 14% + 启发式距离图 28%——剖析存档 prof9/）。加迭代轮数对
  残留拥塞的收益请对照第五轮 L2（历史最优保留后可安全调大）。
- **板幅反馈语义（第十一轮 L40）**：DRC 报「焊盘重叠」且布局拥挤时，优先加大板幅
  （每焊盘 ≥6mm² 为 THT 参考下限），不要调布线参数——面积不足是物理问题。
  粗栅格（≥0.8）有 0.05mm 级贴边量化违规风险（L41），精细板用 0.25-0.5。
- **零格焊盘（第十轮后 L39）**：薄于栅格的焊盘（SOIC 旋转后 0.5 短边 @ grid 0.6）若中心
  不在格心线上会完全不可达——autoPlace 已自动半格微移保障；**锚定薄焊盘由 spec 门拦截**
  （零格覆盖 problem）——锚定坐标请放 (i+0.5)*grid 格心线或加大焊盘。
- **载流感知线宽自动定档（第十一轮后 L47，内核自动）**：nets[].current=N（A, RMS）声明后
  **引擎 netW 内核自动抬宽**（IPC-2152 s 口径：w = 0.5mm × N^1.113 @1oz 外层）——无需手动
  --apply，routeBoard/placeAndRoute/CLI/UI 全路径生效。2oz 铜厚锚点减半（0.3mm）；
  内层 0.5oz 反而需 1.6mm。maxTrackW 全板生效（L37）：8A→5.06mm→栅格 5.3 →
  细节距焊盘封死——**大电流板用 2oz 铜+覆铜载流，或与信号区分层/分区**。
  spec 门自动拦截不足网；投板检查表逐网行自动出现。
- **电压→安全间距（0.14.5 批次1，IPC-2221B）**：nets[].voltage=V（如 170）→ 查表 6-1
  B2 外层无涂层口径（15V→0.1 / 50V→0.6 / 170V→1.25 / 500V→2.5mm 阶梯，>500V 按
  0.005mm/V 线性外推；0.14.7 修正——0.14.6 存表列语义/数值与标准不符）→
  `design.coating:'coated'`（三防漆）走 B4 涂层档（170V→0.4mm）→
  该网有效间距 max(全局,标准)：per-pad 影响区推开异网更远、布线保间距、DRC 逐对
  校验、检查表逐网行。安规终判按 IEC 62368-1/60664-1（检查表有人工确认行）。
- **过孔载流（批次2）**：0.3mm 孔保守 1A/孔——检查表"换层过孔并联"行 = 布线换层孔 +
  stitching 并联数，少于所需（I^1.113 线宽需求同源）判 warn；0 孔=同层走线 ok。
  布线器不自动加孔（几何约束复杂，报告给调用方）——大电流网配 `thermal` 阵列补并联孔。
- **热过孔阵列（批次2）**：`thermal <design> <compId> --apply` 在 DPAK/TO-220/QFN
  散热盘（元件面积最大焊盘）下生成过孔阵，写入 design.stitching——垂直热通道 +
  大电流并联路径双用途。TO-220 舌片自带插件孔时按孔边距自动滤除近孔位。
- **阻抗自动定档（批次3）**：rules.pairs[].z（或 nets[].diffZ）→ diffPairZFor 反查
  耦合间隙 S → 耦合走廊/压实带心/DRC 耦合度全链按此工作。2 层板 90Ω 物理不可达
  （最低 ~137Ω）——spec 门在布线前拦截，检查表如实 warn；用叠层工具算得的间隙
  可 rules.pairs[].gap 显式覆写（≥clearance）。0.14.7：design.solderMask（mm）→
  阻焊一阶修正（−2Ω/0.0254mm，Bogatin B.43/44），sFor 全链跟随；diffz --mask。
- **过孔载流按孔径折算（0.14.7 批次1）**：0.3mm→1A 锚点线性（0.4mm→1.33A/孔）——
  viaCount/thermal parallelAmp/检查表行全链跟随；载流声明网的 ≥3mm² 焊盘也进
  热设计检查表行。
- **涂层与类级间距（0.14.7 批次2）**：design.coating:'coated'（三防漆）→ IPC-2221B
  外层走 B4 档（170V 1.25→0.4mm）；rules.classes[].clr 经 netClass 展开 → netClr
  第三来源。**DRC 逐对校验已闭环**：声明网与异网导体的间距按 max(两网 netClr)
  复核（0.14.6 及以前 DRC 只按全局口径——影响区是必要条件、DRC 是充分复核）。
- **preferredLayer 硬约束慎用（0.14.7 批次5 探针级）**：实测 p05 仅 3 网 →
  −6 连通 +3 DRC +61% 耗时（顶层容量不足）——密板勿用，详见批次5 探针报告。
- **禁布区缓冲（第十轮 L35）**- **禁布区缓冲（第十轮 L35）**：禁布阻挡自动外扩 maxTrackW/2——贴禁布边缘 maxTrackW/2 内
  不再有可布格（铜皮不出界保证）。需要跨区连线的电源/地网别被禁布带完全包围，
  预留桥口（n145 教训：分区禁布带会切断跨区电源网，DRC 拦截）。
- **半孔（castellated）与圆焊盘（第八轮 L26/L27）**：① 引擎已把圆焊盘影响区按外接方形处理
  （弦缺口修复），THT 圆焊盘密集板的走线-焊盘间距由几何保证；② 邮票孔按「孔 0.7/盘 1.1」
  设计以满足全孔环宽口径（半孔工艺环宽口径是 DRC 已知空档）；③ 半孔在 spec 门按
  「圆形+带孔+圆心距板边 < 孔半径」自动豁免出板。

## 6. 实战复盘（ATmega328P 最小系统板，65×45 双层，63 焊盘 13 网络）

一次真实运行（projects/atmega328p-minsys/）的修复循环记录——**每一轮都是布局知识，不是运气**：

**autopcb 循环（本表的人工轮次现已算法化）**：实测去掉下表全部人工教训（无禁布/无锚定）后，
`autopcb --rounds 4` 第 2 轮自动收敛到 complete 48/48 / 0 冲突（热点权重逐轮衰减 50000→8000）。
AI 仍应提供下表的布局知识（锚定/禁布）——有知识时第 1 轮即收敛，无知识时循环兜底。

| 轮次 | 症状 | 诊断 | 决策 |
|---|---|---|---|
| 1 | route 46/48 + 11 处冲突集中一区 | 去耦电容/晶振全被退火塞进 DIP 两排之间的芯片体区 | 锚定 U1/晶振电路，体区加禁布（工具新增 anchor 支持与禁布联动） |
| 2 | XTAL2 横穿 ADC0 死锁 | 晶振预布局位置迫使 XTAL2 跨越右侧上行通道 | 晶振电路整体移到左上，让出通道（XTAL1 走左、XTAL2 走右不交叉） |
| 3 | J1 排针被夹在 U1 顶排与 J2 之间 | 连接器被塞进引脚行间隙 | 排针锚定板边竖放（连接器必须在板边） |
| 4 | RESET 差 1 焊盘（重跑多次同位） | 按键焊盘落在芯片体禁布带内，逃逸被堵 | 按键移出禁布带 |
| 终 | **48/48、0 冲突、8 秒收敛** | 布局修对后协商立即收敛——此前全是布局瓶颈 | 交付 |

**由此固化的布局规程（AI 必读）**：
1. 长元件顺板长轴横放；连接器一律板边；DIP 两排之间的体区设禁布。
2. 晶振电路（Y1+负载电容）锚定在晶振引脚旁，两根 XTAL 走线不得交叉其它信号的上行通道。
3. 去耦电容手动锚定在各自 VCC/GND 引脚旁，但必须离开引脚逃逸走廊（退火只看线长，会拿电容堵走廊）。
4. route 后 0 overuse 但仍有未连通 → 先查焊盘是否落在禁布带/被钳位到板边，再考虑加迭代。
5. place 代价含大额罚项（>1 万）说明有残留重叠/出板——先解决再 route。

工具侧本轮顺带修复：板边 0.3mm 余量钳位（嘉立创 DFM）、初始排布改货架式装箱（大元件不再挤爆网格）、重叠修复尊重锚定、CLI 新增 `--anchor` 与单网重布。

## 7. 完整示例（可复制的最小会话）

```bash
node ai/pcb.mjs schema > /tmp/schema.json                 # 1. 学字段
node ai/pcb.mjs rules > /tmp/rules.json                   # 2. 学规则
# 3. 写 design.json（网表+焊盘，id 用 U1-1 格式）
node ai/pcb.mjs spec design.json                          # 4. 校验
node ai/pcb.mjs place design.json -o placed.json          # 5. 布局
node ai/pcb.mjs route placed.json -o result.json          # 6. 布线
node ai/pcb.mjs drc placed.json result.json               # 7. 检查
node ai/pcb.mjs advise placed.json result.json            # 8. 建议 → 修复循环
node ai/pcb.mjs export easyeda placed.json result.json -o 嘉立创EDA.json   # 9. 交付
```
