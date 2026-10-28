"""SQLite 连接、建表与常用查询。"""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import datetime

from . import config

SCHEMA_VERSION = 7

SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'custom',
  stage TEXT NOT NULL DEFAULT 'activity',
  rule_json TEXT NOT NULL DEFAULT '{}',
  budget_limit_cny REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  report_path TEXT,
  note TEXT
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  root_path TEXT NOT NULL,
  label TEXT NOT NULL,
  added_at TEXT NOT NULL,
  photo_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id),
  rel_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  ext TEXT NOT NULL,
  form TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  mtime TEXT,
  pair_id TEXT,
  capture_time TEXT,
  camera_make TEXT,
  camera_model TEXT,
  lens_model TEXT,
  iso INTEGER,
  aperture TEXT,
  shutter TEXT,
  focal_length TEXT,
  exposure_bias TEXT,
  orientation INTEGER,
  width INTEGER,
  height INTEGER,
  preview_state TEXT NOT NULL DEFAULT 'pending',
  preview_error TEXT,
  import_job_id TEXT,
  ai_suggestion TEXT,
  ai_issue_count INTEGER NOT NULL DEFAULT 0,
  burst_group TEXT,
  burst_rank INTEGER,
  burst_score REAL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_photos_activity ON photos(activity_id, source_id);
CREATE INDEX IF NOT EXISTS idx_photos_pair ON photos(pair_id);

CREATE TABLE IF NOT EXISTS checks (
  photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  check_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_checked',
  result TEXT,
  reason TEXT,
  region_hint TEXT,
  evidence_json TEXT,
  method TEXT,
  prompt_version TEXT,
  model TEXT,
  cost_cny REAL,
  started_at TEXT,
  finished_at TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT,
  PRIMARY KEY (photo_id, check_type)
);

CREATE TABLE IF NOT EXISTS decisions (
  photo_id TEXT PRIMARY KEY REFERENCES photos(id) ON DELETE CASCADE,
  activity_id TEXT NOT NULL,
  verdict TEXT NOT NULL DEFAULT 'undecided',
  important INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS decision_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  photo_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS labels (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'required_shot',
  name TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  na_reason TEXT
);

CREATE TABLE IF NOT EXISTS photo_labels (
  photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (photo_id, label_id)
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  cursor INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  done_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  options_json TEXT,
  result_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_quick_cache (
  key TEXT PRIMARY KEY,
  parsed_json TEXT NOT NULL,
  model TEXT,
  prompt_version TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS ai_requests (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  job_id TEXT,
  photo_id TEXT,
  check_type TEXT,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  status TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_cny REAL,
  usage_reported INTEGER NOT NULL DEFAULT 0,
  sent_at TEXT,
  finished_at TEXT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS exports (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  dest_root TEXT NOT NULL,
  options_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  manifest_path TEXT,
  report_path TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS export_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  export_id TEXT NOT NULL REFERENCES exports(id) ON DELETE CASCADE,
  photo_id TEXT NOT NULL,
  source_path TEXT NOT NULL,
  dest_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  verified_size INTEGER,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS dedupe_runs (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'applied',
  groups INTEGER NOT NULL DEFAULT 0,
  kept_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  options_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  undone_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_dedupe_runs_activity ON dedupe_runs(activity_id, created_at);

CREATE TABLE IF NOT EXISTS dedupe_items (
  run_id TEXT NOT NULL REFERENCES dedupe_runs(id) ON DELETE CASCADE,
  photo_id TEXT NOT NULL,
  group_key TEXT,
  rank INTEGER,
  score REAL,
  prev_verdict TEXT,
  new_verdict TEXT NOT NULL,
  PRIMARY KEY (run_id, photo_id)
);

CREATE TABLE IF NOT EXISTS import_analysis_links (
  import_job_id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  analysis_job_id TEXT,
  created_at TEXT,
  cancelled INTEGER NOT NULL DEFAULT 0,
  consumed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_id TEXT NOT NULL,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  target TEXT,
  detail_json TEXT
);
"""


def now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(config.db_path(), timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


@contextmanager
def db():
    conn = _connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    with db() as conn:
        previous_version = int(conn.execute("PRAGMA user_version").fetchone()[0] or 0)
        conn.executescript(SCHEMA)
        _migrate(conn, previous_version)
        conn.execute(f"PRAGMA user_version={SCHEMA_VERSION}")


def _migrate(conn, previous_version: int = 0) -> None:
    # 旧版 AI 使用 pass/fail，界面只识别 ok/suspect；只在启动时迁移一次。
    conn.execute("UPDATE checks SET result='ok' WHERE result IN ('pass','passed')")
    conn.execute("UPDATE checks SET result='suspect' WHERE result IN ('fail','failed')")
    check_columns = {row["name"] for row in conn.execute("PRAGMA table_info(checks)")}
    if "evidence_json" not in check_columns:
        conn.execute("ALTER TABLE checks ADD COLUMN evidence_json TEXT")
    """给旧版本数据库补列；只做加法，不重写已有数据。"""
    columns = {row[1] for row in conn.execute("PRAGMA table_info(photos)")}
    for name in ("ai_stage", "ai_quick_json", "ai_quick_signature", "import_job_id"):
        if name not in columns:
            conn.execute(f"ALTER TABLE photos ADD COLUMN {name} TEXT")
    decision_columns = {row[1] for row in conn.execute("PRAGMA table_info(decisions)")}
    if "origin" not in decision_columns:
        # Existing conclusions stay protected; only new, untouched rows are automatic.
        conn.execute("ALTER TABLE decisions ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual'")
        conn.execute("UPDATE decisions SET origin='unassigned' WHERE verdict='undecided' "
                     "AND NOT EXISTS (SELECT 1 FROM decision_events e WHERE e.photo_id=decisions.photo_id)")
    if "ai_suggestion" not in columns:
        conn.execute("ALTER TABLE photos ADD COLUMN ai_suggestion TEXT")
    if "ai_issue_count" not in columns:
        conn.execute("ALTER TABLE photos ADD COLUMN ai_issue_count INTEGER NOT NULL DEFAULT 0")
    if "burst_group" not in columns:
        conn.execute("ALTER TABLE photos ADD COLUMN burst_group TEXT")
    if "burst_rank" not in columns:
        conn.execute("ALTER TABLE photos ADD COLUMN burst_rank INTEGER")
    if "burst_score" not in columns:
        conn.execute("ALTER TABLE photos ADD COLUMN burst_score REAL")
    for name, kind in (
        ("camera_make", "TEXT"), ("camera_model", "TEXT"), ("lens_model", "TEXT"),
        ("iso", "INTEGER"), ("aperture", "TEXT"), ("shutter", "TEXT"),
        ("focal_length", "TEXT"), ("exposure_bias", "TEXT"),
    ):
        if name not in columns:
            conn.execute(f"ALTER TABLE photos ADD COLUMN {name} {kind}")
    # v6：把已完成的 AI 建议回填成初筛分类，只改尚未人工处理的照片。
    if previous_version < 6:
        conn.execute(
            "UPDATE decisions SET verdict=("
            "SELECT CASE p.ai_suggestion WHEN 'keep' THEN 'keep' WHEN 'reject' THEN 'reject' "
            "WHEN 'uncertain' THEN 'uncertain' END FROM photos p WHERE p.id=decisions.photo_id), "
            "updated_at=? WHERE verdict='undecided' AND photo_id IN ("
            "SELECT id FROM photos WHERE ai_suggestion IN ('keep','reject','uncertain'))",
            (now(),),
        )
    # macOS 的 ._DSC_0001.NEF 是 AppleDouble 资源叉，不是照片，导入时已跳过；清理旧库里的误导入
    conn.execute("DELETE FROM photos WHERE file_name LIKE '._%'")
    conn.execute("UPDATE sources SET photo_count=(SELECT COUNT(*) FROM photos WHERE photos.source_id=sources.id)")


def log_event(activity_id: str, kind: str, target: str | None = None, detail: str | None = None) -> None:
    with db() as conn:
        conn.execute(
            "INSERT INTO events(activity_id, at, kind, target, detail_json) VALUES (?,?,?,?,?)",
            (activity_id, now(), kind, target, detail),
        )
