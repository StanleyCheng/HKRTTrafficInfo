'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { Clock3, LoaderCircle, RefreshCw } from 'lucide-react';
import { messages } from '@/lib/i18n';
import { type Camera, type Language, hkTime } from '@/lib/traffic';
import { neutralAdjustments, snapshotAdjustments, type SnapshotAdjustments } from '@/lib/snapshot-enhancement';

type Snapshot = { imageUrl: string; updatedAt: string | null; fetchedAt: string; adjustments: SnapshotAdjustments };

export default function SnapshotImage({ camera, language, onActivity }: { camera: Camera; language: Language; onActivity: () => () => void }) {
  const copy = messages[language];
  const [shot, setShot] = useState<Snapshot | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [enhance, setEnhance] = useState(true);
  const [contrast, setContrast] = useState(true);
  const [doubled, setDoubled] = useState(false);

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
        let adjustments = neutralAdjustments;
        try {
          const image = new window.Image();
          image.src = imageUrl;
          await image.decode();
          // Sampling is optional: image availability must not depend on canvas support.
          try {
            const canvas = document.createElement('canvas');
            canvas.width = 96; canvas.height = 72;
            const context = canvas.getContext('2d', { willReadFrequently: true });
            if (context) {
              context.drawImage(image, 0, 0, 96, 72);
              adjustments = snapshotAdjustments(context.getImageData(0, 0, 96, 72).data);
            }
          } catch { /* Keep the original image if sampling is unavailable. */ }
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
          adjustments,
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
  const en = language === 'en';
  const filter = [enhance ? `brightness(${shot?.adjustments.brightness ?? 1}) saturate(1.08)` : '', contrast ? `contrast(${shot?.adjustments.contrast ?? 1})` : ''].filter(Boolean).join(' ') || 'none';

  return <>
    <div className={`snapshot-viewport${doubled ? ' snapshot-doubled' : ''}`} tabIndex={doubled ? 0 : undefined} role={doubled ? 'region' : undefined} aria-label={doubled ? (en ? 'Enlarged snapshot. Scroll to inspect the photo.' : '放大快拍。捲動以查看影像。') : undefined}>
    <div className="snapshot-frame">
      {shot && <Image src={shot.imageUrl} alt={copy.snapshotAlt(cameraName)} fill sizes="(max-width: 700px) 100vw, 600px" style={{ objectFit: 'contain', filter }} unoptimized onError={() => setError(true)}/>}
      {loading && !shot && <div className="image-status" aria-live="polite"><LoaderCircle size={18} className="spin"/>{copy.loadingSnapshot}</div>}
      {error && <div className="image-status" role="alert"><div>{shot ? copy.snapshotDisplayFailed : copy.snapshotTimeout}<br/><button className="text-button" onClick={() => setTick(value => value + 1)}>{copy.reloadSnapshot}</button></div></div>}
    </div>
    </div>
    <div className="snapshot-controls" role="group" aria-label={en ? 'Snapshot photo controls' : '快拍影像控制'}>
      <button type="button" aria-pressed={enhance} onClick={() => setEnhance(value => !value)}>{en ? 'Auto-enhance' : '自動增強'}</button>
      <button type="button" aria-pressed={contrast} onClick={() => setContrast(value => !value)}>{en ? 'Auto-contrast' : '自動對比'}</button>
      <button type="button" aria-pressed={doubled} aria-label={en ? `Photo size ${doubled ? '2×. Restore 1×' : '1×. Enlarge to 2×'}` : `影像大小 ${doubled ? '2×，回復 1×' : '1×，放大至 2×'}`} onClick={() => setDoubled(value => !value)}>{doubled ? '2×' : '1×'}</button>
    </div>
    {doubled && <p className="subtle snapshot-zoom-hint">{en ? 'Scroll the photo to explore at 2×.' : '捲動影像以查看 2× 放大快拍。'}</p>}
    <div className="snapshot-meta">
      <span className={`image-update ${stale ? 'stale' : ''}`}><Clock3 size={12}/>{shot?.updatedAt ? copy.snapshotUpdated(hkTime(shot.updatedAt, true, language)) : shot ? copy.snapshotNoUpdateTime : copy.snapshotWaiting}</span>
      <button className="refresh-image" title={copy.refreshSnapshot} aria-label={copy.refreshSnapshot} disabled={loading} onClick={() => setTick(value => value + 1)}><RefreshCw size={14} className={loading ? 'spin' : ''}/></button>
    </div>
    {stale && <p className="subtle warning-text">{copy.snapshotStale}</p>}
    <p className="subtle snapshot-note">{copy.snapshotNote}</p>
  </>;
}

