import { integrationMessages, messages } from './i18n.ts';
import { layerText, isLiveTrafficDataFresh, isFeedDataStale, isCameraDataStale, feedMaxAgeMs, type Camera, type CameraData, type FlowSegment, type Language, type LayerKind } from './traffic.ts';
import { cameraFromFlowSegment } from './traffic-view.ts';
import type { ApproachesResponse, WarningsResponse } from './types.ts';

export type IntelTab = 'ranked' | 'roads' | 'boundary' | 'weather' | 'systems' | 'notes';
export const INTEL_TABS: IntelTab[] = ['ranked', 'roads', 'boundary', 'weather', 'systems', 'notes'];
export const RANKED_LIMIT = 12;
export type IntelItem = { id: string; kind: 'fault' | 'incident' | 'jam' | 'crossing' | 'works' | 'boundary' | 'weather' | 'note'; title: string; detail: string; score: number; urgent: boolean; tone: 'red' | 'amber' | 'green' | 'none'; camera?: Camera; segment?: FlowSegment };
export type FeedState = { data?: CameraData; loading: boolean; error: boolean };
export type IntelInput = { states: Partial<Record<LayerKind, FeedState>>; segments: FlowSegment[]; now: number };
const faults: Partial<Record<LayerKind, number>> = { flow: 1000000, incident: 640000, crossing: 620000, boundary: 580000, snapshot: 420000, mtr: 400000, kmb: 390000, lrt: 380000, citybus: 370000, gmb: 360000, nlb: 350000, ferry: 340000, 'weather-warning': 160000 };
const sort = (a: IntelItem, b: IntelItem) => b.score - a.score || a.id.localeCompare(b.id);

export function currentCrossingPoints(data: CameraData | undefined, now: number) {
  if (isFeedDataStale('crossing', data, now)) return [];
  return ((data?.payload as ApproachesResponse | undefined)?.points ?? []).filter(point => {
    if (!point.observedAt) return false;
    const age = now - Date.parse(point.observedAt);
    return Number.isFinite(age) && age >= -300000 && age <= feedMaxAgeMs('crossing');
  });
}

export function intelBoard(input: IntelInput, language: Language): Record<IntelTab, IntelItem[]> {
  const m = integrationMessages[language], copy = messages[language];
  const items: IntelItem[] = [];
  for (const [key, state] of Object.entries(input.states)) {
    const kind = key as LayerKind;
    const stale = isFeedDataStale(kind, state.data, input.now) || (kind === 'crossing' && state.data?.cameras.some(camera => isCameraDataStale(camera, input.now))) || (kind === 'flow' && state.data?.segmentsUpdated && !isLiveTrafficDataFresh(state.data.segmentsUpdated, input.now));
    if (!state.error && !stale) continue;
    const score = faults[kind] ?? 150000;
    items.push({ id: `fault-${kind}`, kind: 'fault', title: layerText(kind, language).name, detail: state.data ? m.stale : m.fault, score, urgent: score >= 500000, tone: score >= 500000 ? 'red' : 'amber' });
  }
  const incident = input.states.incident?.data;
  const notices = [...(incident?.notices ?? [])].sort((a, b) => b.time.localeCompare(a.time));
  notices.forEach((notice, index) => items.push({ id: notice.id, kind: 'incident', title: language === 'en' ? notice.textEn || notice.text : notice.text || notice.textEn, detail: '', score: 800000 - index, urgent: true, tone: 'red', camera: incident?.cameras.find(camera => camera.id === notice.cameraId) }));
  const roads = new Map<string, { segment: FlowSegment; lengthKm: number }>();
  for (const segment of input.segments) {
    if (segment.speedKmh === null || (segment.level !== 'slow' && segment.level !== 'moderate')) continue;
    const roadName = segment.nameEn || segment.name;
    const key = /unnamed|未命名|無名|^road$|^路段/i.test(roadName) ? segment.id : roadName;
    let lengthKm = 0;
    for (let i = 1; i < segment.path.length; i++) {
      const [lat, lng] = segment.path[i], [lastLat, lastLng] = segment.path[i - 1];
      lengthKm += Math.hypot((lat - lastLat) * 111.2, (lng - lastLng) * 111.2 * Math.cos(lat * Math.PI / 180));
    }
    const previous = roads.get(key);
    roads.set(key, { segment: previous && previous.segment.speedKmh! <= segment.speedKmh ? previous.segment : segment, lengthKm: lengthKm + (previous?.lengthKm ?? 0) });
  }
  for (const { segment, lengthKm } of roads.values()) {
    const jam = segment.level === 'slow';
    items.push({ id: `jam-${segment.id}`, kind: 'jam', title: language === 'en' ? segment.nameEn || segment.name : segment.name, detail: `${segment.speedKmh} km/h · ${lengthKm.toFixed(1)} km`, score: jam ? 400000 + (30 - segment.speedKmh!) * 1000 + lengthKm * 10 : 50000 + (50 - segment.speedKmh!) * 100, urgent: jam, tone: jam ? 'red' : 'amber', camera: cameraFromFlowSegment(segment, input.states.flow?.data?.segmentsUpdated), segment });
  }
  for (const kind of ['crossing', 'works', 'boundary'] as const) {
    if (isFeedDataStale(kind, input.states[kind]?.data, input.now)) continue;
    for (const camera of input.states[kind]?.data?.cameras ?? []) {
      if (isCameraDataStale(camera, input.now)) continue;
      if (!camera.intel) continue;
      items.push({ id: camera.id, kind, title: language === 'en' ? camera.nameEn || camera.name : camera.name, detail: camera.rows?.slice(0, 4).map(row => language === 'en' ? `${row.labelEn}: ${row.valueEn || row.value}` : `${row.label}: ${row.value}`).join(' · ') || '', ...camera.intel, camera });
    }
  }
  const warningData = input.states['weather-warning']?.data;
  for (const warning of (warningData?.payload as WarningsResponse | undefined)?.warnings ?? []) {
    items.push({ id: warning.id, kind: 'weather', title: warning.name, detail: warning.detail, score: warning.score, urgent: warning.urgent, tone: warning.tone });
  }
  const rain = input.states.rainfall?.data?.cameras ?? [];
  for (const camera of rain.filter(camera => (camera.rainfallMm ?? 0) >= 10)) items.push({ id: camera.id, kind: 'weather', title: language === 'en' ? camera.nameEn || camera.name : camera.name, detail: `${copy.rainfallAmount}: ${camera.rainfallMm} mm`, score: (camera.rainfallMm ?? 0) >= 30 ? 300000 : 10000, urgent: (camera.rainfallMm ?? 0) >= 30, tone: (camera.rainfallMm ?? 0) >= 30 ? 'red' : 'amber', camera });
  const systems = items.filter(item => item.kind === 'fault').sort(sort);
  const weather = items.filter(item => item.kind === 'weather' || item.id === 'fault-weather-warning').sort(sort);
  if (rain.length && !weather.some(item => item.camera?.kind === 'rainfall')) {
    const maximum = rain.reduce((highest, camera) => (camera.rainfallMm ?? 0) > (highest.rainfallMm ?? 0) ? camera : highest);
    weather.push({ id: 'rain-conditions', kind: 'weather', title: copy.rainfallAmount, detail: `${language === 'en' ? maximum.nameEn || maximum.name : maximum.name}: ${maximum.rainfallMm ?? 0} mm`, score: 1, urgent: false, tone: 'green', camera: maximum });
  }
  if (warningData && !(warningData.payload as WarningsResponse).warnings.length && !warningData.stale && !input.states['weather-warning']?.error) weather.push({ id: 'weather-clear', kind: 'weather', title: m.noWarnings, detail: '', score: 0, urgent: false, tone: 'green' });
  return {
    ranked: items.filter(item => item.kind !== 'boundary' || item.score > 1000).sort(sort).slice(0, RANKED_LIMIT),
    roads: items.filter(item => ['jam', 'incident', 'works', 'crossing'].includes(item.kind) || item.id === 'fault-flow' || item.id === 'fault-incident').sort(sort).slice(0, 32),
    boundary: items.filter(item => item.kind === 'boundary' || item.id === 'fault-boundary').sort(sort),
    weather, systems,
    notes: [{ id: 'notes', kind: 'note', title: m.intel, detail: m.noteText, score: 0, urgent: false, tone: 'none' }],
  };
}

export function rankIntel(input: IntelInput, language: Language): IntelItem[] { return intelBoard(input, language).ranked; }
