# awesome-electronics 通读笔记与感悟

> 通读对象：[kitspace/awesome-electronics](https://github.com/kitspace/awesome-electronics)（clone 于 `D:\PCB软件设计\study\awesome-electronics`，2026-10 master）。
> 完整读完了仓库的全部实质内容：**README.md 全部 19 个分类、约 150 个条目**（含阿拉伯语区），以及 contributing.md 的收录准则。未逐一点开 150 个外链——对与本项目直接相关的条目（EDA 软件、板厂、计算器、封装库）做了外部核实，来源已在文中标注。
> 证据分级沿用约定：**【已核实】**=本轮点开/搜索核实过；**【清单原文】**=awesome-electronics 里的描述；**【感悟】**=我的推断。

---

## 一、这份清单长什么样

19 个分类，按工程师的实际工作流排布（我重排成链路视角）：

| 环节 | 清单中的分类 | 代表条目 |
|---|---|---|
| 学 | Learning（教程/课程/理论/大学课程档）、Blogs、Forums、Podcasts、Videos | Khan Academy EE、NEETS 海军教材、Lessons In Electric Circuits、EEVblog、Robert Feranec（100+ PCB 布局技巧视频） |
| 画原理图 + 仿真 | Simulators、Documentation | LTspice、ngspice、Falstad（电子流动可视化）、Qucs 家族、Verilator、WaveDrom |
| 布局布线 | Free/Paid EDA Packages、CAD Specific | **KiCad（"push and shove router"）**、Eagle、DesignSpark、CircuitMaker、gEDA、LibrePCB、Horizon EDA、**EasyEDA（集成 LCSC/嘉立创器件库）**、tscircuit（用 React 写 EDA） |
| 看图/查错 | Gerber Viewers、KiCanvas | Tracespace、Gerbv、ZofZPCB（3D）、KiCanvas（纯前端 KiCad 查看器） |
| 器件 | Part Search Engines、SnapEDA、3D 模型 | Octopart、Component SearchEngine（免费符号/封装/3D）、SnapEDA、SMD 丝印反查 |
| 制造 | PCB Batching Services | **JLCPCB**、OSH Park、PCBWay、Aisler、PCBShopper（比价） |
| 装配/管理 | InteractiveHtmlBom、KiBot、Inventory | InteractiveHtmlBom（手工贴片 BOM）、KiBot（脚本化出制造文件）、PartsBox/InvenTree |
| 分享/周边 | Project Sharing、Dev Board Retailers、订阅盒、其它清单 | Kitspace、Hackaday.io、SparkFun/Adafruit、awesome-embedded-systems 等 8 个二级清单 |

收录准则（contributing.md）很有意思：**禁止自我推销**——条目必须与提交者无利益关联。这保证了清单的独立性（清单作者 Kitspace 自己的站点也只放在"Project Sharing"一节正常收录）。

## 二、十条感悟

**1. 整个清单暴露的是"工作流"，不是"工具列表"。**
从 Learning → Simulators → EDA → Gerber Viewer → Batching → BOM/Inventory → Project Sharing，正好是一条"学会 → 设计 → 验证 → 布线 → 打样 → 贴片 → 分享"的完整链路。每个环节都有至少一个免费选项——**电子设计全流程的免费化已经完成**。我们的工具恰好卡在"布局布线"环节（清单里 free EDA 一节每个软件的子能力），这验证了它的定位，也提醒它不能孤立存在。

**2. 我们的工具在生态里对应的位置非常清晰，且有两个天然邻居。**
Gerber Viewers（Tracespace/Gerbv）在我们**下游**（我们导出 Gerber，它们查看）；InteractiveHtmlBom 在我们**再下游**（打样回来手工贴片时的 BOM 对照）。而我们缺**上游**（原理图/网表）——目前靠 KiCad 导入器弥补。感悟：一个单环节工具必须把"上下游接口"做得极好才能活，这正是 PCB Auto Router 卖点里 DSN/SES 互操作性的同款逻辑。

**3. "浏览器内 EDA" 是被生态承认的形态，我们是这个谱系的极端。**
清单里 EasyEDA（浏览器起家）、tscircuit（React 组件写电路）、KiCanvas（纯前端查看器）、Falstad（在线仿真）都成立。我们的单文件零依赖 HTML 是这个谱系里最激进的一档——好处（双击即用、无安装、可离线）在清单里每一个成功条目上都有对应体现（Falstad 的即开即用、KiCanvas 的零安装）。**感悟：单文件不是玩具特征，是分发优势。**

**4. KiCad 在清单里的描述只有一句，但正好是我们的对标句。**
"Open source EDA package with **push and shove router**, differential pairs and much more"——对普通用户来说，KiCad 的辨识点就是它的布线器。我们把五个一线布线器的精华（Freerouting 协商/KiCad 弦拉直/FlexDR 衰减）已经移植进来了，在"自动布线质量"这一个点上，我们做的事在生态里有真实的位置。

**5. 板厂一节=DFM 数据的原始出处，多厂支持是低成本高价值的完善方向。**
PCB Batching Services 列了 6 家。我们只内化了嘉立创的参数表（用户的研究文档）和检查表。本轮核实了 [OSH Park 双层规格](https://docs.oshpark.com/services/two-layer)（min 线宽/间距 6mil=0.15mm、min 孔 13mil=0.33mm）与 [PCBWay 工艺能力](https://www.pcbway.com/capabilities.html)（极限 0.1mm 线宽/间距、0.15mm 孔、建议 6mil 以上）——**各厂数值差异不大但语义不同（极限 vs 建议）**，做"多厂预设"比做"多厂检查表"务实：预设给安全值，检查表保持嘉立创（用户的板厂）。

**6. 计算器类工具自成一类，说明"小计算"是刚需。**
Saturn PCB Toolkit（清单评价"the best freeware resource for PCB related calculations"）和 NinjaCalc 本质就是一堆小计算器：载流、阻抗、过孔电阻、走线温升……我们刚做的载流+阻抗计算器正是同类。**感悟：这类功能用户粘性极高、实现成本极低**，可以继续加：过孔电阻/压降、走线电感/电容估算、串阻匹配计算。

**7. 封装库是被清单提到最多的"痛点型"基础设施。**
SnapEDA（免费符号/封装）、Component SearchEngine（同）、Adafruit/SparkFun 库、Kitspace 自家的 kicad_footprints 收藏——四条条目都在解决"拿到一个器件怎么变成焊盘"。我们上一轮做了 KiCad 导入，但纯手工设计时放焊盘仍然太慢，本轮补的**常用封装生成器**（0402~1206/SOT/SOIC/DIP/排针，IPC-7351 nominal 参考值，来源 [JLCPCB 封装尺寸指南](https://jlcpcb.com/blog/the-complete-guide-to-smd-resistor-package-sizes)）直击这个痛点。

**8. 学习资源的密度提醒我们：这个工具的教学价值本身就是功能。**
清单 19 类里"学"占了 5 类。我们工具里已有的"布线规则速查（可靠/有条件/勿信）"、嘉立创检查表、每网绕行比，本质上都是教学资产。可以更进一步：把工具的每次布线结果变成教学案例（为什么绕了、哪个孔省了）—— partly 已有（统计面板），值得保持。

**9. 参与生态的方式是"被 awesome 收录"，而收录标准对我们有利。**
contributing.md 只要求：非自我推销、格式规范、有用。我们的工具（开源式单文件、零依赖、可离线）符合"awesome 品味"：即开即用 + 解决单一痛点。**感悟：把 README 写成英文版、挂到 GitHub，就有被 kitspace/awesome-electronics 收录的资格**——这是零成本的分发渠道。

**10. "Other Lists" 一节说明 awesome 清单本身是分形的——对我们的启示是别贪大。**
清单末尾链接了 8 个更细的清单（FPGA、机器人电子、电源电子、嵌入式）。每份清单都只守一个细分领域。对应到工具：**不要长成"全能 EDA"，把"自动布线 + 可制造性检查"这一节做穿**，其余环节用导入/导出接口（KiCad 已通，Gerber 已通）交给邻居工具。

## 三、基于感悟的改进（本轮已落地）

| 改进 | 依据（对应感悟 #） | 实现 |
|---|---|---|
| **常用封装快速放置生成器**：0402/0603/0805/1206（IPC-7351 nominal，JLC 封装指南核实）、SOT-23/SOT-223、SOIC-8/16、DIP-N、排针 1×N/2×N；逆时针引脚编号；自动入当前网络 | #7 封装库是痛点 | `footprintPads()` 核心函数 + 左面板"封装库"，2 项新测试 |
| **OSHPark / PCBWay 设计参数预设**（数值取自两家公开工艺规格的安全值之上，检查表保持嘉立创） | #5 多厂预设务实 | dPreset 新增 2 项，1 项断言在既有预设测试覆盖内 |
| README 增加"学习资源"一节（精选自清单，按环节组织） | #8 教学价值 | 见 README |

## 四、后续路线图（按优先级）

1. **EasyEDA JSON 导入**——清单 #5 的 EasyEDA 与嘉立创深度绑定（LCSC 器件库），我们的目标用户（嘉立创打样）大概率在用 EasyEDA；其 PCB JSON 是文本格式，解析难度与 KiCad 相当。
2. **Gerber 回读自检**——Gerber Viewers 一节的启示：导出前用我们自己的解析器读回 Gerber 画一遍，与布线结果比对，作为最终保险。
3. **贴片坐标文件导出（Pick&Place CSV）**——InteractiveHtmlBom 一节启示：打样回来贴片需要坐标表，我们已有全部焊盘坐标，一个导出函数的事。
4. **计算器扩展**——过孔电阻/压降、走线电感、串阻匹配（Saturn Toolkit 方向）。
5. **英文 README + 开源发布**——进入 awesome 生态（#9）。
6. **差分对与蛇形等长**（KiCad 算法已研读）——高频需求，工程量大，排在易做项之后。

## 五、与本项目其它研读文档的关系

- 布线算法侧：`Freerouting源码研读.md`（批量协商范式）、`一线布线器源码研读.md`（KiCad 推挤/拓扑/IC 级协商/矩形扩展）——解决"布得好不好"。
- 本篇：生态侧——解决"工具该长成什么样、往哪走"。
- 用户此前的两份研究文档（布线规则三层分级、嘉立创参数表）依然是 DFM 检查的数据源。
