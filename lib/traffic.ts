import { integrationLayerNames } from './i18n.ts';
import type { BusRouteSelection } from './bus-route.ts';
export type OriginalLayerKind = 'redlight' | 'speed' | 'snapshot' | 'flow' | 'incident' | 'parking' | 'rainfall';
export type IntegrationKind = 'crossing' | 'works' | 'toll' | 'boundary' | 'weather-warning' | 'mtr' | 'lrt' | 'kmb' | 'citybus' | 'gmb' | 'nlb' | 'ferry';
export type LayerKind = OriginalLayerKind | IntegrationKind;
export type DetailRow = { label: string; labelEn: string; value: string; valueEn?: string };
export type Arrival = { route: string; destination: string; destinationEn: string; minutes: number | null; eta?: string; firstFerry?: string; lastFerry?: string; observedAt?: string; timeType?: 'A' | 'D'; platform?: string; scheduled?: boolean; remark?: string; remarkEn?: string; tracking?: BusRouteSelection };
export type MapPath = { id: string; color: string; points: [number, number][] };
export type Language = 'en' | 'zh';
export type SpeedLevel = 'free' | 'moderate' | 'slow' | 'unknown';
export type Camera = {
  id: string; sourceId: string; kind: LayerKind; name: string; nameEn?: string;
  lat: number; lng: number; district?: string; districtEn?: string; region?: string; regionEn?: string; remarks?: string;
  sourceUpdated?: string; imageUrl?: string;
  color?: string; rotation?: number; vehicleIcon?: string;
  level?: SpeedLevel; speedKmh?: number | null;
  speedLimitKmh?: number;
  vacancy?: number | null; capacity?: number | null; heightLimit?: number; openingStatus?: string;
  rainfallMm?: number;
  text?: string; textEn?: string;
  dataUpdated?: string;
  nextStation?: { name: string; nameEn: string };
  rows?: DetailRow[]; arrivals?: Arrival[]; routes?: string[]; badge?: string; estimated?: boolean; positionType?: 'station' | 'vehicle' | 'pier';
  intel?: { score: number; urgent: boolean; tone: 'red' | 'amber' | 'green' | 'none' };
};
export type IncidentNotice = { id: string; text: string; textEn: string; time: string; located: boolean; cameraId?: string };
// A road network segment from the official Road Network (2nd Generation) CENTERLINE,
// joined with the Transport Department's processed per-segment live speed (irnAvgSpeed-all.xml).
export type FlowSegment = {
  id: string;                    // `flow-segment-${routeId}`
  routeId: number;               // ROUTE_ID in the IRN CENTERLINE
  name: string;                  // STREET_CNAME (falls back to route/street English name or generic label)
  nameEn?: string;               // STREET_ENAME
  routeNum?: number;             // numbered route (1-10) from speed_segments_info.csv, when mapped
  direction?: number;            // TRAVEL_DIRECTION code from CENTERLINE
  speedKmh: number | null;       // live average speed; null when no valid reading
  speedLimitKmh: number;         // official road speed limit, or Hong Kong's 50 km/h default
  level: SpeedLevel;
  path: [number, number][];      // [lat, lng] pairs (WGS84, 5 decimal places)
};
export type CameraData = {
  cameras: Camera[]; count: number; expectedCount: number; fetchedAt: string;
  sourceLastModified: string | null; source: string; complete: boolean;
  notices?: IncidentNotice[];
  segments?: FlowSegment[];      // flow layer only: colored road segments
  segmentsUpdated?: string;      // flow layer only: timestamp of the segment speed data
  segmentsExpectedCount?: number;
  segmentsComplete?: boolean;
  stale?: boolean; observedAt?: string | null; paths?: MapPath[]; payload?: unknown; feedNote?: string; feedError?: string;
};
export const originalKinds: OriginalLayerKind[] = ['flow', 'incident', 'redlight', 'speed', 'snapshot', 'parking', 'rainfall'];
export const integrationKinds: IntegrationKind[] = ['crossing', 'works', 'toll', 'boundary', 'weather-warning', 'mtr', 'lrt', 'kmb', 'citybus', 'gmb', 'nlb', 'ferry'];
export const kinds: LayerKind[] = [...originalKinds, ...integrationKinds];
type Layer = { name: string; nameEn: string; short: string; shortEn: string; caption: string; captionEn: string; color: string; dataset: string; source: string; serverOnly?: boolean };
const extraLayer = (kind: IntegrationKind, color: string, source: string, serverOnly = false): Layer => ({ ...integrationLayerNames[kind], color, source, dataset: '', serverOnly });
export const layers: Record<LayerKind, Layer> = {
  redlight: { name: '衝紅燈攝影機', nameEn: 'Red-light cameras', short: '衝紅燈', shortEn: 'Red light', caption: '裝設攝影機系統的路口', captionEn: 'Camera-enforced junctions', color: '#e15d69', dataset: 'td_rcd_1671693287017_1644', source: 'https://data.gov.hk/tc-data/dataset/hk-td-tis_25-junctions-with-rlc' },
  speed: { name: '偵速攝影機', nameEn: 'Speed cameras', short: '偵速', shortEn: 'Speed', caption: '偵速攝影機機箱位置', captionEn: 'Speed camera housing locations', color: '#d49b25', dataset: 'td_rcd_1671693428549_89372', source: 'https://data.gov.hk/tc-data/dataset/hk-td-tis_26-locations-of-sec' },
  snapshot: { name: '交通快拍', nameEn: 'Traffic snapshots', short: '交通快拍', shortEn: 'Snapshots', caption: '運輸署最新道路影像', captionEn: 'Latest Transport Department images', color: '#318dbe', dataset: '', source: 'https://data.gov.hk/tc-data/dataset/hk-td-tis_2-traffic-snapshot-images' },
  flow: { name: '實時車速', nameEn: 'Live road speed', short: '車速', shortEn: 'Flow', caption: '主要道路路段車速每 2 分鐘更新', captionEn: 'Live speeds on major-road segments', color: '#1f9d63', dataset: '', source: 'https://data.gov.hk/en-data/dataset/hk-td-sm_4-traffic-data-strategic-major-roads' },
  incident: { name: '特別交通消息', nameEn: 'Traffic incidents', short: '事故', shortEn: 'Incidents', caption: '事故、封路及緊急工程', captionEn: 'Accidents, closures and emergency works', color: '#e8842c', dataset: '', source: 'https://data.gov.hk/en-data/dataset/hk-td-tis_19-special-traffic-news-v2' },
  parking: { name: '停車場空位', nameEn: 'Parking vacancy', short: '泊車', shortEn: 'Parking', caption: '實時泊車空位及高度限制', captionEn: 'Real-time spaces and height limits', color: '#7b5fc9', dataset: '', source: 'https://data.gov.hk/en-data/dataset/hk-dpo-datagovhk1-carpark-info-vacancy' },
  rainfall: { name: '降雨量', nameEn: 'Rainfall', short: '雨量', shortEn: 'Rain', caption: '天文台分區每小時雨量', captionEn: 'HKO district hourly rainfall', color: '#5a8fd6', dataset: '', source: 'https://data.gov.hk/en-data/dataset/hk-hko-rss-rainfall-in-the-past-hour' },
  crossing: extraLayer('crossing', '#c0392b', 'https://www.hkemobility.gov.hk/', true),
  works: extraLayer('works', '#b57708', 'https://www.hkemobility.gov.hk/', true),
  toll: extraLayer('toll', '#6b7a8d', 'https://www.hkemobility.gov.hk/', true),
  boundary: extraLayer('boundary', '#8e44ad', 'https://www.immd.gov.hk/', true),
  'weather-warning': extraLayer('weather-warning', '#2e6da4', 'https://www.hko.gov.hk/en/wxinfo/dailywx/wxwarntoday.htm'),
  mtr: extraLayer('mtr', '#d43d2a', 'https://www.mtr.com.hk/', true),
  lrt: extraLayer('lrt', '#8a6d3b', 'https://www.mtr.com.hk/', true),
  kmb: extraLayer('kmb', '#a33e1f', 'https://data.etabus.gov.hk/'),
  citybus: extraLayer('citybus', '#c28a0b', 'https://www.citybus.com.hk/'),
  gmb: extraLayer('gmb', '#2f8f5b', 'https://data.etagmb.gov.hk/'),
  nlb: extraLayer('nlb', '#3b6ea5', 'https://www.nlb.com.hk/'),
  ferry: extraLayer('ferry', '#1f7a8c', 'https://www.td.gov.hk/en/transport_in_hong_kong/public_transport/ferries/', true),
};
export const staticExport = process.env.NEXT_PUBLIC_STATIC_EXPORT === '1';
export const hostedUrl = process.env.NEXT_PUBLIC_HOSTED_URL || 'https://hkrttrafficinfo.vercel.app/';
export const layerAvailable = (kind: LayerKind) => !staticExport || !layers[kind].serverOnly;
export function feedMaxAgeMs(kind: LayerKind): number {
  if (kind === 'toll') return 12 * 60 * 60000;
  if (kind === 'works' || originalKinds.includes(kind as OriginalLayerKind)) return 10 * 60000;
  if (kind === 'crossing') return 4 * 60000;
  return 3 * 60000;
}
export function isFeedDataStale(kind: LayerKind, data: CameraData | undefined, now = Date.now()): boolean {
  if (!data) return false;
  const time = data.observedAt || data.fetchedAt;
  return Boolean(data.stale || !Number.isFinite(Date.parse(time)) || now - Date.parse(time) > feedMaxAgeMs(kind));
}
export function isCameraDataStale(camera: Camera, now = Date.now()): boolean {
  if (!camera.dataUpdated) return camera.kind === 'crossing';
  const age = now - Date.parse(camera.dataUpdated);
  return !Number.isFinite(age) || age < -300000 || age > feedMaxAgeMs(camera.kind);
}
export const layerGroups: { id: 'roads' | 'conditions' | 'rail' | 'bus' | 'ferry'; kinds: LayerKind[] }[] = [
  { id: 'roads', kinds: ['flow', 'incident', 'crossing', 'works', 'toll', 'redlight', 'speed', 'snapshot', 'parking'] },
  { id: 'conditions', kinds: ['boundary', 'rainfall', 'weather-warning'] },
  { id: 'rail', kinds: ['mtr', 'lrt'] },
  { id: 'bus', kinds: ['kmb', 'citybus', 'gmb', 'nlb'] },
  { id: 'ferry', kinds: ['ferry'] },
];
export const speedLevelColors: Record<SpeedLevel, string> = { free: '#1f9d63', moderate: '#d49b25', slow: '#e15d69', unknown: '#8a9aa5' };
const trafficSpeedThresholds = {
  urban: { slowAtOrBelow: 15, freeAbove: 30 },
  major: { slowAtOrBelow: 25, freeAbove: 50 },
} as const;
export const liveTrafficMaxAgeMs = 10 * 60 * 1000;
const liveTrafficFutureToleranceMs = 5 * 60 * 1000;

export function speedLevel(speedKmh: number | null, speedLimitKmh = 50): SpeedLevel {
  if (speedKmh === null || !Number.isFinite(speedKmh) || speedKmh < 0) return 'unknown';
  const thresholds = speedLimitKmh >= 70 ? trafficSpeedThresholds.major : trafficSpeedThresholds.urban;
  if (speedKmh <= thresholds.slowAtOrBelow) return 'slow';
  if (speedKmh <= thresholds.freeAbove) return 'moderate';
  return 'free';
}

export function officialHongKongTimestamp(date: unknown, time: unknown): string | undefined {
  if (typeof date !== 'string' || typeof time !== 'string') return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}:\d{2}$/.test(time)) return undefined;
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute, second] = time.split(':').map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59) return undefined;
  return `${date}T${time}+08:00`;
}

export function isLiveTrafficDataFresh(timestamp: string | undefined, now = Date.now()): boolean {
  if (!timestamp) return false;
  const updatedAt = Date.parse(timestamp);
  if (!Number.isFinite(updatedAt)) return false;
  const age = now - updatedAt;
  return age >= -liveTrafficFutureToleranceMs && age <= liveTrafficMaxAgeMs;
}
export function layerText(kind: LayerKind, language: Language) {
  const layer = layers[kind];
  return language === 'en'
    ? { name: layer.nameEn, short: layer.shortEn, caption: layer.captionEn }
    : { name: layer.name, short: layer.short, caption: layer.caption };
}
export const snapshotInventory = 'https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_Tc.xml';
export const snapshotInventoryEn = 'https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_En.xml';
export const featureService = (kind: 'redlight' | 'speed') => `https://portal.csdi.gov.hk/server/rest/services/common/${layers[kind].dataset}/FeatureServer/0`;
export function hkTime(value: string | number, date = false, language: Language = 'zh') {
  return new Intl.DateTimeFormat(language === 'en' ? 'en-HK' : 'zh-HK', { timeZone: 'Asia/Hong_Kong', ...(date ? { month: '2-digit', day: '2-digit' } : {}), hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value));
}
