# 构建与配置地图

package.json 声明版本、命令、设置及入口 src/extension.js；不经过编译。androidTools.adbPath 默认 adb，解析顺序为显式配置、PATH、ANDROID_HOME、ANDROID_SDK_ROOT、系统常见 SDK 目录；配置在调用时读取。androidTools.scanDepth 控制项目发现深度。npm run package 使用 npx @vscode/vsce 生成 VSIX，产物被 Git 忽略。.vscodeignore 排除测试、开发文档与 node_modules；无部署服务或外部子模块。
