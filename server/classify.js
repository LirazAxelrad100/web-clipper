'use strict';

/**
 * Decides which /raw folder a clipped page belongs in.
 *
 * Deliberately simple and readable: domain matches and keyword matches, scored.
 * Every suggestion comes back with a human-readable reason, so when it guesses
 * wrong you can see which rule fired and fix rules.json.
 */

const fs = require('fs');
const path = require('path');

const RULES_PATH = path.join(__dirname, 'rules.json');

const DOMAIN_POINTS = 100;
const TITLE_KEYWORD_POINTS = 6;
const BODY_KEYWORD_POINTS = 1;
const BODY_KEYWORD_CAP = 8; // one keyword can't dominate by repeating

/** Re-read on every call so hand-edits to rules.json take effect immediately. */
function loadRules() {
  return JSON.parse(fs.readFileSync(RULES_PATH, 'utf8'));
}

/** Hostname without "www.", lowercased. Empty string if the URL is unusable. */
function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** True if `host` is the domain itself or a subdomain of it. */
function hostMatches(host, domain) {
  const d = domain.toLowerCase().replace(/^www\./, '');
  return host === d || host.endsWith(`.${d}`);
}

/** Rough test: does this text contain Hebrew characters? */
function isHebrew(text) {
  const sample = String(text || '').slice(0, 4000);
  const hebrew = (sample.match(/[֐-׿]/g) || []).length;
  const letters = (sample.match(/[\p{Letter}]/gu) || []).length;
  return letters > 0 && hebrew / letters > 0.2;
}

/**
 * Count occurrences of a keyword as a whole word where the language allows it.
 * Hebrew has no case and no \b support in the usual sense, so fall back to
 * plain substring counting for non-ASCII keywords.
 */
function countKeyword(haystack, keyword) {
  const needle = keyword.toLowerCase();
  if (!needle) return 0;

  const isAscii = /^[\x20-\x7E]+$/.test(needle);
  const pattern = isAscii
    ? new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g')
    : new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');

  return (haystack.match(pattern) || []).length;
}

/**
 * Suggest a folder for a page.
 *
 * @param {object} page  { url, title, authors, text }
 * @param {string[]} availableFolders  folder names that actually exist in /raw
 * @returns {{ folder: string|null, score: number, reason: string, scores: object }}
 */
function classify(page, availableFolders) {
  const rules = loadRules();
  const exists = (name) => availableFolders.includes(name);

  const title = String(page.title || '').toLowerCase();
  const body = String(page.text || '').toLowerCase().slice(0, 20000);
  const host = hostOf(page.url);
  const authors = (page.authors || []).map((a) => String(a).toLowerCase());

  // --- Rule 1: is this Liraz's own writing? Strongest signal we have. ---
  const own = rules.ownWriting || {};
  const ownNames = (own.authorNames || []).map((n) => n.toLowerCase());
  const isOwn = ownNames.some((name) => authors.some((a) => a.includes(name)));

  if (isOwn) {
    const hebrew = isHebrew(`${page.title || ''} ${page.text || ''}`);
    const folder = hebrew ? own.hebrewFolder : own.otherFolder;
    if (exists(folder)) {
      return {
        folder,
        score: DOMAIN_POINTS,
        reason: `Author is you, and the text is ${hebrew ? 'Hebrew' : 'not Hebrew'}.`,
        scores: { [folder]: DOMAIN_POINTS },
      };
    }
  }

  // --- Rule 2: score every folder on domain + keywords. ---
  const scores = {};
  const reasons = {};

  for (const folder of rules.folders || []) {
    if (!exists(folder.name)) continue;

    let score = 0;
    const why = [];

    const matchedDomain = (folder.domains || []).find((d) => host && hostMatches(host, d));
    if (matchedDomain) {
      score += DOMAIN_POINTS;
      why.push(`the site ${matchedDomain} is on its list`);
    }

    const titleHits = [];
    const bodyHits = [];
    for (const keyword of folder.keywords || []) {
      const inTitle = countKeyword(title, keyword);
      if (inTitle > 0) {
        score += TITLE_KEYWORD_POINTS * inTitle;
        titleHits.push(keyword);
      }
      const inBody = Math.min(countKeyword(body, keyword), BODY_KEYWORD_CAP);
      if (inBody > 0) {
        score += BODY_KEYWORD_POINTS * inBody;
        if (!inTitle) bodyHits.push(keyword);
      }
    }

    if (titleHits.length) why.push(`the title mentions ${titleHits.slice(0, 3).join(', ')}`);
    if (bodyHits.length) why.push(`the text mentions ${bodyHits.slice(0, 3).join(', ')}`);

    scores[folder.name] = score;
    reasons[folder.name] = why;
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [topName, topScore] = ranked[0] || [null, 0];

  const minScore = typeof rules.minScore === 'number' ? rules.minScore : 4;
  if (!topName || topScore < minScore) {
    return {
      folder: null,
      score: topScore || 0,
      reason: 'Nothing matched strongly enough — pick a folder.',
      scores,
    };
  }

  const why = reasons[topName] || [];
  return {
    folder: topName,
    score: topScore,
    reason: why.length ? `Because ${why.join(', and ')}.` : 'Matched this folder.',
    scores,
  };
}

module.exports = { classify, isHebrew, hostOf };
