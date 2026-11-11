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
  插件的 pcbnew 调用链（ExportSpecctraDSN/ImportSpecctraSES 的返回值语义、KiCad 版本差异）
  需要 **装有 KiCad 的机器实测**——开发环境无 KiCad，只做了 Python 语法检查与逻辑复核。
  首次实测若失败，把弹窗里的报错贴进 issue 即可定位。
- 引擎是网格布线器：KiCad DSN 里的禁布区/regions/差分对约束导入侧跳过（`importDSN` 注释）；
  差分对/等长组建议在 PCB Studio 侧用 `rules` schema 声明后再 route。
- route 未布通（`partial`）也会回读已布部分，弹窗明示连通数。
- 铺铜/缝合孔/丝印在 KiCad 侧保留不动；如需 PCB Studio 的铺铜链路，回 KiCad 前在引擎侧完成。

## 双向能力对照

| 方向 | 通路 | 状态 |
|---|---|---|
| KiCad → 引擎 | `import kicad`（.kicad_pcb 直读）/ `import dsn` / 本插件 | ✓ |
| 引擎 → KiCad | `export ses` + KiCad「文件 → 导入 → Specctra 会话」/ 本插件 | ✓ |
| 引擎 → Freerouting | `export dsn` → Freerouting → 「导入 SES」 | ✓（0.4.x 起） |
