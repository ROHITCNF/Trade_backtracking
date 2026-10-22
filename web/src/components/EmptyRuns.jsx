// "No backtests yet" (States.png), shared by Runs and Dashboard.
import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';

export default function EmptyRuns() {
  return (
    <div className="card empty">
      <span className="empty-icon"><Icon name="chart" size={40} /></span>
      <h2 className="title">No backtests yet</h2>
      <p>
        Pick a symbol list and a date range — defaults are a sensible ORB setup (09:15–09:30 range, tighter 1% stop,
        1.5R target). A 39-symbol, 1-year run takes about 6 minutes.
      </p>
      <Link className="btn btn-primary btn-lg" to="/new">Start your first backtest</Link>
      <span className="caption">Needs Fyers connected today · costs ≈ 273 of 4,800 daily API calls</span>
    </div>
  );
}
