"""DeepSeek 视觉接口客户端（OpenAI 兼容 /chat/completions）。"""
from __future__ import annotations

import base64
import json
from contextlib import nullcontext

import httpx

from . import checks


class DeepSeekError(Exception):
    def __init__(self, message: str, retryable: bool = False, status_code: int | None = None,
                 usage: dict | None = None):
        super().__init__(message)
        self.retryable = retryable
        self.status_code = status_code
        self.usage = usage


def _endpoint(base_url: str) -> str:
    return base_url.rstrip("/") + "/chat/completions"


def _merge_usage(total: dict, usage: dict) -> dict:
    """模型调用可能因截断重试两次，费用要把两次的 token 都算上。"""
    for key in ("prompt_tokens", "completion_tokens", "total_tokens"):
        total[key] = int(total.get(key) or 0) + int(usage.get(key) or 0)
    return total


def analyze_image(image_path: str, enabled: list[str], modes: dict[str, str], *,
                  api_key: str, model: str, base_url: str, activity_kind: str = "",
                  max_output_tokens: int = 1600, timeout: float = 120.0,
                  client: httpx.Client | None = None, quick: bool = False,
                  quick_verify: bool = False) -> tuple[dict, dict]:
    """返回 (每项结果, usage)。网络/服务错误抛 DeepSeekError。

    deepseek-flash 会先输出 reasoning_content，推理 token 也占用 max_tokens；
    max_tokens 太小时 JSON 会被截断。这里遇到截断会自动翻倍重试一次。
    """
    try:
        with open(image_path, "rb") as fh:
            encoded = base64.b64encode(fh.read()).decode("ascii")
    except OSError as exc:
        raise DeepSeekError(f"无法读取预览图：{exc}") from exc

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": ("你是照片质量初筛的独立复核员，只按可见证据返回指定 JSON。"
                                           if quick_verify else
                                           "你是照片质量初筛助手，只按可见证据返回指定 JSON。")
                                           if quick else checks.SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": (
                        checks.quick_verify_prompt(enabled, modes) if quick_verify else checks.quick_prompt(enabled, modes)
                    ) if quick else checks.build_prompt(enabled, modes, activity_kind)},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{encoded}", "detail": "original"},
                    },
                ],
            },
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.1,
        "max_tokens": max_output_tokens,
        "stream": False,
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    cap = max(800, int(max_output_tokens or 1600))
    usage_total: dict = {}

    for _ in range(2):
        payload["max_tokens"] = cap
        try:
            with (nullcontext(client) if client is not None else httpx.Client(timeout=timeout)) as session:
                response = session.post(_endpoint(base_url), headers=headers, json=payload, timeout=timeout)
        except httpx.TimeoutException as exc:
            raise DeepSeekError("请求超时，结果可能已计费", retryable=True, usage=usage_total or None) from exc
        except httpx.HTTPError as exc:
            hint = "；请检查网络或代理后重试" if "SSL" in str(exc) or "EOF" in str(exc) else ""
            raise DeepSeekError(f"网络错误：{exc}{hint}", retryable=True,
                                usage=usage_total or None) from exc

        if response.status_code in (401, 403):
            raise DeepSeekError("API Key 无效或无权限，请在设置中更新", status_code=response.status_code,
                                usage=usage_total or None)
        if response.status_code == 429:
            raise DeepSeekError("请求过于频繁或额度不足（429）", retryable=True, status_code=429,
                                usage=usage_total or None)
        if response.status_code >= 500:
            raise DeepSeekError(f"服务端错误（{response.status_code}）", retryable=True,
                                status_code=response.status_code, usage=usage_total or None)
        if response.status_code >= 400:
            detail = response.text[:300]
            raise DeepSeekError(f"请求失败（{response.status_code}）：{detail}", status_code=response.status_code,
                                usage=usage_total or None)

        try:
            data = response.json()
            choice = data["choices"][0]
            content = choice["message"]["content"]
            usage = data.get("usage") or {}
            finish_reason = choice.get("finish_reason")
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise DeepSeekError(f"无法解析接口返回：{exc}", retryable=True,
                                usage=usage_total or None) from exc

        usage_total = _merge_usage(usage_total, usage)

        if finish_reason == "length":
            if cap < 3000:
                cap = min(4096, max(1600, cap * 2))
                continue
            raise DeepSeekError(
                "模型输出被截断（推理占用了 token）。请到设置把“最大输出 token”调到 1600 以上",
                usage=usage_total,
            )

        try:
            parsed = checks.parse_quick(content, enabled, modes) if quick else checks.parse_response(content, enabled)
        except (ValueError, json.JSONDecodeError) as exc:
            truncated = not (content or "").strip()
            message = (
                f"模型没有返回内容（可能触发长度上限）。请把“最大输出 token”调到 1600 以上"
                if truncated else f"模型未返回合法 JSON：{exc}"
            )
            raise DeepSeekError(message, retryable=True, usage=usage_total) from exc
        return parsed, usage_total

    raise DeepSeekError("模型输出连续被截断，请把“最大输出 token”调大后重试", usage=usage_total or None)



def chat_completion(messages: list[dict], *, api_key: str, model: str, base_url: str,
                    tools: list[dict] | None = None, temperature: float = 0.2,
                    max_tokens: int = 1200, timeout: float = 90.0) -> dict:
    """普通对话/工具调用接口，返回 assistant message 与 usage。"""
    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
    }
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    try:
        with httpx.Client(timeout=timeout) as client:
            response = client.post(_endpoint(base_url), headers=headers, json=payload)
    except httpx.TimeoutException as exc:
        raise DeepSeekError("请求超时，请稍后重试", retryable=True) from exc
    except httpx.HTTPError as exc:
        hint = "；请检查网络或代理" if "SSL" in str(exc) or "EOF" in str(exc) else ""
        raise DeepSeekError(f"网络错误：{exc}{hint}", retryable=True) from exc

    if response.status_code in (401, 403):
        raise DeepSeekError("API Key 无效或无权限，请到设置中更新", status_code=response.status_code)
    if response.status_code == 429:
        raise DeepSeekError("请求过于频繁或额度不足（429）", retryable=True, status_code=429)
    if response.status_code >= 500:
        raise DeepSeekError(f"服务端错误（{response.status_code}）", retryable=True, status_code=response.status_code)
    if response.status_code >= 400:
        raise DeepSeekError(f"请求失败（{response.status_code}）：{response.text[:300]}", status_code=response.status_code)
    try:
        data = response.json()
        choice = data["choices"][0]
        message = choice["message"]
        return {"message": message, "usage": data.get("usage") or {}, "finish_reason": choice.get("finish_reason")}
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise DeepSeekError(f"无法解析接口返回：{exc}", retryable=True) from exc
