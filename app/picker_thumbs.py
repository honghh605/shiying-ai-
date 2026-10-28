"""导入选片用的临时缩略图。"""
from __future__ import annotations

import hashlib
import os

from PIL import Image, ImageOps

from . import config, raw_backend


def _load(path: str, target: int) -> Image.Image:
    ext = os.path.splitext(path)[1].lower()
    if ext in config.RAW_EXTS:
        image, _ = raw_backend.load_raw_image(path, target)
    else:
        with Image.open(path) as opened:
            image = ImageOps.exif_transpose(opened).convert("RGB")
    if max(image.size) > target:
        image.thumbnail((target, target), Image.LANCZOS)
    return image


def thumbnail(path: str, size: int = 420) -> str:
    path = os.path.abspath(path)
    if not os.path.isfile(path):
        raise ValueError("照片文件不存在")
    ext = os.path.splitext(path)[1].lower()
    if ext not in config.RAW_EXTS and ext not in config.JPG_EXTS:
        raise ValueError("不是可识别的照片文件")
    size = max(120, min(int(size or 420), 1600))
    digest = hashlib.sha1(f"{path}|{os.path.getmtime(path)}|{size}".encode("utf-8", "ignore")).hexdigest()
    folder = os.path.join(config.data_dir(), "cache", "picker")
    os.makedirs(folder, exist_ok=True)
    dest = os.path.join(folder, digest + ".jpg")
    if not os.path.isfile(dest):
        image = _load(path, size)
        temp = dest + ".tmp"
        image.save(temp, "JPEG", quality=82, optimize=True)
        os.replace(temp, dest)
    return dest
