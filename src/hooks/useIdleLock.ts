import { useEffect, useRef } from 'react';

/**
 * Calls `onIdle` after `minutes` without user input, or when the app returns
 * to the foreground after being hidden for longer than that.
 */
export function useIdleLock(enabled: boolean, minutes: number, onIdle: () => void): void {
  const cb = useRef(onIdle);
  cb.current = onIdle;
  useEffect(() => {
    if (!enabled) return;
    const ms = Math.max(1, minutes) * 60_000;
    let timer = window.setTimeout(() => cb.current(), ms);
    let hiddenAt: number | null = null;
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => cb.current(), ms);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now();
      else {
        if (hiddenAt && Date.now() - hiddenAt >= ms) cb.current();
        hiddenAt = null;
        reset();
      }
    };
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, minutes]);
}
