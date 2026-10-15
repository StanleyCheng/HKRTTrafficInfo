import type { BusRouteDirection, BusRouteResponse } from './bus-route.ts';
import { busVehicleDistanceAtTime } from './bus-route-motion.ts';
import { reconcileTransitIdentities } from './transit-identity.ts';
import { ETA_KEEP_MS } from './place-arrivals.ts';

function continuous(previous: BusRouteDirection | undefined, next: BusRouteDirection, now: number): BusRouteDirection {
  if (!previous || previous.route.key !== next.route.key) return next;
  const samples = (direction: BusRouteDirection) => direction.vehicles.map(vehicle => ({
    id: vehicle.id, key: direction.route.key, destination: direction.route.key,
    distance: busVehicleDistanceAtTime(vehicle, now) ?? Number.NaN, observedAt: vehicle.validUntil - ETA_KEEP_MS,
  }));
  const ids = reconcileTransitIdentities(samples(previous), samples(next), now);
  return { ...next, vehicles: next.vehicles.map((vehicle, index) => ({ ...vehicle, id: ids[index] })) };
}

// A failed refresh does not revoke an observation that is still within its
// original lifetime. Never renew validUntil or retain against a healthy empty
// board. Keep retained trajectories with the geometry they were calculated on.
export function retainBusRoute(previous: BusRouteResponse | undefined, next: BusRouteResponse, now: number): BusRouteResponse {
  const active = (direction: BusRouteDirection): BusRouteDirection => ({ ...direction, vehicles: direction.vehicles.filter(vehicle => busVehicleDistanceAtTime(vehicle, now) !== null) });
  if (!previous?.route) return next;
  if (!next.ok || !next.route) return {
    ...previous, stale: true, error: next.error || 'Arrival estimates could not refresh',
    vehicles: active({ route: previous.route, vehicles: previous.vehicles }).vehicles,
    reverse: previous.reverse.map(direction => ({ ...active(direction), stale: true })),
  };
  if (next.route.key !== previous.route.key) return next;
  const forward = next.stale && !next.vehicles.length
    ? active({ route: previous.route, vehicles: previous.vehicles })
    : continuous({ route: previous.route, vehicles: previous.vehicles }, { route: next.route, vehicles: next.vehicles }, now);
  return {
    ...next, ...forward,
    reverse: next.reverse.map(direction => {
      const before = previous.reverse.find(item => item.route.key === direction.route.key);
      return direction.stale && !direction.vehicles.length && before ? { ...active(before), stale: true } : continuous(before, direction, now);
    }),
  };
}
