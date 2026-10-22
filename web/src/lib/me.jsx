// Session, Fyers and budget state from GET /api/me (FR-7, FR-8), shared by
// the header, the banners and any screen that must know whether it can start
// a run or load a chart. Polled every 60 s, database reads only (NFR-6).

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

const POLL_MS = 60000;
const MeContext = createContext({ me: null, refresh: () => {} });

export function MeProvider({ children }) {
  const [me, setMe] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setMe(await api('/api/me'));
    } catch {
      // A 401 is handled by the api client; anything else keeps the last state.
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  return <MeContext.Provider value={{ me, refresh }}>{children}</MeContext.Provider>;
}

export const useMe = () => useContext(MeContext);

// Sends the browser to Fyers' login; Fyers redirects back via the API callback.
export async function connectFyers() {
  const { url } = await api('/api/fyers/connect');
  window.location.assign(url);
}
