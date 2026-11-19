/**
 * Authentication adapters.
 *
 * The SDK never stores credentials. Adapters ask the host application for them at
 * request time, so tokens stay wherever the host keeps them (memory, httpOnly cookies).
 */
export interface AuthAdapter {
  /** fetch() credentials mode. 'include' sends cookies (session auth). */
  credentials?: RequestCredentials;
  /** Extra headers for a request (e.g. Authorization or X-CSRFToken). */
  getHeaders?(request: {
    method: string;
    url: string;
  }): Record<string, string> | Promise<Record<string, string>>;
  /**
   * When true, the SDK obtains a short-lived single-use ticket from `POST /ws-ticket/`
   * before each WebSocket connection. Required whenever cookies cannot reach the socket
   * endpoint (bearer tokens, cross-site backends).
   */
  useSocketTicket?: boolean;
  /** Called when the server answers 401/403 not_authenticated or closes the socket with 4401. */
  onUnauthorized?(): void;
}

export interface SessionAuthOptions {
  csrfCookieName?: string;
  csrfHeaderName?: string;
  /** Endpoint that sets the CSRF cookie when it is missing (GET). */
  csrfUrl?: string;
  useSocketTicket?: boolean;
  onUnauthorized?: () => void;
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  for (const part of document.cookie.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

/** Django session cookie + CSRF double-submit. The default for same-site deployments. */
export function sessionAuth(options: SessionAuthOptions = {}): AuthAdapter {
  const cookieName = options.csrfCookieName ?? 'csrftoken';
  const headerName = options.csrfHeaderName ?? 'X-CSRFToken';
  return {
    credentials: 'include',
    useSocketTicket: options.useSocketTicket ?? false,
    onUnauthorized: options.onUnauthorized,
    async getHeaders({ method }) {
      if (!UNSAFE.has(method)) return {};
      let token = readCookie(cookieName);
      if (!token && options.csrfUrl) {
        await fetch(options.csrfUrl, { credentials: 'include' });
        token = readCookie(cookieName);
      }
      return token ? { [headerName]: token } : {};
    },
  };
}

export interface BearerAuthOptions {
  /** Returns the current access token (the host owns refresh and storage). */
  getToken(): string | null | Promise<string | null>;
  scheme?: string;
  onUnauthorized?: () => void;
}

/** Authorization header from a host-provided token getter. Uses socket tickets. */
export function bearerAuth(options: BearerAuthOptions): AuthAdapter {
  return {
    credentials: 'omit',
    useSocketTicket: true,
    onUnauthorized: options.onUnauthorized,
    async getHeaders(): Promise<Record<string, string>> {
      const token = await options.getToken();
      return token ? { Authorization: `${options.scheme ?? 'Bearer'} ${token}` } : {};
    },
  };
}
