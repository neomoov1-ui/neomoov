'use client';

/**
 * Composants d'interface du web (style shadcn/ui, sans dépendance) : cartes, badges, champs, tableaux, dialogue,
 * pagination, avis. Contrastes WCAG 2.1 AA : texte blanc sur le bleu foncé de la charte (6,3:1), jamais sur le bleu
 * clair (3,9:1) ; focus visible partout ; chaque champ a un libellé relié.
 */
import { useEffect, useId, useRef, type ComponentProps, type ReactNode } from 'react';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');
const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue-dark';

type Tone = 'primary' | 'secondary' | 'danger' | 'ghost';
const actionTones: Record<Tone, string> = {
  primary: 'bg-brand-blue-dark text-white hover:bg-brand-night',
  secondary: 'border border-slate-300 bg-white text-brand-ink hover:bg-brand-tint',
  danger: 'bg-red-700 text-white hover:bg-red-800',
  ghost: 'text-brand-blue-dark hover:bg-brand-tint',
};

/** Bouton compact des écrans de gestion. */
export function Action({ tone = 'primary', className, busy, children, ...props }: ComponentProps<'button'> & { tone?: Tone; busy?: boolean }) {
  return (
    <button type="button" aria-busy={busy || undefined} className={cx('inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50', focus, actionTones[tone], className)} {...props}>
      {busy ? <Spinner /> : null}
      {children}
    </button>
  );
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-lg border border-slate-200 bg-white p-4 shadow-sm', className)}>
      {title || actions ? (
        <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title ? <h2 className="text-base text-brand-night">{title}</h2> : <span />}
          {actions}
        </header>
      ) : null}
      {children}
    </section>
  );
}

const badgeTones = {
  neutral: 'bg-slate-100 text-slate-800',
  info: 'bg-brand-tint text-brand-blue-dark',
  success: 'bg-green-100 text-green-900',
  warning: 'bg-amber-100 text-amber-900',
  danger: 'bg-red-100 text-red-900',
} as const;
export type BadgeTone = keyof typeof badgeTones;

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={cx('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold', badgeTones[tone])}>{children}</span>;
}

export function Stat({ label, value, tone, href }: { label: string; value: ReactNode; tone?: BadgeTone; href?: string }) {
  const body = (
    <>
      <span className="block text-xs font-semibold uppercase tracking-wide text-slate-600">{label}</span>
      <span className={cx('mt-1 block text-2xl font-bold', tone === 'danger' ? 'text-red-800' : tone === 'warning' ? 'text-amber-800' : 'text-brand-night')}>{value}</span>
    </>
  );
  const cls = cx('block rounded-lg border border-slate-200 bg-white p-3 shadow-sm', href && 'hover:border-brand-blue-dark', focus);
  return href ? <a href={href} className={cls}>{body}</a> : <div className={cls}>{body}</div>;
}

const control = cx('w-full rounded-md border border-slate-400 bg-white px-3 py-2 text-sm text-brand-night placeholder:text-slate-500 disabled:bg-slate-100', focus);

/** Champ avec libellé relié (et aide ou erreur annoncées au lecteur d'écran). */
export function Field({ label, hint, error, children }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode }) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold text-brand-ink">{label}</label>
      {children({ id, ...(describedBy ? { 'aria-describedby': describedBy } : {}), ...(error ? { 'aria-invalid': true } : {}) })}
      {error ? <p id={`${id}-error`} className="text-xs font-semibold text-red-800">{error}</p> : hint ? <p id={`${id}-hint`} className="text-xs text-slate-600">{hint}</p> : null}
    </div>
  );
}

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cx(control, className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cx(control, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cx(control, 'min-h-20', className)} {...props} />;
}

export function Checkbox({ label, ...props }: ComponentProps<'input'> & { label: ReactNode }) {
  const id = useId();
  return (
    <div className="flex items-start gap-2">
      <input id={id} type="checkbox" className={cx('mt-0.5 h-4 w-4 accent-brand-blue-dark', focus)} {...props} />
      <label htmlFor={id} className="text-sm">{label}</label>
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: BadgeTone; children: ReactNode }) {
  const role = tone === 'danger' ? 'alert' : 'status';
  return <p role={role} className={cx('rounded-md px-3 py-2 text-sm', badgeTones[tone])}>{children}</p>;
}

export function Spinner() {
  return <span aria-hidden className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />;
}

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
}

/** Tableau accessible (en-têtes de colonnes), défilement horizontal sur petit écran. */
export function DataTable<T>({ columns, rows, rowKey, empty, caption }: { columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string; empty: ReactNode; caption?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-600">
            {columns.map((c) => <th key={c.key} scope="col" className={cx('px-2 py-2 font-semibold', c.className)}>{c.header}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={columns.length} className="px-2 py-6 text-center text-slate-600">{empty}</td></tr>
          ) : (
            rows.map((row) => (
              <tr key={rowKey(row)} className="border-b border-slate-100 align-top hover:bg-brand-mist">
                {columns.map((c) => <td key={c.key} className={cx('px-2 py-2', c.className)}>{c.cell(row)}</td>)}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage, labels }: { page: number; pageSize: number; total: number; onPage: (page: number) => void; labels: { previous: string; next: string; pageOf: string } }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav aria-label="pagination" className="mt-3 flex items-center justify-between gap-2 text-sm">
      <Action tone="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>{labels.previous}</Action>
      <span>{labels.pageOf}</span>
      <Action tone="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>{labels.next}</Action>
    </nav>
  );
}

/** Dialogue modal natif (`<dialog>`) : piège du focus et touche Échap fournis par le navigateur. */
export function Dialog({ open, title, onClose, children, wide }: { open: boolean; title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="dialog-title" className={cx('m-auto w-[calc(100%-2rem)] rounded-lg p-0 shadow-xl backdrop:bg-black/40', wide ? 'max-w-4xl' : 'max-w-lg')}>
      {open ? (
        <div className="p-5">
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 id="dialog-title" className="text-lg text-brand-night">{title}</h2>
            <button type="button" onClick={onClose} aria-label="×" className={cx('rounded-md px-2 text-xl leading-none text-slate-600 hover:bg-slate-100', focus)}>×</button>
          </div>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}

export function PageTitle({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl text-brand-night">{title}</h1>
        {subtitle ? <p className="mt-1 max-w-3xl text-sm text-slate-700">{subtitle}</p> : null}
      </div>
      {actions}
    </div>
  );
}

export { cx, focus };
