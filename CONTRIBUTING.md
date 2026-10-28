# 贡献指南

欢迎提交 Issue 和 Pull Request。

## 开发环境

1. Windows 10/11，Python 3.12。
2. 克隆仓库并创建虚拟环境：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt -r requirements-dev.txt
```

3. 准备本地模型：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup_models.ps1 -Repo "OWNER/shiying"
```

不要把 `.onnx` 模型提交到 Git。

## 提交前检查

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

- 不要在测试或示例中写入真实 API Key。
- 不要提交个人照片、数据库、日志或构建产物。
- 涉及 UI 的改动请附截图或说明。
- 保持现有代码风格，尽量做小范围、可验证的修改。

## Issue 内容

请说明：

- 复现步骤；
- 预期结果和实际结果；
- Windows 版本；
- 是否使用安装包/便携版；
- 相关错误文字（请先删除 API Key、照片路径中的个人信息）。
