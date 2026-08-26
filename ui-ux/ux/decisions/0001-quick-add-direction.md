# UX decision 0001: Quick Add direction

**Status:** APPROVED
**Decision owner:** User/product owner
**Approver:** Antonio Ingegnere
**Approval date:** 2026-08-25
**Reopened:** 2026-08-25 (fidelity correction); shell-adoption revalidation 2026-08-25
**Brief:** [Quick Add concept pilot](../briefs/quick-add-pilot.md)
**Concept review:** [P2.2 Quick Add pilot review](../reviews/p2-2-quick-add-pilot-review.md)
**Implementation plan:** Ready to hand off to the Architect Agent as P2.4

## Decision needed

Which Quick Add interaction direction should advance from the P2.2 concept pilot to an
architecture plan: compact/current-direction, command-style, touch-first, or none?

## Alternatives considered

| Alternative | Stable Storybook story ID | Benefits | Trade-offs | Complexity | Accessibility/platform notes |
|---|---|---|---|---|---|
| A: Compact/current-direction | `concepts-quick-add-pilot--compact-current-direction` | Preserves Adeo's fast, familiar capture loop and progressive disclosure | Optional metadata is less immediately discoverable; the compact row needs deliberate mobile adaptation | Low–medium | Strong keyboard continuity; touch layouts must enlarge primary targets without losing the compact hierarchy |
| B: Command-style | `concepts-quick-add-pilot--command-style` | Highest throughput for users who learn the syntax | Adds command discovery, parsing, conflict, and error-handling costs | High | Strong desktop keyboard fit; weakest mobile discoverability |
| C: Touch-first | `concepts-quick-add-pilot--touch-first` | Makes metadata and actions explicit with no hover or syntax prerequisite | Uses more vertical space and can slow plain capture | Medium–high | Strongest phone/touch fit; comparatively spacious on desktop |

## Approved direction

**Alternative:** A — Compact/current-direction
**Chosen story ID:** `concepts-quick-add-pilot--compact-current-direction`

The user initially selected Compact/current-direction on 2026-08-24, then identified on
2026-08-25 that the P2.2 stories did not faithfully represent Adeo's production task rows:
priority appeared as an invented left border and task elements used a different layout. The user
also found that Compact used an oval Add control instead of Adeo's circle, followed by broader
concept-only styling in the simulated task view, omitted expandable-task details, and no visible
proof of production Markdown rendering. All five fidelity findings were corrected and passed
browser revalidation (see P2.2-F01–F05 in the concept review).

The user then reopened P2.1 because the design lab itself was too narrow — no sidebar/app shell,
no list/smart-list variety, no recurring-task or reminder states, no drag-reorder or view-picker
interaction. P2.1 was rebuilt with a real Adeo app-shell fixture, and P2.2 was rebuilt to mount
each Quick Add alternative inside that shell instead of an isolated preview card (P2.2-F06–F07).

After reviewing the shell-based evidence for all three alternatives, the user reconfirmed
Compact/current-direction on 2026-08-25. Command-style and touch-first remain documented
alternatives, rejected for this decision but retained above for reference.

## Prior preference and reason for reopening

Compact/current-direction remains the user's prior preference because it preserves Adeo's
“capture first” principle and minimizes disruption. However, the earlier comparison overstated
visual continuity: the task context and surrounding compose surface were custom-styled rather than
rendered with production classes. Correct visual evidence is required before that rationale can
support approval.

## Candidate required states and behavior

- Keep the current task/list context visible while entering a task; Quick Add does not become a
  blocking dialog.
- Plain text can be submitted immediately by Enter or the visible Add action without opening
  optional metadata.
- Inline `#tag` suggestions support Arrow navigation, Enter selection, and Escape dismissal.
- Optional metadata is exposed by a clearly named disclosure and remains visibly associated with
  the current draft.
- Escape closes only the active suggestion or metadata surface and restores focus to its logical
  trigger.
- Successful submission adds the task, clears the draft, announces success, and returns focus to
  the task field.
- Blank submission does not add a task, names the missing task text, and retains input focus.
- Recoverable save failure preserves the complete draft, announces the failure and retry path,
  and returns focus to the task field.
- Populated, empty-list, save-error, and long-content states remain deterministic and reviewable.
- At 1440, 1024, 768, and 390px, the layout must reflow without horizontal page overflow. At
  touch layouts, primary interactive controls must meet the documented 44px target while keeping
  the compact information hierarchy.
- Light and dark themes use production tokens and non-color state cues.

## Risks and mitigations

| Risk | Impact | Mitigation / validation |
|---|---|---|
| Progressive disclosure makes optional metadata hard to find | Users may assume Quick Add supports only task text and tags | Keep a visible, named disclosure; validate label comprehension and first-use discovery before shipping |
| Desktop density produces undersized touch actions | The chosen direction could be difficult to operate at 390px | Define a responsive 44px touch adaptation in the P2.4 plan and test it at the required narrow viewport |
| Enter/Escape ownership conflicts between submission, tag suggestions, and metadata | Users could submit unexpectedly or lose focus | Specify precedence explicitly and add keyboard interaction coverage for every revealed surface |
| Concept-only state shortcuts leak into production architecture | Deterministic fixtures could be mistaken for service design | P2.4 must reference behavior and acceptance criteria only; production data and service responsibilities stay with the Architect |

## Consequences

### Production implications

- This record is `APPROVED`; P2.4 may begin.
- The plan must map the approved interaction onto production responsibilities, data persistence,
  responsive behavior, accessible semantics, and tests without importing concept controllers or
  fixtures.
- Existing production components and design tokens should be reused where their semantics match;
  extraction or new component work requires explicit scope in the architecture plan.
- The plan must preserve the isolated-data test boundary and include success, blank, recoverable
  failure, keyboard, light/dark, and responsive acceptance coverage.

### Non-goals

- This decision does not approve command syntax or the touch-first layout as the default.
- It does not specify which new metadata types ship, their backend schema, or reminder behavior.
- It does not authorize production code changes before the P2.4 architecture plan is reviewed
  through the existing workflow.
- It does not authorize copying concept fixture controls, simulated failures, or local preview
  state into production.
- It does not approve a mobile application or broader navigation redesign.

## Approval record

- [x] The user reviewed the shell-based alternatives and evidence.
- [x] The user selected Compact/current-direction explicitly after revalidation.
- [x] Status, approver, and approval date reflect that instruction.
- [x] The chosen story ID is stable and reproducible: `concepts-quick-add-pilot--compact-current-direction`.

History: the user first said "let's follow with Compact/current-direction," then reopened P2.2
after identifying the production-style mismatch, then reopened P2.1 after identifying the design
lab's narrow feature coverage. After both were rebuilt and revalidated, the user reconfirmed
Compact/current-direction on 2026-08-25. This instruction controls the final status.
