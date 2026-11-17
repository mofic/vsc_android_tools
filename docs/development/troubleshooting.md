# 问题排查

spawn adb ENOENT 表示主机进程未找到 adb，并不代表手机连接失败。旧版本只依赖扩展进程 PATH；终端能运行 adb 不证明扩展有相同环境。本次版本增加 SDK 路径检测；找不到时显示配置提示。显式指定的路径保留优先级，失效路径需要修正 androidTools.adbPath。单元测试模拟缺失 PATH 和不可执行候选；本机验证只运行 adb version，不读取设备数据。
