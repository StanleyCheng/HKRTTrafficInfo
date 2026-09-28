'use client';
import { useEffect, useRef, useState } from 'react';
import { Maximize, Plus, Minus, LoaderCircle, MousePointer2, RefreshCw } from 'lucide-react';
import type * as Leaflet from 'leaflet';
import { messages } from '@/lib/i18n';
import { Camera, FlowSegment, Language, layerText, layers, speedLevelColors } from '@/lib/traffic';
import type { TrafficSearchItem } from '@/lib/traffic-view';

const symbols = {
  redlight: '<rect x="8" y="2" width="8" height="20" rx="3"/><path d="M5 5h3m8 0h3M5 12h3m8 0h3M5 19h3m8 0h3"/><circle cx="12" cy="7" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="17" r="1"/>',
  speed: '<path d="M4 18a9 9 0 1 1 16 0M12 13l5-5M6 9l1 1M12 5v2M4 15h2m12 0h2"/><circle cx="12" cy="14" r="2"/>',
  snapshot: '<rect x="3" y="6" width="14" height="12" rx="2"/><path d="m17 10 4-3v10l-4-3"/>',
  flow: '<path d="M12 3l6 10h-3.5v8h-5v-8H6l6-10z"/>',
  incident: '<path d="M12 3.5 2.5 20h19L12 3.5z"/><path d="M12 10v4.5m0 2.5v.5"/>',
  parking: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M10 17V7.5h3.4a3.1 3.1 0 0 1 0 6.2H10"/>',
  rainfall: '<path d="M12 3.5s5.8 6.4 5.8 10.6a5.8 5.8 0 1 1-11.6 0C6.2 9.9 12 3.5 12 3.5z"/>',
};
const FLOW_SEGMENT_WEIGHT = 4.8;
const SELECTED_FLOW_SEGMENT_WEIGHT = 7.2;
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';
const OPENFREEMAP_ATTRIBUTION = '<a href="https://openfreemap.org/" target="_blank" rel="noreferrer">OpenFreeMap</a> &copy; <a href="https://openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';

export type Basemap = 'osm' | 'positron';
type Props = { cameras: Camera[]; segments?: FlowSegment[]; selected: Camera | null; selectedSegmentId?: string | null; onSelect: (camera: Camera) => void; onSelectSegment?: (segment: FlowSegment) => void; focusTarget?: TrafficSearchItem | null; loading: boolean; allDisabled: boolean; hasErrors: boolean; language: Language; basemap: Basemap; inactive?: boolean };
export default function TrafficMap({ cameras, segments, selected, selectedSegmentId, onSelect, onSelectSegment, focusTarget, loading, allDisabled, hasErrors, language, basemap, inactive = false }: Props) {
  const copy = messages[language];
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const library = useRef<typeof Leaflet | null>(null);
  const basemapLayer = useRef<Leaflet.Layer | null>(null);
  const cluster = useRef<Leaflet.MarkerClusterGroup | null>(null);
  const markers = useRef(new Map<string, Leaflet.Marker>());
  const previousSelection = useRef<string | null>(null);
  const selectRef = useRef(onSelect);
  const copyRef = useRef(copy);
  const segmentGroup = useRef<Leaflet.LayerGroup | null>(null);
  const segmentRenderer = useRef<Leaflet.Renderer | null>(null);
  const segmentPolylines = useRef(new Map<string, Leaflet.Polyline>());
  const previousSegmentSelection = useRef<string | null>(null);
  const onSelectSegmentRef = useRef(onSelectSegment);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [basemapRetry, setBasemapRetry] = useState(0);
  useEffect(() => { selectRef.current = onSelect; }, [onSelect]);
  useEffect(() => { copyRef.current = copy; }, [copy]);
  useEffect(() => { onSelectSegmentRef.current = onSelectSegment; }, [onSelectSegment]);
  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | undefined;
    (async () => {
      const L = (await import('leaflet')).default;
      (window as unknown as { L: typeof Leaflet }).L = L;
      await import('leaflet.markercluster');
      if (disposed || !element.current) return;
      library.current = L;
      const m = L.map(element.current, { zoomControl: false, minZoom: 10, maxZoom: 19, attributionControl: true }).setView([22.355, 114.13], 11);
      map.current = m;
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
      observer = new ResizeObserver(() => m.invalidateSize());
      observer.observe(element.current);
      setReady(true);
    })().catch(() => setMapError(true));
    return () => { disposed = true; observer?.disconnect(); map.current?.remove(); map.current = null; basemapLayer.current = null; };
  }, []);
  useEffect(() => {
    const L = library.current, m = map.current;
    if (!ready || !L || !m) return;
    let disposed = false;
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
          positronLayer.getMaplibreMap().on('error', () => { if (!disposed) setMapError(true); });
          nextLayer = positronLayer;
        } else {
          nextLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: OSM_ATTRIBUTION,
            maxZoom: 19,
          }).on('tileerror', () => { if (!disposed) setMapError(true); }).addTo(m);
        }
        if (disposed) {
          nextLayer.removeFrom(m);
          return;
        }
        basemapLayer.current = nextLayer;
      } catch {
        if (!disposed) setMapError(true);
      }
    })();
    return () => {
      disposed = true;
      basemapLayer.current?.removeFrom(m);
      basemapLayer.current = null;
    };
  }, [basemap, ready, basemapRetry]);
  useEffect(() => {
    const L = library.current, m = map.current, group = cluster.current;
    if (!ready || !L || !m || !group) return;
    group.clearLayers();
    markers.current.clear();
    group.addLayers(cameras.map(camera => {
      const name = language === 'en' ? camera.nameEn || camera.name : camera.name;
      const icon = L.divIcon({ className: 'camera-marker', html: `<div class="marker-inner" style="--marker-color:${camera.color ?? layers[camera.kind].color}"><svg viewBox="0 0 24 24"${camera.rotation ? ` style="transform:rotate(${camera.rotation}deg)"` : ''}>${symbols[camera.kind]}</svg></div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
      const marker = L.marker([camera.lat, camera.lng], { icon, title: `${layerText(camera.kind, language).name}: ${name}`, alt: name, keyboard: true, cameraKind: camera.kind } as Leaflet.MarkerOptions);
      const label = document.createElement('span'); label.textContent = name;
      marker.bindTooltip(label, { direction: 'top', offset: [0, -12] });
      marker.on('click', () => selectRef.current(camera));
      markers.current.set(camera.id, marker);
      return marker;
    }));
  }, [cameras, ready, language]);
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
  return <section className="map-area" aria-label={copy.mapLabel} aria-hidden={inactive || undefined} inert={inactive || undefined}>
    <div ref={element} className="map-canvas" data-basemap={basemap} role="group" aria-label={copy.mapKeyboardHelp} />
    <div className="map-tools"><div className="zoom-buttons"><button aria-label={copy.zoomIn} title={copy.zoomIn} onClick={() => map.current?.zoomIn()}><Plus size={19}/></button><button aria-label={copy.zoomOut} title={copy.zoomOut} onClick={() => map.current?.zoomOut()}><Minus size={19}/></button></div><button aria-label={copy.showAll} title={copy.returnToHongKong} onClick={fit}><Maximize size={20}/></button></div>
    {mapError && <div className="map-error" role="alert">{copy.mapLoadFailed}<button type="button" className="map-retry" onClick={() => ready ? setBasemapRetry(value => value + 1) : window.location.reload()}><RefreshCw size={14}/>{copy.retry}</button></div>}
    {!ready && !mapError && <div className="map-loading"><LoaderCircle className="spin" size={20}/> {copy.mapLoading}</div>}
    {ready && !loading && cameras.length === 0 && !segments?.length && <div className="map-empty"><strong>{allDisabled ? copy.allLayersOff : hasErrors ? copy.cameraLoadFailed : copy.noCameraLocations}</strong>{allDisabled ? copy.turnOnLayer : copy.checkLayers}</div>}
    <div className="map-hint"><MousePointer2 size={14}/><span>{copy.mapHint}</span></div>
  </section>;
}
