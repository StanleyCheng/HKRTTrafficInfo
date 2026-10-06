import type { BusRouteResponse } from './bus-route.ts';

export function routeDistances(coordinates: [number, number][]): number[] {
  const radians = Math.PI / 180;
  let distance = 0;
  return coordinates.map(([lng, lat], index) => {
    if (index) {
      const [previousLng, previousLat] = coordinates[index - 1];
      const a = Math.sin((lat - previousLat) * radians / 2) ** 2 + Math.cos(lat * radians) * Math.cos(previousLat * radians) * Math.sin((lng - previousLng) * radians / 2) ** 2;
      distance += 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, a)));
    }
    return distance;
  });
}

export function routePointAtDistance(coordinates: [number, number][], distances: number[], distance: number): [number, number] | null {
  if (!coordinates.length || !Number.isFinite(distance)) return null;
  if (distance <= 0) return coordinates[0];
  let low = 1, high = distances.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (distances[middle] < distance) low = middle + 1;
    else high = middle;
  }
  if (distance >= distances.at(-1)!) return coordinates.at(-1)!;
  const length = distances[low] - distances[low - 1];
  const progress = length > 0 ? (distance - distances[low - 1]) / length : 0;
  const start = coordinates[low - 1], end = coordinates[low];
  return [start[0] + (end[0] - start[0]) * progress, start[1] + (end[1] - start[1]) * progress];
}

// Heading in degrees clockwise from north, matching CSS rotate() for the
// up-facing bus glyph. Looks a few meters ahead along the route; near the
// terminus the epsilon would overrun, so it looks back along the final segment
// instead, keeping the last known bearing.
export function routeHeadingAtDistance(coordinates: [number, number][], distances: number[], distance: number): number | null {
  const total = distances.at(-1) ?? 0;
  if (coordinates.length < 2 || total <= 0 || !Number.isFinite(distance)) return null;
  const epsilon = Math.min(25, total / 2);
  const clamped = Math.min(Math.max(distance, 0), total);
  const ahead = clamped + epsilon <= total;
  const from = routePointAtDistance(coordinates, distances, ahead ? clamped : Math.max(0, clamped - epsilon))!;
  const to = routePointAtDistance(coordinates, distances, ahead ? clamped + epsilon : clamped)!;
  const dy = to[1] - from[1];
  const dx = (to[0] - from[0]) * Math.cos(from[1] * Math.PI / 180);
  if (!dx && !dy) return null;
  return (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
}

export function busDistanceAtTime(data: BusRouteResponse, now: number): number | null {
  const vehicle = data.vehicle;
  if (!data.ok || data.stale || !vehicle || now > vehicle.validUntil || now < vehicle.departureAt) return null;
  const duration = vehicle.arrivalAt - vehicle.departureAt;
  if (duration <= 0 || ![vehicle.fromDistance, vehicle.toDistance, vehicle.departureAt, vehicle.arrivalAt, vehicle.validUntil].every(Number.isFinite)) return null;
  const progress = Math.min(1, (now - vehicle.departureAt) / duration);
  return vehicle.fromDistance + (vehicle.toDistance - vehicle.fromDistance) * progress;
}
