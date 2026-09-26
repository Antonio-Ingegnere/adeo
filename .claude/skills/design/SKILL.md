---
name: design
description: Invoke Adeo's standalone Product Designer for UX requirement review, prototype exploration, UX specification, implementation review, or audit under ui-ux/ux/. Use only when the user explicitly asks for design/prototype work.
argument-hint: <request> | prototype <request> | requirements <request> | specify <request> | implementation-review <request> | audit <request>
model: haiku
effort: low
disable-model-invocation: true
---

`/design` is the explicit entry point for the standalone `product-designer` agent.
It is **not** a production `/deliver` and must never create or claim a production
delivery just to make design work possible.

## Lifecycle preflight

Before launching, run `python3 .claude/scripts/delivery-owner-guard.py --role product-designer`
with `{}` on stdin. A nonzero result means an active or inconsistent lifecycle: stop.
Do not create, claim, resume or rewrite delivery state to enable standalone design.

## Dispatch

Invoke exactly one `product-designer` subagent and wait for it to finish in this
turn. Do not perform duplicate reconnaissance in the controller.

Pass the user's request verbatim plus the mode below:

- `prototype` / `explore` → **Explore**
- `requirements` / `requirement-review` → **Requirement review**
- `specify` → **Specify**
- `implementation-review` → **Implementation review**
- `audit` → **Audit**
- no explicit mode → infer only from the user's verb; requests to create/build/
  prototype/visualize a UI concept default to **Explore**. If genuinely
  ambiguous, let `product-designer` choose among its defined modes rather than
  inventing a new mode.

Tell the worker explicitly that this is **standalone design work**: it must not
call `delivery.py worker-claim`, must stay within its existing `ui-ux/ux/` write
boundary, and must preserve the user-only approval rule.

Do not use the implementer, verifier, or QA repairers for `/design`.
