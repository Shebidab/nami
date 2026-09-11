// How a shortcut is written down, in the idiom of the machine reading it.
//
// Nami's chrome is full of key hints — ⌘K on the agents button, ⌘⌫ in the
// workspace menu, ⇧⌘↵ on the selection toolbar, five of them along the footer.
// Every one of those was a Mac glyph typed into a string, and on Windows that
// is not a translation problem but a factual one: there is no ⌘ on that
// keyboard, and the key Nami actually binds there is Ctrl. A hint naming a key
// the machine does not have is worse than no hint, because the reader tries it.
//
// Order and punctuation are part of the idiom too, and they differ. macOS runs
// the modifiers together in a fixed sequence and says nothing about it — ⇧⌘N.
// Windows names each one and joins them with a plus, Ctrl first — Ctrl+Shift+N.
// So this takes tokens rather than text: a caller says which keys it means, and
// this decides how they are spelled and in what order.
//
// Platform is a parameter, for the same reason it is one in src/main/platform.js:
// it is the only way a test can ask what the other machine would read. The
// module-level exports below are that function applied once to the machine we
// are actually on — the platform cannot change while the app runs, and a hint
// that recomputed itself per render would be the same answer at a cost.

// The canonical order each platform writes its modifiers in. Apple's is ⌃⌥⇧⌘
// (Human Interface Guidelines); Windows leads with Ctrl.
const ORDER_MAC = ['ctrl', 'alt', 'shift', 'mod'];
const ORDER_WIN = ['mod', 'ctrl', 'alt', 'shift'];

const NAMES_MAC = { mod: '⌘', ctrl: '⌃', alt: '⌥', shift: '⇧', del: '⌫', enter: '↵', esc: 'Esc' };
const NAMES_WIN = { mod: 'Ctrl', ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', del: 'Del', enter: 'Enter', esc: 'Esc' };

export function keysFor(platform) {
  const mac = platform === 'darwin';
  const order = mac ? ORDER_MAC : ORDER_WIN;
  const names = mac ? NAMES_MAC : NAMES_WIN;
  const glue = mac ? '' : '+';

  const split = (tokens) => [
    order.filter((m) => tokens.includes(m)).map((m) => names[m]),
    tokens.filter((t) => !order.includes(t)).map((k) => names[k] || k),
  ];

  // kbd('shift', 'mod', 'N') → ⇧⌘N · Ctrl+Shift+N
  //
  // Modifiers are sorted into the platform's own order, so a caller may list
  // them in whichever order reads best in the source and still get the right
  // answer on both. Anything that is not a known modifier is the key itself and
  // goes last, in the order it was given.
  const kbd = (...tokens) => { const [m, k] = split(tokens); return [...m, ...k].join(glue); };
  // The same, as the separate caps the shortcuts sheet renders as chips.
  const caps = (...tokens) => { const [m, k] = split(tokens); return [...m, ...k]; };

  return {
    mac,
    kbd,
    caps,
    MOD: names.mod,
    ALT: names.alt,
    SHIFT: names.shift,
    DEL: names.del,
    ENTER: names.enter,

    // The chords Nami actually binds, named once so a hint and the keydown that
    // serves it cannot drift apart — and so the call sites read as what they
    // mean rather than as punctuation.
    K: {
      settings: kbd('mod', ','),
      agents: kbd('mod', 'K'),
      newSession: kbd('mod', 'N'),
      newWindow: kbd('shift', 'mod', 'N'),
      openFolder: kbd('mod', 'O'),
      closePane: kbd('mod', 'W'),
      save: kbd('mod', 'S'),
      trash: kbd('mod', 'del'),
      addToSession: kbd('shift', 'mod', 'enter'),
    },

    // What the thing that opens a folder in the OS is called. "Reveal in
    // Finder" is a Mac phrase twice over — the verb as much as the app — and
    // Windows has its own for the same gesture, which is what Explorer's own
    // menus say.
    FILE_MANAGER: mac ? 'Finder' : 'Explorer',
    REVEAL_IN: mac ? 'Reveal in Finder' : 'Show in Explorer',
    // Mid-sentence, where the verb is not the first word: "…and click to reveal
    // in Finder". Lowercasing REVEAL_IN would give "show in explorer", and
    // Explorer is a name.
    REVEAL_LOWER: mac ? 'reveal in Finder' : 'show in Explorer',

    // Prose rather than a key chip. "⌘ Click to open a file" is how a Mac
    // reads; "Ctrl-click" is how Windows writes the same gesture, and is what
    // its own documentation says.
    MOD_CLICK: mac ? '⌘ Click' : 'Ctrl-click',
    ALT_MOD_CLICK: mac ? '⌥⌘ Click' : 'Ctrl+Alt-click',

    // "…on this Mac only, nothing syncs" is a promise Nami makes about where
    // things are kept, and it has to be true on the machine reading it.
    THIS_MACHINE: mac ? 'this Mac' : 'this PC',
    YOUR_MACHINE: mac ? 'your Mac' : 'your PC',

    // The Settings row that opens the shortcuts sheet. On a Mac the ⌘ in front
    // of it reads as an ornament; "Ctrl Shortcuts & gestures" would read as a
    // broken sentence, so Windows gets the words on their own.
    SHORTCUTS_LABEL: mac ? '⌘ Shortcuts & gestures' : 'Shortcuts & gestures',

    // The legend under the shortcuts sheet, naming the glyphs above it. There
    // are no glyphs to name on Windows — the caps already say Ctrl, Alt and
    // Shift — so it names the third modifier the sheet never mentions instead.
    MODIFIER_LEGEND: mac
      ? '⌘ Command · ⌥ Option · ⇧ Shift'
      : 'Ctrl · Alt · Shift',
  };
}

// The machine this copy is running on. `api` comes from the preload bridge and
// is there before any renderer module evaluates; outside the app — a node test
// importing one of these modules — there is none, and the Windows spelling is
// the safer default to fall back to, because it is words rather than glyphs.
const HERE = keysFor((globalThis.api && globalThis.api.platform) || '');

export const MAC = HERE.mac;
export const kbd = HERE.kbd;
export const caps = HERE.caps;
export const MOD = HERE.MOD;
export const ALT = HERE.ALT;
export const SHIFT = HERE.SHIFT;
export const DEL = HERE.DEL;
export const ENTER = HERE.ENTER;
export const K = HERE.K;
export const FILE_MANAGER = HERE.FILE_MANAGER;
export const REVEAL_IN = HERE.REVEAL_IN;
export const REVEAL_LOWER = HERE.REVEAL_LOWER;
export const MOD_CLICK = HERE.MOD_CLICK;
export const ALT_MOD_CLICK = HERE.ALT_MOD_CLICK;
export const THIS_MACHINE = HERE.THIS_MACHINE;
export const YOUR_MACHINE = HERE.YOUR_MACHINE;
export const SHORTCUTS_LABEL = HERE.SHORTCUTS_LABEL;
export const MODIFIER_LEGEND = HERE.MODIFIER_LEGEND;

// Where the OS keeps a secret for us, named the way each platform names it. The
// Keychain is a Mac thing twice over: the word, and the "allow access" dialog
// that goes with it. Windows has a credential store and asks nothing, so the
// prompt that would have explained the dialog explains the absence instead.
export const SECRET_STORE_HINT = MAC
  ? 'Unlock macOS Keychain to import saved passwords.'
  : 'Windows could not unlock the credential store — saved passwords are unavailable.';
export const SECRET_STORE_ASK = MAC
  ? 'Allow Keychain access if macOS asks.'
  : 'Nothing to allow — Windows unlocks this with your sign-in.';
