'use client';

import { useEffect, useState, type ReactNode } from 'react';

export function Card({ children, className = '', title, action }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode }) {
  return (
    <div className={`glass rounded-3xl border border-line/60 p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between">
          {title && <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled,
  type = 'button',
  className = '',
  size = 'md',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost' | 'danger' | 'gold';
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const variants = {
    primary: 'btn-gradient font-semibold',
    ghost: 'border border-line bg-card text-txt hover:border-primary/40 hover:bg-primary/5',
    danger: 'bg-danger/90 text-white hover:bg-danger',
    gold: 'bg-secondary text-white hover:brightness-105 font-semibold',
  };
  const sizes = { sm: 'px-3 py-1 text-xs', md: 'px-5 py-2 text-sm', lg: 'px-7 py-3 text-base' };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${variants[variant]} ${sizes[size]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  const { label, className = '', ...rest } = props;
  return (
    <label className="block">
      {label && <span className="mb-1 block text-xs font-medium text-muted">{label}</span>}
      <input
        {...rest}
        className={`w-full rounded-lg border border-line bg-elevated/80 px-3 py-2 text-sm outline-none transition placeholder:text-muted/60 focus:border-primary focus:shadow-[0_0_0_3px] focus:shadow-primary/15 ${className}`}
      />
    </label>
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  const { label, className = '', children, ...rest } = props;
  return (
    <label className="block">
      {label && <span className="mb-1 block text-xs font-medium text-muted">{label}</span>}
      <select
        {...rest}
        className={`w-full rounded-lg border border-line bg-elevated px-3 py-2 text-sm outline-none focus:border-primary ${className}`}
      >
        {children}
      </select>
    </label>
  );
}

export function Badge({ children, color = 'primary' }: { children: ReactNode; color?: string }) {
  const map: Record<string, string> = {
    primary: 'bg-primary/15 text-primary',
    gold: 'bg-secondary/15 text-secondary',
    success: 'bg-success/15 text-success',
    danger: 'bg-danger/15 text-danger',
    warning: 'bg-warning/15 text-warning',
    muted: 'bg-elevated text-muted',
  };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${map[color] ?? map.primary}`}>{children}</span>;
}

export function Tabs({ tabs, active, onChange }: { tabs: Array<{ id: string; label: ReactNode }>; active: string; onChange: (id: string) => void }) {
  return (
    <div className="flex gap-1 rounded-full bg-elevated p-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`flex-1 rounded-full px-3 py-1.5 text-sm font-medium transition ${
            active === t.id ? 'bg-card font-semibold text-txt shadow-sm' : 'text-muted hover:text-txt'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-8 text-muted">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-primary" />
      {label && <span className="text-sm">{label}</span>}
    </div>
  );
}

export function ProgressBar({ value, color = 'var(--color-primary)' }: { value: number; color?: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-elevated">
      <div className="h-full rounded-full transition-all duration-300" style={{ width: `${Math.min(100, value * 100)}%`, background: color }} />
    </div>
  );
}

/** Horizontal probability bar with label, PRD-style. */
export function ProbBar({ label, value, color = 'var(--color-primary)', suffix }: { label: string; value: number; color?: string; suffix?: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 shrink-0 text-xs font-semibold">{label}</span>
      <div className="h-3 flex-1 overflow-hidden rounded-full bg-elevated">
        <div className="h-full rounded-full" style={{ width: `${Math.max(1, value * 100)}%`, background: color }} />
      </div>
      <span className="w-14 shrink-0 text-right font-mono text-xs">{suffix ?? `${(value * 100).toFixed(1)}%`}</span>
    </div>
  );
}

export function Meter({ label, value, max = 100 }: { label: string; value: number; max?: number }) {
  const pct = value / max;
  const color = pct >= 0.75 ? 'var(--color-success)' : pct >= 0.5 ? 'var(--color-warning)' : 'var(--color-danger)';
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="font-mono font-semibold" style={{ color }}>{Math.round(value)}</span>
      </div>
      <ProgressBar value={pct} color={color} />
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className={`slide-up max-h-[85vh] w-full ${wide ? 'max-w-3xl' : 'max-w-md'} overflow-y-auto rounded-3xl border border-line/60 bg-card p-6 shadow-2xl shadow-black/10`}
        onClick={(e) => e.stopPropagation()}
      >
        {title && <h2 className="mb-4 text-lg font-bold">{title}</h2>}
        {children}
      </div>
    </div>
  );
}

export function Toast({ message, kind }: { message: string; kind: 'success' | 'error' }) {
  return (
    <div
      className={`slide-up fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full px-5 py-2.5 text-sm font-medium text-white shadow-xl ${
        kind === 'success' ? 'bg-success' : 'bg-danger'
      }`}
    >
      {message}
    </div>
  );
}

export function useToast() {
  const [toast, setToast] = useState<{ message: string; kind: 'success' | 'error' } | null>(null);
  const show = (message: string, kind: 'success' | 'error' = 'success') => {
    setToast({ message, kind });
    setTimeout(() => setToast(null), 3200);
  };
  const node = toast ? <Toast message={toast.message} kind={toast.kind} /> : null;
  return { show, node };
}

export function Stat({ label, value, mono = true }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="rounded-lg bg-elevated px-3 py-2 text-center">
      <div className={`text-lg font-bold ${mono ? 'font-mono' : ''}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
    </div>
  );
}

export function Flag({ code, size = 24, className = '' }: { code: string; size?: number; className?: string }) {
  const [err, setErr] = useState(false);
  if (err || !code) {
    return (
      <span
        className={`inline-flex items-center justify-center rounded bg-elevated font-mono text-[9px] text-muted ${className}`}
        style={{ width: size, height: size * 0.75 }}
      >
        {code}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/flags/${code}`}
      alt={code}
      width={size}
      height={size * 0.75}
      className={`rounded-[3px] object-cover ${className}`}
      style={{ width: size, height: size * 0.75 }}
      onError={() => setErr(true)}
    />
  );
}
