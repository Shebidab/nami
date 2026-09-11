// Absolute paths for tests that do not care which operating system they are on.
//
// Most of the suite predates Windows, so it says `/proj` and `/proj/agents/a.md`
// and means "somewhere absolute". On Windows neither is: `path.resolve('/proj')`
// is `C:\proj`, `path.join` builds with backslashes, and every module that does
// its path handling correctly therefore disagreed with the fixture rather than
// with the requirement. A hundred and fifty tests failed at once, all of them
// for that one reason, and none of them because the code was wrong.
//
// So the fixtures ask for a path instead of spelling one. `abs('proj')` is
// `/proj` where that is what an absolute path looks like and `C:\proj` where it
// is not, and the assertions are written against the same call — which means
// they are now claims about behaviour rather than about punctuation.
//
// The helper is deliberately not a mock of `path`. Anything genuinely about one
// platform's rules (quoting for PowerShell, the shape of a registry PATH) is
// tested by passing that platform in explicitly, the way platform.js has always
// been tested. This is only for the tests where the separator was never the
// point.
import path from 'node:path';

// An absolute path, on whichever machine is running. path.resolve against the
// root gives Windows the current drive letter, which is what a real absolute
// path there has — and is what path.resolve inside the modules under test will
// produce when they are handed one.
export const abs = (...parts) => path.resolve(path.sep, ...parts);

// A path relative to some root, joined the way the code under test joins it.
export const at = (root, ...parts) => path.join(root, ...parts);

// The separator-blind twin, for the in-memory IO doubles that key a flat object
// by path string. Those were written against '/' and split on it; normalising
// both the seed and the lookup means one fixture reads correctly on both
// platforms without every test having to care.
export const slash = (p) => String(p).split(path.sep).join('/');
