import type { BusRouteSelection } from './bus-route.ts'

export function validBusSelection(value: BusRouteSelection, requireStopSeq = false): boolean {
  if (!value || !['kmb', 'citybus', 'gmb', 'nlb'].includes(value.operator) || !/^[A-Za-z0-9-]{1,12}$/.test(value.route) || !/^[A-Za-z0-9]{1,20}$/.test(value.stopId)) return false
  if (requireStopSeq && value.stopSeq == null) return false
  if (value.stopSeq != null && (!Number.isInteger(value.stopSeq) || value.stopSeq < 1 || value.stopSeq > 200)) return false
  if (value.operator === 'kmb') return (value.bound === 'I' || value.bound === 'O') && /^\d{1,3}$/.test(value.serviceType ?? '') && (!value.company || ['KMB', 'LWB'].includes(value.company))
  if (value.operator === 'citybus') return value.bound === 'I' || value.bound === 'O'
  return /^\d{1,10}$/.test(value.routeId ?? '') && (value.operator !== 'gmb' || value.routeSeq === 1 || value.routeSeq === 2)
}
