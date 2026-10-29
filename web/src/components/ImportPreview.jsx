// The .txt import preview (F11; D3): what will be added, what's already there,
// what isn't recognised, and the add / replace / new-list choice. Nothing is
// written until the owner confirms.

import { useState } from 'react';
import { api } from '../lib/api.js';
import Segmented from './Segmented.jsx';
import Icon from './Icon.jsx';

const short = (s) => s.replace(/^NSE:|-EQ$/g, '');
const SKIP_REASON = { index: 'index, not a stock', not_found: 'not recognised in the NSE symbol master' };

export default function ImportPreview({ list, file, preview, onDone, onCancel }) {
  const [mode, setMode] = useState(list.readOnly ? 'new' : 'add');
  const [name, setName] = useState(file.name.replace(/\.txt$/i, ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const incoming = [...preview.add.map((a) => a.symbol), ...preview.already];
  const symbols = mode === 'add' ? preview.add.map((a) => a.symbol) : incoming;
  const verb = mode === 'add' ? `Add ${symbols.length} symbol${symbols.length === 1 ? '' : 's'}` : mode === 'replace' ? `Replace with ${symbols.length}` : `Create list with ${symbols.length}`;

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const { watchlist } = await api(`/api/watchlists/${list.id}/import`, {
        method: 'POST',
        body: { mode, symbols, fileName: file.name, ...(mode === 'new' ? { name: name.trim() } : {}) },
      });
      onDone(watchlist.id);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <section className="card import-card">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="spacer">
          <span className="section">Import <code className="file-name">{file.name}</code></span>
          <span className="cell-sub">{file.lines} lines read · symbols checked against the NSE equity list</span>
        </div>
        <button className="btn btn-ghost icon-btn" aria-label="Cancel import" onClick={onCancel}><Icon name="close" /></button>
      </div>
      <div className="import-counts">
        <div><span className="label">Will be added</span><span className="stat">{preview.counts.add}</span></div>
        <div><span className="label">Already in list</span><span className="stat">{preview.counts.already}</span></div>
        <div className={preview.counts.skipped ? 'warned' : ''}><span className="label">Not recognised</span><span className="stat">{preview.counts.skipped}</span></div>
      </div>
      {incoming.length > 0 && (
        <div className="chips">
          {preview.add.map((a) => <span key={a.symbol} className="chip chip-add" title={a.name}>{short(a.symbol)}</span>)}
          {preview.already.map((s) => <span key={s} className="chip chip-already" title="Already in this list">{short(s)}</span>)}
        </div>
      )}
      {preview.skipped.length > 0 && (
        <div className="banner">
          <b className="warn">These lines will be skipped</b>
          {preview.skipped.map((s, i) => (
            <div key={i} className="caption" style={{ color: 'var(--ink-2)' }}>line {s.line} · <code><b>{s.text}</b></code> — {SKIP_REASON[s.reason] || s.reason}</div>
          ))}
        </div>
      )}
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <Segmented value={mode} onChange={setMode} label="Import mode"
          options={list.readOnly ? [['new', 'New watchlist']] : [['add', 'Add to this list'], ['replace', 'Replace list'], ['new', 'New watchlist']]} />
        {mode === 'new' && <input className="input" style={{ width: 220 }} placeholder="New list name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />}
        <span className="spacer" />
        {error && <span className="loss">{error}</span>}
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" disabled={busy || symbols.length === 0 || (mode === 'new' && !name.trim())} onClick={apply}>{verb}</button>
      </div>
      {mode === 'replace' && <span className="caption">Replace keeps only the {incoming.length} recognised symbols in this file; the others are removed from the list. Past runs keep their own snapshot.</span>}
    </section>
  );
}
