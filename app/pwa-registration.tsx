'use client';

import { useEffect, useState } from 'react';

export default function PwaRegistration() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    // Do not let a development worker interfere with hot reload or previews.
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator && window.isSecureContext) {
      const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
      navigator.serviceWorker.register(`${base}/sw.js`, { scope: `${base}/`, updateViaCache: 'none' })
        .catch(() => { /* The online map remains usable if installation is unavailable. */ });
    }
    return () => { window.removeEventListener('online', sync); window.removeEventListener('offline', sync); };
  }, []);
  return offline ? <div className="pwa-offline-status" role="status">離線 · 交通資訊暫停更新 / Offline · Traffic updates paused</div> : null;
}
