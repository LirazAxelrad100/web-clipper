'use strict';

/**
 * Optional: hand a freshly clipped file straight to the Claude Code CLI so the
 * wiki updates itself, with no "ingest this" typed by hand.
 *
 * Off by default. Turn it on in config.json:
 *
 *   "ingest": { "mode": "auto" }
 *
 * This needs the Claude Code *command line* tool, which is a separate thing
 * from the desktop app:
 *
 *   npm install -g @anthropic-ai/claude-code
 *
 * Worth knowing before switching it on: an automatic ingest edits wiki pages
 * without showing you anything first, and it costs tokens on every clip. The
 * default "inbox" mode keeps the clip queued instead, so you stay in the loop.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULTS = {
  mode: 'inbox',                // "inbox" | "auto" | "off"
  command: 'claude',
  args: ['-p', '--permission-mode', 'acceptEdits'],
  promptTemplate: 'ingest {{path}}',
  timeoutMinutes: 20,
};

function settings(config) {
  return { ...DEFAULTS, ...(config.ingest || {}) };
}

/** Is the CLI actually there? Returns the resolved path, or null. */
function findCommand(command) {
  if (command.includes('/')) return fs.existsSync(command) ? command : null;

  const dirs = (process.env.PATH || '').split(':').filter(Boolean);
  // A LaunchAgent gets a minimal PATH, so check the usual install spots too.
  dirs.push(
    path.join(process.env.HOME || '', '.local/bin'),
    path.join(process.env.HOME || '', '.claude/local'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  );

  for (const dir of dirs) {
    const candidate = path.join(dir, command);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

/**
 * Start an ingest in the background. Returns immediately — the clip is already
 * saved, and the popup should not wait on a model call.
 *
 * @returns {{ started: boolean, reason?: string }}
 */
function start(config, vaultRelPath, logPath) {
  const opts = settings(config);
  if (opts.mode !== 'auto') return { started: false, reason: 'Auto-ingest is off.' };

  const bin = findCommand(opts.command);
  if (!bin) {
    const hint = opts.command === 'claude'
      ? ' Install it with: npm install -g @anthropic-ai/claude-code'
      : ' Check "ingest.command" in config.json.';
    return { started: false, reason: `Could not find the command "${opts.command}".${hint}` };
  }

  const prompt = opts.promptTemplate.replace('{{path}}', vaultRelPath);

  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const log = fs.openSync(logPath, 'a');
  fs.writeSync(log, `\n=== ${new Date().toISOString()} — ${prompt}\n`);

  const child = spawn(bin, [...opts.args, prompt], {
    cwd: config.vaultPath,
    detached: true,
    stdio: ['ignore', log, log],
    env: { ...process.env, CLIPPER_INGEST: '1' },
  });

  // Do not let a stuck run hang around for ever.
  const timeout = setTimeout(() => {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ }
  }, opts.timeoutMinutes * 60 * 1000);
  timeout.unref();

  child.on('error', (err) => {
    fs.writeSync(log, `failed to start: ${err.message}\n`);
  });

  child.unref();
  return { started: true };
}

module.exports = { start, settings, findCommand };
