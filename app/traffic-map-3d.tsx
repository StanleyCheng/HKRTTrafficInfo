'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BusFront, Compass, Layers3, LoaderCircle, LocateFixed, Maximize, Minus, Plus, RefreshCw, Tags } from 'lucide-react';
import type * as MapLibre from 'maplibre-gl';
import { messages } from '@/lib/i18n';
import { layers, layerText, readableInk, type Camera } from '@/lib/traffic';
import { busKinds, movingCameras } from '@/lib/integration-client';
import { buildings3D, nativeZoom, sharedZoom, trafficLines, transportLines } from '@/lib/map-scene';
import { escapeHtml, symbols, vehicleDestination, vehicleHtml } from '@/lib/map-markers';
import { stopPlate } from '@/lib/stop-plate';
import { STOP_LABEL_WIDTH, declutterLabels, stopLabelHeight, type StopLabelItem } from '@/lib/stop-labels';
import { markerOffsets } from '@/lib/marker-layout';
import { vehicleIcon, vehicleIconHeadingOffset } from '@/lib/vehicle-icons';
import { busVehicleDistanceAtTime, routeDistances, routeHeadingAtDistance, routePointAtDistance } from '@/lib/bus-route-motion';
import { getBusStopArrivals } from '@/lib/bus-route-client';
import { createLocationMotion, locationTransitionDuration, validLocationFix, type LocationPoint } from '@/lib/location-motion';
import { vehicleCorrection, vehicleFrame, type VehicleCorrection } from '@/lib/vehicle-motion';
import type { BusRouteStop } from '@/lib/bus-route';
import type { TrafficMapProps } from './traffic-map';

type Camera3D = { pitch: number; bearing: number };
type Props = TrafficMapProps & { camera3D: Camera3D; onCamera3D: (camera: Camera3D) => void; onExit3D: () => void };
type Entry = { marker: MapLibre.Marker; node: HTMLButtonElement; camera: Camera; html: string; distance?: number; drawnAt?: number; heading?: number; feed?: unknown; correction?: VehicleCorrection };
const isBusStop = (camera: Camera) => (busKinds as readonly string[]).includes(camera.kind) && camera.positionType !== 'vehicle';
const motionDuration = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 250;

// Both renderers consume the same monitor data and renderItemDetails. MapLibre owns
// this camera, WebGL canvas and GeoJSON geometry; there is no Leaflet bridge here.
export default function TrafficMap3D(props: Props) {
  const { language, onActivity, selected, focusTarget, cameras, segments, paths, busRoute, busSelection, transitFeeds, inactive, loading, allDisabled, hasErrors, hasDrawableLayers, hasBusStopLayers, renderItemDetails, onExit3D } = props;
  const copy = messages[language];
  const callbacks = useRef(props);
  useEffect(() => { callbacks.current = props; });
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibre.Map | null>(null);
  const library = useRef<typeof MapLibre | null>(null);
  const markers = useRef(new Map<string, Entry>());
  const vehicles = useRef(new Map<string, Entry>());
  const popup = useRef<MapLibre.Popup | null>(null);
  const popupOrigin = useRef<HTMLElement | null>(null);
  const layout = useRef(() => {});
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<'load' | 'unsupported' | null>(null);
  const [retry, setRetry] = useState(0);
  const [pitch, setPitch] = useState(props.camera3D.pitch);
  const [zoom, setZoom] = useState(nativeZoom(props.initialView?.zoom ?? 11));
  const popupContent = useRef<HTMLDivElement | null>(null);
  const [popupElement, setPopupElement] = useState<HTMLDivElement | null>(null);
  const [showBusStops, setShowBusStops] = useState(true);
  const [routeLabels, setRouteLabels] = useState(true);
  const [revealedRoute, setRevealedRoute] = useState<string | null>(null);
  const [routeStop, setRouteStop] = useState<{ key: string; stop: BusRouteStop } | null>(null);
  const [routeDetails, setRouteDetails] = useState<{ camera: Camera; language: string; status: 'loading' | 'error' | 'ready' } | null>(null);
  const [locating, setLocating] = useState(false);
  const [following, setFollowing] = useState(false);
  const [locationError, setLocationError] = useState<'denied' | 'timeout' | 'unsupported' | 'unavailable' | null>(null);
  const locationWatch = useRef<{ id?: number; dispose: () => void } | null>(null);
  const locationMarker = useRef<MapLibre.Marker | null>(null);
  const fittedRoute = useRef<string | null>(props.busRoute?.route?.key ?? null);
  const routeKey = busRoute?.route?.key ?? null;
  const routeFocus = Boolean(routeKey && revealedRoute !== routeKey);
  const stopCamera: Camera | null = routeStop?.key === routeKey && busRoute?.route ? {
    id: `${busRoute.route.operator}-${routeStop.stop.id}`, sourceId: routeStop.stop.id, kind: busRoute.route.operator,
    name: routeStop.stop.nameTc, nameEn: routeStop.stop.nameEn, lat: routeStop.stop.lat, lng: routeStop.stop.lng,
  } : null;
  const popupCamera = selected ?? (stopCamera && routeDetails?.camera.id === stopCamera.id && routeDetails.language === language ? routeDetails.camera : stopCamera);
  const popupId = selected?.id ?? (stopCamera ? `route:${routeKey}:${routeStop?.stop.seq}` : null);

  const stopLocating = useCallback(() => {
    const watch = locationWatch.current;
    locationWatch.current = null;
    if (watch?.id !== undefined) navigator.geolocation.clearWatch(watch.id);
    watch?.dispose();
    locationMarker.current?.remove(); locationMarker.current = null;
    setLocating(false); setFollowing(false);
  }, []);
  const locate = useCallback(() => {
    const m = map.current, gl = library.current;
    if (!m || !gl || locationWatch.current) return;
    setLocationError(null);
    if (!navigator.geolocation) { setLocationError('unsupported'); return; }
    const watch = { id: undefined as number | undefined, dispose: () => {} };
    locationWatch.current = watch;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let latest: LocationPoint | undefined, lastAt: number | undefined, lastTimestamp: number | undefined;
    const motion = createLocationMotion(point => locationMarker.current?.setLngLat([point[1], point[0]]));
    const settle = () => { if (latest && (document.hidden || reduced.matches)) { motion.finish(); m.stop().jumpTo({ center: [latest[1], latest[0]] }); } };
    document.addEventListener('visibilitychange', settle); reduced.addEventListener('change', settle);
    watch.dispose = () => { motion.dispose(); document.removeEventListener('visibilitychange', settle); reduced.removeEventListener('change', settle); };
    setFollowing(true); setLocating(true);
    const fail = (code: number) => {
      if (locationWatch.current !== watch) return;
      stopLocating(); setLocationError(code === 1 ? 'denied' : code === 3 ? 'timeout' : 'unavailable');
    };
    try {
      watch.id = navigator.geolocation.watchPosition(position => {
        if (locationWatch.current !== watch || map.current !== m) return;
        if (!validLocationFix(position, lastTimestamp)) return;
        lastTimestamp = position.timestamp;
        const point: LocationPoint = [position.coords.latitude, position.coords.longitude];
        const now = performance.now(), duration = lastAt === undefined || reduced.matches || document.hidden ? 0 : locationTransitionDuration(now - lastAt);
        lastAt = now; latest = point;
        if (!locationMarker.current) {
          const node = document.createElement('div'); node.className = 'native-location-dot'; node.setAttribute('aria-label', messages[callbacks.current.language].locationFound);
          locationMarker.current = new gl.Marker({ element: node, opacityWhenCovered: 1 }).setLngLat([point[1], point[0]]).addTo(m);
        }
        motion.moveTo(point, duration);
        m.easeTo({ center: [point[1], point[0]], zoom: Math.max(m.getZoom(), nativeZoom(16)), duration, easing: t => t });
        setLocating(false);
      }, failure => fail(failure.code), { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
      if (locationWatch.current !== watch) navigator.geolocation.clearWatch(watch.id);
    } catch { fail(2); }
  }, [stopLocating]);

  useEffect(() => {
    let disposed = false, m: MapLibre.Map | undefined;
    let loadTimeout: ReturnType<typeof setTimeout> | undefined;
    const finish = onActivity();
    const staticEntries = markers.current, movingEntries = vehicles.current;
    (async () => {
      const gl = await import('maplibre-gl');
      if (disposed || !element.current) return;
      library.current = gl;
      gl.setWorkerUrl(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/vendor/maplibre-gl/maplibre-gl-worker.mjs`);
      const { initialView: view, camera3D } = callbacks.current;
      try {
        m = new gl.Map({
          container: element.current, style: 'https://tiles.openfreemap.org/styles/positron',
          center: [view?.lng ?? 114.13, view?.lat ?? 22.355], zoom: nativeZoom(view?.zoom ?? 11),
          pitch: camera3D.pitch, bearing: camera3D.bearing, maxPitch: 75, minZoom: nativeZoom(10), maxZoom: nativeZoom(19),
          canvasContextAttributes: { antialias: true }, attributionControl: { compact: true },
          locale: { 'AttributionControl.ToggleAttribution': messages[callbacks.current.language].sources },
        });
      } catch { if (!disposed) setError('unsupported'); return; }
      map.current = m;
      m.addControl(new gl.ScaleControl({ unit: 'metric' }), 'bottom-left');
      const report = () => {
        if (!m || disposed) return;
        const center = m.getCenter();
        setZoom(m.getZoom()); setPitch(m.getPitch());
        callbacks.current.onViewport?.({ lng: Number(center.lng.toFixed(5)), lat: Number(center.lat.toFixed(5)), zoom: sharedZoom(m.getZoom()) });
        callbacks.current.onCamera3D({ pitch: m.getPitch(), bearing: m.getBearing() });
        layout.current();
      };
      m.on('moveend', report);
      m.on('error', () => { if (!disposed) { setError('load'); clearTimeout(loadTimeout); finish(); } });
      m.on('webglcontextlost', () => { if (!disposed) { setError('unsupported'); finish(); } });
      m.on('click', event => {
        if (!m || event.originalEvent.target instanceof Element && event.originalEvent.target.closest('.maplibregl-marker,.maplibregl-popup,.maplibregl-control-container')) return;
        const features = m.getLayer('hk-traffic-lines') ? m.queryRenderedFeatures(event.point, { layers: ['hk-traffic-lines'] }) : [];
        const segment = callbacks.current.segments?.find(candidate => candidate.id === features[0]?.properties.id);
        if (segment) { setRouteStop(null); popupOrigin.current = m.getCanvas(); callbacks.current.onSelectSegment?.(segment); }
        else { popup.current?.remove(); callbacks.current.onCloseDetails(); setRouteStop(null); setRevealedRoute(callbacks.current.busRoute?.route?.key ?? null); }
      });
      m.on('load', () => {
        if (!m || disposed) return;
        clearTimeout(loadTimeout);
        const style = m.getStyle();
        const buildingLayer = style.layers.find(layer => 'source-layer' in layer && layer['source-layer'] === 'building');
        const buildingSource = buildingLayer && 'source' in buildingLayer ? buildingLayer.source : undefined;
        const source = typeof buildingSource === 'string' ? buildingSource : 'hk-buildings';
        if (!m.getSource(source)) m.addSource(source, { type: 'vector', url: 'https://tiles.openfreemap.org/planet' });
        const firstLabel = style.layers.find(layer => layer.type === 'symbol')?.id;
        m.addLayer(buildings3D(source), firstLabel);
        m.setLight({ anchor: 'viewport', color: '#ffffff', intensity: 0.35, position: [1.5, 180, 35] });
        m.addSource('hk-traffic', { type: 'geojson', data: trafficLines() });
        m.addSource('hk-transport', { type: 'geojson', data: transportLines() });
        for (const [id, sourceId] of [['hk-traffic-lines', 'hk-traffic'], ['hk-transport-lines', 'hk-transport']]) {
          m.addLayer({ id, source: sourceId, type: 'line', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'], 'line-opacity': 0.9 } });
        }
        m.on('mouseenter', 'hk-traffic-lines', () => { if (m) m.getCanvas().style.cursor = 'pointer'; });
        m.on('mouseleave', 'hk-traffic-lines', () => { if (m) m.getCanvas().style.cursor = ''; });
        popupContent.current = document.createElement('div');
        setPopupElement(popupContent.current); setReady(true); finish(); report();
      });
      loadTimeout = setTimeout(() => { if (!disposed) { setError('load'); finish(); } }, 20000);
    })().catch(() => { if (!disposed) setError('load'); }).finally(() => { if (!m || disposed) finish(); });
    return () => {
      disposed = true; clearTimeout(loadTimeout); finish(); stopLocating();
      staticEntries.forEach(entry => entry.marker.remove()); staticEntries.clear();
      movingEntries.forEach(entry => entry.marker.remove()); movingEntries.clear();
      popup.current?.remove(); popup.current = null;
      m?.remove(); if (map.current === m) map.current = null;
    };
  }, [onActivity, retry, stopLocating]);

  useEffect(() => {
    if (!ready || !map.current) return;
    (map.current.getSource('hk-traffic') as MapLibre.GeoJSONSource).setData(trafficLines(segments, props.selectedSegmentId));
    (map.current.getSource('hk-transport') as MapLibre.GeoJSONSource).setData(transportLines(paths, busRoute));
  }, [ready, segments, paths, busRoute, props.selectedSegmentId]);

  useEffect(() => {
    const m = map.current, gl = library.current;
    if (!ready || !m || !gl) return;
    const route = busRoute?.route;
    const routeStops = route && routeLabels ? route.stops.map(stop => ({
      id: `route-stop:${route.key}:${stop.seq}`, sourceId: stop.id, kind: route.operator, lat: stop.lat, lng: stop.lng,
      name: stop.nameTc, nameEn: stop.nameEn, routes: [route.route],
    } as Camera)) : [];
    const visible = [...cameras.filter(camera => !isBusStop(camera) || showBusStops && !routeFocus), ...routeStops];
    const ids = new Set(visible.map(camera => camera.id));
    markers.current.forEach((entry, id) => { if (!ids.has(id)) { entry.marker.remove(); markers.current.delete(id); } });
    for (const camera of visible) {
      if (!Number.isFinite(camera.lat) || !Number.isFinite(camera.lng)) continue;
      const name = language === 'en' ? camera.nameEn || camera.name : camera.name;
      const color = camera.color ?? layers[camera.kind].color;
      const station = camera.positionType === 'station';
      const plate = isBusStop(camera) ? stopPlate(name, camera.routes ?? []) : null;
      const attachment = station ? `<span class="station-label" style="background:${escapeHtml(color)};color:${escapeHtml(readableInk(color))}">${escapeHtml(name)}${(camera.lineColors?.length ?? 0) > 1 ? `<span class="station-lines">${camera.lineColors!.slice(1).map(line => `<i style="background:${escapeHtml(line)}"></i>`).join('')}</span>` : ''}</span>`
        : plate ? `<span class="stop-plate live"><b>${escapeHtml(plate.title)}</b>${plate.lines.map(line => `<span>${escapeHtml(line)}</span>`).join('')}</span>` : '';
      const inner = station ? '' : camera.kind === 'crossing' ? `<b>${escapeHtml(camera.badge || '—')}</b>` : `<svg viewBox="0 0 24 24">${symbols[camera.kind]}</svg>`;
      const html = `<span class="marker-leader" aria-hidden="true" hidden></span><div class="marker-displacement"><div class="marker-inner" style="--marker-color:${escapeHtml(color)}">${inner}</div>${attachment}</div>`;
      let entry = markers.current.get(camera.id);
      if (!entry) {
        const node = document.createElement('button'); node.type = 'button'; node.dataset.markerId = camera.id;
        const marker = new gl.Marker({ element: node, anchor: 'center', pitchAlignment: 'viewport', rotationAlignment: 'viewport', opacityWhenCovered: 1 }).setLngLat([camera.lng, camera.lat]).addTo(m);
        entry = { marker, node, camera, html: '' }; markers.current.set(camera.id, entry);
        node.addEventListener('click', event => {
          event.stopPropagation();
          const current = markers.current.get(camera.id)?.camera;
          if (!current) return;
          popupOrigin.current = node;
          if (current.id.startsWith('route-stop:')) {
            const currentRoute = callbacks.current.busRoute?.route;
            const stop = currentRoute?.stops.find(stop => `route-stop:${currentRoute.key}:${stop.seq}` === current.id);
            if (stop && currentRoute) { callbacks.current.onCloseDetails(); setRouteStop({ key: currentRoute.key, stop }); }
          } else { setRouteStop(null); callbacks.current.onSelect(current); }
        });
      }
      entry.camera = camera;
      entry.node.className = `maplibregl-marker native-marker camera-marker${station ? ' station-marker' : ''}${isBusStop(camera) ? ' bus-stop-marker' : ''}`;
      if (entry.html !== html) { entry.node.innerHTML = html; entry.html = html; }
      entry.node.setAttribute('aria-label', `${layerText(camera.kind, language).name}: ${name}`);
      entry.node.setAttribute('aria-haspopup', 'dialog');
      entry.node.querySelector('.marker-inner')?.classList.toggle('selected', camera.id === selected?.id);
      entry.marker.setLngLat([camera.lng, camera.lat]);
    }
    const runLayout = () => {
      const width = m.getContainer().clientWidth, height = m.getContainer().clientHeight;
      const points = [...markers.current.values()].map(entry => ({ id: entry.camera.id, ...m.project([entry.camera.lng, entry.camera.lat]), size: 30 }));
      const offsets = markerOffsets(points);
      const labels: StopLabelItem[] = [];
      markers.current.forEach(entry => {
        const point = m.project([entry.camera.lng, entry.camera.lat]);
        const onScreen = point.x > -100 && point.y > -100 && point.x < width + 100 && point.y < height + 100;
        entry.node.hidden = !onScreen;
        const offset = offsets.get(entry.camera.id) ?? { x: 0, y: 0 };
        const inner = entry.node.querySelector<HTMLElement>('.marker-displacement');
        if (inner) inner.style.transform = `translate(${offset.x}px,${offset.y}px)`;
        const leader = entry.node.querySelector<HTMLElement>('.marker-leader');
        if (leader) { leader.hidden = Math.hypot(offset.x, offset.y) < 1; leader.style.width = `${Math.hypot(offset.x, offset.y)}px`; leader.style.transform = `rotate(${Math.atan2(offset.y, offset.x)}rad)`; }
        const label = entry.node.querySelector<HTMLElement>('.stop-plate,.station-label');
        if (!label || !onScreen) return;
        const name = language === 'en' ? entry.camera.nameEn || entry.camera.name : entry.camera.name;
        const plate = isBusStop(entry.camera) ? stopPlate(name, entry.camera.routes ?? []) : null;
        const w = plate ? STOP_LABEL_WIDTH : Math.min(230, [...name].length * 11 + 24), h = plate ? stopLabelHeight(plate.lines.length) : 21;
        const x = point.x + offset.x, y = point.y + offset.y;
        labels.push({ id: entry.camera.id, priority: plate ? entry.camera.routes?.length ?? 0 : 100, placements: [
          { key: 'right', x: x + 13, y: y - 11, w, h }, { key: 'left', x: x - 13 - w, y: y - 11, w, h },
          { key: 'above', x: x - w / 2, y: y - 13 - h, w, h }, { key: 'below', x: x - w / 2, y: y + 13, w, h },
        ] });
      });
      const shown = declutterLabels(labels, { x: 0, y: 0, w: width, h: height });
      markers.current.forEach(entry => {
        const label = entry.node.querySelector<HTMLElement>('.stop-plate,.station-label');
        if (!label) return;
        const placement = shown.get(entry.camera.id);
        label.classList.toggle('label-hidden', !placement);
        for (const side of ['left', 'above', 'below']) label.classList.toggle(`pos-${side}`, placement === side);
      });
    };
    layout.current = runLayout; runLayout();
    m.on('moveend', runLayout); m.on('resize', runLayout);
    return () => { layout.current = () => {}; m.off('moveend', runLayout); m.off('resize', runLayout); };
  }, [ready, cameras, language, selected?.id, showBusStops, routeFocus, busRoute, routeLabels]);

  useEffect(() => {
    const m = map.current, gl = library.current;
    if (!ready || !m || !gl) return;
    const directions = busRoute?.route ? [{ route: busRoute.route, vehicles: busRoute.vehicles }, ...(busRoute.reverse ?? [])] : [];
    const geometry = new Map(directions.map(direction => [direction.route.key, routeDistances(direction.route.coordinates)]));
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame: number | undefined, timer: ReturnType<typeof setInterval> | undefined, last = 0;
    const tick = () => {
      const now = Date.now();
      const moving = (['mtr', 'lrt', 'ferry'] as const).flatMap(kind => transitFeeds?.[kind] ? movingCameras(kind, transitFeeds[kind]!, now) : []);
      for (const direction of directions) for (const bus of direction.vehicles) {
        const distance = busVehicleDistanceAtTime(bus, now);
        if (distance === null) continue;
        const distances = geometry.get(direction.route.key)!;
        const coordinate = routePointAtDistance(direction.route.coordinates, distances, distance);
        if (!coordinate) continue;
        const terminus = direction.route.stops.at(-1);
        moving.push({ id: `bus-vehicle:${bus.id}`, sourceId: bus.id, kind: direction.route.operator,
          name: `${direction.route.route} → ${terminus?.nameTc ?? ''}`, nameEn: `${direction.route.route} → ${terminus?.nameEn ?? ''}`,
          lng: coordinate[0], lat: coordinate[1], estimated: true, positionType: 'vehicle', dataUpdated: busRoute?.observedAt ?? undefined,
          vehicleIcon: vehicleIcon({ kind: direction.route.operator, route: direction.route.route, company: direction.route.company }) ?? undefined,
          routePosition: { key: direction.route.key, distance, coordinates: direction.route.coordinates, distances },
        });
      }
      const ids = new Set(moving.map(camera => camera.id));
      vehicles.current.forEach((entry, id) => { if (!ids.has(id)) { entry.marker.remove(); vehicles.current.delete(id); } });
      for (const camera of moving) {
        if (!Number.isFinite(camera.lat) || !Number.isFinite(camera.lng)) continue;
        const name = language === 'en' ? camera.nameEn || camera.name : camera.name;
        const destination = vehicleDestination(camera, language, name), color = camera.color ?? layers[camera.kind].color;
        const html = vehicleHtml(camera.vehicleIcon ?? vehicleIcon({ kind: camera.kind, route: camera.arrivals?.[0]?.route }), color, destination);
        let entry = vehicles.current.get(camera.id);
        if (!entry) {
          const node = document.createElement('button'); node.type = 'button'; node.dataset.markerId = camera.id;
          node.className = `maplibregl-marker native-marker camera-marker vehicle-marker${camera.kind === 'mtr' || camera.kind === 'lrt' ? ' rail-marker' : ''}`;
          entry = { node, camera, html: '', marker: new gl.Marker({ element: node, opacityWhenCovered: 1, pitchAlignment: 'viewport', rotationAlignment: 'viewport' }).setLngLat([camera.lng, camera.lat]).addTo(m) };
          vehicles.current.set(camera.id, entry);
          node.addEventListener('click', event => { event.stopPropagation(); const current = vehicles.current.get(camera.id); if (current) { popupOrigin.current = node; setRouteStop(null); callbacks.current.onSelect(current.camera); } });
        }
        const feed = camera.id.startsWith('bus-vehicle:') ? busRoute : transitFeeds?.[camera.kind as 'mtr' | 'lrt' | 'ferry'];
        const position = camera.routePosition;
        const target = { point: [camera.lng, camera.lat] as [number, number], route: position };
        if (entry.feed !== feed) {
          const previous = entry.marker.getLngLat(), route = entry.camera.routePosition;
          entry.correction = reduced.matches || entry.drawnAt === undefined ? undefined : vehicleCorrection({ point: [previous.lng, previous.lat], route: route && entry.distance !== undefined ? { key: route.key, distance: entry.distance } : undefined, at: entry.drawnAt }, target, now, camera.positionSource === 'gps', camera.id.startsWith('bus-vehicle:') ? 2000 : 1000);
        }
        entry.feed = feed; entry.camera = camera;
        const displayed = vehicleFrame(target, reduced.matches ? undefined : entry.correction, now);
        if (!displayed.active) entry.correction = undefined;
        if (entry.html !== html) { entry.node.innerHTML = html; entry.html = html; }
        entry.node.setAttribute('aria-label', `${name} · ${camera.estimated ? messages[language].estimatedPosition : layerText(camera.kind, language).name}`);
        entry.node.setAttribute('aria-haspopup', 'dialog');
        const previous = entry.marker.getLngLat();
        const dx = (displayed.point[0] - previous.lng) * Math.cos(displayed.point[1] * Math.PI / 180), dy = displayed.point[1] - previous.lat;
        const heading = position && displayed.distance !== undefined ? routeHeadingAtDistance(position.coordinates, position.distances, displayed.distance) : Math.abs(dx) + Math.abs(dy) > 1e-10 ? Math.atan2(dx, dy) * 180 / Math.PI : camera.rotation;
        if (heading != null) entry.heading = heading;
        const headingElement = entry.node.querySelector<HTMLElement>('.vehicle-heading');
        if (headingElement) headingElement.style.transform = `rotate(${(entry.heading ?? 0) + vehicleIconHeadingOffset - m.getBearing()}deg)`;
        entry.marker.setLngLat(displayed.point); entry.distance = displayed.distance; entry.drawnAt = now;
        if (popup.current && callbacks.current.selected?.id === camera.id) popup.current.setLngLat(entry.marker.getLngLat());
      }
    };
    const animate = (time: number) => { if (time - last >= 32) { tick(); last = time; } frame = requestAnimationFrame(animate); };
    const resume = () => {
      if (frame !== undefined) cancelAnimationFrame(frame); clearInterval(timer);
      if (inactive || document.hidden) return;
      tick();
      if (reduced.matches) timer = setInterval(tick, 1000); else frame = requestAnimationFrame(animate);
    };
    resume(); document.addEventListener('visibilitychange', resume); reduced.addEventListener('change', resume);
    return () => { if (frame !== undefined) cancelAnimationFrame(frame); clearInterval(timer); document.removeEventListener('visibilitychange', resume); reduced.removeEventListener('change', resume); };
  }, [ready, busRoute, transitFeeds, language, inactive]);

  useEffect(() => {
    const m = map.current, gl = library.current, route = busRoute?.route;
    if (!ready || !m || !gl || !route || fittedRoute.current === route.key) return;
    fittedRoute.current = route.key;
    const bounds = new gl.LngLatBounds(); route.coordinates.forEach(point => bounds.extend(point));
    if (!bounds.isEmpty()) m.fitBounds(bounds, { padding: { top: 100, bottom: 170, left: 60, right: 80 }, maxZoom: nativeZoom(16), duration: motionDuration() });
  }, [ready, busRoute]);

  useEffect(() => {
    if (!routeStop || !busSelection || routeStop.key !== routeKey || !stopCamera) return;
    const controller = new AbortController(), camera = stopCamera;
    let pending = false;
    const refresh = async () => {
      if (pending || controller.signal.aborted || document.visibilityState !== 'visible') return;
      pending = true;
      try {
        const data = await getBusStopArrivals({ ...busSelection, stopId: routeStop.stop.id, stopSeq: routeStop.stop.seq }, controller.signal);
        if (controller.signal.aborted) return;
        if (!data.ok || data.stale || data.error || !data.observedAt) throw new Error('Stop arrivals unavailable');
        setRouteDetails({ camera: { ...camera, arrivals: data.arrivals, dataUpdated: data.observedAt }, language, status: 'ready' });
      } catch {
        if (!controller.signal.aborted) setRouteDetails(previous => previous?.camera.id === camera.id && previous.language === language
          ? { ...previous, status: 'error' } : { camera, language, status: 'error' });
      } finally { pending = false; }
    };
    queueMicrotask(() => { if (!controller.signal.aborted) { setRouteDetails({ camera, language, status: 'loading' }); void refresh(); } });
    const timer = setInterval(() => void refresh(), 30_000);
    const resume = () => void refresh();
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', resume); window.removeEventListener('online', resume); };
    // camera is derived from this stop and route; feed refreshes should not reset its popup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeStop, routeKey, busSelection, language]);

  useEffect(() => {
    const m = map.current, gl = library.current;
    if (!ready || !m || !gl || !focusTarget) return;
    if (focusTarget.segment) {
      const bounds = new gl.LngLatBounds(); focusTarget.segment.path.forEach(([lat, lng]) => bounds.extend([lng, lat]));
      if (!bounds.isEmpty()) m.fitBounds(bounds, { padding: { top: 110, bottom: 180, left: 50, right: 80 }, maxZoom: nativeZoom(16), duration: motionDuration() });
    } else m.easeTo({ center: [focusTarget.camera.lng, focusTarget.camera.lat], zoom: Math.max(m.getZoom(), nativeZoom(16)), duration: motionDuration() });
  }, [ready, focusTarget]);

  useEffect(() => {
    const m = map.current, gl = library.current, camera = popupCamera, content = popupContent.current;
    if (!ready || !m || !gl || !content || !popupId || !camera) return;
    const source = popupOrigin.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const keyboardOpened = Boolean(source?.matches(':focus-visible'));
    const card = new gl.Popup({ className: 'item-popup native-item-popup', anchor: 'bottom', closeOnClick: false, closeOnMove: false, maxWidth: '320px', offset: 20, focusAfterOpen: false })
      .setLngLat(vehicles.current.get(camera.id)?.marker.getLngLat() ?? [camera.lng, camera.lat]).setDOMContent(content).addTo(m);
    popup.current = card;
    content.className = 'item-popup-content'; content.id = 'item-popup-details'; content.dataset.itemId = camera.id;
    content.setAttribute('role', 'dialog'); content.setAttribute('aria-labelledby', 'item-detail-title'); content.tabIndex = -1;
    source?.setAttribute('aria-controls', content.id); source?.setAttribute('aria-expanded', 'true');
    const popupNode = card.getElement();
    let focused = false;
    const focusIn = () => { focused = true; };
    const focusOut = (event: FocusEvent) => { if (event.relatedTarget instanceof Node && !popupNode?.contains(event.relatedTarget)) focused = false; };
    popupNode?.addEventListener('focusin', focusIn); popupNode?.addEventListener('focusout', focusOut);
    const shell = m.getContainer().closest('.app-shell');
    const overlaySelectors = '.topbar,.traffic-status,.intel-shell,.desktop-layer-dock,.mobile-dock,.layer-group-picker,.map-3d-camera,.map-tools';
    const size = () => {
      if (popup.current !== card) return;
      const area = m.getContainer().getBoundingClientRect();
      const visible = (selector: string) => [...(shell?.querySelectorAll<HTMLElement>(selector) ?? [])].map(node => node.getBoundingClientRect()).filter(rect => rect.height > 0 && rect.width > 0);
      const top = Math.max(area.top, ...visible('.topbar,.traffic-status').map(rect => rect.bottom)) + 12;
      const bottom = Math.min(area.bottom, ...visible('.intel-shell,.desktop-layer-dock,.mobile-dock,.layer-group-picker,.map-3d-camera').map(rect => rect.top)) - 12;
      const left = area.left + 12;
      const right = Math.min(area.right, ...visible('.map-tools').map(rect => rect.left)) - 12;
      content.style.setProperty('--item-popup-max-height', `${Math.max(44, Math.min(420, bottom - top - 28))}px`);
      card.setMaxWidth(`${Math.max(180, Math.min(320, right - left))}px`);
      // Recompute the anchor after React renders a taller card or an image loads.
      card.setLngLat(card.getLngLat());
      const node = card.getElement();
      node?.style.setProperty('--item-color', camera.color ?? layers[camera.kind].color);
      node?.querySelector('.maplibregl-popup-close-button')?.setAttribute('aria-label', messages[callbacks.current.language].closeCameraDetails);
      const rect = node?.querySelector('.maplibregl-popup-content')?.getBoundingClientRect();
      if (!rect) return;
      const dx = Math.max(0, rect.right - right) - Math.max(0, left - rect.left);
      const dy = Math.max(0, rect.bottom - bottom) - Math.max(0, top - rect.top);
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) m.panBy([dx, dy], { duration: 0 });
    };
    const close = () => {
      const restoreFocus = focused || Boolean(popupNode?.contains(document.activeElement));
      source?.removeAttribute('aria-controls'); source?.removeAttribute('aria-expanded'); popupOrigin.current = null;
      callbacks.current.onCloseDetails(); setRouteStop(null);
      if (restoreFocus) {
        const replacement = markers.current.get(camera.id)?.node ?? vehicles.current.get(camera.id)?.node;
        const target = source?.isConnected ? source : replacement ?? m.getCanvas();
        target.focus({ preventScroll: true });
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.target instanceof Element && event.target.closest('dialog[open],[data-slot="popover-content"]')) return;
      event.preventDefault(); card.remove();
    };
    const checkViewport = () => {
      const point = m.project(card.getLngLat());
      if (point.x < 0 || point.y < 0 || point.x > m.getContainer().clientWidth || point.y > m.getContainer().clientHeight) card.remove();
    };
    card.on('close', close); document.addEventListener('keydown', escape);
    const observer = new ResizeObserver(size);
    observer.observe(content); observer.observe(m.getContainer());
    shell?.querySelectorAll<HTMLElement>(overlaySelectors).forEach(node => observer.observe(node));
    m.on('moveend', checkViewport); m.on('resize', size);
    queueMicrotask(() => {
      if (popup.current !== card) return;
      size(); callbacks.current.onDetailsOpen?.(content);
      if (keyboardOpened) content.focus({ preventScroll: true });
    });
    return () => { observer.disconnect(); popupNode?.removeEventListener('focusin', focusIn); popupNode?.removeEventListener('focusout', focusOut); card.off('close', close); card.remove(); source?.removeAttribute('aria-controls'); source?.removeAttribute('aria-expanded'); document.removeEventListener('keydown', escape); m.off('resize', size); m.off('moveend', checkViewport); if (popup.current === card) popup.current = null; };
    // Camera feed updates replace portal content without recreating the popup or stealing focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, popupElement, popupId]);

  const viewAll = () => map.current?.easeTo({ center: [114.13, 22.355], zoom: nativeZoom(11), duration: motionDuration() });
  const resetCamera = () => map.current?.easeTo({ bearing: 0, pitch: 55, duration: motionDuration() });
  const locationErrorText = locationError === 'denied' ? copy.locationDenied : locationError === 'timeout' ? copy.locationTimeout : locationError === 'unsupported' ? copy.locationUnsupported : copy.locationUnavailable;
  return <section className="map-area native-map-area" aria-label={copy.map3DLabel} aria-hidden={inactive || undefined} inert={inactive || undefined}>
    <div ref={element} className="map-canvas native-map-canvas" data-map-mode="3d" data-basemap="positron" role="group" aria-label={copy.map3DKeyboardHelp}/>
    <div className="map-tools">
      <div className="zoom-buttons"><button type="button" aria-label={copy.zoomIn} title={copy.zoomIn} disabled={!ready} onClick={() => map.current?.zoomIn({ duration: motionDuration() })}><Plus size={19}/></button><button type="button" aria-label={copy.zoomOut} title={copy.zoomOut} disabled={!ready} onClick={() => map.current?.zoomOut({ duration: motionDuration() })}><Minus size={19}/></button></div>
      <button type="button" aria-label={copy.showAll} title={copy.returnToHongKong} disabled={!ready} onClick={viewAll}><Maximize size={20}/></button>
      <button type="button" className="gps-button" aria-label={following ? copy.stopFollowing : copy.locateMe} title={following ? copy.stopFollowing : copy.locateMe} aria-pressed={following} aria-busy={locating} disabled={!ready} onClick={following ? stopLocating : locate}>{locating ? <LoaderCircle size={20} className="spin"/> : <LocateFixed size={20}/>}</button>
      {hasBusStopLayers && <button type="button" className="bus-stops-button" aria-label={showBusStops ? copy.hideBusStops : copy.showBusStops} title={showBusStops ? copy.hideBusStops : copy.showBusStops} aria-pressed={showBusStops} onClick={() => setShowBusStops(value => !value)}><BusFront size={20}/></button>}
      {busRoute?.route && <button type="button" className="route-labels-button" aria-label={routeLabels ? copy.hideRouteStopLabels : copy.showRouteStopLabels} title={routeLabels ? copy.hideRouteStopLabels : copy.showRouteStopLabels} aria-pressed={routeLabels} onClick={() => setRouteLabels(value => !value)}><Tags size={20}/></button>}
    </div>
    <div className="map-3d-camera"><button type="button" title={copy.reset3DCamera} aria-label={copy.reset3DCamera} disabled={!ready} onClick={resetCamera}><Compass size={19}/></button><label><Layers3 size={16}/><span>{copy.mapTilt}</span><input type="range" min="0" max="75" step="1" value={pitch} aria-label={copy.mapTilt} disabled={!ready} onChange={event => { const value = Number(event.target.value); setPitch(value); map.current?.setPitch(value); }}/></label></div>
    {ready && zoom < 14.5 && !error && <div className="map-3d-hint" role="status">{copy.zoomForBuildings}</div>}
    <span className="sr-only" role="status">{locating ? copy.locating : following ? copy.locationFound : ''}</span>
    {locationError && <div className="map-error location-error" role="alert">{locationErrorText}<button type="button" className="map-retry" onClick={() => setLocationError(null)}>{copy.dismissLocationError}</button></div>}
    {error && <div className="map-error" role="alert">{error === 'unsupported' ? copy.map3DUnsupported : copy.map3DLoadFailed}<div className="map-error-actions"><button type="button" className="map-retry" onClick={onExit3D}>{copy.returnTo2D}</button>{error === 'load' && <button type="button" className="map-retry" onClick={() => { setReady(false); setError(null); setRetry(value => value + 1); }}><RefreshCw size={14}/>{copy.retry}</button>}</div></div>}
    {!ready && !error && <div className="map-loading"><LoaderCircle className="spin" size={20}/>{copy.map3DLoading}</div>}
    {ready && !loading && !busRoute?.route && cameras.length === 0 && !segments?.length && (allDisabled || hasDrawableLayers) && <div className="map-empty"><strong>{allDisabled ? copy.allLayersOff : hasErrors ? copy.cameraLoadFailed : copy.noCameraLocations}</strong>{allDisabled ? copy.turnOnLayer : copy.checkLayers}</div>}
    {popupElement && popupCamera && createPortal(renderItemDetails(popupCamera, selected ? undefined : {
      status: routeDetails?.camera.id === stopCamera?.id && routeDetails?.language === language ? routeDetails.status : 'loading',
      onRetry: () => setRouteStop(current => current ? { ...current } : null), onClose: () => setRouteStop(null),
    }), popupElement)}
  </section>;
}
