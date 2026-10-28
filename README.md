# 拾影 · ActivityPhotoCull

Windows 本地活动照片初筛工具：导入照片、本地连拍精选、AI 辅助筛图、人工复核、一键导出原片。

当前版本：**v1.0.0**

> 拾影是 Windows 桌面应用，使用本地服务 + Edge WebView2 渲染。照片、缩略图和人工结论默认保存在本机；只有执行 AI 初筛时，选中的预览图才会发送给你自己配置的 DeepSeek API。

## 功能

- 导入本地文件夹或照片，RAW/JPG 自动配对，生成预览和缩略图。
- **本地连拍精选**：CLIP ViT-B/32 场景向量 + YuNet/SFace 人脸集合，每组只保留 1 张，其余立即标记为连拍重复。
- **单轮 API 精筛**：把每组代表帧和非连拍照片一次性发给 DeepSeek，做失焦、闭眼、曝光、遮挡、构图检查。
- 全部粗筛结束后才显示人工复核；支持保留、排除、待确认、重要标记、批量操作、对比和详情查看。
- 一键复制人工保留的 RAW/JPG 原片，生成选片清单 CSV 和处理报告 HTML。
- 本地预算和费用估算，支持多 API Key、暂停/继续。
- 不需要安装 Python 即可使用安装包；模型随安装包离线提供。

## 工作流程

```text
导入照片
  -> 本地生成预览
  -> 本地连拍精选（每组 1 张）
  -> 代表帧 + 非连拍照片一次性送 API
  -> 全部筛完
  -> 人工复核
  -> 导出原片
```

连拍重复照片会立即标记，不等 API 结束。不会覆盖人工已经做出的结论。

## 下载

Release 中提供：

- `拾影-安装包-v1.0.0.exe`：推荐，安装后从开始菜单启动。
- `拾影-v1.0.0-win64.zip`：便携版，解压后双击 `拾影.exe`。
- `models-v1.0.0.zip`：源码运行所需的本地模型文件。

系统要求：Windows 10/11 64 位。安装包和 exe 未做代码签名，SmartScreen 提示时选择“更多信息 → 仍要运行”。

## 从源码运行

模型文件体积较大，不放进普通 Git 仓库，首次运行前下载到 `app/models/`。

```powershell
git clone https://github.com/honghh605/shiying-ai-.git
cd shiying

python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt

# 从 GitHub Release 下载模型
powershell -ExecutionPolicy Bypass -File scripts\setup_models.ps1 -Repo "honghh605/shiying-ai-"

# 原生窗口
.\.venv\Scripts\python.exe -m app.desktop
```

也可以用本地已有的 `models-v1.0.0.zip`：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup_models.ps1 -ZipPath "D:\downloads\models-v1.0.0.zip"
```

## 本地模型

- `clip_vision_vit_b32_float.onnx`：CLIP ViT-B/32 场景向量，约 351MB。
- `face_detection_yunet_2023mar.onnx`：YuNet 人脸检测。
- `face_recognition_sface_2021dec.onnx`：SFace 人脸特征。

来源和许可见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。模型只在本地推理，不上传照片。

## 构建

需要 Python 3.12、Inno Setup 6（安装包）和 PyInstaller。

```powershell
# 便携版 exe + zip
powershell -ExecutionPolicy Bypass -File scripts\build_zip.ps1

# 安装包
powershell -ExecutionPolicy Bypass -File scripts\build_installer.ps1
```

构建前确保 `app/models/` 中已有三个模型文件。

## 测试

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest -q
```

测试默认使用假接口，不产生 API 费用。

## 隐私

- 活动数据库、缩略图、日志默认在 `%LOCALAPPDATA%\ActivityPhotoCull`。
- API Key 使用 Windows DPAPI 加密保存。
- 不做遥测，不上传照片库。
- 只有执行 AI 初筛时，选中的预览图才会发送到配置的 DeepSeek 接口。
- 导出只复制源文件到目标文件夹，不删除原片。

## 已知限制

- 连拍精选依赖本地视觉模型，对侧脸、遮挡、远景小脸无法保证 100% 准确；证据不足时保守处理。
- AI 结果是建议，不是最终结论；正式活动前建议用 100–200 张真实照片对照人工结果验证。
- 需要用户自己准备 DeepSeek API Key，费用由 API 账号结算。
- 当前主要面向 Windows，macOS/Linux 未做完整验证。

## 许可证

本项目代码使用 [MIT License](./LICENSE)。第三方组件、模型和随包二进制文件使用各自许可证，详见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
