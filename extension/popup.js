'use strict';

/**
 * Popup logic.
 *
 * Flow: read the page -> ask the helper which folder it thinks this is ->
 * show the form with that folder pre-selected -> save on click.
 */

const HELPER = 'http://127.0.0.1:4141';
const NEW_FOLDER_VALUE = '__new__';

const el = (id) => document.getElementById(id);

const views = {
  loading: el('loading'),
  offline: el('offline'),
  error: el('error'),
  form: el('form'),
  done: el('done'),
};

/** Show exactly one view. */
function show(name) {
  for (const [key, node] of Object.entries(views)) {
    node.classList.toggle('hidden', key !== name);
  }
}

function showError(message) {
  el('errorMessage').textContent = message;
  show('error');
}

/** The extracted page, kept around between the two steps. */
let page = null;

/** True when the helper is set up to run an ingest command itself. */
let autoIngestAvailable = false;

// ---------------------------------------------------------------- helper API

async function helperFetch(path, options = {}) {
  const response = await fetch(`${HELPER}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Helper returned ${response.status}.`);
  return data;
}

// ---------------------------------------------------------------- page read

async function readPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !tab.id) throw new Error('No active tab.');
  if (/^(chrome|edge|about|chrome-extension|devtools):/.test(tab.url || '')) {
    throw new Error('This is a browser page, not a web page — there is nothing to clip.');
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['content/extract.js', 'content/to-markdown.js', 'content/main.js'],
  });

  const result = results && results[0] && results[0].result;
  if (!result) throw new Error('Could not read this page. Try reloading it first.');
  if (!result.ok) throw new Error(result.error || 'Could not read this page.');
  if (!result.markdown.trim()) throw new Error('No article text found on this page.');

  return result;
}

// ---------------------------------------------------------------- rendering

function renderFolders(folders, suggestion) {
  const select = el('folderSelect');
  select.innerHTML = '';

  for (const name of folders) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  }

  const newOption = document.createElement('option');
  newOption.value = NEW_FOLDER_VALUE;
  newOption.textContent = '+ New folder…';
  select.appendChild(newOption);

  if (suggestion && folders.includes(suggestion)) {
    select.value = suggestion;
  } else {
    // No confident guess — make the user choose rather than filing it wrong.
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Choose a folder…';
    placeholder.disabled = true;
    select.insertBefore(placeholder, select.firstChild);
    select.value = '';
  }
}

function renderReason(text, suggestion) {
  const node = el('reason');
  node.textContent = suggestion ? text : 'No folder matched confidently — pick one below.';
  node.classList.toggle('is-empty', !text && !!suggestion);
}

function onFolderChange() {
  const isNew = el('folderSelect').value === NEW_FOLDER_VALUE;
  el('newFolderInput').classList.toggle('hidden', !isNew);
  if (isNew) el('newFolderInput').focus();
}

/** The folder the user has actually chosen, or null if incomplete. */
function chosenFolder() {
  const value = el('folderSelect').value;
  if (value === NEW_FOLDER_VALUE) return el('newFolderInput').value.trim() || null;
  return value || null;
}

// ---------------------------------------------------------------- actions

async function clip() {
  const folder = chosenFolder();
  if (!folder) {
    el('folderSelect').focus();
    renderReason('Pick a folder first.', true);
    return;
  }

  const button = el('clipBtn');
  button.disabled = true;
  button.textContent = 'Saving…';

  try {
    const result = await helperFetch('/clip', {
      method: 'POST',
      body: JSON.stringify({
        folder,
        title: el('titleInput').value.trim() || page.title,
        source: page.source,
        authors: page.authors,
        translator: page.translator,
        published: page.published,
        description: page.description,
        markdown: page.markdown,
        queueForIngest: true,
        runIngest: autoIngestAvailable && el('queueCheckbox').checked,
      }),
    });

    el('savedPath').textContent = result.path;

    const notes = [];
    if (result.newFolder) notes.push(`Created the folder "${result.folder}".`);
    if (result.ingestStarted) {
      notes.push('Ingesting into the wiki now.');
    } else if (result.ingestError) {
      notes.push(result.ingestError);
    } else if (result.queued) {
      notes.push(`${result.pendingIngest} clip${result.pendingIngest === 1 ? '' : 's'} waiting in the inbox.`);
    }
    el('savedNote').textContent = notes.join(' ');

    show('done');
    setTimeout(() => window.close(), 1800);
  } catch (err) {
    button.disabled = false;
    button.textContent = 'Clip it';
    showError(err.message);
  }
}

// ---------------------------------------------------------------- startup

async function start() {
  show('loading');

  try {
    await helperFetch('/health');
  } catch {
    show('offline');
    return;
  }

  try {
    page = await readPage();
  } catch (err) {
    showError(err.message);
    return;
  }

  let suggestion;
  try {
    suggestion = await helperFetch('/suggest', {
      method: 'POST',
      body: JSON.stringify({
        url: page.source,
        title: page.title,
        authors: page.authors,
        text: page.text,
      }),
    });
  } catch (err) {
    showError(err.message);
    return;
  }

  el('titleInput').value = page.title;
  renderFolders(suggestion.folders, suggestion.suggestion);
  renderReason(suggestion.reason, suggestion.suggestion);

  // In "auto" mode the checkbox offers to run the ingest right away;
  // otherwise the clip is simply queued and the checkbox is not needed.
  autoIngestAvailable = suggestion.ingestMode === 'auto' && suggestion.ingestReady;
  el('queueLabel').textContent = autoIngestAvailable
    ? 'Ingest into the wiki now'
    : 'Add to the ingest inbox';
  el('queueCheckbox').checked = true;
  el('queueCheckbox').disabled = !autoIngestAvailable;

  el('selectionBadge').classList.toggle('hidden', !page.isSelection);
  el('privateWarning').classList.toggle('hidden', !page.isPrivateUrl);
  el('wordCount').textContent = `${page.wordCount.toLocaleString()} words`;
  el('pendingCount').textContent = suggestion.pendingIngest
    ? `${suggestion.pendingIngest} waiting to ingest`
    : '';

  show('form');
  el('clipBtn').focus();
}

el('folderSelect').addEventListener('change', onFolderChange);
el('clipBtn').addEventListener('click', clip);
el('retryBtn').addEventListener('click', start);
el('errorRetryBtn').addEventListener('click', start);

// Enter saves from anywhere in the form.
document.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !views.form.classList.contains('hidden')) {
    event.preventDefault();
    clip();
  }
});

start();
