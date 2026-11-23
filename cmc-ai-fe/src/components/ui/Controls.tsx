import type { ReactNode } from 'react';

export function Toggle({ checked, onChange, label, size = 'md', disabled }: { checked: boolean; onChange(v: boolean): void; label?: ReactNode; size?: 'sm' | 'md'; disabled?: boolean }) {
  return (
    <label className={`toggle toggle-${size} ${disabled ? 'disabled' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="track">
        <span className="thumb" />
      </span>
      {label && <span className="toggle-label">{label}</span>}
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange(v: T): void }) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={o.value === value} className={o.value === value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children, hint, error }: { label: string; children: ReactNode; hint?: ReactNode; error?: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function Card({ title, icon, actions, children, className = '', pad = true }: { title?: ReactNode; icon?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          <h2>
            {icon}
            {title}
          </h2>
          <div className="card-actions">{actions}</div>
        </header>
      )}
      <div className={pad ? 'card-body' : ''}>{children}</div>
    </section>
  );
}

export function EmptyState({ icon, title, text, children, className }: { icon?: ReactNode; title: string; text?: string; children?: ReactNode; className?: string }) {
  return (
    <div className={`empty ${className ?? ''}`.trim()}>
      {icon}
      <strong>{title}</strong>
      {text && <span>{text}</span>}
      {children}
    </div>
  );
}

export function Pagination({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage(p: number): void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const list: (number | '…')[] = [];
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || Math.abs(i - page) <= 1) list.push(i);
    else if (list[list.length - 1] !== '…') list.push('…');
  }
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="pagination">
      <div className="pages">
        <button className="pg" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Trang trước">
          ‹
        </button>
        {list.map((p, i) =>
          p === '…' ? (
            <span key={'e' + i} className="pg-ellipsis">
              …
            </span>
          ) : (
            <button key={p} className={`pg ${p === page ? 'active' : ''}`} onClick={() => onPage(p)}>
              {p}
            </button>
          ),
        )}
        <button className="pg" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Trang sau">
          ›
        </button>
      </div>
      <span className="muted small">
        Hiển thị {from}–{to} / {total}
      </span>
    </div>
  );
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  return (
    <div className="progress" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${value}%` }} />
      </div>
      {label && (
        <div className="progress-label">
          <span>{label}</span>
          <strong>{value}%</strong>
        </div>
      )}
    </div>
  );
}
