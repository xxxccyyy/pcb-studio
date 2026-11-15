# 更新日志

## 0.14.11（2026-11-16）—— checkDRC 保序桶格：pad-pad 82% + seg-pad 13% 家族提速（findings 逐位一致）

0.14.10 转正后按剖析重定方向（docs/深度优化报告-20261116d.md）：新默认下热点结构
大变——搜索瘦身后 checkDRC 被放大为第二热点（icebreaker@12 17%：仅 70 次调用但
单次 144ms，全部来自 jointReroute 逐 mask 计分）。家族计时：**pad-pad O(P²) 双循环
占 82%**（冰拳板 189k 对），seg-pad 13%；段间距扫描只占 0。

### 改动（checkDRC 保序桶格，findings 数组逐位一致）

- **pad-pad 桶格**：桶边长=_padR2（bbox 过滤界）→ 存活对必落相邻桶；逐 i 收集邻桶
  候选（j>i）按 j 升序求值 → 求值序 = 原 (i,j) 双循环序；跳过的对必不过 bbox 过滤
  （保守超集，不可能违规）
- **seg-pad 按层桶格**：padOnLayer 展开到层号，桶边长 = 最大 _sR 上界，每段
  bbox+margin 覆盖桶收集候选、按 pad 索引升序求值、首违即 break（与原全量序一致）
- **每次调用重建桶**——design.pads 可能被 autoPlace 原地改写，跨调用缓存有失效
  风险，重建成本可忽略，零失效风险。【0.14.11 深检修正】桶维度上限 512²
  （cell' = max(过滤界, 板宽高/512)）：小 _padR2 × 大板时稠密桶数组实测 3.3M 槽/
  26MB·次调用（81k 焊盘×400×300mm 板），放大 cell 保完备性（cell' ≥ c 时区间论证
  仍闭合）→ ≤2MB 封顶；密集封顶用例（7373 焊盘 >200 findings）实测 ref 522ms →
  cur 73ms（7.2×）逐字节一致
- 收益面：所有 checkDRC 消费方（GUI DRC 面板/CLI drc/deliver 门禁/jointReroute
  计分）——大板单次 144ms → ~20ms 级

### 验证

- **findings 数组逐字节差分**：180 板×配置 × 多协商采样态，冻结 0.14.10 vs 当前
  **0 处不一致**（403k 字节 findings 比对）
- 真实板 A/B：icebreaker@12 **47.9→43.0s（10.3%）**、fable-03 0.9%、h2 1.6%
  （收益 ∝ 焊盘密度），**结果 SHA-256 全部一致** → search-regression 金标准无需重录
- 全量 npm test exit 0（80 核心 + 285 node:test + 48 书籍 + 17 CLI + 39 模糊 +
  7 深检 + 48 锁）+ 浏览器四组 60 项全过
- 留档：rmstTasks O(V²) 堆化（8%，非位级不变）与 jointReroute 局部化计分（桶格后
  收益比转差）降级；astar/fdm 剩余为微调量级，本轮评估后不取

## 0.14.10（2026-11-16）—— 障碍感知启发式转正默认开：组合一致场（质量全面 ≥ 盲口径 + 1.37-1.88×）

0.14.9 深检留档方向的执行轮（docs/深度优化报告-20261116c.md）。两项修复：

- **分离场 → 组合图单元 BFS**：平面 8 邻 + 换层 2 邻（双端 mask 门控）全部计 1——
  场 = 组合图精确最短路度量，A* 全部可遍历边 ⊆ 场图边集且真实权重 ≥ 1 → 对 A* 代价
  Lipschitz → first-pop 终止即每边最优。探针复测：一致性违反 **43240 → 0**（40 板
  ×410 组态），可采纳性构造保证（diag 1≤√2、换层 1≤viaCost）
- **掩码缓存**：mask 是 {net 恒等, model 静态, viaInf, usage-异网, pairBand, hard}
  的纯函数，routeNet 内 own 提交经 usage+1/ownStamp=gen 配对抵消 → 跨 astar 调用
  逐位不变 → (epoch, net.i, hard) 缓存；失效点 7 处（ripNet/rebuildViaInf/
  patchViaInf/restore/adoptShared/pairBand 置位清除），探针 223 次命中重算比对
  0 陈旧 + 59236 次 astar 不变量全过

### 三方案 A/B（真实板全链，单跑）

| 板 | 盲 0.14.8 | 分离场 0.14.9 | **组合场 0.14.10** |
|---|---|---|---|
| h2-stm32 | 77/77 DRC39 57孔 189.2s | 77/77 DRC25 | 77/77 **DRC12** 45孔 188.6s |
| ext-fable-03 | 92/110 386mm 38.4s | 91/110（−1） | **92/110 386mm 28.1s（1.37×）** |
| ext-icebreaker@12 | 304/533 DRC191 92.4s | 292/533（−11） | **304/533 DRC191 49.2s（1.88×）** |

分离场质量回归全部消失——深检"次优路径机制"因果级验证成立（一致场走廊结构未变
而质量恢复，分离场次优边为主因；漏斗假设降级为未验证残余）。fable-03 与盲口径
路径级 digest 逐位一致；h2 路由改变、DRC 39→12。

### 转正与验证

- **默认开**（质量五板全面 ≥ 盲口径无一回退 + 一致性可证 + 全量回归全过，满足
  compactPairs/jointReroute 转正先例口径）；`opts.obstacleH:false` /
  `--no-obstacle-h` 逃生门**逐位恢复 0.14.8 盲口径**（fable/icebreaker digest 实测）
- search-neighborhood-baseline.json 重录（15 例 11 变，reason 注明 0.14.10 组合场）
- 优化锁 48 持平（45a/45c/45d 更新为默认 vs 盲回退口径）；全量 npm test exit 0
  （80 核心 + 285 node:test + 48 书籍 + 17 CLI + 39 模糊 + 7 深检 + 48 锁）；
  浏览器四组 60 项全过（截图按惯例恢复原版）
- 已知代价：协商路由与 0.14.8 不同（已交付项目重跑对账遵循 0.14.7 批次4 重交付先例）；
  速度收益较 0.14.9 的 2.2-2.5× 降至 1.37-1.88×（组合场更精确 → 展开略多）——
  换取质量持平/更优 + 一致性证明

## 0.14.9（2026-11-16）—— 障碍感知启发式（opt-in --obstacle-h）：协商重搜索 2.2-2.5×，默认关=位级一致

0.14.8 报告留档方向①的执行轮。机制：computeH 每次调用构建本网"无条件可通行"掩码
（判定链与 passable/enterOK 逐字段同源：prefL→blocked→scoped→fixedOwner→padOwner→
viaInf→pairBand→hard-usage），fillDistanceMap 只松弛掩码内格——h 可采纳+逐点支配盲
口径（探针 410 组 0 违反）；【深检修正】非一致场：跨层掩码不对称处平面 Lipschitz 失效
（探针 40 板掩码场 43240 处/最大超出 76.5 格，盲场 0）——first-pop 终止下 obstacleH
模式可能接受轻度次优路径 = 硬板质量偏移的第二机制候选（默认盲口径不受影响）。**实测权衡（完整表见
docs/深度优化报告-20261116b.md）**：协商重搜索 2.2-2.5×（icebreaker 180.9→71.5s、
fable-03 1.64×、h2 1.34×）；保证可解板质量持平偏好（h2-stm32 DRC 错误 39→**25**），
但截断态硬板协商不动点变差（fable-03 −1、icebreaker −11 连通；@60 与 @30 输出全同
=已收敛，加迭代不恢复）。机制假设留档：盲 h 的 plateau 探索顺带给出协商路径多样性，
感知 h 使等代价路径趋同进最短走廊（"漏斗"效应）——协商路由里多样性 > 单路径最优
（PathFinder/Freerouting 同实践）。

### 交付形态：opt-in（默认关=0.14.8 位级一致）

- CLI `route|autopcb --obstacle-h`（cli-args 白名单 + 引擎 opts.obstacleH 透传，
  含 iter-parallel/parallel 两条 worker 路径）；适用：速度敏感迭代流、以 DRC 为先
  的板；不适用：协商未收敛的截断态硬板
- astar 入口 gen++/ownStamp 戳位前移（掩码 hard-usage 判定需本网成员戳；gen 只被
  四个戳数组消费、computeH 只写 hMap，先后交换无交互）；bench-heuristic 改为直接
  驱动 fillDistanceMap（全通掩码=无障碍特例，跨版本场值断言仍有效）

### 验证

- **默认路径 400 组差分**（冻结 0.14.8 参考 × 100 种子 × 4 配置）全流程逐态一致
  0 失败——search-regression 金标准**无需重录**继续通过；期间 obstacleH:on 实验
  暴露 joint-reroute 存档测试断言"连通不得回退"强于 0.14.1 文档化契约
  [-drcE, conn]（DRC 优先）——默认位级一致后测试回归通过，发现留档
- 优化锁定 44→**48**（45a 可解板质量中性 开/关连通一致+DRC0；45b 围死源开/关均
  如实失败=掩码无幻路径；45c 掩码复用双跑逐字一致；45d 旗标注册 route/autopcb
  接受、place 拦截）
- 全量 npm test exit 0（80 核心 + 285 node:test + 48 书籍 + 17 CLI + 39 模糊 +
  7 深检 + 48 锁）；浏览器四组 16+16+22+6=**60 项**全过（截图按惯例恢复原版）
- 下一算法轮方向：带多样性保持的感知 h（逐网 h 偏置/候选走廊多样性机制），按
  20261116b 报告 §3 的漏斗假设设计 A/B

## 0.14.8（2026-11-16）—— A* 热路径深优：别名块扩展 + 堆 hole 法（全量位级不变）

上轮（2026-11-15）"按真实板型剖析决定优化几何索引还是搜索开销"的执行轮。
剖析结论：**搜索开销**——ext-fable-03 astar 自占 ~72%、ext-icebreaker ~68%，
fillDistanceMap 两板均 12-14%（与 astar 调用 1:1，第九轮缓存 A/B 证伪仍成立）；
堆水位 ≤8k（L2 常驻）筛化仅 ~2%——堆不是矛盾主体，单邻居访问 ~88ns 才是。
见 docs/深度优化报告-20261116.md。

### 改动（engine.mjs astar/viaLegal，全部位级不变）

- **astar 局部别名块扩展**：blocked/padOwner/viaInf/cellOwner/fixedOwner（原每邻居
  `model.fixedOwner` 对象链两跳 IC）/gVal/gStamp/par/dirA/closed/nearPenCache/
  nearPenStamp/pairBonusTyped/viaRingPenalty/viaRingStamp 全部提升为 astar 入口
  const——这些数组单次调用内不变（写点均在 commit/rip/hist/patchViaInf，都在
  astar 之外），每邻居省多次上下文槽读（2026-11-15 同款模式的收尾）
- **堆筛化 hole 法**：携带元素留寄存器、空洞移动，每层 4 读 4 写 → 2 读 2 写；
  子选择（平手取左）、终止条件、最终布局与 swap 法逐位一致
- **pairBonus 折扣先整判后除**：pb=0（绝大多数格）跳过浮点除法；pb≠0 时
  b=pb/1000 必非零，判定逐位一致
- **viaLegal 会话级常量提升**：viaOuter/2、viaDrill/2、板宽高、viaHoleBlocked
  提升为会话 const（design/model 会话内只读既有审计口径，ringR/netMeta 同款先例）

### 验证

- **随机板差分**：冻结改动前引擎为参考，100 固定种子随机板 × 4 配置（1/2/4 层、
  斜向开合、混合线宽、hs/pair、电压、keepout、手动走线、stitching、盲埋孔、
  class keepout）——**400 组全流程逐态对拍**（step 逐步/buildResult/snapshot/
  optimize(2)/restore/rerouteSingle 含报错文本）0 失败
- **真实板结果 SHA-256 一致**：555/MCU/h2-stm32/ext-fable-03/ext-icebreaker
  （routeBoard 剔 timeMs 前后逐位一致）
- 优化锁定 42→**44**（43a 堆 hole≡swap 50k 混合操作弹出序对拍；43b 别名化后
  双会话确定性）；search-regression SHA-256 搜索基线作为行为漂移第二道门保持通过；
  两个源码锚点测试（congestion-neighborhood/via-ring-cache）按 0.14.5 先例同步
  别名绑定（同一数组双名绑定，缓存失效语义不变）
- **A/B 计时**（交替序 4 轮中位数，单机）：h2-stm32 **1.9%**、ext-fable-03 **4.0%**、
  ext-icebreaker **5.0%**（555/MCU 小板噪声区间不宣称）；全量回归 exit 0；
  浏览器四组 16+16+22+6=**60 项**全过（回归自动渲染的截图按惯例恢复原版）
- 后续方向留档：障碍感知启发式（质量车道，预计砍 30%+ 展开，需重录搜索金标准）、
  jointReroute 局部化计分（每子集全板 DRC 占 icebreaker 4.4%，需逐家族等价证明）、
  rmstTasks O(V²) Dijkstra 堆化（prev 平手序非位级不变）

## 0.14.7（2026-11-16）—— 声明族第二批：孔径/涂层/间距/阻焊 + 交付清零 + 层位探针关闭

每批次独立深检 + 提交（f102c49 → b26a590）。

### 批次1：过孔载流孔径感知（f102c49）

- `viaAmpFor(design)` = 1A × (viaDrill/0.3)（barrel 截面 π·D·t 一阶线性，锚点 0.3mm→1A）——
  viaCount/换层过孔并联行/thermal parallelAmp/检查表文案全链跟随（8A：0.4mm→6 孔省 25%）
- 热设计检查表阈值智能化：载流声明网焊盘 3mm² 触发（普通网仍 6mm²）

### 批次2：涂层 + DRC 逐对校验 + class clr + **IPC-2221B 表修正**（a7539bb）

- ⚠️ **深检修正 0.14.6 存表**：列语义与标准相反（标准 B2=外层无涂层、B4=聚合物涂层）
  且数值为旧 IPC-2221A 口径（无涂层 170V 标准 1.25 存表 1.27；内层 ≥100V 标准
  0.2/0.25 存表 0.1 偏不安全）——经 EMA Design Automation 与 SF Circuits 两份独立
  复现一致核对重录（B1/B2/B4 + >500V 线性外推 0.0025/0.005/0.00305 mm/V），缺省档 B2
- `design.coating`（'bare'|'coated'）→ ipcTableFor 切档（170V：1.25 ↔ 0.4）
- **checkDRC 逐对闭环**：clrMap/clrBetween + 6 个 need 点 + 4 个 bbox 预滤 _clrMax 化
  （此前 DRC 只按全局间距复检——影响区必要条件缺 DRC 充分复核；无声明设计位级不变）
- `rules.classes[].clr` → netClr 三来源 max（全局/IPC 查表/classClr），buildModel vMap
  走 netClr 单一源；fabChecklist 新增 电压组（netClrDecls 首个消费方）

### 批次3：阻抗阻焊一阶修正（5859687）

- `design.solderMask`（mm）→ diffPairZ −2Ω/0.0254mm（Bogatin B.43/44 一阶口径），
  pairGapFor/耦合走廊/压实/DRC 全下游自动跟随（阻焊压低 z0 → sFor 增大 0.25→0.305）；
  diffz CLI --mask；缺省 0 位级兼容

### 批次4：交付/文档收口（003ed1d）

- **Fable 三板重交付 交付包-0.14.7**（84/95、101/112、101/110，与 0.13.27 位级一致；
  manifest 盖 0.14.7 章 + verify PASS + --force 留痕）——0.9.0 快照口径（审计 F-b）清零
- iCEBreaker/oshwhub-01 首次版本化交付（517/533、320/470 pad 级，ok:false 如实）
- 案例-03 文档补 G-b 口径对照表；白皮书 §2.4 性能（并行 5.08×/候选 1.5×/形状引擎）
  + 能力边界表规格声明族行；CHANGELOG 回溯补记 0.14.2 段

### 批次5：层位感知探针关闭（b26a590）

- `nets[].preferredLayer`（探针级硬约束）+ p05 真板探针：3 跨板长网强制单层 →
  506/512（−6）/3 DRC/+61% 耗时/过孔 +38%，探针三网全 0/2——**硬约束不可吸收，
  立项关闭**；代价偏好变体留"先证软偏好能改变层位选择"前置探针

### 验证

优化锁定 34→**42**（23a-b/24a-c/25a-b/26a）；全量回归 80 核心 + 285 node:test +
48 书籍 + 17 CLI + 39 模糊 + 7 深度校验 exit 0；五个外部案例 manifest 逐项对账通过。

## 0.14.6（2026-11-16）—— 规格声明→IPC/IEC 标准自动生效（批次1-3，每批独立深检+提交）

规格书/数据手册里有物理约束数据，但引擎声明入口此前只有全板统一默认值——"电流→线宽"
（0.14.2-0.14.4）是第一个实例，本轮按同一模式（声明→标准查表→自动生效→DRC 校验）补齐
三批。每批完成后独立深检（查表数值校验 + 真板端到端 + 导出链路 + 全量回归 + 永久测试）。

### 批次1：电压→安全间距（IPC-2221B，a485135 + 7a0231a）

- `nets[].voltage=V` → `ipc2221Clr` 查表 6-1（B1 内层/B2 外层涂层/B4 外层无涂层三档阶梯，
  15V→0.1 … 170V→1.27 / 500V→2.5mm）→ 该网有效间距 `max(全局,标准)`（`netClr/netClrDecls`）
- buildModel 焊盘影响区从全局 halfClr 改为 per-pad 影响区（高压焊盘推开异网更远；
  无声明网行为不变——位级兼容）
- spec 门电压声明拦截 + fabChecklist 逐网行；导出链路带电压网端到端验证
  （EasyEDA verify PASS / Gerber 8 刀 / IPC-356）
- 20b 断言语义升级：netW 内核自动抬宽后检查表从 fail 触发改为确认行（原地改写锁定）

### 批次2：过孔载流 + 热过孔阵列（70d3ed0）

- 检查表"换层过孔并联"行：布线换层孔 + 同网 stitching 计入并联，少于 `ceil(I/viaAmp)`
  （0.3mm 孔 1A/孔）判 warn；0 孔=同层走线 ok——布线器不自动加孔（几何约束复杂，
  报告给调用方）
- `thermalViaArray(design, compId, opts)` + CLI `thermal [--pitch --cols --rows --apply]`：
  元件面积最大焊盘（散热盘）下生成过孔阵，缺省按焊盘自适应（3×3 起）；孔心收进
  viaOuter/2、TO-220 舌片插件孔按孔边距滤除（DRC 同网不豁免口径）、pitch ≥
  viaOuter+viaEdgeMin 校验；输出复用 stitching 通道（固定孔/路由避让/DRC/Gerber
  钻孔/IPC-356 全链既有，零新增管线）
- fabChecklist 热设计组：≥6mm² 无孔 SMD 盘下无过孔 warn
- 行尾归一化（python 文本模式写 CRLF 再犯——已用 bytes 模式重写工具脚本）

### 批次3：阻抗自动定档收口（0a067db）

- `pairGapFor` 单一事实源：显式 `rules.pairs[].gap`（展开 nets[].pairGap，<clearance
  拦截——边到边语义与线宽无关）优先，否则 nets[].diffZ（缺省 90Ω）反查 sFor；
  调用方可能传会话内部网对象（无 pair/diffZ 字段）——按 id 归位 design 网再读声明
  （**深检抓到的真集成 bug**：compactPairs 传会话网 → 反查全 skip-unreachable，
  pair-compact 4 测试红；修复后 6/6）
- 四消费点统一：netMeta 耦合走廊带心 / compactPairs 限带 A* / 压实报告 ratioBefore /
  DRC 差分耦合度——无显式 gap 时行为位级兼容
- fabChecklist 阻抗组逐对行（不可达 warn 指向 gap 逃生门）+ spec 门布线前拦截
  （2 层 90Ω 最低 ~137Ω 物理不可达，如实报告）
- 永久测试 22a-22d：4 层 0.3mm 90Ω→S=0.25 自洽（zdiffAt(S)=90）、显式 gap 覆写、
  2 层诚实不可达、端到端耦合走廊 DRC 干净

### 验证

- 优化锁定 26→34（20a-d/21a-d/22a-d）；全量回归 80 核心 + 285 node:test + 48 书籍 +
  17 CLI + 39 模糊 + 7 深度校验全绿（exit 0）
- 批次4（层位感知 preferredLayer→协商约束）按计划立项留档不实施：需先设计
  "该网只走哪层"约束进协商的方式（passable 层过滤 or 代价偏好），规模与门图同阶——
  立项证据与规模估算见 docs/报告-规格声明自动生效-20261116.md

## 0.14.5（2026-11-15）—— 深优轮：布线热循环机械优化（位级一致）+ 外围工程化收口

双段式一轮：评审驱动的外围收口（不碰引擎行为）+ 剖析驱动的深优（位级一致）。

### 外围收口（评审 P0-P2 清单，docs/外围收口轮-20261115.md）

- **CRLF 回归修复三件套**：0.14.4 的 6a6896d 专做的 LF 归一化被 6d11acb 的 python 补丁工具
  整文件写回 CRLF，7 个源码锚点测试（via-ring-cache 等）在真实工作区全灭而 `npm run check`
  全绿（build 读源码时就地归一化，把问题掩盖而非暴露）。修复：① engine.mjs/template 归一 LF
  ② 新增 `.gitattributes`（`* text=auto eol=lf`，仓库层锁死——外部 python 补丁再写 CRLF 也会
  在提交时归一）③ `build --check` 新增行尾守门（任一注入源含 CR 即报错并给出归一化命令）。
  附教训：行尾转换禁用 `open('wb').write(open('rb').read()…)` 同路径一行式（wb 先截断——
  本轮实测把 engine.mjs 清成 0 字节，git checkout 恢复）
- **LICENSE**（MIT 文本落盘）+ **CI**（.github/workflows/ci.yml：行尾断言 → check → npm test
  → headless 浏览器测试；playwright 仅 CI 侧 --no-save 安装）
- **README.en.md 重写**：36 行（检查数"162"，11-06）严重落后 → 紧凑英文摘要（0.14.4 口径），
  明确中文版为事实源；**README.md 检查数对齐**（250→494，标注"明细随 CHANGELOG 滚动更新"）
- **AI 手册新增 §3.1 故障排查 checklist**：此前失败处理指引散落 §2/§3/§6 三处，收拢为按症状
  A-F 对号入座的固定排查顺序（先查布局，再调参数，最后才动层数——§6 复盘实证结论）
- **tests/si-inductance.test.mjs（4 测试入链）**：SI 电感五式 + copperThickUm 手算锚点
  （黑魔书式 7.9 / Bogatin ch13，非引擎复算）+ jlcTrackRule 2/4 层×铜厚矩阵；锁定已知缺口：
  1.5oz 单面板 limit 字段缺失（spec 工艺极限检查对该组合静默跳过），修复时反转断言
- **scripts/ab-diff.mjs 对拍架转正**（--before 任意 git 引用，12 案例 sha256）——修复 0.14.4
  记录的留痕缺口。确定性口径修正：clean() 需剔除 session.t0（Date.now 墙钟）与 timeMs；
  剔除后实测 routeBoard 的 result 跨进程/跨运行逐字节确定（位级对拍成立前提再确认）

### 深优（全部位级一致，docs/深度优化报告-20261115b.md）

- **剖析**（--cpu-prof，fable-03 shape 全链）：astar 主循环 59.3% + 堆 pop/push 12.7% +
  fillDistanceMap 8.7%——形状管线成本大头在内部栅格基线协商，shape 侧合计 <5%
- **T1-1 堆 push/pop 局部变量化**：堆数组/大小拷贝进局部，消除筛化循环逐层上下文槽读；
  筛化算法逐行一致 → 弹出序逐位一致（4-ary/懒删除都会改 tie-break 序，禁止）
- **T1-2 邻居环 enterOK 内联 + pairBand/scoped 会话常量外提**：逐字段同序直读链；
  hard own 判定 `net.cells.has(s)` 与 `ownStamp[s]===gen` 在 astar 生命周期内恒等
  （ownStamp 入口自 net.cells 全量置位，commit/rip 均在 astar 之外）
- **T1-3 斜向双正交格 passable 内联**（同口径）；**T1-4 pairBonusGet 邻居环内联**
  （typed 直读 + Map 回退原样）
- **实测（同机空载两轮复测一致）**：emcu optimize(2) 155→101ms（**-35%**）、压力板
  optimize(3) 38.7→21ms（**-45%**）、fable-03 shape 全链 29.0→26.2s（**-10%**）、
  e555 optimize(2) -6~-12%；剖析总时长 93.7→68.9s（-26%，pop/push 从热点榜消失）
- **12 案例 ab-diff sha256 全部逐字节一致**（基线与 T1 后同 hash：e555/eled/emcu/m1-p01/
  autoPlace/placeAndRoute/压力板/fable 栅格·形状·shape-only·铺铜·DRC 全口径）；
  npm test 全绿（含外部轮 25 优化锁定）+ test:browser 全绿 + check 行尾守门通过
- **T2-A 热点名提升（二段追加）**：presFac/layerDirOn（轮边界变写 let，V8 无法常量化）
  + usage/ownStamp/hist/hMap（逐邻居多访问 typed 引用）提升为 astar 局部别名，仅热点名
  精准替换 → 逐位一致；**源码锚点测试联动义务实例**：via-ring-cache/congestion-neighborhood
  的 vm 提取区落入别名 → 脚手架同步绑定（21/21 恢复）；同进程交错 A/B（hash 同时校验）：
  emcu optimize(2) **-9.1%**、压力板 optimize(3) -1.7%、协商全链 -0.2%（噪声内）；
  **对拍架扩容 12→14 案例**（+h2-stm32 容量停滞档 ~3min/引擎（非 quick 组）+atmega quick 档）
- **评估后放弃（留档防重踩）**：H 图缓存（第九轮已证伪 1.3% 命中率）、过孔环跨调用持久化
  （环值内嵌本网 own 调整 → 跨网不复用，仅 ≥3 焊盘网第 2 边起有收益，预估 2-4% 不抵
  一致性风险）、4-ary 堆/懒删除（tie-break 序变化）、fillDistanceMap stamp（启发式口径漂移）
- **结论**：位级一致机械优化接近地板；下一档收益在质量侧实验（0.14.4 邻域修正口径）

### 版本记账说明

外部轮提交信息版本号（"0.14.2 载流感知线宽定档"，54b06f8）与 package.json（0.14.4）不一致，
系其会话内独立计数所致；package.json 未回退，本轮按序列推进至 0.14.5。

## 0.14.4（2026-11-15）—— 外部复查轮：正确性修复、等价性优化与拥塞代价模型修正

外部 AI 复查轮（三个子轮，逐轮独立验证后入库；审查记录见对话与各文档）。

### 子轮一：正确性修复与等价性优化（docs/optimization-review-followup.md、docs/deep-optimization-20261115.md）

- **混合线宽几何扫描漏检**：auditGeometry/allNetGeoVio 排序 sweep 的 break 界改用本层最大半宽——旧实现用当前候选段半宽提前终止，后方更宽段的违规被漏检（三段最小反例实证）。均匀线宽板位级不变
- **Worker 会话指纹**：字段白名单 → 完整规范化设计序列化——旧白名单漏 stitching/间距/过孔尺寸/网规则，新增固定孔后单网重布静默使用旧障碍模型；保守方向（元数据变化也重建模）
- **CLI 策略契约**：--no-joint-reroute 布尔旗标、--fanout-first 枚举校验、autopcb 透传 blindVias/compactPairs/jointReroute/fanoutFirst、--pair 重复字面量键清理
- **netLowerBound Prim O(P³)→O(P²)**：独立差分 1000/1000 严格相等；600 焊盘 99.6×/1000 点 170.6×（函数本身，非整板）
- **netGeoVio 段-段候选专项审计**（countNetSegmentViolations）：等价两次全板审计之差，密集合成板 13×
- **UI**：网络面板几何缓存（447~480×，输出等价）；路由状态统一 invalidateRoutingSession（Stop/Escape/失败同源，7 项 UI + 6 项浏览器回归）

### 子轮二：拥塞代价模型修正与制造约束（docs/engine-quality-performance-20261115.md）

- **nearPen 邻域坐标错误修复（行为变更）**：旧实现把 `ns%NC`（格索引）当列号、`floor(ns/NC)`（层号）当行号——东邻只在首行生效、西邻 x=0 跨行环绕、南北邻跨层环绕、3W 环坐标错乱。修正为真实列/行分解。**21 案例同输入对比（可复现）**：几何 DRC error 61→48、线长 4906.5→4593.1mm（-6.4%）、过孔 90→115、未连通 0→0，routeScore 7 好/10 同/4 差（退步案例如实点名 p19-star-7、p45-center-keepout）——**不是全面无损的质量提升**。搜索黄金样本随之迁移：旧 search-baseline.json 保留不覆盖，新增 search-neighborhood-baseline.json（连续两次严格相等后记录），配独立 (layer,row,col) 三元组 oracle 回归（VM 沙箱执行真实源码块）
- **过孔环代价缓存**：环偏移排除中心 ⇒ 环和与换层层对无关（原 rs===cur/ns 过滤恒不命中）⇒ 按 (cell,gen) 缓存 Float64 罚分有效。真实板会话布线 5 次中位 -13.9%，全部几何/统计严格相同（对照=当前引擎仅关缓存）；NC≤100 万启用（+12MB 上限），超限直算回退；顺带修复 TS>4M 时 nearPenCache 为 null 的无条件写入崩溃
- **自动过孔避开既有固定孔钻孔**：stitching/手动换层孔此前不进布线门禁——最小例实测可在同网固定孔旁钻出 0.10mm 孔边距（几何 DRC 0 但 DFM warn）。会话在有固定过孔时按 manufacturingHoles 同口径建按 X 排序孔表，二分邻域查询，同网不豁免、仅等价孔可复用、不相交埋孔跨度不误挡；最小例孔边距 0.10→0.307mm、DFM warning 1→0、线长代价约 +1mm
- **全阶段回滚后的差分对报告**：postroute 整体回滚时 routeBoard 恢复几何但不带压实报告、会话残留被回滚尝试的旧报告——回滚后按最终几何重算占比，标记 rolledBack:true/compacted:0，会话 buildResult 同步；仅报告状态，不放宽接受门禁

### 验证

- 旧 search 基线在子轮一状态 16/16 通过（位级不变实证）；子轮二后新基线 16/16×3 次运行确定
- 21 案例质量对比经第三方以 HEAD 重建 before 引擎逐行复现（21 行浮点一致）
- npm test 全绿（80 核心 + 281 node:test + 48 书籍 + 17 CLI + 39 模糊 + 7 深度校验 + 22 优化锁定）；npm run test:browser 60 项通过
- 已知留痕缺口：两份文档引用的改动前快照目录（.scratch/deep-review-20261115/、.scratch/engine-quality-20261115/）未随库存留——复现可用 `git show 30c497c~1:src/engine.mjs` 重建 before 引擎（21 案例数字已证实与该重建一致）
- 版本 0.14.4；离线入口 index.html 随源码重建

## 0.14.2（2026-11-14，回溯补记——该版本当时未留 CHANGELOG 段，0.14.7 批次4 B3 补齐）

- **载流感知线宽定档**：nets[].current（A, RMS）声明 → IPC-2152 自动定档
  （ampWidthFor 反查 w=base×I^1.113 / netCurrentDecls 报告 / currents CLI --apply /
  spec 门拦截 / 永久测试 20a-20c）
- **门图立项关闭**：corridor-first 门判据实验显示 Fable 板剩余阻挡为不可移动的
  焊盘铜几何（castellated pad 节距 1.27mm）——门图（IntBox 房间代数）对此失效，
  立项关闭（docs/门图立项决策.md）；G-d 规模探针完成：BGA-64 620 障碍 →
  shpBuildAxes 159×195=31,005 轴格，小于 fable-01/M1-p01——"房间数爆炸"风险解除

## 0.14.3## 0.14.3（2026-11-14）—— 性能深优轮：14 处位级一致热路径优化（11 案例对拍逐字节一致）

### 背景
门图立项关闭（0.14.2）后的空档轮。三路并行侦察产出 26 处未优化热点清单
（历史报告遗留项 / engine.mjs 全函数审读 / 质量侧边界），本轮落地 14 处，
全部**位级一致**（输出 JSON 逐字节不变，布通率/线长/过孔/DRC 数字不变）。
详见 [深度优化报告-20261114](docs/深度优化报告-20261114.md)。

### 第一梯队（12 处）
- **checkGeoSpacing 两段式保序排序扫描**：协商/逐网优化主热点，无排序 O(S²) 全对
  → 按层+x0 排序收集候选对（提前 break）→ (i,j) 字典序回排原判定——输出序不变
- **checkDRC 5 处**：manufacturingHoles 数值键、过孔-走线 wOf 复用、DFM 焊盘-走线
  按层索引、`Array.from` 复活副本、3W pairOf Map 化
- **形状管线 5 处**：keepSet 启用、crossHist 预解析、dst 增量维护、过孔回填增量、
  shpAstar 缓冲复用
- **A\***：adjPenAt ownStamp 戳替代 Set.has
- **Prim 选序 O(p³)→O(p²)**（栅格+shape 两侧，严格 < 保选中序）
- **autoPlace 代价函数索引化**：maxTrackW 外提（原每退火步 spread 全 nets）、
  W.get 活对象数组、dirBlk 复用
- **杂项**：pourContains/pourNear y-slab 边索引、beautify 谓词索引、pairCoupleStats
  bbox 快筛、serpentine pairOf Map 化

### 第二梯队（2 处）
- **rebuildViaInf 增量补丁**（routeNet 尾部）：via 快照差分口径，补丁区=旧∪新盘
  清零+全盘重放——stale 窗口语义不变；收益对象是 n130/BGA 级大 TS 板
- **形状修复轮全板违规归属一次扫描**（allNetGeoVio）：O(N×S²)→O(S²)，四族归属
  规则与 netGeoVio 对称差口径逐族对齐

### 实测（中位）
形状管线 **-34%**、autoPlace **-66%**、布局布线循环 **-45%**、协商热循环 -13~-24%、
密板 DRC -24%、大铜皮查询 **-93%**；超小板 optimize +3.7ms（排序开销，留档可加门槛）；
fable-03 栅格全链与 m1-p01 中性（双实例同进程 A/B 核实）。

### 对拍架与两次真 bug 抓获
新增 `.scratch/diff-perf-20261114.mjs`（11 案例 sha256 守门）与 `tests/bench-hotloop.mjs`
微基准。差分架当场抓出两个未流入交付的 bug：pour slab 恰在 yhi 的水平边双侧越界
漏检、pairCoupleStats bbox 快筛端点序假设——均修复并 0/2000 复验。

## 0.14.1（2026-11-14）—— 多网联合重布：失败网+阻塞者子集枚举（#12b 栅格侧落地）

### 背景（0.14.0 后的 Fable 三板诊断）
残留网（84/95、101/112、101/110）的形状补线拒绝原因以 **no-path** 为主
（obs 387~423）——在现有协商铜的障碍下轴图真无路，但 0.11.7 隔离实验证明
个体可达。失败机理 = 现有协商铜的分配不留路 → 单网重布无解，需要
**拆阻塞者 → 失败网先布 → 阻塞者绕行**的多网联合重排。骨架镜像形状侧级联
（0.13.6 已证明有效），侦察确认不依赖形状专属结构、完全可平移。

### 交付
- **jointReroute 会话方法**：失败网（cap 8）逐个处理——阻塞者探测
  （openPads 2.5mm 内有铜的网，重叠计数 top-3）→ mask 枚举（2^n，n≤3）→
  每 mask：restore → 拆 F+子集 → routeNet(F,true) 独占走廊 → 阻塞者按
  net.i 序软重布 → scanOveruse → 全板 `[-drcE, conn]` 权威计分
  （checkDRC dfm:false 含 manualRouteEntries，与 deliver/测试同口径）→
  严格更优才换 bestMask → 平手保守回滚
- **commitRoutes 语义修复**：提交铜后 `S.overuse=scanOveruse()`——此前
  摄档/并行提交后 overuse 停留旧值（并行路径下轮反正重算，无风险；
  standalone 摄档口径由此修复）
- **routeBoard 接线**：compactPairs 之后自动调用（缺省开启，
  `--no-joint-reroute` 关）；result 附 joint 报告；全连通板 no-op 不落字段
  （输出位级不变——search-baseline 16 fixtures 全 complete 已核实）
- **CLI**：`--no-joint-reroute`（route/autopcb）+ 帮助文本

### 实测（Fable-01 实板摄档接入）
improved 2 网、**DRC error 14→9（-5）**、连通守恒 84——字典序接受
DRC 纯收益；其余 5 网如实 no-gain。

### 深检记录
- 过程抓到并修掉三个实现 bug：applyMask 残留死代码、mask 位序在 rip/reroute
  两阶段不一致（选择序≠枚举序）、saved 快照未按失败网重取（前一网的改进
  会被后一网的 restore 吞掉）
- 排除一个假警报：测试口径漏 manualRouteEntries + commitRoutes overuse
  停留旧值叠加造成的"DRC 增加"假象——两者都已修复为正确语义

### 边界（如实）
- 只打失败网；全连通板的 overuse 残留（BGA-64 2 层 13 DRC）是另一模式
- iter-parallel 自建会话路径不接（同 compactPairs）
- 阻塞者 top-3 截断（形状侧无 2^n 防护是已知欠账，栅格侧补上）

### 验证
joint-reroute 4 项（含 Fable 实板接入王牌测试）+ 238 既有全绿 + 并行
12/12（commitRoutes 语义修复无副作用）+ search-baseline 16/16 原样 +
审计 28/28；index.html 已重建。

## 0.14.0（2026-11-14）—— 0.13.x 审计修复：文档/交付包补齐（F-a/F-b/F-d/F-e）

### 审计发现的处置（5 项按严重度）
- **F-a ✓** `routeBoardParallel/IterParallel` 新公开 API 未入文档 → AI 手册 §5.0
  补记：两入口的返回形状（候选级 `{result,session:null,from}` vs 双态
  `fallback:true` 判别）、engineUrl 语义（Parallel 可选降级串行 / IterParallel
  iterWorkers≥2 时必传 throw）、design 原地改写副作用
- **F-b ✓** 三块 Fable 案例板交付包是 0.9.0 快照 → **0.13.27 引擎重交付**：
  USB-Speakerphone 84/95（+2）、Voice-Hub 101/112（+6）、Handheld-Pet 101/110
  （+2）；`交付包-0.13.27/` 各 17 件 + manifest 盖 0.13.27 章（--force 连通门
  未满如实留痕）。**审计口径 103/110 未复现**（4/6 轮 × vc3/5/15 × shape 全试
  最高 101，差 2 网留档）。两个真发现：① viaCost 5 是三板共同收益来源；
  ② deliver 的 manifest 版本回退值 '0.9.0' 是硬编码——重交付最初仍盖 0.9.0
  章，已改为读 package.json（审计字面成因）
- **F-c（留专项）** p10 类违规产生路径未定位：重放基建（onStage/会话重放）
  已就位，专项独立处理
- **F-d ✓** HDI 旗标名易误用为 hdi → CLI 帮助补一句（旗标/选项名
  blindVias；design 侧 design.hdi.blindVias）
- **F-e ✓** CHANGELOG 0.1.0 "已知边界"段陈旧 → 原条目删除线重写，逐条对齐
  2026-11-14 现状（栅格/盲埋孔/差分对/蛇形/覆铜/重板收敛六项全部标记解决
  版本），留痕可查

### 无代码缺陷
本轮唯一代码修复是 deliver 的 manifest 版本戳（读 package.json 替代 '0.9.0'
硬编码）——审计原话"无代码缺陷"成立。

### 验证
238 node:test + 全量套件 0 失败；一致性审计 27/27；三个重交付 manifest
逐项对账一致（版本章/件数/连通数/override）。

## 0.13.27（2026-11-14）—— 差分对强制压实：route 后成对重构（0.4.0 留档后续项）

### 交付
- **compactPairs 会话方法**：对每对 partner 真正重构——拆掉耦合较差者，在
  "master 偏移环带 ∪ partner 焊盘 escape 区（R=12 格全层）"的限带 A* 里重布
  （环带数学复用 buildPairBonus：steps=round(Wc+S)/grid，容差 ±1 格；环带只标
  master 实际有铜的层——异层平行不占比）。验收=耦合占比提升 + DRC error 不增
  + 连通满，否则快照回滚；master 选择失败换位重试一次。
- **限带机制**：enterOK 单一 choke point 加 `S.pairBand` 过滤（null=关闭零开销），
  RMST/Prim/reroute 全部 astar 调用天然继承。
- **pairCoupleStats 提取**：checkDRC 耦合采样块（原 :6024-6055）逐行等价提取为
  模块级助手——DRC 与压实器单一事实源（diffpair.test 5 项位级通过为证）。
- **routeBoard 接线**：optimize 之后自动调用（缺省开启，`--no-compact-pairs`
  关闭；opts.pairCoupleTarget 可调 0~1）；result 附 compact 报告；无 pair 板
  不落字段（输出位级不变）。
- **DRC 语义闭环**：压实后占比 ≥0.6 → 差分耦合 warn 消失——DRC 的"建议清除
  对内障碍后重布"现在引擎自己会做。

### 实测
- **压实触发现场**（pairBias=false 让偏置失灵）：占比 **0→0.716**（compacted:1），
  DRC 0、连通 8/8、差分耦合 warn 消失——接受路径端到端证明
- **已耦合板**（0.913）：如实 skipped——不强行重构
- **对角交叉对**：拓扑性反平行，如实 skipped（占比 0.399）——压实的边界：
  平行拓扑不存在时无从重构
- **带全堵**：skipped 且与关闭时逐字一致（快照还原语义）

### 深检记录
- 过程中排除一个假警报：探针用未吸附 design 副本复检 DRC 产生 0% 假 warn
  （grid 0.25→0.4 被 routeBoard 提升、路线对应吸附后足迹——M3/QFN 同款教训，
  DRC 复检必须用同一被改写 design 对象；插桩确认内部 prepare 全程 0.73~0.93）
- beautify 假设一度怀疑破坏平行耦合——实证排除（beautify=false 同样 warn，
  真因是探针口径）

### 边界（如实）
- iter-parallel 自建会话路径不接压实（routeBoard/parallel 包装器已继承）
- 等长：平行段等长但端点段各自到达，差分等长 warn 可能变化，验收只锁 error
- 阻碍在带内的障碍（如窄缝只容单线）压实无法解决——如实 skipped 留给
  DRC/advise 指引

### 验证
pair-compact 6/6 + diffpair 5/5 + search-baseline 16/16；232 node:test +
全量套件 0 失败；一致性审计 27/27；index.html 已重建。

## 0.13.26（2026-11-14）—— 深检：M1 复现性证明 + 足迹独立审计 + 画像更新

### 三项独立验证（0.13.25 的 M1 结果）
- **足迹独立审计**：20 板 design.json 无走线 DRC 全查——焊盘间距/焊盘重叠/
  出板 20/20 干净；全库最小异网焊盘包围盒间隙 0.200mm（p07 THT 排针，
  ≥0.08 设计间距）——不依赖 routeBoard 绿的独立口径
- **生成器复现性**：gen-m1.mjs 重跑 20/20 全绿且 summary 逐字段一致；
  result.json 差分仅 timeMs 2 行（路线逐字节确定）
- **白皮书画像更新**：单板网数画像加注 M1 实测（130 网/512 焊盘全绿
  43s，WS2812 8×16 链）——0.13.25 的实测直接扩充能力画像

### 验证
全量套件 0 失败；审计 26/26（含 m1-batch 永久门断言）。

## 0.13.25（2026-11-14）—— M1 补齐：20 个 4 层 ≥200 焊盘项目全绿

### 交付
- **0603 填充器**（gen-m1.mjs）：确定性把每板焊盘垫到 ≥200——占用检查
  （包围盒 + 0.35mm 裕量防重叠）、净格扫描、不足时板高 +8 递增；被动件
  农场是真实板构成
- **p20-quad-lqfp64**（256p 构造即达标）
- **形状补线兜底**：route 未绿时 routeBoardShape 接管
- **结果（0.13.24 引擎实测）**：20/20 全绿（complete + DRC errors 0），
  焊盘 200~512、全部 4 层，总耗时 ~54s；0.13.16~0.13.24 引擎演进在
  20 板上零退化
- **归因如实**：19 板栅格直绿，p20 为形状补线救回（栅格 partial
  192/256 → shape complete + DRC 0）
- 旧 p19-qfn-dense（被 -05 取代）目录移除；上版报告的口径不一致
  （盘点按 ≥200 计缺口、生成板多数 <200）本轮从严重跑修正

### 永久门
tests/m1-batch.test.mjs（入 npm test）：存档对账（20 板 × ≥200p × 4 层
逐板核验）+ 4 板抽样活复现（完整管线 route+shape）。

### 路线图
M1 ✓——阶段一/二/三全部里程碑（M1/M2/M3）至此全部达标。

### 验证
m1-batch 2/2；230 node:test + 全量套件 0 失败；一致性审计 26/26。

## 0.13.24（2026-11-14）—— 深度检查：借道罚负权校验修复 + F3b 精确计数器证伪撤销

### 深检范围
0.13.20~0.13.23 四提交的全链走查：F1 判定/排序、F3 借道罚热路径、M3 验收、
路线图记账、确定性、位级守门。

### 修复（保留）
**fanoutBorrowPen 无校验**：opts/design.hdi 传负值会使 A* 边权为负（ec=1+hist
底座可被 -5 压成负权），破坏 Dijkstra 堆不变量；NaN 毒化全部代价。补非负
有限校验（createSession，与 fanoutFirst 同位）+ 测试（-1/NaN/Infinity 干净
报错）。

### 证伪撤销（如实）
**F3b fanoutCnt 精确计数器**：深检发现 F3 用 cellOwner（最近占用者，借道会
翻转）判阵列网——"保护在第一次借道后蒸发"的语义弱点。实现精确计数器
（fanoutCnt[s]>0 ⇔ 有阵列网占 s，8 处 cell 增减点对称维护）后实测：

| 模式 | F3（cellOwner 近似） | F3b（精确计数器） |
|---|---|---|
| 2L inner pen10 | **13** / 74 孔 / over 8 | 30 / 93 孔 / over 18 |
| 2L outer pen10 | **14** / 89 孔 / over 8 | 17 / 88 孔 / over 11 |

精确反而全面更差：计数器把阵列网的**全部**铜（含目标侧走线、多重占格）
纳入罚域——过度惩罚把借道者逼进更差排布（与 pen=25 非单调同因）。
cellOwner 近似恰是更好的校准（罚域窄=只罚新 claim 的通道格）。整体回退，
工作区仅保留校验修复。

### 走查确认（无问题项）
- F3 位于 `if(!hard)` 内——硬阶段（独占）不触借道罚；代价块先于 kind 分派
  ——覆盖走线/过孔/斜向全部边型
- `foi>=0&&foi!==net.i` 守卫；fanout off 路径零开销（先判模式再查）
- detectBallArrays 边界：重复坐标（minAdjDiff 跳过 0 差）、单列阵列（<4 列拒）、
  环深非负（pad 在自身 bbox 内）
- restore 不重建 cellOwner 是既有行为（F3 不再依赖精确性，无影响）
- M3 测试双跑稳定；路线图 M1 盘点口径覆盖两层目录

### 确定性
fanoutFirst ON 双跑逐字一致（F1/F3 新路径）；off 双跑一致；
search-baseline 16/16 原样。

### 验证
230 node:test + 全量套件 0 失败（含新增校验测试，fanout-first 10 项）；
一致性审计 25/25（新增 m3-qfn 入列断言 + 负权校验存在断言）；index.html 重建。

## 0.13.23（2026-11-14）—— M3 验收：0.4mm QFN 密集板 DRC 全绿 + 路线图记账

### M3 达成（双口径，永久门 tests/m3-qfn.test.mjs）
QFN-44 @0.4mm（焊盘 0.2×0.3、线 0.1/距 0.08、过孔 0.3/0.15，2 层）：
- **现实 breakout**（目标四外侧行平行逃逸）：88/88 连通、DRC **0**（栅格
  2.3s；无失败网 → 形状补线平凡绿）
- **压力环**（目标环形放射强制交叉）：88/88 连通、DRC **0**（栅格 25s +
  形状补线）
- 早期更贴边变体实测 grid 6→shape 2（同一协商残留类），扩边距后收敛——
  如实记录
- M3 验收过程中修掉两个 fixture 伪影：QFN 四角焊盘对冲重叠（真实足迹角部
  让位）、目标行 0.4 距配 0.4 宽焊盘相触——都是设计错误而非引擎问题，
  引擎 DRC 如实抓获（顺带验证了足迹自查链）

### 路线图记账（只改文档）
- **#14 推挤式交互 ✓**：0.13.2 已交付 UI 层（实时碰撞反馈+提交前拦截+
  事务化撤销+陈旧 model 防护）——路线图此前漏打 ✓
- **M1 未达标（如实）**：全库 ≥200 焊盘仅 3 项、4 层仅 1 项
  （ext-oshwhub-01）——批量生成 4 层 200-pad 板是遗留项
- **M2 ✓**：kicad-plugin/ + 案例 iCEBreaker、开源广场两篇

### 交付物清单重盘（除 #11 npm 发布外的路线图状态）
阶段一 6 项 ✓（M1 里程碑除外）、阶段二 #7/#8/#9/#10 ✓（#9 AI 工作流以
ai/pcb.mjs 证据分级 CLI 形态在役）、阶段三 #12/#13/#14/#15 全 ✓ +
12b 三阶段 + room-gate v1/v2 + BGA 修复包（A1/A2）+ #15b 盲埋孔 +
扇出优先（F1/F3，F2 证伪撤销）。

### 验证
m3-qfn 2/2；全量套件 0 失败（npm test 含新门）；一致性审计 23/23。

## 0.13.22（2026-11-14）—— F3：扇出借道附加罚（BGA-64 2 层残留累计 33→13）

### 交付（0.13.21 留档后手的实现）
astar 借道代价里，占用者为阵列网（`nets[foi].fanoutRing!=null`，按 cellOwner
首占用者判）时每格加 `fanoutBorrowPen`（缺省 10，opts/design.hdi 可调）。
仅 fanoutFirst 开启时消费——**缺省 off 路径零改动**（search-baseline 16/16
原样）。

### 与 F2 冻结的差别（为什么这个有效）
F2 冻结是"属主不动"——单向斩断协商的全局迁移机制，实测全面劣化后撤销。
F3 只抬价格不动属主：借道者在**有余路时**绕开逃逸通道，**无余路时**仍可
冲突协商——这正是 Freerouting 拆扇出铜 ×139 软保护的语义（我们按格计价）。

### 实测（BGA-64 2 层，A1 口径）
| 配置 | DRC | 过孔 | overuse |
|---|---|---|---|
| off（基线） | 33 | 80 | 23 |
| inner_first（0.13.20 F1） | 22 | 81 | 13 |
| **inner_first + pen10（本轮）** | **13** | 74 | **8** |
| outer_first + pen10 | 14 | 89 | 8 |
| inner_first + pen25 | 21 | 109 | 12（罚过猛反而劣化） |

2 层残留累计 33→**13**（-61%）；pen=10 恰当，25 过猛（借道者被逼进更差的
排布，如实记录非单调性）。

### 验证
228 node:test + 全量套件 0 失败；fanout-first 9/9（BGA-64 行为门 ≤33 仍过，
实际 13）；search-baseline 16/16 原样；无阵列板 ON/OFF 位级一致（借道罚不
触发）。

## 0.13.21（2026-11-14）—— F2 协商冻结：假设证伪，如实撤销（无代码变更）

### 实验
F1 深检显示 pass-1 独占分配被协商轮部分冲掉（overuse 23→13 未清零），
按计划立项 F2"稳定阵列网协商冻结"：协商轮对已连通、无争议的阵列网跳过
rip/route（Freerouting"扇出铜不轻动"软保护的架构对应）。实现 + 冻结行为
测试（10 项全过）后实测：

| 模式 | F1（无冻结） | F2（冻结） |
|---|---|---|
| 2L inner_first | DRC 22 / 81 孔 / over 13 | DRC 24 / **102 孔** / over 16 |
| 2L outer_first | DRC 20 / 61 孔 / over 13 | DRC **46** / 92 孔 / over **33** |
| 4L inner_first | DRC 4 / 73 孔 | DRC **11** / 59 孔 / over 8 |

### 证伪结论
冻结全面劣化。根因：Freerouting 的软保护是"拆扇出铜代价 ×139"——他人
**可以**付高代价拆走，全局重排仍然可能；我的冻结是单向跳过重布——阵列网
钉死，协商的核心机制（每轮全拆全重布、路径向全局更优迁移）对容量紧张
场景恰好是最需要的，被斩断后借道者只能持续付 presFac 死锁在劣化排布上。
**"pass-1 分配被冲掉"不是 F1 的 13 个残留 overuse 的根**——剩余冲突是
协商本该继续打磨的对象，不是需要保护的分配。

### 处置
step() 冻结分支与对应测试整体撤销，工作区回到 0.13.20 位级（search-baseline
16/16、fanout-first 9/9 复验）。遗留的可行后手（未实验，留档）：借道
代价变体——对 borrow 阵列网铜的格子加附加罚（不动属主），让借道者在
有余路时绕开、无余路时仍可冲突协商。

## 0.13.20（2026-11-14）—— F1：扇出优先排序（BGA-64 2 层残留 33→20）

### 交付（Freerouting BallEscapeOrder/BallFields 语义移植，源码实证）
- **detectBallArrays**：BGA 阵列判定——≥16 球、单层同层、行列（pitch/4 容差
  聚类）≥3×3、填充 ≥50%、圆焊盘 ≥16 且 ≥75%（BallFields.java:18,61,116-118
  + TwoLayerBga.java:53-59 阈值原样）；组件 = pad id `-` 前缀（与 advise
  FANOUT 检测同口径）。pitch 用排序去重坐标相邻最小差（规则网格与 Freerouting
  的 O(n²) 等价；错排阵列记边界）。
- **环深**：ring = round(球心到阵列包围盒四边最小距离/pitch)，
  BallEscapeOrder.java:128-129 公式原样；网取最内圈球。
- **pass-1 inner-first 排序**（fanoutMoveToFront）：阵列网按环深提到首队列
  最前（inner_first=降序 / outer_first=升序，同环稳定按 net.i），非阵列网
  保序殿后。**仅动 pass-1 首队列**（startQueue(false) 唯一调用点），协商轮
  队列不动——这是与已撤销 A2c（改 sortNets 影响每一轮、方向存疑）的本质
  差别。
- **开关**：opts.fanoutFirst / design.hdi.fanoutFirst / CLI
  `--fanout-first [auto|inner|outer]`；'auto' → 2 层 inner_first、其它层数
  off（Freerouting 同款）。缺省 off **位级不变**。
- advise 的 FANOUT/FANOUT_TIGHT 补救文本追加 `--fanout-first` 提示。

### 实测（BGA-64，A1 口径 round6/n71-bga64 maxIter 20）
| 模式 | 连通 | DRC | 过孔 | overuse |
|---|---|---|---|---|
| 2L off（基线） | 98/98 | 33 | 80 | 23 |
| 2L inner_first | 98/98 | **22** | 81 | **13** |
| 2L outer_first | 98/98 | **20** | **61** | **13** |
| 4L off / inner_first | 98/98 | 2 / 4 | 68 / 73 | 4L 建议 auto（=off） |

**首个真正撼动 2 层残留的机制**（自 A1 后 33 三轮未动）。意外发现：
outer_first（20/61 孔）优于 Freerouting 默认的 inner_first（22/81 孔）——
我方独占硬阶段+每轮全拆重布的动力学与 Freerouting pass 制不同，两种模式
都保留供用户按板取优。overuse 23→13 未清零：pass-1 的独占分配被协商轮
部分冲掉——F2（稳定阵列网协商冻结）的立项依据。

### 验证
228 node:test + 全量套件 0 失败（含新增 tests/fanout-first.test.mjs 9 项：
判定阈值矩阵/环深/队列 moveToFront/非法值报错/BGA-64 行为门/无阵列板
ON=OFF 位级）；search-baseline 16/16 原样；index.html 已重建。

## 0.13.19（2026-11-14）—— C：BGA 终态矩阵 + 门图定案（留档不立项）+ 文档同步

### BGA-64 终态矩阵（A1 口径：projects/round6/n71-bga64，maxIter 20）
| 变体 | 连通 | DRC | 过孔 |
|---|---|---|---|
| 2 层通孔 | 98/98 | 33 | 80（复现 0.13.16/17 记录，逐字一致） |
| 2 层盲孔 | 98/98 | 33 | 80（2 层板相邻 span=全层，盲孔定义上空操作） |
| **4 层通孔** | 98/98 | **2** | 68（间距冲突 1 + 走线间距 1） |
| 4 层盲孔 | 98/98 | 41 | 67（如实：负收益） |

### 门图决策：留档不立项
- ① 4 层通孔 DRC 已收口到个位数（2）——加层是 BGA 第一正解（advise 的
  FANOUT/加层建议 0.13.13 已交付指引）
- ② 盲孔在 BGA-64 上负收益（41>2）：span 自由度让网更细地穿透球阵、
  协商残局增多——如实记录
- ③ 2 层残留 33 的根因是缺扇出优先的整体规划（0.13.15 定案：容量够、
  历史代价无效），正解是 BatchFanout 语义的扇出优先路由（独立大项），
  而非 any-angle 房间代数
- room-gate v1/v2（形状侧）与协商历史代价已留档（0.13.5~0.13.15）

### 文档同步
- README/能力白皮书/路线图：HDI #15b 状态更新（自动生成已交付 opt-in）
- `docs/深度优化报告-阶段三.md` 追加第四篇（13.1~13.5：A1/A2/#15b/门图
  定案/边界）
- 一致性审计扩充至 22 项（--blind-vias 三处接线、缺省位级不变、VIPPO
  行、报告数字与实测一致、Excellon 分刀账实相符）——22/22 通过

### 验证
228 node:test + 全量套件 0 失败；审计 22/22；search-baseline 16/16 原样
（0.13.16~0.13.19 全程位级守门未再打破——A1 之后所有改动均为 opt-in 或
修 bug 恢复原行为）。

## 0.13.18（2026-11-14）—— B：#15b 相邻层盲埋孔生成（opt-in）

### 交付
- **viaInf 跨度化（B1）**：过孔走线影响区从按列（NC）改按状态（TS）——
  盲埋孔只在其 span 层标记异网走线阻挡（span 外层走线可自由穿过过孔
  投影区，物理上无铜相交）。viaInfV（过孔落点 DRC 盘）保持按列保守口径。
- **addVia span 化（B2）**：签名加 (fromL,toL)，cells/usage 只标 span 层；
  viaSet 记 `{x,y,layers:[from,to]}`（0.13.1 的 DRC/Gerber/Excellon/IPC
  消费链直接复用）。同格重入取 span 并集（加宽）；值对象替换式更新——
  snapshot/restore 共享值对象，原地改会污染快照。
- **viaLegal 层感知（B3）**：通孔走列位图快路径；盲埋孔查 viaPadOwnerL
  （新增 TS 层感知焊盘位图）——span 外层的异网焊盘不阻挡。
- **生成开关（B4）**：`opts.blindVias`（CLI `--blind-vias`，route/autopcb）
  或 `design.hdi.blindVias`；commitPath 换层时记相邻层 span。缺省关——
  过孔仍记全层 span、输出无 layers 字段，**位级不变**（search-baseline
  16/16 原样通过）。

### 深检中修掉的四个 bug
- **viaLegal 漏查 span 外层焊盘（最重要）**：astar 过孔邻居最初把换层
  过渡的相邻 span 传给 viaLegal——通孔物理 span 是全层，只查相邻两层
  漏掉其余层的异网焊盘 → BGA-64 4 层实测 3 颗过孔压焊盘（IO1 过孔压
  gnd 网 U1-32，点距 0）+ 连通 98→97。修复：通孔分支回退全层检查
  （`viaLegal(net,cc)`，位级不变），盲孔分支才传相邻 span。修复后 4 层
  通孔与 0.13.17 HEAD 逐字一致（98/98、59 孔、DRC {3,2}）。
- **反序 span 毒化加宽**：commitPath 传入未排序 (pl,sl)，[2,1] 条目让
  min/max 加宽算出非法 [1,1]（单层"过孔"）。修复：addVia 入口防御排序。
- **Excellon span 缺口**：0.13.1 注释声称"盲埋孔跨度以注释节写明"但代码
  实际没写——同直径盲孔/通孔混在同一刀路，板厂无法分程序。修复：同直径
  不同 span 分刀，非通孔刀具在刀表区 `;Tnn span a-b (盲埋孔)` 注释
  （体区纯坐标，deep-validate 解析器兼容；全通孔板字节级不变）。
- **rebuildViaInf 括号失衡**（替换事故，syntax check 拦截）。

### 全链深检（合成 4 层 HDI 板：顶层球阵→底层目标）
- 盲孔 15 颗 vs 通孔 18 颗，**DRC 0 vs 2**（span 免阻挡红利：异层投影
  区不再误伤）
- **Gerber 分层闪光逐孔核对**：[0,1]/[1,2]/[2,3]/通孔 各层 flash 与 span
  严格一致（4 层 × 全部过孔自动断言）
- **Excellon 分刀**：T01 span 0-1 / T02 span 0-2 / T03 通孔 / T04 span
  1-2 / T05 span 2-3
- DRC/normalizeResult/verify 回读全过

### BGA-64 四层对比（round6/out，maxIter 20；通孔列为 viaLegal 修复后）
| 模式 | 连通 | DRC | 过孔 | DRC 构成 |
|---|---|---|---|---|
| 2 层通孔 | 98/98 | 5 | 59 | 间距冲突 3 + 走线间距 2 |
| 4 层通孔 | 98/98 | 5 | 59 | 同上（与 HEAD 位级一致） |
| 4 层盲孔 | 98/98 | **25** | 50 | 间距冲突 14 + 走线间距 9 + 过孔-走线 2 |

span 分布：30×[0,1]、6×[0,2]、4×[1,2]、2×[1,3]、1×[2,3]、7 通孔。
**如实结论**：BGA-64 上盲孔连通持平但 DRC 25>5——span 自由度让网"更细
地"穿透球阵，协商残局反而增多。盲孔的正战场是**为 HDI 设计的板**
（合成板 DRC 0 vs 2、过孔 -3）；对既有 2/4 层通孔布局是 opt-in 工具
而非自动收益。扇出优先路由仍是 BGA 收口的正解。

### 边界（如实）
- 形状补线路由器（routeBoardShape）不产 span 过孔——B 只覆盖栅格会话。
- [0,2]/[1,3] 型跨两层 span 来自同格重入加宽——机械钻孔（drill>0.1）
  可制造；激光微孔（≤0.1）的相邻层限制由既有 DFM 行如实报告。
- viaInfV（过孔落点）保持按列保守：盲孔-通孔同 XY 堆叠不可落（保守拒绝，
  无 DRC 风险；堆叠微孔独立大项）。

### 验证
228 node:test + 全量套件 0 失败（含新增 tests/hdi-route.test.mjs 9 项：
span 合法性/缺省位级不变/Gerber 闪光/Excellon 分刀/快照语义/回读）；
search-baseline 16/16 原样通过（位级守门未被打破——B 是 opt-in，且
viaLegal 漏查 bug 修复后通孔路径与 HEAD 逐字一致）；index.html 已重建。

## 0.13.17（2026-11-13）—— A2：盘内孔保护 + DFM VIPPO 行（A2a/b/c 如实撤销）

### 交付
- **A2d 保护盘内孔不被 optimize 拆**：optimize 的过孔消除比较 `vA<vB`
  排除"落在自身焊盘铜上"的过孔——它们是口袋球的唯一逃逸出口（车道
  预留），不是绕行脂肪；optimize 的"消孔优先"曾把它们当冗余拆掉。
- **A2e fabChecklist 盘中孔 VIPPO 行**：过孔落在 SMD 焊盘铜内 → 新增
  人工确认行"需树脂塞孔+电镀盖帽，否则回流吸锡；Ø≥0.3mm 或指定树脂
  塞孔工艺"。此前全引擎无 VIPPO 感知（探索确认）。

### 如实撤销的三项（A1 之后不再需要）
- **A2a 盘内过孔折扣**：padViaCost=viaCost×0.25 → 实测 BGA **33→43（+10）**、
  过孔 80→**92**（+12）——A1 的半径修正已打开足够通道，折扣反而让
  布线器多打 12 颗不必要的盘内孔挤占底层。撤销。
- **A2b 口袋触发强制盘内孔**：A* 的过孔邻居（kind=1, cur±NC）在 A1 的
  半径修正下已自然实现盘内孔（viaLegal 对 same-net 焊盘放行）——口袋
  触发不再必要。
- **A2c 排序逃逸深度**：同理，A1 后布线器自行找到盘内孔路径，排序
  变化会破坏 search-baseline 但收益为零。

### 实测
- BGA-64：DRC 33 持平、过孔 80 持平——A2d 保护的 19 颗盘内孔未被
  optimize 拆除
- fabChecklist 正确报出"盘中孔（VIPPO）19 颗（焊盘 19 个）"

### 验证
228 node:test + 全量套件 0 失败（search-baseline 二次重定：A2d 改变
optimize 行为）；独立几何审计 6/6；一致性审计 17/17；全板几何审计
零重叠；Fable 三板不退步。

## 0.13.16（2026-11-14）—— A1：过孔影响半径修正（BGA DRC 138→33）

### 根因（探索+实测双确认）
`rebuildViaInf` 的过孔影响半径 = `viaOuter/2+clearance+max(maxTrackW/2, viaOuter/2)`
= **max(DRC via-trace, DRC via-via)**。这个 max 对**过孔落点**是必要的（via-via
间距），但对**异网走线**在 (via-trace, via-via) 带内过度封锁——BGA-64 的
0.38~0.53mm 带正是内圈球的逃逸通道，封死它 = 138 个 DRC 的主因。
（0.8mm 球距点阵上 0.53 圆盘几乎盖满平面。）

### 实现：影响区拆成双口径
- **viaInf（走线口径）**：`sqrt(D_trace² + grid²/2)`，其中
  `D_trace = viaOuter/2+clearance+maxTrackW/2`。余量项 = 相邻格连线对 DRC 盘的
  最大弦矢差——格心距 ≥ radiusT 的相邻格连线，最近点距过孔心 ≥ D_trace
  （无此余量时对角相邻格的连线可切入 DRC 盘 0.02~0.12mm，n142 实测 +2）。
  `passable` 消费——挡异网走线。
- **viaInfV（过孔口径）**：`viaOuter+clearance`（DRC via-via，点对点精确值）。
  `viaLegal` 消费——挡异网过孔落点（拆分后必须补上，n150 单半径实测 +3 过孔间距）。
- 并行镜像（exportShared/adoptShared）同步双图。

### 位级守门的有意打破（阶段三以来首次）
本提交**有意改变默认布线行为**：search-baseline 重定 15 fixtures（原因：影响
半径修正改变协商可达性）、A/B 位级对拍不适用。替代质量门：
- **批量前后对比**（`.scratch/batch-quality.mjs save/compare`，70 项目
  routeBoard 全新布线，maxIter 20）：DRC 总变化 **-22**、连通总变化 0、
  **零退化**（n142/n150 的单半径退化已消失）
- 全板几何审计零重叠（51858 段-焊盘对）
- Fable 三板不退步：+4/+6/+4，DRC 9→7 / 7→6 / 8→5

### 实测
| 场景 | 旧公式 | 双口径 |
|---|---|---|
| BGA-64 (n71, 2 层) | DRC 138, over 86 | **DRC 33, over 23**（-77%） |
| n142-rot16 (viaOuter 0.8) | DRC 3 | DRC 3（拆分后单半径曾 +2，弦矢余量修复） |
| n150-4layer-hs (viaOuter 0.5) | DRC 0 | DRC 0（单半径曾 +3 过孔间距） |

BGA 分项：间距冲突 23 + 走线间距 10，**无过孔间距**——viaInfV 守卫生效。

### 验证
228 node:test + 全量套件 0 失败；search-regression 16/16（重定后）；
全板几何审计零重叠；Fable 三板不退步；批量零退化。

### 注意
`optimize()` 的"消孔优先"排序与 viaCost=15 未动——盘内孔策略包（折扣/
口袋触发/排序/保护）在下一提交（A2-A6）。

## 0.13.15（2026-11-13）—— room-gate v3：协商历史代价（crossHist）+ BGA 边界定案

### 实现：PathFinder history cost 的连续空间对应物
软借道落盘后，把该网新路径与异网铜的**每个违规段中点**计入 `crossHist`
（0.25mm 量化格 × 层，跨轮保留、跨网共享）。后续网在同格位借道时，
惩罚深度 += 争议次数 × `shapeHistScale`（缺省 8mm/次）——**同点位越被
争夺越贵**，迫使网摊开到未被争夺的缝隙。这是 PathFinder history cost
语义在压缩坐标图上的移植。

### 实测（两个方向都如实记录）
- **Fable 三板不退步**：+4/+6/+4、DRC 9→7 / 7→6 / 8→5 全保持；
  全板几何审计零重叠；批量回归 5 项全过
- **BGA-64 无改善**：DRC 138→**140**（+2），30 次尝试仅 1 次接受。
  历史代价让网避开了争议点，但**避开之后没有好路可走**——问题的
  根不是协商顺序，而是**需要扇出优先路由**（fanout-first：先给每个
  内圈球分配逃逸路径，再布其他网——Freerouting BatchFanout 语义），
  那是独立的大项。

### BGA 边界定案（三轮诊断的收敛）
1. 0.13.12 诊断：违规 74 对集中 22 格、Top10 占 71.6%——争夺假设成立
2. 0.13.13 算术：内圈 15 网 vs 外圈缝容量 28（54% 占用）——容量够
3. 0.13.15 实验：历史代价 + 软 Prim 都不能收敛——**缺的是扇出优先
   的整体规划**，不是增量协商能解决的
→ BGA-64 的 2 层基线（DRC 138）已优于任何协商态；`FANOUT_TIGHT`
建议（加层/减小线宽）是当前工具能给用户的正确指引。

### 验证
228 node:test + 全量套件 0 失败；A/B 位级 35/35；独立几何审计 6/6；
一致性审计 17/17；全板几何审计零重叠（51858 段-焊盘对）；
硬路径干净（无软接入、双跑一致）。

### 边界（如实）
- crossHist 跨轮保留不衰减（maxRounds=3 内可接受；更长轮次需 PathFinder
  式衰减 ×0.5/轮，暂无场景）
- BGA 扇出优先路由（BatchFanout 对应物）未实现——独立大项
## 0.13.14（2026-11-13）—— 批量普适性回归（70 项目）+ target 判据补全

### 批量实测（首次跨 70 项目验证形状补线）
`projects/round11/out`（50）+ `projects/round10/out`（20）：

| 指标 | 结果 |
|---|---|
| 有失败网/违规的项目 | 7 / 70 |
| 连通提升 | 1 个（p01-555-tiny 15→17/26） |
| **DRC 改善** | **5 个**（p01 16→15、p10-grid-08 4→1、p26 1→0、p27-cnc 15→13、n148 2→0） |
| 变差 | **0** |
| DRC 总变化 | **-9** |
| 耗时 | 中位 3ms / 最大 11.8s（全绿板直接 no-failed-nets） |

**关键结论**：round11/round10 的板子在栅格阶段已接近全绿（70 个里只有 7 个有问题），
形状补线的价值场景是**高密度/大网/真实 4 层板**（Fable 三板、BGA-64），
而非这些小规模生成板。但即便在这 7 个里，5 个的存量违规被定向消除——
**p10-grid-08（4→1）与 p27-cnc-shield（15→13）是"已全连、纯消违规"的典型**。

### target 判据补全（批量回归抓出的缺口）
`p43-single-layer` 与 `n148-dual-domain` 的违规是**"间距冲突"/"走线间距"型**
（走线互撞），消息里没有"焊盘 X"——旧判据只从焊盘正则提网，抓不到 → `rounds=0`
静默跳过。补：解析消息里的 `(x, y)` 坐标，反查该处附近的网（走线段距离 ≤ 半宽+
间距，或过孔距离 ≤ viaOuter+间距）。

效果：DRC 改善项目 **4→5**、总变化 **-7→-9**（n148 从 2→0）。

### 新增 tests/shape-batch.test.mjs（5 项常驻回归）
1. 项目集非空（回归有效性前提）
2. **绝不劣化**：70 项目补线后连通不降、DRC 不增
3. **有失败网必须实际跑过**（rounds>0，不得静默跳过）
4. 已全绿项目如实不动作（no-failed-nets 契约）
5. **DRC 改善证据**：至少 3 个项目受益且总变化为负（防修复轮静默失效）

### 验证
228 node:test（+5 批量）+ 全量套件 0 失败；A/B 位级 35/35；
独立几何审计 6/6；一致性审计 17/17；全板几何审计零重叠（51858 对）。

## 0.13.13（2026-11-13）—— 阵列扇出容量检查（advise FANOUT）+ 两次结论修正

### 新增：`advise` 的 FANOUT / FANOUT_TIGHT
几何算术判定阵列（BGA/QFN 类）的逃逸可行性：
- 缝宽 = 球距 − 球径；每缝可穿 ⌊缝宽 / (线宽+间距)⌋ 条线
- 外圈缝数 ≈ 2(nx+ny) − 4；容量 = 缝数 × 每缝条数
- **缝宽 < 需求** ⇒ `FANOUT`（prio 0）：物理上无法从缝中引出任何线
- **内圈独立网数 > 容量** ⇒ `FANOUT`（prio 0）：物理容量不足
- **占用 > 50% 且 <4 层** ⇒ `FANOUT_TIGHT`（prio 2）：容量够但分配难

### 两次结论修正（本轮诊断的价值）
1. **「2 层板 BGA 余量不足」不准确**：BGA-64 内圈只有 **15 个独立网**、
   容量 **28**（占用 54%）——**容量够**。此前的"余量不足"判断是错的。
2. **真正的问题是分配**：15 个网争 28 条缝本该排得开，但 PathFinder 不知道
   "缝隙是稀缺资源"，会随机分配导致互相挤占。`only` 的整区/整带禁入都失败
   （实测 DRC 138→136 / 138→168），因为外圈 19 个 GND 球本身就需要穿行。

### 4 层对照（验证内层是有效解）
同一 BGA-64 改 4 层（grid 0.25）：DRC **138→108**（-30），过孔 43——
内层确实能分流约 22% 的违规。这是 `FANOUT_TIGHT` 建议"加层"的实测依据。

### 实测
- `advise` 对 BGA-64 正确输出 `FANOUT_TIGHT`（占用 54%，2 层板）
- 4×4 宽松阵列（33% 占用）不报——无假阳性
- 缝宽不足场景（pitch 0.4/ball 0.35 ⇒ 缝 0.05）正确报 `FANOUT` prio 0

### 验证
223 node:test（新增 5 项 FANOUT 建议回归）+ 全量套件 0 失败；
A/B 位级 35/35；独立几何审计 6/6；一致性审计 17/17；内联 vm 解析通过。

### 边界（如实）
"容量够但分配难"目前只能**建议**（加层/减小线宽），布线器本身仍不会做
最优缝分配——那需要把外圈缝当作一等资源参与协商，是下一阶段的实质工作。

## 0.13.12（2026-11-13）—— 多网通道属主（only）+ 抓出坐标轴降级阶梯的重大缺陷

### 本轮最大发现：坐标轴降级阶梯的 return 缺失（潜伏 bug）
深度检查中发现 `shpBuildAxes` 的降级阶梯两个 `for(const t of cands)` 循环
**丢失了 return 语句**（`if(...<=CAP) return t;` 的 return 被删）——意味着
**所有形状布线都在"只有窗口四边 + 焊盘"的退化图上跑**，障碍边界细化坐标
全部失效。这就是 BGA 长期 no-path 的真因之一（此前误判为"轴抽稀杀通道"）。

修复后：fable-01 的 DRC 从 9→8 改善到 **9→7**，连通不变（+4/+6/+4 保持）。

### 多网通道属主（`keepouts[].only`）
`only: ['网名', ...]` ⇒ 该区域**只允许**这些网穿行，其余网视作硬障碍。
用途：BGA 阵列这类逃逸瓶颈区，把窄缝通道留给需要逃逸的信号网，禁止
GND/V33 在阵列内穿行抢占（诊断实测：阵列 5.6×5.6mm 内挤了 510 条走线段，
GND 占 111、V33 占 84）。

与 `scope`（class keepout：对异类阻挡、本类自由）语义不同，独立字段；
两者可并存，统一由 `shpKeepoutBlocks()` 判定。

### 立项诊断（BGA 违规热点，假设验证）
74 个违规对集中在 **22 个 2mm 格**，Top10 占 **71.6%**，**100% 落在 BGA 区域**
（半径 12mm），14/15 个网卷入——"多网争夺少数窄缝"假设成立。

### 实测边界（如实）
- Fable 三板：+4/+6/+4，DRC 9→7 / 7→6 / 8→5（fable-01 因阶梯修复多降 1）
- BGA-64 加 only 约束：DRC 138→**136**（仅降 2）——**未达预期**。原因：
  GND/V33 在阵列内有 26/12 个球，整区禁入会让它们连不上自己的球
  （GND 变 16/37）。"允许访问自己焊盘但禁止穿行"的细语义在压缩图上需要
  额外的焊盘内连通构造，实测复杂度不抵收益，**留档为后续项**。

### 验证
218 node:test（shape-route 21→24，新增坐标轴阶梯与 only 语义回归）
+ 全量套件 0 失败；A/B 位级 35/35；独立几何审计 6/6；一致性审计 17/17；
全板几何审计零重叠（51858 段-焊盘对）；内联 vm 解析通过。

**防护力实证**：移除阶梯的 return 再跑新增测试 → 立即失败并精确指出
退化后的轴（`0,4.85,5,5.15,10,14.85,15,15.15,20`——只有焊盘与窗口坐标）。

## 0.13.11（2026-11-13）—— 文档口径同步 + 一致性审计加数字漂移检查

### 修正的文档漂移（0.13.9 纠正数字后未同步）
README 与能力白皮书仍写着 0.13.8 的假绿数字：
- `+4/+6/+6` → **`+4/+6/+4`**（fable-03 的 +2 来自重叠路径）
- `DRC 9→9` → **`9→8`**（fable-01）
- `BGA-64 真饱和` → **可达性已破局但 0 接受**（0.13.7 算术判定推翻"真饱和"：
  球隙 0.35 > 需求 0.23、盘内孔可行；协商能全连通但带 4~74 擦边违规被回滚）

### 一致性审计扩到 17 项（新增 2 项，删 1 项过时项）
- **文档数字与实测一致**：断言 README/白皮书含 `+4/+6/+4` 与 `9→8`，
  且**不得含** `+4/+6/+6`、`9→9 / 7→6`（假绿数字回归即失败）
- **「BGA 真饱和」不得作为结论**：若文档提该词，必须同时说明已被推翻
- CHANGELOG 版本链检查扩到 0.13.10；删除已被第 7/8 项覆盖的过时项（5b）

### 防护力实证
把 `+4/+6/+4` 手工改回 `+4/+6/+6` 再跑审计 → **立刻报错**
（"README 未写正确的 +4/+6/+4"）。文档漂移从此是机器可查的。

### 验证
215 node:test + 全量套件 0 失败；一致性审计 **17/17**。

## 0.13.10（2026-11-13）—— 常驻全板几何审计（假绿的防复发机制）

### 新增 tests/shape-geometry.test.mjs（7 项，已入 npm test）
把 0.13.9 抓假绿时用的临时脚本固化为常驻回归。审计用**文件内独立的几何
原语**（不复用被测实现），对真实板做**全板逐对**检查，判据只有一条硬线：
异网铜之间 gap≤0（重叠=短路）。覆盖六面：

| 面 | 判据 |
|---|---|
| 段-段 | 同层、异网、segSegDist ≤ 0 |
| 段-焊盘 | 异网、层匹配、segmentPadDistance ≤ 0 |
| 过孔-焊盘 | 异网、跨度与焊盘层相交、pointPadDistance ≤ 0 |
| 过孔-走线 | 异网、层在 span 内、segDist ≤ 0 |
| 过孔-过孔 | 异网、span 相交、中心距 ≤ 半径和 |
| 层范围 | 路径点 l 必须在 [0, L) |

另含三项自检：合成 4 层+盲埋孔板零重叠、**人为构造重叠必须被抓出**（验证
审计本身有效）、同网重叠不报（同网铜可自交）。

### 防护力已实证
把引擎回退到 0.13.8 再跑本审计：**准确抓出 fable-01 与 fable-03 的重叠**
（正是假绿的两块板），fable-02 通过（它本来就干净）——证明这套断言不是
能过而是有防护力。

### 为什么必须常驻
0.13.8 当时所有守门都过了：A/B 位级只测默认路径、独立几何审计只测随机
小场景、全量回归没有真实板的重叠断言。假绿是从真实板全板审计这个
**当时不存在的视角**里抓出来的——现在它常驻了。

### 验证
215 node:test（+7）+ 全量套件 0 失败；A/B 位级 35/35；独立几何审计 6/6；
一致性审计 16/16；内联 vm 解析通过。审计耗时 18.7s（三板各 ~6s，可接受）。

## 0.13.9（2026-11-13）—— 深度检查轮：假绿纠正（0.13.8 的 +6/+6/+6 有违规路径）

### 抓出的问题（跨模块深度检查）
1. **跨轮残留路径导致铜-铜重叠**：多轮协商中 merged 保留着**上一轮轴**算出的
   路径，与本轮障碍集不兼容——fable-01 的 3V3 段与 U2-14 焊盘 gap=0（端点
   甚至不在当前坐标轴上）、I2S_DIN 与 U2-2 同理；fable-03 的 CC1 与 J1-B7。
2. **DRC 漏报该类重叠**：DRC 的走线-焊盘检查按段**首命中**就 break，这两段
   的首命中是别的焊盘 → 重叠被掩盖，连通数虚高 = **假绿**。
3. 外层循环 5 处状态缺陷：repaired 集跨轮不清（板面变了却不允许重试）、
   防抖按 netId 反查错误（同网名跨轮污染）、熔断判据漏更差分支、
   cascade 的 kept 标记靠 notes 反查、roundApplied 死代码。

### 修复
- **shpPathClear 落盘前闸门**：整条路径逐段精确复核，任何 gap≤0 的铜-铜
  重叠一律拒绝该接入（只拦短路级，不拦擦边——擦边由接受准则裁决；
  禁布区/板边在压缩图上已正确表达，不重复查）
- 外层循环状态 5 项修复；熔断改不优于即停

### 假绿纠正（如实）
| 板 | 0.13.8 声称 | 0.13.9 真实 | DRC |
|---|---|---|---|
| fable-01 | +6（88/95） | **+4（86/95）** | 9→8 |
| fable-02 | +6（101/112） | +6（101/112） | 7→6 |
| fable-03 | +6（105/110） | **+4（103/110）** | 8→5 |

fable-01 与 fable-03 各有 2 个连通来自**重叠路径**（0.13.8 的假收益）。
纠正后全板**零 gap=0 重叠**（46704 段-焊盘对全查）。

### 验证
208 node:test + 全量套件 0 失败；A/B 位级 35/35；独立几何审计 6/6；
一致性审计 16/16；内联 vm 通过；硬路径干净（无软接入、双跑一致）。

## 0.13.8（2026-11-13）—— room-gate v2：外层收敛循环

### 契约
协商落盘 → 修复轮 → 级联裁决**改变板面**后，被借道的网在新板态下可能获得
新的可达性/违规归属——单轮留下的收益是局部的。外层循环（shapeRounds，缺省 3）：
每轮 target 基于**当前板态**重算（上轮回滚的网障碍变了可再试、被借道的网
违规归属更新），轮末全板裁决 [-drcErrors, connected] 无改进即熔断；
连续两轮进级联又全回滚的网剔除（防抖，防 A/B 互换振荡）。

### 实测
- **fable-01：+6（88/95），DRC 9→7**——单轮 +5/DRC8，多轮让上轮被裁剪的
  借道在新板态下重新裁决成功（耗时 30s，多轮的代价）
- fable-02：+6（101/112），DRC 7→6（两轮后熔断，与单轮持平）
- fable-03：+6（105/110），DRC 8→5（恢复 0.13.6 水平——0.13.7 的 -2 是
  单轮顺序敏感性，外层循环消除）
- BGA-64：两轮 22 网尝试后熔断，0 接受如实保持——擦边违规 48~74/网超出
  单网借道+修复可消的范围；完整收敛需**多网联合借道规划**（room-gate
  门图语义，下一阶段）

### 三板累计（0.13.0 → 0.13.8）
连通 82→88 / 95→101 / 99→105（+6/+6/+6），DRC 9→7 / 7→6 / 8→5（-2/-1/-3）

### 验证
208 node:test（shape-route 19→21）+ 全量套件 0 失败；A/B 位级 35/35；
独立几何审计 6/6；一致性审计 16/16；内联 vm 解析通过；跨模块矩阵 24/24。

## 0.13.7（2026-11-13）—— room-gate v1：软 Prim（协商顺序的可达性修复）

### 立项诊断（推翻两条旧定性，全有复现脚本）
- **「BGA 真饱和」被推翻**：算术判定 0.8 球距下球隙 0.35mm > 需求 0.23mm、
  盘内孔可行（0.3>0.2）、外圈逃逸 23mm——通道存在；12b 洪水填充测得的
  「逃逸域 0.08%」是**栅格协商已把通道占光后**的状态，不是空间不足。
- **「大网必然失败」被推翻**：fable-01 GND 40 盘逐盘孤立软布线全部成功
  （零过孔）——失败纯粹是 Prim 顺序：先接入的盘占掉通道，后接入的盘
  硬模式找不到锚点。
- **收敛后的缺口 = 协商顺序**，不是房间代数——room-gate v1 因此不是
  凸房间图，而是 PathFinder enterOK 的 Prim 对应物。

### 实现：软 Prim
shpRouteNet 的 Prim 循环：硬 A* 失败（或重布连通不优于现状，含相等）→
软 A* 接入（擦边记惩罚）。**gap=0 红线扩展到走线段**（0.13.6 只挡了过孔）
——软协商允许擦边借道，绝不允许短路。
shapeMaxPads 12→40（护栏语义改为纯耗时保护）。

### 实测
- fable-01：+5（87/95），DRC 9→**8**（大网 GND 可尝试后多赚 1 连通 + 1 DRC）
- fable-02：+6（101/112），DRC 7→**6**
- fable-03：+4（103/110），DRC 8→**5**（GND 全连路径带 3 违规被 DRC 优先
  裁决正确回滚——连通 -2 是裁决代价，两版本 DRC 相同）
- **BGA-64：可达性破局**——TCK/TMS/TDO/V33/GND 协商全部从 no-path 变为
  全连通（此前源焊盘逃逸域是死的）；但借道带 4~74 擦边违规，DRC 优先
  裁决如实回滚（0 接受、DRC 138 不变）。通道分配（谁让谁）需多网联合
  协商收敛 = room-gate 完整版。

### 验证
206 node:test（shape-route 17→19）+ 全量套件 0 失败；A/B 位级 35/35；
独立几何审计 6/6；一致性审计 16/16；内联 vm 解析通过。

## 0.13.6（2026-11-13）—— 12b 第三阶段：拆-重布级联 + 裁决口径定案

### 级联机制
协商借道产生净违规时不再一律拒绝：借道路径**先落盘**，修复轮对卷入网重布，
之后**子集枚举裁决**（候选 ≤2^n，n≤3）取全板最优子集——借道候选之间可能
互相违规，逐个裁决存在合成谬误（fable-01 实测：两个借道单独看各 +1 连通，
合在一起互相违规 DRC +5）。

### 裁决口径的两个定案（都由实测反推）
1. **软协商的红线**：gap=0（真重叠/短路）任何模式硬拒——soft 只允许擦边
   借道（0<gap<lim）记惩罚，不允许打穿异网铜（fable-01：借道过孔打在
   异网焊盘中心，viaOk 被 soft 分支放行）。
2. **字典序反转**：裁决键从 [连通, -违规] 改为 **[-DRC error, 连通]**——
   deliver 门禁 errors=0 是可交付硬线，未连通只是 partial；1 个连通焊盘
   不值得换 4 个 DRC。同时裁决计分从 netGeoVio 换成 checkDRC 权威计数
   （自研三查与 DRC 完整家族的口径差追不净，权威口径免打地鼠）。

### 实测
- fable-01：+4，DRC 9→9（互相违规的借道组合被子集裁剪正确回滚）
- fable-02：+6，DRC 7→**6**（借道+修复的组合净收益为正被保留）
- fable-03：+6，DRC 8→**5**
- BGA-64：0 接受如实保持（擦边借道在 DRC 优先裁决下全部回滚）

### 验证
204 node:test（shape-route 15→17）+ 全量套件 0 失败；A/B 位级 35/35；
独立几何审计 6/6；一致性审计 14/14；内联 vm 解析通过。

## 0.13.5（2026-11-13）—— 12b 第二阶段：拆-重布修复轮

### 机制
协商/补线主循环之后，新增**修复轮**（最多 shapeRepairPasses=3 轮，零改进熔断）：
- **触发**：全板段-段违规 OR 逐网 netGeoVio 总和 >0——后者覆盖段-焊盘/过孔类
  违规（auditGeometry 只查段-段；Fable-01 的违规全是段-焊盘型，首个版本的
  触发条件漏掉它们，repairTried 恒 0）
- **归属**：netGeoVio(net)>0 的网进入候选（已修复过的剔除，防 A/B 互换违规死循环）
- **重布**：硬约束形状布线（修复轮禁软借道——目标是消违规不是换违规）
- **接受**：净违规**严格下降** 且连通数不降，否则回滚

### netGeoVio 提升到函数作用域
原定义在协商 forEach 体内，修复轮引用是作用域错误（恰因触发条件先 break
而未爆 ReferenceError——潜伏 bug，靠 repairTried=0 的异常信号抓出）。

### 实测
- **fable-02：DRC 7→6；fable-03：DRC 8→5**——栅格协商的**存量**违规被真实消除
  （修复轮是消除存量违规的第一个机制；此前栅格引擎只能靠整板重跑碰运气）
- fable-01：修复轮试 2 网 0 成功（U2-6/7 附近通道不足），如实保留原状 9 不变
- BGA-64：0 接受如实保持（22s 里约 19s 用于对卷入违规网完备尝试协商——
  正确行为的代价）；已连通且零违规的网加了预检跳过

### 验证
200 node:test（shape-route 13→15）+ 全量套件 0 失败；A/B 位级 35/35；
独立几何审计 6/6；一致性审计 14/14；内联 vm 解析通过。

## 0.13.4（2026-11-13）—— 12b 第一阶段：BGA 诊断 + 软障碍协商

### 诊断：BGA-64 no-path 是真饱和（洪水填充定案）
推翻「轴抽稀杀通道」假设：TCK 图未抽稀（13.3 万节点<40 万预算）、源焊盘 212
条出边、A* 5ms 穷尽全图；洪水填充从源焊盘仅可达 113/133532 节点（0.08%），
窗口扩到 20mm 全 null——**源焊盘被 BGA 阵列已布铜围死**，不是量化问题。

### 软障碍协商（PathFinder enterOK 的形状侧对应物）
- shpBuildGraph(soft)：异网铜违规边不删除、记违规深度惩罚（mm 口径）；
  A* 代价 += penScale×深度（缺省 40：1mm 侵权≈40mm 绕行——偏好绕行，
  只在绕行走不通时借道）。禁布区/板边/孔边距仍硬墙。
- 接受准则 = 对称三查净违规（段-段 + 段-异网焊盘 + 该网过孔 vs 异网焊盘/
  走线/过孔，含 span 判定），before/after 同函数存量抵消；violation 增加
  必须有 ≥ 等量连通增益。

### 三个盲区（被实测 DRC 分项抓出，教训留档）
① 单网传 auditGeometry 恒 0（借道违规 9→24 被判 0→0）
② 过孔类违规不在段审计（借道换 3 盘引入 5 个过孔 DRC）
③ 段-异网焊盘不在段-段审计（残余 0.11<0.15 漏报）
「连通变多+审计 0」不等于安全——审计口径必须与 DRC 全部违规家族对齐。

### 实测
fable-01/02：+4/+6（协商路径净违规 1~2 个，正确拒绝——盲区版本的
+7/+10 是假象）；fable-03：**+6（105/110），DRC 8→7**（CC2 借道净违规
0 被正确接受）；BGA-64：0 接受如实保持（协商路径违规 4~29 全拒，
真饱和板需拆-重布，留 12b 下一阶段）。

### 验证
200 node:test（shape-route 10→13）+ 全量套件 0 失败；A/B 位级 35/35；
独立几何审计 6/6；一致性审计 14/14；内联 vm 解析通过。

## 0.13.3（2026-11-13）—— 深度检查轮：三修复 + 六回归（全部由审计驱动）

### 修复（每个都有独立复现脚本）

1. **broadcastAdopt 对死 worker 白等 60s（延迟 bug，0.13.2 引入）**：worker 被剔除后
   仍每轮向它发 adopt 并等满超时——exit 事件不可靠（unref 计时器下进程可能先于
   事件退出），一旦有 worker 死亡，后续每轮迭代都多等 60s。修复：已剔除的
   worker 不再发 adopt。
2. **mergePolicy='better' 的失效字典序键**：routeList 产物没有 overuse 字段，
   `(r.overuse||0)` 恒 0，第二键失效。修正为 [failed, viaSet, len]（failed 是
   硬冲突口径，与 routeScore 的连通数=total-failed 对齐）。
3. **computePour 的过孔 span 盲区**：过孔不按层跨度参与铜皮——异网埋孔在
   span 外的层也被挖空（假避让），本网埋孔在 span 内的层未 seed。修复：
   span 不含本层的过孔既不 seed 也不挖空；通孔照旧。
4. **buildSVG 把埋孔画进顶层/底层视图**：span [1,2] 的孔出现在两个外层组
   （图纸出现不存在的孔）。修复：只画 span 触及的外层组；孔径用逐孔
   outer/drill（微孔渲染保真）。

### 明确不动的（语义核对后确认正确）
- renderBoardPixels 画全部过孔（俯视合成图，AI 目检需看到全部物理孔；分层
  语义由 SVG/Gerber 承担）——已加注释
- teardropPolys 按走线段层归属（实测泪滴正确挂在 span 内的 1/2 层）
- IPC-356 VIA 记录 PA00（通孔口径，0.13.1 已如实声明为格式限制）

### 新增回归（hdi.test.mjs 17→23，iter-parallel 7）
- pour span 四方向：本网 seed@span 内 / span 外无铜 / 异网避让@span 内 /
  span 外不避让 / 通孔向后兼容
- SVG span 三向：埋孔不出现 / 盲孔只出现在触及的外层组 / 通孔+逐孔孔径

### 复核（防假绿）
- **Fable 三板增益在最终引擎上成立**：+4/+6/+4，补线冲突 0；
  fable-03 DRC 实为 8→7（USB_DP/DM 各再通 2 盘 + 自身违规消除），
  报告 8→8 系引用旧口径，已更正
- CLI 三旗端到端：--shape-patch / --iter-waves 3 --shard 4 全通；
  畸形值（--shape-window abc / --shard 99 / --iter-waves 0）干净拒绝
- manual 走线的过孔 DRC 审计正常（过孔-焊盘间距报出）

### 验证
- 全量回归 **197 node:test** + 80 核心 + 48 书籍 + 17 CLI + 39 模糊
  + 7 深度校验 + 22 优化锁定，**0 失败**
- A/B 位级 35/35；独立几何审计 6/6；一致性审计 14/14；内联脚本 vm 解析通过

## 0.13.2（2026-11-13）—— 阶段三 #13 多核协商分片 + #14 推挤式交互（UI 层）

### #13：空间分片 + 确定性合并
- **`--iter-waves N`** 接通 CLI（引擎早有 `iterWaves`，此前文档写了但未接线）：
  队列切 N 波，波间提交可见（部分 Gauss-Seidel），W=1 即原 Jacobi 口径。
- **`--shard N`** 空间分片：网按 bbox 归属**面积重叠最大**的分片（唯一属主，
  跨分片网不重复布线），分片组 round-robin 分给 worker——空间相邻的网在同一
  worker 内串行可见，冲突立刻暴露而不是靠多轮协商收敛。
  `shard<2` 或分片不可用 → 原 LPT 路径（位级不变）。
- **`commitRoutes(mergePolicy='better')`**：同一网多份结果按字典序
  （连通→冲突→过孔→线长）取优，且**按 net.i 升序提交**——与 worker 完成次序
  无关（确定性）。并行驱动已启用；串行路径不传该参数（位级不变）。
- **adopt 失败剔除 worker**：此前 `broadcastAdopt` 不检查返回值，worker 会带着
  上一轮快照继续 route，产出对陈旧拥塞状态的结果（**静默质量污染**）。
  现在未确认即标记 `alive=false`，其份额由主线程**按 id 升序确定性补跑**。

### #14：推挤式交互（UI 层，不做 hull/绕壳）
- **实时碰撞反馈**：手动布线预览逐段检查异网焊盘/走线/禁布区/板边
  （与 DRC 同口径，bbox 预筛，不做全板两两），冲突时预览描红 + 冲突点十字。
- **提交前拦截**：`finishDraw` 做一次全段检查，冲突则拒绝提交并说明原因，
  而不是写进设计再等 DRC 报错。
- **历史快照含 result**：此前只存 design，撤销一次手动操作会 `app.result=null`
  丢掉全部自动布线（用户要重跑数分钟）。现在 `{design,result}` 一并入栈。
- **自动走线可命中**：`hitTest` 纳入 `result.nets[].paths`（此前只能命中
  pad/manual/keepout），Delete 时如实提示改走「清除该网」。
- **worker 陈旧 model 检出**：设计指纹（焊盘/手动走线/禁布/网宽/板幅）与建会话
  时不一致 → `reroute` 返回 `stale`，UI 提示「需整体重布」，不再用旧障碍集
  产出一个看起来成功的结果。手动走线提交后也会主动作废会话。

### 实测（小板基准，maxIter 12）

| 板 | 串行 | K2 W2 S0 | K2 W2 S4 | K4 W2 S0 |
|---|---|---|---|---|
| LED 25 盘 9 网 | 299ms | 451ms | **315ms** | 405ms |
| MCU 34 盘 11 网 | 586ms | 1118ms | **500ms** | 4193ms |

**结论**：小板上 worker 启停开销淹没并行收益（K4 最差）；**shard 显著改善**
（MCU 1118→500ms，接近串行）——分片让同区域网在同 worker 内串行，减少了
跨 worker 的无效竞争。这支持「空间分片优于纯时间切批」的判断。

### 验证
- 全量回归 **191 node:test**（新增 3 项 shard/merge）+ 80 核心 + 48 书籍
  + 17 CLI + 39 模糊 + 7 深度校验 + 22 优化锁定，**0 失败**
- **A/B 位级 35/35 全等**（串行路径零改动）
- index.html 四个内联脚本（engine/ui/worker-client/worker）全部 vm 解析通过

### 边界（如实）
- **不做 hull/绕壳推挤**：源码研读已论证栅格模型下收益成本比低；本轮交付的是
  UI 层碰撞反馈 + 事务化撤销 + 陈旧 model 防护。
- 分片是**软亲和**（只改批内顺序与分配，不改 A* 与接受准则），因此不保证
  digest 与串行一致——这是并行模式的既有语义（`iterWorkers` digest 独立于串行基线）。
- 浏览器端 Playwright 回归未在本环境执行（无 Playwright），UI 改动以
  vm 解析 + 静态符号检查替代；真机交互需人工复核。

## 0.13.1（2026-11-13）—— 阶段三 #15：HDI 盲埋孔与激光微孔

### 数据模型（向后兼容）
- 过孔记录扩展可选 `layers:[from,to]`（盲/埋孔）+ `drill`/`outer`（逐孔尺寸）；
  **无 span = 通孔**（贯穿全部层）——0.13.0 之前的全部数据与导出保持不变。
- `normalizeResult` 校验 span 合法性（端序、层范围、drill≤outer），畸形输入干净报错。
- 手动换层点的 span = 相邻两层（`manualRouteEntries`）；`reliability` 的 deepEqual 同步。

### DRC span 化（关键正确性）
- 过孔-焊盘 / 过孔-走线 / 过孔-过孔间距：只在**层跨度相交**时比较
  （不相交则物理上不在同一层——同 XY 的通孔与埋孔合法，不报间距）。
- 孔边距（同网不豁免）：span 不相交的孔跳过；`manufacturingHoles` 合并键含 span
  （否则同 XY 同直径的埋孔与通孔会被吞掉一枚）。
- 新增**激光微孔**检查：钻孔 ≤0.10 按 HDI 口径——环宽 ≥0.075、**只能跨相邻层**
  （深径比 1:1，RTF2 p148-155）、低于工艺口径给 warn。`JLC.microvia` 新增工艺行。

### 导出分层
- **Gerber**：过孔只在其 span 内的铜层闪现（盲埋孔不在外层留铜环）。
- **Excellon**：去重键含 span——同 XY 同直径的埋孔与通孔是两次独立钻孔；
  同一 span 的共位孔仍合并。孔径用逐孔 drill（支持微孔）。
- DFM 过孔孔距用各自实际钻径，并按 span 过滤。

### 验证
- 全量回归 **188 node:test**（新增 17 项 HDI）+ 80 核心 + 48 书籍 + 17 CLI
  + 39 模糊 + 7 深度校验 + 22 优化锁定，**0 失败**
- **A/B 位级 35/35 全等**（通孔路径零改动）
- 独立几何审计 6/6

### 边界（如实）
- **栅格布线器仍只产通孔**：`addVia` 全层标记、`fillDistanceMap` 只走相邻层边。
  本轮交付的是**数据模型 + DRC + 导出**的 span 能力（可读入/校验/交付盲埋孔设计），
  自动生成盲埋孔需要跨层直达边与 TS 尺寸位图，属 #15b 后续项。
- **EasyEDA 导出降级为通孔并如实标注**：该文档格式的 VIA 原语无层对字段，
  不伪造 span。
- IPC-356 的 `PA00` 访问码仍为通孔口径（盲埋孔需按 span 分记录，后续项）。

## 0.13.0（2026-11-13）—— 阶段三 #12：压缩坐标迷宫布线器（形状补线）

### 新能力：`--shape-patch`（补充式，默认关闭）

栅格布线之后，对**仍未连通或有 DRC 间距错误**的网，用**压缩坐标（非均匀）**
重新布线——搜索空间从"均匀栅格的格心采样"换成"障碍边界 ± 需求间距构成的
非均匀坐标轴"，通道宽度由真实几何决定而非栅格步长。

```bash
node ai/pcb.mjs route design.json -o out.json --shape-patch \
     [--shape-window 6] [--shape-nets USB_DP,USB_DM]
```

GUI：左侧「形状补线（失败网）」按钮（有失败网或冲突时才生效）。

### 为什么不做 room-gate（方法论记录）

开工前三份独立代码探索得出：`checkDRC` 本身就是精确连续几何、全部下游只读
`paths[{x,y,l}]`、`rmstTasks` 已是任意坐标 Hanan 网格——**病灶是
`buildModel` 的栅格量化**（`halfClr=clearance+maxTrackW/2`），不是 A\* 范式。
故先验证"量化是根因"这一**可证伪假设**，而非直接移植 1.5k~3.7k LOC 的多边形代数。

### 实测（真实板，基线 DRC 用当前引擎口径重算）

| 项目 | 栅格 | 补线后 | 增益 | DRC |
|---|---|---|---|---|
| ext-fable-01（45×35） | 82/95（86.3%） | **86/95（90.5%）** | +4 盘 | 9 → 9 |
| ext-fable-02（60×35） | 95/112（84.8%） | **101/112（90.2%）** | +6 盘 | 7 → 7 |
| ext-fable-03（55×40） | 99/110（90.0%） | **103/110（93.6%）** | +4 盘 | 8 → 8 |

**假设裁决：验证成立但不充分**——量化确实是**一个**根因（+4/+6/+4 盘，零退步）；
但剩余失败网（跨板长电源网、被密集铜围死的网）需要的是**多轮拆重布协商**，
不是更大的搜索空间 → **#12b 立项依据更新为"单网串行布线在已布满铜的板上无解"**。

### 开发期抓出的三个真缺陷（各有独立复现）

1. **跨界边漏检（契约级）**：轴在 `bbox±R∓ε` 细化，按"坐标下标范围"枚举边会
   漏掉跨出 ε 的那批——它们正是穿过膨胀区的边。改为按**几何区间重叠**枚举。
2. **定长堆越界写**：类型化数组 OOB 写静默丢弃 → 堆序破坏 → A\* 返回 27.1mm
   而暴力 Dijkstra 最优 6.9mm。改为可增长堆。
3. **下滤基准错误**：`pop()` 用已弹出的旧根值当比较基准。修复后 A\* 与暴力
   Dijkstra **逐值相等**（6.900 = 6.900）。

### 验证

- 全量回归全绿（161 node:test + 80 核心 + **10 形状布线** + 48 书籍 + 17 CLI
  + 39 模糊 + 7 深度校验 + 22 优化锁定）
- **位级守卫 35/35 逐位全等**（`node .scratch/opt-ab.mjs`）——默认路径零改动
- **独立几何审计 6/6**（`node .scratch/shape-audit.mjs`，不复用被测代码：
  逐段间距 / 逐孔孔距 / 独立并查集连通数 / 双跑确定性）
- 报告：[docs/深度优化报告-阶段三.md](docs/深度优化报告-阶段三.md)

### 边界

- v1 **只做正交**；45° / any-angle 留 #12b
- **无协商**：一次尝试 + 字典序接受/回滚，不做多轮
- 补线后 `cells` 置空（`computeRatsnest` 走顶点回退）
- 窗口 = 本网焊盘 bbox + `max(4mm, 2·grid)`，跨板长网可能因窗口放弃

## 0.12.1（2026-11-13）—— 深度优化轮：Fable 密度对照实验（假设证伪）+ 三板回滚

### 密度对照实验（假设证伪，方法论记录）
- **假设**：协商失败与布局密度相关——放宽板幅（+5~7mm 各向）应提升布通
- **结果（三板对照）**：01: 82→78、02: 95→95、03: 99→97——**全部持平或略降**
- 附加变量对照：place 迭代 4000→12000、autopcb 轮数 4→6、maxIter 30→80——
  **均不敏感**
- **结论固化**：剩余未连通网（三板合计 37 个）是**协商机制的系统性边界**——
  PathFinder 逐轮 ripup-and-retry 在这些板拓扑下不收敛，与层使用失衡（内2 层
  三板合计仅 10mm 走线）共同指向 **#12 形状布线 expansion rooms**
- 三板已回滚至各自最佳状态（86%/85%/90%）；实验数据与日志留存

### 数字对账（阶段三开工前，如实纠正）
- **发现**：0.12.1 提交时 `projects/ext-fable-0{1,2,3}` 的 `placed/result.json`
  实际是**密度实验的放大板产物**（52×40 / 66×40 / 62×45，连通 82.1% / 84.8% / 88.2%），
  与本文"已回滚至最佳状态（86%/85%/90%）"及 `交付包/manifest.json` 的 99/110 均不一致——
  "声称回滚但未回滚"，属假绿家族（与 0.11.7 的 DRC 字段读错同类）。
- **归位**：按"可复现优先"恢复三份真实最佳产物，今日用 `ai/pcb.mjs drc` 复核：
  01 = 82/95（86.3%，45×35 grid 0.7，即 `placed-auto/result-auto.json`）、
  02 = 95/112（84.8%，60×35，0.12.0 产物）、03 = 99/110（90.0%，55×40，0.12.0 产物）。
- **口径澄清**：`交付包/` 与 manifest 是三板各自的**交付时快照**（含 `--force` 留痕的门禁结果），
  不随后续回滚更新——它不是"当前 result.json 的报告"，引用时按快照对待。
- 密度实验的**结论不受影响**（证伪结论来自同一批对照数据，与本次归位无关）。

### 回归
- 全量回归全绿；A/B 对拍 35/35 全等；案例文档 0.12.1 节

## 0.12.0（2026-11-13）—— Fable 三设备复刻完成（USB 扬声器/语音中枢/手持宠物）

对照 Fable 5.2 三设备（Diode 制造"无需电路修复"），本项目用**自有 AI 工作流**
完成三块 4 层板的**网表→可制造 PCB+真符号原理图** 半程复刻（固件/外壳/声学
不在本项目范围，如实声明）。

### 三设备对照（全部真 LCSC 器件+真符号真封装）

| 设备 | 焊盘/网/组件 | 自动布通 | DRC | 交付 |
|---|---|---|---|---|
| 01 USB 会议扬声器（45×35） | 132/17/20 | 82/95（86%） | 11（7 未连通+4 残留） | 17 件 |
| 02 语音助手中枢（60×35，双麦阵列） | 148/19/22 | 95/112（85%） | 门禁如实拦截 | 17 件 |
| 03 手持电子宠物（55×40，屏+锂电） | 148/24/27 | 99/110（90%） | 门禁如实拦截 | 17 件 |

- 新器件验证：TP4056（C382139 ESOP-8）/WS2812B（C114586 5050）——真封装拉取
- 网表意图修正实录：BOOT 单焊盘（漏按键）→SW1→BOOT；BAT1 环宽 0（盘<孔）→
  盘加大；VBUS/5V 断链（rules 悬空引用拦截器抓出）；SOIC/THT 重叠（布局挤）
- **三板共同结论**：自动布通 85~90% 稳定复现；剩余为协商收敛边界（跨板长网/
  差分对）——#12 形状布线的第三篇实证；所有未达全绿状态经 --force 留痕
  （manifest 保留门禁原始结果，不粉饰）

### 语义修正（0.11.7 携带）
- checkDRC external 同元件豁免（与 spec 对等）——真实封装密距=ground truth
- 铺铜连通语义：全盘入同网铜皮=已接通

### 文档
- 案例 03：[docs/案例-03-Fable复刻-USB会议扬声器.md](docs/案例-03-Fable复刻-USB会议扬声器.md)
  （含与 Fable 能/不能边界对比表：规格→网表→真器件→原理图→PCB 相当；固件/
  外壳/投板验证不在范围）
- 项目目录：projects/ext-fable-01/02/03（design/placed/result/交付包/原理图/渲染）

## 0.11.7（2026-11-13）—— 深度优化轮：DRC 语义两修复 + Fable 假绿纠正

### 两个 DRC 语义修复（Fable 实测驱动）
1. **checkDRC external 同元件豁免**（与 spec 对等）：真实封装密距/重叠=封装作者
   ground truth（TYPE-C A6/A7 同位、ESP32-S3 模块 castellated 沿边 pad 1.5 重叠
   节距 1.27——开源广场/器件库实样坐标）；仅豁免同元件对，异元件仍全查。
   Fable 板 DRC 31→11。
2. **铺铜连通语义**：网内全部焊盘落入同网铜皮=已接通（真实 EDA 同口径——GND 类
   网的连接方式就是铜皮）；部分落入仍如实报错。GND 40 盘中 38 入铜豁免、2 盘真
   未接入如实保留。

### 假绿纠正（教训）
- 此前"Fable 板 DRC 0/0"是**诊断脚本读错字段**（drc 命令的 issues 在 `j.drc`
  里，顶层无 `errors`）——真实状态 31 errors。deliver 门禁一直正确拦截。
- **隔离实验定案**：7 个未连通信号网全部**隔离布通**（USB_DP 5/5 跨板 44mm、
  GND 40/40）——失败非可达性，是协商在全板环境互相挤掉（收敛边界）——#12
  形状布线又一篇实证。最终：86% 自动 + 11 DRC（7 未连通+4 协商残留违规），
  全部如实入 manifest（--force 留痕）。

### 回归
- 全量回归全绿；A/B 对拍 35/35 全等（既有负载无 external 板/无铺铜语义触发）
- 案例文档 0.11.7 节

## 0.11.6（2026-11-13）—— Fable 复刻试点：USB 会议扬声器（案例 03）

Anthropic Fable 5.2（2026-11-09）用 Claude Code 设计三块 4 层板（USB 会议扬声器/
语音中枢/手持宠物，Diode 制造"无需电路修复"）。本项目复刻第一个设备的
**网表→可制造 PCB+原理图** 半程（固件/外壳/声学不在本项目范围）。

### 全链（真实嘉立创器件）
- **BOM 全 API 验证**：ESP32-S3-WROOM-1（C2913201）/MAX98357A（C910544）/
  INMP441（C5438445，库存 0 如实标注）/AMS1117（C6186）/USBLC6（C7519）/
  TYPE-C（C165948）/开关/LED/阻容——真符号+真封装拉取
- **stamp 实例化**（新工具 .scratch/stamp-fable01.mjs）：器件封装实例化+网表意图
  （USB→ESD→MCU、I2S 双设备共享主控时钟、电源树、去耦）→ 132 pads/17 nets/20 comps
- **全链**：spec 0 problems（external 豁免；**rules 悬空引用拦截器抓出 VBUS/5V
  网表意图错误**）→ place → autopcb 4 轮 **82/95（86%）**（USB 差分对+电源加宽）
  → pour GND（6 缝合孔自动、GND 全接入）→ **DRC 0/0** → verify OK → deliver
  17 件（--force 留痕：连通性 82/95 如实入 manifest）→ schem 真符号原理图 → render

### 发现
- **rules 悬空引用拦截实战首秀**：netClass.VBUS 引用已清理的网 → spec 即报错——
  正确抓出 AI 写网表的电源树断链意图错误
- deliver 门禁正确拦截（连通性 82/95）；DRC 计数差异（deliver 31 vs 命令 0）记录待查
- 与 Fable 的能/不能边界对比表见案例 03（布线收尾差距=#12 立项依据；固件/外壳
  不在范围）

## 0.11.5（2026-11-13）—— M1 里程碑达标 + 引擎级连通计数 bug 修复

### M1 达标（路线图阶段一 M1：「20 个 4 层 200-pad 级项目全绿」）
- 盘点：全仓 379 项目中 4 层 ≥200 焊盘仅 1 → **生成器补齐 19 个**（封装家族/
  拓扑/板幅多样化：LQFP144/100/48、QFN、SOIC 农场、WS2812 菊花链 512 盘、
  DIP/排针 THT、0603 农场、广播网、混合工艺）——**19/19 route complete + DRC 0**
  + icebreaker 4 层实测 = **M1 达标**（[M1-报告](projects/m1-4layer/M1-报告.md)）

### 引擎级 bug（M1 生成器首次触发，潜伏至今）
- **`routeNet` Prim 接入的天然连通未落账**：焊盘 cells 与树共享格（pad 间距
  < 格+盘径——真实电路"总线相邻脚同网"常见）时，touching 分支跳过但未把
  cells 并入 net.cells——countConn 判定该网每轮误计失败（connected 恒 0），
  协商永不自愈。修复：touching 时 cells 并入（语义=天然连通落账+影响区占位
  更准确）。最小复现 0/2→complete 2/2；A/B 对拍 35/35 全等（既有负载无
  共享格网，行为不变）；全量回归全绿

### 生成器参数教训（DRC 正确拦截实录，详见 M1-报告）
0.5 节距配 padH 0.9 重叠 / 1.27 节距 padH 1.5 重叠 / 0.4 节距超工艺极限（DRC
正确拦截）/ 奇数脚跨角配对 / 组距贴合 / 板幅装不下封装链——全部 DRC 正确拦
截后逐个对账修复

## 0.11.4（2026-11-13）—— 案例 02 遗留收尾：位号回收 80/80 + 真板铺铜验证

### 位号回收（无名 LIB 组）
- 真实文件的 80 个封装 attrs 全无 `name`，但**每个 LIB 内部恰好有一个位号样式
  TEXT**（所有权 1:1 明确）——无名 LIB 组的内部位号 TEXT 直接回收为组名（同名
  冲突/缺失保 LIB{n}；顶层 PA12 类网名/引脚名不参与——所有权不明防误配）
- 实测：**组件 80/80 全部找回真位号**（U15/U2/LCD2/USB1/R5/C15/LED1...，零残留
  LIB{n}）——BOM/贴片坐标分组恢复真实语义
- 回归：easyeda-import 12 项（+「无名 LIB 位号回收」：回收/同名冲突/缺失三分支）

### 真板铺铜重铺验证（案例 02 接力链最后一环）
- `pour --net GND --layer bottom` 在真实 4 层板上：ok、6 缝合孔自动生成、
  unconnectedPads 空（GND 焊盘全接入）、**DRC 0/0/0**（errors/warnings/fabFail）

### 文档
- 案例 02 遗留清单第 5 项标记已解决；追加 0.11.4 节

## 0.11.3（2026-11-12）—— KiCad 10 真机实测：全链 7 步打通 + 4 个 KiCad 10 方言缺口（2026-11-12）—— KiCad 10 真机实测：全链 7 步打通 + 4 个 KiCad 10 方言缺口

用户装机（KiCad 10.0.6 / D:\KiCad）后按插件 README 的 headless 指引驱动真机实测。
实测脚本 `.scratch/kicad-e2e.py`（7 步断言）：LoadBoard → ExportSpecctraDSN →
import dsn → route（**complete**）→ export ses → ImportSpecctraSES（**True，10
tracks 回读**）→ SaveBoard——**全链 PASS**；icebreaker 真板（636 pads）规模验证
通过（ExportSpecctraDSN 233KB → 导入 558 pads）。

### KiCad 10 方言缺口（实测抓出，全部修复）
1. **ExportSpecctraDSN/ImportSpecctraSES 需双参重载**（board, path）——单参版在
   headless 无活动板时静默返回 False
2. **DSN 刻度=µm 口径**（mm×1000）：KiCad 10 的 host_cad="KiCad's Pcbnew" 但刻度
   并非 0.1µm——host_cad 短路判定删除，全靠典型尺寸合理性打分（打分机制本为此设计）
3. **SES 结构对齐 Freerouting SesWriter**：`base_design`（下划线非驼峰）、placement
   段含 resolution、routes 内 **library_out（via padstack 形状定义）**——缺失或
   括号不配平都**静默拒绝**（KiCad 不报错只返回 False）
4. **`(nets ...)` 尾行致 KiCad 10 静默拒绝**（Freerouting 不写此行，已删）；
   session 名不得含损坏路径（DSN 头的 Windows 路径经 parseSexpr 的 Specctra 转义
   后反斜杠丢失——改从原始文本提取 pcb 头再取 basename）；层名用 design.dsnLayers
   （DSN 原始层名 F.Cu/B.Cu，SES 须与 DSN 一致）

### 回归
- tests/dsn-ses.test.mjs session 头断言更新（Freerouting 风格无引号+.ses 后缀）
- 全量回归全绿；build 一致 + 经典脚本守卫 OK；A/B 对拍架不受影响（负载无 DSN）
- KiCad 真机链路脚本固化：.scratch/kicad-e2e.py（7 步断言，可重复执行）
- GUI 注册（Tools 菜单）由 KiCad 自有加载器负责——headless 模拟 inspect.getfile
  差异不追，用户 GUI 目检一次即可（README 已注明）

## 0.11.2（2026-11-12）—— git 版本化 + 外部实测（KiCad 插件 mock + 开源广场案例 02）

### 仓库
- **git init**（仓库根=pcb-autorouter）：1050 文件初始入库，.scratch/排除，
  core.autocrlf=false（字节级一致性文化），仓库本地占位身份

### KiCad 插件（Part 2a）
- **mock pcbnew 单元测试 8 项**（tests/kicad-plugin.test.py + node 驱动器，python
  缺失如实 SKIP）：_repo_root 三条解析路径 / Run 命令序列（真 node CLI 子进程跑
  import dsn→route→export ses 全链）/ SES 内容校验 / 四条错误路径
- **插件真缺口修复**：PCB_STUDIO_NODE 指向无效路径时 WinError 2 原样抛出 →
  isfile 校验+可操作报错
- README 补**真机 headless 实测指引**（KiCad 自带 python 逐条命令；pcbnew 真机
  调用链待用户装机后实测——如实待办）

### 开源广场接力案例 02（Part 2b，[案例文档](docs/案例-外部板02-开源广场接力.md)）
- **获取路径打通**：oshwhub 项目页 RSC → projectid → `lceda.cn/api/projects/{uuid}`
  → documents docType 3 → `api/documents/{docUuid}` dataStr（972KB 真实 PCB）
- **三个真实缺口修复**（each with 回归锁定）：
  1. **板框层 10**：真实文件板框画在层 10 的 TRACK（非 SOLIDREGION boardoutline）
     ——记入板框候选兜底
  2. **LIB 坐标两口径修正**：板文件 LIB 内形状=doc 绝对坐标、PAD rot=板面绝对角
     （实样对拍）——原 pcb-rnd 本地坐标语义致 150 焊盘飞出板外；修正后 spec
     出板 208→0
  3. **SOLIDREGION 网名铜皮分类**：层 1/2 带网名=异形铜皮，单独计数
- 布通率分析（头部遗留）：manual 影响区线性侵蚀可布区（158 条→53/203，0 条→
  104/203）——高占用板接力补线是栅格模型能力边界，**#12 形状布线的实证依据**
- 回归：easyeda-import 11 项（真实案例口径合成复刻）；A/B 对拍 35/35 全等

### 验证
- 全量回归全绿（80+160+48+17+46+7+22）；build 一致 + 经典脚本守卫 OK
- git 提交：Part1 初始入库 / Part2a 插件 mock / Part2b 本条（各带深度检查）

## 0.11.1（2026-11-12）—— 深度优化第二轮：分段归因驱动的 pour/会话优化

第一轮收口后**分段计时插桩**（computePour 逐节计时）精确归因：孤岛处理 40.6%
（负空间孤岛可达 152 万格被逐格 BFS）、open 块 40.1%（形态学热循环内分支）。
详见 [深度优化报告 §7](docs/深度优化报告-20261112.md)。

### 优化（全部保序，35/35 A/B JSON 全等）
1. **routeBoard 候选会话共享 model**：审计确认 model 在会话生命周期内只读（全部
   写点在 buildModel 内，逐字段 grep）→ 初始+候选×3+逐网优化共 5 次会话复用一次
   构建（opts.model 直通；line 5710 的 17.8% 先例同款手法；并行变体走 worker 不受影响）
2. **孤岛 always 快径**：run-based 扫描线连通计数（run 行段+行间重叠合并+小型并查集）
   替代 152 万格逐格 BFS——组件划分与 4 连通 BFS 严格一致。**两个位级一致陷阱实测
   抓出并修复**：① 浮点求和顺序（"总格数×cell²"≠BFS 逐组件累加的浮点序列——改为
   按组件最小格索引排序后逐组件累加）；② 并查集合并时计数/最小格未随 root 聚合。
   area/never 保留原 BFS（回填 vis 语义不动）；always 的 done 排除语义由 !vis 蕴含
3. **morph erode/dilate 专用循环**（分支提出热循环）

### 实测（同进程 A/B）
- pour 5 次合计（密集板）943 → 703 ms（**-25%**；孤岛 -73%）
- **routeBoard 会话 e555 139.6 → 109.8 ms（1.27×）**（model 共享 + 上轮 checkDRC）
- checkDRC dense 复测 18.6 → 8.1 ms（2.30×，上轮收益确认）
- 剩余天花板如实留档：morph 字并行（风险/收益比不足）、cell 分辨率（破坏逐位一致）

### 验证
- **A/B 对拍扩容至 35/35 JSON 全等**（新增：routeBoard 完整 result 逐位、孤岛三模式
  逐位；timeMs 剥离）
- 全量回归全绿；build 一致 + 经典脚本守卫 OK

## 0.11.0（2026-11-12）—— 深度优化轮：checkDRC 热路径受控提速（1.9~4.1×）

方法论与 0.6.x 优化轮一致：**先剖析后动手、全部保序受控改造、A/B 对拍逐位一致、
全量回归收口**。详见 [深度优化报告](docs/深度优化报告-20261112.md)。

### 剖析结论（node --cpu-prof，密集负载 152 焊盘）
- checkDRC 22.4%：焊盘×焊盘全对（**每对一次 `Array.from({length:layers})` 分配**）
  + 段×焊盘/过孔×焊盘/过孔×段全扫
- computePour 家族 ~45%：细格 0.04mm → **152 万格**的线性形态学/洪泛——本质复杂度
- GC 3.5%：pour 的 JS 数组 push 边界边 + 大 typed array 分配

### 优化（全部保序——候选集保守超集，findings/输出逐位不变）
1. **checkDRC 四处全扫的标量快速过滤**（pad×pad/via×pad/via×seg/seg×pad）：
   保序充分性有数学依据——焊盘边上任意点距中心 ≤ hypot(w,h)/2，违规对中心距
   < 阈值+双半径，逐轴分量同界，轴距超界者必不违规；迭代结构与 add() 顺序不变
2. **`Array.from({length:layers})` 每对分配 → 全程一次**（层重叠检查提升出热循环）
3. **netW 引用守卫缓存**（WeakMap 按 design 存 **net 对象引用**——w 现读，原地改
   nets[i].w 立即生效；nets 数组换代自动重建；语义与线性 find 严格一致）
4. **computePour 边界边两遍扫描 + Int32Array 预分配**（原 JS 数组 push 是 GC 大户）

### 实测（同进程 A/B，before=优化前完整引擎副本）
- checkDRC：dense 27.4→14.1ms（**1.94×**）、示例板 **2.0~4.1×**
- **routeBoard 会话 e555 167.8→147.5ms（1.14×）**——prepare 每次布线跑 5 遍
  checkDRC（初始+候选×3+逐网优化），全链受益
- pour：输出位级一致、耗时持平——数量级优化需放粗 cell 分辨率（破坏逐位一致），
  如实留档不做（docs/深度优化报告-20261112.md §6）

### 验证
- **A/B 对拍 20/20 JSON 全等**（.scratch/opt-ab.mjs：DRC findings / pour solid /
  pour grid+thermal / route 连通位级 × 5 确定性负载）
- 全量回归全绿（80+159+48+17+46+7+22）；build 一致 + 经典脚本守卫 OK

## 0.10.0（2026-11-11）—— roadmap #9：AI 工作流定型（deliver 一键交付包 + 手册 v2）——阶段二收官

### 功能
- **CLI `deliver`**：`deliver design.json [result.json] -o 交付目录 [--project 名] [--force]`
  - **三道门禁**：① verify 写后回读 ok（导出与设计逐项一致）② DRC errors=0
    （fabFail=工艺极限违规计入）③ **连通性 100% 布通且 total>0**（实测抓出并堵住
    "无 result 空板放行"的门禁漏洞）；门禁不过 → ok:false 中止列 findings；
    `--force` 覆盖但 manifest 如实记 override（门禁原始结果保留，不粉饰）
  - **交付目录**：EasyEDA JSON（roundtrip-verified 证据级）+ Gerber 八件套（gerber/）
    + IPC-356 + SVG + BOM.csv（嘉立创 SMT 格式）+ 贴片坐标.csv（CPL 左下原点）+
    渲染 PNG（目检用）+ 投板检查表.json + **manifest.json**
  - **manifest.json**：每个交付物带 bytes + evidence 证据级（roundtrip-verified >
    deterministic > datasheet-backed，AI 手册 §4 证据分级贯彻到交付物）+ 门禁结果 +
    设计/布线摘要 + 证据级口径说明——AI 复核按证据级引用，人工复核按 datasheet-backed
    项走（BOM 的 C 编号/封装）
  - 项目名消毒（路径注入防护：`[\\/:*?"<>|\s]` → `_`，前导点 → `_`）
- **bom/pos 提取公共 helper**（bomRowsOf/posCsvOf，bom/pos/deliver 三处共用——
  行为不变，cli 回归证明）

### AI 手册 v2
- 工作流主线定型：`资料 → 器件选型(device) → 连接关系 spec（含 rules 约束 schema）
  → spec 校验 → place → route → tune → drc → advise → 修复循环 → pour → deliver
  → render 目检`——交付步由 13 行散装清单收敛为 deliver 一条（散装命令保留为
  底层 API，产物一致）；命令一览补 deliver 行与 export ses

### 质量守卫
- **tests/cli.test.mjs +2 项**（17 项）：deliver 成功包（门禁全过/项目名消毒/
  证据级三级齐/每件带 bytes）+ 门禁中止（空板拒绝）+ --force 留痕（override:true
  且门禁原始结果保留不粉饰）
- 全量回归全绿；build 一致 + 经典脚本守卫 OK；文档三角同步（README/AI 手册/CHANGELOG）

### 阶段二收官对照（路线图 M2）
- #7 KiCad 双向插件 ✓（importDSN/exportSES/kicad-plugin + 外部案例文档此前已备）
- #8 嘉立创全往返 ✓（EasyEDA 导入 + 开源广场接力）
- #9 AI 工作流定型 ✓（本版本）
- #10 约束系统升级 ✓（rules schema + class keepout）
- #11 版本化分发：按决策跳过（npm 发布/GitHub 公开需账号配合，另行安排）

## 0.9.0（2026-11-11）—— roadmap #7：KiCad 双向插件（importDSN + exportSES + kicad-plugin）

### 功能
- **`importDSN(dsnText)`（engine）**：Specctra DSN 导入——两种 dialect 统一公式
  「板坐标 = rotate(pin 本地, place.rot) + place 位置」（本工具 place=(0,0,0) 恒等、
  KiCad place=板坐标+旋转，一个公式全覆盖）：
  - **双刻度自适应**（差 10×）：本工具/Freerouting 实样（Issue026 交叉验证）DSN
    数值=µm（mm×1000）；KiCad pcbnew ExportSpecctraDSN 数值=0.1µm（mm×10000，内部
    nm/100）。host_cad 直接识别（kicad/pcbnew）；无 host 按典型尺寸合理性打分
    （焊盘/过孔/线宽/间距落在 [0.05,2.5]mm 者胜，平票取 µm）
  - image/place（封装/位号）分离解析、90°/270° 旋转、front/back（back 的 padstack
    Top 层→bottom；pin 本地坐标按 DSN 惯例导出侧已镜像不再翻）、padstack
    circle/rect（signal=通孔、Top/Bottom=表贴）、每网线宽 rule、boundary path/rect
  - **string_quote 自指坑位修复**（Freerouting 研读第二轮）：`(string_quote ")` 的
    引号字符是字面值本身——通用解析器把后续全文吞进未闭合字符串；替换为空串字面值
  - wiring 不导入（DSN 是布前网表，走线走 SES 通路）；design.external=true
- **`exportSES(design, result)`（engine）**：布线结果→SES 会话（network_out 逐网
  wire 换层拆 run + via；换层拆分与 exportDSN wiring 同逻辑）。**SES 数值刻度
  = DSN×R = mm×10000**（Issue026 口径，与 importSES 的 v/R×0.001 对称——
  修复了 exportDSN mm×1000 与 SES 口径混用的潜在 10× 错位）。KiCad
  ImportSpecctraSES / Freerouting 可直接回读
- **CLI**：`export ses design.json result.json -o out.ses`；`import dsn`（0.7.0 留位）转正
- **`kicad-plugin/`（KiCad 7/8 Action Plugin）**：Tools 菜单「PCB Studio 一键布线」——
  ExportSpecctraDSN → `node ai/pcb.mjs import dsn → route → export ses` →
  ImportSpecctraSES → 刷新。PCB_STUDIO_HOME/NODE/VIA_COST 环境变量配置；弹窗报告
  布通状态；未布通也回读已布部分（如实提示）

### 存量 bug 修复
- **importSES 带引号网名**：Freerouting 对含下划线网名（LED_N）按 IdentifierType
  规则加引号——parseSexpr 返回 {str} 对象，String() 变 "[object Object]" 跳过整网。
  修复：netName 提取判 {str}（555 实测 15 条 entry 全回读）。此为 KiCad/Freerouting
  生态接通的最后一公里

### 质量守卫
- **tests/dsn-ses.test.mjs 7 项**（package.json 注册）：本工具方言往返逐项对账、
  KiCad dialect（4 层/旋转/back/每网线宽/0.1µm 刻度）、无 host 刻度自适识别、
  SES 回读链逐点对账（含引号网名）、换层合并（via 处 4 点 L0→L1）、CLI 端到端
  （export ses 落盘 + import dsn 回读）、坏输入零崩溃
- Python 插件 py_compile 通过；**如实声明**：pcbnew 调用链（ExportSpecctraDSN/
  ImportSpecctraSES 返回值语义、KiCad 版本差异）需装有 KiCad 的机器实测——
  开发环境无 KiCad，插件 README 列了实测步骤与报错回传路径
- 全量回归全绿；build 一致 + 经典脚本守卫 OK；文档三角同步（README 功能区/工程
  结构/AI 手册命令行/CHANGELOG）

## 0.8.0（2026-11-11）—— roadmap #10：约束系统升级（rules schema，生成器惯用法根治）

### 功能
- **`design.rules` 声明式约束**（normalizeDesign 单向展开为扁平字段——扁平模型仍是
  唯一事实源，全部消费方零改动；展开幂等）：
  - `classes`/`netClass`：网类线宽/上升时间 → 成员网 `nets[].w/tr`（KiCad net class
    同思想）
  - `pairs`：`{group, nets:[A,B], z?}` → 成员网 `pair`/`diffZ`（差分对引擎/等长检查/
    3W 对内豁免/diffz 全链自动接入）
  - `lengths`：`{group, nets:[...]}` → 成员网 `lenGroup`（tune 蛇形按组补长；组级
    tolerance/target 留在 rules 上供后续消费）
  - `keepouts`：`{rects:[...] | x,y,w,h, class?}` → **class keepout**（keepouts[].scope）
- **冲突即错误**（根治生成器惯用法——不静默取优先级）：netClass 与 nets[].w/tr 双写
  不一致、rules.netClass 引用悬空（网/类）、pairs 成员缺失/非 2 个/网重复归组、
  lengths 悬空/重复、keepout class 悬空/零尺寸、class w/tr 非法值——全部在
  normalize 即抛（spec/CLI 以干净 JSON error 呈现）

### class keepout（作用域禁布，KiCad 网类限制 zone 同思想）
- scope=类名的 keepout **对异类网是障碍、本类网自由**；无 scope 照旧全局禁布
- buildModel：scope keepout 进 `scopedBlocked`（按类分位图，含 n145 同款缓冲带+焊盘
  真铜格豁免）；内部网对象携带 cls（design.rules.netClass 现算，不依赖展开——
  worker 镜像会话同样生效）
- 消费链全口径：路由 passable / 差分对建廊 ×2 / 过孔 viaLegal / 蛇形美化（载体+步进
  采样两处）/ DRC（走线-禁布 error + 焊盘-禁布 warn）/ autoPlace 布局罚分——
  保守合理处不作用域化（pour 铜皮避让、回流地孔选址避所有禁布、SVG/PNG 显示画全部）
- 性能：scopedBlocked 为空（绝大多数设计）时 `_scopedHit` 零开销短路

### 消费方审计（深度检查）
- grep 逐点核对 pair（差分对引擎 3 处）/lenGroup（蛇形 2 处）/diffZ（奇偶模口径）/
  tr（传输线判据/等长）/scope（9 个触点）——全部读扁平字段，展开后零遗漏路径；
  routeBoardIterParallel 的 worker 镜像会话从 design.rules 现算 cls ✓

### CLI / 质量
- `spec`：输出 `rules` 摘要（classes/classified/pairs/lengthGroups/keepouts 计数）+
  class 线宽工艺极限与「w<clearance 同网自碰」拦截
- `schema`：rules 字段文档 + 惯用法错误负面清单 3 条（双写冲突/组重复/引用悬空）
- **tests/rules-schema.test.mjs 9 项**（package.json 注册）：展开/幂等/冲突即错误/
  悬空拦截 9 类/class keepout 路由端到端（异类绕行+本类直穿+布通）/DRC 分网判定/
  向后兼容（无 rules 行为不变+全局 keepout 照旧）/CLI spec 摘要与拦截/惯用法错误
  家族 CLI 干净 JSON error
- **fuzz 13 项增补**（26→39）：rules 数组/classes 数组/悬空网/悬空类/pair 单成员/
  pair 悬空/pair 冲突/lengths 悬空/keepout 悬空类/零尺寸/class 负宽/w 双写冲突/
  rules null——全部干净 JSON 错误零崩溃
- 全量回归全绿；build 一致 + 经典脚本守卫 OK；文档三角同步（README/AI 手册/CHANGELOG）

## 0.7.0（2026-11-11）—— roadmap #8：EasyEDA PCB 导入（开源广场接力入口）

### 功能
- **`importEasyEdaPcb`/`importEasyEdaPcbFull`（engine）**：解析 docType 3 标准 PCB JSON——
  本工具 exportEasyEdaPcb 输出与嘉立创EDA真实文件两口径。shape 字段序经 pcb-rnd
  src_plugins/io_easyeda/read_std_low.c 逐字段交叉核实（study/pcb-rnd）：PAD 的
  points=f[10]/rot=f[11]、TRACK/VIA/TEXT/SOLIDREGION/LIB 头全部对齐。
  - **LIB 块**：`LIB~x~y~attrs~rot~...#@内含形状（#@$ 分隔）`，内含形状为本地坐标
    （read_std_hi.c std_parse_subc → subc_finalize 在 x,y,rot 整体放置实证），
    旋转按 EasyEDA 屏幕坐标（y 向下）标准矩阵；组件名取 attrs \`name\`（精确归属）
  - **旋转焊盘**：任意角按 KiCad 导入器同款真旋转 AABB（|w·cos|+|h·sin|）写 w/h，
    保留 rotAbs/wLocal/hLocal（spec 45° 真形状精查输入齐全）
  - **TRACK→design.manual**（手动走线，计入连通/DRC/全部导出），各网众数线宽写
    nets[].w（平票取更宽）；**VIA→两点换层 stub**（buildModel 惯例：换层点=全层
    过孔影响区，实测 stub+两段走线 union 连通）；内层 TRACK（21/22）→ 4 层板
  - **COPPERAREA/HOLE(NPTH) 不导入**（design 无铜皮多边形/裸孔存储）——报告如实
    计数，接力工作流用 pour 重铺
  - **板框**：SOLIDREGION boardoutline 包围盒（路径字段定位容真实文件字段序差异），
    缺失回退焊盘包围盒+5mm（KiCad 导入同款）；keepout SOLIDREGION→矩形近似
  - **design.external=true**（spec 同元件焊盘间距豁免，KiCad 导入同款）

### 摊平焊盘位号归属：「簇优先、位号后贴」（v3）
- EasyEDA docType 3 摊平焊盘无封装记录，位号归属靠几何。**弃用最近邻起步+贴邻
  精化（v2，同版本内推翻）**：宽体 IC 边缘脚到邻组位号比到本组位号更近（555 实测
  DIP-8 左列 3.95 < 5.3mm），且列间距 7.5 > 到邻组 5.0，贴邻精化同样反水——
  几何最近类算法在宽体 IC 场景本质不可靠
- **v3**：几何单链聚簇（阈值 2.6mm≈THT 2.54 节距上限）→ 位号认领「含其最近焊盘」
  的簇（位号在组件中心，其最近焊盘必属本组件；LIB 内部位号不参与认领）
- **已知边界（如实）**：宽体 IC 左右列裂成两簇，远离位号的一列降级 P 组件；密集
  0402 农场（间距<2.6mm）可能链成大簇共享位号——均只影响 pad id 命名与 BOM/pos
  分组，网名逐焊盘保全，电气连通以 netId 为准；LIB 块文件不受影响

### 两个潜伏缺陷修复（回路测试逼出）
- **网格磁吸**：路由器路径点恰在格点上，导出量化（±0.00013mm）让
  floor(x/grid-0.5) 翻到邻格——整条走线与焊盘格错开一格且无 4 邻接，连通性假断、
  buildModel markFixed 固定格错位。修复：漂移 <0.001mm 的坐标吸附回 grid/2 格点；
  外来文件坐标（0.254 步进）距格点 ≥0.004mm 不受影响
- **computeRatsnest 手动走线走廊标记**：45° 斜线恰好沿格角穿越（x+y=格点常数）时
  0.25 步采样从格 (i,j) 直接跳到 (i±1,j±1)，4 邻域并查断链——导入板预拉线假断。
  修复：与 markFixed 同口径的段距离走廊标记（格方块与段相交即标记，几何完整）

### CLI / GUI
- **`import easyeda|kicad|dsn <file> [-o design.json]`**（新命令）：easyeda 全报告
  （pads/nets/tracks/vias/copperareas/holes/graphics/skipped/notes）；顺带补齐
  `import kicad` 与 `import dsn` 的 CLI 缺口（KiCad 导入此前只有 GUI）；cli-args
  `-o` 白名单同步
- **GUI「导入」菜单新增「嘉立创EDA PCB (.json)」**：FileReader→importEasyEdaPcbFull
  →载入画布，报告走线/过孔/跳过计数与覆铜重铺提醒（文件名与 skip 计数均 escapeHtml）
- dsn 分支依赖的 importDSN 属 roadmap #7（本版本 CLI 已留位，下一版本落地）

### 质量守卫
- **tests/easyeda-import.test.mjs 10 项**（package.json 注册）：回路对账（焊盘按
  引脚号@量化坐标逐个命中+网名逐焊盘一致，量化走 verify 同款路径）、VIA stub 连通、
  真实文件风格 fixture（LIB+90° 旋转+非零 canvas 原点+keepout+skip 计数）、45° 真包络、
  同簇同号消歧、坏输入零崩溃、畸形 shape 容错、接力重布+**三方对账**（import→route
  →re-export→verify ok:true→再 import 全连通）、CLI 端到端+落盘 spec 可过
- **fuzz 9 项增补**（17→26）：坏 docType/缺 shape/shape 垃圾元素/超大坐标/倒序
  outline/嵌套 LIB——全部干净 JSON 错误零崩溃
- 全量回归全绿（router 80、node --test 组 143 含新增 10、books-insights 48、
  CLI 15、fuzz 26、deep-validate 7、verify-optimizations 22）；build 一致 + 经典脚本
  解析守卫 OK
- 文档三角同步：README（功能区/测试覆盖段/模糊数）、AI 手册（命令一览 import 行+
  接力工作流）、CHANGELOG 本条

## 0.6.3（2026-11-11）

核心布线深层检查轮：外部板反哺测试的对抗推演暴露**潜伏 5 个版本的核心缺陷**。

### 重大发现：RMST 快路径自 0.1.0 起是死代码
- RMST 分解循环的 `goal = tree ∪ dst` 把已连接树包含进目标集——而边源（pad 格或
  上边终点）恒 ∈ tree ⊆ goal → A* 在起点立即"命中"目标 → **每条 RMST 边退化为
  单格路径** → RMST 恒失败 → 全部走 Prim 回退。0.1.0 起所有布线实际由 Prim
  承担，RMST 是每次白跑一遍再拆掉的死代码（外部板 iCEBreaker 逐边探针定位）
- **修复**：goal=dst（每条边路由到自己的目标焊盘格）——RMST 路径复活
  （实测 2 焊盘网 edge pathLen 9/30 真路径、3 网全连）
- **路线决策（数据驱动）**：外部板 4 层实测 Prim 156.7s/419 vs RMST 293.6s/413
  ——Prim 更快且质量同级 → **Prim 为主、RMST 为 Prim 未全连时的回退**
  （routeNet 重排：primRoute 先行 → 未全连 → ripNet → RMST 同尺重试）

### 质量守卫全程
- search-baseline digest 因路由顺序变化重定（15 fixtures 全部 DRC 干净后重定，
  非 silent 覆盖）；322 项回归绿；经典解析守卫 OK
- 旧 KICAD_SAMPLE fixture 补上 KiCad 必写的 pad 绝对角（原 fixture 漏写=不忠实
  输出——这正是旋转语义歧义的根源，与 0.6.2 的三重实证相互印证）

### 检查轮追加（同版本内修复）
- EDGE_DEBUG 探针 5 处拆除（括号感知删除，含多行块）+ 死 normAng（90° 量化版）
  删除防误用
- 旗标三角审计：CLI 47 旗标 ↔ 白名单 ↔ 文档，无缺失无幽灵
- 外部案例文档同步：旋转语义修复后 spec 184→9（45° 封装真形状不再误报）
- 深检通过：iter-parallel→pour 链路、波次 1/4 全连通、45° 焊盘细间距配方布线
  DRC 干净、机械孔障碍语义（走线绕行不穿孔）
- 全项目深度审计（收尾轮）：ui.js/server.mjs/文档引用逐项过审；
  **修复 fabChecklist 检查表 HTML 注入点**——engine 侧 `item` 拼入用户可控网名
  （KiCad 导入网名字符任意），ui.js 渲染处未转义（其余 UI 注入点全有 escapeHtml，
  唯此处遗漏）——修复放在消费端转义（item/value/limit/note 全转，CLI JSON 侧
  保持原始字符串语义）；worker-client 双副本（index.html 内联 vs src/worker-client.js）
  逐行一致性过审；文档引用完整性过审（初检 3 项"缺失"均为 grep 误报，实际全存在）

## 0.6.2（2026-11-10）

外部案例缺口反哺回归轮：6 项缺口修复全部固化为 tests/kicad-import.test.mjs
（合成最小 KiCad 文件逐项复刻，防退化），并深挖出**第 7 项缺口（旋转焊盘交换
条件的角度语义）**——三重实证（R_0402 同位置不同 fp 旋转 / U7-U3 板面尺寸差
90° 互换 / SOT-23-6 物理不重叠）定论：文件 pad 位置=封装本地坐标（按 frot 旋转
到板坐标）、文件 pad 角=板坐标绝对角（w/h 交换与精查全按 prot 绝对角）。
修复了 normAng 两处缺陷（90+270=360 环绕丢交换、45 被量化到 90 毁真形状），
w/h 改为真旋转形状的板坐标 AABB（各轴 |w·cos|+|h·sin|）。旧 KICAD_SAMPLE
fixture 补上 KiCad 必写的绝对角（原 fixture 漏写=不忠实输出，正是歧义根源）。
外部板 spec 184→9（剩余为 QFN EP 导热孔环宽 DFM 遗留）。

### 反哺回归套件（tests/kicad-import.test.mjs 6 项）
1. 同号焊盘消歧（后缀唯一 + 两种分组约定保持）
2. 旋转焊盘（U1 normAng 环绕回归：板面 0.65×1.06 + 位置按 frot；U6 45° 真形状
   AABB 0.6364 + rotAbs 不被量化）
3. 机械孔环宽豁免（checkDRC：无网 THT 不查环宽）
4. design.external 豁免（CLI spec 集成：外部板不报 + 自产规格对照仍拦截）
5. EasyEDA 网名消毒（~/| 字段不错位 + TRACK 网名 + verify 全绿）
6. verify 取整不对称（.005 边界不误报 VRF-PAD）

## 0.6.1（2026-11-10）

### 案例结论
- 全链走通：KiCad 导入 → spec → place → route → tune → pour → export → verify → render
- **并行协商 6.18×**（490.9s → 79.4s，4 worker，连通 414 vs 410 优于串行）
- capacityStall 容量签名在真实外部板触发（2 层跑真 4 层板；4 层对照 419/533）
- **autopcb 布局-布线反馈循环**：3 轮后 **517/533（+98 连接）**——散布失败的
  正确解法是改布局；atmega 模式在外部板复现；剩余 8 网为连接器/状态脚
- 案例文档：docs/案例-外部板01-iCEBreaker.md（命令日志/指标表/遗留清单/复现）

### 外部板抓出的真实缺口（6 项，全部修复——外部案例的价值实证）
1. importKiCadPcb 同号焊盘消歧（拨码开关公共脚/QFN 散热焊盘分割——spec 直接拒绝）
2. 旋转焊盘 w/h：封装本地坐标+相对角语义对拍定论（normAng(90+270)=360→0 丢交换）
3. 机械安装孔（无网 THT）环宽误报——spec/checkDRC 双处豁免
4. spec 同元件焊盘间距外部板豁免（QFN-48-1EP 散热焊盘交叠=封装作者几何 ground truth）
5. **EasyEDA 网名消毒**：KiCad 层级网名含 ~/| 会错位 ~ 分隔字段（导出对嘉立创EDA
   本身就是坏的）——导出侧消毒 + verify 键同口径
6. **verify 往返取整不对称**：.005 边界坐标设计侧/往返侧 toFixed(2) 不同——期望值
   改走导出同款量化路径

### 遗留清单（案例文档详列）
- QFN EP 导热孔环宽 0.10（JLC 接受，DFM 分级遗留）
- 0.4 BGA 超能力；导入不含内层铜；2 层容量边界（capacityStall 已诊断）

### 质量
- 全量 316 项回归绿；verify 0 findings；经典解析守卫 OK

## 0.6.0（2026-11-10）

阶段一 #4 完成：协商内 worker 并行（TritonRoute FlexDR per-iteration 模式的架构
对应物）——**真实板实测 5.08×**（298.5s → 58.8s，h2-stm32 maxIter=30，4 worker）。

### 架构（与 TritonRoute FlexDR 同构）
- 迭代串行（共享拥塞状态=串行依赖），每迭代的网批量并行：
  主会话 beginIteration（阶段机/历史增量/邻域拆除/排序，从 step 逐字提取——
  串行路径位级不变）→ exportShared 广播拥塞快照（usage/hist/cellOwner/viaCore/
  走廊折扣/阶段参数，类型化数组 structured clone 直传）→ K 个**持久镜像会话**
  routeList 分到的网批（批内互不见=预期冲突，PathFinder 语义）→ 主会话按队列
  prio 序串行 commitRoutes → 下一迭代
- 分批=队列 prio 序 round-robin（确定性）；commit 按队列序（tie 语义保持）
- worker 持久镜像（创建一次跨迭代 adopt，零重建）；worker 失败批次自动串行补跑
  （并行永不劣于串行）

### 协议健壮性（冒烟两次挂死的修复）
- reqId 关联全部应答（陈旧消息不污染下一次等待）
- send 全路径收敛：应答/错误回复/worker 崩溃/进程退出/超时——漏一条即永久挂起
- route 批次 120s 兜底超时 + finally terminate 池（node --test 事件循环退出保证——
  此前测试"完成"却收不了尾，worker 不退出占住事件循环）
- **严禁 JSON 往返**广播（5M 元素×6 数组×K worker×每迭代=挂死，实测教训）

### 并行语义的口径修正（commitRoutes 与串行一致）
- net.total/ cellOwner 补齐（stats 6/0 → 6/6 的根因；cellOwner 缺失会让
  nearPen/对内豁免读到陈旧属主）
- capacityStall 条件展开（非停滞结果位级不变——digest 守卫确认）
- 质量口径：批内并发协商的路径微差由逐网优化收敛（实测长度差 <5%，连通/DRC 同级）

### CLI
- `route --iter-workers K`：并行协商（与 --parallel 候选级互补；重板适用）

### 波次批处理 + LPT（同版本追加优化）
- **波次批处理（Jacobi→部分 Gauss-Seidel）**：全网只见迭代起始快照时协商收敛慢于
  串行（同迭代数 overuse 254 vs 历史口径）——队列按 prio 切 W 个波次，波间提交
  可见、波内保持并行；**W=2 实测 overuse 减半（254→119，77/77 全连通）**，
  4 波反而丢连通（74/77，如实记录）→ 默认 W=2（`--iter-waves` 后续开放）
- **LPT 负载均衡**：波内按最长网优先分配（修 round-robin 尾部延迟——最后一批
  拿全是最长网）
- onStage 会话重放补齐（并行协商逐迭代留痕，与串行同口径）

### 检查轮追加（同版本内修复）
- **route --iter-workers CLI 缺口**：手册宣传的旗标此前只在引擎层（doc-CLI 缝隙，
  历轮同款）——补 CLI 实现+白名单
- **routeBoardParallel 候选 worker 不终止**：与 iter-parallel 同款事件循环风险
  ——结果收集后统一 terminate
- 死代码清理（msgHandler 占位）；已知边界记录：TS>8M 巨板回退 Map 时
  exportShared 不带走廊折扣（worker 侧无偏置，协商质量与串行同级但慢）

### 质量
- 新增 tests/iter-parallel.test.mjs 4 项（有效性/确定性/质量同级/回退）；
  全量 316 项回归绿；经典解析守卫 OK

## 0.5.2（2026-11-09）

收敛加速（roadmap #4 的真杠杆）：邻域拆除——freerouting RetryNeighbourhood 策略移植。

### 缺口与修复
- **失败网零协商压力的结构性缺口**：A 路径失败（非冲突）时不产生 overuse →
  历史代价无增量 → 阻挡者永不被推动 → 失败网每轮同位重试（atmega"重跑多次同位"
  与 n148 残留的根因）。协商循环里存在"失败但不冲突"的死角，此前无任何机制触达
- **邻域拆除**（freerouting RetryNeighbourhood 移植）：连续失败 ≥2 轮的网，其
  开放焊盘（padCells ∩ cells=∅）邻域的阻挡者先行拆除并标记 conflicted——队列中
  失败网（failedLast 优先）先看到清空的空间，阻挡者排后绕行重布；半径/上限随
  连续失败渐进放宽（1.5→12mm / 3→12 个，首次失败只观察）；`neighbourhoodRipup:false`
  可关闭

### 真实板验收（h2-stm32，98 焊盘，maxIter=30/80 双跑）
- **前沿推进**：连通 57/77 → **75/77（+18 网，74%→97%）**——同迭代预算
- **代价如实**：中途间距违规更多（mi=30：90 vs 29；mi=80：69 vs 29）——前沿更远
  但间距清理滞后
- **收敛性定论**：开版 overuse 随迭代持续下降（30 轮 86 → 80 轮 51，**正在收敛**）；
  关版恒定 24（**永久卡死**）——邻域拆除是"卡死"与"收敛中"的分界线，
  历史代价/种子洗牌均触达不了该死角；验收线（DRC 全清）需要更大的迭代预算
- 2 个残余未连通网为另一类问题（封装/几何可达性），非本策略范畴

### 检查轮追加（同版本内修复）
- **routeBoardParallel 鲁棒性缺口**：engineUrl 无效/worker 崩溃时结果静默降级为
  "仅初始布线"（候选全丢，比串行还差）——worker 失败的候选项自动串行补跑，
  **并行永不劣于串行**
- `route --no-nb-ripup` CLI 旗标（邻域拆除的逃生口此前只在引擎 API 层）

### 容量停滞诊断（产品化）
- 协商结束时（迭代耗尽 + overuse ≥10 + 仍有失败）在 result 打 capacityStall 签名，
  advise 升级为 CAPACITY_STALL 建议：跳过逐网修复直接加层（实测同板 2→4 层
  57→77/77 全通）——AI 代理不再浪费轮次在容量不足的板上逐条试建议

### 质量
- 无失败场景位级不变（search-baseline 摘要逐位通过）；全量 312 项回归绿

## 0.5.1（2026-11-09）

A* 热路径深度优化（roadmap #4 的"A* 热路径残余优化"项）：**路由切片
（h2-stm32，maxIter=3）69.3s → 20.4s（3.40×）**，输出位级不变（search-baseline
摘要逐位通过）。

**口径分歧的归因调查（受控 A/B 定论）**：跨进程的墙钟基准（438/293/306/1082s 系列）
被机漂污染不可互相归约——本机同配置重跑方差达 ±35%（legacy 399.5/297.3s）。
同进程交错 A/B（各跑 2 次取均值）才可信：**maxIter=10 下 1.27×**（legacy 348.4s vs
optimized 275.0s）；maxIter=3 切片 3.40×。加速比随迭代规模递减（后期迭代拥塞
加重，nearPen 非零率上升，缓存收益结构变化）——真实增益口径：1.27~3.40×。
**意外红利**：优化后方差从 ±34% 收敛到 ±0.6%（Map 重哈希/Set 查询的抖动源被
类型化数组消除）——性能更可预测。routeBoardParallel 的 1.50× 同样受此机漂
影响，真实值带较宽误差棒。

### 四项优化（全部位级安全——digest 守卫全程验证）
- **邻近罚逐格缓存**（最大头）：nearPen 与入边数无关地重复计算至 4 次/格
  （斜向更多），且 adjPenAt 内含 `net.cells.has`（Set 哈希查）——改为 gen 戳
  的 Float32Array 逐格缓存，每生成格算一次。TS >4M 状态自动回退直算（内存门）
- **耦合走廊 Map → 懒分配类型化数组**：A* 每条边一次 pairBonus.get（哈希查）→
  Float32Array/Int32Array 直接索引；TS >8M 状态回退 Map；写入/读取/清理同语义
- **viaLegal keepout 位图**：每过孔尝试一次 distToRect×keepouts 循环 →
  会话级懒构建 Uint8Array 位图一次读
- **堆 swap 内联**：swap 闭包占档案 2.4%（V8 对多捕获变量闭包常不内联）——
  push/pop 内联展开

### 检查轮追加（同版本内修复）
- **浏览器 GUI 全灭事故**：routeBoardParallel 引擎本体内用了 Node ESM 的模块元
  属性——该语法在 index.html 的经典 <script> 内联构建里是**解析期错误，整个
  引擎脚本失效**（GUI 全灭），而 CLI（Node ESM）全绿完美掩盖。修复：引擎本体
  禁用该语法，engineUrl 由调用方传入（CLI/测试用 URL 构造），缺省串行回退；
  **build --check 新增经典 script 解析守卫**（防复发——字节新鲜度检查抓不到
  解析期错误）
- **耦合走廊折扣的 F32 精度风险**：0.9 经 Float32 存取变为 0.89999997…，与
  Map 路径的双精度 0.9 位级不同（摘要测试通过属 fixture 幸运）——val 改
  Int16 千分比存储（500/750/900），读取时 /1000（IEEE 除法正确舍入回与字面量
  相同的 double，位级一致）；顺带移除只写不读的计数器
- **方法论补强**：GUI 与 CLI 共享引擎时，"CLI 全绿"不等于"GUI 可用"——
  内联构建的解析期验证必须进 check 流水线（本次已进）

### 方法论
- 全程以 tests/search-baseline.json 摘要守卫做位级回归（每次改动即跑）；
  临时环境门做同构建 before/after 对比（69.3s vs 60.0s 的门切换测量受 JIT
  迁移干扰低估——撤门后终验 20.4s 才是真值），测毕即撤
- routeBoardParallel 端到端同步受益（worker 内同一 A*）

### 已知边界
- 4 叉堆未采纳：pop 序对等优先级键依赖堆结构——会破坏位级确定性（digest 变化）
- nearPen/pairBonus 类型化缓存的内存门（4M/8M 状态）之上的巨板自动回退旧路径

## 0.5.0（2026-11-09）

阶段一 #4 第一增量：并行候选布线（性能-多核的可落地部分）。

### 调研（源码研读 + 文档）
- **freerouting BatchOptimizer**（本地源码精读）：autorouter pass 单线程、
  optimizer 按 connection 候选并行——固定线程池 + ThreadLocal 私有板深拷贝 +
  串行合并赢家 + chunk 调度（threads×4）+ 连续失败早停 + deadline
- **OpenROAD FlexDR**（本地源码 + 官方文档）：迭代串行、每迭代 worker 批次并行
  （gcell 区域分片、worker 状态可序列化、结果串行 applyUpdates）+ dynamic schedule
- **共同架构原则**：共享拥塞状态是串行依赖 → 并行的单元=彼此无共享写的独立
  候选评估；worker 私有状态隔离（深拷贝/快照）+ 串行合并
- 参考来源：[OpenROAD Detailed Routing 文档](https://openroad.readthedocs.io/en/latest/main/src/drt/README.html)、
  [TritonRoute 论文](https://vlsicad.ucsd.edu/Publications/Journals/j133.pdf)

### 引擎
- **routeBoardParallel**：多配置候选重跑的 worker_threads 并行——每候选=独立
  完整会话（freerouting optimizer 线程池的架构对应物）：主线程跑初始布线定候选集 →
  K 个 worker（分桶、桶内串行、结果按提交序收集保持 tie 语义）→ 每候选独立
  优化后取最优（语义演进：串行版只优化最优候选；并行版质量 ≥ 串行）；
  浏览器无 worker_threads 自动回退串行；drcErrors before/after 兜底 exit hook
- `route --parallel K` CLI（autopcb 白名单预留）

### 基准（h2-stm32，98 焊盘真实板）
- 串行 routeBoard（init+3 候选+逐网优化）：438.78s
- 并行 routeBoardParallel：**293.07s（1.50×）**，同 DRC 口径，且并行候选 2 胜出
  （质量更优路径被选中）；worker 启动开销 ~300ms（模块加载）——小板被开销淹没，
  重板才能摊薄

### 诚实边界
- 1.50× < 路线图验收的 6.8×（3.4h→30min）：候选级并行只覆盖候选阶段；
  协商内 worker 并行（TritonRoute per-iteration 模式）需要会话状态序列化重构
  （usage/hist/pairBonus 可传输化）——列入后续，#4 保持"部分交付"
- 小板（<1s）用并行反而更慢（worker 启动开销）——docs 已注明适用阈值

### 质量
- 新增 tests/parallel-route.test.mjs 5 项：结果有效性、质量 ≥ 串行、确定性、
  parallel=1 串行回退、CLI 端到端；全量 312 项回归绿

## 0.4.0（2026-11-09）

阶段一 #3：差分对耦合布线转正（lite → 奇偶模阻抗口径）。

### 引擎
- **diffPairZ/diffPairZFor（奇偶模阻抗口径）**：边耦合微带近似
  Zdiff(S)=2·Z0·(1−0.48·e^(−0.96·S/H))（IPC-2141 量级，与 impedance() 同一免责
  层级）；奇模=Zdiff/2、偶模≈Z0（微带偶模弱变化近似）；间隙求解
  S=−(H/0.96)·ln((1−Zt/(2Z0))/0.48)；叠层口径 4 层 h=0.2（与 PDN 平面电容同
  假设）/2 层 h≈1.5 core——**2 层 90Ω 不可达时如实报告**（最低可达 Ω @ S=0.1）
- **耦合走廊转正**：pairBonus 从"贴邻折扣"升级为**设计间隙带**——伙伴网沿
  "中心距 (W1+W2)/2+S" 的环形带（梯度折扣：设计环 0.5/容差环 0.9）平行走线；
  带叠加合法性过滤（边距 <clr 的量化环剔除、焊盘归属/禁布格剔除——设计间隙
  在粗网格上最近量化格可能非法，实测教训）；无设计间隙（叠层不可达）回退贴邻
- **DRC 差分耦合度检查**：对内平行段处于设计间隙带的长度占比（双向采样取保守），
  低于 60% 告警并带阻抗口径（S/Z0/Ω）；目标不可达单独告警（2 层板如实提示）
- nets[].diffZ（目标差分阻抗，默认 90）；search-baseline 重定（crossing fixture
  用 pair，走廊行为变更合法）

### CLI
- `diffz <design> [--pair 名] [--z 90]`：逐对输出 Z0/未耦合 Zdiff/最低可达/
  设计间隙 S/奇偶模阻抗/可达性与建议；免责声明（经验公式，正式控制以板厂实测为准）

### 已知边界（诚实声明）
- 耦合走廊为**偏置式**（成本引导）：伙伴网收敛度受 A* 经济学与焊盘几何约束
  （焊盘间距 > 设计间隙时需收敛坡道），本版不强制收敛——规则驱动的对内压实
  （route 后成对重构）为后续项；端到端耦合占比以 DRC 耦合度检查如实度量
- 路由器既有缺口被走廊暴露：焊盘逃逸对角几何在紧间距下可产生走线-焊盘间距
  违规（无 pair 对照同样触发）——路由器级修复列入路线图

### 质量
- 新增 tests/diffpair.test.mjs 5 项：公式单调性/回代、不可达如实报告、
  走廊布线 DRC 干净、分离 pair 低耦合告警、CLI diffz；全量 307 项回归绿

## 0.3.3（2026-11-09）

等长蛇形检查轮：真实板验收暴露致命可用性缺陷并修复——**本轮之前 tune 在真实布线板上
完全失效**（单元测试全用手造直线路径，掩盖了问题）。

### 致命缺陷与修复
- **真实板无可用载体**：beautify 后路径全部为 0.25mm 步进段（轴/斜皆是），
  最长轴对齐直段 0.25mm < 最小 bump 需求 → tune 永远"无可用的直段空间"。
  修复合并拳：**候选/障碍扫描前先 mergePathPts**（磁盘结果存未合并逐步点——
  61 点合并为 11 点后 2.5mm 轴段/2.25mm 斜段一直在，只是没被读到）
- **45° 载体 bump**：真实路径以斜段为主——新增 45° 载体支持：振幅=整数步 m
  （jog 位移 (−sy·s·m·g, sx·s·m·g) 轴对齐、顶点全在格点），A=m·√2·g 精确计量；
  段级精确碰撞检查（_segPadGap + 逐段 segSegDist/segDist + blocked 采样）
- **四个拼接/口径缺陷**（真实板联调逐一揪出）：
  1. 拼接目标错误——候选在合并路径上找（si 为合并数组下标），插入却 splice 进
     未合并数组 → 法兰肯斯坦路径（长度 +31.4mm、几何非法、DRC +4 错）
  2. 走廊检查漏障碍物自身铜厚——异网走线半宽/过孔半径未计入（中心线口径），
     轴对齐与对角两套检查都修
  3. 对角量化振幅的 exact 过冲无上限（+14.75mm 塞进网里）——粒度 C=2m·stepAmp
     ≤2×缺口 + 过冲硬顶 max(4 步粒度, 10%Δ+2 步)，超顶 exact 直接弃选
  4. consider 取舍语义——exact 按过冲最小、partial 按 extra 最大、exact 胜 partial、
     ov 相等回退 Amax 裕量 tie-break；audit 同线共线段排除（相连铜≠耦合平行线）、
     扫描限定插入区外扩 2mm（既有扇出同网间距不污染口径）、drcErrors 改
     before/after 口径（脏板可比）
- **铺铜时效性**：tune 改路径 → 既有铜皮未避让新 bump 铜 → audit.stalePour 检测 +
  CLI note 提示重跑 pour

### 真实板验收（h2-stm32，gnd/3V3 标 pair）
- 3V3 62.095 → 78.759（目标 78.8，residual 0 精确命中，45° 载体单 bump）
- DRC errors 45→45（零新增，45 为该项目既有未连通）、等长 DRC 清洁、staleOk

### 质量
- serpentine 套件 16 项全绿；全量 302 项回归绿

## 0.3.2（2026-11-09）

等长蛇形深度优化轮：partner 纪律 + 自由子区间搜索 + 自审计闭环。

### 引擎（serpentineTune）
- **partner 纪律（SI 正确性）**：差分对伙伴的铜（段/焊盘/过孔）要求边到边 ≥ serpGap
  （3W）而非 clr——此前 bump 可以 0.05mm 贴着伙伴走（DRC 合法但对内几何劣化）。
  两区域检查：B=新增铜区（bump 包络减基线条带）按伙伴 serpGap/其余 clr 从严，
  L=既有基线条带（路由已合法）维持 clr 现状不误伤
- **自由子区间搜索（Allegro void avoidance 思想）**：走廊检查原为全段"全有或全无"——
  一个局部障碍（伙伴焊盘/过孔）废掉整段容量。改为按 minAmp 振幅逐列探测取最长
  自由子区间（≤2 个）分别二分振幅：partner 焊盘压在中点时自动用两侧自由区，
  2mm 碎直段也可承载合法 bump（子跨度 ≥ wMin 即可）
- **性能**：buildModel 提升到每次调用一次（原每轮重建，profile 17.8%）；障碍带
  bbox + 候选侧 bbox 预筛选（二分 18 轮只扫局部障碍）；整段精确命中快速通道
  （开阔场景零列扫描开销）。60 障碍网压场 107→56ms（含子区间搜索新能力）
- **audit 自审计闭环**：drcErrors（全量 DRC 错误数）/ staleOk（结果-设计同步）/
  finalLens（各组调后逐网长度）——报告即验收数据

### 质量
- 新增 4 项测试：partner 纪律（单侧受限如实跳过而非 0.05mm 贴脸）、换侧避开伙伴
  3W 带、子区间搜索（局部障碍不废整段）、audit 闭环；全量 302 项回归绿

## 0.3.1（2026-11-09）

等长蛇形借鉴轮：研读 KiCad pns_meander（本地源码）与 Altium/Allegro 长度调谐文档后的对标。

### 借鉴来源 → 落地
- **Altium 固定 Length 规则** → `tune --target mm`：绝对目标长度（不只"组内最长"）；
  **Allegro match group** 口径（组内对齐最长）保持为默认
- **KiCad/Altium Max Amplitude 参数** → `tune --max-amp mm`：振幅上限；受限时自动
  增加 bump 数（k=ceil(Δ/2Amax)）保持精确命中，无法再分时部分吸收+预算内残差如实报告
- **Altium "调谐段远离其它布线"** → 候选同容量时优先侧向净空更大者（弯更少、裕量更大）
- **KiCad pad-to-die** → 新字段 `nets[].padToDie`（mm，封装内走线长度，数据手册可查）：
  计入等长口径（DRC 检查与 tune 生成同尺）；helper `_groupLen` 与统计长度口径隔离
- **本工具证据分级哲学** → `tune` 报告自带 `audit`：等长 DRC 是否清零
  （eqDrcClean/eqDrcMsg）+ 调谐网平行动距最小值（minParallelGap，对照 serpGap）

### 调研未采纳（记录理由）
- Sawtooth 45° 模式（Altium 第三模式）：耦合更紧、与 3W 方波口径冲突，暂缓
- KiCad 圆角 80%（90° 弧）：Gerber 弧段输出是大改，本工具知识库（RTF2 实测）90°
  ≤1GHz 无差别，暂缓
- Allegro Auto Phase Tune（对内相位）：需要 pad-to-die/逐引脚时序数据，padToDie
  字段已铺路，完整相位调谐待后续

### 质量
- 新增 4 项测试：固定目标、振幅上限（精确命中+部分吸收双场景）、padToDie 换短网、
  audit 自审计

## 0.3.0（2026-11-09）

阶段一 #2：等长蛇形生成——补齐"检查已有，缺生成器"（roadmap #2 交付）。

### 引擎
- **serpentineTune**：对 pair（差分对）/lenGroup（等长组）组内短网，沿既有走线的
  轴对齐直段插入 90° 方波 bump，精确补长至组内最长网。口径与 DRC 等长检查同一把尺
  （netRoutedLen，同层段欧氏和）——生成后 ΔL=0，等长 DRC 通过（验收标准 1）
- **几何契约**：bump 顶点替换直线段中部、段端点不动 → 连通性/焊盘接触不变；
  水平覆盖不变（bump 顶边+段间基线=原跨度），垂直增量恰为 2A/bump → 补长 2kA
  精确命中 Δ。修复两处实测缺陷：路径重建丢段终点 b（断连风险）、bump 顶点未跟随
  段遍历方向（右到左段产生回头折线，长度爆炸 19.5→63.1——真实布线端到端测试抓出）
- **节距合规**（验收标准 2）：所有平行段边到边 ≥ serpGap（默认 3W 自耦合口径，
  可配 --serp-gap；有叠层信息建议 max(3W,3H)——Altium 教材）；bump 区离段端退让
  W/2+clr，振幅下限 W（矮于线宽几何退化），缺口 <2W 视为预算内不补偿并如实报告
- **空间检查**：bump 铜包络对异网铜/焊盘 ≥ clearance、本网其它段不重叠（本网焊盘
  为连接形态不算障碍）、模型 blocked（含板边带+禁布区）不侵入；free(A) 单调 →
  二分 18 轮求最大振幅；空间不足自动换段/换侧/部分吸收（每轮重扫候选，逐轮消化缺口）
- **lenGroup 等长组**（新字段）：nets[].lenGroup 组名，组内各网以最长网为目标；
  DRC 等长检查扩展到 lenGroup（与 pair 同预算口径：0.2×UI 或 ≤5%/2mm）

### CLI
- `tune <design> <result> [-o result2] [--pair 名] [--group 名] [--serp-gap 0=自动3W]
  [--tol 0.05]`：报告 groups/tuned（insertions 明细）/skipped（原因分级）；写回 result。
  工作流：route → tune → drc（勿在 tune 后再 beautify，45° 切角会削弯补偿长度）

### 质量
- 新增 tests/serpentine.test.mjs 8 项：精确补长+端点保持+等长 DRC 通过、节距合规、
  无碰撞、lenGroup 多网补齐、无空间如实跳过、确定性、CLI 端到端、真实布线验收全链

## 0.2.3（2026-11-09）

多边形覆铜深度优化轮：CPU profile 驱动（flood 33%→morph 38%→主扫描），加一次
真实板对拍抓出的洪泛完备性修复。h2-stm32 实测 solid 1106→599ms / grid 1017→516ms
（-46%/-49%），输出与 0.2.2 逐位一致。

### 引擎（computePour）
- **扫描线洪泛（run-based）替代逐格 BFS**：入队/出队与邻居检查以行段为单位，
  队列按需倍增；4-连通组件成员与逐格版严格一致（真实板对拍 diff=0 验证）。
  修复初版实现的完备性缺陷：初始段只吞"种子连段"而非"种子所在的最大可填充
  连段"——种子同行相邻的空闲格永远等不到垂直发现（h2-stm32 漏 45 格，测试板
  与 25 板模糊测试均未覆盖该形态，真实板对拍抓出）；固化为回归测试
- **形态学开运算重写**：垂直轴由按列扫描（stride-WF，5M 格逐格 cache miss）
  改为列计数器随行滑动（全行优先零跨步）；水平轴行内滑窗；固定窗口 2rc+1
  （板边带保证对 vis 格与裁剪窗口语义等价）。morph 相位 ~2×
- **网格铜缝合孔吸附条纹中心**：候选点先吸附到 k·P+gridW/2 再判 inPour——
  否则落空档的候选被静默丢弃（50×40 板实测 45 vs 80），吸附后覆盖率追平实心，
  全部落条纹交点且去重

### 质量
- 新增 2 项测试：扫描线洪泛等价性（种子同行邻格模式）、网格缝合孔吸附
  （覆盖率 ≥90% 实心 + 全部落条纹 + 去重）
- 全量 286 项回归绿；面积/确定性对拍逐位一致；CLI pour 输出补 minWidth/
  thermalActive 字段

## 0.2.2（2026-11-08）

多边形覆铜三轮优化：对标 KiCad（Clipper2 收缩-再膨胀）、Altium（Remove Dead Copper +
Minimum Width）、EasyEDA（最小优化宽度）的细颈/死铜处理语义。

### 引擎（computePour）
- **细颈消除（形态学开运算）**：`minWidth`（默认 0.25mm=KiCad `ZONE_THICKNESS_MM`，
  下限 0.025 同 KiCad `ZONE_THICKNESS_MIN_VALUE_MM`）。可分离盒结构元（前缀和 O(N)
  四趟）腐蚀→膨胀：窄于 minWidth 的铜颈/酸角尖坍缩消失——KiCad 用 Clipper2
  InflatePaths 负/正 delta 实现的收缩-再膨胀的栅格等价。开运算 ⊆ 原集合：
  间距契约与不越界性天然保持。焊盘/走线/过孔/缝合孔/筋条为本网真实铜，开运算后
  回填保护；与种子失连的残余碎片交孤岛策略（KiCad shrinkUnconnectedIslands 同源）。
  仅实心模式生效——网格铜条纹以自身线宽为最小厚度（KiCad hatch 口径）。
  实测 h2-stm32：死铜 −73mm²，窄颈/尖角全部消除
- **同网铜皮不参与避让（KiCad/Altium 同网 zone 独立填充语义）**：`avoidPours` 里
  同网铜皮跳过，本次铺铜从当前板态全新计算，孤岛去留由本次 islandMode 统一裁决。
  曾试验把旧铜皮并入种子（fill 层面融合），自查发现两个反例后否决：
  `--islands always` 重铺会救回旧保留孤岛（旗标失效）、`--fill grid` 重铺会保住
  旧实心区域（输出混合铜皮）——旗标可预测性优先
- **实心连接兜底**：筋条窄于 minWidth 时开窗必然产生不可靠连接（KiCad zone_filler
  "Cannot create stubs having a width < zone min thickness"）→ 热焊盘退化为实心连接，
  `thermalActive:false` 回传；EasyEDA COPPERAREA thermal 字段跟随
- 洪泛支持 keep 掩码参数（细颈消除后的保留域约束传播）

### CLI
- `pour` 新旗标 `--min-width 0.25`；帮助文本补细颈消除与同网合并说明

### 质量
- 新增 4 项测试：细颈消除（0.14mm 铜颈消除/关闭对照/开运算后间距契约审计）、
  同网合并（never 孤岛跨 always 重铺延续 + 无合并对照）、实心兜底
  （thermalActive/零开窗孔/面积=实心/正常筋条不受影响）、网格铜最坏位置过孔
  （四空格角点 Ø0.8>周期 0.508 仍单一连通铜皮）
- 全量 285 项回归绿；确定性复核逐位一致

## 0.2.1（2026-11-08）

多边形覆铜优化轮：研读 KiCad zone_filler.cpp（孤岛三档/筋条测试点/zone 优先级）、
pcb-rnd io_easyeda、嘉立创 DFM 工艺口径与 EasyEDA 铺铜文档后的对标实现。

### 引擎（computePour）
- **多铜皮互避**（KiCad zone priority 思想）：`opts.avoidPours` 让后铺铜皮挖空先铺
  铜皮本体 ⊕ clearance——修复同层铺第二块异网铜皮时与第一块重叠短路的真实缺陷；
  同网铜皮合并不挖。`r.pours` 数组承载历史铜皮，Gerber/SVG/PNG 支持多铜皮数组渲染
- **孤岛策略三档**（KiCad ISLAND_REMOVAL_MODE）：`islandMode: always|area|never` +
  `minIslandArea`（mm²）；保留的孤岛进入输出多边形并计数（islandsKept/keptIslandArea），
  DRC 明确提醒天线风险。修复：孤岛收集原用 DFS 栈复用 q，组件被覆盖产生幽灵单格
  多边形——改 BFS（压入位置不复用，q[0..n-1] 恰为完整组件）
- **焊盘铜皮接入检测**（KiCad 筋条末端测试点法的环带版）：证据=筋条末端以外环带内
  的本网铜（排除焊盘本体/自身筋条走廊/孤岛格）；筋条全被截断或四周被挖空的焊盘
  输出 `unconnectedPads`，DRC 报警"铜皮接入失败"
- **网格铜 hatch**（EasyEDA fillStyle 'grid' / 嘉立创"大铜面网格防起泡"口径）：
  `fill:'grid'` + gridW/gridGap（钳制 ≥0.254mm=10mil）；焊盘/走线/过孔/筋条保持实心
  （KiCad hatch 同款），条纹断裂处重洪泛取真实连通性，断裂条纹按孤岛策略处理
- **参数化**：`clearance`（铜皮间距类覆盖）/`edgeMargin`（板边带，默认 0.2 与布线模型
  同口径；嘉立创建议带电铜皮距板边 ≥0.3mm 时可调大）
- **轮廓跟踪鞍点修复**（模糊测试 it20 实证）：鞍点选边原取最大 turn 值=最左转，把
  本应拆分的两个环合并成自接触环——改为右转优先（右1>直0>左3）。新增 `_pourSelfX`
  环自交检测：DP 弦线若仍自交则容差逐级减半重简化，最终回退原始楼梯环（构造上简单）
- **性能**：洪泛邻居检查内联（去掉每格 4 次闭包调用）、孤岛栈与洪泛队列复用同一
  Int32Array、挖空场合成合并为单次遍历。98 焊盘板 862→698ms（含新功能开销；
  同口径对比 464ms 为无新功能版本），200 焊盘 100×80 实心 606ms / 网格 1017ms

### CLI
- `pour` 新旗标：`--islands always|area|never`、`--min-island-area`、`--fill solid|grid`、
  `--grid-w`、`--grid-gap`、`--clearance`、`--edge-margin`；输出 islandsRemoved/
  islandsKept/unconnectedPads/fill/pours；`r.pours` 历史铜皮维护（同网同层重铺幂等替换）
- `export easyeda`：COPPERAREA fill 字段跟随（solid/grid），keep_island 跟随 islandMode
- `export gerber/svg`：多铜皮数组渲染

### 质量
- 新增 tests/pour-optimize.test.mjs 7 项：多铜皮避让（含无避让缺陷对照）、孤岛三档、
  筋条截断报告、网格铜（条纹/实心/钳制/缝合孔落铜）、参数化、**模糊测试 25 块随机板**
  （环自交全查 + 间距契约边界采样审计 + 统计自洽）、DRC 铜皮来源归一化——
  模糊测试当场抓出鞍点合并与孤岛栈覆盖两个真 bug
- **自查修复：CLI drc 铜皮审查死代码路径**——checkDRC 此前只认 opts.pour，CLI 命令
  `drc` 从不传入 → 回流地孔/孤岛/接入失败报告在 CLI 全部失明。现在铜皮来源归一化
  （opts 显式传入优先，result.pours/result.pour 兜底，按 netId@layer 去重），回流检查
  按网络匹配地铜皮，孤岛/保留孤岛/接入失败逐块铜皮报告（带网络名）
- **自查修复：EasyEDA 多铜皮导出缺口**——exportEasyEdaPcb/verifyEasyEdaExport 支持
  铜皮数组（逐块 COPPERAREA，fill/keep_island 各自跟随），CLI export easyeda 传
  r.pours；VRF-POUR 对账升级为数量+逐网络核对
- **二轮自查修复：其余单铜皮假设清零**——CLI export gerber/svg 此前也只渲染主铜皮
  r.pour（多铜皮时其余层铜皮丢失），改传 r.pours；powerDrop 铺铜入口判定与
  autoReturnVias 回流覆盖改为认 r.pours 中该网任一铜皮（宽松 netId 口径，退化
  pour 对象与旧结果兼容）。双铜皮 e2e：GND 底层+VCC 顶层 → Gerber 两层各有铜皮、
  EasyEDA 两条 COPPERAREA（层号正确）、verify 对账通过
- 全量 281 项回归绿

## 0.2.0（2026-11-08）

阶段一 #1：多边形覆铜——替换栅格条带近似，铺铜输出升级为真实多边形。

### 引擎
- **多边形覆铜**（roadmap 阶段一 #1）：细格精确距离场（导体 ⊕ clearance 的 Minkowski
  偏移：胶囊走线/圆角焊盘/圆过孔/禁布区，行扫描解析式填充）→ 洪泛定拓扑
  （连通性/孤岛去除/热焊盘）→ 活动边轮廓跟踪出环（铜在右规则 + 鞍点最右转，
  环不自交）→ Douglas-Peucker 简化 → 外环/孔分组输出 `pour.polys`
- **间距契约**：挖空阈值 T=clearance+0.707·cell（细格对角可达半径），铜皮任意点到
  异网导体距离 ≥ clearance（方向保守）；典型富余 ≤1.2·cell（cell=clamp(min(clr,grid)/5,
  0.015,0.1)mm，12M 细格上限自动放粗）。实测 98 焊盘板 926ms / 45 孔 13718 顶点
- **热焊盘**：环形开窗（thermalGap，默认 clearance+0.25）+ 4 条实宽轴向筋条
  （spokeW，默认 max(网线宽,0.3)）——筋条不再受布线栅格量化；开窗不挖本网铜
  （焊盘本体/穿过环带的本网走线保持铜），筋条被异网导体截断方向自动放弃
- **异网泪滴避让**：computePour 接受 teardrops，楔形 ⊕ clearance 参与挖空
  （归属按基边中点匹配过孔），覆铜不再与异网泪滴交叠（books 测试从空转变真检查）
- 几何辅助导出：pourContains（射线法偶奇）/ pourNear（点在铜内或距边 ≤reach）/
  inPour 重写为多边形口径；autoReturnVias 回流覆盖、DRC 回流地孔检查、
  缝合孔规划、powerDrop 铺铜入口判定全部切换多边形口径

### 交付与互通
- **Gerber**：覆铜区输出多边形极性区域——外环 LPD 暗画、孔 LPC 清除画（KiCad
  同款 RS-274X 手法），区域闭合坐标 2.6 整数格式
- **EasyEDA**：导出 COPPERAREA 覆铜区（字段序经 pcb-rnd io_easyeda 解析器核实：
  stroke_width~layer~net~path~clearance~fill~id~thermal~keep_island~zone~locked；
  存区域+参数，嘉立创EDA 打开后自行重铺）；verify 回读新增 VRF-POUR/VRF-POUR-NET/
  VRF-POUR-EXTRA 对账
- **渲染**：PNG 栅格化改逐行偶奇填充（与 Gerber 同源）；SVG 单 path evenodd；
  GUI 画布 Path2D evenodd；buildSVG/CLI export svg 携带铜皮

### 质量
- 新增 tests/pour.test.mjs 12 项：间距保证与贴紧性（边界采样审计）、热焊盘
  环形开窗/筋条连通/宽度定制、孤岛去除、Gerber LPD/LPC 结构与区域闭合、
  EasyEDA COPPERAREA 字段与 verify 对账、缝合孔落铜、渲染像素、45° 胶囊、
  异网泪滴避让、未知网空输出、大板细格自动放粗
- 既有覆铜测试全部改写多边形口径（router/books-insights/canvas-style），
  全量套件绿（含 11 轮 182 项目回归）

### 已知边界（诚实声明）
- 覆铜挖空边缘为多边形弦线近似（DP 容差 ≤cell/3 ≈0.013mm，弧段呈弦——
  与 KiCad 弧段摊平同口径）；EasyEDA 侧 COPPERAREA 打开后由嘉立创引擎重铺，
  与本引擎铺铜结果存在正常差异

## 0.1.0（2026-11-08）

首个版本化发布。从原型到工具级的 11 轮实测迭代（182 个实战项目）全部收敛于本版本。

### 引擎
- 布局：多重启模拟退火（货架初始排布、逃逸口袋罚、边缘间距梯度罚、罚金常数下限、
  真铜属主恢复、薄焊盘格心保障、停滞自适应重启、热点反馈、元件自动旋转）
- 布线：A* 迷宫（八方向、分层首选方向、45° 斜向）+ RMST 斯坦纳分解（Dreyfus–Wagner）
  + PathFinder 协商拥塞 + 历史最优保留 + 停滞解僵局 + 逐网优化器 + 弦拉直/45° 美化
  （精确线段距离审查）
- 检查：DRC（连通/间距/焊盘/出板/禁布/过孔/环宽/孔边距，多层语义）+ 嘉立创 DFM
  （铜厚感知）+ 投板检查表 + 3W/回流地孔/差分等长/孤岛报告 + ERC + IR-drop + PDN
- 影响区模型六件套与 DRC 契约对齐：焊盘 halfClr / 圆焊盘外接方形 / 禁布缓冲带
  （maxTrackW/2 + 真铜格豁免）/ 板边 0.2 带 / 真铜属主 / 零格焊盘保障
- 性能：A* 类型化堆 + ownStamp 成员戳 + 距离图内联（实测 4-12% 提速，输出逐位一致）

### 交付与互通
- 嘉立创EDA（标准版 PCB JSON + 原理图）、Gerber RS-274X 八件套（含覆铜/泪滴/多刀钻孔）、
  Excellon、IPC-D-356A、SVG/PNG、KiCad .kicad_pcb 导入、Specctra DSN/SES（Freerouting 互通）
- LCSC 器件库（C 编号真符号+真封装）、嘉立创 SMT BOM/坐标
- AI 代理无头 CLI：schema/rules/spec/erc/place/autopcb/route/drc/advise/verify/pour/drop/
  pdn/render/export…（证据分级：deterministic / datasheet-backed / book-backed / heuristic）

### 质量
- 261+ 项回归（核心/几何/可靠性/HTTP/搜索/布局规则/制造规则/书籍知识/CLI/模糊/深度校验/
  优化锁定 22 项），模糊测试畸形输入零崩溃
- 11 轮 182 个实战项目实测（报告见 docs/），四条参数空间定量曲线（板幅/栅格/密度/网数）
- spec 门六项前置拦截（坏引用/单脚网/空网/同元件间距/出板含半孔豁免/THT 环宽/零格覆盖）

### 已知边界（诚实声明）
- ~~栅格布线器~~（栅格协商为主 + 0.13.0 形状补线双引擎）；~~无盲埋孔/HDI~~（0.13.1
  数据模型/DRC/导出三层 + 0.13.18 自动生成）；~~差分对为 lite~~（0.4.0 奇偶模阻抗
  + 耦合走廊 + 0.13.27 强制压实）；~~无等长蛇形自动生成~~（0.3.0 serpentineTune）；
  ~~覆铜为栅格条带近似~~（0.2.0 多边形覆铜）；重板收敛（0.25 grid、45 网双域 3.4h）
  ——0.6.0 候选级/协商内并行已交付（5.08×）
- 定位：学习/工具级布线器。复杂高密度板建议专业 EDA，或配合 KiCad/立创 互通使用。
  （本段由 0.14.0 按 0.13.x 审计 F-e 重写——0.1.0 时点的边界陈述与 2026-11-14
  现状逐条对齐，解决版本可查）
