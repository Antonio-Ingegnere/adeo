import logging
import os
import sqlite3
import sys
from datetime import datetime
from typing import Any, Optional, List, Dict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI, HTTPException
from dateutil.rrule import rrulestr
from pydantic import BaseModel

from reminders import get_conn, get_due_reminders, parse_dtstart

app = FastAPI()

logger = logging.getLogger("adeo.notifications")
if not logger.handlers:
  logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
  )


def has_column(conn: sqlite3.Connection, table: str, column: str) -> bool:
  rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
  return any(row["name"] == column for row in rows)


def initialize_db() -> None:
  conn = get_conn()
  try:
    conn.execute(
      """
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT NOT NULL,
        details TEXT NOT NULL DEFAULT '',
        done INTEGER NOT NULL DEFAULT 0,
        position INTEGER NOT NULL DEFAULT 0,
        list_id INTEGER,
        priority TEXT NOT NULL DEFAULT 'none',
        reminder_date TEXT,
        reminder_time TEXT,
        repeat_rule TEXT,
        repeat_start TEXT,
        series_id INTEGER,
        completed_at TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
      """
    )
    conn.execute(
      """
      CREATE TABLE IF NOT EXISTS lists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
      """
    )
    if not has_column(conn, "tasks", "list_id"):
      conn.execute("ALTER TABLE tasks ADD COLUMN list_id INTEGER")
    if not has_column(conn, "tasks", "priority"):
      conn.execute("ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'none'")
    if not has_column(conn, "tasks", "reminder_date"):
      conn.execute("ALTER TABLE tasks ADD COLUMN reminder_date TEXT")
    if not has_column(conn, "tasks", "reminder_time"):
      conn.execute("ALTER TABLE tasks ADD COLUMN reminder_time TEXT")
    if not has_column(conn, "tasks", "repeat_rule"):
      conn.execute("ALTER TABLE tasks ADD COLUMN repeat_rule TEXT")
    if not has_column(conn, "tasks", "repeat_start"):
      conn.execute("ALTER TABLE tasks ADD COLUMN repeat_start TEXT")
    if not has_column(conn, "tasks", "series_id"):
      conn.execute("ALTER TABLE tasks ADD COLUMN series_id INTEGER")
    if not has_column(conn, "tasks", "completed_at"):
      conn.execute("ALTER TABLE tasks ADD COLUMN completed_at TEXT")
    if not has_column(conn, "lists", "position"):
      conn.execute("ALTER TABLE lists ADD COLUMN position INTEGER NOT NULL DEFAULT 0")
      conn.execute("UPDATE lists SET position = id WHERE position = 0")
    conn.execute(
      """
      CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        color TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
      """
    )
    conn.execute(
      """
      CREATE TABLE IF NOT EXISTS task_tags (
        task_id INTEGER NOT NULL,
        tag_id INTEGER NOT NULL,
        PRIMARY KEY (task_id, tag_id)
      )
      """
    )
    conn.commit()
  finally:
    conn.close()


@app.on_event("startup")
def on_startup() -> None:
  initialize_db()


@app.get("/health")
def health() -> Dict[str, str]:
  return {"status": "ok"}


@app.get("/reminders/due")
def get_reminders_due() -> List[Dict[str, Any]]:
  return get_due_reminders()


class TaskCreate(BaseModel):
  text: str
  listId: Optional[int] = None
  tagIds: Optional[List[int]] = None


class TaskOrder(BaseModel):
  orderedIds: List[int]


class ListOrder(BaseModel):
  orderedIds: List[int]


class TaskDone(BaseModel):
  done: bool


class TaskText(BaseModel):
  text: str


class TaskList(BaseModel):
  listId: Optional[int] = None


class TaskPriority(BaseModel):
  priority: str


class TaskDetails(BaseModel):
  details: Optional[str] = None


class TaskReminder(BaseModel):
  reminderDate: Optional[str] = None
  reminderTime: Optional[str] = None


class TaskRepeat(BaseModel):
  repeatRule: Optional[str] = None
  repeatStart: Optional[str] = None


class ListCreate(BaseModel):
  name: str


class ListName(BaseModel):
  name: str


class TagCreate(BaseModel):
  name: str


class TagName(BaseModel):
  name: str


class TaskTags(BaseModel):
  tagIds: List[int]


TAG_PALETTE = [
  "#F6C6C6",  # rose
  "#F9D9B8",  # peach
  "#F5EBAE",  # butter
  "#C9E8C1",  # mint
  "#BEE3E8",  # aqua
  "#C5D4F5",  # periwinkle
  "#DCCDF0",  # lilac
  "#F3CFE3",  # pink
]


def normalize_tag_name(name: str) -> str:
  trimmed = name.strip()
  if trimmed.startswith("#"):
    trimmed = trimmed[1:].strip()
  if not trimmed:
    raise HTTPException(status_code=400, detail="Tag name is empty")
  return trimmed


def row_to_task(row: sqlite3.Row, tag_ids: Optional[List[int]] = None) -> Dict[str, Any]:
  return {
    "id": row["id"],
    "text": row["text"],
    "details": row["details"],
    "done": bool(row["done"]),
    "position": row["position"],
    "listId": row["list_id"],
    "priority": row["priority"] or "none",
    "reminderDate": row["reminder_date"],
    "reminderTime": row["reminder_time"],
    "repeatRule": row["repeat_rule"],
    "repeatStart": row["repeat_start"],
    "seriesId": row["series_id"],
    "tagIds": tag_ids or [],
  }


def compute_next_occurrence(rule: str, dtstart: datetime, now: datetime) -> Optional[datetime]:
  rrule = rrulestr(rule, dtstart=dtstart)
  return rrule.after(now, inc=False)


@app.post("/tasks")
def add_task(payload: TaskCreate) -> Dict[str, Any]:
  trimmed = payload.text.strip()
  if not trimmed:
    raise HTTPException(status_code=400, detail="Task text is empty")
  conn = get_conn()
  try:
    row = conn.execute("SELECT MAX(position) as maxPos FROM tasks").fetchone()
    next_pos = (row["maxPos"] if row and row["maxPos"] is not None else -1) + 1
    cursor = conn.execute(
      """
      INSERT INTO tasks (text, details, done, position, list_id, priority, reminder_date, reminder_time, repeat_rule, repeat_start)
      VALUES (?, '', 0, ?, ?, 'none', NULL, NULL, NULL, NULL)
      """,
      (trimmed, next_pos, payload.listId),
    )
    task_id = cursor.lastrowid
    tag_ids: List[int] = []
    for tag_id in payload.tagIds or []:
      inserted = conn.execute(
        "INSERT OR IGNORE INTO task_tags (task_id, tag_id) SELECT ?, id FROM tags WHERE id = ?",
        (task_id, tag_id),
      )
      if inserted.rowcount:
        tag_ids.append(tag_id)
    conn.commit()
    return {
      "id": task_id,
      "text": trimmed,
      "details": "",
      "done": False,
      "position": next_pos,
      "listId": payload.listId,
      "priority": "none",
      "reminderDate": None,
      "reminderTime": None,
      "repeatRule": None,
      "repeatStart": None,
      "tagIds": tag_ids,
    }
  finally:
    conn.close()


@app.get("/tasks")
def get_tasks() -> List[Dict[str, Any]]:
  conn = get_conn()
  try:
    rows = conn.execute(
      """
      SELECT id, text, details, done, position, list_id, priority, reminder_date, reminder_time, repeat_rule, repeat_start, series_id
      FROM tasks
      ORDER BY position ASC, id ASC
      """
    ).fetchall()
    tag_map: Dict[int, List[int]] = {}
    for link in conn.execute("SELECT task_id, tag_id FROM task_tags ORDER BY tag_id ASC").fetchall():
      tag_map.setdefault(link["task_id"], []).append(link["tag_id"])
    return [row_to_task(row, tag_map.get(row["id"])) for row in rows]
  finally:
    conn.close()


@app.patch("/tasks/{task_id}/done")
def update_task_done(task_id: int, payload: TaskDone) -> Dict[str, Any]:
  conn = get_conn()
  try:
    row = conn.execute(
      """
      SELECT id, text, details, position, list_id, priority, reminder_date, reminder_time, repeat_rule,
             repeat_start, series_id, done, completed_at
      FROM tasks
      WHERE id = ?
      """,
      (task_id,),
    ).fetchone()

    next_done = 1 if payload.done else 0
    conn.execute("UPDATE tasks SET done = ? WHERE id = ?", (next_done, task_id))

    if row and payload.done and not row["done"] and row["repeat_rule"] and not row["completed_at"]:
      series_id = row["series_id"] or row["id"]
      if not row["series_id"]:
        conn.execute("UPDATE tasks SET series_id = ? WHERE id = ?", (series_id, row["id"]))
      conn.execute("UPDATE tasks SET completed_at = ? WHERE id = ?", (datetime.now().isoformat(timespec="seconds"), row["id"]))
      base_dt = parse_dtstart(row["reminder_date"] or row["repeat_start"], row["reminder_time"])
      next_dt = compute_next_occurrence(row["repeat_rule"], base_dt, base_dt)
      if next_dt:
        next_date = next_dt.date().isoformat()
        next_time = row["reminder_time"]
        position_row = conn.execute("SELECT MAX(position) as maxPos FROM tasks").fetchone()
        next_pos = (position_row["maxPos"] if position_row and position_row["maxPos"] is not None else -1) + 1
        insert_cursor = conn.execute(
          """
          INSERT INTO tasks (
            text, details, done, position, list_id, priority, reminder_date, reminder_time,
            repeat_rule, repeat_start, series_id
          )
          VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)
          """,
          (
            row["text"],
            row["details"],
            next_pos,
            row["list_id"],
            row["priority"],
            next_date,
            next_time,
            row["repeat_rule"],
            row["repeat_start"],
            series_id,
          ),
        )
        conn.execute(
          "INSERT INTO task_tags (task_id, tag_id) SELECT ?, tag_id FROM task_tags WHERE task_id = ?",
          (insert_cursor.lastrowid, row["id"]),
        )
      conn.commit()
    else:
      conn.commit()
    return {"id": task_id, "done": payload.done}
  finally:
    conn.close()


@app.patch("/tasks/{task_id}/text")
def update_task_text(task_id: int, payload: TaskText) -> Dict[str, Any]:
  trimmed = payload.text.strip()
  if not trimmed:
    raise HTTPException(status_code=400, detail="Task text is empty")
  conn = get_conn()
  try:
    conn.execute("UPDATE tasks SET text = ? WHERE id = ?", (trimmed, task_id))
    conn.commit()
    return {"id": task_id, "text": trimmed}
  finally:
    conn.close()


@app.patch("/tasks/{task_id}/details")
def update_task_details(task_id: int, payload: TaskDetails) -> Dict[str, Any]:
  details = payload.details or ""
  conn = get_conn()
  try:
    conn.execute("UPDATE tasks SET details = ? WHERE id = ?", (details, task_id))
    conn.commit()
    return {"id": task_id, "details": details}
  finally:
    conn.close()


@app.patch("/tasks/{task_id}/list")
def update_task_list(task_id: int, payload: TaskList) -> Dict[str, Any]:
  conn = get_conn()
  try:
    conn.execute("UPDATE tasks SET list_id = ? WHERE id = ?", (payload.listId, task_id))
    conn.commit()
    return {"id": task_id, "listId": payload.listId}
  finally:
    conn.close()


@app.patch("/tasks/{task_id}/priority")
def update_task_priority(task_id: int, payload: TaskPriority) -> Dict[str, Any]:
  allowed = {"none", "low", "medium", "high"}
  if payload.priority not in allowed:
    raise HTTPException(status_code=400, detail="Invalid priority")
  conn = get_conn()
  try:
    conn.execute("UPDATE tasks SET priority = ? WHERE id = ?", (payload.priority, task_id))
    conn.commit()
    return {"id": task_id, "priority": payload.priority}
  finally:
    conn.close()


@app.patch("/tasks/{task_id}/reminder")
def update_task_reminder(task_id: int, payload: TaskReminder) -> Dict[str, Any]:
  conn = get_conn()
  try:
    conn.execute(
      "UPDATE tasks SET reminder_date = ?, reminder_time = ? WHERE id = ?",
      (payload.reminderDate, payload.reminderTime, task_id),
    )
    conn.commit()
    return {"id": task_id, "reminderDate": payload.reminderDate, "reminderTime": payload.reminderTime}
  finally:
    conn.close()


@app.patch("/tasks/{task_id}/repeat")
def update_task_repeat(task_id: int, payload: TaskRepeat) -> Dict[str, Any]:
  conn = get_conn()
  try:
    conn.execute(
      "UPDATE tasks SET repeat_rule = ?, repeat_start = ? WHERE id = ?",
      (payload.repeatRule, payload.repeatStart, task_id),
    )
    conn.commit()
    return {"id": task_id, "repeatRule": payload.repeatRule, "repeatStart": payload.repeatStart}
  finally:
    conn.close()


@app.post("/tasks/order")
def update_task_order(payload: TaskOrder) -> Dict[str, Any]:
  conn = get_conn()
  try:
    for index, task_id in enumerate(payload.orderedIds):
      conn.execute("UPDATE tasks SET position = ? WHERE id = ?", (index, task_id))
    conn.commit()
    return {"success": True}
  finally:
    conn.close()


@app.post("/lists")
def add_list(payload: ListCreate) -> Dict[str, Any]:
  trimmed = payload.name.strip()
  if not trimmed:
    raise HTTPException(status_code=400, detail="List name is empty")
  conn = get_conn()
  try:
    row = conn.execute("SELECT MAX(position) as maxPos FROM lists").fetchone()
    next_pos = (row["maxPos"] if row and row["maxPos"] is not None else -1) + 1
    cursor = conn.execute("INSERT INTO lists (name, position) VALUES (?, ?)", (trimmed, next_pos))
    conn.commit()
    return {"id": cursor.lastrowid, "name": trimmed, "position": next_pos}
  finally:
    conn.close()


@app.get("/lists")
def get_lists() -> List[Dict[str, Any]]:
  conn = get_conn()
  try:
    rows = conn.execute("SELECT id, name, position FROM lists ORDER BY position ASC, id ASC").fetchall()
    return [{"id": row["id"], "name": row["name"], "position": row["position"]} for row in rows]
  finally:
    conn.close()


@app.patch("/lists/{list_id}/name")
def update_list_name(list_id: int, payload: ListName) -> Dict[str, Any]:
  trimmed = payload.name.strip()
  if not trimmed:
    raise HTTPException(status_code=400, detail="List name is empty")
  conn = get_conn()
  try:
    conn.execute("UPDATE lists SET name = ? WHERE id = ?", (trimmed, list_id))
    conn.commit()
    return {"id": list_id, "name": trimmed}
  finally:
    conn.close()


@app.delete("/lists/{list_id}")
def delete_list(list_id: int) -> Dict[str, Any]:
  conn = get_conn()
  try:
    conn.execute("DELETE FROM task_tags WHERE task_id IN (SELECT id FROM tasks WHERE list_id = ?)", (list_id,))
    conn.execute("DELETE FROM tasks WHERE list_id = ?", (list_id,))
    conn.execute("DELETE FROM lists WHERE id = ?", (list_id,))
    conn.commit()
    return {"id": list_id}
  finally:
    conn.close()


@app.post("/lists/order")
def update_list_order(payload: ListOrder) -> Dict[str, Any]:
  conn = get_conn()
  try:
    for index, list_id in enumerate(payload.orderedIds):
      conn.execute("UPDATE lists SET position = ? WHERE id = ?", (index, list_id))
    conn.commit()
    return {"success": True}
  finally:
    conn.close()


@app.post("/tags")
def add_tag(payload: TagCreate) -> Dict[str, Any]:
  name = normalize_tag_name(payload.name)
  conn = get_conn()
  try:
    existing = conn.execute(
      "SELECT id, name, color, position FROM tags WHERE name = ? COLLATE NOCASE",
      (name,),
    ).fetchone()
    if existing:
      return {
        "id": existing["id"],
        "name": existing["name"],
        "color": existing["color"],
        "position": existing["position"],
      }
    count_row = conn.execute("SELECT COUNT(*) as total FROM tags").fetchone()
    count = count_row["total"] if count_row else 0
    color = TAG_PALETTE[count % len(TAG_PALETTE)]
    cursor = conn.execute(
      "INSERT INTO tags (name, color, position) VALUES (?, ?, ?)",
      (name, color, count),
    )
    conn.commit()
    return {"id": cursor.lastrowid, "name": name, "color": color, "position": count}
  finally:
    conn.close()


@app.get("/tags")
def get_tags() -> List[Dict[str, Any]]:
  conn = get_conn()
  try:
    rows = conn.execute(
      "SELECT id, name, color, position FROM tags ORDER BY name COLLATE NOCASE ASC, id ASC"
    ).fetchall()
    return [
      {"id": row["id"], "name": row["name"], "color": row["color"], "position": row["position"]}
      for row in rows
    ]
  finally:
    conn.close()


@app.patch("/tags/{tag_id}/name")
def update_tag_name(tag_id: int, payload: TagName) -> Dict[str, Any]:
  name = normalize_tag_name(payload.name)
  conn = get_conn()
  try:
    try:
      conn.execute("UPDATE tags SET name = ? WHERE id = ?", (name, tag_id))
      conn.commit()
    except sqlite3.IntegrityError:
      raise HTTPException(status_code=400, detail="Tag name already exists")
    return {"id": tag_id, "name": name}
  finally:
    conn.close()


@app.delete("/tags/{tag_id}")
def delete_tag(tag_id: int) -> Dict[str, Any]:
  conn = get_conn()
  try:
    conn.execute("DELETE FROM task_tags WHERE tag_id = ?", (tag_id,))
    conn.execute("DELETE FROM tags WHERE id = ?", (tag_id,))
    conn.commit()
    return {"id": tag_id}
  finally:
    conn.close()


@app.put("/tasks/{task_id}/tags")
def set_task_tags(task_id: int, payload: TaskTags) -> Dict[str, Any]:
  conn = get_conn()
  try:
    conn.execute("DELETE FROM task_tags WHERE task_id = ?", (task_id,))
    applied: List[int] = []
    for tag_id in payload.tagIds:
      inserted = conn.execute(
        "INSERT OR IGNORE INTO task_tags (task_id, tag_id) SELECT ?, id FROM tags WHERE id = ?",
        (task_id, tag_id),
      )
      if inserted.rowcount:
        applied.append(tag_id)
    conn.commit()
    return {"id": task_id, "tagIds": applied}
  finally:
    conn.close()


if __name__ == "__main__":
  import uvicorn

  host = os.environ.get("ADEO_API_HOST", "127.0.0.1")
  port = int(os.environ.get("ADEO_API_PORT", "8000"))
  uvicorn.run(app, host=host, port=port)
