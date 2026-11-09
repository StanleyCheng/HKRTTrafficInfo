import type { BusRouteData } from './bus-route.ts'

// KMB and Citybus stop-to-stop coordinates are useful for stop ordering,
// but they do not describe the road taken between those stops.
export const hasBusRoadDisplay = (route: Pick<BusRouteData, 'operator'> & Partial<Pick<BusRouteData, 'geometry'>>) => route.operator !== 'kmb' && route.operator !== 'citybus' || route.geometry === 'road'
