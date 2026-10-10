'use client';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Maximize, Plus, Minus, LoaderCircle, RefreshCw, LocateFixed } from 'lucide-react';
import type * as Leaflet from 'leaflet';
import { integrationMessages, messages } from '@/lib/i18n';
import { Camera, CameraData, FlowSegment, Language, MapPath, hkTime, layerText, layers, parkingCounts, readableInk, speedLevelColors } from '@/lib/traffic';
import type { TrafficSearchItem } from '@/lib/traffic-view';
import { ferryDepartures, movingCameras, railHoverText, type MapViewport } from '@/lib/integration-client';
import { stopPlate } from '@/lib/stop-plate';
import { STOP_LABEL_WIDTH, declutterLabels, stopLabelHeight, type StopLabelItem, type StopLabelPlacement } from '@/lib/stop-labels';
import type { BusRouteResponse, BusRouteSelection, BusRouteStop } from '@/lib/bus-route';
import { getBusStopArrivals } from '@/lib/bus-route-client';
import { busDistanceAtTime, routeDistances, routeHeadingAtDistance, routePointAtDistance } from '@/lib/bus-route-motion';
import { markerOffsets, type MarkerPoint } from '@/lib/marker-layout';
import { vehicleIcon, vehicleIconHeadingOffset } from '@/lib/vehicle-icons';
import { ferryBadge } from '@/lib/ferry-routes';
import SnapshotImage from './snapshot-image';

const symbols = {
  redlight: '<rect x="8" y="2" width="8" height="20" rx="3"/><path d="M5 5h3m8 0h3M5 12h3m8 0h3M5 19h3m8 0h3"/><circle cx="12" cy="7" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="17" r="1"/>',
  speed: '<path d="M4 18a9 9 0 1 1 16 0M12 13l5-5M6 9l1 1M12 5v2M4 15h2m12 0h2"/><circle cx="12" cy="14" r="2"/>',
  snapshot: '<rect x="3" y="6" width="14" height="12" rx="2"/><path d="m17 10 4-3v10l-4-3"/>',
  flow: '<path d="M12 3l6 10h-3.5v8h-5v-8H6l6-10z"/>',
  incident: '<path d="M12 3.5 2.5 20h19L12 3.5z"/><path d="M12 10v4.5m0 2.5v.5"/>',
  parking: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M10 17V7.5h3.4a3.1 3.1 0 0 1 0 6.2H10"/>',
  rainfall: '<path d="M12 3.5s5.8 6.4 5.8 10.6a5.8 5.8 0 1 1-11.6 0C6.2 9.9 12 3.5 12 3.5z"/>',
  crossing: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  works: '<path d="m12 3 8 18H4L12 3zM7 15h10M9 10h6"/>',
  toll: '<path d="M3 21V7h18v14M3 7l3-4h12l3 4M8 12h8M8 16h8"/>',
  boundary: '<path d="M12 3 3 7v6c0 5 9 8 9 8s9-3 9-8V7l-9-4z"/>',
  'weather-warning': '<path d="M12 3 2 21h20L12 3zM12 9v5m0 3v1"/>',
  mtr: '<rect x="5" y="3" width="14" height="16" rx="4"/><path d="M5 11h14M8 19l-2 3m10-3 2 3M8 15h1m6 0h1"/>',
  lrt: '<rect x="5" y="3" width="14" height="16" rx="4"/><path d="M5 11h14M8 19l-2 3m10-3 2 3M8 15h1m6 0h1"/>',
  kmb: '<rect x="4" y="4" width="16" height="15" rx="3"/><path d="M4 11h16M7 19v3m10-3v3M7 15h1m8 0h1"/>',
  citybus: '<rect x="4" y="4" width="16" height="15" rx="3"/><path d="M4 11h16M7 19v3m10-3v3M7 15h1m8 0h1"/>',
  gmb: '<rect x="4" y="4" width="16" height="15" rx="3"/><path d="M4 11h16M7 19v3m10-3v3M7 15h1m8 0h1"/>',
  nlb: '<rect x="4" y="4" width="16" height="15" rx="3"/><path d="M4 11h16M7 19v3m10-3v3M7 15h1m8 0h1"/>',
  ferry: '<path d="M3 14h18l-4 6H7l-4-6zM7 14V8h10v6M12 3v5M2 22l4-1 4 1 4-1 4 1 4-1"/>',
};
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
function updatePopup(popup: Leaflet.Popup) {
  const focused = popup.getElement()?.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
  popup.update();
  focused?.focus({ preventScroll: true });
}
const vehicleHtml = (src: string | null, color: string, destination: string) => `<span class="marker-leader" aria-hidden="true" hidden></span><div class="marker-displacement" style="--marker-color:${escapeHtml(color)}"><span class="vehicle-dest" aria-hidden="true">${escapeHtml(destination)}</span><div class="marker-inner"><div class="vehicle-heading" style="transform:rotate(${vehicleIconHeadingOffset}deg)"><img class="vehicle-art" src="${escapeHtml(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}${src ?? ''}`)}" alt="" draggable="false"/></div></div></div>`;
const enableMarkerKeyboard = (marker: Leaflet.Marker) => marker.on('keydown', (event: Leaflet.LeafletKeyboardEvent) => {
  if (event.originalEvent.key !== 'Enter' && event.originalEvent.key !== ' ') return;
  event.originalEvent.preventDefault();
  event.originalEvent.stopPropagation();
  marker.fire('click', { originalEvent: event.originalEvent });
});
// Trains name themselves "line → terminus"; ferries carry the sailing destination
// on their first arrival; the vessel name is the last resort.
const vehicleDestination = (camera: Pick<Camera, 'kind' | 'arrivals'>, language: Language, name: string) => {
  if (camera.kind === 'mtr' || camera.kind === 'lrt') return name;
  const arrival = camera.arrivals?.[0];
  return language === 'en' ? arrival?.destinationEn || arrival?.destination || name : arrival?.destination || name;
};
const FLOW_SEGMENT_WEIGHT = 4.8;
const SELECTED_FLOW_SEGMENT_WEIGHT = 7.2;
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';
const OPENFREEMAP_ATTRIBUTION = '<a href="https://openfreemap.org/" target="_blank" rel="noreferrer">OpenFreeMap</a> &copy; <a href="https://openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';

const busStopKinds: readonly string[] = ['kmb', 'citybus', 'gmb', 'nlb'];
const isBusStop = (camera: Camera) => busStopKinds.includes(camera.kind);
const hasDelayedHover = (camera: Camera) => camera.kind === 'snapshot' || camera.kind === 'ferry' && camera.positionType === 'pier';
// Every vehicle type the car park publishes, in the current language, as label plus
// available / total. The tooltip and the accessible name both read this list.
const parkingRows = (camera: Camera, language: Language): { label: string; counts: string }[] => {
  const copy = messages[language];
  const locale = language === 'en' ? 'en-HK' : 'zh-HK';
  return (camera.parkingSpaces ?? []).map(space => ({ label: copy.parkingTypeLabel[space.type], counts: parkingCounts(space, locale) }));
};
// Leaflet takes tooltip content as HTML, so the same rows are escaped into it: names and counts
// come from the public feed.
const parkingTooltipHtml = (camera: Camera, language: Language, name: string): string => {
  const rows = parkingRows(camera, language).map(row => `<span class="parking-tooltip-row"><span>${escapeHtml(row.label)}</span><b>${row.counts}</b></span>`).join('');
  return `<span class="parking-tooltip-body"><strong class="parking-tooltip-name">${escapeHtml(name)}</strong>${rows ? `<span class="parking-tooltip-counts">${escapeHtml(messages[language].parkingCountsHeader)}</span>${rows}` : ''}</span>`;
};

// Plate anchor candidates in preference order, matching .stop-plate and its
// .pos-* modifiers in globals.css. Offsets are container pixels from the stop
// point: the 30px icon box is anchored on its center, and each plate edge sits
// 13px off the point so it clears the scaled-down icon on every side.
const platePlacements = (point: { x: number; y: number }, lines: number): StopLabelPlacement[] => {
  const w = STOP_LABEL_WIDTH, h = stopLabelHeight(lines);
  return [
    { key: 'right', x: point.x + 13, y: point.y - 11, w, h },
    { key: 'left', x: point.x - 13 - w, y: point.y - 11, w, h },
    { key: 'above', x: point.x - w / 2, y: point.y - 13 - h, w, h },
    { key: 'below', x: point.x - w / 2, y: point.y + 13, w, h },
  ];
};

function FerryPierPopup({ camera, language, now }: { camera: Camera; language: Language; now: number }) {
  const copy = integrationMessages[language];
  const departures = ferryDepartures(camera, now);
  return <><strong className="snapshot-hover-name">{language === 'en' ? camera.nameEn || camera.name : camera.name}</strong>
    {departures.length ? <ul className="ferry-departures" aria-label={copy.ferryDepartures}>{departures.map(call => <li key={JSON.stringify([call.route, call.destination || call.destinationEn])}>
      <strong>{language === 'en' ? call.destinationEn || call.destination : call.destination}</strong>
      <small className="ferry-route">{ferryBadge(call.route)[language === 'en' ? 'en' : 'tc']}{(language === 'en' ? call.remarkEn : call.remark) ? ` · ${language === 'en' ? call.remarkEn : call.remark}` : ''}</small>
      <dl><div><dt>{copy.firstFerry}</dt><dd>{call.firstFerry || copy.queue[4]}</dd></div><div><dt>{copy.lastFerry}</dt><dd>{call.lastFerry || copy.queue[4]}</dd></div><div><dt>{copy.nextFerry}</dt><dd>{call.eta ? hkTime(call.eta, false, language) : copy.queue[4]}</dd></div></dl>
      {call.minutes !== null && <p className="ferry-countdown">{copy.ferryNextIn(call.minutes)}</p>}
    </li>)}</ul> : <p>{copy.noFerryDepartures}</p>}
    <small className="ferry-times">{copy.ferryTimes}</small>
  </>;
}

export type Basemap = 'osm' | 'positron';
type DetailOptions = { status: 'loading' | 'error' | 'ready'; onRetry?: () => void; onClose?: () => void };
type Props = { busRoute?: BusRouteResponse; onActivity: () => () => void; cameras: Camera[]; paths?: MapPath[]; transitFeeds?: Partial<Record<'mtr' | 'lrt' | 'ferry', CameraData>>; onViewport?: (view: MapViewport) => void; segments?: FlowSegment[]; selected: Camera | null; selectedSegmentId?: string | null; onSelect: (camera: Camera) => void; onSelectSegment?: (segment: FlowSegment) => void; focusTarget?: TrafficSearchItem | null; loading: boolean; allDisabled: boolean; hasErrors: boolean; language: Language; basemap: Basemap; inactive?: boolean; now: number; busSelection?: BusRouteSelection | null; renderItemDetails: (camera: Camera, options?: DetailOptions) => ReactNode; onCloseDetails: () => void; onDetailsOpen?: (content: HTMLElement) => void };
export default function TrafficMap({ busRoute, onActivity, cameras, paths, transitFeeds, onViewport, segments, selected, selectedSegmentId, onSelect, onSelectSegment, focusTarget, loading, allDisabled, hasErrors, language, basemap, inactive = false, now, busSelection, renderItemDetails, onCloseDetails, onDetailsOpen }: Props) {
  const copy = messages[language];
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const library = useRef<typeof Leaflet | null>(null);
  const basemapLayer = useRef<Leaflet.Layer | null>(null);
  const markerGroup = useRef<Leaflet.LayerGroup | null>(null);
  const markers = useRef(new Map<string, Leaflet.Marker>());
  const markerData = useRef(new Map<string, { camera: Camera; style: string; labelLines?: number }>());
  const [routePopupStop, setRoutePopupStop] = useState<{ key: string; stop: BusRouteStop } | null>(null);
  const [routePopupData, setRoutePopupData] = useState<{ stop: BusRouteStop; language: Language; camera?: Camera; status: 'loading' | 'error' | 'ready' } | null>(null);
  const [popupElement, setPopupElement] = useState<HTMLDivElement | null>(null);
  const [snapshotHover, setSnapshotHover] = useState<{ camera: Camera; element: HTMLDivElement } | null>(null);
  const snapshotPopupRef = useRef<Leaflet.Popup | null>(null);
  const popupRef = useRef<{ popup: Leaflet.Popup; stopId: string } | null>(null);
  const popupOrigin = useRef<{ id: string; element: HTMLElement | null; point?: Leaflet.LatLng } | null>(null);
  const focusMoving = useRef(false);
  const closeDetailsRef = useRef(onCloseDetails);
  const detailsOpenRef = useRef(onDetailsOpen);
  const popupLanguage = useRef(language);
  const [revealedRouteKey, setRevealedRouteKey] = useState<string | null>(null);
  const routeFocusRef = useRef(false);
  const previousSelection = useRef<string | null>(null);
  const selectRef = useRef(onSelect);
  const layoutMarkers = useRef<() => void>(() => {});
  const displayOffsets = useRef(new Map<string, { x: number; y: number }>());
  const segmentGroup = useRef<Leaflet.LayerGroup | null>(null);
  const segmentRenderer = useRef<Leaflet.Renderer | null>(null);
  const railRenderer = useRef<Leaflet.Renderer | null>(null);
  const segmentPolylines = useRef(new Map<string, Leaflet.Polyline>());
  const vehicleGroup = useRef<Leaflet.LayerGroup | null>(null);
  const fittedBusRoute = useRef<string | null>(null);
  const busVehicle = useRef<{ key: string; marker: Leaflet.Marker; distance: number; feed: BusRouteResponse; correction?: { distance: number; at: number }; heading?: HTMLElement | null } | null>(null);
  const vehicles = useRef(new Map<string, { marker: Leaflet.Marker; camera: Camera; feed: CameraData | undefined; language: Language; hoverAt: number; routeDistance?: number; correction?: { lat: number; lng: number; at: number }; routeCorrection?: { distance: number; at: number } }>());
  const previousSegmentSelection = useRef<string | null>(null);
  const onSelectSegmentRef = useRef(onSelectSegment);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [basemapRetry, setBasemapRetry] = useState(0);
  const [mapZoom, setMapZoom] = useState(11);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<'denied' | 'unavailable' | 'timeout' | 'unsupported' | null>(null);
  const [locationFound, setLocationFound] = useState(false);
  const [followingLocation, setFollowingLocation] = useState(false);
  const locationWatch = useRef<{ id: number | null } | null>(null);
  const locationLayer = useRef<Leaflet.LayerGroup | null>(null);
  const viewportCallback = useRef(onViewport);
  const stopLocating = useCallback(() => {
    const watch = locationWatch.current;
    locationWatch.current = null;
    if (watch?.id != null) navigator.geolocation.clearWatch(watch.id);
    locationLayer.current?.clearLayers();
    setFollowingLocation(false);
    setLocating(false);
    setLocationFound(false);
  }, []);
  const locate = useCallback(() => {
    const m = map.current, L = library.current;
    if (!m || !L || locationWatch.current) return;
    setLocationError(null);
    setLocationFound(false);
    locationLayer.current?.clearLayers();
    if (!navigator.geolocation) {
      setLocationError('unsupported');
      return;
    }
    const watch = { id: null as number | null };
    locationWatch.current = watch;
    setFollowingLocation(true);
    setLocating(true);
    const fail = (code: number) => {
      if (map.current !== m || locationWatch.current !== watch) return;
      stopLocating();
      setLocationError(code === 1 ? 'denied' : code === 3 ? 'timeout' : 'unavailable');
    };
    try {
      watch.id = navigator.geolocation.watchPosition(position => {
        if (map.current !== m || locationWatch.current !== watch) return;
        setLocating(false);
        const point: Leaflet.LatLngExpression = [position.coords.latitude, position.coords.longitude];
        locationLayer.current ??= L.layerGroup().addTo(m);
        locationLayer.current.clearLayers();
        L.circle(point, { radius: position.coords.accuracy, color: '#137f87', weight: 1, fillOpacity: 0.08, interactive: false, className: 'user-location-accuracy' }).addTo(locationLayer.current);
        L.circleMarker(point, { radius: 7, color: '#fff', weight: 3, fillColor: '#137f87', fillOpacity: 1, interactive: false, pane: 'userLocation', className: 'user-location-dot' }).addTo(locationLayer.current);
        m.setView(point, Math.max(m.getZoom(), 16), { animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches });
        setLocationFound(true);
      }, error => fail(error.code), { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
      if (locationWatch.current !== watch) navigator.geolocation.clearWatch(watch.id);
    } catch {
      fail(2);
    }
  }, [stopLocating]);
  useEffect(() => { viewportCallback.current = onViewport; }, [onViewport]);
  useEffect(() => { selectRef.current = onSelect; }, [onSelect]);
  useEffect(() => { closeDetailsRef.current = onCloseDetails; }, [onCloseDetails]);
  useEffect(() => { detailsOpenRef.current = onDetailsOpen; }, [onDetailsOpen]);
  useEffect(() => { popupLanguage.current = language; }, [language]);
  // Route-focus: while a route is on the map, bus stops hide until the rider
  // clicks blank map space. A new route key (or clearing the route) re-arms it.
  const busRouteKey = busRoute?.route?.key ?? null;
  const routeFocus = busRouteKey !== null && revealedRouteKey !== busRouteKey;
  useEffect(() => { routeFocusRef.current = routeFocus; }, [routeFocus]);
  useEffect(() => { onSelectSegmentRef.current = onSelectSegment; }, [onSelectSegment]);
  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | undefined;
    const vehicleEntries = vehicles.current;
    const staticEntries = markers.current, staticData = markerData.current;
    const finishActivity = onActivity();
    (async () => {
      const L = (await import('leaflet')).default;
      (window as unknown as { L: typeof Leaflet }).L = L;
      if (disposed || !element.current) return;
      library.current = L;
      const m = L.map(element.current, { zoomControl: false, minZoom: 10, maxZoom: 19, attributionControl: true }).setView([22.355, 114.13], 11);
      map.current = m;
      const locationPane = m.createPane('userLocation');
      locationPane.style.zIndex = '625';
      locationPane.style.pointerEvents = 'none';
      m.on('moveend', () => { const center = m.getCenter(); setMapZoom(m.getZoom()); viewportCallback.current?.({ lng: Number(center.lng.toFixed(5)), lat: Number(center.lat.toFixed(5)), zoom: m.getZoom() }); });
      L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(m);
      markerGroup.current = L.layerGroup().addTo(m);
      segmentRenderer.current = L.canvas({ padding: 0.5 });
      const railPane = m.createPane('railRoutes');
      railPane.style.zIndex = '410';
      // Decorative tracks must let clicks reach the road canvas underneath.
      railPane.style.pointerEvents = 'none';
      railRenderer.current = L.canvas({ padding: 0.5, pane: 'railRoutes' });
      segmentGroup.current = L.layerGroup().addTo(m);
      observer = new ResizeObserver(() => m.invalidateSize());
      observer.observe(element.current);
      setPopupElement(document.createElement('div'));
      setReady(true);
      locate();
    })().catch(() => { if (!disposed) setMapError(true); }).finally(finishActivity);
    return () => { disposed = true; finishActivity(); observer?.disconnect(); stopLocating(); map.current?.remove(); map.current = null; markerGroup.current = null; basemapLayer.current = null; locationLayer.current = null; vehicleGroup.current = null; busVehicle.current = null; fittedBusRoute.current = null; vehicleEntries.clear(); staticEntries.clear(); staticData.clear(); };
  }, [onActivity, locate, stopLocating]);
  useEffect(() => {
    const L = library.current, m = map.current;
    if (!ready || !L || !m) return;
    let disposed = false;
    const finishAssets = onActivity();
    let finishTiles: (() => void) | undefined;
    const tileLoading = () => { if (!disposed && !finishTiles) finishTiles = onActivity(); };
    const tileLoaded = () => { finishTiles?.(); finishTiles = undefined; };
    setMapError(false);
    basemapLayer.current?.removeFrom(m);
    basemapLayer.current = null;
    (async () => {
      try {
        let nextLayer: Leaflet.Layer;
        if (basemap === 'positron') {
          const [{ maplibreGL }, { setWorkerUrl }] = await Promise.all([
            import('@maplibre/maplibre-gl-leaflet'),
            import('maplibre-gl'),
          ]);
          if (disposed) return;
          setWorkerUrl(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/vendor/maplibre-gl/maplibre-gl-worker.mjs`);
          const positronLayer = maplibreGL({
            style: 'https://tiles.openfreemap.org/styles/positron',
            attributionControl: { customAttribution: OPENFREEMAP_ATTRIBUTION },
            maxZoom: 20,
          });
          positronLayer.addTo(m);
          const vectorMap = positronLayer.getMaplibreMap();
          tileLoading();
          vectorMap.on('dataloading', tileLoading);
          vectorMap.on('idle', tileLoaded);
          vectorMap.on('error', () => { if (!disposed) setMapError(true); tileLoaded(); });
          nextLayer = positronLayer;
        } else {
          nextLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: OSM_ATTRIBUTION,
            maxZoom: 19,
          }).on('loading', tileLoading).on('load', tileLoaded).on('tileerror', () => { if (!disposed) setMapError(true); }).addTo(m);
        }
        if (disposed) {
          nextLayer.removeFrom(m);
          return;
        }
        basemapLayer.current = nextLayer;
      } catch {
        if (!disposed) setMapError(true);
        tileLoaded();
      } finally {
        finishAssets();
      }
    })();
    return () => {
      disposed = true;
      finishAssets();
      tileLoaded();
      basemapLayer.current?.removeFrom(m);
      basemapLayer.current = null;
    };
  }, [basemap, ready, basemapRetry, onActivity]);
  useEffect(() => {
    const L = library.current, m = map.current, group = markerGroup.current;
    if (!ready || !L || !m || !group) return;
    const visible = cameras;
    const ids = new Set(visible.map(camera => camera.id));
    markers.current.forEach((marker, id) => { if (!ids.has(id)) { group.removeLayer(marker); markers.current.delete(id); markerData.current.delete(id); if (popupRef.current?.stopId === id) popupRef.current.popup.remove(); } });
    visible.forEach(camera => {
      const style = language;
      const previous = markerData.current.get(camera.id);
      if (previous?.camera === camera && previous.style === style) return;
      if (camera.kind === 'snapshot' && previous?.style === style && JSON.stringify(previous.camera) === JSON.stringify(camera)) { markerData.current.set(camera.id, { ...previous, camera }); return; }
      const oldMarker = markers.current.get(camera.id);
      const name = language === 'en' ? camera.nameEn || camera.name : camera.name;
      const rail = camera.kind === 'mtr' || camera.kind === 'lrt';
      const hover = rail ? railHoverText(camera, language) : name;
      const badge = camera.kind === 'crossing' ? camera.badge : undefined;
      const plate = isBusStop(camera) ? stopPlate(name, camera.routes ?? []) : null;
      // Rail stations swap the generic glyph for a compact line-coloured dot plus a
      // rounded name pill; interchanges add a dot for every extra serving line.
      const color = camera.color ?? layers[camera.kind].color;
      const lineColors = camera.positionType === 'station' ? camera.lineColors ?? [] : [];
      const attachment = camera.positionType === 'station'
        ? `<span class="station-label" style="background:${escapeHtml(color)};color:${escapeHtml(readableInk(color))}">${escapeHtml(name)}${lineColors.length > 1 ? `<span class="station-lines">${lineColors.slice(1).map(line => `<i style="background:${escapeHtml(line)}"></i>`).join('')}</span>` : ''}</span>`
        : plate ? `<span class="stop-plate live"><b>${escapeHtml(plate.title)}</b>${plate.lines.map(line => `<span>${escapeHtml(line)}</span>`).join('')}</span>` : '';
      const inner = camera.kind === 'crossing' ? `<b>${escapeHtml(badge || '—')}</b>` : camera.positionType === 'station' ? '' : `<svg viewBox="0 0 24 24"${camera.rotation ? ` style="transform:rotate(${camera.rotation}deg)"` : ''}>${symbols[camera.kind]}</svg>`;
      const icon = L.divIcon({ className: `camera-marker${camera.positionType === 'station' ? ' station-marker' : ''}${rail ? ' rail-marker' : ''}${isBusStop(camera) ? ' bus-stop-marker' : ''}`, html: `<span class="marker-leader" aria-hidden="true" hidden></span><div class="marker-displacement"><div class="marker-inner" style="--marker-color:${color}">${inner}</div>${attachment}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
      const marker = oldMarker ?? enableMarkerKeyboard(L.marker([camera.lat, camera.lng], { icon, keyboard: true, cameraKind: camera.kind } as Leaflet.MarkerOptions).addTo(group));
      if (oldMarker) marker.setIcon(icon).setLatLng([camera.lat, camera.lng]);
      const node = marker.getElement();
      // A car park states its counts in the tooltip, so it never gets the browser's delayed native
      // title, and its label repeats the counts because no popup opens to carry them.
      const rows = camera.kind === 'parking' ? parkingRows(camera, language) : [];
      if (node) {
        if (hasDelayedHover(camera) || camera.kind === 'parking') node.removeAttribute('title');
        else node.title = rail ? hover : `${layerText(camera.kind, language).name}: ${name}`;
        node.setAttribute('aria-label', rows.length ? `${hover} · ${rows.map(row => `${row.label} ${row.counts}`).join(' · ')}` : hover);
        if (camera.kind === 'parking') node.removeAttribute('aria-haspopup');
        else node.setAttribute('aria-haspopup', 'dialog');
        node.dataset.markerId = camera.id;
      }
      if (!oldMarker && camera.kind === 'parking') marker.on('tooltipopen', (event: Leaflet.TooltipEvent) => { const element = event.tooltip.getElement(); if (element) element.style.borderColor = color; });
      const textLabel = document.createElement('span'); textLabel.textContent = name;
      const tooltipLabel: string | HTMLElement = camera.kind === 'parking' ? parkingTooltipHtml(camera, language, name) : textLabel;
      if (rail || camera.kind === 'ferry') marker.unbindTooltip();
      else if (marker.getTooltip()) marker.setTooltipContent(tooltipLabel);
      else marker.bindTooltip(tooltipLabel, { direction: 'top', offset: [0, -12], className: camera.kind === 'parking' ? 'parking-tooltip' : undefined });
      // Car parks carry their counts in the tooltip, so their marker opens no details popup.
      if (!oldMarker && camera.kind !== 'parking') marker.on('click', () => {
        const latest = markerData.current.get(camera.id)?.camera;
        if (!latest || isBusStop(latest) && routeFocusRef.current) return;
        popupOrigin.current = { id: latest.id, element: marker.getElement() ?? null };
        setRoutePopupStop(null);
        selectRef.current(latest);
      });
      markers.current.set(camera.id, marker);
      markerData.current.set(camera.id, { camera, style, labelLines: plate?.lines.length });
    });
    layoutMarkers.current();
  }, [cameras, ready, language, copy, mapZoom]);
  const snapshotMarkerKey = JSON.stringify(cameras.filter(hasDelayedHover));
  const fullPopupOpen = Boolean(selected || routePopupStop);
  useEffect(() => {
    const L = library.current, m = map.current;
    if (!ready || !L || !m || inactive || fullPopupOpen) return;
    let delay: ReturnType<typeof setTimeout> | undefined, dismiss: ReturnType<typeof setTimeout> | undefined;
    let popup: Leaflet.Popup | undefined, content: HTMLDivElement | undefined, activeNode: HTMLElement | undefined;
    const clearDismiss = () => { clearTimeout(dismiss); dismiss = undefined; };
    const close = () => {
      clearTimeout(delay); delay = undefined; clearDismiss();
      activeNode?.removeAttribute('aria-controls');
      const popupNode = popup?.getElement();
      if (popupNode) { popupNode.removeEventListener('mouseenter', clearDismiss); popupNode.removeEventListener('mouseleave', leave); popupNode.style.pointerEvents = 'none'; }
      popup?.off('remove', close); popup?.remove(); popup = undefined; content = undefined; activeNode = undefined;
      snapshotPopupRef.current = null;
      setSnapshotHover(null);
    };
    const leave = () => {
      clearTimeout(delay); delay = undefined;
      if (!popup) { close(); return; }
      clearDismiss();
      dismiss = setTimeout(() => {
        if (!activeNode?.matches(':hover') && document.activeElement !== activeNode && !popup?.getElement()?.matches(':hover') && !content?.contains(document.activeElement)) close();
      }, 250);
    };
    const listeners: (() => void)[] = [];
    markerData.current.forEach(({ camera }) => {
      if (!hasDelayedHover(camera)) return;
      const marker = markers.current.get(camera.id), node = marker?.getElement();
      if (!marker || !node) return;
      node.setAttribute('aria-haspopup', 'dialog');
      const enter = () => {
        if (popupRef.current) return;
        if (activeNode === node) { clearDismiss(); return; }
        close(); activeNode = node;
        delay = setTimeout(() => {
          delay = undefined;
          if (popupRef.current) return;
          const name = language === 'en' ? camera.nameEn || camera.name : camera.name;
          content = document.createElement('div'); content.id = camera.kind === 'ferry' ? 'ferry-hover' : 'snapshot-hover'; content.className = `marker-hover ${content.id}`;
          const topbar = document.querySelector('.topbar')?.getBoundingClientRect();
          const status = m.getContainer().closest('.map-workspace')?.querySelector('.traffic-status')?.getBoundingClientRect();
          content.style.maxHeight = `${Math.max(80, m.getContainer().getBoundingClientRect().bottom - Math.max(topbar?.bottom ?? 0, status?.bottom ?? 0) - 48)}px`;
          content.setAttribute('role', 'dialog'); content.setAttribute('aria-label', name); content.tabIndex = -1;
          content.addEventListener('focusin', clearDismiss); content.addEventListener('focusout', leave);
          node.setAttribute('aria-controls', content.id);
          const offset = displayOffsets.current.get(camera.id);
          popup = L.popup({ offset: L.point(offset?.x ?? 0, -12 + (offset?.y ?? 0)), autoPan: false, closeButton: false, maxWidth: 320, className: 'snapshot-hover-popup' })
            .setLatLng(marker.getLatLng()).setContent(content).openOn(m);
          popup.getElement()?.addEventListener('mouseenter', clearDismiss); popup.getElement()?.addEventListener('mouseleave', leave);
          popup.on('remove', close);
          snapshotPopupRef.current = popup;
          setSnapshotHover({ camera, element: content });
          if (document.activeElement === node && node.matches(':focus-visible')) content.focus();
        }, 2000);
      };
      node.addEventListener('mouseenter', enter); node.addEventListener('mouseleave', leave);
      node.addEventListener('focus', enter); node.addEventListener('blur', leave); node.addEventListener('click', close);
      listeners.push(() => {
        node.removeEventListener('mouseenter', enter); node.removeEventListener('mouseleave', leave);
        node.removeEventListener('focus', enter); node.removeEventListener('blur', leave); node.removeEventListener('click', close);
      });
    });
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const node = content?.contains(document.activeElement) ? activeNode : undefined;
      node?.focus(); close();
    };
    const visibility = () => { if (document.visibilityState !== 'visible') close(); };
    m.on('movestart click', close); document.addEventListener('keydown', escape); document.addEventListener('visibilitychange', visibility);
    return () => { listeners.forEach(remove => remove()); m.off('movestart click', close); document.removeEventListener('keydown', escape); document.removeEventListener('visibilitychange', visibility); close(); };
  }, [snapshotMarkerKey, ready, language, mapZoom, inactive, fullPopupOpen]);
  useEffect(() => {
    const popup = snapshotPopupRef.current;
    if (!snapshotHover || !popup || !element.current || !library.current) return;
    const container = element.current, L = library.current;
    const position = () => {
      const focused = snapshotHover.element.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
      popup.update();
      let bounds = popup.getElement()?.getBoundingClientRect();
      const area = container.getBoundingClientRect();
      if (!bounds) return;
      const top = Math.max(area.top, container.closest('.app-shell')?.querySelector('.topbar')?.getBoundingClientRect().bottom ?? area.top, container.closest('.map-workspace')?.querySelector('.traffic-status')?.getBoundingClientRect().bottom ?? area.top);
      const left = area.left;
      const right = Math.min(area.right, container.parentElement?.querySelector('.map-tools')?.getBoundingClientRect().left ?? area.right);
      const content = popup.getElement()?.querySelector<HTMLElement>('.marker-hover');
      if (content) { content.style.maxWidth = `${Math.max(80, right - left - 16 - (bounds.width - content.getBoundingClientRect().width))}px`; popup.update(); bounds = popup.getElement()!.getBoundingClientRect(); }
      const x = Math.max(left + 8 - bounds.left, Math.min(0, right - 8 - bounds.right));
      const y = Math.max(top + 8 - bounds.top, Math.min(0, area.bottom - 8 - bounds.bottom));
      if (x || y) { const offset = L.point(popup.options.offset ?? [0, 0]); popup.options.offset = offset.add([x, y]); popup.update(); }
      focused?.focus({ preventScroll: true });
    };
    position();
    let frame: number | undefined;
    const observer = new ResizeObserver(() => {
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => { frame = undefined; position(); });
    });
    observer.observe(snapshotHover.element);
    return () => { observer.disconnect(); if (frame !== undefined) cancelAnimationFrame(frame); };
  }, [snapshotHover]);
  // Separate close icons in screen pixels, keeping the source point and motion exact.
  // Plates and tooltips follow the displayed icon; a leader marks any displacement.
  useEffect(() => {
    const m = map.current, L = library.current;
    if (!ready || !m || !L) return;
    const run = () => {
      if (inactive || document.visibilityState !== 'visible' || m.getContainer().classList.contains('leaflet-zoom-anim')) return;
      const size = m.getSize();
      const viewport = { x: -40, y: -40, w: size.x + 80, h: size.y + 80 };
      // Vehicles stick to their routes: only static markers join the collision layout.
      const all = [...markers.current.entries()];
      const points: MarkerPoint[] = [];
      all.forEach(([id, marker]) => {
        if (routeFocusRef.current && marker.getElement()?.classList.contains('bus-stop-marker')) return;
        const point = m.latLngToContainerPoint(marker.getLatLng());
        if (point.x < -70 || point.y < -70 || point.x > size.x + 70 || point.y > size.y + 70) return;
        points.push({ id, ...point, size: 30 });
      });
      const offsets = markerOffsets(points);
      displayOffsets.current = offsets;
      all.forEach(([id, marker]) => {
        const node = marker.getElement();
        const offset = offsets.get(id) ?? { x: 0, y: 0 };
        const displaced = node?.querySelector<HTMLElement>('.marker-displacement');
        if (displaced) displaced.style.transform = `translate(${offset.x}px, ${offset.y}px)`;
        const leader = node?.querySelector<HTMLElement>('.marker-leader');
        if (leader) {
          leader.style.width = `${Math.hypot(offset.x, offset.y)}px`;
          leader.style.transform = `rotate(${Math.atan2(offset.y, offset.x)}rad)`;
          leader.hidden = !offset.x && !offset.y;
        }
        const tooltip = marker.getTooltip();
        if (tooltip) { tooltip.options.offset = L.point(offset.x, offset.y - 12); if (tooltip.isOpen()) tooltip.update(); }
      });
      const popup = popupRef.current;
      if (popup) {
        const offset = offsets.get(popup.stopId);
        popup.popup.options.offset = L.point(offset?.x ?? 0, -14 + (offset?.y ?? 0));
        updatePopup(popup.popup);
      }
      const items: StopLabelItem[] = [];
      const labels: [string, HTMLElement][] = [];
      markers.current.forEach((marker, id) => {
        const data = markerData.current.get(id);
        if (!data) return;
        const bus = isBusStop(data.camera), station = data.camera.positionType === 'station';
        if (!bus && !station) return;
        const label = marker.getElement()?.querySelector<HTMLElement>(bus ? '.stop-plate' : '.station-label');
        if (!label) return;
        labels.push([id, label]);
        const point = m.latLngToContainerPoint(marker.getLatLng());
        const offset = offsets.get(id);
        const anchor = { x: point.x + (offset?.x ?? 0), y: point.y + (offset?.y ?? 0) };
        if (bus) items.push({ id, priority: data.camera.routes?.length ?? 0, placements: platePlacements(anchor, data.labelLines ?? 0) });
        else {
          // Pill box estimate without measuring the DOM: CJK glyphs ~11.5px at the
          // 11px pill font, Latin ~6.2px, plus padding and 10px per extra line dot.
          // Stations outrank every bus plate so interchanges keep their names longest.
          const name = language === 'en' ? data.camera.nameEn || data.camera.name : data.camera.name;
          const extraLines = (data.camera.lineColors?.length ?? 1) - 1;
          const w = Math.min(230, Math.ceil([...name].reduce((width, character) => width + (character.charCodeAt(0) > 0x2e7f ? 11.5 : 6.2), 21 + extraLines * 10)));
          items.push({ id, priority: 100 + (data.camera.lineColors?.length ?? 1), placements: [{ key: 'right', x: anchor.x + 12, y: anchor.y - 10, w, h: 21 }, { key: 'left', x: anchor.x - 12 - w, y: anchor.y - 10, w, h: 21 }, { key: 'above', x: anchor.x - w / 2, y: anchor.y - 33, w, h: 21 }, { key: 'below', x: anchor.x - w / 2, y: anchor.y + 12, w, h: 21 }] });
        }
      });
      const shown = declutterLabels(items, viewport);
      labels.forEach(([id, label]) => {
        const placement = shown.get(id);
        label.classList.toggle('label-hidden', placement === undefined);
        label.classList.toggle('pos-left', placement === 'left');
        label.classList.toggle('pos-above', placement === 'above');
        label.classList.toggle('pos-below', placement === 'below');
      });
    };
    layoutMarkers.current = run;
    run();
    m.on('moveend', run);
    m.on('zoomend', run);
    document.addEventListener('visibilitychange', run);
    return () => { layoutMarkers.current = () => {}; m.off('moveend', run); m.off('zoomend', run); document.removeEventListener('visibilitychange', run); };
  }, [cameras, ready, language, mapZoom, inactive, routeFocus]);
  const routePopupCamera: Camera | null = routePopupStop?.key === busRouteKey && busRoute?.route ? {
    ...(routePopupData && routePopupData.stop === routePopupStop.stop && routePopupData.language === language ? routePopupData.camera : undefined),
    id: `${busRoute.route.operator}-${routePopupStop.stop.id}`, sourceId: routePopupStop.stop.id, kind: busRoute.route.operator,
    name: routePopupStop.stop.nameTc, nameEn: routePopupStop.stop.nameEn, lat: routePopupStop.stop.lat, lng: routePopupStop.stop.lng,
  } : null;
  const popupCamera = selected ?? routePopupCamera;
  const popupId = selected?.id ?? (routePopupCamera ? `route:${busRouteKey}:${routePopupStop!.stop.seq}` : null);
  const popupCameraRef = useRef(popupCamera);
  useEffect(() => { popupCameraRef.current = popupCamera; }, [popupCamera]);
  useEffect(() => {
    if (!routePopupStop) return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      if (routePopupStop.key !== busRouteKey || !busSelection) { setRoutePopupStop(current => current === routePopupStop ? null : current); return; }
      const stop = routePopupStop.stop;
      const terminus = busRoute?.route?.stops.at(-1);
      setRoutePopupData({ stop, language, status: 'loading' });
      void getBusStopArrivals({ ...busSelection, stopId: stop.id, stopSeq: stop.seq }, controller.signal).then(data => {
        if (controller.signal.aborted) return;
        if (!data.ok || data.stale || data.error || !data.observedAt) throw new Error('Stop arrivals unavailable');
        const camera: Camera = { id: `${busSelection.operator}-${stop.id}`, sourceId: stop.id, kind: busSelection.operator, name: stop.nameTc, nameEn: stop.nameEn, lat: stop.lat, lng: stop.lng, dataUpdated: data.observedAt, arrivals: data.arrivals.map(call => ({ ...call, destination: call.destination || terminus?.nameTc || '', destinationEn: call.destinationEn || terminus?.nameEn || terminus?.nameTc || '' })) };
        setRoutePopupData({ stop, language, camera, status: 'ready' });
      }).catch(() => { if (!controller.signal.aborted) setRoutePopupData({ stop, language, status: 'error' }); });
    });
    return () => { controller.abort(); };
  }, [routePopupStop, busRouteKey, busSelection, busRoute, language]);
  useEffect(() => {
    const m = map.current;
    if (!ready || !m || !focusTarget) return;
    popupOrigin.current = null;
    focusMoving.current = true;
    const done = () => { focusMoving.current = false; };
    m.once('moveend', done);
    const animate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (focusTarget.segment) m.fitBounds(focusTarget.segment.path, { padding: [60, 90], maxZoom: 16, animate });
    else m.setView([focusTarget.camera.lat, focusTarget.camera.lng], Math.max(m.getZoom(), 16), { animate });
    return () => { m.off('moveend', done); focusMoving.current = false; };
  }, [focusTarget, ready]);
  useEffect(() => {
    const L = library.current, m = map.current;
    const camera = popupCameraRef.current;
    if (!ready || !L || !m || !popupElement || !popupId || !camera) return;
    const origin = popupOrigin.current?.id === camera.id ? popupOrigin.current : null;
    const source = origin?.element ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const keyboard = Boolean(source?.matches(':focus-visible'));
    const offset = displayOffsets.current.get(popupId);
    const point = origin?.point ?? vehicles.current.get(camera.id)?.marker.getLatLng() ?? L.latLng(camera.lat, camera.lng);
    const popup = L.popup({ offset: L.point(offset?.x ?? 0, -14 + (offset?.y ?? 0)), closeButton: true, closeOnClick: false, closeOnEscapeKey: false, autoPan: false, keepInView: false, minWidth: 180, maxWidth: 320, className: 'item-popup' })
      .setLatLng(point).setContent(popupElement);
    popupElement.setAttribute('class', 'item-popup-content');
    popupElement.setAttribute('id', 'item-popup-details');
    popupElement.setAttribute('data-item-id', camera.id);
    popupElement.setAttribute('role', 'dialog');
    popupElement.setAttribute('aria-labelledby', 'item-detail-title');
    popupElement.setAttribute('tabindex', '-1');
    L.DomEvent.disableClickPropagation(popupElement);
    L.DomEvent.disableScrollPropagation(popupElement);
    let focused = false;
    const focusIn = () => { focused = true; };
    const focusOut = (event: FocusEvent) => { if (event.relatedTarget instanceof Node && !popup.getElement()?.contains(event.relatedTarget)) focused = false; };
    const onRemove = () => {
      const restoreFocus = focused || popup.getElement()?.contains(document.activeElement);
      if (popupRef.current?.popup === popup) popupRef.current = null;
      source?.removeAttribute('aria-controls');
      source?.removeAttribute('aria-expanded');
      popupOrigin.current = null;
      setRoutePopupStop(null);
      closeDetailsRef.current();
      if (restoreFocus) {
        const routeLabel = element.current?.querySelector<HTMLElement>(`.bus-route-stop-label[data-stop-id="${CSS.escape(camera.sourceId)}"]`);
        const replacement = popupId.startsWith('route:') ? routeLabel : markers.current.get(camera.id)?.getElement() ?? vehicles.current.get(camera.id)?.marker.getElement();
        const target = source?.isConnected ? source : replacement ?? element.current;
        target?.focus({ preventScroll: true });
      }
    };
    // While our own reveal pan animates, getBounds() blends the old center
    // with the moving pane and can momentarily report the anchor outside;
    // skip removal then and re-check once the pan settles at moveend.
    let revealing = false;
    const checkViewport = () => { if (revealing) return; const point = popup.getLatLng(); if (popup.isOpen() && point && !m.getBounds().contains(point)) popup.remove(); };
    const endReveal = () => { if (revealing) { revealing = false; checkViewport(); } };
    const closeOnBlank = (event: Leaflet.LeafletMouseEvent) => {
      const target = event.originalEvent?.target;
      if (event.sourceTarget !== m || target instanceof Element && target.closest('.leaflet-marker-icon,.leaflet-popup,.leaflet-tooltip,.leaflet-control-container')) return;
      popup.remove();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.target instanceof Element && event.target.closest('dialog[open],[data-slot="popover-content"]')) return;
      if (event.key === 'Escape' && popup.isOpen()) { event.preventDefault(); popup.remove(); }
    };
    const sizePopup = () => {
      const area = m.getContainer().getBoundingClientRect();
      const workspace = m.getContainer().closest('.app-shell');
      const visibleBounds = (selector: string) => [...(workspace?.querySelectorAll<HTMLElement>(selector) ?? [])].filter(node => {
        const style = getComputedStyle(node); return style.display !== 'none' && style.visibility !== 'hidden' && node.getBoundingClientRect().height > 0;
      }).map(node => node.getBoundingClientRect());
      const top = Math.max(area.top, ...visibleBounds('.topbar,.traffic-status').map(bounds => bounds.bottom));
      const bottom = Math.min(area.bottom, ...visibleBounds('.intel-shell,.desktop-layer-dock,.mobile-dock,.layer-group-picker').map(bounds => bounds.top));
      const right = Math.min(area.right, ...visibleBounds('.map-tools').map(bounds => bounds.left));
      const node = popup.getElement();
      node?.style.setProperty('--item-popup-width', `${Math.max(180, Math.min(320, right - area.left - 24))}px`);
      node?.style.setProperty('--item-popup-max-height', `${Math.max(44, Math.min(420, bottom - top - 36))}px`);
      node?.style.setProperty('--item-color', (vehicles.current.get(camera.id)?.camera ?? markerData.current.get(camera.id)?.camera ?? camera).color ?? layers[camera.kind].color);
      popup.options.autoPanPaddingTopLeft = L.point(12, top - area.top + 12);
      popup.options.autoPanPaddingBottomRight = L.point(area.right - right + 12, area.bottom - bottom + 12);
      updatePopup(popup);
    };
    const resize = () => {
      checkViewport();
      if (!popup.isOpen()) return;
      sizePopup();
      panToReveal();
    };
    // Reveal the card with a bounded pan of our own. Leaflet's autoPan keeps
    // panning until the card fits the padded workspace, and for a tall card
    // near an edge that pan pushes the card's own anchor out of the map;
    // checkViewport then reads the anchor as scrolled away and removes the
    // popup moments after it opened. Reveal the card, draw an off-screen
    // anchor back in (earlier popups may have panned it out), and cap the
    // pan so the anchor always stays a margin inside the map.
    const panToReveal = () => {
      const node = popup.getElement(), area = m.getContainer().getBoundingClientRect();
      if (!node || !area.width || !area.height) return;
      const rect = node.getBoundingClientRect();
      const padding = {
        topLeft: L.point(popup.options.autoPanPaddingTopLeft ?? L.point(12, 12)),
        bottomRight: L.point(popup.options.autoPanPaddingBottomRight ?? L.point(12, 12)),
      };
      // panBy subtracts from the pane position, so a positive delta moves the
      // card up/left: revealing a bottom/right overflow needs a positive pan.
      const delta = L.point(
        Math.max(0, (rect.right - area.left) - (area.width - padding.bottomRight.x)) - Math.max(0, padding.topLeft.x - (rect.left - area.left)),
        Math.max(0, (rect.bottom - area.top) - (area.height - padding.bottomRight.y)) - Math.max(0, padding.topLeft.y - (rect.top - area.top)),
      );
      const anchor = popup.getLatLng();
      if (anchor) {
        const margin = 12, point = m.latLngToContainerPoint(anchor), size = m.getSize();
        delta.x += Math.max(0, point.x - (size.x - margin)) + Math.min(0, point.x - margin);
        delta.y += Math.max(0, point.y - (size.y - margin)) + Math.min(0, point.y - margin);
        // The pan moves the anchor by -delta; keep it a margin inside the map.
        delta.x = Math.min(Math.max(delta.x, point.x - (size.x - margin)), point.x - margin);
        delta.y = Math.min(Math.max(delta.y, point.y - (size.y - margin)), point.y - margin);
      }
      if (!delta.x && !delta.y) return;
      revealing = true;
      m.panBy(delta, { animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches });
    };
    const open = () => {
      popup.openOn(m);
      popupRef.current = { popup, stopId: popupId };
      popupElement.scrollTo({ top: 0 });
      sizePopup();
      const node = popup.getElement();
      node?.addEventListener('focusin', focusIn); node?.addEventListener('focusout', focusOut);
      const closeButton = node?.querySelector<HTMLAnchorElement>('.leaflet-popup-close-button');
      closeButton?.setAttribute('aria-label', messages[popupLanguage.current].closeControls);
      closeButton?.setAttribute('title', messages[popupLanguage.current].closeControls);
      source?.setAttribute('aria-controls', popupElement.id);
      source?.setAttribute('aria-expanded', 'true');
      updatePopup(popup);
      panToReveal();
      popup.on('remove', onRemove);
      if (keyboard) popupElement.focus({ preventScroll: true });
      detailsOpenRef.current?.(popupElement);
    };
    if (focusMoving.current) m.once('moveend', open);
    else open();
    m.on('moveend', checkViewport);
    m.on('moveend', endReveal);
    m.on('resize', resize);
    m.on('click', closeOnBlank);
    document.addEventListener('keydown', escape);
    const observer = new ResizeObserver(() => { if (popup.isOpen()) { sizePopup(); checkViewport(); } });
    observer.observe(popupElement);
    m.getContainer().closest('.app-shell')?.querySelectorAll<HTMLElement>('.topbar,.traffic-status,.intel-shell,.desktop-layer-dock,.mobile-dock,.layer-group-picker,.map-tools').forEach(node => observer.observe(node));
    return () => {
      observer.disconnect(); m.off('moveend', open); m.off('moveend', checkViewport); m.off('moveend', endReveal); m.off('resize', resize); m.off('click', closeOnBlank); document.removeEventListener('keydown', escape);
      popup.getElement()?.removeEventListener('focusin', focusIn); popup.getElement()?.removeEventListener('focusout', focusOut);
      popup.off('remove', onRemove); if (popupRef.current?.popup === popup) popupRef.current = null; popup.remove();
      source?.removeAttribute('aria-controls'); source?.removeAttribute('aria-expanded');
    };
  }, [ready, popupId, popupElement, focusTarget]);
  useEffect(() => {
    const entry = popupRef.current;
    if (!entry || !popupCamera) return;
    const displayed = vehicles.current.get(popupCamera.id)?.camera ?? markerData.current.get(popupCamera.id)?.camera ?? popupCamera;
    entry.popup.getElement()?.style.setProperty('--item-color', displayed.color ?? layers[displayed.kind].color);
    const closeButton = entry.popup.getElement()?.querySelector<HTMLAnchorElement>('.leaflet-popup-close-button');
    closeButton?.setAttribute('aria-label', copy.closeControls); closeButton?.setAttribute('title', copy.closeControls);
    updatePopup(entry.popup);
  }, [popupCamera, cameras, language, copy.closeControls]);
  useEffect(() => {
    const L = library.current, m = map.current;
    if (!ready || !L || !m) return;
    const group = L.layerGroup().addTo(m);
    const rail = (paths ?? []).filter(path => /^(mtr|lrt)-/.test(path.id));
    if (rail.length) m.attributionControl.addAttribution(OSM_ATTRIBUTION);
    rail.forEach(path => L.polyline(path.points, { color: '#fff', weight: 6, opacity: .9, smoothFactor: 0, interactive: false, renderer: railRenderer.current ?? undefined, className: 'rail-route-halo' }).addTo(group));
    paths?.forEach(path => {
      const isRail = /^(mtr|lrt)-/.test(path.id);
      L.polyline(path.points, { color: path.color, weight: isRail ? 3.5 : 3, opacity: isRail ? .95 : .65, smoothFactor: 0, dashArray: isRail ? undefined : '10 7', interactive: false, renderer: (isRail ? railRenderer.current : segmentRenderer.current) ?? undefined, className: isRail ? 'rail-route-polyline' : 'ferry-route-polyline' }).addTo(group);
    });
    return () => { group.remove(); if (rail.length) m.attributionControl.removeAttribution(OSM_ATTRIBUTION); };
  }, [paths, ready]);
  useEffect(() => {
    const L = library.current, m = map.current;
    if (!ready || !L || !m) return;
    const route = busRoute?.route;
    if (!route) { fittedBusRoute.current = null; return; }
    const group = L.layerGroup().addTo(m);
    const points = route.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]);
    const color = layers[route.operator].color;
    L.polyline(points, { color: '#fff', weight: 8, opacity: .95, interactive: false }).addTo(group);
    L.polyline(points, { color, weight: 4, opacity: 1, interactive: false, dashArray: route.geometry === 'stops' ? '7 7' : undefined, className: 'bus-route-polyline' }).addTo(group);
    const compact = window.matchMedia('(max-width:700px),(max-height:520px) and (orientation:landscape)').matches;
    const labels: { button: HTMLButtonElement; marker: Leaflet.CircleMarker }[] = [];
    route.stops.forEach((stop, index) => {
      const endpoint = index === 0 || index === route.stops.length - 1;
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'bus-route-stop-label'; button.textContent = language === 'en' ? stop.nameEn || stop.nameTc : stop.nameTc || stop.nameEn;
      button.dataset.stopId = stop.id; button.dataset.stopSeq = String(stop.seq); button.style.setProperty('--route-color', color);
      button.setAttribute('aria-label', `${button.textContent} · ${integrationMessages[language].stopArrivals}`); button.setAttribute('aria-haspopup', 'dialog');
      L.DomEvent.disableClickPropagation(button);
      button.addEventListener('click', event => {
        L.DomEvent.stopPropagation(event);
        popupOrigin.current = { id: `${route.operator}-${stop.id}`, element: button };
        closeDetailsRef.current();
        setRoutePopupStop({ key: route.key, stop });
      });
      const marker = L.circleMarker([stop.lat, stop.lng], { radius: endpoint ? 5 : 3, color, weight: 2, fillColor: '#fff', fillOpacity: 1, interactive: false, className: 'bus-route-stop' }).addTo(group)
        .bindTooltip(button, { permanent: true, direction: 'auto', offset: [8, 0], interactive: true, opacity: 1, className: 'bus-route-stop-tooltip' });
      marker.getTooltip()?.getElement()?.removeAttribute('role');
      labels.push({ button, marker });
    });
    const positionLabels = () => {
      const width = m.getSize().x;
      labels.forEach(({ button, marker }) => {
        button.style.maxWidth = `${Math.max(100, Math.min(220, width / 2 - 30))}px`;
        const tooltip = marker.getTooltip();
        if (tooltip) { tooltip.options.direction = m.latLngToContainerPoint(marker.getLatLng()).x < width / 2 ? 'right' : 'left'; tooltip.update(); }
      });
    };
    positionLabels(); m.on('moveend resize', positionLabels);
    if (!inactive && fittedBusRoute.current !== route.key && points.length > 1) {
      fittedBusRoute.current = route.key;
      const labelHalfHeight = Math.max(0, ...labels.map(({ button }) => button.offsetHeight / 2));
      m.fitBounds(points, { paddingTopLeft: [compact ? 60 : 90, 80 + labelHalfHeight], paddingBottomRight: [compact ? 70 : 85, (compact ? 170 : 125) + labelHalfHeight], maxZoom: 16, animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches });
    }
    return () => { m.off('moveend resize', positionLabels); group.remove(); };
  }, [busRoute, ready, inactive, language]);
  // Route-focus hides every bus stop (CSS on the container — markers stay
  // mounted) until the rider clicks blank map space; the route, stop circles
  // and vehicle are unaffected. Clearing the route re-shows stops for free.
  useEffect(() => {
    const m = map.current, container = element.current;
    if (!ready || !m || !container) return;
    container.classList.toggle('route-focus', routeFocus);
    if (!routeFocus || !busRouteKey) return () => container.classList.remove('route-focus');
    const reveal = (event: Leaflet.LeafletMouseEvent) => {
      const target = event.originalEvent.target;
      if (target instanceof Element && target.closest('.leaflet-marker-icon, .leaflet-popup, .leaflet-tooltip, .leaflet-control-container')) return;
      setRevealedRouteKey(busRouteKey);
    };
    m.on('click', reveal);
    return () => { m.off('click', reveal); container.classList.remove('route-focus'); };
  }, [ready, routeFocus, busRouteKey]);
  useEffect(() => {
    const L = library.current, m = map.current;
    if (!ready || !L || !m) return;
    const route = busRoute?.route;
    const remove = () => { busVehicle.current?.marker.remove(); busVehicle.current = null; };
    if (!route || !busRoute) { remove(); return; }
    const distances = routeDistances(route.coordinates);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame: number | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let zooming = m.getContainer().classList.contains('leaflet-zoom-anim');
    const name = `${route.route} · ${language === 'en' ? 'Estimated bus position' : '估算巴士位置'}`;
    const terminus = route.stops[route.stops.length - 1];
    const destination = `${route.route} → ${language === 'en' ? terminus?.nameEn || terminus?.nameTc || route.route : terminus?.nameTc || route.route}`;
    if (busVehicle.current) {
      const destEl = busVehicle.current.marker.getElement()?.querySelector<HTMLElement>('.vehicle-dest');
      if (destEl) destEl.textContent = destination;
      const icon = busVehicle.current.marker.getElement();
      if (icon) { icon.title = name; icon.setAttribute('aria-label', name); }
    }
    const tick = (move = true) => {
      const now = Date.now();
      const distance = busDistanceAtTime(busRoute, now);
      if (distance === null) { remove(); return; }
      let entry = busVehicle.current;
      if (entry && entry.key !== route.key) { remove(); entry = null; }
      if (entry && entry.feed !== busRoute) {
        entry.correction = reducedMotion.matches ? undefined : { distance: entry.distance - distance, at: now };
        entry.feed = busRoute;
      }
      const remaining = !reducedMotion.matches && entry?.correction ? Math.max(0, 1 - (now - entry.correction.at) / 2000) ** 3 : 0;
      const displayDistance = distance + (entry?.correction?.distance ?? 0) * remaining;
      const coordinate = routePointAtDistance(route.coordinates, distances, displayDistance);
      if (!coordinate) { remove(); return; }
      const point = L.latLng(coordinate[1], coordinate[0]);
      if (!entry) {
        const icon = L.divIcon({ className: 'camera-marker vehicle-marker bus-route-marker', html: vehicleHtml(vehicleIcon({ kind: route.operator, route: route.route, company: route.company }), layers[route.operator].color, destination), iconSize: [24, 24], iconAnchor: [12, 12] });
        const marker = enableMarkerKeyboard(L.marker(point, { icon, title: name, alt: name, keyboard: true, zIndexOffset: 500 }).addTo(m));
        marker.getElement()?.setAttribute('aria-label', name);
        busVehicle.current = entry = { key: route.key, marker, distance: displayDistance, feed: busRoute, heading: marker.getElement()?.querySelector<HTMLElement>('.vehicle-heading') ?? null };
      }
      // Rotate inside the marker; Leaflet owns its outer transform.
      const heading = routeHeadingAtDistance(route.coordinates, distances, displayDistance);
      if (heading !== null) {
        entry.heading ??= entry.marker.getElement()?.querySelector<HTMLElement>('.vehicle-heading') ?? null;
        if (entry.heading) entry.heading.style.transform = `rotate(${heading + vehicleIconHeadingOffset}deg)`;
      }
      if (move) {
        entry.distance = displayDistance;
        if (!remaining) entry.correction = undefined;
        entry.marker.setLatLng(point);
        const icon = entry.marker.getElement();
        if (icon) L.DomUtil.setPosition(icon, m.project(point).subtract(m.getPixelOrigin()));
      }
    };
    const animate = () => { tick(); frame = requestAnimationFrame(animate); };
    const visible = () => {
      if (frame !== undefined) cancelAnimationFrame(frame); frame = undefined;
      if (timer) clearInterval(timer); timer = undefined;
      const paused = inactive || zooming || document.visibilityState !== 'visible';
      element.current?.classList.toggle('map-motion-paused', paused || reducedMotion.matches);
      if (paused) return;
      tick();
      if (reducedMotion.matches) timer = setInterval(() => tick(false), 1000);
      else frame = requestAnimationFrame(animate);
    };
    const startZoom = () => { zooming = true; visible(); };
    const endZoom = () => { zooming = false; visible(); };
    if (busVehicle.current?.key !== route.key || busDistanceAtTime(busRoute, Date.now()) === null) remove();
    visible(); document.addEventListener('visibilitychange', visible); reducedMotion.addEventListener('change', visible); m.on('zoomstart', startZoom); m.on('zoomend', endZoom);
    return () => { if (frame !== undefined) cancelAnimationFrame(frame); if (timer) clearInterval(timer); document.removeEventListener('visibilitychange', visible); reducedMotion.removeEventListener('change', visible); m.off('zoomstart', startZoom); m.off('zoomend', endZoom); };
  }, [busRoute, ready, language, inactive]);
  useEffect(() => {
    const L = library.current, m = map.current;
    if (!ready || !L || !m) return;
    const group = vehicleGroup.current ??= L.layerGroup().addTo(m);
    const entries = vehicles.current;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame: number | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let zooming = m.getContainer().classList.contains('leaflet-zoom-anim');
    const tick = (move = true) => {
      const now = Date.now();
      const next = (['mtr', 'lrt', 'ferry'] as const).flatMap(kind => transitFeeds?.[kind] ? movingCameras(kind, transitFeeds[kind]!, now) : []).filter(camera => Number.isFinite(camera.lat) && Number.isFinite(camera.lng));
      const ids = new Set(next.map(camera => camera.id));
      entries.forEach((entry, id) => { if (!ids.has(id)) { group.removeLayer(entry.marker); entries.delete(id); if (popupRef.current?.stopId === id) popupRef.current.popup.remove(); } });
      next.forEach(camera => {
        const name = language === 'en' ? camera.nameEn || camera.name : camera.name;
        const rail = camera.kind === 'mtr' || camera.kind === 'lrt';
        const routePosition = camera.routePosition;
        const feed = transitFeeds?.[camera.kind as 'mtr' | 'lrt' | 'ferry'];
        const existing = entries.get(camera.id);
        if (existing) {
          const node = existing.marker.getElement();
          if (existing.feed !== feed) {
            // Refresh corrections follow the route the vehicle is on: a distance offset walks the
            // surveyed path, while a latitude/longitude tween would cut across a bend. Only a GPS
            // fix without a surveyed route falls back to that tween.
            if (routePosition) existing.routeCorrection = !reducedMotion.matches && existing.camera.routePosition?.key === routePosition.key && existing.routeDistance !== undefined ? { distance: existing.routeDistance - routePosition.distance, at: now } : undefined;
            else if (!rail && camera.positionSource === 'gps' && !reducedMotion.matches) {
              const position = existing.marker.getLatLng();
              existing.correction = { lat: position.lat - camera.lat, lng: position.lng - camera.lng, at: now };
            } else if (!rail) existing.correction = undefined;
          }
          if (existing.language !== language || existing.camera.name !== camera.name || existing.camera.nameEn !== camera.nameEn) {
            const destination = vehicleDestination(camera, language, name);
            const destEl = node?.querySelector<HTMLElement>('.vehicle-dest');
            if (destEl && destEl.textContent !== destination) destEl.textContent = destination;
          }
          // An interpolated boat keeps the label of its source, so a marker projected forward from
          // an operator GPS fix still reads as GPS rather than as a timetable estimate.
          if (!rail && (existing.language !== language || existing.camera.name !== camera.name || existing.camera.nameEn !== camera.nameEn || existing.camera.positionSource !== camera.positionSource)) {
            const icon = existing.marker.getElement(); if (icon) { icon.title = name; icon.setAttribute('aria-label', `${name} · ${camera.positionSource === 'gps' ? integrationMessages[language].gps : integrationMessages[language].estimatedFerry}`); }
          }
          const correction = routePosition ? existing.routeCorrection : existing.correction;
          const remaining = !reducedMotion.matches && correction ? Math.max(0, 1 - (now - correction.at) / 1000) ** 3 : 0;
          const routeDistance = routePosition ? routePosition.distance + (existing.routeCorrection?.distance ?? 0) * remaining : undefined;
          const routePoint = routePosition && routeDistance !== undefined ? routePointAtDistance(routePosition.coordinates, routePosition.distances, routeDistance) : null;
          const point = routePoint ? L.latLng(routePoint[1], routePoint[0]) : L.latLng(camera.lat + (existing.correction?.lat ?? 0) * remaining, camera.lng + (existing.correction?.lng ?? 0) * remaining);
          const previous = existing.marker.getLatLng();
          const dx = (point.lng - previous.lng) * Math.cos(point.lat * Math.PI / 180), dy = point.lat - previous.lat;
          const running = Math.abs(dx) + Math.abs(dy) > 1e-10;
          if (rail && node && (existing.feed !== feed || existing.language !== language || existing.camera.nextStation?.name !== camera.nextStation?.name || now - existing.hoverAt >= 1000)) {
            const hover = railHoverText(camera, language, now);
            if (node.title !== hover) { node.title = hover; node.setAttribute('aria-label', hover); }
            existing.hoverAt = now;
          }
          if (existing.camera.color !== camera.color) node?.querySelector<HTMLElement>('.marker-displacement')?.style.setProperty('--marker-color', camera.color ?? layers[camera.kind].color);
          const heading = node?.querySelector<HTMLElement>('.vehicle-heading');
          if (running && heading) heading.style.transform = `rotate(${Math.atan2(dx, dy) * 180 / Math.PI + vehicleIconHeadingOffset}deg)`;
          const art = node?.querySelector<HTMLImageElement>('.vehicle-art');
          if (art && vehicleIcon(existing.camera) !== vehicleIcon(camera)) art.src = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}${vehicleIcon(camera)}`;
          existing.camera = camera; existing.feed = feed; existing.language = language;
          if (move) {
            if (!remaining) { existing.correction = undefined; existing.routeCorrection = undefined; }
            existing.routeDistance = routeDistance;
            existing.marker.setLatLng(point);
            // Leaflet rounds marker pixels; retain its geographic state with subpixel display motion.
            const icon = existing.marker.getElement(); if (icon) L.DomUtil.setPosition(icon, m.project(point).subtract(m.getPixelOrigin()));
          }
          const popup = popupRef.current;
          if (popup?.stopId === camera.id) {
            const position = existing.marker.getLatLng();
            if (!m.getBounds().contains(position)) popup.popup.remove();
            else { popup.popup.setLatLng(position); popup.popup.getElement()?.style.setProperty('--item-color', camera.color ?? layers[camera.kind].color); }
          }
          return;
        }
        const hover = rail ? railHoverText(camera, language, now) : name;
        const icon = L.divIcon({ className: `camera-marker vehicle-marker${rail ? ' rail-marker' : ' ferry-marker'}`, html: vehicleHtml(vehicleIcon(camera), camera.color ?? layers[camera.kind].color, vehicleDestination(camera, language, name)), iconSize: [24, 24], iconAnchor: [12, 12] });
        const marker = enableMarkerKeyboard(L.marker([camera.lat, camera.lng], { icon, title: hover, alt: name, keyboard: true }).addTo(group));
        const vehicleLabel = rail ? hover : `${name} · ${camera.positionSource === 'gps' ? integrationMessages[language].gps : integrationMessages[language].estimatedFerry}`;
        const node = marker.getElement();
        node?.setAttribute('aria-label', vehicleLabel); node?.setAttribute('aria-haspopup', 'dialog');
        if (node) node.dataset.markerId = camera.id;
        marker.on('click', () => {
          const latest = entries.get(camera.id);
          if (!latest) return;
          popupOrigin.current = { id: latest.camera.id, element: marker.getElement() ?? null };
          setRoutePopupStop(null);
          selectRef.current(latest.camera);
        });
        entries.set(camera.id, { marker, camera, feed, language, hoverAt: now, routeDistance: routePosition?.distance });
      });
    };
    const animate = () => { tick(); frame = requestAnimationFrame(animate); };
    const visible = () => {
      if (frame !== undefined) cancelAnimationFrame(frame); frame = undefined;
      if (timer) clearInterval(timer); timer = undefined;
      const paused = inactive || zooming || document.visibilityState !== 'visible';
      element.current?.classList.toggle('map-motion-paused', paused || reducedMotion.matches);
      if (paused) return;
      tick();
      if (reducedMotion.matches) timer = setInterval(() => tick(false), 1000);
      else frame = requestAnimationFrame(animate);
    };
    const startZoom = () => { zooming = true; visible(); };
    const endZoom = () => { zooming = false; visible(); };
    visible(); document.addEventListener('visibilitychange', visible); reducedMotion.addEventListener('change', visible); m.on('zoomstart', startZoom); m.on('zoomend', endZoom);
    return () => { if (frame !== undefined) cancelAnimationFrame(frame); if (timer) clearInterval(timer); document.removeEventListener('visibilitychange', visible); reducedMotion.removeEventListener('change', visible); m.off('zoomstart', startZoom); m.off('zoomend', endZoom); };
  }, [ready, transitFeeds, language, inactive]);
  useEffect(() => {
    const L = library.current, group = segmentGroup.current;
    if (!ready || !L || !group) return;
    group.clearLayers();
    segmentPolylines.current.clear();
    (segments ?? []).forEach(segment => {
      const name = language === 'en' ? segment.nameEn || segment.name : segment.name;
      const polyline = L.polyline(segment.path, {
        color: speedLevelColors[segment.level],
        weight: FLOW_SEGMENT_WEIGHT, opacity: 0.85, lineCap: 'round', lineJoin: 'round', smoothFactor: 1,
        renderer: segmentRenderer.current ?? undefined, className: 'segment-polyline',
      });
      polyline.bindTooltip(name, { sticky: true, direction: 'top', offset: [0, -10] });
      polyline.on('click', (event: Leaflet.LeafletMouseEvent) => {
        popupOrigin.current = { id: segment.id, element: element.current, point: event.latlng };
        setRoutePopupStop(null);
        onSelectSegmentRef.current?.(segment);
      });
      segmentPolylines.current.set(segment.id, polyline);
      group.addLayer(polyline);
    });
  }, [segments, ready, language]);
  useEffect(() => {
    const L = library.current, m = map.current;
    if (!ready || !L || !m) return;
    const renderer = L.svg({ padding: 0.1 });
    const group = L.layerGroup().addTo(m);
    const dots = new Map<string, Leaflet.Polyline>();
    const candidates = (segments ?? []).filter(segment => segment.level !== 'unknown' && segment.speedKmh !== null && Number.isFinite(segment.speedKmh) && segment.speedKmh >= 0 && segment.path.length > 1).map(segment => ({ segment, bounds: L.latLngBounds(segment.path) }));
    const update = () => {
      const viewport = m.getBounds();
      const batches = new Map<string, { speed: number; reversed: boolean; weight: number; paths: [number, number][][] }>();
      candidates.forEach(({ segment, bounds }) => {
        if (!viewport.intersects(bounds)) return;
        const speed = segment.speedKmh!, reversed = segment.direction === 2, weight = segment.id === selectedSegmentId ? SELECTED_FLOW_SEGMENT_WEIGHT : FLOW_SEGMENT_WEIGHT, key = `${speed}:${reversed}:${weight}`;
        let batch = batches.get(key);
        if (!batch) { batch = { speed, reversed, weight, paths: [] }; batches.set(key, batch); }
        batch.paths.push(segment.path);
      });
      dots.forEach((line, key) => { if (!batches.has(key)) { group.removeLayer(line); dots.delete(key); } });
      // Disconnected subpaths share one animation per speed and direction, avoiding thousands of animated SVG elements.
      batches.forEach(({ speed, reversed, weight, paths }, key) => {
        const existing = dots.get(key);
        if (existing) { existing.setLatLngs(paths); return; }
        const line = L.polyline(paths, { color: '#fff', weight, opacity: 0.9, dashArray: '0 72', lineCap: 'round', lineJoin: 'round', smoothFactor: 1, interactive: false, renderer, className: `segment-speed-dots${speed > 0 ? ' is-moving' : ''}${reversed ? ' is-reversed' : ''}` }).addTo(group);
        if (speed > 0) (line.getElement() as SVGElement | undefined)?.style.setProperty('--speed-dot-duration', `${144 / (speed * 0.49)}s`);
        dots.set(key, line);
      });
    };
    update(); m.on('moveend', update);
    return () => { m.off('moveend', update); group.remove(); renderer.remove(); };
  }, [segments, ready, selectedSegmentId]);
  useEffect(() => {
    if (previousSelection.current) markers.current.get(previousSelection.current)?.getElement()?.querySelector('.marker-inner')?.classList.remove('selected');
    if (selected) markers.current.get(selected.id)?.getElement()?.querySelector('.marker-inner')?.classList.add('selected');
    previousSelection.current = selected?.id ?? null;
  }, [selected, cameras]);
  useEffect(() => {
    if (previousSegmentSelection.current) {
      const prev = segmentPolylines.current.get(previousSegmentSelection.current);
      if (prev) prev.setStyle({ weight: FLOW_SEGMENT_WEIGHT, opacity: 0.85 });
    }
    if (selectedSegmentId) {
      const next = segmentPolylines.current.get(selectedSegmentId);
      if (next) { next.setStyle({ weight: SELECTED_FLOW_SEGMENT_WEIGHT, opacity: 1 }); next.bringToFront(); }
    }
    previousSegmentSelection.current = selectedSegmentId ?? null;
  }, [selectedSegmentId, segments]);
  function fit() {
    map.current?.setView([22.355, 114.13], 11, { animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches });
  }
  const locationErrorMessage = locationError === 'denied' ? copy.locationDenied : locationError === 'timeout' ? copy.locationTimeout : locationError === 'unsupported' ? copy.locationUnsupported : copy.locationUnavailable;
  return <section className="map-area" aria-label={copy.mapLabel} aria-hidden={inactive || undefined} inert={inactive || undefined}>
    <div ref={element} className="map-canvas" data-basemap={basemap} role="group" aria-label={copy.mapKeyboardHelp} />
    <div className="map-tools"><div className="zoom-buttons"><button aria-label={copy.zoomIn} title={copy.zoomIn} onClick={() => map.current?.zoomIn()}><Plus size={19}/></button><button aria-label={copy.zoomOut} title={copy.zoomOut} onClick={() => map.current?.zoomOut()}><Minus size={19}/></button></div><button aria-label={copy.showAll} title={copy.returnToHongKong} onClick={fit}><Maximize size={20}/></button><button type="button" className="gps-button" aria-label={followingLocation ? copy.stopFollowing : copy.locateMe} title={followingLocation ? copy.stopFollowing : copy.locateMe} aria-pressed={followingLocation} aria-busy={locating} disabled={!ready} onClick={followingLocation ? stopLocating : locate}>{locating ? <LoaderCircle className="spin" size={20}/> : <LocateFixed size={20}/>}</button></div>
    <span className="sr-only" role="status">{locating ? copy.locating : locationFound ? copy.locationFound : ''}</span>
    {locationError && <div className={`map-error location-error${mapError ? ' with-map-error' : ''}`} role="alert">{locationErrorMessage}<button type="button" className="map-retry" onClick={() => setLocationError(null)}>{copy.dismissLocationError}</button></div>}
    {mapError && <div className="map-error" role="alert">{copy.mapLoadFailed}<button type="button" className="map-retry" onClick={() => ready ? setBasemapRetry(value => value + 1) : window.location.reload()}><RefreshCw size={14}/>{copy.retry}</button></div>}
    {!ready && !mapError && <div className="map-loading"><LoaderCircle className="spin" size={20}/> {copy.mapLoading}</div>}
    {ready && !loading && cameras.length === 0 && !segments?.length && <div className="map-empty"><strong>{allDisabled ? copy.allLayersOff : hasErrors ? copy.cameraLoadFailed : copy.noCameraLocations}</strong>{allDisabled ? copy.turnOnLayer : copy.checkLayers}</div>}
    {popupElement && popupCamera && createPortal(renderItemDetails(popupCamera, selected ? undefined : {
      status: routePopupData && routePopupData.stop === routePopupStop?.stop && routePopupData.language === language ? routePopupData.status : 'loading',
      onRetry: () => setRoutePopupStop(current => current ? { ...current } : null),
      onClose: () => setRoutePopupStop(null),
    }), popupElement)}
    {snapshotHover && createPortal(<div onClick={event => {
      if (event.target instanceof Element && event.target.closest('button,a')) return;
      popupOrigin.current = { id: snapshotHover.camera.id, element: markers.current.get(snapshotHover.camera.id)?.getElement() ?? null };
      setRoutePopupStop(null);
      selectRef.current(snapshotHover.camera);
    }}>{snapshotHover.camera.kind === 'ferry' ? <FerryPierPopup camera={snapshotHover.camera} language={language} now={now}/> : <><strong className="snapshot-hover-name">{language === 'en' ? snapshotHover.camera.nameEn || snapshotHover.camera.name : snapshotHover.camera.name}</strong><SnapshotImage camera={snapshotHover.camera} language={language} onActivity={onActivity}/></>}</div>, snapshotHover.element)}
  </section>;
}
