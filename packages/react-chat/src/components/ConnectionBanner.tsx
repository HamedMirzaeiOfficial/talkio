import { RefreshCw, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useChatContext } from '../context.js';
import { useChatClient, useConnection } from '../hooks.js';
import { cx } from '../utils.js';

/** Explains degraded connectivity. Hidden while connected or during the very first connect. */
export function ConnectionBanner({ className }: { className?: string }) {
  const client = useChatClient();
  const connection = useConnection();
  const { strings } = useChatContext();
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!connection.nextRetryAt) return;
    const tick = () => setSeconds(Math.max(0, Math.ceil((connection.nextRetryAt! - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [connection.nextRetryAt]);

  const { status } = connection;
  if (
    status === 'open' ||
    status === 'idle' ||
    (status === 'connecting' && !connection.everConnected) ||
    status === 'closed'
  )
    return null;
  const unauthenticated = status === 'unauthenticated';
  const text = unauthenticated
    ? strings.unauthenticated
    : status === 'offline'
      ? strings.offlineBanner
      : strings.reconnecting;
  return (
    <div
      role="status"
      className={cx(
        'rc-enter rc:flex rc:shrink-0 rc:items-center rc:gap-2 rc:border-b rc:px-4 rc:py-2 rc:text-[13px]',
        className,
        unauthenticated
          ? 'rc:border-danger/30 rc:bg-danger/10 rc:text-danger'
          : 'rc:border-warning/30 rc:bg-warning/10 rc:text-fg',
      )}
    >
      {status === 'offline' ? (
        <WifiOff className="rc:size-4 rc:shrink-0" aria-hidden />
      ) : (
        <RefreshCw
          className={cx('rc:size-4 rc:shrink-0', !unauthenticated && 'rc:animate-spin')}
          aria-hidden
        />
      )}
      <span className="rc:flex-1">
        {text}
        {!unauthenticated && seconds > 0 && <span className="rc:text-muted"> · {seconds}s</span>}
      </span>
      {!unauthenticated && (
        <button
          type="button"
          onClick={() => client.socket.reconnectNow()}
          className="rc:font-medium rc:text-primary rc:hover:underline"
        >
          {strings.retryNow}
        </button>
      )}
    </div>
  );
}
