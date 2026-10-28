# GitHub 发布清单

## 仓库内容

- 源代码、测试、构建脚本、文档、安装器脚本；
- 不提交：
  - `app/models/*.onnx`
  - `dist/`、`build/`、`backups/`
  - `.venv/`、缓存、日志
  - 个人照片、演示数据库、测试素材
  - 本机路径相关的 `.cmd`

## Release 附件

创建 tag `v1.0.0`，上传：

- `拾影-安装包-v1.0.0.exe`
- `拾影-v1.0.0-win64.zip`
- `models-v1.0.0.zip`

`models-v1.0.0.zip` 内至少包含：

```text
clip_vision_vit_b32_float.onnx
face_detection_yunet_2023mar.onnx
face_recognition_sface_2021dec.onnx
```

## README 占位符

把 README 和 `scripts/setup_models.ps1` 中的：

```text
honghh605/shiying-ai--
```

替换为实际 GitHub 用户名和仓库名。

## 推送前检查

```powershell
git status --short
git ls-files | Select-String -Pattern '\.onnx$|\.exe$|\.zip$|cull\.db'
```

确认没有模型、安装包、数据库或密钥进入 Git。

## 发布后

- 在仓库 About 中填写简介和截图；
- 开启 Issues；
- 在 Release 说明中写清楚隐私边界和 API 费用提示；
- 如果要接受外部贡献，保留 `CONTRIBUTING.md` 和 `SECURITY.md`。
