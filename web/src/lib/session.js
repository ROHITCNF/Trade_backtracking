// The app session token (hld § Authentication). Kept in localStorage so a tab
// reopened within 7 days stays logged in; storage can be unavailable (private
// mode), so every access is guarded and the app still works for the tab.

const KEY = 'orb.session';
let memory = null;

export function readSession() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) memory = JSON.parse(raw);
  } catch {}
  return memory && memory.expiresAt > Date.now() ? memory : null;
}

export function saveSession(session) {
  memory = session;
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {}
}

export function clearSession() {
  memory = null;
  try {
    localStorage.removeItem(KEY);
  } catch {}
}
