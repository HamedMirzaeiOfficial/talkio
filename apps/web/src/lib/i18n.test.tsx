import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { Register } from '../routes/Register';
import { getLang, intlLocale, setLang, t } from './i18n';

describe('i18n', () => {
  afterEach(() => setLang('en'));

  it('translates with placeholders and falls back to English', () => {
    setLang('fa');
    expect(t('Continue with {name}', { name: 'GitHub' })).toBe('ادامه با GitHub');
    expect(t('Not in the dictionary')).toBe('Not in the dictionary');
    expect(intlLocale()).toBe('fa-IR');
  });

  it('sets the document language and direction', () => {
    setLang('fa');
    expect(getLang()).toBe('fa');
    expect(document.documentElement.lang).toBe('fa');
    expect(document.documentElement.dir).toBe('rtl');
    setLang('en');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('renders a page in Persian', () => {
    setLang('fa');
    const router = createMemoryRouter([{ path: '/register', element: <Register /> }], {
      initialEntries: ['/register'],
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('heading', { name: 'حساب خود را بسازید' })).toBeInTheDocument();
    expect(screen.getByLabelText('نام نمایشی')).toBeInTheDocument();
  });
});
