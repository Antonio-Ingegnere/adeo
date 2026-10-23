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
const { resolveDue, templateSeed } = await import(distUrl('activeSmartList.js'));
const { parseQuery } = await import(distUrl('query.js'));
const { deriveTemplate } = await import(distUrl('smartListTemplate.js'));

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

// ---- 8. SQL-style destinations plan exactly like their shorthand equivalents (TQL-001) ---
{
  const pairs = [
    ['tag = work AND priority = high', 'tag:work AND priority:high', 'deterministic'],
    ['tag IN (work) AND priority IN (high)', 'tag:work AND priority:high', 'deterministic'],
    ['list = Home AND due = 2026-09-05', 'list:Home AND due:2026-09-05', 'deterministic'],
    ['tag = work AND due BETWEEN 2026-09-01 AND 2026-09-30', 'tag:work AND due>=2026-09-01 AND due<=2026-09-30', 'best-effort'],
    ['tag = work AND priority IN (high, low)', 'tag:work AND (priority:high OR priority:low)', 'best-effort'],
    ['tag = work AND text CONTAINS review', 'tag:work AND text~review', 'best-effort'],
    ['tag = work AND due IS NOT NULL', 'tag:work AND due!=none', 'best-effort'],
    ['text CONTAINS review', 'text~review', 'blocked'],
    ['tag IN (work, urgent)', '(tag:work OR tag:urgent)', 'blocked'],
    ['due BETWEEN 2026-09-01 AND 2026-09-30', 'due>=2026-09-01 AND due<=2026-09-30', 'blocked'],
  ];
  const source = listRef(2, 'Home');
  for (const [fresh, legacy, verdict] of pairs) {
    const dest = (query) => ({ kind: 'smart', smartListId: 99, query, label: 'tmp' });
    const a = planBoardMove(task({ listId: 2 }), source, dest(fresh));
    const b = planBoardMove(task({ listId: 2 }), source, dest(legacy));
    check(a.verdict === verdict, `8: "${fresh}" is ${verdict} (got ${a.verdict})`);
    check(a.verdict === b.verdict, `8: "${fresh}" verdict matches "${legacy}" (${a.verdict} vs ${b.verdict})`);
    check(
      JSON.stringify(a.changes) === JSON.stringify(b.changes),
      `8: "${fresh}" changes match "${legacy}" (${JSON.stringify(a.changes)} vs ${JSON.stringify(b.changes)})`,
    );
    check(
      JSON.stringify(a.skipped) === JSON.stringify(b.skipped),
      `8: "${fresh}" skipped matches "${legacy}" (${JSON.stringify(a.skipped)} vs ${JSON.stringify(b.skipped)})`,
    );
  }
  // a task that already satisfies the SQL-style destination is a no-op, like the shorthand
  const noop = planBoardMove(
    task({ listId: 1, tagIds: [1] }),
    listRef(1, 'Work'),
    { kind: 'smart', smartListId: 99, query: 'tag = work', label: 'tmp' },
  );
  check(noop.verdict === 'noop', `8: already-matching "tag = work" is noop (got ${noop.verdict})`);
  // contradictory equalities are reported, not resolved
  const conflict = planBoardMove(
    task({ listId: 2 }),
    listRef(2, 'Home'),
    { kind: 'smart', smartListId: 99, query: 'priority = high AND priority = low', label: 'tmp' },
  );
  check(
    !conflict.changes.some((c) => c.field === 'priority') &&
      conflict.skipped.some((x) => x.includes('priority is constrained twice')),
    `8: contradictory equalities keep conflict reporting (got ${JSON.stringify(conflict.skipped)})`,
  );
}

// ---- 9. Relative dates (TQL-002): equality-derived dates resolve to absolute ISO at action time ----
{
  // independent local-calendar oracle (Date normalises the overflowing day/month)
  const shifted = (dd, dm, dy) => {
    const n = new Date();
    const d = new Date(n.getFullYear() + dy, n.getMonth() + dm, n.getDate() + dd);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const dest = (query) => ({ kind: 'smart', smartListId: 99, query, label: 'tmp' });
  const source = listRef(2, 'Home');
  const ISO = /^\d{4}-\d{2}-\d{2}$/;

  const plan7 = planBoardMove(task({ listId: 2 }), source, dest('due = today+7d'));
  const rem7 = plan7.changes.find((c) => c.field === 'reminder');
  const want7 = shifted(7, 0, 0);
  check(plan7.verdict === 'deterministic', `9: due = today+7d is invertible (got ${plan7.verdict})`);
  check(Boolean(rem7) && rem7.chip === `Due ${want7}`, `9: today+7d resolved to ${want7} (got ${rem7 && rem7.chip})`);
  const applied7 = task({ listId: 2 });
  if (rem7) rem7.apply(applied7);
  check(ISO.test(applied7.reminderDate ?? ''), `9: the applied task date is absolute (got ${applied7.reminderDate})`);

  check(resolveDue('today-1w') === shifted(-7, 0, 0), '9: resolveDue today-1w');
  check(resolveDue('today+2w') === shifted(14, 0, 0), '9: resolveDue today+2w');
  check(resolveDue('today+1m') === shifted(0, 1, 0) || new Date().getDate() > 28, '9: resolveDue today+1m');
  check(resolveDue('today-1y') === shifted(0, 0, -1) || (new Date().getMonth() === 1 && new Date().getDate() === 29), '9: resolveDue today-1y');
  check(resolveDue('TODAY+0D') === isoToday(), '9: resolveDue is case-insensitive');
  check(resolveDue('today') === isoToday() && resolveDue('2026-09-05') === '2026-09-05', '9: keywords and absolute dates unchanged');
  check(resolveDue('today+99999999d') === null, '9: an unrepresentable date resolves to null, not a wrapped date');

  const seedOf = (query) => templateSeed(deriveTemplate(parseQuery(query).ast));
  check(seedOf('due = today+7d')?.reminderDate === want7, '9: task creation seeds an absolute reminderDate');
  check(seedOf('due = "today+7d"')?.reminderDate === want7, '9: quoted relative equality seeds the same date');
  check(seedOf('due = today+7d AND repeat = weekly')?.repeatStart === want7, '9: repeatStart follows the resolved date');
  check(seedOf('due <= today+7d') === undefined, '9: range templates still seed no date');
  check(seedOf('due BETWEEN today AND today+7d') === undefined, '9: BETWEEN templates still seed no date');
  check(seedOf('due IN (today+1d, today+2d)') === undefined, '9: IN templates still seed no date');
  check(seedOf('due = today+99999999d') === undefined, '9: an unrepresentable equality seeds nothing');

  const planRange = planBoardMove(task({ listId: 2 }), source, dest('due <= today+7d'));
  check(planRange.verdict === 'blocked', `9: a relative range destination is still uninvertible (got ${planRange.verdict})`);
  const planSame = planBoardMove(task({ listId: 2, reminderDate: want7 }), source, dest('due = today+7d'));
  check(planSame.verdict === 'noop', `9: a task already due then is a noop (got ${planSame.verdict})`);
  const planBad = planBoardMove(task({ listId: 2 }), source, dest('due = today+99999999d'));
  check(
    planBad.changes.length === 0 && planBad.skipped.some((x) => x.includes('today+99999999d')),
    `9: an unrepresentable destination writes nothing and says so (got ${JSON.stringify(planBad.skipped)})`,
  );
}

if (failures) {
  console.error(`\nboard-move self-test FAILED: ${failures} of ${checks} checks failed`);
  process.exitCode = 1;
} else {
  console.log(`board-move self-test passed (${checks} checks)`);
}
