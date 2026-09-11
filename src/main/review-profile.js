const fs = require('fs');
const os = require('os');
const path = require('path');

// Select before Electron initializes storage. Never reuse a review directory,
// and never claim ownership of a directory supplied by the caller.
function createReviewProfile({ argv, normalPath, packaged, reviewBuild = false, homePath = os.homedir(), platform = process.platform }) {
  const persistent = reviewBuild || argv.includes('--review');
  const review = persistent || argv.some((arg) => arg === '--review' || arg === '--demo' || arg === '--screenshot'
    || arg.startsWith('--scene=') || arg.startsWith('--theme='));
  const index = argv.indexOf('--user-data');
  const explicit = index >= 0 && argv[index + 1];
  // A review profile on Desktop makes even background cache/settings activity
  // request protected-folder access. Reject that developer launch configuration
  // before Electron opens storage; never probe or migrate protected files here.
  if (review && explicit) {
    const target = path.resolve(explicit);
    if (['Desktop', 'Documents', 'Downloads'].some(name => {
      const protectedPath = path.join(homePath, name);
      return target === protectedPath || target.startsWith(protectedPath + path.sep);
    })) throw new Error('Review data must be outside Desktop, Documents and Downloads. Use --review without --user-data for a persistent Application Support profile.');
  }
  const owned = review && !persistent && !explicit;
  const directory = explicit ? path.resolve(explicit)
    : persistent ? persistentDir(homePath, platform)
      : owned ? fs.mkdtempSync(path.join(os.tmpdir(), 'nami-review-'))
      : normalPath + (packaged ? '' : '-dev');
  return {
    review,
    path: directory,
    cleanup() {
      if (!owned) return;
      // maxRetries, because of Windows. Deleting a directory somebody still has
      // a handle open on is an error there rather than a detail of bookkeeping,
      // and at quit time Chromium's own threads have not all let go of the
      // cache yet — measured as EPERM on every single review run. The retries
      // cover the usual case; the catch covers the rest, because this is a
      // temp directory nobody will look at again and failing to remove one is
      // not worth ending a quit over. Whatever survives is swept on the next
      // launch by sweepOldProfiles.
      try {
        fs.rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
      } catch (_) { /* the sweep will get it */ }
    },
  };
}

// Where a persistent review profile lives, per platform's own convention for
// "application data that is not a document". macOS keeps it under Library;
// Windows keeps it in Roaming, which is what app.getPath('userData') would
// return there — but this runs before Electron will say.
function persistentDir(homePath, platform) {
  if (platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(homePath, 'AppData', 'Roaming'), 'Nami Review');
  }
  return path.join(homePath, 'Library', 'Application Support', 'Nami Review');
}

// Disposable profiles that outlived their run. One is left behind whenever a
// cleanup loses its race with Chromium's file handles, and on Windows that is
// most of them — so without this, a week of review builds is a week of
// abandoned Electron profiles in the temp folder, tens of megabytes each.
//
// Age, not emptiness: a profile from a copy of Nami that is running right now
// must not be swept out from under it, and no run lasts a day.
function sweepOldProfiles({ dir = os.tmpdir(), now = Date.now, maxAgeMs = 24 * 3600e3, io = fs } = {}) {
  let swept = 0;
  let names = [];
  try { names = io.readdirSync(dir); } catch (_) { return 0; }
  for (const name of names) {
    if (!name.startsWith('nami-review-')) continue;
    const full = path.join(dir, name);
    try {
      if (now() - io.statSync(full).mtimeMs < maxAgeMs) continue;
      io.rmSync(full, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      swept++;
    } catch (_) { /* still in use, or gone already — either way, not our problem */ }
  }
  return swept;
}

module.exports = { createReviewProfile, sweepOldProfiles };
