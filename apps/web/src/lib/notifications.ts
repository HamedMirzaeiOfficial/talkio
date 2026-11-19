const KEY = 'talkio:notifications';

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function notificationsEnabled(): boolean {
  try {
    return notificationsSupported() && localStorage.getItem(KEY) === 'on';
  } catch {
    return false;
  }
}

export async function setNotificationsEnabled(enabled: boolean): Promise<boolean> {
  if (!notificationsSupported()) return false;
  if (enabled && Notification.permission !== 'granted') {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return false;
  }
  try {
    localStorage.setItem(KEY, enabled ? 'on' : 'off');
  } catch {
    /* ignore */
  }
  return enabled;
}
