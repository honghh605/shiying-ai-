"""AI 初筛：预算估算、任务编排、并发请求、断点与结果落库。"""
from __future__ import annotations

import hashlib
import json
import os
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED

import httpx

from .screening_pool import ScreeningKeyPool

from . import checks, config, db, dedupe, deepseek, keychain, previews, settings_store

WORKERS = 3
MAX_ATTEMPTS = 3


# ---------- 查询与估算 ----------

def _activity(activity_id: str):
    with db.db() as conn:
        return conn.execute("SELECT * FROM activities WHERE id=?", (activity_id,)).fetchone()


def _rule(activity) -> tuple[list[str], dict[str, str]]:
    rule = json.loads(activity["rule_json"] or "{}")
    return checks.enabled_checks(rule), checks.check_modes(rule)


def _pending_rows(activity_id: str, import_job_id: str | None = None) -> list:
    activity = _activity(activity_id)
    if not activity:
        return []
    enabled, _modes = _rule(activity)
    if not enabled:
        return []
    placeholders = ",".join("?" for _ in enabled)
    with db.db() as conn:
        rows = conn.execute(
            "SELECT p.*, s.root_path FROM photos p JOIN sources s ON s.id = p.source_id "
            "WHERE p.activity_id=? AND p.preview_state IN ('ok','degraded') "
            + ("AND p.import_job_id=? " if import_job_id else "")
            + "AND COALESCE(p.ai_stage,'') != 'burst_duplicate' "
            + "AND (SELECT COUNT(*) FROM checks c WHERE c.photo_id=p.id AND c.check_type IN (" + placeholders + ") "
            "AND c.status='done') < ? "
            "ORDER BY p.file_name COLLATE NOCASE",
            (activity_id, *((import_job_id,) if import_job_id else ()), *enabled, len(enabled)),
        ).fetchall()
    return list(rows)


def used_cost(activity_id: str) -> float:
    """只统计真正产生 token 的请求；连接失败/未扣费的 lost 不计入已用预算。"""
    with db.db() as conn:
        row = conn.execute(
            "SELECT COALESCE(SUM(cost_cny), 0) AS total FROM ai_requests "
            "WHERE activity_id=? AND status IN ('ok','error')",
            (activity_id,),
        ).fetchone()
    return float(row["total"] or 0)


def estimate(activity_id: str) -> dict:
    activity = _activity(activity_id)
    if not activity:
        raise ValueError("活动不存在")
    enabled, _modes = _rule(activity)
    settings = settings_store.load_settings()
    per_photo = checks.per_photo_cost(settings)
    rows = _pending_rows(activity_id)
    pending = len(rows)
    with db.db() as conn:
        importing = bool(conn.execute(
            "SELECT 1 FROM jobs WHERE activity_id=? AND kind='import' "
            "AND status IN ('queued','running') LIMIT 1",
            (activity_id,),
        ).fetchone())
    used = used_cost(activity_id)
    budget = activity["budget_limit_cny"]
    from .two_stage import estimated_cost
    total_est = estimated_cost(rows, enabled, _modes, activity['kind'], settings)
    trial_est = estimated_cost(rows[:20], enabled, _modes, activity['kind'], settings)
    return {
        "pending_photos": pending,
        "importing": importing,
        "burst_per_group": 1,
        "enabled_checks": enabled,
        "check_names": {key: checks.CHECK_TYPES[key]["name"] for key in enabled},
        "per_photo_cost": round(per_photo, 5),
        "estimate_20": round(trial_est, 4),
        "estimated_cost": round(total_est, 4),
        "used_cost": round(used, 4),
        "budget_limit_cny": budget,
        "remaining_budget": None if budget is None else round(budget - used, 4),
        "can_afford": budget is None or used + total_est <= budget,
        "can_afford_trial": budget is None or used + trial_est <= budget,
        "api_key_set": bool(keychain.screening_credentials()),
        "model": settings["model"],
    }


# ---------- 任务 ----------

def recover_interrupted() -> None:
    """The previous process cannot finish its requests after an app restart."""
    with db.db() as conn:
        conn.execute("UPDATE jobs SET status='paused', error=?, updated_at=? WHERE kind='analyze' "
                     "AND (status IN ('queued','running','pausing') "
                     "OR (status='failed' AND error LIKE '%cannot schedule new futures%'))",
                     ("上次运行已中断，可继续处理剩余照片", db.now()))

def resume_auto_continuations() -> None:
    """Restart an import batch that the user had already opted into before shutdown."""
    import threading
    with db.db() as conn:
        links = conn.execute(
            "SELECT l.*, j.status AS import_status FROM import_analysis_links l "
            "JOIN jobs j ON j.id=l.import_job_id "
            "WHERE l.cancelled=0 AND j.kind='import' AND j.status='done' "
            "ORDER BY l.created_at"
        ).fetchall()
    for link in links:
        try:
            rows = _pending_rows(link["activity_id"], link["import_job_id"])
            if not rows:
                continue
            with db.db() as conn:
                active = conn.execute(
                    "SELECT 1 FROM jobs WHERE activity_id=? AND kind='analyze' "
                    "AND status IN ('queued','running','pausing') LIMIT 1",
                    (link["activity_id"],),
                ).fetchone()
                latest = conn.execute(
                    "SELECT status FROM jobs WHERE activity_id=? AND kind='analyze' "
                    "ORDER BY created_at DESC, rowid DESC LIMIT 1",
                    (link["activity_id"],),
                ).fetchone()
            if active:
                continue
            # paused/failed after shutdown, or the previous pass was done but
            # the import batch still has unprocessed photos.
            if latest and latest["status"] == "running":
                continue
            start_analysis(link["activity_id"], 0, False, import_job_id=link["import_job_id"])
            db.log_event(link["activity_id"], "analysis_auto_resume", link["import_job_id"], None)
        except Exception as exc:
            db.log_event(link["activity_id"], "analysis_auto_resume_failed",
                         link["import_job_id"], str(exc)[:300])


def _set_job(job_id: str, **fields) -> None:
    if not fields:
        return
    fields["updated_at"] = db.now()
    columns = ", ".join(f"{key}=?" for key in fields)
    with db.db() as conn:
        conn.execute(f"UPDATE jobs SET {columns} WHERE id=?", (*fields.values(), job_id))


def _job_row(job_id: str):
    with db.db() as conn:
        return conn.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()


def start_analysis(activity_id: str, limit: int = 0, auto_dedupe: bool = False,
                   import_job_id: str | None = None) -> dict:
    activity = _activity(activity_id)
    if not activity:
        raise ValueError("活动不存在")
    if not bool(keychain.screening_credentials()):
        raise ValueError("还没有设置 API Key，请先到“设置”填写")
    enabled, modes = _rule(activity)
    if not enabled:
        raise ValueError("五类问题全部设为“不检查”，请先在规则里启用至少一项")
    with db.db() as conn:
        if conn.execute("SELECT 1 FROM jobs WHERE activity_id=? AND kind='analyze' "
                        "AND status IN ('queued','running','pausing')", (activity_id,)).fetchone():
            raise ValueError("本场已有筛图任务运行中，请等待或暂停后继续")
    rows = _pending_rows(activity_id, import_job_id)
    if not rows:
        raise ValueError("没有待分析的照片；所有启用项都已完成，或照片读取失败")
    if limit and limit > 0:
        rows = rows[:limit]

    settings = settings_store.load_settings()
    per_photo = checks.per_photo_cost(settings) * (2 if any(key in checks.QUICK_TYPES for key in enabled) else 1)
    used = used_cost(activity_id)
    budget = activity["budget_limit_cny"]
    from .two_stage import estimated_cost
    estimate_cost = estimated_cost(rows, enabled, modes, activity['kind'], settings)
    if budget is not None and used + estimate_cost > budget:
        raise ValueError(
            f"预计需要 {(used + estimate_cost):.2f} 元，超过本场预算 {budget:.2f} 元"
            f"（已用 {used:.2f} 元）。请缩小范围、调整预算或减少检查项。"
        )

    job_id = uuid.uuid4().hex
    options = {"enabled": enabled, "modes": modes, "kind": activity["kind"], "count": len(rows), "strategy": "two_stage",
               "auto_dedupe": auto_dedupe, "burst_per_group": 1}
    if import_job_id:
        options["import_job_id"] = import_job_id
    with db.db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        if conn.execute("SELECT 1 FROM jobs WHERE activity_id=? AND kind='analyze' "
                        "AND status IN ('queued','running','pausing')", (activity_id,)).fetchone():
            raise ValueError("本场已有筛图任务运行中")
        conn.execute(
            "INSERT INTO jobs(id, activity_id, kind, status, total, options_json, created_at, updated_at) "
            "VALUES (?,?,'analyze','queued',?,?,?,?)",
            (job_id, activity_id, len(rows), json.dumps(options, ensure_ascii=False), db.now(), db.now()),
        )
    from .two_stage import run
    thread = threading.Thread(
        target=run,
        args=(job_id, activity_id, [row["id"] for row in rows], enabled, modes, activity["kind"], limit == 0 and auto_dedupe),
        daemon=True,
    )
    thread.start()
    return {"job_id": job_id, "count": len(rows), "estimated_cost": round(estimate_cost, 4)}


def _auto_after_import(import_job_id: str, activity_id: str) -> None:
    import time
    while True:
        with db.db() as conn:
            link = conn.execute(
                "SELECT * FROM import_analysis_links WHERE import_job_id=?",
                (import_job_id,),
            ).fetchone()
            if not link or link["cancelled"] or link["consumed"]:
                return
            initial = conn.execute("SELECT status FROM jobs WHERE id=?", (link["analysis_job_id"],)).fetchone()
            imp = conn.execute("SELECT status FROM jobs WHERE id=?", (import_job_id,)).fetchone()
        if not imp or imp["status"] in ("failed", "cancelled"):
            return
        if initial and initial["status"] in ("pausing", "paused", "cancelling", "cancelled"):
            return
        if imp["status"] == "done" and initial and initial["status"] in ("done", "failed"):
            break
        time.sleep(1.0)
    with db.db() as conn:
        conn.execute(
            "UPDATE import_analysis_links SET consumed=1 WHERE import_job_id=? AND consumed=0",
            (import_job_id,),
        )
    try:
        start_analysis(activity_id, 0, False, import_job_id=import_job_id)
        db.log_event(activity_id, "import_auto_analysis", import_job_id, None)
    except ValueError as exc:
        # 没有剩余照片（或另一任务刚好启动）不算错误。
        db.log_event(activity_id, "import_auto_analysis_skip", import_job_id, str(exc)[:200])


def schedule_auto_analysis(import_job_id: str, activity_id: str) -> None:
    with db.db() as conn:
        link = conn.execute(
            "SELECT 1 FROM import_analysis_links WHERE import_job_id=? AND cancelled=0 AND consumed=0",
            (import_job_id,),
        ).fetchone()
    if link:
        thread = threading.Thread(target=_auto_after_import, args=(import_job_id, activity_id), daemon=True)
        thread.start()


def pause_analysis(activity_id: str) -> dict:
    with db.db() as conn:
        row = conn.execute(
            "SELECT id, status FROM jobs WHERE activity_id=? AND kind='analyze' "
            "ORDER BY created_at DESC, rowid DESC LIMIT 1",
            (activity_id,),
        ).fetchone()
        if not row or row["status"] not in ("queued", "running"):
            raise ValueError("当前没有可暂停的分析任务")
        status = "pausing" if row["status"] == "running" else "paused"
        conn.execute("UPDATE jobs SET status=?, updated_at=? WHERE id=?", (status, db.now(), row["id"]))
        conn.execute(
            "UPDATE import_analysis_links SET cancelled=1 WHERE analysis_job_id=? AND consumed=0",
            (row["id"],),
        )
    return {"ok": True, "status": status}


def analysis_status(activity_id: str, photo_ids: list[str] | None = None) -> dict:
    from .activities import _review_counts
    updates = []
    with db.db() as conn:
        job = conn.execute(
            "SELECT * FROM jobs WHERE activity_id=? AND kind='analyze' "
            "ORDER BY created_at DESC, rowid DESC LIMIT 1", (activity_id,)
        ).fetchone()
        ids = (photo_ids or [])[:300]
        if ids:
            updates = [dict(row) for row in conn.execute(
                "SELECT p.id, p.ai_stage, p.ai_suggestion, COALESCE(d.verdict,'undecided') AS verdict "
                "FROM photos p LEFT JOIN decisions d ON d.photo_id=p.id WHERE p.activity_id=? "
                f"AND p.id IN ({','.join('?' for _ in ids)})", (activity_id, *ids))]
        counts = _review_counts(conn, activity_id)
        auto_link = conn.execute(
            "SELECT import_job_id FROM import_analysis_links "
            "WHERE activity_id=? AND consumed=0 AND cancelled=0 "
            "ORDER BY created_at DESC LIMIT 1",
            (activity_id,),
        ).fetchone()
    used = used_cost(activity_id)
    raw_job = json.loads(job["result_json"]) if job and job["result_json"] else None
    activity = _activity(activity_id)
    enabled = _rule(activity)[0] if activity else []
    return {
        "updates": updates,
        "counts": counts,
        "used_cost": round(used, 4),
        "auto_import_pending": bool(auto_link),
        "enabled_checks": enabled,
        "job": None if not job else {
            "id": job["id"],
            "status": job["status"],
            "total": job["total"],
            "done_count": job["done_count"],
            "failed_count": job["failed_count"],
            "error": job["error"],
            "result": raw_job,
        },
    }


# ---------- 执行 ----------

def _run_analysis(job_id: str, activity_id: str, photo_ids: list[str],
                  enabled: list[str], modes: dict[str, str], activity_kind: str,
                  auto_dedupe: bool = False) -> None:
    try:
        current = _job_row(job_id)
        if current and current["status"] in ("pausing", "paused", "cancelling", "cancelled"):
            return
        _set_job(job_id, status="running")
        key_pool = ScreeningKeyPool(keychain.screening_credentials())
        if not key_pool.keys:
            _set_job(job_id, status="failed", error="API Key 不可用，请重新设置")
            return
        settings = settings_store.load_settings()
        activity = _activity(activity_id)
        budget = activity["budget_limit_cny"] if activity else None
        done = failed = 0

        workers = min(12, max(1, int(settings.get("screening_concurrency", WORKERS))), len(key_pool.keys) * 3)
        next_index = 0
        per_photo = checks.per_photo_cost(settings)
        budget_paused = False
        # A bounded rolling queue keeps fast workers busy without waiting for a slow batch.
        # Reserve estimated cost for in-flight work before admitting each new photo.
        with httpx.Client(timeout=120, limits=httpx.Limits(max_connections=workers,
                               max_keepalive_connections=workers)) as client, \
                ThreadPoolExecutor(max_workers=workers) as pool:
            pending = {}
            while next_index < len(photo_ids) or pending:
                current = _job_row(job_id)
                stopping = current and current["status"] in ("pausing", "paused", "cancelling", "cancelled")
                while not stopping and next_index < len(photo_ids) and len(pending) < workers:
                    if budget is not None and used_cost(activity_id) + per_photo * (len(pending) + 1) > budget:
                        budget_paused = not pending
                        break
                    photo_id = photo_ids[next_index]
                    future = pool.submit(_analyze_photo, photo_id, activity_id, job_id,
                                         enabled, modes, "", settings, activity_kind,
                                         key_pool=key_pool, client=client)
                    pending[future] = photo_id
                    next_index += 1
                if not pending:
                    break
                finished, _ = wait(pending, timeout=0.25, return_when=FIRST_COMPLETED)
                for future in finished:
                    photo_id = pending.pop(future)
                    try:
                        result = future.result()
                    except Exception as exc:
                        result = {"ok": False, "error": key_pool.redact(str(exc))[:300]}
                    if result["ok"]:
                        _save_success(photo_id, result["parsed"], modes, settings)
                        done += 1
                    else:
                        _save_failure(photo_id, enabled, result["error"])
                        failed += 1
                    _set_job(job_id, done_count=done, failed_count=failed)
        if budget_paused:
            _set_job(job_id, status="paused", done_count=done, failed_count=failed,
                     result_json=json.dumps({"stage": "paused", "reason": "budget",
                                             "done": done, "failed": failed}))
            db.log_event(activity_id, "analysis_paused_budget", job_id, None)
            return

        current = _job_row(job_id)
        status = "done"
        if current and current["status"] in ("pausing", "paused"):
            status = "paused"
        elif current and current["status"] in ("cancelling", "cancelled"):
            status = "cancelled"
        summary = {"stage": "finished", "done": done, "failed": failed,
                   "used_cost": round(used_cost(activity_id), 4)}
        if status == "done" and auto_dedupe:
            # 全量 AI 分析完成后，用 AI 结果重新挑选每组最佳 2 张
            dedupe_result = dedupe.auto_apply(activity_id, "analysis")
            summary["dedupe"] = dedupe_result
        _set_job(job_id, status=status, done_count=done, failed_count=failed,
                 result_json=json.dumps(summary, ensure_ascii=False))
        db.log_event(activity_id, "analysis_finished", job_id,
                     json.dumps(summary, ensure_ascii=False))
    except Exception as exc:  # 任务级异常必须落库，界面才能显示原因
        _set_job(job_id, status="failed", error=str(exc)[:500])


def _analyze_photo(photo_id: str, activity_id: str, job_id: str | None,
                   enabled: list[str], modes: dict[str, str], api_key: str,
                   settings: dict, activity_kind: str, *,
                   key_pool: ScreeningKeyPool | None = None, client: httpx.Client | None = None,
                   quick: bool = False, quick_verify: bool = False) -> dict:
    with db.db() as conn:
        row = conn.execute(
            "SELECT p.*, s.root_path FROM photos p JOIN sources s ON s.id=p.source_id WHERE p.id=?",
            (photo_id,),
        ).fetchone()
    if not row:
        return {"ok": False, "error": "照片不存在"}
    source = os.path.join(row["root_path"], row["rel_path"])
    image_path = config.ai_path(activity_id, photo_id)
    if quick:
        image_path += ".quick-v2.jpg"
    if not os.path.exists(image_path):
        built, note = previews.build_quick(source, row["form"], image_path, config.ai_path(activity_id, photo_id)) \
            if quick else previews.build_ai(source, row["form"], image_path)
        if not built:
            return {"ok": False, "error": f"预览生成失败：{note}"}

    key_pool = key_pool or ScreeningKeyPool([api_key] if api_key else keychain.screening_credentials())
    model = (settings.get("quick_model") or settings["model"]) if quick and not quick_verify else settings["model"]
    cache_key = None
    if quick and not quick_verify:
        try:
            with open(image_path, "rb") as fh:
                image_digest = hashlib.sha256(fh.read()).hexdigest()
            material = json.dumps([checks.QUICK_PROMPT_VERSION, enabled, modes, model, image_digest],
                                  sort_keys=True, ensure_ascii=False)
            cache_key = hashlib.sha256(material.encode()).hexdigest()
            with db.db() as conn:
                cached = conn.execute(
                    "SELECT parsed_json FROM ai_quick_cache WHERE key=?", (cache_key,)
                ).fetchone()
            if cached:
                return {"ok": True, "parsed": json.loads(cached["parsed_json"]), "usage": {},
                        "cost": 0.0, "cached": True}
        except Exception:
            cache_key = None
    last_error = "未知错误"
    for attempt in range(1, MAX_ATTEMPTS + 1):
        slot = None
        status_code = None
        try:
            slot, request_key = key_pool.acquire()
            parsed, usage = deepseek.analyze_image(
                image_path, enabled, modes,
                api_key=request_key, model=model, base_url=settings["base_url"],
                activity_kind=activity_kind, max_output_tokens=settings["max_output_tokens"], client=client,
                quick=quick, quick_verify=quick_verify,
            )
            cost = checks.actual_cost(usage, settings)
            _record_request(activity_id, job_id, photo_id, model, "ok",
                            usage, cost, 1, None, quick=quick)
            if cache_key:
                try:
                    with db.db() as conn:
                        conn.execute(
                            "INSERT OR REPLACE INTO ai_quick_cache(key, parsed_json, model, prompt_version, created_at) "
                            "VALUES (?,?,?,?,?)",
                            (cache_key, json.dumps(parsed, ensure_ascii=False), model,
                             checks.QUICK_PROMPT_VERSION, db.now()),
                        )
                except Exception:
                    pass
            return {"ok": True, "parsed": parsed, "usage": usage, "cost": cost}
        except deepseek.DeepSeekError as exc:
            status_code = exc.status_code
            safe_error = key_pool.redact(str(exc))
            usage = getattr(exc, "usage", None) or {}
            has_usage = bool(usage.get("prompt_tokens") or usage.get("completion_tokens"))
            if has_usage:
                status, cost = "error", checks.actual_cost(usage, settings)
            elif exc.retryable:
                # 连接失败/SSL 中断：请求没有成功，不能计费
                status, cost = "lost", 0.0
            else:
                status, cost = "error", 0.0
            _record_request(activity_id, job_id, photo_id, model, status,
                            usage, cost, 1 if has_usage else 0, safe_error, quick=quick)
            last_error = safe_error
            if not exc.retryable and exc.status_code not in (401, 403):
                break
        except ValueError as exc:
            last_error = str(exc)
            break
        finally:
            if slot is not None:
                key_pool.release(slot, status_code)
        if attempt < MAX_ATTEMPTS and status_code not in (401, 403, 429):
            time.sleep(min(8.0, 1.5 * (2 ** (attempt - 1))))
    return {"ok": False, "error": last_error}


def _record_request(activity_id: str, job_id: str | None, photo_id: str, model: str,
                    status: str, usage: dict, cost: float, usage_reported: int,
                    error: str | None, *, quick: bool = False) -> None:
    with db.db() as conn:
        conn.execute(
            "INSERT INTO ai_requests(id, activity_id, job_id, photo_id, check_type, model, prompt_version, "
            "status, input_tokens, output_tokens, cost_cny, usage_reported, sent_at, finished_at, error) "
            "VALUES (?,?,?,?,'all',?,?,?,?,?,?,?,?,?,?)",
            (uuid.uuid4().hex, activity_id, job_id, photo_id, model, checks.QUICK_PROMPT_VERSION if quick else checks.PROMPT_VERSION,
             status, int(usage.get("prompt_tokens") or 0), int(usage.get("completion_tokens") or 0),
             round(cost, 6), usage_reported, db.now(), db.now(), error),
        )


def _save_success(photo_id: str, parsed: dict, modes: dict[str, str], settings: dict) -> None:
    suggestion, issues = checks.suggestion(parsed, modes)
    with db.db() as conn:
        for key, item in parsed.items():
            conn.execute(
                "INSERT INTO checks(photo_id, check_type, status, result, reason, region_hint, method, "
                "prompt_version, model, finished_at, updated_at, attempts, evidence_json) "
                "VALUES (?,?,'done',?,?,?,'deepseek',?,?,?, ?, 1, ?) "
                "ON CONFLICT(photo_id, check_type) DO UPDATE SET status='done', result=excluded.result, "
                "reason=excluded.reason, region_hint=excluded.region_hint, method='deepseek', "
                "prompt_version=excluded.prompt_version, model=excluded.model, "
                "finished_at=excluded.finished_at, updated_at=excluded.updated_at, error=NULL, "
                "attempts=attempts+1, evidence_json=excluded.evidence_json",
                (photo_id, key, item["result"], item["reason"], item["region"],
                 checks.PROMPT_VERSION, settings["model"], db.now(), db.now(),
                 json.dumps({field: item.get(field) for field in ("severity", "confidence", "subject", "applicability")})),
            )
        conn.execute("UPDATE photos SET ai_suggestion=?, ai_issue_count=?, ai_stage='refined' WHERE id=?",
                     (suggestion, len(issues), photo_id))
        # AI 建议作为初筛预分类：只填充尚未人工处理的照片，人工结论永远优先。
        if suggestion in ("keep", "reject", "uncertain"):
            conn.execute(
                "UPDATE decisions SET verdict=?, updated_at=?, origin='ai' WHERE photo_id=? AND important=0 "
                "AND (origin='ai' OR (verdict='undecided' AND NOT EXISTS "
                "(SELECT 1 FROM decision_events e WHERE e.photo_id=decisions.photo_id)))",
                (suggestion, db.now(), photo_id),
            )


def _save_failure(photo_id: str, enabled: list[str], error: str) -> None:
    with db.db() as conn:
        finished = {row["check_type"] for row in conn.execute(
            "SELECT check_type FROM checks WHERE photo_id=? AND status='done'", (photo_id,)
        )}
        for key in enabled:
            if key in finished:
                continue
            conn.execute(
                "INSERT INTO checks(photo_id, check_type, status, method, finished_at, updated_at, error, attempts) "
                "VALUES (?,?,'failed','deepseek',?,?,?,1) "
                "ON CONFLICT(photo_id, check_type) DO UPDATE SET status='failed', "
                "finished_at=excluded.finished_at, updated_at=excluded.updated_at, "
                "error=excluded.error, attempts=attempts+1",
                (photo_id, key, db.now(), db.now(), error[:300]),
            )


def analyze_single(photo_id: str) -> dict:
    """单张同步分析（界面上的“AI 检查本张”）。"""
    with db.db() as conn:
        photo = conn.execute(
            "SELECT p.*, s.root_path, s.activity_id AS aid FROM photos p JOIN sources s ON s.id=p.source_id "
            "WHERE p.id=?", (photo_id,)
        ).fetchone()
    if not photo:
        raise ValueError("照片不存在")
    activity_id = photo["aid"]
    activity = _activity(activity_id)
    if not activity:
        raise ValueError("活动不存在")
    if not bool(keychain.screening_credentials()):
        raise ValueError("还没有设置 API Key，请先到“设置”填写")
    enabled, modes = _rule(activity)
    if not enabled:
        raise ValueError("五类问题全部设为“不检查”")
    settings = settings_store.load_settings()
    used = used_cost(activity_id)
    budget = activity["budget_limit_cny"]
    per_photo = checks.per_photo_cost(settings)
    if budget is not None and used + per_photo > budget:
        raise ValueError(f"预计会超过本场预算（已用 {used:.2f} / {budget:.2f} 元）")

    result = _analyze_photo(photo_id, activity_id, None, enabled, modes,
                            "", settings, activity["kind"])
    if not result["ok"]:
        _save_failure(photo_id, enabled, result["error"])
        raise ValueError(f"分析失败：{result['error']}")
    _save_success(photo_id, result["parsed"], modes, settings)
    return {"ok": True, "cost": round(result["cost"], 5)}
