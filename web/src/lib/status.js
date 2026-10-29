// The header's one status chip (v2): a verdict word plus the three facts it is
// made of. Routine states stay grey (Fyers disconnected every morning); only
// things that cost data turn amber or red, as the v1 pills did (States.png).

import { qty } from './format.js';

export function budgetLevel({ used, cap, paused }) {
  if (paused || used >= cap) return 'red';
  return used / cap >= 0.8 ? 'amber' : 'grey';
}

// me: the /api/me response (or null while loading); market: marketStatus().
// level: 'ok' | 'idle' | 'warn' | 'error'.
export function statusSummary(me, market) {
  const parts = [market.open ? 'NSE open' : 'NSE closed'];
  if (!me) return { level: 'idle', title: 'Checking…', parts };
  const { fyers, budget } = me;
  parts.unshift(fyers.connected ? 'Fyers on' : 'Fyers off');
  parts.push(`API ${qty(budget.used)} / ${qty(budget.cap)}`);

  if (budget.paused) return { level: 'error', title: 'Paused', parts };
  if (budget.used >= budget.cap) return { level: 'error', title: 'Budget used', parts };
  if (!fyers.connected) return { level: 'idle', title: 'Connect Fyers', parts };
  if (budgetLevel(budget) === 'amber') return { level: 'warn', title: 'Budget low', parts };
  return { level: 'ok', title: 'All good', parts };
}
