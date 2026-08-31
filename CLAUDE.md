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

## The ingest step — open issue

This is the part that is *not* finished, and the reason is a constraint rather
than a bug.

**The problem.** The goal of this whole project is to keep the wiki updated with
less work: clip something, and have it ingested into the wiki without typing
anything. The clipper does the first half well. The second half — actually
running the ingest — needs to launch an AI agent, and a local Node server can
only launch a **command line** program.

**Why it is not on.** There is no `claude` command on this machine. The Claude
Code *desktop app* is installed, which is a different thing: a desktop app has
no command the server can run. So `ingest.mode` is `"inbox"`, and every clip is
queued in `clipper-inbox.md` at the vault root instead.

**What is already built.** `server/ingest.js` is complete and tested against the
failure paths. Setting `ingest.mode` to `"auto"` makes it run the configured
command from the vault folder with `{{path}}` replaced by the new file, log to
`logs/ingest.log`, and time out after 20 minutes. The clip is written to disk
*before* the agent starts, so a failed ingest can never lose a clip. If the
command is missing it says so in the popup rather than failing silently.

**To switch it on**, install a command line agent and set `mode: "auto"`:

    npm install -g @anthropic-ai/claude-code

It is deliberately not Claude-specific — `command` and `args` are config, so
Gemini CLI, Codex CLI, Aider or a hand-written script work just as well. That
was a requirement: no lock-in to one AI.

**The judgement call.** Even once the CLI exists, `"inbox"` stays the default.
An automatic ingest rewrites wiki pages without showing anything first, and the
vault's own ingest flow is written to be conversational — it reports takeaways
and proposes pages *before* editing, and asks when a connection is uncertain.
Running that unattended throws away the review step that makes it trustworthy,
and costs tokens on every clip. The inbox is the compromise: no typing to
remember what is new, but a human still says go.

**If revisiting:** the interesting middle ground is batching — ingest everything
in the inbox in one run, on demand or on a schedule, rather than one agent per
clip. That keeps the review step meaningful and is far cheaper than per-clip
runs.

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
