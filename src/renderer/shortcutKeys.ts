/**
 * Bindings as strings, and the rules for turning a keypress into one.
 *
 * A binding is a canonical string like "Mod+Shift+F", "ArrowDown" or "?". Canonical means
 * two things: modifiers always appear in MOD_ORDER, and a key is always spelled the one way,
 * so a binding lookup is plain string equality against a Map and nothing has to normalize at
 * dispatch time.
 *
 * The rules, which are the whole correctness surface of this file:
 *
 * - `Mod` is ⌘ on macOS and Ctrl everywhere else. The *other* modifier is emitted literally
 *   (`Ctrl` on macOS, `Meta` elsewhere), so `Mod` can never silently collide with a real Ctrl.
 * - Named keys pass through verbatim: ArrowUp, Enter, Escape, Home, End, Backspace, Delete,
 *   F1–F12. A space is `Space`, since " " is unreadable in a keymap file.
 * - Printable characters use `event.key` *as typed*, with Shift dropped — `Shift+/` on a US
 *   layout produces "?" and so the binding is "?", which then round-trips on every layout
 *   that can produce a ? at all, however it gets there. ASCII letters are the exception: they
 *   uppercase and keep Shift, because for a letter the case is the only signal there is, and
 *   "A" and "Shift+A" have to stay distinguishable.
 * - `event.key`, never `event.code`. People bind what is printed on the key they pressed.
 *
 * Dom-free on purpose: KeyLike is a plain shape rather than KeyboardEvent, and isMac is always
 * a parameter, so scripts/query-selftest.mjs can drive all of this from Node.
 */

export type Binding = string;

export type KeyLike = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

/** Modifiers serialize in this order, always. String equality depends on it. */
export const MOD_ORDER = ['Mod', 'Ctrl', 'Meta', 'Alt', 'Shift'] as const;

const NAMED_KEYS = [
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Enter',
  'Escape',
  'Tab',
  'Backspace',
  'Delete',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Space',
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12',
];

const NAMED_BY_LOWER = new Map(NAMED_KEYS.map((name) => [name.toLowerCase(), name]));

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'AltGraph']);

const isAsciiLetter = (value: string) => value.length === 1 && /^[a-zA-Z]$/.test(value);

/** Canonical spelling of a single key, or null if it isn't one we can represent. */
const canonicalKey = (raw: string): string | null => {
  if (!raw) return null;
  if (raw === ' ') return 'Space';
  const named = NAMED_BY_LOWER.get(raw.toLowerCase());
  if (named) return named;
  if (isAsciiLetter(raw)) return raw.toUpperCase();
  // any other single printable character stands for itself: "?", "/", ",", "1"
  if (Array.from(raw).length === 1) return raw;
  return null;
};

const joinBinding = (mods: Set<string>, key: string): Binding =>
  [...MOD_ORDER.filter((mod) => mods.has(mod)), key].join('+');

/**
 * Parse a binding written by hand or read back from settings.json, returning it in canonical
 * form. Returns null for anything unrepresentable, which is how untrusted input is rejected.
 */
export const normalizeBinding = (raw: string): Binding | null => {
  if (typeof raw !== 'string' || raw.length === 0) return null;

  // "+" is both the separator and a bindable key, so a trailing one is the key itself
  // ("Mod++" is Mod plus the + key) and everything before it is modifiers.
  const plusIsKey = raw.endsWith('+');
  const body = plusIsKey ? raw.slice(0, -1) : raw;
  const parts = body.split('+').filter((part) => part.length > 0);
  const keyPart = plusIsKey ? '+' : parts.pop();
  if (!keyPart) return null;
  const mods = new Set<string>();
  for (const part of parts) {
    switch (part.toLowerCase()) {
      case 'mod':
      case 'cmdorctrl':
      case 'commandorcontrol':
        mods.add('Mod');
        break;
      case 'ctrl':
      case 'control':
        mods.add('Ctrl');
        break;
      case 'meta':
      case 'cmd':
      case 'command':
      case 'super':
        mods.add('Meta');
        break;
      case 'alt':
      case 'option':
        mods.add('Alt');
        break;
      case 'shift':
        mods.add('Shift');
        break;
      default:
        return null;
    }
  }

  const key = canonicalKey(keyPart);
  if (!key) return null;
  // Shift on a printable non-letter is never canonical — see the Shift rule up top.
  if (mods.has('Shift') && key.length === 1 && !isAsciiLetter(key)) return null;
  return joinBinding(mods, key);
};

/**
 * The binding a keypress stands for, or null when there isn't one — a bare modifier keydown,
 * or a key we can't spell.
 */
export const bindingFromEvent = (event: KeyLike, isMac: boolean): Binding | null => {
  if (MODIFIER_KEYS.has(event.key)) return null;
  const key = canonicalKey(event.key);
  if (!key) return null;

  const mods = new Set<string>();
  if (isMac) {
    if (event.metaKey) mods.add('Mod');
    if (event.ctrlKey) mods.add('Ctrl');
  } else {
    if (event.ctrlKey) mods.add('Mod');
    if (event.metaKey) mods.add('Meta');
  }
  if (event.altKey) mods.add('Alt');
  // Shift is already baked into a printable non-letter (Shift+/ arrives as "?"), so recording
  // it again would produce "Shift+?" — a binding nothing can ever match.
  if (event.shiftKey && (key.length > 1 || isAsciiLetter(key))) mods.add('Shift');

  return joinBinding(mods, key);
};

/** True when a binding carries a modifier strong enough to be safe while the user is typing. */
export const hasStrongModifier = (binding: Binding): boolean => {
  const parts = binding.split('+');
  return parts.some((part) => part === 'Mod' || part === 'Ctrl' || part === 'Meta' || part === 'Alt');
};

const MAC_SYMBOLS: Record<string, string> = {
  Mod: '⌘',
  Ctrl: '⌃',
  Meta: '⌘',
  Alt: '⌥',
  Shift: '⇧',
};

const OTHER_LABELS: Record<string, string> = {
  Mod: 'Ctrl',
  Ctrl: 'Ctrl',
  Meta: 'Win',
  Alt: 'Alt',
  Shift: 'Shift',
};

const KEY_SYMBOLS: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Enter: '↵',
  Backspace: '⌫',
  Delete: '⌦',
};

/** One display token per keycap, so a caller can wrap each in its own <kbd>. */
export const formatBinding = (binding: Binding, isMac: boolean): string[] => {
  const parts = binding.split('+');
  const key = parts.pop() ?? '';
  const symbols = isMac ? MAC_SYMBOLS : OTHER_LABELS;
  const tokens = MOD_ORDER.filter((mod) => parts.includes(mod)).map((mod) => symbols[mod]);
  tokens.push((isMac && KEY_SYMBOLS[key]) || key);
  return tokens;
};

/**
 * An Electron menu accelerator, or null when the binding can't be one. Kept conservative:
 * Menu.buildFromTemplate *throws* on a malformed accelerator, which would take the whole menu
 * down at launch, so anything doubtful is refused here rather than risked there.
 */
export const toElectronAccelerator = (binding: Binding): string | null => {
  const normalized = normalizeBinding(binding);
  if (!normalized) return null;
  const parts = normalized.split('+');
  const key = parts.pop()!;
  const mods = parts.map((part) => {
    switch (part) {
      case 'Mod':
        return 'CmdOrCtrl';
      case 'Ctrl':
        return 'Control';
      case 'Meta':
        return 'Super';
      default:
        return part;
    }
  });
  // Electron's own spellings for the handful of keys where it differs from KeyboardEvent.key.
  const acceleratorKey = key === 'Space' ? 'Space' : key === 'Escape' ? 'Esc' : key;
  if (!/^([A-Z0-9]|F[1-9][0-2]?|[^A-Za-z0-9\s]|Space|Esc|Tab|Enter|Backspace|Delete|Home|End|PageUp|PageDown|Up|Down|Left|Right|Arrow(Up|Down|Left|Right))$/.test(
    acceleratorKey
  )) {
    return null;
  }
  return [...mods, acceleratorKey.replace(/^Arrow/, '')].join('+');
};

/**
 * Defaults with the user's overrides laid over the top, per shortcut id.
 *
 * Overrides are stored rather than a full keymap snapshot: an absent id keeps its default, so
 * a default improved in a later version still reaches anyone who never rebound that one. An
 * empty array is an explicit unbind, which is why it is distinct from absent. Ids we no longer
 * recognise are reported in `dropped` rather than dropped silently.
 */
export const resolveKeymap = (
  defaults: Record<string, Binding[]>,
  overrides: Record<string, string[]> | null | undefined,
  knownIds: Set<string>
): { keymap: Record<string, Binding[]>; dropped: string[] } => {
  const keymap: Record<string, Binding[]> = { ...defaults };
  const dropped: string[] = [];
  if (!overrides || typeof overrides !== 'object') return { keymap, dropped };

  for (const [id, raw] of Object.entries(overrides)) {
    if (!knownIds.has(id)) {
      dropped.push(id);
      continue;
    }
    if (!Array.isArray(raw)) {
      dropped.push(id);
      continue;
    }
    const bindings: Binding[] = [];
    for (const entry of raw) {
      const normalized = typeof entry === 'string' ? normalizeBinding(entry) : null;
      if (normalized && !bindings.includes(normalized)) bindings.push(normalized);
    }
    keymap[id] = bindings;
  }
  return { keymap, dropped };
};

/**
 * Bindings claimed by more than one shortcut *in the same scope*. Scope matters: Space on a
 * focused task row and a hypothetical Space inside a modal never both fire, so they are not
 * in conflict and reporting them as such would be noise.
 */
export const findConflicts = (
  keymap: Record<string, Binding[]>,
  scopeOf: (id: string) => string
): Array<{ binding: Binding; ids: string[] }> => {
  const seen = new Map<string, { binding: Binding; ids: string[] }>();
  for (const [id, bindings] of Object.entries(keymap)) {
    for (const binding of bindings) {
      const scopedKey = scopeOf(id) + ' ' + binding;
      const entry = seen.get(scopedKey) ?? { binding, ids: [] };
      entry.ids.push(id);
      seen.set(scopedKey, entry);
    }
  }
  return [...seen.values()].filter((entry) => entry.ids.length > 1);
};

/**
 * userAgentData isn't in every Electron version's lib.dom, so fall back to the deprecated but
 * reliable platform string. Case-insensitive: userAgentData.platform reports "macOS" while
 * navigator.platform reports "MacIntel".
 */
export const detectIsMac = (): boolean =>
  /mac|iphone|ipad/i.test(
    (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData?.platform ??
      navigator.platform
  );
