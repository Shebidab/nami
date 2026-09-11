// Where a file opened from Finder or Explorer lands.
//
// The OS hands the app a path and nothing else. Nami is folder-shaped — a tile
// always sits on some folder's desk — so every incoming path has to be turned
// into a (window, folder) pair before anything can render. That decision is
// the whole of this module: pure, no Electron, so the four cases below are
// testable without a running app.
//
// The two platforms deliver the path by different routes and this module is
// deliberately blind to both. macOS fires `open-file`, sometimes before the app
// is ready; Windows appends it to argv, on a first launch and — through the
// single-instance lock — on every later double-click too. `filesFromArgv` turns
// the second of those into the same thing the first already was.
//
// Kept deliberately short. Only the types Nami already renders as a document,
// and only the ones a person would plausibly want a workbench to own. Images,
// video, audio and PDF are Preview's; .json and .yml belong to an editor.
// Being listed in "Open With" for everything is noise, not a feature.
const path = require('path');

const OPEN_EXT = ['md', 'markdown', 'mdx', 'txt', 'text'];

function extOf(p) {
  const base = String(p || '').split(/[\\/]/).pop() || '';
  const i = base.lastIndexOf('.');
  // i > 0, not i >= 0: a leading dot names the file (".md"), it is not an
  // extension on an empty name.
  return i > 0 ? base.slice(i + 1).toLowerCase() : '';
}

function handles(filePath) { return OPEN_EXT.includes(extOf(filePath)); }

function dirOf(p) { return path.dirname(String(p || '')); }

// Separator-aware, so "/proj-evil" is not read as living under "/proj". Same
// boundary test as the renderer's path-guard, for the same reason — and
// path.relative rather than a startsWith, because on Windows the two strings
// can also differ by separator and by the case of the drive letter while
// naming the same place.
function contains(folder, filePath) {
  if (!folder) return false;
  let rel;
  try { rel = path.relative(String(folder), String(filePath)); } catch (_) { return false; }
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

const depth = (folder) => String(folder).split(/[\\/]+/).filter(Boolean).length;

// windows: [{ id, folder }] — folder may be null for a window with nothing open.
// Returns { action, id, folder }:
//   here       — that window already holds the file; just open the tile
//   adopt      — that window switches to the file's parent folder first
//   new-window — nothing is open; make a window on the parent folder
function chooseTarget({ filePath, windows = [], focusedId = null }) {
  const dir = dirOf(filePath);
  const holding = windows.filter((w) => w.folder && contains(w.folder, filePath));
  if (holding.length) {
    // Deepest folder first: a window open on the file's own folder is a better
    // home than one open on the repo root three levels up. The focused window
    // breaks ties, so the desk being looked at wins when both are equal.
    let best = holding[0];
    for (const w of holding) {
      const d = depth(w.folder), bd = depth(best.folder);
      if (d > bd || (d === bd && w.id === focusedId)) best = w;
    }
    return { action: 'here', id: best.id, folder: best.folder };
  }
  // No window holds it. Hand it to the focused desk to adopt — falling back to
  // the last window, because a focusedId can go stale between the click and
  // the event, and spawning a window over a stale id would be a surprise.
  if (windows.length) {
    const target = windows.find((w) => w.id === focusedId) || windows[windows.length - 1];
    return { action: 'adopt', id: target.id, folder: dir };
  }
  return { action: 'new-window', id: null, folder: dir };
}

// The Windows half of `open-file`: a double-click in Explorer starts (or, via
// the single-instance lock, reaches) Nami with the path on the end of argv.
//
// Everything that is not plainly a document is dropped, because argv also
// carries things that would be disastrous to treat as one. The first entry is
// the executable. A dev run's is `electron .`, so the second is the app folder.
// Chromium and Electron both add their own switches, and Nami adds --demo,
// --scene=, --user-data and a screenshot path. Rather than enumerate those —
// a list that is wrong the moment anyone adds a flag — this keeps only what
// `handles` already vouches for, which no switch can ever look like.
//
// `--` is honoured as the end of switches, so a file genuinely called
// `--notes.md` can still be opened by anything that passes one.
function filesFromArgv(argv = [], { skip = 1 } = {}) {
  const rest = argv.slice(skip);
  const sep = rest.indexOf('--');
  const words = sep >= 0 ? rest.slice(sep + 1) : rest.filter((a) => !String(a).startsWith('-'));
  return words.filter((a) => handles(a));
}

module.exports = { OPEN_EXT, handles, chooseTarget, filesFromArgv };
