"""
PCB Studio 一键布线 · KiCad Action Plugin（roadmap #7：KiCad 双向插件）

流程：KiCad 当前板 → ExportSpecctraDSN → 本引擎（import dsn → route → export ses）
→ ImportSpecctraSES 回读 → 刷新画布。

安装（KiCad 7/8）：
  1. 把本目录（或本文件）放入 KiCad 插件目录：
     - Windows: %APPDATA%/kicad/7.0/scripting/plugins/（8.0 同路径把 7.0 换 8.0）
     - Linux:   ~/.local/share/kicad/7.0/scripting/plugins/
  2. 配置引擎仓库位置（二选一）：
     - 把 kicad-plugin/ 留在 PCB Studio 仓库内并设置环境变量 PCB_STUDIO_HOME=仓库根
       （含 ai/pcb.mjs 的目录）
     - 或 PCB_STUDIO_HOME 未设时按"插件文件位于仓库 kicad-plugin/ 内"自动推断
  3. 重启 KiCad → PCB 编辑器 → Tools 菜单「PCB Studio 一键布线」。

环境变量（可选）：
  PCB_STUDIO_HOME    引擎仓库根（含 ai/pcb.mjs）
  PCB_STUDIO_NODE    node 可执行文件路径（默认 PATH 查找）
  PCB_STUDIO_VIA_COST route --via-cost（默认 15）

已知边界（如实）：
  - 引擎为网格布线器；KiCad 导出的 DSN 含禁布区/regions 时导入侧跳过（见 importDSN 注释）
  - route 未布通（status partial）也会回读已布部分——弹窗明示连通数
  - back 元件：DSN 惯例 pin 已镜像，importDSN 不再翻转（引擎与 KiCad 对拍见测试）
"""

import os
import shutil
import subprocess
import sys
import tempfile

import pcbnew

try:
    import wx
    def _msg(text, error=False):
        style = wx.ICON_ERROR if error else wx.ICON_INFORMATION
        wx.MessageBox(text, "PCB Studio 布线", style)
except ImportError:  # 独立运行 pcbnew CLI 时无 wx
    def _msg(text, error=False):
        print(("[ERROR] " if error else "") + text)


def _repo_root():
    env = os.environ.get("PCB_STUDIO_HOME")
    if env and os.path.isfile(os.path.join(env, "ai", "pcb.mjs")):
        return env
    here = os.path.dirname(os.path.abspath(__file__))
    guess = os.path.dirname(here)  # 插件在仓库 kicad-plugin/ 内
    if os.path.isfile(os.path.join(guess, "ai", "pcb.mjs")):
        return guess
    return None


def _run(node, cli, args, cwd):
    proc = subprocess.run([node, cli] + args, cwd=cwd,
                          capture_output=True, text=True, timeout=3600)
    if proc.returncode != 0:
        raise RuntimeError("命令失败 %s\n%s" % (" ".join(args), (proc.stderr or proc.stdout)[-800:]))
    return proc.stdout


class PcbStudioRouter(pcbnew.ActionPlugin):
    def defaults(self):
        self.name = "PCB Studio 一键布线"
        self.category = "PCB Design"
        self.description = "导出 DSN → PCB Studio 引擎自动布线 → SES 回读"
        self.show_toolbar_button = True
        self.icon_file_name = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icon.png")

    def Run(self):
        board = pcbnew.GetBoard()
        repo = _repo_root()
        if not repo:
            _msg("未找到 PCB Studio 引擎仓库：请设置环境变量 PCB_STUDIO_HOME\n"
                 "（指向含 ai/pcb.mjs 的仓库根目录）", error=True)
            return
        node = os.environ.get("PCB_STUDIO_NODE") or shutil.which("node")
        if not node:
            _msg("未找到 node（引擎为 Node.js 程序）：请安装 Node.js 或设置 PCB_STUDIO_NODE",
                 error=True)
            return
        if not os.path.isfile(node):
            _msg("PCB_STUDIO_NODE 指向的可执行文件不存在：" + node +
                 "\n请修正该环境变量，或删除它改用 PATH 查找。", error=True)
            return
        cli = os.path.join(repo, "ai", "pcb.mjs")
        via_cost = os.environ.get("PCB_STUDIO_VIA_COST", "15")
        try:
            with tempfile.TemporaryDirectory(prefix="pcb-studio-") as td:
                dsn = os.path.join(td, "in.dsn")
                design = os.path.join(td, "design.json")
                result = os.path.join(td, "result.json")
                ses = os.path.join(td, "out.ses")
                if not pcbnew.ExportSpecctraDSN(dsn):
                    raise RuntimeError("ExportSpecctraDSN 失败")
                _run(node, cli, ["import", "dsn", dsn, "-o", design], td)
                out = _run(node, cli, ["route", design, "-o", result, "--via-cost", via_cost], td)
                _run(node, cli, ["export", "ses", design, result, "-o", ses], td)
                # 布通率从 route 的 JSON 输出提取（容错：解析失败不影响回读）
                connected, status = None, "?"
                try:
                    import json
                    j = json.loads(out)
                    status = j.get("status", "?")
                    stats = j.get("stats") or {}
                    connected = stats.get("connected")
                except Exception:
                    pass
                if not pcbnew.ImportSpecctraSES(ses):
                    raise RuntimeError("ImportSpecctraSES 失败")
                pcbnew.Refresh()
                _msg("布线完成：%s%s\n已回读到 KiCad（过孔=换层点）。\n"
                     "提示：铺铜/缝合孔可在 PCB Studio 侧完成后导出 Gerber。"
                     % (status, ("，连通 %s" % connected) if connected is not None else ""))
        except Exception as e:
            _msg("布线失败：%s" % e, error=True)


PcbStudioRouter().register()
