# 0.15.0 发布前深度审查（2026-11-17）

## 范围与结论

在原有未提交改动基础上审查引擎、Worker、封装、PNG、GUI 导入/回传、CLI、HTTP/MCP 控制桥、语义编辑、SEA 打包、依赖与 CI。没有回退原有工作、提交或推送代码，没有启动替代常驻工作台。浏览器验证均使用无头实例与临时测试端口。

本轮重点是**纠错、数据保护和发布可复验性**，不是未经测量的整体提速。算法仍有高密度布线边界，DRC 通过不构成生产保证。

## 主要修复

| 领域 | 确认的问题 | 修复与证据 |
|---|---|---|
| 封装 | QFP/QFN 左右焊盘长边方向错误、QFP 角部相交；名称 Infinity/超大数量可能无界循环 | 调整焊盘方向/角部间隙，严格有限整数计数；全焊盘间距及隔离子进程超时回归 |
| 渲染/PNG | mm 距离与像素半径混用，scale 非 1 时形状失真；短字节视图读取 backing buffer 邻接数据 | mm 半径同口径；尺寸/16 MP/字节视图精确校验；scale 0.5/2/8 逐像素 oracle 与 PNG 解压对账 |
| GUI PNG | 大板画布尺寸无界，toBlob 返回 null 未处理 | 16 MP、单边 8192 像素上限，分配/编码失败反馈 |
| 路径/Worker | 近重复点清理会删除换层前点或端点；重布混用原始设计和规范化设计 | 只删内部同层冗余点；美化及返回设计共用规范化对象 |
| 编辑 | 修改失败半改状态、请求数组别名、无效尺寸被默认值掩盖；组件前缀误匹配 | 草稿先验证再提交；精确归属、数值验证、保留 holeR/compId；原子失败/无别名单测 |
| 几何失效 | keepout 把中心当左上角；只看路径顶点漏长段穿越；bbox 偏半焊盘宽 | 中心坐标统一、整段/过孔/逐网宽度判定；clr 变更失效旧网；长线穿区回归 |
| CLI | 主函数解析态共享、process.exit 截断大 stdout、并行分支漏保存设计、输出可能覆写设计 | main(argv) 返回退出码且可重入；选项/arity/覆盖保护、完整大输出及迭代并行保存回归 |
| 文件与子进程 | 会话 cwd 不是沙箱；Node 参数注入、路径/junction/ADS/设备名逃逸 | 命令白名单、实际祖先路径检查、子进程会话二次检查；单文件同目录临时替换 |
| HTTP/MCP | Host/Origin 边界不足、状态修改并发、旧 Worker 退出污染新实例、坏 JSON-RPC 崩溃 | HTTP 修改互斥/MCP 有界串行、全端点同源校验、实例身份校验、协议错误响应、输出/SSE 背压限制 |
| 浏览器桥 | 关闭回传仍发待发/强制截图；storage 禁用崩溃；网络 Promise 未捕获；初始快照覆盖新 SSE | 发送时二次开关检查/取消计时器、storage 容错、成功后去重、初始同步版本门；VM 与真实浏览器集成 |
| SEA | 参数分发依赖文件存在猜测；共享可预测临时引擎；端口/参数宽松 | 用 node:sea 检测模式及真实 argv 布局；随机临时目录、严格 serve 参数、正常信号关闭；实际 exe 冒烟 |
| 发布 | 桥测试不进 CI、bundle 可过期、锁文件版本落后、浏览器依赖未锁定 | Windows/Linux Node24 CI、强制重建桥测试、Playwright 锁定、源码开发 Node24+、四段脚本语法守卫 |

## 本机验证

环境：Windows、Node v24.21.0、Playwright 1.65.1 / Chromium 159。没有把本机结果冒充 GitHub Actions 已通过。

- `npm test`：通过（核心 84；当次 node:test 319；书籍知识 48；CLI 17；KiCad mock；模糊输入 39；交付格式深检 7；优化锁定 48）。最后两个编辑边界用例和预览安全检查在后续专项重跑中验证。
- 最终专项：`node --test tests/core-boundary-audit.test.mjs tests/cli-bridge-security.test.mjs tests/serve-options.test.mjs tests/ui-bridge.test.mjs tests/server.test.mjs`：**43/43**，无跳过。
- HTTP/MCP bundle 端到端：**58/58**，覆盖 load/cmd/SSE/route-live/reroute/cancel/undo/截图/渲染及协议。
- `npm run test:browser`：**63 项**（16 基础、16 工作台、22 像素/图层、6 真实 Worker 取消、3 真实浏览器桥）；HTTP 与 file:// 两种入口均覆盖。检查工作台截图，样例无预拉线且 DRC 清洁。
- `npm run exe && node tests/exe-smoke.mjs`：通过。实际 93.5 MiB SEA 的 schema、QFP 命令、非法端口拒绝、并行引擎解包与 PNG 导出 **5 项**通过；不是仅验证 CJS bundle。
- `npm run check`、`git diff --check`、锁文件/主版本一致性：通过。
- `npm audit`：当次报告 **0 vulnerabilities**（含开发依赖，不代表不存在未披露漏洞）。
- 工作树常见高置信密钥模式扫描无命中；不是完整秘密审计，也未扫描清理所有 Git 历史。已检查的跟踪文件最大约 1.96 MiB，未发现超 GitHub 单文件限制的跟踪产物。

## 明确保留的边界

1. 桥只供本地单用户使用，未携 token 的本机脚本仍允许；不能暴露到网络，不能隔离不可信本机进程。
2. 路径校验与打开之间仍可能有恶意本机目录替换竞态；design/result 多文件不是事务。重要设计独立备份。
3. 同步 DRC/render 等复杂几何计算仍可能占用事件循环；资源上限不是 CPU/内存硬隔离。
4. 正常信号会清理服务/直接子进程；强杀父进程、控制台关闭不保证整个子进程树回收。
5. Windows SEA 注入会使复制的 Node 原签名失效；本轮构建工具出现 `The signature seems corrupted!` 提示，但实际 exe 五项冒烟通过。**没有给产物代码签名**，分发可能触发 SmartScreen；正式签名需维护者证书，不应声称可信签名已完成。
6. 通用封装需按厂家 datasheet 核对；本轮修正生成器几何，不等于所有具体料号已获认证。
7. 第三方板样本/器件数据的来源许可需维护者复核，根 MIT 不自动覆盖它们。KiCad 插件仅 mock 验证，不是安装 KiCad 的真实主机验收。
8. Linux/Windows 的云端 CI 已配置，但本轮只实际运行了本机 Windows 测试，推送后仍需看 Actions 结果。

## 发布操作

参见 [开发与发布清单](../CONTRIBUTING.md) 与 [安全边界](../SECURITY.md)。特别注意新源码/测试/锁文件尚未跟踪，应逐项暂存，不能只 `git commit -am`。`dist/` 保持忽略，exe 建议作为 GitHub Release 附件；不要把会话 token、本机资料或依赖目录一并上传。
