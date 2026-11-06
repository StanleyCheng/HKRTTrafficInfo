'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, LoaderCircle } from 'lucide-react';
import { searchBuildings, type BuildingLocation } from '@/lib/building-search';
import type { Language } from '@/lib/traffic';

export default function BuildingSearch({ query, language, onSelect }: { query: string; language: Language; onSelect: (building: BuildingLocation) => void }) {
  const en = language === 'en';
  const [state, setState] = useState<{ query: string; results: BuildingLocation[]; status: 'loading' | 'ready' | 'error' }>({ query: '', results: [], status: 'ready' });
  const [retry, setRetry] = useState(0);
  const term = query.trim();
  useEffect(() => {
    if (term.length < 2) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      setState({ query: term, results: [], status: 'loading' });
      searchBuildings(term, abort.signal).then(results => {
        if (!abort.signal.aborted) setState({ query: term, results, status: 'ready' });
      }).catch(() => {
        if (!abort.signal.aborted) setState({ query: term, results: [], status: 'error' });
      });
    }, 500);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [term, retry]);
  const status = state.query === term ? state.status : 'loading';
  return <div className="building-search">
    {term.length < 2 ? <p className="search-empty">{en ? 'Enter at least 2 characters, for example Two International Finance Centre or 國際金融中心二期.' : '請輸入最少兩個字元，例如「國際金融中心二期」或 Two International Finance Centre。'}</p> : status === 'loading' ? <p className="building-search-status" role="status"><LoaderCircle size={16} className="spin"/>{en ? 'Searching buildings…' : '正在搜尋大廈…'}</p> : status === 'error' ? <div role="alert"><p className="search-empty">{en ? 'Building search is unavailable. Check your connection and try again.' : '暫時未能搜尋大廈。請檢查網絡連線後重試。'}</p><button className="text-button" type="button" onClick={() => setRetry(value => value + 1)}>{en ? 'Retry search' : '重新搜尋'}</button></div> : <>
      <p className="search-count" role="status">{state.results.length ? (en ? `${state.results.length} suggested locations` : `${state.results.length} 個建議位置`) : (en ? 'No matching buildings. Try a full building name or street address.' : '找不到相符大廈。請嘗試完整大廈名稱或街道地址。')}</p>
      <ul className="search-results">{state.results.map(building => <li key={building.id}><button type="button" className="search-result" onClick={() => onSelect(building)}><span className="result-copy"><strong>{en ? building.nameEn : building.name}</strong><span>{en ? building.name : building.nameEn}</span><span>{en ? building.addressEn : building.address}</span></span><ArrowRight size={18} aria-hidden="true"/></button></li>)}</ul>
    </>}
    <p className="subtle">{en ? 'Suggested addresses · Locations may be approximate.' : '建議地址 · 位置可能為約略位置。'} <a href="https://www.als.gov.hk/" target="_blank" rel="noreferrer">{en ? 'Government Address Lookup Service' : '政府地址搜尋服務'}</a></p>
  </div>;
}
