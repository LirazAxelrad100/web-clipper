'use strict';

/**
 * The ingest inbox.
 *
 * Every saved clip gets a checkbox line in one markdown file at the vault root.
 * That file is the hand-off to Claude Code: open the vault and say
 * "ingest the inbox", and it has an exact, clickable list of what is new.
 *
 * Why a file and not an automatic ingest: the vault's CLAUDE.md ingest flow is
 * conversational on purpose (it reports takeaways and proposes pages before
 * editing). A queue keeps that review step instead of silently rewriting the wiki.
 */

const fs = require('fs');
const path = require('path');

const HEADER = `# Clipper inbox

Sources clipped from the browser that have **not been ingested into the wiki yet**.

To process them, open this vault in Claude Code and say: **"ingest the inbox"**.
Follow the ingest flow in \`CLAUDE.md\`, then tick each item off here.

---
`;

/** Escape a `]` so it can't break the wiki-link. */
function safeLink(target) {
  return String(target).replace(/[[\]]/g, '');
}

/**
 * Append one clip to the inbox file, creating the file if needed.
 *
 * @param {string} inboxPath  absolute path to the inbox markdown file
 * @param {object} entry      { vaultRelPath, title, source, date }
 */
function addEntry(inboxPath, entry) {
  if (!fs.existsSync(inboxPath)) {
    fs.writeFileSync(inboxPath, HEADER, 'utf8');
  }

  // Link without the .md extension — that is how Obsidian resolves wiki-links.
  const linkTarget = safeLink(entry.vaultRelPath.replace(/\.md$/, ''));
  const source = entry.source ? ` — <${entry.source}>` : '';
  const line = `- [ ] ${entry.date} — [[${linkTarget}|${safeLink(entry.title)}]]${source}\n`;

  fs.appendFileSync(inboxPath, line, 'utf8');
}

/** How many items are still unchecked. Used to show a badge in the popup. */
function pendingCount(inboxPath) {
  if (!fs.existsSync(inboxPath)) return 0;
  const text = fs.readFileSync(inboxPath, 'utf8');
  return (text.match(/^- \[ \] /gm) || []).length;
}

// "- [ ] 2026-08-31 — [[raw/buddhism/Some Note|Some Note]] — <https://...>"
const ENTRY_LINE = /^- \[([ xX])\] .*?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/;

/**
 * Drop entries whose file is no longer in the vault.
 *
 * If you delete or rename a clip in Obsidian, the inbox should not keep
 * pointing at a note that isn't there — an ingest run would just fail on it.
 * Only unticked entries are removed; a ticked one is history and stays put.
 *
 * @returns {number} how many dead entries were removed
 */
function prune(inboxPath, vaultPath) {
  if (!fs.existsSync(inboxPath)) return 0;

  const lines = fs.readFileSync(inboxPath, 'utf8').split('\n');
  let removed = 0;

  const kept = lines.filter((line) => {
    const match = line.match(ENTRY_LINE);
    if (!match) return true;

    const [, checkbox, target] = match;
    if (checkbox.trim()) return true; // already ticked off — leave it alone

    const notePath = path.join(vaultPath, `${target}.md`);
    if (fs.existsSync(notePath)) return true;

    removed += 1;
    return false;
  });

  if (removed) fs.writeFileSync(inboxPath, kept.join('\n'), 'utf8');
  return removed;
}

module.exports = { addEntry, pendingCount, prune };
