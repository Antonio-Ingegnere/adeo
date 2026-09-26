# Legacy delivery state

This directory is historical. DELIVERY-002 writes `.switchyard/current.json` and canonical
per-lifecycle JSONL instead. Existing current.json is not migrated or deleted automatically.
An active legacy state blocks new delivery until the operator reviews and explicitly archives it.
See [migration and recovery](../../docs/agent/switchyard-delivery.md).
