import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Register } from './Register';

function renderRegister() {
  const router = createMemoryRouter(
    [
      { path: '/register', element: <Register /> },
      { path: '/app', element: <p>workspace</p> },
    ],
    { initialEntries: ['/register'] },
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('Register', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('validates locally before calling the server', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderRegister();
    await userEvent.type(screen.getByLabelText('Username'), 'a');
    await userEvent.type(screen.getByLabelText('Password'), 'short');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'different');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByText('Use 3–30 letters, numbers, dots or underscores.')).toBeInTheDocument();
    expect(screen.getByText('Tell people what to call you.')).toBeInTheDocument();
    expect(screen.getByText('Passwords do not match.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows field errors returned by the server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: { code: 'username_taken', message: 'This username is taken.', field: 'username' },
            }),
            { status: 409 },
          ),
      ),
    );
    renderRegister();
    await userEvent.type(screen.getByLabelText('Display name'), 'Nora');
    await userEvent.type(screen.getByLabelText('Username'), 'alice');
    await userEvent.type(screen.getByLabelText('Password'), 'Long-enough-1');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'Long-enough-1');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('This username is taken.')).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toHaveAttribute('aria-invalid', 'true');
  });
});
