# 更新日志

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
- 栅格布线器；无盲埋孔/HDI；差分对为 lite（等长检查+对内豁免，无耦合阻抗布线）；
  无等长蛇形自动生成（roadmap）；覆铜为栅格条带近似（多边形覆铜 roadmap）；
  重板（0.25 grid、45 网、双域扇出）协商收敛 3.4h 级（性能 roadmap）
- 定位：学习/工具级布线器。复杂高密度板建议专业 EDA，或配合 KiCad/立创 互通使用。
