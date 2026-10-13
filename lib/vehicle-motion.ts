import { routeDistances, routePointAtDistance } from './bus-route-motion.ts';

type Point = [longitude: number, latitude: number];
export type VehicleRoutePosition = { key: string; distance: number; coordinates: Point[]; distances: number[] };
type Target = { point: Point; route?: VehicleRoutePosition };
type Displayed = { point: Point; route?: { key: string; distance: number }; at: number };
export type VehicleCorrection = { at: number; duration: number } & (
  { key: string; distance: number } | { point: Point }
);

// Correction belongs to the displayed marker and its route. After a suspended tab
// or a changed route, show the current estimate immediately instead of replaying
// a trip from an obsolete position. Normal refreshes start at the displayed point.
export function vehicleCorrection(previous: Displayed, target: Target, now: number, allowPoint: boolean, duration = 1000): VehicleCorrection | undefined {
  if (!Number.isFinite(now) || !Number.isFinite(duration) || duration <= 0 || now < previous.at || now - previous.at > 2500) return;
  if (target.route && previous.route?.key === target.route.key) {
    const distance = previous.route.distance - target.route.distance;
    if (!Number.isFinite(distance) || Math.abs(distance) > 1500) return;
    return { key: target.route.key, distance, at: now, duration };
  }
  if (!target.route && !previous.route && allowPoint) {
    const distance = routeDistances([previous.point, target.point])[1];
    if (!Number.isFinite(distance) || distance > 1500) return;
    return { point: [previous.point[0] - target.point[0], previous.point[1] - target.point[1]], at: now, duration };
  }
}

export function vehicleFrame(target: Target, correction: VehicleCorrection | undefined, now: number): { point: Point; distance?: number; active: boolean } {
  const compatible = correction && (target.route ? 'key' in correction && correction.key === target.route.key : 'point' in correction);
  const remaining = compatible ? Math.max(0, Math.min(1, 1 - (now - correction.at) / correction.duration)) ** 3 : 0;
  if (target.route) {
    const distance = target.route.distance + (correction && 'distance' in correction ? correction.distance : 0) * remaining;
    return { point: routePointAtDistance(target.route.coordinates, target.route.distances, distance) ?? target.point, distance, active: remaining > 0 };
  }
  const offset = correction && 'point' in correction ? correction.point : [0, 0];
  return { point: [target.point[0] + offset[0] * remaining, target.point[1] + offset[1] * remaining], active: remaining > 0 };
}
