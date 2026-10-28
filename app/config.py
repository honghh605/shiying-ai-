"""全局配置与路径。"""
from __future__ import annotations

import os
import sys

APP_NAME = "ActivityPhotoCull"
APP_DISPLAY_NAME = "拾影"
VERSION = "1.0.0"

# 支持的扩展名（小写）
RAW_EXTS = {".arw", ".cr2", ".cr3", ".nef", ".dng", ".raf", ".orf", ".rw2", ".srw", ".pef"}
JPG_EXTS = {".jpg", ".jpeg"}

PREVIEW_GRID = 320      # 网格缩略图长边
PREVIEW_REVIEW = 1600   # 复核大图长边
PREVIEW_AI = 1024       # 发送给模型的长边（官方会把大图缩到约 1300×1300，token 上限 1024）
THUMB_QUALITY = 82
REVIEW_QUALITY = 88
AI_QUALITY = 86

VERDICTS = {"keep", "reject", "uncertain"}


def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def app_dir() -> str:
    """源码运行时是项目根目录；打包后是 exe 所在目录。"""
    if is_frozen():
        return os.path.dirname(os.path.abspath(sys.executable))
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def resource_dir() -> str:
    """打包后静态资源在 _MEIPASS；源码运行时在项目根目录。"""
    if is_frozen():
        return str(getattr(sys, "_MEIPASS", app_dir()))
    return app_dir()


def web_dir() -> str:
    return os.path.join(resource_dir(), "app", "web")


def data_dir() -> str:
    base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    path = os.path.join(base, APP_NAME)
    os.makedirs(path, exist_ok=True)
    return path


def db_path() -> str:
    return os.path.join(data_dir(), "cull.db")


def settings_path() -> str:
    return os.path.join(data_dir(), "settings.json")


def secret_path() -> str:
    return os.path.join(data_dir(), "secret.bin")


def logs_dir() -> str:
    path = os.path.join(data_dir(), "logs")
    os.makedirs(path, exist_ok=True)
    return path


def cache_root(activity_id: str) -> str:
    path = os.path.join(data_dir(), "cache", activity_id)
    os.makedirs(path, exist_ok=True)
    return path


def thumb_path(activity_id: str, photo_id: str) -> str:
    folder = os.path.join(cache_root(activity_id), "thumb")
    os.makedirs(folder, exist_ok=True)
    return os.path.join(folder, photo_id + ".jpg")


def review_path(activity_id: str, photo_id: str) -> str:
    folder = os.path.join(cache_root(activity_id), "review")
    os.makedirs(folder, exist_ok=True)
    return os.path.join(folder, photo_id + ".jpg")


def ai_path(activity_id: str, photo_id: str) -> str:
    folder = os.path.join(cache_root(activity_id), "ai")
    os.makedirs(folder, exist_ok=True)
    return os.path.join(folder, photo_id + ".jpg")

















