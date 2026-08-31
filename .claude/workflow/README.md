# Legacy feature artifacts

`.claude/workflow/current.md` contains historical FAST/STANDARD/FULL workflow
state. It remains readable so an already-authorized legacy feature is not
silently invalidated, but new ordinary work must use `/deliver` and the
machine-owned `.claude/delivery/current.json` lifecycle.

Do not create new workflow artifacts. New high-risk work uses an immutable plan
snapshot plus `delivery.py authorize-high`; it does not synchronize this file.
Implementation completion is never recorded here; deterministic quality plus a
bounded verifier receipt own `READY_FOR_PRODUCT_REVIEW`.
