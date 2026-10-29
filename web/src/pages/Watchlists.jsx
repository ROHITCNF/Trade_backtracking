// Watchlists (F10, F11; Watchlists + .txt import.png). Lists on the left; the
// selected list's symbols with their latest-run stats on the right. Symbols are
// added through search or a .txt import that previews before writing anything
// (D3: no rename hints — an unknown ticker is just "not recognised").

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { pnl, qty, rate, tone } from '../lib/format.js';
import SymbolSearch from '../components/SymbolSearch.jsx';
import Icon from '../components/Icon.jsx';
import ImportPreview from '../components/ImportPreview.jsx';

const short = (s) => s.replace(/^NSE:|-EQ$/g, '');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (iso) => { const d = new Date(new Date(iso).getTime() + 19800000); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };

const sourceLabel = (w) => (w.readOnly ? 'read-only · seeded' : w.source === 'import' ? 'imported .txt' : w.source === 'seed' ? 'seeded' : 'custom');

function NewListForm({ onCreated, onCancel }) {
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  async function submit(e) {
    e.preventDefault();
    try {
      const { watchlist } = await api('/api/watchlists', { method: 'POST', body: { name } });
      onCreated(watchlist.id);
    } catch (err) {
      setError(err.message);
    }
  }
  return (
    <form className="card stack" style={{ gap: 'var(--s-2)' }} onSubmit={submit}>
      <input className="input" autoFocus placeholder="Watchlist name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      {error && <span className="loss caption">{error}</span>}
      <div className="row">
        <button className="btn btn-primary" disabled={!name.trim()}>Create</button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export default function Watchlists() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [lists, setLists] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(null); // { file: {name, lines}, preview }
  const [renaming, setRenaming] = useState(false);
  const fileInput = useRef(null);

  const loadLists = useCallback(() => api('/api/watchlists').then(({ watchlists }) => setLists(watchlists), (err) => setError(err.message)), []);
  useEffect(() => {
    loadLists();
  }, [loadLists]);

  const selectedId = Number(id) || lists?.[0]?.id;
  const loadDetail = useCallback(() => {
    if (!selectedId) return;
    api(`/api/watchlists/${selectedId}`).then(setDetail, (err) => setError(err.message));
  }, [selectedId]);
  useEffect(() => {
    setDetail(null);
    setImporting(null);
    setRenaming(false);
    loadDetail();
  }, [loadDetail]);

  const refresh = () => {
    loadLists();
    loadDetail();
  };
  const act = async (fn) => {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    }
    refresh();
  };

  async function onFile(e) {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    setError(null);
    try {
      const text = await f.text();
      const preview = await api(`/api/watchlists/${selectedId}/import/preview`, { method: 'POST', body: { fileName: f.name, text } });
      setImporting({ file: { name: f.name, lines: text.split(/\r?\n/).filter((l) => l.trim()).length }, preview });
    } catch (err) {
      setError(err.message);
    }
  }

  async function exportTxt() {
    const res = await api(`/api/watchlists/${selectedId}/export`, { raw: true });
    const url = URL.createObjectURL(await res.blob());
    Object.assign(document.createElement('a'), { href: url, download: `${detail.watchlist.name.replace(/[^A-Za-z0-9_-]+/g, '_')}.txt` }).click();
    URL.revokeObjectURL(url);
  }

  if (!lists) return error ? <div className="banner banner-error">{error}</div> : <p className="placeholder">Loading…</p>;
  const w = detail?.watchlist;

  return (
    <div className="stack">
      <div>
        <h1 className="display">Watchlists</h1>
        <p className="caption" style={{ fontSize: 13.5, margin: '4px 0 0' }}>Symbol lists you backtest against. Add symbols one by one or import a .txt file.</p>
      </div>
      <div className="wl-layout">
        <aside className="stack" style={{ gap: 'var(--s-2)' }}>
          <div className="row">
            <h2 className="section spacer">Watchlists</h2>
            <button className="link-btn accent" onClick={() => setCreating(true)}>+ New</button>
          </div>
          {creating && <NewListForm onCancel={() => setCreating(false)} onCreated={(newId) => { setCreating(false); loadLists(); navigate(`/watchlists/${newId}`); }} />}
          <nav className="card wl-list">
            {lists.map((l) => (
              <Link key={l.id} to={`/watchlists/${l.id}`} className={`wl-item${l.id === selectedId ? ' on' : ''}`}>
                <span><b>{l.name}</b><span className="cell-sub">{sourceLabel(l)}</span></span>
                <span>{l.count}</span>
              </Link>
            ))}
          </nav>
          <p className="caption">Watchlists show up as symbol sources in <Link to="/new">New backtest</Link>.</p>
        </aside>

        <div className="stack" style={{ minWidth: 0 }}>
          {error && <div className="banner banner-error">{error}</div>}
          {!w ? (
            <p className="placeholder">Loading…</p>
          ) : (
            <>
              <section className="card stack" style={{ padding: 'var(--s-4)' }}>
                <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div className="spacer">
                    {renaming ? (
                      <input className="input" autoFocus defaultValue={w.name} maxLength={80}
                        onBlur={(e) => { setRenaming(false); if (e.target.value.trim() && e.target.value.trim() !== w.name) act(() => api(`/api/watchlists/${w.id}`, { method: 'PATCH', body: { name: e.target.value.trim() } })); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setRenaming(false); }} />
                    ) : (
                      <div className="row">
                        <h2 className="title" style={{ fontSize: 20 }}>{w.name}</h2>
                        {!w.readOnly && <button className="link-btn" onClick={() => setRenaming(true)}>Rename</button>}
                      </div>
                    )}
                    <span className="caption" style={{ fontSize: 13 }}>
                      {w.count} symbols{w.sourceFile && w.source === 'import' ? ` · Imported from ${w.sourceFile}` : ''} · updated {day(w.updatedAt)}
                      {w.readOnly && ' · read-only — import into a new watchlist to change it'}
                    </span>
                  </div>
                  <Link className="btn btn-primary" to={`/new?watchlist=${w.id}`}>Backtest this list</Link>
                  <button className="btn" onClick={exportTxt}>Export .txt</button>
                  {!w.readOnly && (
                    <button className="btn danger-outline" onClick={() => {
                      if (window.confirm(`Delete “${w.name}”? Past runs keep their own symbol snapshot.`)) act(async () => { await api(`/api/watchlists/${w.id}`, { method: 'DELETE' }); navigate('/watchlists', { replace: true }); });
                    }}>Delete</button>
                  )}
                </div>
                <div className="wl-tools">
                  {!w.readOnly ? (
                    <SymbolSearch placeholder="Add a symbol — ticker or company" exclude={detail.symbols.map((s) => s.symbol)}
                      onPick={(r) => act(() => api(`/api/watchlists/${w.id}/symbols`, { method: 'POST', body: { symbol: r.symbol } }))} />
                  ) : <span />}
                  <button className="drop-zone" onClick={() => fileInput.current.click()}>
                    <Icon name="upload" size={18} />
                    <span>
                      <b className="accent-link">Import .txt</b>
                      <span className="cell-sub">one per line or comma-separated · PAYTM or NSE:PAYTM-EQ · up to 500 lines</span>
                    </span>
                  </button>
                  <input ref={fileInput} type="file" accept=".txt,text/plain" hidden onChange={onFile} />
                </div>
              </section>

              {importing && (
                <ImportPreview list={w} file={importing.file} preview={importing.preview} onCancel={() => setImporting(null)}
                  onDone={(targetId) => { setImporting(null); refresh(); if (targetId !== w.id) navigate(`/watchlists/${targetId}`); }} />
              )}

              <section className="card" style={{ padding: 0 }}>
                <div className="row" style={{ padding: 'var(--s-3) var(--s-4)' }}>
                  <h2 className="section">{w.count} symbols</h2><span className="caption">results from the latest run where available</span>
                </div>
                {detail.symbols.length === 0 ? (
                  <p className="caption" style={{ padding: '0 var(--s-4) var(--s-4)' }}>No symbols yet — add one above or import a .txt file.</p>
                ) : (
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr><th>Symbol</th><th>Company</th><th className="num">Trades</th><th className="num">Win %</th><th className="num">P&amp;L · latest run</th><th>Added</th><th /></tr>
                      </thead>
                      <tbody>
                        {detail.symbols.map((s) => (
                          <tr key={s.symbol}>
                            <td><b>{short(s.symbol)}</b></td>
                            <td>{s.name || <span className="caption">—</span>}</td>
                            <td className="num">{s.latest ? qty(s.latest.trades) : '—'}</td>
                            <td className="num">{s.latest ? rate(s.latest.winRate) : '—'}</td>
                            <td className={`num ${s.latest ? tone(s.latest.totalPnl) : ''}`}>
                              {s.latest ? <Link className={tone(s.latest.totalPnl)} to={`/runs/${s.latest.runId}/symbols/${encodeURIComponent(s.symbol)}`}>{pnl(s.latest.totalPnl)}</Link> : <span className="caption">not in run</span>}
                            </td>
                            <td className="caption">{day(s.addedAt)}</td>
                            <td className="num">
                              {!w.readOnly && <button className="link-btn" onClick={() => act(() => api(`/api/watchlists/${w.id}/symbols/${encodeURIComponent(s.symbol)}`, { method: 'DELETE' }))}>Remove</button>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
