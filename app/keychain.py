"""API Key 的本地加密存储（Windows DPAPI，绑定当前 Windows 用户）。"""
from __future__ import annotations

import ctypes
import ctypes.wintypes as wt
import os
import json
import threading
import uuid

from . import config

CRYPTPROTECT_UI_FORBIDDEN = 0x01
_pool_lock = threading.RLock()


class _DataBlob(ctypes.Structure):
    _fields_ = [("cbData", wt.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]


def _blob(data: bytes) -> _DataBlob:
    buffer = ctypes.create_string_buffer(data, len(data))
    return _DataBlob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_char)))


def _free(pointer) -> None:
    kernel32 = ctypes.windll.kernel32
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    kernel32.LocalFree.restype = ctypes.c_void_p
    kernel32.LocalFree(ctypes.cast(pointer, ctypes.c_void_p))


def _protect(data: bytes) -> bytes:
    crypt32 = ctypes.windll.crypt32
    crypt32.CryptProtectData.argtypes = [
        ctypes.POINTER(_DataBlob), ctypes.c_wchar_p, ctypes.POINTER(_DataBlob),
        ctypes.c_void_p, ctypes.c_void_p, wt.DWORD, ctypes.POINTER(_DataBlob),
    ]
    crypt32.CryptProtectData.restype = wt.BOOL
    out = _DataBlob()
    if not crypt32.CryptProtectData(
        ctypes.byref(_blob(data)), None, None, None, None,
        CRYPTPROTECT_UI_FORBIDDEN, ctypes.byref(out),
    ):
        raise OSError("DPAPI 加密失败")
    try:
        return ctypes.string_at(out.pbData, out.cbData)
    finally:
        _free(out.pbData)


def _unprotect(data: bytes) -> bytes:
    crypt32 = ctypes.windll.crypt32
    crypt32.CryptUnprotectData.argtypes = [
        ctypes.POINTER(_DataBlob), ctypes.POINTER(ctypes.c_wchar_p), ctypes.POINTER(_DataBlob),
        ctypes.c_void_p, ctypes.c_void_p, wt.DWORD, ctypes.POINTER(_DataBlob),
    ]
    crypt32.CryptUnprotectData.restype = wt.BOOL
    out = _DataBlob()
    if not crypt32.CryptUnprotectData(
        ctypes.byref(_blob(data)), None, None, None, None,
        CRYPTPROTECT_UI_FORBIDDEN, ctypes.byref(out),
    ):
        raise OSError("DPAPI 解密失败")
    try:
        return ctypes.string_at(out.pbData, out.cbData)
    finally:
        _free(out.pbData)


def save_api_key(key: str) -> None:
    key = key.strip()
    if not key:
        raise ValueError("API Key 不能为空")
    protected = _protect(key.encode("utf-8"))
    path = config.secret_path()
    tmp = path + ".tmp"
    with open(tmp, "wb") as fh:
        fh.write(protected)
    os.replace(tmp, path)


def load_api_key() -> str | None:
    path = config.secret_path()
    if not os.path.exists(path):
        return None
    try:
        with open(path, "rb") as fh:
            data = fh.read()
        return _unprotect(data).decode("utf-8")
    except Exception:
        return None


def has_api_key() -> bool:
    return load_api_key() is not None


def clear_api_key() -> None:
    path = config.secret_path()
    if os.path.exists(path):
        os.remove(path)


def _pool_path() -> str:
    return os.path.join(config.data_dir(), "screening-keys.dpapi")


def load_screening_keys() -> list[dict]:
    """Only screening code may read these secrets; public APIs return masks."""
    with _pool_lock:
        if not os.path.exists(_pool_path()):
            return []
        try:
            with open(_pool_path(), "rb") as fh:
                items = json.loads(_unprotect(fh.read()).decode("utf-8"))
            if not isinstance(items, list) or any(
                not isinstance(item, dict) or not isinstance(item.get("key"), str)
                or not isinstance(item.get("id"), str) for item in items
            ):
                raise ValueError()
            return items
        except Exception as exc:
            raise ValueError("筛图 Key 池无法解密，请使用保存它的 Windows 账号") from exc


def _save_screening_keys(items: list[dict]) -> None:
    path = _pool_path()
    protected = _protect(json.dumps(items).encode("utf-8"))
    with open(path + ".tmp", "wb") as fh:
        fh.write(protected)
    os.replace(path + ".tmp", path)


def screening_keys_public() -> list[dict]:
    return [{"id": item["id"], "mask": "•••• " + item["key"][-4:]} for item in load_screening_keys()]


def add_screening_key(key: str) -> None:
    key = key.strip()
    if len(key) < 12 or len(key) > 512 or any(char.isspace() for char in key):
        raise ValueError("请输入完整的 API Key，不能包含空格或换行")
    with _pool_lock:
        items = load_screening_keys()
        if key == load_api_key() or any(item["key"] == key for item in items):
            raise ValueError("这个 Key 已保存，无需重复添加")
        if len(items) >= 8:
            raise ValueError("最多保存 8 个筛图专用 Key")
        items.append({"id": uuid.uuid4().hex, "key": key})
        _save_screening_keys(items)


def remove_screening_key(key_id: str) -> None:
    with _pool_lock:
        items = load_screening_keys()
        _save_screening_keys([item for item in items if item["id"] != key_id])


def screening_credentials() -> list[str]:
    main = load_api_key()
    keys = ([main] if main else []) + [item["key"] for item in load_screening_keys()]
    return list(dict.fromkeys(keys))
