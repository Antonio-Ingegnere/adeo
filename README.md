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

## Build a self-sufficient Linux app (bundled Python)

Like macOS, Linux packaging bundles a standalone Python runtime per architecture so end
users don't need Python installed: `python/linux-x64/` and `python/linux-arm64/`.

### 1) Download a standalone Python runtime per architecture

Get the `install_only` build for Python 3.12.x from
[python-build-standalone](https://github.com/astral-sh/python-build-standalone/releases),
e.g.:
```
curl -L -o cpython-linux-x64.tar.gz \
  https://github.com/astral-sh/python-build-standalone/releases/download/<tag>/cpython-3.12.x+<tag>-x86_64-unknown-linux-gnu-install_only.tar.gz
tar -xzf cpython-linux-x64.tar.gz
mv python python/linux-x64

curl -L -o cpython-linux-arm64.tar.gz \
  https://github.com/astral-sh/python-build-standalone/releases/download/<tag>/cpython-3.12.x+<tag>-aarch64-unknown-linux-gnu-install_only.tar.gz
tar -xzf cpython-linux-arm64.tar.gz
mv python python/linux-arm64
```

Expected layout:
```
python/
  linux-x64/
    bin/python3
    ...
  linux-arm64/
    bin/python3
    ...
```

The packaged app looks for `resources/python/bin/python3` — electron-builder copies the
matching architecture's folder there at build time, the same way macOS does.

### 2) Install site-packages into each runtime

```
python/linux-x64/bin/python3 -m pip install -r server/requirements.txt
python/linux-arm64/bin/python3 -m pip install -r server/requirements.txt
```
Cross-architecture installs (e.g. installing into `linux-arm64` from an x64 build host)
require either emulation (e.g. `binfmt_misc`/QEMU) to run that interpreter directly, or
running this step on a matching native or CI host; `pip` has no cross-arch `--platform`
wheel-targeting path for Linux manylinux wheels the way Windows does.

### 3) Package for Linux

```
npm run package:linux
```
This produces `release/linux-x64/Adeo.AppImage` and `release/linux-arm64/Adeo.AppImage`
for whichever `python/linux-*` bundles are present, each with its matching bundled
Python. Running the AppImage requires a Linux desktop environment with the usual
AppImage/FUSE prerequisites; Adeo does not depend on a system Python, pip or any other
separately installed runtime.

### Bundle verification

All three `npm run package:*` entry points run `scripts/after-pack-verify.js` as an
electron-builder `afterPack` hook after every architecture is packaged. It checks, for
the architecture that was just built, that the bundled Python binary and its
`site-packages` contain fastapi/uvicorn/pydantic/python-dateutil and their native/
transitive dependencies, and that `server/app.py` and `server/reminder_notifier.py` were
copied into the release's resources. When the host can run that architecture's
interpreter directly (same OS/arch, or x64 under Rosetta 2 on Apple Silicon), it also
spawns the bundled interpreter with a clean environment and imports those packages. Any
gap fails the build with a specific list of what is missing, instead of silently
producing an incomplete release.

After packaging, `npm run test:packaged` launches the actual built app for the current OS
(from `release/`, override with `ADEO_PACKAGED_APP`) with isolated user data, confirms its
bundled Python serves a healthy local API with no `ADEO_PYTHON_BIN`/dev assistance, and
exercises task create/read/update/restart-persistence against it directly — the same
backend the window's UI calls. It does not drive the Electron UI itself: packaged
(asar) Electron apps refuse the `NODE_OPTIONS` injection Playwright's Electron driver
relies on, so this talks to the bundled FastAPI server over loopback HTTP instead.

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

## Delivery workflow

Install the pinned Python delivery dependency with `.venv/bin/python -m pip install -r requirements-delivery.txt`.
Use `/deliver feature "request"` or `/deliver bugfix "report"`, then human QA and `/accept`
or `/qa-fix "feedback"`. Use `/deliver resume` after an interruption, or `/deliver rollback [reason]`
to discard the attempt safely. `SWITCHYARD_ROOT` is not required.
See [Switchyard setup, verification and migration](docs/agent/switchyard-delivery.md).
