"""本地人脸检测/识别（OpenCV YuNet + SFace），不联网、不上传照片。

模型文件位于 app/models，源码/安装包都会带上。首次使用会把模型复制到
一个纯 ASCII 路径，因为 Windows 版 OpenCV 对中文路径支持不稳定。
"""
from __future__ import annotations

import os
import shutil
import threading

from . import config

FACE_DETECT_MODEL = "face_detection_yunet_2023mar.onnx"
FACE_EMBED_MODEL = "face_recognition_sface_2021dec.onnx"
# OpenCV SFace 官方推荐余弦阈值约 0.363；这里取更保守的 0.40，
# 宁可漏掉同一人连拍，也不把不同领导并成一组。
FACE_MATCH_THRESHOLD = 0.25

_lock = threading.Lock()
_loaded = False
_detector = None
_recognizer = None
_cv2 = None
_np = None
_embedding_cache: dict[tuple[str, float], object | None] = {}
_embeddings_cache: dict[tuple[str, float], list] = {}


def _models_src() -> str:
    return os.path.join(config.resource_dir(), "app", "models")


def _ascii_models_dir() -> str | None:
    """OpenCV 在 Windows 上打不开中文路径；复制到 Users\\Public。"""
    base = os.environ.get("PUBLIC") or r"C:\Users\Public"
    target = os.path.join(base, "ActivityPhotoCull", "models")
    try:
        os.makedirs(target, exist_ok=True)
        for name in (FACE_DETECT_MODEL, FACE_EMBED_MODEL):
            src = os.path.join(_models_src(), name)
            dst = os.path.join(target, name)
            if not os.path.exists(src):
                return None
            if not os.path.exists(dst) or os.path.getsize(dst) != os.path.getsize(src):
                shutil.copy2(src, dst)
        return target
    except OSError:
        return None


def _load():
    global _loaded, _detector, _recognizer, _cv2, _np
    if _loaded:
        return _cv2 is not None
    with _lock:
        if _loaded:
            return _cv2 is not None
        _loaded = True
        try:
            import cv2
            import numpy as np
        except Exception:
            return False
        model_dir = _ascii_models_dir()
        if not model_dir:
            return False
        try:
            _detector = cv2.FaceDetectorYN.create(
                os.path.join(model_dir, FACE_DETECT_MODEL), "", (320, 320), 0.5, 0.3, 5000
            )
            _recognizer = cv2.FaceRecognizerSF.create(
                os.path.join(model_dir, FACE_EMBED_MODEL), ""
            )
            _cv2 = cv2
            _np = np
            return True
        except Exception:
            _detector = _recognizer = None
            return False


def available() -> bool:
    return _load()


def _read_image(path: str):
    if not _load():
        return None
    try:
        data = _np.fromfile(path, dtype=_np.uint8)
        image = _cv2.imdecode(data, _cv2.IMREAD_COLOR)
    except Exception:
        return None
    if image is None or image.size == 0:
        return None
    height, width = image.shape[:2]
    longest = max(height, width)
    if longest > 720:
        scale = 720.0 / longest
        image = _cv2.resize(image, (max(1, int(width * scale)), max(1, int(height * scale))))
    return image


def embeddings(path: str) -> list:
    """Return SFace embeddings for all detected faces (largest first).

    集体照里每帧最大的脸可能不是同一个人；分组时比较“任一共同人脸”，
    不能只看最大脸，否则同一群人的照片会被判成不同人。
    """
    if not _load():
        return []
    try:
        stat = os.stat(path)
    except OSError:
        return []
    key = (path, stat.st_mtime)
    if key in _embeddings_cache:
        return _embeddings_cache[key]
    image = _read_image(path)
    if image is None:
        _embeddings_cache[key] = []
        return []
    try:
        height, width = image.shape[:2]
        _detector.setInputSize((width, height))
        _count, found = _detector.detect(image)
        if found is None or len(found) == 0:
            _embeddings_cache[key] = []
            return []
        ordered = sorted(found, key=lambda item: float(item[2]) * float(item[3]), reverse=True)[:6]
        result = []
        for face in ordered:
            aligned = _recognizer.alignCrop(image, face)
            result.append(_recognizer.feature(aligned))
        _embeddings_cache[key] = result
        return result
    except Exception:
        _embeddings_cache[key] = []
        return []


def embedding(path: str):
    """Return the largest/central face embedding, kept for single-face callers."""
    if not _load():
        return None
    try:
        stat = os.stat(path)
    except OSError:
        return None
    key = (path, stat.st_mtime)
    if key in _embedding_cache:
        return _embedding_cache[key]
    values = embeddings(path)
    feature = values[0] if values else None
    _embedding_cache[key] = feature
    return feature


def similarity(first, second) -> float | None:
    if first is None or second is None:
        return None
    if not _load():
        return None
    try:
        return float(_recognizer.match(first, second, _cv2.FaceRecognizerSF_FR_COSINE))
    except Exception:
        return None


def similarity_sets(first, second) -> float | None:
    """Best cosine among any two faces; None if either set is empty."""
    if not first or not second:
        return None
    best = None
    for left in first:
        for right in second:
            score = similarity(left, right)
            if score is not None and (best is None or score > best):
                best = score
    return best


def same_person(path_a: str, path_b: str) -> tuple[bool | None, float | None]:
    """True/False, or None when no reliable face comparison is possible."""
    if not _load():
        return None, None
    first = embedding(path_a)
    second = embedding(path_b)
    score = similarity(first, second)
    if score is None:
        return None, None
    return score >= FACE_MATCH_THRESHOLD, score
