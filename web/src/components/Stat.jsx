// One stat card: label, value, optional caption (design system § Stat card).
export function Stat({ label, value, sub, className = '' }) {
  return (
    <div className="stat-card">
      <span className="label">{label}</span>
      <span className={`stat ${className}`}>{value}</span>
      {sub && <span className="caption">{sub}</span>}
    </div>
  );
}
