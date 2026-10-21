// Manual self-test for the advanced-search query engine.
// Run after `npm run build`:  node scripts/query-selftest.mjs
import { parseQuery, compilePredicate, queryUsesField } from '../dist/renderer/query.js';
import { deriveTemplate } from '../dist/renderer/smartListTemplate.js';

const ctx = {
  listNameById: new Map([
    [1, 'home'],
    [2, 'foo list 1'],
  ]),
  tagNameById: new Map([
    [1, 'errands'],
    [2, 'urgent'],
    [3, 'none'],
  ]),
  todayISO: '2026-08-08',
};

const task = (id, overrides = {}) => ({
  id,
  text: `task ${id}`,
  details: '',
  done: false,
  position: id,
  listId: null,
  priority: 'none',
  reminderDate: null,
  reminderTime: null,
  repeatRule: null,
  repeatStart: null,
  seriesId: null,
  tagIds: [],
  ...overrides,
});

const tasks = [
  task(1, { text: 'Buy milk', listId: 1, tagIds: [1] }),
  task(2, { text: 'pay bills extra', details: 'water and MILK budget', listId: 2, tagIds: [1, 2], priority: 'high' }),
  task(3, { text: 'done thing', done: true, listId: 1 }),
  task(4, { text: 'due yesterday', reminderDate: '2026-08-07', priority: 'low' }),
  task(5, { text: 'due today', reminderDate: '2026-08-08', priority: 'medium' }),
  task(6, { text: 'due tomorrow', reminderDate: '2026-08-09' }),
  task(7, { text: 'weekly chore', repeatRule: 'FREQ=WEEKLY;BYDAY=MO', listId: 2 }),
  task(8, { text: 'daily habit', repeatRule: 'DTSTART:x\nFREQ=DAILY' }),
  task(9, { text: 'tagged none-tag', tagIds: [3] }),
  task(10, { text: 'AND OR NOT literal words' }),
];

const run = (query) => {
  const parsed = parseQuery(query);
  if (!parsed.ok) return { error: parsed.error };
  const predicate = compilePredicate(parsed.ast);
  return { ids: tasks.filter((t) => predicate(t, ctx)).map((t) => t.id) };
};

const matchCases = [
  ['milk', [1, 2]],
  ['buy milk', [1]],
  ['MILK budget', [2]],
  ['text~milk', [1]],
  ['text:"buy milk"', [1]],
  ['text!="buy milk"', [2, 3, 4, 5, 6, 7, 8, 9, 10]],
  ['details~budget', [2]],
  ['list:Home', [1, 3]],
  ['list:"Foo list 1"', [2, 7]],
  ['list~foo', [2, 7]],
  ['list:none', [4, 5, 6, 8, 9, 10]],
  ['list!=home', [2, 4, 5, 6, 7, 8, 9, 10]],
  ['tag:errands', [1, 2]],
  ['tag:ERRANDS tag:urgent', [2]],
  ['tag~urg', [2]],
  ['tag:none', [3, 4, 5, 6, 7, 8, 10]],
  ['tag:"none"', [9]],
  ['tag:any', [1, 2, 9]],
  ['tag!=errands', [3, 4, 5, 6, 7, 8, 9, 10]],
  ['tag:nosuch', []],
  ['#errands', [1, 2]],
  ['priority:high OR priority:medium', [2, 5]],
  ['priority!=none', [2, 4, 5]],
  ['done:true', [3]],
  ['done:false AND due<=today', [4, 5]],
  ['due:none', [1, 2, 3, 7, 8, 9, 10]],
  ['due:any', [4, 5, 6]],
  ['due:today', [5]],
  ['due:tomorrow', [6]],
  ['due<today', [4]],
  ['due>=2026-08-08', [5, 6]],
  ['due!=today', [1, 2, 3, 4, 6, 7, 8, 9, 10]],
  ['repeat:weekly', [7]],
  ['repeat:daily', [8]],
  ['repeat:any', [7, 8]],
  ['repeat:none', [1, 2, 3, 4, 5, 6, 9, 10]],
  ['repeat!=weekly', [1, 2, 3, 4, 5, 6, 8, 9, 10]],
  ['NOT done:true', [1, 2, 4, 5, 6, 7, 8, 9, 10]],
  ['NOT (list:home OR done:true)', [2, 4, 5, 6, 7, 8, 9, 10]],
  // precedence: a OR b c  ==  a OR (b AND c)
  ['tag:urgent OR list:home done:false', [1, 2]],
  ['(tag:urgent OR list:home) done:false', [1, 2]],
  ['tag:urgent OR (list:home AND done:true)', [2, 3]],
  ['not Done:TRUE and Priority:High', [2]],
  ['"and"', [2, 10]],
  ['', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]],
  ['   ', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]],
];

const errorCases = [
  ['due:', 'Expected value'],
  ['priority~high', 'not valid for priority'],
  ['"unclosed', 'Unclosed quote'],
  ['(tag:urgent OR', 'Expected'],
  ['tag:urgent)', 'Unexpected ")"'],
  ['foo:bar', 'Unknown field "foo"'],
  ['priority:urgent', 'priority must be'],
  ['done:yes', 'done must be true or false'],
  ['due<none', 'cannot be used'],
  ['due:someday', 'Invalid date'],
  ['NOT', 'Expected expression after "NOT"'],
  ['< 5', 'Unexpected "<"'],
  ['repeat:sometimes', 'repeat must be'],
  // SQL operators the language lacks are reported, not silently searched as words
  ['priority LIKE high', 'LIKE is not supported for priority'],
  ['due LIKE 2026', 'LIKE is not supported for due'],
  ['tag NOT IN (work)', 'NOT IN is not supported for tag'],
  ['priority <> high', '"<>" is not supported'],
  ['priority = urgent AND done = false', 'priority must be'],
];

let failures = 0;

for (const [query, expected] of matchCases) {
  const result = run(query);
  if (result.error) {
    failures += 1;
    console.error(`FAIL  ${JSON.stringify(query)} — unexpected error: ${result.error.message}`);
    continue;
  }
  const got = JSON.stringify(result.ids);
  const want = JSON.stringify(expected);
  if (got !== want) {
    failures += 1;
    console.error(`FAIL  ${JSON.stringify(query)} — got ${got}, want ${want}`);
  }
}

for (const [query, substring] of errorCases) {
  const result = run(query);
  if (!result.error) {
    failures += 1;
    console.error(`FAIL  ${JSON.stringify(query)} — expected error containing ${JSON.stringify(substring)}, got ids ${JSON.stringify(result.ids)}`);
    continue;
  }
  if (!result.error.message.includes(substring)) {
    failures += 1;
    console.error(`FAIL  ${JSON.stringify(query)} — error ${JSON.stringify(result.error.message)} does not contain ${JSON.stringify(substring)}`);
  }
}

const usesDoneCases = [
  ['done:true', true],
  ['NOT (list:home OR done:false)', true],
  ['tag:errands AND due<=today', false],
  ['done', false], // bare word, not the field
  ['', false],
];
for (const [query, expected] of usesDoneCases) {
  const parsed = parseQuery(query);
  if (!parsed.ok) {
    failures += 1;
    console.error(`FAIL  usesDone ${JSON.stringify(query)} — unexpected error`);
    continue;
  }
  const got = queryUsesField(parsed.ast, 'done');
  if (got !== expected) {
    failures += 1;
    console.error(`FAIL  usesDone ${JSON.stringify(query)} — got ${got}, want ${expected}`);
  }
}

// deriveTemplate: inverting a smart list into defaults for a new task.
// Each case is [query, expected-subset]; `skipped` is compared as an exact array.
const templateCases = [
  // fully assignable conjunctions -- the case that beats Reminders' one-list limit
  ['list:Work AND #urgent AND priority:high',
    { listName: 'Work', tagNames: ['urgent'], priority: 'high', skipped: [] }],
  ['#a #b', { tagNames: ['a', 'b'], skipped: [] }],
  ['list:"Foo list 1"', { listName: 'Foo list 1', tagNames: [], skipped: [] }],
  ['due:today', { due: 'today', tagNames: [], skipped: [] }],
  ['repeat:weekly', { repeat: 'weekly', tagNames: [], skipped: [] }],
  // 'none' means "the default", which a new task already satisfies
  ['list:none', { listName: null, tagNames: [], skipped: [] }],
  ['due:none', { due: undefined, tagNames: [], skipped: [] }],
  ['repeat:none', { repeat: undefined, tagNames: [], skipped: [] }],
  ['tag:none', { tagNames: [], skipped: [] }],
  ['list:Work AND done:false', { listName: 'Work', tagNames: [], skipped: [] }],
  // ranges and contains describe sets, not values
  ['list:Work AND due<=today', { listName: 'Work', tagNames: [], skipped: ['due<=today'] }],
  ['text~milk', { tagNames: [], skipped: ['text~milk'] }],
  ['priority!=none', { tagNames: [], skipped: ['priority!=none'] }],
  ['due:any', { tagNames: [], skipped: ['due:any'] }],
  ['milk', { tagNames: [], skipped: ['milk'] }],
  ['text:"Buy milk"', { tagNames: [], skipped: ['text:"Buy milk"'] }],
  ['details~customer', { tagNames: [], skipped: ['details~customer'] }],
  // exact values of every assignable field
  ['due:2026-08-20', { due: '2026-08-20', tagNames: [], skipped: [] }],
  ['priority:none', { priority: 'none', tagNames: [], skipped: [] }],
  // done:true records a task that is already finished; done:false is a new task's default
  ['done:true', { done: true, tagNames: [], skipped: [] }],
  ['done:false', { done: undefined, tagNames: [], skipped: [] }],
  ['#todo AND done:true', { done: true, tagNames: ['todo'], skipped: [] }],
  // no single satisfying assignment
  ['tag:a OR tag:b', { tagNames: [], skipped: ['(tag:a OR tag:b)'] }],
  ['list:Work OR list:Personal',
    { listName: undefined, tagNames: [], skipped: ['(list:Work OR list:Personal)'] }],
  ['(list:Work OR list:Personal) AND #todo',
    { listName: undefined, tagNames: ['todo'], skipped: ['(list:Work OR list:Personal)'] }],
  ['(priority:high OR priority:medium) AND #work',
    { priority: undefined, tagNames: ['work'],
      skipped: ['(priority:high OR priority:medium)'] }],
  ['#work AND NOT #blocked',
    { tagNames: ['work'], skipped: ['NOT tag:blocked'] }],
  ['NOT list:Home', { tagNames: [], skipped: ['NOT list:Home'] }],
  ['list:Work AND NOT #urgent',
    { listName: 'Work', tagNames: [], skipped: ['NOT tag:urgent'] }],
  // contradictions: report, never pick one
  ['list:Work AND list:Home',
    { listName: undefined, tagNames: [], skipped: ['list is constrained twice (Work, Home)'] }],
  ['priority:high AND priority:low',
    { priority: undefined, tagNames: [],
      skipped: ['priority is constrained twice (high, low)'] }],
  ['tag:none AND #urgent',
    { tagNames: [], skipped: ['tag is constrained twice (none, urgent)'] }],
  ['done:true AND done:false',
    { done: undefined, tagNames: [], skipped: ['done is constrained twice (true, false)'] }],
  // `list:none` (no list) must stay distinct from a list literally *named* "none"
  ['list:"none"', { listName: 'none', tagNames: [], skipped: [] }],
  ['list:"none" AND list:none',
    { listName: undefined, tagNames: [],
      skipped: ['list is constrained twice (none, no list)'] }],
  ['list:none AND list:Work',
    { listName: undefined, tagNames: [],
      skipped: ['list is constrained twice (no list, Work)'] }],
  // case-insensitive de-duplication, matching the evaluator
  ['#Urgent #urgent', { tagNames: ['Urgent'], skipped: [] }],
  ['list:Work AND list:work', { listName: 'Work', tagNames: [], skipped: [] }],
  ['', { tagNames: [], skipped: [] }],
];
for (const [query, expected] of templateCases) {
  const parsed = parseQuery(query);
  if (!parsed.ok) {
    failures += 1;
    console.error(`FAIL  template ${JSON.stringify(query)} — unexpected parse error`);
    continue;
  }
  const got = deriveTemplate(parsed.ast);
  for (const [key, want] of Object.entries(expected)) {
    const actual = got[key];
    const same = JSON.stringify(actual) === JSON.stringify(want);
    if (!same) {
      failures += 1;
      console.error(
        `FAIL  template ${JSON.stringify(query)} .${key} — got ${JSON.stringify(actual)}, want ${JSON.stringify(want)}`
      );
    }
  }
}


// ---- TQL-001: SQL-inspired syntax, normalised onto the existing AST ----
const astOf = (query) => {
  const parsed = parseQuery(query);
  return parsed.ok ? JSON.stringify(parsed.ast) : `ERROR: ${parsed.error.message}`;
};

// [new form, legacy form]: identical normalised AST, hence identical matches
const equivalenceCases = [
  ['priority = high', 'priority:high'],
  ['priority=high', 'priority:high'],
  ['PRIORITY = High', 'PRIORITY:High'],
  ['tag = "none"', 'tag:"none"'],
  ['tag = errands', '#errands'],
  ['done = false', 'done:false'],
  ['done=true', 'done:true'],
  ['due = today', 'due:today'],
  ['due <= today', 'due<=today'],
  ['due = none', 'due:none'],
  ['list = "Foo list 1"', 'list:"Foo list 1"'],
  ['text CONTAINS "buy milk"', 'text~"buy milk"'],
  ['text contains milk', 'text~milk'],
  ['details Contains budget', 'details~budget'],
  ['list CONTAINS foo', 'list~foo'],
  ['tag CONTAINS urg', 'tag~urg'],
  ['tag IN ("errands", "urgent")', '(tag:"errands" OR tag:"urgent")'],
  ['tag in (errands,urgent)', '(tag:errands OR tag:urgent)'],
  ['tag IN ("errands","urgent")', '(tag:"errands" OR tag:"urgent")'],
  ['priority IN (high, medium)', '(priority:high OR priority:medium)'],
  ['priority IN (high, medium, low)', '((priority:high OR priority:medium) OR priority:low)'],
  ['priority IN (high)', 'priority:high'],
  ['done IN (true, false)', '(done:true OR done:false)'],
  ['list IN (home, none)', '(list:home OR list:none)'],
  ['due IN (today, 2026-08-09)', '(due:today OR due:2026-08-09)'],
  ['due IS NULL', 'due:none'],
  ['due is null', 'due:none'],
  ['due IS NOT NULL', 'due!=none'],
  ['Due Is Not Null', 'due!=none'],
  ['due BETWEEN 2026-10-01 AND 2026-10-31', 'due>=2026-10-01 AND due<=2026-10-31'],
  ['due between today and tomorrow', 'due>=today AND due<=tomorrow'],
  ['due BETWEEN yesterday AND today AND done:false', '(due>=yesterday AND due<=today) AND done:false'],
  ['done:false due BETWEEN today AND tomorrow', 'done:false AND (due>=today AND due<=tomorrow)'],
  // precedence: NOT binds tighter than AND, AND tighter than OR; a BETWEEN's AND is its own
  ['NOT tag IN (urgent) AND done = false', 'NOT tag:urgent AND done:false'],
  ['tag IN (urgent, errands) OR due BETWEEN today AND tomorrow AND done = false',
    '(tag:urgent OR tag:errands) OR (due>=today AND due<=tomorrow AND done:false)'],
  ['NOT (due IS NULL OR priority IN (high, low))', 'NOT (due:none OR (priority:high OR priority:low))'],
];
for (const [fresh, legacy] of equivalenceCases) {
  const a = astOf(fresh);
  const b = astOf(legacy);
  if (a.startsWith('ERROR') || b.startsWith('ERROR') || a !== b) {
    failures += 1;
    console.error(`FAIL  equivalence ${JSON.stringify(fresh)} vs ${JSON.stringify(legacy)}\n  ${a}\n  ${b}`);
    continue;
  }
  const ra = run(fresh);
  const rb = run(legacy);
  if (JSON.stringify(ra.ids) !== JSON.stringify(rb.ids)) {
    failures += 1;
    console.error(`FAIL  equivalence matches ${JSON.stringify(fresh)}: ${JSON.stringify(ra.ids)} vs ${JSON.stringify(rb.ids)}`);
  }
}

const sqlMatchCases = [
  ['priority = high', [2]],
  ['tag = "none"', [9]],
  ['tag = none', [3, 4, 5, 6, 7, 8, 10]],
  ['text CONTAINS "buy milk"', [1]],
  ['text CONTAINS milk', [1]],
  ['tag IN (errands, urgent)', [1, 2]], // any of the tags, not all
  ['tag IN ("none")', [9]],
  ['tag IN ("none", urgent)', [2, 9]],
  ['tag IN (none, urgent)', [2, 3, 4, 5, 6, 7, 8, 10]],
  ['priority IN (high, medium)', [2, 5]],
  ['done IN (true, false)', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]],
  ['due IS NULL', [1, 2, 3, 7, 8, 9, 10]],
  ['due IS NOT NULL', [4, 5, 6]],
  // inclusive at both ends; tasks without a due date never match
  ['due BETWEEN 2026-08-07 AND 2026-08-08', [4, 5]],
  ['due BETWEEN 2026-08-08 AND 2026-08-08', [5]],
  ['due BETWEEN yesterday AND tomorrow', [4, 5, 6]],
  ['due BETWEEN today AND tomorrow', [5, 6]],
  ['due BETWEEN 2026-08-09 AND 2026-08-07', []], // reversed bounds match nothing
  ['due BETWEEN today AND tomorrow AND list:home', []],
  ['due BETWEEN yesterday AND today AND priority = medium', [5]],
  ['due BETWEEN yesterday AND today OR tag = urgent', [2, 4, 5]],
  ['(due BETWEEN today AND tomorrow) tag IN (urgent)', []],
  // keywords only count in predicate position; elsewhere they are ordinary words
  ['in', [3]], // matches the text of "done thing" only
  ['contains between is null', []],
  ['literal words', [10]],
  ['"tag IN (a)"', []],
  // compact and quoted forms
  ['priority=high done=false', [2]],
  ['tag IN ("a,b")', []],
  // legacy comma-containing values and `=` words are untouched outside IN
  ['tag:a,b', []],
  ['text:"a, b"', []],
  ['a=b', []],
  ['=5', []],
  // SQL-looking input is only ever bare text
  ['SELECT * FROM tasks', []],
  ['SELECT text FROM tasks WHERE done = false', null],
];
for (const [query, expected] of sqlMatchCases) {
  const result = run(query);
  if (expected === null) {
    // a statement-shaped query parses as bare words (or errors); it must never be special
    const parsed = parseQuery(query);
    const ok = !parsed.ok || !JSON.stringify(parsed.ast).includes('"kind":"select"');
    if (!ok) {
      failures += 1;
      console.error(`FAIL  ${JSON.stringify(query)} — SQL statement gained semantics`);
    }
    continue;
  }
  if (result.error) {
    failures += 1;
    console.error(`FAIL  ${JSON.stringify(query)} — unexpected error: ${result.error.message}`);
    continue;
  }
  if (JSON.stringify(result.ids) !== JSON.stringify(expected)) {
    failures += 1;
    console.error(`FAIL  ${JSON.stringify(query)} — got ${JSON.stringify(result.ids)}, want ${JSON.stringify(expected)}`);
  }
}

// [query, message substring, error column (0-based)]
const sqlErrorCases = [
  ['tag IN', 'Expected "(" after "tag IN"', 6],
  ['tag IN a', 'Expected "(" after', 6],
  ['tag IN ()', 'at least one value', 8],
  ['tag IN (a,)', 'Expected value', 10],
  ['tag IN (,a)', 'Expected value', 8],
  ['tag IN (a b)', 'Expected "," or ")"', 10],
  ['tag IN (a', 'Expected "," or ")"', 9],
  ['tag IN (a,', 'Expected value', 10],
  ['priority IN (high, urgent)', 'priority must be', 19],
  ['done IN (true, maybe)', 'done must be true or false', 15],
  ['due IN (today, someday)', 'Invalid date', 15],
  ['due IS', 'Expected NULL or NOT NULL', 6],
  ['due IS NOT', 'Expected NULL after "IS NOT"', 10],
  ['due IS maybe', 'Expected NULL or NOT NULL', 7],
  ['priority IS NULL', 'only supported for due', 9],
  ['tag IS NOT NULL', 'only supported for due', 4],
  ['due BETWEEN', 'Expected lower date', 11],
  ['due BETWEEN AND today', 'Expected lower date', 12],
  ['due BETWEEN today', 'Expected AND', 17],
  ['due BETWEEN today AND', 'Expected upper date', 21],
  ['due BETWEEN today tomorrow', 'Expected AND', 18],
  ['due BETWEEN x AND today', 'Invalid date', 12],
  ['due BETWEEN today AND someday', 'Invalid date', 22],
  ['due BETWEEN none AND today', 'cannot be used', 12],
  ['due BETWEEN today AND any', 'cannot be used', 22],
  ['priority BETWEEN 1 AND 2', 'only supported for due', 9],
  ['priority CONTAINS high', 'CONTAINS is not valid for priority', 9],
  ['done CONTAINS true', 'CONTAINS is not valid for done', 5],
  ['due CONTAINS today', 'CONTAINS is not valid for due', 4],
  ['text CONTAINS', 'Expected value after "text CONTAINS"', 13],
  ['priority = urgent', 'priority must be', 11],
  ['priority =', 'Expected value after "priority ="', 10],
  ['foo = bar', 'Unknown field "foo"', 0],
  ['foo IN (a)', null, null], // not a field: plain words, then an unmatched paren group
];
for (const [query, substring, column] of sqlErrorCases) {
  const result = run(query);
  if (substring === null) continue;
  if (!result.error) {
    failures += 1;
    console.error(`FAIL  ${JSON.stringify(query)} — expected error containing ${JSON.stringify(substring)}`);
    continue;
  }
  if (!result.error.message.includes(substring)) {
    failures += 1;
    console.error(`FAIL  ${JSON.stringify(query)} — error ${JSON.stringify(result.error.message)} does not contain ${JSON.stringify(substring)}`);
  }
  if (result.error.position !== column) {
    failures += 1;
    console.error(`FAIL  ${JSON.stringify(query)} — error position ${result.error.position}, want ${column}`);
  }
}

const sqlUsesDone = [
  ['done IN (true, false)', true],
  ['done = false', true],
  ['tag IN (a) AND done IN (true)', true],
  ['tag IN (a, b)', false],
  ['due BETWEEN today AND tomorrow', false],
];
for (const [query, expected] of sqlUsesDone) {
  const parsed = parseQuery(query);
  if (!parsed.ok || queryUsesField(parsed.ast, 'done') !== expected) {
    failures += 1;
    console.error(`FAIL  usesDone ${JSON.stringify(query)} — want ${expected}`);
  }
}

// deriveTemplate: new equality conjunctions == shorthand; multi-value IN / BETWEEN stay skipped.
const sqlTemplateEquivalence = [
  ['list = Work AND tag = urgent AND priority = high', 'list:Work AND #urgent AND priority:high'],
  ['list = Work AND list = Home', 'list:Work AND list:Home'],
  ['priority = high AND priority = low', 'priority:high AND priority:low'],
  ['priority IN (high)', 'priority:high'],
  ['tag IN (urgent) AND done = true', '#urgent AND done:true'],
  ['due IS NULL', 'due:none'],
  ['due IS NOT NULL', 'due!=none'],
  ['due BETWEEN today AND tomorrow', 'due>=today AND due<=tomorrow'],
  ['tag IN (a, b)', '(tag:a OR tag:b)'],
  ['list = Work AND priority IN (high, low)', 'list:Work AND (priority:high OR priority:low)'],
  ['text CONTAINS milk', 'text~milk'],
  ['list = Work AND NOT tag IN (blocked)', 'list:Work AND NOT tag:blocked'],
];
for (const [fresh, legacy] of sqlTemplateEquivalence) {
  const a = parseQuery(fresh);
  const b = parseQuery(legacy);
  if (!a.ok || !b.ok) {
    failures += 1;
    console.error(`FAIL  template equivalence parse ${JSON.stringify(fresh)}`);
    continue;
  }
  if (JSON.stringify(deriveTemplate(a.ast)) !== JSON.stringify(deriveTemplate(b.ast))) {
    failures += 1;
    console.error(`FAIL  template equivalence ${JSON.stringify(fresh)} vs ${JSON.stringify(legacy)}`);
  }
}
const sqlTemplateCases = [
  ['priority = high', { priority: 'high', skipped: [] }],
  ['priority IN (high)', { priority: 'high', skipped: [] }],
  ['priority IN (high, medium)', { priority: undefined, skipped: ['(priority:high OR priority:medium)'] }],
  ['tag IN (a, b)', { tagNames: [], skipped: ['(tag:a OR tag:b)'] }],
  ['list = Work AND list = Home', { listName: undefined, skipped: ['list is constrained twice (Work, Home)'] }],
  ['due BETWEEN today AND tomorrow', { due: undefined, skipped: ['due>=today', 'due<=tomorrow'] }],
  ['due IS NULL', { due: undefined, skipped: [] }],
  ['due IS NOT NULL', { due: undefined, skipped: ['due!=none'] }],
  ['text CONTAINS milk', { skipped: ['text~milk'] }],
];
for (const [query, expected] of sqlTemplateCases) {
  const parsed = parseQuery(query);
  if (!parsed.ok) {
    failures += 1;
    console.error(`FAIL  template ${JSON.stringify(query)} — unexpected parse error`);
    continue;
  }
  const got = deriveTemplate(parsed.ast);
  for (const [key, want] of Object.entries(expected)) {
    if (JSON.stringify(got[key]) !== JSON.stringify(want)) {
      failures += 1;
      console.error(`FAIL  template ${JSON.stringify(query)} .${key} — got ${JSON.stringify(got[key])}, want ${JSON.stringify(want)}`);
    }
  }
}

const total =
  matchCases.length + errorCases.length + usesDoneCases.length + templateCases.length +
  equivalenceCases.length + sqlMatchCases.length + sqlErrorCases.length + sqlUsesDone.length +
  sqlTemplateEquivalence.length + sqlTemplateCases.length;
if (failures) {
  console.error(`\n${failures}/${total} cases failed`);
  process.exit(1);
}
console.log(`All ${total} query cases passed`);
