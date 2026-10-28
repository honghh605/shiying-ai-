"""Progressive screening: local burst grouping, then first/ second pass."""
from __future__ import annotations

import hashlib
import json
import time
import uuid
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait

import httpx

from . import analysis, checks, db, dedupe, keychain, settings_store
from .screening_pool import ScreeningKeyPool


def signature(enabled, modes, kind, settings):
    value = [checks.QUICK_PROMPT_VERSION, enabled, modes, kind,
             settings["model"], settings.get("quick_model", ""), settings["base_url"]]
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def estimated_cost(rows, enabled, modes, kind, settings):
    # 现在只有一次 API 精筛，不再跑快速初筛。
    return checks.per_photo_cost(settings) * len(rows)


def save_quick(photo_id, parsed, stamp):
    verdict = parsed["verdict"]
    suggestion = {"keep": "keep", "reject": "reject", "refine": "uncertain"}[verdict]
    stage = {"keep": "quick_keep", "reject": "quick_reject", "refine": "quick_refine"}[verdict]
    with db.db() as conn:
        conn.execute("UPDATE photos SET ai_quick_json=?, ai_quick_signature=?, ai_stage=?, "
                     "ai_suggestion=?, ai_issue_count=? WHERE id=?",
                     (json.dumps(parsed), stamp, stage, suggestion, int(verdict == "reject"), photo_id))
        conn.execute(
            "UPDATE decisions SET verdict=?, origin='ai', updated_at=? WHERE photo_id=? AND important=0 "
            "AND (origin='ai' OR (verdict='undecided' AND NOT EXISTS "
            "(SELECT 1 FROM decision_events e WHERE e.photo_id=decisions.photo_id)))",
            (suggestion, db.now(), photo_id))


def _decisions(photo_ids: list[str]) -> dict[str, str]:
    result: dict[str, str] = {}
    with db.db() as conn:
        for start in range(0, len(photo_ids), 400):
            chunk = photo_ids[start:start + 400]
            rows = conn.execute(
                f"SELECT photo_id, COALESCE(verdict, 'undecided') AS verdict FROM decisions "
                f"WHERE photo_id IN ({','.join('?' for _ in chunk)})",
                chunk,
            ).fetchall()
            result.update({row["photo_id"]: row["verdict"] for row in rows})
    return result


def _quick_snapshot(activity_id: str, photo_ids: list[str], stamp: str):
    verdicts: dict[str, str] = {}
    decisions: dict[str, str] = {}
    with db.db() as conn:
        for start in range(0, len(photo_ids), 400):
            chunk = photo_ids[start:start + 400]
            rows = conn.execute(
                "SELECT p.id, p.ai_quick_json, p.ai_quick_signature, "
                "COALESCE(d.verdict, 'undecided') AS verdict "
                "FROM photos p LEFT JOIN decisions d ON d.photo_id=p.id "
                f"WHERE p.id IN ({','.join('?' for _ in chunk)})",
                chunk,
            ).fetchall()
            for row in rows:
                decisions[row["id"]] = row["verdict"]
                if row["ai_quick_signature"] == stamp and row["ai_quick_json"]:
                    try:
                        parsed = json.loads(row["ai_quick_json"])
                    except (ValueError, TypeError):
                        continue
                    if parsed.get("verdict") in ("keep", "reject", "refine"):
                        verdicts[row["id"]] = parsed["verdict"]
    return verdicts, decisions


def _burst_plan(activity_id: str, photo_ids: list[str], progress=None, per_group: int = 1):
    """Local-only burst plan before first pass.

    Burst photos never go to first-pass API.  Up to three highest-ranked frames
    per group become second-pass candidates; the rest are marked duplicate.
    """
    wanted = set(photo_ids)
    decisions = _decisions(photo_ids)
    grouped: set[str] = set()
    representatives: set[str] = set()
    skipped: set[str] = set()
    detected = list(dedupe._detect(activity_id, progress=progress))
    # 把分组写回数据库，复核卡片才能显示“连拍精选/连拍重复”。
    with db.db() as conn:
        conn.execute("UPDATE photos SET burst_group=NULL, burst_rank=NULL, burst_score=NULL WHERE activity_id=?",
                     (activity_id,))
        for group in detected:
            group_key = "burst-" + uuid.uuid4().hex[:12]
            for item in group:
                conn.execute(
                    "UPDATE photos SET burst_group=?, burst_rank=?, burst_score=? WHERE id IN (%s)"
                    % ",".join("?" for _ in item["photos"]),
                    (group_key, item["rank"], item.get("score", 0), *item["photos"]),
                )
    for group in detected:
        members = [pid for item in group for pid in item["photos"]]
        present = [pid for pid in members if pid in wanted]
        if not present:
            continue
        grouped.update(members)
        picked = 0
        for item in sorted(group, key=lambda value: value["rank"]):
            item_ids = [pid for pid in item["photos"] if pid in wanted]
            if not item_ids:
                continue
            if all(decisions.get(pid) == "reject" for pid in item_ids):
                continue
            representatives.update(item_ids)
            picked += 1
            if picked >= max(1, per_group):
                break
        skipped.update(pid for pid in present if pid not in representatives)
    singles = [pid for pid in photo_ids if pid not in grouped]
    return grouped, representatives, skipped, singles


def _mark_burst_duplicates(activity_id: str, skipped: list[str]) -> None:
    if not skipped:
        return
    with db.db() as conn:
        for start in range(0, len(skipped), 400):
            chunk = skipped[start:start + 400]
            placeholders = ",".join("?" for _ in chunk)
            conn.execute(
                f"UPDATE photos SET ai_stage='burst_duplicate' WHERE id IN ({placeholders})",
                chunk,
            )
            conn.execute(
                f"INSERT INTO decisions(photo_id, activity_id, verdict, origin, important, updated_at) "
                f"SELECT id, activity_id, 'uncertain', 'ai', 0, ? FROM photos "
                f"WHERE id IN ({placeholders}) "
                f"ON CONFLICT(photo_id) DO UPDATE SET verdict='uncertain', origin='ai', "
                f"updated_at=excluded.updated_at "
                f"WHERE decisions.important=0 AND decisions.origin != 'manual'",
                (db.now(), *chunk),
            )


def _settle_burst_groups(activity_id: str, selected: set[str]) -> None:
    """After second pass, keep only the best selected frame per burst group."""
    if not selected:
        return
    for group in dedupe._detect(activity_id):
        picked = [pid for item in group for pid in item["photos"] if pid in selected]
        if not picked:
            continue
        best = next((item for item in sorted(group, key=lambda value: value["rank"])
                     if any(pid in selected for pid in item["photos"])), None)
        if not best:
            continue
        best_ids = {pid for pid in best["photos"] if pid in selected}
        others = [pid for pid in picked if pid not in best_ids]
        if not others:
            continue
        with db.db() as conn:
            conn.execute(
                "UPDATE photos SET burst_rank=1 WHERE id IN (%s)" % ",".join("?" for _ in best_ids),
                tuple(best_ids),
            )
            conn.execute(
                "UPDATE photos SET burst_rank=2 WHERE id IN (%s)" % ",".join("?" for _ in others),
                tuple(others),
            )
            for start in range(0, len(others), 400):
                chunk = others[start:start + 400]
                placeholders = ",".join("?" for _ in chunk)
                conn.execute(
                    f"UPDATE photos SET ai_stage='burst_duplicate' WHERE id IN ({placeholders})",
                    chunk,
                )
                conn.execute(
                    f"UPDATE decisions SET verdict='uncertain', origin='ai', updated_at=? "
                    f"WHERE photo_id IN ({placeholders}) AND important=0 AND origin='ai'",
                    (db.now(), *chunk),
                )


def run(job_id, activity_id, photo_ids, enabled, modes, activity_kind, auto_dedupe=False):
    """One API pass after local burst selection.

    Flow: local CLIP/face grouping -> one frame per burst + non-burst photos ->
    detailed API check -> settle -> done.
    """
    pool_keys = None
    try:
        def stopped():
            row = analysis._job_row(job_id)
            return not row or row["status"] in ("pausing", "paused", "cancelling", "cancelled")

        if stopped():
            return
        analysis._set_job(job_id, status="running")
        settings = settings_store.load_settings()
        pool_keys = ScreeningKeyPool(keychain.screening_credentials())
        if not pool_keys.keys:
            raise ValueError("API Key 不可用，请重新设置")
        activity = analysis._activity(activity_id)
        budget = activity["budget_limit_cny"]
        keys = max(1, len(pool_keys.keys))
        workers = min(12, max(1, int(settings.get("screening_concurrency", 3))), keys * 3)
        workers = min(12, max(workers, keys * 2), keys * 3)
        reserve = checks.per_photo_cost(settings)

        progress = {"stage": "grouping", "grouping_done": 0, "grouping_total": 0,
                    "refine_done": 0, "refine_total": 0, "rejected": 0,
                    "kept": 0, "uncertain": 0, "burst_skipped": 0,
                    "burst_groups": 0, "done": 0, "failed": 0}
        last_push = [0.0]

        def publish(force=False):
            now = time.monotonic()
            if not force and now - last_push[0] < 0.35:
                return
            last_push[0] = now
            analysis._set_job(job_id, done_count=progress["done"],
                              failed_count=progress["failed"],
                              result_json=json.dumps(progress, ensure_ascii=False))

        def grouping_progress(done_count, total_count):
            progress["grouping_done"] = done_count
            progress["grouping_total"] = total_count
            publish()

        grouped, representatives, skipped_set, singles = _burst_plan(
            activity_id, photo_ids, progress=grouping_progress
        )
        progress["burst_groups"] = len(grouped)
        progress["burst_skipped"] = len(skipped_set)
        if skipped_set:
            _mark_burst_duplicates(activity_id, list(skipped_set))
        # 本地每组只留 1 张；非连拍单张全部送 API。
        candidates = [pid for pid in photo_ids
                      if pid in representatives or pid not in grouped]
        progress["refine_total"] = len(candidates)
        progress["stage"] = "refine"
        progress["done"] = len(skipped_set)
        publish(force=True)

        done = len(skipped_set)
        failed = 0
        budget_paused = False
        with httpx.Client(timeout=120, limits=httpx.Limits(max_connections=workers,
                               max_keepalive_connections=workers)) as client, \
                ThreadPoolExecutor(max_workers=workers) as executor:
            index, pending = 0, {}
            while index < len(candidates) or pending:
                stopping = stopped()
                while not stopping and index < len(candidates) and len(pending) < workers:
                    if budget is not None and analysis.used_cost(activity_id) + reserve * (len(pending) + 1) > budget:
                        budget_paused = not pending
                        break
                    pid = candidates[index]
                    pending[executor.submit(
                        analysis._analyze_photo, pid, activity_id, job_id,
                        enabled, modes, "", settings, activity_kind,
                        key_pool=pool_keys, client=client, quick=False
                    )] = pid
                    index += 1
                if not pending:
                    break
                finished, _ = wait(pending, timeout=.25, return_when=FIRST_COMPLETED)
                for future in finished:
                    pid = pending.pop(future)
                    try:
                        result = future.result()
                    except Exception as exc:
                        result = {"ok": False, "error": pool_keys.redact(str(exc))[:300]}
                    progress["refine_done"] += 1
                    if result["ok"]:
                        suggestion, _issues = checks.suggestion(result["parsed"], modes)
                        if suggestion == "reject":
                            progress["rejected"] += 1
                        elif suggestion == "keep":
                            progress["kept"] += 1
                        else:
                            progress["uncertain"] += 1
                        analysis._save_success(pid, result["parsed"], modes, settings)
                        done += 1
                        progress["done"] = done
                    else:
                        analysis._save_failure(pid, enabled, result["error"])
                        with db.db() as conn:
                            conn.execute("UPDATE photos SET ai_stage='refine_failed' WHERE id=?", (pid,))
                        failed += 1
                        progress["failed"] = failed
                    publish()

        current = analysis._job_row(job_id)
        status = "done"
        if budget_paused or current["status"] in ("pausing", "paused"):
            status = "paused"
        elif current["status"] in ("cancelling", "cancelled"):
            status = "cancelled"
        if status == "done":
            _settle_burst_groups(activity_id, set(candidates))
        progress.update(done=done, failed=failed,
                        used_cost=round(analysis.used_cost(activity_id), 4))
        if budget_paused:
            progress["reason"] = "budget"
        if status == "done" and not failed and auto_dedupe:
            progress["dedupe"] = dedupe.auto_apply(activity_id, "analysis")
        analysis._set_job(job_id, status=status, done_count=done, failed_count=failed,
                          result_json=json.dumps(progress, ensure_ascii=False))
        db.log_event(activity_id, "analysis_finished", job_id, json.dumps(progress))
    except Exception as exc:
        error = pool_keys.redact(str(exc)) if pool_keys else str(exc)
        if "cannot schedule new futures after shutdown" in error:
            analysis._set_job(job_id, status="paused", error="应用关闭，分析已中断；重新打开后可继续")
        else:
            analysis._set_job(job_id, status="failed", error=error[:500])
