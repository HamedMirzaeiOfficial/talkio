import { Pause, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useChatContext } from '../../context.js';
import { cx, formatDuration } from '../../utils.js';

const SPEEDS = [1, 1.5, 2];

export interface VoicePlayerProps {
  src: string | null;
  duration: number | null;
  waveform: number[] | null;
  onAccent?: boolean;
  /** Upload progress 0–1 while sending. */
  progress?: number | null;
}

export function VoicePlayer({
  src,
  duration,
  waveform,
  onAccent = false,
  progress = null,
}: VoicePlayerProps) {
  const { strings } = useChatContext();
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [speed, setSpeed] = useState(1);
  const total = duration ?? 0;
  const bars = waveform?.length ? waveform : Array.from({ length: 40 }, () => 30);
  const played = total ? position / total : 0;

  useEffect(() => {
    if (audio.current) audio.current.playbackRate = speed;
  }, [speed]);

  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => setPlaying(false));
    else el.pause();
  };

  const seek = (fraction: number) => {
    const el = audio.current;
    if (!el || !total) return;
    el.currentTime = Math.max(0, Math.min(total, fraction * total));
    setPosition(el.currentTime);
  };

  return (
    <div className="rc:flex rc:w-64 rc:max-w-full rc:items-center rc:gap-2.5 rc:py-0.5" dir="ltr">
      <button
        type="button"
        onClick={toggle}
        disabled={!src}
        aria-label={playing ? strings.pause : strings.play}
        className={cx(
          'rc:grid rc:size-10 rc:shrink-0 rc:place-items-center rc:rounded-full rc:transition rc:disabled:opacity-50',
          onAccent ? 'rc:bg-white rc:text-[var(--rc-bubble-out)]' : 'rc:bg-primary rc:text-primary-fg',
        )}
      >
        {playing ? (
          <Pause className="rc:size-4" fill="currentColor" />
        ) : (
          <Play className="rc:ms-0.5 rc:size-4" fill="currentColor" />
        )}
      </button>
      <div className="rc:flex rc:min-w-0 rc:flex-1 rc:flex-col rc:gap-1">
        <div
          role="slider"
          tabIndex={src ? 0 : -1}
          aria-label={strings.kindVoice}
          aria-valuemin={0}
          aria-valuemax={Math.round(total)}
          aria-valuenow={Math.round(position)}
          aria-valuetext={`${formatDuration(position)} / ${formatDuration(total)}`}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            seek((e.clientX - rect.left) / rect.width);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') seek((position + 5) / total);
            if (e.key === 'ArrowLeft') seek((position - 5) / total);
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault();
              toggle();
            }
          }}
          className="rc:flex rc:h-7 rc:cursor-pointer rc:items-center rc:gap-[2px]"
        >
          {bars.map((value, i) => (
            <span
              key={i}
              className={cx(
                'rc:w-[3px] rc:flex-1 rc:rounded-full rc:transition-colors',
                i / bars.length < played
                  ? onAccent
                    ? 'rc:bg-white'
                    : 'rc:bg-primary'
                  : onAccent
                    ? 'rc:bg-white/40'
                    : 'rc:bg-subtle/40',
              )}
              style={{ height: `${Math.max(12, value)}%` }}
            />
          ))}
        </div>
        <div
          className={cx(
            'rc:flex rc:items-center rc:gap-2 rc:text-[11px] rc:tabular-nums',
            onAccent ? 'rc:text-out-fg/80' : 'rc:text-muted',
          )}
        >
          <span>
            {progress !== null && progress < 1
              ? `${Math.round(progress * 100)}%`
              : formatDuration(playing || position ? position : total)}
          </span>
          <button
            type="button"
            onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]!)}
            aria-label={`${strings.playbackSpeed} ${speed}×`}
            className={cx(
              'rc:rounded rc:px-1 rc:font-semibold',
              onAccent ? 'rc:bg-white/15' : 'rc:bg-surface-2',
            )}
          >
            {speed}×
          </button>
        </div>
      </div>
      {src && (
        <audio
          ref={audio}
          src={src}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setPosition(0);
          }}
          onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
          hidden
        />
      )}
    </div>
  );
}
