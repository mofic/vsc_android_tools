# Android Device Tools 开发约定

本文件适用于整个仓库。与用户沟通默认使用中文；用户在当前会话中的明确要求优先。

## 项目与代码位置

这是通过 ADB 管理 Android 设备的 VS Code 桌面扩展。使用 JavaScript CommonJS、Node.js 标准库与 VS Code API，没有运行时 npm 依赖，也没有 TypeScript 编译步骤。

- `package.json`：扩展入口、命令、图标、菜单、设置和版本。
- `src/app-view.js`、`media/app.js`、`media/app.css`：项目应用侧栏，显示目标并通过白名单复用命令。
- `src/extension.js`：设备/文件树、目录缓存、原生 Gradle 项目与应用操作、命令注册。
- `src/core.js`：ADB 调用、路径校验、目录元数据、项目发现、APK 元数据、日志解析和过滤。
- `src/root-files.js`：Root 私有文件传输及权限保留；`src/remote-path.js`：路径和 shell 参数校验。
- `src/run-targets.js`：通过 Gradle 应用变体模型识别运行目标，限定模块和变体的 APK。
- `src/log-query.js`：Studio 风格查询解析和匹配，不执行用户输入代码。
- `src/logcat.js`：Logcat Webview 生命周期、实时/离线日志、过滤历史及采集操作。
- `src/device-capture.js`：设备行截图/录屏入口、每设备会话与停止状态栏；`src/capture.js`：采集进程与安全保存。
- `media/logcat.js`、`media/logcat.css`：Webview 交互和样式。
- `test/*.test.js`：自动化测试；`test/host.cjs`：真实 Extension Host 验证入口。
- `test/device-smoke.js`、`test/root-smoke.js`、`test/capture-smoke.js`：需明确指定设备的手动真机验证脚本。
- `README.md`：使用方式与功能边界；`docs/verification.md`：历史验证记录。

## 修改原则

优先做满足需求的最小完整修改，复用现有函数和交互。不要为了少量代码引入依赖、框架或通用抽象。

修改前检查函数调用方、命令声明、Webview 消息收发和相关测试。新增命令同时更新注册和 `package.json`；新增 Webview 控件同时更新 HTML、前端事件和后端消息处理。非平凡逻辑补充能验证行为的测试。

侧栏顶部使用图标和悬停提示，保留中文命令标题。界面沿用 VS Code 主题变量、可访问标签和键盘操作。日志及文件名必须通过文本节点显示，不将设备内容拼入可执行 HTML。

## 必须保留的行为

- 每次设备操作都绑定序列号；切换设备不能改变已打开文件和 Logcat 标签页的操作目标。
- 浏览目录只读取当前层元数据，不递归扫描或预先下载文件内容。打开文件才拉取编辑副本，上传回设备需要显式保存操作。
- 设备连接轮询不得无条件重刷文件树。保留按设备/目录的缓存、并发请求复用，以及刷新、断开和文件写入后的失效处理。
- 不因属性读取失败而丢弃已知名称的条目。保留隐藏文件、权限受限条目和符号链接；相对链接需按物理目录解析。
- 设备 shell 参数使用 `quote`，路径和包名通过现有校验；主机子进程使用独立参数，避免未经校验的 shell 拼接。
- 构建和设备写入遵守工作区信任检查。删除、覆盖、卸载、清数据等操作保留现有确认与错误反馈。
- 权限撤销只针对目标应用，不能调用影响全设备的权限重置；录屏停止只针对本次记录的 PID，不使用全局 `pkill`。
- Logcat 各标签页的缓冲、过滤、暂停和进程独立。过滤历史可共享，但不能改变其他页当前过滤条件；离线页不得依赖设备连接。
- 保留日志缓冲与导入文件大小上限。关闭标签页释放进程、定时器及事件监听。
- 截屏/录屏本地文件保存成功前不删除设备临时文件；失败时保留恢复路径，不能以残缺下载覆盖已有文件。

## 验证与交付

源码变更后执行：

```sh
npm test
npm run check
```

功能交付需要安装包时执行 `npm run package`，生成 VSIX；首次可能需要网络获取 `@vscode/vsce`。可在 VS Code 中按 F5 启动隔离的 Extension Development Host。增加源码脚本时同步检查 `npm run check` 的覆盖范围。

功能发布时更新 `package.json` 版本和 README 中的安装包名称，并根据实际结果记录验证范围。纯文档修改无需升级版本或重新安装插件。VSIX 已被 Git 忽略，不提交打包产物。

真机测试使用唯一命名的测试目录并清理，不能拿用户已有文件或应用做破坏性测试。截屏、录屏和现有数据读取遵循会话中已有授权，不把授权扩大到无关内容。不要在日志、提交或报告中暴露私有屏幕内容。

提交前检查 `git diff` 和 `git status`，不覆盖用户修改，不重写历史；远程推送或发布遵循用户授权。最终说明实际改动、已运行的验证和未验证范围，不能把模拟测试描述成真机测试。


<!-- shared-ai-workflow -->
## 公共 AI 工作流

本机公共库：[/Users/lanweining/Desktop/ai-workflow/AGENTS.md](/Users/lanweining/Desktop/ai-workflow/AGENTS.md)。
开发任务开始时读取公共协议、docs/workflow.md 与适用经验；项目规则及用户指令优先。
项目 spec/task/ADR 保留本地；通用经验脱敏验证后按公共同步流程回填。
公共库不可用时保留现有流程并报告。跨机器使用前重新接入本机公共库。


<!-- shared-ai-workflow:project-bootstrap -->
## 项目初始化与文档维护

首次或补齐接入时读取 [/Users/lanweining/Desktop/ai-workflow/docs/project-bootstrap.md](/Users/lanweining/Desktop/ai-workflow/docs/project-bootstrap.md)，扫描实际代码与配置填充项目文档。
脚本仅创建骨架；处理待扫描标记、复用已有文档、回填初始化task后才算完成。
后续按 docs/development/ai-workflow.md 更新架构、开发、经验和需求资产；项目同职责已有文档优先复用。
