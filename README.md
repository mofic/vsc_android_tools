# Android Device Tools

VS Code 安卓设备管理插件，支持原生 Android Gradle 项目和多根工作区。无需运行时 npm 依赖。

## 安装与运行

1. 安装 Android SDK Platform Tools，在终端确认 `adb devices -l` 能看到已授权设备。
2. 在 VS Code 执行 **Extensions: Install from VSIX…**，选择本仓库生成的 `android-device-tools-0.1.0.vsix`。
3. 打开左侧 Android Tools 图标，点击设备选中目标。ADB 不在 PATH 时设置 `androidTools.adbPath`。
4. 使用命令面板搜索 `Android Tools` 执行应用和文件操作；文件树提供右键菜单。

开发：本目录执行 `npm test` 和 `npm run check`；VS Code 打开目录后按 F5 启动 Extension Development Host。`npm run package` 生成 VSIX（首次需要网络下载打包工具）。

## 设备与文件

每 5 秒刷新设备；未授权和离线设备不能选中。默认浏览 `/sdcard`，使用“跳转设备目录”访问其他 ADB 可读目录。文件树支持创建、重命名、删除、上传和下载文件/文件夹。

单击文件下载本地副本并打开；编辑后执行 **保存编辑到设备**，确认覆盖原文件。编辑副本绑定下载时的设备，即使切换设备也不会写错设备。退出扩展后删除临时副本，请及时上传或另存为。上传/下载文件夹会合并目录并覆盖同名文件，操作前有确认；取消可能留下部分文件，不支持事务回滚。

普通 ADB 无法读取其他应用私有目录，权限错误会提示；不支持 Root、run-as、无线配对。文件名中的换行符不支持。大文件请使用下载而非文本编辑。

## 原生项目与应用

支持直接打开文件夹和多根 `.code-workspace`。从各根目录扫描 `settings.gradle` / `settings.gradle.kts`，默认深度 4，可设置 `androidTools.scanDepth`；忽略 `.git`、`.gradle`、`build` 等目录。发现一个项目自动选择；多个项目手动选择并在工作区记忆，支持手动选目录。

“构建并安装启动”使用项目 Gradle Wrapper，可选择/输入模块和变体构建任务（默认 `:app:assembleDebug`）。构建后选择 APK 元数据，获取真实 applicationId，包括 flavor 和 applicationIdSuffix。需预先配置 JDK/Android SDK，且项目 Wrapper 可用。安装已有 APK 支持多选 APK，通过 `install-multiple` 安装拆分包。构建流程选择含拆分过滤条件的 APK 时会提示改用通用 APK 或手动选择完整拆分包。

启动、停止、卸载、清数据和撤销权限会确认 applicationId；优先使用构建产物包名，没有产物可以手动输入。卸载、清数据、权限撤销有额外确认。撤销权限仅针对当前 Android 用户、所选应用已授予的运行时权限；系统固定权限等可能失败，详情在输出面板 Android Tools。不会执行全设备权限重置。

构建、设备写入和应用操作要求工作区已信任。

## Logcat

每个面板绑定自己的设备；可同时打开多个设备面板。按 V/D/I/W/E/F 级别着色，支持最低级别、Tag、关键词、正则、包名过滤。包名每 1.5 秒重新查询进程表，跟随应用重启，同时包含 `:remote` 等子进程。

最多保留最近 10000 行。暂停仅暂停显示，后台继续更新有界缓冲。支持自动滚动、复制/导出过滤后的缓冲日志；“清空视图”只清本面板，“清除设备日志”会确认后清设备缓冲区。断连后点击“重连”。正则用于本地过滤，请避免复杂回溯表达式。

## 验证范围

`node:test` 覆盖路径与 shell 引号、设备状态、多根扫描与深度、APK 元数据、日志过滤、进程失败。自动化不替代真机验证；实际安装、文件传输、权限和 Gradle 构建受设备/项目环境影响。

## Git

仓库为本地 Git 管理。远程托管时添加你的仓库：

```sh
git remote add origin <仓库地址>
git push -u origin main
```
