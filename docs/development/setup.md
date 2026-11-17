# 开发环境

桌面 VS Code 最低版本来自 package.json 的 engines.vscode；Node.js 与 npm 用于开发验证，仓库没有独立 Node 版本锁定。无运行时 npm 依赖。ADB 需要 Android SDK Platform Tools；插件自动检测 PATH、ANDROID_HOME、ANDROID_SDK_ROOT，随后检测 macOS 的 ~/Library/Android/sdk、Windows 的 LOCALAPPDATA/Android/Sdk、Linux 的 ~/Android/Sdk 或 ~/Android/sdk。自定义安装可设置 androidTools.adbPath。先执行 npm test 与 npm run check，F5 验证扩展；本次未运行真实 Extension Host。
