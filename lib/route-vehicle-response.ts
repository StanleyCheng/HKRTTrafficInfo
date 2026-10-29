import type { BusRouteData, BusRouteResponse, BusRouteStop, BusVehicle } from './bus-route.ts'
import type { CameraData, Camera, Arrival } from './traffic.ts'
import type { RouteVehicleSnapshot } from './route-vehicles.ts'
import { validBusSelection } from './bus-selection.ts'

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const text = (value: unknown): value is string => typeof value === 'string'
const point = (value: unknown): value is [number, number] => Array.isArray(value) && value.length === 2 && value.every(finite)
const stop = (value: unknown): value is BusRouteStop => record(value) && text(value.id) && Number.isInteger(value.seq) && finite(value.lat) && finite(value.lng) && finite(value.distance) && text(value.nameTc) && text(value.nameEn)
export function isBusRouteData(value: unknown): value is BusRouteData {
  if (!record(value) || !['kmb', 'citybus', 'gmb', 'nlb'].includes(String(value.operator)) || !text(value.key) || !text(value.route) || value.geometry !== 'road' && value.geometry !== 'stops' || !Array.isArray(value.coordinates) || value.coordinates.length < 2 || !value.coordinates.every(point) || !Array.isArray(value.stops) || !value.stops.every(stop)) return false
  if (value.company !== undefined && !text(value.company)) return false
  if (value.selection !== undefined) {
    if (!record(value.selection)) return false
    const selection = value.selection
    if (selection.operator !== value.operator || selection.route !== value.route || !text(selection.stopId)) return false
    // All primitive fields are checked before the protocol validator reads them.
    if (['company', 'bound', 'serviceType', 'routeId'].some(key => selection[key] !== undefined && !text(selection[key])) || ['routeSeq', 'stopSeq'].some(key => selection[key] !== undefined && !finite(selection[key]))) return false
    if (!validBusSelection(selection as Parameters<typeof validBusSelection>[0])) return false
  }
  return true
}
const vehicle = (value: unknown): value is BusVehicle => record(value) && text(value.id) && ['fromDistance', 'toDistance', 'departureAt', 'arrivalAt', 'validUntil'].every(key => finite(value[key])) && (value.scheduled === undefined || typeof value.scheduled === 'boolean') && (value.timeline === undefined || Array.isArray(value.timeline) && value.timeline.every(item => record(item) && finite(item.distance) && finite(item.at)))
export function isBusRouteResponse(value: unknown): value is BusRouteResponse {
  return record(value) && typeof value.ok === 'boolean' && typeof value.stale === 'boolean' && (value.observedAt === null || text(value.observedAt))
    && (value.route === undefined || isBusRouteData(value.route)) && (value.error === undefined || text(value.error))
    && Array.isArray(value.vehicles) && value.vehicles.every(vehicle) && Array.isArray(value.reverse) && value.reverse.every(direction => record(direction) && isBusRouteData(direction.route) && Array.isArray(direction.vehicles) && direction.vehicles.every(vehicle) && (direction.stale === undefined || typeof direction.stale === 'boolean'))
}
const arrival = (value: unknown): value is Arrival => record(value) && text(value.route) && text(value.destination) && text(value.destinationEn) && (value.minutes === null || finite(value.minutes)) && (value.eta === undefined || text(value.eta)) && (value.observedAt === undefined || text(value.observedAt)) && (value.scheduled === undefined || typeof value.scheduled === 'boolean') && (value.mtrLineRef === undefined || text(value.mtrLineRef))
const camera = (value: unknown): value is Camera => record(value) && value.kind === 'mtr-bus' && text(value.id) && text(value.sourceId) && text(value.name) && (value.nameEn === undefined || text(value.nameEn)) && finite(value.lat) && finite(value.lng) && (value.dataUpdated === undefined || text(value.dataUpdated)) && Array.isArray(value.arrivals) && value.arrivals.every(arrival)
function isMtrBusData(value: unknown): value is CameraData {
  return record(value) && Array.isArray(value.cameras) && value.cameras.every(camera) && finite(value.count) && finite(value.expectedCount) && text(value.fetchedAt) && (value.observedAt === null || text(value.observedAt)) && typeof value.stale === 'boolean' && typeof value.complete === 'boolean' && text(value.source) && value.sourceLastModified === null
}
export function readRouteVehicleSnapshot(value: unknown): RouteVehicleSnapshot {
  if (!record(value) || value.ok !== true || !record(value.snapshot)) throw new Error('Vehicle positions unavailable')
  const snapshot = value.snapshot
  // A shared-cache fallback marks the envelope stale without changing its
  // retained payload. Keep that status visible without renewing any clocks.
  if (snapshot.kind === 'bus' && isBusRouteResponse(snapshot.data)) return { kind: 'bus', data: value.stale === true ? { ...snapshot.data, stale: true, error: text(value.error) ? value.error : snapshot.data.error } : snapshot.data }
  if (snapshot.kind === 'mtr-bus' && isMtrBusData(snapshot.data)) return { kind: 'mtr-bus', data: value.stale === true ? { ...snapshot.data, stale: true } : snapshot.data }
  throw new Error('Vehicle positions unavailable')
}
