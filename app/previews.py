"""预览图生成与缓存。"""
from __future__ import annotations

import os

from PIL import Image, ImageOps

from . import config, raw_backend


def load_image(path: str, form: str, target: int) -> tuple[Image.Image, bool]:
    """返回 (RGB 图像, 是否降级)。只保证长边不超过 target。"""
    if form == "jpeg":
        with Image.open(path) as opened:
            # JPEG 可以先让解码器输出较小尺寸，明显加快网格/AI 预览生成。
            try:
                opened.draft("RGB", (target * 2, target * 2))
            except Exception:
                pass
            image = ImageOps.exif_transpose(opened)
            image = image.convert("RGB")
    else:
        image, degraded = raw_backend.load_raw_image(path, target)
        if max(image.size) > target:
            image.thumbnail((target, target), Image.LANCZOS)
        return image, degraded

    if max(image.size) > target:
        image.thumbnail((target, target), Image.LANCZOS)
    return image, False


def save_jpeg(image: Image.Image, dest: str, quality: int) -> None:
    folder = os.path.dirname(dest)
    os.makedirs(folder, exist_ok=True)
    tmp = dest + ".tmp"
    image.save(tmp, "JPEG", quality=quality, optimize=True)
    os.replace(tmp, dest)


def build_grid(path: str, form: str, dest: str) -> tuple[bool, str | None]:
    """生成网格缩略图。返回 (成功, 降级说明或错误)。"""
    try:
        image, degraded = load_image(path, form, config.PREVIEW_GRID)
        save_jpeg(image, dest, config.THUMB_QUALITY)
        return True, ("降级预览" if degraded else None)
    except Exception as exc:
        return False, str(exc)[:300]


def build_review(path: str, form: str, dest: str) -> tuple[bool, str | None]:
    try:
        image, degraded = load_image(path, form, config.PREVIEW_REVIEW)
        save_jpeg(image, dest, config.REVIEW_QUALITY)
        return True, ("降级预览" if degraded else None)
    except Exception as exc:
        return False, str(exc)[:300]


def build_ai(path: str, form: str, dest: str) -> tuple[bool, str | None]:
    """发送给模型的较小预览（长边 1024），控制请求体与 token。"""
    try:
        image, degraded = load_image(path, form, config.PREVIEW_AI)
        save_jpeg(image, dest, config.AI_QUALITY)
        return True, ("降级预览" if degraded else None)
    except Exception as exc:
        return False, str(exc)[:300]


def build_quick(path: str, form: str, dest: str, full_dest: str | None = None) -> tuple[bool, str | None]:
    """首轮保留足够主体细节；仅缓存缩图，不修改原片。"""
    try:
        # Decode a large JPEG/RAW once and keep the existing detailed preview for
        # phase two. Cached previews also avoid decoding the source on resume.
        if full_dest and os.path.exists(full_dest):
            image, degraded = load_image(full_dest, "jpeg", config.PREVIEW_AI)
        else:
            image, degraded = load_image(path, form, config.PREVIEW_AI)
            if full_dest:
                save_jpeg(image, full_dest, config.AI_QUALITY)
        image.thumbnail((960, 960), Image.LANCZOS)
        save_jpeg(image, dest, 80)
        return True, ("降级预览" if degraded else None)
    except Exception as exc:
        return False, str(exc)[:300]
