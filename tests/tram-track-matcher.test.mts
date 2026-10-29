import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

test('tram importer rejects track gaps and contrary preferred directions', () => {
  const script = String.raw`
import importlib.util
import sys
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('tram', 'scripts/build-tram-track-geometry.py')
t = importlib.util.module_from_spec(spec); spec.loader.exec_module(t)
def way(points, direction='forward'):
    return {'geometry': points, 'tags': {'railway':'tram','railway:preferred_direction':direction}}
def stop(lng,lat):
    return {'STATION_LONGITUDE':lng,'STATION_LATITUDE':lat}
a=[114.0,22.4]; b=[114.001,22.4]; c=[114.002,22.4]
relation={'members':[{'type':'w','ref':1,'role':''},{'type':'w','ref':2,'role':''}]}
stops=[stop(*a),stop(*b),stop(*c)]
connected={'1':way([a,b]),'2':way([b,c])}
assert any(t.matcher.match(path,stops) for path in t.components(relation,connected))
broken={'1':way([a,b]),'2':way([[114.00101,22.4],c])}
assert not any(t.matcher.match(path,stops) for path in t.components(relation,broken))
wrong_way={'1':way([a,b]),'2':way([c,b])}
assert not any(t.matcher.match(path,stops) for path in t.components(relation,wrong_way))
`
  const result = spawnSync('python3', ['-c', script], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
})
