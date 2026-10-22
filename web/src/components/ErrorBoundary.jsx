// A screen that crashes while rendering shows this instead of a blank page.
import { Component } from 'react';

export default class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidUpdate(prev) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card empty">
        <h2 className="title">This screen hit an error</h2>
        <p>Nothing was lost — saved runs and settings live on the server. Reload to try again.</p>
        <code className="caption">{String(this.state.error.message || this.state.error)}</code>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>Reload</button>
      </div>
    );
  }
}
