# 验证记录 · 2026-11-12

- Node.js v26.5.0：8 项 node:test 测试通过；4 个源码脚本语法检查通过。
- 真实 VS Code Extension Host：加载扩展、注册全部 22 个命令、ADB refresh，通过（隔离 user-data-dir）。
- Pixel 4a / ADB 37.0.1：设备列举，文件创建、上传、覆盖、重命名、下载，文件夹递归上传下载，读取 Logcat，通过。仅使用唯一测试目录，finally 清理。
- VSIX：使用 @vscode/vsce 打包并检查归档文件列表。

尚未验证：真实 Gradle 项目构建、APK 安装/启动/卸载、清数据、撤销权限、完整 Webview 手工交互、Windows/Linux。当前目录没有 Android 项目；没有对现有应用执行破坏性测试。

官方 API 依据：https://code.visualstudio.com/api/references/vscode-api 、https://code.visualstudio.com/api/references/contribution-points 。

## 0.1.3 符号链接与打开文件修复

- 9 项单元/集成模拟测试通过，包含相对链接解析、链接图标、目录链接展开、重复打开复用、保存至目标路径。
- Pixel 4a：真实 `/sdcard` 链接识别、独立测试目录中的文件/目录/失效链接、目标文件读取通过，测试目录已清理。
- 真实 Extension Host：链接目标 hosts 文件在编辑器打开；重复打开复用同一文档。未对设备 hosts 文件执行写入。
- 默认编辑器处理打开动作，下载仍为独立操作；图标外观尚未进行完整手工验收。
