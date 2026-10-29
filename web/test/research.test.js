import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cardTitle, configBody, defaultStrategy, isJournalRun, progressFacts, researchDraft, researchRuns, sameStrategy, weekdaysBetween,
} from '../src/lib/research.js';

const config = { direction: 'both', orbStart: '09:15', orbEnd: '09:30', sessionEnd: '15:14', slMode: 'tighter', slPct: 1, targetMode: 'pct', targetR: 1, targetPct: 1.5, sizing: 'entryPrice', capitalPerTrade: 10000, leverage: 5, quantity: 1, costBps: 0, resolution: '1' };
const run = (over) => ({ id: 1, name: null, status: 'done', config, fromDate: '2026-04-28', toDate: '2026-10-28', watchlistName: 'core', total: 39, done: 39, callsUsed: 156, ...over });
const items = [
  { type: 'run', run: run({ id: 5, name: 'Journal · 1', config: { ...config, targetPct: 2 } }) },
  { type: 'run', run: run({ id: 4 }) },
  { type: 'sweep', sweepId: 2, runs: [run({ id: 2, name: '1R' }), run({ id: 3, name: '2R' })] },
  { type: 'run', run: run({ id: 1, name: 'Journal · 2' }) },
];

test('journal runs are told apart by name', () => {
  assert.equal(isJournalRun(run({ name: 'Journal · 3' })), true);
  assert.equal(isJournalRun(run({ name: 'Journal notes' })), false);
  assert.equal(isJournalRun(run()), false);
});

test('research cards skip journal runs and sweeps', () => {
  assert.deepEqual(researchRuns(items).map((r) => r.id), [4]);
});

test('default strategy is the newest journal run, else the fallback', () => {
  assert.equal(defaultStrategy(items, config).targetPct, 2);
  assert.equal(defaultStrategy(items, config).resolution, undefined);
  assert.equal(defaultStrategy([items[1]], config).targetPct, 1.5);
});

test('strategy comparison ignores text vs number', () => {
  assert.equal(sameStrategy(config, { ...config, slPct: '1', targetPct: '1.5' }), true);
  assert.equal(sameStrategy(config, { ...config, slMode: 'pct' }), false);
});

test('card titles: name, else list', () => {
  assert.equal(cardTitle(run({ name: 'SBIN', watchlistName: null })), 'SBIN');
  assert.equal(cardTitle(run()), 'core');
});

test('weekdays in a range', () => {
  assert.equal(weekdaysBetween('2026-10-26', '2026-11-01'), 5); // Mon → Sun
  assert.equal(weekdaysBetween('2026-10-31', '2026-10-31'), 0); // Sat
});

test('launcher draft: whole list, subset, single symbol', () => {
  const list = { id: 2, name: 'final', count: 18 };
  const base = { fromDate: '2026-07-28', toDate: '2026-10-28', config: { ...config, slPct: '0.8' } };
  assert.deepEqual(researchDraft({ ...base, mode: 'watchlist', list, subset: null }), { fromDate: '2026-07-28', toDate: '2026-10-28', config: configBody(base.config), watchlistId: 2 });
  assert.equal(researchDraft({ ...base, mode: 'watchlist', list, subset: null }).config.slPct, 0.8);
  const subset = ['NSE:A-EQ', 'NSE:B-EQ'];
  assert.deepEqual(researchDraft({ ...base, mode: 'watchlist', list, subset }).name, 'final (2 of 18)');
  assert.deepEqual(researchDraft({ ...base, mode: 'watchlist', list, subset }).symbols, subset);
  assert.equal(researchDraft({ ...base, mode: 'watchlist', list, subset: [] }), null);
  assert.deepEqual(researchDraft({ ...base, mode: 'symbol', symbol: { symbol: 'NSE:SBIN-EQ', ticker: 'SBIN' } }).symbols, ['NSE:SBIN-EQ']);
  assert.equal(researchDraft({ ...base, mode: 'symbol', symbol: { symbol: 'NSE:SBIN-EQ', ticker: 'SBIN' } }).name, 'SBIN');
  assert.equal(researchDraft({ ...base, mode: 'symbol', symbol: null }), null);
});

test('progress and ETA from planned calls', () => {
  // 39 symbols × 4 chunks = 156 planned calls; 60 spent leaves 96 ≈ 125 s.
  assert.deepEqual(progressFacts(run({ status: 'running', done: 15, callsUsed: 60 })), { pct: 38, remainingCalls: 96, etaSeconds: 125 });
});
