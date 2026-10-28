"""本机文件夹浏览（导入/导出选择用，不依赖系统对话框）。"""
from __future__ import annotations

import os
import string

from . import config


def list_dir(path: str | None = None, include_files: bool = False) -> dict:
    if not path:
        entries = [
            {"name": f"{letter}:\\", "path": f"{letter}:\\"}
            for letter in string.ascii_uppercase
            if os.path.exists(f"{letter}:\\")
        ]
        return {"path": "", "parent": None, "entries": entries}

    path = os.path.abspath(path)
    if not os.path.isdir(path):
        raise ValueError("文件夹不存在或不可访问")
    entries = []
    try:
        with os.scandir(path) as iterator:
            for entry in iterator:
                if entry.name.startswith(".") or entry.name.startswith("$"):
                    continue
                try:
                    if entry.is_dir(follow_symlinks=False):
                        entries.append({"name": entry.name, "path": entry.path, "type": "dir"})
                    elif include_files and entry.is_file(follow_symlinks=False):
                        ext = os.path.splitext(entry.name)[1].lower()
                        if ext in config.RAW_EXTS or ext in config.JPG_EXTS:
                            try:
                                size = entry.stat(follow_symlinks=False).st_size
                            except OSError:
                                size = 0
                            entries.append({"name": entry.name, "path": entry.path, "type": "file", "size": size})
                except OSError:
                    continue
    except PermissionError as exc:
        raise ValueError(f"无权访问该文件夹：{exc}") from exc
    entries.sort(key=lambda item: item["name"].lower())

    drive, tail = os.path.splitdrive(path)
    if tail in ("\\", "/"):
        # 盘符根目录的上一级是“此电脑”（path 为空），不是 None。
        parent = ""
    else:
        parent = os.path.dirname(path.rstrip("\\/"))
        if not parent or parent == path:
            parent = None
    return {"path": path, "parent": parent, "entries": entries}


def create_dir(parent: str, name: str) -> dict:
    parent = os.path.abspath(parent)
    if not os.path.isdir(parent):
        raise ValueError("上级文件夹不存在")
    name = (name or "").strip()
    if not name or name in (".", "..") or any(ch in name for ch in '\\/:*?"<>|'):
        raise ValueError("文件夹名称不能为空，也不能包含路径分隔符或特殊字符")
    target = os.path.join(parent, name)
    if os.path.exists(target):
        raise ValueError("同名文件或文件夹已存在")
    try:
        os.mkdir(target)
    except OSError as exc:
        raise ValueError(f"创建文件夹失败：{exc}") from exc
    return {"ok": True, "path": target, "listing": list_dir(parent)}


def open_in_explorer(path: str) -> dict:
    path = os.path.abspath(path)
    if not os.path.exists(path):
        raise ValueError("路径不存在")
    os.startfile(path)  # noqa: S606 - 本地工具，打开资源管理器
    return {"ok": True}
