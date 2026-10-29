import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

test('Citybus OSM extraction recognises CTB joint operators without accepting KMB alone', () => {
  const script = String.raw`
import importlib.util
import sys
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('citybus_extract', 'scripts/extract-citybus-osm.py')
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
assert module.is_citybus_relation({'operator': 'CTB; KMB'})
assert module.is_citybus_relation({'operator': 'KMB;CTB'})
assert module.is_citybus_relation({'operator': 'Citybus Limited'})
assert not module.is_citybus_relation({'operator': 'KMB'})
assert not module.is_citybus_relation({'operator': 'NOTCTB'})
assert not module.is_citybus_relation({'operator': 'NWFB; KMB'})
`
  const result = spawnSync('python3', ['-c', script], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
})
