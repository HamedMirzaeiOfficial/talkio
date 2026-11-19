import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { forwardRef, useId } from 'react';

const cx = (...v: (string | false | null | undefined)[]) => v.filter(Boolean).join(' ');

export function Button({
  variant = 'primary',
  loading,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || loading}
      className={cx(
        'inline-flex h-10 items-center justify-center gap-2 rounded-ui px-4 text-sm font-medium transition disabled:opacity-50',
        variant === 'primary' && 'bg-primary text-primary-fg hover:brightness-110',
        variant === 'secondary' && 'border border-border bg-surface text-fg hover:bg-surface-2',
        variant === 'ghost' && 'text-muted hover:bg-surface-2 hover:text-fg',
        variant === 'danger' && 'bg-danger text-white hover:brightness-110',
        className,
      )}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export const Field = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: ReactNode }
>(function Field({ label, error, hint, className, ...props }, ref) {
  const id = useId();
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-fg">
        {label}
      </label>
      <input
        ref={ref}
        id={id}
        aria-invalid={Boolean(error)}
        aria-describedby={error || hint ? `${id}-help` : undefined}
        className={cx(
          'h-10 rounded-ui border bg-surface px-3 text-[15px] text-fg transition outline-none placeholder:text-subtle focus:border-primary sm:text-sm',
          error ? 'border-danger' : 'border-border',
        )}
        {...props}
      />
      {(error || hint) && (
        <p id={`${id}-help`} className={cx('text-[12.5px]', error ? 'text-danger' : 'text-muted')}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
});

/** Brand mark: a speech bubble carrying a voice waveform, with a "live" presence dot. */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-hidden>
      <defs>
        <linearGradient id={`${id}t`} x1="8" y1="4" x2="56" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#6D6BF5" />
          <stop offset="1" stopColor="#4338CA" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="18" fill={`url(#${id}t)`} />
      <path
        fill="#fff"
        d="M14 27.5C14 19.5 20.5 13 28.5 13h7C43.5 13 50 19.5 50 27.5S43.5 42 35.5 42H28l-8.2 6.6c-1.3 1-3.1.1-3.1-1.5v-7.4A14.4 14.4 0 0 1 14 27.5Z"
      />
      <g fill="#4F46E5">
        <rect x="22.5" y="24" width="4" height="7" rx="2" />
        <rect x="29.5" y="19.5" width="4" height="16" rx="2" />
        <rect x="36.5" y="22.5" width="4" height="10" rx="2" />
      </g>
      <circle cx="50" cy="14" r="6.5" fill="#34D399" stroke={`url(#${id}t)`} strokeWidth="3.5" />
    </svg>
  );
}

export function Logo({ className, iconOnly = false }: { className?: string; iconOnly?: boolean }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-2.5 text-[17px] font-semibold tracking-[-0.02em] text-fg',
        className,
      )}
    >
      <LogoMark size={iconOnly ? 34 : 30} />
      {iconOnly ? <span className="sr-only">Talkio</span> : 'Talkio'}
    </span>
  );
}
