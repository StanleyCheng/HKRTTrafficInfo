import { busCompany } from './bus-company.ts';
import { SUN_ROUTES } from './ferry-routes.ts';
import type { Camera } from './traffic.ts';

export const vehicleIconHeadingOffset = 180;
export const railVehicleIcons: Record<string, string> = {
  AEL: 'rail-airport', DRL: 'rail-disney', EAL: 'rail-east', ISL: 'rail-urban',
  KTL: 'rail-urban', SIL: 'rail-south', TCL: 'rail-tung-chung', TKL: 'rail-urban',
  TML: 'rail-tuen-ma', TWL: 'rail-urban',
};
export const vehicleIconAssets = [...new Set(Object.values(railVehicleIcons)), 'rail-light',
  'bus-kmb', 'bus-lwb', 'bus-citybus', 'bus-gmb', 'bus-nlb',
  'ferry-star', 'ferry-sun', 'ferry-hkkf', 'ferry-fortune'];

export function ferryVehicleIcon(route: string, sourceId = ''): string | undefined {
  if (route === '天星' || sourceId.startsWith('run-天星-')) return 'ferry-star';
  if (route === '富裕' || sourceId.startsWith('run-富裕-')) return 'ferry-fortune';
  if (SUN_ROUTES.some(item => item.code === route || sourceId.startsWith(`${item.code}-`) || sourceId.startsWith(`run-${item.code}-`))) return 'ferry-sun';
  if (/^[1-4]$/.test(route) || /^run-[1-4]-hkkf-/.test(sourceId)) return 'ferry-hkkf';
}

export function vehicleIcon(camera: Pick<Camera, 'kind'> & Partial<Pick<Camera, 'positionType' | 'arrivals' | 'sourceId' | 'vehicleIcon'>> & { route?: string; company?: string }): string | null {
  if (camera.positionType && camera.positionType !== 'vehicle') return null;
  const arrival = camera.arrivals?.[0];
  const route = camera.route ?? arrival?.route ?? '';
  const asset = camera.vehicleIcon
    ?? (camera.kind === 'mtr' ? railVehicleIcons[route]
      : camera.kind === 'lrt' ? 'rail-light'
        : camera.kind === 'kmb' ? `bus-${busCompany(route, camera.company ?? arrival?.tracking?.company ?? '').toLowerCase()}`
          : ['citybus', 'gmb', 'nlb'].includes(camera.kind) ? `bus-${camera.kind}`
            : camera.kind === 'ferry' ? ferryVehicleIcon(route, camera.sourceId) : undefined);
  return asset && vehicleIconAssets.includes(asset) ? `/vehicles/${asset}.webp` : null;
}
