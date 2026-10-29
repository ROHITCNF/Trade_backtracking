import test from 'node:test';
import assert from 'node:assert/strict';
import { compactPnl, dayPnl, heatmap, journalFrom, journalListId, journalName, journalState, journalTo, supersededRuns } from '../src/lib/journal.js';

const ist = (s) => Date.parse(`${s}+05:30`);
const strategy = { direction: 'both', slMode: 'tighter', slPct: 1, targetMode: 'pct', targetPct: 1.5 };
const lists = [{ id: 1, name: 'core', count: 39 }, { id: 2, name: 'final', count: 18 }, { id: 4, name: 'empty', count: 0 }];
const run = (id, over) => ({ id, name: journalName(1), status: 'done', toDate: '2026-10-28', total: 39, config: { ...strategy }, ...over });

test('journal names carry the list id', () => {
  assert.equal(journalName(7), 'Journal · 7');
  assert.equal(journalListId({ name: 'Journal · 7' }), 7);
  assert.equal(journalListId({ name: 'core' }), null);
});

test('journal covers today from 15:45 IST on weekdays, else the weekday before', () => {
  assert.equal(journalTo(ist('2026-10-29T15:44:00')), '2026-10-28'); // Thu
  assert.equal(journalTo(ist('2026-10-29T15:45:00')), '2026-10-29');
  assert.equal(journalTo(ist('2026-10-31T11:00:00')), '2026-10-30'); // Sat → Fri
  assert.equal(journalTo(ist('2026-11-02T09:00:00')), '2026-10-30'); // Mon morning → Fri
  assert.equal(journalFrom('2026-10-28'), '2026-09-19'); // 40 days inclusive
});

test('a list is queued when missing, behind, re-strategised or resized', () => {
  const s = journalState(lists, [run(5)], strategy, '2026-10-28');
  assert.deepEqual(s.map((x) => x.stale), [[], ['never run'], ['never run']]);
  assert.deepEqual(s.map((x) => x.needsRun), [false, true, false]); // an empty list never runs
  assert.deepEqual(journalState(lists, [run(5)], strategy, '2026-10-29')[0].stale, ['behind']);
  assert.deepEqual(journalState(lists, [run(5)], { ...strategy, targetPct: 2 }, '2026-10-28')[0].stale, ['strategy']);
  assert.deepEqual(journalState([{ ...lists[0], count: 40 }], [run(5)], strategy, '2026-10-28')[0].stale, ['symbols']);
});

test('an active run is waited for, not duplicated', () => {
  const s = journalState(lists, [run(6, { status: 'running', toDate: '2026-10-29' }), run(5)], strategy, '2026-10-29')[0];
  assert.equal(s.active.id, 6);
  assert.equal(s.done.id, 5);
  assert.equal(s.needsRun, false);
});

test('a failed run for the same day is left for the owner to retry', () => {
  const s = journalState(lists, [run(6, { status: 'failed', toDate: '2026-10-29' }), run(5)], strategy, '2026-10-29')[0];
  assert.equal(s.failed.id, 6);
  assert.equal(s.needsRun, false);
  // A day later it is out of date again and a fresh run is queued.
  assert.equal(journalState(lists, [run(6, { status: 'failed', toDate: '2026-10-29' }), run(5)], strategy, '2026-10-30')[0].needsRun, true);
});

test('older journal runs go once a newer one is done; active ones stay', () => {
  const runs = [run(9, { status: 'queued' }), run(8), run(7, { status: 'failed' }), run(5), run(3, { name: journalName(2) })];
  assert.deepEqual(supersededRuns(journalState(lists, runs, strategy, '2026-10-28')), [7, 5]);
});

test('day P&L from the per-trade curve', () => {
  const curve = [{ date: '2026-10-27', equity: 100 }, { date: '2026-10-27', equity: 40 }, { date: '2026-10-28', equity: 140.5 }];
  assert.deepEqual([...dayPnl(curve)], [['2026-10-27', 40], ['2026-10-28', 100.5]]);
});

test('heatmap: last N dates across lists, shades scaled per row, row totals', () => {
  const a = new Map([['2026-10-26', 400], ['2026-10-27', -100], ['2026-10-28', 50]]);
  const b = new Map([['2026-10-27', -9000], ['2026-10-28', 3000]]);
  const h = heatmap([{ list: { id: 1 }, days: a }, { list: { id: 2 }, days: b }], 2);
  assert.deepEqual(h.dates, ['2026-10-27', '2026-10-28']);
  assert.deepEqual(h.rows[0].cells.map((c) => [c.pnl, c.shade]), [[-100, 4], [50, 2]]);
  assert.deepEqual(h.rows[1].cells.map((c) => c.shade), [4, 2]);
  assert.equal(h.rows[0].total, -50);
  const gap = heatmap([{ list: { id: 1 }, days: a }, { list: { id: 3 }, days: new Map() }]);
  assert.deepEqual(gap.rows[1].cells.map((c) => c.pnl), [null, null, null]);
});

test('compact cell amounts', () => {
  assert.equal(compactPnl(-1400), '−1.4k');
  assert.equal(compactPnl(165), '+165');
  assert.equal(compactPnl(23000), '+23.0k');
  assert.equal(compactPnl(0), '0');
});
