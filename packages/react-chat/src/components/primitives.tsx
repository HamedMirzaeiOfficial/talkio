import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as MenuPrimitive from '@radix-ui/react-dropdown-menu';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Loader2, X } from 'lucide-react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { forwardRef } from 'react';

import { useChatContext, useThemeRoot } from '../context.js';
import { cx } from '../utils.js';
import { useOptionalChatContext } from '../context.js';
import { defaultStrings } from '../strings.js';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const variants: Record<Variant, string> = {
  primary: 'rc:bg-primary rc:text-primary-fg rc:hover:brightness-110',
  secondary: 'rc:bg-surface rc:text-fg rc:border rc:border-border rc:hover:bg-surface-2',
  ghost: 'rc:text-muted rc:hover:bg-surface-2 rc:hover:text-fg',
  danger: 'rc:bg-danger rc:text-white rc:hover:brightness-110',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    className,
    children,
    disabled,
    type = 'button',
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cx(
        'rc:inline-flex rc:items-center rc:justify-center rc:gap-2 rc:rounded-ui rc:font-medium rc:transition rc:select-none rc:disabled:opacity-50 rc:whitespace-nowrap',
        size === 'sm' ? 'rc:h-8 rc:px-3 rc:text-[13px]' : 'rc:h-9 rc:px-4 rc:text-sm',
        variants[variant],
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className="rc:size-4 rc:animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  active?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, active = false, size = 'md', className, children, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        'rc:inline-flex rc:shrink-0 rc:items-center rc:justify-center rc:rounded-ui rc:transition rc:disabled:opacity-40',
        size === 'sm' ? 'rc:size-7' : size === 'lg' ? 'rc:size-10' : 'rc:size-8',
        active
          ? 'rc:bg-primary-soft rc:text-primary'
          : 'rc:text-muted rc:hover:bg-surface-2 rc:hover:text-fg',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});

export const TextInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode }
>(function TextInput({ icon, className, ...props }, ref) {
  return (
    <div className={cx('rc:relative rc:flex rc:items-center', className)}>
      {icon && <span className="rc:pointer-events-none rc:absolute rc:start-3 rc:text-subtle">{icon}</span>}
      <input
        ref={ref}
        className={cx(
          'rc:h-9 rc:w-full rc:rounded-ui rc:border rc:border-border rc:bg-surface rc:text-sm rc:text-fg rc:transition rc:focus:border-primary',
          icon ? 'rc:ps-9 rc:pe-3' : 'rc:px-3',
        )}
        {...props}
      />
    </div>
  );
});

export function Spinner({ label }: { label?: string }) {
  const context = useOptionalChatContext();
  return (
    <span role="status" className="rc:inline-flex rc:items-center rc:gap-2 rc:text-[13px] rc:text-muted">
      <Loader2 className="rc:size-4 rc:animate-spin" aria-hidden />
      {label ?? <span className="rc:sr-only">{context?.strings.loading ?? defaultStrings.loading}</span>}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cx('rc-skeleton rc:block rc:rounded-md', className)} />;
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rc:flex rc:h-full rc:flex-col rc:items-center rc:justify-center rc:gap-2 rc:px-6 rc:py-10 rc:text-center">
      {icon && (
        <div className="rc:mb-1 rc:grid rc:size-11 rc:place-items-center rc:rounded-full rc:bg-primary-soft rc:text-primary">
          {icon}
        </div>
      )}
      <p className="rc:text-sm rc:font-medium rc:text-fg">{title}</p>
      {hint && <p className="rc:max-w-xs rc:text-[13px] rc:text-muted">{hint}</p>}
      {action && <div className="rc:mt-2">{action}</div>}
    </div>
  );
}

export function Switch({
  checked,
  onCheckedChange,
  label,
  hint,
  id,
}: {
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  label: string;
  hint?: string;
  id: string;
}) {
  return (
    <div className="rc:flex rc:items-start rc:justify-between rc:gap-4 rc:py-2">
      <label htmlFor={id} className="rc:flex rc:flex-col rc:gap-0.5">
        <span className="rc:text-sm rc:text-fg">{label}</span>
        {hint && <span className="rc:text-[13px] rc:text-muted">{hint}</span>}
      </label>
      <button
        id={id}
        role="switch"
        type="button"
        aria-checked={checked}
        onClick={() => onCheckedChange(!checked)}
        className={cx(
          'rc:relative rc:mt-0.5 rc:h-5 rc:w-9 rc:shrink-0 rc:rounded-full rc:transition',
          checked ? 'rc:bg-primary' : 'rc:bg-border',
        )}
      >
        <span
          className={cx(
            'rc:absolute rc:top-0.5 rc:size-4 rc:rounded-full rc:bg-white rc:shadow rc:transition-all',
            checked ? 'rc:start-[18px]' : 'rc:start-0.5',
          )}
        />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------------- Dialog */

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: 'sm' | 'md';
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = 'md',
}: DialogProps) {
  const root = useThemeRoot();
  const { strings } = useChatContext();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          {...root}
          className={cx(root.className, 'rc-fade rc:fixed rc:inset-0 rc:z-[1000] rc:bg-overlay')}
        />
        <DialogPrimitive.Content
          {...root}
          className={cx(
            root.className,
            'rc-pop rc:fixed rc:z-[1001] rc:flex rc:flex-col rc:overflow-hidden rc:bg-surface rc:text-fg rc:shadow-[var(--rc-shadow)]',
            'rc:inset-x-0 rc:bottom-0 rc:max-h-[92dvh] rc:rounded-t-2xl',
            'rc:sm:inset-auto rc:sm:left-1/2 rc:sm:top-[12vh] rc:sm:-translate-x-1/2 rc:sm:rounded-2xl rc:sm:border rc:sm:border-border',
            width === 'sm' ? 'rc:sm:w-[400px]' : 'rc:sm:w-[480px]',
          )}
        >
          <div className="rc:flex rc:items-start rc:justify-between rc:gap-4 rc:px-5 rc:pt-5 rc:pb-3">
            <div>
              <DialogPrimitive.Title className="rc:text-base rc:font-semibold">{title}</DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="rc:mt-1 rc:text-[13px] rc:text-muted">
                  {description}
                </DialogPrimitive.Description>
              ) : (
                <DialogPrimitive.Description className="rc:sr-only">{title}</DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close asChild>
              <IconButton label={strings.close} size="sm">
                <X className="rc:size-4" />
              </IconButton>
            </DialogPrimitive.Close>
          </div>
          <div className="rc-scroll rc:min-h-0 rc:flex-1 rc:overflow-y-auto rc:px-5 rc:pb-4">{children}</div>
          {footer && (
            <div className="rc:flex rc:justify-end rc:gap-2 rc:border-t rc:border-border rc:px-5 rc:py-3">
              {footer}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/* --------------------------------------------------------------------------- Menu */

export const Menu = MenuPrimitive.Root;
export const MenuTrigger = MenuPrimitive.Trigger;

export function MenuContent({
  children,
  align = 'end',
  side,
  onCloseAutoFocus,
}: {
  children: ReactNode;
  align?: 'start' | 'end' | 'center';
  side?: 'top' | 'bottom';
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const root = useThemeRoot();
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        {...root}
        align={align}
        side={side}
        sideOffset={6}
        onCloseAutoFocus={onCloseAutoFocus}
        collisionPadding={8}
        className={cx(
          root.className,
          'rc-pop rc:z-[1002] rc:min-w-44 rc:overflow-hidden rc:rounded-xl rc:border rc:border-border rc:bg-surface rc:p-1 rc:text-fg rc:shadow-[var(--rc-shadow)]',
        )}
      >
        {children}
      </MenuPrimitive.Content>
    </MenuPrimitive.Portal>
  );
}

export function MenuItem({
  children,
  icon,
  onSelect,
  danger = false,
  disabled = false,
}: {
  children: ReactNode;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <MenuPrimitive.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cx(
        'rc:flex rc:h-8 rc:cursor-pointer rc:items-center rc:gap-2.5 rc:rounded-lg rc:px-2.5 rc:text-[13px] rc:outline-none rc:data-[highlighted]:bg-surface-2 rc:data-[disabled]:opacity-40',
        danger ? 'rc:text-danger' : 'rc:text-fg',
      )}
    >
      {icon && <span className="rc:text-muted">{icon}</span>}
      {children}
    </MenuPrimitive.Item>
  );
}

export function MenuSeparator() {
  return <MenuPrimitive.Separator className="rc:my-1 rc:h-px rc:bg-border" />;
}

export { MenuPrimitive };

/* ------------------------------------------------------------------------ Popover */

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export function PopoverContent({
  children,
  side = 'top',
  align = 'end',
  label,
  onOpenAutoFocus,
}: {
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  label: string;
  onOpenAutoFocus?: (event: Event) => void;
}) {
  const root = useThemeRoot();
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        {...root}
        aria-label={label}
        side={side}
        align={align}
        sideOffset={8}
        collisionPadding={8}
        onOpenAutoFocus={onOpenAutoFocus}
        className={cx(
          root.className,
          'rc-pop rc:z-[1003] rc:overflow-hidden rc:rounded-2xl rc:border rc:border-border rc:bg-surface rc:text-fg rc:shadow-[var(--rc-shadow)]',
        )}
      >
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}
