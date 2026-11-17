---
id: SPEC-ADB-DISCOVERY
title: 自动发现已安装 ADB
status: implemented
---

扩展进程 PATH 缺失时仍能使用系统标准位置的 Android SDK。采用固定候选路径查找，无依赖、无 shell 和全盘扫描；显式配置优先，不静默替换。统一路径回调覆盖普通命令、Logcat 和录屏。找不到时提示 androidTools.adbPath。验收覆盖候选优先级、不可执行候选、后续安装及三平台路径规则；Windows/Linux 仅在 macOS 文件夹夹具中模拟。
