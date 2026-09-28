'use client';

import { useMemo, useState } from 'react';
import { ArrowRight, Search, X } from 'lucide-react';
import { messages } from '@/lib/i18n';
import { hkTime, layerText } from '@/lib/traffic';
import type { Camera, Language } from '@/lib/traffic';
import { searchTrafficItems } from '@/lib/traffic-view';
import type { TrafficSearchItem } from '@/lib/traffic-view';

const pageSize = 20;

export default function TrafficSearch({ items, language, selected, loading, onSelect }: {
  items: TrafficSearchItem[];
  language: Language;
  selected: Camera | null;
  loading: boolean;
  onSelect: (item: TrafficSearchItem) => void;
}) {
  const copy = messages[language];
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'roads' | 'locations'>('roads');
  const [page, setPage] = useState(0);
  const results = useMemo(() => searchTrafficItems(items.filter(item => scope === 'roads' ? Boolean(item.segment) : !item.segment), query, language), [items, query, language, scope]);
  const lastPage = Math.max(0, Math.ceil(results.length / pageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  const start = currentPage * pageSize;
  const visible = results.slice(start, start + pageSize);

  return <div className="traffic-search">
    <h3>{copy.searchTitle}</h3>
    <p className="search-help">{copy.searchHelp}</p>
    <div className="search-scope" role="group" aria-label={copy.searchScope}>
      <button type="button" aria-pressed={scope === 'roads'} onClick={() => { setScope('roads'); setPage(0); }}>{copy.searchRoads}</button>
      <button type="button" aria-pressed={scope === 'locations'} onClick={() => { setScope('locations'); setPage(0); }}>{copy.searchLocations}</button>
    </div>
    <label htmlFor="traffic-search-input">{scope === 'roads' ? copy.searchRoadLabel : copy.searchLocationLabel}</label>
    <div className="search-input-wrap">
      <Search size={18} aria-hidden="true"/>
      <input id="traffic-search-input" type="search" value={query} autoComplete="off" onChange={event => { setQuery(event.target.value); setPage(0); }}/>
      {query && <button type="button" aria-label={copy.clearSearch} onClick={() => { setQuery(''); setPage(0); document.getElementById('traffic-search-input')?.focus(); }}><X size={16}/></button>}
    </div>
    <p className="search-count" role="status">{loading && !results.length ? copy.loadingOfficialData : copy.searchResults(results.length.toLocaleString(language === 'en' ? 'en-HK' : 'zh-HK'))}</p>
    {selected && <button type="button" className="selected-search-item" onClick={() => onSelect(items.find(item => item.camera.id === selected.id) ?? { camera: selected })}>
      <span>{copy.selectedLocation}<strong>{language === 'en' ? selected.nameEn || selected.name : selected.name}</strong></span><ArrowRight size={16}/>
    </button>}
    {!visible.length && !loading && <p className="search-empty">{query ? copy.searchNoResults : copy.searchNoData}</p>}
    <ul className="search-results">
      {visible.map(item => {
        const { camera, segment } = item;
        const name = language === 'en' ? camera.nameEn || camera.name : camera.name;
        const district = language === 'en' ? camera.districtEn || camera.district : camera.district;
        const resultLabel = segment
          ? `${name}, ${copy.segmentLabel} ${camera.sourceId}, ${camera.speedKmh == null ? copy.speedLevels.unknown : `${camera.speedKmh} km/h, ${copy.speedLevels[camera.level ?? 'unknown']}`}`
          : `${name}, ${layerText(camera.kind, language).short}${district ? `, ${district}` : ''}`;
        return <li key={camera.id}>
          <button type="button" className={selected?.id === camera.id ? 'search-result selected' : 'search-result'} aria-label={copy.inspectLocation(resultLabel)} onClick={() => onSelect(item)}>
            <span className="result-copy"><strong>{name}</strong><span>{segment ? `${copy.segmentLabel} ${camera.sourceId}${segment.routeNum != null ? ` · ${copy.routeNumberLabel} ${segment.routeNum}` : ''}` : `${layerText(camera.kind, language).short}${district ? ` · ${district}` : ''}`}</span>{camera.dataUpdated && <time dateTime={camera.dataUpdated}>{copy.liveDataTime} {hkTime(camera.dataUpdated, false, language)}</time>}</span>
            <span className="result-reading">{segment ? <><strong>{camera.speedKmh ?? '—'}<small> km/h</small></strong><span>{copy.speedLevels[camera.level ?? 'unknown']}</span></> : <ArrowRight size={18}/>}</span>
          </button>
        </li>;
      })}
    </ul>
    {results.length > pageSize && <nav className="search-pagination" aria-label={copy.searchPagination}>
      <button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{copy.previousPage}</button>
      <span>{copy.searchRange(start + 1, Math.min(start + pageSize, results.length), results.length)}</span>
      <button type="button" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>{copy.nextPage}</button>
    </nav>}
  </div>;
}
