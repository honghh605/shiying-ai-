"""本地 HTTP 接口。"""
from __future__ import annotations

import json
import os

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import (
    activities, agent, analysis, batchops, config, db, dedupe, exporter, fsbrowse, importer, labels, picker_thumbs,
    preferences, previews, report, review, settings_store, wallpapers,
)

app = FastAPI(title=config.APP_DISPLAY_NAME, version=config.VERSION)
app.mount("/static", StaticFiles(directory=config.web_dir()), name="static")

@app.middleware("http")
async def _web_assets_cache(request, call_next):
    response = await call_next(request)
    path = request.url.path
    if path == "/":
        # 入口页必须回源，才能拿到带新版本号的静态资源地址。
        response.headers["Cache-Control"] = "no-cache, must-revalidate"
    elif path.startswith("/static/"):
        # 资源地址带构建版本号；恢复缓存，避免每次切页重新下载/解析所有玻璃样式。
        response.headers["Cache-Control"] = "public, max-age=86400"
    return response


@app.on_event("startup")
def _startup() -> None:
    db.init_db()
    analysis.recover_interrupted()


@app.middleware("http")
async def _local_only(request: Request, call_next):
    host = request.headers.get("host", "").split(":")[0].lower()
    if host not in {"127.0.0.1", "localhost"}:
        return JSONResponse({"detail": "仅允许本机访问"}, status_code=403)
    return await call_next(request)


@app.exception_handler(ValueError)
async def _value_error(_request: Request, exc: ValueError):
    return JSONResponse({"detail": str(exc)}, status_code=400)


class ActivityCreate(BaseModel):
    name: str
    kind: str = "custom"
    budget_limit_cny: float | None = None


class ActivityPatch(BaseModel):
    name: str | None = None
    kind: str | None = None
    budget_limit_cny: float | None = None
    note: str | None = None
    stage: str | None = None
    rule: dict | None = None


class ImportRequest(BaseModel):
    paths: list[str]
    auto_dedupe: bool = False


class DecisionRequest(BaseModel):
    verdict: str | None = None
    important: bool | None = None
    note: str | None = None


class BatchDecisionRequest(BaseModel):
    photo_ids: list[str]
    verdict: str


class AgentMessage(BaseModel):
    role: str
    content: str


class AgentContext(BaseModel):
    view: str = ""
    activity_id: str | None = None
    activity_name: str | None = None
    photo_id: str | None = None
    category: str | None = None
    reference_image: str | None = None
    reference_name: str | None = None
    permissions: dict | None = None


class AgentChatRequest(BaseModel):
    messages: list[AgentMessage]
    context: AgentContext | None = None


class AgentReferenceRequest(BaseModel):
    name: str = "reference.jpg"
    data: str


class WallpaperPayload(BaseModel):
    name: str = "wallpaper.jpg"
    data: str


class WallpaperApply(BaseModel):
    id: str


class LabelCreate(BaseModel):
    name: str


class LabelPatch(BaseModel):
    name: str | None = None
    na_reason: str | None = None


class PhotoLabels(BaseModel):
    label_ids: list[str]


class ExportPlanRequest(BaseModel):
    dest_root: str
    pair_mode: str = "both"
    keep_source_subdir: bool = True
    scope: str = "keep"


class OriginalsDeleteRequest(BaseModel):
    source_id: str
    scope: str = "keep"


class DedupeOptions(BaseModel):
    keep_per_group: int = 2


class ScreeningKeyAdd(BaseModel):
    key: str


class SettingsPatch(BaseModel):
    screening_concurrency: int | None = None
    api_key: str | None = None
    model: str | None = None
    quick_model: str | None = None
    base_url: str | None = None
    price_input_cny_per_m: float | None = None
    price_output_cny_per_m: float | None = None
    estimate_image_tokens: int | None = None
    estimate_prompt_tokens: int | None = None
    max_output_tokens: int | None = None
    clear_api_key: bool = False


class AnalysisStart(BaseModel):
    limit: int = 0
    auto_dedupe: bool = False


class OpenPath(BaseModel):
    path: str


class MakeDirRequest(BaseModel):
    parent: str
    name: str



class PreferencesRequest(BaseModel):
    preferences: dict = {}


@app.get("/api/preferences")
def preferences_get():
    return {"preferences": preferences.read()}


@app.put("/api/preferences")
def preferences_put(body: PreferencesRequest):
    return {"preferences": preferences.update(body.preferences)}


# ---------- 页面 ----------

@app.get("/", response_class=HTMLResponse)
def index():
    path = os.path.join(config.web_dir(), "index.html")
    if not os.path.exists(path):
        raise HTTPException(500, "界面文件缺失")
    return FileResponse(path)


@app.get("/api/health")
def health():
    return {"ok": True, "version": config.VERSION, "data_dir": config.data_dir()}


# ---------- 活动 ----------

@app.get("/api/activities")
def activities_list():
    return activities.list_activities()


@app.post("/api/activities")
def activities_create(body: ActivityCreate):
    return activities.create_activity(body.name, body.kind, body.budget_limit_cny)


@app.get("/api/activities/{activity_id}")
def activity_detail(activity_id: str):
    activity = activities.get_activity(activity_id)
    if not activity:
        raise HTTPException(404, "活动不存在")
    return activity


@app.patch("/api/activities/{activity_id}")
def activity_patch(activity_id: str, body: ActivityPatch):
    return activities.update_activity(activity_id, body.model_dump(exclude_none=True))


@app.delete("/api/activities/{activity_id}")
def activities_delete(activity_id: str):
    return activities.delete_activity(activity_id)


@app.post("/api/activities/{activity_id}/import")
def activity_import(activity_id: str, body: ImportRequest):
    if not body.paths:
        raise ValueError("请先选择要导入的文件夹")
    if not activities.get_activity(activity_id):
        raise HTTPException(404, "活动不存在")
    return {"job_id": importer.start_import_job(activity_id, body.paths, body.auto_dedupe)}


# ---------- 任务 ----------

@app.get("/api/jobs/{job_id}")
def job_detail(job_id: str):
    with db.db() as conn:
        row = conn.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
    if not row:
        raise HTTPException(404, "任务不存在")
    return {
        "id": row["id"],
        "activity_id": row["activity_id"],
        "kind": row["kind"],
        "status": row["status"],
        "total": row["total"],
        "done_count": row["done_count"],
        "failed_count": row["failed_count"],
        "error": row["error"],
        "result": json.loads(row["result_json"]) if row["result_json"] else None,
    }


@app.post("/api/jobs/{job_id}/cancel")
def job_cancel(job_id: str):
    with db.db() as conn:
        row = conn.execute("SELECT status FROM jobs WHERE id=?", (job_id,)).fetchone()
        if not row:
            raise HTTPException(404, "任务不存在")
        if row["status"] in ("queued", "running"):
            status = "cancelling" if row["status"] == "running" else "cancelled"
            conn.execute("UPDATE jobs SET status=?, updated_at=? WHERE id=?", (status, db.now(), job_id))
    return {"ok": True}


# ---------- 照片与复核 ----------

@app.get("/api/activities/{activity_id}/photos")
def photos_list(activity_id: str, category: str = "all", source_id: str | None = None,
                q: str | None = None, offset: int = 0, limit: int = 120):
    limit = max(1, min(limit, 300))
    return review.list_photos(activity_id, category, source_id, q, max(0, offset), limit)


@app.get("/api/photos/{photo_id}")
def photo_detail(photo_id: str):
    photo = review.get_photo(photo_id)
    if not photo:
        raise HTTPException(404, "照片不存在")
    return photo


@app.post("/api/photos/{photo_id}/decision")
def photo_decision(photo_id: str, body: DecisionRequest):
    return review.set_decision(photo_id, body.verdict, body.important, body.note)


@app.post("/api/activities/{activity_id}/decisions/batch")
def photos_batch(activity_id: str, body: BatchDecisionRequest):
    return review.batch_decision(activity_id, body.photo_ids, body.verdict)


@app.post("/api/photos/{photo_id}/undo")
def photo_undo(photo_id: str):
    return review.undo(photo_id)


@app.get("/api/photos/{photo_id}/file")
def photo_file(photo_id: str, kind: str = "grid"):
    with db.db() as conn:
        row = conn.execute(
            "SELECT p.*, s.root_path FROM photos p JOIN sources s ON s.id=p.source_id WHERE p.id=?",
            (photo_id,),
        ).fetchone()
    if not row:
        raise HTTPException(404, "照片不存在")
    with db.db() as conn:
        source_path = exporter.resolve_photo_path(conn, photo_id, row["root_path"], row["rel_path"])
    grid = kind != "review"
    dest = (config.thumb_path(row["activity_id"], photo_id) if grid
            else config.review_path(row["activity_id"], photo_id))
    if not os.path.exists(dest):
        ok, note = (previews.build_grid(source_path, row["form"], dest) if grid
                    else previews.build_review(source_path, row["form"], dest))
        if not ok:
            if not grid and row["form"] == "jpeg" and os.path.exists(source_path):
                return FileResponse(source_path)  # JPG 大图生成失败时退回原图
            raise HTTPException(404, f"预览不可用：{note}")
        with db.db() as conn:
            conn.execute(
                "UPDATE photos SET preview_state=?, preview_error=? WHERE id=?",
                ("ok" if not note else "degraded", note, photo_id),
            )
    return FileResponse(dest, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600"})


@app.post("/api/photos/{photo_id}/open")
def photo_open(photo_id: str):
    with db.db() as conn:
        row = conn.execute(
            "SELECT p.rel_path, s.root_path FROM photos p JOIN sources s ON s.id=p.source_id WHERE p.id=?",
            (photo_id,),
        ).fetchone()
    if not row:
        raise HTTPException(404, "照片不存在")
    path = os.path.join(row["root_path"], row["rel_path"])
    if not os.path.exists(path):
        raise HTTPException(404, "原片文件不存在")
    os.startfile(path)  # noqa: S606
    return {"ok": True}



class PhotoBatchExport(BaseModel):
    dest_root: str
    photo_ids: list[str] = []
    category: str | None = None
    source_id: str | None = None


class PhotoBatchDelete(BaseModel):
    mode: str = "app"
    photo_ids: list[str] = []
    category: str | None = None
    source_id: str | None = None


class SingleExport(BaseModel):
    dest_root: str


class SingleDelete(BaseModel):
    mode: str = "app"


@app.post("/api/activities/{activity_id}/photos/export-batch")
def photos_export_batch(activity_id: str, body: PhotoBatchExport):
    return batchops.export_photos(activity_id, body.dest_root, body.photo_ids, body.category, body.source_id)


@app.post("/api/activities/{activity_id}/photos/delete-batch")
def photos_delete_batch(activity_id: str, body: PhotoBatchDelete):
    return batchops.delete_photos(activity_id, body.mode, body.photo_ids, body.category, body.source_id)


@app.post("/api/photos/{photo_id}/export")
def photo_export(photo_id: str, body: SingleExport):
    with db.db() as conn:
        row = conn.execute("SELECT activity_id FROM photos WHERE id=?", (photo_id,)).fetchone()
    if not row:
        raise ValueError("照片不存在")
    return batchops.export_one(row["activity_id"], photo_id, body.dest_root)


@app.post("/api/photos/{photo_id}/delete")
def photo_delete(photo_id: str, body: SingleDelete):
    with db.db() as conn:
        row = conn.execute("SELECT activity_id FROM photos WHERE id=?", (photo_id,)).fetchone()
    if not row:
        raise ValueError("照片不存在")
    return batchops.delete_one(row["activity_id"], photo_id, body.mode)


@app.get("/api/fs/thumb")
def fs_thumb(path: str, size: int = 420):
    try:
        return FileResponse(picker_thumbs.thumbnail(path, size), media_type="image/jpeg")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# ---------- 标签 ----------

@app.get("/api/activities/{activity_id}/labels")
def labels_list(activity_id: str):
    return labels.list_labels(activity_id)


@app.post("/api/activities/{activity_id}/labels")
def labels_add(activity_id: str, body: LabelCreate):
    return labels.add_label(activity_id, body.name)


@app.patch("/api/labels/{label_id}")
def labels_patch(label_id: str, body: LabelPatch):
    return labels.update_label(label_id, body.name, body.na_reason)


@app.delete("/api/labels/{label_id}")
def labels_delete(label_id: str):
    return labels.delete_label(label_id)


@app.put("/api/photos/{photo_id}/labels")
def photo_labels(photo_id: str, body: PhotoLabels):
    return labels.set_photo_labels(photo_id, body.label_ids)


# ---------- 导出 ----------

@app.post("/api/activities/{activity_id}/exports/plan")
def export_plan(activity_id: str, body: ExportPlanRequest):
    return exporter.build_plan(activity_id, body.dest_root, body.pair_mode, body.keep_source_subdir, body.scope)


@app.post("/api/activities/{activity_id}/exports/quick")
def export_quick(activity_id: str, body: ExportPlanRequest):
    return exporter.start_export(activity_id, body.dest_root, body.pair_mode, body.keep_source_subdir, body.scope)


@app.post("/api/activities/{activity_id}/exports")
def export_run(activity_id: str, body: ExportPlanRequest):
    return exporter.execute(activity_id, body.dest_root, body.pair_mode, body.keep_source_subdir, body.scope)


@app.post("/api/activities/{activity_id}/originals/delete")
def originals_delete(activity_id: str, body: OriginalsDeleteRequest):
    return activities.delete_originals(activity_id, body.source_id, body.scope)


@app.get("/api/activities/{activity_id}/dedupe/status")
def dedupe_status(activity_id: str):
    return dedupe.status(activity_id)


@app.get("/api/activities/{activity_id}/dedupe/preview")
def dedupe_preview(activity_id: str):
    return dedupe.preview(activity_id)


@app.post("/api/activities/{activity_id}/dedupe/apply")
def dedupe_apply(activity_id: str, body: DedupeOptions):
    return dedupe.apply(activity_id, body.keep_per_group)


@app.post("/api/activities/{activity_id}/dedupe/undo")
def dedupe_undo(activity_id: str):
    return dedupe.undo(activity_id)


@app.get("/api/exports/{export_id}")
def export_detail(export_id: str):
    data = exporter.get_export(export_id)
    if not data:
        raise HTTPException(404, "导出记录不存在")
    return data


@app.post("/api/exports/{export_id}/retry")
def export_retry(export_id: str):
    return exporter.retry_failed(export_id)


@app.get("/api/exports/{export_id}/manifest")
def export_manifest(export_id: str):
    with db.db() as conn:
        row = conn.execute("SELECT manifest_path FROM exports WHERE id=?", (export_id,)).fetchone()
    if not row or not row["manifest_path"] or not os.path.exists(row["manifest_path"]):
        raise HTTPException(404, "清单尚未生成")
    return FileResponse(row["manifest_path"], filename="选片清单.csv")


@app.get("/api/exports/{export_id}/report", response_class=HTMLResponse)
def export_report(export_id: str):
    with db.db() as conn:
        row = conn.execute("SELECT report_path FROM exports WHERE id=?", (export_id,)).fetchone()
    if not row or not row["report_path"] or not os.path.exists(row["report_path"]):
        raise HTTPException(404, "报告尚未生成")
    return FileResponse(row["report_path"])


@app.get("/api/activities/{activity_id}/report", response_class=HTMLResponse)
def activity_report(activity_id: str):
    _title, body = report.activity_report_html(activity_id)
    return HTMLResponse(body)


# ---------- AI 初筛 ----------

@app.get("/api/activities/{activity_id}/analysis/estimate")
def analysis_estimate(activity_id: str):
    return analysis.estimate(activity_id)


@app.post("/api/activities/{activity_id}/analysis/start")
def analysis_start(activity_id: str, body: AnalysisStart):
    return analysis.start_analysis(activity_id, body.limit, body.auto_dedupe)


@app.post("/api/activities/{activity_id}/analysis/pause")
def analysis_pause(activity_id: str):
    return analysis.pause_analysis(activity_id)


@app.get("/api/activities/{activity_id}/analysis/status")
def analysis_status(activity_id: str, photo_ids: str = ""):
    return analysis.analysis_status(activity_id, photo_ids.split(",")[:300] if photo_ids else [])


@app.post("/api/photos/{photo_id}/analyze")
def photo_analyze(photo_id: str):
    return analysis.analyze_single(photo_id)


@app.get("/api/activities/{activity_id}/costs")
def activity_costs(activity_id: str):
    with db.db() as conn:
        rows = conn.execute(
            "SELECT photo_id, status, cost_cny, usage_reported, input_tokens, output_tokens, "
            "finished_at, error FROM ai_requests WHERE activity_id=? ORDER BY finished_at DESC LIMIT 50",
            (activity_id,),
        ).fetchall()
    return {
        "used_cost": analysis.used_cost(activity_id),
        "requests": [dict(row) for row in rows],
    }


# ---------- 文件系统 / 设置 ----------

@app.get("/api/fs/list")
def fs_list(path: str | None = None, files: bool = False):
    return fsbrowse.list_dir(path, include_files=files)


@app.post("/api/fs/open")
def fs_open(body: OpenPath):
    return fsbrowse.open_in_explorer(body.path)


@app.post("/api/fs/mkdir")
def fs_mkdir(body: MakeDirRequest):
    return fsbrowse.create_dir(body.parent, body.name)


@app.get("/api/wallpapers")
def wallpapers_list():
    return {"items": []}


@app.post("/api/wallpapers/upload")
def wallpaper_upload(body: WallpaperPayload):
    try:
        return wallpapers.save_data_url(body.data, body.name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/wallpapers/system")
def wallpaper_system():
    try:
        return wallpapers.system_wallpaper()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/wallpapers/wallpaper-engine")
def wallpaper_engine_list():
    return wallpapers.scan_wallpaper_engine()


@app.post("/api/wallpapers/wallpaper-engine/apply")
def wallpaper_engine_apply(body: WallpaperApply):
    try:
        return wallpapers.apply_we(body.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/wallpapers/file/{name}")
def wallpaper_file(name: str):
    path = wallpapers.file_path(name)
    if not path:
        raise HTTPException(status_code=404, detail="壁纸不存在")
    return FileResponse(path, media_type="image/jpeg")


@app.get("/api/wallpapers/thumb/{name}")
def wallpaper_thumb(name: str):
    path = wallpapers.thumb_path(name)
    if not path:
        raise HTTPException(status_code=404, detail="壁纸缩略图不存在")
    return FileResponse(path, media_type="image/jpeg")


@app.get("/api/wallpapers/scene/{item_id}/{file_path:path}")
def wallpaper_scene_asset(item_id: str, file_path: str):
    item = wallpapers._ITEMS.get(item_id)
    if not item:
        wallpapers.scan_wallpaper_engine()
        item = wallpapers._ITEMS.get(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Wallpaper Engine 壁纸不存在")
    folder = os.path.realpath(item.get("folder") or "")
    target = os.path.realpath(os.path.join(folder, file_path))
    if not folder or not (target == folder or target.startswith(folder + os.sep)) or not os.path.isfile(target):
        raise HTTPException(status_code=404, detail="场景资源不存在")
    ext = target.rsplit(".", 1)[-1].lower()
    media = {"json": "application/json", "pkg": "application/octet-stream",
             "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
             "webp": "image/webp", "gif": "image/gif", "mp4": "video/mp4",
             "webm": "video/webm", "html": "text/html", "js": "text/javascript",
             "css": "text/css", "ttf": "font/ttf", "woff": "font/woff", "woff2": "font/woff2"}.get(ext, "application/octet-stream")
    return FileResponse(target, media_type=media)


@app.get("/api/wallpapers/video/{name}")
def wallpaper_video(name: str):
    path = wallpapers.video_path(name)
    if not path:
        raise HTTPException(status_code=404, detail="动态壁纸不存在")
    ext = path.rsplit(".", 1)[-1].lower()
    media = {"mp4": "video/mp4", "webm": "video/webm", "mov": "video/quicktime", "mkv": "video/x-matroska"}.get(ext, "application/octet-stream")
    return FileResponse(path, media_type=media)


@app.get("/api/agent/status")
def agent_status():
    data = settings_store.public_settings()
    return {
        "ok": bool(data.get("api_key_set")),
        "api_key_set": bool(data.get("api_key_set")),
        "model": data.get("model"),
        "base_url": data.get("base_url"),
        "version": data.get("version"),
        "suggestions": [
            "总结当前活动",
            "找 AI 建议排除",
            "标记第 1 张保留",
            "打开设置",
        ],
    }


@app.post("/api/agent/chat")
def agent_chat(body: AgentChatRequest):
    history = [{"role": m.role, "content": m.content} for m in body.messages]
    context = body.context.model_dump() if body.context else {}
    try:
        return agent.chat(history, context)
    except agent.AgentError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/agent/reference")
def agent_reference(body: AgentReferenceRequest):
    import base64
    import io
    import os
    import uuid
    from PIL import Image
    raw = body.data or ""
    if "," in raw and raw.lstrip().startswith("data:"):
        raw = raw.split(",", 1)[1]
    try:
        payload = base64.b64decode(raw, validate=True)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="参考图数据无效") from exc
    if len(payload) > 12 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="参考图不能超过 12MB")
    try:
        with Image.open(io.BytesIO(payload)) as image:
            image.verify()
        with Image.open(io.BytesIO(payload)) as image:
            image = image.convert("RGB")
            image.thumbnail((1600, 1600), Image.LANCZOS)
            folder = os.path.join(config.data_dir(), "agent-refs")
            os.makedirs(folder, exist_ok=True)
            path = os.path.join(folder, f"ref-{uuid.uuid4().hex[:12]}.jpg")
            image.save(path, "JPEG", quality=88, optimize=True)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail="无法读取参考图") from exc
    return {"path": path, "name": body.name or os.path.basename(path)}


@app.post("/api/settings/screening-keys")
def screening_key_add(body: ScreeningKeyAdd):
    from . import keychain
    keychain.add_screening_key(body.key)
    return {"items": keychain.screening_keys_public()}


@app.delete("/api/settings/screening-keys/{key_id}")
def screening_key_remove(key_id: str):
    from . import keychain
    keychain.remove_screening_key(key_id)
    return {"items": keychain.screening_keys_public()}


@app.get("/api/settings")
def settings_get():
    return settings_store.public_settings()


@app.put("/api/settings")
def settings_put(body: SettingsPatch):
    if body.clear_api_key:
        from . import keychain
        keychain.clear_api_key()
    if body.api_key is not None and body.api_key.strip():
        from . import keychain
        keychain.save_api_key(body.api_key)
    patch = body.model_dump(exclude_none=True, exclude={"api_key", "clear_api_key"})
    settings_store.save_settings(patch)
    return settings_store.public_settings()
