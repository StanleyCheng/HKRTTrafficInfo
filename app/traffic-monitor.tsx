'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, lazy, Suspense, type CSSProperties } from 'react';
import Image from 'next/image';
import { Box, Clock3, CloudRain, Gauge, Info, LoaderCircle, MapPin, Navigation, Search, ShieldCheck, Layers3, SquareParking, TrafficCone, TriangleAlert, Video, X, BusFront, TramFront, Accessibility, CarTaxiFront, Radar } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { messages, integrationMessages, layerCategoryMessages } from '@/lib/i18n';
import { getCameraData } from '@/lib/traffic-client';
import { Camera, CameraData, FlowSegment, Language, LayerKind, IntegrationKind, OriginalLayerKind, featureService, hkTime, isLiveTrafficDataFresh, isFeedDataStale, isCameraDataStale, kinds, originalKinds, integrationKinds, layerGroups, layerCategories, layerCategoryKinds, layerAvailable, hostedUrl, layerText, layers, snapshotInventory, snapshotInventoryEn, speedLevelColors } from '@/lib/traffic';
import { cameraFromFlowSegment, displayFlowSegments, type TrafficSearchItem } from '@/lib/traffic-view';
import TrafficMap, { type Basemap, type TrafficMapProps } from './traffic-map';
import ItemDetails from './item-details';
import NearbyPanel from './nearby-panel';
import { useSessionField } from './use-session-field';
import { savedPlace, sessionStore } from '@/lib/session-state';
import { nearbyKinds, nearbyPlaces } from '@/lib/nearby';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import TrafficSearch from './traffic-search';
import TrafficStatus from './traffic-status';
import IntelPanel from './intel-panel';
import { getIntegrationData, initialViewport, integrationRequestKey, pollingMs, viewportNote, withBoundarySpeeds, movingCameras, retainTransitIdentities, type MapViewport } from '@/lib/integration-client';
import TransportLayers from './transport-layers';
import { useRouteVehicles } from './use-route-vehicles';
import { selectedVehicleCameras, type RouteVehicleFeeds, type RouteVehicleState } from '@/lib/route-vehicles';
import { useRoutePaths } from './use-route-paths';
import { transportRoutes, filterTransportFeed, routeVisible, setAllRoutes, busPaths, transportKinds, transportModes, type TransportMode, type TransportRoute, type RouteFocus } from '@/lib/transport-routes';
import type { BusRouteResponse, BusRouteSelection } from '@/lib/bus-route';
import { getBusRoute } from '@/lib/bus-route-client';
import { retainBusRoute } from '@/lib/bus-route-state';
import { busVehicleDistanceAtTime } from '@/lib/bus-route-motion';
import { ETA_FRESH_MS } from '@/lib/place-arrivals';

const TrafficMap3D = lazy(() => import('./traffic-map-3d'));

type LayerState = { data?: CameraData; loading: boolean; error: boolean };
type BusRouteState = { selection: BusRouteSelection; data?: BusRouteResponse; error?: boolean; loading: boolean };

const icons = { 'mtr-bus': BusFront, tram: TramFront, access: Accessibility, taxi: CarTaxiFront, redlight: TrafficCone, speed: Gauge, snapshot: Video, flow: Navigation, incident: TriangleAlert, parking: SquareParking, rainfall: CloudRain, crossing: Clock3, works: TrafficCone, toll: MapPin, boundary: ShieldCheck, 'weather-warning': CloudRain, mtr: Navigation, lrt: Navigation, kmb: MapPin, citybus: MapPin, gmb: MapPin, nlb: MapPin, ferry: Navigation };
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



// Stored boolean maps (rail lines, enabled layers) follow the language/basemap
// subscription pattern: no hydration mismatch, no cross-tab drift, and a write
// to worn-out storage still updates this tab. An absent record means "defaults".
function createStoredRecord(storageKey: string) {
  const listeners = new Set<() => void>();
  // A stable empty record: useSyncExternalStore re-renders forever if the
  // "no stored value" snapshot is a fresh object every call.
  const empty: Record<string, boolean> = {};
  let fallback: Record<string, boolean> | undefined;
  let fallbackRaw: string | null = null;
  let writeFailed = false;
  function parse(value: string | null): Record<string, boolean> | undefined {
    if (!value) return undefined;
    try {
      const parsed: unknown = JSON.parse(value);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
      const entries = Object.entries(parsed as Record<string, unknown>).filter(([, on]) => typeof on === 'boolean');
      return entries.length ? Object.fromEntries(entries) as Record<string, boolean> : undefined;
    } catch {
      return undefined;
    }
  }
  function getSnapshot(): Record<string, boolean> {
    if (writeFailed && fallback) return fallback;
    try {
      // Re-parse only when the stored text changes; a fresh object per call
      // would loop useSyncExternalStore.
      const raw = window.localStorage.getItem(storageKey);
      if (raw !== fallbackRaw) {
        fallbackRaw = raw;
        fallback = parse(raw);
      }
    } catch {
      // Storage can be unavailable in locked-down browser contexts; keep the in-memory choice.
    }
    return fallback ?? empty;
  }
  function getServerSnapshot(): Record<string, boolean> {
    return empty;
  }
  function subscribe(listener: () => void) {
    listeners.add(listener);
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) {
        writeFailed = false;
        fallbackRaw = event.newValue;
        fallback = parse(event.newValue);
        listener();
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener('storage', onStorage);
    };
  }
  function write(value: Record<string, boolean>) {
    fallback = value;
    fallbackRaw = JSON.stringify(value);
    try {
      window.localStorage.setItem(storageKey, fallbackRaw);
      writeFailed = false;
    } catch {
      writeFailed = true;
      // The in-memory subscription still updates the current tab when storage is unavailable.
    }
    listeners.forEach(listener => listener());
  }
  return { getSnapshot, getServerSnapshot, subscribe, write };
}

const railLinesStore = createStoredRecord('hk-traffic-rail-lines-v1');
const layerSelectionStore = createStoredRecord('hk-traffic-layers-v1');

// First-visit layers; a restored selection replaces this whole map.
function defaultEnabled(): Record<LayerKind, boolean> {
  return Object.fromEntries(kinds.map(kind => [kind, kind === 'flow' || kind === 'incident' || (kind === 'mtr' && layerAvailable(kind))])) as Record<LayerKind, boolean>;
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
  const hydrated = useSyncExternalStore(() => () => {}, () => true, () => false);
  const [mapMode, setMapMode] = useSessionField('mapMode');
  const [followLocation] = useSessionField('followLocation');
  const [camera3D] = useSessionField('camera3D');
  const updateCamera3D = useCallback((camera: { pitch: number; bearing: number }) => { const previous = sessionStore.getSnapshot().camera3D; if (previous.pitch !== camera.pitch || previous.bearing !== camera.bearing) sessionStore.update({ camera3D: camera }); }, []);
  const basemap = useSyncExternalStore(subscribeBasemap, getBasemapSnapshot, getServerBasemapSnapshot);
  const copy = messages[language];
  const extra = integrationMessages[language];
  const numberLocale = language === 'en' ? 'en-HK' : 'zh-HK';
  const railLines = useSyncExternalStore(railLinesStore.subscribe, railLinesStore.getSnapshot, railLinesStore.getServerSnapshot);
  const [layerCategory] = useSessionField('layerCategory');
  const categoryCopy = layerCategoryMessages[language];
  const transportMode = transportModes.find(mode => mode === layerCategory);
  const [storedRouteVisibility, setRouteVisibility] = useSessionField('routeVisibility');
  const [chosenBusRoutes, setChosenBusRoutes] = useSessionField('chosenBusRoutes');
  const routeVisibility = useMemo(() => {
    const hasRailChoices = Object.keys(storedRouteVisibility).some(key => key === 'all:rail' || key.startsWith('rail:'));
    const legacy = hasRailChoices ? {} : Object.fromEntries(Object.entries(railLines).map(([code, on]) => [code === 'lrt' ? 'rail:lrt' : `rail:mtr:${code}`, on]));
    return { ...legacy, ...storedRouteVisibility };
  }, [railLines, storedRouteVisibility]);
  const [routeFocus, setRouteFocus] = useState<RouteFocus | null>(null);
  const finishRouteFocus = useCallback(() => setRouteFocus(null), []);
  // Restored layer choices persist across launches; unavailable layers stay off.
  const enabledSelection = useSyncExternalStore(layerSelectionStore.subscribe, layerSelectionStore.getSnapshot, layerSelectionStore.getServerSnapshot);
  const enabled = useMemo<Record<LayerKind, boolean>>(() => Object.keys(enabledSelection).length
    ? Object.fromEntries(kinds.map(kind => [kind, enabledSelection[kind] === true && layerAvailable(kind)])) as Record<LayerKind, boolean>
    : defaultEnabled(), [enabledSelection]);
  const [states, setStates] = useState<Record<LayerKind, LayerState>>(() => Object.fromEntries(kinds.map(kind => [kind, { loading: originalKinds.includes(kind as OriginalLayerKind) || (kind === 'mtr' && layerAvailable(kind)), error: false }])) as Record<LayerKind, LayerState>);
  const [pendingActivity, setPendingActivity] = useState(0);
  const mounted = useRef(false);
  const lifecycle = useRef(0);
  const beginActivity = useCallback(() => {
    setPendingActivity(count => count + 1);
    let complete = false;
    return () => {
      if (complete) return;
      complete = true;
      if (mounted.current) setPendingActivity(count => count - 1);
    };
  }, []);
  const [storedViewport] = useSessionField('view');
  const viewport = storedViewport ?? initialViewport;
  const updateViewport = useCallback((view: MapViewport) => { const previous = sessionStore.getSnapshot().view; if (!previous || previous.lat !== view.lat || previous.lng !== view.lng || previous.zoom !== view.zoom) sessionStore.update({ view }); }, []);
  const [dockGroup, setDockGroup] = useSessionField('dockGroup');
  const dockKinds = layerGroups.find(group => group.id === dockGroup)!.kinds;
  const [selectedSnapshot] = useSessionField('selectedPlace');
  const setSelectedSnapshot = useCallback((camera: Camera | null) => sessionStore.update({ selectedPlace: savedPlace(camera) }), []);
  const pendingDetailsFocus = useRef(false);
  const [busSelection, setBusSelection] = useSessionField('busSelection');
  const [busRouteState, setBusRouteState] = useState<BusRouteState | null>(null);
  const [routeToFit, setRouteToFit] = useState<BusRouteSelection | null>(null);
  const [busRouteRetry, setBusRouteRetry] = useState(0);
  const busRouteCache = useRef(new Map<string, { promise: Promise<BusRouteState>; pending: boolean }>());
  const [showDetectors, setShowDetectors] = useSessionField('showDetectors');
  const [openControl, setOpenControl] = useSessionField('openControl');
  const [showNearbyOnMap] = useSessionField('showNearbyOnMap');
  const [nearbyRadius] = useSessionField('nearbyRadius');
  const mapEnabled = useMemo(() => Object.fromEntries(kinds.map(kind => [kind, enabled[kind] || showNearbyOnMap && nearbyKinds.includes(kind as IntegrationKind)])) as Record<LayerKind, boolean>, [enabled, showNearbyOnMap]);
  const requested = useMemo(() => Object.fromEntries(kinds.map(kind => [kind, mapEnabled[kind] || openControl === 'nearby' && nearbyKinds.includes(kind as IntegrationKind)])) as Record<LayerKind, boolean>, [mapEnabled, openControl]);
  const [now, setNow] = useState(() => Date.now());
  const [focusTarget, setFocusTarget] = useState<TrafficSearchItem | null>(null);
  const topbarCollapsed = useSyncExternalStore(topbarFlag.subscribe, topbarFlag.getSnapshot, topbarFlag.getServerSnapshot);
  const dialog = useRef<HTMLDialogElement>(null);
  const inflight = useRef(new Set<LayerKind>());
  const originalRetryAt = useRef(new Map<LayerKind, number>());
  const refreshIntegration = useRef<(kind: IntegrationKind) => Promise<void>>(async () => {});
  const integrationContext = useRef({ enabled, viewport, language });
  const integrationPending = useRef(new Map<IntegrationKind, { key: string; controller: AbortController }>());
  const integrationLastFetch = useRef(new Map<IntegrationKind, { key: string; at: number; retryAt?: number }>());

  function toggleTopbar() {
    topbarFlag.set(!topbarCollapsed);
  }

  useEffect(() => {
    document.documentElement.lang = language === 'en' ? 'en-HK' : 'zh-HK';
  }, [language]);

  useEffect(() => {
    mounted.current = true;
    const generation = lifecycle.current + 1;
    lifecycle.current = generation;
    const pending = integrationPending.current;
    const lastFetch = integrationLastFetch.current;
    return () => {
      mounted.current = false;
      // Effect replay remounts synchronously. A real unmount must cancel every
      // consumer, including transit, without interrupting that replay's loads.
      queueMicrotask(() => {
        if (lifecycle.current !== generation) return;
        pending.forEach(request => request.controller.abort());
        pending.clear();
        lastFetch.clear();
        refreshIntegration.current = async () => {};
      });
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30000);
    const onVisible = () => { if (document.visibilityState === 'visible') setNow(Date.now()); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  const fetchLayer = useCallback(async (kind: LayerKind, force = false) => {
    if (!layerAvailable(kind)) return;
    if (integrationKinds.includes(kind as IntegrationKind)) return refreshIntegration.current(kind as IntegrationKind);
    if (inflight.current.has(kind)) return;
    inflight.current.add(kind);
    originalRetryAt.current.delete(kind);
    const finishActivity = beginActivity();
    setStates(state => ({ ...state, [kind]: { ...state[kind], loading: true, error: false } }));
    try {
      const data = await getCameraData(kind as OriginalLayerKind, { force });
      if (!mounted.current) return;
      if (data.feedError) originalRetryAt.current.set(kind, Date.now() + 30000);
      setStates(state => ({ ...state, [kind]: { data, loading: false, error: Boolean(data.feedError) } }));
    } catch {
      if (!mounted.current) return;
      originalRetryAt.current.set(kind, Date.now() + 30000);
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
    // Failed updates recover on a short, bounded cadence while keeping their
    // last data visible, instead of waiting for the normal multi-minute poll.
    const retryInterval = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      originalRetryAt.current.forEach((at, kind) => {
        if (integrationContext.current.enabled[kind] && Date.now() >= at) void fetchLayer(kind, true);
      });
    }, 30000);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') originalKinds.forEach(kind => fetchLayer(kind));
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    const onOnline = () => originalKinds.forEach(kind => void fetchLayer(kind, true));
    window.addEventListener('online', onOnline);
    return () => {
      clearInterval(flowInterval);
      clearInterval(otherInterval);
      clearInterval(retryInterval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('online', onOnline);
    };
  }, [fetchLayer]);

  useEffect(() => {
    integrationContext.current = { enabled: requested, viewport, language };
    integrationKinds.forEach(kind => {
      if (pollingMs[kind] > 0 && (!requested[kind] || !layerAvailable(kind))) {
        integrationPending.current.get(kind)?.controller.abort();
        integrationPending.current.delete(kind);
        integrationLastFetch.current.delete(kind);
      }
    });
    const refresh = async (kind: IntegrationKind, force = false) => {
      if (!requested[kind] || !layerAvailable(kind) || document.visibilityState !== 'visible') return;
      const last = integrationLastFetch.current.get(kind);
      const key = integrationRequestKey(kind, viewport, language);
      const pending = integrationPending.current.get(kind);
      if (pending && pending.key === key) return;
      if (!force && last?.key === key && Date.now() < (last.retryAt ?? last.at + pollingMs[kind])) return;
      integrationPending.current.get(kind)?.controller.abort();
      const request = { key, controller: new AbortController() };
      integrationPending.current.set(kind, request);
      const finishActivity = beginActivity();
      const isCurrent = () => {
        const current = integrationContext.current;
        const currentKey = integrationRequestKey(kind, current.viewport, current.language);
        return mounted.current && integrationPending.current.get(kind) === request && current.enabled[kind] && currentKey === key;
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
        if (error) integrationLastFetch.current.set(kind, { key, at: Date.now(), retryAt: Date.now() + 30000 });
        const completedAt = Date.now();
        setStates(state => ({ ...state, [kind]: { data: retainTransitIdentities(kind, data, state[kind].data, completedAt), loading: false, error } }));
      } catch {
        if (isCurrent()) {
          integrationLastFetch.current.set(kind, { key, at: Date.now(), retryAt: Date.now() + 30000 });
          setStates(state => ({ ...state, [kind]: { ...state[kind], loading: false, error: true } }));
        }
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
    const onOnline = () => integrationKinds.forEach(kind => void refresh(kind, true));
    window.addEventListener('online', onOnline);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refreshAll); window.removeEventListener('online', onOnline); };
  }, [requested, language, viewport, beginActivity]);

  const segments = useMemo(() => displayFlowSegments(states.flow.data?.segments, states.flow.data?.segmentsUpdated, now), [states.flow.data, now]);
  const boundaryData = useMemo(() => withBoundarySpeeds(states.boundary.data, segments), [states.boundary.data, segments]);
  const displayStates = useMemo(() => ({ ...states, boundary: { ...states.boundary, data: boundaryData } }), [states, boundaryData]);
  const intelInput = useMemo(() => ({ states: Object.fromEntries(kinds.filter(kind => enabled[kind] && layerAvailable(kind)).map(kind => [kind, displayStates[kind]])), segments: enabled.flow ? segments : [], now }), [displayStates, enabled, segments, now]);
  const activeBusSelection = busSelection && enabled[busSelection.operator] && routeVisible({ id: `bus:${busSelection.operator}:${busSelection.route}`, mode: 'bus' }, routeVisibility) ? busSelection : null;
  const routeFeeds = useMemo(() => Object.fromEntries(kinds.map(kind => [kind, displayStates[kind].data])), [displayStates]);
  const routeCatalogue = useMemo(() => transportRoutes(routeFeeds, chosenBusRoutes), [routeFeeds, chosenBusRoutes]);
  const { loaded: routePaths, retry: retryRoutePaths } = useRoutePaths(routeCatalogue, enabled, routeVisibility, beginActivity);
  const { states: positionStates, snapshots: selectedVehicleFeeds, retry: retryPositions } = useRouteVehicles(routeCatalogue, enabled, routeVisibility, routePaths, routeFeeds, beginActivity, activeBusSelection, now);
  const viewStates = useMemo(() => Object.fromEntries(kinds.map(kind => [kind, { ...displayStates[kind], data: filterTransportFeed(kind, displayStates[kind].data, routeCatalogue, routeVisibility) }])) as Record<LayerKind, LayerState>, [displayStates, routeCatalogue, routeVisibility]);
  const transitFeeds = useMemo(() => ({ mtr: enabled.mtr ? viewStates.mtr.data : undefined, lrt: enabled.lrt ? viewStates.lrt.data : undefined, ferry: enabled.ferry ? viewStates.ferry.data : undefined }), [enabled, viewStates]);
  const paths = useMemo(() => [
    ...(['mtr', 'lrt', 'ferry', 'tram', 'access'] as const).flatMap(kind => enabled[kind] ? viewStates[kind].data?.paths ?? [] : []),
    ...routeCatalogue.flatMap(route => {
      if (!route.bus || !enabled[route.kind] || !routeVisible(route, routeVisibility) || busSelection?.operator === route.kind && busSelection.route === route.code) return [];
      const state = routePaths[route.id];
      if (state?.status === 'ready') return state.paths;
      const snapshot = selectedVehicleFeeds[route.id];
      return snapshot?.kind === 'bus' && snapshot.data.route ? busPaths([snapshot.data.route, ...snapshot.data.reverse.map(direction => direction.route)]) : [];
    }),
    ...routeCatalogue.filter(route => route.kind === 'mtr-bus' && enabled[route.kind] && routeVisible(route, routeVisibility)).flatMap(route => route.paths),
  ], [enabled, viewStates, routeCatalogue, routeVisibility, routePaths, selectedVehicleFeeds, busSelection]);
  const flowFresh = isLiveTrafficDataFresh(states.flow.data?.segmentsUpdated, now);
  const cameras = useMemo(() => {
    const visible = kinds.flatMap(kind => {
      if (!enabled[kind]) return [];
      if (kind === 'flow') return showDetectors ? (states.flow.data?.cameras ?? []).map(camera => flowFresh ? camera : { ...camera, speedKmh: null, level: 'unknown' as const, color: speedLevelColors.unknown }) : [];
      if (viewportNote(kind, viewport)) return [];
      const data = viewStates[kind].data;
      return (data?.cameras ?? []).map(camera => isFeedDataStale(kind, data, now) || isCameraDataStale(camera, now) ? { ...camera, color: speedLevelColors.unknown } : camera);
    });
    if (showNearbyOnMap) {
      const seen = new Set(visible.map(camera => camera.id));
      const feeds = nearbyKinds.filter(kind => layerAvailable(kind) && !viewportNote(kind, viewport)).map(kind => viewStates[kind].data);
      for (const { camera } of nearbyPlaces(feeds, viewport, nearbyRadius, now)) {
        if (seen.has(camera.id)) continue;
        seen.add(camera.id);
        visible.push(isFeedDataStale(camera.kind, displayStates[camera.kind].data, now) || isCameraDataStale(camera, now) ? { ...camera, color: speedLevelColors.unknown } : camera);
      }
    }
    return visible;
  }, [states, viewStates, displayStates, enabled, showDetectors, flowFresh, viewport, now, showNearbyOnMap, nearbyRadius]);
  const selected = useMemo(() => {
    if (selectedSnapshot?.positionType === 'vehicle') {
      if (selectedSnapshot.id.startsWith('selected-vehicle:')) return selectedVehicleCameras(selectedVehicleFeeds, now).find(camera => camera.id === selectedSnapshot.id) ?? null;
      const kind = selectedSnapshot.kind;
      if (kind !== 'mtr' && kind !== 'lrt' && kind !== 'ferry') return selectedSnapshot;
      const data = states[kind].data;
      return data ? movingCameras(kind, data, now).find(camera => camera.id === selectedSnapshot.id) ?? null : null;
    }
    if (!selectedSnapshot?.id.startsWith('flow-segment-')) {
      const latestCamera = selectedSnapshot && viewStates[selectedSnapshot.kind].data?.cameras.find(camera => camera.id === selectedSnapshot.id);
      const camera = latestCamera ?? selectedSnapshot;
      if (camera?.kind === 'flow' && !flowFresh) return { ...camera, speedKmh: null, level: 'unknown' as const, color: speedLevelColors.unknown };
      return camera && (isFeedDataStale(camera.kind, displayStates[camera.kind].data, now) || isCameraDataStale(camera, now)) ? { ...camera, color: speedLevelColors.unknown } : camera;
    }
    const segment = segments.find(candidate => candidate.id === selectedSnapshot.id);
    return segment ? cameraFromFlowSegment(segment, states.flow.data?.segmentsUpdated) : null;
  }, [selectedSnapshot, states, displayStates, viewStates, selectedVehicleFeeds, segments, flowFresh, now]);
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
        const finishActivity = beginActivity();
        const promise = getBusRoute(selection).then<BusRouteState>(async result => {
          const retained = await previous?.promise;
          const data = retainBusRoute(retained?.data, result, Date.now());
          return { selection, data, error: Boolean(!data.ok || data.error || data.stale), loading: false };
        }).catch(async () => {
          const retained = await previous?.promise;
          return { selection, data: retained?.data ? retainBusRoute(retained.data, { ok: false, vehicles: [], reverse: [], observedAt: null, stale: true }, Date.now()) : undefined, error: true, loading: false };
        });
        void promise.finally(finishActivity);
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
    window.addEventListener('online', visible);
    return () => { disposed = true; clearInterval(timer); document.removeEventListener('visibilitychange', visible); window.removeEventListener('online', visible); };
  }, [activeBusSelection, busRouteRetry, beginActivity]);
  const searchItems = useMemo<TrafficSearchItem[]>(() => [
    ...segments.map(segment => ({ camera: cameraFromFlowSegment(segment, states.flow.data?.segmentsUpdated), segment })),
    ...kinds.filter(kind => kind !== 'flow' && layerAvailable(kind) && !viewportNote(kind, viewport)).flatMap(kind => (viewStates[kind].data?.cameras ?? []).map(camera => ({ camera }))),
  ], [segments, states, viewStates, viewport]);
  const loading = kinds.some(kind => (originalKinds.includes(kind as OriginalLayerKind) || mapEnabled[kind]) && states[kind].loading);
  const appBusy = pendingActivity > 0 || loading;
  const errors = kinds.some(kind => mapEnabled[kind] && states[kind].error);
  // Map content is genuinely expected only while an enabled layer can still
  // draw: flow's speed segments, or a camera layer outside its viewport gate.
  // Gated bus feeds and layers that never place cameras (weather warnings)
  // leave the map empty by design, so the centre notice must stay away.
  const hasDrawableLayers = kinds.some(kind => mapEnabled[kind] && layerAvailable(kind) && (kind === 'flow' || (kind !== 'weather-warning' && !viewportNote(kind, viewport))));
  const activeKinds = kinds.filter(kind => mapEnabled[kind]);
  const activeErrors = activeKinds.some(kind => states[kind].error);
  const activeLoading = activeKinds.some(kind => states[kind].loading);
  const activeFetched = activeKinds.flatMap(kind => states[kind].data ? [states[kind].data!.fetchedAt] : []).sort()[0];

  function refreshAllLayers() {
    kinds.forEach(kind => void fetchLayer(kind, true));
    if (activeBusSelection) setBusRouteRetry(value => value + 1);
    retryPositions();
  }

  function toggle(kind: LayerKind) {
    if (!layerAvailable(kind)) return;
    if (enabled[kind]) setStates(state => ({ ...state, [kind]: { ...state[kind], loading: false } }));
    if (enabled[kind] && busSelection?.operator === kind) setBusSelection(null);
    layerSelectionStore.write({ ...enabled, [kind]: !enabled[kind] });
    if (selected?.kind === kind && enabled[kind]) setSelectedSnapshot(null);
  }

  const closeDetails = useCallback(() => {
    pendingDetailsFocus.current = false;
    setSelectedSnapshot(null);
  }, [setSelectedSnapshot]);

  const focusDetails = useCallback((content: HTMLElement) => {
    if (pendingDetailsFocus.current) content.focus({ preventScroll: true });
    pendingDetailsFocus.current = false;
  }, []);

  const choose = useCallback((camera: Camera) => {
    pendingDetailsFocus.current = Boolean(document.activeElement?.matches(':focus-visible'));
    setSelectedSnapshot(camera);
    sessionStore.update({ routeStop: null });
    setOpenControl(null);
  }, [setSelectedSnapshot, setOpenControl]);

  const onSelectSegment = useCallback((segment: FlowSegment) => {
    choose(cameraFromFlowSegment(segment, states.flow.data?.segmentsUpdated));
  }, [choose, states.flow.data?.segmentsUpdated]);

  const showBusRoute = useCallback((camera: Camera, tracking: BusRouteSelection) => {
    pendingDetailsFocus.current = false;
    layerSelectionStore.write({ ...enabled, [camera.kind]: true });
    setRouteVisibility(previous => ({ ...previous, [`bus:${tracking.operator}:${tracking.route}`]: true }));
    setBusSelection(tracking);
    setRouteToFit(tracking);
    sessionStore.update({ routeStop: null });
    setSelectedSnapshot(null);
    setOpenControl(null);
  }, [enabled, setBusSelection, setSelectedSnapshot, setOpenControl, setRouteVisibility]);

  function selectSearchItem(item: TrafficSearchItem) {
    layerSelectionStore.write({ ...enabled, [item.camera.kind]: true });
    setFocusTarget({ ...item });
    choose(item.camera);
  }

  const selectedName = selected && (language === 'en' ? selected.nameEn || selected.name : selected.name);
  function switchMapMode() {
    closeDetails();
    setFocusTarget(null);
    setMapMode(mode => mode === '2d' ? '3d' : '2d');
  }

  const basemapAction = basemap === 'osm' ? copy.switchToPositron : copy.switchToOsm;

  const routeLoading = Boolean(activeBusSelection && (busRouteState?.selection !== activeBusSelection || busRouteState.loading));
  const routeError = Boolean(activeBusSelection && busRouteState?.selection === activeBusSelection && busRouteState.error);
  const panelPositions: Record<string, RouteVehicleState> = { ...positionStates };
  const panelVehicleFeeds: RouteVehicleFeeds = { ...selectedVehicleFeeds };
  if (activeBusSelection) {
    const id = `bus:${activeBusSelection.operator}:${activeBusSelection.route}`;
    const data = busRoute ? { kind: 'bus' as const, data: busRoute } : undefined;
    panelPositions[id] = routeLoading ? { status: 'loading', data } : routeError || !data ? { status: 'error', data } : { status: 'ready', data };
    if (data) panelVehicleFeeds[id] = data;
  }
  const busCount = busRoute ? [busRoute.vehicles, ...busRoute.reverse.map(direction => direction.vehicles)].flat().filter(vehicle => busVehicleDistanceAtTime(vehicle, now) !== null).length : 0;
  const routeControlLabel = activeBusSelection ? `${copy.mapLayers} · ${extra.selectedBusRoute} ${activeBusSelection.route}${routeLoading ? ` · ${extra.loadingBusRoute}` : routeError ? ` · ${extra.busRouteError}` : ''}` : copy.mapLayers;
  const routeStatus = activeBusSelection && <section className="bus-route-status" aria-label={`${extra.selectedBusRoute} ${activeBusSelection.route}`}>
    <div className="bus-route-heading"><strong>{extra.selectedBusRoute} · {activeBusSelection.route}</strong><button type="button" className="text-button" onClick={() => setBusSelection(null)}>{extra.closeBusRoute}</button></div>
    <div role="status" aria-live="polite">
      {routeLoading && <p><LoaderCircle size={13} className="spin"/>{extra.loadingBusRoute}</p>}
      {routeError && <p className="warning-text">{extra.busRouteError} <button type="button" className="text-button" onClick={() => setBusRouteRetry(value => value + 1)}>{copy.retry}</button></p>}
      {busRoute?.route && <><p>{busCount ? extra.estimatedBuses(busCount) : extra.noBusPosition}</p><p>{extra.busPositionNote}</p>{busRoute.route.geometry === 'stops' && <p>{extra.busRouteStops}</p>}{busRoute.stale && <p className="warning-text">{extra.stale}</p>}</>}
    </div>
  </section>;

  function renderItemDetails(camera: Camera, options?: { status: 'loading' | 'error' | 'ready'; onRetry?: () => void; onClose?: () => void }) {
    const relatedRoute = Boolean(activeBusSelection && camera.kind === activeBusSelection.operator && (camera.sourceId === activeBusSelection.stopId || busRoute?.route?.stops.some(stop => stop.id === camera.sourceId)));
    const stale = isCameraDataStale(camera, now) || (!options && (states[camera.kind].error || isFeedDataStale(camera.kind, states[camera.kind].data, now)));
    return <ItemDetails camera={camera} language={language} now={now} stale={stale} onActivity={beginActivity} activeBusSelection={activeBusSelection} routeStatus={relatedRoute ? routeStatus : undefined} status={options?.status} onRetry={options?.onRetry} onShowRoute={tracking => { showBusRoute(camera, tracking); options?.onClose?.(); }}/>;
  }

  function rememberBusRoute(route: TransportRoute, on: boolean) {
    const bus = route.bus;
    if (!bus) return;
    setChosenBusRoutes(previous => {
      const remaining = previous.filter(saved => saved.operator !== bus.operator || saved.route !== bus.route);
      return on ? [...remaining, { operator: bus.operator, route: bus.route, stopId: bus.stopId, name: route.name, nameEn: route.nameEn }] : remaining;
    });
  }

  function enableTransport(mode: TransportMode) {
    const next = { ...enabled };
    for (const kind of transportKinds[mode]) if (layerAvailable(kind)) {
      next[kind] = true;
      if (enabled[kind] && (kind === 'mtr' || kind === 'lrt' || kind === 'ferry')) void fetchLayer(kind, true);
    }
    layerSelectionStore.write(next);
  }

  function enableRoute(route: TransportRoute) {
    layerSelectionStore.write({ ...enabled, [route.kind]: true });
    if (enabled[route.kind] && (route.kind === 'mtr' || route.kind === 'lrt' || route.kind === 'ferry')) void fetchLayer(route.kind, true);
  }

  const mapProps: TrafficMapProps = {
    selectedVehicleFeeds, routeFocus, onRouteFocusComplete: finishRouteFocus, onActivity: beginActivity, busRoute, fitBusRoute: activeBusSelection === routeToFit, paths, transitFeeds, onViewport: updateViewport, initialView: viewport, autoLocate: followLocation,
    cameras, segments: enabled.flow ? segments : undefined, selected,
    selectedSegmentId: selected?.id.startsWith('flow-segment-') ? selected.id : null,
    onSelect: choose, onSelectSegment, focusTarget, loading,
    allDisabled: kinds.every(kind => !mapEnabled[kind]), hasErrors: errors, hasDrawableLayers,
    language, basemap, now, busSelection: activeBusSelection, renderItemDetails,
    onCloseDetails: closeDetails, onDetailsOpen: focusDetails,
  };

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
        {mapMode === '2d' && <button type="button" className="basemap-toggle" aria-label={`${copy.mapStyle}: ${basemap === 'osm' ? copy.mapStyleStreet : copy.mapStyleLight}. ${basemapAction}`} title={basemapAction} onClick={() => setStoredBasemap(basemap === 'osm' ? 'positron' : 'osm')}><span className="map-style-label">{copy.mapStyle}: </span>{basemap === 'osm' ? copy.mapStyleStreet : copy.mapStyleLight}</button>}
        <button type="button" className="map-mode-toggle" data-testid="map-mode-toggle" aria-pressed={mapMode === '3d'} aria-label={mapMode === '3d' ? copy.switchTo2D : copy.switchTo3D} title={mapMode === '3d' ? copy.switchTo2D : copy.switchTo3D} onClick={switchMapMode}><Box size={17}/><span>3D</span></button>
        <button className="source-button" aria-label={copy.sources} onClick={() => dialog.current?.showModal()}><Info size={17}/><span>{copy.sources}</span></button>
      </div>
    </header>
    <div className="workspace">
      <div className="map-workspace">
      {!hydrated ? <div className="map-loading" role="status"><LoaderCircle className="spin" size={20}/>{copy.loadingOfficialData}</div> : mapMode === '3d' ? <Suspense fallback={<div className="map-loading" role="status"><LoaderCircle className="spin" size={20}/>{copy.map3DLoading}</div>}>
        <TrafficMap3D {...mapProps} camera3D={camera3D} onCamera3D={updateCamera3D} onExit3D={switchMapMode}/>
      </Suspense> : <TrafficMap {...mapProps}/>}
      {appBusy && <div className="background-activity" role="status" aria-live="polite" aria-atomic="true"><LoaderCircle size={16} className="spin" aria-hidden="true"/><span>{language === 'en' ? 'Updating data…' : '正在更新資料…'}</span></div>}
      <IntelPanel input={intelInput} language={language} onSelect={selectSearchItem}/>
      <TrafficStatus feeds={activeKinds.map(kind => ({ kind, ...states[kind] }))} language={language} flowEnabled={enabled.flow} updated={states.flow.data?.segmentsUpdated} fetched={activeFetched} now={now} loading={activeLoading} error={activeErrors} mapped={segments.length} expected={states.flow.data?.segmentsExpectedCount} onRefresh={refreshAllLayers}/>
      <div className="map-toolbar" role="group" aria-label={copy.openControls}>
        <Popover open={openControl === 'layers'} onOpenChange={open => setOpenControl(open ? 'layers' : null)}>
          <PopoverTrigger asChild><button type="button" className={`toolbar-button ${routeError ? 'error' : ''}`} aria-label={routeControlLabel} title={routeControlLabel}>{routeLoading ? <LoaderCircle size={20} className="spin"/> : routeError ? <TriangleAlert size={20}/> : <Layers3 size={20}/>}</button></PopoverTrigger>
          <PopoverContent className="map-control-popover layers-popover" side="left" align="start" sideOffset={10} collisionPadding={16} aria-labelledby="layers-popover-title" onCloseAutoFocus={event => { if (selectedSnapshot) event.preventDefault(); }}>
            <div className="control-popover-head"><h2 id="layers-popover-title">{copy.mapLayers}</h2><button type="button" className="close-button" aria-label={copy.closeControls} onClick={() => setOpenControl(null)}><X size={18}/></button></div>
            <label className="transport-select layer-category-picker" htmlFor="layer-category">{categoryCopy.category}<select id="layer-category" value={layerCategory} onChange={event => {
              const category = layerCategories.find(category => category === event.target.value);
              if (!category) return;
              const mode = transportModes.find(mode => mode === category);
              sessionStore.update({ layerCategory: category, routeQuery: '', ...(mode ? { transportMode: mode } : {}) });
            }}>{layerCategories.map(category => <option key={category} value={category}>{categoryCopy[category]}</option>)}</select></label>
            <div className="control-popover-body" key={layerCategory}>
          <div className="layer-list" role="group" aria-label={categoryCopy[layerCategory]}>{layerCategoryKinds[layerCategory].map(kind => {
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
              {enabled[kind] && kind === 'access' && <p className="layer-capability">{language === 'en' ? 'Published paths at zoom 15+. Teal: wheelchair access without a recorded barrier. Amber: barrier or no wheelchair access. Grey: unclassified. The local sample may be incomplete; operating status is unknown.' : '第 15 級或以上顯示已公布路段。青色：輪椅可通行且無記錄障礙；琥珀色：有障礙或輪椅未能通行；灰色：未分類。附近資料可能不完整，運作狀態不明。'}</p>}
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
              {enabled[kind] && state.error && <div className="layer-error" role="alert">{state.data ? copy.layerUpdateFailed : copy.dataLoadFailed} <button className="text-button" onClick={() => fetchLayer(kind, true)}>{copy.retry}</button></div>}
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
              {transportMode && <TransportLayers language={language} mode={transportMode} routes={routeCatalogue} visibility={routeVisibility} enabled={enabled} loaded={routePaths} positions={panelPositions} vehicleFeeds={panelVehicleFeeds} now={now} onRetryPositions={() => { retryPositions(); if (activeBusSelection) setBusRouteRetry(value => value + 1); }} onRetry={retryRoutePaths}
                onAll={(mode, on) => { setRouteVisibility(setAllRoutes(routeVisibility, mode, on)); if (mode === 'bus') setChosenBusRoutes([]); if (on) enableTransport(mode); closeDetails(); }}
                onToggle={(route, on) => { rememberBusRoute(route, on); setRouteVisibility({ ...routeVisibility, [route.id]: on }); if (on) enableRoute(route); closeDetails(); }}
                onZoom={route => {
                  const state = routePaths[route.id];
                  const points = (state?.status === 'ready' ? state.paths : route.paths).flatMap(path => path.points);
                  if (points.length) { rememberBusRoute(route, true); enableRoute(route); setRouteVisibility({ ...routeVisibility, [route.id]: true }); setRouteFocus({ points }); sessionStore.update({ followLocation: false }); setOpenControl(null); closeDetails(); }
                }}/>}
              {transportMode === 'bus' && routeStatus}
          {layerCategory === 'roads' && <p className="layer-note">{copy.layerNote}</p>}
            </div>
          </PopoverContent>
        </Popover>
        <Popover open={openControl === 'nearby'} onOpenChange={open => setOpenControl(open ? 'nearby' : null)}>
          <PopoverTrigger asChild><button type="button" className="toolbar-button nearby-toggle" aria-label={language === 'en' ? 'Nearby transport' : '附近交通'} title={language === 'en' ? 'Nearby transport' : '附近交通'}><Radar size={20}/></button></PopoverTrigger>
          <PopoverContent className="map-control-popover nearby-popover" side="left" align="start" sideOffset={10} collisionPadding={16} aria-labelledby="nearby-popover-title" onCloseAutoFocus={event => { if (selectedSnapshot) event.preventDefault(); }}>
            <div className="control-popover-head"><h2 id="nearby-popover-title">{language === 'en' ? 'Nearby transport' : '附近交通'}</h2><button type="button" className="close-button" aria-label={copy.closeControls} onClick={() => setOpenControl(null)}><X size={18}/></button></div>
            <div className="control-popover-body"><NearbyPanel states={displayStates} view={viewport} language={language} now={now} onSelect={camera => selectSearchItem({ camera })} onRefresh={() => nearbyKinds.forEach(kind => void fetchLayer(kind, true))}/></div>
          </PopoverContent>
        </Popover>
        <Popover open={openControl === 'search'} onOpenChange={open => setOpenControl(open ? 'search' : null)}>
          <PopoverTrigger asChild><button type="button" className="toolbar-button" aria-label={copy.searchTab} title={copy.searchTab}><Search size={20}/></button></PopoverTrigger>
          <PopoverContent className="map-control-popover search-popover" side="left" align="start" sideOffset={10} collisionPadding={16} aria-labelledby="search-popover-title" onCloseAutoFocus={event => { if (selectedSnapshot) event.preventDefault(); }}>
            <div className="control-popover-head"><h2 id="search-popover-title">{copy.searchTab}</h2><button type="button" className="close-button" aria-label={copy.closeControls} onClick={() => setOpenControl(null)}><X size={18}/></button></div>
            <div className="control-popover-body"><TrafficSearch items={searchItems} language={language} selected={selected} loading={loading} onSelect={selectSearchItem}/></div>
          </PopoverContent>
        </Popover>
        {activeBusSelection && <span className="sr-only" role="status">{extra.selectedBusRoute} {activeBusSelection.route} · {routeLoading ? extra.loadingBusRoute : routeError ? extra.busRouteError : extra.estimatedBuses(busCount)}</span>}
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
        <p className="dialog-footnote">{copy.basemap}{(basemap === 'positron' || mapMode === '3d') && <><a href="https://openfreemap.org/" target="_blank" rel="noreferrer">{copy.openFreeMapPositron}</a> · <a href="https://openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a> · </>}<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">{copy.osmContributors}</a>{copy.nonGovernmentBasemap}<a href="https://data.gov.hk/tc/terms-and-conditions" target="_blank" rel="noreferrer">{copy.governmentTerms}</a>.</p>
      </div>
    </dialog>
  </main>;
}
