# KiCad 双向插件（roadmap #7）

在 KiCad 内一键调用 PCB Studio 引擎布线，结果直接回读到当前板。

## 工作流

```
KiCad 当前板 ──ExportSpecctraDSN──▶ in.dsn
    ──node ai/pcb.mjs import dsn──▶ design.json
    ──node ai/pcb.mjs route──▶ result.json
    ──node ai/pcb.mjs export ses──▶ out.ses
    ──pcbnew.ImportSpecctraSES──▶ 回读画布（过孔=换层点）
```

## 安装（KiCad 7/8）

1. 复制本目录到 KiCad 插件目录：
   - Windows：`%APPDATA%\kicad\7.0\scripting\plugins\`（8.0 把 `7.0` 换 `8.0`）
   - Linux：`~/.local/share/kicad/7.0/scripting/plugins/`
2. 告诉插件引擎在哪（二选一）：
   - 设置环境变量 `PCB_STUDIO_HOME` = PCB Studio 仓库根（含 `ai/pcb.mjs`）；
   - 或把整个 `kicad-plugin/` 目录留在仓库内不搬走——插件按"上级目录含 ai/pcb.mjs"自动推断。
3. 重启 KiCad → PCB 编辑器 → **Tools → PCB Studio 一键布线**。

前置条件：本机已装 Node.js（`PCB_STUDIO_NODE` 可指定非 PATH 路径）。

## 环境变量

| 变量 | 作用 | 默认 |
|---|---|---|
| `PCB_STUDIO_HOME` | 引擎仓库根 | 插件上级目录自动推断 |
| `PCB_STUDIO_NODE` | node 可执行文件 | `PATH` 查找 |
| `PCB_STUDIO_VIA_COST` | route --via-cost | 15 |

## 已知边界（如实）

- **实测依赖**：引擎侧（importDSN/exportSES/CLI）在本仓库有全量回归（`tests/dsn-ses.test.mjs`）；
  插件逻辑层有 mock pcbnew 单元测试（`tests/kicad-plugin.test.py`——fake pcbnew/wx 注入 +
  真实 node CLI 子进程，覆盖 repo_root 解析/命令序列/四条错误路径/route 输出容错，
  `npm test` 自动运行）；**pcbnew 真机调用链仍需装有 KiCad 的机器实测**——
  首次实测若失败，把弹窗里的报错贴进 issue 即可定位。
- 引擎是网格布线器：KiCad DSN 里的禁布区/regions/差分对约束导入侧跳过（`importDSN` 注释）；
  差分对/等长组建议在 PCB Studio 侧用 `rules` schema 声明后再 route。
- route 未布通（`partial`）也会回读已布部分，弹窗明示连通数。
- 铺铜/缝合孔/丝印在 KiCad 侧保留不动；如需 PCB Studio 的铺铜链路，回 KiCad 前在引擎侧完成。

## 真机 headless 实测指引（装好 KiCad 后逐步执行）

> **实测状态（2026-11-12，KiCad 10.0.6 / Windows）**：✅ **全链 7 步通过**——
> LoadBoard → ExportSpecctraDSN（需 **双参重载** `ExportSpecctraDSN(board, path)`，
> 单参版 headless 无活动板返回 False）→ import dsn → route（complete）→ export ses →
> ImportSpecctraSES（True，10 tracks 回读）→ SaveBoard。icebreaker 真板（636 pads）
> ExportSpecctraDSN 233KB 导入验证通过。
> **实测抓出并修复 4 个 KiCad 10 方言缺口**：①DSN 刻度=µm 口径（host_cad 字符串
> 与刻度无绑定，host 短路判定删除、全靠尺寸合理性打分）；②SES 必须
> `base_design`（下划线）+placement 段+library_out（via padstack 定义，缺闭合括号
> 或整段缺失都会**静默拒绝**）；③**`(nets ...)` 尾行致 KiCad 10 静默拒绝**
> （Freerouting SesWriter 不写此行，已删）；④session 名不得含损坏路径（DSN 头
> 路径取 basename，parseSexpr 的 Specctra 转义会吃掉反斜杠）。
> GUI 注册（Tools 菜单出现插件项）由 KiCad 自己的加载器负责——首次启动 KiCad
> PCB 编辑器目检一次即可。
> 实测脚本：`.scratch/kicad-e2e.py`（7 步断言，KiCad python 直接跑）。

KiCad 自带 Python（内含 pcbnew 模块），无需打开 GUI 即可验证整条调用链。以下命令
逐条复制执行（PowerShell，KiCad 8 路径为准；7.0 把 `8.0` 换 `7.0`）：

```powershell
# 0) 前置：确认 pcbnew 模块可导入
& "C:\Program Files\KiCad\8.0\bin\python.exe" -c "import pcbnew; print(pcbnew.GetBuildVersion())"

# 1) 准备一块最小 .kicad_pcb（或直接用你手头的真实工程）
#    用本仓库测试夹具生成：projects/ext-icebreaker/icebreaker-v1.0e.kicad_pcb 是真实板

# 2) KiCad 侧导出 DSN（headless）
& "C:\Program Files\KiCad\8.0\bin\python.exe" -c "import pcbnew; print(pcbnew.ExportSpecctraDSN(r'D:\tmp\in.dsn'))"
#    期望输出 True——在 KiCad 里先打开该工程（pcbnew 需要活动板）：
#    无活动板时可走完整路径：pcbnew.LoadBoard(r'...kicad_pcb') 后再导出

# 3) 引擎三连（node 侧）
node ai\pcb.mjs import dsn D:\tmp\in.dsn -o D:\tmp\design.json
node ai\pcb.mjs route D:\tmp\design.json -o D:\tmp\result.json
node ai\pcb.mjs export ses D:\tmp\design.json D:\tmp\result.json -o D:\tmp\out.ses

# 4) SES 回读 KiCad（headless 验证）
& "C:\Program Files\KiCad\8.0\bin\python.exe" -c "import pcbnew; print(pcbnew.ImportSpecctraSES(r'D:\tmp\out.ses'))"
#    期望 True——随后 pcbnew.SaveBoard(...) 存盘，用 KiCad GUI 打开目检走线

# 5) 插件整链：设置 PCB_STUDIO_HOME 后在 KiCad GUI 里 Tools → PCB Studio 一键布线
```

实测关注点：①`ExportSpecctraDSN/ImportSpecctraSES` 的返回值语义（True/异常）；②KiCad
导出的 DSN 刻度（importDSN 的 0.1µm 自适应是否命中）；③回读后走线层归属与过孔；
④action plugin 在 7/8 两代的注册差异。结果（含报错原文）记录到 issue 或案例文档。

## 双向能力对照

| 方向 | 通路 | 状态 |
|---|---|---|
| KiCad → 引擎 | `import kicad`（.kicad_pcb 直读）/ `import dsn` / 本插件 | ✓ |
| 引擎 → KiCad | `export ses` + KiCad「文件 → 导入 → Specctra 会话」/ 本插件 | ✓ |
| 引擎 → Freerouting | `export dsn` → Freerouting → 「导入 SES」 | ✓（0.4.x 起） |
