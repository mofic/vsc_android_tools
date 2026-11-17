# 模块与依赖地图

权威职责列表见 [AGENTS.md](../../AGENTS.md)，整体设计见 [design.md](../design.md)。入口 src/extension.js 负责命令与原生树，调用 core.js 的 ADB 与文件能力；src/adb-path.js 只解析主机 ADB 路径，统一供设备、Logcat、录屏使用。app-view.js 与 media/app.* 管理项目侧栏；logcat.js 与 media/logcat.* 管理日志。root-files.js、remote-path.js 管理私有文件与输入安全；run-targets.js 识别 Gradle 目标；device-capture.js/capture.js 管理采集。没有运行时 npm 依赖，测试位于 test/。
