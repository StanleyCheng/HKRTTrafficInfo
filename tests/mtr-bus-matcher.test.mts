import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

// Exercise the importer on small road networks, not the generated fixture.
// In particular a near miss must never become a made-up connection.
test('MTR Bus importer rejects disconnected and wrong-way roads and handles repeated stops', () => {
  const script = String.raw`
import importlib.util
import sys
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('matcher', 'scripts/build-mtr-bus-road-geometry.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
def way(points, oneway='yes'):
    return {'geometry': points, 'tags': {'highway':'residential','oneway':oneway}}
def stop(lng,lat):
    return {'STATION_LONGITUDE':lng,'STATION_LATITUDE':lat}
relation={'members':[{'type':'w','ref':1,'role':''},{'type':'w','ref':2,'role':''}]}
a=[114.0,22.4]; b=[114.001,22.4]; c=[114.002,22.4]
stops=[stop(*a),stop(*b),stop(*c)]
connected={'1':way([a,b]),'2':way([b,c])}
assert any(m.match(path,stops) for path in m.components(relation,connected))
broken={'1':way([a,b]),'2':way([[114.00101,22.4],c])}
assert not any(m.match(path,stops) for path in m.components(relation,broken))
wrong_way={'1':way([a,b]),'2':way([c,b])}
assert not any(m.match(path,stops) for path in m.components(relation,wrong_way))
loop=[a,b,c,b,a]
matched=m.match(loop,[stop(*a),stop(*c),stop(*a)])
assert matched and matched['stopDistances'][0] < matched['stopDistances'][1] < matched['stopDistances'][2]
assert matched['coordinates'][0] == a and matched['coordinates'][-1] == a
`
  const result = spawnSync('python3', ['-c', script], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
})
