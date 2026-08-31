# Wiki Clipper — working notes

Notes for Claude (and for me) on how this project is built and why.
Short by design — the README is the user-facing doc, this is the decisions.

## What it is

A browser extension that clips a web page into the *right* folder of an Obsidian
vault, and queues it for an AI ingest. It replaces the Obsidian Web Clipper,
which saves everything into one folder and leaves the filing to be done by hand.

## Status

Working and in real use. Both halves are done and tested:

- `extension/` — Chrome MV3 extension: reads the page, converts to Markdown, popup UI
- `server/` — Node helper on `127.0.0.1:4141`: classifies, writes the file, keeps the inbox

`npm test` — 24 tests, run against a throwaway vault in the temp folder.

Verified end-to-end against real pages on accesstoinsight.org, suttacentral.net,
productcompass.pm and Substack (including Hebrew posts).

## Key decisions

**Two halves, not one extension.** A browser extension cannot write to disk —
that is a browser security rule, not something to engineer around. It is exactly
why the Obsidian clipper has to route through the Downloads folder. So a small
local helper does the file writing. It binds to `127.0.0.1` only.

**No dependencies anywhere.** The article extractor, the HTML→Markdown
converter, the server and even the PNG icon generator are all hand-written
against the standard library. No npm install, no build step, nothing to audit,
and every file is readable as-is. Worth keeping.

**Rules, not AI, for the filing decision.** Domain + keyword scoring in
`server/rules.json`, and every suggestion comes back with a plain-English reason
so a wrong guess is explainable and fixable. Below `minScore` it refuses to guess
and asks. An AI classifier was considered and deliberately deferred — the rules
cover the repeat sources, and a wrong silent guess is worse than a question.

**Own writing is detected by author, then split by language.** Her posts carry
`author: "[[Liraz Axelrad]]"`; Hebrew ones go to `Substack-archive`, English to
`English writing`. This was found by reading the existing vault, not assumed.

**Folders are read from disk every time.** New folders in Obsidian appear in the
dropdown with no code change. `rules.json` only controls *auto-suggestion*.

**Frontmatter matches the old clipper exactly** — same fields, same order, same
quoting — so old and new clips are indistinguishable in the vault. Do not
"improve" this format. The one addition is `translator:`, which only appears
when a translator is actually found.

**Translator is separate from author.** On a sutta the translator is the person
whose words these are, but they did not write the text. Read from site markup
(`#H_docAuthor`), from "translated from the Pali by …", or from a
`Title—Translator` page title.

**Ingest defaults to a queue, not automatic.** Clips are appended to
`clipper-inbox.md` at the vault root. Auto-ingest exists (`ingest.mode: "auto"`)
but is off: it rewrites wiki pages unseen and costs tokens per clip. The ingest
command is provider-neutral — `command` + `args` in config, so switching AI is a
two-line change.

## Things to avoid

- **The vault is a different project.** This repo only *writes into*
  `~/Documents/Obsidian Vault`. Its `CLAUDE.md`, the `WIKI/` layer and the ingest
  convention are maintained elsewhere. Read the vault to learn formats; don't
  edit it.
- `config.json` is gitignored — it holds a personal vault path. `config.example.json`
  is the committed template.
- Don't add a bundler or dependencies without a real reason (see above).
- The extension must be **reloaded** at `chrome://extensions` after changing
  anything under `extension/`. Server changes only need the helper restarted.

## Next up

- Watch which pages get filed wrong and tune `server/rules.json` — it is re-read
  on every clip, so no restart is needed.
- `bash install/install.sh` to make the helper start at login (not run yet).
- Possible later: AI fallback for pages no rule matches; capturing published
  dates more reliably on Substack.
