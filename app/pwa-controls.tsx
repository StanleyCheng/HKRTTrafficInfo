'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { Download } from 'lucide-react';
import type { Language } from '@/lib/traffic';

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
const subscribeDevice = () => () => {};
const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
const subscribeDisplay = (update: () => void) => {
  const display = window.matchMedia('(display-mode: standalone)');
  display.addEventListener('change', update);
  return () => display.removeEventListener('change', update);
};

export default function PwaControls({ language }: { language: Language }) {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(false);
  const ios = useSyncExternalStore(subscribeDevice, isIos, () => false);
  const runningStandalone = useSyncExternalStore(subscribeDisplay, standalone, () => false);
  const [busy, setBusy] = useState(false);
  const en = language === 'en';
  useEffect(() => {
    const beforeInstall = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt); };
    const didInstall = () => { setInstalled(true); setPrompt(null); };
    window.addEventListener('beforeinstallprompt', beforeInstall);
    window.addEventListener('appinstalled', didInstall);
    return () => { window.removeEventListener('beforeinstallprompt', beforeInstall); window.removeEventListener('appinstalled', didInstall); };
  }, []);
  async function install() {
    if (!prompt || busy) return;
    setBusy(true);
    try { await prompt.prompt(); await prompt.userChoice; }
    catch { /* The browser menu remains available if the prompt cannot open. */ }
    finally { setPrompt(null); setBusy(false); }
  }
  return <section className="pwa-install" aria-labelledby="pwa-install-title">
    <h3 id="pwa-install-title">{en ? 'Install the traffic map' : '安裝交通地圖'}</h3>
    {installed || runningStandalone ? <p>{en ? 'The traffic map is installed.' : '交通地圖已安裝。'}</p> : prompt ? <button type="button" className="pwa-install-button" disabled={busy} onClick={install}><Download size={17}/>{en ? 'Install app' : '安裝應用程式'}</button> : <p>{ios ? (en ? 'In Safari, open Share, then choose Add to Home Screen.' : '在 Safari 開啟「分享」，然後選擇「加入主畫面」。') : (en ? 'Open your browser menu and choose Install app or Add to Home Screen, when available.' : '在瀏覽器選單選擇「安裝應用程式」或「加入主畫面」（如適用）。')}</p>}
    <p className="subtle">{en ? 'Live traffic, photos, building search and map tiles need an internet connection. An offline page helps you reconnect.' : '實時交通、快拍、大廈搜尋及地圖圖磚需要網絡連線。離線頁面會提示你重新連線。'}</p>
  </section>;
}
