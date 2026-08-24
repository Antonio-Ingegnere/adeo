# UX implementation review: <feature>

**Status:** DRAFT | PASS | PASS WITH FOLLOW-UP | BLOCKED
**Reviewer:** Product Design Agent
**Review date:** YYYY-MM-DD
**UX decision:** <relative link>
**Production commit/diff:** <SHA or range>
**Build under review:** <command/artifact>

## Outcome

<One paragraph stating whether the implementation matches the approved decision. The
Product Design Agent may report PASS/BLOCKED against criteria but does not approve a new
product direction.>

## Requirement-to-evidence traceability

| Requirement / acceptance criterion | Evidence (story, test, screenshot, selector, steps) | Result | Finding ID |
|---|---|---|---|
| | | PASS / FAIL / NOT TESTED | |

## Evidence environment

- Source commit:
- OS/runtime:
- Theme(s):
- Viewport(s):
- Fixture/database:
- Electron `userData` path:
- Commands:
- Confirmation that real development/user data was unchanged:

## Findings

### <F-01: concise finding>

**Severity:** Blocking | High | Medium | Low
**Requirement:** <criterion>
**Reproduction:** <numbered deterministic steps>
**Evidence:** <link or artifact>
**Expected:** <approved behavior>
**Actual:** <observed behavior>
**Suggested scope:** <focused correction, not unapproved redesign>
**Owner / due task:** <role and roadmap ID>

## Accessibility review

- [ ] Keyboard-only critical flow completed.
- [ ] Focus order, dismissal, and restoration verified.
- [ ] Names, roles, states, and announcements inspected.
- [ ] Axe run on every revealed state; report attached.
- [ ] Light/dark and non-color state cues reviewed.
- [ ] 200% zoom and reduced-motion behavior reviewed.
- [ ] Touch path reviewed where in scope.

## Responsive review

| Viewport | Theme/state | Result | Evidence |
|---|---|---|---|
| 1440px | | | |
| 1024px | | | |
| 768px | | | |
| 390px | | | |

## Gaps and follow-up

- <Untested behavior, accepted limitation, owner, and due roadmap task>

## Final traceability check

- [ ] Every blocking claim has reproducible evidence.
- [ ] Expected visual changes link to the approved UX decision.
- [ ] No baseline was regenerated merely to hide a regression.
- [ ] Every new/touched component spacing declaration uses `--space-*` or records an inline
  `spacing-exception` and repeats its rationale in this review.
- [ ] No production files, tests, dependencies, plans, or Git state were modified by the
  Product Design Agent during this review.
