"""活动与来源的创建、查询。"""
from __future__ import annotations

import json
import os
import shutil
import uuid

from . import config, db

DEFAULT_REQUIRED_SHOTS = ["现场全景", "致辞", "学生代表", "观众", "互动", "集体合影"]

DEFAULT_RULE = {
    "checks": {
        "focus": {"mode": "strict"},
        "closed_eye": {"mode": "strict"},
        "exposure": {"mode": "strict"},
        "occlusion": {"mode": "strict"},
        "composition": {"mode": "remind"},
    },
    "required_shots": DEFAULT_REQUIRED_SHOTS,
    "export": {"pair_mode": "both", "keep_source_subdir": True},
}


def _counts(conn, activity_id: str) -> dict:
    row = conn.execute(
        "SELECT COUNT(*) AS files, COUNT(DISTINCT pair_id) AS pairs, "
        "SUM(CASE WHEN preview_state='failed' THEN 1 ELSE 0 END) AS unreadable "
        "FROM photos WHERE activity_id=?",
        (activity_id,),
    ).fetchone()
    files = row["files"] or 0
    pairs = row["pairs"] or 0
    return {"files": files, "objects": files - pairs, "pairs": pairs, "unreadable": row["unreadable"] or 0}


def _review_counts(conn, activity_id: str) -> dict:
    row = conn.execute(
        "SELECT "
        "SUM(CASE WHEN COALESCE(d.verdict,'undecided')='undecided' THEN 1 ELSE 0 END) AS undecided, "
        "SUM(CASE WHEN d.verdict='keep' THEN 1 ELSE 0 END) AS keep_count, "
        "SUM(CASE WHEN d.verdict='reject' THEN 1 ELSE 0 END) AS reject_count, "
        "SUM(CASE WHEN d.verdict='uncertain' THEN 1 ELSE 0 END) AS uncertain_count, "
        "SUM(CASE WHEN d.important=1 THEN 1 ELSE 0 END) AS important, "
        "SUM(CASE WHEN p.ai_suggestion='reject' THEN 1 ELSE 0 END) AS ai_reject, "
        "SUM(CASE WHEN p.ai_suggestion='uncertain' THEN 1 ELSE 0 END) AS ai_uncertain, "
        "SUM(CASE WHEN p.ai_suggestion IS NOT NULL THEN 1 ELSE 0 END) AS ai_done, "
        "SUM(CASE WHEN json_extract(p.ai_quick_json, '$.verdict') = 'keep' THEN 1 ELSE 0 END) AS refine_count, "
        "SUM(CASE WHEN p.preview_state='failed' THEN 1 ELSE 0 END) AS unreadable, "
        "SUM(CASE WHEN p.burst_rank=1 THEN 1 ELSE 0 END) AS burst_best_count, "
        "SUM(CASE WHEN p.ai_stage='burst_duplicate' OR p.burst_rank > 1 THEN 1 ELSE 0 END) AS burst_duplicate_count "
        "FROM photos p LEFT JOIN decisions d ON d.photo_id=p.id WHERE p.activity_id=?",
        (activity_id,),
    ).fetchone()
    keys = ("undecided", "keep_count", "reject_count", "uncertain_count", "important",
            "ai_reject", "ai_uncertain", "ai_done", "refine_count", "unreadable",
            "burst_best_count", "burst_duplicate_count")
    counts = {key: int(row[key] or 0) for key in keys}
    run = conn.execute(
        "SELECT status, groups, kept_count, rejected_count, options_json FROM dedupe_runs "
        "WHERE activity_id=? ORDER BY created_at DESC LIMIT 1",
        (activity_id,),
    ).fetchone()
    counts["dedupe"] = {
        "applied": bool(run and run["status"] == "applied"),
        "groups": int(run["groups"]) if run else 0,
        "kept_count": int(run["kept_count"]) if run else 0,
        "rejected_count": int(run["rejected_count"]) if run else 0,
    }
    return counts


def _row_to_activity(conn, row) -> dict:
    counts = _counts(conn, row["id"])
    counts["review"] = _review_counts(conn, row["id"])
    cover = conn.execute(
        "SELECT id FROM photos WHERE activity_id=? AND preview_state IN ('ok','degraded') "
        "ORDER BY created_at, file_name COLLATE NOCASE LIMIT 1",
        (row["id"],),
    ).fetchone()
    counts["cover_photo_id"] = cover["id"] if cover else None
    sources = [
        {"id": src["id"], "label": src["label"], "root_path": src["root_path"], "photo_count": src["photo_count"],
            "available": os.path.isdir(src["root_path"])}
        for src in conn.execute("SELECT * FROM sources WHERE activity_id=? ORDER BY added_at", (row["id"],))
    ]
    labels = [
        {"id": lab["id"], "name": lab["name"], "order_index": lab["order_index"], "na_reason": lab["na_reason"]}
        for lab in conn.execute("SELECT * FROM labels WHERE activity_id=? ORDER BY order_index", (row["id"],))
    ]
    return {
        "id": row["id"],
        "name": row["name"],
        "kind": row["kind"],
        "stage": row["stage"],
        "budget_limit_cny": row["budget_limit_cny"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "note": row["note"],
        "counts": counts,
        "sources": sources,
        "labels": labels,
        "rule": json.loads(row["rule_json"]),
    }


def list_activities() -> list[dict]:
    with db.db() as conn:
        rows = conn.execute("SELECT * FROM activities ORDER BY updated_at DESC").fetchall()
        return [_row_to_activity(conn, row) for row in rows]


def get_activity(activity_id: str) -> dict | None:
    with db.db() as conn:
        row = conn.execute("SELECT * FROM activities WHERE id=?", (activity_id,)).fetchone()
        return _row_to_activity(conn, row) if row else None


def create_activity(name: str, kind: str = "custom", budget_limit_cny: float | None = None) -> dict:
    name = (name or "").strip()
    if not name:
        raise ValueError("活动名称不能为空")
    if kind not in {"ceremony", "performance", "sports", "custom"}:
        kind = "custom"
    activity_id = uuid.uuid4().hex
    rule = json.loads(json.dumps(DEFAULT_RULE, ensure_ascii=False))
    with db.db() as conn:
        conn.execute(
            "INSERT INTO activities(id, name, kind, stage, rule_json, budget_limit_cny, created_at, updated_at) "
            "VALUES (?,?,?, 'activity', ?, ?, ?, ?)",
            (activity_id, name, kind, json.dumps(rule, ensure_ascii=False), budget_limit_cny, db.now(), db.now()),
        )
        for index, label in enumerate(DEFAULT_REQUIRED_SHOTS):
            conn.execute(
                "INSERT INTO labels(id, activity_id, kind, name, order_index) VALUES (?,?, 'required_shot', ?, ?)",
                (uuid.uuid4().hex, activity_id, label, index),
            )
    db.log_event(activity_id, "activity_created", activity_id, name)
    return get_activity(activity_id)


def update_activity(activity_id: str, patch: dict) -> dict:
    allowed = {}
    if "name" in patch and isinstance(patch["name"], str) and patch["name"].strip():
        allowed["name"] = patch["name"].strip()
    if "kind" in patch and patch["kind"] in {"ceremony", "performance", "sports", "custom"}:
        allowed["kind"] = patch["kind"]
    if "budget_limit_cny" in patch:
        value = patch["budget_limit_cny"]
        if value is None or (isinstance(value, (int, float)) and value >= 0):
            allowed["budget_limit_cny"] = value
    if "note" in patch and isinstance(patch["note"], str):
        allowed["note"] = patch["note"]
    if "stage" in patch and patch["stage"] in {
        "activity", "import", "rules", "trial", "analyze", "review", "check", "export",
    }:
        allowed["stage"] = patch["stage"]
    if "rule" in patch and isinstance(patch["rule"], dict):
        with db.db() as conn:
            row = conn.execute("SELECT rule_json FROM activities WHERE id=?", (activity_id,)).fetchone()
        if row:
            rule = json.loads(row["rule_json"] or "{}")
            incoming = patch["rule"]
            for key, current in DEFAULT_RULE["checks"].items():
                mode = ((incoming.get("checks") or {}).get(key) or {}).get("mode")
                if mode in {"strict", "remind", "skip"}:
                    rule.setdefault("checks", {}).setdefault(key, {})["mode"] = mode
            allowed["rule_json"] = json.dumps(rule, ensure_ascii=False)
    if allowed:
        allowed["updated_at"] = db.now()
        columns = ", ".join(f"{key}=?" for key in allowed)
        with db.db() as conn:
            conn.execute(f"UPDATE activities SET {columns} WHERE id=?", (*allowed.values(), activity_id))
    activity = get_activity(activity_id)
    if activity is None:
        raise ValueError("活动不存在")
    return activity


def safe_label(text: str, fallback: str = "source") -> str:
    cleaned = "".join(ch for ch in text if ch not in '<>:"/\\|?*').strip().strip(".")
    return cleaned or fallback


def delete_activity(activity_id: str) -> dict:
    """删除活动及其全部索引/决策/任务记录，并清理缩略图缓存。原始照片不动。"""
    with db.db() as conn:
        row = conn.execute("SELECT id FROM activities WHERE id=?", (activity_id,)).fetchone()
        if not row:
            raise ValueError("活动不存在")
        conn.execute("DELETE FROM export_items WHERE export_id IN (SELECT id FROM exports WHERE activity_id=?)", (activity_id,))
        conn.execute("DELETE FROM exports WHERE activity_id=?", (activity_id,))
        conn.execute("DELETE FROM ai_requests WHERE activity_id=?", (activity_id,))
        conn.execute("DELETE FROM jobs WHERE activity_id=?", (activity_id,))
        conn.execute("DELETE FROM events WHERE activity_id=?", (activity_id,))
        conn.execute("DELETE FROM decision_events WHERE photo_id IN (SELECT id FROM photos WHERE activity_id=?)", (activity_id,))
        conn.execute("DELETE FROM checks WHERE photo_id IN (SELECT id FROM photos WHERE activity_id=?)", (activity_id,))
        conn.execute("DELETE FROM photo_labels WHERE photo_id IN (SELECT id FROM photos WHERE activity_id=?) OR label_id IN (SELECT id FROM labels WHERE activity_id=?)", (activity_id, activity_id))
        conn.execute("DELETE FROM decisions WHERE activity_id=?", (activity_id,))
        conn.execute("DELETE FROM dedupe_items WHERE run_id IN (SELECT id FROM dedupe_runs WHERE activity_id=?)", (activity_id,))
        conn.execute("DELETE FROM dedupe_runs WHERE activity_id=?", (activity_id,))
        conn.execute("DELETE FROM photos WHERE activity_id=?", (activity_id,))
        conn.execute("DELETE FROM sources WHERE activity_id=?", (activity_id,))
        conn.execute("DELETE FROM labels WHERE activity_id=?", (activity_id,))
        conn.execute("DELETE FROM activities WHERE id=?", (activity_id,))
    shutil.rmtree(os.path.join(config.data_dir(), "cache", activity_id), ignore_errors=True)
    return {"ok": True, "id": activity_id}


def delete_originals(activity_id: str, source_id: str, scope: str = "keep") -> dict:
    """永久删除某个来源卡中指定范围的原片，并移除对应照片记录；已导出副本不受影响。"""
    from . import review as review_module

    if scope not in {"keep", "undecided", "uncertain", "reject", "all"}:
        raise ValueError("无效的删除范围")
    with db.db() as conn:
        source = conn.execute("SELECT * FROM sources WHERE id=? AND activity_id=?", (source_id, activity_id)).fetchone()
        if not source:
            raise ValueError("来源卡不存在")
        where, params = review_module._filter_sql(scope, source_id, None)
        rows = conn.execute(
            "SELECT p.id, p.rel_path, s.root_path FROM photos p JOIN sources s ON s.id=p.source_id "
            "LEFT JOIN decisions d ON d.photo_id=p.id "
            f"WHERE {where}", (activity_id, *params),
        ).fetchall()

    root = os.path.abspath(source["root_path"])
    deleted = failed = 0
    ids: list[str] = []
    for row in rows:
        ids.append(row["id"])
        path = os.path.abspath(os.path.join(row["root_path"], row["rel_path"]))
        try:
            if os.path.commonpath([root, path]) != root:
                failed += 1
                continue
            if os.path.isfile(path):
                os.remove(path)
            deleted += 1
        except OSError:
            failed += 1

    with db.db() as conn:
        for index in range(0, len(ids), 500):
            chunk = ids[index:index + 500]
            conn.executemany("DELETE FROM photos WHERE id=?", [(pid,) for pid in chunk])
        conn.execute("UPDATE sources SET photo_count=(SELECT COUNT(*) FROM photos WHERE source_id=sources.id) WHERE id=?", (source_id,))
        conn.execute("UPDATE activities SET updated_at=? WHERE id=?", (db.now(), activity_id))
    db.log_event(activity_id, "delete_originals", source_id,
                 json.dumps({"scope": scope, "deleted": deleted, "failed": failed}, ensure_ascii=False))
    return {"ok": True, "deleted": deleted, "failed": failed, "source_id": source_id,
            "source_label": source["label"], "root_path": root}


