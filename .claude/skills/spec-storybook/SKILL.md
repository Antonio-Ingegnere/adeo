---
name: spec-storybook
description: Incrementally update Adeo's Markdown UI specifications from Storybook evidence. Use when the user asks to inventory Storybook, derive or refresh UI specs, or run the Storybook-to-specification workflow.
argument-hint: [all | changed | path=/story/<story-id> | source path/title]
context: fork
agent: spec-owner
---

Run the repository's Storybook-to-specification workflow.

This is an optional specialist workflow used when the user explicitly requests
Storybook specification maintenance. It is not a prerequisite for FAST or
STANDARD feature implementation.

Scope: `$ARGUMENTS`

Interpret the scope exactly as defined by the Spec Owner:

- `path=/story/<story-id>`, `/story/<story-id>`, a Storybook URL containing
  `path=/story/<story-id>`, or `id=<story-id>` is an exact-story request. It
  must create or update a dedicated, self-contained spec for that story.
- A source path or Storybook title scopes the run to the matching file/group.
- `all` reconciles the complete configured catalog.
- `changed` reads the complete catalog but writes only where current evidence
  differs from the existing specifications.
- No argument defaults to `all`.

Follow the Spec Owner system instructions exactly. Only files under `spec/` may
change. Report changed inventory entries and specs, new open questions,
preserved human decisions, contradictions, and major evidence gaps. Do not
implement application changes or generate user stories, plans, backlog items,
or development tasks.

For an exact-story request, the first line of the completion report must be
`Created spec: spec/ui/<file>.md` or `Updated spec: spec/ui/<file>.md`. Do not
report success if no dedicated spec was created or updated.
