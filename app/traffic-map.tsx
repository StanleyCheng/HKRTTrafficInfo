'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize, Plus, Minus, LoaderCircle, RefreshCw, LocateFixed } from 'lucide-react';
import type * as Leaflet from 'leaflet';
import { messages } from '@/lib/i18n';
import { Camera, CameraData, FlowSegment, Language, MapPath, layerText, layers, speedLevelColors } from '@/lib/traffic';
import type { TrafficSearchItem } from '@/lib/traffic-view';
import { movingCameras, type MapViewport } from '@/lib/integration-client';
import { stopPlate } from '@/lib/stop-plate';

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
const FLOW_SEGMENT_WEIGHT = 4.8;
const SELECTED_FLOW_SEGMENT_WEIGHT = 7.2;
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';
const OPENFREEMAP_ATTRIBUTION = '<a href="https://openfreemap.org/" target="_blank" rel="noreferrer">OpenFreeMap</a> &copy; <a href="https://openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';

export type Basemap = 'osm' | 'positron';
type Props = { onActivity: () => () => void; cameras: Camera[]; paths?: MapPath[]; transitFeeds?: Partial<Record<'mtr' | 'lrt' | 'ferry', CameraData>>; onViewport?: (view: MapViewport) => void; segments?: FlowSegment[]; selected: Camera | null; selectedSegmentId?: string | null; onSelect: (camera: Camera) => void; onSelectSegment?: (segment: FlowSegment) => void; focusTarget?: TrafficSearchItem | null; loading: boolean; allDisabled: boolean; hasErrors: boolean; language: Language; basemap: Basemap; inactive?: boolean };
export default function TrafficMap({ onActivity, cameras, paths, transitFeeds, onViewport, segments, selected, selectedSegmentId, onSelect, onSelectSegment, focusTarget, loading, allDisabled, hasErrors, language, basemap, inactive = false }: Props) {
  const copy = messages[language];
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const library = useRef<typeof Leaflet | null>(null);
  const basemapLayer = useRef<Leaflet.Layer | null>(null);
  const cluster = useRef<Leaflet.MarkerClusterGroup | null>(null);
  const stationGroup = useRef<Leaflet.LayerGroup | null>(null);
  const markers = useRef(new Map<string, Leaflet.Marker>());
  const markerData = useRef(new Map<string, { camera: Camera; style: string }>());
  const previousSelection = useRef<string | null>(null);
  const selectRef = useRef(onSelect);
  const copyRef = useRef(copy);
  const segmentGroup = useRef<Leaflet.LayerGroup | null>(null);
  const segmentRenderer = useRef<Leaflet.Renderer | null>(null);
  const segmentPolylines = useRef(new Map<string, Leaflet.Polyline>());
  const vehicleGroup = useRef<Leaflet.LayerGroup | null>(null);
  const vehicles = useRef(new Map<string, { marker: Leaflet.Marker; camera: Camera; feed: CameraData | undefined; language: Language; correction?: { lat: number; lng: number; at: number } }>());
  const previousSegmentSelection = useRef<string | null>(null);
  const onSelectSegmentRef = useRef(onSelectSegment);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [basemapRetry, setBasemapRetry] = useState(0);
  const [mapZoom, setMapZoom] = useState(11);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<'denied' | 'unavailable' | 'timeout' | 'unsupported' | null>(null);
  const [locationFound, setLocationFound] = useState(false);
  const locationPending = useRef(false);
  const locationLayer = useRef<Leaflet.LayerGroup | null>(null);
  const viewportCallback = useRef(onViewport);
  const locate = useCallback(() => {
    const m = map.current, L = library.current;
    if (!m || !L || locationPending.current) return;
    setLocationError(null);
    setLocationFound(false);
    locationLayer.current?.clearLayers();
    if (!navigator.geolocation) {
      setLocationError('unsupported');
      return;
    }
    locationPending.current = true;
    setLocating(true);
    const fail = (code: number) => {
      if (map.current !== m) return;
      locationPending.current = false;
      setLocating(false);
      setLocationError(code === 1 ? 'denied' : code === 3 ? 'timeout' : 'unavailable');
    };
    try {
      navigator.geolocation.getCurrentPosition(position => {
        if (map.current !== m) return;
        locationPending.current = false;
        setLocating(false);
        const point: Leaflet.LatLngExpression = [position.coords.latitude, position.coords.longitude];
        locationLayer.current ??= L.layerGroup().addTo(m);
        locationLayer.current.clearLayers();
        L.circle(point, { radius: position.coords.accuracy, color: '#137f87', weight: 1, fillOpacity: 0.08, interactive: false, className: 'user-location-accuracy' }).addTo(locationLayer.current);
        L.circleMarker(point, { radius: 7, color: '#fff', weight: 3, fillColor: '#137f87', fillOpacity: 1, interactive: false, pane: 'userLocation', className: 'user-location-dot' }).addTo(locationLayer.current);
        m.setView(point, Math.max(m.getZoom(), 16), { animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches });
        setLocationFound(true);
      }, error => fail(error.code), { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
    } catch {
      fail(2);
    }
  }, []);
  useEffect(() => { viewportCallback.current = onViewport; }, [onViewport]);
  useEffect(() => { selectRef.current = onSelect; }, [onSelect]);
  useEffect(() => { copyRef.current = copy; }, [copy]);
  useEffect(() => { onSelectSegmentRef.current = onSelectSegment; }, [onSelectSegment]);
  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | undefined;
    const vehicleEntries = vehicles.current;
    const finishActivity = onActivity();
    (async () => {
      const L = (await import('leaflet')).default;
      (window as unknown as { L: typeof Leaflet }).L = L;
      await import('leaflet.markercluster');
      if (disposed || !element.current) return;
      library.current = L;
      const m = L.map(element.current, { zoomControl: false, minZoom: 10, maxZoom: 19, attributionControl: true }).setView([22.355, 114.13], 11);
      map.current = m;
      const locationPane = m.createPane('userLocation');
      locationPane.style.zIndex = '625';
      locationPane.style.pointerEvents = 'none';
      m.on('moveend', () => { const center = m.getCenter(); setMapZoom(m.getZoom()); viewportCallback.current?.({ lng: Number(center.lng.toFixed(5)), lat: Number(center.lat.toFixed(5)), zoom: m.getZoom() }); });
      L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(m);
      cluster.current = L.markerClusterGroup({ maxClusterRadius: 42, showCoverageOnHover: false, spiderfyOnMaxZoom: true, spiderfyDistanceMultiplier: 1.8, animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        iconCreateFunction(group) {
          const children = group.getAllChildMarkers();
          const types = new Set(children.map(c => (c.options as Leaflet.MarkerOptions & { cameraKind: string }).cameraKind));
          const kind = [...types][0] as keyof typeof layers;
          return L.divIcon({ className: 'camera-cluster', html: `<div class="cluster-inner ${types.size > 1 ? 'mixed' : ''}" style="--cluster-color:${layers[kind].color}" aria-label="${copyRef.current.clusterLabel(children.length)}">${children.length}</div>`, iconSize: [40, 40] });
        },
      }).addTo(m);
      segmentRenderer.current = L.canvas({ padding: 0.5 });
      segmentGroup.current = L.layerGroup().addTo(m);
      stationGroup.current = L.layerGroup().addTo(m);
      observer = new ResizeObserver(() => m.invalidateSize());
      observer.observe(element.current);
      setReady(true);
      locate();
    })().catch(() => { if (!disposed) setMapError(true); }).finally(finishActivity);
    return () => { disposed = true; finishActivity(); observer?.disconnect(); map.current?.remove(); map.current = null; basemapLayer.current = null; locationLayer.current = null; locationPending.current = false; vehicleGroup.current = null; vehicleEntries.clear(); };
  }, [onActivity, locate]);
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
    const L = library.current, m = map.current, group = cluster.current;
    if (!ready || !L || !m || !group) return;
    const visible = cameras.filter(camera => camera.kind !== 'toll' || (mapZoom >= 14 ? camera.badge !== 'overview' : camera.badge !== 'portal'));
    const ids = new Set(visible.map(camera => camera.id));
    markers.current.forEach((marker, id) => { if (!ids.has(id)) { group.removeLayer(marker); stationGroup.current?.removeLayer(marker); markers.current.delete(id); markerData.current.delete(id); } });
    const clustered: Leaflet.Marker[] = [];
    visible.forEach(camera => {
      const style = `${language}:${mapZoom >= 16.5}`;
      const previous = markerData.current.get(camera.id);
      if (previous?.camera === camera && previous.style === style) return;
      const oldMarker = markers.current.get(camera.id);
      if (oldMarker) { group.removeLayer(oldMarker); stationGroup.current?.removeLayer(oldMarker); }
      const name = language === 'en' ? camera.nameEn || camera.name : camera.name;
      const badge = camera.kind === 'crossing' ? camera.badge : mapZoom >= 16.5 && ['kmb', 'citybus', 'gmb', 'nlb'].includes(camera.kind) ? camera.badge : undefined;
      const plate = badge && camera.kind !== 'crossing' ? stopPlate(name, camera.routes ?? []) : null;
      const icon = L.divIcon({ className: `camera-marker ${camera.positionType === 'station' ? 'station-marker' : ''}`, html: `<div class="marker-inner" style="--marker-color:${camera.color ?? layers[camera.kind].color}">${camera.kind === 'crossing' ? `<b>${escapeHtml(badge || '—')}</b>` : `<svg viewBox="0 0 24 24"${camera.rotation ? ` style="transform:rotate(${camera.rotation}deg)"` : ''}>${symbols[camera.kind]}</svg>`}</div>${plate ? `<span class="stop-plate"><b>${escapeHtml(plate.title)}</b>${plate.lines.map(line => `<span>${escapeHtml(line)}</span>`).join('')}</span>` : ''}`, iconSize: [30, 30], iconAnchor: [15, 15] });
      const marker = L.marker([camera.lat, camera.lng], { icon, title: `${layerText(camera.kind, language).name}: ${name}`, alt: name, keyboard: true, cameraKind: camera.kind } as Leaflet.MarkerOptions);
      const label = document.createElement('span'); label.textContent = name;
      marker.bindTooltip(label, { direction: 'top', offset: [0, -12] });
      marker.on('click', () => selectRef.current(camera));
      markers.current.set(camera.id, marker);
      markerData.current.set(camera.id, { camera, style });
      if (camera.positionType === 'station' || camera.positionType === 'pier') stationGroup.current?.addLayer(marker);
      else clustered.push(marker);
    });
    group.addLayers(clustered);
  }, [cameras, ready, language, mapZoom]);
  useEffect(() => {
    const L = library.current, m = map.current;
    if (!ready || !L || !m) return;
    const group = L.layerGroup().addTo(m);
    paths?.forEach(path => L.polyline(path.points, { color: path.color, weight: 3, opacity: .65, interactive: false, renderer: segmentRenderer.current ?? undefined }).addTo(group));
    return () => { group.remove(); };
  }, [paths, ready]);
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
      entries.forEach((entry, id) => { if (!ids.has(id)) { group.removeLayer(entry.marker); entries.delete(id); } });
      next.forEach(camera => {
        const name = language === 'en' ? camera.nameEn || camera.name : camera.name;
        const feed = transitFeeds?.[camera.kind as 'mtr' | 'lrt' | 'ferry'];
        const existing = entries.get(camera.id);
        if (existing) {
          if (existing.feed !== feed && !reducedMotion.matches) {
            const position = existing.marker.getLatLng();
            existing.correction = { lat: position.lat - camera.lat, lng: position.lng - camera.lng, at: now };
          }
          if (existing.language !== language || existing.camera.name !== camera.name || existing.camera.nameEn !== camera.nameEn) {
            const label = document.createElement('span'); label.textContent = name;
            existing.marker.setTooltipContent(label);
            const icon = existing.marker.getElement(); if (icon) { icon.title = name; icon.setAttribute('aria-label', name); }
          }
          if (existing.camera.color !== camera.color) existing.marker.getElement()?.querySelector<HTMLElement>('.marker-inner')?.style.setProperty('--marker-color', camera.color ?? layers[camera.kind].color);
          existing.camera = camera; existing.feed = feed; existing.language = language;
          if (move) {
            const remaining = !reducedMotion.matches && existing.correction ? Math.max(0, 1 - (now - existing.correction.at) / 1000) ** 3 : 0;
            const point = L.latLng(camera.lat + (existing.correction?.lat ?? 0) * remaining, camera.lng + (existing.correction?.lng ?? 0) * remaining);
            if (!remaining) existing.correction = undefined;
            existing.marker.setLatLng(point);
            // Leaflet rounds marker pixels; retain its geographic state with subpixel display motion.
            const icon = existing.marker.getElement(); if (icon) L.DomUtil.setPosition(icon, m.project(point).subtract(m.getPixelOrigin()));
          }
          return;
        }
        const icon = L.divIcon({ className: 'camera-marker vehicle-marker', html: `<div class="marker-inner" style="--marker-color:${camera.color ?? layers[camera.kind].color}"><svg viewBox="0 0 24 24">${symbols[camera.kind]}</svg></div>`, iconSize: [26, 26], iconAnchor: [13, 13] });
        const marker = L.marker([camera.lat, camera.lng], { icon, title: name, alt: name, keyboard: true }).addTo(group);
        const label = document.createElement('span'); label.textContent = name; marker.bindTooltip(label);
        marker.getElement()?.setAttribute('aria-label', name);
        marker.on('click', () => { const latest = entries.get(camera.id); if (latest) selectRef.current(latest.camera); });
        entries.set(camera.id, { marker, camera, feed, language });
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
      polyline.on('click', () => onSelectSegmentRef.current?.(segment));
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
  useEffect(() => {
    const m = map.current;
    if (!ready || !m || !focusTarget) return;
    const animate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (focusTarget.segment) m.fitBounds(focusTarget.segment.path, { padding: [60, 90], maxZoom: 16, animate });
    else m.setView([focusTarget.camera.lat, focusTarget.camera.lng], Math.max(m.getZoom(), 16), { animate });
  }, [focusTarget, ready]);
  function fit() {
    map.current?.setView([22.355, 114.13], 11, { animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches });
  }
  const locationErrorMessage = locationError === 'denied' ? copy.locationDenied : locationError === 'timeout' ? copy.locationTimeout : locationError === 'unsupported' ? copy.locationUnsupported : copy.locationUnavailable;
  return <section className="map-area" aria-label={copy.mapLabel} aria-hidden={inactive || undefined} inert={inactive || undefined}>
    <div ref={element} className="map-canvas" data-basemap={basemap} role="group" aria-label={copy.mapKeyboardHelp} />
    <div className="map-tools"><div className="zoom-buttons"><button aria-label={copy.zoomIn} title={copy.zoomIn} onClick={() => map.current?.zoomIn()}><Plus size={19}/></button><button aria-label={copy.zoomOut} title={copy.zoomOut} onClick={() => map.current?.zoomOut()}><Minus size={19}/></button></div><button aria-label={copy.showAll} title={copy.returnToHongKong} onClick={fit}><Maximize size={20}/></button><button type="button" className="gps-button" aria-label={locating ? copy.locating : copy.locateMe} title={locating ? copy.locating : copy.locateMe} aria-busy={locating} disabled={!ready || locating} onClick={locate}>{locating ? <LoaderCircle className="spin" size={20}/> : <LocateFixed size={20}/>}</button></div>
    <span className="sr-only" role="status">{locating ? copy.locating : locationFound ? copy.locationFound : ''}</span>
    {locationError && <div className={`map-error location-error${mapError ? ' with-map-error' : ''}`} role="alert">{locationErrorMessage}<button type="button" className="map-retry" onClick={() => setLocationError(null)}>{copy.dismissLocationError}</button></div>}
    {mapError && <div className="map-error" role="alert">{copy.mapLoadFailed}<button type="button" className="map-retry" onClick={() => ready ? setBasemapRetry(value => value + 1) : window.location.reload()}><RefreshCw size={14}/>{copy.retry}</button></div>}
    {!ready && !mapError && <div className="map-loading"><LoaderCircle className="spin" size={20}/> {copy.mapLoading}</div>}
    {ready && !loading && cameras.length === 0 && !segments?.length && <div className="map-empty"><strong>{allDisabled ? copy.allLayersOff : hasErrors ? copy.cameraLoadFailed : copy.noCameraLocations}</strong>{allDisabled ? copy.turnOnLayer : copy.checkLayers}</div>}
  </section>;
}
