# 安全边界 / Security

## 运行边界

- 本工具定位为**个人电脑上的本地开发工具**，不是多用户 Web 服务。控制桥仅监听 `127.0.0.1`；不要通过反向代理、端口转发或隧道暴露给公网/局域网。
- HTTP 桥检查 Host、Origin、浏览器跨站标记，并拒绝错误的 `X-PCB-Token`。为兼容本机脚本，**没有 token 的本机客户端仍可访问**。token 不是本机用户间的权限隔离；同机不可信进程不能靠它隔离。
- 浏览器页面可回传当前设计与画布截图至本机桥。左下角「AI 桥」可关闭自动回传和镜头命令的截图上传；手动截图读取仍能取得之前缓存的截图。关闭回传不等于擦除既有会话数据。
- 桥和 MCP 的命令使用白名单及会话目录约束，拒绝路径逃逸、符号链接/目录联接、Windows 备用数据流与设备名。CLI 直接调用则按用户权限读写传入路径。
- 文件采用同目录临时文件后替换，避免单文件写入中断时破坏旧文件；**多个产物不是数据库事务**。重要设计请版本管理或独立备份。会话目录应由当前用户独占，不能放到不可信用户可写的共享目录；路径检查不承诺抵御本机进程并发替换目录的竞态。
- 不要打开来源不可信的超大/恶意设计。路由栅格、PNG 像素数、部分输入和请求大小有上限，但不承诺所有几何算法具有固定耗时或硬内存隔离。
- 离线打开单文件 HTML 不启动桥、不上传设计。`device`、`part`、`bom --check` 等显式器件查询会访问第三方服务。

## 制造与参考材料

DRC/verify 通过不代表可直接量产。通用 QFP/QFN/BGA/XTAL 等生成器不是特定料号的厂家封装；请核对 datasheet、板厂能力、电气安全和实物样板。开源外部板/器件数据的许可不自动转为本仓库 MIT，重新分发前应核对原始来源与授权。

## 报告漏洞 / Reporting

请优先使用 GitHub 仓库的 **Security → Report a vulnerability**（仓库维护者需开启 private vulnerability reporting）。若尚未开启，不要在公开 issue 粘贴密钥、私人设计、完整会话或可直接利用的细节；先开一个不含敏感信息的 issue 请求私下联系。

提供版本、操作系统、Node 版本、最小去敏复现输入、预期与实际行为。不要上传含 token 的 `bridge.json`、私钥或商业设计。项目仅对最新代码接受安全修复，不提供长期维护版本承诺。

This is a local, single-user development tool, **not a hosted service**. Do not expose its bridge to a network. Same-machine clients without a token remain allowed; local processes are outside the isolation boundary. Please report vulnerabilities privately through GitHub Security when enabled, with a minimal sanitized reproduction.
