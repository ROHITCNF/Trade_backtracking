// Run status: Queued · Running · Done · Failed · Cancelled (design system).
const LABEL = { queued: 'Queued', running: 'Running', done: 'Done', failed: 'Failed', cancelled: 'Cancelled' };

export default function StatusPill({ status }) {
  return (
    <span className={`status status-${status}`}>
      <span className="dot" />
      {LABEL[status] || status}
    </span>
  );
}
