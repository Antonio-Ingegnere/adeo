# Adeo visual baseline

This directory contains the Phase P0.5 reference capture of the current Electron UI.
It is descriptive evidence, not an automatic approval mechanism. A later screenshot
change requires an approved UX decision or explicit user approval.

## Capture command

From the Adeo repository root:

```text
npm run build
node ui-ux/ux/baselines/capture-baseline.mjs
```

The capture script uses `ADEO_UI_TEST=1`, a temporary SQLite database, a temporary
Electron `userData` directory, and a temporary Chromium bootstrap directory. It removes
those temporary files after each theme and never uses `ADEO_API_URL`.

## Matrix

The baseline captures every combination of:

- Theme: light, dark
- Window size: 800×600, 1280×800
- Fixture/state:
  - `empty`
  - `populated`
  - `valid-query`
  - `invalid-query`
  - `edit-dialog`
  - `settings-general`
  - `settings-tasks`
  - `settings-shortcuts`

Expected total: 32 PNG files.

On macOS, each PNG contains the Electron renderer content rather than the native title
bar. The requested 800×600 and 1280×800 window sizes therefore produce 800×568 and
1280×768 images in this environment. Both the requested window size and measured renderer
viewport are recorded in `manifest.json`.

## Deterministic fixture

The populated state creates the same lists, tags, tasks, priorities, details, reminder,
completion, and repeat data in a fresh isolated database. Renderer time is fixed to
2026-08-22 before Settings is opened so its date-format example is reproducible.

## Evidence

`manifest.json` records every screenshot's relative path, source commit, visual-source
cleanliness, theme, fixture, requested Electron window size, measured renderer viewport,
capture command, timestamp, and runtime versions.

The source commit identifies the checked-in visual implementation. If the broader worktree
is dirty, the manifest records that separately. The capture must stop if tracked visual
source files differ from `HEAD` so a baseline is never mislabeled with the wrong commit.

## Directory layout

```text
baselines/
  README.md
  capture-baseline.mjs
  manifest.json
  images/
    light/
      800x600/
      1280x800/
    dark/
      800x600/
      1280x800/
```
