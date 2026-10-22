// Turns a launcher draft into a run spec: checks it (FR-10), fills the settings
// snapshot (FR-13) and prices it in Fyers calls (FR-12). Input checking only;
// what the settings mean stays in src/engine.js.

const baseConfig = require('../config');
const { toMinutes, istToday } = require('../src/time');
const { MIN_GAP_MS } = require('../src/fyers');

// The settings a run snapshots. Dates and symbols live in their own columns.
const STRATEGY_KEYS = [
  'direction', 'orbStart', 'orbEnd', 'sessionEnd', 'slMode', 'slPct', 'targetMode', 'targetR',
  'targetPct', 'sizing', 'capitalPerTrade', 'leverage', 'quantity', 'costBps', 'resolution',
];

const CHUNK_DAYS = 60; // src/fetch.js fetches history 60 days per call
const DAY_MS = 86400000;
const MAX_SYMBOLS = 500;

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
const strategyOf = (config) => pick(config, STRATEGY_KEYS);

const time = { type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' };
const date = { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' };
const positive = { type: 'number', exclusiveMinimum: 0 };

// JSON schema for POST /api/runs and /api/estimate. Shapes and enums here;
// rules spanning fields are in validate().
const draftSchema = {
  type: 'object',
  required: ['fromDate', 'toDate', 'config'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', maxLength: 120 },
    fromDate: date,
    toDate: date,
    symbols: { type: 'array', items: { type: 'string', maxLength: 40 }, maxItems: MAX_SYMBOLS },
    watchlistId: { type: 'integer', minimum: 1 },
    sweep: { type: 'boolean' },
    config: {
      type: 'object',
      additionalProperties: false,
      properties: {
        direction: { enum: ['long', 'short', 'both'] },
        orbStart: time,
        orbEnd: time,
        sessionEnd: time,
        slMode: { enum: ['pct', 'range', 'tighter', 'wider'] },
        slPct: positive,
        targetMode: { enum: ['R', 'pct', 'none'] },
        targetR: positive,
        targetPct: positive,
        sizing: { enum: ['entryPrice', 'fixed'] },
        capitalPerTrade: positive,
        leverage: positive,
        quantity: { type: 'integer', minimum: 1 },
        costBps: { type: 'number', minimum: 0, maximum: 1000 },
      },
    },
  },
};

function shiftYears(ymd, years) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

// Problems with a draft, as messages for the form; empty when it is fine.
// config is the full snapshot (defaults filled in).
function validate({ fromDate, toDate, config }, today = istToday()) {
  const errors = [];
  if (fromDate > toDate) errors.push('From date must be on or before To date.');
  if (fromDate < shiftYears(today, -1)) errors.push('From date can be at most one year back.');
  if (toDate > today) errors.push('To date cannot be in the future.');
  if (!(toMinutes(config.orbStart) < toMinutes(config.orbEnd) && toMinutes(config.orbEnd) < toMinutes(config.sessionEnd))) {
    errors.push('ORB start must be before ORB end, and ORB end before session end.');
  }
  if (toMinutes(config.sessionEnd) > toMinutes('15:30')) errors.push('Session end must be by 15:30.');
  if (config.targetMode === 'R' && !(config.targetR > 0)) errors.push('Target R must be above 0.');
  if (config.targetMode === 'pct' && !(config.targetPct > 0)) errors.push('Target % must be above 0.');
  return errors;
}

// The draft's settings over config.js, so every run stores every knob (FR-13).
const snapshot = (draftConfig = {}) => ({ ...strategyOf(baseConfig), ...draftConfig, resolution: '1' });

// History calls for one symbol over the range: one per 60-day chunk, as
// src/fetch.js makes them. Retries can add more; this is the planned cost.
function callsPerSymbol(fromDate, toDate) {
  const days = Math.round((Date.parse(toDate) - Date.parse(fromDate)) / DAY_MS) + 1;
  return Math.max(1, Math.ceil(days / CHUNK_DAYS));
}

function estimate({ symbolCount, fromDate, toDate }) {
  const calls = symbolCount * callsPerSymbol(fromDate, toDate);
  return { calls, seconds: Math.ceil((calls * MIN_GAP_MS) / 1000) };
}

module.exports = { draftSchema, validate, snapshot, strategyOf, estimate, callsPerSymbol, STRATEGY_KEYS, shiftYears };
