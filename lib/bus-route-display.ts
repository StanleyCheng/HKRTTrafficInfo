import type { BusRouteData } from './bus-route.ts'

// Citybus stop-to-stop coordinates are useful for listing and fitting stops,
// but they do not describe the route taken on the road.
export const hasBusRoadDisplay = (route: Pick<BusRouteData, 'operator'> & Partial<Pick<BusRouteData, 'geometry'>>) => route.operator !== 'citybus' || route.geometry !== 'stops'
