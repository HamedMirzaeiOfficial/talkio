import { useCallback, useEffect, useRef, useState } from 'react';

export interface RecordedVoice {
  file: File;
  duration: number;
  waveform: number[];
}

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'];
const SAMPLE_MS = 80;
const WAVEFORM_BARS = 64;

export function voiceRecordingSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

/** Reduce raw RMS samples to `bars` values in 0–100 (peak-normalized). */
export function toWaveform(samples: number[], bars = WAVEFORM_BARS): number[] {
  if (samples.length === 0) return [];
  const size = Math.max(1, samples.length / bars);
  const out: number[] = [];
  for (let i = 0; i < Math.min(bars, samples.length); i += 1) {
    const chunk = samples.slice(
      Math.floor(i * size),
      Math.max(Math.floor((i + 1) * size), Math.floor(i * size) + 1),
    );
    out.push(Math.max(...chunk));
  }
  const peak = Math.max(...out, 1e-6);
  return out.map((v) => Math.round((v / peak) * 100));
}

/**
 * MediaRecorder + an AnalyserNode for live levels. `stop(true)` resolves with the file,
 * its duration and a waveform; `stop(false)` discards. Stops automatically at maxSeconds.
 */
export function useVoiceRecorder(maxSeconds: number) {
  const [state, setState] = useState<'idle' | 'recording' | 'error'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const session = useRef<{
    recorder: MediaRecorder;
    stream: MediaStream;
    context: AudioContext;
    chunks: Blob[];
    samples: number[];
    startedAt: number;
    timer: ReturnType<typeof setInterval>;
    done: Promise<Blob>;
  } | null>(null);

  const cleanup = useCallback(() => {
    const current = session.current;
    if (!current) return;
    clearInterval(current.timer);
    current.stream.getTracks().forEach((t) => t.stop());
    void current.context.close().catch(() => undefined);
    session.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const stop = useCallback(
    async (keep: boolean): Promise<RecordedVoice | null> => {
      const current = session.current;
      if (!current) return null;
      const duration = (performance.now() - current.startedAt) / 1000;
      if (current.recorder.state !== 'inactive') current.recorder.stop();
      const blob = await current.done;
      const samples = current.samples;
      cleanup();
      setState('idle');
      setElapsed(0);
      setLevels([]);
      if (!keep || duration < 0.5) return null;
      const type = (blob.type || current.recorder.mimeType || 'audio/webm').split(';')[0]!;
      const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
      return {
        file: new File([blob], `voice-${Date.now()}.${ext}`, { type }),
        duration: Math.min(duration, maxSeconds),
        waveform: toWaveform(samples),
      };
    },
    [cleanup, maxSeconds],
  );

  const start = useCallback(async () => {
    if (session.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      const mimeType = MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported?.(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
      const buffer = new Float32Array(analyser.fftSize);
      const chunks: Blob[] = [];
      const samples: number[] = [];
      recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
      const done = new Promise<Blob>((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType }));
      });
      const startedAt = performance.now();
      const timer = setInterval(() => {
        analyser.getFloatTimeDomainData(buffer);
        let sum = 0;
        for (const v of buffer) sum += v * v;
        const rms = Math.sqrt(sum / buffer.length);
        samples.push(rms);
        setLevels((prev) => [...prev.slice(-39), Math.min(1, rms * 4)]);
        const seconds = (performance.now() - startedAt) / 1000;
        setElapsed(seconds);
        if (seconds >= maxSeconds) void stop(true);
      }, SAMPLE_MS);
      recorder.start(250);
      session.current = { recorder, stream, context, chunks, samples, startedAt, timer, done };
      setState('recording');
    } catch {
      cleanup();
      setState('error');
    }
  }, [cleanup, maxSeconds, stop]);

  return { state, elapsed, levels, start, stop };
}
