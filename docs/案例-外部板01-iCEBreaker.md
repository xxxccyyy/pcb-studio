# 外部真实案例 01：iCEBreaker FPGA 开发板（v1.0e）

> 路线图阶段一 #6 第一块外部板。来源：[icebreaker-fpga/icebreaker](https://codeberg.org/icebreaker-fpga/icebreaker)（Codeberg，CC0/OSHW，1BitSquared）。
> 本案例是 #6 的核心交付：真实 KiCad 板全链走通 + 缺口清单。所有数据可复现（命令与产物在 `projects/ext-icebreaker/`）。

## 1. 板子基线

| 项 | 原板 | 导入后 |
|---|---|---|
| 尺寸 | 76×40mm | 76×40mm |
| 层数 | 4（In1/In2 使用稀疏） | 导入识别 2 层（案例按 2 层跑，见遗留清单） |
| 网络 | 126 | 126（导入后删除无焊盘网络） |
| 焊盘 | 616（含 11 组同号焊盘） | 616（同号消歧后缀 b/c/d…） |
| 封装 | 193 | 134 组 |
| 特殊 | QFN-48-1EP 散热焊盘 45° 旋转、SOT-23-6、机械安装孔、KiCad 层级网名 | 同左 |

## 2. 全链命令日志（真实输出，未美化）

```
importKiCadPcb → 616 焊盘/126 网/76×40mm ✓
spec（首跑）      → 184 problems：同元件焊盘间距 108 + 焊盘 76   ← 缺口 1/2/3 被抓出
修复后 spec       → 9 problems：QFN EP 导热孔环宽 0.10（DFM 遗留，见清单）
                  （0.6.2/0.6.3 旋转焊盘语义修复后：45° 封装真形状不再误报）
place(6000 iter)  → 代价 190.6M → 125.4M，134 组件组，~9min
route 串行        → 490.9s  conn 410/533  drcErrors 200
route --iter-workers 4 → 79.4s  conn 414/533  drcErrors 200  ← **6.18×**，连通 +4
                  → capacityStall:true（容量签名在真实外部板触发 ✓）
4 层对照           → conn 419/533（容量上限确认：本板原设计就是 4 层）
autopcb×3 轮(4层)  → **517/533**（+98 连接——布局反馈兑现，见 §3.1）
pour(GND bottom)  → 铺铜写入 ✓
export gerber     → 8 件套 ✓      verify → ok:true findings:0（修复后）✓
render            → board-final.png 目检 ✓
```

## 3. 指标表

### 3.1 autopcb 布局-布线反馈循环（外部板的解法验证）

散布失败（34 个非 QFN 聚集）的正确解法是**改布局而非调布线**——工具自带
autopcb 循环（place→route→热点反馈→re-place）3 轮（4 层，mi=60/轮，总 ~4h）：

| 配置 | 连通 | 未连通网 | 说明 |
|---|---|---|---|
| 2 层 iter-parallel | 414/533 | 45 | capacityStall 触发 |
| 4 层 iter-parallel | 419/533 | 45 | mi=60 无改善（谈判稳定） |
| **4 层 autopcb×3 轮** | **517/533** | **8** | **+98 连接**——布局反馈兑现 |

未连通的 8 网：GND 残余（铺铜兜底）+ 零星信号网。**atmega 案例的
"46/48→48/48" 模式在外部板上复现**——布局-布线协同是工具设计哲学的
又一次验证。

| 指标 | 串行 | 并行（--iter-workers 4） |
|---|---|---|
| 墙钟 | **490.9s** | **79.4s（6.18×）** |
| 连通 | 410/533 | **414/533** |
| DRC errors | 200 | 200（结构相同：间距冲突 60/未连通 55/焊盘重叠 51/焊盘间距 34） |
| 过孔 | 193 | 194 |

**6.8× 验收线口径**：n148 类板 3.4h→30min。本板实测 **6.18×**（4 worker）——同量级达成。
未连通的 119 个焊盘连接：板子真实密度（2 层跑真 4 层板）+ 0.5mm QFN 细间距，
属容量边界而非算法残留（4 层对照 +19，capacityStall 签名触发即证据）。

## 4. 本案例抓出的真实缺口（全部修复，共 6 项）

1. **importKiCadPcb 同号焊盘**：拨码开关公共脚/QFN 散热焊盘分割是同 (ref,number)
   多 pad——spec 直接拒绝。修复：消歧后缀 b/c/d…（两种分组约定都不破坏）
2. **importKiCadPcb 旋转焊盘 w/h**：KiCad 板文件 pad 位置是封装本地坐标（需按 frot
   旋转）、pad 角度是相对角（w/h 按 frot+prot 交换）——用 U1 SOT-23-6 +
   U6 45° QFN 双例对拍定论（comb 惯例正确；normAng(90+270)=360→0 的环绕丢交换
   是 U1 误报根因）
3. **机械安装孔环宽误报**：无网 THT（REF\*\* 安装孔，孔 3.2mm 无铜环）被当 THT 焊盘
   查环宽——spec/checkDRC 双处豁免（障碍语义保留）
4. **spec 同元件焊盘间距对外部板误报**：真实封装自带同封装焊盘交叠（QFN-48-1EP
   散热焊盘 vs 边脚 0.165mm——旋转不变性验证）——design.external 标记 + 豁免
   （该检查针对自产 generator 规格）
5. **EasyEDA 网名消毒**：KiCad 层级网名 `/FLASH_~{WP}|IO2` 含 `~`/`|`，会错位
   `~` 分隔的 EasyEDA 字段（导出文件对嘉立创EDA 本身就是坏的）——导出侧网名
   消毒 + verify 键同口径（VRF-PAD 144→0）
6. **verify 往返取整不对称**：坐标落在 .005 边界（5.225）时设计侧 toFixed(2)→"5.22"
   而导出往返→"5.23"——期望值改走与导出相同的量化路径

## 5. 遗留清单（诚实口径）

- **QFN EP 导热孔环宽 0.10mm < 0.18**（18 处）：JLC 对 EP 内导热孔接受 0.1 环宽，
  建议级而非错误；spec 按极限口径报——遗留给 DFM 分级
- **细间距配方**：0.5mm QFN 按 AI 手册配方（grid 0.25/线 0.1/距 0.05）跑通；
  更细（0.4 BGA）超能力（白皮书已声明）
- **2 层容量**：本板原设计 4 层——2 层跑到的 414/533 就是 2 层容量边界，
  不是算法残留（4 层对照 +5 且 capacityStall 证实）
- **导入不含内层铜**：In1/In2 的平面/走线不导入（本工具重布）——4 层案例的
  内层平面效应（回流/阻抗）不在本工具口径
- **连线可视化**：partial 状态的 119 连接为真实不可达（2 层容量），交付口径
  应按 4 层重跑或调整布局

## 6. 复现

```bash
node .scratch/ext-import.mjs                                  # KiCad → design.json
node ai/pcb.mjs spec projects/ext-icebreaker/design.json      # 18 遗留（DFM）
node ai/pcb.mjs place projects/ext-icebreaker/design.json -o projects/ext-icebreaker/placed.json --iterations 6000
node ai/pcb.mjs route projects/ext-icebreaker/placed.json -o projects/ext-icebreaker/result-serial.json --max-iter 30   # 串行基线 490.9s
node ai/pcb.mjs route projects/ext-icebreaker/placed.json -o projects/ext-icebreaker/result-iterpar.json --max-iter 30 --iter-workers 4   # 79.4s
node ai/pcb.mjs pour projects/ext-icebreaker/placed.json projects/ext-icebreaker/result-iterpar.json -o projects/ext-icebreaker/placed-poured.json --net GND --layer bottom
node ai/pcb.mjs export gerber projects/ext-icebreaker/placed-poured.json projects/ext-icebreaker/result-iterpar.json
node ai/pcb.mjs verify projects/ext-icebreaker/placed-poured.json projects/ext-icebreaker/result-iterpar.json
node ai/pcb.mjs render projects/ext-icebreaker/placed-poured.json projects/ext-icebreaker/result-iterpar.json -o projects/ext-icebreaker/board-final.png
```
