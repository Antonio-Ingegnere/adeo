# P2.1 implementation review: concept fixtures and dependency boundary

**Status:** DONE — 2026-08-24
**Reviewer:** Codex implementation verification
**Review date:** 2026-08-24
**Classification:** Approved design-lab infrastructure; no product-direction change
**Production base:** `4721d97` plus the reviewed Phase 1 exit and P2.1 worktree diff
**Build under review:** `npm run build` and `npm run storybook:build`

## Outcome

P2.1 is complete. Storybook now has a top-level `Concepts` hierarchy with the stable story
`concepts-fixture-catalog--deterministic-states`. Its populated, empty, and recoverable-error
fixtures use fixed IDs, a fixed ISO clock, explicit task/tag data, and runtime-frozen arrays
and objects. They do not read Electron services, application state, the current time, or
random values.

The fixture catalog consumes production tag chips, sidebar pills, shortcut keycaps, CSS,
and design tokens. The reverse direction is blocked: `npm run check:ux-boundary` scans
production TypeScript, JavaScript, Python, CSS, and HTML imports and fails when a resolved
specifier enters `ui-ux/ux`. The guard includes a rejecting self-check and runs before both
the production and Storybook builds. The production `dist` contains no concept markers.

## Requirement-to-evidence traceability

| Requirement / acceptance criterion | Evidence | Result |
|---|---|---|
| Add `ux/concepts/` under top-level `Concepts` | `.storybook/main.ts` explicitly discovers `ux/concepts/**/*.stories.ts`; the Storybook index contains the stable `Concepts/Fixture catalog` story | PASS |
| Create deterministic UI fixtures | `concepts/fixtures.ts` exports frozen populated, empty, and error fixtures with fixed IDs and `2026-08-24T09:30:00+02:00`; Chrome rendered the same three IDs and timestamps in all eight cases | PASS |
| Concepts may consume production components and tokens | The catalog imports `createTagChip`, `createSidebarPill`, and `createShortcutKeycaps`; Storybook loads production CSS and theme tokens | PASS |
| Production imports no UX concept code | `npm run check:ux-boundary` passed across 42 production files; its self-check rejects a representative `src/renderer` → `ui-ux/ux` import | PASS |
| Enforce direction at build time | `npm run build` and `npm run storybook:build` both execute the guard first | PASS |
| Keep concept code out of production output | Search of `dist` found no fixture IDs, catalog title, or catalog bundle marker | PASS |
| Preserve accessibility enforcement | The story inherits project-wide `a11y.test: 'error'`; light and dark each report zero violations | PASS |
| Preserve the spacing policy | Every concept-owned margin, padding, and gap uses `--space-*`; no exception is required | PASS |

## Chrome matrix

| Viewport | Light | Dark | Horizontal overflow |
|---|---:|---:|---:|
| 1440×900 | PASS | PASS | None |
| 1024×768 | PASS | PASS | None |
| 768×1024 | PASS | PASS | None |
| 390×844 | PASS | PASS | None |

All eight cases rendered the expected theme, the same three fixture IDs, the fixed timestamp,
and the recoverable error message. At the 1440px accessibility scan, each theme reports
0 violations, 26 passes, and 1 inconclusive rule. The inconclusive nodes are the three
symbol-only `⌘` keycaps; the inherited production pairing was manually verified during P1.5
at 14.85:1 light and 14.48:1 dark. A story-owned unsupported `aria-label` uncertainty found
during the first scan was corrected with explicit group roles before this final matrix.

## Visual evidence

- [Light fixture catalog, desktop 1440](evidence/p2-1-fixtures-light-desktop-1440.jpg)
- [Dark fixture catalog, mobile 390](evidence/p2-1-fixtures-dark-mobile-390.jpg)

The captures confirm the three-column desktop catalog, single-column mobile flow, readable
fixed data, production component reuse, light/dark theming, and visible empty/error states.

## Verification

```text
npm run check:ux-boundary
  PASS; guard self-check and 42 production files

npm run build
  PASS; dependency guard runs first

npm run storybook:build
  PASS; dependency guard runs first and concept story is indexed

Production dist concept-marker search
  PASS; no concept code markers found

node scripts/query-selftest.mjs
  PASS; all 103 query cases

node scripts/shortcuts-selftest.mjs
  PASS; all 132 shortcut cases

npm run test:isolation
  PASS; 34 checks and protected user data unchanged

Chrome rendered-state verification
  PASS; 8 of 8 theme/viewport cases, no horizontal overflow
  PASS; zero axe violations in light and dark

git diff --check
  PASS
```

## Gaps and next gate

- P2.1 deliberately supplies data and lab infrastructure only. It does not propose or imply
  approval of a Quick Add direction.
- P2.2 must create the compact/current-direction, command-style, and touch-first alternatives
  as separate interactive stories using these fixtures. Benefits, trade-offs, complexity,
  keyboard behavior, empty/error behavior, and platform implications must accompany each.
- No real user/development database was accessed. Unrelated `.claude` changes were not
  modified.
