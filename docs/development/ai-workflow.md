# 项目 AI 工作流

1. 先读项目README、AGENTS及适用规则，再读相关spec、task、ADR和经验。
2. 任务先建task；新功能、跨模块、需求口径、构建或AI流程变化补spec；长期取舍补ADR。
3. 明确影响面，实施最小完整改动，运行相关验证并回填task.result。
4. 新结论先进入项目docs/ai；已验证、可复用并脱敏的经验再同步公共库，私有需求和决策保留本地。

## 文档按变更维护
- 模块、入口或依赖边界改变：更新architecture/module-map.md和change-playbook.md。
- 构建、配置、依赖或发布入口改变：更新architecture/build-config-map.md；涉及命令、前置条件时同步commands.md和setup.md。
- 新的已验证故障：更新troubleshooting.md；需要完整调查记录时放在reports/下并从排障文档链接。
- 产生稳定经验或约定：更新docs/ai对应文件；不为无新结论的任务凑条目。
- 新增长期入口：更新README的导航；同职责已有文档优先链接复用。

公共库入口及首次扫描要求见项目AGENTS中的接入块；项目规则优先。
