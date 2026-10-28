"""壁纸来源：本地上传、Windows 当前壁纸、Wallpaper Engine 预览图。"""
from __future__ import annotations

import base64
import ctypes
import hashlib
import io
import json
import os
import re
import shutil
from pathlib import Path

from PIL import Image

from . import config

_THUMBS: dict[str, str] = {}
_ITEMS: dict[str, dict] = {}


def wallpaper_dir() -> str:
    path = os.path.join(config.data_dir(), "wallpapers")
    os.makedirs(path, exist_ok=True)
    return path


def thumb_dir() -> str:
    path = os.path.join(wallpaper_dir(), "thumbs")
    os.makedirs(path, exist_ok=True)
    return path


def video_dir() -> str:
    path = os.path.join(wallpaper_dir(), "videos")
    os.makedirs(path, exist_ok=True)
    return path


def video_path(name: str) -> str | None:
    name = _safe_id(name)
    for ext in (".mp4", ".webm", ".mov", ".mkv"):
        path = os.path.join(video_dir(), name if name.lower().endswith(ext) else name + ext)
        if os.path.isfile(path):
            return path
    return None


def _safe_id(value: str) -> str:
    value = re.sub(r"[^a-zA-Z0-9_.-]", "", str(value or ""))
    if not value:
        raise ValueError("壁纸 id 无效")
    return value


def _save_image_bytes(payload: bytes, prefix: str = "wp") -> dict:
    try:
        with Image.open(io.BytesIO(payload)) as img:
            img.verify()
        with Image.open(io.BytesIO(payload)) as img:
            img = img.convert("RGB")
            if max(img.size) > 3840:
                img.thumbnail((3840, 3840), Image.LANCZOS)
            digest = hashlib.sha1(payload).hexdigest()[:16]
            name = f"{prefix}-{digest}.jpg"
            path = os.path.join(wallpaper_dir(), name)
            img.save(path, "JPEG", quality=92, optimize=True)
    except Exception as exc:
        raise ValueError(f"无法读取壁纸图片：{exc}") from exc
    return {
        "id": name,
        "name": name,
        "url": f"/api/wallpapers/file/{name}",
    }


def save_data_url(data: str, name: str = "wallpaper.jpg") -> dict:
    raw = str(data or "")
    if "," in raw and raw.lstrip().startswith("data:"):
        raw = raw.split(",", 1)[1]
    payload = base64.b64decode(raw, validate=True)
    if len(payload) > 20 * 1024 * 1024:
        raise ValueError("壁纸不能超过 20MB")
    result = _save_image_bytes(payload, "custom")
    result["original_name"] = name or "wallpaper.jpg"
    return result


def file_path(name: str) -> str | None:
    name = _safe_id(name)
    path = os.path.join(wallpaper_dir(), name)
    return path if os.path.isfile(path) else None


def thumb_path(name: str) -> str | None:
    name = _safe_id(name)
    path = _THUMBS.get(name)
    return path if path and os.path.isfile(path) else None


def system_wallpaper() -> dict:
    """读取当前 Windows 桌面壁纸并复制到拾影壁纸库。"""
    try:
        buffer = ctypes.create_unicode_buffer(32768)
        ok = ctypes.windll.user32.SystemParametersInfoW(0x0073, len(buffer), buffer, 0)
        if not ok or not buffer.value or not os.path.isfile(buffer.value):
            raise ValueError("读取 Windows 壁纸失败")
        with Image.open(buffer.value) as img:
            image = img.convert("RGB")
            if max(image.size) > 3840:
                image.thumbnail((3840, 3840), Image.LANCZOS)
            digest = hashlib.sha1(buffer.value.encode("utf-8", "ignore")).hexdigest()[:16]
            name = f"windows-{digest}.jpg"
            path = os.path.join(wallpaper_dir(), name)
            image.save(path, "JPEG", quality=92, optimize=True)
        return {"id": name, "name": "Windows 当前壁纸", "url": f"/api/wallpapers/file/{name}"}
    except OSError as exc:
        raise ValueError(f"读取 Windows 壁纸失败：{exc}") from exc


def _steam_roots() -> list[str]:
    roots: list[str] = []

    def add(value: str | None) -> None:
        if not value:
            return
        value = os.path.normpath(value.strip())
        if os.path.isdir(value) and value not in roots:
            roots.append(value)

    try:
        import winreg

        for hive, key_path, value_name in (
            (winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam", "SteamPath"),
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Valve\Steam", "InstallPath"),
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Valve\Steam", "InstallPath"),
        ):
            try:
                with winreg.OpenKey(hive, key_path) as key:
                    add(winreg.QueryValueEx(key, value_name)[0])
            except OSError:
                pass
    except Exception:
        pass
    for candidate in (
        r"C:\Program Files (x86)\Steam",
        r"C:\Program Files\Steam",
        r"D:\Steam",
        r"D:\SteamLibrary",
        r"E:\SteamLibrary",
        r"F:\SteamLibrary",
    ):
        add(candidate)
    # libraryfolders.vdf: Steam 的额外库
    extra: list[str] = []
    for root in list(roots):
        vdf = os.path.join(root, "steamapps", "libraryfolders.vdf")
        if not os.path.isfile(vdf):
            continue
        try:
            text = Path(vdf).read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for match in re.finditer(r'"path"\s+"([^"]+)"', text):
            extra.append(match.group(1).replace("\\\\", "\\"))
    for value in extra:
        add(value)
    return roots


def _read_project(folder: str) -> dict | None:
    project = os.path.join(folder, "project.json")
    if not os.path.isfile(project):
        return None
    try:
        data = json.loads(Path(project).read_text(encoding="utf-8", errors="ignore"))
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    preview = data.get("preview")
    candidates = []
    if isinstance(preview, str):
        candidates.append(os.path.join(folder, preview))
    candidates.extend(os.path.join(folder, name) for name in ("preview.jpg", "preview.png", "preview.jpeg", "preview.webp", "preview.gif"))
    preview_path = next((p for p in candidates if os.path.isfile(p)), None)
    if not preview_path:
        return None
    declared = data.get("file") if isinstance(data.get("file"), str) else ""
    declared = declared.replace("\\", "/")
    media_path = os.path.join(folder, declared) if declared else ""
    project_type = str(data.get("type") or "").lower()
    kind = "video" if project_type == "video" else ("web" if project_type == "web" else "scene")
    scene_file = ""
    if kind == "video":
        if not os.path.isfile(media_path):
            media_path = next((os.path.join(folder, name) for name in os.listdir(folder)
                               if name.lower().endswith((".mp4", ".webm", ".mov", ".mkv")) and os.path.isfile(os.path.join(folder, name))), "")
        if not media_path:
            kind = "image"
    elif declared and os.path.isfile(media_path):
        scene_file = declared
    else:
        # 兼容 project.json 声明 scene.json 但只带 scene.pkg 的项目
        for candidate in ("scene.pkg", "scene.json"):
            if os.path.isfile(os.path.join(folder, candidate)):
                scene_file = candidate
                break
    if kind in ("scene", "web") and not scene_file:
        kind = "image"
    try:
        with Image.open(preview_path) as img:
            img = img.convert("RGB")
            if max(img.size) > 1920:
                img.thumbnail((1920, 1920), Image.LANCZOS)
            digest = hashlib.sha1(preview_path.encode("utf-8", "ignore")).hexdigest()[:16]
            name = f"we-{digest}.jpg"
            dest = os.path.join(thumb_dir(), name)
            if not os.path.isfile(dest):
                img.save(dest, "JPEG", quality=85, optimize=True)
    except Exception:
        return None
    _THUMBS[name] = dest
    title = data.get("title") if isinstance(data.get("title"), str) else os.path.basename(folder)
    return {
        "id": name,
        "title": title,
        "type": data.get("type") or "scene",
        "kind": kind,
        "thumb_url": f"/api/wallpapers/thumb/{name}",
        "source": "Wallpaper Engine",
        "path": preview_path,
        "media_path": media_path if kind == "video" else "",
        "folder": folder,
        "scene_file": scene_file,
    }


def scan_wallpaper_engine() -> dict:
    roots = _steam_roots()
    folders: list[str] = []
    for root in roots:
        for candidate in (
            os.path.join(root, "steamapps", "workshop", "content", "431960"),
            os.path.join(root, "steamapps", "common", "wallpaper_engine", "projects", "myprojects"),
        ):
            if os.path.isdir(candidate):
                try:
                    for name in os.listdir(candidate):
                        path = os.path.join(candidate, name)
                        if os.path.isdir(path):
                            folders.append(path)
                except OSError:
                    pass
    items = []
    seen = set()
    for folder in sorted(folders, key=lambda p: os.path.basename(p).lower()):
        item = _read_project(folder)
        if not item or item["id"] in seen:
            continue
        seen.add(item["id"])
        _ITEMS[item["id"]] = item
        items.append(item)
        if len(items) >= 120:
            break
    return {
        "available": bool(roots),
        "steam_roots": roots,
        "count": len(items),
        "items": items,
    }


def apply_we(item_id: str) -> dict:
    item_id = _safe_id(item_id)
    source = _THUMBS.get(item_id)
    item = _ITEMS.get(item_id)
    if not source or not os.path.isfile(source) or not item:
        # 重新扫描一次，允许服务重启后按 id 恢复
        scan_wallpaper_engine()
        source = _THUMBS.get(item_id)
        item = _ITEMS.get(item_id)
    if not source or not os.path.isfile(source):
        raise ValueError("找不到该 Wallpaper Engine 壁纸预览")
    media = (item or {}).get("media_path") or ""
    if item and item.get("kind") == "video" and media and os.path.isfile(media):
        ext = os.path.splitext(media)[1].lower() or ".mp4"
        name = f"wallpaper-video-{hashlib.sha1(media.encode('utf-8', 'ignore')).hexdigest()[:12]}{ext}"
        dest = os.path.join(video_dir(), name)
        if not os.path.isfile(dest):
            shutil.copy2(media, dest)
        return {
            "id": name, "name": item.get("title") or "Wallpaper Engine 动态壁纸",
            "url": f"/api/wallpapers/file/{name}", "kind": "video",
            "media_url": f"/api/wallpapers/video/{name}", "media_type": ext.lstrip("."),
            "preview_url": f"/api/wallpapers/thumb/{item_id}",
        }
    scene_file = (item or {}).get("scene_file") or ""
    if item and item.get("kind") in ("scene", "web") and scene_file:
        from urllib.parse import quote
        base_url = f"/api/wallpapers/scene/{item_id}/"
        if item.get("kind") == "web":
            entry = quote(base_url + scene_file)
            scene_url = (f"/static/webwallgl/index.html?type=web&src={entry}"
                         "&fit=cover&muted=true&sceneFps=30&autoq=1")
        else:
            # httpSource() treats the source URL as the project directory and
            # appends project.json / scene.pkg itself. Passing scene.pkg as src
            # made it request scene.pkg/project.json and fall back to the clock.
            scene_url = (f"/static/webwallgl/index.html?type=scene"
                         f"&mediaBase={quote(base_url)}&fit=cover&muted=true&sceneFps=30&autoq=1")
        return {
            "id": item_id, "name": item.get("title") or "Wallpaper Engine 动态壁纸",
            "url": f"/api/wallpapers/thumb/{item_id}", "kind": "scene",
            "scene_url": scene_url, "preview_url": f"/api/wallpapers/thumb/{item_id}",
        }
    with Image.open(source) as img:
        image = img.convert("RGB")
        if max(image.size) > 3840:
            image.thumbnail((3840, 3840), Image.LANCZOS)
        name = f"wallpaper-engine-{hashlib.sha1(source.encode('utf-8', 'ignore')).hexdigest()[:12]}.jpg"
        dest = os.path.join(wallpaper_dir(), name)
        image.save(dest, "JPEG", quality=92, optimize=True)
    return {"id": name, "name": item.get("title") if item else "Wallpaper Engine 壁纸",
            "url": f"/api/wallpapers/file/{name}", "kind": "image"}
