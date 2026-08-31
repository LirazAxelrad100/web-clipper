'use strict';

/**
 * Entry point for the injected scripts. Its final expression is what
 * chrome.scripting.executeScript hands back to the popup.
 */

(() => {
  const extract = globalThis.__clipperExtract;
  const toMarkdown = globalThis.__clipperToMarkdown;

  try {
    const { element, isSelection } = extract.getContent();
    const markdown = toMarkdown(element);
    const plainText = element.textContent.replace(/\s+/g, ' ').trim();

    return {
      ok: true,
      title: extract.getTitle(),
      source: window.location.href,
      authors: extract.getAuthors(),
      translator: extract.getTranslator(plainText),
      published: extract.getPublished(),
      description: extract.getDescription(),
      markdown,
      // Plain text for the classifier — cheaper to scan than the markdown.
      text: plainText.slice(0, 20000),
      isSelection,
      isPrivateUrl: extract.isPrivateUrl(),
      wordCount: markdown.split(/\s+/).filter(Boolean).length,
    };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
})();
