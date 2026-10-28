"""RAW 预览提取：优先内嵌 JPEG，失败后退化为半尺寸解码。"""
from __future__ import annotations

import io
import os

from PIL import Image, ImageOps

from . import config


class PreviewError(Exception):
    pass


def _open_embedded(path: str, target: int) -> Image.Image | None:
    import rawpy

    try:
        with rawpy.imread(path) as raw:
            thumb = raw.extract_thumb()
        if thumb.format == rawpy.ThumbFormat.JPEG:
            image = Image.open(io.BytesIO(thumb.data))
        else:  # BITMAP
            image = Image.fromarray(thumb.data)
        image = ImageOps.exif_transpose(image)
        image = image.convert("RGB")
        if max(image.size) < target // 3:
            return None
        return image
    except Exception:
        return None


def _decode_half(path: str) -> Image.Image:
    import rawpy

    try:
        with rawpy.imread(path) as raw:
            data = raw.postprocess(half_size=True, use_camera_wb=True, output_bps=8)
    except Exception as exc:  # 解析失败要能显示原因，不能被当成废片
        raise PreviewError(f"RAW 解析失败：{exc}") from exc
    return Image.fromarray(data).convert("RGB")


def load_raw_image(path: str, target: int) -> tuple[Image.Image, bool]:
    """返回 (图像, 是否为降级预览)。"""
    if not os.path.exists(path):
        raise PreviewError("源文件不存在")
    image = _open_embedded(path, target)
    if image is not None:
        return image, False
    return _decode_half(path), True
