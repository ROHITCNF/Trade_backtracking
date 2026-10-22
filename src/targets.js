// The profit-target rules a sweep compares (spec F5). Shared by sweep.js and the
// web app's sweep runs; entries and stops are identical across them.

// R here means "multiples of the stop distance", whatever config.slMode makes that.
const TARGET_VARIANTS = [
  { label: 'no target (EOD)', targetMode: 'none' },
  { label: '0.5R', targetMode: 'R', targetR: 0.5 },
  { label: '1R', targetMode: 'R', targetR: 1 },
  { label: '1.5R', targetMode: 'R', targetR: 1.5 },
  { label: '2R', targetMode: 'R', targetR: 2 },
  { label: '3R', targetMode: 'R', targetR: 3 },
  { label: 'fixed 1%', targetMode: 'pct', targetPct: 1 },
  { label: 'fixed 2%', targetMode: 'pct', targetPct: 2 },
  { label: 'fixed 2.5%', targetMode: 'pct', targetPct: 2.5 },
];

module.exports = { TARGET_VARIANTS };
