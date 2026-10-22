import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="card empty">
      <h2 className="title">Page not found</h2>
      <p>That address doesn’t match any screen. The run or watchlist may have been deleted.</p>
      <div className="row"><Link className="btn btn-primary" to="/">Dashboard</Link><Link className="btn" to="/runs">Runs</Link></div>
    </div>
  );
}
