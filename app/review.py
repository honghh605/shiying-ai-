"""人工复核：照片列表、结论、重要标记、撤销。"""
from __future__ import annotations

import os

import json

from . import checks as check_defs
from . import config, db


def _photo_dict(row) -> dict:
    paired = row["pair_id"] is not None
    return {
        "id": row["id"],
        "file_name": row["file_name"],
        "ext": row["ext"],
        "form": row["form"],
        "rel_path": row["rel_path"],
        "source_id": row["source_id"],
        "source_label": row["source_label"],
        "size_bytes": row["size_bytes"],
        "width": row["width"],
        "height": row["height"],
        "capture_time": row["capture_time"],
        "camera_make": row["camera_make"],
        "camera_model": row["camera_model"],
        "lens_model": row["lens_model"],
        "iso": row["iso"],
        "aperture": row["aperture"],
        "shutter": row["shutter"],
        "focal_length": row["focal_length"],
        "exposure_bias": row["exposure_bias"],
        "preview_state": row["preview_state"],
        "preview_error": row["preview_error"],
        "pair_id": row["pair_id"],
        "paired": paired,
        "verdict": row["verdict"] or "undecided",
        "important": bool(row["important"]),
        "note": row["note"],
        "labels": [],
        "ai_suggestion": row["ai_suggestion"],
        "ai_stage": row["ai_stage"],
        "ai_quick": json.loads(row["ai_quick_json"]) if row["ai_quick_json"] else None,
        "ai_issue_count": row["ai_issue_count"] or 0,
        "burst_group": row["burst_group"],
        "burst_rank": row["burst_rank"],
        "burst_score": row["burst_score"],
        "issues": [],
    }


def _checks(photo_id: str) -> dict:
    with db.db() as conn:
        rows = conn.execute(
            "SELECT check_type, status, result, reason, region_hint, error, method, evidence_json FROM checks WHERE photo_id=?",
            (photo_id,),
        ).fetchall()
    return {
        row["check_type"]: {
            "status": row["status"],
            "result": row["result"],
            "reason": row["reason"],
            "region": row["region_hint"],
            "evidence": json.loads(row["evidence_json"] or "{}"),
            "error": row["error"],
            "method": row["method"],
            "name": check_defs.CHECK_TYPES.get(row["check_type"], {}).get("name", row["check_type"]),
        }
        for row in rows
    }


def _filter_sql(category: str, source_id: str | None, keyword: str | None) -> tuple[str, list]:
    clauses = ["p.activity_id = ?"]
    params: list = []
    if category == "undecided":
        clauses.append("COALESCE(d.verdict, 'undecided') = 'undecided'")
    elif category in ("keep", "reject", "uncertain"):
        clauses.append("d.verdict = ?")
        params.append(category)
    elif category == "important":
        clauses.append("d.important = 1")
    elif category == "refine":
        # 精筛：只包含第一轮快速初筛打上“保留”标签、进入精筛的照片。
        clauses.append("json_extract(p.ai_quick_json, '$.verdict') = 'keep'")
    elif category == "dedupe_duplicates":
        # 以实际标记为准；未完成第二轮时 rank>1 也属于同组重复候选。
        clauses.append("(p.ai_stage = 'burst_duplicate' OR p.burst_rank > 1)")
    elif category == "burst_best":
        clauses.append("p.burst_rank = 1")
    elif category == "unreadable":
        clauses.append("p.preview_state = 'failed'")
    elif category == "ai_reject":
        clauses.append("p.ai_suggestion = 'reject'")
    elif category == "ai_uncertain":
        clauses.append("p.ai_suggestion = 'uncertain'")
    elif category == "ai_done":
        clauses.append("p.ai_suggestion IS NOT NULL")
    if source_id:
        clauses.append("p.source_id = ?")
        params.append(source_id)
    if keyword:
        clauses.append("p.file_name LIKE ?")
        params.append(f"%{keyword}%")
    return " AND ".join(clauses), params


def list_photos(activity_id: str, category: str = "all", source_id: str | None = None,
                keyword: str | None = None, offset: int = 0, limit: int = 120) -> dict:
    where, params = _filter_sql(category, source_id, keyword)
    with db.db() as conn:
        # 先判断来源卡是否在线；来源离线时只保留已经导出到新位置的照片。
        all_rows = conn.execute(
            "SELECT p.id, p.source_id, s.root_path FROM photos p JOIN sources s ON s.id=p.source_id "
            "LEFT JOIN decisions d ON d.photo_id=p.id "
            f"WHERE {where} ORDER BY p.file_name COLLATE NOCASE",
            (activity_id, *params),
        ).fetchall()
        online: dict[str, bool] = {}
        for row in all_rows:
            if row["source_id"] not in online:
                online[row["source_id"]] = os.path.isdir(row["root_path"])
        offline_ids = [row["id"] for row in all_rows if not online.get(row["source_id"])]
        exported_ids: set[str] = set()
        if offline_ids:
            placeholders = ",".join("?" for _ in offline_ids)
            exported_ids = {
                item["photo_id"] for item in conn.execute(
                    "SELECT DISTINCT ei.photo_id FROM export_items ei JOIN exports e ON e.id=ei.export_id "
                    f"WHERE ei.photo_id IN ({placeholders}) AND ei.status='done'",
                    offline_ids,
                ).fetchall()
            }
        visible = [row for row in all_rows if online.get(row["source_id"]) or row["id"] in exported_ids]
        total = len(visible)
        page_ids = [row["id"] for row in visible[offset:offset + limit]]
        if not page_ids:
            return {"total": total, "items": []}
        placeholders = ",".join("?" for _ in page_ids)
        rows = conn.execute(
            "SELECT p.*, s.label AS source_label, "
            "COALESCE(d.verdict, 'undecided') AS verdict, COALESCE(d.important, 0) AS important, d.note "
            "FROM photos p JOIN sources s ON s.id = p.source_id "
            "LEFT JOIN decisions d ON d.photo_id = p.id "
            f"WHERE p.id IN ({placeholders})",
            page_ids,
        ).fetchall()
        by_id = {row["id"]: row for row in rows}
        rows = [by_id[pid] for pid in page_ids if pid in by_id]
        items = [_photo_dict(row) for row in rows]
        for item, source_id_value in zip(items, [row["source_id"] for row in rows]):
            item["source_available"] = online.get(source_id_value, True)
            item["available_from_export"] = not item["source_available"] and item["id"] in exported_ids
        _attach_issues(conn, items)
    return {"total": total, "items": items}


def _attach_issues(conn, items: list[dict]) -> None:
    if not items:
        return
    ids = [item["id"] for item in items]
    placeholders = ",".join("?" for _ in ids)
    rows = conn.execute(
        "SELECT photo_id, check_type, result, reason FROM checks "
        f"WHERE photo_id IN ({placeholders}) AND status='done' AND result IN ('suspect','uncertain')",
        ids,
    ).fetchall()
    by_photo = {item["id"]: item for item in items}
    for row in rows:
        item = by_photo.get(row["photo_id"])
        if item is None:
            continue
        info = check_defs.CHECK_TYPES.get(row["check_type"], {})
        item["issues"].append({
            "type": row["check_type"],
            "name": info.get("short", row["check_type"]),
            "result": row["result"],
            "reason": row["reason"],
        })


def get_photo(photo_id: str) -> dict | None:
    with db.db() as conn:
        row = conn.execute(
            "SELECT p.*, s.label AS source_label, s.root_path, "
            "COALESCE(d.verdict, 'undecided') AS verdict, COALESCE(d.important, 0) AS important, d.note "
            "FROM photos p JOIN sources s ON s.id = p.source_id "
            "LEFT JOIN decisions d ON d.photo_id = p.id WHERE p.id=?",
            (photo_id,),
        ).fetchone()
        if not row:
            return None
        data = _photo_dict(row)
        data["root_path"] = row["root_path"]
        if not all(data.get(key) for key in ("camera_model", "lens_model", "iso", "aperture", "shutter")):
            try:
                from .importer import read_metadata
                meta = read_metadata(os.path.join(row["root_path"], row["rel_path"]), row["ext"])
                if meta.get("camera_model"):
                    data.update({key: meta.get(key) for key in (
                        "camera_make", "camera_model", "lens_model", "iso", "aperture",
                        "shutter", "focal_length", "exposure_bias", "capture_time",
                        "width", "height", "orientation",
                    )})
                    conn.execute(
                        "UPDATE photos SET camera_make=?, camera_model=?, lens_model=?, iso=?, "
                        "aperture=?, shutter=?, focal_length=?, exposure_bias=?, "
                        "capture_time=COALESCE(capture_time, ?), width=COALESCE(width, ?), "
                        "height=COALESCE(height, ?), orientation=COALESCE(orientation, ?) WHERE id=?",
                        (meta.get("camera_make"), meta.get("camera_model"), meta.get("lens_model"),
                         meta.get("iso"), meta.get("aperture"), meta.get("shutter"),
                         meta.get("focal_length"), meta.get("exposure_bias"),
                         meta.get("capture_time"), meta.get("width"), meta.get("height"),
                         meta.get("orientation"), photo_id),
                    )
            except Exception:
                pass
        data["checks"] = _checks(photo_id)
        labels = conn.execute(
            "SELECT label_id FROM photo_labels WHERE photo_id=?", (photo_id,)
        ).fetchall()
        data["labels"] = [item["label_id"] for item in labels]
        return data


def set_decision(photo_id: str, verdict: str | None = None, important: bool | None = None,
                 note: str | None = None) -> dict:
    if verdict is not None and verdict not in config.VERDICTS and verdict != "undecided":
        raise ValueError("无效的选片结论")
    with db.db() as conn:
        row = conn.execute(
            "SELECT COALESCE(d.verdict, 'undecided') AS verdict, COALESCE(d.important, 0) AS important, d.note "
            "FROM photos p LEFT JOIN decisions d ON d.photo_id = p.id WHERE p.id=?",
            (photo_id,),
        ).fetchone()
        if not row:
            raise ValueError("照片不存在")
        before = {"verdict": row["verdict"], "important": bool(row["important"]), "note": row["note"]}
        after = {
            "verdict": verdict if verdict is not None else before["verdict"],
            "important": bool(important) if important is not None else before["important"],
            "note": note if note is not None else before["note"],
        }
        activity = conn.execute("SELECT activity_id FROM photos WHERE id=?", (photo_id,)).fetchone()["activity_id"]
        conn.execute(
            "INSERT INTO decisions(photo_id, activity_id, verdict, important, note, updated_at) "
            "VALUES (?,?,?,?,?,?) ON CONFLICT(photo_id) DO UPDATE SET "
            "verdict=excluded.verdict, important=excluded.important, note=excluded.note, updated_at=excluded.updated_at, origin='manual'",
            (photo_id, activity, after["verdict"], int(after["important"]), after["note"], db.now()),
        )
        conn.execute(
            "INSERT INTO decision_events(photo_id, before_json, after_json, at) VALUES (?,?,?,?)",
            (photo_id, json.dumps(before, ensure_ascii=False), json.dumps(after, ensure_ascii=False), db.now()),
        )
        conn.execute("UPDATE activities SET updated_at=? WHERE id=?", (db.now(), activity))
    return {"ok": True, "decision": after}


def batch_decision(activity_id: str, photo_ids: list[str], verdict: str) -> dict:
    if verdict not in config.VERDICTS:
        raise ValueError("无效的选片结论")
    applied = skipped = 0
    for photo_id in photo_ids:
        with db.db() as conn:
            row = conn.execute(
                "SELECT COALESCE(d.important, 0) AS important FROM photos p "
                "LEFT JOIN decisions d ON d.photo_id=p.id WHERE p.id=? AND p.activity_id=?",
                (photo_id, activity_id),
            ).fetchone()
        if not row:
            skipped += 1
            continue
        if verdict == "reject" and row["important"]:
            skipped += 1  # 重要照片不能被批量排除
            continue
        set_decision(photo_id, verdict=verdict)
        applied += 1
    return {"applied": applied, "skipped": skipped}


def undo(photo_id: str) -> dict:
    with db.db() as conn:
        event = conn.execute(
            "SELECT id, before_json FROM decision_events WHERE photo_id=? ORDER BY id DESC LIMIT 1",
            (photo_id,),
        ).fetchone()
        if not event:
            raise ValueError("没有可撤销的操作")
        before = json.loads(event["before_json"] or "{}")
        conn.execute(
            "INSERT INTO decisions(photo_id, activity_id, verdict, important, note, updated_at) "
            "SELECT ?, activity_id, ?, ?, ?, ? FROM photos WHERE id=? "
            "ON CONFLICT(photo_id) DO UPDATE SET verdict=excluded.verdict, important=excluded.important, "
            "note=excluded.note, updated_at=excluded.updated_at, origin='manual'",
            (photo_id, before.get("verdict", "undecided"), int(bool(before.get("important"))),
             before.get("note"), db.now(), photo_id),
        )
        conn.execute("DELETE FROM decision_events WHERE id=?", (event["id"],))
    return {"ok": True, "decision": before}
