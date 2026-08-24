# P1.1 implementation review: design-token extraction

**Status:** PASS
**Reviewer:** Codex implementation verification
**Review date:** 2026-08-22
**Classification:** Structure-only maintenance; no UX decision required
**Production base:** `e7fc05bf93714b13b40804b7d713679d4d1847d0` plus the reviewed worktree diff
**Build under review:** `npm run build`

## Outcome

P1.1 meets its acceptance criteria. Adeo's base tokens and dark-theme overrides now live
in importable production CSS files, while names, declared values, computed values, cascade,
and rendered states remain unchanged. `styles.css` retains only component/layout rules and
the dark-scheme exceptions that cannot be expressed as variables.

## Requirement-to-evidence traceability

| Requirement / acceptance criterion | Evidence | Result |
|---|---|---|
| Extract color, typography, radius, and elevation variables | `../../../styles/tokens.css` contains the complete 70-token base set | PASS |
| Extract dark-theme variables | `../../../styles/themes.css` contains all 57 existing dark overrides under the existing media query | PASS |
| Preserve names and declared values | Ordered declaration diff against `git show HEAD:styles.css` produced no differences | PASS |
| Production app imports extracted files | The first two rules in `../../../styles.css` import tokens then themes | PASS |
| Built app contains imports | `npm run build` copied byte-identical files to `dist/styles/`; both TypeScript compilations passed | PASS |
| Preserve computed cascade | Candidate manifests reported the same 70 non-empty computed properties for light and dark before and after extraction | PASS |
| No unintended matrix differences | All 32 Phase 0 fixture/theme/size combinations were captured before and after; decoded deltas stayed below the measured unchanged-run compositor envelope | PASS |
| Preserve existing behavior and isolation | 103 query cases, 132 shortcut cases, and 34 isolation checks passed | PASS |

## Visual comparison evidence

The harness captured normalized pre- and post-extraction matrices to separate validated
directories under `os.tmpdir()`. It used the Phase 0 fixture, fixed renderer time, isolated
SQLite and Electron `userData`, light/dark themes, and 800×600/1280×800 windows. The
committed Phase 0 images and manifest were not regenerated.

Raw PNG bytes are not a reliable equality signal in Electron on this macOS runner. Two
unchanged reduced-motion captures established the compositor envelope:

- maximum changed pixels in one image: 3,436;
- maximum per-channel delta: 15;
- maximum summed channel delta in one image: 9,726.

The extraction comparison was smaller than that unchanged-run envelope:

- 25 of 32 images were raw-byte identical;
- seven images contained decoded differences;
- maximum changed pixels in one image: 2,099;
- maximum per-channel delta: 15;
- maximum summed channel delta in one image: 5,681;
- the largest region was the existing Electron modal shadow; remaining differences were
  isolated antialias pixels at modal/focus edges.

Representative empty, populated, valid-query, invalid-query, edit-dialog, and Settings
screenshots were inspected in both themes and both size classes with no visible difference.
More importantly for this task, all computed token names and values matched exactly.

## Evidence environment and commands

- Source base: `e7fc05bf93714b13b40804b7d713679d4d1847d0`
- OS/runtime: macOS arm64; Electron `39.2.6`; Playwright Core `1.62.1`
- Themes: light and dark
- Electron windows: 800×600 and 1280×800
- Fixtures: all eight Phase 0 states
- Token counts: 70 base declarations; 57 dark overrides; 70 computed properties per theme
- Commands: `npm run build`, both Node self-tests, `npm run test:isolation`, temporary
  candidate captures, ordered declaration diff, computed-token JSON diff, and decoded BMP
  pixel comparison
- Real-data confirmation: the 34-check isolation suite passed after extraction

## Scope and follow-up

- No token was added, removed, renamed, consolidated, or given a new value.
- No selector, markup, renderer behavior, layout, or spacing value changed.
- Spacing token definition remains P1.2.
- Storybook consumption of these files remains P1.3.
- No Git state or unrelated agent configuration was modified by this review.
