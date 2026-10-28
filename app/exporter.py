"""导出：选片清单规划、原片复制、重名处理、失败重试。"""
from __future__ import annotations

import json
import os
import shutil
import threading
import uuid

from . import activities, config, db, report


EXPORT_SCOPES = {
    "keep": "keep",
    "undecided": "undecided",
    "uncertain": "uncertain",
    "reject": "reject",
    "all": "all",
}


def _scope_sql(scope: str) -> tuple[str, list]:
    if scope not in EXPORT_SCOPES:
        raise ValueError("无效的导出范围")
    if scope == "keep":
        return "d.verdict='keep'", []
    if scope == "undecided":
        return "COALESCE(d.verdict, 'undecided')='undecided'", []
    if scope == "uncertain":
        return "d.verdict='uncertain'", []
    if scope == "reject":
        return "d.verdict='reject'", []
    return "1=1", []


def _scope_rows(activity_id: str, scope: str = "keep") -> list:
    where, params = _scope_sql(scope)
    with db.db() as conn:
        return conn.execute(
            "SELECT p.*, s.root_path, s.label AS source_label, "
            "COALESCE(d.verdict, 'undecided') AS verdict, COALESCE(d.important, 0) AS important "
            "FROM photos p JOIN sources s ON s.id = p.source_id "
            "LEFT JOIN decisions d ON d.photo_id = p.id "
            f"WHERE p.activity_id=? AND {where} "
            "ORDER BY s.label COLLATE NOCASE, p.rel_path COLLATE NOCASE",
            (activity_id, *params),
        ).fetchall()


def _group_objects(rows: list) -> list[list]:
    objects: dict[str, list] = {}
    for row in rows:
        objects.setdefault(row["pair_id"] or row["id"], []).append(row)
    return list(objects.values())


def _select_files(group: list, pair_mode: str) -> list:
    if len(group) == 1:
        return group
    if pair_mode == "raw":
        return [row for row in group if row["form"] == "raw"]
    if pair_mode == "jpg":
        return [row for row in group if row["form"] == "jpeg"]
    return group


def _unique_dest(path: str, planned: set[str]) -> tuple[str, bool]:
    if not os.path.exists(path) and os.path.normcase(path) not in planned:
        planned.add(os.path.normcase(path))
        return path, False
    stem, ext = os.path.splitext(path)
    index = 2
    while True:
        candidate = f"{stem}_{index}{ext}"
        if not os.path.exists(candidate) and os.path.normcase(candidate) not in planned:
            planned.add(os.path.normcase(candidate))
            return candidate, True
        index += 1


def _label_status(conn, activity_id: str) -> list[dict]:
    rows = conn.execute(
        "SELECT l.id, l.name, l.na_reason, "
        "(SELECT COUNT(*) FROM photo_labels pl JOIN decisions d ON d.photo_id = pl.photo_id "
        " WHERE pl.label_id = l.id AND d.verdict = 'keep') AS kept_count "
        "FROM labels l WHERE l.activity_id=? ORDER BY l.order_index",
        (activity_id,),
    ).fetchall()
    return [{"id": row["id"], "name": row["name"], "na_reason": row["na_reason"], "kept_count": row["kept_count"]}
            for row in rows]


def build_plan(activity_id: str, dest_root: str, pair_mode: str = "both",
               keep_source_subdir: bool = True, scope: str = "keep") -> dict:
    if pair_mode not in {"both", "raw", "jpg"}:
        raise ValueError("无效的配对导出方式")
    dest_root = os.path.abspath(dest_root)
    if not dest_root:
        raise ValueError("请选择导出目标文件夹")

    rows = _scope_rows(activity_id, scope)
    objects = _group_objects(rows)
    planned: set[str] = set()
    items = []
    files = bytes_total = 0
    renamed = missing = 0

    for group in objects:
        for row in _select_files(group, pair_mode):
            source_path = os.path.join(row["root_path"], row["rel_path"])
            if not os.path.exists(source_path):
                missing += 1
                continue
            if keep_source_subdir:
                subdir = os.path.dirname(row["rel_path"])
                target_dir = os.path.join(dest_root, activities.safe_label(row["source_label"]), subdir)
            else:
                target_dir = dest_root
            dest, was_renamed = _unique_dest(os.path.join(target_dir, row["file_name"]), planned)
            renamed += int(was_renamed)
            files += 1
            bytes_total += row["size_bytes"] or 0
            items.append({
                "photo_id": row["id"],
                "source_path": source_path,
                "dest_path": dest,
                "form": row["form"],
                "size_bytes": row["size_bytes"] or 0,
            })

    with db.db() as conn:
        labels = _label_status(conn, activity_id)

    return {
        "dest_root": dest_root,
        "pair_mode": pair_mode,
        "keep_source_subdir": keep_source_subdir,
        "scope": scope,
        "objects": len(objects),
        "files": files,
        "bytes": bytes_total,
        "renamed": renamed,
        "missing": missing,
        "labels": labels,
        "items": items,
    }


def _copy_one(source_path: str, dest_path: str) -> None:
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    tmp = dest_path + ".part-" + uuid.uuid4().hex[:8]
    shutil.copy2(source_path, tmp)
    if os.path.getsize(tmp) != os.path.getsize(source_path):
        os.remove(tmp)
        raise OSError("复制后大小不一致")
    os.replace(tmp, dest_path)


def execute(activity_id: str, dest_root: str, pair_mode: str = "both",
            keep_source_subdir: bool = True, scope: str = "keep") -> dict:
    plan = build_plan(activity_id, dest_root, pair_mode, keep_source_subdir, scope)
    if plan["files"] == 0:
        raise ValueError("没有符合该导出范围的照片可导出")
    if plan["missing"]:
        raise ValueError(f"有 {plan['missing']} 个原片文件已不存在，请先回到复核处理")

    export_id = uuid.uuid4().hex
    options = {"pair_mode": pair_mode, "keep_source_subdir": keep_source_subdir, "scope": scope,
               "files": plan["files"], "bytes": plan["bytes"]}
    with db.db() as conn:
        conn.execute(
            "INSERT INTO exports(id, activity_id, dest_root, options_json, status, created_at) "
            "VALUES (?,?,?,?, 'running', ?)",
            (export_id, activity_id, plan["dest_root"], json.dumps(options, ensure_ascii=False), db.now()),
        )
        for item in plan["items"]:
            conn.execute(
                "INSERT INTO export_items(export_id, photo_id, source_path, dest_path, status) "
                "VALUES (?,?,?,?, 'pending')",
                (export_id, item["photo_id"], item["source_path"], item["dest_path"]),
            )

    _run_export(export_id)
    db.log_event(activity_id, "export", export_id, json.dumps({"files": plan["files"]}, ensure_ascii=False))
    return get_export(export_id)


def start_export(activity_id: str, dest_root: str, pair_mode: str = "both",
                 keep_source_subdir: bool = True, scope: str = "keep") -> dict:
    """一键导出：先规划，再后台复制原片，立即返回进度信息。"""
    plan = build_plan(activity_id, dest_root, pair_mode, keep_source_subdir, scope)
    if plan["files"] == 0:
        raise ValueError("没有符合该导出范围的照片可导出")
    if plan["missing"]:
        raise ValueError(f"有 {plan['missing']} 个原片文件已不存在，请先回到复核处理")

    export_id = uuid.uuid4().hex
    options = {"pair_mode": pair_mode, "keep_source_subdir": keep_source_subdir, "scope": scope}
    with db.db() as conn:
        conn.execute(
            "INSERT INTO exports(id, activity_id, dest_root, options_json, status, created_at) "
            "VALUES (?,?,?,?, 'running', ?)",
            (export_id, activity_id, plan["dest_root"], json.dumps(options, ensure_ascii=False), db.now()),
        )
        for item in plan["items"]:
            conn.execute(
                "INSERT INTO export_items(export_id, photo_id, source_path, dest_path, status) "
                "VALUES (?,?,?,?, 'pending')",
                (export_id, item["photo_id"], item["source_path"], item["dest_path"]),
            )
    thread = threading.Thread(target=_run_export, args=(export_id,), daemon=True)
    thread.start()
    db.log_event(activity_id, "export", export_id, json.dumps({"files": plan["files"], "quick": True},
                                                              ensure_ascii=False))
    return {
        "export": get_export(export_id),
        "files": plan["files"],
        "bytes": plan["bytes"],
        "objects": plan["objects"],
        "dest_root": plan["dest_root"],
    }


def _export_dict(row) -> dict:
    return {
        "id": row["id"],
        "activity_id": row["activity_id"],
        "dest_root": row["dest_root"],
        "options": json.loads(row["options_json"]),
        "status": row["status"],
        "manifest_path": row["manifest_path"],
        "report_path": row["report_path"],
        "created_at": row["created_at"],
        "finished_at": row["finished_at"],
    }


def _run_export(export_id: str) -> None:
    failed = 0
    with db.db() as conn:
        items = conn.execute("SELECT * FROM export_items WHERE export_id=? ORDER BY id", (export_id,)).fetchall()
    for item in items:
        try:
            _copy_one(item["source_path"], item["dest_path"])
            status, error, size = "done", None, os.path.getsize(item["dest_path"])
        except Exception as exc:
            status, error, size = "failed", str(exc)[:300], None
            failed += 1
        with db.db() as conn:
            conn.execute(
                "UPDATE export_items SET status=?, error=?, verified_size=?, attempts=attempts+1 WHERE id=?",
                (status, error, size, item["id"]),
            )
    with db.db() as conn:
        export = conn.execute("SELECT * FROM exports WHERE id=?", (export_id,)).fetchone()
    manifest = html = None
    report_error = None
    try:
        manifest = report.write_manifest(export_id, export["dest_root"])
        html = report.write_export_report(export_id, export["dest_root"])
    except Exception as exc:
        report_error = str(exc)[:300]
    with db.db() as conn:
        conn.execute(
            "UPDATE exports SET status=?, manifest_path=?, report_path=?, finished_at=? WHERE id=?",
            ("done" if failed == 0 and not report_error else "done_with_errors",
             manifest, html, db.now(), export_id),
        )


def retry_failed(export_id: str) -> dict:
    retried = 0
    with db.db() as conn:
        items = conn.execute(
            "SELECT * FROM export_items WHERE export_id=? AND status='failed'", (export_id,)
        ).fetchall()
    for item in items:
        try:
            _copy_one(item["source_path"], item["dest_path"])
            status, error, size = "done", None, os.path.getsize(item["dest_path"])
        except Exception as exc:
            status, error, size = "failed", str(exc)[:300], None
        with db.db() as conn:
            conn.execute(
                "UPDATE export_items SET status=?, error=?, verified_size=?, attempts=attempts+1 WHERE id=?",
                (status, error, size, item["id"]),
            )
        retried += 1
    with db.db() as conn:
        remaining = conn.execute(
            "SELECT COUNT(*) AS n FROM export_items WHERE export_id=? AND status='failed'", (export_id,)
        ).fetchone()["n"]
        conn.execute("UPDATE exports SET status=? WHERE id=?",
                     ("done" if remaining == 0 else "done_with_errors", export_id))
    return {"retried": retried, "remaining_failed": remaining}


def get_export(export_id: str) -> dict | None:
    with db.db() as conn:
        row = conn.execute("SELECT * FROM exports WHERE id=?", (export_id,)).fetchone()
        if not row:
            return None
        data = _export_dict(row)
        items = conn.execute(
            "SELECT status, COUNT(*) AS n FROM export_items WHERE export_id=? GROUP BY status", (export_id,)
        ).fetchall()
        data["item_counts"] = {item["status"]: item["n"] for item in items}
        data["total_items"] = sum(item["n"] for item in items)
        data["bytes_total"] = int((data.get("options") or {}).get("bytes") or 0)
        size_row = conn.execute(
            "SELECT COALESCE(SUM(verified_size), 0) AS n FROM export_items WHERE export_id=? AND status='done'",
            (export_id,),
        ).fetchone()
        data["bytes_done"] = int(size_row["n"] or 0)
        data["failed_items"] = [
            {"source_path": item["source_path"], "dest_path": item["dest_path"], "error": item["error"]}
            for item in conn.execute(
                "SELECT * FROM export_items WHERE export_id=? AND status='failed' LIMIT 20", (export_id,)
            )
        ]
        return data


def exported_path(conn, photo_id: str) -> str | None:
    """最近一次已成功导出的副本路径；源卡拔出后照片仍可读取这里。"""
    row = conn.execute(
        "SELECT ei.dest_path FROM export_items ei JOIN exports e ON e.id=ei.export_id "
        "WHERE ei.photo_id=? AND ei.status='done' ORDER BY e.created_at DESC LIMIT 1",
        (photo_id,),
    ).fetchone()
    return row["dest_path"] if row else None


def resolve_photo_path(conn, photo_id: str, root_path: str, rel_path: str) -> str:
    source_path = os.path.join(root_path, rel_path)
    if os.path.exists(source_path):
        return source_path
    return exported_path(conn, photo_id) or source_path
