// Add or edit a Journal list (v2/Journal: "+ Add list — search symbols or
// import a .txt", "click a list name to edit it"). A side sheet on desktop,
// full screen on a phone. listId is a watchlist id, or 'new' to create one.
// onClose(changedId) reports which list changed, so its Journal run is redone.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import SymbolSearch from './SymbolSearch.jsx';
import ImportPreview from './ImportPreview.jsx';
import Icon from './Icon.jsx';

const short = (s) => s.replace(/^NSE:|-EQ$/g, '');

function NewList({ onCreated }) {
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { watchlist } = await api('/api/watchlists', { method: 'POST', body: { name: name.trim() } });
      onCreated(watchlist.id);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }
  return (
    <form className="stack" onSubmit={submit}>
      <label className="field"><span className="label">Name</span>
        <input className="input input-lg" autoFocus maxLength={80} placeholder="e.g. banks, momentum, my picks" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      {error && <span className="loss">{error}</span>}
      <button className="btn btn-primary btn-lg" disabled={!name.trim() || busy}>Create list</button>
      <span className="caption">Then add symbols by search or import a .txt. The Journal starts tracking it on the next update.</span>
    </form>
  );
}

export default function ListSheet({ listId, onClose, onDeleted }) {
  const [id, setId] = useState(listId === 'new' ? null : Number(listId));
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [q, setQ] = useState('');
  const changed = useRef(false);
  const fileInput = useRef(null);

  const load = useCallback(() => {
    if (!id) return;
    api(`/api/watchlists/${id}`).then(setDetail, (err) => setError(err.message));
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  const close = useCallback(() => onClose(changed.current ? id : null), [onClose, id]);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !importing && close();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close, importing]);

  const act = async (fn) => {
    setError(null);
    try {
      await fn();
      changed.current = true;
    } catch (err) {
      setError(err.message);
    }
    load();
  };

  async function onFile(e) {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    setError(null);
    try {
      const text = await f.text();
      const preview = await api(`/api/watchlists/${id}/import/preview`, { method: 'POST', body: { fileName: f.name, text } });
      setImporting({ file: { name: f.name, lines: text.split(/\r?\n/).filter((l) => l.trim()).length }, preview });
    } catch (err) {
      setError(err.message);
    }
  }

  async function exportTxt() {
    const res = await api(`/api/watchlists/${id}/export`, { raw: true });
    const url = URL.createObjectURL(await res.blob());
    Object.assign(document.createElement('a'), { href: url, download: `${detail.watchlist.name.replace(/[^A-Za-z0-9_-]+/g, '_')}.txt` }).click();
    URL.revokeObjectURL(url);
  }

  async function remove() {
    try {
      await api(`/api/watchlists/${id}`, { method: 'DELETE' });
      onDeleted(id);
    } catch (err) {
      setError(err.message);
    }
  }

  const w = detail?.watchlist;
  const needle = q.trim().toUpperCase();
  const symbols = detail ? detail.symbols.filter((s) => !needle || short(s.symbol).includes(needle)) : [];

  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <aside className="sheet" role="dialog" aria-modal="true" aria-label={w ? `Edit ${w.name}` : 'New list'}>
        <div className="sheet-head">
          {w && !w.readOnly ? (
            <input className="input sheet-name" defaultValue={w.name} maxLength={80} key={w.name} aria-label="List name"
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== w.name) act(() => api(`/api/watchlists/${id}`, { method: 'PATCH', body: { name: v } })); }}
              onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
          ) : (
            <h2 className="title">{w ? w.name : 'New list'}</h2>
          )}
          <span className="spacer" />
          <button className="btn btn-ghost icon-btn" aria-label="Close" onClick={close}><Icon name="close" /></button>
        </div>

        <div className="sheet-body">
          {error && <div className="banner banner-error">{error}</div>}
          {!id ? (
            <NewList onCreated={(newId) => { changed.current = true; setId(newId); }} />
          ) : !w ? (
            <p className="placeholder">Loading…</p>
          ) : (
            <>
              <span className="caption">
                {w.count} symbols{w.source === 'import' && w.sourceFile ? ` · imported from ${w.sourceFile}` : ''}
                {w.readOnly && ' · read-only — import a .txt into a new list to change it'}
              </span>
              {!w.readOnly && (
                <SymbolSearch placeholder="Add a symbol — ticker or company" exclude={detail.symbols.map((s) => s.symbol)}
                  onPick={(r) => act(() => api(`/api/watchlists/${id}/symbols`, { method: 'POST', body: { symbol: r.symbol } }))} />
              )}
              <button className="drop-zone" onClick={() => fileInput.current.click()}>
                <Icon name="upload" size={18} />
                <span>
                  <b className="accent-link">Import .txt</b>
                  <span className="cell-sub">one per line or comma-separated · PAYTM or NSE:PAYTM-EQ · up to 500 lines</span>
                </span>
              </button>
              <input ref={fileInput} type="file" accept=".txt,text/plain" hidden onChange={onFile} />

              {importing && (
                <ImportPreview list={w} file={importing.file} preview={importing.preview} onCancel={() => setImporting(null)}
                  onDone={(targetId) => { setImporting(null); changed.current = true; if (targetId !== id) setId(targetId); else load(); }} />
              )}

              <div className="row">
                <h3 className="section spacer">{w.count} symbols</h3>
                {detail.symbols.length > 12 && <input className="input" style={{ width: 140 }} placeholder="Filter" value={q} onChange={(e) => setQ(e.target.value)} />}
              </div>
              {detail.symbols.length === 0 ? (
                <p className="caption">No symbols yet — add one above or import a .txt.</p>
              ) : (
                <div className="chips sheet-chips">
                  {symbols.map((s) => (
                    <span className="chip" key={s.symbol} title={s.name || undefined}>
                      {short(s.symbol)}
                      {!w.readOnly && (
                        <button type="button" aria-label={`Remove ${short(s.symbol)}`}
                          onClick={() => act(() => api(`/api/watchlists/${id}/symbols/${encodeURIComponent(s.symbol)}`, { method: 'DELETE' }))}>
                          <Icon name="close" size={12} />
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {w && (
          <div className="sheet-foot">
            {confirmDelete ? (
              <>
                <span className="spacer">Delete “{w.name}” and its Journal history? Research runs keep their own copy.</span>
                <button className="btn" onClick={() => setConfirmDelete(false)}>Keep</button>
                <button className="btn btn-danger" onClick={remove}>Delete</button>
              </>
            ) : (
              <>
                <button className="btn" onClick={exportTxt}>Export .txt</button>
                {!w.readOnly && <button className="btn danger-outline" onClick={() => setConfirmDelete(true)}>Delete list</button>}
                <span className="spacer" />
                <button className="btn btn-primary" onClick={close}>Done</button>
              </>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
