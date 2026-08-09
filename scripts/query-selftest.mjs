// Manual self-test for the advanced-search query engine.
// Run after `npm run build`:  node scripts/query-selftest.mjs
import { parseQuery, compilePredicate, queryUsesField } from '../dist/renderer/query.js';
import { deriveTemplate } from '../dist/renderer/filterTemplate.js';

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

// deriveTemplate: inverting a saved filter into defaults for a new task.
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
  ['done:true', { tagNames: [], skipped: ['done:true'] }],
  ['milk', { tagNames: [], skipped: ['milk'] }],
  // no single satisfying assignment
  ['tag:a OR tag:b', { tagNames: [], skipped: ['(tag:a OR tag:b)'] }],
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

const total =
  matchCases.length + errorCases.length + usesDoneCases.length + templateCases.length;
if (failures) {
  console.error(`\n${failures}/${total} cases failed`);
  process.exit(1);
}
console.log(`All ${total} query cases passed`);
