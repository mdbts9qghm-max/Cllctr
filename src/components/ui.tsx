'use client';

/** Kleine, wiederverwendete Bausteine. Bewusst schlicht gehalten. */

import type { TrainingCapacity } from '@/lib/types';

export function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-ink-faint">
        {title}
      </h2>
      {hint ? <p className="mb-3 text-sm leading-relaxed text-ink-muted">{hint}</p> : null}
      <div className={hint ? '' : 'mt-3'}>{children}</div>
    </section>
  );
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-line bg-surface p-4 ${className}`}>{children}</div>
  );
}

export function Button({
  children,
  onClick,
  variant = 'default',
  disabled = false,
  type = 'button',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'primary' | 'danger';
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  const styles: Record<string, string> = {
    default: 'border-line-strong bg-surface-2 text-ink hover:border-ink-faint',
    primary: 'border-ember bg-ember text-void font-semibold hover:bg-ember/90',
    danger: 'border-danger/50 bg-transparent text-danger hover:bg-danger/10',
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded border px-4 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${styles[variant]}`}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-ink-muted">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-ink-faint">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  'w-full rounded border border-line-strong bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-ember focus:outline-none';

const CAPACITY_STYLE: Record<TrainingCapacity, string> = {
  none: 'border-line-strong text-ink-faint',
  light: 'border-ember-dim text-ember',
  moderate: 'border-sky-700 text-sky-400',
  full: 'border-ok/50 text-ok',
};

export function CapacityBadge({ capacity, label }: { capacity: TrainingCapacity; label: string }) {
  return (
    <span
      className={`inline-block shrink-0 whitespace-nowrap rounded border px-2 py-0.5 text-[11px] uppercase tracking-wider ${CAPACITY_STYLE[capacity]}`}
    >
      {label}
    </span>
  );
}

/**
 * Rauten-Marke.
 *
 * Bewusst als SVG und nicht als Zeichen wie ▪ oder ◆: iOS rendert solche
 * Zeichen je nach Schrift als Emoji oder als leeren Kasten. Ein gezeichnetes
 * Element sieht überall gleich aus.
 */
export function Mark({
  variant = 'solid',
  className = '',
}: {
  variant?: 'solid' | 'half' | 'outline';
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 10 10"
      aria-hidden="true"
      className={`inline-block size-2.5 shrink-0 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
    >
      <path d="M5 1l4 4-4 4-4-4z" strokeLinejoin="round" />
      {variant === 'solid' ? <path d="M5 1l4 4-4 4-4-4z" fill="currentColor" /> : null}
      {variant === 'half' ? <path d="M5 3l2 2-2 2-2-2z" fill="currentColor" stroke="none" /> : null}
    </svg>
  );
}

/** Kleine Faktenkachel — Dauer, Zone, RPE. Liest sich besser als eine Zeile mit Trennpunkten. */
export function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded border border-line-strong px-2 py-0.5 text-[11px] text-ink-muted tabular">
      {children}
    </span>
  );
}

export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warn' | 'ok' | 'error';
  children: React.ReactNode;
}) {
  const tones: Record<string, string> = {
    info: 'border-line bg-surface text-ink-muted',
    warn: 'border-ember-dim bg-ember/5 text-ink',
    ok: 'border-ok/40 bg-ok/5 text-ink',
    error: 'border-danger/40 bg-danger/10 text-ink',
  };
  return (
    <p className={`rounded border p-3 text-sm leading-relaxed ${tones[tone]}`}>{children}</p>
  );
}
