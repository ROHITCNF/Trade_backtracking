import test from 'node:test';
import assert from 'node:assert/strict';
import { durationLabel, runTitle, settingsLabel, plannedCalls } from '../src/lib/runs.js';

const config = { direction: 'both', slMode: 'tighter', slPct: 1, targetMode: 'R', targetR: 1.5, targetPct: 2 };

test('run titles and labels', () => {
  assert.equal(durationLabel('2025-10-23', '2026-10-21'), '1 year');
  assert.equal(durationLabel('2026-04-21', '2026-10-21'), '6 months');
  assert.equal(durationLabel('2026-10-14', '2026-10-21'), '8 days');
  assert.equal(settingsLabel(config), 'Both · SL tighter 1% · TGT 1.5R');
  assert.equal(settingsLabel({ ...config, slMode: 'range', targetMode: 'none' }), 'Both · SL range · no target');
  const run = { name: null, watchlistName: 'core', total: 39, fromDate: '2025-10-23', toDate: '2026-10-21', config };
  assert.equal(runTitle(run), 'core 39 · 1 year · TGT 1.5R');
  assert.equal(runTitle({ ...run, name: 'Mine' }), 'Mine');
  assert.equal(plannedCalls(run), 39 * 7);
});

import { sweepTitle } from '../src/lib/runs.js';

test('sweep titles', () => {
  const run = { name: 'Core sweep · 1.5R', watchlistName: 'core', total: 39, fromDate: '2025-10-23', toDate: '2026-10-21' };
  assert.equal(sweepTitle(run), 'Core sweep');
  assert.equal(sweepTitle({ ...run, name: '1.5R' }), 'core 39 · 1 year · sweep');
});
