// Manual self-test for the keyboard-shortcut key grammar and the default keymap.
// Run after `npm run build`:  node scripts/shortcuts-selftest.mjs
//
// Both modules under test are deliberately dom-free — bindingFromEvent takes a plain
// {key, metaKey, ctrlKey, altKey, shiftKey} shape and isMac is always a parameter — which is
// what lets this run in Node with no Electron and no DOM.
import {
  bindingFromEvent,
  findConflicts,
  formatBinding,
  hasStrongModifier,
  normalizeBinding,
  resolveKeymap,
  toElectronAccelerator,
} from '../dist/renderer/shortcutKeys.js';
import {
  SHORTCUTS,
  SHORTCUT_IDS,
  defaultKeymap,
  scopeOf,
} from '../dist/renderer/shortcutRegistry.js';

let failures = 0;
let checks = 0;

const check = (label, actual, expected) => {
  checks += 1;
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  if (!same) {
    failures += 1;
    console.error(`FAIL  ${label} — got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  }
};

const ok = (label, condition) => {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.error(`FAIL  ${label}`);
  }
};

const ev = (key, mods = {}) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

// ---------- normalizeBinding ----------

for (const [raw, want] of [
  ['Mod+F', 'Mod+F'],
  ['mod+f', 'Mod+F'],
  ['Shift+Mod+F', 'Mod+Shift+F'], // modifiers always re-order into MOD_ORDER
  ['CmdOrCtrl+F', 'Mod+F'],
  ['Alt+ArrowUp', 'Alt+ArrowUp'],
  ['alt+arrowup', 'Alt+ArrowUp'],
  ['Mod+,', 'Mod+,'],
  ['Mod+/', 'Mod+/'],
  ['?', '?'],
  ['Space', 'Space'],
  ['Mod++', 'Mod++'], // trailing + is the key, not a stray separator
  ['Escape', 'Escape'],
  ['Ctrl+F', 'Ctrl+F'], // literal Ctrl stays distinct from Mod
  ['', null],
  ['Bogus+F', null],
  ['Shift+?', null], // Shift is baked into a printable non-letter; "Shift+?" can never match
  ['Mod+F1', 'Mod+F1'],
]) {
  check(`normalizeBinding(${JSON.stringify(raw)})`, normalizeBinding(raw), want);
}

// ---------- bindingFromEvent ----------

for (const [label, event, isMac, want] of [
  ['Cmd+F on mac', ev('f', { metaKey: true }), true, 'Mod+F'],
  ['Ctrl+F on windows', ev('f', { ctrlKey: true }), false, 'Mod+F'],
  ['Ctrl+F on mac is not Mod', ev('f', { ctrlKey: true }), true, 'Ctrl+F'],
  ['Win+F on windows is not Mod', ev('f', { metaKey: true }), false, 'Meta+F'],
  ['Cmd+Shift+F', ev('F', { metaKey: true, shiftKey: true }), true, 'Mod+Shift+F'],
  ['Shift+/ arrives as ?', ev('?', { shiftKey: true }), false, '?'],
  ['Shift+ArrowDown keeps Shift', ev('ArrowDown', { shiftKey: true }), false, 'Shift+ArrowDown'],
  ['space is Space', ev(' '), false, 'Space'],
  ['bare Shift is not a binding', ev('Shift', { shiftKey: true }), false, null],
  ['bare Meta is not a binding', ev('Meta', { metaKey: true }), true, null],
  ['Alt+ArrowUp', ev('ArrowUp', { altKey: true }), true, 'Alt+ArrowUp'],
  ['lowercase letter uppercases', ev('a'), false, 'A'],
  ['Shift+a keeps both', ev('A', { shiftKey: true }), false, 'Shift+A'],
]) {
  check(`bindingFromEvent: ${label}`, bindingFromEvent(event, isMac), want);
}

// Every default has to survive a round trip through the event path, or a key the user
// actually presses would never equal the binding we shipped.
check('round trip Cmd+, on mac', bindingFromEvent(ev(',', { metaKey: true }), true), 'Mod+,');
check('round trip Cmd+/ on mac', bindingFromEvent(ev('/', { metaKey: true }), true), 'Mod+/');
check('round trip Cmd+1 on mac', bindingFromEvent(ev('1', { metaKey: true }), true), 'Mod+1');

// ---------- hasStrongModifier ----------
// This is the rule that keeps "?" inert while typing and lets Mod+F fire from a text field.

check('? is not strongly modified', hasStrongModifier('?'), false);
check('Shift+A is not strongly modified', hasStrongModifier('Shift+A'), false);
check('Mod+F is strongly modified', hasStrongModifier('Mod+F'), true);
check('Alt+ArrowUp is strongly modified', hasStrongModifier('Alt+ArrowUp'), true);
check('Space is not strongly modified', hasStrongModifier('Space'), false);

// ---------- toElectronAccelerator ----------

for (const [binding, want] of [
  ['Mod+F', 'CmdOrCtrl+F'],
  ['Mod+Shift+H', 'CmdOrCtrl+Shift+H'],
  ['Mod+,', 'CmdOrCtrl+,'],
  ['Alt+ArrowUp', 'Alt+Up'], // Electron spells arrows without the prefix
  ['Space', 'Space'],
  ['Escape', 'Esc'],
  ['Mod+F1', 'CmdOrCtrl+F1'],
]) {
  check(`toElectronAccelerator(${JSON.stringify(binding)})`, toElectronAccelerator(binding), want);
}
check('toElectronAccelerator rejects junk', toElectronAccelerator('Bogus+X'), null);

// ---------- formatBinding ----------

check('mac keycaps', formatBinding('Mod+Shift+F', true), ['⌘', '⇧', 'F']);
check('windows keycaps', formatBinding('Mod+Shift+F', false), ['Ctrl', 'Shift', 'F']);
check('mac arrow symbol', formatBinding('Alt+ArrowUp', true), ['⌥', '↑']);
check('windows arrow name', formatBinding('Alt+ArrowUp', false), ['Alt', 'ArrowUp']);

// ---------- registry integrity ----------

const ids = SHORTCUTS.map((def) => def.id);
check('every shortcut id is unique', ids.length, new Set(ids).size);
ok('SHORTCUT_IDS matches SHORTCUTS', ids.every((id) => SHORTCUT_IDS.has(id)));

for (const isMac of [true, false]) {
  const platform = isMac ? 'mac' : 'other';

  for (const def of SHORTCUTS) {
    for (const binding of def.defaults[platform]) {
      check(`${def.id} default ${JSON.stringify(binding)} (${platform}) is canonical`,
        normalizeBinding(binding), binding);
    }
  }

  // Fixed entries are documentation, never dispatched, so they are allowed to name a key that
  // a real shortcut also uses in another scope (Enter is both "add the typed task" and "open
  // the focused task"). Everything else must be unambiguous within its own scope.
  const dispatchable = {};
  for (const def of SHORTCUTS) {
    if (def.fixed) continue;
    dispatchable[def.id] = def.defaults[platform];
  }
  const conflicts = findConflicts(dispatchable, scopeOf);
  check(
    `no default collisions within a scope (${platform})`,
    conflicts.map((c) => `${c.binding}: ${c.ids.join(', ')}`),
    []
  );
}

// ---------- resolveKeymap ----------

const defaults = defaultKeymap(true);

check(
  'no overrides keeps every default',
  resolveKeymap(defaults, {}, SHORTCUT_IDS).keymap['app.newTask'],
  ['Mod+N']
);
check(
  'an override replaces the default',
  resolveKeymap(defaults, { 'app.newTask': ['Mod+Shift+P'] }, SHORTCUT_IDS).keymap['app.newTask'],
  ['Mod+Shift+P']
);
check(
  'an empty array is an explicit unbind',
  resolveKeymap(defaults, { 'app.newTask': [] }, SHORTCUT_IDS).keymap['app.newTask'],
  []
);
check(
  'an absent id is untouched by another id override',
  resolveKeymap(defaults, { 'app.newTask': [] }, SHORTCUT_IDS).keymap['app.newList'],
  ['Mod+Shift+N']
);
check(
  'an unknown id is reported, not kept',
  resolveKeymap(defaults, { 'app.fromTheFuture': ['Mod+Y'] }, SHORTCUT_IDS).dropped,
  ['app.fromTheFuture']
);
ok(
  'an unknown id does not appear in the keymap',
  !('app.fromTheFuture' in
    resolveKeymap(defaults, { 'app.fromTheFuture': ['Mod+Y'] }, SHORTCUT_IDS).keymap)
);
check(
  'unparseable bindings are dropped from an override',
  resolveKeymap(defaults, { 'app.newTask': ['Bogus+Q', 'Mod+Y'] }, SHORTCUT_IDS).keymap[
    'app.newTask'
  ],
  ['Mod+Y']
);
check(
  'overrides are normalized on the way in',
  resolveKeymap(defaults, { 'app.newTask': ['shift+mod+p'] }, SHORTCUT_IDS).keymap['app.newTask'],
  ['Mod+Shift+P']
);
check(
  'a non-array override is reported',
  resolveKeymap(defaults, { 'app.newTask': 'Mod+Y' }, SHORTCUT_IDS).dropped,
  ['app.newTask']
);
check(
  'garbage overrides fall back to defaults',
  resolveKeymap(defaults, null, SHORTCUT_IDS).keymap['app.newTask'],
  ['Mod+N']
);

if (failures) {
  console.error(`\n${failures}/${checks} shortcut cases failed`);
  process.exit(1);
}
console.log(`All ${checks} shortcut cases passed`);
