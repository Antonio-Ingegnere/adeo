# UI/UX Agent Integration Plan

## Goal

Integrate a repository-aware Product Design Agent into Adeo's existing
architect/implementer workflow. The agent must be able to review requirements,
create isolated interactive concepts, enforce the design system, and review the
running implementation without modifying production code or using real user data.

The target outcome is a repeatable workflow:

```text
Requirement
  -> Product Design review and concepts
  -> User approval and UX decision record
  -> Architect implementation plan
  -> Implementer production changes
  -> Automated and Product Design review
```

## SMART conventions

Every task below is:

- **Specific:** it names the artifact or behavior to create.
- **Measurable:** the Done column defines evidence that can be checked.
- **Achievable:** it builds on Adeo's current plain TypeScript, HTML, CSS,
  Electron, and FastAPI architecture rather than requiring a framework rewrite.
- **Relevant:** it directly enables design exploration, consistency, approval,
  or implementation QA.
- **Time-bound:** its target is expressed in working days from the start of its
  phase. A phase does not start until its dependencies are complete.

Working-day targets are planning limits, not permission to skip acceptance
criteria. If a task exceeds its target, record the reason and revise the remaining
forecast before continuing.

## Scope and guardrails

- Storybook will use the HTML/Vite renderer; adopting React is not part of this plan.
- Storybook will be the first Design Lab. A second design application will only be
  considered if Storybook proves insufficient in actual use.
- The Product Design Agent may write UX documentation and isolated concept code
  under `ux/`. It may not modify production code, tests, dependencies, or Git state.
- Only the user can approve a concept or UX decision.
- Production implementation continues through `.claude/plans/current.md` and the
  existing architect/implementer approval gate.
- Automated UI tests must use a temporary database and temporary Electron user-data
  directory. They must never fall back to the development or user database.
- The current dialog rollback must finish before any dialog component extraction or
  redesign is proposed.
- Axe and screenshot checks supplement manual keyboard, screen-reader, responsive,
  and product-design review; they do not replace it.
- The `ui-ux` workspace lives inside the Adeo repository so UX decisions, baselines,
  and their production implementation can be reviewed against the same commit.
- P0.5 baseline capture must not begin until the user gives separate formal approval.

## Workspace layout

The roadmap and design artifacts live in a restricted subtree of the Adeo repository:

```text
adeo/
  src/        # production source
  server/
  .claude/    # implementation workflow
  ui-ux/
    UI_UX_AGENT_INTEGRATION_PLAN.md
    ux/       # Product Design Agent's only writable subtree
```

Paths beginning with `ux/` in this plan are relative to `ui-ux/`. Paths beginning
with `.claude/`, `src/`, `server/`, or other application paths are relative to
the Adeo repository root one directory above `ui-ux/`. This boundary is intentional:
design exploration can read the product source, but production modules must never import
from the UX workspace.

## Roles

| Role | Responsibility |
|---|---|
| User / product owner | Approves concepts, UX decisions, priorities, and scope changes. |
| Product Design Agent | Reviews requirements, creates concepts, writes UX artifacts, and reviews implementations. |
| Architect Agent | Converts an approved UX decision into the technical implementation plan. |
| Implementer Agent | Changes production code and adds the tests required by the approved plan. |
| Git Agent | Performs explicitly authorized version-control work after changes have been reviewed. |

## Phase 0 — Document the baseline and make testing safe

**Phase objective:** establish the source of truth for UX decisions and guarantee
that later UI automation cannot touch real Adeo data.

**Target duration:** 5 working days.

| ID | SMART task | Owner | Done / measurement | Target | Depends on |
|---|---|---|---|---|---|
| P0.1 | Create `ux/` with `README.md`, `principles.md`, `patterns.md`, `responsive.md`, `accessibility.md`, `content.md`, and `component-inventory.md`. | Product Design Agent + user | All seven files exist; each identifies Adeo-specific rules rather than generic advice; the user approves the principles. | Day 2 | None |
| P0.2 | Add templates at `ux/briefs/template.md`, `ux/decisions/template.md`, and `ux/reviews/template.md`. | Product Design Agent | The brief template requires user goal, flow, states, edge cases, accessibility, platform implications, and acceptance criteria. The decision template requires alternatives, chosen story ID, rationale, risks, status, approver, and approval date. The review template contains requirement-to-evidence traceability. | Day 2 | P0.1 |
| P0.3 | Inventory the current reusable UI behaviors, CSS tokens, component-like patterns, and known accessibility gaps. | Product Design Agent | `ux/component-inventory.md` names the relevant source file for every entry and classifies it as reusable, extraction candidate, or production-only. It records that spacing is not tokenized and that sidebar drag ordering is pointer-dependent. | Day 3 | P0.1 |
| P0.4 | Add an explicit test-isolation seam for `ADEO_DB_PATH` and Electron `userData`. | Architect + Implementer | An automated test launches Adeo with temporary paths, creates a uniquely named task, closes the app, and proves that the development database and settings file are byte-for-byte unchanged. The test fails before app startup if an isolated path is absent. | Day 4 | Current dialog rollback complete |
| P0.5 | Capture the visual baseline of the current application. | Product Design Agent | Versioned screenshots exist for light/dark, empty/populated, valid/invalid search, edit dialog, every Settings tab, and 800x600/1280x800 windows. Each screenshot records commit SHA, viewport, theme, fixture name, and capture command. | Day 5 | P0.4 |

**Phase exit criteria**

- The user has approved the UX principles.
- Test isolation has a repeatable automated proof.
- The baseline can be reproduced by someone using only repository instructions.

## Phase 1 — Design-system surface and Storybook

**Phase objective:** make the existing design language inspectable and provide
isolated states for the first reusable UI elements.

**Target duration:** 10 working days.

| ID | SMART task | Owner | Done / measurement | Target | Depends on |
|---|---|---|---|---|---|
| P1.1 | Extract the existing color, typography, radius, elevation, and theme variables from `styles.css` into design CSS files without changing their values. | Architect + Implementer | The production app imports the extracted files; the Phase 0 screenshot matrix has no unintended visual differences; both TypeScript projects pass typecheck. | Day 3 | Phase 0 |
| P1.2 | Define a documented spacing scale for newly created or touched components without mechanically rewriting all legacy spacing declarations. | Product Design Agent + Architect | The scale is documented in `ux/patterns.md` and code; every component created in this plan uses only the scale unless a documented exception is approved. | Day 3 | P1.1 |
| P1.3 | Configure Storybook with `@storybook/html-vite`, TypeScript stories, production design CSS, light/dark controls, and 1440/1024/768/390 viewport presets. | Implementer | `npm run storybook` starts locally; `npm run storybook:build` exits successfully; a smoke story renders in every theme and viewport preset. | Day 5 | P1.1 |
| P1.4 | Extract and story the first low-risk UI elements: tag chip/dot, shortcut keycap, and combobox suggestion item. | Architect + Implementer | Each factory accepts explicit data/callbacks and has no `window.electronAPI`, global `refs`, or mutable global `state` dependency. Stories cover normal, selected/active, disabled where applicable, long text, light, and dark states. | Day 7 | P1.3 |
| P1.5 | Add `@storybook/addon-a11y` and establish the initial accessibility policy. | Implementer + Product Design Agent | All Phase 1 production-component stories run axe. New stories use `a11y.test: 'error'`; any inherited violation is recorded with an owner and due phase rather than silently disabled. | Day 8 | P1.3 |
| P1.6 | Add stories around the existing date picker and one sidebar pill presentation without changing dialog architecture or reorder behavior. | Architect + Implementer | Stories demonstrate closed/open, boundary dates, long labels, keyboard focus, selected/unselected, and light/dark. Interaction code is isolated from Electron services. | Day 10 | P1.4, current dialog rollback complete |

**Phase exit criteria**

- Storybook builds in a clean checkout.
- At least five production UI elements have meaningful state coverage.
- The Product Design Agent can inspect tokens and component states without running Electron.

## Phase 2 — Use Storybook as the Design Lab

**Phase objective:** prove that interactive, non-production alternatives can be
created, compared, approved, and handed off without polluting the application.

**Target duration:** 7 working days.

| ID | SMART task | Owner | Done / measurement | Target | Depends on |
|---|---|---|---|---|---|
| P2.1 | Add `ux/concepts/` to Storybook under a top-level `Concepts` hierarchy and create deterministic UI fixtures. | Implementer | Concept stories can import production tokens/components and fixtures, but no production module imports anything from `ux/`. A build-time check or dependency rule enforces that direction. | Day 2 | Phase 1 |
| P2.2 | Run a Quick Add pilot with three alternatives: compact/current-direction, command-style, and touch-first. | Product Design Agent | Three interactive stories exist. Each includes benefits, trade-offs, complexity, keyboard behavior, empty/error behavior, and desktop/web/mobile implications. All render at the four required viewports. | Day 4 | P2.1 |
| P2.3 | Conduct an approval review for the Quick Add pilot. | User + Product Design Agent | The user selects, rejects, or requests revision. The outcome is recorded in a numbered UX decision with approver/date and stable Storybook story ID. The agent does not set approval itself. | Day 5 | P2.2 |
| P2.4 | Hand the approved UX decision to the Architect Agent without implementation leakage. | Architect | `.claude/plans/current.md` links the approved UX decision and includes production responsibilities, tests, non-goals, and acceptance criteria. Concept-only shortcuts or fixture code are not copied into the plan as production architecture. | Day 7 | P2.3 and user approval |

**Phase exit criteria**

- At least one real design choice has moved through concept, user approval, and
  technical planning.
- Concept code remains absent from the production bundle.

## Phase 3 — Add and evaluate the Product Design Agent

**Phase objective:** install a permission-constrained agent and prove that its output
is useful, repository-specific, and compatible with the existing workflow.

**Target duration:** 7 working days.

| ID | SMART task | Owner | Done / measurement | Target | Depends on |
|---|---|---|---|---|---|
| P3.1 | Add `.claude/agents/product-designer.md` or the equivalent Codex agent definition with explicit modes: requirement review, explore, specify, implementation review, and audit. | Architect + user | The definition names required reading, output formats, approval boundaries, and stop conditions. It states that only the user approves concepts. | Day 2 | Phase 2 |
| P3.2 | Enforce agent writes to `ux/` only and restrict shell commands to approved read-only inspection and UI-review scripts. | Architect + Implementer | Attempts to edit `src/`, `server/`, tests, package files, `.claude/plans/current.md`, or Git state are blocked by hooks/policy and demonstrated with negative tests. Concept writes under `ux/` still succeed. | Day 3 | P3.1 |
| P3.3 | Give the agent browser, screenshot, viewport, Storybook, axe-result, and read-only Git-diff access while excluding deployment, package installation, production database, and Git-write tools. | Architect | The final tool list is documented in the agent file. A dry run proves it can open a story, interact, resize, capture evidence, and read a production diff without gaining prohibited access. | Day 4 | P3.2 |
| P3.4 | Evaluate the agent on three fixed scenarios: incomplete requirement review, multi-concept exploration, and implementation audit. | User + Architect | A rubric scores repository grounding, missing-state coverage, component/token reuse, accessibility, platform reasoning, evidence quality, and false claims. Each scenario must score at least 80%, with no production-write or self-approval violation. | Day 6 | P3.3 |
| P3.5 | Revise the prompt once from evaluation evidence and freeze version 1.0. | Architect + user | The agent file records version/date; every prompt change maps to a failed or weak rubric item; all three scenarios are rerun and meet the threshold. | Day 7 | P3.4 |

**Model starting point**

- Codex: GPT-5.6 Sol with high reasoning for concept and review work.
- Existing Claude harness: the high-capability `opus` alias, matching the Architect Agent.
- A lower-cost model may be introduced for routine audits only after the same evaluation
  suite shows no unacceptable quality loss.

**Phase exit criteria**

- The agent passes the evaluation suite.
- A technical control, not only prompt text, protects production code and Git state.

## Phase 4 — Automated visual, interaction, and accessibility QA

**Phase objective:** give the Product Design Agent reliable evidence from both the
browser renderer and Electron shell.

**Target duration:** 10 working days.

| ID | SMART task | Owner | Done / measurement | Target | Depends on |
|---|---|---|---|---|---|
| P4.1 | Add Playwright Test with separate `renderer` and `electron` projects plus shared isolated fixtures. | Implementer | `npm run test:e2e` starts all required processes, uses temporary data, collects traces/screenshots on failure, and cleans up. No manual server startup is required. | Day 3 | P0.4, Phase 3 |
| P4.2 | Add renderer E2E coverage for empty/populated startup, add/edit/complete/delete task, simple/query search, list/tag/smart-list management, settings, and keyboard focus. | Implementer | Every named flow has at least one assertion on behavior and accessible role/name. All tests pass at 1280x800 and a narrow viewport; responsive-specific flows also run at 390px once supported. | Day 6 | P4.1 |
| P4.3 | Add a focused Electron suite for startup, preload/IPC, menu events, settings persistence, theme handoff, native-confirm stubbing, and task deep links. | Implementer | Each desktop-specific boundary has one deterministic test. CRUD is not redundantly retested through every Electron path. | Day 7 | P4.1 |
| P4.4 | Add `@axe-core/playwright` scans for the main view and every revealed state: menus, suggestions, search errors, dialogs, date picker, and Settings tabs. | Implementer + Product Design Agent | New violations fail CI. Existing violations use specific fingerprints with owner and due task; broad element exclusions or global rule disabling require user approval. | Day 8 | P4.2, P4.3 |
| P4.5 | Add visual baselines for the agreed stable states and define update rules. | Product Design Agent + Implementer | Baselines run on a pinned browser/OS in CI. A baseline update requires a linked approved UX decision or explicit user approval. Review documentation distinguishes expected diffs from regressions. | Day 9 | P4.2 |
| P4.6 | Add a CI job for Storybook build, story accessibility, renderer E2E, Electron smoke, and visual checks. | Implementer | The job runs on every pull request, reports each layer separately, and uploads traces, axe reports, and screenshot diffs for failures. The full job completes within 15 minutes on three consecutive runs. | Day 10 | P4.4, P4.5 |

**Phase exit criteria**

- The agent can cite reproducible browser/test evidence in an implementation review.
- A changed screenshot cannot be accepted merely by regenerating the baseline.

## Phase 5 — Web and mobile readiness

**Phase objective:** remove Electron from the renderer's core execution path and make
the design workflow exercise the future platform boundaries.

**Target duration:** 15 working days for readiness work; mobile implementation is not
included.

| ID | SMART task | Owner | Done / measurement | Target | Depends on |
|---|---|---|---|---|---|
| P5.1 | Define `AppServices` boundaries for data, settings/theme, confirmation, app events, and notification/deep-link capability. | Architect | The interfaces account for all current `window.electronAPI` uses and distinguish required capabilities from optional platform features. The design is approved before implementation. | Day 3 | Phase 4 |
| P5.2 | Implement Electron and deterministic test adapters, then remove direct `window.electronAPI` use from feature/render modules. | Implementer | Direct bridge access is confined to the Electron adapter/bootstrap. Existing Electron behavior and Phase 4 tests remain green. | Day 7 | P5.1 |
| P5.3 | Add a standalone Vite renderer entry and browser adapter suitable for local development. | Implementer | `npm run web` opens a working browser UI without Electron globals. CRUD uses an explicit test/dev backend; settings and confirmations use browser implementations; unsupported native features are represented as capabilities, not runtime errors. | Day 10 | P5.2 |
| P5.4 | Implement responsive navigation and editor behavior for desktop, tablet, and mobile widths. | Product Design Agent + Architect + Implementer | At 1440, 1024, 768, and 390px there is no horizontal page overflow; critical actions require neither hover nor drag; primary touch controls meet the documented target size; editor and Settings remain operable by keyboard and touch. | Day 13 | P5.3 and approved responsive concept |
| P5.5 | Run a time-boxed Capacitor versus React Native decision spike. | Architect + Product Design Agent | Within two days, document reuse percentage, offline data approach, notifications/background work, accessibility, performance, release complexity, and prototype evidence. Produce a user-approved decision or explicitly defer it with named missing information. | Day 15 | P5.4 |

**Phase exit criteria**

- The renderer runs in a normal browser with no Electron global.
- Platform-specific behavior is isolated behind adapters.
- A mobile technology is selected only from prototype evidence and product needs.

## Cross-phase Definition of Done

A task is complete only when:

1. Its measurable Done criteria are satisfied.
2. Relevant typechecks, builds, tests, and accessibility scans pass.
3. User-visible changes have reviewable screenshots or an explicit statement that
   no visual change is expected.
4. New UX behavior links to an approved UX decision.
5. Documentation names remaining gaps and owners.
6. The Product Design Agent has not modified production code or approved its own work.
7. No automation accessed the real development/user database.

## Progress tracking

### Current implementation progress

| Task | Status | Evidence / next gate |
|---|---|---|
| P0.1 | DONE — 2026-08-21 | The seven required files exist under `ux/`; Antonio approved `ux/principles.md` on 2026-08-21. |
| P0.2 | DONE — 2026-08-21 | `ux/briefs/template.md`, `ux/decisions/template.md`, and `ux/reviews/template.md` contain the required fields and traceability structure. |
| P0.3 | DONE — 2026-08-21 | `ux/component-inventory.md` records source-backed classifications, the missing spacing tokens, and pointer-dependent sidebar ordering. |
| P0.4 | DONE — 2026-08-22 | The user approved the production plan; `npm run test:isolation` passes 34 checks across fail-closed configuration, isolated task/settings persistence, and byte-for-byte protected-file comparison. See `ux/reviews/p0-4-test-isolation-review.md`. |
| P0.5 | DONE — 2026-08-22 | After the user's formal approval, the isolated capture produced the complete 32-image matrix and per-image provenance manifest. See `ux/reviews/p0-5-visual-baseline-review.md` and `ux/baselines/README.md`. |
| P1.1 | DONE — 2026-08-22 | Base and dark token declarations are imported from `styles/tokens.css` and `styles/themes.css`; all declared/computed values match, the build and regression suites pass, and the 32-state comparison is within the measured unchanged-renderer noise envelope. See `ux/reviews/p1-1-token-extraction-review.md`. |
| P1.2 | DONE — 2026-08-22 | `styles/tokens.css` and `ux/patterns.md` define the value-named 0/2/4/6/8/10/12/16/20/24/32px scale and forward-only exception policy. Existing tokens, visuals, and regressions are unchanged. See `ux/reviews/p1-2-spacing-scale-review.md`. |
| P1.3 | DONE — 2026-08-24 | Chrome exercised all eight light/dark and 1440/1024/768/390 combinations through rendered Storybook controls with correct markers, computed production tokens, and canvas widths. Builds and regressions pass. See `ux/reviews/p1-3-storybook-setup-review.md`. |
| P1.4 | DONE — 2026-08-24 | Shared dependency-free factories now back tag chips/dots, shortcut keycaps, and query/tag suggestion rows. Three stories cover required states and passed 12 Chrome theme/viewport cases plus builds and regressions. See `ux/reviews/p1-4-low-risk-elements-review.md`. |
| P1.5 | DONE — 2026-08-24 | Storybook loads the axe-based accessibility addon with project-wide `a11y.test: 'error'`. Chrome ran all four Phase 1 stories in light/dark; Storybook-only issues were fixed and three inherited production-token findings remain failing, fingerprinted, owned, and due by Phase 1 exit. See `ux/reviews/p1-5-accessibility-policy-review.md`. |

**Phase 0 status:** DONE — 2026-08-22. All five tasks and all three phase-exit
criteria are satisfied. The user authorized Phase 1 by instructing the work to continue.

Use these statuses in this file when execution begins:

- `NOT STARTED`
- `IN PROGRESS`
- `BLOCKED — <reason>`
- `DONE — <date and evidence link>`

Do not mark an entire phase done until every phase exit criterion is met. Review the
plan with the user at each phase boundary before starting the next phase.

## Overall success metrics

Evaluate the integration after Phase 4 and again after Phase 5:

- 100% of implemented UI features link to an approved UX decision or are explicitly
  classified as maintenance-only.
- 100% of new production UI elements use documented tokens and existing components,
  or include an approved exception.
- 100% of critical task flows have keyboard coverage and an automated axe scan.
- 0 automated runs access the development/user database.
- At least 80% on every Product Design Agent evaluation scenario.
- UI review findings contain reproducible evidence for at least 90% of blocking claims.
- Storybook, accessibility, renderer E2E, Electron smoke, and visual CI complete within
  15 minutes on three consecutive runs.

## Explicit non-goals

- Migrating the production renderer to React or another UI framework.
- Adding Storybook MCP while its agent features do not support this HTML renderer.
- Implementing a hosted multi-user backend, authentication, or synchronization.
- Shipping a mobile application.
- Introducing Penpot or Figma into the required workflow.
- Creating separate accessibility, mobile, design-system, and visual-QA agents.
- Reworking all legacy CSS spacing in one mechanical migration.
