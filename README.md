# Adeo

Adeo is a lightweight Electron todo app with a local FastAPI backend for data storage and sync-free operation.

## Run locally

1. Install Node dependencies: `npm install`
2. Create a Python venv (one time):
   - `python3 -m venv .venv`
   - `source .venv/bin/activate`
   - `pip install -r server/requirements.txt`
3. Start the app: `npm run start`

## Build a self-sufficient Windows app (bundled Python)

This app ships a bundled Python runtime so end users do not need Python installed.

### 1) Add Windows embeddable Python

Download the official Windows embeddable package for Python 3.12.x and extract it to:
```
python/python-3.12.10-embed-amd64/
```

Expected layout (example):
```
python/
  python-3.12.10-embed-amd64/
    python.exe
    python312._pth
    ...
```

The packaged app looks for `resources/python/python.exe` and `resources/python/*/python.exe`.

### 2) Populate embedded site-packages from macOS

From the repo root on macOS, download Windows wheels into the embedded Python:
```
python3 -m pip install -r server/requirements.txt \
  --platform win_amd64 \
  --python-version 3.12 \
  --implementation cp \
  --abi cp312 \
  --only-binary=:all: \
  --target python/python-3.12.10-embed-amd64/Lib/site-packages
```

Then edit `python/python-3.12.10-embed-amd64/python312._pth`:
- Add `Lib\site-packages` on its own line
- Ensure `import site` is uncommented

If pip fails due to missing wheels, run this step on a Windows machine instead.

### 3) Package for Windows

```
npm run build
npm run package:win
```

The packaged app will use the bundled Python by default.

## Build a self-sufficient macOS app (bundled Python)

Like Windows, macOS packaging bundles a real Python runtime so end users don't need Python installed. Since macOS builds separate binaries per CPU architecture (no universal "embeddable" package like Windows), you need one bundle per architecture you intend to ship: `python/mac-arm64/` (Apple Silicon) and `python/mac-x64/` (Intel).

### 1) Download a standalone Python runtime per architecture

Get the `install_only` build for Python 3.12.x from [python-build-standalone](https://github.com/astral-sh/python-build-standalone/releases) for each architecture, e.g.:
```
curl -L -o cpython-arm64.tar.gz \
  https://github.com/astral-sh/python-build-standalone/releases/download/<tag>/cpython-3.12.x+<tag>-aarch64-apple-darwin-install_only.tar.gz
tar -xzf cpython-arm64.tar.gz
mv python python/mac-arm64

curl -L -o cpython-x64.tar.gz \
  https://github.com/astral-sh/python-build-standalone/releases/download/<tag>/cpython-3.12.x+<tag>-x86_64-apple-darwin-install_only.tar.gz
tar -xzf cpython-x64.tar.gz
mv python python/mac-x64
```

Expected layout:
```
python/
  mac-arm64/
    bin/python3
    ...
  mac-x64/
    bin/python3
    ...
```

The packaged app looks for `resources/python/bin/python3` — electron-builder copies the matching architecture's folder there at build time (see `build.mac.target` in `package.json`).

### 2) Install site-packages into each runtime

Each bundle includes its own `pip`, so install directly (no cross-platform wheel targeting needed, unlike Windows):
```
python/mac-arm64/bin/python3 -m pip install -r server/requirements.txt
python/mac-x64/bin/python3 -m pip install -r server/requirements.txt
```
On Apple Silicon, the `mac-x64` leg runs the x86_64 interpreter under Rosetta 2 (install it first if needed: `softwareupdate --install-rosetta`) — pip still resolves and installs the correct x86_64 wheels since it's driven by the actual x86_64 interpreter.

### 3) Package for macOS

```
npm run build
npm run package:mac
```
This produces both `release/mac-arm64/Adeo.app` and `release/mac-x64/Adeo.app` (dmg + zip), each with its matching bundled Python.

### Known gap: Linux

`package:linux` does not bundle Python either — the same fix (a standalone runtime under `python/`, referenced from `build.linux.extraResources`) would be needed if that becomes necessary; it's currently out of scope.

## Background reminder notifications (macOS: bundling terminal-notifier)

Reminders fire even when Adeo isn't running via a per-OS background scheduler (a LaunchAgent on macOS, a Scheduled Task on Windows, a systemd user timer on Linux — see `ensureBackgroundReminderService()` in `src/main.ts`) that invokes `server/reminder_notifier.py`. On macOS, posting a *clickable* notification from that standalone script (one that can launch Adeo via `adeo://open-task/<id>` when clicked) requires the [terminal-notifier](https://github.com/julienXX/terminal-notifier) CLI, since plain `osascript display notification` has no click-action support.

```
curl -L -o terminal-notifier.zip \
  https://github.com/julienXX/terminal-notifier/releases/download/2.0.0/terminal-notifier-2.0.0.zip
unzip terminal-notifier.zip -d vendor/mac
rm terminal-notifier.zip

# Required: the downloaded .app is completely unsigned, and macOS silently
# drops notifications from unsigned bundles (no prompt, no error — it just
# never appears). Ad-hoc signing it is enough:
codesign --force --deep --sign - vendor/mac/terminal-notifier.app
```

Expected layout: `vendor/mac/terminal-notifier.app/Contents/MacOS/terminal-notifier`. `package:mac`'s `extraResources` copies this into the packaged app (see `mac.extraResources` in `package.json`); the signature survives that copy, so this only needs to be done once per download, not per build.

`terminal-notifier`'s binary is x86_64-only (no arm64 build), so it runs under Rosetta 2 on Apple Silicon — `ensureBackgroundReminderService()` does a one-time synchronous invocation when installing the LaunchAgent specifically to surface any first-run Rosetta-install prompt during a normal interactive app launch, rather than silently inside the background LaunchAgent later.

Windows uses a bundled PowerShell script (`server/reminder_notify_windows.ps1`) instead — no extra download needed, since `New-ToastNotification`-style APIs are built into Windows. Linux's click-through support depends on the desktop environment's notification daemon and is best-effort (see `notify_linux()` in `reminder_notifier.py`).

## Python references

- Windows embeddable packages: https://www.python.org/downloads/windows/
- macOS/Linux standalone builds: https://github.com/astral-sh/python-build-standalone
- Python license: https://docs.python.org/3/license.html
