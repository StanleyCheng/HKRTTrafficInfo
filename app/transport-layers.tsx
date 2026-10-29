'use client'
import type { CSSProperties } from 'react'
import { Crosshair, LoaderCircle, RefreshCw, Search } from 'lucide-react'
import { selectedVehicleCameras, type RouteVehicleFeeds, type RouteVehicleState } from '@/lib/route-vehicles'
import { useSessionField } from './use-session-field'
import { layers, layerAvailable, type Language, type LayerKind, type MapPath } from '@/lib/traffic'
import { routeVisible, transportKinds, type TransportMode, type TransportRoute, type RouteVisibility } from '@/lib/transport-routes'

const labels = {
  en: { stops: 'Bus stops', stopNote: 'Show stop markers on the map', routeLabels: 'Route stop labels', transport: 'Transport', bus: 'Buses & minibuses', rail: 'Trains & Light Rail', ferry: 'Ferries', tram: 'Trams', all: 'Show all routes', none: 'Hide all routes', search: 'Search routes or destinations', empty: 'No matching routes', busNote: 'Bus routes are listed from stops loaded around the map. Zoom in or move the map to find more. MTR Bus road routes are matched to published stops using OpenStreetMap data; unmapped directions are omitted.', otherNote: 'Select several routes to compare them on the map.', zoom: 'Zoom to route', unavailable: 'Route geometry unavailable', approximate: 'Approximate stop connections', retry: 'Retry route geometry', loading: 'Loading route geometry', shown: (shown: number, total: number) => `${shown} of ${total} shown` },
  zh: { stops: '巴士站', stopNote: '在地圖顯示車站標記', routeLabels: '路線車站標籤', transport: '交通工具', bus: '巴士及小巴', rail: '港鐵及輕鐵', ferry: '渡輪', tram: '電車', all: '顯示所有路線', none: '隱藏所有路線', search: '搜尋路線或目的地', empty: '沒有符合的路線', busNote: '巴士路線來自地圖附近已載入的車站。請放大或移動地圖以尋找更多路線。港鐵巴士道路路線採用 OpenStreetMap 資料，並與已公布車站配對；未有路線資料的方向不會顯示。', otherNote: '可選取多條路線在地圖比較。', zoom: '縮放至路線', unavailable: '未能取得路線走線', approximate: '約略車站連線', retry: '重試路線走線', loading: '正在載入路線走線', shown: (shown: number, total: number) => `顯示 ${shown} / ${total} 條` },
}
type PathState = { status: 'ready'; paths: MapPath[]; approximate: boolean } | { status: 'error' }
type Props = {
  language: Language; routes: TransportRoute[]; visibility: RouteVisibility; enabled: Record<LayerKind, boolean>
  mode: TransportMode; loaded: Record<string, PathState>; onToggle: (route: TransportRoute, on: boolean) => void
  positions: Record<string, RouteVehicleState>; vehicleFeeds: RouteVehicleFeeds; now: number; onRetryPositions: () => void
  onAll: (mode: TransportMode, on: boolean) => void; onZoom: (route: TransportRoute) => void; onRetry: () => void
}
export default function TransportLayers({ language, mode, routes, visibility, enabled, loaded, positions, vehicleFeeds, now, onRetryPositions, onToggle, onAll, onZoom, onRetry }: Props) {
  const copy = labels[language]
  const [query, setQuery] = useSessionField('routeQuery')
  const [showStops, setShowStops] = useSessionField('showBusStops')
  const [showPiers, setShowPiers] = useSessionField('showFerryPiers')
  const [showLabels, setShowLabels] = useSessionField('routeLabels')
  const choices = routes.filter(route => route.mode === mode && layerAvailable(route.kind))
  const matching = choices.filter(route => `${route.code} ${route.name} ${route.nameEn} ${layers[route.kind].name} ${layers[route.kind].nameEn}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const shown = choices.filter(route => enabled[route.kind] && routeVisible(route, visibility)).length
  const available = transportKinds[mode].some(layerAvailable)
  const moving = selectedVehicleCameras(vehicleFeeds, now)
  return <section className="transport-layers" aria-label={copy.transport}>
    <div className="transport-visibility">
      {mode === 'bus' && <label className="transport-switch"><span><strong>{copy.stops}</strong><small>{copy.stopNote}</small></span><input type="checkbox" role="switch" checked={showStops} onChange={event => setShowStops(event.target.checked)} aria-label={copy.stops}/><span className="switch" aria-hidden="true"/></label>}
      {mode === 'ferry' && <label className="transport-switch"><span><strong>{language === 'en' ? 'Ferry piers' : '渡輪碼頭'}</strong><small>{language === 'en' ? 'Show pier icons on the map' : '在地圖顯示碼頭圖示'}</small></span><input type="checkbox" role="switch" checked={showPiers} onChange={event => setShowPiers(event.target.checked)} aria-label={language === 'en' ? 'Ferry piers' : '渡輪碼頭'}/><span className="switch" aria-hidden="true"/></label>}
      <label className="transport-switch compact"><span>{copy.routeLabels}</span><input type="checkbox" role="switch" checked={showLabels} onChange={event => setShowLabels(event.target.checked)} aria-label={copy.routeLabels}/><span className="switch" aria-hidden="true"/></label>
    </div>
    <p className="transport-scope">{mode === 'bus' ? copy.busNote : copy.otherNote}</p>
    <div className="transport-route-actions"><button type="button" disabled={!available} onClick={() => onAll(mode, true)}>{copy.all}</button><button type="button" disabled={!available} onClick={() => onAll(mode, false)}>{copy.none}</button></div>
    <label className="transport-route-search"><Search size={16} aria-hidden="true"/><input type="search" value={query} maxLength={200} placeholder={copy.search} aria-label={copy.search} onChange={event => setQuery(event.target.value)}/></label>
    <div className="transport-route-count" role="status">{copy.shown(shown, choices.length)}</div>
    <ul className="transport-route-list">{matching.map(route => {
      const on = enabled[route.kind] && routeVisible(route, visibility), state = loaded[route.id]
      const loading = route.bus && on && !state, failed = state?.status === 'error'
      const supportsPositions = Boolean(route.bus || route.kind === 'mtr-bus')
      const position = positions[route.id], positionLoading = supportsPositions && on && (!position || position.status === 'loading')
      const count = moving.filter(camera => camera.id.startsWith(`selected-vehicle:${route.id}:`)).length
      const canZoom = route.paths.some(path => path.points.length > 1) || state?.status === 'ready'
      return <li key={route.id} className={on ? 'selected' : ''} style={{ '--transport-color': layers[route.kind].color } as CSSProperties}>
        <label className="transport-route-choice"><input type="checkbox" checked={on} onChange={event => onToggle(route, event.target.checked)} aria-label={`${language === 'en' ? 'Show' : '顯示'} ${route.code} ${language === 'en' ? route.nameEn : route.name}`.trim()}/><span className="transport-route-copy"><strong>{route.code && <b>{route.code}</b>}{language === 'en' ? route.nameEn : route.name}</strong>{route.bus && <small>{layers[route.kind][language === 'en' ? 'nameEn' : 'name']}</small>}{loading && <small><LoaderCircle size={12} className="spin"/>{copy.loading}</small>}{state?.status === 'ready' && state.approximate && <small>{copy.approximate}</small>}{failed && <small className="warning-text">{copy.unavailable}</small>}{route.roadCoverage === 'partial' && <small className="warning-text">{language === 'en' ? 'Some directions have no matched road route' : '部分方向未有配對道路路線'}</small>}{route.roadCoverage === 'unavailable' && <small className="warning-text">{language === 'en' ? 'Road route unavailable' : '未有道路路線'}</small>}{positionLoading && <small className="route-position-status"><LoaderCircle size={12} className="spin"/>{language === 'en' ? 'Loading vehicle positions…' : '正在載入車輛位置…'}</small>}{on && supportsPositions && count > 0 && <small className="route-position-status">{language === 'en' ? `${count} ETA position estimates` : `${count} 個 ETA 估算位置`}</small>}{on && supportsPositions && !positionLoading && count === 0 && <small className="route-position-status">{language === 'en' ? 'No current position estimate' : '暫無位置估算'}</small>}{on && position?.status === 'error' && <small className="warning-text">{language === 'en' ? 'Vehicle update unavailable' : '未能更新車輛位置'}</small>}{on && route.kind === 'tram' && <small>{language === 'en' ? 'No published GPS or ETA feed' : '未有公布 GPS 或到站時間資料'}</small>}</span></label>
        {on && position?.status === 'error' && <button type="button" className="transport-route-zoom" onClick={onRetryPositions} aria-label={`${language === 'en' ? 'Retry vehicle positions' : '重試車輛位置'} ${route.code}`}><RefreshCw size={16}/></button>}
        {failed ? <button type="button" className="transport-route-zoom" onClick={onRetry} aria-label={`${copy.retry} ${route.code}`} title={copy.retry}><RefreshCw size={16}/></button> : <button type="button" className="transport-route-zoom" disabled={!canZoom} onClick={() => onZoom(route)} aria-label={`${copy.zoom} ${route.code || (language === 'en' ? route.nameEn : route.name)}`} title={copy.zoom}><Crosshair size={18}/></button>}
      </li>
    })}</ul>
    {!matching.length && <p className="transport-route-empty">{copy.empty}</p>}
  </section>
}
