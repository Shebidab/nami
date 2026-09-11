import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortAge } from '../src/renderer/rel-time.mjs';

const NOW = Date.UTC(2026, 7, 9, 12, 0, 0); // Sun 9 Aug 2026, noon
const ago = (ms) => NOW - ms;

test('a row with no timestamp shows nothing rather than a fake age', () => {
  assert.equal(shortAge(0, NOW), '');
  assert.equal(shortAge(undefined, NOW), '');
});

test('the last minute reads as now', () => {
  assert.equal(shortAge(ago(0), NOW), 'now');
  assert.equal(shortAge(ago(59e3), NOW), 'now');
});

test('minutes, then hours', () => {
  assert.equal(shortAge(ago(12 * 60e3), NOW), '12m');
  assert.equal(shortAge(ago(3 * 3600e3), NOW), '3h');
  assert.equal(shortAge(ago(23 * 3600e3), NOW), '23h');
});

// The weekday is formatted in the reader's own locale, which is the point — so
// the assertion has to be about the shape of the answer rather than about its
// alphabet. `/^[A-Za-z]{3,}\.?$/` looked like it said "a weekday" and actually
// said "an English one": on a machine set to Russian this printed `чт`, a
// correct answer that failed the test. What is true in every locale is that a
// weekday carries no digits, a date does, and the two are never the same
// string.
test('inside the week it names the day, past it a date', () => {
  const weekday = shortAge(ago(3 * 86400e3), NOW);
  assert.ok(weekday.length >= 2, `expected a weekday, got ${weekday}`);
  assert.doesNotMatch(weekday, /\d/, `a weekday carries no number, got ${weekday}`);
  const older = shortAge(ago(40 * 86400e3), NOW);
  assert.match(older, /\d/, `expected a date with a number, got ${older}`);
  assert.notEqual(older, weekday);
});

// The ladder's own steps stay ASCII whatever the machine is set to — they are
// Nami's words, not the platform's, and a rail that read `сейчас` on one desk
// and `now` on another would be a bug rather than a translation.
test('the short steps are Nami’s own text, not the locale’s', () => {
  assert.equal(shortAge(ago(30e3), NOW), 'now');
  assert.equal(shortAge(ago(45 * 60e3), NOW), '45m');
});

test('a clock that jumped backwards never prints a negative age', () => {
  assert.equal(shortAge(NOW + 5 * 3600e3, NOW), 'now');
});
