# 开发与验证命令

在仓库根目录运行，来源为 package.json：

- npm test：Node 内置测试运行器执行 test/*.test.js。
- npm run check：逐项执行 node --check，无 TypeScript 编译。
- npm run package：npx @vscode/vsce package --no-dependencies，首次可能需联网。
- VS Code F5：启动隔离 Extension Development Host，见 .vscode 配置。

本次实际结果见 [任务记录](../../tasks/adb-discovery.md)。真机脚本需要明确设备授权，本次不运行。
