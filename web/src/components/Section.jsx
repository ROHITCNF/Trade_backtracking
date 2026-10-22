// A collapsible form card: title, one-line summary of its settings, chevron.
import { useState } from 'react';

export default function Section({ title, summary, defaultOpen = true, children, aside }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="card section-card">
      <button type="button" className="section-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>
          <span className="section">{title}</span>
          {summary && <span className="caption section-summary">{summary}</span>}
        </span>
        {aside}
        <svg className={`chevron${open ? ' open' : ''}`} width="14" height="14" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}
