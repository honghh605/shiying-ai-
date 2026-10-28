"""用户界面偏好持久化（跨随机端口/重启保持）。"""
from __future__ import annotations

import json
import os
import tempfile

from . import config

PREF_FILE = "preferences.json"


def _path() -> str:
    return os.path.join(config.data_dir(), PREF_FILE)


def read() -> dict:
    try:
        with open(_path(), "r", encoding="utf-8") as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def update(preferences: dict) -> dict:
    current = read()
    if isinstance(preferences, dict):
        current.update({str(key): value for key, value in preferences.items() if isinstance(key, str)})
    path = _path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix="prefs-", suffix=".json", dir=os.path.dirname(path))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(current, handle, ensure_ascii=False, indent=2)
        os.replace(temp, path)
    finally:
        try:
            if os.path.exists(temp):
                os.remove(temp)
        except OSError:
            pass
    return current
