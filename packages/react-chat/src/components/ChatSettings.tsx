import { Monitor, Moon, Sun } from 'lucide-react';

import type { ThemeMode } from '../context.js';
import { useChatContext } from '../context.js';
import { cx } from '../utils.js';
import { Switch } from './primitives.js';

/** Chat preferences bound to <ChatProvider> (controlled or persisted to localStorage). */
export function ChatSettings({ className, showTheme = true }: { className?: string; showTheme?: boolean }) {
  const { preferences, setPreferences, strings } = useChatContext();
  const themes: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
    { value: 'system', label: strings.themeSystem, icon: Monitor },
    { value: 'light', label: strings.themeLight, icon: Sun },
    { value: 'dark', label: strings.themeDark, icon: Moon },
  ];
  return (
    <div className={cx('rc:flex rc:flex-col rc:gap-4', className)}>
      {showTheme && (
        <fieldset className="rc:flex rc:flex-col rc:gap-2">
          <legend className="rc:mb-2 rc:text-sm rc:font-medium rc:text-fg">{strings.theme}</legend>
          <div role="radiogroup" aria-label={strings.theme} className="rc:grid rc:grid-cols-3 rc:gap-2">
            {themes.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={preferences.theme === value}
                onClick={() => setPreferences({ theme: value })}
                className={cx(
                  'rc:flex rc:h-16 rc:flex-col rc:items-center rc:justify-center rc:gap-1.5 rc:rounded-ui rc:border rc:text-[13px] rc:transition',
                  preferences.theme === value
                    ? 'rc:border-primary rc:bg-primary-soft rc:text-primary'
                    : 'rc:border-border rc:text-muted rc:hover:bg-surface-2',
                )}
              >
                <Icon className="rc:size-4" />
                {label}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      <div className="rc:divide-y rc:divide-border">
        <Switch
          id="rc-enter-to-send"
          checked={preferences.enterToSend}
          onCheckedChange={(v) => setPreferences({ enterToSend: v })}
          label={strings.enterToSend}
          hint={strings.enterToSendHint}
        />
        <Switch
          id="rc-compact"
          checked={preferences.compact}
          onCheckedChange={(v) => setPreferences({ compact: v })}
          label={strings.compactMode}
          hint={strings.compactModeHint}
        />
      </div>
    </div>
  );
}
