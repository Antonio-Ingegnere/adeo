import json
import os
import subprocess
import sys
from typing import Any, Dict, Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from reminders import DB_PATH, get_due_reminders

USER_DATA_DIR = os.path.dirname(DB_PATH)
LOCK_PATH = os.path.join(USER_DATA_DIR, "app-running.lock")
NOTIFIED_PATH = os.path.join(USER_DATA_DIR, "notified.json")
LOG_PATH = os.path.join(USER_DATA_DIR, "reminder-notifier.log")
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
NOTIFICATION_TITLE = "Adeo Reminder"


def log_error(message: str) -> None:
  try:
    from datetime import datetime as _dt

    with open(LOG_PATH, "a") as f:
      f.write(f"{_dt.now().isoformat()} {message}\n")
  except Exception:
    pass


def is_pid_alive(pid: int) -> bool:
  if pid <= 0:
    return False
  if sys.platform.startswith("win"):
    try:
      result = subprocess.run(
        ["tasklist", "/FI", f"PID eq {pid}"],
        capture_output=True,
        text=True,
        timeout=5,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
      )
      return str(pid) in result.stdout
    except Exception:
      return False
  try:
    os.kill(pid, 0)
  except ProcessLookupError:
    return False
  except PermissionError:
    return True
  except Exception:
    return False
  return True


def is_main_app_running() -> bool:
  try:
    with open(LOCK_PATH, "r") as f:
      pid = int(f.read().strip())
  except Exception:
    return False
  return is_pid_alive(pid)


def load_notified() -> Dict[str, str]:
  try:
    with open(NOTIFIED_PATH, "r") as f:
      return json.load(f)
  except Exception:
    return {}


def save_notified(data: Dict[str, str]) -> None:
  try:
    with open(NOTIFIED_PATH, "w") as f:
      json.dump(data, f)
  except Exception:
    pass


def find_first_existing(candidates: list) -> Optional[str]:
  for candidate in candidates:
    if candidate and os.path.exists(candidate):
      return candidate
  return None


def xml_escape(value: str) -> str:
  return (
    value.replace("&", "&amp;")
    .replace("<", "&lt;")
    .replace(">", "&gt;")
    .replace('"', "&quot;")
    .replace("'", "&apos;")
  )


def notify_macos(task_id: int, body: str) -> bool:
  binary = find_first_existing(
    [
      # Packaged: server/ and terminal-notifier.app/ are sibling folders under Resources/.
      os.path.join(SCRIPT_DIR, "..", "terminal-notifier.app", "Contents", "MacOS", "terminal-notifier"),
      # Dev (unpackaged): repo root's vendor/mac/terminal-notifier.app.
      os.path.join(SCRIPT_DIR, "..", "..", "vendor", "mac", "terminal-notifier.app", "Contents", "MacOS", "terminal-notifier"),
      "/opt/homebrew/bin/terminal-notifier",
      "/usr/local/bin/terminal-notifier",
    ]
  )
  if not binary:
    log_error(f"notify_macos: terminal-notifier binary not found for task {task_id}")
    return False
  url = f"adeo://open-task/{task_id}"

  # macOS silently drops notifications posted by a process whose "responsible"
  # parent isn't a proper, permission-registered app — a bare interpreter like
  # this script (even calling a signed terminal-notifier via subprocess.Popen)
  # gets attributed as that parent and blocked with no error or prompt.
  # Confirmed empirically: launchd invoking terminal-notifier *directly* works;
  # launchd -> python -> Popen(terminal-notifier) does not. So instead of
  # spawning terminal-notifier ourselves, we write a one-shot per-task
  # LaunchAgent and have launchd itself spawn it (RunAtLoad), making launchd
  # the direct parent, matching the working case.
  label = f"com.adeo.app.notify.{task_id}"
  plist_path = os.path.expanduser(f"~/Library/LaunchAgents/{label}.plist")
  plist = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>{xml_escape(label)}</string>
    <key>ProgramArguments</key>
    <array>
      <string>{xml_escape(binary)}</string>
      <string>-title</string>
      <string>{xml_escape(NOTIFICATION_TITLE)}</string>
      <string>-message</string>
      <string>{xml_escape(body)}</string>
      <string>-open</string>
      <string>{xml_escape(url)}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
  </dict>
</plist>
"""
  try:
    os.makedirs(os.path.dirname(plist_path), exist_ok=True)
    with open(plist_path, "w") as f:
      f.write(plist)
    uid = os.getuid()
    subprocess.run(
      ["launchctl", "bootout", f"gui/{uid}/{label}"],
      stdout=subprocess.DEVNULL,
      stderr=subprocess.DEVNULL,
    )
    subprocess.run(
      ["launchctl", "bootstrap", f"gui/{uid}", plist_path],
      stdout=subprocess.DEVNULL,
      stderr=subprocess.DEVNULL,
    )
    return True
  except Exception as exc:
    log_error(f"notify_macos: failed for task {task_id}: {exc}")
    return False


def notify_windows(task_id: int, body: str) -> bool:
  script = os.path.join(SCRIPT_DIR, "reminder_notify_windows.ps1")
  if not os.path.exists(script):
    log_error(f"notify_windows: script not found at {script}")
    return False
  url = f"adeo://open-task/{task_id}"
  try:
    result = subprocess.run(
      [
        "powershell.exe",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        script,
        "-Title",
        NOTIFICATION_TITLE,
        "-Body",
        body,
        "-Url",
        url,
      ],
      capture_output=True,
      text=True,
      timeout=15,
      creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    if result.returncode != 0:
      log_error(
        f"notify_windows: toast script exited {result.returncode} for task {task_id}: "
        f"{result.stderr.strip()}"
      )
      return False
    return True
  except Exception as exc:
    log_error(f"notify_windows: failed to invoke toast script for task {task_id}: {exc}")
    return False


def notify_linux(task_id: int, body: str) -> bool:
  url = f"adeo://open-task/{task_id}"
  # notify-send blocks until the user interacts (or times out) when actions are
  # given, printing the chosen action id to stdout — best-effort: many Linux
  # notification daemons don't support actions and will just show a plain
  # notification with no click-through, which is an accepted limitation here.
  shell_cmd = (
    f'ACTION=$(notify-send --action=default=Open "{NOTIFICATION_TITLE}" "{body}" 2>/dev/null); '
    f'if [ "$ACTION" = "default" ]; then xdg-open "{url}" >/dev/null 2>&1; fi'
  )
  try:
    subprocess.Popen(
      ["sh", "-c", shell_cmd],
      stdout=subprocess.DEVNULL,
      stderr=subprocess.DEVNULL,
      start_new_session=True,
    )
    return True
  except Exception as exc:
    log_error(f"notify_linux: failed for task {task_id}: {exc}")
    return False


def notify(reminder: Dict[str, Any]) -> bool:
  body = reminder.get("text") or "Task reminder"
  task_id = reminder["id"]
  if sys.platform == "darwin":
    return notify_macos(task_id, body)
  elif sys.platform.startswith("win"):
    return notify_windows(task_id, body)
  else:
    return notify_linux(task_id, body)


def main() -> None:
  if is_main_app_running():
    return

  due = get_due_reminders()
  notified = load_notified()
  active_ids = set()
  changed = False

  for reminder in due:
    key_id = str(reminder["id"])
    active_ids.add(key_id)
    time_key = f'{reminder["reminderDate"]}|{reminder["reminderTime"]}'
    if notified.get(key_id) == time_key:
      continue
    if notify(reminder):
      notified[key_id] = time_key
      changed = True

  stale_ids = [key_id for key_id in notified if key_id not in active_ids]
  for key_id in stale_ids:
    notified.pop(key_id, None)
    changed = True

  if changed:
    save_notified(notified)


if __name__ == "__main__":
  main()
