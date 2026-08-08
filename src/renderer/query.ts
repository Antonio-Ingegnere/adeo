// Pure query engine for advanced search: tokenizer -> parser -> compiled predicate.
// Must stay free of dom/state/browser imports so it can be exercised from a
// plain node script (scripts/query-selftest.mjs) — the repo has no test runner.
import type { Task } from '../types.js';

export type TokenKind = 'lparen' | 'rparen' | 'op' | 'word' | 'quoted' | 'eof';
export type Token = { kind: TokenKind; text: string; start: number; end: number };

export type Op = ':' | '~' | '!=' | '<' | '<=' | '>' | '>=';

export type QueryNode =
  | { kind: 'and' | 'or'; left: QueryNode; right: QueryNode }
  | { kind: 'not'; child: QueryNode }
  | { kind: 'term'; field: string; op: Op; value: string; quoted: boolean }
  | { kind: 'bare'; value: string };

export type ParseError = { message: string; position: number };
export type ParseResult =
  | { ok: true; ast: QueryNode | null }
  | { ok: false; error: ParseError };

export type EvalContext = {
  listNameById: Map<number, string>; // lowercased names
  tagNameById: Map<number, string>; // lowercased names
  todayISO: string; // 'YYYY-MM-DD' local
};

export type CompiledPredicate = (task: Task, ctx: EvalContext) => boolean;

export type FieldType = 'string' | 'list' | 'tag' | 'enum' | 'bool' | 'date';
export type FieldSpec = {
  name: string;
  type: FieldType;
  ops: Op[];
  values: string[]; // fixed value suggestions (enums/bool/date keywords)
};

const STRING_OPS: Op[] = ['~', ':', '!='];
const ENUM_OPS: Op[] = [':', '!='];
const DATE_OPS: Op[] = [':', '!=', '<', '<=', '>', '>='];

export const FIELDS: FieldSpec[] = [
  { name: 'text', type: 'string', ops: STRING_OPS, values: [] },
  { name: 'details', type: 'string', ops: STRING_OPS, values: [] },
  { name: 'list', type: 'list', ops: STRING_OPS, values: ['none'] },
  { name: 'tag', type: 'tag', ops: STRING_OPS, values: ['none', 'any'] },
  { name: 'priority', type: 'enum', ops: ENUM_OPS, values: ['none', 'low', 'medium', 'high'] },
  { name: 'done', type: 'bool', ops: ENUM_OPS, values: ['true', 'false'] },
  { name: 'due', type: 'date', ops: DATE_OPS, values: ['today', 'tomorrow', 'yesterday', 'none', 'any'] },
  { name: 'repeat', type: 'enum', ops: ENUM_OPS, values: ['none', 'any', 'daily', 'weekly', 'monthly', 'yearly'] },
];

const fieldByName = new Map(FIELDS.map((f) => [f.name, f]));

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_KEYWORDS = ['today', 'tomorrow', 'yesterday'];

// ---------- Tokenizer ----------

const isSpace = (ch: string) => ch === ' ' || ch === '\t' || ch === '\n';
const SINGLE_OPS = new Set([':', '~', '<', '>']);

export const tokenize = (input: string): { ok: true; tokens: Token[] } | { ok: false; error: ParseError } => {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (isSpace(ch)) {
      i += 1;
      continue;
    }
    if (ch === '(') {
      tokens.push({ kind: 'lparen', text: '(', start: i, end: i + 1 });
      i += 1;
      continue;
    }
    if (ch === ')') {
      tokens.push({ kind: 'rparen', text: ')', start: i, end: i + 1 });
      i += 1;
      continue;
    }
    if (ch === '"') {
      const close = input.indexOf('"', i + 1);
      if (close === -1) {
        return { ok: false, error: { message: 'Unclosed quote', position: i } };
      }
      tokens.push({ kind: 'quoted', text: input.slice(i + 1, close), start: i, end: close + 1 });
      i = close + 1;
      continue;
    }
    if (ch === '!' && input[i + 1] === '=') {
      tokens.push({ kind: 'op', text: '!=', start: i, end: i + 2 });
      i += 2;
      continue;
    }
    if ((ch === '<' || ch === '>') && input[i + 1] === '=') {
      tokens.push({ kind: 'op', text: ch + '=', start: i, end: i + 2 });
      i += 2;
      continue;
    }
    if (SINGLE_OPS.has(ch)) {
      tokens.push({ kind: 'op', text: ch, start: i, end: i + 1 });
      i += 1;
      continue;
    }
    // word: run until whitespace, paren, quote, or an operator start
    const start = i;
    while (i < input.length) {
      const c = input[i];
      if (isSpace(c) || c === '(' || c === ')' || c === '"' || SINGLE_OPS.has(c)) break;
      if (c === '!' && input[i + 1] === '=') break;
      i += 1;
    }
    tokens.push({ kind: 'word', text: input.slice(start, i), start, end: i });
  }
  tokens.push({ kind: 'eof', text: '', start: input.length, end: input.length });
  return { ok: true, tokens };
};

// ---------- Parser ----------

const isKeyword = (token: Token, word: string) =>
  token.kind === 'word' && token.text.toUpperCase() === word;

class ParseFailure extends Error {
  position: number;
  constructor(message: string, position: number) {
    super(message);
    this.position = position;
  }
}

const validateTermValue = (field: FieldSpec, op: Op, value: string, quoted: boolean, position: number) => {
  if (!field.ops.includes(op)) {
    throw new ParseFailure(`"${op}" is not valid for ${field.name} (use ${field.ops.join(' or ')})`, position);
  }
  const lower = value.toLowerCase();
  if (field.type === 'enum' && !field.values.includes(lower)) {
    throw new ParseFailure(`${field.name} must be ${field.values.join(', ')}`, position);
  }
  if (field.type === 'bool' && !field.values.includes(lower)) {
    throw new ParseFailure(`${field.name} must be true or false`, position);
  }
  if (field.type === 'date') {
    const isSpecial = !quoted && (lower === 'none' || lower === 'any');
    const isDate = ISO_DATE_RE.test(lower) || DATE_KEYWORDS.includes(lower);
    if (isSpecial) {
      if (op !== ':' && op !== '!=') {
        throw new ParseFailure(`"${op}" cannot be used with ${field.name}:${lower}`, position);
      }
    } else if (!isDate) {
      throw new ParseFailure(
        `Invalid date "${value}" — use YYYY-MM-DD, today, tomorrow or yesterday`,
        position
      );
    }
  }
};

const parseTokens = (tokens: Token[]): QueryNode => {
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  const parseOr = (): QueryNode => {
    let left = parseAnd();
    while (isKeyword(peek(), 'OR')) {
      next();
      const right = parseAnd();
      left = { kind: 'or', left, right };
    }
    return left;
  };

  const startsPrimary = (token: Token) =>
    token.kind === 'lparen' || token.kind === 'quoted' || (token.kind === 'word' && !isKeyword(token, 'OR'));

  const parseAnd = (): QueryNode => {
    let left = parseNot();
    while (true) {
      const token = peek();
      if (isKeyword(token, 'AND')) {
        next();
        left = { kind: 'and', left, right: parseNot() };
        continue;
      }
      if (startsPrimary(token)) {
        left = { kind: 'and', left, right: parseNot() }; // implicit AND
        continue;
      }
      return left;
    }
  };

  const parseNot = (): QueryNode => {
    if (isKeyword(peek(), 'NOT')) {
      const token = next();
      if (peek().kind === 'eof') {
        throw new ParseFailure('Expected expression after "NOT"', token.end);
      }
      return { kind: 'not', child: parseNot() };
    }
    return parsePrimary();
  };

  const parsePrimary = (): QueryNode => {
    const token = peek();
    if (token.kind === 'lparen') {
      next();
      const inner = parseOr();
      if (peek().kind !== 'rparen') {
        throw new ParseFailure('Expected ")"', peek().start);
      }
      next();
      return inner;
    }
    if (token.kind === 'quoted') {
      next();
      return { kind: 'bare', value: token.text };
    }
    if (token.kind === 'word') {
      next();
      const after = peek();
      if (after.kind === 'op') {
        const field = fieldByName.get(token.text.toLowerCase());
        if (!field) {
          throw new ParseFailure(`Unknown field "${token.text}"`, token.start);
        }
        const opToken = next();
        const op = opToken.text as Op;
        const valueToken = peek();
        if (valueToken.kind !== 'word' && valueToken.kind !== 'quoted') {
          throw new ParseFailure(`Expected value after "${field.name} ${op}"`, opToken.end);
        }
        next();
        validateTermValue(field, op, valueToken.text, valueToken.kind === 'quoted', valueToken.start);
        return {
          kind: 'term',
          field: field.name,
          op,
          value: valueToken.text,
          quoted: valueToken.kind === 'quoted',
        };
      }
      // #tag sugar
      if (token.text.startsWith('#') && token.text.length > 1) {
        return { kind: 'term', field: 'tag', op: ':', value: token.text.slice(1), quoted: false };
      }
      return { kind: 'bare', value: token.text };
    }
    if (token.kind === 'rparen') {
      throw new ParseFailure('Unexpected ")"', token.start);
    }
    if (token.kind === 'op') {
      throw new ParseFailure(`Unexpected "${token.text}"`, token.start);
    }
    throw new ParseFailure('Expected expression', token.start);
  };

  const root = parseOr();
  if (peek().kind !== 'eof') {
    const token = peek();
    throw new ParseFailure(`Unexpected "${token.text || ')'}"`, token.start);
  }
  return root;
};

export const parseQuery = (input: string): ParseResult => {
  if (!input.trim()) {
    return { ok: true, ast: null };
  }
  const tokenized = tokenize(input);
  if (!tokenized.ok) {
    return tokenized;
  }
  try {
    return { ok: true, ast: parseTokens(tokenized.tokens) };
  } catch (error) {
    if (error instanceof ParseFailure) {
      return { ok: false, error: { message: error.message, position: error.position } };
    }
    return { ok: false, error: { message: 'Invalid query', position: 0 } };
  }
};

// ---------- Evaluator ----------

const addDays = (iso: string, days: number): string => {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d + days);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
};

const freqFromRule = (rule: string): string => {
  const match = /(?:^|[;\n])FREQ=([A-Za-z]+)/i.exec(rule);
  return match ? match[1].toLowerCase() : '';
};

const matchString = (actual: string | null, op: Op, value: string): boolean => {
  if (op === '!=') return actual !== value;
  if (actual === null) return false;
  if (op === '~') return actual.includes(value);
  return actual === value; // ':'
};

const evalTerm = (node: Extract<QueryNode, { kind: 'term' }>, task: Task, ctx: EvalContext): boolean => {
  const value = node.value.toLowerCase();
  const special = !node.quoted ? value : '';
  switch (node.field) {
    case 'text':
      return matchString(task.text.toLowerCase(), node.op, value);
    case 'details':
      return matchString((task.details ?? '').toLowerCase(), node.op, value);
    case 'list': {
      const name = task.listId != null ? ctx.listNameById.get(task.listId) ?? null : null;
      if (special === 'none') {
        return node.op === '!=' ? name !== null : name === null;
      }
      return matchString(name, node.op, value);
    }
    case 'tag': {
      const names = (task.tagIds ?? [])
        .map((id) => ctx.tagNameById.get(id))
        .filter((n): n is string => Boolean(n));
      if (special === 'none') {
        return node.op === '!=' ? names.length > 0 : names.length === 0;
      }
      if (special === 'any') {
        return node.op === '!=' ? names.length === 0 : names.length > 0;
      }
      if (node.op === '!=') return !names.some((n) => n === value);
      if (node.op === '~') return names.some((n) => n.includes(value));
      return names.some((n) => n === value);
    }
    case 'priority': {
      const priority = task.priority ?? 'none';
      return node.op === '!=' ? priority !== value : priority === value;
    }
    case 'done': {
      const wanted = value === 'true';
      return node.op === '!=' ? task.done !== wanted : task.done === wanted;
    }
    case 'due': {
      const due = task.reminderDate ?? null;
      if (special === 'none') {
        return node.op === '!=' ? due !== null : due === null;
      }
      if (special === 'any') {
        return node.op === '!=' ? due === null : due !== null;
      }
      let target = value;
      if (value === 'today') target = ctx.todayISO;
      else if (value === 'tomorrow') target = addDays(ctx.todayISO, 1);
      else if (value === 'yesterday') target = addDays(ctx.todayISO, -1);
      if (node.op === ':') return due === target;
      if (node.op === '!=') return due !== target;
      if (due === null) return false;
      if (node.op === '<') return due < target;
      if (node.op === '<=') return due <= target;
      if (node.op === '>') return due > target;
      return due >= target; // '>='
    }
    case 'repeat': {
      const rule = task.repeatRule ?? null;
      const kind = rule ? freqFromRule(rule) : 'none';
      if (value === 'none') {
        return node.op === '!=' ? kind !== 'none' : kind === 'none';
      }
      if (value === 'any') {
        return node.op === '!=' ? kind === 'none' : kind !== 'none';
      }
      return node.op === '!=' ? kind !== value : kind === value;
    }
    default:
      return false;
  }
};

const evalBare = (value: string, task: Task): boolean => {
  const needle = value.toLowerCase();
  if (!needle) return true;
  return (
    task.text.toLowerCase().includes(needle) ||
    (task.details ?? '').toLowerCase().includes(needle)
  );
};

const evalNode = (node: QueryNode, task: Task, ctx: EvalContext): boolean => {
  switch (node.kind) {
    case 'and':
      return evalNode(node.left, task, ctx) && evalNode(node.right, task, ctx);
    case 'or':
      return evalNode(node.left, task, ctx) || evalNode(node.right, task, ctx);
    case 'not':
      return !evalNode(node.child, task, ctx);
    case 'term':
      return evalTerm(node, task, ctx);
    case 'bare':
      return evalBare(node.value, task);
  }
};

export const queryUsesField = (ast: QueryNode | null, field: string): boolean => {
  if (!ast) return false;
  switch (ast.kind) {
    case 'and':
    case 'or':
      return queryUsesField(ast.left, field) || queryUsesField(ast.right, field);
    case 'not':
      return queryUsesField(ast.child, field);
    case 'term':
      return ast.field === field;
    case 'bare':
      return false;
  }
};

export const compilePredicate = (ast: QueryNode | null): CompiledPredicate => {
  if (ast === null) {
    return () => true;
  }
  return (task, ctx) => evalNode(ast, task, ctx);
};
