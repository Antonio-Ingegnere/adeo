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

## Python references

- Windows embeddable packages: https://www.python.org/downloads/windows/
- Python license: https://docs.python.org/3/license.html
