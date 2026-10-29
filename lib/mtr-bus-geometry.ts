import geometry from '../data/mtr-bus-road-geometry.json' with { type: 'json' }
import { mtrBusStops } from './commuter-catalogue.ts'

type Stop = (typeof mtrBusStops)[number]
type RoadShape = { relation: number; stopIds: string[]; stopCoordinates: [number, number][]; coordinates: [number, number][]; stopDistances: number[] }
export type MtrBusDirection = { key: string; code: string; stops: Stop[]; road: RoadShape | null }

// Only use a checked road shape with the exact stop sequence it was matched to.
// An updated operator catalogue can otherwise silently make a bundled route stale.
const shapes = geometry.routes as unknown as Record<string, RoadShape>
let directions: MtrBusDirection[] | undefined
export function mtrBusDirections(): MtrBusDirection[] {
  if (directions) return directions
  const groups = new Map<string, Stop[]>()
  for (const stop of mtrBusStops) {
    const key = `${stop.reference}:${stop.direction}`
    groups.set(key, [...(groups.get(key) ?? []), stop])
  }
  return directions = [...groups].map(([key, stops]) => {
    stops.sort((a, b) => a.seq - b.seq)
    const shape = shapes[key]
    const road = shape && shape.coordinates.length >= 2 && shape.stopIds.length === stops.length
      && shape.stopDistances.length === stops.length && shape.stopCoordinates.length === stops.length
      && shape.stopIds.every((id, i) => id === stops[i].id && shape.stopCoordinates[i][0] === stops[i].lng && shape.stopCoordinates[i][1] === stops[i].lat)
      ? shape : null
    return { key, code: stops[0].route, stops, road }
  })
}
