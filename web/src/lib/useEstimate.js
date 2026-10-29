// Debounced POST /api/estimate whenever the draft changes (FR-12). A null
// draft (form not complete yet) prices nothing.

import { useEffect, useState } from 'react';
import { api } from './api.js';

export function useEstimate(draft, refreshKey) {
  const [state, setState] = useState({ loading: true });
  const key = JSON.stringify(draft);
  useEffect(() => {
    if (!draft) return setState({});
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    const t = setTimeout(async () => {
      try {
        const est = await api('/api/estimate', { method: 'POST', body: draft });
        if (!cancelled) setState({ est });
      } catch (err) {
        if (!cancelled) setState({ error: err.message });
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [key, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}
