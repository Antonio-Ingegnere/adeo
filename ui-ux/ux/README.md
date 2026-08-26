# Adeo UX workspace

This directory is the source of truth for Adeo product-design work. It is a restricted
subtree inside the production repository so UX artifacts and implementation can share a
commit while the Product Design Agent remains unable to modify application code.

## Workspace boundary

- UX workspace: `adeo/ui-ux/ux/`
- Production source: the `adeo/` repository root (`../../` from this file)
- Product Design Agent writes: this `ux/` directory only
- Product Design Agent reads: this directory and the production source
- Production changes: only through the approved plan at
  `../../.claude/plans/current.md`
- Approval: only the user/product owner can approve a concept or decision

Concept code is exploratory. Production code must never import from `ux/`, and a
concept must not be described as shipped until a production review verifies it.

## Required reading order

1. [principles.md](principles.md)
2. [patterns.md](patterns.md)
3. [responsive.md](responsive.md)
4. [accessibility.md](accessibility.md)
5. [content.md](content.md)
6. [component-inventory.md](component-inventory.md)
7. The brief, decision, or review relevant to the current request
8. The production files named by those artifacts

## Workflow

```text
Requirement
  -> ux/briefs/<feature>.md
  -> Storybook concepts and comparison
  -> user approval
  -> ux/decisions/NNNN-<decision>.md
  -> ../../.claude/plans/current.md
  -> implementation
  -> ux/reviews/<feature>-review.md
```

Use the templates in `briefs/`, `decisions/`, and `reviews/`. A brief may be revised
without approval. A decision is not approved until its status, approver, and approval
date are filled in by, or at the explicit direction of, the user.

## Storybook

Run `npm run storybook` from the repository root for the local design-system workspace,
or `npm run storybook:build` to verify the static build. Storybook imports production
`styles.css`; its theme control derives light and dark values from the production token files.
Concept stories live under `concepts/` and appear only beneath Storybook's top-level
`Concepts` hierarchy. `npm run check:ux-boundary` rejects production imports from this UX
workspace, and both production and Storybook builds run that guard first.
The deterministic fixture catalog has the stable story ID
`concepts-fixture-catalog--deterministic-states`. A second story,
`concepts-fixture-catalog--app-shell`, adds the real Lists/Smart lists/Tags sidebar, multiple
lists, a smart list, an "All lists" aggregate, recurring-task/reminder states, and working sidebar
drag-reorder, view-picker switching, and keyboard task navigation — added when P2.1 was reopened a
second time on 2026-08-25 because the flat catalog didn't represent enough of Adeo's real feature
surface. See `ux/reviews/p2-1-concept-fixtures-review.md` for the reopened findings.
The P2.2 Quick Add pilot has three stable review IDs:
`concepts-quick-add-pilot--compact-current-direction`,
`concepts-quick-add-pilot--command-style`, and
`concepts-quick-add-pilot--touch-first`. P2.1 and P2.2 were revalidated after migrating task
context to one shared production-aligned preview and replacing P2.2's custom task-view shell with
production view, compose, input, suggestion, metadata, Add, and task classes. Storybook fixture
controls are explicitly labelled outside Adeo. Tasks with details demonstrate production expanded
and collapsed double-chevron states plus visible Markdown heading, emphasis, inline-code, list,
rule, and paragraph rendering. All three alternatives now mount inside the same P2.1 app-shell
(real Lists/Smart lists/Tags sidebar, working view picker, sidebar drag-reorder) via
`createAppShellPreview`'s injectable-composer option, added when P2.2 was reopened a second time on
2026-08-25 — see `ux/reviews/p2-2-quick-add-pilot-review.md` (findings P2.2-F06/F07).
[UX decision 0001](decisions/0001-quick-add-direction.md) remains `PROPOSED` until the (now
shell-based) evidence is reviewed. The earlier Compact/current-direction selection is retained as
history, not active approval.

## Evidence rules

- Reference production files relative to this workspace, for example
  `../../src/renderer/tasks.ts`.
- Record the source commit, viewport, theme, fixture, and command for screenshots.
- Give each Storybook concept a stable story ID and retain rejected alternatives until
  the decision is recorded.
- Link every blocking review finding to reproducible evidence.
- State when evidence is unavailable; do not infer that an untested behavior works.
- Never launch UI automation without isolated database and Electron `userData` paths.

## Directory map

```text
ux/
  README.md
  principles.md
  patterns.md
  responsive.md
  accessibility.md
  content.md
  component-inventory.md
  briefs/
    template.md
  decisions/
    template.md
  reviews/
    template.md
  stories/        # Storybook design-system smoke and future UX stories
  concepts/       # deterministic fixtures and non-production Storybook explorations
  baselines/      # reproducible visual baseline capture, images, and manifest
```

## Baseline provenance

This initial documentation audit was performed on 2026-08-20 against Adeo commit
`99dab6e602edefd3975e1cbe7defb72a24786c64`. The production worktree also contained
uncommitted agent-configuration changes; those are user-owned and were not treated as
product behavior.
