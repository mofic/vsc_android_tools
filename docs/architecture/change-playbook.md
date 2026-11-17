# 改动指引

设备与文件修改从 src/extension.js 和 core.js 的调用链开始，检查序列号、信任、确认与缓存失效。ADB 查找改 src/adb-path.js，并运行 test/adb-path.test.js。命令变更同步 package.json；Webview 改动同步 HTML、media 事件和后端消息处理。非平凡逻辑补行为测试，新增源码同步 check 脚本。运行 npm test、npm run check，交付 VSIX 时更新版本、README 和 docs/verification.md。
