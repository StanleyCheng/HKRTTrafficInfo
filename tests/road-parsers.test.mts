import test from 'node:test'
import assert from 'node:assert/strict'
import { worksFromWfs, tollsFromWfs, withTraditionalText } from '../lib/picture.ts'
import { parseWarnsum } from '../lib/warnings.ts'
import { controlPointFeatures, isQueueFile, decorateControlPoints, type QueueFile } from '../lib/control-points.ts'
import { readApproachPoints } from '../lib/approaches.ts'
import { bestCrossings } from '../lib/crossings.ts'
import { parseSlpDetectors } from '../lib/slp.ts'

const point = (properties: Record<string, unknown>) => ({ type: 'Feature', properties, geometry: { type: 'Point', coordinates: [114.1, 22.3] } })
test('road works joins traditional text, rejects invalid coordinates; toll points deduplicate', () => {
  const en = worksFromWfs({ features: [point({ ROADWORKS_ID: '1', ROAD_NAME: 'Test Road', WORKS_STATUS: 'In progress' }), { ...point({ ROADWORKS_ID: 'bad' }), geometry: null }] })
  const tc = worksFromWfs({ features: [point({ ROADWORKS_ID: '1', ROAD_NAME: '測試路' })] })
  assert.equal(withTraditionalText(en, tc, ['road']).features[0].properties?.roadTc, '測試路')
  assert.equal(en.features.length, 1)
  const row = point({ TunnelCode: 'CHT', FeatureID: 1, Scale: '300+' })
  const tolls = tollsFromWfs({ features: [row, row] })
  assert.equal(tolls.features.length, 1)
  assert.equal(tolls.features[0].properties?.band, 'overview')
})
test('boundary retains all eight control points and decorates approach speeds', () => {
  const queue = Object.fromEntries(['HYW','HZM','LMC','LSC','LWS','MKT','SBC','STK'].map((code) => [code, { arrQueue: 0, depQueue: 2 }])) as QueueFile
  assert.equal(isQueueFile(queue), true)
  assert.equal(isQueueFile({}), false)
  const features = controlPointFeatures(queue, queue)
  assert.equal(features.length, 8)
  assert.equal(features[0].properties?.worst, 2)
  const decorated = decorateControlPoints({ type: 'FeatureCollection', features }, [{ roadEn: 'HEUNG YUEN WAI HIGHWAY', roadTc: '', speedKmh: 10, band: 'congested' }])
  assert.equal(decorated.features[0].properties?.vehicleKmh, 10)
})
test('warnings cancel and severity ordering; empty warning object is valid', () => {
  const warnings = parseWarnsum({ WHOT: { code: 'WHOT' }, WRAIN: { code: 'WRAINB', type: '黑色' }, WCOLD: { code: 'WCOLD', actionCode: 'CANCEL' } }, 'tc')
  assert.equal(warnings.length, 2)
  assert.equal(warnings[0].urgent, true)
  assert.equal(warnings[0].shortName, '黑雨')
  assert.deepEqual(parseWarnsum({}), [])
  assert.throws(() => parseWarnsum(null))
})
test('approaches retain valid minutes and upstream colours; best crossing picks shortest', () => {
  const wfs = { features: [point({ LOCATION_ID: 'H1', LOCATION: 'Test Road' })] }
  const { points, capturedAt } = readApproachPoints(wfs, { H1: [{ dest: { did: 'CH', time: 9, cid: 1, date: '2026-10-03T12:30:00' } }, { dest: { did: 'EH', time: -1 } }] })
  assert.equal(capturedAt, '2026-10-03T12:30:00+08:00')
  assert.equal(points[0].legs.length, 1)
  assert.equal(bestCrossings(points)[0].colour, 'red')
})

test('SLP joins locations to valid lanes, rejecting invalid lanes and stale observations', () => {
  const oldNow = Date.now
  Date.now = () => Date.parse('2026-10-03T12:00:00+08:00')
  const csv = 'AID_ID_Number,Latitude,Longitude,Road_TC,Road_EN\nSLP1,22.3,114.1,測試路 [SLP1],Test Road [SLP1]\nSLP2,0,0,外地,Outside'
  const xml = '<raw_speed_volume_list><date>2026-10-03</date><periods><period><period_to>12:00:00</period_to><detectors><detector><detector_id>SLP1</detector_id><lanes><lane><valid>Y</valid><speed>20</speed></lane><lane><valid>Y</valid><speed>40</speed></lane><lane><valid>N</valid><speed>999</speed></lane></lanes></detector></detectors></period></periods></raw_speed_volume_list>'
  try {
    const cameras = parseSlpDetectors(csv, xml)
    assert.equal(cameras.length, 1)
    assert.equal(cameras[0].speedKmh, 30)
    assert.equal(cameras[0].nameEn, 'Test Road')
    assert.equal(cameras[0].dataUpdated, '2026-10-03T12:00:00+08:00')
    Date.now = () => Date.parse('2026-10-03T13:00:00+08:00')
    const stale = parseSlpDetectors(csv, xml)[0]
    assert.equal(stale.speedKmh, null)
    assert.equal(stale.level, 'unknown')
  } finally { Date.now = oldNow }
})

test('mixed-age journey boards retain their own clocks instead of inheriting newest feed time', () => {
  const wfs = { features: ['H1', 'H2', 'H3'].map(id => point({ LOCATION_ID: id, LOCATION: id })) }
  const detail = (date: string, minutes: number) => [{ dest: { did: 'CH', time: minutes, cid: 3, date } }]
  const result = readApproachPoints(wfs, {
    H1: detail('2026-09-29T15:21:00', 7),
    H2: detail('2026-10-04T10:30:00', 11),
    H3: detail('unavailable', 5),
  })
  assert.equal(result.capturedAt, '2026-10-04T10:30:00+08:00')
  assert.equal(result.points.find(p => p.id === 'H1')?.observedAt, '2026-09-29T15:21:00+08:00')
  assert.equal(result.points.find(p => p.id === 'H2')?.observedAt, result.capturedAt)
  assert.equal(result.points.find(p => p.id === 'H3')?.observedAt, undefined)
})
