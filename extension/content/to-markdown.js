'use strict';

/**
 * Converts a cleaned DOM element into Markdown.
 *
 * Written by hand rather than pulled from a library, so the extension has zero
 * dependencies and the output can be tuned to how this vault likes its notes
 * (poem line breaks preserved, Hebrew untouched, blockquotes kept intact).
 */

const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DIV', 'DL', 'DT',
  'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3',
  'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE',
  'SECTION', 'TABLE', 'UL',
]);

/** Escape characters that would otherwise be read as Markdown syntax. */
function escapeText(text) {
  return text
    .replace(/([\\`*_{}[\]])/g, '\\$1')
    .replace(/^(\s*)([-+]|\d+\.)\s/gm, '$1\\$2 ')
    .replace(/^(\s*)(#{1,6})\s/gm, '$1\\$2 ')
    .replace(/^(\s*)>/gm, '$1\\>');
}

/** Collapse runs of whitespace, the way HTML rendering does. */
function collapse(text) {
  return text.replace(/[\t\f\r ]+/g, ' ').replace(/\n{3,}/g, '\n\n');
}

function isBlock(node) {
  return node.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has(node.tagName);
}

/** Absolute URL, so links still work once the note is in Obsidian. */
function absoluteUrl(value) {
  if (!value) return '';
  try {
    return new URL(value, document.baseURI).href;
  } catch {
    return value;
  }
}

/** Walk the children of a node and join their markdown. */
function renderChildren(node, context) {
  let out = '';
  for (const child of Array.from(node.childNodes)) {
    out += renderNode(child, context);
  }
  return out;
}

function renderList(node, context) {
  const ordered = node.tagName === 'OL';
  const start = ordered ? parseInt(node.getAttribute('start') || '1', 10) : 1;
  const indent = '  '.repeat(context.listDepth);

  const items = Array.from(node.children).filter((el) => el.tagName === 'LI');
  const lines = items.map((li, i) => {
    const marker = ordered ? `${start + i}.` : '-';
    const body = renderChildren(li, { ...context, listDepth: context.listDepth + 1 })
      .replace(/^\n+|\n+$/g, '');

    // Continuation lines of a list item must line up under the marker.
    const padding = ' '.repeat(marker.length + 1);
    const indented = body.replace(/\n(?!$)/g, `\n${indent}${padding}`);
    return `${indent}${marker} ${indented}`;
  });

  return `\n\n${lines.join('\n')}\n\n`;
}

function renderTable(node) {
  const rows = Array.from(node.querySelectorAll('tr'));
  if (!rows.length) return '';

  const toCells = (tr) =>
    Array.from(tr.querySelectorAll('th, td')).map((cell) =>
      collapse(cell.textContent).trim().replace(/\|/g, '\\|') || ' ');

  const header = toCells(rows[0]);
  if (!header.length) return '';

  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
  ];

  for (const tr of rows.slice(1)) {
    const cells = toCells(tr);
    while (cells.length < header.length) cells.push(' ');
    lines.push(`| ${cells.slice(0, header.length).join(' | ')} |`);
  }

  return `\n\n${lines.join('\n')}\n\n`;
}

function renderNode(node, context) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = collapse(node.nodeValue || '');
    if (!text.trim() && !text.includes(' ')) return '';
    return context.raw ? text : escapeText(text);
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const tag = node.tagName;

  switch (tag) {
    case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6': {
      const level = Number(tag[1]);
      const text = collapse(renderChildren(node, context)).trim();
      return text ? `\n\n${'#'.repeat(level)} ${text}\n\n` : '';
    }

    case 'P': {
      const text = renderChildren(node, context).trim();
      return text ? `\n\n${text}\n\n` : '';
    }

    case 'BR':
      // Two trailing spaces = a hard line break. Matters for poetry.
      return '  \n';

    case 'HR':
      return '\n\n---\n\n';

    case 'STRONG': case 'B': {
      const text = renderChildren(node, context).trim();
      return text ? `**${text}**` : '';
    }

    case 'EM': case 'I': {
      const text = renderChildren(node, context).trim();
      return text ? `*${text}*` : '';
    }

    case 'DEL': case 'S': case 'STRIKE': {
      const text = renderChildren(node, context).trim();
      return text ? `~~${text}~~` : '';
    }

    case 'CODE': {
      if (node.closest('pre')) return renderChildren(node, { ...context, raw: true });
      const text = collapse(node.textContent).trim();
      return text ? `\`${text.replace(/`/g, '')}\`` : '';
    }

    case 'PRE': {
      const text = node.textContent.replace(/\n+$/, '');
      if (!text.trim()) return '';
      const lang = (node.querySelector('code')?.className || '').match(/language-([\w-]+)/);
      return `\n\n\`\`\`${lang ? lang[1] : ''}\n${text}\n\`\`\`\n\n`;
    }

    case 'A': {
      const text = renderChildren(node, context).trim();
      const href = absoluteUrl(node.getAttribute('href'));
      if (!text) return '';
      if (!href || href.startsWith('javascript:')) return text;
      return `[${text}](${href.replace(/[()]/g, encodeURIComponent)})`;
    }

    case 'IMG': {
      const src = absoluteUrl(node.getAttribute('src') || node.getAttribute('data-src'));
      if (!src || src.startsWith('data:')) return '';
      const alt = (node.getAttribute('alt') || '').replace(/[[\]]/g, '');
      return `![${alt}](${src})`;
    }

    case 'BLOCKQUOTE': {
      const inner = renderChildren(node, context).trim();
      if (!inner) return '';
      const quoted = inner.split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n');
      return `\n\n${quoted}\n\n`;
    }

    case 'UL': case 'OL':
      return renderList(node, context);

    case 'TABLE':
      return renderTable(node);

    case 'FIGCAPTION': {
      const text = renderChildren(node, context).trim();
      return text ? `\n\n*${text}*\n\n` : '';
    }

    case 'SUP': case 'SUB': {
      const text = renderChildren(node, context).trim();
      return text ? `<${tag.toLowerCase()}>${text}</${tag.toLowerCase()}>` : '';
    }

    default: {
      const inner = renderChildren(node, context);
      return isBlock(node) ? `\n\n${inner.trim()}\n\n` : inner;
    }
  }
}

/** Tidy the assembled markdown: no runaway blank lines, no trailing spaces. */
function tidy(markdown) {
  return markdown
    .replace(/ /g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, (match) => (match === '  ' ? '  ' : '')))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

globalThis.__clipperToMarkdown = function toMarkdown(element) {
  return tidy(renderChildren(element, { listDepth: 0, raw: false }));
};
