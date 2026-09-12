// Whisper, on this machine, in the Electron main process.
//
// Verified on Electron 43 / transformers 3.8.1: `process.release.name` is 'node'
// in main, so transformers picks the onnxruntime-node backend and runs native.
// Do NOT set globalThis[Symbol.for('onnxruntime')] to force it — in 3.8.1 that
// branch assigns the runtime but never fills `supportedDevices`, and every
// pipeline call then dies with `Unsupported device: "cpu"`.
//
// Measured on an x64 Windows 10 CPU, q8, for a 6 s clip: whisper-base loads in
// ~1.5 s and transcribes in ~2 s; whisper-small ~4.5 s and ~5 s. Both models are
// multilingual — see stt-model.js for why these two, and stt-language.js for
// how the language is chosen.
const path = require('path');
const store = require('./stt-model');
const langs = require('./stt-language');

let transformers = null;   // the module, imported once
let sessions = new Map();  // modelId -> Promise<pipeline>, kept warm
let modelsDir = null;

// main owns the paths; this module stays free of electron so it can be required
// from a plain node script when debugging.
function configure({ dir }) { modelsDir = dir; }
function dir() { return modelsDir; }

async function loadTransformers() {
  if (transformers) return transformers;
  const mod = await import('@huggingface/transformers');
  transformers = mod.env ? mod : mod.default;
  const { env } = transformers;
  // read the weights we placed ourselves, and never reach the network at
  // inference time — a missing file must be a loud error, not a silent download
  env.localModelPath = modelsDir;
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  return transformers;
}

function status(cfg = {}) {
  const model = store.modelById(cfg.sttModelId);
  // What the Voice sheet needs to offer a choice: every model with its size and
  // whether it is already here, the language setting, and the languages there are.
  const choices = {
    language: langs.normalizeLanguage(cfg.sttLanguage),
    languages: langs.LANGUAGES,
    models: store.MODELS.map((m) => ({
      id: m.id, label: m.label, bytes: m.bytes, bundled: !!m.bundled,
      ready: !!modelsDir && store.isReady({ dir: modelsDir, repo: m.repo }),
    })),
  };
  if (!modelsDir) return { ready: false, reason: 'no model folder', ...choices };
  const ready = store.isReady({ dir: modelsDir, repo: model.repo });
  return ready
    ? { ready: true, modelId: model.id, ...choices }
    : { ready: false, reason: 'model not downloaded', downloadBytes: model.bytes, modelId: model.id, ...choices };
}

async function prepare(cfg = {}, onProgress = () => {}) {
  const model = store.modelById(cfg.sttModelId);
  await store.ensureModel({ dir: modelsDir, repo: model.repo, onProgress });
  // Announced before the wait, not after it: tens of MB of weights go into an
  // ONNX session here, which takes seconds and prints nothing. A progress counter
  // that stops on its last file and then sits there is how a download that is
  // working reads as a download that has hung.
  onProgress({ phase: 'load' });
  await session(model);   // pay the load cost now, not on the first dictation
  return { ok: true, modelId: model.id };
}

function session(model) {
  if (sessions.has(model.id)) return sessions.get(model.id);
  // One model in memory at a time. Switching to small in Settings would
  // otherwise keep base's session alive beside it for the rest of the run —
  // a few hundred MB of RAM spent on a model nobody is using.
  for (const [id, stale] of sessions) {
    sessions.delete(id);
    stale.then((run) => run.dispose && run.dispose()).catch(() => {});
  }
  const p = (async () => {
    const { pipeline } = await loadTransformers();
    return pipeline('automatic-speech-recognition', model.repo, { dtype: 'q8' });
  })();
  // a failed load must not poison the cache — the next attempt should retry.
  // It is also the one failure worth shouting about: it usually means the native
  // ONNX binary could not be loaded (asar packing, signing, wrong arch).
  p.catch((e) => {
    if (sessions.get(model.id) === p) sessions.delete(model.id);
    console.error('[stt] could not load', model.repo, '—', (e && e.message) || e);
  });
  sessions.set(model.id, p);
  return p;
}

const SAMPLE_RATE = 16000;
const WINDOW_S = 30;   // Whisper only ever sees 30 s at a time
const textOf = (out) => String((out && out.text) || '').trim();

async function transcribe(clip, cfg = {}) {
  const model = store.modelById(cfg.sttModelId);
  if (!store.isReady({ dir: modelsDir, repo: model.repo })) {
    throw new Error('the on-device model still needs downloading');
  }
  const run = await session(model);
  const rate = clip.sampleRate || SAMPLE_RATE;
  const long = clip.pcm.length > WINDOW_S * rate;
  // longer clips need overlapping windows, which only the pipeline does
  const chunking = long ? { chunk_length_s: WINDOW_S, stride_length_s: 5 } : {};

  const picked = langs.normalizeLanguage(cfg.sttLanguage);
  if (picked !== langs.AUTO) {
    return textOf(await run(clip.pcm, { ...chunking, language: picked, task: 'transcribe' }));
  }
  if (!long) return transcribeHeard(run, clip.pcm);
  // A long clip is heard from its first window, then transcribed whole in that
  // language. That is a second encoder pass, but only for dictation over 30 s.
  const { input_features } = await run.processor(clip.pcm.subarray(0, WINDOW_S * rate));
  const language = await hear(run, { input_features });
  return textOf(await run(clip.pcm, { ...chunking, language, task: 'transcribe' }));
}

// The language the model hears in these encoder inputs — see stt-language.js.
// `inputs` is either { input_features } (the model encodes them) or
// { encoder_outputs } (already encoded, so this is a single decoder step).
async function hear(run, inputs) {
  const T = await loadTransformers();
  const gc = run.model.generation_config;
  const start = new T.Tensor('int64', BigInt64Array.from([BigInt(gc.decoder_start_token_id)]), [1, 1]);
  const { logits } = await run.model({ ...inputs, decoder_input_ids: start });
  const language = langs.pickLanguage(logits.data, gc.lang_to_id);
  if (!language) throw new Error('the model has no language tokens to detect with');
  return language;
}

// Hear the language and transcribe a clip that fits one window, encoding it once.
//
// Done the obvious way — hear(), then the pipeline with that language — the
// encoder runs twice, and the encoder is the expensive half: 3.3 s of whisper-
// small's 5 s. Encoding once and handing the result to both steps makes
// detection cost one decoder step (measured: +0.1 s on base, +0.35 s on small)
// and gives, on every clip tried, the pipeline's exact text.
//
// Two things in transformers 3.8.1 make that work, and are the reason it is
// pinned. _prepare_encoder_decoder_kwargs_for_generation is the encoder call
// generate() itself makes. And Whisper's forward_params does not list
// 'encoder_outputs', so generate() quietly discards a precomputed one and
// encodes again unless the model is told the name is allowed. If a transformers
// upgrade moves either, this falls back to the two-pass way: slower, still right.
async function transcribeHeard(run, pcm) {
  const { model, processor, tokenizer } = run;
  const { input_features } = await processor(pcm);

  if (typeof model._prepare_encoder_decoder_kwargs_for_generation !== 'function'
    || !Array.isArray(model.forward_params)) {
    const language = await hear(run, { input_features });
    return textOf(await run(pcm, { language, task: 'transcribe' }));
  }
  if (!model.forward_params.includes('encoder_outputs')) {
    model.forward_params = [...model.forward_params, 'encoder_outputs'];
  }
  const { encoder_outputs } = await model._prepare_encoder_decoder_kwargs_for_generation({
    inputs_tensor: input_features,
    model_inputs: { input_features },
    model_input_name: 'input_features',
    generation_config: model.generation_config,
  });
  const language = await hear(run, { encoder_outputs });
  const ids = await model.generate({ inputs: input_features, encoder_outputs, language, task: 'transcribe' });
  return String(tokenizer.batch_decode(ids, { skip_special_tokens: true })[0] || '').trim();
}

// Warm the session in the background so the first dictation isn't the slow one.
function warm(cfg = {}) {
  try {
    if (!status(cfg).ready) return;
    const t0 = Date.now();
    session(store.modelById(cfg.sttModelId))
      .then(() => console.log('[stt] on-device engine ready in', Date.now() - t0, 'ms'))
      .catch(() => {});   // session() already logged it
  } catch (e) { console.error('[stt] warm failed:', e.message); }
}

module.exports = { configure, dir, status, prepare, transcribe, warm };
