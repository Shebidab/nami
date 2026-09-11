import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
import { pathToFileURL } from 'node:url';
import { abs } from './paths.mjs';
const { browserFileUrl } = require('../src/main/browser-file.js');

function fileStat() { return { isFile: () => true }; }

// The expected URL is computed rather than typed: a file: URL for a Windows
// path carries a drive letter (file:///C:/Users/…), so a literal here would be
// asserting which machine the suite ran on. What the test is actually about is
// that the space is encoded and the extension's case is left alone.
test('browserFileUrl accepts existing absolute html paths', () => {
  const site = abs('Users', 'cal', 'My Site', 'index.html');
  const url = browserFileUrl(site, { statSync: fileStat });
  assert.equal(url, pathToFileURL(site).href);
  assert.match(url, /My%20Site\/index\.html$/);
  assert.equal(
    browserFileUrl(abs('tmp', 'report.HTM'), { statSync: fileStat }),
    pathToFileURL(abs('tmp', 'report.HTM')).href,
  );
});

test('browserFileUrl refuses relative paths and non-html files', () => {
  assert.equal(browserFileUrl('site/index.html', { statSync: fileStat }), null);
  assert.equal(browserFileUrl(abs('tmp', 'readme.md'), { statSync: fileStat }), null);
  assert.equal(browserFileUrl(abs('tmp', 'page.html.js'), { statSync: fileStat }), null);
});

test('browserFileUrl refuses missing paths and directories', () => {
  assert.equal(browserFileUrl(abs('tmp', 'missing.html'), { statSync: () => { throw new Error('missing'); } }), null);
  assert.equal(browserFileUrl(abs('tmp', 'folder.html'), { statSync: () => ({ isFile: () => false }) }), null);
});
