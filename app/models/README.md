# 本地人脸模型

用于连拍分组时的人物相似度，不联网、不上传照片。

- `face_detection_yunet_2023mar.onnx`：OpenCV Zoo YuNet 人脸检测。
- `face_recognition_sface_2021dec.onnx`：OpenCV Zoo SFace 人脸特征。

来源：https://github.com/opencv/opencv_zoo
许可：Apache License 2.0（以 OpenCV Zoo 对应模型目录说明为准）。

构建脚本会把本目录打进 `app/models`，安装后离线可用。


## 场景向量模型

- `clip_vision_vit_b32_float.onnx`：OpenAI CLIP ViT-B/32 图像编码器的 ONNX 导出
  （Xenova/clip-vit-base-patch32），保留 float32。
- 用途：连拍分组中的“环境/构图/场景”相似度。
- 来源：https://github.com/openai/CLIP 、
  https://huggingface.co/Xenova/clip-vit-base-patch32
- 许可：OpenAI CLIP 以 MIT License 发布；上游模型卡和仓库许可为准。
- 运行时：Microsoft ONNX Runtime（MIT License）。
