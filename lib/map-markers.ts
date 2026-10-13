import type { Camera, Language } from './traffic';
import { vehicleIconHeadingOffset } from './vehicle-icons';

export const symbols = {
  redlight: '<rect x="8" y="2" width="8" height="20" rx="3"/><path d="M5 5h3m8 0h3M5 12h3m8 0h3M5 19h3m8 0h3"/><circle cx="12" cy="7" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="17" r="1"/>',
  speed: '<path d="M4 18a9 9 0 1 1 16 0M12 13l5-5M6 9l1 1M12 5v2M4 15h2m12 0h2"/><circle cx="12" cy="14" r="2"/>',
  snapshot: '<rect x="3" y="6" width="14" height="12" rx="2"/><path d="m17 10 4-3v10l-4-3"/>',
  flow: '<path d="M12 3l6 10h-3.5v8h-5v-8H6l6-10z"/>',
  incident: '<path d="M12 3.5 2.5 20h19L12 3.5z"/><path d="M12 10v4.5m0 2.5v.5"/>',
  parking: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M10 17V7.5h3.4a3.1 3.1 0 0 1 0 6.2H10"/>',
  rainfall: '<path d="M12 3.5s5.8 6.4 5.8 10.6a5.8 5.8 0 1 1-11.6 0C6.2 9.9 12 3.5 12 3.5z"/>',
  crossing: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  works: '<path d="m12 3 8 18H4L12 3zM7 15h10M9 10h6"/>',
  toll: '<path d="M3 21V7h18v14M3 7l3-4h12l3 4M8 12h8M8 16h8"/>',
  boundary: '<path d="M12 3 3 7v6c0 5 9 8 9 8s9-3 9-8V7l-9-4z"/>',
  'weather-warning': '<path d="M12 3 2 21h20L12 3zM12 9v5m0 3v1"/>',
  mtr: '<rect x="5" y="3" width="14" height="16" rx="4"/><path d="M5 11h14M8 19l-2 3m10-3 2 3M8 15h1m6 0h1"/>',
  lrt: '<rect x="5" y="3" width="14" height="16" rx="4"/><path d="M5 11h14M8 19l-2 3m10-3 2 3M8 15h1m6 0h1"/>',
  kmb: '<rect x="4" y="4" width="16" height="15" rx="3"/><path d="M4 11h16M7 19v3m10-3v3M7 15h1m8 0h1"/>',
  citybus: '<rect x="4" y="4" width="16" height="15" rx="3"/><path d="M4 11h16M7 19v3m10-3v3M7 15h1m8 0h1"/>',
  gmb: '<rect x="4" y="4" width="16" height="15" rx="3"/><path d="M4 11h16M7 19v3m10-3v3M7 15h1m8 0h1"/>',
  nlb: '<rect x="4" y="4" width="16" height="15" rx="3"/><path d="M4 11h16M7 19v3m10-3v3M7 15h1m8 0h1"/>',
  ferry: '<path d="M3 14h18l-4 6H7l-4-6zM7 14V8h10v6M12 3v5M2 22l4-1 4 1 4-1 4 1 4-1"/>',
};
export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
export const vehicleHtml = (src: string | null, color: string, destination: string) => `<span class="marker-leader" aria-hidden="true" hidden></span><div class="marker-displacement" style="--marker-color:${escapeHtml(color)}"><span class="vehicle-dest" aria-hidden="true">${escapeHtml(destination)}</span><div class="marker-inner"><div class="vehicle-heading" style="transform:rotate(${vehicleIconHeadingOffset}deg)"><img class="vehicle-art" src="${escapeHtml(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}${src ?? ''}`)}" alt="" draggable="false"/></div></div></div>`;
export const vehicleDestination = (camera: Pick<Camera, 'kind' | 'arrivals'>, language: Language, name: string) => {
  if (camera.kind === 'mtr' || camera.kind === 'lrt') return name;
  const arrival = camera.arrivals?.[0];
  return language === 'en' ? arrival?.destinationEn || arrival?.destination || name : arrival?.destination || name;
};
