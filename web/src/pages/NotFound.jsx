import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="card empty">
      <h2 className="title">Page not found</h2>
      <p>That address doesn’t match any screen. The run or list may have been deleted.</p>
      <div className="row"><Link className="btn btn-primary" to="/">Journal</Link><Link className="btn" to="/research">Research</Link></div>
    </div>
  );
}
