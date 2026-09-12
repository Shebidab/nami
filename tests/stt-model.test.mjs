import { test } from 'node:test';
import assert from 'node:assert/strict';
import store from '../src/main/stt-model.js';
import { abs } from './paths.mjs';

const { MODEL_FILES, MODELS, modelById, isReady, ensureModel, seedBundled } = store;
const REPO = 'onnx-community/whisper-base';
import { join, sep } from 'node:path';
// Where a model file lands, addressed the way stt-model.js addresses it — it
// joins with path.join, so on Windows the repo id's own slashes become
// separators too and a hand-built '/m/…' string matches nothing.
const modelPath = (rel) => join(abs('m'), REPO, rel);

// An in-memory disk that records renames, so we can prove nothing is published
// under its final name until it is complete.
function memIo() {
  const files = new Set();
  const log = [];
  return {
    files, log,
    exists: (p) => files.has(p),
    mkdir: () => {},
    write: (p) => { files.add(p); log.push(['write', p]); },
    rename: (a, b) => { files.delete(a); files.add(b); log.push(['rename', a, b]); },
    remove: (p) => { for (const f of [...files]) if (f === p || f.startsWith(p + sep)) files.delete(f); },
  };
}
function okFetch() {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
  };
  impl.calls = calls;
  return impl;
}

test('a fresh folder downloads every file the pipeline will open', async () => {
  const io = memIo(), f = okFetch();
  const res = await ensureModel({ dir: abs('m'), repo: REPO, fetchImpl: f, io });
  assert.equal(res.ok, true);
  assert.equal(res.cached, false);
  assert.equal(f.calls.length, MODEL_FILES.length);
  assert.equal(isReady({ dir: abs('m'), repo: REPO, io }), true);
  // and it asked huggingface for exactly the files we listed
  assert.deepEqual(
    f.calls.map((u) => u.replace(`https://huggingface.co/${REPO}/resolve/main/`, '')).sort(),
    [...MODEL_FILES].sort());
});

test('every file is written as .part and renamed — never published half-written', async () => {
  const io = memIo(), f = okFetch();
  await ensureModel({ dir: abs('m'), repo: REPO, fetchImpl: f, io });
  const writes = io.log.filter(([op]) => op === 'write').map(([, p]) => p);
  const onnx = writes.filter((p) => p.endsWith('.onnx') || p.endsWith('.json'));
  assert.equal(onnx.length, 0, 'no final path may be written to directly');
  assert.equal(writes.filter((p) => p.endsWith('.part')).length, MODEL_FILES.length);
});

test('a fetch that fails mid-set leaves no usable model and no final file', async () => {
  const io = memIo();
  let n = 0;
  const f = async (url) => {
    n += 1;
    if (n === 3) return { ok: false, status: 503 };
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
  };
  await assert.rejects(() => ensureModel({ dir: abs('m'), repo: REPO, fetchImpl: f, io }), /could not fetch/);
  assert.equal(isReady({ dir: abs('m'), repo: REPO, io }), false);
  assert.equal([...io.files].some((p) => p.endsWith('.ready')), false, 'no marker on a failed run');
  assert.equal([...io.files].some((p) => p.endsWith('.part')), false, 'no stray .part left behind');
  // the file that failed must not exist at its final path
  const failed = modelPath(MODEL_FILES[2]);
  assert.equal(io.files.has(failed), false);
});

test('a second call on a complete folder makes zero requests', async () => {
  const io = memIo();
  await ensureModel({ dir: abs('m'), repo: REPO, fetchImpl: okFetch(), io });
  const f2 = okFetch();
  const res = await ensureModel({ dir: abs('m'), repo: REPO, fetchImpl: f2, io });
  assert.equal(res.cached, true);
  assert.equal(f2.calls.length, 0);
});

test('a resumed download only fetches what is still missing', async () => {
  const io = memIo();
  // pretend an earlier run got the small files down but died before the weights
  for (const f of MODEL_FILES.slice(0, 4)) io.files.add(modelPath(f));
  const f = okFetch();
  await ensureModel({ dir: abs('m'), repo: REPO, fetchImpl: f, io });
  assert.equal(f.calls.length, MODEL_FILES.length - 4);
  assert.equal(isReady({ dir: abs('m'), repo: REPO, io }), true);
});

test('files without the marker are not trusted — the set is completed first', async () => {
  const io = memIo();
  for (const f of MODEL_FILES) io.files.add(modelPath(f));
  assert.equal(isReady({ dir: abs('m'), repo: REPO, io }), false, 'no marker means not ready');
  const f = okFetch();
  await ensureModel({ dir: abs('m'), repo: REPO, fetchImpl: f, io });
  assert.equal(f.calls.length, 0, 'present files are kept');
  assert.equal(isReady({ dir: abs('m'), repo: REPO, io }), true, 'and the marker is written');
});

test('a marker whose files went missing does not count as ready', async () => {
  const io = memIo();
  await ensureModel({ dir: abs('m'), repo: REPO, fetchImpl: okFetch(), io });
  io.files.delete(modelPath('onnx/encoder_model_quantized.onnx'));
  assert.equal(isReady({ dir: abs('m'), repo: REPO, io }), false);
});

test('progress is reported once per downloaded file and reaches the total', async () => {
  const io = memIo(), seen = [];
  await ensureModel({ dir: abs('m'), repo: REPO, fetchImpl: okFetch(), io, onProgress: (p) => seen.push(p) });
  assert.equal(seen.length, MODEL_FILES.length);
  assert.equal(seen[seen.length - 1].done, MODEL_FILES.length);
  assert.equal(seen[seen.length - 1].total, MODEL_FILES.length);
});

test('modelById falls back to the bundled default for junk input', () => {
  assert.equal(modelById('small').id, 'small');
  assert.equal(modelById('nope').id, 'base');
  assert.equal(modelById(undefined).id, 'base');
  // the default must be the one we ship, or first run needs a network after all
  assert.equal(MODELS.find((m) => m.bundled).id, 'base');
  assert.equal(MODELS.filter((m) => m.bundled).length, 1, 'one model in the installer, not two');
});

test('the English-only models are gone, and a settings file naming one gets the default', () => {
  // tiny.en and base.en transcribed Russian as invented English. Nothing may
  // resolve to them, including an old settings.json that still says so.
  assert.equal(MODELS.some((m) => /\.en$/.test(m.id) || /\.en$/.test(m.repo)), false);
  assert.equal(modelById('tiny.en').id, 'base');
  assert.equal(modelById('base.en').id, 'base');
});

// A disk that understands folders: copying or renaming a directory moves
// everything under it, which is what seeding does to a whole model at once.
function treeIo(initial = []) {
  const files = new Set(initial);
  const under = (p) => [...files].filter((f) => f === p || f.startsWith(p + sep));
  return {
    files,
    exists: (p) => files.has(p) || under(p).length > 0,
    mkdir: () => {},
    write: (p) => files.add(p),
    remove: (p) => under(p).forEach((f) => files.delete(f)),
    copy: (a, b) => under(a).forEach((f) => files.add(b + f.slice(a.length))),
    rename: (a, b) => under(a).forEach((f) => { files.delete(f); files.add(b + f.slice(a.length)); }),
  };
}
const shipped = (root, repo) => [...MODEL_FILES, '.ready'].map((f) => join(root, repo, f));
const BASE = 'onnx-community/whisper-base';

test('an update that ships a new model copies it in, even though a models folder already exists', () => {
  // The case the old seeding missed: someone on the tiny.en build already has
  // userData/models/onnx-community, so "is there a models folder?" said yes and
  // the bundled base was never copied — a model inside the app reading as a download.
  const app = abs('app', 'models'), user = abs('user', 'models');
  const io = treeIo([...shipped(app, BASE), ...shipped(user, 'onnx-community/whisper-tiny.en')]);
  assert.deepEqual(seedBundled({ from: app, to: user, io }), [BASE]);
  assert.equal(isReady({ dir: user, repo: BASE, io }), true);
});

test('seeding leaves a model that is already usable alone, and copies nothing the app does not ship', () => {
  const app = abs('app', 'models'), user = abs('user', 'models');
  const io = treeIo([...shipped(app, BASE), ...shipped(user, BASE)]);
  assert.deepEqual(seedBundled({ from: app, to: user, io }), []);
  // small is not in the bundle, so it is not seeded from it
  assert.equal(isReady({ dir: user, repo: 'onnx-community/whisper-small', io }), false);
});

test('a half-copied model from an interrupted launch is replaced, not trusted', () => {
  const app = abs('app', 'models'), user = abs('user', 'models');
  // the marker made it across, one of the weights did not
  const partial = shipped(user, BASE).filter((f) => !f.endsWith('encoder_model_quantized.onnx'));
  const io = treeIo([...shipped(app, BASE), ...partial, join(user, BASE + '.seeding', 'config.json')]);
  assert.deepEqual(seedBundled({ from: app, to: user, io }), [BASE]);
  assert.equal(isReady({ dir: user, repo: BASE, io }), true);
  assert.equal([...io.files].some((f) => f.includes('.seeding')), false, 'no temporary copy is left behind');
});

test('seeding with no bundle or no destination does nothing', () => {
  assert.deepEqual(seedBundled({ from: null, to: abs('u'), io: treeIo() }), []);
  assert.deepEqual(seedBundled({ from: abs('a'), to: null, io: treeIo() }), []);
});

test('isReady is false rather than throwing when no folder is configured', () => {
  assert.equal(isReady({ dir: null, repo: REPO, io: memIo() }), false);
});
