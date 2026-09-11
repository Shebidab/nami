// Every key hint in the app, in both idioms.
//
// These read as trivia until you remember what a shortcut hint is for: it is
// the app telling somebody which physical key to press. On Windows the ⌘ that
// was written into forty-odd strings names a key that is not on the keyboard,
// and the one Nami actually binds is Ctrl — so the hint was not merely styled
// wrongly, it was false.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keysFor } from '../src/renderer/keys.mjs';
import { SHORTCUT_GROUPS, OPEN_OUTPUT_COPY } from '../src/renderer/shortcuts.mjs';

const mac = keysFor('darwin');
const win = keysFor('win32');

test('a Mac runs its modifiers together, in Apple’s own order', () => {
  assert.equal(mac.kbd('mod', 'N'), '⌘N');
  // listed shift-first in the source, written ⇧⌘ either way
  assert.equal(mac.kbd('shift', 'mod', 'N'), '⇧⌘N');
  assert.equal(mac.kbd('mod', 'shift', 'N'), '⇧⌘N');
  assert.equal(mac.kbd('alt', 'mod', 'click'), '⌥⌘click');
});

test('Windows names them, joins with a plus, and leads with Ctrl', () => {
  assert.equal(win.kbd('mod', 'N'), 'Ctrl+N');
  assert.equal(win.kbd('shift', 'mod', 'N'), 'Ctrl+Shift+N');
  assert.equal(win.kbd('mod', 'shift', 'N'), 'Ctrl+Shift+N');
  assert.equal(win.kbd('alt', 'mod', 'click'), 'Ctrl+Alt+click');
});

test('the keys Nami binds are spelled for the keyboard in front of you', () => {
  assert.equal(mac.K.trash, '⌘⌫');
  assert.equal(win.K.trash, 'Ctrl+Del');
  assert.equal(mac.K.addToSession, '⇧⌘↵');
  assert.equal(win.K.addToSession, 'Ctrl+Shift+Enter');
});

// The whole point, stated once: nothing a Windows user reads may name a key
// their keyboard does not have.
test('no Mac glyph survives into the Windows spelling', () => {
  const glyphs = /[⌘⌥⇧⌫↵⌃]/;
  const strings = [
    ...Object.values(win.K),
    win.MOD, win.ALT, win.SHIFT, win.DEL, win.ENTER,
    win.MOD_CLICK, win.ALT_MOD_CLICK,
    win.FILE_MANAGER, win.REVEAL_IN, win.REVEAL_LOWER,
    win.THIS_MACHINE, win.YOUR_MACHINE,
    win.SHORTCUTS_LABEL, win.MODIFIER_LEGEND,
  ];
  for (const s of strings) assert.doesNotMatch(s, glyphs, s);
});

test('and nothing on a Mac loses one', () => {
  assert.match(mac.MODIFIER_LEGEND, /⌘/);
  assert.match(mac.SHORTCUTS_LABEL, /^⌘ /);
  assert.equal(mac.REVEAL_IN, 'Reveal in Finder');
});

// Finder is an application on one platform and does not exist on the other.
// "Reveal in Finder" is a Mac phrase in both halves, verb included.
test('the file manager is called what it is called', () => {
  assert.equal(win.FILE_MANAGER, 'Explorer');
  assert.equal(win.REVEAL_IN, 'Show in Explorer');
  // mid-sentence, and Explorer keeps its capital because it is a name
  assert.equal(win.REVEAL_LOWER, 'show in Explorer');
  assert.equal(mac.REVEAL_LOWER, 'reveal in Finder');
});

// ---- the sheet somebody opens to find out which key to press ---------------

test('the shortcuts reference carries no glyph the reader has no key for', () => {
  const here = keysFor((globalThis.api && globalThis.api.platform) || '');
  const all = SHORTCUT_GROUPS.flatMap((g) => g.rows.flatMap((r) => [r[0], ...(r[1] || []), r[2] || '']));
  for (const cell of all.filter(Boolean)) {
    if (here.mac) continue;
    assert.doesNotMatch(String(cell), /[⌘⌥⇧⌫↵⌃]/, cell);
  }
  assert.doesNotMatch(OPEN_OUTPUT_COPY, here.mac ? /Ctrl/ : /[⌘⌥⇧]/);
});

test('every row still names a key, whichever platform built it', () => {
  for (const group of SHORTCUT_GROUPS) {
    for (const [label, keys] of group.rows) {
      assert.ok(label, 'a row with no label');
      assert.ok(Array.isArray(keys) && keys.length, `${label} lost its keys`);
      assert.ok(keys.every((k) => typeof k === 'string' && k), `${label} has an empty cap`);
    }
  }
});
