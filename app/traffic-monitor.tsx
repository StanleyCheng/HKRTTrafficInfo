'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Image from 'next/image';
import { ArrowUpRight, Clock3, CloudRain, Gauge, Info, LoaderCircle, MapPin, Navigation, PanelLeftClose, PanelLeftOpen, RefreshCw, ShieldCheck, SlidersHorizontal, SquareParking, TrafficCone, TriangleAlert, Video, X } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { formatRecordDate, messages } from '@/lib/i18n';
import { getCameraData } from '@/lib/traffic-client';
import { Camera, CameraData, FlowSegment, Language, LayerKind, featureService, hkTime, isLiveTrafficDataFresh, kinds, layerText, layers, snapshotInventory, snapshotInventoryEn, speedLevelColors } from '@/lib/traffic';
import { cameraFromFlowSegment, displayFlowSegments, type TrafficSearchItem } from '@/lib/traffic-view';
import TrafficMap, { type Basemap } from './traffic-map';
import TrafficSearch from './traffic-search';
import TrafficStatus from './traffic-status';

type LayerState = { data?: CameraData; loading: boolean; error: boolean };
type Snapshot = { imageUrl: string; updatedAt: string | null; fetchedAt: string };
type PanelTab = 'layers' | 'search' | 'details';
const panelTabs: PanelTab[] = ['layers', 'search', 'details'];
const pinnedLayers: LayerKind[] = ['flow', 'incident', 'snapshot', 'parking'];

const icons = { redlight: TrafficCone, speed: Gauge, snapshot: Video, flow: Navigation, incident: TriangleAlert, parking: SquareParking, rainfall: CloudRain };
const languageStorageKey = 'hk-traffic-language-v1';
const basemapStorageKey = 'hk-traffic-basemap-v1';
const compactLayoutQuery = '(max-width: 700px), (max-height: 520px) and (orientation: landscape)';
const languageListeners = new Set<() => void>();
const basemapListeners = new Set<() => void>();
let fallbackLanguage: Language | undefined;
let fallbackBasemap: Basemap = 'osm';
let storageWriteFailed = false;
let basemapStorageWriteFailed = false;

function getLanguageSnapshot(): Language {
  if (storageWriteFailed && fallbackLanguage) return fallbackLanguage;
  try {
    const stored = window.localStorage.getItem(languageStorageKey);
    if (stored === 'en' || stored === 'zh') {
      fallbackLanguage = stored;
      return stored;
    }
  } catch {
    // Storage can be unavailable in locked-down browser contexts; use the browser language.
  }
  if (fallbackLanguage) return fallbackLanguage;
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

function getServerLanguageSnapshot(): Language {
  return 'zh';
}

function subscribeLanguage(listener: () => void) {
  languageListeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === languageStorageKey || event.key === null) {
      storageWriteFailed = false;
      fallbackLanguage = event.newValue === 'en' || event.newValue === 'zh' ? event.newValue : undefined;
      listener();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    languageListeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

function setStoredLanguage(language: Language) {
  fallbackLanguage = language;
  try {
    window.localStorage.setItem(languageStorageKey, language);
    storageWriteFailed = false;
  } catch {
    storageWriteFailed = true;
    // The in-memory subscription still updates the current tab when storage is unavailable.
  }
  languageListeners.forEach(listener => listener());
}

function getBasemapSnapshot(): Basemap {
  if (basemapStorageWriteFailed) return fallbackBasemap;
  try {
    const stored = window.localStorage.getItem(basemapStorageKey);
    if (stored === 'positron' || stored === 'carto') fallbackBasemap = 'positron';
    else if (stored === 'osm') fallbackBasemap = 'osm';
  } catch {
    // Storage can be unavailable in locked-down browser contexts; keep the in-memory choice.
  }
  return fallbackBasemap;
}

function getServerBasemapSnapshot(): Basemap {
  return 'osm';
}

function subscribeBasemap(listener: () => void) {
  basemapListeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === basemapStorageKey || event.key === null) {
      basemapStorageWriteFailed = false;
      fallbackBasemap = event.newValue === 'positron' || event.newValue === 'carto' ? 'positron' : 'osm';
      listener();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    basemapListeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

function setStoredBasemap(basemap: Basemap) {
  fallbackBasemap = basemap;
  try {
    window.localStorage.setItem(basemapStorageKey, basemap);
    basemapStorageWriteFailed = false;
  } catch {
    basemapStorageWriteFailed = true;
  }
  basemapListeners.forEach(listener => listener());
}

// Panel display preferences (retracted top bar, retracted layers panel) follow the
// same stored subscription pattern as the language: no hydration mismatch, no
// cross-tab drift, and a write to worn-out storage still updates this tab.
function createStoredFlag(storageKey: string) {
  const listeners = new Set<() => void>();
  let fallback = false;
  let writeFailed = false;
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      const onStorage = (event: StorageEvent) => {
        if (event.key === storageKey || event.key === null) {
          writeFailed = false;
          fallback = event.newValue === 'collapsed';
          listener();
        }
      };
      window.addEventListener('storage', onStorage);
      return () => {
        listeners.delete(listener);
        window.removeEventListener('storage', onStorage);
      };
    },
    getSnapshot(): boolean {
      if (writeFailed) return fallback;
      try {
        const stored = window.localStorage.getItem(storageKey);
        if (stored === 'collapsed' || stored === 'expanded') fallback = stored === 'collapsed';
      } catch {
        // Storage can be unavailable in locked-down browser contexts.
      }
      return fallback;
    },
    getServerSnapshot(): boolean {
      return false;
    },
    set(value: boolean) {
      fallback = value;
      try {
        window.localStorage.setItem(storageKey, value ? 'collapsed' : 'expanded');
        writeFailed = false;
      } catch {
        writeFailed = true;
      }
      listeners.forEach(listener => listener());
    },
  };
}

const topbarFlag = createStoredFlag('hk-traffic-topbar-v1');
const sidebarFlag = createStoredFlag('hk-traffic-sidebar-v1');

function SnapshotImage({ camera, language }: { camera: Camera; language: Language }) {
  const copy = messages[language];
  const [shot, setShot] = useState<Snapshot | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    let busy = false;
    async function refresh() {
      if (busy) return;
      busy = true;
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
      clearInterval(interval);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [camera.imageUrl, tick]);

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
      {shot && <Image src={shot.imageUrl} alt={copy.snapshotAlt(cameraName)} fill sizes="(max-width: 700px) 100vw, 300px" unoptimized onError={() => setError(true)}/>}
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

export default function TrafficMonitor() {
  const language = useSyncExternalStore(subscribeLanguage, getLanguageSnapshot, getServerLanguageSnapshot);
  const basemap = useSyncExternalStore(subscribeBasemap, getBasemapSnapshot, getServerBasemapSnapshot);
  const copy = messages[language];
  const numberLocale = language === 'en' ? 'en-HK' : 'zh-HK';
  const [enabled, setEnabled] = useState<Record<LayerKind, boolean>>({ flow: true, incident: true, redlight: false, speed: false, snapshot: false, parking: false, rainfall: false });
  const [states, setStates] = useState<Record<LayerKind, LayerState>>({
    flow: { loading: true, error: false },
    incident: { loading: true, error: false },
    redlight: { loading: true, error: false },
    speed: { loading: true, error: false },
    snapshot: { loading: true, error: false },
    parking: { loading: true, error: false },
    rainfall: { loading: true, error: false },
  });
  const [selectedSnapshot, setSelectedSnapshot] = useState<Camera | null>(null);
  const [showDetectors, setShowDetectors] = useState(false);
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<PanelTab>('layers');
  const [now, setNow] = useState(() => Date.now());
  const [focusTarget, setFocusTarget] = useState<TrafficSearchItem | null>(null);
  const topbarCollapsed = useSyncExternalStore(topbarFlag.subscribe, topbarFlag.getSnapshot, topbarFlag.getServerSnapshot);
  const sidebarCollapsed = useSyncExternalStore(sidebarFlag.subscribe, sidebarFlag.getSnapshot, sidebarFlag.getServerSnapshot);
  const details = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const mobilePanelButton = useRef<HTMLButtonElement>(null);
  const panelReopenButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const inflight = useRef(new Set<LayerKind>());
  const panelScroll = useRef<HTMLDivElement>(null);

  const closeMobilePanel = useCallback(() => {
    setMobilePanelOpen(false);
    setTimeout(() => mobilePanelButton.current?.focus(), 0);
  }, []);

  function toggleTopbar() {
    topbarFlag.set(!topbarCollapsed);
  }

  function toggleSidebar(collapsed: boolean) {
    sidebarFlag.set(collapsed);
    if (collapsed) requestAnimationFrame(() => panelReopenButton.current?.focus());
  }

  useEffect(() => {
    document.documentElement.lang = language === 'en' ? 'en-HK' : 'zh-HK';
  }, [language]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30000);
    const onVisible = () => { if (document.visibilityState === 'visible') setNow(Date.now()); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  useEffect(() => {
    const media = window.matchMedia(compactLayoutQuery);
    if (!mobilePanelOpen || !media.matches) return;
    const panelElement = panel.current;
    if (!panelElement) return;
    const focusable = () => Array.from(panelElement.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter(element => element.getClientRects().length > 0);
    const focusFirst = requestAnimationFrame(() => focusable()[0]?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMobilePanel();
        return;
      }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      if (!elements.length) {
        event.preventDefault();
        return;
      }
      const first = elements[0];
      const last = elements.at(-1)!;
      if (event.shiftKey && (document.activeElement === first || !panelElement.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !panelElement.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!panelElement.contains(event.target as Node)) focusable()[0]?.focus();
    };
    const onLayoutChange = (event: MediaQueryListEvent) => {
      if (!event.matches) closeMobilePanel();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);
    media.addEventListener('change', onLayoutChange);
    return () => {
      cancelAnimationFrame(focusFirst);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn);
      media.removeEventListener('change', onLayoutChange);
    };
  }, [closeMobilePanel, mobilePanelOpen]);

  const fetchLayer = useCallback(async (kind: LayerKind) => {
    if (inflight.current.has(kind)) return;
    inflight.current.add(kind);
    setStates(state => ({ ...state, [kind]: { ...state[kind], loading: true, error: false } }));
    try {
      const data = await getCameraData(kind);
      setStates(state => ({ ...state, [kind]: { data, loading: false, error: false } }));
    } catch {
      setStates(state => ({ ...state, [kind]: { ...state[kind], loading: false, error: true } }));
    } finally {
      inflight.current.delete(kind);
    }
  }, []);

  useEffect(() => {
    kinds.forEach(kind => fetchLayer(kind));
    const flowInterval = setInterval(() => {
      if (document.visibilityState === 'visible') fetchLayer('flow');
    }, 120000);
    const otherInterval = setInterval(() => {
      if (document.visibilityState === 'visible') kinds.filter(kind => kind !== 'flow').forEach(kind => fetchLayer(kind));
    }, 300000);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') kinds.forEach(kind => fetchLayer(kind));
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearInterval(flowInterval);
      clearInterval(otherInterval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [fetchLayer]);

  const segments = useMemo(() => displayFlowSegments(states.flow.data?.segments, states.flow.data?.segmentsUpdated, now), [states.flow.data, now]);
  const flowFresh = isLiveTrafficDataFresh(states.flow.data?.segmentsUpdated, now);
  const cameras = useMemo(() => kinds.flatMap(kind => {
    if (!enabled[kind]) return [];
    if (kind === 'flow') return showDetectors ? (states.flow.data?.cameras ?? []).map(camera => flowFresh ? camera : { ...camera, speedKmh: null, level: 'unknown' as const, color: speedLevelColors.unknown }) : [];
    return states[kind].data?.cameras ?? [];
  }), [states, enabled, showDetectors, flowFresh]);
  const selected = useMemo(() => {
    if (!selectedSnapshot?.id.startsWith('flow-segment-')) {
      const latestCamera = selectedSnapshot && states[selectedSnapshot.kind].data?.cameras.find(camera => camera.id === selectedSnapshot.id);
      const camera = latestCamera ?? selectedSnapshot;
      return camera?.kind === 'flow' && !flowFresh ? { ...camera, speedKmh: null, level: 'unknown' as const, color: speedLevelColors.unknown } : camera;
    }
    const segment = segments.find(candidate => candidate.id === selectedSnapshot.id);
    return segment ? cameraFromFlowSegment(segment, states.flow.data?.segmentsUpdated) : null;
  }, [selectedSnapshot, states, segments, flowFresh]);
  const searchItems = useMemo<TrafficSearchItem[]>(() => [
    ...segments.map(segment => ({ camera: cameraFromFlowSegment(segment, states.flow.data?.segmentsUpdated), segment })),
    ...kinds.filter(kind => kind !== 'flow').flatMap(kind => (states[kind].data?.cameras ?? []).map(camera => ({ camera }))),
  ], [segments, states]);
  const total = kinds.reduce((count, kind) => count + (states[kind].data?.count ?? 0), 0);
  const loading = kinds.some(kind => states[kind].loading);
  const errors = kinds.some(kind => states[kind].error);
  const complete = kinds.every(kind => states[kind].data?.complete) && !errors;
  const times = kinds.flatMap(kind => states[kind].data ? [states[kind].data!.fetchedAt] : []).sort();
  const latest = times[0];
  const activeKinds = kinds.filter(kind => enabled[kind]);
  const activeErrors = activeKinds.some(kind => states[kind].error);
  const activeLoading = activeKinds.some(kind => states[kind].loading);
  const activeFetched = activeKinds.flatMap(kind => states[kind].data ? [states[kind].data!.fetchedAt] : []).sort()[0];

  function toggle(kind: LayerKind) {
    setEnabled(current => ({ ...current, [kind]: !current[kind] }));
    if (selected?.kind === kind && enabled[kind]) setSelectedSnapshot(null);
  }

  const choose = useCallback((camera: Camera) => {
    setSelectedSnapshot(camera);
    setPanelTab('details');
    sidebarFlag.set(false);
    if (window.matchMedia(compactLayoutQuery).matches) setMobilePanelOpen(true);
    const keyboardSelection = document.activeElement?.matches(':focus-visible');
    requestAnimationFrame(() => {
      panelScroll.current?.scrollTo({ top: 0 });
      if (keyboardSelection) details.current?.focus({ preventScroll: true });
    });
  }, []);

  const onSelectSegment = useCallback((segment: FlowSegment) => {
    choose(cameraFromFlowSegment(segment, states.flow.data?.segmentsUpdated));
  }, [choose, states.flow.data?.segmentsUpdated]);

  function selectSearchItem(item: TrafficSearchItem) {
    setEnabled(current => ({ ...current, [item.camera.kind]: true }));
    setFocusTarget({ ...item });
    choose(item.camera);
  }

  function switchPanelTab(tab: PanelTab) {
    setPanelTab(tab);
    panelScroll.current?.scrollTo({ top: 0 });
  }

  const selectedName = selected && (language === 'en' ? selected.nameEn || selected.name : selected.name);
  const selectedDistrict = selected && (language === 'en' ? selected.districtEn || selected.district : selected.district);
  const selectedRegion = selected && (language === 'en' ? selected.regionEn || selected.region : selected.region);
  const basemapAction = basemap === 'osm' ? copy.switchToPositron : copy.switchToOsm;

  return <main className={sidebarCollapsed ? 'app-shell sidebar-collapsed' : 'app-shell'}>
    <header className={topbarCollapsed ? 'topbar collapsed' : 'topbar'} inert={mobilePanelOpen || undefined}>
      <div className="brand">
        <button type="button" className="brand-toggle" aria-expanded={!topbarCollapsed} aria-label={topbarCollapsed ? copy.expandTopbar : copy.collapseTopbar} title={topbarCollapsed ? copy.expandTopbar : copy.collapseTopbar} onClick={toggleTopbar}><span className="brand-icon"><Image src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/app-icon-192.png`} alt="" width={43} height={43} priority/></span></button>
        <div className="brand-copy"><h1><span className="brand-full">{copy.brandTitle}</span><span className="brand-compact">{copy.brandCompactTitle}</span></h1></div>
      </div>
      <div className="header-meta">
        {states.flow.loading && !states.flow.data && <span className="live-loading-dot" role="status" title={copy.loadingLiveSpeeds} aria-label={copy.loadingLiveSpeeds}/>}
        <span className="official-tag"><ShieldCheck size={15}/>{copy.officialData}</span>
        <div className="language-toggle" role="group" aria-label={copy.languageControl}>
          <button type="button" aria-pressed={language === 'en'} aria-label={copy.english} title={copy.english} onClick={() => setStoredLanguage('en')}>EN</button>
          <button type="button" aria-pressed={language === 'zh'} aria-label={copy.chinese} title={copy.chinese} onClick={() => setStoredLanguage('zh')}>繁</button>
        </div>
        <button type="button" className="basemap-toggle" aria-label={`${copy.mapStyle}: ${basemap === 'osm' ? copy.mapStyleStreet : copy.mapStyleLight}. ${basemapAction}`} title={basemapAction} onClick={() => setStoredBasemap(basemap === 'osm' ? 'positron' : 'osm')}><span className="map-style-label">{copy.mapStyle}: </span>{basemap === 'osm' ? copy.mapStyleStreet : copy.mapStyleLight}</button>
        <button className="source-button" aria-label={copy.sources} onClick={() => dialog.current?.showModal()}><Info size={17}/><span>{copy.sources}</span></button>
      </div>
    </header>
    <div className="workspace">
      <button className={`mobile-scrim ${mobilePanelOpen ? 'visible' : ''}`} aria-label={copy.closeControls} aria-hidden="true" tabIndex={-1} onClick={closeMobilePanel}/>
      <aside ref={panel} className={`sidebar ${mobilePanelOpen ? 'mobile-open' : ''}`} aria-label={copy.sidebarLabel} role={mobilePanelOpen ? 'dialog' : undefined} aria-modal={mobilePanelOpen || undefined}>
        <div className="panel-head"><h2>{panelTab === 'details' && selected ? selectedName : copy.overviewTitle}</h2><button type="button" className="sidebar-toggle" aria-label={copy.collapseSidebar} title={copy.collapseSidebar} onClick={() => toggleSidebar(true)}><PanelLeftClose size={19}/></button><button className="mobile-panel-close close-button" aria-label={copy.closeControls} onClick={closeMobilePanel}><X size={19}/></button></div>
        <div className="panel-tabs" role="tablist" aria-label={copy.panelNavigation}>
          {panelTabs.map(tab => <button key={tab} type="button" id={`panel-tab-${tab}`} role="tab" aria-selected={panelTab === tab} aria-controls={`panel-${tab}`} tabIndex={panelTab === tab ? 0 : -1} onClick={() => switchPanelTab(tab)} onKeyDown={event => {
            const index = panelTabs.indexOf(tab);
            const next = event.key === 'ArrowRight' ? (index + 1) % panelTabs.length : event.key === 'ArrowLeft' ? (index + panelTabs.length - 1) % panelTabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? panelTabs.length - 1 : null;
            if (next === null) return;
            event.preventDefault();
            switchPanelTab(panelTabs[next]);
            document.getElementById(`panel-tab-${panelTabs[next]}`)?.focus();
          }}>{tab === 'layers' ? copy.mapLayers : tab === 'search' ? copy.searchTab : copy.cameraDetails}</button>)}
        </div>
        <div className="sidebar-scroll" ref={panelScroll}>
          <section id="panel-layers" role="tabpanel" aria-labelledby="panel-tab-layers" hidden={panelTab !== 'layers'}>
          <div className="summary" aria-live="polite"><strong>{total ? total.toLocaleString(numberLocale) : loading ? '—' : '0'}</strong><span>{copy.publishedLocations}</span>{complete && <small>{copy.completeInventory}</small>}</div>
          <div className="section-label"><h3>{copy.mapLayers}</h3><span>{copy.showingLocations(cameras.length.toLocaleString(numberLocale))}</span></div>
          <div className="layer-list">{kinds.map(kind => {
            const text = layerText(kind, language);
            const state = states[kind];
            const Icon = icons[kind];
            return <div key={kind} className={`layer-card ${kind} ${enabled[kind] ? 'active' : ''}`}>
              <button className="layer-toggle" role="switch" aria-checked={enabled[kind]} aria-label={copy.layerSwitch(text.name)} onClick={() => toggle(kind)}>
                <span className="layer-symbol"><Icon size={21}/></span><span className="layer-copy"><strong>{text.name}</strong><span>{text.caption}</span></span>
                <span className="layer-count">{state.loading && !state.data ? <LoaderCircle size={16} className="spin"/> : !enabled[kind] ? '—' : state.data ? state.data.count.toLocaleString(numberLocale) : '!'}</span><span className="switch"/>
              </button>
              {kind === 'flow' && enabled.flow && state.data && state.data.count > 0 && (
                <button className={`detector-toggle ${showDetectors ? 'active' : ''}`} role="switch" aria-checked={showDetectors} aria-label={copy.showDetectors} onClick={() => setShowDetectors(v => !v)}>
                  <span>{copy.showDetectors} <span className="detector-count">{state.data.count.toLocaleString(numberLocale)}</span></span>
                  <span className="switch"/>
                </button>
              )}
              {kind === 'flow' && state.data?.segmentsComplete === false && state.data.segmentsExpectedCount !== undefined && (
                <div className="flow-coverage">{copy.flowCoverage((state.data.segments?.length ?? 0).toLocaleString(numberLocale), state.data.segmentsExpectedCount.toLocaleString(numberLocale))}</div>
              )}
              {state.error && <div className="layer-error" role="alert">{state.data ? copy.layerUpdateFailed : copy.dataLoadFailed} <button className="text-button" onClick={() => fetchLayer(kind)}>{copy.retry}</button></div>}
              {state.data?.count === 0 && kind !== 'incident' && <div className="layer-error">{copy.noOfficialLocations}</div>}
              {kind === 'incident' && state.data && (
                state.data.notices?.length ? <details className="incident-notices">
                  <summary>{copy.incidentListTitle(state.data.notices.length.toLocaleString(numberLocale))}</summary>
                  <ul>{state.data.notices.map(notice => <li key={notice.id}>
                    <span className="notice-text">{language === 'en' ? notice.textEn || notice.text : notice.text || notice.textEn}</span>
                    <span className="notice-meta">
                      <time>{hkTime(notice.time, false, language)}</time>
                      {notice.cameraId
                        ? <button className="text-button" onClick={() => { const target = state.data?.cameras.find(camera => camera.id === notice.cameraId); if (target) selectSearchItem({ camera: target }); }}>{copy.incidentViewOnMap}</button>
                        : <em>{copy.incidentNoLocation}</em>}
                    </span>
                  </li>)}
                  </ul>
                </details> : <div className="incident-empty">{copy.incidentEmpty}</div>
              )}
            </div>;
          })}</div>
          <p className="layer-note">{copy.layerNote}</p>
          </section>
          <section id="panel-search" role="tabpanel" aria-labelledby="panel-tab-search" hidden={panelTab !== 'search'}>
            <TrafficSearch items={searchItems} language={language} selected={selected} loading={loading} onSelect={selectSearchItem}/>
          </section>
          <section id="panel-details" role="tabpanel" aria-labelledby="panel-tab-details" hidden={panelTab !== 'details'}>
          <div ref={details} className="detail" tabIndex={-1} aria-label={selectedName || copy.cameraDetails}>
            <div className="selection-label"><h3>{copy.cameraDetails}</h3>{selected && <button type="button" className="clear-selection" onClick={() => { setSelectedSnapshot(null); switchPanelTab('layers'); document.getElementById('panel-tab-layers')?.focus(); }}>{copy.clearSelection}</button>}</div>
            {selected ? <>
              <div className="detail-kind"><span className="color-dot" style={{ background: selected.color ?? layers[selected.kind].color }}/>{layerText(selected.kind, language).name}<span>／ {selected.sourceId}</span></div>
              <h4>{selectedName}</h4>
              {selected.kind === 'snapshot' && <SnapshotImage camera={selected} language={language} key={selected.id}/>}
              {selected.kind === 'flow' && <div className="live-figure">
                <strong style={{ color: speedLevelColors[selected.level ?? 'unknown'] }}>{selected.speedKmh === null || selected.speedKmh === undefined ? '—' : selected.speedKmh}<small>km/h</small></strong>
                <span className="level-badge" style={{ background: speedLevelColors[selected.level ?? 'unknown'] }}>{copy.speedLevels[selected.level ?? 'unknown']}</span>
                <span className="live-label">{copy.speedNow}</span>
              </div>}
              {selected.kind === 'parking' && <div className="live-figure">
                <strong>{selected.vacancy === null || selected.vacancy === undefined ? '—' : selected.vacancy.toLocaleString(numberLocale)}</strong>
                <span className="live-label">{selected.vacancy === null || selected.vacancy === undefined ? copy.parkingNoLive : copy.parkingSpaces}</span>
              </div>}
              {selected.kind === 'parking' && selected.remarks && <p className="detail-address">{selected.remarks}</p>}
              {selected.kind === 'rainfall' && selected.rainfallMm !== undefined && <div className="live-figure">
                <strong>{selected.rainfallMm}</strong>
                <span className="live-label">{copy.millimetres(String(selected.rainfallMm))} · {copy.rainfallAmount}</span>
              </div>}
              {selected.kind === 'incident' && <p className="incident-text">{(language === 'en' ? selected.textEn || selected.text : selected.text || selected.textEn)?.trim()}</p>}
              <dl>
                {selectedDistrict && <><dt>{copy.district}</dt><dd>{selectedRegion ? `${selectedRegion} · ` : ''}{selectedDistrict}</dd></>}
                {selected.kind === 'flow' && selected.remarks && <><dt>{selected.id.startsWith('flow-segment-') ? copy.routeNumberLabel : copy.directionLabel}</dt><dd>{selected.remarks}</dd></>}
                {selected.kind === 'flow' && selected.speedLimitKmh !== undefined && <><dt>{copy.speedLimitLabel}</dt><dd>{selected.speedLimitKmh} km/h</dd></>}
                {selected.kind === 'parking' && selected.heightLimit !== undefined && <><dt>{copy.heightLimitLabel}</dt><dd>{copy.metres(String(selected.heightLimit))}</dd></>}
                {selected.kind === 'parking' && selected.openingStatus && <><dt>{copy.openingStatusLabel}</dt><dd>{selected.openingStatus}</dd></>}
                <dt>{copy.coordinates}</dt><dd>{selected.lat.toFixed(6)}, {selected.lng.toFixed(6)}</dd>
                {selected.sourceUpdated && <><dt>{copy.recordUpdated}</dt><dd>{formatRecordDate(selected.sourceUpdated, language)}</dd></>}
                {selected.kind !== 'flow' && selected.kind !== 'parking' && selected.remarks && <><dt>{copy.officialRemarks}</dt><dd>{selected.remarks}</dd></>}
                {selected.dataUpdated && <><dt>{copy.liveDataTime}</dt><dd>{hkTime(selected.dataUpdated, true, language)}</dd></>}
              </dl>
              {(selected.kind === 'redlight' || selected.kind === 'speed') && <p className="detail-note">{copy.layerDetail[selected.kind]}</p>}
              {selected.kind === 'flow' && <p className="detail-note">{copy.speedLayerNote}</p>}
              {selected.kind === 'rainfall' && <p className="detail-note">{copy.rainfallNote}</p>}
              {selected.kind === 'incident' && <p className="detail-note">{copy.incidentApproxNote}</p>}
              <a className="detail-source" href={layers[selected.kind].source} target="_blank" rel="noreferrer">{copy.officialSource} <ArrowUpRight size={13}/></a>
            </> : <div className="empty-detail"><div className="empty-icon"><MapPin size={26}/></div><h4>{copy.emptyDetailTitle}</h4><p>{copy.emptyDetailBody}</p></div>}
          </div>
          </section>
        </div>
        <footer className="sidebar-footer"><div className="connection" aria-live="polite"><span className={`connection-dot ${errors ? 'warning' : ''}`}/>{loading ? copy.loadingOfficialData : errors ? copy.partialUpdateFailure : latest ? copy.inventoryFetched(hkTime(latest, false, language)) : copy.noData}</div><button className="icon-button" title={copy.refreshAll} aria-label={copy.refreshAll} disabled={loading} onClick={() => kinds.forEach(kind => fetchLayer(kind))}><RefreshCw size={15} className={loading ? 'spin' : ''}/></button></footer>
      </aside>
      <button ref={panelReopenButton} type="button" className="panel-reopen" aria-label={copy.expandSidebar} title={copy.expandSidebar} onClick={() => { toggleSidebar(false); requestAnimationFrame(() => document.getElementById(`panel-tab-${panelTab}`)?.focus()); }}><PanelLeftOpen size={18}/></button>
      <div className={`map-workspace ${mobilePanelOpen ? 'panel-active' : ''}`} inert={mobilePanelOpen || undefined} aria-hidden={mobilePanelOpen || undefined}>
      <TrafficMap cameras={cameras} segments={enabled.flow ? segments : undefined} selected={selected} selectedSegmentId={selected?.id && selected.id.startsWith('flow-segment-') ? selected.id : null} onSelect={choose} onSelectSegment={onSelectSegment} focusTarget={focusTarget} loading={loading} allDisabled={kinds.every(kind => !enabled[kind])} hasErrors={errors} language={language} basemap={basemap} inactive={mobilePanelOpen}/>
      <TrafficStatus language={language} flowEnabled={enabled.flow} updated={states.flow.data?.segmentsUpdated} fetched={activeFetched} now={now} loading={activeLoading} error={activeErrors} mapped={segments.length} expected={states.flow.data?.segmentsExpectedCount} onRefresh={() => kinds.forEach(kind => fetchLayer(kind))}/>
      <TooltipProvider delayDuration={180} skipDelayDuration={100}>
        <nav className="desktop-layer-dock" aria-label={copy.mapLayers}>
          {kinds.map(kind => {
            const Icon = icons[kind];
            const text = layerText(kind, language);
            const state = states[kind];
            const enabledLabel = language === 'en' ? enabled[kind] ? 'On' : 'Off' : enabled[kind] ? '已開啟' : '已關閉';
            const countLabel = state.data ? `${state.data.count.toLocaleString(numberLocale)} ${copy.publishedLocations}` : copy.noData;
            return <Tooltip key={kind}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={`desktop-layer-button ${kind} ${enabled[kind] ? 'active' : ''} ${state.error ? 'error' : ''}`}
                  aria-label={`${copy.layerSwitch(text.name)}: ${enabledLabel}`}
                  aria-pressed={enabled[kind]}
                  onClick={() => toggle(kind)}
                >
                  <Icon size={22}/>
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={12} collisionPadding={16} className="layer-dock-tooltip">
                <strong>{text.name}</strong>
                <span>{enabledLabel} · {countLabel}</span>
                {state.loading && <span>{copy.loadingOfficialData}</span>}
                {state.error && <span className="tooltip-error">{state.data ? copy.layerUpdateFailed : copy.dataLoadFailed}</span>}
              </TooltipContent>
            </Tooltip>;
          })}
        </nav>
        <nav className="mobile-dock" aria-label={copy.mapLayers} aria-hidden={mobilePanelOpen || undefined} inert={mobilePanelOpen || undefined}>
          {pinnedLayers.map(kind => {
            const Icon = icons[kind];
            const text = layerText(kind, language);
            const state = states[kind];
            const enabledLabel = language === 'en' ? enabled[kind] ? 'On' : 'Off' : enabled[kind] ? '已開啟' : '已關閉';
            return <button key={kind}
                  type="button"
                  className={`mobile-layer-button ${kind} ${enabled[kind] ? 'active' : ''} ${state.error ? 'error' : ''}`}
                  aria-label={`${copy.layerSwitch(text.name)}: ${enabledLabel}`}
                  aria-pressed={enabled[kind]}
                  onClick={() => toggle(kind)}
                >
                  <Icon size={20}/><span>{text.short}</span>
                </button>;
          })}
          <button ref={mobilePanelButton} type="button" className="mobile-panel-button" aria-label={copy.openControls} aria-expanded={mobilePanelOpen} onClick={() => { if (!selected) switchPanelTab('layers'); setMobilePanelOpen(true); }}><SlidersHorizontal size={20}/><span>{selected ? copy.cameraDetails : copy.moreLayers}</span></button>
        </nav>
      </TooltipProvider>
      </div>
    </div>
    <p className="sr-only" role="status">{selectedName ? copy.selectionAnnounced(selectedName) : ''}</p>
    <dialog ref={dialog} className="sources-dialog" aria-labelledby="sources-title" onClick={event => {
      if (event.target === event.currentTarget) dialog.current?.close();
    }}>
      <div className="dialog-head"><h2 id="sources-title">{copy.sourceDialogTitle}</h2><button className="close-button" aria-label={copy.closeSources} onClick={() => dialog.current?.close()}><X size={18}/></button></div>
      <div className="dialog-body">
        {kinds.map(kind => {
          const text = layerText(kind, language);
          const data = states[kind].data;
          return <details className="source-entry" key={kind}>
            <summary><span className="color-dot" style={{ background: layers[kind].color }}/>{text.name}</summary>
            <p>{copy.sourceDescriptions[kind]}</p>
            <a href={layers[kind].source} target="_blank" rel="noreferrer">{copy.dataGovLink} ↗</a>
            {(kind === 'redlight' || kind === 'speed' || kind === 'snapshot') && <a href={kind === 'snapshot' ? language === 'en' ? snapshotInventoryEn : snapshotInventory : featureService(kind) + '?f=pjson'} target="_blank" rel="noreferrer">{kind === 'snapshot' ? copy.locationXml : copy.officialApi} ↗</a>}
            {data && <div className="source-check">{kind === 'incident' ? `${copy.incidentMapped(data.count.toLocaleString(numberLocale), data.expectedCount.toLocaleString(numberLocale))} · ${copy.inventoryFetched(hkTime(data.fetchedAt, true, language))}${states[kind].error ? ` · ${copy.layerUpdateFailed}` : ''}` : copy.sourceChecked(data.count.toLocaleString(numberLocale), data.expectedCount.toLocaleString(numberLocale), hkTime(data.fetchedAt, true, language), states[kind].error)}</div>}
            {kind === 'flow' && data?.segmentsExpectedCount !== undefined && <div className="source-check">{copy.flowCoverage((data.segments?.length ?? 0).toLocaleString(numberLocale), data.segmentsExpectedCount.toLocaleString(numberLocale))}</div>}
          </details>;
        })}
        <p className="dialog-footnote">{copy.sourceFootnote}</p>
        <p className="dialog-footnote">{copy.basemap}{basemap === 'positron' && <><a href="https://openfreemap.org/" target="_blank" rel="noreferrer">{copy.openFreeMapPositron}</a> · <a href="https://openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a> · </>}<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">{copy.osmContributors}</a>{copy.nonGovernmentBasemap}<a href="https://data.gov.hk/tc/terms-and-conditions" target="_blank" rel="noreferrer">{copy.governmentTerms}</a>.</p>
      </div>
    </dialog>
  </main>;
}
