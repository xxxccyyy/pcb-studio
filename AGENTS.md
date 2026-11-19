# AGENTS.md —— AI 代理项目规则

本文件由 AI 代理（ZCode 等）自动加载，是硬性项目规则。技术规程见
《docs/AI-使用手册.md》（批处理口径）与《docs/AI-桥接手册.md》（实时桥接口径）。

## 画图前先问观众（硬性交互规则）

AI 即将开始**实时画图**之前——即通过桥接接口（`pcb-studio.exe serve` / `npm run bridge`）
跑 place / route / pour / tune 等会改变画面的操作——**必须先询问用户**：

> 「要不要在浏览器里看着 AI 画图？」

- **要**：确认服务已启动且浏览器已打开工作台页面（serve 默认自动开；已在看就别重开），
  告知用户可实时旁观，然后开始画。
- **不要**：改走无头 CLI（`pcb-studio.exe <命令>` 或 `node ai/pcb.mjs`，不开界面）静默完成，
  只汇报结果与交付物。

判定口径：用户没有明确说过「我要看」就不许擅自开界面；用户看的过程中 AI 每一步推送
（/api/load、autoLoad）界面都会实时刷新，无需再问；纯检查类命令（drc/spec/advise/render）
不改变画面，不算画图，无需询问。

## 画完必须视觉自检（硬性）

AI 每轮画图（place/route/pour/tune 改变了画面）结束后、交付前，**必须亲眼确认**，双通道互补：

1. `GET /api/screenshot.png` —— 工作台真实截图（人所见即 AI 所见；`/api/health` 的
   `screenshotAt` 过旧说明标签页在后台，此时改用下一通道）
2. `GET /api/render?scale=8` —— 引擎几何渲染（确定性，随时可用）
3. 密集板看不清就上**镜头控制** `GET /api/view?net=<网>&region=<x,y,w,h>`——高亮该网 +
   推近局部再截图（界面未连接返回 fallback，改用 render）

目检内容：预拉线是否清零、走线有无明显绕行/相交、覆铜是否成型；几何对错以 DRC/verify
输出为准。AI 在后台标签页场景拿不到新截图不算失职，但 render 必看。

## 布线失败先看法医报告（硬性）

route 返回 `partial` 时，**先 `POST /api/why` 看失败法医报告**（谁挡的、在哪、建议动作），
按 blockers 精确拆障（/api/edit 挪元件/清走线），再重跑——不许拿到 partial 就盲目改参数重布。
注意 `why.partialReasons`：连通满格的 partial 是 route 内部 DRC 错误，跑 drc 看明细，不是布线失败。
布线前先 `POST /api/estimate`：`need4` 判定就不要硬跑 2 层。

## 冷启动（首次接入本项目）

**第一站：`GET /api/help`**——自描述接口目录（全部端点速查 + 三套工作流配方 + tips），
不必先读手册即可开工；细节规程再查《AI-桥接手册》与《AI-使用手册》。

## 视觉驱动布线（自动布线卡壳时的进阶手法）

自动布线卡壳（partial 反复不收敛）时，按《[视觉驱动布线实战记录](docs/视觉驱动布线实战记录.md)》的循环处理：
`/api/view` 截屏看图 → `/api/query` 取焊盘坐标 → 验证器核算间距 → 注入 design.manual → ratsnest 复核。
硬规则：manual 段端点用精确焊盘坐标；内层段改正交；GND 类网用铺铜收尾；ratsnest 是唯一裁判。

## 其它硬性口径

- **规格阶段焊盘坐标用 `fp` 生成**（CLI `fp SOIC-8 --x …` 或 `GET /api/fp`）：内置库
  （0402/0603/0805/1206/SOT-23/SOT-223/SOIC/DIP/**QFP/QFN/BGA/XTAL**/排针）一律不手算坐标；
  库外封装用嘉立创 `device` 拉真封装或才手工展开
- **布线优先 `/api/route-live`**（进度直播+可取消+会话驻留）；修一根网用 `/api/reroute-net`
  （会话失效返回 stale 就重新 route-live）；需要 `--parallel` 才走 `/api/cmd route`
- **改参重跑后必 `POST /api/diff`**：确认修复真有效（字典序 routeScore 裁决），不许凭感觉说变好
- 改坏了用 `/api/undo` 回退（快照深度 20），history 可查操作轨迹
- **token 纪律**：日常轮询用 `GET /api/summary`，查单对象用 `/api/query?net|comp|pad`——
  只有要完整 JSON 时才拉 `/api/state`；看局部用 render `crop`/`highlight` 或 `/api/view`，不拉全板大图
- **DRC 修复闭环**：`POST /api/drc-live`（findings 带 where 坐标）→ 有坐标的违规用
  `/api/view?region=…` 目检特写 → /api/edit 修 → 重跑 drc-live——不许对着字符串 msg 瞎猜位置
- comps 元数据漏写不用慌：load 自动从焊盘前缀补齐（响应带 compsAutoSynced）；
  补写后可 `edit sync-comps` 显式对齐
