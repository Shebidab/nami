import { test } from 'node:test';
import assert from 'node:assert/strict';
import langs from '../src/main/stt-language.js';

const { AUTO, LANGUAGES, normalizeLanguage, pickLanguage } = langs;

// The on-device engine understood English and nothing else: tiny.en turned a
// Russian sentence into "At Cry 5's Nastroik Miii's Preyfjashov". The models are
// multilingual now, and which language they listen for is decided here.

test('the table is Whisper\'s 99 languages, each once, Russian and English among them', () => {
  assert.equal(LANGUAGES.length, 99);
  const codes = LANGUAGES.map(([code]) => code);
  assert.equal(new Set(codes).size, 99, 'no code twice');
  assert.deepEqual(LANGUAGES.find(([c]) => c === 'ru'), ['ru', 'Russian']);
  assert.deepEqual(LANGUAGES.find(([c]) => c === 'en'), ['en', 'English']);
  // every name is written for a person, not copied lowercase from the tokenizer
  assert.equal(LANGUAGES.every(([, name]) => /^[A-Z]/.test(name)), true);
});

test('a saved language is kept only if it is one of Whisper\'s codes', () => {
  assert.equal(normalizeLanguage('ru'), 'ru');
  assert.equal(normalizeLanguage(' RU '), 'ru');
  assert.equal(normalizeLanguage('haw'), 'haw');
});

test('anything else means "detect", never a guess at what was meant', () => {
  // A wrong language is not harmless — the model translates into it, or makes
  // things up in it — so junk falls back to hearing, not to English.
  for (const v of [undefined, null, '', 'auto', 'russian', 'ru-RU', 'xx', 42, {}]) {
    assert.equal(normalizeLanguage(v), AUTO, `for ${JSON.stringify(v)}`);
  }
});

// A vocabulary shaped like Whisper's: ordinary word ids, then language tokens.
const LANG_TO_ID = { '<|en|>': 50259, '<|zh|>': 50260, '<|ru|>': 50263, '<|uk|>': 50280 };
function logits(scores, size = 51865) {
  const a = new Float32Array(size).fill(-10);
  for (const [id, v] of Object.entries(scores)) a[id] = v;
  return a;
}

test('the language heard is the highest-scoring language token', () => {
  assert.equal(pickLanguage(logits({ 50259: 1.5, 50263: 9.25, 50280: 7 }), LANG_TO_ID), 'ru');
  assert.equal(pickLanguage(logits({ 50259: 12, 50263: 3 }), LANG_TO_ID), 'en');
});

test('a word that outscores every language is not mistaken for one', () => {
  // id 440 is an ordinary token; the model finding it likely says nothing about
  // which language the audio is in, so only language tokens may compete
  assert.equal(pickLanguage(logits({ 440: 99, 50259: 2, 50263: 4 }), LANG_TO_ID), 'ru');
});

test('a token the table does not know cannot be returned as a language', () => {
  const withJunk = { ...LANG_TO_ID, '<|xx|>': 50300 };
  assert.equal(pickLanguage(logits({ 50300: 50, 50259: 1 }), withJunk), 'en');
});

test('no language tokens at all gives no answer rather than a wrong one', () => {
  assert.equal(pickLanguage(logits({ 1: 5 }), {}), null);
  assert.equal(pickLanguage(logits({ 1: 5 }), undefined), null);
});
