import { Link } from 'react-router-dom';
import { t } from '../lib/i18n';

export function NotFound() {
  return (
    <div className="grid h-full place-items-center p-8 text-center">
      <div>
        <p className="text-sm font-medium text-primary">404</p>
        <h1 className="mt-2 text-2xl font-semibold text-fg">{t('This page does not exist')}</h1>
        <Link to="/" className="mt-6 inline-block text-sm font-medium text-primary hover:underline">
          {t('Back to Talkio')}
        </Link>
      </div>
    </div>
  );
}
