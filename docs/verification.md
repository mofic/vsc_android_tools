# 验证记录 · 2026-11-12

- Node.js v26.5.0：8 项 node:test 测试通过；4 个源码脚本语法检查通过。
- 真实 VS Code Extension Host：加载扩展、注册全部 22 个命令、ADB refresh，通过（隔离 user-data-dir）。
- Pixel 4a / ADB 37.0.1：设备列举，文件创建、上传、覆盖、重命名、下载，文件夹递归上传下载，读取 Logcat，通过。仅使用唯一测试目录，finally 清理。
- VSIX：使用 @vscode/vsce 打包并检查归档文件列表。

尚未验证：真实 Gradle 项目构建、APK 安装/启动/卸载、清数据、撤销权限、完整 Webview 手工交互、Windows/Linux。当前目录没有 Android 项目；没有对现有应用执行破坏性测试。

官方 API 依据：https://code.visualstudio.com/api/references/vscode-api 、https://code.visualstudio.com/api/references/contribution-points 。
