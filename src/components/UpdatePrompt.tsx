import { APP_NAME } from '../config/brand';
import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { Button } from './ui';

/**
 * Registers the service worker (app-shell caching only) and offers a reload
 * when a new version of the app has been deployed.
 */
export function UpdatePrompt() {
  const [update, setUpdate] = useState<null | ((reload?: boolean) => Promise<void>)>(null);
  useEffect(() => {
    if (import.meta.env.DEV) return;
    const updateSW = registerSW({
      onNeedRefresh() {
        setUpdate(() => updateSW);
      },
    });
  }, []);
  if (!update) return null;
  return (
    <div className="toasts" style={{ bottom: 'auto', top: 16 }}>
      <div className="toast" role="status">
        <span style={{ flex: 1 }}>A new version of {APP_NAME} is available.</span>
        <Button size="sm" onClick={() => void update(true)}>
          Reload
        </Button>
      </div>
    </div>
  );
}
