// Manual self-test for the advanced-search query engine.
// Run after `npm run build`:  node scripts/query-selftest.mjs
import { parseQuery, compilePredicate, queryUsesField, resolveRelativeDate } from '../dist/renderer/query.js';
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

// ---- TQL-002: relative local dates (today+Nd, today-Nd; units d, w, m, y) ----
const relIso = (value, today) => {
  const r = resolveRelativeDate(value, today);
  return r && 'iso' in r ? r.iso : r;
};
// [value, todayISO, expected]
const relResolveCases = [
  ['today+0d', '2026-08-08', '2026-08-08'],
  ['today-0d', '2026-08-08', '2026-08-08'],
  ['today+007d', '2026-08-08', '2026-08-15'],
  ['today+1d', '2026-08-31', '2026-09-01'],
  ['today-1d', '2026-09-01', '2026-08-31'],
  ['today+1d', '2026-12-31', '2027-01-01'],
  ['today-1d', '2027-01-01', '2026-12-31'],
  ['today+1d', '2024-02-28', '2024-02-29'],
  ['today+1d', '2026-02-28', '2026-03-01'],
  ['today+7d', '2026-08-08', '2026-08-15'],
  ['today-7d', '2026-08-08', '2026-08-01'],
  ['today+1w', '2026-08-08', '2026-08-15'],
  ['today-2w', '2026-08-08', '2026-07-25'],
  ['today+52w', '2026-08-08', '2027-08-07'],
  ['today+1m', '2026-01-31', '2026-02-28'],
  ['today+1m', '2024-01-31', '2024-02-29'],
  ['today+1m', '2026-08-08', '2026-09-08'],
  ['today+5m', '2026-08-31', '2027-01-31'],
  ['today+4m', '2026-10-31', '2027-02-28'],
  ['today-1m', '2026-03-31', '2026-02-28'],
  ['today-1m', '2024-03-31', '2024-02-29'],
  ['today-1m', '2026-01-15', '2025-12-15'],
  ['today+12m', '2026-08-08', '2027-08-08'],
  ['today+1y', '2024-02-29', '2025-02-28'],
  ['today+4y', '2024-02-29', '2028-02-29'],
  ['today-1y', '2024-02-29', '2023-02-28'],
  ['today-4y', '2024-02-29', '2020-02-29'],
  ['today+1y', '2026-08-08', '2027-08-08'],
  ['TODAY+1D', '2026-08-08', '2026-08-09'],
  ['Today-1W', '2026-08-08', '2026-08-01'],
  ['today+1M', '2026-08-08', '2026-09-08'],
  ['today+0001y', '2026-08-08', '2027-08-08'],
  // Europe/Warsaw DST changes (2026-03-29 has 23 hours, 2026-10-25 has 25): whole calendar days
  ['today+1d', '2026-03-28', '2026-03-29'],
  ['today+1d', '2026-03-29', '2026-03-30'],
  ['today-1d', '2026-03-30', '2026-03-29'],
  ['today+1w', '2026-03-25', '2026-04-01'],
  ['today+1w', '2026-10-21', '2026-10-28'],
  ['today-1w', '2026-10-28', '2026-10-21'],
  ['today+1d', '2026-10-24', '2026-10-25'],
  ['today+1d', '2026-10-25', '2026-10-26'],
  ['today-1d', '2026-10-26', '2026-10-25'],
  ['today+7d', '2026-03-23', '2026-03-30'],
  ['today+1m', '2026-02-28', '2026-03-28'],
  ['today+1m', '2026-03-29', '2026-04-29'],
  ['today+1m', '2026-09-25', '2026-10-25'],
  ['today+1y', '2025-10-25', '2026-10-25'],
  ['today+1d', '0099-12-31', '0100-01-01'], // years below 100 are not remapped to 19xx
  ['today+9999y', '2026-08-08', { beyond: 1 }],
  ['today-9999y', '2026-08-08', { beyond: -1 }],
  ['today+99999999d', '2026-08-08', { beyond: 1 }],
  ['today-99999999d', '2026-08-08', { beyond: -1 }],
  ['today+9007199254740991d', '2026-08-08', { beyond: 1 }],
  ['today+3000000d', '2026-08-08', { beyond: 1 }],
  ['today+1d', '9999-12-31', { beyond: 1 }],
  ['today-1d', '0001-01-01', { beyond: -1 }],
  ['today+1d', 'not-a-date', { invalid: true }],
  ['tomorrow', '2026-08-08', null],
];
for (const [value, today, want] of relResolveCases) {
  const got = relIso(value, today);
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failures += 1;
    console.error(`FAIL  resolveRelativeDate(${value}, ${today}) — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

// Same data as `tasks`, with dates around ctx.todayISO (2026-08-08); ids 4/5/6 are -1/0/+1 days.
const relTasks = [
  task(21, { reminderDate: '2026-08-01' }), // -7d
  task(22, { reminderDate: '2026-08-07' }), // -1d
  task(23, { reminderDate: '2026-08-08' }), // today
  task(24, { reminderDate: '2026-08-09' }), // +1d
  task(25, { reminderDate: '2026-08-15' }), // +7d / +1w
  task(26, { reminderDate: '2026-08-16' }), // +8d
  task(27, { reminderDate: '2026-09-08' }), // +1m
  task(28, { reminderDate: '2027-08-08' }), // +1y
  task(29, { reminderDate: null }),
];
const runRel = (query, c = ctx, list = relTasks) => {
  const parsed = parseQuery(query);
  if (!parsed.ok) return { error: parsed.error };
  const predicate = compilePredicate(parsed.ast);
  return { ids: list.filter((t) => predicate(t, c)).map((t) => t.id) };
};
const relMatchCases = [
  // every comparison operator, both spellings of equality
  ['due:today+7d', [25]],
  ['due=today+7d', [25]],
  ['due = today+7d', [25]],
  ['due:today+1w', [25]],
  ['due:today-7d', [21]],
  ['due!=today+7d', [21, 22, 23, 24, 26, 27, 28, 29]], // null due is "not equal"
  ['due<today+7d', [21, 22, 23, 24]],
  ['due<=today+7d', [21, 22, 23, 24, 25]],
  ['due > today+7d', [26, 27, 28]],
  ['due>=today+7d', [25, 26, 27, 28]],
  ['due<today-0d', [21, 22]],
  ['due>=today+0d', [23, 24, 25, 26, 27, 28]],
  ['due:today+1m', [27]],
  ['due:today+1y', [28]],
  ['due<=today-1d', [21, 22]], // overdue
  // case-insensitive keyword and units, quoted values, whitespace around operators
  ['DUE:TODAY+7D', [25]],
  ['due:"today+7d"', [25]],
  ['due <= "Today+7D"', [21, 22, 23, 24, 25]],
  ['due   >=   today-1d   AND   due   <=   today+1d', [22, 23, 24]],
  // IN: members may mix absolute, keyword and relative values; null due never matches
  ['due IN (today+7d, today-7d)', [21, 25]],
  ['due IN (today+1w, 2026-08-09, tomorrow, "today+1m")', [24, 25, 27]],
  ['due IN (today+0d)', [23]],
  // BETWEEN: either bound relative, mixed with absolute, inclusive; reversed matches nothing
  ['due BETWEEN today AND today+7d', [23, 24, 25]],
  ['due BETWEEN today-7d AND today', [21, 22, 23]],
  ['due BETWEEN today-1d AND today+1d', [22, 23, 24]],
  ['due BETWEEN 2026-08-07 AND today+1d', [22, 23, 24]],
  ['due BETWEEN yesterday AND today+8d', [22, 23, 24, 25, 26]],
  ['due BETWEEN "today+1d" AND "today+7d"', [24, 25]],
  ['due BETWEEN today+7d AND today', []],
  ['due BETWEEN today+1d AND today-1d', []],
  ['due between today+0d and today+0d', [23]],
  // composition with the rest of the language is unchanged
  ['due<=today+7d OR due>today+1y', [21, 22, 23, 24, 25]],
  ['NOT due<=today+7d', [26, 27, 28, 29]], // a null due is not <= anything, so NOT keeps it
  ['due IS NULL OR due>today+1m', [28, 29]],
  ['due<today+7d due>today-7d', [22, 23, 24]], // implicit AND
  // absolute dates and existing keywords still work next to the new values
  ['due:2026-08-15', [25]],
  ['due:tomorrow', [24]],
  // beyond the representable range: deterministic, no crash, no string comparison
  ['due<today+99999999d', [21, 22, 23, 24, 25, 26, 27, 28]],
  ['due<=today+9999y', [21, 22, 23, 24, 25, 26, 27, 28]],
  ['due>today+99999999d', []],
  ['due:today+99999999d', []],
  ['due!=today+99999999d', [21, 22, 23, 24, 25, 26, 27, 28, 29]],
  ['due>today-99999999d', [21, 22, 23, 24, 25, 26, 27, 28]],
  ['due<today-99999999d', []],
  ['due BETWEEN today AND today+99999999d', [23, 24, 25, 26, 27, 28]],
];
for (const [query, expected] of relMatchCases) {
  const result = runRel(query);
  if (result.error) {
    failures += 1;
    console.error(`FAIL  ${JSON.stringify(query)} — unexpected error: ${result.error.message}`);
  } else if (JSON.stringify(result.ids) !== JSON.stringify(expected)) {
    failures += 1;
    console.error(`FAIL  ${JSON.stringify(query)} — got ${JSON.stringify(result.ids)}, want ${JSON.stringify(expected)}`);
  }
}

// An unusable base date never crashes and never string-compares: only `!=` can hold.
{
  const bad = { ...ctx, todayISO: 'garbage' };
  const got = ['due<today+1d', 'due:today+1d', 'due>=today-1d', 'due!=today+1d'].map((q) => runRel(q, bad).ids);
  const want = [[], [], [], [21, 22, 23, 24, 25, 26, 27, 28, 29]];
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failures += 1;
    console.error(`FAIL  invalid todayISO — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

// One compiled predicate, reused as the date advances: no reparse, no recompile.
{
  const parsed = parseQuery('due <= today+7d AND due >= today-1d');
  const predicate = compilePredicate(parsed.ast);
  const dated = [
    task(31, { reminderDate: '2026-12-31' }),
    task(32, { reminderDate: '2027-01-01' }),
    task(33, { reminderDate: '2027-01-07' }),
    task(34, { reminderDate: '2027-01-08' }),
    task(35, { reminderDate: '2027-01-09' }),
  ];
  const at = (todayISO) => dated.filter((t) => predicate(t, { ...ctx, todayISO })).map((t) => t.id);
  const sequence = [
    ['2026-12-31', [31, 32, 33]],
    ['2027-01-01', [31, 32, 33, 34]],
    ['2027-01-02', [32, 33, 34, 35]],
    ['2027-01-09', [34, 35]],
    ['2026-12-31', [31, 32, 33]], // going back is just as consistent
  ];
  for (const [todayISO, want] of sequence) {
    const got = at(todayISO);
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      failures += 1;
      console.error(`FAIL  reused predicate at ${todayISO} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    }
  }
  // month-end rollover through the same compiled predicate
  const monthly = compilePredicate(parseQuery('due = today+1m').ast);
  const leap = task(36, { reminderDate: '2024-02-29' });
  const plain = task(37, { reminderDate: '2026-02-28' });
  const m = (t, todayISO) => monthly(t, { ...ctx, todayISO });
  if (!m(leap, '2024-01-31') || m(plain, '2024-01-31') || !m(plain, '2026-01-31') || m(leap, '2026-01-31')) {
    failures += 1;
    console.error('FAIL  reused predicate month-end clamping');
  }
}

// Malformed relative values: positioned (at the value), describing the supported syntax.
const relErrorCases = [
  ['due:today+', 'Invalid relative date', 4],
  ['due:today-', 'Invalid relative date', 4],
  ['due:today+7', 'Invalid relative date', 4],
  ['due:today+1.5d', 'Invalid relative date', 4],
  ['due:today++2d', 'Invalid relative date', 4],
  ['due:today+-2d', 'Invalid relative date', 4],
  ['due:today+2h', 'Invalid relative date', 4],
  ['due:today+1d-2d', 'Invalid relative date', 4],
  ['due:today+1d+2d', 'Invalid relative date', 4],
  ['due:today+d', 'Invalid relative date', 4],
  ['due:today+1dd', 'Invalid relative date', 4],
  ['due:today+१d', 'Invalid relative date', 4],
  ['due:"today + 7d"', 'Invalid date', 4],
  ['due = today+', 'Invalid relative date', 6],
  ['due >= today+7', 'Invalid relative date', 7],
  ['due < today+1.5d', 'Invalid relative date', 6],
  ['due:today+99999999999999999999d', 'too large', 4],
  ['due:today+9007199254740992d', 'too large', 4],
  ['due IN (today+1d, today+2h)', 'Invalid relative date', 18],
  ['due IN (today+)', 'Invalid relative date', 8],
  ['due BETWEEN today+ AND today', 'Invalid relative date', 12],
  ['due BETWEEN today AND today+7', 'Invalid relative date', 22],
  ['due BETWEEN today AND today+1d-2d', 'Invalid relative date', 22],
  ['due:tomorrow+1d', 'Invalid date', 4],
  ['due:yesterday-1d', 'Invalid date', 4],
  ['due:now+1d', 'Invalid date', 4],
  ['due:today1d', 'Invalid date', 4],
  ['due:next+1d', 'Invalid date', 4],
];
for (const [query, substring, column] of relErrorCases) {
  const result = run(query);
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
  if (substring === 'Invalid relative date' && !/today\+Nd or today-Nd.*d, w, m or y/.test(result.error.message)) {
    failures += 1;
    console.error(`FAIL  ${JSON.stringify(query)} — message does not describe the syntax: ${result.error.message}`);
  }
}

// Template derivation keeps the expression symbolic; range/IN forms stay skipped as before.
const relTemplateCases = [
  ['due = today+7d', { due: 'today+7d', skipped: [] }],
  ['due:TODAY-2W', { due: 'today-2w', skipped: [] }],
  ['due = "today+1m" AND priority = high', { due: 'today+1m', priority: 'high', skipped: [] }],
  ['due <= today+7d', { due: undefined, skipped: ['due<=today+7d'] }],
  ['due BETWEEN today AND today+7d', { due: undefined, skipped: ['due>=today', 'due<=today+7d'] }],
  ['due IN (today+1d, today+2d)', { due: undefined, skipped: ['(due:today+1d OR due:today+2d)'] }],
  ['due = today+1d AND due = today+2d', { due: undefined, skipped: ['due is constrained twice (today+1d, today+2d)'] }],
];
for (const [query, expected] of relTemplateCases) {
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

// Equivalence with existing keywords: today+1d == tomorrow, today-1d == yesterday, today+0d == today
for (const [rel, kw] of [['today+1d', 'tomorrow'], ['today-1d', 'yesterday'], ['today+0d', 'today']]) {
  for (const op of [':', '!=', '<', '<=', '>', '>=']) {
    const a = run(`due${op}${rel}`);
    const b = run(`due${op}${kw}`);
    if (JSON.stringify(a.ids) !== JSON.stringify(b.ids)) {
      failures += 1;
      console.error(`FAIL  due${op}${rel} vs due${op}${kw}: ${JSON.stringify(a.ids)} vs ${JSON.stringify(b.ids)}`);
    }
  }
}
// The issue's moving-window examples against the original fixtures (ids 4/5/6 = -1/0/+1 days)
for (const [query, want] of [
  ['due < today AND done = false', [4]],
  ['due <= today+7d', [4, 5, 6]],
  ['due BETWEEN today AND today+7d', [5, 6]],
  ['due BETWEEN today+1d AND today-1d', []],
]) {
  const got = run(query).ids;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failures += 1;
    console.error(`FAIL  ${JSON.stringify(query)} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}
const relTotal =
  relResolveCases.length + relMatchCases.length + relErrorCases.length + relTemplateCases.length + 1 + 5 + 1 + 18 + 4;

const total =
  relTotal +
  matchCases.length + errorCases.length + usesDoneCases.length + templateCases.length +
  equivalenceCases.length + sqlMatchCases.length + sqlErrorCases.length + sqlUsesDone.length +
  sqlTemplateEquivalence.length + sqlTemplateCases.length;
if (failures) {
  console.error(`\n${failures}/${total} cases failed`);
  process.exit(1);
}
console.log(`All ${total} query cases passed`);
