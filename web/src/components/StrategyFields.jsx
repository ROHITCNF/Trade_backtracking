// Every strategy knob (FR-9) in one compact panel: the Research "change"
// panel and the Journal default strategy share it. config holds what the owner
// typed (numbers may be text); onChange gets a patch.

import Segmented from './Segmented.jsx';
import { rupees } from '../lib/format.js';

const STOP_HINTS = {
  pct: 'Pct — always SL % from the entry. Fixed risk, ignores how wide the range is.',
  range: 'Range — the opposite edge of the opening range. The classic ORB stop; risk varies by day.',
  tighter: 'Tighter — whichever of Pct and Range is closer to the entry. Smaller risk, more stop-outs.',
  wider: 'Wider — whichever of Pct and Range is further from the entry. Room to breathe, larger risk.',
};

export default function StrategyFields({ config: c, onChange: setC }) {
  const targetHint =
    c.targetMode === 'R'
      ? `${c.targetR}R = ${c.targetR} × the stop distance`
      : c.targetMode === 'pct'
        ? `Target ${c.targetPct}% from the entry, whatever the stop`
        : 'No target — exits on the stop or at session end';
  const notional = Number(c.capitalPerTrade) * Number(c.leverage);

  return (
    <div className="strategy-fields">
      <div className="fields">
        <label className="field"><span className="label">Direction</span>
          <Segmented value={c.direction} options={[['long', 'Long'], ['short', 'Short'], ['both', 'Both']]} onChange={(direction) => setC({ direction })} label="Direction" />
        </label>
        <label className="field"><span className="label">OR start</span>
          <input className="input input-time" inputMode="numeric" maxLength={5} placeholder="HH:MM" value={c.orbStart} onChange={(e) => setC({ orbStart: e.target.value })} />
        </label>
        <label className="field"><span className="label">OR end</span>
          <input className="input input-time" inputMode="numeric" maxLength={5} placeholder="HH:MM" value={c.orbEnd} onChange={(e) => setC({ orbEnd: e.target.value })} />
        </label>
        <label className="field"><span className="label">Session end</span>
          <input className="input input-time" inputMode="numeric" maxLength={5} placeholder="HH:MM" value={c.sessionEnd} onChange={(e) => setC({ sessionEnd: e.target.value })} />
        </label>
      </div>
      <div className="fields">
        <label className="field"><span className="label">Stop</span>
          <Segmented value={c.slMode} options={[['pct', 'Pct'], ['range', 'Range'], ['tighter', 'Tighter'], ['wider', 'Wider']]} onChange={(slMode) => setC({ slMode })} label="Stop mode" />
        </label>
        <label className="field"><span className="label">SL %</span>
          <input className="input" inputMode="decimal" value={c.slPct} onChange={(e) => setC({ slPct: e.target.value })} disabled={c.slMode === 'range'} />
        </label>
        <label className="field"><span className="label">Target</span>
          <Segmented value={c.targetMode} options={[['R', 'R'], ['pct', 'Pct'], ['none', 'None']]} onChange={(targetMode) => setC({ targetMode })} label="Target mode" />
        </label>
        {c.targetMode !== 'none' && (
          <label className="field"><span className="label">{c.targetMode === 'R' ? 'R' : '%'}</span>
            <input className="input" inputMode="decimal" value={c.targetMode === 'R' ? c.targetR : c.targetPct}
              onChange={(e) => setC(c.targetMode === 'R' ? { targetR: e.target.value } : { targetPct: e.target.value })} />
          </label>
        )}
      </div>
      <span className="caption">{STOP_HINTS[c.slMode]} {targetHint}.</span>
      <div className="fields">
        <label className="field"><span className="label">Sizing</span>
          <Segmented value={c.sizing} options={[['entryPrice', 'Entry-price based'], ['fixed', 'Fixed qty']]} onChange={(sizing) => setC({ sizing })} label="Sizing" />
        </label>
        {c.sizing === 'entryPrice' ? (
          <>
            <label className="field"><span className="label">Capital / trade</span>
              <span className="affix">₹<input className="input" style={{ width: 110 }} inputMode="numeric" value={c.capitalPerTrade} onChange={(e) => setC({ capitalPerTrade: e.target.value })} /></span>
            </label>
            <label className="field"><span className="label">Leverage</span>
              <span className="affix"><input className="input" style={{ width: 64 }} inputMode="decimal" value={c.leverage} onChange={(e) => setC({ leverage: e.target.value })} />x</span>
            </label>
          </>
        ) : (
          <label className="field"><span className="label">Quantity</span>
            <input className="input" inputMode="numeric" value={c.quantity} onChange={(e) => setC({ quantity: e.target.value })} />
          </label>
        )}
        <label className="field"><span className="label">Costs (bps)</span>
          <input className="input" inputMode="decimal" value={c.costBps} onChange={(e) => setC({ costBps: e.target.value })} />
        </label>
      </div>
      <span className="caption">
        {c.sizing === 'entryPrice'
          ? `Qty = ⌊${rupees(notional)} ÷ entry price⌋.`
          : 'The same number of shares on every trade, whatever the price.'}{' '}
        Costs are round-trip: 10 bps = 0.1% of entry + exit value.
      </span>
    </div>
  );
}
