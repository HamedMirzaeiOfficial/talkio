import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { t } from '../lib/i18n';

type Tone = 'error' | 'success' | 'info';
interface Toast {
  id: number;
  tone: Tone;
  message: string;
}

const ToastContext = createContext<((message: string, tone?: Tone) => void) | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);
  const recent = useRef(new Map<string, number>());

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (message: string, tone: Tone = 'info') => {
      const now = Date.now();
      if ((recent.current.get(message) ?? 0) > now - 3000) return; // collapse bursts of the same error
      recent.current.set(message, now);
      const id = (counter.current += 1);
      setToasts((all) => [...all.slice(-3), { id, tone, message }]);
      setTimeout(() => dismiss(id), tone === 'error' ? 6000 : 3500);
    },
    [dismiss],
  );
  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[2000] flex flex-col items-center gap-2 px-4 md:bottom-6"
      >
        <AnimatePresence initial={false}>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.16 }}
              role={toast.tone === 'error' ? 'alert' : 'status'}
              className="pointer-events-auto flex max-w-md items-center gap-3 rounded-xl border border-border bg-surface px-4 py-2.5 text-[13px] text-fg shadow-[var(--rc-shadow)]"
            >
              {toast.tone === 'error' ? (
                <AlertCircle className="size-4 shrink-0 text-danger" />
              ) : (
                <CheckCircle2 className="size-4 shrink-0 text-success" />
              )}
              <span className="flex-1">{toast.message}</span>
              <button
                type="button"
                aria-label={t('Dismiss')}
                onClick={() => dismiss(toast.id)}
                className="rounded p-0.5 text-subtle hover:text-fg"
              >
                <X className="size-3.5" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast outside ToastProvider');
  return value;
}
