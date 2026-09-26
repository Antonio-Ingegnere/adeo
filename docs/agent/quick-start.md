# Adeo quick start

Adeo uses Electron, TypeScript and a local FastAPI/SQLite backend. Start with current
code and narrow executable evidence. The architecture router is [architecture/README.md](architecture/README.md).

Use `/deliver <task>`, manually test at READY_FOR_MANUAL_QA, then `/accept` or
`/repair <bug report>`. See [delivery setup and recovery](switchyard-delivery.md).
`python3 .claude/scripts/delivery.py status` inspects lifecycle pointers against canonical events.
`npm run quality:delivery` runs deterministic project verification independently.
Keep real development data isolated from all Electron test harnesses.
