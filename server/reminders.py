import os
import sqlite3
import sys
from datetime import datetime
from typing import Any, Dict, List, Optional

# Wide enough to reliably catch at least one tick of the ~30s OS-scheduled
# background checker (launchd/Task Scheduler/systemd timers aren't perfectly
# precise to the second, so a tight window can miss a reminder entirely).
reminder_grace_seconds = 120


def default_db_path() -> str:
  home = os.path.expanduser("~")
  if sys.platform == "darwin":
    return os.path.join(home, "Library", "Application Support", "Adeo", "tasks.db")
  if sys.platform.startswith("win"):
    appdata = os.environ.get("APPDATA", home)
    return os.path.join(appdata, "Adeo", "tasks.db")
  return os.path.join(home, ".config", "Adeo", "tasks.db")


DB_PATH = os.environ.get("ADEO_DB_PATH") or default_db_path()


def get_conn() -> sqlite3.Connection:
  dir_path = os.path.dirname(DB_PATH)
  if dir_path:
    os.makedirs(dir_path, exist_ok=True)
  conn = sqlite3.connect(DB_PATH)
  conn.row_factory = sqlite3.Row
  return conn


def parse_dtstart(date_value: Optional[str], time_value: Optional[str]) -> datetime:
  date_part = date_value or datetime.now().date().isoformat()
  time_part = time_value or "00:00"
  return datetime.fromisoformat(f"{date_part}T{time_part}")


def get_due_reminders() -> List[Dict[str, Any]]:
  now = datetime.now()
  conn = get_conn()
  try:
    rows = conn.execute(
      """
      SELECT id, text, done, reminder_date, reminder_time
      FROM tasks
      WHERE done = 0 AND reminder_date IS NOT NULL AND reminder_time IS NOT NULL
      """
    ).fetchall()
  finally:
    conn.close()

  due: List[Dict[str, Any]] = []
  for row in rows:
    reminder_dt = parse_dtstart(row["reminder_date"], row["reminder_time"])
    delta = (now - reminder_dt).total_seconds()
    if delta < 0 or delta > reminder_grace_seconds:
      continue
    due.append(
      {
        "id": row["id"],
        "text": row["text"] or "Task reminder",
        "reminderDate": row["reminder_date"],
        "reminderTime": row["reminder_time"],
      }
    )
  return due
