import { Loader2 } from 'lucide-react';
import { t } from '../lib/i18n';

export function FullScreenSpinner() {
  return (
    <div className="grid h-full place-items-center" role="status" aria-label={t('Loading')}>
      <Loader2 className="size-6 animate-spin text-subtle" />
    </div>
  );
}
