"""连拍/近似照片精简：按拍摄时间 + 感知哈希分组，每组保留若干张最佳。

设计原则：
- 只处理成组（>=3 个照片对象）的连拍，不碰普通单张；
- RAW+JPG 配对按一个“照片对象”处理；
- 只自动改“未决”的结论，人工已经决定的绝不被覆盖；
- 每次精简都记录前一结论，支持一键撤销。
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime

import numpy as np
from PIL import Image, ImageDraw

from . import config, db, faces, scene_embeddings

TIME_GAP_SECONDS = 6.0      # 仅保留给旧配置说明；分组不再用时间硬门槛
SCENE_SIMILARITY = 0.78     # CLIP 余弦相似度；同场同构图通常 0.86+
SCENE_SIMILARITY_NO_FACE = 0.82  # 没人脸时更保守
SCENE_SIMILARITY_ONE_FACE = 0.90 # 一侧没检出脸时，避免把不同领导并组
FACE_SIMILARITY = 0.30      # SFace 余弦
HASH_DISTANCE = 24          # CLIP 不可用时的旧 dHash 回退
ENVIRONMENT_DISTANCE = 28
PERSON_DISTANCE = 16
MIN_GROUP_SIZE = 2
DEFAULT_KEEP = 1            # 每组只保留最好的 1 张

_FEATURE_CACHE: dict[tuple[str, float], dict] = {}


def _parse_time(value) -> datetime | None:
    if not value:
        return None
    text = str(value).strip()
    # EXIF 格式：2026:10:20 12:34:56
    if len(text) >= 19 and text[4] == ":" and text[7] == ":":
        text = text[:4] + "-" + text[5:7] + "-" + text[8:]
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def _hamming(a: int, b: int) -> int:
    return bin(a ^ b).count("1")


def _dhash(image: Image.Image, size: int = 8) -> int:
    """9x8 dHash；size 参数保留，方便以后换 16x16。"""
    small = image.convert("L").resize((9, size), Image.Resampling.LANCZOS)
    pixels = list(small.get_flattened_data()) if hasattr(small, "get_flattened_data") else list(small.getdata())
    bits = 0
    for y in range(size):
        row = y * 9
        for x in range(8):
            bits = (bits << 1) | (1 if pixels[row + x] > pixels[row + x + 1] else 0)
    return bits


def _features(activity_id: str, photo_ids: list[str]) -> dict | None:
    """Compute local features once per thumbnail.

    - composition: whole-frame dHash
    - environment: dHash after masking the center subject area
    - person: center-region dHash plus an SFace embedding when a face exists
    - sharpness: Laplacian variance for ranking
    """
    path = None
    for photo_id in photo_ids:
        candidate = config.thumb_path(activity_id, photo_id)
        if os.path.exists(candidate):
            path = candidate
            break
    if not path:
        return None
    stat = os.stat(path)
    cache_key = (path, stat.st_mtime)
    if cache_key in _FEATURE_CACHE:
        return _FEATURE_CACHE[cache_key]
    try:
        with Image.open(path) as opened:
            rgb = opened.convert("RGB")
            gray = rgb.convert("L")
            composition = _dhash(gray)
            width, height = gray.size
            left, right = int(width * .20), int(width * .80)
            top, bottom = int(height * .08), int(height * .96)
            person = _dhash(gray.crop((left, top, right, bottom)))
            masked = gray.copy()
            draw = ImageDraw.Draw(masked)
            mean = int(sum(masked.getdata()) / max(1, width * height))
            draw.rectangle((left, top, right, bottom), fill=mean)
            environment = _dhash(masked)
            arr = np.asarray(gray, dtype=np.float32)
            if arr.shape[0] >= 3 and arr.shape[1] >= 3:
                lap = (-4.0 * arr[1:-1, 1:-1] + arr[:-2, 1:-1] + arr[2:, 1:-1]
                       + arr[1:-1, :-2] + arr[1:-1, 2:])
                sharpness = float(lap.var())
            else:
                sharpness = 0.0
            face_set = faces.embeddings(path)
            face = face_set[0] if face_set else None
            scene = scene_embeddings.embedding(path)
    except Exception:
        return None
    feature = {"composition": composition, "environment": environment,
               "person": person, "sharpness": sharpness, "face": face,
               "faces": face_set, "scene": scene}
    _FEATURE_CACHE[cache_key] = feature
    return feature


def _pair_similar(first: dict, second: dict) -> bool:
    """同一组要求：场景/构图向量相近 + 人物一致（有人脸时）。"""
    scene_a, scene_b = first.get("scene"), second.get("scene")
    face_a, face_b = first.get("face"), second.get("face")
    faces_a, faces_b = first.get("faces") or ([face_a] if face_a is not None else []), \
        second.get("faces") or ([face_b] if face_b is not None else [])
    scene_score = scene_embeddings.similarity(scene_a, scene_b)
    if scene_score is not None:
        if scene_score < SCENE_SIMILARITY:
            return False
        if faces_a and faces_b:
            score = faces.similarity_sets(faces_a, faces_b)
            return score is not None and score >= FACE_SIMILARITY
        if not faces_a and not faces_b:
            return (scene_score >= SCENE_SIMILARITY_NO_FACE
                    and _hamming(first["person"], second["person"]) <= PERSON_DISTANCE)
        # 一侧没检出脸：只有极相似的场景才允许并组，避免不同领导。
        return scene_score >= SCENE_SIMILARITY_ONE_FACE and _hamming(first["person"], second["person"]) <= 10
    # CLIP 模型不可用：回退到旧 dHash 规则。
    if _hamming(first["composition"], second["composition"]) > HASH_DISTANCE:
        return False
    if _hamming(first["environment"], second["environment"]) > ENVIRONMENT_DISTANCE:
        return False
    if face_a is not None and face_b is not None:
        score = faces.similarity(face_a, face_b)
        return score is not None and score >= FACE_SIMILARITY
    if face_a is None and face_b is None:
        return _hamming(first["person"], second["person"]) <= PERSON_DISTANCE
    return False



def _load_objects(activity_id: str, progress=None) -> list[dict]:
    with db.db() as conn:
        rows = conn.execute(
            "SELECT p.*, s.label AS source_label, "
            "COALESCE(d.verdict, 'undecided') AS verdict, COALESCE(d.important, 0) AS important "
            "FROM photos p JOIN sources s ON s.id=p.source_id "
            "LEFT JOIN decisions d ON d.photo_id=p.id "
            "WHERE p.activity_id=? AND p.preview_state IN ('ok','degraded') "
            "ORDER BY p.source_id, p.capture_time, p.file_name COLLATE NOCASE",
            (activity_id,),
        ).fetchall()
        check_rows = conn.execute(
            "SELECT c.photo_id, c.check_type, c.result FROM checks c "
            "JOIN photos p ON p.id=c.photo_id WHERE p.activity_id=? AND c.status='done'",
            (activity_id,),
        ).fetchall()
    checks: dict[str, dict] = {}
    for row in check_rows:
        checks.setdefault(row["photo_id"], {})[row["check_type"]] = row["result"]

    grouped: dict[str, list] = {}
    for row in rows:
        grouped.setdefault(row["pair_id"] or row["id"], []).append(row)

    objects = []
    total = len(grouped)
    for index, (key, members) in enumerate(grouped.items(), 1):
        rep = next((row for row in members if row["form"] == "jpeg" and row["capture_time"]), None)
        rep = rep or next((row for row in members if row["form"] == "jpeg"), None) or members[0]
        time_value = None
        for row in members:
            time_value = _parse_time(row["capture_time"])
            if time_value:
                break
        if not time_value:
            for row in members:
                time_value = _parse_time(row["mtime"])
                if time_value:
                    break
        feature = _features(activity_id, [row["id"] for row in members])
        if feature is None:
            continue
        objects.append({
            "key": key,
            "source_id": rep["source_id"],
            "file_name": rep["file_name"],
            "time": time_value,
            "hash": feature["composition"],
            "composition": feature["composition"],
            "environment": feature["environment"],
            "person": feature["person"],
            "face": feature["face"],
            "faces": feature.get("faces") or [],
            "scene": feature.get("scene"),
            "sharpness": feature["sharpness"],
            "photos": [row["id"] for row in members],
            "verdict": rep["verdict"],
            "important": bool(rep["important"]),
            "checks": checks.get(rep["id"], {}),
            "ai_suggestion": rep["ai_suggestion"],
            "ai_issue_count": rep["ai_issue_count"] or 0,
        })
        if progress:
            try:
                progress(index, total)
            except Exception:
                pass
    return objects


CHECK_BONUS = {
    "focus": {"ok": 3.0, "suspect": -4.0},
    "closed_eye": {"ok": 1.5, "suspect": -2.5},
    "exposure": {"ok": 0.7, "suspect": -1.5},
    "occlusion": {"ok": 0.5, "suspect": -1.0},
    "composition": {"ok": 0.5, "suspect": -0.5},
}
AI_BONUS = {"keep": 2.0, "uncertain": 0.4, "reject": -2.5}


def _rank_group(group: list[dict]) -> None:
    sharp_values = [item["sharpness"] for item in group]
    low, high = min(sharp_values), max(sharp_values)
    for item in group:
        sharp = 0.5 if high - low < 1e-6 else (item["sharpness"] - low) / (high - low)
        score = sharp * 4.0
        for check, weights in CHECK_BONUS.items():
            result = item["checks"].get(check)
            score += weights.get(result, 0.0)
        score += AI_BONUS.get(item["ai_suggestion"], 0.0)
        score -= (item["ai_issue_count"] or 0) * 0.3
        if item["important"]:
            score += 8.0
        if item["verdict"] == "keep":
            score += 8.0
        elif item["verdict"] == "reject":
            score -= 8.0
        item["score"] = round(score, 3)
    ordered = sorted(group, key=lambda item: (
        -item["score"], item["time"] or datetime.max, item["file_name"].lower()
    ))
    for index, item in enumerate(ordered, 1):
        item["rank"] = index


def _detect(activity_id: str, progress=None) -> list[list[dict]]:
    objects = _load_objects(activity_id, progress=progress)
    objects.sort(key=lambda item: (
        item["source_id"], item["time"] or datetime.max, item["file_name"].lower()
    ))
    groups: list[list[dict]] = []
    current: list[dict] = []
    for item in objects:
        if not current:
            current = [item]
            continue
        previous = current[-1]
        same_source = item["source_id"] == current[0]["source_id"]
        # 拍摄时间只用于排序；不再用时间间隔卡分组。
        # 用户要的是人物/环境/构图相似，很多连拍会隔十几秒甚至几分钟。
        similar = _pair_similar(item, previous)
        # 同时和组首比较，避免“A≈B、B≈C”一路链到另一个场景；
        # 人脸集合比较已经能处理多人合影中最大脸不是同一个人的情况。
        similar_to_first = _pair_similar(item, current[0])
        if same_source and similar and similar_to_first:
            current.append(item)
        else:
            if len(current) >= MIN_GROUP_SIZE:
                groups.append(current)
            current = [item]
    if len(current) >= MIN_GROUP_SIZE:
        groups.append(current)
    for group in groups:
        _rank_group(group)
    return groups


def screening_representatives(activity_id: str, photo_ids: list[str], per_group: int = 3) -> tuple[list[str], list[str]]:
    """Return (photos to send to AI, burst members intentionally skipped).

    Burst groups are detected with the same local dHash + capture-time pass as
    dedupe.  Only the top N ranked frames of each group are sent to the model;
    unrelated singles are always included.  RAW+JPG pairs count as one object.
    This is a local prefilter: it never writes decisions and never calls the API.
    """
    if not photo_ids:
        return [], []
    wanted = set(photo_ids)
    selected: set[str] = set()
    skipped: set[str] = set()
    grouped: set[str] = set()
    for group in _detect(activity_id):
        members = [pid for item in group for pid in item["photos"]]
        present = [pid for pid in members if pid in wanted]
        if not present:
            continue
        grouped.update(members)
        representatives = {
            pid for item in group if item["rank"] <= per_group for pid in item["photos"]
        }
        selected.update(pid for pid in present if pid in representatives)
        skipped.update(pid for pid in present if pid not in representatives)
    selected.update(pid for pid in wanted if pid not in grouped)
    ordered = [pid for pid in photo_ids if pid in selected]
    skipped_ordered = [pid for pid in photo_ids if pid in skipped]
    return ordered, skipped_ordered



def _run_options() -> dict:
    return {
        "time_gap_seconds": TIME_GAP_SECONDS,
        "hash_distance": HASH_DISTANCE,
        "min_group_size": MIN_GROUP_SIZE,
        "keep_per_group": DEFAULT_KEEP,
    }


def _latest_run(activity_id: str):
    with db.db() as conn:
        return conn.execute(
            "SELECT * FROM dedupe_runs WHERE activity_id=? ORDER BY created_at DESC LIMIT 1",
            (activity_id,),
        ).fetchone()


def status(activity_id: str) -> dict:
    run = _latest_run(activity_id)
    if not run:
        return {"applied": False, "run": None}
    return {
        "applied": run["status"] == "applied",
        "run": {
            "id": run["id"],
            "status": run["status"],
            "groups": run["groups"],
            "kept_count": run["kept_count"],
            "rejected_count": run["rejected_count"],
            "options": json.loads(run["options_json"] or "{}"),
            "created_at": run["created_at"],
            "undone_at": run["undone_at"],
        },
    }


def preview(activity_id: str, keep_per_group: int = DEFAULT_KEEP) -> dict:
    groups = _detect(activity_id)
    keep_per_group = max(1, min(int(keep_per_group), 9))
    details = []
    kept_photos = rejected_photos = 0
    for index, group in enumerate(groups):
        kept = [item for item in group if item["rank"] <= keep_per_group]
        rejected = [item for item in group if item["rank"] > keep_per_group]
        kept_photos += sum(len(item["photos"]) for item in kept)
        rejected_photos += sum(len(item["photos"]) for item in rejected)
        if len(details) < 50:
            details.append({
                "key": f"group-{index + 1}",
                "count": len(group),
                "kept": [{
                    "id": item["photos"][0],
                    "file_name": item["file_name"],
                    "score": item["score"],
                    "rank": item["rank"],
                    "thumb": f"/api/photos/{item['photos'][0]}/file?kind=grid",
                } for item in kept],
                "duplicates": [{
                    "id": item["photos"][0],
                    "file_name": item["file_name"],
                    "score": item["score"],
                } for item in rejected],
                "kept_count": len(kept),
                "rejected_count": len(rejected),
            })
    object_count = sum(len(group) for group in groups)
    kept_objects = sum(1 for group in groups for item in group if item["rank"] <= keep_per_group)
    return {
        "group_count": len(groups),
        "object_count": object_count,
        "kept_objects": kept_objects,
        "rejected_objects": object_count - kept_objects,
        "keep_per_group": keep_per_group,
        "kept_photos": kept_photos,
        "rejected_photos": rejected_photos,
        "groups": details,
        "thresholds": _run_options(),
    }


def apply(activity_id: str, keep_per_group: int = DEFAULT_KEEP) -> dict:
    keep_per_group = max(1, min(int(keep_per_group), 9))
    current = _latest_run(activity_id)
    if current and current["status"] == "applied":
        undo(activity_id)

    groups = _detect(activity_id)
    if not groups:
        raise ValueError("没有发现可精简的连拍组（至少 3 个对象相似才会成组）")

    run_id = uuid.uuid4().hex
    now = db.now()
    changed = kept_photos = rejected_photos = 0
    kept_objects = rejected_objects = 0
    with db.db() as conn:
        decisions = {
            row["photo_id"]: row for row in conn.execute(
                "SELECT photo_id, verdict, important FROM decisions WHERE activity_id=?",
                (activity_id,),
            )
        }
        conn.execute(
            "INSERT INTO dedupe_runs(id, activity_id, status, groups, kept_count, rejected_count, "
            "options_json, created_at) VALUES (?,?, 'applied', 0, 0, 0, ?, ?)",
            (run_id, activity_id, json.dumps(_run_options(), ensure_ascii=False), now),
        )
        for index, group in enumerate(groups):
            group_key = f"group-{index + 1}"
            kept_objects += sum(1 for item in group if item["rank"] <= keep_per_group)
            rejected_objects += sum(1 for item in group if item["rank"] > keep_per_group)
            for item in group:
                new_verdict = "keep" if item["rank"] <= keep_per_group else "reject"
                for photo_id in item["photos"]:
                    decision = decisions.get(photo_id)
                    if decision is None:
                        old_verdict, important = "undecided", 0
                    else:
                        old_verdict, important = decision["verdict"], decision["important"]
                    if old_verdict != "undecided":
                        continue
                    if new_verdict == "reject" and important:
                        continue
                    before = json.dumps({"verdict": old_verdict, "important": bool(important)}, ensure_ascii=False)
                    after = json.dumps({"verdict": new_verdict, "important": bool(important)}, ensure_ascii=False)
                    conn.execute(
                        "INSERT INTO decisions(photo_id, activity_id, verdict, important, updated_at) "
                        "VALUES (?,?,?,?,?) ON CONFLICT(photo_id) DO UPDATE SET "
                        "verdict=excluded.verdict, updated_at=excluded.updated_at, origin='manual'",
                        (photo_id, activity_id, new_verdict, important, now),
                    )
                    conn.execute(
                        "INSERT INTO decision_events(photo_id, before_json, after_json, at) VALUES (?,?,?,?)",
                        (photo_id, before, after, now),
                    )
                    conn.execute(
                        "INSERT OR REPLACE INTO dedupe_items(run_id, photo_id, group_key, rank, score, "
                        "prev_verdict, new_verdict) VALUES (?,?,?,?,?,?,?)",
                        (run_id, photo_id, group_key, item["rank"], item["score"], old_verdict, new_verdict),
                    )
                    changed += 1
                    if new_verdict == "keep":
                        kept_photos += 1
                    else:
                        rejected_photos += 1
                conn.execute(
                    "UPDATE photos SET burst_group=?, burst_rank=?, burst_score=? WHERE id IN (%s)"
                    % ",".join("?" for _ in item["photos"]),
                    (group_key, item["rank"], item["score"], *item["photos"]),
                )
        conn.execute(
            "UPDATE dedupe_runs SET groups=?, kept_count=?, rejected_count=?, options_json=? WHERE id=?",
            (len(groups), kept_photos, rejected_photos,
             json.dumps({**_run_options(), "keep_per_group": keep_per_group,
                         "kept_objects": kept_objects, "rejected_objects": rejected_objects},
                        ensure_ascii=False), run_id),
        )
    return {
        "run_id": run_id,
        "groups": len(groups),
        "changed": changed,
        "kept_photos": kept_photos,
        "rejected_photos": rejected_photos,
        "kept_objects": kept_objects,
        "rejected_objects": rejected_objects,
        "keep_per_group": keep_per_group,
    }


def undo(activity_id: str) -> dict:
    run = _latest_run(activity_id)
    if not run or run["status"] != "applied":
        raise ValueError("没有可撤销的连拍精简")
    restored = 0
    now = db.now()
    with db.db() as conn:
        items = conn.execute(
            "SELECT photo_id, prev_verdict, new_verdict FROM dedupe_items WHERE run_id=?",
            (run["id"],),
        ).fetchall()
        for item in items:
            decision = conn.execute(
                "SELECT verdict FROM decisions WHERE photo_id=?", (item["photo_id"],)
            ).fetchone()
            if not decision or decision["verdict"] != item["new_verdict"]:
                continue
            prev = item["prev_verdict"] or "undecided"
            conn.execute(
                "UPDATE decisions SET verdict=?, updated_at=?, origin='manual' WHERE photo_id=?",
                (prev, now, item["photo_id"]),
            )
            conn.execute(
                "INSERT INTO decision_events(photo_id, before_json, after_json, at) VALUES (?,?,?,?)",
                (item["photo_id"],
                 json.dumps({"verdict": item["new_verdict"]}, ensure_ascii=False),
                 json.dumps({"verdict": prev}, ensure_ascii=False), now),
            )
            restored += 1
        conn.execute(
            "UPDATE photos SET burst_group=NULL, burst_rank=NULL, burst_score=NULL WHERE activity_id=?",
            (activity_id,),
        )
        conn.execute(
            "UPDATE dedupe_runs SET status='undone', undone_at=? WHERE id=?",
            (now, run["id"]),
        )
    return {"restored": restored}


def auto_apply(activity_id: str, reason: str = "auto") -> dict | None:
    """自动流程调用：导入完成 / AI 全量分析完成后执行一次精简。

    没有连拍组、或精简失败都不影响主任务；只记录事件，绝不抛出。
    """
    try:
        result = apply(activity_id, DEFAULT_KEEP)
    except ValueError:
        return None
    except Exception as exc:  # 自动任务必须吞掉异常，避免把导入/分析标记为失败
        try:
            db.log_event(activity_id, "dedupe_auto_failed", None, str(exc)[:300])
        except Exception:
            pass
        return None
    try:
        db.log_event(activity_id, "dedupe_auto", None,
                     json.dumps({"reason": reason, **result}, ensure_ascii=False))
    except Exception:
        pass
    return result


