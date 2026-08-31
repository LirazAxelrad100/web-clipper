# Wiki Clipper

A browser extension that clips a web page into **the right folder** of an Obsidian
vault — and adds it to an inbox file so an AI agent knows what is new.

Built to replace the Obsidian Web Clipper, which saves everything to one folder and
leaves you to move the files by hand afterwards.

## What it does

1. You press the extension button (or `Cmd+Shift+S`) on any page.
2. It pulls out the article — title, author, date, body — and skips the menus,
   share buttons, footers and comments.
3. It converts the page to Markdown, keeping headings, links, images, quotes,
   lists, tables and poetry line breaks.
4. It **guesses which folder** the clip belongs in and tells you why.
5. You confirm (or override, or type a brand-new folder name) and it saves the
   `.md` file straight into your vault.
6. It adds a line to `clipper-inbox.md` at the top of the vault, so the next
   time an AI agent opens the vault it has an exact list of what is new.

Select text before clipping and it saves only the selection.

A few smaller things it handles:

- **Translators.** Sutta sites publish a translation, and the translator is the
  name worth keeping. It is read from the page — from the site's own markup,
  from "translated from the Pali by …", or from a title like
  `Piyajātikasutta—Bhikkhu Sujato` — and saved as its own `translator:` field,
  separate from `author:`, because a translator did not write the text.
- **Editor and draft pages.** Clipping from a post editor gives you a title full
  of the editor's chrome and a `source:` link only you can open. The title is
  cleaned up, and the popup warns you before saving.
- **Deleted clips.** Remove a clip in Obsidian and its inbox line goes with it,
  so an ingest never points at a note that isn't there.

## Why there is a small local helper

A browser extension is not allowed to write files to your disk — that is a
security rule of the browser, not something a clipper can work around. That is
exactly why the Obsidian Web Clipper has to go through the Downloads folder.

So this project has two halves:

| Part | What it is | What it does |
| --- | --- | --- |
| `extension/` | A Chrome extension | Reads the page, shows the popup |
| `server/` | A small Node program | Writes the file into your vault |

The helper listens on `127.0.0.1` only, so nothing outside your own Mac can
reach it. It has no dependencies — just Node.

## Setup

**1. Point it at your vault**

```bash
cp config.example.json config.json
```

Edit `config.json` and set `vaultPath` to your vault. `rawFolder` is the folder
inside the vault that holds the topic subfolders.

**2. Start the helper**

```bash
npm start
```

To make it start automatically every time you log in:

```bash
bash install/install.sh
```

(`bash install/uninstall.sh` undoes that.)

**3. Load the extension**

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode**, top right.
3. Click **Load unpacked** and choose this project's `extension` folder.
4. Pin the extension so its button is visible.

## Teaching it where things go

`server/rules.json` holds the filing rules. Edit it in any text editor — the
helper re-reads it on every clip, so there is nothing to restart.

Each folder gets a list of `domains` and `keywords`:

```json
{
  "name": "buddhism",
  "domains": ["accesstoinsight.org", "suttacentral.net"],
  "keywords": ["sutta", "dhamma", "retreat", "מדיטציה"]
}
```

Scoring is deliberately simple, so a wrong guess is always explainable:

| Match | Points |
| --- | --- |
| The page's site is in `domains` | 100 |
| A keyword appears in the title | 6 each |
| A keyword appears in the body | 1 each, capped at 8 |

The highest-scoring folder wins if it beats `minScore`. Below that, the popup
asks you to pick rather than filing it somewhere wrong.

There is one special rule ahead of all of this: if the author is you
(`ownWriting.authorNames`), the clip is your own writing, and it is filed by
language — Hebrew to one folder, everything else to another.

**New folders need no code change.** The dropdown is read from the vault every
time the popup opens, so a folder you create in Obsidian shows up by itself.
Adding it to `rules.json` is only needed if you want it auto-suggested. You can
also create a folder straight from the popup with **+ New folder…**.

## The ingest inbox

Every clip is appended to `clipper-inbox.md` at the top of your vault:

```markdown
- [ ] 2026-08-31 — [[raw/buddhism/Kalama Sutta|Kalama Sutta]] — <https://...>
```

By default the clipper does not ingest anything itself: ingesting rewrites wiki
pages, and it is worth a look before it happens. The inbox is an accurate
hand-off — open the vault in your wiki agent and ask it to work through the
unticked items.

Untick a box and the item counts as pending again; the popup shows how many
are waiting.

### Ingesting automatically

Set `ingest.mode` to `"auto"` in `config.json` and the clipper runs the ingest
itself the moment a clip is saved. The popup checkbox then says *Ingest into the
wiki now*, and the file is written before the agent is even started — so a
failed ingest can never cost you the clip.

This needs a **command line** AI agent, which is a different program from a
desktop app. It is not tied to any one provider — the clipper just runs whatever
command you name, from the vault folder, with `{{path}}` swapped for the new
file:

| Agent | `command` | `args` |
| --- | --- | --- |
| Claude Code | `claude` | `["-p", "--permission-mode", "acceptEdits"]` |
| Gemini CLI | `gemini` | `["-p", "--yolo"]` |
| Codex CLI | `codex` | `["exec", "--full-auto"]` |
| Aider | `aider` | `["--yes", "--message"]` |
| Anything else | your script | whatever it takes before the prompt |

Switching AI later means editing two lines of `config.json`. Nothing else in the
clipper knows or cares which one you use.

Output goes to `logs/ingest.log`. Each clip is still recorded in the inbox, so
you keep a list of everything that was ingested.

## Development

```bash
npm test          # rules, filenames, frontmatter, inbox
npm run icons     # regenerate the extension icons
```

`npm test` runs against a throwaway vault in the temp folder and never touches
the real one.

To try the page-reading code in a normal tab without reloading the extension,
start the helper with `CLIPPER_DEV=1` and it will serve the content scripts as
one file at `/dev/bundle.js`.

### How the pieces fit

```
extension/popup.js
  └─ injects content/extract.js     find the article, strip the furniture
     then content/to-markdown.js    DOM  ->  Markdown
     then content/main.js           bundle it all up and hand it back
  └─ POST /suggest  ->  server/classify.js   which folder?
  └─ POST /clip     ->  server/note.js       write the .md file
                        server/inbox.js      add it to the inbox
```

Nothing is minified or bundled and there are no dependencies, so every file in
here is readable as-is.

## Licence

MIT
