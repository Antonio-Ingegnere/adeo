// Board "Move to…" planner acceptance suite (pure node over dist/).
// Run with: npm run test:board-move
//
// Proves that src/renderer/boardMove.ts routes every move decision through the *unmodified*
// production query path -- parseQuery / compilePredicate (query.ts), deriveTemplate / unparse
// (smartListTemplate.ts) and resolveDue (activeSmartList.ts) -- by asserting the
// deterministic / best-effort / blocked / no-op verdicts and the derived attribute writes for
// a fixture matrix. No Electron, no API, no database.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

// boardMove.js -> activeSmartList.js -> dom.js touches `document` at module load. Stub just
// enough for the import to succeed; nothing here renders.
globalThis.document = {
  getElementById: () => null,
  createElement: () => ({ className: '' }),
};

let checks = 0;
let failures = 0;
const check = (condition, message) => {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.error(`  FAIL: ${message}`);
  }
};

const distUrl = (rel) => new URL(`file://${path.join(repoRoot, 'dist', 'renderer', rel)}`).href;

const { state } = await import(distUrl('state.js'));
const { planBoardMove } = await import(distUrl('boardMove.js'));

const isoToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
};

// ---- fixtures -----------------------------------------------------------------------------
state.lists = [
  { id: 1, name: 'Work', position: 0 },
  { id: 2, name: 'Home', position: 1 },
];
state.tags = [
  { id: 1, name: 'work', color: '#F6C6C6', position: 0 },
  { id: 2, name: 'urgent', color: '#F9D9B8', position: 1 },
];
state.smartLists = [
  { id: 10, name: 'Hi work', query: '#work priority:high', position: 0 },
  { id: 11, name: 'Due soon work', query: '#work AND due<=2026-09-05', position: 1 },
  { id: 12, name: 'Review', query: 'text~review', position: 2 },
  { id: 13, name: 'Work tag', query: '#work', position: 3 },
  { id: 14, name: 'Today', query: 'due:today', position: 4 },
];
state.tasks = [];
state.showCompleted = true;

const task = (over) => ({
  id: 1,
  text: 'Draft the quarterly plan',
  details: '',
  done: false,
  position: 0,
  listId: null,
  priority: 'none',
  reminderDate: null,
  reminderTime: null,
  repeatRule: null,
  repeatStart: null,
  tagIds: [],
  ...over,
});

const listRef = (id, label) => ({ kind: 'list', listId: id, label });
const smartRef = (id) => {
  const s = state.smartLists.find((x) => x.id === id);
  return { kind: 'smart', smartListId: s.id, query: s.query, label: s.name };
};

// ---- 1. List -> List : deterministic single listId write --------------------------------
{
  const plan = planBoardMove(task({ listId: 1 }), listRef(1, 'Work'), listRef(2, 'Home'));
  check(plan.verdict === 'deterministic', `1: list->list is deterministic (got ${plan.verdict})`);
  check(plan.changes.length === 1 && plan.changes[0].field === 'list', '1: one list change');
  check(plan.changes[0].chip === 'Home', `1: chip names the destination list (got ${plan.changes[0].chip})`);
}

// ---- 2. List -> same List : no-op, writes nothing --------------------------------------
{
  const plan = planBoardMove(task({ listId: 2 }), listRef(1, 'Work'), listRef(2, 'Home'));
  check(plan.verdict === 'noop', `2: already in destination list is noop (got ${plan.verdict})`);
  check(plan.changes.length === 0, '2: no-op produces zero changes');
}

// ---- 3. -> Smart "#work priority:high" : deriveTemplate assigns priority, deterministic --
{
  const plan = planBoardMove(
    task({ listId: 1, tagIds: [1] }),
    listRef(1, 'Work'),
    smartRef(10),
  );
  check(plan.verdict === 'deterministic', `3: fully-invertible smart dest is deterministic (got ${plan.verdict})`);
  const pr = plan.changes.find((c) => c.field === 'priority');
  check(Boolean(pr) && pr.priority === 'high', '3: deriveTemplate produced a priority:high change');
  check(!plan.changes.some((c) => c.field === 'tags'), '3: no tag change (task already has #work)');
}

// ---- 4. -> Smart "#work AND due<=2026-09-05" : range skipped -> best-effort -------------
{
  const plan = planBoardMove(task({ listId: 2 }), listRef(2, 'Home'), smartRef(11));
  check(plan.verdict === 'best-effort', `4: uninvertible range -> best-effort (got ${plan.verdict})`);
  check(plan.changes.some((c) => c.field === 'tags'), '4: the invertible #work part is still applied');
  check(
    plan.skipped.some((s) => s.toLowerCase().includes('due')),
    `4: the due range is reported in skipped (got ${JSON.stringify(plan.skipped)})`,
  );
}

// ---- 5. -> Smart "text~review" : nothing invertible -> blocked ------------------------
{
  const plan = planBoardMove(
    task({ listId: 1, text: 'Buy milk' }),
    listRef(1, 'Work'),
    smartRef(12),
  );
  check(plan.verdict === 'blocked', `5: pure contains() query -> blocked (got ${plan.verdict})`);
  check(plan.changes.length === 0, '5: blocked produces zero changes');
  check(
    plan.skipped.some((s) => s.includes('text')),
    `5: the un-invertible clause is named (got ${JSON.stringify(plan.skipped)})`,
  );
}

// ---- 6. -> Smart "#work" where the task already matches : no-op ------------------------
{
  const plan = planBoardMove(task({ listId: 1, tagIds: [1] }), listRef(1, 'Work'), smartRef(13));
  check(plan.verdict === 'noop', `6: already matches smart dest -> noop (got ${plan.verdict})`);
  check(plan.changes.length === 0, '6: no-op writes nothing');
}

// ---- 7. -> Smart "due:today" : resolveDue turns the keyword into a concrete date -------
{
  const plan = planBoardMove(task({ listId: 1 }), listRef(1, 'Work'), smartRef(14));
  check(plan.verdict === 'deterministic', `7: due:today is fully invertible (got ${plan.verdict})`);
  const rem = plan.changes.find((c) => c.field === 'reminder');
  check(Boolean(rem), '7: a reminder change is produced');
  check(
    Boolean(rem) && rem.chip === `Due ${isoToday()}`,
    `7: resolveDue resolved "today" to ${isoToday()} (got ${rem && rem.chip})`,
  );
}

if (failures) {
  console.error(`\nboard-move self-test FAILED: ${failures} of ${checks} checks failed`);
  process.exitCode = 1;
} else {
  console.log(`board-move self-test passed (${checks} checks)`);
}
