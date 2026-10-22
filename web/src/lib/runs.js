// How a run is named and described across screens: "core · 1 year · TGT 1.5R",
// "Both · SL tighter 1% · TGT 1.5R".

import { daysBetween } from './dates.js';

const DIRECTION = { long: 'Long', short: 'Short', both: 'Both' };

export const stopLabel = (c) => `SL ${c.slMode === 'range' ? 'range' : `${c.slMode} ${c.slPct}%`}`;
export const targetLabel = (c) => (c.targetMode === 'none' ? 'no target' : c.targetMode === 'R' ? `TGT ${c.targetR}R` : `TGT ${c.targetPct}%`);
export const settingsLabel = (c) => `${DIRECTION[c.direction]} · ${stopLabel(c)} · ${targetLabel(c)}`;

// '2025-10-23' → '2026-10-21' reads as '1 year'; shorter spans in months or days.
export function durationLabel(from, to) {
  const days = daysBetween(from, to);
  if (days >= 350) return days <= 380 ? '1 year' : `${Math.round(days / 365)} years`;
  if (days >= 28) {
    const m = Math.round(days / 30.4);
    return `${m} month${m === 1 ? '' : 's'}`;
  }
  return `${days} day${days === 1 ? '' : 's'}`;
}

// The run's own name, or one made from what it ran.
export function runTitle(run) {
  if (run.name) return run.name;
  const what = run.watchlistName ? `${run.watchlistName} ${run.total}` : `${run.total} symbol${run.total === 1 ? '' : 's'}`;
  return `${what} · ${durationLabel(run.fromDate, run.toDate)} · ${targetLabel(run.config)}`;
}

// A sweep's name: what the owner called it (its runs are named "<name> · <rule>";
// an unnamed sweep's runs are just "<rule>"), else what it ran.
export function sweepTitle(run) {
  if (run.name?.includes(' · ')) return run.name.split(' · ').slice(0, -1).join(' · ');
  const what = run.watchlistName ? `${run.watchlistName} ${run.total}` : `${run.total} symbols`;
  return `${what} · ${durationLabel(run.fromDate, run.toDate)} · sweep`;
}

// Planned Fyers calls for a run: one per symbol per 60-day chunk (api/runSpec.js).
export const plannedCalls = (run) => run.total * Math.max(1, Math.ceil(daysBetween(run.fromDate, run.toDate) / 60));

export const isActive = (status) => status === 'queued' || status === 'running';
