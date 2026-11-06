export type BuildingLocation = {
  id: string; name: string; nameEn: string; address: string; addressEn: string; lat: number; lng: number;
};

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';

function address(value: unknown, chinese: boolean): string {
  const row = record(value), prefix = chinese ? 'Chi' : 'Eng';
  const street = record(row[`${prefix}Street`]);
  const numbers = [text(street.BuildingNoFrom), text(street.BuildingNoTo)].filter(Boolean).join('–');
  const road = chinese ? `${text(street.StreetName)}${numbers ? `${numbers}號` : ''}` : [numbers, text(street.StreetName)].filter(Boolean).join(' ');
  return [text(record(row[`${prefix}Estate`]).EstateName), road, text(record(row[`${prefix}District`]).DcDistrict)].filter(Boolean).join(chinese ? ' · ' : ', ');
}

/** ALS returns bilingual structured addresses and WGS84 coordinates. Never invent a pin. */
export function parseBuildingResults(payload: unknown): BuildingLocation[] {
  const suggestions = record(payload).SuggestedAddress;
  if (!Array.isArray(suggestions)) throw new Error('Invalid address search response');
  const results = new Map<string, BuildingLocation>();
  for (const suggestion of suggestions) {
    const premises = record(record(record(suggestion).Address).PremisesAddress);
    const rawGeo = premises.GeospatialInformation;
    const geo = record(Array.isArray(rawGeo) ? rawGeo[0] : rawGeo);
    const lat = Number(geo.Latitude), lng = Number(geo.Longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 22.1 || lat > 22.6 || lng < 113.8 || lng > 114.5) continue;
    const en = record(premises.EngPremisesAddress), zh = record(premises.ChiPremisesAddress);
    const addressEn = address(en, false), addressZh = address(zh, true);
    const nameEn = text(en.BuildingName) || text(record(en.EngEstate).EstateName) || addressEn;
    const name = text(zh.BuildingName) || text(record(zh.ChiEstate).EstateName) || addressZh || nameEn;
    if (!name && !nameEn) continue;
    const id = `${text(premises.GeoAddress) || `${lat},${lng}`}:${name}:${nameEn}`;
    results.set(id, { id, name, nameEn: nameEn || name, address: addressZh || addressEn, addressEn: addressEn || addressZh, lat, lng });
  }
  return [...results.values()].slice(0, 20);
}

const cache = new Map<string, { at: number; results: BuildingLocation[] }>();
export async function searchBuildings(query: string, signal: AbortSignal): Promise<BuildingLocation[]> {
  const key = query.trim().replace(/\s+/g, ' ').toLowerCase();
  if (key.length < 2 || key.length > 200) return [];
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < 15 * 60_000) return cached.results;
  const response = await fetch(`https://www.als.gov.hk/lookup?${new URLSearchParams({ q: key, n: '20' })}`, {
    headers: { Accept: 'application/json', 'Accept-Language': 'en, zh-Hant' },
    signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
  });
  if (!response.ok) throw new Error('Address search unavailable');
  const results = parseBuildingResults(await response.json());
  signal.throwIfAborted();
  if (cache.size >= 50) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: Date.now(), results });
  return results;
}

export function buildingPopupContent(building: BuildingLocation, language: 'en' | 'zh'): HTMLElement {
  const content = document.createElement('div');
  content.className = 'building-popup-content';
  const title = document.createElement('strong');
  title.textContent = language === 'en' ? building.nameEn : building.name;
  const subtitle = document.createElement('p');
  subtitle.textContent = language === 'en' ? building.addressEn : building.address;
  const source = document.createElement('a');
  source.href = 'https://www.als.gov.hk/';
  source.target = '_blank'; source.rel = 'noreferrer';
  source.textContent = language === 'en' ? 'Address Lookup Service · Approximate location' : '地址搜尋服務 · 約略位置';
  content.appendChild(title); content.appendChild(subtitle); content.appendChild(source);
  return content;
}
