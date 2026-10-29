import assert from 'node:assert/strict'
import test from 'node:test'
import trams from '../data/tram-network.json' with { type: 'json' }
import { tramTrack, tramTrackPaths } from '../lib/tram-track-geometry.ts'
import { routeDistances, routePointAtDistance } from '../lib/bus-route-motion.ts'
import { metresBetween } from '../lib/nearest.ts'

test('tram directions follow matched track and preserve each ordered official stop', () => {
  assert.equal(trams.routes.length, 12)
  for (const route of trams.routes) {
    const track = tramTrack(route)
    assert.ok(track, `${route.id} has a matched tram relation`)
    assert.ok(track.coordinates.length > route.points.length * 2, `${route.id} uses track geometry`)
    const distances = routeDistances(track.coordinates)
    for (const [index, [lat, lng]] of route.points.entries()) {
      const distance = track.stopDistances[index]
      assert.ok(distance >= 0 && distance <= distances.at(-1)! + .02, route.id)
      if (index) assert.ok(distance >= track.stopDistances[index - 1], route.id)
      const projected = routePointAtDistance(track.coordinates, distances, distance)!
      assert.ok(metresBetween({ lng: projected[0], lat: projected[1] }, { lng, lat }) <= 25, `${route.id} stop ${index + 1}`)
    }
    const shown = tramTrackPaths(route.routeId).find(path => path.id === `tram-${route.id}`)
    assert.deepEqual(shown?.points, track.coordinates.map(([lng, lat]) => [lat, lng]))
    if (route.routeId === '4002' || route.routeId === '4003') {
      assert.ok(track.coordinates.some(([, lat]) => lat < 22.27), `${route.id} reaches the Happy Valley loop`)
    }
    const changed = { ...route, points: route.points.map((point, index) => index === 1 ? [point[0] + .001, point[1]] : point) }
    assert.equal(tramTrack(changed), null, `${route.id} invalidates a changed stop sequence`)
  }
})
