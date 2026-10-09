'use client';
import { useMemo, useRef, useState, type CSSProperties } from 'react';
import { ChevronUp, X } from 'lucide-react';
import { integrationMessages } from '@/lib/i18n';
import { INTEL_TABS, intelBoard, currentCrossingPoints, type IntelInput, type IntelItem, type IntelTab } from '@/lib/intel';
import type { Language } from '@/lib/traffic';
import type { TrafficSearchItem } from '@/lib/traffic-view';
import './intel-panel.css';

export default function IntelPanel({ input, language, onSelect }: { input: IntelInput; language: Language; onSelect: (item: TrafficSearchItem) => void }) {
  const m = integrationMessages[language];
  const board = useMemo(() => intelBoard(input, language), [input, language]);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<IntelTab>('ranked');
  const trigger = useRef<HTMLButtonElement>(null);
  const marquee = board.ranked.length ? board.ranked : [{ id: 'empty', title: m.empty, tone: 'none' }];
  function close() { setOpen(false); requestAnimationFrame(() => trigger.current?.focus()); }
  function select(item: IntelItem) { if (item.camera) { setOpen(false); onSelect({ camera: item.camera, segment: item.segment }); } }
  const points = currentCrossingPoints(input.states.crossing?.data, input.now);
  return <section className={`intel-shell ${open ? 'expanded' : ''}`} aria-label={m.intel} onKeyDown={event => { if (event.key === 'Escape' && open) { event.preventDefault(); close(); } }}>
    <button ref={trigger} type="button" className="intel-trigger" aria-label={m.expand} aria-expanded={open} aria-controls="intel-panel" onClick={() => { setOpen(value => !value); if (!open) requestAnimationFrame(() => document.getElementById(`intel-tab-${tab}`)?.focus()); }}>
      <strong>{m.intel}</strong><span className="intel-marquee-window"><span className="intel-marquee" style={{ '--intel-duration': `${Math.max(28, marquee.length * 9)}s` } as CSSProperties}>{[0, 1].map(copy => <span key={copy} className={`intel-marquee-copy ${copy ? 'duplicate' : ''}`} aria-hidden={copy ? true : undefined}>{marquee.map(item => <span className={`intel-ticker-item ${item.tone}`} key={item.id}><i/>{item.title}</span>)}</span>)}</span></span><ChevronUp size={16}/>
    </button>
    {open && <div id="intel-panel" className="intel-panel">
      <header><h2>{m.intel}</h2><button type="button" aria-label={m.close} onClick={close}><X size={18}/></button></header>
      <div className="intel-glances"><button type="button" onClick={() => setTab('boundary')}><span>{m.tabs.boundary}</span><strong>{input.states.boundary?.error ? m.fault : input.states.boundary?.data ? m.busyPoints(board.boundary.filter(item => item.urgent || item.tone === 'amber').length) : m.notLoaded}</strong></button><button type="button" onClick={() => setTab('weather')}><span>{m.tabs.weather}</span><strong>{input.states['weather-warning']?.error ? m.fault : input.states['weather-warning']?.data ? m.activeWarnings(input.states['weather-warning'].data.count) : m.notLoaded}</strong></button></div>
      {!!points.length && <div className="crossing-pills">{(['CH', 'EH', 'WH'] as const).map(code => {
        const best = points.flatMap(point => point.legs.filter(leg => leg.code === code && leg.minutes !== null).map(leg => ({ ...leg, point }))).sort((a, b) => a.minutes! - b.minutes!)[0];
        const camera = input.states.crossing?.data?.cameras.find(camera => camera.sourceId === best?.point.id);
        return <button key={code} type="button" className={best?.colour || 'none'} disabled={!camera} onClick={() => { if (camera) { setOpen(false); onSelect({ camera }); } }}><span>{m.crossingNames[code]}</span><strong>{best?.minutes ?? '—'} <small>{m.minutes}</small></strong></button>;
      })}</div>}
      <div className="intel-tabs" role="tablist" aria-label={m.intel}>{INTEL_TABS.map(name => <button type="button" key={name} id={`intel-tab-${name}`} role="tab" aria-selected={tab === name} aria-controls={`intel-content-${name}`} tabIndex={tab === name ? 0 : -1} onClick={() => setTab(name)} onKeyDown={event => {
        const i = INTEL_TABS.indexOf(name), next = event.key === 'ArrowRight' ? (i + 1) % INTEL_TABS.length : event.key === 'ArrowLeft' ? (i + INTEL_TABS.length - 1) % INTEL_TABS.length : event.key === 'Home' ? 0 : event.key === 'End' ? INTEL_TABS.length - 1 : null;
        if (next === null) return; event.preventDefault(); setTab(INTEL_TABS[next]); document.getElementById(`intel-tab-${INTEL_TABS[next]}`)?.focus();
      }}>{m.tabs[name]}{board[name].some(item => item.urgent) && <i className="urgent-dot" aria-hidden="true"/>}</button>)}</div>
      {INTEL_TABS.map(name => <div key={name} id={`intel-content-${name}`} role="tabpanel" aria-labelledby={`intel-tab-${name}`} hidden={tab !== name} tabIndex={0} className="intel-content">
        {!board[name].length && <p className="intel-empty">{m.empty}</p>}
        <ol>{board[name].map(item => <li key={item.id} className={`intel-row ${item.tone}`}>{item.camera ? <button type="button" onClick={() => select(item)}><strong>{item.title}</strong>{item.detail && <span>{item.detail}</span>}</button> : <div><strong>{item.title}</strong>{item.detail && <span>{item.detail}</span>}</div>}</li>)}</ol>
      </div>)}
    </div>}
  </section>;
}
