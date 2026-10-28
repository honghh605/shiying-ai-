"""报告与选片清单（HTML / CSV）。"""
from __future__ import annotations

import csv
import html
import os

from . import config, db

VERDICT_NAMES = {"undecided": "待处理", "keep": "保留", "reject": "疑似废片", "uncertain": "待确认"}
FORM_NAMES = {"raw": "RAW", "jpeg": "JPG"}
CHECK_NAMES = {
    "focus": "主体失焦或手抖", "closed_eye": "闭眼或表情不合适", "exposure": "严重过曝或欠曝",
    "occlusion": "主体遮挡或重要部分裁切", "composition": "构图不好或画面杂乱",
}
SUGGESTION_NAMES = {"keep": "建议保留", "reject": "建议排除", "uncertain": "建议待确认"}


def _esc(value) -> str:
    return html.escape("" if value is None else str(value))


def _stats(conn, activity_id: str) -> dict:
    photos = conn.execute(
        "SELECT COUNT(*) AS files, COUNT(DISTINCT pair_id) AS pairs, "
        "SUM(CASE WHEN preview_state='failed' THEN 1 ELSE 0 END) AS unreadable "
        "FROM photos WHERE activity_id=?", (activity_id,)
    ).fetchone()
    files = photos["files"] or 0
    pairs = photos["pairs"] or 0
    verdicts = {row["verdict"]: row["n"] for row in conn.execute(
        "SELECT COALESCE(d.verdict,'undecided') AS verdict, COUNT(*) AS n FROM photos p "
        "LEFT JOIN decisions d ON d.photo_id=p.id WHERE p.activity_id=? GROUP BY 1", (activity_id,)
    )}
    important = conn.execute(
        "SELECT COUNT(*) AS n FROM decisions d JOIN photos p ON p.id=d.photo_id "
        "WHERE p.activity_id=? AND d.important=1", (activity_id,)
    ).fetchone()["n"]
    checks = conn.execute(
        "SELECT COUNT(*) AS total, SUM(CASE WHEN c.status='done' THEN 1 ELSE 0 END) AS done "
        "FROM checks c JOIN photos p ON p.id=c.photo_id WHERE p.activity_id=?", (activity_id,)
    ).fetchone()
    ai_suggestions = {row["ai_suggestion"]: row["n"] for row in conn.execute(
        "SELECT ai_suggestion, COUNT(*) AS n FROM photos "
        "WHERE activity_id=? AND ai_suggestion IS NOT NULL GROUP BY 1", (activity_id,)
    )}
    ai_cost = conn.execute(
        "SELECT COALESCE(SUM(cost_cny), 0) AS total FROM ai_requests "
        "WHERE activity_id=? AND status IN ('ok','error','lost')", (activity_id,)
    ).fetchone()["total"] or 0
    check_types = conn.execute(
        "SELECT c.check_type, c.status, COUNT(*) AS n FROM checks c JOIN photos p ON p.id=c.photo_id "
        "WHERE p.activity_id=? GROUP BY c.check_type, c.status", (activity_id,)
    ).fetchall()
    labels = conn.execute(
        "SELECT l.name, l.na_reason, "
        "(SELECT COUNT(*) FROM photo_labels pl JOIN decisions d ON d.photo_id=pl.photo_id "
        " WHERE pl.label_id=l.id AND d.verdict='keep') AS kept_count "
        "FROM labels l WHERE l.activity_id=? ORDER BY l.order_index", (activity_id,)
    ).fetchall()
    exports = conn.execute(
        "SELECT dest_root, status, created_at, finished_at FROM exports WHERE activity_id=? "
        "ORDER BY created_at DESC", (activity_id,)
    ).fetchall()
    sources = conn.execute(
        "SELECT label, root_path, photo_count FROM sources WHERE activity_id=? ORDER BY added_at",
        (activity_id,)
    ).fetchall()
    return {
        "objects": files - pairs,
        "files": files,
        "pairs": pairs,
        "unreadable": photos["unreadable"] or 0,
        "verdicts": verdicts,
        "important": important,
        "checks_total": checks["total"] or 0,
        "checks_done": checks["done"] or 0,
        "ai_suggestions": ai_suggestions,
        "ai_cost": float(ai_cost),
        "check_types": check_types,
        "labels": labels,
        "exports": exports,
        "sources": sources,
    }


def _page(title: str, body: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>{_esc(title)}</title>
<style>
body{{font-family:"Microsoft YaHei",system-ui,sans-serif;max-width:960px;margin:32px auto;padding:0 20px;color:#222;line-height:1.65}}
h1{{font-size:22px;margin-bottom:4px}} h2{{font-size:16px;margin-top:28px;border-bottom:1px solid #ddd;padding-bottom:6px}}
table{{border-collapse:collapse;width:100%;font-size:13px;margin-top:8px}}
th,td{{border:1px solid #ddd;padding:6px 8px;text-align:left}} th{{background:#f5f5f5}}
.muted{{color:#777;font-size:12px}} .warn{{color:#b45309}}
code{{background:#f3f3f3;padding:1px 4px;border-radius:3px}}
</style></head><body>{body}</body></html>"""


def _verdict_rows(stats: dict) -> str:
    names = ["undecided", "keep", "reject", "uncertain"]
    cells = "".join(
        f"<tr><td>{_esc(VERDICT_NAMES[name])}</td><td>{stats['verdicts'].get(name, 0)}</td></tr>"
        for name in names
    )
    return f"<table><tr><th>人工结论</th><th>照片对象数</th></tr>{cells}</table>"


def _label_rows(stats: dict) -> str:
    rows = []
    for label in stats["labels"]:
        note = "（本场不适用）" if label["na_reason"] else ""
        css = "" if label["kept_count"] > 0 or label["na_reason"] else ' class="warn"'
        rows.append(
            f"<tr{css}><td>{_esc(label['name'])}{note}</td><td>{label['kept_count']}</td></tr>"
        )
    return ("<table><tr><th>必备画面</th><th>保留数量</th></tr>" + "".join(rows) + "</table>")


def _source_rows(stats: dict) -> str:
    rows = "".join(
        f"<tr><td>{_esc(src['label'])}</td><td><code>{_esc(src['root_path'])}</code></td>"
        f"<td>{src['photo_count']}</td></tr>"
        for src in stats["sources"]
    )
    return f"<table><tr><th>来源</th><th>原始文件夹</th><th>文件数</th></tr>{rows}</table>"


def _export_rows(stats: dict) -> str:
    if not stats["exports"]:
        return "<p class='muted'>尚未导出。</p>"
    rows = "".join(
        f"<tr><td><code>{_esc(item['dest_root'])}</code></td><td>{_esc(item['status'])}</td>"
        f"<td>{_esc(item['finished_at'] or '')}</td></tr>"
        for item in stats["exports"]
    )
    return f"<table><tr><th>导出目标</th><th>状态</th><th>完成时间</th></tr>{rows}</table>"


def _check_rows(stats: dict) -> str:
    if stats["checks_total"] == 0:
        return "<p class='muted'>尚未进行 AI 初筛，检查状态为“未检查”。</p>"
    rows = []
    by_type: dict[str, dict[str, int]] = {}
    for item in stats["check_types"]:
        by_type.setdefault(item["check_type"], {})[item["status"]] = item["n"]
    for key, counts in by_type.items():
        name = CHECK_NAMES.get(key, key)
        rows.append(
            f"<tr><td>{_esc(name)}</td><td>{counts.get('done', 0)}</td>"
            f"<td>{counts.get('failed', 0)}</td><td>{counts.get('not_checked', 0)}</td></tr>"
        )
    table = ("<table><tr><th>检查项</th><th>已完成</th><th>失败</th><th>未检查</th></tr>"
             + "".join(rows) + "</table>")
    suggestion_rows = "".join(
        f"<tr><td>{_esc(SUGGESTION_NAMES.get(key, key))}</td><td>{value}</td></tr>"
        for key, value in stats["ai_suggestions"].items()
    )
    suggestion_table = ("<table><tr><th>AI 建议</th><th>照片对象数</th></tr>"
                        + suggestion_rows + "</table>") if suggestion_rows else ""
    return (f"<p>已完成检查 {stats['checks_done']} / {stats['checks_total']} 项；"
            "未检查与失败不能当作“没有问题”。</p>"
            f"{table}{suggestion_table}"
            f"<p>已记录 AI 费用：{stats['ai_cost']:.3f} 元（按服务端用量与设置单价计算，最终以账单为准）。</p>")


def activity_report_html(activity_id: str) -> tuple[str, str]:
    with db.db() as conn:
        activity = conn.execute("SELECT * FROM activities WHERE id=?", (activity_id,)).fetchone()
        if not activity:
            raise ValueError("活动不存在")
        stats = _stats(conn, activity_id)
    title = f"{activity['name']} · 处理报告"
    body = f"""
<h1>{_esc(activity['name'])} · 处理报告</h1>
<p class="muted">生成时间：{_esc(db.now())}　照片对象 {stats['objects']} 张（{stats['files']} 个文件，
配对 {stats['pairs']} 组）　读取失败 {stats['unreadable']} 个</p>
<h2>人工结论</h2>{_verdict_rows(stats)}
<p>重要标记：{stats['important']} 张。重要照片不会被批量排除，重新分析也不改变人工结论。</p>
<h2>检查完成情况</h2>{_check_rows(stats)}
<h2>必备画面</h2>{_label_rows(stats)}
<h2>来源文件夹</h2>{_source_rows(stats)}
<h2>导出记录</h2>{_export_rows(stats)}
<h2>说明</h2>
<p class="muted">本报告仅记录本机处理事实，不代表准确率或效率结论；费用未接入前不显示金额。</p>
"""
    return title, _page(title, body)


def write_manifest(export_id: str, dest_root: str) -> str:
    path = os.path.join(dest_root, "选片清单.csv")
    with db.db() as conn:
        export = conn.execute("SELECT * FROM exports WHERE id=?", (export_id,)).fetchone()
        rows = conn.execute(
            "SELECT s.label AS source_label, p.rel_path, p.file_name, p.form, "
            "COALESCE(d.verdict,'undecided') AS verdict, COALESCE(d.important,0) AS important, "
            "ei.dest_path, ei.status, ei.error "
            "FROM export_items ei JOIN photos p ON p.id=ei.photo_id "
            "JOIN sources s ON s.id=p.source_id "
            "LEFT JOIN decisions d ON d.photo_id=p.id "
            "WHERE ei.export_id=? ORDER BY ei.id",
            (export_id,),
        ).fetchall()
    os.makedirs(dest_root, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.writer(fh)
        writer.writerow(["来源", "原始相对路径", "文件名", "形态", "人工结论", "重要", "导出路径", "导出状态", "错误"])
        for row in rows:
            writer.writerow([
                row["source_label"], row["rel_path"], row["file_name"],
                FORM_NAMES.get(row["form"], row["form"]),
                VERDICT_NAMES.get(row["verdict"], row["verdict"]),
                "是" if row["important"] else "",
                os.path.relpath(row["dest_path"], dest_root),
                row["status"], row["error"] or "",
            ])
    return path


def write_export_report(export_id: str, dest_root: str) -> str:
    path = os.path.join(dest_root, "处理报告.html")
    with db.db() as conn:
        export = conn.execute("SELECT * FROM exports WHERE id=?", (export_id,)).fetchone()
        if not export:
            raise ValueError("导出记录不存在")
        activity = conn.execute("SELECT * FROM activities WHERE id=?", (export["activity_id"],)).fetchone()
        stats = _stats(conn, export["activity_id"])
        counts = {row["status"]: row["n"] for row in conn.execute(
            "SELECT status, COUNT(*) AS n FROM export_items WHERE export_id=? GROUP BY status", (export_id,)
        )}
        failures = conn.execute(
            "SELECT source_path, dest_path, error FROM export_items WHERE export_id=? AND status='failed' LIMIT 20",
            (export_id,),
        ).fetchall()
    failure_html = ""
    if failures:
        rows = "".join(
            f"<tr><td><code>{_esc(item['source_path'])}</code></td><td>{_esc(item['error'])}</td></tr>"
            for item in failures
        )
        failure_html = f"<h2>复制失败（前 20 项）</h2><table><tr><th>原片</th><th>原因</th></tr>{rows}</table>"
    body = f"""
<h1>{_esc(activity['name'])} · 导出报告</h1>
<p class="muted">导出时间：{_esc(export['created_at'])}　目标：<code>{_esc(export['dest_root'])}</code></p>
<h2>导出结果</h2>
<table><tr><th>状态</th><th>文件数</th></tr>
<tr><td>成功</td><td>{counts.get('done', 0)}</td></tr>
<tr><td>失败</td><td>{counts.get('failed', 0)}</td></tr>
<tr><td>跳过</td><td>{counts.get('skipped', 0)}</td></tr></table>
<h2>本场概况</h2>
<p>照片对象 {stats['objects']} 张，文件 {stats['files']} 个，配对 {stats['pairs']} 组；
保留 {stats['verdicts'].get('keep', 0)} 张，疑似废片 {stats['verdicts'].get('reject', 0)} 张，
待确认 {stats['verdicts'].get('uncertain', 0)} 张，重要 {stats['important']} 张。</p>
{_check_rows(stats)}
<h2>必备画面</h2>{_label_rows(stats)}
{failure_html}
<h2>说明</h2>
<p class="muted">只复制人工确认保留的原片；重名文件已自动改名，完整对应关系见同目录《选片清单.csv》。</p>
"""
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(_page(f"{activity['name']} · 导出报告", body))
    return path
