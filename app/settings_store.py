"""非敏感设置（模型、接口地址、计价参数）与 API Key 状态的统一入口。"""
from __future__ import annotations

import json
import os

from . import config, keychain

DEFAULTS = {
    # deepseek-flash 支持图片输入；旧模型名会被官方路由到新模型
    "screening_concurrency": 3,
    "model": "deepseek-flash",
    # 留空 = 与精筛同一个模型；可单独填更快的快筛模型
    "quick_model": "",
    "base_url": "https://api.deepseek.com",
    # 计价按高峰时段、缓存未命中的偏高价格，实际费用以服务端账单为准
    "price_input_cny_per_m": 2.0,
    "price_output_cny_per_m": 8.0,
    "estimate_image_tokens": 1024,
    "estimate_prompt_tokens": 700,
    # 该模型会先输出推理内容，推理 token 也计入 max_tokens；
    # 400 会在真实照片上把 JSON 截断，默认给足 1600。
    "max_output_tokens": 1600,
    # 费用预估用的典型输出量（推理 + JSON），不是硬上限
    "estimate_output_tokens": 600,
}

INT_KEYS = {"screening_concurrency", "estimate_image_tokens", "estimate_prompt_tokens", "max_output_tokens", "estimate_output_tokens"}
FLOAT_KEYS = {"price_input_cny_per_m", "price_output_cny_per_m"}


def load_settings() -> dict:
    data = dict(DEFAULTS)
    path = config.settings_path()
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as fh:
                stored = json.load(fh)
            if isinstance(stored, dict):
                data.update({key: stored[key] for key in DEFAULTS if key in stored})
        except Exception:
            pass
    if data.get("model") == "deepseek-chat":  # 旧默认值不支持图片，升级时纠正
        data["model"] = "deepseek-flash"
    # 旧版本默认 400，会把推理 + JSON 截断；升级时自动抬高上限。
    try:
        if int(data.get("max_output_tokens") or 0) < 800:
            data["max_output_tokens"] = 1600
    except (TypeError, ValueError):
        data["max_output_tokens"] = 1600
    try:
        data["screening_concurrency"] = max(1, min(12, int(data["screening_concurrency"])))
    except (TypeError, ValueError):
        data["screening_concurrency"] = 3
    return data


def save_settings(patch: dict) -> dict:
    data = load_settings()
    for key in DEFAULTS:
        if key not in patch:
            continue
        value = patch[key]
        if key in FLOAT_KEYS:
            try:
                number = float(value)
            except (TypeError, ValueError):
                continue
            if number >= 0:
                data[key] = number
        elif key in INT_KEYS:
            try:
                number = int(value)
            except (TypeError, ValueError):
                continue
            if number > 0:
                data[key] = min(12, number) if key == "screening_concurrency" else number
        elif key == "quick_model" and isinstance(value, str):
            data[key] = value.strip()
        elif isinstance(value, str) and value.strip():
            data[key] = value.strip()
    path = config.settings_path()
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, path)
    return data


def public_settings() -> dict:
    from . import checks

    data = load_settings()
    return {
        "model": data["model"],
        "quick_model": data.get("quick_model", ""),
        "base_url": data["base_url"],
        "price_input_cny_per_m": data["price_input_cny_per_m"],
        "price_output_cny_per_m": data["price_output_cny_per_m"],
        "estimate_image_tokens": data["estimate_image_tokens"],
        "estimate_prompt_tokens": data["estimate_prompt_tokens"],
        "estimate_output_tokens": data["estimate_output_tokens"],
        "max_output_tokens": data["max_output_tokens"],
        "per_photo_cost": round(checks.per_photo_cost(data), 5),
        "api_key_set": keychain.has_api_key(),
        "screening_key_set": bool(keychain.screening_credentials()),
        "screening_keys": keychain.screening_keys_public(),
        "screening_concurrency": data["screening_concurrency"],
        "data_dir": config.data_dir(),
        "version": config.VERSION,
    }
