import { Loader2 } from 'lucide-react';

export function FullScreenSpinner() {
  return (
    <div className="grid h-full place-items-center" role="status" aria-label="Loading">
      <Loader2 className="size-6 animate-spin text-subtle" />
    </div>
  );
}
