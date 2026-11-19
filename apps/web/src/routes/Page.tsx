import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { t } from '../lib/i18n';

export function Page({ title, children, back }: { title: string; children: ReactNode; back?: boolean }) {
  const navigate = useNavigate();
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-bg/90 px-4 backdrop-blur md:px-8">
        {back && (
          <button
            type="button"
            aria-label={t('Back')}
            onClick={() => navigate(-1)}
            className="grid size-8 place-items-center rounded-ui text-muted hover:bg-surface-2 hover:text-fg"
          >
            <ArrowLeft className="size-5 rtl:rotate-180" />
          </button>
        )}
        <h1 className="text-[17px] font-semibold tracking-tight text-fg">{title}</h1>
      </header>
      <div className="mx-auto w-full max-w-2xl px-4 py-6 md:px-8 md:py-8">{children}</div>
    </div>
  );
}

export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-6 rounded-xl border border-border bg-surface p-5">
      <h2 className="text-[15px] font-semibold text-fg">{title}</h2>
      {description && <p className="mt-1 text-[13px] text-muted">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}
