'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import Image from 'next/image';
import { Clock3, CloudRain, Gauge, Info, LoaderCircle, MapPin, Navigation, Search, ShieldCheck, SlidersHorizontal, SquareParking, TrafficCone, TriangleAlert, Video, X } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { messages, integrationMessages } from '@/lib/i18n';
import { getCameraData } from '@/lib/traffic-client';
import { Camera, CameraData, FlowSegment, Language, LayerKind, IntegrationKind, OriginalLayerKind, featureService, hkTime, isLiveTrafficDataFresh, isFeedDataStale, isCameraDataStale, kinds, originalKinds, integrationKinds, layerGroups, layerAvailable, hostedUrl, layerText, layers, snapshotInventory, snapshotInventoryEn, speedLevelColors } from '@/lib/traffic';
import { cameraFromFlowSegment, displayFlowSegments, type TrafficSearchItem } from '@/lib/traffic-view';
import TrafficMap, { type Basemap } from './traffic-map';
import ItemDetails from './item-details';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import TrafficSearch from './traffic-search';
import TrafficStatus from './traffic-status';
import IntelPanel from './intel-panel';
import { getIntegrationData, initialViewport, pollingMs, viewportNote, withBoundarySpeeds, movingCameras, type MapViewport } from '@/lib/integration-client';
import type { BusRouteResponse, BusRouteSelection } from '@/lib/bus-route';
import { getBusRoute } from '@/lib/bus-route-client';
import { busDistanceAtTime } from '@/lib/bus-route-motion';
import { ETA_FRESH_MS } from '@/lib/place-arrivals';

type LayerState = { data?: CameraData; loading: boolean; error: boolean };
type BusRouteState = { selection: BusRouteSelection; data?: BusRouteResponse; error?: boolean; loading: boolean };

const icons = { redlight: TrafficCone, speed: Gauge, snapshot: Video, flow: Navigation, incident: TriangleAlert, parking: SquareParking, rainfall: CloudRain, crossing: Clock3, works: TrafficCone, toll: MapPin, boundary: ShieldCheck, 'weather-warning': CloudRain, mtr: Navigation, lrt: Navigation, kmb: MapPin, citybus: MapPin, gmb: MapPin, nlb: MapPin, ferry: Navigation };
const languageStorageKey = 'hk-traffic-language-v1';
const basemapStorageKey = 'hk-traffic-basemap-v1';
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

// The top bar display preference follows the
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


export default function TrafficMonitor() {
  const language = useSyncExternalStore(subscribeLanguage, getLanguageSnapshot, getServerLanguageSnapshot);
  const basemap = useSyncExternalStore(subscribeBasemap, getBasemapSnapshot, getServerBasemapSnapshot);
  const copy = messages[language];
  const extra = integrationMessages[language];
  const numberLocale = language === 'en' ? 'en-HK' : 'zh-HK';
  const [enabled, setEnabled] = useState<Record<LayerKind, boolean>>(() => Object.fromEntries(kinds.map(kind => [kind, kind === 'flow' || kind === 'incident' || (kind === 'mtr' && layerAvailable(kind))])) as Record<LayerKind, boolean>);
  const [states, setStates] = useState<Record<LayerKind, LayerState>>(() => Object.fromEntries(kinds.map(kind => [kind, { loading: originalKinds.includes(kind as OriginalLayerKind) || (kind === 'mtr' && layerAvailable(kind)), error: false }])) as Record<LayerKind, LayerState>);
  const [pendingActivity, setPendingActivity] = useState(0);
  const beginActivity = useCallback(() => {
    setPendingActivity(count => count + 1);
    let complete = false;
    return () => {
      if (complete) return;
      complete = true;
      setPendingActivity(count => count - 1);
    };
  }, []);
  const [viewport, setViewport] = useState<MapViewport>(initialViewport);
  const [dockGroup, setDockGroup] = useState<(typeof layerGroups)[number]['id']>('roads');
  const dockKinds = layerGroups.find(group => group.id === dockGroup)!.kinds;
  const [selectedSnapshot, setSelectedSnapshot] = useState<Camera | null>(null);
  const pendingDetailsFocus = useRef(false);
  const [busSelection, setBusSelection] = useState<BusRouteSelection | null>(null);
  const [busRouteState, setBusRouteState] = useState<BusRouteState | null>(null);
  const [busRouteRetry, setBusRouteRetry] = useState(0);
  const busRouteCache = useRef(new Map<string, { promise: Promise<BusRouteState>; pending: boolean }>());
  const [showDetectors, setShowDetectors] = useState(false);
  const [openControl, setOpenControl] = useState<'search' | 'layers' | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [focusTarget, setFocusTarget] = useState<TrafficSearchItem | null>(null);
  const topbarCollapsed = useSyncExternalStore(topbarFlag.subscribe, topbarFlag.getSnapshot, topbarFlag.getServerSnapshot);
  const dialog = useRef<HTMLDialogElement>(null);
  const inflight = useRef(new Set<LayerKind>());
  const refreshIntegration = useRef<(kind: IntegrationKind) => Promise<void>>(async () => {});
  const integrationContext = useRef({ enabled, viewport, language });
  const integrationPending = useRef(new Map<IntegrationKind, { key: string; controller: AbortController }>());
  const integrationLastFetch = useRef(new Map<IntegrationKind, { key: string; at: number }>());

  function toggleTopbar() {
    topbarFlag.set(!topbarCollapsed);
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

  const fetchLayer = useCallback(async (kind: LayerKind) => {
    if (!layerAvailable(kind)) return;
    if (integrationKinds.includes(kind as IntegrationKind)) return refreshIntegration.current(kind as IntegrationKind);
    if (inflight.current.has(kind)) return;
    inflight.current.add(kind);
    const finishActivity = beginActivity();
    setStates(state => ({ ...state, [kind]: { ...state[kind], loading: true, error: false } }));
    try {
      const data = await getCameraData(kind as OriginalLayerKind);
      setStates(state => ({ ...state, [kind]: { data, loading: false, error: Boolean(data.feedError) } }));
    } catch {
      setStates(state => ({ ...state, [kind]: { ...state[kind], loading: false, error: true } }));
    } finally {
      finishActivity();
      inflight.current.delete(kind);
    }
  }, [beginActivity]);

  useEffect(() => {
    originalKinds.forEach(kind => fetchLayer(kind));
    const flowInterval = setInterval(() => {
      if (document.visibilityState === 'visible') fetchLayer('flow');
    }, 120000);
    const otherInterval = setInterval(() => {
      if (document.visibilityState === 'visible') originalKinds.filter(kind => kind !== 'flow').forEach(kind => fetchLayer(kind));
    }, 300000);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') originalKinds.forEach(kind => fetchLayer(kind));
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearInterval(flowInterval);
      clearInterval(otherInterval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [fetchLayer]);

  useEffect(() => () => {
    integrationPending.current.forEach((request, kind) => {
      // Preserve transit loads through React's effect replay: their pending-key
      // guard already dedupes repeats, so replaying must not abort them.
      if (['mtr', 'lrt', 'kmb', 'citybus', 'gmb', 'nlb', 'ferry'].includes(kind)) return;
      request.controller.abort();
      integrationPending.current.delete(kind);
      integrationLastFetch.current.delete(kind);
    });
    refreshIntegration.current = async () => {};
  }, []);

  useEffect(() => {
    integrationContext.current = { enabled, viewport, language };
    integrationKinds.forEach(kind => {
      if (pollingMs[kind] > 0 && (!enabled[kind] || !layerAvailable(kind))) {
        integrationPending.current.get(kind)?.controller.abort();
        integrationPending.current.delete(kind);
        integrationLastFetch.current.delete(kind);
      }
    });
    const refresh = async (kind: IntegrationKind, force = false) => {
      if (!enabled[kind] || !layerAvailable(kind) || document.visibilityState !== 'visible') return;
      const last = integrationLastFetch.current.get(kind);
      const spatial = ['kmb', 'citybus', 'gmb', 'nlb'].includes(kind);
      // Transit envelopes are bilingual and localized at render time, so the key
      // tracks only the viewport: language toggles keep in-flight requests alive.
      const key = spatial ? `${viewport.lng}:${viewport.lat}:${viewport.zoom}` : '';
      const pending = integrationPending.current.get(kind);
      if (pending && pending.key === key) return;
      if (!force && last?.key === key && Date.now() - last.at < pollingMs[kind]) return;
      integrationPending.current.get(kind)?.controller.abort();
      const request = { key, controller: new AbortController() };
      integrationPending.current.set(kind, request);
      const finishActivity = beginActivity();
      const isCurrent = () => {
        const current = integrationContext.current;
        const currentKey = spatial ? `${current.viewport.lng}:${current.viewport.lat}:${current.viewport.zoom}` : '';
        return integrationPending.current.get(kind) === request && current.enabled[kind] && currentKey === key;
      };
      integrationLastFetch.current.set(kind, { key, at: Date.now() });
      setStates(state => ({ ...state, [kind]: { ...state[kind], loading: true } }));
      try {
        const data = await getIntegrationData(kind, viewport, language, request.controller.signal);
        if (!isCurrent()) return;
        // A bus feed surfaces total failures as data.stale=true + a
        // non-parenthetical feedError; partial misses leave data.stale=false
        // and only set feedError to "Some X (N of M)", which is a soft warning
        // rendered in the popover rather than a red banner. MTR/LRT derive their
        // failure flag from !data.complete (which already accounts for staleness).
        const partialMiss = Boolean(data.feedError && /\(\d+ of \d+\)/.test(data.feedError))
        const error = !partialMiss && (Boolean(data.stale) || Boolean(data.feedError) || ((kind === 'mtr' || kind === 'lrt') && !data.complete))
        setStates(state => ({ ...state, [kind]: { data, loading: false, error } }));
      } catch {
        if (isCurrent()) setStates(state => ({ ...state, [kind]: { ...state[kind], loading: false, error: true } }));
      } finally {
        finishActivity();
        if (integrationPending.current.get(kind) === request) integrationPending.current.delete(kind);
      }
    };
    refreshIntegration.current = kind => refresh(kind, true);
    const refreshAll = () => integrationKinds.forEach(kind => void refresh(kind));
    refreshAll();
    const timer = setInterval(refreshAll, ETA_FRESH_MS);
    document.addEventListener('visibilitychange', refreshAll);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refreshAll); };
  }, [enabled, language, viewport, beginActivity]);

  const segments = useMemo(() => displayFlowSegments(states.flow.data?.segments, states.flow.data?.segmentsUpdated, now), [states.flow.data, now]);
  const boundaryData = useMemo(() => withBoundarySpeeds(states.boundary.data, segments), [states.boundary.data, segments]);
  const displayStates = useMemo(() => ({ ...states, boundary: { ...states.boundary, data: boundaryData } }), [states, boundaryData]);
  const intelInput = useMemo(() => ({ states: Object.fromEntries(kinds.filter(kind => enabled[kind] && layerAvailable(kind)).map(kind => [kind, displayStates[kind]])), segments: enabled.flow ? segments : [], now }), [displayStates, enabled, segments, now]);
  const mtrData = enabled.mtr ? states.mtr.data : undefined;
  const lrtData = enabled.lrt ? states.lrt.data : undefined;
  const ferryData = enabled.ferry ? states.ferry.data : undefined;
  const transitFeeds = useMemo(() => ({ mtr: mtrData, lrt: lrtData, ferry: ferryData }), [mtrData, lrtData, ferryData]);
  const paths = useMemo(() => [mtrData, lrtData, ferryData].flatMap(data => data?.paths ?? []), [mtrData, lrtData, ferryData]);
  const flowFresh = isLiveTrafficDataFresh(states.flow.data?.segmentsUpdated, now);
  const cameras = useMemo(() => kinds.flatMap(kind => {
    if (!enabled[kind]) return [];
    if (kind === 'flow') return showDetectors ? (states.flow.data?.cameras ?? []).map(camera => flowFresh ? camera : { ...camera, speedKmh: null, level: 'unknown' as const, color: speedLevelColors.unknown }) : [];
    if (viewportNote(kind, viewport)) return [];
    const data = displayStates[kind].data;
    return (data?.cameras ?? []).map(camera => isFeedDataStale(kind, data, now) || isCameraDataStale(camera, now) ? { ...camera, color: speedLevelColors.unknown } : camera);
  }), [states, displayStates, enabled, showDetectors, flowFresh, viewport, now]);
  const selected = useMemo(() => {
    if (selectedSnapshot?.positionType === 'vehicle') {
      const kind = selectedSnapshot.kind as 'mtr' | 'lrt' | 'ferry';
      const data = states[kind].data;
      return data ? movingCameras(kind, data, now).find(camera => camera.id === selectedSnapshot.id) ?? null : null;
    }
    if (!selectedSnapshot?.id.startsWith('flow-segment-')) {
      const latestCamera = selectedSnapshot && displayStates[selectedSnapshot.kind].data?.cameras.find(camera => camera.id === selectedSnapshot.id);
      const camera = latestCamera ?? selectedSnapshot;
      if (camera?.kind === 'flow' && !flowFresh) return { ...camera, speedKmh: null, level: 'unknown' as const, color: speedLevelColors.unknown };
      return camera && (isFeedDataStale(camera.kind, displayStates[camera.kind].data, now) || isCameraDataStale(camera, now)) ? { ...camera, color: speedLevelColors.unknown } : camera;
    }
    const segment = segments.find(candidate => candidate.id === selectedSnapshot.id);
    return segment ? cameraFromFlowSegment(segment, states.flow.data?.segmentsUpdated) : null;
  }, [selectedSnapshot, states, displayStates, segments, flowFresh, now]);
  const activeBusSelection = busSelection && enabled[busSelection.operator] ? busSelection : null;
  const busRoute = activeBusSelection && busRouteState?.selection === activeBusSelection ? busRouteState.data : undefined;
  useEffect(() => {
    if (!activeBusSelection) return;
    const selection = activeBusSelection;
    const key = JSON.stringify([selection.operator, selection.company, selection.route, selection.stopId, selection.bound, selection.serviceType, selection.routeId, selection.routeSeq, selection.stopSeq]);
    let disposed = false;
    const refresh = async () => {
      if (disposed || document.visibilityState !== 'visible') return;
      let cached = busRouteCache.current.get(key);
      if (!cached || !cached.pending) {
        const previous = cached;
        const promise = getBusRoute(selection).then<BusRouteState>(data => {
          if (!data.ok) throw new Error(data.error || 'Bus route unavailable');
          return { selection, data, error: Boolean(data.error || data.stale), loading: false };
        }).catch(async () => {
          const retained = await previous?.promise;
          return { selection, data: retained?.data ? { ...retained.data, stale: true, vehicle: null } : undefined, error: true, loading: false };
        });
        const entry = { promise, pending: true };
        void promise.then(() => { entry.pending = false; });
        busRouteCache.current.set(key, entry);
        cached = entry;
      }
      const pending = cached.pending;
      setBusRouteState(previous => ({ selection, data: previous?.selection === selection ? previous.data : undefined, loading: pending }));
      const state = await cached.promise;
      if (!disposed) setBusRouteState({ ...state, selection });
    };
    // Keep the selected route schedule live alongside the transit layers.
    void refresh();
    const timer = setInterval(() => void refresh(), 30000);
    const visible = () => void refresh();
    document.addEventListener('visibilitychange', visible);
    return () => { disposed = true; clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [activeBusSelection, busRouteRetry]);
  const searchItems = useMemo<TrafficSearchItem[]>(() => [
    ...segments.map(segment => ({ camera: cameraFromFlowSegment(segment, states.flow.data?.segmentsUpdated), segment })),
    ...kinds.filter(kind => kind !== 'flow' && layerAvailable(kind) && !viewportNote(kind, viewport)).flatMap(kind => (displayStates[kind].data?.cameras ?? []).map(camera => ({ camera }))),
  ], [segments, states, displayStates, viewport]);
  const total = kinds.reduce((count, kind) => count + (states[kind].data?.count ?? 0), 0);
  const loading = kinds.some(kind => (originalKinds.includes(kind as OriginalLayerKind) || enabled[kind]) && states[kind].loading);
  const appBusy = pendingActivity > 0;
  const errors = kinds.some(kind => enabled[kind] && states[kind].error);
  const complete = kinds.filter(kind => enabled[kind]).every(kind => states[kind].data?.complete) && !errors;
  const activeKinds = kinds.filter(kind => enabled[kind]);
  const activeErrors = activeKinds.some(kind => states[kind].error);
  const activeLoading = activeKinds.some(kind => states[kind].loading);
  const activeFetched = activeKinds.flatMap(kind => states[kind].data ? [states[kind].data!.fetchedAt] : []).sort()[0];

  function refreshAllLayers() {
    kinds.forEach(kind => void fetchLayer(kind));
    if (activeBusSelection) setBusRouteRetry(value => value + 1);
  }

  function toggle(kind: LayerKind) {
    if (!layerAvailable(kind)) return;
    if (enabled[kind]) setStates(state => ({ ...state, [kind]: { ...state[kind], loading: false } }));
    if (enabled[kind] && busSelection?.operator === kind) setBusSelection(null);
    setEnabled(current => ({ ...current, [kind]: !current[kind] }));
    if (selected?.kind === kind && enabled[kind]) setSelectedSnapshot(null);
  }

  const closeDetails = useCallback(() => {
    pendingDetailsFocus.current = false;
    setSelectedSnapshot(null);
  }, []);

  const focusDetails = useCallback((content: HTMLElement) => {
    if (pendingDetailsFocus.current) content.focus({ preventScroll: true });
    pendingDetailsFocus.current = false;
  }, []);

  const choose = useCallback((camera: Camera) => {
    pendingDetailsFocus.current = Boolean(document.activeElement?.matches(':focus-visible'));
    setSelectedSnapshot(camera);
    setOpenControl(null);
  }, []);

  const onSelectSegment = useCallback((segment: FlowSegment) => {
    choose(cameraFromFlowSegment(segment, states.flow.data?.segmentsUpdated));
  }, [choose, states.flow.data?.segmentsUpdated]);

  const showBusRoute = useCallback((camera: Camera, tracking: BusRouteSelection) => {
    pendingDetailsFocus.current = false;
    setEnabled(current => ({ ...current, [camera.kind]: true }));
    setBusSelection(tracking);
    setSelectedSnapshot(null);
    setOpenControl(null);
  }, []);

  function selectSearchItem(item: TrafficSearchItem) {
    setEnabled(current => ({ ...current, [item.camera.kind]: true }));
    setFocusTarget({ ...item });
    choose(item.camera);
  }

  const selectedName = selected && (language === 'en' ? selected.nameEn || selected.name : selected.name);
  const basemapAction = basemap === 'osm' ? copy.switchToPositron : copy.switchToOsm;

  const routeLoading = Boolean(activeBusSelection && (busRouteState?.selection !== activeBusSelection || busRouteState.loading));
  const routeError = Boolean(activeBusSelection && busRouteState?.selection === activeBusSelection && busRouteState.error);
  const routeControlLabel = activeBusSelection ? `${copy.mapLayers} · ${extra.selectedBusRoute} ${activeBusSelection.route}${routeLoading ? ` · ${extra.loadingBusRoute}` : routeError ? ` · ${extra.busRouteError}` : ''}` : copy.mapLayers;
  const routeStatus = activeBusSelection && <section className="bus-route-status" aria-label={`${extra.selectedBusRoute} ${activeBusSelection.route}`}>
    <div className="bus-route-heading"><strong>{extra.selectedBusRoute} · {activeBusSelection.route}</strong><button type="button" className="text-button" onClick={() => setBusSelection(null)}>{extra.closeBusRoute}</button></div>
    <div role="status" aria-live="polite">
      {routeLoading && <p><LoaderCircle size={13} className="spin"/>{extra.loadingBusRoute}</p>}
      {routeError && <p className="warning-text">{extra.busRouteError} <button type="button" className="text-button" onClick={() => setBusRouteRetry(value => value + 1)}>{copy.retry}</button></p>}
      {busRoute?.route && <><p>{busDistanceAtTime(busRoute, now) === null ? extra.noBusPosition : extra.busRouteTracking}</p><p>{extra.estimated}</p>{busRoute.route.geometry === 'stops' && <p>{extra.busRouteStops}</p>}{busRoute.stale && <p className="warning-text">{extra.stale}</p>}</>}
    </div>
  </section>;

  function renderItemDetails(camera: Camera, options?: { status: 'loading' | 'error' | 'ready'; onRetry?: () => void; onClose?: () => void }) {
    const relatedRoute = Boolean(activeBusSelection && camera.kind === activeBusSelection.operator && (camera.sourceId === activeBusSelection.stopId || busRoute?.route?.stops.some(stop => stop.id === camera.sourceId)));
    const stale = isCameraDataStale(camera, now) || (!options && (states[camera.kind].error || isFeedDataStale(camera.kind, states[camera.kind].data, now)));
    return <ItemDetails camera={camera} language={language} now={now} stale={stale} onActivity={beginActivity} activeBusSelection={activeBusSelection} routeStatus={relatedRoute ? routeStatus : undefined} status={options?.status} onRetry={options?.onRetry} onShowRoute={tracking => { showBusRoute(camera, tracking); options?.onClose?.(); }}/>;
  }

  return <main className="app-shell">
    <header className={topbarCollapsed ? 'topbar collapsed' : 'topbar'}>
      <div className="brand">
        <button type="button" className="brand-toggle" aria-expanded={!topbarCollapsed} aria-label={topbarCollapsed ? copy.expandTopbar : copy.collapseTopbar} title={topbarCollapsed ? copy.expandTopbar : copy.collapseTopbar} onClick={toggleTopbar}><span className="brand-icon"><Image src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/app-icon-192.png`} alt="" width={43} height={43} priority/></span></button>
        <div className="brand-copy"><h1><span className="brand-full">{copy.brandTitle}</span><span className="brand-compact">{copy.brandCompactTitle}</span></h1></div>
      </div>
      <div className="header-meta">
        <span className="official-tag"><ShieldCheck size={15}/>{copy.officialData}</span>
        <span className="activity-indicator-slot">{appBusy && <span className="live-loading-dot" role="status" title={copy.loadingActivity} aria-label={copy.loadingActivity}/>}</span>
        <div className="language-toggle" role="group" aria-label={copy.languageControl}>
          <button type="button" aria-pressed={language === 'en'} aria-label={copy.english} title={copy.english} onClick={() => setStoredLanguage('en')}>EN</button>
          <button type="button" aria-pressed={language === 'zh'} aria-label={copy.chinese} title={copy.chinese} onClick={() => setStoredLanguage('zh')}>繁</button>
        </div>
        <button type="button" className="basemap-toggle" aria-label={`${copy.mapStyle}: ${basemap === 'osm' ? copy.mapStyleStreet : copy.mapStyleLight}. ${basemapAction}`} title={basemapAction} onClick={() => setStoredBasemap(basemap === 'osm' ? 'positron' : 'osm')}><span className="map-style-label">{copy.mapStyle}: </span>{basemap === 'osm' ? copy.mapStyleStreet : copy.mapStyleLight}</button>
        <button className="source-button" aria-label={copy.sources} onClick={() => dialog.current?.showModal()}><Info size={17}/><span>{copy.sources}</span></button>
      </div>
    </header>
    <div className="workspace">
      <div className="map-workspace">
      <TrafficMap onActivity={beginActivity} busRoute={busRoute} paths={paths} transitFeeds={transitFeeds} onViewport={setViewport} cameras={cameras} segments={enabled.flow ? segments : undefined} selected={selected} selectedSegmentId={selected?.id && selected.id.startsWith('flow-segment-') ? selected.id : null} onSelect={choose} onSelectSegment={onSelectSegment} focusTarget={focusTarget} loading={loading} allDisabled={kinds.every(kind => !enabled[kind])} hasErrors={errors} language={language} basemap={basemap} now={now} busSelection={activeBusSelection} renderItemDetails={renderItemDetails} onCloseDetails={closeDetails} onDetailsOpen={focusDetails}/>
      <IntelPanel input={intelInput} language={language} onSelect={selectSearchItem}/>
      <TrafficStatus feeds={kinds.filter(kind => enabled[kind]).map(kind => ({ kind, ...states[kind] }))} language={language} flowEnabled={enabled.flow} updated={states.flow.data?.segmentsUpdated} fetched={activeFetched} now={now} loading={activeLoading} error={activeErrors} mapped={segments.length} expected={states.flow.data?.segmentsExpectedCount} onRefresh={refreshAllLayers}/>
      <div className="map-toolbar" role="group" aria-label={copy.openControls}>
        <Popover open={openControl === 'search'} onOpenChange={open => setOpenControl(open ? 'search' : null)}>
          <PopoverTrigger asChild><button type="button" className="toolbar-button" aria-label={copy.searchTab} title={copy.searchTab}><Search size={20}/></button></PopoverTrigger>
          <PopoverContent className="map-control-popover search-popover" side="left" align="start" sideOffset={10} collisionPadding={16} aria-labelledby="search-popover-title" onCloseAutoFocus={event => { if (selectedSnapshot) event.preventDefault(); }}>
            <div className="control-popover-head"><h2 id="search-popover-title">{copy.searchTab}</h2><button type="button" className="close-button" aria-label={copy.closeControls} onClick={() => setOpenControl(null)}><X size={18}/></button></div>
            <div className="control-popover-body"><TrafficSearch items={searchItems} language={language} selected={selected} loading={loading} onSelect={selectSearchItem}/></div>
          </PopoverContent>
        </Popover>
        <Popover open={openControl === 'layers'} onOpenChange={open => setOpenControl(open ? 'layers' : null)}>
          <PopoverTrigger asChild><button type="button" className={`toolbar-button ${routeError ? 'error' : ''}`} aria-label={routeControlLabel} title={routeControlLabel}>{routeLoading ? <LoaderCircle size={20} className="spin"/> : routeError ? <TriangleAlert size={20}/> : <SlidersHorizontal size={20}/>}</button></PopoverTrigger>
          <PopoverContent className="map-control-popover layers-popover" side="left" align="start" sideOffset={10} collisionPadding={16} aria-labelledby="layers-popover-title" onCloseAutoFocus={event => { if (selectedSnapshot) event.preventDefault(); }}>
            <div className="control-popover-head"><h2 id="layers-popover-title">{copy.mapLayers}</h2><button type="button" className="close-button" aria-label={copy.closeControls} onClick={() => setOpenControl(null)}><X size={18}/></button></div>
            <div className="control-popover-body">
              {routeStatus}
          <div className="summary" aria-live="polite"><strong>{total ? total.toLocaleString(numberLocale) : loading ? '—' : '0'}</strong><span>{copy.publishedLocations}</span>{complete && <small>{copy.completeInventory}</small>}</div>
          <div className="section-label"><h3>{copy.mapLayers}</h3><span>{copy.showingLocations(cameras.length.toLocaleString(numberLocale))}</span></div>
          <div className="layer-list">{kinds.map(kind => {
            const text = layerText(kind, language);
            const state = states[kind];
            const Icon = icons[kind];
            return <div key={kind} className={`layer-card ${kind} ${enabled[kind] ? 'active' : ''}`} style={{ '--layer-color': layers[kind].color } as CSSProperties}>
              <button className="layer-toggle" role="switch" disabled={!layerAvailable(kind)} aria-checked={enabled[kind]} aria-label={copy.layerSwitch(text.name)} onClick={() => toggle(kind)}>
                <span className="layer-symbol"><Icon size={21}/></span><span className="layer-copy"><strong>{text.name}</strong><span>{text.caption}</span></span>
                <span className="layer-count">{state.loading && !state.data ? <LoaderCircle size={16} className="spin"/> : !enabled[kind] ? '—' : state.data ? state.data.count.toLocaleString(numberLocale) : '!'}</span><span className="switch"/>
              </button>
              {!layerAvailable(kind) && <p className="layer-capability">{extra.hostedOnly} <a href={hostedUrl} target="_blank" rel="noreferrer">{extra.hostedLink} ↗</a></p>}
              {enabled[kind] && viewportNote(kind, viewport) && <p className="layer-capability">{extra[viewportNote(kind, viewport)!]}</p>}
              {enabled[kind] && kind === 'weather-warning' && state.data && <p className="layer-capability">{state.data.count ? `${state.data.count} · ${text.name}` : extra.noWarnings}</p>}
              {kind === 'flow' && enabled.flow && state.data && state.data.count > 0 && (
                <button className={`detector-toggle ${showDetectors ? 'active' : ''}`} role="switch" aria-checked={showDetectors} aria-label={copy.showDetectors} onClick={() => setShowDetectors(v => !v)}>
                  <span>{copy.showDetectors} <span className="detector-count">{state.data.count.toLocaleString(numberLocale)}</span></span>
                  <span className="switch"/>
                </button>
              )}
              {kind === 'flow' && state.data?.segmentsComplete === false && state.data.segmentsExpectedCount !== undefined && (
                <div className="flow-coverage">{copy.flowCoverage((state.data.segments?.length ?? 0).toLocaleString(numberLocale), state.data.segmentsExpectedCount.toLocaleString(numberLocale))}</div>
              )}
              {enabled[kind] && state.error && <div className="layer-error" role="alert">{state.data ? copy.layerUpdateFailed : copy.dataLoadFailed} <button className="text-button" onClick={() => fetchLayer(kind)}>{copy.retry}</button></div>}
              {state.data?.count === 0 && kind !== 'incident' && kind !== 'weather-warning' && !viewportNote(kind, viewport) && <div className="layer-error">{copy.noOfficialLocations}</div>}
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
            </div>
          </PopoverContent>
        </Popover>
        {activeBusSelection && <span className="sr-only" role="status">{extra.selectedBusRoute} {activeBusSelection.route} · {routeLoading ? extra.loadingBusRoute : routeError ? extra.busRouteError : extra.busRouteTracking}</span>}
      </div>
      <TooltipProvider delayDuration={180} skipDelayDuration={100}>
        <div className="layer-group-picker" role="group" aria-label={copy.mapLayers}>{layerGroups.map(group => <button type="button" key={group.id} aria-pressed={dockGroup === group.id} onClick={() => setDockGroup(group.id)}>{extra.groups[group.id]}</button>)}</div>
        <nav className="desktop-layer-dock" aria-label={copy.mapLayers}>
          {dockKinds.map(kind => {
            const Icon = icons[kind];
            const text = layerText(kind, language);
            const state = states[kind];
            const enabledLabel = enabled[kind] ? extra.enabled : extra.disabled;
            const countLabel = state.data ? `${state.data.count.toLocaleString(numberLocale)} ${copy.publishedLocations}` : copy.noData;
            return <Tooltip key={kind}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  style={{ '--layer-color': layers[kind].color } as CSSProperties}
                  className={`desktop-layer-button ${kind} ${enabled[kind] ? 'active' : ''} ${state.error ? 'error' : ''}`}
                  aria-label={`${copy.layerSwitch(text.name)}: ${enabledLabel}`}
                  aria-pressed={enabled[kind]}
                  disabled={!layerAvailable(kind)}
                  onClick={() => toggle(kind)}
                >
                  <Icon size={22}/><span>{text.short}</span>
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
        <nav className="mobile-dock" aria-label={copy.mapLayers}>
          <div className="mobile-layer-scroll">
            {dockKinds.map(kind => {
              const Icon = icons[kind];
              const text = layerText(kind, language);
              const state = states[kind];
              const enabledLabel = enabled[kind] ? extra.enabled : extra.disabled;
              return <button key={kind}
                    type="button"
                    className={`mobile-layer-button ${kind} ${enabled[kind] ? 'active' : ''} ${state.error ? 'error' : ''}`}
                    style={{ '--layer-color': layers[kind].color } as CSSProperties}
                    aria-label={`${copy.layerSwitch(text.name)}: ${enabledLabel}`}
                    aria-pressed={enabled[kind]}
                  disabled={!layerAvailable(kind)}
                    onClick={() => toggle(kind)}
                  >
                    <span className="mobile-layer-icon"><Icon size={20}/></span><span>{text.short}</span>
                  </button>;
            })}
          </div>
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
            <p>{copy.sourceDescriptions[kind as OriginalLayerKind] || extra.sourceText}</p>{integrationKinds.includes(kind as IntegrationKind) && <p>{extra.refreshCadence(pollingMs[kind as IntegrationKind] / 1000)}</p>}{data?.observedAt && <p>{copy.liveDataTime}: {hkTime(data.observedAt, true, language)}{isFeedDataStale(kind, data, now) ? ` · ${extra.stale}` : ""}</p>}{!layerAvailable(kind) && <p>{extra.hostedOnly} <a href={hostedUrl}>{extra.hostedLink}</a></p>}
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
