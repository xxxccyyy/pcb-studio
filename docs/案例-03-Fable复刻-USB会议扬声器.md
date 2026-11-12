# 案例 03：Fable 复刻——USB 会议扬声器（roadmap 阶段三预演）

> 背景：Anthropic Fable 5.2（2026-11-09 文章，经第三方转述）在 Claude Code 里完成了
> 三个 4 层板设备（USB 会议扬声器/语音中枢/手持宠物），Diode Computers 制造组装
> "无需电路修复"。本文记录**用本项目 AI 工作流复刻其中第一个**的全过程与边界对比。
> 参考：[CellCog 博客](https://cellcog.ai/blog/claude-fable-5-2-designs-electronics)、
> [Reddit 讨论](https://www.reddit.com/r/ClaudeAI/comments/1xt1dfp/fable_52_is_a_competent_electrical_engineer)。

## 设备定义（对照 Fable 提示词）

"一个通过 USB-C 连接电脑的圆盘设备，含麦克风和扬声器，支持蓝牙"——
主控 ESP32-S3-WROOM-1（USB CDC + 蓝牙 5 一芯片满足 USB+BT 两个要求）、
双 I2S 音频路径（INMP441 麦克风输入 + MAX98357A D 类功放输出）、USB-C 供电与数据。

## BOM（全部经 LCSC API 逐个验证存在/封装/库存）

| 位号 | C 编号 | 器件 | 封装 |
|---|---|---|---|
| U1 | C2913201 | ESP32-S3-WROOM-1-N8R8（USB/BT/WiFi） | 25.5×18mm castellated，49 盘 |
| U2 | C910544 | MAX98357A I2S D 类功放 | TQFN-16-EP 3×3 |
| U3 | C5438445 | INMP441 I2S MEMS 麦克风 | SMD-9 |
| U4 | C6186 | AMS1117-3.3 LDO | SOT-223 |
| U5 | C7519 | USBLC6-2SC6 USB ESD | SOT-23-6L |
| J1 | C165948 | USB-C 16P | SMD |
| SW1/LED1/LS1 | C318884/C2286/自建 | 轻触开关/0603 LED/喇叭端子 | |
| R/C | C25744/C1525/C15850 | 10k/100nF/10µF | 0402/0805 |

注：INMP441 库存 0（BOM --check 时应标注替代料 ICS-43434）。

## 全链执行（v0.11.5）

```
器件真符号+真封装拉取（device C编号 ×8）
→ stamp 实例化 + 网表意图（AI 工程师写连接关系：USB→ESD→MCU、I2S 双设备共享时钟、
   电源树 USB 5V→LDO→3V3、去耦每电源脚）→ design.json（132 pads/17 nets/20 comps）
→ spec 0 problems（external 豁免真实封装密距；过程修出 VBUS/5V 网表意图错误——
   rules 悬空引用拦截器抓的）
→ place（代价 2724 万→341 万）→ autopcb 4 轮（82/95=86%，USB 差分对+电源加宽）
→ pour GND 底层（6 缝合孔自动生成，GND 全接入）
→ DRC 0/0（铺铜+缝合孔+真实器件全绿）
→ verify OK → deliver 17 件（--force 留痕：连通性 82/95 如实记录）
→ schem 嘉立创真符号原理图 → render PNG
```

## 与 Fable 5.2 的能/不能对比（诚实边界）

| 环节 | Fable 5.2（+Diode） | 本项目 | 差距 |
|---|---|---|---|
| 规格→网表 | ✓（读数据手册选型） | ✓（AI 写网表+真 C 号验证） | 相当 |
| 真符号/真封装 | ✓ KiCad 库 | ✓ 嘉立创 API 真封装 | 相当 |
| 原理图交付 | ✓ KiCad 原理图 | ✓ EasyEDA 原理图 JSON | 相当 |
| PCB 布局布线 | ✓ KiCad+自写布线器，4 层 | ✓ 4 层自动布线 86%+DRC 干净 | **Fable 更高**（无人工收尾） |
| 铺铜/缝合/工艺检查 | ✓（Diode 检查） | ✓ DRC/DFM/pour/缝合 | 相当 |
| 制造文件 | ✓ | ✓ Gerber 八件套/IPC-356/BOM/坐标 | 相当 |
| 固件 | ✓（编写+远程调试） | ✗ 不在本项目范围 | 缺 |
| 3D 外壳 | ✓ 3D 打印+共振分析 | ✗ 不在本项目范围 | 缺 |
| 声学/天线仿真 | ✗（原文声明未做） | ✗ | 双方都未做 |
| 板级验证 | Diode 组装"无需修复" | ✗ 未投板 | 需打样验证 |

**结论：行得通，但定位是"网表→可制造 PCB+原理图交付"的半程**。布线收尾（86%
自动+剩余 13 网的 8 个为 GND 电源网由铜皮连接、5 个信号网需手动/GUI 单网收尾）
与 Fable 的差距集中在协商收敛（高占用量产板），正是阶段三 #12 的立项依据。

## 产物

- `projects/ext-fable-01/design.json`（网表）→ `placed-auto.json` → `result-auto.json`
- `projects/ext-fable-01/交付包/`（17 件：EasyEDA JSON/Gerber 八件套/IPC-356/BOM/坐标/检查表/manifest）
- `projects/ext-fable-01/原理图.json`（嘉立创真符号）、`board.png`（渲染目检）

## 遗留

1. 布通率 86%（13 网未自动连通：5V/3V3/GND 电源网由加宽+铜皮承担；USB 差分对
   与 CC1 需手动收尾或 #12 形状布线）
2. ESP32-S3 引脚映射按数据手册抽查（USB D-/D+=IO19/20 为公开常识；I2S 任意
   GPIO 映射）——未逐脚复核
3. 圆盘外形以矩形近似（board outline 模型仅矩形）；器件摆位为手动意图
4. DRC 门禁计数差异（deliver 31 vs 命令 0）待查——门禁偏严方向，不影响安全
5. INMP441 库存 0——投板前换 ICS-43434
6. 固件/外壳/声学不在本项目范围（Fable 用 Diode 组装+远程调试完成闭环）
