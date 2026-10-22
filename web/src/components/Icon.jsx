// The few line icons the design uses, inline so they follow currentColor.
const PATHS = {
  alert: <><circle cx="10" cy="10" r="7.5" /><path d="M10 6v4.5M10 13.5v.01" /></>,
  warn: <><path d="M10 3l7.5 13h-15z" /><path d="M10 8.5v3.5M10 14.5v.01" /></>,
  info: <><circle cx="10" cy="10" r="7.5" /><path d="M10 9v4.5M10 6.5v.01" /></>,
  link: <><path d="M8.5 11.5l3-3" /><path d="M9 6l1.5-1.5a3 3 0 014.2 4.2L13 10.5M11 14l-1.5 1.5a3 3 0 01-4.2-4.2L7 9.5" /></>,
  clock: <><circle cx="10" cy="10" r="7.5" /><path d="M10 6v4l2.5 2" /></>,
  chart: <><path d="M3 14l4-4 3 2.5 6-6.5" /><path d="M3 17h14" /></>,
  close: <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />,
};

export default function Icon({ name, size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="icon">
      {PATHS[name]}
    </svg>
  );
}
