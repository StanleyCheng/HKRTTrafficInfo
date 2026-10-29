import assert from 'node:assert/strict'
import test from 'node:test'
import stops from './fixtures/citybus-11-outbound-stops.json' with { type: 'json' }
import { citybusOsmGeometry, matchCitybusOsmCandidates, matchCitybusOsmPath } from '../lib/citybus-osm-geometry.ts'
import { routeDistances, routePointAtDistance } from '../lib/bus-route-motion.ts'
import { metresBetween } from '../lib/nearest.ts'
import type { BusRouteStop } from '../lib/bus-route.ts'

test('Citybus 11 uses a direction-matched OSM road relation near every published stop', async () => {
  const shape = await citybusOsmGeometry({ operator: 'citybus', route: '11', bound: 'O', stopId: stops[0].id }, stops)
  assert.ok(shape)
  assert.equal(shape.source, 'osm')
  assert.equal(shape.relation, 8258233)
  assert.ok(shape.coordinates.length > stops.length * 2)
  const distances = routeDistances(shape.coordinates)
  for (const [i, stop] of stops.entries()) {
    const at = shape.stopDistances[i]
    assert.ok(at >= (shape.stopDistances[i - 1] ?? 0))
    const p = routePointAtDistance(shape.coordinates, distances, at)!
    assert.ok(metresBetween({ lng: p[0], lat: p[1] }, stop) <= 65)
  }
  assert.equal(await citybusOsmGeometry({ operator: 'kmb', route: '11', bound: 'O', stopId: stops[0].id }, stops), null)
  assert.equal(await citybusOsmGeometry({ operator: 'citybus', route: '11', bound: 'I', stopId: stops.at(-1)!.id }, [...stops].reverse()), null)
})

test('missing, misordered, sparse-detour and ambiguous road variants are rejected', () => {
  const rows = [[114.1,22.3], [114.105,22.3], [114.11,22.3]].map(([lng, lat], i) => ({ id: `${i}`, seq: i+1, lng, lat, nameTc: '', nameEn: '', distance: 0 } satisfies BusRouteStop))
  const straight: [number, number][] = [[114.1,22.3],[114.105,22.3],[114.11,22.3]]
  const offset: [number, number][] = [[114.1,22.3],[114.1025,22.301],[114.105,22.3],[114.1075,22.301],[114.11,22.3]]
  assert.ok(matchCitybusOsmPath(straight, rows))
  assert.equal(matchCitybusOsmPath(straight, [rows[0], rows[2], rows[1]]), null)
  assert.equal(matchCitybusOsmPath(straight, [{...rows[0],lat:22.31}, rows[1], rows[2]]), null)
  assert.equal(matchCitybusOsmCandidates([{relation:1, version:1, paths:[straight]}, {relation:2,version:1,paths:[offset]}], rows), null)
  const hugeDetour: [number, number][] = [[114.1,22.3],[114.1,22.32],[114.105,22.3],[114.11,22.3]]
  assert.equal(matchCitybusOsmPath(hugeDetour, rows), null)
})

test('matching selects a valid later occurrence on a loop instead of rejecting it for an earlier detour', () => {
  const stops = [[114.1, 22.3], [114.101, 22.3], [114.102, 22.3]].map(([lng, lat], i) => ({ id: `${i}`, seq: i + 1, lng, lat, nameTc: '', nameEn: '', distance: 0 } satisfies BusRouteStop))
  const path: [number, number][] = [[114.1, 22.3], [114.1, 22.32], [114.10005, 22.32], [114.10005, 22.3], [114.101, 22.3], [114.102, 22.3]]
  const match = matchCitybusOsmPath(path, stops)
  assert.ok(match, 'a later occurrence of the first stop is a valid match')
  assert.ok(match.stopDistances[1] < 1200, 'matched stops avoid the earlier long loop')
  assert.ok(routeDistances(match.coordinates).at(-1)! < 1200, 'the route is clipped to the valid occurrence')
})
