// Gets Whisper weights onto disk in a layout transformers.js can read offline.
//
// Deliberately does NOT use transformers' own FileCache: that streams straight
// into the final path, so quitting mid-download leaves a truncated .onnx that
// every later run treats as a valid cache hit. Here each file lands as .part and
// is renamed only once complete, and the model only counts as usable when a
// .ready marker exists — so a half-finished set is re-fetched, never trusted.
//
// fs and fetch are injectable so the tests run without network or disk.
const fs = require('fs');
const path = require('path');

// Verified empirically against transformers 3.8.1: these are exactly the files
// it opens for an ASR pipeline. Re-check with a remote run if the version moves.
const MODEL_FILES = [
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'tokenizer_config.json',
  'tokenizer.json',
  'onnx/encoder_model_quantized.onnx',
  'onnx/decoder_model_merged_quantized.onnx',
];

// Multilingual, both of them. These replaced tiny.en and base.en, which were
// trained on English alone: given Russian, tiny.en wrote "At Cry 5's Nastroik
// Miii's Preyfjashov" — not a weak transcript, a transcript of nothing.
//
// Measured on the Windows 10 machine this port was built on (x64 CPU, q8,
// transformers 3.8.1), three Russian sentences of 6–8 s read by a TTS voice,
// word error rate against the script:
//
//   tiny   41 MB   9 / 55 / 64 %   ~1 s    — ruled out: half the words wrong
//   base   77 MB   9 /  9 / 36 %   ~2 s    — bundled: works offline on day one
//   small 249 MB   9 /  9 /  9 %   ~5 s    — the one to download for accuracy
//
// base costs the installer 36 MB over tiny.en, and is also the better English
// model of the two. Anything larger (large-v3-turbo is 1 GB) is too slow on a
// CPU for dictation, where the wait is the whole experience.
const MODELS = [
  { id: 'base', repo: 'onnx-community/whisper-base', label: 'Fast', bytes: 77_000_000, bundled: true },
  { id: 'small', repo: 'onnx-community/whisper-small', label: 'More accurate', bytes: 249_000_000 },
];
const DEFAULT_MODEL = 'base';
const modelById = (id) => MODELS.find((m) => m.id === id) || MODELS.find((m) => m.id === DEFAULT_MODEL);

const fsIo = {
  exists: (p) => fs.existsSync(p),
  mkdir: (p) => fs.mkdirSync(p, { recursive: true }),
  write: (p, buf) => fs.writeFileSync(p, buf),
  rename: (a, b) => fs.renameSync(a, b),
  remove: (p) => fs.rmSync(p, { recursive: true, force: true }),
  copy: (a, b) => fs.cpSync(a, b, { recursive: true }),
};

const repoDir = (dir, repo) => path.join(dir, repo);
const readyMarker = (dir, repo) => path.join(repoDir(dir, repo), '.ready');

// Usable means: the marker is there AND every file it promised still is.
function isReady({ dir, repo, io = fsIo }) {
  if (!dir || !io.exists(readyMarker(dir, repo))) return false;
  return MODEL_FILES.every((f) => io.exists(path.join(repoDir(dir, repo), f)));
}

async function ensureModel({ dir, repo, fetchImpl = fetch, io = fsIo, onProgress = () => {} }) {
  if (isReady({ dir, repo, io })) return { ok: true, cached: true, dir: repoDir(dir, repo) };
  // a marker without its files (or the reverse) means a previous run died partway
  io.remove(readyMarker(dir, repo));

  const missing = MODEL_FILES.filter((f) => !io.exists(path.join(repoDir(dir, repo), f)));
  let done = 0;
  for (const rel of missing) {
    const dest = path.join(repoDir(dir, repo), rel);
    const part = dest + '.part';
    io.mkdir(path.dirname(dest));
    const url = `https://huggingface.co/${repo}/resolve/main/${rel}`;
    const r = await fetchImpl(url);
    if (!r.ok) throw new Error(`could not fetch ${rel} (${r.status})`);
    io.write(part, Buffer.from(await r.arrayBuffer()));
    io.rename(part, dest);   // only now is the file real
    done += 1;
    onProgress({ phase: 'download', file: rel, done, total: missing.length });
  }
  io.write(readyMarker(dir, repo), Buffer.from(new Date().toISOString()));
  return { ok: true, cached: false, dir: repoDir(dir, repo) };
}

// Copy the models an app bundle ships (`from`, read-only) into the writable
// folder the engine reads (`to`), each one that is not already usable there.
//
// Per model, not per folder. This used to seed only when `to` had no models at
// all, which was the same thing while every build shipped the same model — and
// stops being the same the first time a build ships a different one: everyone
// updating already has a models folder, holding the old model, so the new one
// is never copied and a model that is sitting in the app reads as "77 MB to
// download".
//
// A copy lands under a temporary name and is renamed into place, like a
// download: a copy cut short by a quit would otherwise carry its .ready marker
// alongside a truncated .onnx and be trusted forever.
function seedBundled({ from, to, io = fsIo }) {
  const seeded = [];
  if (!from || !to) return seeded;
  for (const { repo } of MODELS) {
    if (!isReady({ dir: from, repo, io }) || isReady({ dir: to, repo, io })) continue;
    const dest = repoDir(to, repo), part = dest + '.seeding';
    io.remove(part);
    io.mkdir(path.dirname(dest));
    io.copy(repoDir(from, repo), part);
    io.remove(dest);
    io.rename(part, dest);
    seeded.push(repo);
  }
  return seeded;
}

module.exports = { MODEL_FILES, MODELS, DEFAULT_MODEL, modelById, isReady, ensureModel, seedBundled, repoDir, fsIo };
