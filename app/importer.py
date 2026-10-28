"""导入：扫描来源文件夹、读取元数据、RAW/JPG 配对、后台生成缩略图。"""
from __future__ import annotations

import io
import json
import os
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
import uuid
from datetime import datetime

from PIL import Image

from . import config, db, dedupe, previews


# ---------- 扫描 ----------

def _walk(root: str) -> tuple[list[tuple[str, str, str]], list[str]]:
    files: list[tuple[str, str, str]] = []
    errors: list[str] = []

    def on_error(exc: OSError) -> None:
        errors.append(f"{getattr(exc, 'filename', '')}: {exc}")

    for dirpath, dirnames, filenames in os.walk(root, followlinks=False, onerror=on_error):
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        for name in filenames:
            ext = os.path.splitext(name)[1].lower()
            if ext not in config.RAW_EXTS and ext not in config.JPG_EXTS:
                continue
            abs_path = os.path.join(dirpath, name)
            files.append((abs_path, os.path.relpath(abs_path, root), ext))
    return files, errors


def _ratio(value):
    try:
        if hasattr(value, "numerator") and hasattr(value, "denominator") and value.denominator:
            return value.numerator / value.denominator
        return float(value)
    except Exception:
        return None


def _clean(value) -> str | None:
    if not value:
        return None
    text = str(value).split("\x00", 1)[0].strip()
    return text or None


def _camera_fields(img) -> dict:
    data = {"camera_make": None, "camera_model": None, "lens_model": None,
            "iso": None, "aperture": None, "shutter": None,
            "focal_length": None, "exposure_bias": None}
    try:
        exif = img.getexif()
        ifd = {}
        try:
            ifd = exif.get_ifd(0x8769)
        except Exception:
            ifd = {}

        def xget(tag):
            return exif.get(tag) or ifd.get(tag)

        data["camera_make"] = _clean(xget(271))
        data["camera_model"] = _clean(xget(272))
        data["lens_model"] = _clean(xget(42036))
        iso = xget(34855) or xget(34867)
        try:
            data["iso"] = int(iso[0] if isinstance(iso, (tuple, list)) else iso) if iso else None
        except Exception:
            data["iso"] = None
        fnum = _ratio(xget(33437))
        if fnum:
            data["aperture"] = f"f/{fnum:.1f}".rstrip("0").rstrip(".")
        exposure = _ratio(xget(33434))
        if exposure:
            data["shutter"] = f"1/{round(1 / exposure)} s" if exposure < 1 else f"{exposure:g} s"
        focal = _ratio(xget(37386))
        if focal:
            data["focal_length"] = f"{focal:g} mm"
        bias = _ratio(xget(37380))
        if bias is not None:
            data["exposure_bias"] = f"{bias:+.1f} EV"
    except Exception:
        pass
    return data


def _raw_exif_metadata(abs_path: str) -> dict:
    """直接读取 NEF/ARW/CR2 等 RAW 的 TIFF/EXIF，不依赖内嵌 JPEG 预览。"""
    data = {"camera_make": None, "camera_model": None, "lens_model": None,
            "iso": None, "aperture": None, "shutter": None,
            "focal_length": None, "exposure_bias": None, "capture_time": None,
            "orientation": None}
    try:
        import exifread
        with open(abs_path, "rb") as handle:
            tags = exifread.process_file(handle, details=False)

        def text(name):
            tag = tags.get(name)
            return _clean(str(tag)) if tag else None

        def first(name):
            tag = tags.get(name)
            if not tag:
                return None
            values = getattr(tag, "values", None)
            if isinstance(values, (list, tuple)) and values:
                return values[0]
            return tag

        def ratio(name):
            value = first(name)
            if value is None:
                return None
            try:
                return float(value)
            except Exception:
                text_value = str(value)
                if "/" in text_value:
                    try:
                        a, b = text_value.split("/", 1)
                        return float(a) / float(b)
                    except Exception:
                        return None
                try:
                    return float(text_value)
                except Exception:
                    return None

        data["camera_make"] = text("Image Make")
        data["camera_model"] = text("Image Model")
        data["lens_model"] = text("EXIF LensModel") or text("MakerNote LensModel")
        iso = first("EXIF ISOSpeedRatings") or first("EXIF PhotographicSensitivity")
        try:
            data["iso"] = int(iso) if iso is not None else None
        except Exception:
            data["iso"] = None
        fnum = ratio("EXIF FNumber")
        if fnum:
            data["aperture"] = f"f/{fnum:.1f}".rstrip("0").rstrip(".")
        exposure_tag = tags.get("EXIF ExposureTime")
        exposure = ratio("EXIF ExposureTime")
        if exposure_tag is not None:
            raw_exposure = str(exposure_tag).strip()
            if "/" in raw_exposure:
                data["shutter"] = f"{raw_exposure} s"
            elif exposure is not None:
                data["shutter"] = f"1/{round(1 / exposure)} s" if 0 < exposure < 1 else f"{exposure:g} s"
        focal = ratio("EXIF FocalLength")
        if focal:
            data["focal_length"] = f"{focal:g} mm"
        bias = ratio("EXIF ExposureBiasValue")
        if bias is not None:
            data["exposure_bias"] = f"{bias:+.1f} EV"
        data["capture_time"] = text("EXIF DateTimeOriginal") or text("Image DateTime")
        orientation = first("Image Orientation")
        data["orientation"] = orientation
    except Exception:
        pass
    return data


def _read_metadata(abs_path: str, ext: str) -> dict:
    data = {"width": None, "height": None, "capture_time": None, "orientation": None,
            "camera_make": None, "camera_model": None, "lens_model": None,
            "iso": None, "aperture": None, "shutter": None,
            "focal_length": None, "exposure_bias": None}
    if ext in config.JPG_EXTS:
        try:
            with Image.open(abs_path) as img:
                data["width"], data["height"] = img.size
                exif = img.getexif()
                data["orientation"] = exif.get(274)
                capture = exif.get(36867)
                if not capture:
                    try:
                        capture = exif.get_ifd(0x8769).get(36867)
                    except Exception:
                        capture = None
                data["capture_time"] = str(capture) if capture else None
                data.update(_camera_fields(img))
        except Exception:
            pass
    elif ext in config.RAW_EXTS:
        raw_info = _raw_exif_metadata(abs_path)
        data.update(raw_info)
        try:
            import rawpy
            with rawpy.imread(abs_path) as raw:
                data["width"], data["height"] = raw.sizes.width, raw.sizes.height
                thumb = raw.extract_thumb()
            if thumb.format == rawpy.ThumbFormat.JPEG:
                with Image.open(io.BytesIO(thumb.data)) as img:
                    fallback = _camera_fields(img)
                    for key, value in fallback.items():
                        if value and not data.get(key):
                            data[key] = value
                    exif = img.getexif()
                    capture = exif.get(36867)
                    data["capture_time"] = data.get("capture_time") or (str(capture) if capture else None)
                    data["orientation"] = data.get("orientation") or exif.get(274)
        except Exception:
            pass
    return data


def scan_source(activity_id: str, root_path: str, import_job_id: str | None = None) -> dict:
    """扫描一个来源并写入数据库；同一目录重复导入会跳过已有文件。"""
    root = os.path.abspath(root_path)
    walk_errors: list[str] = []
    if os.path.isfile(root):
        ext = os.path.splitext(root)[1].lower()
        if ext not in config.RAW_EXTS and ext not in config.JPG_EXTS:
            raise ValueError(f"不是可识别的照片文件：{root_path}")
        # 单文件导入：来源仍按所在目录归并，rel_path 使用文件名，便于预览和配对
        file_path = root
        root = os.path.dirname(file_path) or file_path
        label = os.path.basename(root) or root
        files = [(file_path, os.path.basename(file_path), ext)]
    elif os.path.isdir(root):
        label = os.path.basename(root.rstrip("\\/")) or root
        files, walk_errors = _walk(root)
    else:
        raise ValueError(f"文件或文件夹不存在：{root_path}")
    if not files:
        return {"root": root, "label": label, "added": 0, "skipped": 0,
                "paired": 0, "errors": walk_errors + ["该文件夹内没有可识别的 RAW/JPG 文件"]}

    with db.db() as conn:
        existing = conn.execute(
            "SELECT id FROM sources WHERE activity_id=? AND root_path=?",
            (activity_id, root),
        ).fetchone()
        if existing:
            source_id = existing["id"]
        else:
            source_id = uuid.uuid4().hex
            conn.execute(
                "INSERT INTO sources(id, activity_id, root_path, label, added_at) VALUES (?,?,?,?,?)",
                (source_id, activity_id, root, label, db.now()),
            )

        known = {
            os.path.normcase(os.path.join(row["root_path"], row["rel_path"]))
            for row in conn.execute(
                "SELECT s.root_path, p.rel_path FROM photos p JOIN sources s ON s.id=p.source_id "
                "WHERE p.activity_id=?",
                (activity_id,),
            )
        }

        rows = []
        added = skipped = 0
        seen = set()
        for abs_path, rel_path, ext in files:
            # macOS 在照片旁生成的 AppleDouble 元数据（._DSC_0001.NEF），不是照片
            if os.path.basename(abs_path).startswith("._"):
                continue
            key = os.path.normcase(abs_path)
            if key in known or key in seen:
                skipped += 1
                continue
            seen.add(key)
            try:
                stat = os.stat(abs_path)
                size_bytes, mtime = stat.st_size, datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds")
            except OSError as exc:
                walk_errors.append(f"{abs_path}: {exc}")
                continue
            meta = _read_metadata(abs_path, ext)
            rows.append((
                uuid.uuid4().hex, activity_id, source_id, rel_path, os.path.basename(abs_path),
                ext, "raw" if ext in config.RAW_EXTS else "jpeg",
                size_bytes, mtime, None, meta["capture_time"],
                meta["camera_make"], meta["camera_model"], meta["lens_model"], meta["iso"],
                meta["aperture"], meta["shutter"], meta["focal_length"], meta["exposure_bias"],
                meta["orientation"], meta["width"], meta["height"], "pending", None, db.now(), import_job_id,
            ))
            added += 1

        if rows:
            conn.executemany(
                "INSERT INTO photos(id, activity_id, source_id, rel_path, file_name, ext, form, "
                "size_bytes, mtime, pair_id, capture_time, camera_make, camera_model, lens_model, iso, "
                "aperture, shutter, focal_length, exposure_bias, orientation, width, height, "
                "preview_state, preview_error, created_at, import_job_id) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                rows,
            )
            conn.executemany(
                "INSERT INTO decisions(photo_id, activity_id, verdict, important, updated_at) "
                "VALUES (?,?, 'undecided', 0, ?)",
                [(row[0], activity_id, db.now()) for row in rows],
            )

        paired = _pair_source(conn, source_id)
        count = conn.execute("SELECT COUNT(*) AS n FROM photos WHERE source_id=?", (source_id,)).fetchone()["n"]
        conn.execute("UPDATE sources SET photo_count=? WHERE id=?", (count, source_id))

    return {"root": root, "label": label, "source_id": source_id, "added": added,
            "skipped": skipped, "paired": paired, "errors": walk_errors}


def _pair_source(conn, source_id: str) -> int:
    """同源、同目录、恰好一 RAW 一 JPG 且同名时配对；其余保持独立。"""
    grouped: dict[tuple[str, str], list] = {}
    for row in conn.execute(
        "SELECT id, rel_path, file_name, form FROM photos WHERE source_id=? AND pair_id IS NULL",
        (source_id,),
    ):
        key = (os.path.dirname(row["rel_path"]).lower(), os.path.splitext(row["file_name"])[0].lower())
        grouped.setdefault(key, []).append(row)

    paired = 0
    for rows in grouped.values():
        if len(rows) != 2:
            continue
        forms = {row["form"] for row in rows}
        if forms != {"raw", "jpeg"}:
            continue
        pair_id = uuid.uuid4().hex
        conn.executemany("UPDATE photos SET pair_id=? WHERE id=?", [(pair_id, row["id"]) for row in rows])
        paired += 1
    return paired


# ---------- 后台任务 ----------

def start_import_job(activity_id: str, paths: list[str], auto_dedupe: bool = False) -> str:
    job_id = uuid.uuid4().hex
    with db.db() as conn:
        conn.execute(
            "INSERT INTO jobs(id, activity_id, kind, status, total, options_json, created_at, updated_at) "
            "VALUES (?,?,'import','queued',0,?,?,?)",
            (job_id, activity_id,
             json.dumps({"paths": paths, "auto_dedupe": auto_dedupe}, ensure_ascii=False), db.now(), db.now()),
        )
    thread = threading.Thread(target=_run_import, args=(job_id, activity_id, paths, auto_dedupe), daemon=True)
    thread.start()
    return job_id


def _set_job(job_id: str, **fields) -> None:
    if not fields:
        return
    fields["updated_at"] = db.now()
    columns = ", ".join(f"{key}=?" for key in fields)
    with db.db() as conn:
        conn.execute(f"UPDATE jobs SET {columns} WHERE id=?", (*fields.values(), job_id))


def _job_cancelled(job_id: str) -> bool:
    with db.db() as conn:
        row = conn.execute("SELECT status FROM jobs WHERE id=?", (job_id,)).fetchone()
    return bool(row) and row["status"] == "cancelling"


def _run_import(job_id: str, activity_id: str, paths: list[str], auto_dedupe: bool = False) -> None:
    try:
        _set_job(job_id, status="running", result_json=json.dumps({"stage": "scanning"}, ensure_ascii=False))
        sources = []
        for path in paths:
            if _job_cancelled(job_id):
                break
            sources.append(scan_source(activity_id, path, job_id))

        with db.db() as conn:
            rows = conn.execute(
                "SELECT p.*, s.root_path FROM photos p JOIN sources s ON s.id=p.source_id "
                "WHERE p.activity_id=? AND p.import_job_id=? AND p.preview_state != 'ok'",
                (activity_id, job_id),
            ).fetchall()
            conn.execute(
                "UPDATE jobs SET total=?, result_json=? WHERE id=?",
                (len(rows), json.dumps({"stage": "previews", "sources": sources}, ensure_ascii=False), job_id),
            )

        done = failed = degraded = 0
        pending_updates = []

        def flush_previews():
            nonlocal pending_updates
            if not pending_updates:
                return
            with db.db() as conn:
                conn.executemany(
                    "UPDATE photos SET preview_state=?, preview_error=?, "
                    "width=COALESCE(width, ?), height=COALESCE(height, ?) WHERE id=?",
                    pending_updates,
                )
            pending_updates = []

        def make_preview(item):
            dest = config.thumb_path(activity_id, item["id"])
            ok, note = previews.build_grid(
                os.path.join(item["root_path"], item["rel_path"]), item["form"], dest
            )
            return item, ok, note

        # 预览生成是导入最慢的一段：并行解码/缩放，主线程批量写库。
        workers = max(2, min(8, os.cpu_count() or 4))
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [pool.submit(make_preview, dict(row)) for row in rows]
            for future in as_completed(futures):
                if _job_cancelled(job_id):
                    for item in futures:
                        item.cancel()
                    break
                item, ok, note = future.result()
                state = "ok"
                if not ok:
                    state, failed = "failed", failed + 1
                elif note:
                    state, degraded = "degraded", degraded + 1
                else:
                    done += 1
                pending_updates.append((state, note, item["width"], item["height"], item["id"]))
                if len(pending_updates) >= 10:
                    flush_previews()
                if (done + failed + degraded) % 5 == 0:
                    _set_job(job_id, done_count=done, failed_count=failed)
            flush_previews()

        status = "cancelled" if _job_cancelled(job_id) else "done"
        # 导入只负责扫描/预览；连拍分组属于“判断”，由 AI 初筛或手动精简触发。
        dedupe_result = None
        summary = {"stage": "finished", "sources": sources, "done": done,
                   "failed": failed, "degraded": degraded,
                   "dedupe": dedupe_result}
        _set_job(job_id, status=status, done_count=done, failed_count=failed,
                 result_json=json.dumps(summary, ensure_ascii=False))
        with db.db() as conn:
            total = conn.execute("SELECT COUNT(*) AS n FROM photos WHERE activity_id=?", (activity_id,)).fetchone()["n"]
            if total:
                conn.execute("UPDATE activities SET stage='review', updated_at=? WHERE id=? AND stage='activity'",
                             (db.now(), activity_id))
        db.log_event(activity_id, "import", job_id, json.dumps(summary, ensure_ascii=False))
    except Exception as exc:
        _set_job(job_id, status="failed", error=str(exc)[:500])




def read_metadata(abs_path: str, ext: str | None = None) -> dict:
    return _read_metadata(abs_path, (ext or os.path.splitext(abs_path)[1]).lower())
