'use strict';

/**
 * Wiki Clipper — local helper.
 *
 * A browser extension cannot write to your disk. This tiny server can, so the
 * extension sends it the page and it saves the .md file into the right folder.
 *
 * It binds to 127.0.0.1 only: nothing outside this Mac can reach it.
 * No dependencies — plain Node.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const { classify } = require('./classify');
const { writeNote } = require('./note');
const inbox = require('./inbox');
const ingest = require('./ingest');

// ---------------------------------------------------------------- config

const ROOT = path.join(__dirname, '..');

function loadConfig() {
  // CLIPPER_CONFIG lets the test suite point at a throwaway vault.
  const localPath = process.env.CLIPPER_CONFIG || path.join(ROOT, 'config.json');
  const examplePath = path.join(ROOT, 'config.example.json');

  if (!fs.existsSync(localPath)) {
    console.error('No config.json found.');
    console.error(`Copy ${examplePath} to ${localPath} and set your vault path.`);
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(localPath, 'utf8'));

  if (!fs.existsSync(config.vaultPath)) {
    console.error(`Vault not found at: ${config.vaultPath}`);
    console.error('Fix "vaultPath" in config.json.');
    process.exit(1);
  }

  return {
    port: config.port || 4141,
    vaultPath: config.vaultPath,
    rawDir: path.join(config.vaultPath, config.rawFolder || 'raw'),
    inboxPath: path.join(config.vaultPath, (config.inbox && config.inbox.file) || 'clipper-inbox.md'),
    inboxEnabled: !config.inbox || config.inbox.enabled !== false,
    ingestLogPath: path.join(ROOT, 'logs', 'ingest.log'),
    raw: config,
  };
}

const CONFIG = loadConfig();

// ---------------------------------------------------------------- helpers

/** Folder names inside /raw, read fresh so new folders appear on their own. */
function listFolders() {
  return fs
    .readdirSync(CONFIG.rawDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Resolve a folder name to an absolute path, refusing anything that would
 * escape /raw (path traversal, absolute paths, nested paths).
 */
function resolveFolder(name) {
  const clean = String(name || '').trim();
  if (!clean || clean.includes('/') || clean.includes('\\') || clean.startsWith('.')) {
    throw new Error(`Invalid folder name: "${clean}"`);
  }
  const full = path.resolve(CONFIG.rawDir, clean);
  if (path.dirname(full) !== path.resolve(CONFIG.rawDir)) {
    throw new Error(`Folder must sit directly inside /raw: "${clean}"`);
  }
  return full;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 20 * 1024 * 1024) {
        reject(new Error('Page too large (over 20MB).'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (err) {
        reject(new Error('Could not read the request as JSON.'));
      }
    });
    req.on('error', reject);
  });
}

/** Path relative to the vault, for wiki-links and for showing the user. */
function vaultRelative(filePath) {
  return path.relative(CONFIG.vaultPath, filePath);
}

// ---------------------------------------------------------------- routes

async function handleSuggest(req, res) {
  const page = await readBody(req);
  const folders = listFolders();
  const result = classify(page, folders);

  // Clips you have since deleted should not linger in the inbox.
  if (CONFIG.inboxEnabled) inbox.prune(CONFIG.inboxPath, CONFIG.vaultPath);

  const ingestOpts = ingest.settings(CONFIG.raw);

  sendJson(res, 200, {
    folders,
    suggestion: result.folder,
    reason: result.reason,
    score: result.score,
    pendingIngest: CONFIG.inboxEnabled ? inbox.pendingCount(CONFIG.inboxPath) : 0,
    ingestMode: ingestOpts.mode,
    ingestReady: ingestOpts.mode !== 'auto' || Boolean(ingest.findCommand(ingestOpts.command)),
  });
}

async function handleClip(req, res) {
  const clip = await readBody(req);

  if (!clip.markdown || !String(clip.markdown).trim()) {
    sendJson(res, 400, { error: 'Nothing to save — no page content came through.' });
    return;
  }

  const folderName = clip.folder;
  let dir;
  try {
    dir = resolveFolder(folderName);
  } catch (err) {
    sendJson(res, 400, { error: err.message });
    return;
  }

  const isNewFolder = !fs.existsSync(dir);
  const { filePath, fileName } = writeNote(dir, clip);
  const relPath = vaultRelative(filePath);

  // Always leave a record in the inbox, even when the ingest runs on its own —
  // it doubles as the log of what has been clipped.
  let queued = false;
  if (CONFIG.inboxEnabled && clip.queueForIngest !== false) {
    inbox.addEntry(CONFIG.inboxPath, {
      vaultRelPath: relPath,
      title: clip.title || fileName.replace(/\.md$/, ''),
      source: clip.source,
      date: new Date().toISOString().slice(0, 10),
    });
    queued = true;
  }

  // Optional: kick off the ingest immediately. Returns straight away — the file
  // is already safely written, so the popup never waits on a model.
  let ingestResult = { started: false };
  if (clip.runIngest) {
    ingestResult = ingest.start(CONFIG.raw, relPath, CONFIG.ingestLogPath);
  }

  console.log(
    `saved: ${relPath}`
    + `${isNewFolder ? '  (new folder)' : ''}`
    + `${queued ? '  [queued]' : ''}`
    + `${ingestResult.started ? '  [ingesting]' : ''}`,
  );

  sendJson(res, 200, {
    ok: true,
    path: relPath,
    fileName,
    folder: folderName,
    newFolder: isNewFolder,
    queued,
    ingestStarted: ingestResult.started,
    ingestError: ingestResult.started ? null : (clip.runIngest ? ingestResult.reason : null),
    pendingIngest: CONFIG.inboxEnabled ? inbox.pendingCount(CONFIG.inboxPath) : 0,
  });
}

// ---------------------------------------------------------------- server

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  try {
    const { pathname } = new URL(req.url, 'http://127.0.0.1');

    if (req.method === 'GET' && pathname === '/health') {
      sendJson(res, 200, {
        ok: true,
        vault: CONFIG.vaultPath,
        folders: listFolders(),
        pendingIngest: CONFIG.inboxEnabled ? inbox.pendingCount(CONFIG.inboxPath) : 0,
      });
      return;
    }

    // Dev helper: serves the content scripts as one file so they can be tried
    // out in a normal browser tab without reloading the whole extension.
    // Only available when started with CLIPPER_DEV=1.
    if (req.method === 'GET' && pathname === '/dev/bundle.js' && process.env.CLIPPER_DEV === '1') {
      const files = ['extract.js', 'to-markdown.js', 'main.js']
        .map((name) => fs.readFileSync(path.join(ROOT, 'extension', 'content', name), 'utf8'));
      const body = files.join('\n;\n');
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(body);
      return;
    }

    if (req.method === 'POST' && pathname === '/suggest') {
      await handleSuggest(req, res);
      return;
    }

    if (req.method === 'POST' && pathname === '/clip') {
      await handleClip(req, res);
      return;
    }

    sendJson(res, 404, { error: `No route for ${req.method} ${pathname}` });
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: err.message || 'Something went wrong.' });
  }
});

server.listen(CONFIG.port, '127.0.0.1', () => {
  console.log('Wiki Clipper helper is running.');
  console.log(`  vault:   ${CONFIG.vaultPath}`);
  console.log(`  folders: ${listFolders().join(', ')}`);
  console.log(`  address: http://127.0.0.1:${CONFIG.port}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${CONFIG.port} is already in use — the helper may already be running.`);
    process.exit(1);
  }
  throw err;
});
