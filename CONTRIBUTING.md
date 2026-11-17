# 开发与发布清单

## 环境

- Node.js **24+**，`npm ci` 安装锁定的**开发**依赖；HTML 双击、原始 Node CLI 和打包 exe 运行时仍零第三方依赖。
- 修改算法/界面源文件后 `npm run build` 更新生成的单文件 HTML，不要直接编辑生成文件。
- Windows 如禁用 PowerShell 脚本，用 `npm.cmd` / `npx.cmd`，不要为本项目放宽系统执行策略。
- 算法修改应补确定性、几何/连通性、异常边界测试；不要只改基线快照让测试变绿。

## 本地验证

```bash
npm ci
npm run build
npm test
npm run test:bridge
npx playwright install chromium
npm run test:browser
# Windows only
npm run exe
./dist/pcb-studio.exe schema
```

核心测试会读取仓库里的项目样本。不要在验证前删减案例，也不要把本机资料/参考源码复制到仓库里。浏览器测试启动临时端口的无头测试服务器，完成后关闭；不需替换用户正在运行的工作台。

## 提交/发布前

- [ ] 上述测试全部通过；在 GitHub Actions 上确认 Windows/Linux CI，而不是把本机验证等同于云端已通过。
- [ ] `npm run check`、`git diff --check` 通过；提交生成的 HTML、版本一致的锁文件，以及新源码与测试（不要只提交已跟踪文件的变更）。
- [ ] `git status --short` 逐项复核：不包含会话、token、日志、临时探针、商业设计、密钥、依赖目录或构建目录。
- [ ] 新增/替换外部板样本、器件数据和图片，核对来源、作者、许可和再分发条件。本仓库 MIT 不自动覆盖第三方样本。
- [ ] 对高压、RF/高速、阻抗、热设计和封装尺寸保留人工复核声明；不要把 DRC 无报错误写成量产保证。
- [ ] 源码包不包含 `dist/`。Windows exe、校验摘要应作为 **GitHub Release 附件**，不要用 `git add -f dist` 塞进源码历史。
- [ ] 开启仓库 secret scanning / push protection（可用时）和 private vulnerability reporting；安全边界见 [SECURITY.md](SECURITY.md)。

## 性能结论

报告应给出硬件/Node 版本、案例、参数、测量命令、是否预热、重复次数、质量指标与代价。功能修复不应宣称为未经测量的整体提速；更改几何/封装会改变历史图像，应分别验证正确性与视觉表现。
