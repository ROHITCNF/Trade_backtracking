// After the Fyers OAuth round trip the API redirects to /?fyers=connected or
// ?fyers=error (F3). Reads the flag once, refreshes the status pills, then drops
// it from the URL so a reload doesn't repeat it. Only a failure gets a toast;
// success shows in the header pill.

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMe } from '../lib/me.jsx';

const MESSAGES = {
  error: ['error', 'Fyers connection didn’t complete. Try Connect Fyers again.'],
};

export default function Toast() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { refresh } = useMe();
  const [toast, setToast] = useState(null);

  useEffect(() => {
    const flag = params.get('fyers');
    if (!flag) return;
    refresh();
    params.delete('fyers');
    navigate({ search: params.toString() }, { replace: true });
    if (!MESSAGES[flag]) return;
    setToast(MESSAGES[flag]);
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [params, navigate, refresh]);

  if (!toast) return null;
  return (
    <div className={`toast toast-${toast[0]}`} role="status" onClick={() => setToast(null)}>
      {toast[1]}
    </div>
  );
}
