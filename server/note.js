'use strict';

/**
 * Turns an extracted page into an Obsidian markdown file.
 *
 * The frontmatter deliberately matches the format the Obsidian Web Clipper
 * already produced, so old and new clips look identical in the vault.
 */

const fs = require('fs');
const path = require('path');

/** Characters macOS / Obsidian dislike in filenames. */
const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|#^[\]]/g;

/**
 * Make a title safe to use as a filename, without mangling Hebrew or
 * punctuation that is actually fine.
 */
function toFilename(title) {
  const cleaned = String(title || '')
    .replace(ILLEGAL_FILENAME_CHARS, '')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim();

  // Leave room for a " (12).md" suffix inside the 255-byte filename limit.
  const trimmed = cleaned.slice(0, 180).trim();
  return trimmed || 'Untitled clip';
}

/**
 * Find a filename that is not taken yet: "Title.md", "Title (2).md", ...
 * Returns the full path.
 */
function uniquePath(dir, baseName) {
  let candidate = path.join(dir, `${baseName}.md`);
  let n = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${baseName} (${n}).md`);
    n += 1;
  }
  return candidate;
}

/** Quote a string for a YAML scalar, escaping embedded quotes. */
function yamlQuote(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** YYYY-MM-DD in local time (not UTC — a late-night clip should say today). */
function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Normalise whatever date-ish string a page gave us into YYYY-MM-DD, or null. */
function normalizeDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
}

/**
 * Build the YAML frontmatter block, matching the existing vault format:
 *
 *   ---
 *   title: "..."
 *   source: "https://..."
 *   author:
 *     - "[[Name]]"
 *   published: 2026-08-19
 *   created: 2026-08-31
 *   description: "..."
 *   tags:
 *     - "clippings"
 *   ---
 */
function buildFrontmatter(clip) {
  const lines = ['---'];

  lines.push(`title: ${yamlQuote(clip.title || 'Untitled clip')}`);

  if (clip.source) lines.push(`source: ${yamlQuote(clip.source)}`);

  const authors = (clip.authors || []).filter(Boolean);
  if (authors.length) {
    lines.push('author:');
    for (const name of authors) lines.push(`  - ${yamlQuote(`[[${name}]]`)}`);
  }

  // Recorded separately from the author: on a sutta the translator is the
  // person whose words these are, but they did not write the text.
  if (clip.translator && !authors.includes(clip.translator)) {
    lines.push('translator:');
    lines.push(`  - ${yamlQuote(`[[${clip.translator}]]`)}`);
  }

  const published = normalizeDate(clip.published);
  if (published) lines.push(`published: ${published}`);

  lines.push(`created: ${today()}`);

  if (clip.description) {
    // Collapse newlines — a multi-line description would break the YAML scalar.
    lines.push(`description: ${yamlQuote(String(clip.description).replace(/\s+/g, ' ').trim())}`);
  }

  lines.push('tags:');
  lines.push('  - "clippings"');

  lines.push('---');
  return lines.join('\n');
}

/**
 * Write the clip into `dir`. Returns { filePath, fileName }.
 */
function writeNote(dir, clip) {
  fs.mkdirSync(dir, { recursive: true });

  const filePath = uniquePath(dir, toFilename(clip.title));
  const body = String(clip.markdown || '').trim();
  const contents = `${buildFrontmatter(clip)}\n${body}\n`;

  fs.writeFileSync(filePath, contents, 'utf8');
  return { filePath, fileName: path.basename(filePath) };
}

module.exports = { writeNote, toFilename, buildFrontmatter, today, normalizeDate };
