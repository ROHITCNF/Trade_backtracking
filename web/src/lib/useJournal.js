// Keeps the Journal current (decisions D16–D18): loads lists and runs, queues
// a Journal run for every list that needs one (Fyers connected, not paused),
// deletes runs a newer one has replaced, and polls while any is active. The
// rules are in journal.js; this file only talks to the API.

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { useMe } from './me.jsx';
import { allRuns, configBody, defaultStrategy } from './research.js';
import { dayPnl, journalFrom, journalName, journalState, journalTo, supersededRuns } from './journal.js';

const POLL_MS = 4000;

// Once per page load: StrictMode runs effects twice, and a reload must not
// queue the same run again while the first POST is still in flight.
const requested = new Set();
const deleted = new Set();
const analyses = new Map(); // run id -> full-window analysis (finished runs never change)

async function queueRun(list, to, config) {
  return api('/api/runs', {
    method: 'POST',
    body: { name: journalName(list.id), watchlistId: list.id, fromDate: journalFrom(to), toDate: to, config: configBody(config) },
  });
}

export function useJournal() {
  const { me, refresh } = useMe();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [queueError, setQueueError] = useState(null);
  const loading = useRef(false);

  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const [{ watchlists }, { items }, defaults] = await Promise.all([api('/api/watchlists'), api('/api/runs?limit=500'), api('/api/defaults')]);
      const strategy = defaultStrategy(items, defaults.config);
      const to = journalTo();
      const state = journalState(watchlists, allRuns(items), strategy, to);
      await Promise.all(
        state.filter((s) => s.done && !analyses.has(s.done.id)).map(async (s) => analyses.set(s.done.id, await api(`/api/runs/${s.done.id}/analysis`)))
      );
      const rows = state.map((s) => ({ list: s.list, days: s.done ? dayPnl(analyses.get(s.done.id).metrics.curve) : new Map() }));
      setData({ lists: watchlists, strategy, to, state, rows, analysisOf: (runId) => analyses.get(runId) });
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      loading.current = false;
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Queue what's missing, then tidy up what a newer run has replaced.
  const canQueue = Boolean(me?.fyers.connected && !me.budget.paused);
  useEffect(() => {
    if (!data || !canQueue) return;
    const due = data.state.filter((s) => s.needsRun && !requested.has(`${s.list.id}|${data.to}|${JSON.stringify(data.strategy)}|${s.list.count}`));
    if (!due.length) return;
    (async () => {
      for (const s of due) {
        requested.add(`${s.list.id}|${data.to}|${JSON.stringify(data.strategy)}|${s.list.count}`);
        try {
          await queueRun(s.list, data.to, data.strategy);
        } catch (err) {
          setQueueError(`Couldn’t update ${s.list.name}: ${err.message}`);
          break;
        }
      }
      refresh();
      load();
    })();
  }, [data, canQueue, load, refresh]);

  useEffect(() => {
    if (!data) return;
    const ids = supersededRuns(data.state).filter((id) => !deleted.has(id));
    if (!ids.length) return;
    ids.forEach((id) => deleted.add(id));
    Promise.all(ids.map((id) => api(`/api/runs/${id}`, { method: 'DELETE' }).catch(() => {})));
  }, [data]);

  const active = data?.state.some((s) => s.active);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [active, load]);

  // A new default strategy (D18): queue every list on it; the newest Journal
  // run's settings are the default from then on.
  const applyStrategy = useCallback(async (config) => {
    setQueueError(null);
    const to = journalTo();
    for (const s of data.state.filter((x) => x.list.count > 0)) {
      requested.add(`${s.list.id}|${to}|${JSON.stringify(config)}|${s.list.count}`);
      await queueRun(s.list, to, config);
    }
    refresh();
    await load();
  }, [data, load, refresh]);

  const retry = useCallback(async (runId) => {
    setQueueError(null);
    try {
      await api(`/api/runs/${runId}`, { method: 'PATCH', body: { resume: true } });
    } catch (err) {
      setQueueError(err.message);
    }
    refresh();
    await load();
  }, [load, refresh]);

  return { data, error, queueError, canQueue, reload: load, applyStrategy, retry };
}
