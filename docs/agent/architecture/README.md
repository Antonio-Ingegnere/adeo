# Scoped architecture index

The detailed guide is intentionally outside root `CLAUDE.md` so it is not
injected into every session. Do not read `repository-guide.md` end to end.
Locate the relevant heading, read only that section, and verify it against the
current implementation.

| Work area | Detailed heading | Start with source |
| --- | --- | --- |
| Setup, build, packaging, test inventory | `Commands` | `package.json`, `scripts/` |
| Electron/FastAPI boundary | `Process split`, `Data flow for a UI action` | `src/main.ts`, `src/preload.ts`, `server/app.py` |
| Test isolation and environment | `Ports and environment variables` | `scripts/lib/isolated-electron.mjs` |
| View bar and current view | `The view` | `src/renderer/viewBar.ts`, `currentView.ts` |
| Keyboard shortcuts | `Keyboard shortcuts` | `src/renderer/shortcut*.ts`, `shortcuts*.ts` |
| Tags and sidebar ordering | `Tag colour`, `Sidebar order` | `src/renderer/tagColor.ts`, `pillDnD.ts` |
| Settings UI and persistence | `The Settings dialog`, `Settings vs. app data` | `src/renderer/settings*.ts`, `src/main.ts` |
| Smart lists and query templates | `Smart lists` | `src/renderer/activeSmartList.ts`, `smartListTemplate.ts` |
| Quick Add metadata | `Quick Add options` | `src/renderer/composeOptions.ts`, `actions.ts` |

Reference: [`repository-guide.md`](repository-guide.md).

Use search plus a bounded read, for example:

```text
Find the `### Quick Add options` heading, then read only until the next heading.
```

If a task is not represented here, inspect repository paths first and add a
small routed document only when the knowledge is stable and repeatedly useful.
