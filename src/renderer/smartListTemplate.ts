// Inverts a smart list's query into defaults for a newly added task.
//
// A smart list is a predicate, and "add a task to a predicate" is under-determined -- many
// different tasks satisfy `tag:errands AND priority:high`. It is decidable for the subset of
// queries that are a conjunction of equality terms: a `term` node using `:` that sits under
// only `and` nodes is a straight assignment. Everything else (OR, NOT, ranges, contains) has
// no single satisfying assignment and is reported in `skipped` rather than guessed at.
//
// Must stay free of dom/state/browser imports, like query.ts, so scripts/query-selftest.mjs
// can exercise it from dist/.
import type { Task } from '../types.js';
import type { QueryNode } from './query.js';

export type SmartListTemplate = {
  /** absent = unconstrained; null = `list:none`, i.e. explicitly no list */
  listName?: string | null;
  tagNames: string[];
  priority?: Task['priority'];
  /** an ISO date or one of today/tomorrow/yesterday; the caller resolves keywords */
  due?: string;
  /** an RRULE frequency: daily | weekly | monthly | yearly */
  repeat?: string;
  /** human-readable constraints that could not be turned into an assignment */
  skipped: string[];
};

/** Renders a node back to query syntax, for the "not applied" note. */
export const unparse = (node: QueryNode): string => {
  switch (node.kind) {
    case 'and':
      return `${unparse(node.left)} AND ${unparse(node.right)}`;
    case 'or':
      return `(${unparse(node.left)} OR ${unparse(node.right)})`;
    case 'not':
      return `NOT ${unparse(node.child)}`;
    case 'term':
      return `${node.field}${node.op}${node.quoted ? `"${node.value}"` : node.value}`;
    case 'bare':
      // a quoted primary parses to a bare node and loses its quoting, so re-add it when the
      // value could not have been written unquoted
      return /\s/.test(node.value) ? `"${node.value}"` : node.value;
  }
};

const isSpecial = (node: Extract<QueryNode, { kind: 'term' }>, word: string) =>
  !node.quoted && node.value.toLowerCase() === word;

/** Distinct-value check that treats names case-insensitively, as the evaluator does. */
const distinct = (values: string[]): string[] => {
  const seen = new Map<string, string>();
  values.forEach((v) => {
    const key = v.toLowerCase();
    if (!seen.has(key)) seen.set(key, v);
  });
  return [...seen.values()];
};

export const deriveTemplate = (ast: QueryNode | null): SmartListTemplate => {
  const lists: (string | null)[] = [];
  const tags: string[] = [];
  const priorities: string[] = [];
  const dues: string[] = [];
  const repeats: string[] = [];
  const skipped: string[] = [];
  let tagNone = false;

  const skip = (node: QueryNode) => {
    const text = unparse(node);
    if (!skipped.includes(text)) skipped.push(text);
  };

  const visitTerm = (node: Extract<QueryNode, { kind: 'term' }>) => {
    // only '=' style equality can be inverted; ~ != < <= > >= all describe sets, not values
    if (node.op !== ':') {
      skip(node);
      return;
    }
    switch (node.field) {
      case 'list':
        lists.push(isSpecial(node, 'none') ? null : node.value);
        return;
      case 'tag':
        if (isSpecial(node, 'any')) {
          skip(node);
          return;
        }
        if (isSpecial(node, 'none')) {
          tagNone = true;
          return;
        }
        tags.push(node.value);
        return;
      case 'priority':
        priorities.push(node.value.toLowerCase());
        return;
      case 'due':
        if (isSpecial(node, 'any')) {
          skip(node);
          return;
        }
        // 'none' is assignable: it means no due date, which is a new task's default
        dues.push(node.value.toLowerCase());
        return;
      case 'repeat':
        if (isSpecial(node, 'any')) {
          skip(node);
          return;
        }
        repeats.push(node.value.toLowerCase());
        return;
      case 'done':
        // a new task is never done, so done:false is already satisfied and needs no note;
        // done:true would mean creating an already-completed task, which is not a default
        if (!isSpecial(node, 'false')) skip(node);
        return;
      default:
        // text / details -- the user types the task's own text, so seeding it from the
        // smart list would put words in their mouth
        skip(node);
    }
  };

  const visit = (node: QueryNode) => {
    switch (node.kind) {
      case 'and':
        visit(node.left);
        visit(node.right);
        return;
      case 'or':
      case 'not':
        // a disjunction has no single satisfying assignment and a negation is not an
        // assignment at all; report the whole subtree rather than descending into it
        skip(node);
        return;
      case 'term':
        visitTerm(node);
        return;
      case 'bare':
        skip(node);
    }
  };

  if (ast) visit(ast);

  const template: SmartListTemplate = { tagNames: [], skipped };

  // A repeated field with differing values is a contradiction -- no task can satisfy it -- so
  // silently picking one would be a lie. Report it and assign nothing.
  // `null` (an explicit `field:none`) is keyed as itself rather than via a string sentinel,
  // so a list genuinely *named* "none" can never collide with it.
  const single = <T extends string | null>(values: T[], label: string): T | undefined => {
    if (values.length === 0) return undefined;
    const seen = new Map<string | null, T>();
    values.forEach((value) => {
      const key = value === null ? null : value.toLowerCase();
      if (!seen.has(key)) seen.set(key, value);
    });
    const uniq = [...seen.values()];
    if (uniq.length > 1) {
      // "no <field>" rather than "none", so a conflict against something genuinely *named*
      // "none" does not read as `(none, none)`
      const shown = uniq.map((v) => (v === null ? `no ${label}` : v));
      skipped.push(`${label} is constrained twice (${shown.join(', ')})`);
      return undefined;
    }
    return uniq[0];
  };

  const listName = single(lists, 'list');
  if (listName !== undefined) template.listName = listName;

  const priority = single(priorities, 'priority');
  if (priority !== undefined) template.priority = priority as Task['priority'];

  const due = single(dues, 'due');
  // due:none is the default (no date), so it needs no assignment
  if (due !== undefined && due !== 'none') template.due = due;

  const repeat = single(repeats, 'repeat');
  if (repeat !== undefined && repeat !== 'none') template.repeat = repeat;

  const tagNames = distinct(tags);
  if (tagNone && tagNames.length > 0) {
    skipped.push(`tag is constrained twice (none, ${tagNames.join(', ')})`);
  } else if (!tagNone) {
    template.tagNames = tagNames;
  }

  return template;
};
