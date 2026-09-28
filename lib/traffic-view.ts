import { isLiveTrafficDataFresh, speedLevelColors } from './traffic.ts';
import type { Camera, FlowSegment, Language } from './traffic.ts';

// Re-evaluate age in the UI as well as at fetch time: a failed refresh must not
// leave an old reading looking like current free-flowing traffic.
export function displayFlowSegments(segments: FlowSegment[] | undefined, updated: string | undefined, now: number): FlowSegment[] {
  if (!segments) return [];
  if (isLiveTrafficDataFresh(updated, now)) return segments;
  return segments.map(segment => segment.level === 'unknown' && segment.speedKmh === null
    ? segment
    : { ...segment, speedKmh: null, level: 'unknown' });
}

export function cameraFromFlowSegment(segment: FlowSegment, dataUpdated?: string): Camera {
  const mid = segment.path[Math.floor(segment.path.length / 2)] ?? segment.path[0];
  return {
    id: segment.id,
    sourceId: String(segment.routeId),
    kind: 'flow',
    name: segment.name,
    nameEn: segment.nameEn,
    lat: mid[0],
    lng: mid[1],
    speedKmh: segment.speedKmh,
    speedLimitKmh: segment.speedLimitKmh,
    level: segment.level,
    color: speedLevelColors[segment.level],
    remarks: segment.routeNum != null ? String(segment.routeNum) : undefined,
    dataUpdated,
  };
}

export type TrafficSearchItem = { camera: Camera; segment?: FlowSegment };

export function searchTrafficItems(items: TrafficSearchItem[], query: string, language: Language): TrafficSearchItem[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return items.filter(({ camera, segment }) => {
    const text = [camera.name, camera.nameEn, camera.district, camera.districtEn, camera.sourceId, segment?.routeNum]
      .filter(value => value !== undefined).join(' ').toLocaleLowerCase();
    return terms.every(term => text.includes(term));
  }).sort((a, b) => {
    const nameA = language === 'en' ? a.camera.nameEn || a.camera.name : a.camera.name;
    const nameB = language === 'en' ? b.camera.nameEn || b.camera.name : b.camera.name;
    return nameA.localeCompare(nameB, language === 'en' ? 'en-HK' : 'zh-HK') || a.camera.id.localeCompare(b.camera.id);
  });
}
