'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import Image from 'next/image';
import { ArrowUpRight, Clock3, CloudRain, Gauge, Info, LoaderCircle, MapPin, Navigation, PanelLeftClose, PanelLeftOpen, RefreshCw, ShieldCheck, SlidersHorizontal, SquareParking, TrafficCone, TriangleAlert, Video, X } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { formatRecordDate, messages, integrationMessages } from '@/lib/i18n';
import { getCameraData } from '@/lib/traffic-client';
import { Camera, CameraData, FlowSegment, Language, LayerKind, IntegrationKind, OriginalLayerKind, featureService, hkTime, isLiveTrafficDataFresh, isFeedDataStale, isCameraDataStale, kinds, originalKinds, integrationKinds, layerGroups, layerAvailable, hostedUrl, layerText, layers, snapshotInventory, snapshotInventoryEn, speedLevelColors } from '@/lib/traffic';
import { cameraFromFlowSegment, displayFlowSegments, type TrafficSearchItem } from '@/lib/traffic-view';
import TrafficMap, { type Basemap } from './traffic-map';
import SnapshotImage from './snapshot-image';
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
type PanelTab = 'layers' | 'search' | 'details';
const panelTabs: PanelTab[] = ['layers', 'search', 'details'];

const icons = { redlight: TrafficCone, speed: Gauge, snapshot: Video, flow: Navigation, incident: TriangleAlert, parking: SquareParking, rainfall: CloudRain, crossing: Clock3, works: TrafficCone, toll: MapPin, boundary: ShieldCheck, 'weather-warning': CloudRain, mtr: Navigation, lrt: Navigation, kmb: MapPin, citybus: MapPin, gmb: MapPin, nlb: MapPin, ferry: Navigation };
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
  const [busSelection, setBusSelection] = useState<BusRouteSelection | null>(null);
  const [busRouteState, setBusRouteState] = useState<BusRouteState | null>(null);
  const [busRouteRetry, setBusRouteRetry] = useState(0);
  const busRouteCache = useRef(new Map<string, { promise: Promise<BusRouteState>; pending: boolean }>());
  const busRouteLastRetry = useRef(0);
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
  const refreshIntegration = useRef<(kind: IntegrationKind) => Promise<void>>(async () => {});
  const integrationContext = useRef({ enabled, viewport, language });
  const integrationPending = useRef(new Map<IntegrationKind, { key: string; controller: AbortController }>());
  const integrationLastFetch = useRef(new Map<IntegrationKind, { key: string; at: number }>());
  const panelScroll = useRef<HTMLDivElement>(null);

  const closeMobilePanel = useCallback(() => {
    setMobilePanelOpen(false);
    setTimeout(() => mobilePanelButton.current?.focus(), 0);
  }, [setMobilePanelOpen]);

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
      // Preserve one-shot loads through React's effect replay.
      if (pollingMs[kind] === 0) return;
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
      const manual = pollingMs[kind] === 0;
      const last = integrationLastFetch.current.get(kind);
      if (!force && manual && last) return;
      if (manual && viewportNote(kind, viewport)) {
        setStates(state => state[kind].loading ? { ...state, [kind]: { ...state[kind], loading: false } } : state);
        return;
      }
      const spatial = ['kmb', 'citybus', 'gmb', 'nlb'].includes(kind);
      const key = `${language}:${spatial ? `${viewport.lng}:${viewport.lat}:${viewport.zoom}` : ''}`;
      const pending = integrationPending.current.get(kind);
      if (pending && (manual || pending.key === key)) return;
      if (!force && last?.key === key && Date.now() - last.at < pollingMs[kind]) return;
      integrationPending.current.get(kind)?.controller.abort();
      const request = { key, controller: new AbortController() };
      integrationPending.current.set(kind, request);
      const finishActivity = beginActivity();
      const isCurrent = () => {
        const current = integrationContext.current;
        const currentKey = `${current.language}:${spatial ? `${current.viewport.lng}:${current.viewport.lat}:${current.viewport.zoom}` : ''}`;
        return integrationPending.current.get(kind) === request && (manual || (current.enabled[kind] && currentKey === key));
      };
      integrationLastFetch.current.set(kind, { key, at: Date.now() });
      setStates(state => ({ ...state, [kind]: { ...state[kind], loading: true } }));
      try {
        const data = await getIntegrationData(kind, viewport, language, request.controller.signal);
        if (!isCurrent()) return;
        const error = Boolean(data.stale || data.feedError || ((kind === 'mtr' || kind === 'lrt') && !data.complete));
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
      return camera?.kind === 'flow' && !flowFresh ? { ...camera, speedKmh: null, level: 'unknown' as const, color: speedLevelColors.unknown } : camera;
    }
    const segment = segments.find(candidate => candidate.id === selectedSnapshot.id);
    return segment ? cameraFromFlowSegment(segment, states.flow.data?.segmentsUpdated) : null;
  }, [selectedSnapshot, states, displayStates, segments, flowFresh, now]);
  const activeBusSelection = busSelection && selected?.sourceId === busSelection.stopId && selected.kind === busSelection.operator && enabled[busSelection.operator] ? busSelection : null;
  const busRoute = activeBusSelection && busRouteState?.selection === activeBusSelection ? busRouteState.data : undefined;
  useEffect(() => {
    if (!activeBusSelection) return;
    const selection = activeBusSelection;
    const key = JSON.stringify([selection.operator, selection.company, selection.route, selection.stopId, selection.bound, selection.serviceType, selection.routeId, selection.routeSeq, selection.stopSeq]);
    const manual = busRouteRetry !== busRouteLastRetry.current;
    busRouteLastRetry.current = busRouteRetry;
    let disposed = false;
    let loaded = false;
    const refresh = async () => {
      if (disposed || loaded || document.visibilityState !== 'visible') return;
      loaded = true;
      let cached = busRouteCache.current.get(key);
      if (!cached || (manual && !cached.pending)) {
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
    const visible = () => void refresh();
    void refresh();
    document.addEventListener('visibilitychange', visible);
    return () => { disposed = true; document.removeEventListener('visibilitychange', visible); };
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
  const times = kinds.flatMap(kind => states[kind].data ? [states[kind].data!.fetchedAt] : []).sort();
  const latest = times[0];
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
    setEnabled(current => ({ ...current, [kind]: !current[kind] }));
    if (selected?.kind === kind && enabled[kind]) setSelectedSnapshot(null);
  }

  const choose = useCallback((camera: Camera) => {
    setSelectedSnapshot(camera);
    setBusSelection(camera.arrivals?.find(call => call.tracking)?.tracking ?? null);
    setPanelTab('details');
    sidebarFlag.set(false);
    if (window.matchMedia(compactLayoutQuery).matches) setMobilePanelOpen(true);
    const keyboardSelection = document.activeElement?.matches(':focus-visible');
    requestAnimationFrame(() => {
      panelScroll.current?.scrollTo({ top: 0 });
      if (keyboardSelection) details.current?.focus({ preventScroll: true });
    });
  }, [setMobilePanelOpen]);

  const onSelectSegment = useCallback((segment: FlowSegment) => {
    choose(cameraFromFlowSegment(segment, states.flow.data?.segmentsUpdated));
  }, [choose, states.flow.data?.segmentsUpdated]);

  const showBusRoute = useCallback((camera: Camera, tracking: BusRouteSelection) => {
    setSelectedSnapshot(camera);
    setBusSelection(tracking);
    if (mobilePanelOpen) closeMobilePanel();
  }, [mobilePanelOpen, closeMobilePanel]);

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
              {selected.kind === 'snapshot' && <SnapshotImage camera={selected} language={language} onActivity={beginActivity} key={selected.id}/>}
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
              {selected.estimated && <p className="detail-note">{extra.estimated}</p>}
              {activeBusSelection && <section className="bus-route-status" aria-label={`${extra.selectedBusRoute} ${activeBusSelection.route}`}>
                <div className="bus-route-heading"><strong>{extra.selectedBusRoute} · {activeBusSelection.route}</strong><button type="button" className="text-button" onClick={() => setBusSelection(null)}>{extra.closeBusRoute}</button></div>
                <div role="status" aria-live="polite">
                  {busRouteState?.selection !== activeBusSelection || busRouteState.loading ? <p><LoaderCircle size={13} className="spin"/>{extra.loadingBusRoute}</p> : null}
                  {busRouteState?.selection === activeBusSelection && busRouteState.error && <p className="warning-text">{extra.busRouteError} <button type="button" className="text-button" onClick={() => setBusRouteRetry(value => value + 1)}>{copy.retry}</button></p>}
                  {busRoute?.route && <><p>{busDistanceAtTime(busRoute, now) === null ? extra.noBusPosition : extra.busRouteTracking}</p><p>{extra.estimated}</p>{busRoute.route.geometry === 'stops' && <p>{extra.busRouteStops}</p>}{busRoute.stale && <p className="warning-text">{extra.stale}</p>}</>}
                </div>
              </section>}
              {selected.positionType === 'vehicle' && selected.kind === 'ferry' && !selected.estimated && <p className="detail-note">{extra.gps}</p>}
              {(states[selected.kind].error || isFeedDataStale(selected.kind, states[selected.kind].data, now) || isCameraDataStale(selected, now)) && <p className="warning-text">{extra.stale}</p>}
              {selected.arrivals && <section className="arrival-board"><h5>{extra.arrivals}</h5>{selected.arrivals.length ? <ul>{selected.arrivals.map((call, index) => {
                const eta = call.eta ? Date.parse(call.eta) : NaN;
                const minutes = Number.isFinite(eta) ? Math.max(0, Math.ceil((eta - now) / 60000)) : call.minutes;
                return <li key={`${call.route}-${index}`}><span className="arrival-route-choice"><strong className="arrival-route">{call.route}</strong>{call.tracking && <button type="button" className="bus-route-button" aria-pressed={Boolean(activeBusSelection && JSON.stringify(activeBusSelection) === JSON.stringify(call.tracking))} aria-label={`${extra.showBusRoute} ${call.route} · ${language === 'en' ? call.destinationEn || call.destination : call.destination}`} onClick={() => { setBusSelection(call.tracking!); if (mobilePanelOpen) closeMobilePanel(); }}>{extra.showBusRoute}</button>}</span><span className="arrival-destination">{language === 'en' ? call.destinationEn || call.destination : call.destination}{call.platform && <small>{extra.platform} {call.platform}</small>}<small>{call.timeType ? call.timeType === 'D' ? extra.departure : extra.arrival : call.scheduled ? extra.scheduled : extra.live}{(language === 'en' ? call.remarkEn : call.remark) ? ` · ${language === 'en' ? call.remarkEn : call.remark}` : ''}</small></span><strong className="arrival-minutes">{minutes ?? '—'}<small>{extra.minutes}</small></strong></li>;
              })}</ul> : <p>{extra.noArrivals}</p>}</section>}
              <dl>
                {selected.rows?.map((row, index) => <div className="detail-row" key={`${row.labelEn}-${index}`}><dt>{language === 'en' ? row.labelEn : row.label}</dt><dd>{language === 'en' ? row.valueEn || row.value : row.value}</dd></div>)}
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
        <footer className="sidebar-footer"><div className="connection" aria-live="polite"><span className={`connection-dot ${errors ? 'warning' : ''}`}/>{loading ? copy.loadingOfficialData : errors ? copy.partialUpdateFailure : latest ? copy.inventoryFetched(hkTime(latest, false, language)) : copy.noData}</div><button className="icon-button" title={copy.refreshAll} aria-label={copy.refreshAll} disabled={loading} onClick={refreshAllLayers}><RefreshCw size={15} className={loading ? 'spin' : ''}/></button></footer>
      </aside>
      <button ref={panelReopenButton} type="button" className="panel-reopen" aria-label={copy.expandSidebar} title={copy.expandSidebar} onClick={() => { toggleSidebar(false); requestAnimationFrame(() => document.getElementById(`panel-tab-${panelTab}`)?.focus()); }}><PanelLeftOpen size={18}/></button>
      <div className={`map-workspace ${mobilePanelOpen ? 'panel-active' : ''}`} inert={mobilePanelOpen || undefined} aria-hidden={mobilePanelOpen || undefined}>
      <TrafficMap onActivity={beginActivity} busRoute={busRoute} paths={paths} transitFeeds={transitFeeds} onViewport={setViewport} cameras={cameras} segments={enabled.flow ? segments : undefined} selected={selected} selectedSegmentId={selected?.id && selected.id.startsWith('flow-segment-') ? selected.id : null} onSelect={choose} onSelectSegment={onSelectSegment} focusTarget={focusTarget} loading={loading} allDisabled={kinds.every(kind => !enabled[kind])} hasErrors={errors} language={language} basemap={basemap} inactive={mobilePanelOpen} now={now} busSelection={activeBusSelection} onShowBusRoute={showBusRoute}/>
      <IntelPanel input={intelInput} language={language} onSelect={selectSearchItem}/>
      <TrafficStatus feeds={kinds.filter(kind => enabled[kind]).map(kind => ({ kind, ...states[kind] }))} language={language} flowEnabled={enabled.flow} updated={states.flow.data?.segmentsUpdated} fetched={activeFetched} now={now} loading={activeLoading} error={activeErrors} mapped={segments.length} expected={states.flow.data?.segmentsExpectedCount} onRefresh={refreshAllLayers}/>
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
        <nav className="mobile-dock" aria-label={copy.mapLayers} aria-hidden={mobilePanelOpen || undefined} inert={mobilePanelOpen || undefined}>
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
