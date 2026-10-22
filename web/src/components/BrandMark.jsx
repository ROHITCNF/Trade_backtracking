// The ORB Lab mark: a rising line on an ink tile.
export default function BrandMark({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
      <rect width="20" height="20" rx="4" fill="var(--ink)" />
      <path d="M4 13.5l3.5-3 2.5 2 5.5-6" fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 15l3.5-3 2.5 2 5.5-6" fill="none" stroke="var(--surface)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
    </svg>
  );
}
