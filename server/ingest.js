'use strict';

/**
 * Optional: hand freshly clipped files to a command line AI agent so the wiki
 * updates itself, with no "ingest this" typed by hand.
 *
 * Off by default (`mode: "inbox"`), and deliberately not tied to any one AI.
 *
 * With `command: "auto"` the helper looks for each agent in `agents` and uses
 * the first one actually installed. Switching AI then means installing a
 * different CLI — no config to edit, nothing in the code to change. Name a
 * `command` explicitly to override the search, including a path to your own
 * script.
 *
 * Worth knowing before switching it on: an automatic ingest edits wiki pages
 * without showing you anything first, and it costs tokens on every run. The
 * default "inbox" mode queues the clip instead, so you stay in the loop.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

/**
 * Agents this helper knows how to drive, in the order it tries them.
 * Each takes the prompt as its final argument.
 *
 * Adding one is a two-line change — that is the point.
 */
const KNOWN_AGENTS = [
  { command: 'claude', args: ['-p', '--permission-mode', 'acceptEdits'] },
  { command: 'gemini', args: ['-p', '--yolo'] },
  { command: 'codex', args: ['exec', '--full-auto'] },
  { command: 'opencode', args: ['run'] },
  { command: 'cursor-agent', args: ['-p', '--force'] },
  { command: 'aider', args: ['--yes', '--message'] },
  { command: 'llm', args: [] },
];

const DEFAULTS = {
  mode: 'inbox',                // "inbox" | "auto" | "off"
  command: 'auto',              // "auto" = use whichever agent is installed
  args: null,                   // null = use the matched agent's own arguments
  agents: KNOWN_AGENTS,
  promptTemplate: 'ingest {{path}}',
  timeoutMinutes: 20,
};

function settings(config) {
  return { ...DEFAULTS, ...(config.ingest || {}) };
}

/** Where to look for a command, including the spots a LaunchAgent's PATH misses. */
function searchDirs() {
  const home = process.env.HOME || '';
  return [
    ...(process.env.PATH || '').split(':').filter(Boolean),
    path.join(home, '.local/bin'),
    path.join(home, '.claude/local'),
    path.join(home, '.bun/bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];
}

/** Resolve a command name to an executable path, or null. */
function findCommand(command) {
  if (!command || command === 'auto') return null;
  if (command.includes('/')) return fs.existsSync(command) ? command : null;

  for (const dir of searchDirs()) {
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
 * Work out which agent to run.
 *
 * @returns {{ bin: string, args: string[], command: string } | null}
 */
function resolveAgent(config) {
  const opts = settings(config);

  // An explicitly named command wins, so you can always override the search.
  if (opts.command && opts.command !== 'auto') {
    const bin = findCommand(opts.command);
    if (!bin) return null;
    const known = (opts.agents || []).find((a) => a.command === opts.command);
    return {
      bin,
      command: opts.command,
      args: opts.args || (known && known.args) || [],
    };
  }

  for (const agent of opts.agents || []) {
    const bin = findCommand(agent.command);
    if (bin) return { bin, command: agent.command, args: opts.args || agent.args || [] };
  }

  return null;
}

/** Names of the agents this helper would recognise, for messages and docs. */
function knownAgentNames(config) {
  return (settings(config).agents || []).map((a) => a.command);
}

/**
 * Start an ingest in the background. Returns immediately — the clip is already
 * saved, and the popup should not wait on a model call.
 *
 * @returns {{ started: boolean, agent?: string, reason?: string }}
 */
function start(config, vaultRelPath, logPath) {
  const opts = settings(config);
  if (opts.mode !== 'auto') return { started: false, reason: 'Auto-ingest is off.' };

  const agent = resolveAgent(config);
  if (!agent) {
    const looked = opts.command && opts.command !== 'auto'
      ? `"${opts.command}"`
      : `any of: ${knownAgentNames(config).join(', ')}`;
    return {
      started: false,
      reason: `No AI agent command found — looked for ${looked}. `
        + 'Install one, or set "ingest.command" in config.json.',
    };
  }

  const prompt = opts.promptTemplate.replace('{{path}}', vaultRelPath);

  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const log = fs.openSync(logPath, 'a');
  fs.writeSync(log, `\n=== ${new Date().toISOString()} — ${agent.command}: ${prompt}\n`);

  const child = spawn(agent.bin, [...agent.args, prompt], {
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
  return { started: true, agent: agent.command };
}

module.exports = { start, settings, findCommand, resolveAgent, knownAgentNames, KNOWN_AGENTS };
