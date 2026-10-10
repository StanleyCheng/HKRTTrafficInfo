'use client';

import type { ReactNode } from 'react';
import { ArrowUpRight, LoaderCircle } from 'lucide-react';
import { formatRecordDate, integrationMessages, messages } from '@/lib/i18n';
import { hkTime, layerText, layers, speedLevelColors, type Camera, type Language } from '@/lib/traffic';
import type { BusRouteSelection } from '@/lib/bus-route';
import SnapshotImage from './snapshot-image';

export default function ItemDetails({ camera, language, now, stale, onActivity, activeBusSelection, onShowRoute, routeStatus, status = 'ready', onRetry }: {
  camera: Camera;
  language: Language;
  now: number;
  stale: boolean;
  onActivity: () => () => void;
  activeBusSelection?: BusRouteSelection | null;
  onShowRoute: (tracking: BusRouteSelection) => void;
  routeStatus?: ReactNode;
  status?: 'loading' | 'error' | 'ready';
  onRetry?: () => void;
}) {
  const copy = messages[language];
  const extra = integrationMessages[language];
  const numberLocale = language === 'en' ? 'en-HK' : 'zh-HK';
  const name = language === 'en' ? camera.nameEn || camera.name : camera.name;
  const district = language === 'en' ? camera.districtEn || camera.district : camera.district;
  const region = language === 'en' ? camera.regionEn || camera.region : camera.region;

  return <div className="detail item-detail">
    <h2 className="item-detail-title" id="item-detail-title">{name}</h2>
    <div className="detail-kind"><span className="color-dot" style={{ background: camera.color ?? layers[camera.kind].color }}/>{layerText(camera.kind, language).name}<span>／ {camera.sourceId}</span></div>
    {camera.kind === 'snapshot' && <SnapshotImage camera={camera} language={language} onActivity={onActivity} key={camera.id}/>}
    {camera.kind === 'flow' && <div className="live-figure">
      <strong style={{ color: speedLevelColors[camera.level ?? 'unknown'] }}>{camera.speedKmh === null || camera.speedKmh === undefined ? '—' : camera.speedKmh}<small>km/h</small></strong>
      <span className="level-badge" style={{ background: speedLevelColors[camera.level ?? 'unknown'] }}>{copy.speedLevels[camera.level ?? 'unknown']}</span>
      <span className="live-label">{copy.speedNow}</span>
    </div>}
    {camera.kind === 'parking' && <div className="live-figure">
      <strong>{camera.vacancy === null || camera.vacancy === undefined ? '—' : camera.vacancy.toLocaleString(numberLocale)}</strong>
      <span className="live-label">{camera.vacancy === null || camera.vacancy === undefined ? copy.parkingNoLive : copy.parkingSpaces}</span>
    </div>}
    {camera.kind === 'parking' && camera.remarks && <p className="detail-address">{camera.remarks}</p>}
    {camera.kind === 'rainfall' && camera.rainfallMm !== undefined && <div className="live-figure">
      <strong>{camera.rainfallMm}</strong>
      <span className="live-label">{copy.millimetres(String(camera.rainfallMm))} · {copy.rainfallAmount}</span>
    </div>}
    {camera.kind === 'incident' && <p className="incident-text">{(language === 'en' ? camera.textEn || camera.text : camera.text || camera.textEn)?.trim()}</p>}
    {camera.kind === 'ferry' && camera.positionType === 'vehicle'
      ? camera.positionSource !== 'gps' && <p className="detail-note">{extra.estimated}</p>
      : camera.estimated && <p className="detail-note">{extra.estimated}</p>}
    {routeStatus}
    {camera.positionType === 'vehicle' && camera.kind === 'ferry' && camera.positionSource === 'gps' && <p className="detail-note">{extra.gps}</p>}
    {stale && <p className="warning-text">{extra.stale}</p>}
    {status !== 'ready' && <p className="item-detail-status" role={status === 'error' ? 'alert' : 'status'}>
      {status === 'loading' ? <><LoaderCircle size={13} className="spin"/>{copy.loadingOfficialData}</> : <>{extra.busRouteError}{onRetry && <> <button type="button" className="text-button" onClick={onRetry}>{copy.retry}</button></>}</>}
    </p>}
    {status === 'ready' && camera.arrivals && <section className="arrival-board"><h5>{extra.arrivals}</h5>{camera.arrivals.length ? <ul>{camera.arrivals.map((call, index) => {
      const eta = call.eta ? Date.parse(call.eta) : NaN;
      const minutes = Number.isFinite(eta) ? Math.max(0, Math.ceil((eta - now) / 60000)) : call.minutes;
      return <li key={`${call.route}-${index}`}><span className="arrival-route-choice"><strong className="arrival-route">{call.route}</strong>{call.tracking && <button type="button" className="bus-route-button" aria-pressed={Boolean(activeBusSelection && JSON.stringify(activeBusSelection) === JSON.stringify(call.tracking))} aria-label={`${extra.showBusRoute} ${call.route} · ${language === 'en' ? call.destinationEn || call.destination : call.destination}`} onClick={() => onShowRoute(call.tracking!)}>{extra.showBusRoute}</button>}</span><span className="arrival-destination">{language === 'en' ? call.destinationEn || call.destination : call.destination}{call.platform && <small>{extra.platform} {call.platform}</small>}<small>{call.timeType ? call.timeType === 'D' ? extra.departure : extra.arrival : call.scheduled ? extra.scheduled : extra.live}{(language === 'en' ? call.remarkEn : call.remark) ? ` · ${language === 'en' ? call.remarkEn : call.remark}` : ''}</small></span><strong className="arrival-minutes">{minutes ?? '—'}<small>{extra.minutes}</small></strong></li>;
    })}</ul> : <p>{extra.noArrivals}</p>}</section>}
    <dl>
      {camera.rows?.map((row, index) => <div className="detail-row" key={`${row.labelEn}-${index}`}><dt>{language === 'en' ? row.labelEn : row.label}</dt><dd>{language === 'en' ? row.valueEn || row.value : row.value}</dd></div>)}
      {district && <><dt>{copy.district}</dt><dd>{region ? `${region} · ` : ''}{district}</dd></>}
      {camera.kind === 'flow' && camera.remarks && <><dt>{camera.id.startsWith('flow-segment-') ? copy.routeNumberLabel : copy.directionLabel}</dt><dd>{camera.remarks}</dd></>}
      {camera.kind === 'flow' && camera.speedLimitKmh !== undefined && <><dt>{copy.speedLimitLabel}</dt><dd>{camera.speedLimitKmh} km/h</dd></>}
      {camera.kind === 'parking' && camera.heightLimit !== undefined && <><dt>{copy.heightLimitLabel}</dt><dd>{copy.metres(String(camera.heightLimit))}</dd></>}
      {camera.kind === 'parking' && camera.openingStatus && <><dt>{copy.openingStatusLabel}</dt><dd>{camera.openingStatus}</dd></>}
      <dt>{copy.coordinates}</dt><dd>{camera.lat.toFixed(6)}, {camera.lng.toFixed(6)}</dd>
      {camera.sourceUpdated && <><dt>{copy.recordUpdated}</dt><dd>{formatRecordDate(camera.sourceUpdated, language)}</dd></>}
      {camera.kind !== 'flow' && camera.kind !== 'parking' && camera.remarks && <><dt>{copy.officialRemarks}</dt><dd>{camera.remarks}</dd></>}
      {camera.dataUpdated && <><dt>{copy.liveDataTime}</dt><dd>{hkTime(camera.dataUpdated, true, language)}</dd></>}
    </dl>
    {(camera.kind === 'redlight' || camera.kind === 'speed') && <p className="detail-note">{copy.layerDetail[camera.kind]}</p>}
    {camera.kind === 'flow' && <p className="detail-note">{copy.speedLayerNote}</p>}
    {camera.kind === 'rainfall' && <p className="detail-note">{copy.rainfallNote}</p>}
    {camera.kind === 'incident' && <p className="detail-note">{copy.incidentApproxNote}</p>}
    <a className="detail-source" href={layers[camera.kind].source} target="_blank" rel="noreferrer">{copy.officialSource} <ArrowUpRight size={13}/></a>
  </div>;
}
