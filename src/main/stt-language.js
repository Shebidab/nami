// Which language the on-device Whisper listens for.
//
// The multilingual models know the 99 languages below and nothing else: each is
// a single token in the decoder's vocabulary, and the prompt a transcription
// starts from names one of them — <|startoftranscript|> <|ru|> <|transcribe|>.
// Name the wrong one and the model does not fail, it obeys: measured on
// whisper-small, Russian speech prompted as English comes back as a tidy English
// *translation*, and whisper-base prompted as Russian over English speech comes
// back as nonsense in Cyrillic. So the language is never guessed from the
// machine's locale; it is either the one the user picked or the one the model
// hears.
//
// Hearing it is one decoder step. From <|startoftranscript|> alone the model's
// next token is its guess at the language, so the language token it scores
// highest is the answer. transformers 3.8.1 does not do this ("TODO: Implement
// language detection" — with no language it logs "defaulting to English" and
// transcribes Russian as English), so stt-local.js does, with pickLanguage.
//
// Pure: no model, no electron. The table is Whisper's own, in its own order.

const AUTO = 'auto';

const LANGUAGES = [
  ['en', 'English'], ['zh', 'Chinese'], ['de', 'German'], ['es', 'Spanish'],
  ['ru', 'Russian'], ['ko', 'Korean'], ['fr', 'French'], ['ja', 'Japanese'],
  ['pt', 'Portuguese'], ['tr', 'Turkish'], ['pl', 'Polish'], ['ca', 'Catalan'],
  ['nl', 'Dutch'], ['ar', 'Arabic'], ['sv', 'Swedish'], ['it', 'Italian'],
  ['id', 'Indonesian'], ['hi', 'Hindi'], ['fi', 'Finnish'],
  ['vi', 'Vietnamese'], ['he', 'Hebrew'], ['uk', 'Ukrainian'], ['el', 'Greek'],
  ['ms', 'Malay'], ['cs', 'Czech'], ['ro', 'Romanian'], ['da', 'Danish'],
  ['hu', 'Hungarian'], ['ta', 'Tamil'], ['no', 'Norwegian'], ['th', 'Thai'],
  ['ur', 'Urdu'], ['hr', 'Croatian'], ['bg', 'Bulgarian'],
  ['lt', 'Lithuanian'], ['la', 'Latin'], ['mi', 'Maori'], ['ml', 'Malayalam'],
  ['cy', 'Welsh'], ['sk', 'Slovak'], ['te', 'Telugu'], ['fa', 'Persian'],
  ['lv', 'Latvian'], ['bn', 'Bengali'], ['sr', 'Serbian'],
  ['az', 'Azerbaijani'], ['sl', 'Slovenian'], ['kn', 'Kannada'],
  ['et', 'Estonian'], ['mk', 'Macedonian'], ['br', 'Breton'], ['eu', 'Basque'],
  ['is', 'Icelandic'], ['hy', 'Armenian'], ['ne', 'Nepali'],
  ['mn', 'Mongolian'], ['bs', 'Bosnian'], ['kk', 'Kazakh'], ['sq', 'Albanian'],
  ['sw', 'Swahili'], ['gl', 'Galician'], ['mr', 'Marathi'], ['pa', 'Punjabi'],
  ['si', 'Sinhala'], ['km', 'Khmer'], ['sn', 'Shona'], ['yo', 'Yoruba'],
  ['so', 'Somali'], ['af', 'Afrikaans'], ['oc', 'Occitan'], ['ka', 'Georgian'],
  ['be', 'Belarusian'], ['tg', 'Tajik'], ['sd', 'Sindhi'], ['gu', 'Gujarati'],
  ['am', 'Amharic'], ['yi', 'Yiddish'], ['lo', 'Lao'], ['uz', 'Uzbek'],
  ['fo', 'Faroese'], ['ht', 'Haitian Creole'], ['ps', 'Pashto'],
  ['tk', 'Turkmen'], ['nn', 'Nynorsk'], ['mt', 'Maltese'], ['sa', 'Sanskrit'],
  ['lb', 'Luxembourgish'], ['my', 'Myanmar'], ['bo', 'Tibetan'],
  ['tl', 'Tagalog'], ['mg', 'Malagasy'], ['as', 'Assamese'], ['tt', 'Tatar'],
  ['haw', 'Hawaiian'], ['ln', 'Lingala'], ['ha', 'Hausa'], ['ba', 'Bashkir'],
  ['jw', 'Javanese'], ['su', 'Sundanese'],
];
const CODES = new Set(LANGUAGES.map(([code]) => code));

// What a settings.json value means. Anything that is not one of Whisper's codes
// — unset, a typo, a name like "russian", a code from some other list — is
// "detect it", because detection is right far more often than a wrong language
// is harmless.
function normalizeLanguage(value) {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return CODES.has(v) ? v : AUTO;
}

// The language the model heard: the highest-scoring language token in one
// decoder step's logits. Only language tokens compete — the vocabulary around
// them is 50k words, and a word outscoring every language says nothing about
// which language it is in.
//
// langToId is the model's own generation_config.lang_to_id ({"<|ru|>": 50263}),
// so the token ids always match the weights they came with.
function pickLanguage(logits, langToId) {
  let best = null, bestScore = -Infinity;
  for (const [token, id] of Object.entries(langToId || {})) {
    const code = token.replace(/^<\|/, '').replace(/\|>$/, '');
    const score = Number(logits[id]);
    if (CODES.has(code) && score > bestScore) { best = code; bestScore = score; }
  }
  return best;
}

module.exports = { AUTO, LANGUAGES, normalizeLanguage, pickLanguage };
