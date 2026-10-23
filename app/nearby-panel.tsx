'use client'

import { useState } from 'react'
import { useSessionField } from './use-session-field'
import { LoaderCircle, MapPin, RefreshCw } from 'lucide-react'
import { nearbyGroups, nearbyPlaces, nextArrivalText } from '@/lib/nearby'
import { isCameraDataStale, hostedUrl, layerAvailable, layerText, type Camera, type CameraData, type Language, type LayerKind } from '@/lib/traffic'
import { viewportNote, type MapViewport } from '@/lib/integration-client'
import { integrationMessages } from '@/lib/i18n'

const text = {
  en: { title: 'Nearby', centre: 'Around map centre', distance: 'Straight-line distance; walking routes may be longer.', radius: 'Search radius', groups: { rail: 'Rail', bus: 'Buses', tram: 'Trams', ferry: 'Ferries', access: 'Accessible access', taxi: 'Taxi stands' }, none: 'No published locations in this radius.', zoom: 'Zoom in to load nearby bus departures.', published: 'Published information', noDepartures: 'No current departures', scheduled: 'Scheduled', minutes: 'min', loading: 'Updating nearby information', failed: 'Some sources could not update. Expired departures are hidden.', refresh: 'Refresh nearby information', partial: 'The local path sample is capped; not every connection is shown.', more: 'Show more', less: 'Show fewer', access: 'Published facilities and paths have no live operating status. Teal: wheelchair access without a recorded barrier. Amber: barrier or no wheelchair access. Grey: unclassified.', unavailable: 'Some transport modes require the full hosted version.' },
  zh: { title: '附近', centre: '以地圖中心搜尋', distance: '直線距離；實際步行路線可能較長。', radius: '搜尋範圍', groups: { rail: '鐵路', bus: '巴士', tram: '電車', ferry: '渡輪', access: '無障礙設施', taxi: '的士站' }, none: '此範圍內暫無已公布位置。', zoom: '放大地圖以載入附近巴士開出時間。', published: '已公布資料', noDepartures: '暫無有效開出時間', scheduled: '時間表', minutes: '分鐘', loading: '正在更新附近資料', failed: '部分來源未能更新。已隱藏過期開出時間。', refresh: '更新附近資料', partial: '附近行人路網資料設有數量上限，未能顯示所有連接。', more: '顯示更多', less: '顯示較少', access: '設施及路段並非實時運作狀態。青色：已公布輪椅可通行且無記錄障礙。琥珀色：有障礙或輪椅未能通行。灰色：未分類。', unavailable: '部分交通工具需使用完整託管版本。' },
}
type FeedState = { data?: CameraData; loading: boolean; error: boolean }
export default function NearbyPanel({ states, view, language, now, onSelect, onRefresh }: {
  states: Record<LayerKind, FeedState>; view: MapViewport; language: Language; now: number;
  onSelect: (camera: Camera) => void; onRefresh: () => void;
}) {
  const copy = text[language], extra = integrationMessages[language]
  const [radius, setRadius] = useSessionField('nearbyRadius')
  const [showOnMap, setShowOnMap] = useSessionField('showNearbyOnMap')
  const [expanded, setExpanded] = useState<string[]>([])
  const kinds = nearbyGroups.flatMap(group => group.kinds).filter(layerAvailable)
  const loading = kinds.some(kind => states[kind].loading)
  const failed = kinds.some(kind => states[kind].error)
  return <div className="nearby-panel">
    <div className="nearby-context"><span><MapPin size={14}/>{copy.centre}</span><button type="button" className="nearby-refresh" aria-label={copy.refresh} disabled={loading} onClick={onRefresh}>{loading ? <LoaderCircle size={16} className="spin"/> : <RefreshCw size={16}/>}</button></div>
    <p className="nearby-distance-note">{copy.distance}</p>
    <label className="nearby-radius">{copy.radius}<select value={radius} onChange={event => setRadius(Number(event.target.value))}>{[500, 1000, 2000].map(metres => <option value={metres} key={metres}>{metres < 1000 ? `${metres} m` : `${metres / 1000} km`}</option>)}</select></label>
    <button type="button" className="nearby-map-toggle" role="switch" aria-checked={showOnMap} onClick={() => setShowOnMap(value => !value)}><span>{language === 'en' ? 'Show nearby on map' : '在地圖顯示附近交通'}</span><span className="switch" aria-hidden="true"/></button>
    {loading && <p className="nearby-status" role="status">{copy.loading}</p>}
    {failed && <p className="nearby-status warning-text" role="status">{copy.failed}</p>}
    {kinds.length < nearbyGroups.flatMap(group => group.kinds).length && <p className="nearby-status">{copy.unavailable} <a href={hostedUrl}>{extra.hostedLink}</a></p>}
    {nearbyGroups.map(group => {
      const feeds = group.kinds.filter(kind => layerAvailable(kind) && !viewportNote(kind, view))
      const places = nearbyPlaces(feeds.map(kind => states[kind].data), view, radius, now)
      const shown = expanded.includes(group.id) ? places : places.slice(0, 6)
      return <section className={`nearby-group nearby-${group.id}`} key={group.id} aria-label={copy.groups[group.id]}>
        <h3>{copy.groups[group.id]}<span>{places.length}</span></h3>
        {group.id === 'access' && <><p className="nearby-group-note">{copy.access}</p>{states.access.data?.complete === false && !states.access.error && <p className="nearby-group-note">{copy.partial}</p>}</>}
        {!places.length && <p className="nearby-empty">{group.kinds.some(kind => layerAvailable(kind) && viewportNote(kind, view)) ? copy.zoom : copy.none}</p>}
        <ul>{shown.map(({ camera, metres }) => {
          const arrival = nextArrivalText(camera, now)
          const source = states[camera.kind]
          const stale = source.error || source.data?.stale || isCameraDataStale(camera, now)
          const published = camera.kind === 'tram' || camera.kind === 'access' || camera.kind === 'taxi'
          return <li key={camera.id}><button type="button" className="nearby-place" onClick={() => onSelect(camera)}>
            <span className="nearby-place-main"><strong>{language === 'en' ? camera.nameEn || camera.name : camera.name}</strong><small>{layerText(camera.kind, language).short} · {Math.round(metres / 10) * 10} m</small><span className={stale ? 'warning-text' : ''}>{published ? copy.published : stale ? extra.stale : arrival ? `${arrival.route} · ${arrival.scheduled ? copy.scheduled : extra.live}` : copy.noDepartures}</span></span>
            {arrival && <span className="nearby-departure">{arrival.minutes}<small>{copy.minutes}</small></span>}
          </button></li>
        })}</ul>
        {places.length > 6 && <button type="button" className="nearby-more" onClick={() => setExpanded(previous => previous.includes(group.id) ? previous.filter(id => id !== group.id) : [...previous, group.id])}>{expanded.includes(group.id) ? copy.less : copy.more}</button>}
      </section>
    })}
  </div>
}
