import trackData from '../data/tram-track-geometry.json' with { type: 'json' }
import trams from '../data/tram-network.json' with { type: 'json' }
import type { MapPath } from './traffic.ts'

type Track = { relation: number; version: number; stopPoints: number[][]; coordinates: [number, number][]; stopDistances: number[] }
const tracks = trackData.routes as unknown as Record<string, Track>

// A refreshed official stop sequence must never silently retain an old track.
export function tramTrack(route: (typeof trams.routes)[number]): Track | null {
  const track = tracks[route.id]
  return track && track.coordinates.length >= 2 && track.stopPoints.length === route.points.length
    && track.stopDistances.length === route.points.length
    && track.stopPoints.every((point, index) => point[0] === route.points[index][0] && point[1] === route.points[index][1])
    ? track : null
}

export function tramTrackPaths(routeId?: string): MapPath[] {
  return trams.routes.filter(route => !routeId || route.routeId === routeId).flatMap(route => {
    const track = tramTrack(route)
    return track ? [{ id: `tram-${route.id}`, color: '#278273', points: track.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]) }] : []
  })
}
