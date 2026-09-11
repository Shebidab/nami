// Is there a newer Nami than the one running?
//
// Notify-only on purpose: this asks GitHub what the latest release is, and if
// it is newer, main tells the renderer to show a bar. Clicking opens the dmg in
// a browser — the user installs it themselves. Nothing here downloads, unpacks
// or replaces anything.
//
// That restraint is deliberate. Replacing a running app in place is the step
// that needs Apple's blessing (a notarized build, verified before it is swapped
// in), and doing it wrong bricks the install. When notarization is live,
// electron-updater takes over and the only thing that changes is what happens
// on click — the deciding logic below stays exactly as it is, which is why it
// lives in its own file with the IO injected.
//
// The whole module is built to fail quietly. An update check is the app's own
// business: offline, rate-limited, behind a captive portal, or handed something
// that is not a release at all — every one of those ends as "no update", never
// as an error the user has to read.

// A dotted version as numbers, plus whether it carries a -prerelease tail.
// Anything unparseable comes back null so callers can treat it as "no answer".
function parseVersion(v) {
  const text = String(v == null ? '' : v).trim().replace(/^v/i, '');
  const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-(.+))?$/.exec(text);
  if (!m) return null;
  return {
    parts: [Number(m[1]), Number(m[2] || 0), Number(m[3] || 0)],
    pre: m[4] || '',
  };
}

// True when `candidate` is a version worth telling the user about.
function isNewer(candidate, current) {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a.parts[i] !== b.parts[i]) return a.parts[i] > b.parts[i];
  }
  // Same numbers: a prerelease is the run-up to the release, so it loses to it.
  if (a.pre && !b.pre) return false;
  if (!a.pre && b.pre) return true;
  return false;
}

// What a downloadable installer is called on each platform. One release now
// carries four of them — two Mac dmgs and two Windows installers — so "the
// newest asset" is no longer an answer; the extension is what tells a Mac's
// download from a PC's.
const INSTALLER_EXT = { darwin: '.dmg', win32: '.exe' };

// GitHub's release JSON → { version, url }, or null if it is not something a
// user should be offered: a draft, a prerelease, or not a release at all.
function releaseFromApi(doc, arch = process.arch, platform = process.platform) {
  if (!doc || typeof doc !== 'object') return null;
  if (doc.draft || doc.prerelease) return null;
  const version = String(doc.tag_name || '').trim().replace(/^v/i, '');
  if (!parseVersion(version)) return null;

  // Hand the user the installer for the machine they are on: the dmg on a Mac,
  // the .exe on Windows — never the other, which is the one mistake here that
  // is worse than offering nothing. A platform with no naming rule of its own
  // (a Linux build from source) falls through to the release page, which is
  // also where an arch we cannot match lands.
  const ext = INSTALLER_EXT[String(platform)] || '';
  const assets = Array.isArray(doc.assets) ? doc.assets : [];
  const mine = ext ? assets.filter((a) => a && typeof a.name === 'string' && a.name.endsWith(ext)) : [];
  const wantsArm = String(arch) === 'arm64';
  const pick = mine.find((a) => (/arm64/i.test(a.name)) === wantsArm) || null;
  const url = (pick && pick.browser_download_url) || doc.html_url || '';
  if (!url) return null;
  return { version, url };
}

const LATEST = 'https://api.github.com/repos/mrdainami/nami/releases/latest';

async function fetchLatest(url = LATEST) {
  const res = await fetch(url, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Nami' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

// The same question with the answer kept whole:
//   { state: 'update', version, url } | { state: 'current' } | { state: 'offline' }
//
// This is for the About pane, where somebody pressed a button and is waiting.
// The silence the rest of this file is built on would be a lie there: "I could
// not reach GitHub" and "you have the newest one" are different answers, and
// telling someone they are up to date when nothing was actually checked is the
// one outcome an update check must never produce.
//
// A reachable GitHub with nothing offerable (the latest is a draft, or a
// prerelease) is 'current' rather than an error. From where the user stands
// there is nothing to install, which is what 'current' means.
async function updateStatus({ currentVersion, arch = process.arch, platform = process.platform, fetchJson = fetchLatest } = {}) {
  let doc = null;
  try {
    doc = await fetchJson();
  } catch (_) {
    return { state: 'offline' };
  }
  const rel = releaseFromApi(doc, arch, platform);
  if (!rel || !isNewer(rel.version, currentVersion)) return { state: 'current' };
  return { state: 'update', version: rel.version, url: rel.url };
}

// The whole question, answered once: { version, url } or null. Never throws.
// The background poll's contract, unchanged: everything that is not news is
// null, so being offline never reaches the user as anything at all.
async function checkForUpdate(opts = {}) {
  const st = await updateStatus(opts);
  return st.state === 'update' ? { version: st.version, url: st.url } : null;
}

module.exports = { isNewer, releaseFromApi, checkForUpdate, updateStatus, parseVersion, LATEST, INSTALLER_EXT };
