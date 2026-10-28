# 第三方组件与许可说明

拾影自己的代码使用 MIT License。以下第三方组件、模型和运行时保留各自许可证；本项目不重新授权它们。

## 模型

| 文件 | 来源 | 许可 |
|---|---|---|
| `clip_vision_vit_b32_float.onnx` | OpenAI CLIP ViT-B/32，ONNX 导出来自 [Xenova/clip-vit-base-patch32](https://huggingface.co/Xenova/clip-vit-base-patch32) | 按 [OpenAI CLIP](https://github.com/openai/CLIP) 仓库及模型卡许可；分发时保留上游声明 |
| `face_detection_yunet_2023mar.onnx` | [OpenCV Zoo](https://github.com/opencv/opencv_zoo) YuNet | Apache-2.0（以模型目录说明为准） |
| `face_recognition_sface_2021dec.onnx` | [OpenCV Zoo](https://github.com/opencv/opencv_zoo) SFace | Apache-2.0（以模型目录说明为准） |

模型默认不打进 Git 仓库，通过 GitHub Release 分发。重新分发前请再次核对上游模型卡和许可条款。

## 运行时与依赖

- Python：PSF License。
- FastAPI：MIT。
- Uvicorn：BSD-3-Clause。
- Pillow：HPND。
- rawpy：MIT；其底层 LibRaw 使用 LGPL-2.1/CDDL（以实际 wheel 和 LibRaw 版本为准）。
- ExifRead：BSD 风格许可。
- NumPy：BSD-3-Clause。
- httpx：BSD-3-Clause。
- OpenCV / opencv-python-headless：Apache-2.0；其随包 FFmpeg 可能涉及 LGPL/GPL，请以实际 wheel 的 `LICENSE` 为准。
- ONNX Runtime：MIT。
- pywebview：BSD-3-Clause。
- pystray：**LGPLv3**。发布二进制版本时需保留其许可文本，并确认打包/重链接方式符合 LGPL；如果不希望承担该合规要求，可替换为宽松许可的托盘实现。
- PyInstaller：GPLv2-or-later，附带允许构建和分发非自由程序的特殊例外。
- Inno Setup：按其许可分发安装包。

## 前端

前端为项目自写代码，除随包字体、图标和壁纸素材外，不包含第三方前端框架。字体、壁纸和图标如来自第三方，请在上游许可要求的范围内使用。

## 合规建议

1. 发布安装包或便携包时，在安装目录或关于页面提供本文件和对应许可证文本。
2. 保留所有第三方版权声明。
3. 如果修改了 LGPL 组件的打包方式，请重新评估动态链接/重链接义务。
4. 如果要将模型用于商业分发，请先确认模型权重许可和再分发条件。
