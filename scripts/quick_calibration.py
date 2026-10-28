"""Read-only quick-screen calibration report.

Usage:
  .venv\\Scripts\\python.exe scripts\\quick_calibration.py
  .venv\\Scripts\\python.exe scripts\\quick_calibration.py --db <cull.db> --activity <id>
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
from collections import Counter


def default_db() -> str:
    return os.path.join(os.environ.get("LOCALAPPDATA", ""), "ActivityPhotoCull", "cull.db")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=default_db())
    parser.add_argument("--activity", default="")
    args = parser.parse_args()
    if not os.path.exists(args.db):
        print(f"数据库不存在：{args.db}")
        return 2
    conn = sqlite3.connect(f"file:{args.db.replace(chr(92), '/')}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    where = "WHERE p.activity_id=?" if args.activity else ""
    params = (args.activity,) if args.activity else ()
    rows = conn.execute(
        "SELECT p.id, p.ai_stage, p.ai_quick_json, p.ai_suggestion, "
        "COALESCE(d.verdict, 'undecided') AS verdict, COALESCE(d.origin, '') AS origin "
        "FROM photos p LEFT JOIN decisions d ON d.photo_id=p.id " + where, params
    ).fetchall()
    buckets = Counter()
    for row in rows:
        quick = ""
        if row["ai_quick_json"]:
            try:
                quick = json.loads(row["ai_quick_json"]).get("verdict") or ""
            except (ValueError, TypeError):
                pass
        manual = row["origin"] == "manual"
        buckets[(quick or "none", row["verdict"], "manual" if manual else "auto")] += 1
    print(f"总照片：{len(rows)}")
    print("快速结果 -> 当前结论（人工/自动）")
    for (quick, verdict, origin), count in sorted(buckets.items()):
        print(f"  {quick:7} -> {verdict:10} {origin}: {count}")
    manual = [row for row in rows if row["origin"] == "manual"]
    quick_reject_manual_keep = sum(
        1 for row in manual
        if row["ai_quick_json"] and json.loads(row["ai_quick_json"]).get("verdict") == "reject"
        and row["verdict"] == "keep"
    )
    quick_keep_manual_reject = sum(
        1 for row in manual
        if row["ai_quick_json"] and json.loads(row["ai_quick_json"]).get("verdict") == "keep"
        and row["verdict"] == "reject"
    )
    print(f"人工已复核：{len(manual)}")
    print(f"  第一轮误排除（quick=reject, 人工=keep）：{quick_reject_manual_keep}")
    print(f"  第一轮误保留（quick=keep, 人工=reject）：{quick_keep_manual_reject}")
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
