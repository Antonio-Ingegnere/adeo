# Adeo development workflow

Use the lightest workflow that can deliver a change safely. Specifications are
coordination artifacts; requirements define intent, while code and tests define
implementation reality.

## Start here

An ordinary feature request is enough for the current agent to apply this
workflow automatically. Use the explicit command when you want to select or
inspect the lifecycle yourself:

```text
/feature start request="Describe the requested outcome"
```

The command inspects the repository, classifies the work, and writes one current
artifact at `.claude/workflow/current.md`. Classification uses simple rules:

- **FAST** — clear, localized, low-risk work expected to affect about 1–3 files;
  no schema, external contract, security, migration, or architectural change.
- **STANDARD** — the default for normal feature work: several files or
  components, explicit acceptance criteria, and moderate regression risk while
  the existing architecture remains suitable.
- **FULL** — only for architecture or cross-cutting changes, migrations or major
  data-model changes, external API contracts, security-sensitive work, hard
  compatibility constraints, large epics, or significant uncertainty.

When uncertain, choose STANDARD. Do not use a numeric scoring system.

## The three paths

### FAST

```text
request -> lightweight brief -> implementation -> tests -> review -> done
```

The brief is implementation-ready immediately. It contains only the goal,
acceptance criteria, constraints, likely impacted areas, and genuine open
decisions. No separate spec, architecture phase, plan, or human approval is
required.

### STANDARD (default)

```text
request -> mini spec -> one human approval -> implementation -> QA/review -> done
```

The mini spec uses the same concise sections as a FAST brief, with enough detail
to make behavior and acceptance criteria unambiguous. Start produces
`AWAITING_APPROVAL`; the user approves once with:

```text
/feature approve
```

After approval, implementation proceeds autonomously within the stated scope.
NON-BLOCKING review comments never require another spec revision or approval.

### FULL

```text
research/specification -> architecture/plan -> one human approval
    -> implementation -> QA/review -> done
```

FULL reuses the existing named-plan lifecycle:

```text
/implementation-plan start spec=<path> [plan=<id>]
/implementation-plan update plan=<id> request="<material change>"
/implementation-plan approve plan=<id>
/implementation-plan status [plan=<id>]
/implementation-plan archive plan=<id> outcome=implemented|cancelled|superseded
```

Use immutable revisions and the Architect only in FULL. Build the specification
and plan before the single approval; do not add a separate approval for each.

## `/feature` commands

```text
/feature start request="..." [mode=fast|standard|full]
/feature status
/feature review
/feature approve
/feature escalate [to=standard|full] reason="..."
/feature complete
```

- `mode=` is an explicit user override. Never silently downgrade it.
- `review` evaluates readiness in the current agent; it does not create a
  reviewer subagent merely to polish Markdown.
- `approve` is valid for STANDARD only when the user invokes it explicitly and
  readiness has no blocking findings. FULL approval stays with
  `/implementation-plan approve`.
- `complete` records the outcome after implementation, tests, and review.

## Progressive escalation

Start cheaply and escalate when discovered facts require it:

```text
FAST -> STANDARD -> FULL
```

Escalate FAST to STANDARD for material behavioral ambiguity, broader impact, or
moderate regression risk. Escalate to FULL for architecture, security,
migration, contract, compatibility, or major scope discoveries. Record the
reason once in `current.md`; do not retain the entire conversation. Never
silently downgrade a workflow.

## Artifacts and context budget

FAST and STANDARD use only `.claude/workflow/current.md` unless the request
already has a useful ticket, test, decision, or specification. Link existing
evidence instead of copying it.

- Keep a FAST brief to roughly 40 lines or fewer.
- Keep a STANDARD mini spec to roughly 100 lines or fewer.
- Omit empty/template-only sections except `Open Decisions`.
- Allow at most one spec-review revision cycle. If a blocker remains, ask the
  user directly or escalate; do not spawn writer/reviewer/rewriter chains.
- Give implementation and fixing most of the working context. Summarize old
  discussion instead of repeatedly loading complete history.

As a budgeting guide, spend roughly 10–15% on understanding/specification,
5–10% on architecture/planning, 55–65% on implementation, 15–20% on
testing/fixing, and 5–10% on final review. These are guardrails, not accounting
requirements; if routine work consumes much of its capacity before code, stop
planning and implement.

## Review contract

Readiness review must use exactly this shape:

```text
BLOCKING:
1. ... (or None.)

NON-BLOCKING:
1. ... (or None.)

READY FOR IMPLEMENTATION: YES | NO
```

BLOCKING means the issue could cause a materially different or incorrect
implementation, violates a safety boundary, or leaves an acceptance criterion
undefined. Style, optional documentation, and theoretical edge cases are
NON-BLOCKING unless they affect a stated criterion or significant risk. If
BLOCKING is empty, implementation proceeds.

Use `@reviewer` when independent context materially improves a readiness or
post-implementation review. It is not a mandatory stage and cannot edit files.

## Agent responsibilities

| Agent | Use | Writes |
| --- | --- | --- |
| Current agent | Classify work, create FAST briefs/STANDARD mini specs, and handle small tasks end to end | In-scope workflow and implementation files |
| `implementer` | Implement an authorized FAST, STANDARD, or FULL artifact | In-scope application code and tests; never workflow/spec/plan files |
| `reviewer` | Independent readiness, code, or QA review when useful | Nothing |
| `architect` | FULL architecture and revisioned plans only | `.claude/plans/` |
| `product-designer` | Material UX exploration or review | `ui-ux/ux/` only |
| `spec-owner` | Explicit Storybook-to-spec maintenance | `spec/` only |
| `git` | Explicitly requested Git operations | Git state only |

Do not create a subagent for work the current agent can finish with a few tool
calls. A specialist is justified by independent parallel work, genuinely useful
independent context, a required specialty, or task size that exceeds its setup
cost.

Model policy follows the same principle: reserve the strongest reasoning model
for FULL architecture or difficult decisions; use a coding model for routine
implementation and a faster model for mechanical checks.

## Bounded autonomy

Workflow simplification does not relax safety. Agents still stop for destructive
or irreversible operations, security-sensitive choices, contradictory
requirements, material scope expansion, architecture outside the approved
scope, protected files, production/external writes, secrets, and credentials.

After a STANDARD or FULL approval, agents may make small implementation choices
that do not change agreed behavior or architecture. Tests, fixes, and review do
not require additional human approval unless one of the boundaries above is
crossed.

## Specialized optional workflows

`/spec-storybook` maintains evidence-labelled UI specs from Storybook. It is
useful when the user explicitly requests that artifact; it is not a prerequisite
for FAST or STANDARD implementation.

Product Designer is similarly optional. Use it when product/UX choices genuinely
need exploration, not as an automatic prelude to ordinary UI work. Only the user
approves a UX decision.

### Creating a Storybook item

Storybook assets under `ui-ux/ux/` are owned by the Product Designer. For a new
exploratory concept, ask it to create deterministic alternatives in Explore
mode, including the relevant states, themes, viewports, keyboard behavior, and
accessibility evidence:

```text
@product-designer In Explore mode, create Storybook alternatives for inline
task priority selection. Reuse production components and tokens.
```

When the behavior is already established, say that the story documents current
behavior and must not redesign it:

```text
@product-designer In Explore mode, add a Storybook story documenting the
existing date-picker states. Reuse production behavior; do not redesign it.
```

The designer must render and inspect the story, but creating a story does not
approve its behavior. If the story presents a new product direction, the user
selects it. For STANDARD work, combine that selection with the mini-spec
approval rather than adding separate concept, specification, and plan gates.

Once a story exists, a FAST or STANDARD feature may reference its story ID
directly instead of copying its content. Generate persistent Markdown only when
it is genuinely useful:

```text
/spec-storybook path=/story/<story-id>
```

The normal sequence is:

```text
create and render story
-> user selects direction when needed
-> /feature start referencing the story
-> /feature approve when STANDARD
-> implementation and Storybook/application QA
-> /feature complete
```

The Git Agent never commits, pushes, or opens a pull request without an explicit
request and preserves its existing destructive-action guardrails.

## Configuration

```text
.claude/skills/feature/                 FAST/STANDARD/FULL entry point
.claude/workflow/current.md             Current concise brief or mini spec (created on start)
.claude/agents/implementer.md            Developer and authorization gate
.claude/agents/reviewer.md               Read-only readiness/code/QA reviewer
.claude/skills/implementation-plan/      FULL-only named-plan lifecycle
.claude/plans/                           FULL plan storage and immutable history
.claude/skills/spec-storybook/           Optional Storybook specification maintenance
```
