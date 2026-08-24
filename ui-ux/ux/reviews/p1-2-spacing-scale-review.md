# P1.2 implementation review: forward-only spacing scale

**Status:** PASS
**Reviewer:** Codex implementation verification
**Review date:** 2026-08-22
**Classification:** Approved roadmap design-system convention; no user-visible change
**Production base:** `e7fc05bf93714b13b40804b7d713679d4d1847d0` plus the reviewed P1.1/P1.2 worktree diff
**Build under review:** `npm run build`

## Outcome

P1.2 meets its acceptance criteria. Adeo now has a production spacing scale derived from
the dominant rhythm in its current CSS, plus an explicit forward-only adoption and exception
policy. No existing component spacing declaration was rewritten and no current layout or
appearance changed.

## Requirement-to-evidence traceability

| Requirement / acceptance criterion | Evidence | Result |
|---|---|---|
| Derive the scale from Adeo rather than a generic system | Audit counts show 2/4/6/8/10/12/16/20/24/32px are the dominant positive padding, margin, and gap values | PASS |
| Define the scale in production code | `../../../styles/tokens.css` contains `--space-0`, `--space-2`, `--space-4`, `--space-6`, `--space-8`, `--space-10`, `--space-12`, `--space-16`, `--space-20`, `--space-24`, and `--space-32` | PASS |
| Document token values and intended roles | `../patterns.md` contains the complete table and states that suffixes are literal pixel values | PASS |
| Avoid mechanical legacy rewrite | P1.2 added declarations only; existing `styles.css` spacing literals and component selectors were untouched | PASS |
| Define adoption boundary | `../patterns.md` limits scale usage to component-owned margin, padding, gap, and spacing insets in new/materially touched components | PASS |
| Define exception handling | Code comment, patterns, and `template.md` require an inline `spacing-exception` plus review rationale | PASS |
| Do not misuse spacing tokens as geometry | Patterns explicitly exclude borders, dimensions, icons, typography, transforms, and shadows | PASS |
| Preserve existing design tokens | All 70 pre-P1.2 computed properties matched exactly in light and dark after the change | PASS |
| Make new tokens theme-independent | All 11 spacing properties resolve to the same declared values in both themes and none is overridden in `themes.css` | PASS |
| Preserve current visuals and behavior | Full 32-state matrix remained within unchanged-renderer noise; build and all regression suites passed | PASS |

## Scale evidence

The `styles.css` audit counted literal positive values in `padding`, `margin`, and `gap`
declarations. The chosen scale covers the repeated values that define the current compact
rhythm: 2px (25 uses), 4px (37), 6px (40), 8px (52), 10px (28), 12px (20),
16px (13), 20px (4), 24px (4), and 32px (3), plus an explicit zero token.

Less common values were not promoted merely because they exist. Values such as 1, 3, 5, 7,
9, 14, 18, and 26px are retained as legacy optical/geometry choices. If a future component
touches one, it must either adopt the nearest scale value through a reviewed visual change or
record a `spacing-exception`.

No component was created by P1.2 itself. The rule becomes enforceable for the Storybook and
component work beginning in P1.3/P1.4, and the shared review template now carries the check.

## Visual and computed-token evidence

Pre/post candidate captures used isolated temporary database and Electron `userData` paths,
fixed renderer time, reduced motion, both themes, both window sizes, and all eight Phase 0
states. The committed Phase 0 baseline was not regenerated.

- Original computed tokens: 70 of 70 identical in both themes.
- New computed spacing tokens: 11 of 11 exact and identical across themes.
- Raw-byte identical screenshots: 27 of 32.
- Decoded differences: five images, limited to the established modal/compositor edge noise.
- Maximum changed pixels in one image: 3,436 (unchanged-run ceiling: 3,436).
- Maximum per-channel delta: 15 (unchanged-run ceiling: 15).
- Maximum summed channel delta: 9,726 (unchanged-run ceiling: 9,726).

Because no selector consumes a spacing token yet, an actual product-layout difference would
indicate an import/cascade regression and block the task. None was observed.

## Verification

```text
npm run build
  PASS; source and dist/styles/tokens.css are byte-identical

node scripts/query-selftest.mjs
  All 103 query cases passed

node scripts/shortcuts-selftest.mjs
  All 132 shortcut cases passed

npm run test:isolation
  Isolation self-test passed (34 checks)
```

The two pure Node tests emit their existing module-type performance warning. It is unrelated
to P1.2 and does not represent a failure.

## Remaining scope

- Existing literal spacing remains intentionally in place.
- P1.3 must use the scale for any new Storybook-owned layout CSS.
- P1.4 and P1.6 reviews must enforce token use for extracted component spacing.
- Responsive/mobile spacing variants remain outside P1.2.
- No Git operation or unrelated agent-configuration change was performed.
