'use strict';

/**
 * Pulls the article out of a web page: title, author, date, and the main
 * content element — skipping menus, footers, share buttons and comments.
 *
 * Runs inside the page, so it can read the live DOM.
 */

// Elements that are never part of an article.
const JUNK_SELECTOR = [
  'script', 'style', 'noscript', 'template', 'iframe', 'object', 'embed',
  'nav', 'header', 'footer', 'aside', 'form', 'button', 'svg', 'canvas',
  '[aria-hidden="true"]', '[hidden]', '[role="navigation"]', '[role="banner"]',
  '[role="complementary"]', '[role="contentinfo"]', '[role="search"]',
].join(',');

// Class/id fragments that usually mark page furniture rather than content.
const JUNK_PATTERN = /(^|[-_ ])(share|social|comment|related|recommend|newsletter|subscribe|paywall|promo|advert|ads?|sponsor|sidebar|breadcrumb|pagination|cookie|consent|banner|popup|modal|toolbar|menu|nav|footer|header|byline-actions|post-ufi|like-button|tooltip)([-_ ]|$)/i;

// Containers that are very often the real article, best guess first.
const CONTENT_SELECTORS = [
  'article .available-content',   // Substack
  '.available-content',
  'article [itemprop="articleBody"]',
  '[itemprop="articleBody"]',
  'article .post-content',
  '.post-content',
  '.entry-content',
  '.article-body',
  '.article__body',
  '.story-body',
  '.markup',
  'main article',
  '[role="main"] article',
  'article',
  'main',
  '[role="main"]',
  '#content',
];

function metaContent(...selectors) {
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    const value = el && (el.getAttribute('content') || el.getAttribute('datetime') || el.textContent);
    if (value && value.trim()) return value.trim();
  }
  return '';
}

/**
 * Names this site might append to its page titles: the name it declares, plus
 * the words in its own domain.
 */
function siteNames() {
  const names = [];

  const declared = metaContent('meta[property="og:site_name"]', 'meta[name="application-name"]');
  if (declared) names.push(declared);

  try {
    const skip = new Set(['com', 'org', 'net', 'co', 'io', 'uk', 'de', 'www']);
    for (const part of location.hostname.split('.')) {
      if (part.length > 2 && !skip.has(part)) names.push(part);
    }
  } catch {
    /* about: pages and the like have no usable hostname */
  }

  return names;
}

/**
 * Strip the furniture sites add around a title: a trailing site name, and the
 * "Editing ..." prefix you get when clipping from an editor rather than the
 * published page.
 */
function cleanTitle(title) {
  let text = String(title || '').trim();

  // "Article Name | Site Name" -> "Article Name". Twice, since some pages
  // append both a section and the site.
  for (let i = 0; i < 2; i += 1) {
    for (const name of siteNames()) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const suffix = new RegExp(`\\s*[|\\u2013\\u2014\\u00b7:-]\\s*${escaped}\\s*$`, 'i');
      if (suffix.test(text) && text.replace(suffix, '').trim().length > 2) {
        text = text.replace(suffix, '').trim();
      }
    }
  }

  text = text.replace(/^(editing|edit|draft|preview)\s*[:—–-]?\s+/i, '').trim();

  // Editors often wrap the title in their own quotes; drop a matched pair.
  text = text.replace(/^["'“”](.*)["'“”]$/s, '$1').trim();

  return text;
}

/** Page title, preferring the og: tag, with site furniture removed. */
function getTitle() {
  const og = metaContent('meta[property="og:title"]', 'meta[name="twitter:title"]');
  if (og) return cleanTitle(og);

  const h1 = document.querySelector('article h1, main h1, h1');
  if (h1 && h1.textContent.trim()) return cleanTitle(h1.textContent);

  return cleanTitle(document.title) || document.title;
}

/**
 * Does this URL point at an editor, draft or preview rather than something
 * anyone else could open? Worth warning about: the clip is fine, but the
 * `source:` link in the note will be useless to everybody else.
 */
function isPrivateUrl() {
  const url = location.href;
  return /\/publish\/post\//.test(url)          // Substack editor
    || /\/(edit|drafts?|compose|new)(\/|\?|$)/i.test(url)
    || /docs\.google\.com\/.*\/edit/.test(url)
    || /[?&](draft|preview)=(true|1)/i.test(url)
    || /\/wp-admin\//.test(url);
}

/** Author names, as a list — pages disagree wildly about where to put these. */
function getAuthors() {
  const found = [];

  const push = (value) => {
    const name = String(value || '').replace(/^\s*by\s+/i, '').trim();
    if (name && name.length < 80 && !found.includes(name)) found.push(name);
  };

  document.querySelectorAll('meta[name="author"], meta[property="article:author"], meta[name="twitter:creator"]')
    .forEach((el) => push(el.getAttribute('content')));

  // JSON-LD is the most reliable source when a site bothers to include it.
  document.querySelectorAll('script[type="application/ld+json"]').forEach((el) => {
    try {
      const data = JSON.parse(el.textContent);
      const nodes = Array.isArray(data) ? data : [data, ...(data['@graph'] || [])];
      for (const node of nodes) {
        const author = node && node.author;
        if (!author) continue;
        for (const a of Array.isArray(author) ? author : [author]) {
          push(typeof a === 'string' ? a : a && a.name);
        }
      }
    } catch {
      /* malformed JSON-LD is common — just skip it */
    }
  });

  if (!found.length) {
    document.querySelectorAll('[rel="author"], .author-name, .byline-names, .byline, .author, [itemprop="author"]')
      .forEach((el) => push(el.textContent));
  }

  // A twitter:creator handle is a fallback, not a name — drop it if we have better.
  return found.filter((n) => !(found.length > 1 && n.startsWith('@'))).slice(0, 4);
}

/** Does this read like a person's name rather than a phrase? */
function looksLikeName(value) {
  const text = String(value || '').trim();
  if (!text || text.length > 60 || /\d/.test(text)) return false;

  const words = text.split(/\s+/);
  if (words.length < 1 || words.length > 4) return false;

  return words.every((word) => /^[\p{Lu}][\p{L}.'’-]*$/u.test(word));
}

/**
 * The translator, for sources that have one.
 *
 * Sutta sites publish a translation rather than an original, and the
 * translator is the name worth recording — but they rarely put it in a meta
 * tag, so it has to be read off the page.
 *
 * @param {string} contentText  the article's plain text, for the prose pattern
 */
function getTranslator(contentText) {
  // 1. Sites that mark it up. #H_docAuthor is Access to Insight's.
  const el = document.querySelector('#H_docAuthor, [itemprop="translator"], .translator');
  if (el) {
    const name = el.textContent.trim();
    if (looksLikeName(name)) return name;
  }

  // 2. "translated from the Pali by Thanissaro Bhikkhu"
  const prose = String(contentText || '').slice(0, 3000)
    .match(/translated\s+(?:from\s+the\s+\p{Lu}\p{L}+\s+)?by\s+([\p{Lu}][\p{L}.'’-]*(?:\s+[\p{Lu}][\p{L}.'’-]*){0,3})/u);
  if (prose && looksLikeName(prose[1])) return prose[1].trim();

  // 3. SuttaCentral titles the page "Piyajātikasutta—Bhikkhu Sujato".
  const title = metaContent('meta[property="og:title"]') || document.title;
  const dashed = title.match(/[—–]\s*([^—–]+)$/);
  if (dashed && looksLikeName(dashed[1])) return dashed[1].trim();

  return '';
}

function getPublished() {
  return metaContent(
    'meta[property="article:published_time"]',
    'meta[name="article:published_time"]',
    'meta[property="og:article:published_time"]',
    'meta[name="date"]',
    'meta[name="publish-date"]',
    'time[datetime]',
  );
}

function getDescription() {
  return metaContent('meta[name="description"]', 'meta[property="og:description"]');
}

/** Ratio of text sitting inside links — navigation blocks score high here. */
function linkDensity(el) {
  const total = el.textContent.length;
  if (!total) return 1;
  let linked = 0;
  el.querySelectorAll('a').forEach((a) => { linked += a.textContent.length; });
  return linked / total;
}

/** How article-like a container looks. */
function scoreElement(el) {
  const paragraphs = el.querySelectorAll('p');
  let text = 0;
  paragraphs.forEach((p) => {
    const len = p.textContent.trim().length;
    if (len > 25) text += len;
  });
  if (text < 200) return 0;
  return text * (1 - linkDensity(el));
}

/** Best-effort guess at the element holding the article. */
function findContentElement() {
  for (const selector of CONTENT_SELECTORS) {
    const el = document.querySelector(selector);
    if (el && scoreElement(el) > 0) return el;
  }

  let best = null;
  let bestScore = 0;
  document.querySelectorAll('div, section, td').forEach((el) => {
    const score = scoreElement(el);
    if (score > bestScore) {
      bestScore = score;
      best = el;
    }
  });

  return best || document.body;
}

/** Remove furniture from a detached copy of the content. */
function clean(root) {
  root.querySelectorAll(JUNK_SELECTOR).forEach((el) => el.remove());

  root.querySelectorAll('[class], [id]').forEach((el) => {
    const label = `${el.className || ''} ${el.id || ''}`;
    if (typeof el.className === 'string' && JUNK_PATTERN.test(label)) el.remove();
  });

  // Empty wrappers left behind by the removals above.
  root.querySelectorAll('div, span, p, section').forEach((el) => {
    if (!el.textContent.trim() && !el.querySelector('img, video, hr, br')) el.remove();
  });

  return root;
}

/**
 * If the user selected text before clipping, clip only that.
 * Returns a detached element, or null when nothing is selected.
 */
function getSelectionElement() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  if (selection.toString().trim().length < 20) return null;

  const wrapper = document.createElement('div');
  for (let i = 0; i < selection.rangeCount; i += 1) {
    wrapper.appendChild(selection.getRangeAt(i).cloneContents());
  }
  return wrapper;
}

/** @returns {{ element: Element, isSelection: boolean }} */
function getContent() {
  const selected = getSelectionElement();
  if (selected) return { element: clean(selected), isSelection: true };

  const found = findContentElement();
  return { element: clean(found.cloneNode(true)), isSelection: false };
}

globalThis.__clipperExtract = {
  getTitle,
  getAuthors,
  getPublished,
  getDescription,
  getContent,
  isPrivateUrl,
  getTranslator,
};
