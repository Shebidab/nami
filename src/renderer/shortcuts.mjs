// One offline reference, shared by Settings and Quick Start.
//
// Nothing here is typed as a glyph. Every cap is a token that keys.mjs spells
// for the machine reading it — ⌘ on a Mac, Ctrl on a PC — because a shortcut
// sheet is the one surface where naming a key that does not exist is more than
// a cosmetic problem: this is the page somebody opened specifically to find out
// which key to press.
import { caps, MOD, FILE_MANAGER } from './keys.mjs';

export const OPEN_OUTPUT_COPY = `Hold ${MOD} and click a link or file path in a session. `
  + 'Web links open in your browser. Files open here in Nami.';

export const SHORTCUT_GROUPS = [
  {
    icon: 'link', title: 'Links & files',
    rows: [
      ['Open a web link', caps('mod', 'click'), 'In session output · opens your browser'],
      ['Open a file in Nami', caps('mod', 'click'), 'In session output · opens the file here'],
      [`Reveal a file in ${FILE_MANAGER}`, caps('alt', 'mod', 'click')],
      [`Reveal a folder in ${FILE_MANAGER}`, caps('mod', 'click')],
      ['Open link actions', ['Right-click'], 'Open, copy, or reveal — depending on the link'],
    ],
    note: 'Reading a document? Links in Read mode open with a normal click.',
  },
  {
    icon: 'keyboard', title: 'Everyday shortcuts',
    rows: [
      ['New session', caps('mod', 'N')],
      ['Open the agent picker', caps('mod', 'K')],
      ['Open a folder', caps('mod', 'O')],
      ['New window', caps('shift', 'mod', 'N')],
      ['Open Settings', caps('mod', ',')],
      ['Save the active file', caps('mod', 'S')],
      ['Close the active pane', caps('mod', 'W')],
      ['Dismiss a dialog or leave an expanded pane', ['Esc']],
    ],
  },
  {
    icon: 'desk', title: 'Arrange your desk',
    rows: [
      ['Reorder a pane', ['Drag header']],
      ['Resize a pane', ['Drag handle']],
      ['Reset a pane’s size', ['Double-click handle']],
      ['Rename a session', ['Double-click title']],
    ],
  },
  {
    icon: 'file', title: 'In the workspace',
    rows: [
      ['Rename a selected file or folder', ['Return'], 'When the workspace list has focus'],
      ['Move a selected item to Trash', caps('mod', 'del'), 'When the workspace list has focus'],
      ['Add selected file content to a session', caps('shift', 'mod', 'enter'), 'From the file’s selection toolbar'],
    ],
  },
];
