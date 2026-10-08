import { integrationMessages as labels, messages, boundaryNames, tollNames } from './i18n.ts';
import { hkTime, layers, staticExport, type Arrival, type Camera, type CameraData, type DetailRow, type FlowSegment, type IntegrationKind, type Language, type MapPath } from './traffic.ts';
import type { ApproachesResponse, ControlPointsResponse, FerryResponse, LrtResponse, MtrResponse, CitybusResponse, WarningsResponse } from './types.ts';
import { mtrStationCollection, mtrTrackCollection, stationRecord, lineRecord, projectNetworkTrain } from './mtr-network.ts';
import { lrtStationCollection, lrtTrackCollection, lrtPoint, lrtStation } from './lrt-network.ts';
import { projectTrain } from './mtr-estimate.ts';
import { placeOnPath } from './ferry-run.ts';
import { ferryVehicleIcon } from './vehicle-icons.ts';
import { decorateControlPoints } from './control-points.ts';

export type MapViewport = { lng: number; lat: number; zoom: number };
export const initialViewport: MapViewport = { lng: 114.13, lat: 22.355, zoom: 11 };
export const busKinds = ['kmb', 'citybus', 'gmb', 'nlb'] as const;
export function viewportNote(kind: string, view: MapViewport): 'viewportBus' | 'viewportGmb' | 'viewportNlb' | undefined {
  if ((kind === 'kmb' || kind === 'citybus') && view.zoom < 13) return 'viewportBus';
  if (kind === 'gmb' && view.zoom < 17) return 'viewportGmb';
  if (kind === 'nlb' && (view.lng < 113.8 || view.lng > 114.05 || view.lat < 22.18 || view.lat > 22.34)) return 'viewportNlb';
}
const endpoints: Record<IntegrationKind, string> = { crossing: 'approaches', works: 'works', toll: 'tolls', boundary: 'control-points', 'weather-warning': 'warnings', mtr: 'mtr', lrt: 'lrt', kmb: 'kmb', citybus: 'citybus', gmb: 'gmb', nlb: 'nlb', ferry: 'ferry' };
export const pollingMs: Record<IntegrationKind, number> = { crossing: 120000, works: 300000, toll: 21600000, boundary: 60000, 'weather-warning': 60000, mtr: 15000, lrt: 15000, kmb: 60000, citybus: 60000, gmb: 60000, nlb: 60000, ferry: 60000 };
type Envelope = { ok: boolean; complete?: boolean; error?: string; fetchedAt?: string; observedAt?: string | null; capturedAt?: string | null; stale?: boolean };
type FeaturesResponse = Envelope & { works?: GeoJSON.FeatureCollection; tolls?: GeoJSON.FeatureCollection };

async function json(url: string, signal?: AbortSignal): Promise<unknown> {
  const timeout = AbortSignal.timeout(55000);
  const response = await fetch(url, { cache: 'no-store', signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  if (!response.ok) throw new Error(`Feed HTTP ${response.status}`);
  return response.json();
}
export async function getIntegrationData(kind: IntegrationKind, view: MapViewport, language: Language, signal?: AbortSignal): Promise<CameraData> {
  const note = viewportNote(kind, view);
  if (note) return { ...base(kind, { ok: true }), feedNote: note };
  let payload: Envelope;
  if (staticExport) {
    if (kind === 'weather-warning') {
      const { parseWarnsum, EMPTY_CONDITIONS } = await import('./warnings.ts');
      const lang = language === 'en' ? 'en' : 'tc';
      const data = await json(`https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=warnsum&lang=${lang}`);
      payload = { ok: true, observedAt: new Date().toISOString(), warnings: parseWarnsum(data, lang), conditions: EMPTY_CONDITIONS } as WarningsResponse;
    } else if (kind === 'kmb' || kind === 'citybus' || kind === 'gmb' || kind === 'nlb') {
      const { loadDirectTransit } = await import('./transit-direct.ts');
      payload = await loadDirectTransit(kind, view.lng, view.lat, Date.now(), view.zoom);
    } else throw new Error('Hosted feed required');
  } else {
    const query = new URLSearchParams({ lng: String(view.lng), lat: String(view.lat), zoom: String(view.zoom), lang: language === 'en' ? 'en' : 'tc' });
    payload = await json(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/api/${endpoints[kind]}?${query}`, signal) as Envelope;
  }
  if (!payload.ok) throw new Error(payload.error || 'Feed unavailable');
  return normalizeIntegration(kind, payload);
}
function base(kind: IntegrationKind, payload: Envelope): CameraData {
  const fetchedAt = validDate(payload.fetchedAt) ?? new Date().toISOString();
  return { cameras: [], count: 0, expectedCount: 0, fetchedAt, observedAt: validDate(payload.observedAt ?? payload.capturedAt), sourceLastModified: null, source: layers[kind].source, complete: payload.complete !== false && !payload.stale, stale: Boolean(payload.stale), feedError: payload.error, payload };
}
function validDate(value: string | null | undefined) { return value && Number.isFinite(Date.parse(value)) ? value : null; }
const text = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const tones = { red: '#e15d69', amber: '#d49b25', green: '#1f9d63', none: '#8a9aa5' };
function row(key: keyof typeof labels.en, value: string, valueEn = value): DetailRow {
  return { label: text(labels.zh[key]), labelEn: text(labels.en[key]), value, valueEn };
}
export function pathsFromFeatures(collection: GeoJSON.FeatureCollection, prefix: string): MapPath[] {
  return collection.features.flatMap((feature, i) => {
    const paths = feature.geometry.type === 'LineString' ? [feature.geometry.coordinates] : feature.geometry.type === 'MultiLineString' ? feature.geometry.coordinates : [];
    return paths.map((points, j) => ({ id: `${prefix}-${i}-${j}`, color: text(feature.properties?.color) || '#8a6d3b', points: points.map(point => [point[1], point[0]] as [number, number]) }));
  });
}
function featureCameras(kind: IntegrationKind, collection: GeoJSON.FeatureCollection): Camera[] {
  return collection.features.flatMap((feature, index) => {
    if (feature.geometry.type !== 'Point') return [];
    const [lng, lat] = feature.geometry.coordinates;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
    const p = feature.properties ?? {};
    const sourceId = text(p.id || p.code || index);
    return [{ id: `${kind}-${sourceId}`, sourceId, kind, lat, lng, name: text(p.nameTc || p.roadTc || p.name || p.road || sourceId), nameEn: text(p.name || p.road || sourceId), badge: text(p.band), district: text(p.districtTc || p.district), districtEn: text(p.district) }];
  });
}
export function normalizeIntegration(kind: IntegrationKind, payload: Envelope): CameraData {
  const data = base(kind, payload);
  if (kind === 'crossing') {
    data.cameras = (payload as ApproachesResponse).points.map(point => {
      const valid = point.legs.filter(leg => leg.minutes !== null);
      const worst = valid.slice().sort((a, b) => (b.colour === 'red' ? 2 : b.colour === 'amber' ? 1 : 0) - (a.colour === 'red' ? 2 : a.colour === 'amber' ? 1 : 0))[0];
      return { id: `crossing-${point.id}`, sourceId: point.id, kind, name: point.nameTc || point.name, nameEn: point.name, dataUpdated: validDate(point.observedAt) ?? undefined, lng: point.coordinates[0], lat: point.coordinates[1], badge: worst ? String(worst.minutes) : '—', color: tones[worst?.colour ?? 'none'], rows: point.legs.map(leg => ({ label: labels.zh.crossingNames[leg.code as 'CH'] || leg.name, labelEn: labels.en.crossingNames[leg.code as 'CH'] || leg.name, value: `${leg.minutes ?? '—'} ${labels.zh.minutes}`, valueEn: `${leg.minutes ?? '—'} ${labels.en.minutes}` })), intel: { score: (worst?.colour === 'red' ? 600000 : worst?.colour === 'amber' ? 200000 : 10000) + (worst?.minutes ?? 0), urgent: worst?.colour === 'red', tone: worst?.colour ?? 'none' } };
    });
  } else if (kind === 'works' || kind === 'toll') {
    const collection = ((payload as FeaturesResponse)[kind === 'works' ? 'works' : 'tolls']) ?? { type: 'FeatureCollection', features: [] };
    data.cameras = featureCameras(kind, collection).map(camera => {
      const feature = collection.features.find(f => text(f.properties?.id) === camera.sourceId);
      const p = feature?.properties ?? {};
      const live = /in progress/i.test(text(p.status));
      const rows = kind === 'works' ? (['road', 'place', 'status', 'lane', 'start', 'end'] as const).flatMap(key => {
        if (!text(p[key])) return [];
        if (key === 'status') return [row(key, live ? labels.zh.underway : /preparation/i.test(text(p.status)) ? labels.zh.prep : text(p.statusTc || p.status), text(p.status))];
        return [row(key, text(p[`${key}Tc`] || p[key]), text(p[key]))];
      }) : [];
      if (p.bound) rows.push(row('direction', text(p.boundTc || p.bound), text(p.bound)));
      return { ...camera, name: kind === 'toll' ? tollNames[text(p.code)] || camera.name : camera.name, rows, color: kind === 'works' ? live ? tones.red : tones.amber : layers.toll.color, intel: kind === 'works' ? { score: live ? 250000 : 120000, urgent: live, tone: live ? 'red' as const : 'amber' as const } : undefined };
    });
  } else if (kind === 'boundary') {
    data.cameras = boundaryCameras((payload as ControlPointsResponse).points);
  } else if (kind === 'mtr' || kind === 'lrt') {
    data.paths = pathsFromFeatures(kind === 'mtr' ? mtrTrackCollection() : lrtTrackCollection(), kind);
    data.cameras = featureCameras(kind, kind === 'mtr' ? mtrStationCollection() : lrtStationCollection()).map(camera => {
      const arrivals: Arrival[] = kind === 'mtr' ? (payload as MtrResponse).boards.filter(board => board.station === camera.sourceId).flatMap(board => board.trains.map(call => ({ route: board.line, destination: stationRecord(call.dest)?.tc || call.dest, destinationEn: stationRecord(call.dest)?.en || call.dest, minutes: call.ttnt, eta: board.observedAt && Number.isFinite(Date.parse(board.observedAt)) ? new Date(Date.parse(board.observedAt) + call.ttnt * 60000).toISOString() : undefined, observedAt: board.observedAt, timeType: call.timeType, platform: call.plat, remark: call.delay ? labels.zh.delayed : '', remarkEn: call.delay ? labels.en.delayed : '' }))) : (payload as LrtResponse).boards.filter(board => board.station === camera.sourceId).flatMap(board => board.calls.map(call => ({ route: call.route, destination: call.destTc, destinationEn: call.destEn, minutes: call.ttnt, eta: board.observedAt && Number.isFinite(Date.parse(board.observedAt)) ? new Date(Date.parse(board.observedAt) + call.ttnt * 60000).toISOString() : undefined, observedAt: board.observedAt, timeType: call.timeType, platform: call.plat })));
      const observed = (payload as MtrResponse | LrtResponse).boards.filter(board => board.station === camera.sourceId).map(board => validDate(board.observedAt)).filter((time): time is string => Boolean(time)).sort();
      return { ...camera, dataUpdated: observed[0], positionType: 'station', arrivals: arrivals.sort((a, b) => (a.minutes ?? Infinity) - (b.minutes ?? Infinity)).slice(0, 12) };
    });
  } else if (kind === 'kmb' || kind === 'citybus' || kind === 'gmb' || kind === 'nlb') {
    data.cameras = (payload as CitybusResponse).stops.map(stop => ({ id: `${kind}-${stop.id}`, sourceId: stop.id, kind, name: stop.nameTc, nameEn: stop.nameEn, lng: stop.lng, lat: stop.lat, routes: stop.routes, badge: stop.routes.slice(0, 3).join(' · '), arrivals: stop.calls.slice(0, 12).map(call => ({ route: call.route, destination: call.destTc, destinationEn: call.destEn, minutes: call.minutes, eta: call.eta, scheduled: call.scheduled, remark: call.remarkTc, remarkEn: call.remarkEn, tracking: call.tracking })) }));
  } else if (kind === 'ferry') {
    data.cameras = (payload as FerryResponse).piers.map(pier => ({ id: `ferry-${pier.id}`, sourceId: pier.id, kind, name: pier.nameTc, nameEn: pier.nameEn, lng: pier.lng, lat: pier.lat, positionType: 'pier', arrivals: pier.calls.slice(0, 12).map(call => ({ route: call.route, destination: call.destTc, destinationEn: call.destEn, eta: call.eta, minutes: call.minutes, scheduled: call.scheduled, remark: call.remarkTc, remarkEn: call.remarkEn })) }));
    data.paths = (payload as FerryResponse).vessels.filter(vessel => vessel.pathLng && vessel.pathLat).map(vessel => ({ id: vessel.id, color: layers.ferry.color, points: vessel.pathLng!.map((lng, i) => [vessel.pathLat![i], lng] as [number, number]) }));
  }
  data.cameras = data.cameras.map(camera => ({ ...camera, dataUpdated: kind === 'crossing' || kind === 'mtr' || kind === 'lrt' ? camera.dataUpdated : camera.dataUpdated || data.observedAt || undefined }));
  data.count = kind === 'weather-warning' ? (payload as WarningsResponse).warnings.length : data.cameras.length;
  data.expectedCount = data.count;
  return data;
}
export function boundaryCameras(collection: GeoJSON.FeatureCollection): Camera[] {
  return featureCameras('boundary', collection).map(camera => {
    const p = collection.features.find(f => text(f.properties?.code) === camera.sourceId)?.properties ?? {};
    const worst = Number(p.worst);
    const score = worst === 2 ? 750000 : p.vehicleBand === 'congested' ? 420000 : worst === 1 ? 230000 : worst === 4 || worst === 99 ? 180000 : p.vehicleBand === 'slow' ? 60000 : 1000;
    const tone = worst === 2 || p.vehicleBand === 'congested' ? 'red' : worst === 1 || worst === 4 || worst === 99 || p.vehicleBand === 'slow' ? 'amber' : 'green';
    const fields = { residentArrCode: 'residentArrival', residentDepCode: 'residentDeparture', visitorArrCode: 'visitorArrival', visitorDepCode: 'visitorDeparture' } as const;
    const rows = Object.entries(fields).map(([key, label]) => { const code = Number(p[key]); const index = code === 99 ? 3 : code >= 0 && code <= 2 ? code : 4; return row(label, labels.zh.queue[index], labels.en.queue[index]); });
    if (typeof p.vehicleKmh === 'number') rows.push(row('approachSpeed', `${text(p.vehicleRoadTc || p.vehicleRoadEn)} · ${p.vehicleKmh} km/h`, `${text(p.vehicleRoadEn)} · ${p.vehicleKmh} km/h`));
    return { ...camera, name: boundaryNames[camera.sourceId] || camera.name, rows, color: tones[tone], intel: { score, urgent: tone === 'red', tone } };
  });
}
export function withBoundarySpeeds(data: CameraData | undefined, segments: FlowSegment[]): CameraData | undefined {
  if (!data?.payload) return data;
  const points = (data.payload as ControlPointsResponse).points;
  if (!points) return data;
  const collection = decorateControlPoints(points, segments.map(segment => ({ roadEn: segment.nameEn || '', roadTc: segment.name, speedKmh: segment.speedKmh, band: segment.level === 'slow' ? 'congested' : segment.level === 'moderate' ? 'slow' : segment.level })));
  return { ...data, cameras: boundaryCameras(collection).map(camera => ({ ...camera, dataUpdated: data.observedAt ?? undefined })) };
}
export function movingCameras(kind: 'mtr' | 'lrt' | 'ferry', data: CameraData, now: number): Camera[] {
  if (!data.payload || !data.observedAt || now - Date.parse(data.observedAt) > 180000) return [];
  if (kind === 'ferry') return (data.payload as FerryResponse).vessels.flatMap(vessel => {
    const path = vessel.pathLng?.map((lng, i) => ({ lng, lat: vessel.pathLat?.[i] ?? vessel.lat })) ?? [{ lng: vessel.fromLng ?? vessel.lng, lat: vessel.fromLat ?? vessel.lat }, { lng: vessel.toLng ?? vessel.lng, lat: vessel.toLat ?? vessel.lat }];
    const spot = vessel.fix === 'gps' ? vessel : placeOnPath(path, vessel.departAt ?? null, vessel.arriveAt ?? null, now);
    return spot ? [{ id: `ferry-vessel-${vessel.id}`, sourceId: vessel.id, kind, vehicleIcon: ferryVehicleIcon(vessel.route, vessel.id), name: vessel.nameTc, nameEn: vessel.nameEn, lat: spot.lat, lng: spot.lng, estimated: vessel.fix !== 'gps', positionType: 'vehicle', dataUpdated: data.observedAt ?? undefined, arrivals: [{ route: vessel.route, destination: vessel.destTc || vessel.nameTc, destinationEn: vessel.destEn || vessel.nameEn, minutes: spot.minutes, eta: vessel.eta }] }] : [];
  });
  return (data.payload as MtrResponse | LrtResponse).trains.flatMap(train => {
    const spot = kind === 'mtr' ? projectNetworkTrain(train, now) : projectTrain({ ...train, observedAt: Date.parse(train.observedAt) }, lrtPoint, now);
    if (!spot) return [];
    const dest = kind === 'mtr' ? stationRecord(train.dest) : lrtStation(train.dest);
    const nextCode = spot.clamp !== 'none' && spot.minutes > 0 ? train.anchor : spot.to;
    const next = kind === 'mtr' ? stationRecord(nextCode) : lrtStation(nextCode);
    return [{ id: `${kind}-train-${train.id}`, sourceId: train.id, kind, name: `${train.line} → ${dest?.tc || train.dest}`, nameEn: `${train.line} → ${dest?.en || train.dest}`, nextStation: { name: next?.tc || nextCode, nameEn: next?.en || nextCode }, lat: spot.lat, lng: spot.lng, color: kind === 'mtr' ? lineRecord(train.line)?.color : layers.lrt.color, estimated: true, positionType: 'vehicle', dataUpdated: train.observedAt, arrivals: [{ route: train.line, destination: dest?.tc || train.dest, destinationEn: dest?.en || train.dest, minutes: spot.minutes, eta: new Date(now + spot.minutes * 60000).toISOString(), observedAt: train.observedAt, platform: train.plat }] }];
  });
}

export function railHoverText(camera: Camera, language: Language, now = Date.now()): string {
  const copy = labels[language];
  const station = camera.nextStation ?? camera;
  const name = language === 'en' ? station.nameEn || station.name : station.name;
  const times = (camera.arrivals ?? []).map(call => call.eta ? Date.parse(call.eta) : NaN).filter(time => Number.isFinite(time) && time >= now).sort((a, b) => a - b);
  const updated = validDate(camera.dataUpdated);
  return `${name}\n${copy.nextTrainEta}: ${times.length ? hkTime(times[0], false, language) : copy.queue[4]}\n${messages[language].recordUpdated}: ${updated ? hkTime(updated, true, language) : copy.noTimestamp}`;
}
