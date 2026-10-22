// Slows password guessing (FR-4): after MAX_FAILURES failed logins from one IP
// within WINDOW_MS, that IP is refused until the oldest failure ages out. Kept
// in memory: one process, and a restart forgetting it costs an attacker only
// five more guesses.

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;

function createLoginLimiter({ now = Date.now } = {}) {
  const failures = new Map(); // ip -> failure times, oldest first

  function recent(ip) {
    const cutoff = now() - WINDOW_MS;
    const times = (failures.get(ip) || []).filter((t) => t > cutoff);
    if (times.length) failures.set(ip, times);
    else failures.delete(ip);
    return times;
  }

  return {
    // Milliseconds until this IP may try again; 0 if it may now.
    retryAfter(ip) {
      const times = recent(ip);
      return times.length < MAX_FAILURES ? 0 : times[times.length - MAX_FAILURES] + WINDOW_MS - now();
    },
    fail(ip) {
      failures.set(ip, [...recent(ip), now()]);
    },
    succeed(ip) {
      failures.delete(ip);
    },
  };
}

module.exports = { createLoginLimiter, MAX_FAILURES, WINDOW_MS };
