'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { Clock3, LoaderCircle, RefreshCw } from 'lucide-react';
import { messages } from '@/lib/i18n';
import { type Camera, type Language, hkTime } from '@/lib/traffic';

type Snapshot = { imageUrl: string; updatedAt: string | null; fetchedAt: string };

export default function SnapshotImage({ camera, language, onActivity }: { camera: Camera; language: Language; onActivity: () => () => void }) {
  const copy = messages[language];
  const [shot, setShot] = useState<Snapshot | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    let busy = false;
    let finishActivity = () => {};
    async function refresh() {
      if (busy) return;
      busy = true;
      finishActivity = onActivity();
      setLoading(true);
      setError(false);
      try {
        if (!camera.imageUrl) throw new Error('Snapshot URL is unavailable');
        const response = await fetch(camera.imageUrl, {
          cache: 'no-store',
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(55000)]),
        });
        if (!response.ok || !response.headers.get('Content-Type')?.toLowerCase().startsWith('image/')) throw new Error('Snapshot request failed');
        const blob = await response.blob();
        const imageUrl = URL.createObjectURL(blob);
        try {
          const image = new window.Image();
          image.src = imageUrl;
          await image.decode();
        } catch (error) {
          URL.revokeObjectURL(imageUrl);
          throw error;
        }
        if (abort.signal.aborted) {
          URL.revokeObjectURL(imageUrl);
          return;
        }
        const modified = response.headers.get('Last-Modified');
        setShot({
          imageUrl,
          updatedAt: modified && Number.isFinite(Date.parse(modified)) ? new Date(modified).toISOString() : null,
          fetchedAt: new Date().toISOString(),
        });
      } catch {
        if (!abort.signal.aborted) setError(true);
      } finally {
        finishActivity();
        busy = false;
        if (!abort.signal.aborted) setLoading(false);
      }
    }
    refresh();
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, 120000);
    const visible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      abort.abort();
      finishActivity();
      clearInterval(interval);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [camera.imageUrl, tick, onActivity]);

  useEffect(() => {
    const imageUrl = shot?.imageUrl;
    return () => {
      if (imageUrl?.startsWith('blob:')) URL.revokeObjectURL(imageUrl);
    };
  }, [shot?.imageUrl]);

  const stale = Boolean(shot?.updatedAt && Date.parse(shot.fetchedAt) - Date.parse(shot.updatedAt) > 10 * 60000);
  const cameraName = language === 'en' ? camera.nameEn || camera.name : camera.name;

  return <>
    <div className="snapshot-frame">
      {shot && <Image src={shot.imageUrl} alt={copy.snapshotAlt(cameraName)} fill sizes="(max-width: 700px) 100vw, 300px" style={{ objectFit: 'contain' }} unoptimized onError={() => setError(true)}/>}
      {loading && !shot && <div className="image-status" aria-live="polite"><LoaderCircle size={18} className="spin"/>{copy.loadingSnapshot}</div>}
      {error && <div className="image-status" role="alert"><div>{shot ? copy.snapshotDisplayFailed : copy.snapshotTimeout}<br/><button className="text-button" onClick={() => setTick(value => value + 1)}>{copy.reloadSnapshot}</button></div></div>}
    </div>
    <div className="snapshot-meta">
      <span className={`image-update ${stale ? 'stale' : ''}`}><Clock3 size={12}/>{shot?.updatedAt ? copy.snapshotUpdated(hkTime(shot.updatedAt, true, language)) : shot ? copy.snapshotNoUpdateTime : copy.snapshotWaiting}</span>
      <button className="refresh-image" title={copy.refreshSnapshot} aria-label={copy.refreshSnapshot} disabled={loading} onClick={() => setTick(value => value + 1)}><RefreshCw size={14} className={loading ? 'spin' : ''}/></button>
    </div>
    {stale && <p className="subtle warning-text">{copy.snapshotStale}</p>}
    <p className="subtle snapshot-note">{copy.snapshotNote}</p>
  </>;
}

