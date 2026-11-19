import type { ChatMessage, Sticker } from '@realtime-chat/client';
import {
  CornerUpLeft,
  Mic,
  Paperclip,
  Pencil,
  SendHorizontal,
  Smile,
  Trash2,
  X,
  Keyboard,
} from 'lucide-react';
import type { ClipboardEvent, DragEvent, KeyboardEvent } from 'react';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

import { useChatContext } from '../context.js';
import { useChatClient, useChatConfig, useMediaQuery } from '../hooks.js';
import { cx, formatBytes, formatDuration } from '../utils.js';
import { AttachmentPreview } from './AttachmentPreview.js';
import type { MediaTab } from './media/MediaPanel.js';
import { MediaPanel } from './media/MediaPanel.js';
import { useVoiceRecorder, voiceRecordingSupported } from './media/useVoiceRecorder.js';
import { IconButton, Popover, PopoverContent, PopoverTrigger } from './primitives.js';

const drafts = new Map<string, string>();
const TYPING_IDLE_MS = 3000;

export interface MessageComposerProps {
  conversationId: string;
  replyTo?: ChatMessage | null;
  onCancelReply?: () => void;
  editing?: ChatMessage | null;
  onCancelEdit?: () => void;
  /** ArrowUp in an empty composer: edit your last message. */
  onEditLast?: () => void;
  onSent?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  className?: string;
}

export interface MessageComposerHandle {
  focus(): void;
  addFiles(files: File[]): void;
}

interface PickedFile {
  file: File;
  preview: string | null;
}

export const MessageComposer = forwardRef<MessageComposerHandle, MessageComposerProps>(
  function MessageComposer(
    {
      conversationId,
      replyTo,
      onCancelReply,
      editing,
      onCancelEdit,
      onEditLast,
      onSent,
      placeholder,
      autoFocus = false,
      disabled = false,
      className,
    },
    ref,
  ) {
    const client = useChatClient();
    const config = useChatConfig();
    const { strings, preferences } = useChatContext();
    const [text, setText] = useState(() => drafts.get(conversationId) ?? '');
    const [files, setFiles] = useState<PickedFile[]>([]);
    const [problems, setProblems] = useState<string[]>([]);
    const [dragging, setDragging] = useState(false);
    const [saving, setSaving] = useState(false);
    const area = useRef<HTMLTextAreaElement>(null);
    const fileInput = useRef<HTMLInputElement>(null);
    const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const maxLength = config?.limits.max_message_length ?? 4000;
    const attachmentsEnabled = config?.features.attachments !== false;

    const stopTyping = useCallback(() => {
      if (typingTimer.current) clearTimeout(typingTimer.current);
      typingTimer.current = null;
      client.setTyping(conversationId, false);
    }, [client, conversationId]);

    // Switch drafts with the conversation.
    useEffect(() => {
      setText(drafts.get(conversationId) ?? '');
      setFiles([]);
      setProblems([]);
      return () => stopTyping();
    }, [conversationId, stopTyping]);

    useEffect(() => {
      if (editing) {
        setText(editing.body);
        const timer = setTimeout(() => {
          area.current?.focus();
          area.current?.setSelectionRange(editing.body.length, editing.body.length);
        }, 0);
        return () => clearTimeout(timer);
      }
    }, [editing]);

    useEffect(() => {
      if (!replyTo) return;
      // Deferred: the message menu's focus trap is still active during this commit.
      const timer = setTimeout(() => area.current?.focus(), 0);
      return () => clearTimeout(timer);
    }, [replyTo]);

    useEffect(() => {
      const el = area.current;
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }, [text]);

    useEffect(() => () => files.forEach((f) => f.preview && URL.revokeObjectURL(f.preview)), []); // eslint-disable-line react-hooks/exhaustive-deps

    const addFiles = useCallback(
      (list: File[]) => {
        if (!attachmentsEnabled || list.length === 0) return;
        const allowed = config?.allowed_attachment_types;
        const maxSize = config?.limits.max_attachment_size ?? Infinity;
        const maxCount = config?.limits.max_attachments_per_message ?? 10;
        const errors: string[] = [];
        const accepted: PickedFile[] = [];
        for (const file of list) {
          if (allowed && !allowed.includes(file.type))
            errors.push(`${file.name} ${strings.fileTypeNotAllowed}`);
          else if (file.size > maxSize)
            errors.push(`${file.name} ${strings.fileTooLarge} (${formatBytes(maxSize)})`);
          else
            accepted.push({
              file,
              preview:
                file.type.startsWith('image/') && URL.createObjectURL ? URL.createObjectURL(file) : null,
            });
        }
        setFiles((current) => [...current, ...accepted].slice(0, maxCount));
        setProblems(errors);
      },
      [attachmentsEnabled, config, strings],
    );

    useImperativeHandle(ref, () => ({ focus: () => area.current?.focus(), addFiles }), [addFiles]);

    const updateText = (value: string) => {
      setText(value);
      if (!editing) drafts.set(conversationId, value);
      if (editing) return;
      if (value.trim()) {
        client.setTyping(conversationId, true);
        if (typingTimer.current) clearTimeout(typingTimer.current);
        typingTimer.current = setTimeout(stopTyping, TYPING_IDLE_MS);
      } else stopTyping();
    };

    const trimmed = text.trim();
    const tooLong = trimmed.length > maxLength;
    const canSend = !disabled && !tooLong && (trimmed.length > 0 || files.length > 0) && !saving;

    const stickersEnabled = config?.features.stickers !== false;
    const showMic =
      !canSend &&
      !editing &&
      attachmentsEnabled &&
      config?.features.voice !== false &&
      voiceRecordingSupported();
    const recorder = useVoiceRecorder(config?.limits.max_voice_duration ?? 600);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [pickerTab, setPickerTab] = useState<MediaTab>('emoji');
    // Phones get a panel docked under the input that replaces the on-screen keyboard.
    const sheet = useMediaQuery('(max-width: 639px)');
    const toggleSheet = () => {
      if (pickerOpen) {
        setPickerOpen(false);
        area.current?.focus();
      } else {
        area.current?.blur();
        setPickerOpen(true);
      }
    };
    const panel = (variant: 'popover' | 'sheet') => (
      <MediaPanel
        variant={variant}
        defaultTab={pickerTab}
        onTabChange={setPickerTab}
        onEmoji={(emoji) => insertText(emoji, variant === 'popover')}
        onSticker={stickersEnabled && !editing ? sendSticker : undefined}
      />
    );

    const { state: recordingState, stop: stopRecording } = recorder;
    useEffect(() => {
      if (recordingState === 'error') setProblems([strings.microphoneDenied]);
      if (recordingState !== 'recording') return;
      const onKey = (event: globalThis.KeyboardEvent) => {
        if (event.key === 'Escape') void stopRecording(false);
      };
      document.addEventListener('keydown', onKey);
      return () => document.removeEventListener('keydown', onKey);
    }, [recordingState, stopRecording, strings.microphoneDenied]);

    // Insert at the caret, keeping the selection after the inserted text.
    const insertText = (value: string, refocus = true) => {
      const el = area.current;
      const start = el?.selectionStart ?? text.length;
      const end = el?.selectionEnd ?? text.length;
      updateText(text.slice(0, start) + value + text.slice(end));
      requestAnimationFrame(() => {
        if (refocus) el?.focus();
        el?.setSelectionRange(start + value.length, start + value.length);
      });
    };

    const sendSticker = (sticker: Sticker) => {
      setPickerOpen(false);
      void client
        .sendMessage(conversationId, { sticker, replyToId: replyTo?.id ?? null })
        .catch(() => undefined);
      onCancelReply?.();
      onSent?.();
    };

    const sendVoice = async () => {
      const recorded = await recorder.stop(true);
      if (!recorded) return;
      void client
        .sendMessage(conversationId, { voice: recorded, replyToId: replyTo?.id ?? null })
        .catch(() => undefined);
      onCancelReply?.();
      onSent?.();
    };

    const submit = async () => {
      if (!canSend) return;
      if (editing) {
        if (trimmed === editing.body) return onCancelEdit?.();
        setSaving(true);
        try {
          await client.editMessage(editing.id, trimmed);
          setText(drafts.get(conversationId) ?? '');
          onCancelEdit?.();
        } catch {
          /* reported via client errors */
        } finally {
          setSaving(false);
        }
        return;
      }
      const outgoing = files.map((f) => f.file);
      files.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
      setText('');
      setFiles([]);
      setProblems([]);
      drafts.delete(conversationId);
      stopTyping();
      onCancelReply?.();
      onSent?.();
      // Optimistic: the message appears immediately; failures show "Retry" on the bubble.
      void client
        .sendMessage(conversationId, { body: trimmed, replyToId: replyTo?.id ?? null, files: outgoing })
        .catch(() => undefined);
      area.current?.focus();
    };

    const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.nativeEvent.isComposing) return; // IME composition (e.g. CJK, Persian keyboards)
      if (
        event.key === 'Enter' &&
        (event.metaKey || event.ctrlKey || (preferences.enterToSend && !event.shiftKey))
      ) {
        event.preventDefault();
        void submit();
      } else if (event.key === 'Escape') {
        if (editing) {
          event.preventDefault();
          setText(drafts.get(conversationId) ?? '');
          onCancelEdit?.();
        } else if (replyTo) {
          event.preventDefault();
          onCancelReply?.();
        }
      } else if (event.key === 'ArrowUp' && !text && !editing && onEditLast) {
        event.preventDefault();
        onEditLast();
      }
    };

    const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const pasted = Array.from(event.clipboardData.files);
      if (pasted.length) {
        event.preventDefault();
        addFiles(pasted);
      }
    };

    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      setDragging(false);
      addFiles(Array.from(event.dataTransfer.files));
    };

    const context = editing ?? replyTo;
    return (
      <div
        className={cx(
          'rc:relative rc:shrink-0 rc:border-t rc:border-border rc:bg-surface rc:px-3 rc:pt-2 rc:pb-[max(0.5rem,env(safe-area-inset-bottom))] rc:sm:px-4',
          className,
        )}
        onDragOver={(e) => {
          if (!attachmentsEnabled || !e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
        }}
        onDrop={onDrop}
      >
        {dragging && (
          <div className="rc:pointer-events-none rc:absolute rc:inset-1 rc:z-10 rc:grid rc:place-items-center rc:rounded-xl rc:border-2 rc:border-dashed rc:border-primary rc:bg-primary-soft rc:text-sm rc:font-medium rc:text-primary">
            {strings.dropFiles}
          </div>
        )}
        {context && (
          <div className="rc:mb-2 rc:flex rc:items-center rc:gap-3 rc:rounded-lg rc:bg-surface-2 rc:px-3 rc:py-1.5">
            {editing ? (
              <Pencil className="rc:size-4 rc:shrink-0 rc:text-primary" aria-hidden />
            ) : (
              <CornerUpLeft className="rc:size-4 rc:shrink-0 rc:text-primary" aria-hidden />
            )}
            <span className="rc:flex rc:min-w-0 rc:flex-1 rc:flex-col">
              <span className="rc:text-[12px] rc:font-semibold rc:text-primary">
                {editing
                  ? strings.editingMessage
                  : `${strings.replyingTo} ${context.sender?.display_name ?? ''}`}
              </span>
              <span dir="auto" className="rc:truncate rc:text-[12.5px] rc:text-muted">
                {context.body || context.attachments[0]?.name}
              </span>
            </span>
            <IconButton
              label={strings.cancel}
              size="sm"
              onClick={() => {
                if (editing) {
                  setText(drafts.get(conversationId) ?? '');
                  onCancelEdit?.();
                } else onCancelReply?.();
              }}
            >
              <X className="rc:size-4" />
            </IconButton>
          </div>
        )}
        {files.length > 0 && (
          <div className="rc:mb-2 rc:flex rc:flex-wrap rc:gap-2">
            {files.map((f, i) => (
              <AttachmentPreview
                key={`${f.file.name}-${i}`}
                local={{
                  name: f.file.name,
                  size: f.file.size,
                  type: f.file.type,
                  previewUrl: f.preview,
                  progress: 0,
                  uploaded: null,
                  voice: null,
                }}
                onRemove={() => {
                  if (f.preview) URL.revokeObjectURL(f.preview);
                  setFiles((current) => current.filter((_, index) => index !== i));
                }}
              />
            ))}
          </div>
        )}
        {problems.length > 0 && (
          <ul role="alert" className="rc:mb-2 rc:text-[12px] rc:text-danger">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        {recorder.state === 'recording' ? (
          <div className="rc:flex rc:items-center rc:gap-1.5" role="group" aria-label={strings.recording}>
            <IconButton label={strings.cancelRecording} size="lg" onClick={() => void recorder.stop(false)}>
              <Trash2 className="rc:size-5" />
            </IconButton>
            <div className="rc:flex rc:h-10 rc:flex-1 rc:items-center rc:gap-3 rc:rounded-[20px] rc:bg-surface-2 rc:px-4">
              <span
                className="rc:size-2.5 rc:shrink-0 rc:animate-pulse rc:rounded-full rc:bg-danger"
                aria-hidden
              />
              <span className="rc:text-[13px] rc:font-medium rc:text-fg rc:tabular-nums" aria-live="off">
                {formatDuration(recorder.elapsed)}
              </span>
              <span
                className="rc:flex rc:h-6 rc:flex-1 rc:items-center rc:justify-end rc:gap-[2px] rc:overflow-hidden"
                aria-hidden
              >
                {recorder.levels.map((level, i) => (
                  <span
                    key={i}
                    className="rc:w-[3px] rc:shrink-0 rc:rounded-full rc:bg-primary"
                    style={{ height: `${Math.max(10, level * 100)}%` }}
                  />
                ))}
              </span>
            </div>
            <IconButton
              label={strings.stopAndSend}
              size="lg"
              onClick={() => void sendVoice()}
              className="rc:bg-primary rc:text-primary-fg rc:hover:bg-primary rc:hover:text-primary-fg rc:hover:brightness-110"
            >
              <SendHorizontal className="rc:size-5 rc:rtl:-scale-x-100" />
            </IconButton>
          </div>
        ) : (
          <div className="rc:flex rc:items-end rc:gap-1.5">
            {attachmentsEnabled && !editing && (
              <>
                <IconButton
                  label={strings.attach}
                  size="lg"
                  disabled={disabled}
                  onClick={() => fileInput.current?.click()}
                >
                  <Paperclip className="rc:size-5" />
                </IconButton>
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  hidden
                  accept={config?.allowed_attachment_types.join(',')}
                  onChange={(e) => {
                    addFiles(Array.from(e.target.files ?? []));
                    e.target.value = '';
                  }}
                />
              </>
            )}
            <div className="rc:flex rc:min-h-10 rc:flex-1 rc:items-center rc:rounded-[20px] rc:bg-surface-2 rc:px-4 rc:py-2 rc:transition rc:focus-within:ring-1 rc:focus-within:ring-[var(--rc-ring)]">
              <textarea
                ref={area}
                rows={1}
                dir="auto"
                value={text}
                disabled={disabled}
                autoFocus={autoFocus}
                enterKeyHint={preferences.enterToSend ? 'send' : 'enter'}
                onChange={(e) => updateText(e.target.value)}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                onBlur={stopTyping}
                placeholder={placeholder ?? strings.messagePlaceholder}
                aria-label={placeholder ?? strings.messagePlaceholder}
                aria-invalid={tooLong}
                className="rc:max-h-[200px] rc:w-full rc:bg-transparent rc:outline-none rc:focus-visible:outline-none rc:text-base rc:leading-6 rc:text-fg rc:sm:text-[14px] rc:sm:leading-5"
              />
              {sheet ? (
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={stickersEnabled ? `${strings.emoji} / ${strings.stickers}` : strings.emoji}
                  aria-expanded={pickerOpen}
                  title={strings.emoji}
                  onClick={sheet ? toggleSheet : undefined}
                  className={cx(
                    'rc:-me-2 rc:ms-1 rc:grid rc:size-8 rc:shrink-0 rc:place-items-center rc:self-end rc:rounded-full rc:transition rc:hover:text-fg',
                    pickerOpen ? 'rc:text-primary' : 'rc:text-muted',
                  )}
                >
                  {sheet && pickerOpen ? <Keyboard className="rc:size-5" /> : <Smile className="rc:size-5" />}
                </button>
              ) : (
                <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      disabled={disabled}
                      aria-label={stickersEnabled ? `${strings.emoji} / ${strings.stickers}` : strings.emoji}
                      aria-expanded={pickerOpen}
                      title={strings.emoji}
                      onClick={sheet ? toggleSheet : undefined}
                      className={cx(
                        'rc:-me-2 rc:ms-1 rc:grid rc:size-8 rc:shrink-0 rc:place-items-center rc:self-end rc:rounded-full rc:transition rc:hover:text-fg',
                        pickerOpen ? 'rc:text-primary' : 'rc:text-muted',
                      )}
                    >
                      {sheet && pickerOpen ? (
                        <Keyboard className="rc:size-5" />
                      ) : (
                        <Smile className="rc:size-5" />
                      )}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent label={strings.emoji} side="top" align="end">
                    {panel('popover')}
                  </PopoverContent>
                </Popover>
              )}
            </div>
            {showMic ? (
              <IconButton
                label={strings.recordVoice}
                size="lg"
                disabled={disabled}
                onClick={() => {
                  setProblems([]);
                  stopTyping();
                  void recorder.start();
                }}
              >
                <Mic className="rc:size-5" />
              </IconButton>
            ) : (
              <IconButton
                label={editing ? strings.save : strings.send}
                size="lg"
                disabled={!canSend}
                onClick={() => void submit()}
                className={cx(
                  canSend &&
                    'rc:bg-primary rc:text-primary-fg rc:hover:bg-primary rc:hover:text-primary-fg rc:hover:brightness-110',
                )}
              >
                <SendHorizontal className="rc:size-5 rc:rtl:-scale-x-100" />
              </IconButton>
            )}
          </div>
        )}
        {sheet && pickerOpen && recorder.state !== 'recording' && (
          <div className="rc:-mx-3 rc:mt-2 rc:border-t rc:border-border rc:sm:-mx-4">{panel('sheet')}</div>
        )}
        {trimmed.length > maxLength * 0.9 && (
          <p
            className={cx(
              'rc:mt-1 rc:text-end rc:text-[11px] rc:tabular-nums',
              tooLong ? 'rc:text-danger' : 'rc:text-subtle',
            )}
            aria-live="polite"
          >
            {trimmed.length}/{maxLength}
          </p>
        )}
      </div>
    );
  },
);
