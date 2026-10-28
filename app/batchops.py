"""批量/单张导出与删除：只操作本活动内照片。"""
from __future__ import annotations

import os
import shutil

from . import config, db


def _photo_rows(activity_id: str, photo_ids: list[str] | None = None,
                category: str | None = None, source_id: str | None = None) -> list:
    with db.db() as conn:
        if photo_ids:
            marks = ",".join("?" for _ in photo_ids)
            rows = conn.execute(
                "SELECT p.id, p.rel_path, p.file_name, s.root_path, s.label AS source_label "
                "FROM photos p JOIN sources s ON s.id=p.source_id "
                f"WHERE p.activity_id=? AND p.id IN ({marks})",
                (activity_id, *photo_ids),
            ).fetchall()
        else:
            from . import review as review_module
            where, params = review_module._filter_sql(category or "all", source_id, None)
            rows = conn.execute(
                "SELECT p.id, p.rel_path, p.file_name, s.root_path, s.label AS source_label "
                "FROM photos p JOIN sources s ON s.id=p.source_id "
                "LEFT JOIN decisions d ON d.photo_id=p.id "
                f"WHERE {where}",
                (activity_id, *params),
            ).fetchall()
    return rows


def export_photos(activity_id: str, dest_root: str, photo_ids: list[str] | None = None,
                  category: str | None = None, source_id: str | None = None) -> dict:
    if not dest_root or not os.path.isdir(dest_root):
        raise ValueError("目标文件夹不存在")
    rows = _photo_rows(activity_id, photo_ids, category, source_id)
    copied = failed = 0
    folders: set[str] = set()
    for row in rows:
        source = os.path.abspath(os.path.join(row["root_path"], row["rel_path"]))
        relative = str(row["rel_path"]).replace("/", os.sep).replace("\\", os.sep)
        if not os.path.isfile(source):
            failed += 1
            continue
        dest = os.path.join(dest_root, relative)
        # Different source cards may share rel_path; keep them separated.
        if os.path.exists(dest) and os.path.abspath(dest) != source:
            dest = os.path.join(dest_root, str(row["source_label"] or "照片"), relative)
        try:
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            shutil.copy2(source, dest)
            copied += 1
            folders.add(os.path.dirname(dest))
        except OSError:
            failed += 1
    return {"ok": True, "copied": copied, "failed": failed, "total": len(rows),
            "dest_root": dest_root, "folders": sorted(folders)}


def delete_photos(activity_id: str, mode: str = "app", photo_ids: list[str] | None = None,
                  category: str | None = None, source_id: str | None = None) -> dict:
    if mode not in {"app", "disk"}:
        raise ValueError("无效的删除方式")
    if not photo_ids and not category:
        raise ValueError("需要指定照片或分类")
    rows = _photo_rows(activity_id, photo_ids, category, source_id)
    ids = [row["id"] for row in rows]
    deleted_files = failed_files = 0
    if mode == "disk":
        for row in rows:
            path = os.path.abspath(os.path.join(row["root_path"], row["rel_path"]))
            try:
                if os.path.isfile(path):
                    os.remove(path)
                deleted_files += 1
            except OSError:
                failed_files += 1
    if not ids:
        return {"ok": True, "deleted": 0, "failed_files": 0, "mode": mode}
    with db.db() as conn:
        marks = ",".join("?" for _ in ids)
        conn.execute(f"DELETE FROM decisions WHERE photo_id IN ({marks})", ids)
        conn.execute(f"DELETE FROM decision_events WHERE photo_id IN ({marks})", ids)
        conn.execute(f"DELETE FROM checks WHERE photo_id IN ({marks})", ids)
        conn.execute(f"DELETE FROM photo_labels WHERE photo_id IN ({marks})", ids)
        conn.execute(f"DELETE FROM photos WHERE id IN ({marks})", ids)
        conn.execute("UPDATE sources SET photo_count=(SELECT COUNT(*) FROM photos WHERE source_id=sources.id) WHERE activity_id=?", (activity_id,))
        conn.execute("UPDATE activities SET updated_at=? WHERE id=?", (db.now(), activity_id))
    for photo_id in ids:
        for path in (config.thumb_path(activity_id, photo_id),
                     config.review_path(activity_id, photo_id),
                     config.ai_path(activity_id, photo_id)):
            try:
                os.remove(path)
            except OSError:
                pass
    db.log_event(activity_id, "delete_photos", source_id or "",
                 __import__("json").dumps({"mode": mode, "count": len(ids), "files": deleted_files}, ensure_ascii=False))
    return {"ok": True, "deleted": len(ids), "deleted_files": deleted_files,
            "failed_files": failed_files, "mode": mode}


def export_one(activity_id: str, photo_id: str, dest_root: str) -> dict:
    return export_photos(activity_id, dest_root, photo_ids=[photo_id])


def delete_one(activity_id: str, photo_id: str, mode: str) -> dict:
    return delete_photos(activity_id, mode=mode, photo_ids=[photo_id])
