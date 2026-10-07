---
name: repair
description: Retired old REPAIR preset; use explicit V2 bugfix delivery.
disable-model-invocation: true
---

Explain that standalone REPAIR is retired for new work. Do not invoke the old preset.
For pending QA use `/reopen` with human feedback first. For a new defect operation use
`/deliver bugfix <report>` only when explicitly requested. Do not silently reinterpret this command,
resume a legacy run or automatically start a model.
