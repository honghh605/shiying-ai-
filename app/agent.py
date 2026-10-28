"""拾影 Agent：DeepSeek 对话 + 本地工具调用。"""
from __future__ import annotations

import base64
import io
import ipaddress
import json
import os
import re
import shutil
import urllib.parse
import webbrowser
from pathlib import Path

import httpx
from PIL import Image

from . import activities, config, db, deepseek, keychain, previews, review, settings_store


class AgentError(Exception):
    pass


SYSTEM_PROMPT = """你是「拾影」照片初筛软件的 AI 操作助手。你要用简洁中文帮助用户查看数据、筛选照片和完成基础操作。

规则：
1. 先用工具获取真实数据，不要编造活动、照片或数量。
2. 用户要求修改照片状态时，如果目标已经明确，可以直接调用 set_photo_verdict；一次最多 30 张。目标不明确时先问清楚。
3. 删除原片、导出原片、启动全量 AI 分析不要直接执行，告诉用户到对应界面确认。
4. navigate_to 和 set_review_filter 只负责切换界面或筛选条件，不会修改照片。
5. 回答先给结论，再说明做了什么；不要输出 JSON 或工具参数，不要使用 Markdown 表格或长代码块。
6. 权限边界：只能读取/复制照片和写入用户明确指定的输出文件夹；严禁读取、写入或修改软件源码、安装目录和程序文件；不要生成补丁或让用户执行代码。
7. 联网工具 web_fetch / open_url 只允许 http/https，禁止访问 localhost、127.0.0.1、内网地址。
8. 按参考图找人时，先确认活动、参考图和目标文件夹；使用低分辨率预览快速比较当前分类内全部照片（最多 200 张）。复制前必须确认目标目录。

当前界面上下文会附在用户消息前；优先使用当前活动，除非用户明确指定其他活动。"""


def _tool_defs() -> list[dict]:
    def fn(name: str, description: str, properties: dict, required: list[str]) -> dict:
        return {"type": "function", "function": {
            "name": name, "description": description,
            "parameters": {"type": "object", "properties": properties, "required": required},
        }}
    return [
        fn("list_activities", "列出全部活动，含 id、名称、文件数和保留数。", {}, []),
        fn("get_activity_summary", "查看一个活动的统计、来源卡和当前阶段。", {
            "activity_id": {"type": "string", "description": "活动 id"},
        }, ["activity_id"]),
        fn("search_photos", "按分类、文件名关键字或来源筛选照片，最多返回 20 张。", {
            "activity_id": {"type": "string"},
            "category": {"type": "string", "description": "all/undecided/keep/reject/uncertain/important/ai_reject/ai_uncertain/dedupe_duplicates/burst_best/unreadable"},
            "keyword": {"type": "string"},
            "source_id": {"type": "string"},
            "limit": {"type": "integer", "description": "1-20"},
        }, ["activity_id"]),
        fn("get_photo", "查看单张照片的结论、AI 建议和问题。", {
            "photo_id": {"type": "string"},
        }, ["photo_id"]),
        fn("set_photo_verdict", "修改照片的选片结论。只有用户明确要求时才调用。最多 30 张。", {
            "photo_ids": {"type": "array", "items": {"type": "string"}, "description": "照片 id 列表，最多 30 个"},
            "verdict": {"type": "string", "description": "keep/reject/uncertain/undecided"},
        }, ["photo_ids", "verdict"]),
        fn("navigate_to", "在软件内打开活动列表、某个活动、复核、导出或设置。", {
            "target": {"type": "string", "description": "activities/activity/review/export/settings"},
            "activity_id": {"type": "string"},
        }, ["target"]),
        fn("set_review_filter", "切换当前复核页的筛选分类或搜索词。", {
            "activity_id": {"type": "string"},
            "category": {"type": "string", "description": "all/undecided/keep/reject/uncertain/important/ai_reject/ai_uncertain/dedupe_duplicates/burst_best/unreadable"},
            "keyword": {"type": "string"},
        }, ["activity_id"]),
        fn("find_person_photos", "根据一张参考人物照片，在当前活动的候选照片中逐张比较是否为同一人；可选复制匹配照片到指定文件夹。", {
            "activity_id": {"type": "string"},
            "reference_image": {"type": "string", "description": "参考图路径；如果当前对话附了参考图可留空"},
            "target_dir": {"type": "string", "description": "匹配照片的复制目标文件夹；不复制可留空"},
            "copy_matches": {"type": "boolean"},
            "category": {"type": "string", "description": "候选范围，默认 all"},
            "max_candidates": {"type": "integer", "description": "最多检查多少张，默认当前分类全部（上限 200）"},
        }, ["activity_id"]),
        fn("copy_photos_to_folder", "把指定照片的原片复制到用户指定的文件夹。", {
            "photo_ids": {"type": "array", "items": {"type": "string"}},
            "target_dir": {"type": "string"},
        }, ["photo_ids", "target_dir"]),
        fn("web_fetch", "读取一个公开网页的文本内容，用于查资料。", {
            "url": {"type": "string"},
        }, ["url"]),
        fn("open_url", "在系统默认浏览器中打开一个公开网址。", {
            "url": {"type": "string"},
        }, ["url"]),
    ]


CATEGORY_NAMES = {
    "all": "全部", "undecided": "待处理", "keep": "保留", "reject": "疑似废片",
    "uncertain": "待确认", "refine": "精筛", "important": "重要", "ai_reject": "AI 建议排除",
    "ai_uncertain": "AI 待确认", "dedupe_duplicates": "连拍重复", "burst_best": "连拍精选",
    "unreadable": "读取失败",
}


def _compact_activity(item: dict) -> dict:
    counts = item.get("counts") or {}
    rv = counts.get("review") or {}
    return {
        "id": item.get("id"), "name": item.get("name"), "kind": item.get("kind"),
        "stage": item.get("stage"), "files": counts.get("files", 0),
        "keep": rv.get("keep_count", 0), "pending": rv.get("undecided_count", 0),
    }


def _compact_photo(item: dict) -> dict:
    return {
        "id": item.get("id"), "file": item.get("file_name"),
        "source": item.get("source_label"), "verdict": item.get("verdict"),
        "important": item.get("important"), "ai": item.get("ai_suggestion"),
        "burst_rank": item.get("burst_rank"), "preview": item.get("preview_state"),
    }


def _activity_or_raise(activity_id: str) -> dict:
    activity = activities.get_activity(activity_id)
    if not activity:
        raise ValueError("活动不存在")
    return activity


def _forbidden_roots() -> list[Path]:
    roots = []
    for value in (config.app_dir(), config.resource_dir()):
        try:
            roots.append(Path(value).resolve())
        except Exception:
            pass
    return roots


def _safe_output_dir(value: str) -> str:
    raw = str(value or "").strip()
    if not raw:
        raise ValueError("请提供目标文件夹路径")
    target = Path(os.path.expandvars(os.path.expanduser(raw))).resolve()
    for root in _forbidden_roots():
        if target == root or root in target.parents:
            raise ValueError("不能写入软件程序或源码目录，请换一个照片输出文件夹")
    target.mkdir(parents=True, exist_ok=True)
    return str(target)


def _photo_original_path(photo_id: str) -> str | None:
    with db.db() as conn:
        row = conn.execute(
            "SELECT p.rel_path, s.root_path FROM photos p JOIN sources s ON s.id=p.source_id WHERE p.id=?",
            (photo_id,),
        ).fetchone()
    if not row:
        return None
    path = os.path.join(row["root_path"], row["rel_path"])
    return path if os.path.isfile(path) else None


def _photo_match_image(activity_id: str, photo_id: str) -> str | None:
    """Prefer cached AI/review/thumb previews; they are much faster and are
    still sharp enough for identity comparison."""
    for path in (config.ai_path(activity_id, photo_id),
                 config.review_path(activity_id, photo_id),
                 config.thumb_path(activity_id, photo_id)):
        if os.path.isfile(path):
            return path
    return _photo_original_path(photo_id)


def _copy_photo_files(photo_ids: list[str], target_dir: str) -> list[str]:
    folder = _safe_output_dir(target_dir)
    copied = []
    for photo_id in photo_ids[:50]:
        source = _photo_original_path(photo_id)
        if not source:
            continue
        base_name = os.path.basename(source)
        stem, ext = os.path.splitext(base_name)
        dest = os.path.join(folder, base_name)
        index = 2
        while os.path.exists(dest):
            dest = os.path.join(folder, f"{stem}_{index}{ext}")
            index += 1
        shutil.copy2(source, dest)
        copied.append(dest)
    return copied


def _image_data_url(path: str, max_side: int = 512) -> str:
    with Image.open(path) as opened:
        image = opened.convert("RGB")
        if max(image.size) > max_side:
            image.thumbnail((max_side, max_side), Image.LANCZOS)
        buffer = io.BytesIO()
        image.save(buffer, "JPEG", quality=82, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def _same_person(reference_path: str, candidate_path: str) -> tuple[bool | None, float, str]:
    settings = settings_store.load_settings()
    key = keychain.load_api_key()
    if not key:
        raise AgentError("还没有配置 DeepSeek API Key")
    prompt = ("比较这两张照片是否为同一个人。只根据可见的人物身份判断，忽略服装、背景、光线差异。"
              "返回 JSON：{\"same_person\": true/false, \"confidence\": 0-1, \"reason\": \"20字以内\"}。不要输出其他内容。")
    messages = [{"role": "user", "content": [
        {"type": "text", "text": prompt},
        {"type": "image_url", "image_url": {"url": _image_data_url(reference_path)}},
        {"type": "image_url", "image_url": {"url": _image_data_url(candidate_path)}},
    ]}]
    result = deepseek.chat_completion(
        messages, api_key=key, model=settings.get("model") or "deepseek-flash",
        base_url=settings.get("base_url") or "https://api.deepseek.com",
        temperature=0.1, max_tokens=240, timeout=30.0,
    )
    content = (result.get("message", {}).get("content") or "").strip()
    match = re.search(r"\{.*\}", content, re.S)
    if match:
        try:
            data = json.loads(match.group(0))
            return bool(data.get("same_person")), float(data.get("confidence") or 0), str(data.get("reason") or "")
        except Exception:
            pass
    lowered = content.lower()
    return ("true" in lowered or "是" in content), 0.5, content[:80]


def _safe_public_url(value: str) -> str:
    url = str(value or "").strip()
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError("只支持 http/https 公开网址")
    host = parsed.hostname.lower()
    if host in ("localhost",) or host.endswith(".local"):
        raise ValueError("不允许访问本机或内网地址")
    ip = None
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        ip = None
    if ip and (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved):
        raise ValueError("不允许访问本机或内网地址")
    return url


def _web_fetch(url: str) -> dict:
    safe = _safe_public_url(url)
    with httpx.Client(timeout=18, follow_redirects=True, headers={"User-Agent": "Shiying-Agent/1.0"}) as client:
        response = client.get(safe)
    response.raise_for_status()
    text = response.text
    text = re.sub(r"<script[^>]*>.*?</script>", " ", text, flags=re.S | re.I)
    text = re.sub(r"<style[^>]*>.*?</style>", " ", text, flags=re.S | re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return {"url": safe, "status": response.status_code, "text": text[:6000]}


def _run_tool(name: str, args: dict, context: dict | None = None) -> tuple[dict, dict | None]:
    permissions = (context or {}).get("permissions") or {}
    def allowed(key: str) -> bool:
        return bool(permissions.get(key, True))
    read_tools = {"list_activities", "get_activity_summary", "search_photos", "get_photo", "find_person_photos"}
    if name in read_tools and not allowed("read"):
        raise ValueError("读取活动与照片的权限已在设置中关闭")
    if name in {"set_photo_verdict", "copy_photos_to_folder"} and not allowed("write"):
        raise ValueError("修改照片与复制照片的权限已在设置中关闭")
    if name == "web_fetch" and not allowed("web"):
        raise ValueError("读取网页的权限已在设置中关闭")
    if name == "open_url" and not allowed("browser"):
        raise ValueError("调用浏览器的权限已在设置中关闭")
    if name == "list_activities":
        return {"activities": [_compact_activity(a) for a in activities.list_activities()]}, None
    if name == "get_activity_summary":
        activity = _activity_or_raise(str(args.get("activity_id") or ""))
        counts = activity.get("counts") or {}
        return {
            "id": activity["id"], "name": activity["name"], "stage": activity["stage"],
            "counts": {k: v for k, v in counts.items() if k != "cover_photo_id"},
            "sources": [{"id": s["id"], "label": s["label"], "count": s["photo_count"]} for s in activity.get("sources", [])],
        }, None
    if name == "search_photos":
        activity_id = str(args.get("activity_id") or "")
        _activity_or_raise(activity_id)
        category = str(args.get("category") or "all")
        limit = max(1, min(20, int(args.get("limit") or 10)))
        data = review.list_photos(activity_id, category, args.get("source_id") or None,
                                  args.get("keyword") or None, 0, limit)
        return {
            "category": category, "category_name": CATEGORY_NAMES.get(category, category),
            "total": data.get("total", 0), "photos": [_compact_photo(p) for p in data.get("items", [])],
        }, None
    if name == "get_photo":
        photo = review.get_photo(str(args.get("photo_id") or ""))
        if not photo:
            raise ValueError("照片不存在")
        return {
            "photo": _compact_photo(photo), "note": photo.get("note"),
            "issues": [{"type": k, "name": v.get("name"), "result": v.get("result"), "reason": v.get("reason")}
                       for k, v in (photo.get("checks") or {}).items() if v.get("result") in ("suspect", "uncertain")],
        }, None
    if name == "set_photo_verdict":
        verdict = str(args.get("verdict") or "")
        if verdict not in ("keep", "reject", "uncertain", "undecided"):
            raise ValueError("无效结论")
        ids = [str(x) for x in (args.get("photo_ids") or []) if str(x).strip()]
        if not ids:
            raise ValueError("没有指定照片")
        if len(ids) > 30:
            raise ValueError("一次最多处理 30 张，请先缩小范围")
        if verdict == "undecided":
            applied = 0
            skipped = 0
            for photo_id in ids:
                try:
                    review.set_decision(photo_id, verdict="undecided")
                    applied += 1
                except ValueError:
                    skipped += 1
        else:
            placeholders = ",".join("?" for _ in ids)
            with db.db() as conn:
                rows = conn.execute(
                    f"SELECT id, activity_id FROM photos WHERE id IN ({placeholders})", ids
                ).fetchall()
            found = {row["id"]: row["activity_id"] for row in rows}
            activity_ids = {found[pid] for pid in ids if pid in found}
            if len(activity_ids) != 1:
                raise ValueError("这些照片不属于同一个活动，或包含不存在的照片")
            result = review.batch_decision(next(iter(activity_ids)), ids, verdict)
            applied, skipped = result.get("applied", 0), result.get("skipped", 0)
        return {"applied": applied, "skipped": skipped, "verdict": verdict}, {"type": "refresh"}
    if name == "navigate_to":
        target = str(args.get("target") or "activities")
        if target == "activity":
            activity_id = str(args.get("activity_id") or "")
            _activity_or_raise(activity_id)
            return {"navigation": f"#/activity/{activity_id}"}, {"type": "navigate", "hash": f"#/activity/{activity_id}"}
        routes = {"activities": "#/activities", "review": "#/activities", "export": "#/activities", "settings": "#/settings"}
        if target not in routes:
            raise ValueError("不支持的页面")
        return {"navigation": routes[target]}, {"type": "navigate", "hash": routes[target]}
    if name == "set_review_filter":
        activity_id = str(args.get("activity_id") or "")
        _activity_or_raise(activity_id)
        category = str(args.get("category") or "all")
        if category not in CATEGORY_NAMES:
            raise ValueError("不支持的筛选分类")
        action = {"type": "review_filter", "activity_id": activity_id, "category": category,
                  "keyword": str(args.get("keyword") or "")}
        return {"filter": CATEGORY_NAMES[category], "keyword": args.get("keyword") or ""}, action
    if name == "copy_photos_to_folder":
        ids = [str(x) for x in (args.get("photo_ids") or []) if str(x).strip()]
        if not ids:
            raise ValueError("没有指定照片")
        copied = _copy_photo_files(ids, str(args.get("target_dir") or ""))
        return {"copied": len(copied), "files": copied[:20], "target_dir": str(args.get("target_dir") or "")}, {"type": "refresh"}
    if name == "find_person_photos":
        activity_id = str(args.get("activity_id") or (context or {}).get("activity_id") or "")
        _activity_or_raise(activity_id)
        reference = str(args.get("reference_image") or (context or {}).get("reference_image") or "").strip()
        if not reference or not os.path.isfile(reference):
            raise ValueError("缺少可读取的参考图。请先附加参考图或提供图片绝对路径")
        category = str(args.get("category") or "refine")
        requested = int(args.get("max_candidates") or 200)
        limit = max(1, min(200, requested))
        data = review.list_photos(activity_id, category, None, None, 0, limit)
        if not data.get("items") and category == "refine":
            # 还没做 AI 粗筛的项目没有精筛结果，退回到全部照片。
            category = "all"
            data = review.list_photos(activity_id, category, None, None, 0, limit)
        candidates = []
        for item in data.get("items", []):
            path = _photo_match_image(activity_id, item.get("id"))
            if path:
                candidates.append((item, path))
        matches, checked = [], 0

        def check(candidate):
            item, path = candidate
            try:
                same, confidence, reason = _same_person(reference, path)
            except Exception:
                return None
            return (item, path, same, confidence, reason)

        from concurrent.futures import ThreadPoolExecutor
        # Four concurrent comparisons keeps API latency down without hammering
        # the screening endpoint.
        with ThreadPoolExecutor(max_workers=4) as pool:
            for result in pool.map(check, candidates):
                if result is None:
                    continue
                item, path, same, confidence, reason = result
                checked += 1
                if same:
                    matches.append({"id": item.get("id"), "file": item.get("file_name"),
                                    "source": item.get("source_label"),
                                    "confidence": round(confidence, 2),
                                    "reason": reason, "path": path})
        copied = []
        if args.get("copy_matches") and not allowed("write"):
            raise ValueError("复制照片的权限已在设置中关闭")
        if args.get("copy_matches") and matches:
            copied = _copy_photo_files([m["id"] for m in matches], str(args.get("target_dir") or ""))
        return {"checked": checked, "matches": matches, "copied": len(copied),
                "target_dir": str(args.get("target_dir") or "")}, {"type": "refresh"} if matches else None
    if name == "web_fetch":
        return _web_fetch(str(args.get("url") or "")), None
    if name == "open_url":
        url = _safe_public_url(str(args.get("url") or ""))
        webbrowser.open(url)
        return {"opened": url}, None
    raise ValueError(f"未知工具：{name}")


def chat(history: list[dict], context: dict | None = None) -> dict:
    key = keychain.load_api_key()
    if not key:
        raise AgentError("还没有配置 DeepSeek API Key，请先到设置页填写。")
    settings = settings_store.load_settings()
    model = settings.get("model") or "deepseek-flash"
    base_url = settings.get("base_url") or "https://api.deepseek.com"

    context = context or {}
    context_lines = []
    if context.get("view"):
        context_lines.append(f"当前页面：{context['view']}")
    if context.get("activity_id"):
        context_lines.append(f"当前活动 id：{context['activity_id']}")
    if context.get("activity_name"):
        context_lines.append(f"当前活动名称：{context['activity_name']}")
    if context.get("photo_id"):
        context_lines.append(f"当前选中照片 id：{context['photo_id']}")
    if context.get("reference_image"):
        context_lines.append(f"当前附带的参考图路径：{context['reference_image']}")
    if context.get("category"):
        context_lines.append(f"当前筛选：{CATEGORY_NAMES.get(context['category'], context['category'])}")
    context_text = "\n".join(context_lines) or "当前没有打开活动。"

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for item in history[-24:]:
        role = item.get("role")
        content = str(item.get("content") or "").strip()
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})
    if not any(m.get("role") == "user" for m in messages):
        raise AgentError("没有用户消息")
    messages[-1] = dict(messages[-1])
    messages[-1]["content"] = f"【当前界面】\n{context_text}\n\n【用户】\n{messages[-1]['content']}"

    tools = _tool_defs()
    actions: list[dict] = []
    executed: list[dict] = []
    usage_total = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
    reply = ""
    try:
        for _ in range(5):
            result = deepseek.chat_completion(
                messages, api_key=key, model=model, base_url=base_url,
                tools=tools, temperature=0.2, max_tokens=1400,
            )
            usage = result.get("usage") or {}
            for k in usage_total:
                usage_total[k] += int(usage.get(k) or 0)
            message = result["message"]
            content = (message.get("content") or "").strip()
            tool_calls = message.get("tool_calls") or []
            if content:
                reply = content
            if not tool_calls:
                break
            messages.append({
                "role": "assistant",
                "content": message.get("content") or "",
                "tool_calls": tool_calls,
            })
            for call in tool_calls:
                fn = (call.get("function") or {})
                name = fn.get("name") or ""
                call_id = call.get("id") or f"call_{len(executed)}"
                try:
                    args = json.loads(fn.get("arguments") or "{}")
                    if not isinstance(args, dict):
                        args = {}
                except json.JSONDecodeError:
                    args = {}
                try:
                    tool_result, action = _run_tool(name, args, context)
                    ok = True
                except Exception as exc:
                    tool_result, action, ok = {"error": str(exc)}, None, False
                if action and action not in actions:
                    actions.append(action)
                executed.append({"name": name, "arguments": args,
                                 "ok": ok, "result": tool_result})
                messages.append({
                    "role": "tool", "tool_call_id": call_id, "name": name,
                    "content": json.dumps(tool_result, ensure_ascii=False),
                })
        if not reply:
            reply = "我已经完成查询。" if executed else "我暂时没有生成回复，请换个说法再试。"
    except deepseek.DeepSeekError as exc:
        raise AgentError(str(exc)) from exc

    return {
        "reply": reply,
        "actions": actions,
        "tools": executed,
        "usage": usage_total,
        "model": model,
    }
