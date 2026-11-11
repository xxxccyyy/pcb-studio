# Freerouting 源码研读笔记 —— 以及它如何改进了本工具

> 研读对象：[freerouting/freerouting](https://github.com/freerouting/freerouting) master 分支
> commit `2eba6f7f`（2026-10-27），完整克隆位于本机 `D:\PCB软件设计\study\freerouting`。
> 本笔记遵循研究文档的证据分级约定：**【源码实证】**= 从源码逐行核实；**【厂商公开】**= 来自厂商公开资料；**【推断】**= 我们的推断。

---

## 1. 为什么研读 Freerouting

Freerouting 是目前应用最广的开源自动布线器（Specctra 兼容，KiCad/Eagle/Altium 均以它为标准外挂）。它的引擎与我们同为"A\* 搜索 + 拆线重布"范式，但有十年以上的工程打磨。逐行读它的布线引擎（`src/main/java/app/freerouting/autoroute/`），把可移植的思想移植进本工具，是本轮改进的出发点。

## 2. 引擎架构总览【源码实证】

```
RoutingPipeline（总指挥）
 ├─ TwoLayerBga / ExitStubs        预处理：双层 BGA 免扇出、细间距引脚"出口短桩"
 ├─ BatchAutorouter.runBatchLoop
 │   ├─ BatchFanout                SMD 引脚扇出（逃逸到第一个过孔即停）
 │   └─ AutorouteBatchLoop         pass 主循环 + 板历史回滚 + 双重停滞检测
 │       └─ AutoroutePassRunner    单 pass：排序 → 逐网调用连接路由器
 │           └─ AutorouteConnectionRouter  单连接：迷宫搜索 → 颈宽重试 → 严格 DRC
 │               └─ MazeSearchEngine       房间-门图上的 A*（核心搜索）
 ├─ RoutingFallbackRunner          命名回退策略（整板重跑、对比择优）
 ├─ RoutingSupervisor              UCB1 多臂老虎机自动挑参数扰动
 ├─ BatchOptimizer                 布线后优化器（逐项拆-重布）
 ├─ releaseExitStubs               短桩解固定
 └─ DanglingCopper                 悬空铜清理（最多 16 轮迭代拆尾）
```

与我们架构最大的差异：Freerouting 的搜索空间不是均匀网格，而是**精确几何的房间-门图**（expansion rooms，`autoroute/expansion/` 包）——走线可以走任意位置，代价是几何切割复杂。我们用均匀栅格，牺牲位置自由度换取实现简单和可预测的 DRC。

## 3. 值得学习的机制（按价值排序）

### 3.1 拆-重布优化器（BatchOptimizer）——已移植 ✅【源码实证】

`autoroute/pipeline/BatchOptimizer.java`（1375 行）。要点：

- **唯一原子操作**："拆一个过孔/走线及其接触连线 → 加价重布 → 与优化前比指标"。消过孔、消孤线都由"拆掉后重布不再放回"自然实现。
- **接受准则是字典序且绝不退步**（`ItemRouteResult.compareTo`，ItemRouteResult.java:69-90）：开路数先比 → 开路平比过孔数 → 过孔平比线长。注释原话："完整性和 DRC 数是否决票；分数只做排序"。
- **过孔优先**（ReadSortedRouteItems，:1298-1319）：同一位置先扫过孔再扫走线——先试消孔；与过孔相连的走线跳过（会随孔一起重布）。
- **奇偶轮切换首选方向**（:406，`pass % 2 != 0`）：注释"to create more variations"——同一连接在不同轮得到几何形态不同的重布候选。免费的多样性来源。
- **连续失败熔断**（:761-771）：第 1 轮连续 12 项无改进、之后 50 项 → 提前结束本轮。
- **拆走线比拆过孔便宜**（DefaultSettings.java:253，`traceRipupCostFactor=0.6`）——鼓励动线保孔。
- **四道防线层层设防**：单项字典序 → pass 级三否决（连通回退/DRC 回退/分数不升，:590-606）→ 单轮只落一个最佳候选 → 收尾回滚历史最优。设计哲学："**宁可少改进也绝不退步**"。

**移植**：本工具新增 `session.optimize(maxPasses, onStep)`（逐网粒度）：过孔多的网优先重布，接受准则 = 连通不降 → 冲突不增 →（未连减少 / 过孔严格减少 / 过孔平且线长严格减少），否则整网回滚快照；奇偶轮切换首选方向；连续失败熔断 12/50；整轮无改进即停。UI 在整板重跑候选之后追加这一步。

### 3.2 跨障按"障碍"计费而非按格计费（ALREADY_RIPPED_COSTS）——已移植 ✅【源码实证】

`autoroute/maze/MazeRipupResolver.java:92-94`：路径**连续**穿越同一个已被拆走的障碍时只付 1（`ALREADY_RIPPED_COSTS=1`），不重复付全额。跨不同障碍才付全额 `ripupCosts = 预算 × 半宽系数 / 该连接的绕行比`（:96-168）。

栅格路由的天然缺陷是把"借道一根被拆走线 30 格"算成 30 次全额罚，代价失真。**移植**：A\* 边代价中，若上一步所在格已处于被其它网络占用的状态（正在连续穿越同一拥塞区），后续格子按折扣计费（`1 + presFac×(其余占用数-1)`），入口格仍付全额。

### 3.3 确定性洗牌解僵局——已移植 ✅【源码实证】

`autoroute/pipeline/AutoroutePassRunner.java:285-301`：停滞 ≥2 轮后，用种子 `passNo×1000003 + maxNetNumber` 做**确定性洗牌**打破振荡——既解僵局又可复现（注释明确禁用了"同哈希早停"，因为预算和种子每轮都在变，同状态后续仍可能进步）。同类思路还出现在 BatchFanout 的振荡检测（:139-159，`(routedCount<<32)^viaCount` 指纹连续 3 轮相同即停）。

**移植**：本工具协商阶段统计"总未连数"连续 2 轮不降即以 `轮次×1000003+网络数` 为种子洗牌重布队列（`detShuffle`，LCG 实现）。

### 3.4 ripup 预算线性增长【源码实证】——评估后未移植

Freerouting 的跨障预算 = `startRipupCosts × passNo`（**线性**，AutorouteConnectionRouter.java:44-45；默认 start=100，DefaultSettings.java:62），配合"逐 pass 时间预算指数翻倍"（`100000ms × 2^(pass-1)`，:71-73）。我们用 PathFinder 经典的 presFac 翻倍 + 历史项，实测收敛良好（压力板 2.5mm 通道 8 网 0 冲突），故保留原方案，但线性预算是值得记住的替代设计。

### 3.5 可采纳启发：多过孔假说取最小【源码实证】——我们已等价拥有

`autoroute/maze/DestinationDistance.java` 按"0/1/2/3/4 个过孔"假说枚举跨层路径取最小值作下界（含 0.8× 乐观过孔价）。我们的 `computeH` 是目标集合到全场的**多源 BFS 下界**（把过孔边也纳入 BFS），是同样的"忽略障碍、承认换层"思想，且逐格精确——不劣于 Freerouting 的盒近似，无需改动。

### 3.6 过孔价随物理尺寸、SMD 网折扣【源码实证】——未移植（单值模型）

`minNormalViaCost = viaCosts × max(maxViaRadius,1)`（AutorouteControl.java:390-403）；纯 SMD 网络再 ×0.1；平面网过孔另有低价（viaCosts 50 vs planeViaCosts 5，DefaultSettings.java:48,54）。我们有单一 trackW/viaOuter，暂无多网络类模型，故只在文档记录。

### 3.7 编排层的"顺序本身就是算法"【源码实证】——部分借鉴

- 平面网络/电源网络排最前（BatchAutorouter.java:527-529，理由：先放短柱留出逃逸走廊）；
- 上一轮未连完的"顽固网"优先重布（AutoroutePassRunner.java:302-323）——我们已有 failed-first 等价物；
- BGA 球**内圈先逃逸**（BallEscapeOrder：2 层板 auto=inner_first，"出路最少的球先拿走自己的出路"）；
- 扇出引脚 outer_first / 周边密度优先（BatchFanout.java:809-830）；
- 细间距 QFP"出口短桩"（ExitStubs.java，1634 行）：预判间隙裕量紧张的最外排引脚，把唯一出路先钉成固定铜，布完再解除——最精华也最重工程，暂未移植。

### 3.8 其余值得记录的设计【源码实证】

- **板历史回滚**：≤30 张带分数的板快照，每 4 个 pass 检查一次"当前是否不如历史最优"，是则回滚重来（BoardHistory.java + AutorouteBatchLoop.java:367-414）；
- **pass≥3 强制严格 DRC**：新布铜带间距违规就整批拆掉记失败（BatchAutorouter.java:404-428）；
- **命名回退策略 + UCB1 探索**：失败后按 {换种子、邻域拆铜、颈宽 100µm、过孔÷2/4/8、过孔×2/4/8} 自动选招（RoutingFallback.java / RoutingSupervisor.java:77-142）——我们 UI 里的"整板重跑候选 + 字典序择优"是其简化版；
- **Last-mile 拆障**：只剩 ≤8 条未连且停滞时，直接拆掉压在航空线走廊上的他网铜（LastMileBlockerRipup.java）；
- **颈宽重试**：布不进焊盘的连接用更细线宽再试一次，成功后该网记住用颈宽（AutorouteConnectionRouter.java:165-190）。

## 4. PCB Auto Router 调研结论【厂商公开】

- **闭源商业软件**（Windows .exe / Linux .deb + KiCad/EasyEDA 插件），无源码可学。
- 公开定位：GPU 加速 + 强化学习布线引擎、Specctra DSN/SES 工作流、差分对与蛇形等长、全本地运行、以 Freerouting 为对标。
- 可借鉴的是**产品形态**而非算法：① DSN/SES 互导是与专业 EDA 工具互通的标准接口；② 差分对/等长是高频需求；③ "不产生冗余过孔"是核心卖点——与我们这次"消孔优先"的优化器方向一致。
- 检索过程：官网 TLS 直连失败（ECONNRESET），经网页快照与多轮搜索确认无公开代码仓库；同类的 Quilter.ai 同为闭源；开源替代可见 PCBfy（github.com/niranjan22oh/PCBFy，实验性）。

## 5. 本轮落地的改进清单（全部有测试覆盖）

| 改进 | 源码依据 | 本工具位置 |
|---|---|---|
| 逐网拆-重布优化器（消孔优先 / 字典序绝不退步 / 奇偶轮方向 / 失败熔断） | BatchOptimizer.java | `createSession().optimize()`，UI postroute 末段 |
| 跨障按段计费（连续穿越同一拥塞区折扣） | MazeRipupResolver.java:92-94 | `astar()` 边代价 |
| 停滞 ≥2 轮确定性洗牌（seed=轮次×1000003） | AutoroutePassRunner.java:285-301 | `step()` 协商段 + `detShuffle` |
| 整板重跑候选加入"无首选方向"变体 | RoutingSupervisor.java:126-130（过孔/参数扰动探索思想） | `runRoute()` 候选表 |

验证：单元测试 41/41 通过（新增 4 项：三示例板优化后不退步、优化后间距审计合规、双跑逐字节一致、优化后会话可继续操作）；基准脚本 `tests/bench-opt.mjs` 显示 3 块示例板与 2.5mm 通道 8 网拥塞压力板在优化器下 **0 退步**（已收敛板上零改进是预期行为——这正是 Freerouting 保守接受准则的本意）。

## 6. 评估后暂不移植的技术（留档）

| 技术 | 不移植原因 |
|---|---|
| 房间-门图精确几何搜索 | 实现复杂度高一个量级；栅格模型已保证 DRC |
| shove（推挤让路） | 需要几何平移验证器；栅格模型下收益有限 |
| ExitStubs 出口短桩 / BatchFanout / BGA 逃逸序 | 示例板与目标场景（双层教学/中等密度板）无 BGA/细间距 QFP；工程量大 |
| DrillPage 两级过孔候选 | 栅格模型过孔候选天然有限 |
| 多网络类（净类）代价体系 | 设计数据模型暂无 net class |


---

## 二轮研读（用户下载版 freerouting-master）：DSN/SES 文件格式与互操作落地

用户提供了完整下载副本（`D:\PCB软件设计reerouting-master`，与首轮克隆的 autoroute 包逐字节一致，同版本 master）。本轮精读首轮未覆盖的 **io/specctra 包**（DsnReader/SesReader/SesWriter + parser/ 下 40 个语法类，约 2900 行），提炼出 Specctra 文件的精确文法（20 条 reader 坑位清单，见研究笔记），并落地为工具的互操作能力：

| 实现 | 依据 | 位置 |
|---|---|---|
| **导出 DSN**：板框/层/padstack（含 smd vs 通孔的层覆盖语义）/placement/library/network/wiring（手动走线+缝合孔为 fix） | parser\Structure.java、Library.java、Network.java、Component.java、Wiring.java | `exportDSN()` |
| **导入 SES**：wire→手动走线、via→换层点合并、未知网络跳过计数 | SesReader.java:334-609（只认 path、坐标须整数板坐标、net 按名+子网 1 匹配） | `importSES()` |
| 坐标刻度：DSN 数值=µm（resolution um 10）；SES 数值=DSN×R（经 fixtures/Issue026 实样交叉验证：DSN 250 ↔ SES 2500） | CoordinateTransform.java + 实样 | 换算函数 |

**新工作流**：画板（或 KiCad 导入）→「导出 DSN」→ Freerouting 打开布线 →「导入 SES」→ 铺铜/DRC/导出 Gerber。工具由此接入 Freerouting 生态——这正是此前调研 PCB Auto Router 时确认的行业互操作标准（DSN/SES）。

实现中发现并修复：① SES 过孔合并后 wire 被误标记 used 导致结果丢失；② 换层点层号在合并时丢失；③ padstack/引脚名含下划线或数字开头时按 Freerouting IdentifierType 规则加引号。

## UI 渲染借鉴（2026-11-08，gui/rendering 三文件精读）

对 `BoardRenderer` / `GraphicsContext` / `ColorIntensityTable` / `ItemColorTableModel` 的渲染专项研读，落地到本工具画布（src/ui.js renderScene）：

- **默认配色表**（ItemColorTableModel）：顶层走线 #C83434、底层 #4D7FC4、焊盘 #E3B72E、内层六色循环（#7FC87F/#CE7D2C/#4FCBCB/#DB628B/#A7A5C6/#28CCD9）——本工具画布与 PNG 像素渲染已对齐（含 router.test 像素断言同步）。
- **铺铜斜线纹理**（GraphicsContext.prepareAndDrawHatch）：45° 反对角 1px 线 tile（TexturePaint 平铺）+ 沿区域轮廓 2×pitch 描边 + ColorIntensityTable 强度 0.2。本工具以 `createPattern` + `setTransform(1/pxPerMM)` 实现**屏幕恒定 8px pitch**，任意缩放不糊；条带近似下不描外轮廓（轮廓需多边形并集，留档）。
- **过孔随层色**（BoardRenderer.drawColors case VIA → getTraceColors）：过孔铜环按所在层走线色绘制（底层先画、顶层后画、钻孔最后统一画），不再用独立金色——两遍层色画法已实现，层开关（顶层/底层显隐）对过孔同样生效。
- **不透明度表**（ColorIntensityTable）：TRACES/VIAS/PINS=1.0、CONDUCTION_AREAS/KEEPOUTS=0.2、HIGHLIGHT=0.8、INCOMPLETES=1.0——本工具按深色底视觉校准为铺铜 hatch alpha 0.5（20% 强度在浅底与 50% 在深底观感对齐）。
- **预拉线**（NetIncompletesGraphics）：实心 1px 细线（非虚线）——已改为白色 55% 实心细线。

### 补充：底色体系核实（2026-11-08 第二轮）

首轮借鉴只对了色值没对底色——用户对比后指出"还是不像"。复读 `OtherColorTableModel` 与 `BoardPanel`：
- **板面 BACKGROUND = (0,16,35) 深藏青**（不是绿/不是白），桌面（BoardPanel）纯黑
- **INCOMPLETES = Color.white** 实心细线（白色在深藏青上才可读——这正是 FR 预拉线白色的原因）
- **OUTLINE = (100,150,255) 浅蓝**；KEEPOUTS = (26,196,210) 青
- CONDUCTION_AREAS 逐层：层0 (0,150,0) 绿 / 层1 (100,100,0) 橄榄——20% 强度 hatch 在深藏青上即 FR 标志性的"暗绿斜线"

已全面对齐：板面/板框/桌面/禁布区/铺铜 hatch 色全部改为 FR 原值，图例与像素渲染（AI 视觉自检）同步。教训：**借鉴配色必须连同底色一起借**——同一色值在不同底色上观感完全不同。
