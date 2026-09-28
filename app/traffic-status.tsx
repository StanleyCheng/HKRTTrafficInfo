'use client';

import { useRef, useState } from 'react';
import { Clock3, Info, RefreshCw, TriangleAlert } from 'lucide-react';
import { messages } from '@/lib/i18n';
import { hkTime, isLiveTrafficDataFresh } from '@/lib/traffic';
import type { Language, SpeedLevel } from '@/lib/traffic';

const levels: SpeedLevel[] = ['free', 'moderate', 'slow', 'unknown'];

export default function TrafficStatus({ language, flowEnabled, updated, fetched, now, loading, error, mapped, expected, onRefresh }: {
  language: Language;
  flowEnabled: boolean;
  updated?: string;
  fetched?: string;
  now: number;
  loading: boolean;
  error: boolean;
  mapped: number;
  expected?: number;
  onRefresh: () => void;
}) {
  const copy = messages[language];
  const [expanded, setExpanded] = useState(false);
  const toggleButton = useRef<HTMLButtonElement>(null);
  const stale = flowEnabled && Boolean(updated) && !isLiveTrafficDataFresh(updated, now);
  const warning = error ? copy.partialUpdateFailure : stale ? copy.liveSpeedsStale : '';
  const minutes = updated ? Math.max(0, Math.floor((now - Date.parse(updated)) / 60000)) : 0;
  const status = flowEnabled
    ? updated ? stale ? copy.liveSpeedsStale : copy.updatedMinutes(minutes) : loading ? copy.loadingLiveSpeeds : copy.noOfficialUpdateTime
    : fetched ? copy.inventoryFetched(hkTime(fetched, false, language)) : loading ? copy.loadingOfficialData : copy.noData;
  return <div className={`traffic-status ${warning ? 'has-warning' : ''} ${expanded ? 'is-expanded' : ''}`} onKeyDown={event => {
    if (event.key !== 'Escape' || !expanded) return;
    event.preventDefault();
    setExpanded(false);
    toggleButton.current?.focus();
  }}>
    <button ref={toggleButton} type="button" className="traffic-info-toggle" aria-label={expanded ? copy.hideTrafficInfo : copy.showTrafficInfo} title={expanded ? copy.hideTrafficInfo : copy.showTrafficInfo} aria-expanded={expanded} aria-controls="traffic-status-details" aria-describedby={warning ? 'traffic-info-warning' : undefined} onClick={() => setExpanded(value => !value)}>
      <span className="traffic-info-symbol"><Info size={22} aria-hidden="true"/>{warning && <span className="traffic-info-badge" aria-hidden="true"/>}</span>
      {warning && <span id="traffic-info-warning" className="sr-only">{warning}</span>}
    </button>
    <div id="traffic-status-details" className="traffic-status-details">
    <div className="traffic-status-head">
      <div className="traffic-freshness" role="status"><Clock3 size={14}/><span>{status}</span>{loading && (updated || fetched) && <span className="updating-label">{copy.updating}</span>}</div>
      <button type="button" className="status-refresh" aria-label={copy.refreshAll} title={copy.refreshAll} disabled={loading} onClick={onRefresh}><RefreshCw size={16} className={loading ? 'spin' : ''}/></button>
    </div>
    {error && <p className="traffic-warning" role="status"><TriangleAlert size={13}/>{copy.partialUpdateFailure}</p>}
    {flowEnabled && <>
      <ul className="flow-legend" aria-label={copy.speedLegend}>{levels.map(level => <li key={level}><span className={`legend-swatch ${level}`} aria-hidden="true"/><span>{copy.speedLevels[level]}</span></li>)}</ul>
      {expected !== undefined && <span className="status-coverage">{copy.mappedSegments(mapped.toLocaleString(language === 'en' ? 'en-HK' : 'zh-HK'), expected.toLocaleString(language === 'en' ? 'en-HK' : 'zh-HK'))}</span>}
      <details className="legend-explanation"><summary>{copy.speedLegendHelp}</summary><p>{copy.speedLayerNote}</p></details>
    </>}
    </div>
  </div>;
}
