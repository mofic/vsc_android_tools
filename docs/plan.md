# Android Tools Implementation Plan

Goal: 可安装的 VS Code Android 管理插件。
Architecture: Node.js CommonJS、VS Code API、ADB 子进程，无运行时依赖。
Spec: docs/design.md

- [x] 核心：ADB 参数隔离、设备/目录解析、项目扫描、APK 元数据，node:test 测试边界。
- [x] 界面：命令注册、设备与文件树、上传下载编辑、Gradle 与应用操作。
- [x] Logcat：独立 Webview、有界缓冲、过滤、进程跟踪、导出与生命周期清理。
- [x] 验证：单元测试、语法检查、VSIX 打包、使用说明、Git 提交。

风险检查：特殊文件名与 shell 注入；离线设备；多项目多 APK；无权限目录；日志洪泛与 Webview 注入。
