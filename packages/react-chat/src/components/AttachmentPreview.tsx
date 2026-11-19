import type { Attachment, LocalAttachment } from '@realtime-chat/client';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Download, FileText, Film, Music, X } from 'lucide-react';
import { useState } from 'react';

import { useChatContext, useThemeRoot } from '../context.js';
import { useAttachmentUrl } from '../hooks.js';
import { cx, formatBytes } from '../utils.js';
import { VoicePlayer } from './media/VoicePlayer.js';
import { IconButton, Skeleton } from './primitives.js';

export interface AttachmentPreviewProps {
  attachment?: Attachment;
  /** A not-yet-sent upload (shows progress). */
  local?: LocalAttachment;
  /** On outgoing (colored) bubbles. */
  onAccent?: boolean;
  onRemove?: () => void;
  className?: string;
}

function kindIcon(type: string) {
  if (type.startsWith('video/')) return <Film className="rc:size-5" />;
  if (type.startsWith('audio/')) return <Music className="rc:size-5" />;
  return <FileText className="rc:size-5" />;
}

export function AttachmentPreview({
  attachment,
  local,
  onAccent = false,
  onRemove,
  className,
}: AttachmentPreviewProps) {
  const name = attachment?.name ?? local?.name ?? 'file';
  const type = attachment?.content_type ?? local?.type ?? '';
  const size = attachment?.size ?? local?.size ?? 0;
  const progress = local && !local.uploaded ? local.progress : null;
  const isImage = type.startsWith('image/');
  // Images resolve their own (thumbnail / full) URLs; everything else needs the file URL.
  const { url } = useAttachmentUrl(isImage ? null : (attachment ?? null));
  const src = url ?? local?.previewUrl ?? null;

  if (attachment?.is_voice || local?.voice) {
    return (
      <VoicePlayer
        src={src}
        duration={attachment?.duration ?? local?.voice?.duration ?? null}
        waveform={attachment?.waveform ?? local?.voice?.waveform ?? null}
        onAccent={onAccent}
        progress={progress}
      />
    );
  }
  if (isImage && (attachment || local?.previewUrl)) {
    return (
      <ImageAttachment
        attachment={attachment ?? null}
        localSrc={local?.previewUrl ?? null}
        name={name}
        gif={type === 'image/gif'}
        progress={progress}
        onRemove={onRemove}
        className={className}
      />
    );
  }
  if (attachment && url && type.startsWith('audio/')) {
    return (
      <audio
        controls
        preload="none"
        src={url}
        className={cx('rc:w-64 rc:max-w-full', className)}
        aria-label={name}
      />
    );
  }
  if (attachment && url && type.startsWith('video/')) {
    return (
      <video
        controls
        preload="metadata"
        src={url}
        className={cx('rc:max-h-72 rc:w-80 rc:max-w-full rc:rounded-xl', className)}
        aria-label={name}
      />
    );
  }
  return (
    <div
      className={cx(
        'rc:relative rc:flex rc:w-64 rc:max-w-full rc:items-center rc:gap-3 rc:overflow-hidden rc:rounded-xl rc:p-2.5',
        onAccent ? 'rc:bg-white/15' : 'rc:bg-surface-2',
        className,
      )}
    >
      <span
        className={cx(
          'rc:grid rc:size-9 rc:shrink-0 rc:place-items-center rc:rounded-lg',
          onAccent ? 'rc:bg-white/20' : 'rc:bg-primary-soft rc:text-primary',
        )}
      >
        {kindIcon(type)}
      </span>
      <span className="rc:flex rc:min-w-0 rc:flex-1 rc:flex-col">
        <span dir="auto" className="rc:truncate rc:text-[13px] rc:font-medium">
          {name}
        </span>
        <span className={cx('rc:text-[11px]', onAccent ? 'rc:opacity-80' : 'rc:text-muted')}>
          {formatBytes(size)}
        </span>
      </span>
      {attachment && url && (
        <a
          href={url}
          download={name}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Download ${name}`}
          className="rc:rounded-md rc:p-1.5 rc:hover:bg-black/10"
        >
          <Download className="rc:size-4" />
        </a>
      )}
      {onRemove && (
        <IconButton label={`Remove ${name}`} size="sm" onClick={onRemove}>
          <X className="rc:size-3.5" />
        </IconButton>
      )}
      {progress !== null && <ProgressBar value={progress} />}
    </div>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <span
      className="rc:absolute rc:inset-x-0 rc:bottom-0 rc:h-0.5 rc:bg-black/10"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
    >
      <span
        className="rc:block rc:h-full rc:bg-primary rc:transition-all"
        style={{ width: `${Math.round(value * 100)}%` }}
      />
    </span>
  );
}

function ImageAttachment({
  attachment,
  localSrc,
  name,
  gif,
  progress,
  onRemove,
  className,
}: {
  attachment: Attachment | null;
  localSrc: string | null;
  name: string;
  gif: boolean;
  progress: number | null;
  onRemove?: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useThemeRoot();
  const { strings } = useChatContext();
  const thumbRef = attachment?.thumbnail_url
    ? { id: `${attachment.id}:thumb`, url: attachment.thumbnail_url }
    : attachment;
  const preview = useAttachmentUrl(thumbRef ?? null).url;
  // The full-resolution file is only fetched when the viewer opens it.
  const full = useAttachmentUrl(open || !attachment?.thumbnail_url ? attachment : null).url;
  const src = preview ?? localSrc;
  const width = attachment?.width ?? null;
  const height = attachment?.height ?? null;
  const ratio = width && height ? width / height : 4 / 3;
  return (
    <div
      className={cx('rc:relative rc:overflow-hidden rc:rounded-xl', className)}
      style={{
        width: onRemove ? 72 : Math.min(320, Math.round(240 * Math.max(0.6, Math.min(ratio, 1.6)))),
        aspectRatio: onRemove ? '1' : String(ratio),
      }}
    >
      {src ? (
        <button
          type="button"
          className="rc:block rc:size-full"
          onClick={() => !onRemove && setOpen(true)}
          aria-label={`Open ${name}`}
        >
          <img src={src} alt={name} className="rc:size-full rc:object-cover" loading="lazy" />
        </button>
      ) : (
        <Skeleton className="rc:size-full" />
      )}
      {gif && !onRemove && (
        <span className="rc:pointer-events-none rc:absolute rc:start-2 rc:top-2 rc:rounded rc:bg-black/55 rc:px-1.5 rc:py-0.5 rc:text-[10px] rc:font-bold rc:text-white">
          GIF
        </span>
      )}
      {onRemove && (
        <IconButton
          label={`Remove ${name}`}
          size="sm"
          onClick={onRemove}
          className="rc:absolute rc:end-1 rc:top-1 rc:bg-black/55 rc:text-white rc:hover:bg-black/70 rc:hover:text-white"
        >
          <X className="rc:size-3.5" />
        </IconButton>
      )}
      {progress !== null && <ProgressBar value={progress} />}
      {src && (
        <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay
              {...root}
              className={cx(root.className, 'rc-fade rc:fixed rc:inset-0 rc:z-[1000] rc:bg-black/85')}
            />
            <DialogPrimitive.Content
              {...root}
              className={cx(
                root.className,
                'rc-fade rc:fixed rc:inset-0 rc:z-[1001] rc:grid rc:place-items-center rc:p-4',
              )}
            >
              <DialogPrimitive.Title className="rc:sr-only">{name}</DialogPrimitive.Title>
              <DialogPrimitive.Description className="rc:sr-only">{name}</DialogPrimitive.Description>
              <img
                src={full ?? src}
                alt={name}
                className="rc:max-h-[88dvh] rc:max-w-full rc:rounded-lg rc:object-contain"
              />
              <div className="rc:fixed rc:end-4 rc:top-4 rc:flex rc:gap-2">
                <a
                  href={full ?? src}
                  download={name}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Download ${name}`}
                  className="rc:grid rc:size-9 rc:place-items-center rc:rounded-full rc:bg-white/10 rc:text-white rc:hover:bg-white/20"
                >
                  <Download className="rc:size-4" />
                </a>
                <DialogPrimitive.Close
                  aria-label={strings.close}
                  className="rc:grid rc:size-9 rc:place-items-center rc:rounded-full rc:bg-white/10 rc:text-white rc:hover:bg-white/20"
                >
                  <X className="rc:size-4" />
                </DialogPrimitive.Close>
              </div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
      )}
    </div>
  );
}
