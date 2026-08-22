# P0.5 implementation review: reproducible visual baseline

**Status:** PASS
**Reviewer:** Codex implementation verification
**Review date:** 2026-08-22
**Classification:** Descriptive baseline evidence; no UX decision required
**Production base:** `99dab6e602edefd3975e1cbe7defb72a24786c64`
**Build under review:** `npm run build && node ui-ux/ux/baselines/capture-baseline.mjs`

## Outcome

P0.5 meets its acceptance criteria. The repository-local baseline contains all 32 required
theme, window-size, and fixture combinations. The capture is deterministic, fails if the
tracked visual sources differ from the recorded commit, and launches Adeo only through the
P0.4 fail-closed isolation seam. This baseline describes the current UI; it does not approve
the current UI as a future design direction.

## Requirement-to-evidence traceability

| Requirement / acceptance criterion | Evidence | Result |
|---|---|---|
| Light and dark themes | `../baselines/images/light/` and `../baselines/images/dark/`; manifest contains 16 entries per theme | PASS |
| 800×600 and 1280×800 Electron windows | Both size directories exist in each theme; every manifest entry records requested window size and measured renderer viewport | PASS |
| Empty and populated data | `empty.png` and `populated.png` exist for every theme/size combination | PASS |
| Valid and invalid query states | `valid-query.png` shows one `priority:high` result; `invalid-query.png` shows the parser error and retained last-valid result | PASS |
| Edit dialog and every Settings tab | `edit-dialog.png`, `settings-general.png`, `settings-tasks.png`, and `settings-shortcuts.png` exist for every theme/size combination | PASS |
| Per-image provenance | All 32 manifest entries record file, source commit, visual-source cleanliness, theme, fixture, requested window size, renderer viewport, command, and timestamp | PASS |
| Reproducible from repository instructions | `../baselines/README.md` documents the two commands, matrix, deterministic fixture, isolation, provenance, and macOS viewport behavior | PASS |
| No real data access | Capture uses `ADEO_UI_TEST=1` with fresh absolute database, `userData`, and Chromium bootstrap paths under the OS temp directory; P0.4 rejects missing paths | PASS |

## Evidence environment

- Source commit: `99dab6e602edefd3975e1cbe7defb72a24786c64`
- Visual-source state: `index.html`, `styles.css`, and `src/renderer/` matched `HEAD`
- OS/runtime: macOS arm64; Node `v26.7.0`; Electron `39.2.6`; Playwright Core `1.62.1`
- Themes: light and dark
- Electron window sizes: 800×600 and 1280×800
- Renderer viewports on this macOS run: 800×568 and 1280×768
- Fixtures: empty, populated, valid query, invalid query, edit dialog, and three Settings tabs
- Fixture/database: deterministic fixture in a new temporary SQLite database for each theme
- Electron `userData`: new temporary directory for each theme, removed when that run closes
- Fixed renderer time: `2026-08-22T10:00:00.000Z`
- Capture command: `npm run build && node ui-ux/ux/baselines/capture-baseline.mjs`
- Confirmation of real-data isolation: the production process can start in UI-test mode only
  when both isolated absolute paths pass the P0.4 validation; the capture supplies both and
  removes only its validated OS-temp roots

## Visual inspection

Representative screenshots were inspected across both themes and sizes, including empty,
populated, valid query, invalid query, edit dialog, and all Settings tabs. Dialogs fit within
both requested window sizes. At 800×600, the existing Shortcuts settings content uses its
current internal vertical overflow behavior; the baseline records that behavior rather than
changing or approving it.

The macOS native title bar is not part of Playwright's renderer screenshot. Consequently,
the 800×600 and 1280×800 Electron windows produce PNGs measuring 800×568 and 1280×768. The
manifest records both measurements, so this is explicit provenance rather than ambiguity.

## Scope checks and follow-up

- No product UI source was modified for P0.5.
- No baseline was accepted to conceal a regression; tracked visual sources were required to
  match the recorded source commit before capture.
- Accessibility behavior was not evaluated by this descriptive screenshot task. Automated
  axe, keyboard, zoom, and reduced-motion coverage remains assigned to later roadmap phases.
- The files are present under the Adeo repository and ready for an explicitly authorized Git
  operation; this review did not stage or commit them.
