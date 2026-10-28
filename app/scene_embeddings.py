"""本地场景向量（CLIP ViT-B/32 ONNX）。

用于连拍分组：把整张照片映射成 512 维向量，语义上相近的“同一场景/
同一构图”会得到较高余弦相似度。模型随安装包离线提供，不联网。
"""
from __future__ import annotations

import os
import threading

import numpy as np

from . import config

MODEL_NAME = "clip_vision_vit_b32_float.onnx"
# CLIP 官方图像预处理参数
_MEAN = np.array([0.48145466, 0.4578275, 0.40821073], dtype=np.float32)
_STD = np.array([0.26862954, 0.26130258, 0.27577711], dtype=np.float32)

_lock = threading.Lock()
_loaded = False
_session = None
_cache: dict[tuple[str, float], np.ndarray | None] = {}


def model_path() -> str:
    return os.path.join(config.resource_dir(), "app", "models", MODEL_NAME)


def _load() -> bool:
    global _loaded, _session
    if _loaded:
        return _session is not None
    with _lock:
        if _loaded:
            return _session is not None
        _loaded = True
        path = model_path()
        if not os.path.exists(path):
            return False
        try:
            import onnxruntime as ort
            options = ort.SessionOptions()
            options.intra_op_num_threads = 2
            options.inter_op_num_threads = 1
            _session = ort.InferenceSession(
                path, sess_options=options, providers=["CPUExecutionProvider"]
            )
            return True
        except Exception:
            _session = None
            return False


def available() -> bool:
    return _load()


def _preprocess(image) -> np.ndarray:
    from PIL import Image

    rgb = image.convert("RGB")
    width, height = rgb.size
    side = min(width, height)
    if side <= 0:
        raise ValueError("empty image")
    rgb = rgb.crop(
        ((width - side) // 2, (height - side) // 2, (width + side) // 2, (height + side) // 2)
    ).resize((224, 224), Image.Resampling.BICUBIC)
    array = np.asarray(rgb, dtype=np.float32) / 255.0
    array = (array - _MEAN) / _STD
    return array.transpose(2, 0, 1)[None]


def embedding(path: str) -> np.ndarray | None:
    """Return a normalized 512-d CLIP image embedding, or None."""
    if not _load():
        return None
    try:
        stat = os.stat(path)
    except OSError:
        return None
    key = (path, stat.st_mtime)
    if key in _cache:
        return _cache[key]
    try:
        from PIL import Image

        with Image.open(path) as opened:
            tensor = _preprocess(opened)
        value = _session.run(None, {"pixel_values": tensor})[0][0]
        value = np.asarray(value, dtype=np.float32)
        norm = float(np.linalg.norm(value))
        if norm <= 0:
            value = None
        else:
            value = value / norm
    except Exception:
        value = None
    _cache[key] = value
    return value


def similarity(first, second) -> float | None:
    if first is None or second is None:
        return None
    try:
        return float(np.dot(first, second))
    except Exception:
        return None
