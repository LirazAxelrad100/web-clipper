'use strict';

/**
 * Tests for the parts that decide where a clip goes and what the file
 * looks like. Runs against a throwaway vault in the system temp folder —
 * it never touches the real one.
 *
 *   npm test
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { classify } = require('../server/classify');
const { writeNote, toFilename, today } = require('../server/note');
const inbox = require('../server/inbox');

const FOLDERS = ['English writing', 'Substack-archive', 'Work-PM-AI', 'buddhism', 'literature'];

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${err.message}`);
  }
}

// ---------------------------------------------------------------- classify

console.log('\nclassify');

test('own Hebrew post goes to Substack-archive', () => {
  const result = classify({
    url: 'https://substack.com/home/post/p-207658102',
    title: 'ימים קרים, רחובות ריקים',
    authors: ['Liraz Axelrad'],
    text: 'אני אוהבת את הרחובות הריקים של ברלין בחורף. היה קר מאוד.',
  }, FOLDERS);
  assert.strictEqual(result.folder, 'Substack-archive');
});

test('own English post goes to English writing', () => {
  const result = classify({
    url: 'https://www.linkedin.com/posts/liraz',
    title: 'What I learned shipping my first AI tool',
    authors: ['Liraz Axelrad'],
    text: 'This week I shipped a small tool and here is what surprised me about the process.',
  }, FOLDERS);
  assert.strictEqual(result.folder, 'English writing');
});

test('a sutta site goes to buddhism', () => {
  const result = classify({
    url: 'https://www.accesstoinsight.org/tipitaka/an/an03/an03.065.than.html',
    title: 'Kalama Sutta: The Buddha\'s Charter of Free Inquiry',
    authors: ['Thanissaro Bhikkhu'],
    text: 'Thus have I heard. On one occasion the Blessed One was wandering.',
  }, FOLDERS);
  assert.strictEqual(result.folder, 'buddhism');
});

test('a PM newsletter goes to Work-PM-AI', () => {
  const result = classify({
    url: 'https://www.productcompass.pm/p/ai-prototyping',
    title: 'AI Prototyping in 2026: The PM Field Guide',
    authors: ['Paweł Huryn'],
    text: 'Which AI prototyping tool for which job, and the context prompt that beats a spec.',
  }, FOLDERS);
  assert.strictEqual(result.folder, 'Work-PM-AI');
});

test('a poem goes to literature', () => {
  const result = classify({
    url: 'https://www.poetryfoundation.org/poems/12345',
    title: 'Catastrophe Is Next to Godliness — a poem by Franny Choi',
    authors: ['Franny Choi'],
    text: 'A poem in several stanzas about longing and the end of things.',
  }, FOLDERS);
  assert.strictEqual(result.folder, 'literature');
});

test('buddhist keywords win without a known domain', () => {
  const result = classify({
    url: 'https://some-random-blog.example.com/post',
    title: 'Notes from a vipassana retreat',
    authors: ['Someone Else'],
    text: 'The teacher spoke about dukkha and anicca, and we practised metta each evening. '
        + 'Ajahn reminded us that mindfulness is not a technique.',
  }, FOLDERS);
  assert.strictEqual(result.folder, 'buddhism');
});

test('an unrelated page gets no suggestion', () => {
  const result = classify({
    url: 'https://example.com/recipes/soup',
    title: 'How to make lentil soup',
    authors: [],
    text: 'Chop the onions, add the lentils, simmer for forty minutes and season to taste.',
  }, FOLDERS);
  assert.strictEqual(result.folder, null);
});

test('a folder that does not exist is never suggested', () => {
  const result = classify({
    url: 'https://www.accesstoinsight.org/anything',
    title: 'A sutta',
    authors: [],
    text: 'dhamma dhamma dhamma',
  }, ['literature']);
  assert.notStrictEqual(result.folder, 'buddhism');
});

test('the reason explains which rule fired', () => {
  const result = classify({
    url: 'https://www.accesstoinsight.org/x',
    title: 'A sutta',
    authors: [],
    text: 'dhamma',
  }, FOLDERS);
  assert.match(result.reason, /accesstoinsight\.org/);
});

// ---------------------------------------------------------------- filenames

console.log('\nfilenames');

test('illegal characters are stripped', () => {
  assert.strictEqual(toFilename('AI Prototyping in 2026: The PM Field Guide'),
    'AI Prototyping in 2026 The PM Field Guide');
});

test('Hebrew titles survive intact', () => {
  assert.strictEqual(toFilename('ימים קרים, רחובות ריקים'), 'ימים קרים, רחובות ריקים');
});

test('slashes cannot escape the folder', () => {
  assert.ok(!toFilename('../../etc/passwd').includes('/'));
});

test('an empty title still produces a filename', () => {
  assert.strictEqual(toFilename('   '), 'Untitled clip');
});

// ---------------------------------------------------------------- note file

console.log('\nnote file');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clipper-test-'));
const rawDir = path.join(tmp, 'raw', 'buddhism');

test('frontmatter matches the existing vault format', () => {
  const { filePath } = writeNote(rawDir, {
    title: 'Kalama Sutta: Free Inquiry',
    source: 'https://www.accesstoinsight.org/x.html',
    authors: ['Thanissaro Bhikkhu'],
    published: '2020-03-04',
    description: 'The Buddha on how to test a teaching.',
    markdown: '## Opening\n\nThus have I heard.',
  });

  const text = fs.readFileSync(filePath, 'utf8');
  assert.match(text, /^---\n/);
  assert.match(text, /title: "Kalama Sutta: Free Inquiry"/);
  assert.match(text, /source: "https:\/\/www\.accesstoinsight\.org\/x\.html"/);
  assert.match(text, /author:\n {2}- "\[\[Thanissaro Bhikkhu\]\]"/);
  assert.match(text, /published: 2020-03-04/);
  assert.match(text, new RegExp(`created: ${today()}`));
  assert.match(text, /tags:\n {2}- "clippings"/);
  assert.match(text, /Thus have I heard\./);
});

test('a second clip with the same title does not overwrite the first', () => {
  const a = writeNote(rawDir, { title: 'Same Title', markdown: 'first' });
  const b = writeNote(rawDir, { title: 'Same Title', markdown: 'second' });
  assert.notStrictEqual(a.filePath, b.filePath);
  assert.strictEqual(fs.readFileSync(a.filePath, 'utf8').trim().endsWith('first'), true);
  assert.match(b.fileName, /\(\d\)\.md$/);
});

test('missing author and date are simply left out', () => {
  const { filePath } = writeNote(rawDir, { title: 'Bare clip', markdown: 'body' });
  const text = fs.readFileSync(filePath, 'utf8');
  assert.ok(!text.includes('author:'));
  assert.ok(!text.includes('published:'));
  assert.match(text, /created: /);
});

test('a translator is recorded in its own field', () => {
  const { filePath } = writeNote(rawDir, {
    title: 'Piyajatikasutta', translator: 'Bhikkhu Sujato', markdown: 'So I have heard.',
  });
  const text = fs.readFileSync(filePath, 'utf8');
  assert.match(text, /translator:\n {2}- "\[\[Bhikkhu Sujato\]\]"/);
  assert.ok(!text.includes('author:'));
});

test('a translator who is also the author is not repeated', () => {
  const { filePath } = writeNote(rawDir, {
    title: 'Self translated', authors: ['Someone'], translator: 'Someone', markdown: 'body',
  });
  const text = fs.readFileSync(filePath, 'utf8');
  assert.ok(!text.includes('translator:'));
});

test('a quote in the title does not break the YAML', () => {
  const { filePath } = writeNote(rawDir, { title: 'He said "hello"', markdown: 'body' });
  const text = fs.readFileSync(filePath, 'utf8');
  assert.match(text, /title: "He said \\"hello\\""/);
});

// ---------------------------------------------------------------- inbox

console.log('\ningest inbox');

const inboxPath = path.join(tmp, 'clipper-inbox.md');

test('the inbox is created on the first clip', () => {
  inbox.addEntry(inboxPath, {
    vaultRelPath: 'raw/buddhism/Kalama Sutta.md',
    title: 'Kalama Sutta',
    source: 'https://example.org/x',
    date: '2026-08-31',
  });
  const text = fs.readFileSync(inboxPath, 'utf8');
  assert.match(text, /# Clipper inbox/);
  assert.match(text, /- \[ \] 2026-08-31 — \[\[raw\/buddhism\/Kalama Sutta\|Kalama Sutta\]\]/);
});

test('pending items are counted', () => {
  inbox.addEntry(inboxPath, { vaultRelPath: 'raw/literature/Poem.md', title: 'Poem', date: '2026-08-31' });
  assert.strictEqual(inbox.pendingCount(inboxPath), 2);
});

test('ticked-off items stop counting', () => {
  const text = fs.readFileSync(inboxPath, 'utf8').replace('- [ ]', '- [x]');
  fs.writeFileSync(inboxPath, text);
  assert.strictEqual(inbox.pendingCount(inboxPath), 1);
});

test('an entry whose file was deleted is dropped', () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'clipper-prune-'));
  const box = path.join(vault, 'clipper-inbox.md');
  fs.mkdirSync(path.join(vault, 'raw', 'buddhism'), { recursive: true });
  fs.writeFileSync(path.join(vault, 'raw', 'buddhism', 'Alive.md'), 'x');

  inbox.addEntry(box, { vaultRelPath: 'raw/buddhism/Alive.md', title: 'Alive', date: '2026-08-31' });
  inbox.addEntry(box, { vaultRelPath: 'raw/buddhism/Deleted.md', title: 'Deleted', date: '2026-08-31' });
  assert.strictEqual(inbox.pendingCount(box), 2);

  assert.strictEqual(inbox.prune(box, vault), 1);
  assert.strictEqual(inbox.pendingCount(box), 1);
  assert.match(fs.readFileSync(box, 'utf8'), /Alive/);
  assert.ok(!fs.readFileSync(box, 'utf8').includes('Deleted'));

  fs.rmSync(vault, { recursive: true, force: true });
});

test('a ticked-off entry survives pruning even if the file is gone', () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'clipper-prune2-'));
  const box = path.join(vault, 'clipper-inbox.md');
  inbox.addEntry(box, { vaultRelPath: 'raw/x/Gone.md', title: 'Gone', date: '2026-08-31' });
  fs.writeFileSync(box, fs.readFileSync(box, 'utf8').replace('- [ ]', '- [x]'));

  assert.strictEqual(inbox.prune(box, vault), 0);
  assert.match(fs.readFileSync(box, 'utf8'), /Gone/);

  fs.rmSync(vault, { recursive: true, force: true });
});

// ---------------------------------------------------------------- done

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
