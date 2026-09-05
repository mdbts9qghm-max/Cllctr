'use client';

/**
 * Die Bausteine der Oberfläche.
 *
 * Bewusst wenige und bewusst dumm: Sie kennen keine Daten und keine Logik. Wer
 * hier ein `useLiveQuery` einbaut, bekommt eine Komponente, die man nicht mehr
 * an einer anderen Stelle verwenden kann.
 */

import type { ReactNode } from 'react';

/* ------------------------------------------------------------------ */
/* Struktur                                                            */
/* ------------------------------------------------------------------ */

export function Section({
  title,
  hint,
  action,
  children,
}: {
  title?: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-7">
      {title ? (
        <div className="mb-2.5 flex items-baseline justify-between gap-3 px-0.5">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
            {title}
          </h2>
          {action}
        </div>
      ) : null}
      {hint ? (
        <p className="mb-3 px-0.5 text-xs leading-relaxed text-ink-faint">{hint}</p>
      ) : null}
      {children}
    </section>
  );
}

export function Card({
  children,
  className = '',
  tone = 'default',
}: {
  children: ReactNode;
  className?: string;
  tone?: 'default' | 'accent' | 'quiet';
}) {
  const tones = {
    default: 'border-line bg-surface',
    accent: 'border-[color:var(--color-accent-dim)] bg-surface',
    quiet: 'border-line bg-surface-2',
  };
  return (
    <div className={`rounded-[14px] border ${tones[tone]} p-4 ${className}`}>{children}</div>
  );
}

/* ------------------------------------------------------------------ */
/* Bedienelemente                                                      */
/* ------------------------------------------------------------------ */

export function Button({
  children,
  onClick,
  variant = 'default',
  size = 'md',
  disabled,
  type = 'button',
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
}) {
  const variants = {
    default: 'border-line-strong bg-surface-2 text-ink hover:border-[color:var(--color-accent)]',
    primary:
      'border-[color:var(--color-accent)] bg-[color:var(--color-accent)] text-white hover:opacity-90',
    danger: 'border-[color:var(--color-warn)]/50 bg-transparent text-[color:var(--color-warn)]',
    ghost: 'border-transparent bg-transparent text-ink-muted hover:text-ink',
  };
  const sizes = { sm: 'px-2.5 py-1 text-xs', md: 'px-3.5 py-2 text-sm' };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${variants[variant]} ${sizes[size]} ${className}`}
    >
      {children}
    </button>
  );
}

export const inputClass =
  'w-full rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-base text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-[color:var(--color-accent)]';

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-ink-faint">
        {label}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-ink-faint">{hint}</span> : null}
    </label>
  );
}

/** Auswahl aus wenigen Werten — schneller als ein Dropdown auf dem Telefon. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
}) {
  return (
    <div className="flex gap-1 rounded-lg border border-line bg-surface-2 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`flex-1 rounded-md ${size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'} font-medium transition-colors ${
            value === o.value
              ? 'bg-[color:var(--color-accent)] text-white'
              : 'text-ink-muted hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Anzeige                                                             */
/* ------------------------------------------------------------------ */

export type Tone = 'good' | 'ok' | 'warn' | 'neutral' | 'accent';

const TONE_TEXT: Record<Tone, string> = {
  good: 'text-[color:var(--color-good)]',
  ok: 'text-[color:var(--color-ok)]',
  warn: 'text-[color:var(--color-warn)]',
  neutral: 'text-ink',
  accent: 'text-[color:var(--color-accent)]',
};

const TONE_BG: Record<Tone, string> = {
  good: 'bg-[color:var(--color-good)]',
  ok: 'bg-[color:var(--color-ok)]',
  warn: 'bg-[color:var(--color-warn)]',
  neutral: 'bg-[color:var(--color-ink-faint)]',
  accent: 'bg-[color:var(--color-accent)]',
};

export function toneClass(tone: Tone): string {
  return TONE_TEXT[tone];
}

/** Ein Punkt in Ampelfarbe. Ersetzt Emoji, die auf jedem Gerät anders aussehen. */
export function Dot({ tone, className = '' }: { tone: Tone; className?: string }) {
  return <span className={`inline-block size-2 shrink-0 rounded-full ${TONE_BG[tone]} ${className}`} />;
}

/** Eine große Zahl mit Beschriftung — das Grundelement jedes Dashboards. */
export function Stat({
  label,
  value,
  unit,
  sub,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  unit?: string;
  sub?: string;
  tone?: Tone;
}) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-faint">{label}</p>
      <p className={`mt-1 text-2xl font-semibold leading-none tabular ${TONE_TEXT[tone]}`}>
        {value}
        {unit ? <span className="ml-0.5 text-sm font-normal text-ink-faint">{unit}</span> : null}
      </p>
      {sub ? <p className="mt-1 text-[11px] leading-tight text-ink-faint">{sub}</p> : null}
    </div>
  );
}

export function Bar({
  ratio,
  tone = 'accent',
  className = '',
}: {
  ratio: number;
  tone?: Tone;
  className?: string;
}) {
  return (
    <div className={`h-1.5 overflow-hidden rounded-full bg-surface-2 ${className}`}>
      <div
        className={`h-full rounded-full transition-[width] duration-500 ${TONE_BG[tone]}`}
        style={{ width: `${Math.max(0, Math.min(100, ratio * 100))}%` }}
      />
    </div>
  );
}

export function Chip({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  const border: Record<Tone, string> = {
    good: 'border-[color:var(--color-good)]/40',
    ok: 'border-[color:var(--color-ok)]/40',
    warn: 'border-[color:var(--color-warn)]/40',
    neutral: 'border-line-strong',
    accent: 'border-[color:var(--color-accent)]/50',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] ${border[tone]} ${TONE_TEXT[tone]}`}
    >
      {children}
    </span>
  );
}

export function Notice({
  children,
  tone = 'accent',
}: {
  children: ReactNode;
  tone?: 'accent' | 'good' | 'warn';
}) {
  const styles = {
    accent: 'border-[color:var(--color-accent)]/40 bg-[color:var(--color-accent)]/10',
    good: 'border-[color:var(--color-good)]/40 bg-[color:var(--color-good)]/10',
    warn: 'border-[color:var(--color-warn)]/40 bg-[color:var(--color-warn)]/10',
  };
  return (
    <div className={`rounded-lg border p-3 text-sm leading-relaxed text-ink ${styles[tone]}`}>
      {children}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <Card tone="quiet">
      <p className="text-sm font-medium text-ink">{title}</p>
      {children ? (
        <div className="mt-1.5 text-sm leading-relaxed text-ink-muted">{children}</div>
      ) : null}
    </Card>
  );
}

export function Loading() {
  return <p className="p-4 text-sm text-ink-faint">Lade …</p>;
}

/** Modaler Bereich für Formulare. Auf dem Telefon von unten, sonst mittig. */
export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        aria-label="Schließen"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
      />
      <div className="relative max-h-[90vh] w-full overflow-y-auto rounded-t-2xl border border-line bg-surface p-4 sm:max-w-lg sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Schließen
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}
