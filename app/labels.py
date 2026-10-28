"""必备画面 / 环节标签。"""
from __future__ import annotations

import uuid

from . import db


def list_labels(activity_id: str) -> list[dict]:
    with db.db() as conn:
        rows = conn.execute(
            "SELECT l.*, "
            "(SELECT COUNT(*) FROM photo_labels pl JOIN decisions d ON d.photo_id=pl.photo_id "
            " WHERE pl.label_id=l.id AND d.verdict='keep') AS kept_count "
            "FROM labels l WHERE l.activity_id=? ORDER BY l.order_index, l.name",
            (activity_id,),
        ).fetchall()
    return [{"id": row["id"], "name": row["name"], "order_index": row["order_index"],
             "na_reason": row["na_reason"], "kept_count": row["kept_count"]} for row in rows]


def add_label(activity_id: str, name: str) -> dict:
    name = (name or "").strip()
    if not name:
        raise ValueError("画面名称不能为空")
    with db.db() as conn:
        exists = conn.execute(
            "SELECT id FROM labels WHERE activity_id=? AND name=?", (activity_id, name)
        ).fetchone()
        if exists:
            raise ValueError("已存在同名画面")
        order = conn.execute(
            "SELECT COALESCE(MAX(order_index), -1) + 1 AS n FROM labels WHERE activity_id=?", (activity_id,)
        ).fetchone()["n"]
        label_id = uuid.uuid4().hex
        conn.execute(
            "INSERT INTO labels(id, activity_id, kind, name, order_index) VALUES (?,?, 'required_shot', ?, ?)",
            (label_id, activity_id, name, order),
        )
    return {"id": label_id, "name": name, "order_index": order, "na_reason": None, "kept_count": 0}


def update_label(label_id: str, name: str | None = None, na_reason: str | None = None) -> dict:
    with db.db() as conn:
        row = conn.execute("SELECT * FROM labels WHERE id=?", (label_id,)).fetchone()
        if not row:
            raise ValueError("画面不存在")
        new_name = (name or "").strip() if name is not None else row["name"]
        if not new_name:
            raise ValueError("画面名称不能为空")
        reason = (na_reason.strip() or None) if isinstance(na_reason, str) else row["na_reason"]
        conn.execute("UPDATE labels SET name=?, na_reason=? WHERE id=?", (new_name, reason, label_id))
    return {"id": label_id, "name": new_name, "na_reason": reason}


def delete_label(label_id: str) -> dict:
    with db.db() as conn:
        conn.execute("DELETE FROM labels WHERE id=?", (label_id,))
    return {"ok": True}


def set_photo_labels(photo_id: str, label_ids: list[str]) -> dict:
    with db.db() as conn:
        activity = conn.execute("SELECT activity_id FROM photos WHERE id=?", (photo_id,)).fetchone()
        if not activity:
            raise ValueError("照片不存在")
        valid = {
            row["id"] for row in conn.execute(
                "SELECT id FROM labels WHERE activity_id=?", (activity["activity_id"],)
            )
        }
        chosen = [label_id for label_id in label_ids if label_id in valid]
        conn.execute("DELETE FROM photo_labels WHERE photo_id=?", (photo_id,))
        conn.executemany(
            "INSERT INTO photo_labels(photo_id, label_id, created_at) VALUES (?,?,?)",
            [(photo_id, label_id, db.now()) for label_id in chosen],
        )
    return {"ok": True, "label_ids": chosen}
