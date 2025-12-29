# Electron Hello World

Simple TypeScript-based Electron boilerplate that opens a single window showing "Hello World".

## Setup

1. Install dependencies: `npm install`
2. Build and run: `npm start`

The entry point is compiled from `src/main.ts` to `dist/main.js`, which creates a `BrowserWindow` loading `index.html`. The preload script (`src/preload.ts`) runs in an isolated context and populates the displayed Electron version.

## Bundled Python (Windows)

To ship a self-sufficient Windows build, place the embeddable Python zip contents under `python/`.

Expected layout (example):
```
python/
  python-3.14.2-embed-amd64/
    python.exe
    python314._pth
    ...
```

The app will search `resources/python/python.exe` and also `resources/python/*/python.exe` when packaged.

### Add FastAPI deps to the embedded Python

1. Create a venv and install deps:
```
python -m venv .venv
.venv\Scripts\activate
pip install fastapi uvicorn
```
2. Copy packages into the embedded Python:
```
.\.venv\Lib\site-packages\fastapi
.\.venv\Lib\site-packages\uvicorn
.\.venv\Lib\site-packages\starlette
.\.venv\Lib\site-packages\pydantic
.\.venv\Lib\site-packages\typing_extensions.py
```
3. Edit the `.pth` file inside the embedded folder (e.g. `python314._pth`):
   - Add `Lib\site-packages`
   - Ensure `import site` is uncommented

Then build and package:
```
npm run build
npm run package:win
```
