// Reading a .txt watchlist import (FR-34, D3): split, normalise, and classify
// each entry against the symbol master. Pure; nothing is written here.

const MAX_LINES = 500;

// Entries with the line they came from. Accepts one per line or comma-separated;
// blank lines and '#' comments are ignored.
function parseImport(text) {
  const lines = String(text).split(/\r?\n/);
  if (lines.length > MAX_LINES) throw Object.assign(new Error(`At most ${MAX_LINES} lines per file.`), { tooLong: true });
  const entries = [];
  lines.forEach((raw, i) => {
    const content = raw.replace(/#.*/, '');
    for (const part of content.split(',')) {
      const text = part.trim();
      if (text) entries.push({ line: i + 1, text });
    }
  });
  return entries;
}

// classify(text) -> { kind: 'equity'|'index'|null, symbol, name } (api/symbols.js).
// existing: the symbols already in the watchlist.
function previewImport(text, { classify, existing = [] }) {
  const have = new Set(existing);
  const seen = new Set();
  const add = [];
  const already = [];
  const skipped = [];
  for (const { line, text: entry } of parseImport(text)) {
    const hit = classify(entry);
    if (hit.kind === 'index') skipped.push({ line, text: entry, reason: 'index' });
    else if (hit.kind !== 'equity') skipped.push({ line, text: entry, reason: 'not_found' });
    else if (seen.has(hit.symbol)) continue; // repeated in the file
    else {
      seen.add(hit.symbol);
      if (have.has(hit.symbol)) already.push(hit.symbol);
      else add.push({ symbol: hit.symbol, name: hit.name });
    }
  }
  return { add, already, skipped, counts: { add: add.length, already: already.length, skipped: skipped.length } };
}

module.exports = { parseImport, previewImport, MAX_LINES };
