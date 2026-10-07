import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import sharp from 'sharp';
import { ferryVehicleIcon, railVehicleIcons, vehicleIcon, vehicleIconAssets, vehicleIconHeadingOffset } from '../lib/vehicle-icons.ts';
import { SUN_ROUTES } from '../lib/ferry-routes.ts';

assert.equal(vehicleIconHeadingOffset, 180);
assert.deepEqual(Object.keys(railVehicleIcons).sort(), ['AEL', 'DRL', 'EAL', 'ISL', 'KTL', 'SIL', 'TCL', 'TKL', 'TML', 'TWL']);
for (const [route, asset] of Object.entries(railVehicleIcons)) assert.equal(vehicleIcon({ kind: 'mtr', route }), `/vehicles/${asset}.webp`);
assert.equal(vehicleIcon({ kind: 'lrt', route: '610' }), '/vehicles/rail-light.webp');
assert.equal(vehicleIcon({ kind: 'kmb', route: '1A' }), '/vehicles/bus-kmb.webp');
assert.equal(vehicleIcon({ kind: 'kmb', route: 'A31' }), '/vehicles/bus-lwb.webp');
assert.equal(vehicleIcon({ kind: 'kmb', route: 'X1', company: 'LWB' }), '/vehicles/bus-lwb.webp');
for (const kind of ['citybus', 'gmb', 'nlb'] as const) assert.equal(vehicleIcon({ kind }), `/vehicles/bus-${kind}.webp`);
assert.equal(ferryVehicleIcon('天星'), 'ferry-star');
assert.equal(ferryVehicleIcon('富裕'), 'ferry-fortune');
assert.equal(ferryVehicleIcon('', 'run-天星-star-central'), 'ferry-star');
assert.equal(ferryVehicleIcon('', 'run-富裕-sun-north-point'), 'ferry-fortune');
for (const route of SUN_ROUTES) {
  assert.equal(ferryVehicleIcon(route.code), 'ferry-sun');
  assert.equal(ferryVehicleIcon('', `${route.code}-boat`), 'ferry-sun');
  assert.equal(ferryVehicleIcon('', `run-${route.code}-${route.from}`), 'ferry-sun');
}
for (const route of ['1', '2', '3', '4']) {
  assert.equal(ferryVehicleIcon(route), 'ferry-hkkf');
  assert.equal(ferryVehicleIcon('', `run-${route}-hkkf-central`), 'ferry-hkkf');
}
assert.equal(ferryVehicleIcon('unknown'), undefined);
assert.equal(vehicleIcon({ kind: 'mtr', route: 'invalid' }), null);
assert.equal(vehicleIcon({ kind: 'kmb', positionType: 'station' }), null);
assert.equal(vehicleIcon({ kind: 'ferry', route: '1', vehicleIcon: 'ferry-fortune' }), '/vehicles/ferry-fortune.webp');
assert.equal(vehicleIcon({ kind: 'ferry', vehicleIcon: '../../bad' }), null);
const manifest = JSON.parse(readFileSync(new URL('../public/vehicles/prompts.json', import.meta.url), 'utf8')) as {
  assets: { asset: string; src: string; sources: string[] }[];
};
assert.deepEqual(new Set(manifest.assets.map(item => item.asset)), new Set(vehicleIconAssets));
assert.ok(!JSON.stringify(manifest).includes('C:/Users/'));
for (const item of manifest.assets) {
  assert.equal(item.src, `/vehicles/${item.asset}.webp`);
  assert.ok(item.sources.length > 0, `${item.asset} has no fleet reference`);
}
for (const asset of vehicleIconAssets) {
  const file = new URL(`../public/vehicles/${asset}.webp`, import.meta.url);
  assert.ok(existsSync(file), `missing ${asset}`);
  const buffer = readFileSync(file);
  assert.equal(buffer.toString('ascii', 0, 4), 'RIFF');
  assert.equal(buffer.toString('ascii', 8, 12), 'WEBP');
  assert.ok(buffer.length < 30_000, `${asset} exceeds map icon size budget`);
  const metadata = await sharp(buffer).metadata();
  assert.equal(metadata.width, 192);
  assert.equal(metadata.height, 192);
  assert.equal(metadata.hasAlpha, true);
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (const pixel of [0, info.width - 1, (info.height - 1) * info.width, info.width * info.height - 1]) {
    assert.equal(data[pixel * 4 + 3], 0, `${asset} has an opaque corner`);
  }
}
