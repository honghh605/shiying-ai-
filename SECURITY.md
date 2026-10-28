# 安全说明

## 报告问题

请不要在公开 Issue 中提交 API Key、个人照片、数据库或完整日志。发现安全问题时，请通过 GitHub Security Advisory 私下报告，或先开一个不含敏感信息的 Issue 说明需要私下沟通。

## 数据边界

- 照片、缩略图、人工结论和 API Key 默认保存在本机 `%LOCALAPPDATA%\ActivityPhotoCull`。
- API Key 使用 Windows DPAPI 加密保存，不写入日志。
- 只有执行 AI 初筛时，选中的预览图才会发送到用户配置的 DeepSeek 接口。
- 项目不包含遥测或自动上传照片库的逻辑。
- 导出功能只复制源文件，不会删除原始照片。

## 提交代码

提交前请确认没有把以下内容带进 Git：

- API Key、`.env`、日志；
- 个人照片、活动数据库、缩略图缓存；
- `dist/`、`build/`、安装包；
- `app/models/*.onnx`（通过 Release 分发）。

如果怀疑密钥已经泄露，请立即在 API 平台吊销并重新生成。
