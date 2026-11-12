# Studio-style Android Tools Experience

Goal: 保留 VS Code 原生设备文件树和 Logcat 编辑器标签页，统一改善已讨论的核心交互。
Architecture: 继续使用 CommonJS、Node 标准库与现有 Webview，无新运行时依赖。

- [x] Logcat 查询：支持 package/process/tag/message/line/level/age/is/name、排除、正则与布尔组合，package:mine 使用当前项目；保留原过滤与历史，添加命名收藏和输入提示。
- [x] Logcat 阅读：时间、PID/TID、包名/进程、级别、Tag、消息对齐，精简视图；增量更新保留选区；滚动离开底部解除跟随、跳到最新、暂停新增计数；保留搜索、换行、导入导出及采集。
- [x] 设备文件：稳定节点 ID、路径与设备标识、后退/前进/最近目录、按对象区分菜单、大小/修改时间、局部刷新；明确本地副本待上传状态。
- [x] 验证：查询语义及错误边界、元数据解析、菜单/命令/导航、增量 DOM/搜索/滚动行为、真实浏览器多宽度、Extension Host、唯一目录真机回归。更新文档、打包安装、Git 提交。

不更改权限边界，不为浏览预先下载设备内容。保留工作区信任、覆盖与删除确认；离线包名不猜测。查询的 Studio 兼容范围及已知差异在 README 明确说明，不承诺完整替代 Android Studio。
