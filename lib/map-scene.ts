import type { FeatureCollection, LineString } from 'geojson';
import type { FillExtrusionLayerSpecification } from 'maplibre-gl';
import { speedLevelColors, layers, type FlowSegment, type MapPath } from './traffic.ts';
import type { BusRouteResponse } from './bus-route.ts';

// Leaflet's 256px world and MapLibre's 512px world differ by one zoom level.
// Keep the shared feed viewport in Leaflet units, including bus-feed zoom gates.
export const nativeZoom = (zoom: number) => zoom - 1;
export const sharedZoom = (zoom: number) => zoom + 1;

export const buildings3D = (source: string): FillExtrusionLayerSpecification => ({
  id: 'hk-3d-buildings', type: 'fill-extrusion', source, 'source-layer': 'building',
  minzoom: 14, filter: ['!=', ['get', 'hide_3d'], true],
  paint: {
    'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 0], 0, '#d5dedb', 120, '#a1b6b0', 300, '#75978e'],
    'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14, 0, 15, ['coalesce', ['get', 'render_height'], 0]],
    'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
    'fill-extrusion-opacity': 0.82,
  },
});

type Lines = FeatureCollection<LineString>;
const validLine = (points: number[][]) => points.length > 1 && points.every(point => point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]));
// Leaflet traffic/rail paths use [lat, lng]; GeoJSON and bus geometry use [lng, lat].
export function trafficLines(segments: FlowSegment[] = [], selectedId?: string | null): Lines {
  return { type: 'FeatureCollection', features: segments.filter(segment => validLine(segment.path)).map(segment => ({
    type: 'Feature', id: segment.id, properties: { id: segment.id, color: speedLevelColors[segment.level], width: segment.id === selectedId ? 7.2 : 4.8 },
    geometry: { type: 'LineString', coordinates: segment.path.map(([lat, lng]) => [lng, lat]) },
  })) };
}
export function transportLines(paths: MapPath[] = [], busRoute?: BusRouteResponse): Lines {
  const features: Lines['features'] = paths.filter(path => validLine(path.points)).map(path => ({
    type: 'Feature', properties: { color: path.color, width: 3 },
    geometry: { type: 'LineString', coordinates: path.points.map(([lat, lng]) => [lng, lat]) },
  }));
  const directions = busRoute?.route ? [busRoute.route, ...(busRoute.reverse ?? []).map(direction => direction.route)] : [];
  for (const route of directions) if (validLine(route.coordinates)) features.push({
    type: 'Feature', properties: { color: layers[route.operator].color, width: 5 },
    geometry: { type: 'LineString', coordinates: route.coordinates },
  });
  return { type: 'FeatureCollection', features };
}
