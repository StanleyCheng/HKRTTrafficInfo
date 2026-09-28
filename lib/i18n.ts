import type { Language, LayerKind } from './traffic';

type AppMessages = {
  languageControl: string;
  english: string;
  chinese: string;
  collapseTopbar: string;
  expandTopbar: string;
  collapseSidebar: string;
  expandSidebar: string;
  brandTitle: string;
  brandCompactTitle: string;
  mapStyle: string;
  mapStyleStreet: string;
  mapStyleLight: string;
  switchToPositron: string;
  switchToOsm: string;
  officialData: string;
  sources: string;
  sidebarLabel: string;
  overviewEyebrow: string;
  overviewTitle: string;
  publishedLocations: string;
  completeInventory: string;
  mapLayers: string;
  showingLocations: (count: string) => string;
  layerSwitch: (name: string) => string;
  layerUpdateFailed: string;
  dataLoadFailed: string;
  retry: string;
  noOfficialLocations: string;
  layerNote: string;
  cameraDetails: string;
  clearSelection: string;
  selectedLocation: string;
  selectionAnnounced: (name: string) => string;
  panelNavigation: string;
  searchTab: string;
  moreLayers: string;
  searchTitle: string;
  searchHelp: string;
  searchScope: string;
  searchRoads: string;
  searchLocations: string;
  searchRoadLabel: string;
  searchLocationLabel: string;
  clearSearch: string;
  searchResults: (count: string) => string;
  searchNoResults: string;
  searchNoData: string;
  inspectLocation: (name: string) => string;
  segmentLabel: string;
  searchPagination: string;
  previousPage: string;
  nextPage: string;
  searchRange: (start: number, end: number, total: number) => string;
  speedLegend: string;
  speedLegendHelp: string;
  liveSpeedsStale: string;
  noOfficialUpdateTime: string;
  updatedMinutes: (minutes: number) => string;
  updating: string;
  mappedSegments: (mapped: string, expected: string) => string;
  incidentMapped: (mapped: string, notices: string) => string;
  closeCameraDetails: string;
  district: string;
  coordinates: string;
  recordUpdated: string;
  officialRemarks: string;
  layerDetail: Record<'redlight' | 'speed', string>;
  liveDataTime: string;
  speedNow: string;
  speedLevels: Record<'free' | 'moderate' | 'slow' | 'unknown', string>;
  noLiveSpeed: string;
  directionLabel: string;
  showDetectors: string;
  routeNumberLabel: string;
  speedLimitLabel: string;
  flowCoverage: (mapped: string, expected: string) => string;
  speedLayerNote: string;
  parkingSpaces: string;
  parkingNoLive: string;
  heightLimitLabel: string;
  metres: (height: string) => string;
  openingStatusLabel: string;
  rainfallAmount: string;
  millimetres: (mm: string) => string;
  rainfallNote: string;
  incidentApproxNote: string;
  incidentListTitle: (count: string) => string;
  incidentViewOnMap: string;
  incidentNoLocation: string;
  incidentEmpty: string;
  officialSource: string;
  emptyDetailTitle: string;
  emptyDetailBody: string;
  loadingOfficialData: string;
  loadingLiveSpeeds: string;
  partialUpdateFailure: string;
  inventoryFetched: (time: string) => string;
  noData: string;
  refreshAll: string;
  openControls: string;
  closeControls: string;
  panelTitle: string;
  sourceDialogTitle: string;
  closeSources: string;
  sourceDescriptions: Record<LayerKind, string>;
  dataGovLink: string;
  locationXml: string;
  officialApi: string;
  sourceChecked: (count: string, expected: string, time: string, stale: boolean) => string;
  sourceFootnote: string;
  basemap: string;
  osmContributors: string;
  openFreeMapPositron: string;
  nonGovernmentBasemap: string;
  governmentTerms: string;
  snapshotAlt: (name: string) => string;
  snapshotTimeout: string;
  snapshotDisplayFailed: string;
  loadingSnapshot: string;
  reloadSnapshot: string;
  snapshotUpdated: (time: string) => string;
  snapshotNoUpdateTime: string;
  snapshotWaiting: string;
  refreshSnapshot: string;
  snapshotStale: string;
  snapshotNote: string;
  mapLabel: string;
  mapKeyboardHelp: string;
  zoomIn: string;
  zoomOut: string;
  showAll: string;
  returnToHongKong: string;
  mapLoadFailed: string;
  mapLoading: string;
  allLayersOff: string;
  cameraLoadFailed: string;
  noCameraLocations: string;
  turnOnLayer: string;
  checkLayers: string;
  mapHint: string;
  clusterLabel: (count: number) => string;
};

export const messages: Record<Language, AppMessages> = {
  zh: {
    languageControl: '語言選擇', english: '英文', chinese: '中文',
    collapseTopbar: '收起頂部工具列，讓地圖顯示更大', expandTopbar: '展開頂部工具列',
    collapseSidebar: '收起圖層面板，讓地圖顯示更大', expandSidebar: '展開圖層面板',
    brandTitle: '香港實時交通資訊', brandCompactTitle: '香港交通',
    mapStyle: '底圖樣式', mapStyleStreet: '街道', mapStyleLight: '淺灰',
    switchToPositron: '切換至 OpenFreeMap Positron 淺灰底圖', switchToOsm: '切換至 OpenStreetMap 底圖',
    officialData: '官方開放數據', sources: '資料來源', sidebarLabel: '圖層及詳情',
    overviewEyebrow: '香港 · 交通概覽', overviewTitle: '全港交通概覽', publishedLocations: '個已公布位置',
    completeInventory: '完整名冊', mapLayers: '地圖圖層', showingLocations: count => `顯示 ${count} 個`,
    layerSwitch: name => `${name}圖層`, layerUpdateFailed: '更新失敗，現顯示上次成功載入的名冊。', dataLoadFailed: '資料載入失敗。',
    retry: '重試', noOfficialLocations: '官方名冊暫無位置資料。',
    layerNote: '數字代表官方公布的位置數目，並非正在運作的相機數量。偵速機箱名冊不包括政府隧道及管制區。',
    cameraDetails: '詳情', closeCameraDetails: '關閉詳情', clearSelection: '清除選取', selectedLocation: '已選位置',
    selectionAnnounced: name => `已選取 ${name}。`,
    panelNavigation: '交通面板', searchTab: '搜尋', moreLayers: '更多',
    searchTitle: '搜尋道路及位置', searchHelp: '搜尋官方路段，或按地區查找相機、停車場及其他位置。選取結果可在地圖定位並查看詳情。',
    searchScope: '搜尋類別', searchRoads: '道路車速', searchLocations: '其他位置',
    searchRoadLabel: '道路名稱、路線或路段編號', searchLocationLabel: '位置名稱或地區', clearSearch: '清除搜尋',
    searchResults: count => `${count} 個結果`, searchNoResults: '沒有符合的結果。請縮短搜尋字詞或使用另一語言的道路名稱。',
    searchNoData: '暫無可供搜尋的資料。請查看圖層狀態並重試。', inspectLocation: name => `在地圖定位並查看 ${name} 的詳情`,
    segmentLabel: '路段', searchPagination: '搜尋結果分頁', previousPage: '上一頁', nextPage: '下一頁',
    searchRange: (start, end, total) => `${start}–${end} / ${total}`,
    speedLegend: '道路車速圖例', speedLegendHelp: '顏色分類說明', liveSpeedsStale: '車速資料已超過 10 分鐘',
    noOfficialUpdateTime: '暫無車速更新時間', updatedMinutes: minutes => minutes === 0 ? '車速剛剛更新' : `車速 ${minutes} 分鐘前更新`,
    updating: '更新中', mappedSegments: (mapped, expected) => `${mapped} / ${expected} 個路段已配對`,
    incidentMapped: (mapped, notices) => `${notices} 則消息中有 ${mapped} 個地圖位置`,
    district: '所屬地區', coordinates: '位置座標',
    recordUpdated: '記錄更新', officialRemarks: '官方備註',
    layerDetail: {
      redlight: '此圖層提供衝紅燈攝影機系統路口位置。官方並無提供此相機的即時運作狀態或快拍影像。',
      speed: '此圖層提供偵速攝影機機箱位置。官方並無提供此相機的即時運作狀態或快拍影像。',
    },
    officialSource: '官方資料來源',
    liveDataTime: '數據時間', speedNow: '平均車速',
    speedLevels: { free: '暢通', moderate: '一般', slow: '緩慢', unknown: '暫無讀數' },
    noLiveSpeed: '官方暫未提供有效車速讀數', directionLabel: '行車方向', showDetectors: '顯示探測器位置', routeNumberLabel: '路線編號', speedLimitLabel: '道路限速',
    flowCoverage: (mapped, expected) => `已配對 ${mapped} / ${expected} 個官方車速路段；未有相符路網線段的不會顯示。`,
    speedLayerNote: '路段顏色按官方道路限速及實時平均車速分類：一般道路紅色 ≤15、黃色 ≤30、綠色 >30 km/h；限速 70 km/h 或以上道路紅色 ≤25、黃色 ≤50、綠色 >50 km/h。失效、格式錯誤或超過 10 分鐘的讀數顯示灰色。',
    parkingSpaces: '私家車空位', parkingNoLive: '暫無實時空位數據',
    heightLimitLabel: '高度限制', metres: height => `${height} 米`, openingStatusLabel: '開放狀態',
    rainfallAmount: '過去一小時雨量', millimetres: mm => `${mm} 毫米`,
    rainfallNote: '天文台提供分區最高雨量讀數；標記位置為分區參考點，並非量度站。',
    incidentApproxNote: '此位置按路名經官方地址查詢服務推斷，僅為大約位置。',
    incidentListTitle: count => `全部消息（${count}）`, incidentViewOnMap: '地圖', incidentNoLocation: '未能確定位置',
    incidentEmpty: '現時沒有特別交通消息。',
    emptyDetailTitle: '每段路況，一目了然',
    emptyDetailBody: '點選地圖上的相機標記或車速路段，查看位置詳情、實時車速或最新交通快拍。',
    loadingOfficialData: '正在讀取官方資料…', loadingLiveSpeeds: '正在載入實時車速路段', partialUpdateFailure: '部分資料更新失敗',
    inventoryFetched: time => `資料讀取 ${time}`, noData: '未有可用資料', refreshAll: '重新讀取所有官方資料',
    openControls: '開啟圖層及詳情', closeControls: '關閉圖層及詳情', panelTitle: '圖層及詳情',
    sourceDialogTitle: '資料來源與更新', closeSources: '關閉資料來源',
    sourceDescriptions: {
      redlight: '運輸署於空間數據共享平台（CSDI）公布的裝設衝紅燈攝影機系統路口。先查詢全部記錄編號及總數，再分批取得每個位置，並核對完整性。位置名冊按官方資料更新。',
      speed: '運輸署於空間數據共享平台（CSDI）公布的偵速機箱位置（不包括政府隧道及管制區）。先查詢全部記錄編號及總數，再分批取得每個位置，並核對完整性。位置名冊按官方資料更新。',
      snapshot: '運輸署交通快拍完整位置名冊（XML）及官方 JPEG 影像。已選快拍每兩分鐘重新讀取，時間取自影像回應的 Last-Modified。',
      flow: '運輸署「策略性／主要道路的交通數據」：把每 2 分鐘更新的官方處理後平均車速，按 CSDI Road Network 2nd Generation 的官方道路限速及 IRN CENTERLINE 分類着色；另可按需要顯示探測器當刻平均讀數。',
      incident: '運輸署「特別交通消息」（XML），雙語對照。官方消息沒有座標；地圖標示是透過官方地址查詢服務（ALS）按路名推斷的大約位置，未能確定位置的消息只於列表顯示。',
      parking: '資料一線通「停車場空置車位數據」（一鍵通版本）：結合停車場基本資料（位置、高度限制、開放時間）及實時私家車空位數目。',
      rainfall: '香港天文台「過去一小時降雨量」開放數據（JSON，每 15 分鐘更新）。雨量為分區最高讀數，標記置於分區參考點。',
    },
    dataGovLink: '資料一線通', locationXml: '完整位置 XML', officialApi: 'CSDI 官方 API',
    sourceChecked: (count, expected, time, stale) => `已核對 ${count} / ${expected} 筆 · ${time} 讀取${stale ? '（更新失敗，保留上次名冊）' : ''}`,
    sourceFootnote: '所有位置及交通影像均取自香港政府，沒有模擬交通資料。名冊每五分鐘重新讀取。快拍為定時更新的靜態影像，並非直播；官方可能回傳「No Service」影像。本網站不代表香港特別行政區政府。',
    basemap: '底圖：', osmContributors: 'OpenStreetMap 貢獻者', openFreeMapPositron: 'OpenFreeMap Positron', nonGovernmentBasemap: '（非政府底圖）。', governmentTerms: '政府開放數據使用條款',
    snapshotAlt: name => `${name}的官方交通快拍`,
    snapshotTimeout: '快拍載入逾時，請重試。', snapshotDisplayFailed: '影像無法顯示，請重試。',
    loadingSnapshot: '載入最新快拍', reloadSnapshot: '重新載入快拍', snapshotUpdated: time => `影像更新 ${time}`,
    snapshotNoUpdateTime: '來源未提供影像更新時間', snapshotWaiting: '等待官方影像', refreshSnapshot: '更新快拍',
    snapshotStale: '此影像已超過 10 分鐘未更新，可能暫停服務。',
    snapshotNote: '每 2 分鐘自動重新讀取 · 香港時間\n更新時間取自官方影像檔案；拍攝時間以圖中標示為準。若顯示「No Service」，代表官方暫未提供影像。',
    mapLabel: '香港交通互動地圖', mapKeyboardHelp: '使用方向鍵移動地圖，點選數字群組放大；使用面板搜尋以鍵盤查找道路及位置',
    zoomIn: '放大地圖', zoomOut: '縮小地圖',
    showAll: '顯示全港交通', returnToHongKong: '返回全港',
    mapLoadFailed: '互動地圖或底圖暫時未能完整載入。相機位置資料不受影響，請檢查網絡或重新載入。',
    mapLoading: '正在載入地圖', allLayersOff: '所有圖層已關閉', cameraLoadFailed: '暫時未能載入相機位置',
    noCameraLocations: '暫無相機位置資料', turnOnLayer: '開啟相機圖層，即可在地圖查看位置。',
    checkLayers: '請查看圖層狀態，並按重新整理再試。', mapHint: '點選標記或路段查看詳情，或在面板搜尋道路及位置',
    clusterLabel: count => `${count} 個相機位置，按下展開`,
  },
  en: {
    languageControl: 'Language', english: 'English', chinese: 'Chinese',
    collapseTopbar: 'Collapse the top bar to free up map space', expandTopbar: 'Expand the top bar',
    collapseSidebar: 'Collapse the layers panel to free up map space', expandSidebar: 'Expand the layers panel',
    brandTitle: 'HK Real-Time Traffic Info', brandCompactTitle: 'HK Traffic',
    mapStyle: 'Map style', mapStyleStreet: 'Street', mapStyleLight: 'Light',
    switchToPositron: 'Switch to the OpenFreeMap Positron light-gray basemap', switchToOsm: 'Switch to the OpenStreetMap basemap',
    officialData: 'Official open data', sources: 'Sources', sidebarLabel: 'Layers and details',
    overviewEyebrow: 'HONG KONG · TRAFFIC OVERVIEW', overviewTitle: 'Traffic overview', publishedLocations: 'published locations',
    completeInventory: 'Complete list', mapLayers: 'Map layers', showingLocations: count => `Showing ${count}`,
    layerSwitch: name => `${name} layer`, layerUpdateFailed: 'Update failed. Showing the last successfully loaded list.', dataLoadFailed: 'Data could not be loaded.',
    retry: 'Retry', noOfficialLocations: 'The official list currently has no location data.',
    layerNote: 'Counts are published locations, not cameras confirmed to be operating. The speed-camera list excludes government tunnels and control areas.',
    cameraDetails: 'Details', closeCameraDetails: 'Close details', clearSelection: 'Clear selection', selectedLocation: 'Selected location',
    selectionAnnounced: name => `Selected ${name}.`,
    panelNavigation: 'Traffic panel', searchTab: 'Search', moreLayers: 'More',
    searchTitle: 'Find a road or location', searchHelp: 'Search official road segments, or find cameras, parking and other locations by district. Select a result to locate it on the map and open its details.',
    searchScope: 'Search category', searchRoads: 'Road speeds', searchLocations: 'Other locations',
    searchRoadLabel: 'Road name, route or segment number', searchLocationLabel: 'Location name or district', clearSearch: 'Clear search',
    searchResults: count => `${count} results`, searchNoResults: 'No matching results. Try fewer words or a road name in the other language.',
    searchNoData: 'No data to search yet. Check the layer status and retry.', inspectLocation: name => `Locate ${name} on the map and open its details`,
    segmentLabel: 'Segment', searchPagination: 'Search result pages', previousPage: 'Previous', nextPage: 'Next',
    searchRange: (start, end, total) => `${start}–${end} of ${total}`,
    speedLegend: 'Road speed legend', speedLegendHelp: 'How colours are classified', liveSpeedsStale: 'Speeds are over 10 minutes old',
    noOfficialUpdateTime: 'No speed update time available', updatedMinutes: minutes => minutes === 0 ? 'Speeds updated just now' : `Speeds updated ${minutes} min ago`,
    updating: 'Updating', mappedSegments: (mapped, expected) => `${mapped} of ${expected} segments mapped`,
    incidentMapped: (mapped, notices) => `${mapped} mapped locations from ${notices} notices`,
    district: 'District', coordinates: 'Coordinates',
    recordUpdated: 'Record updated', officialRemarks: 'Official remarks',
    layerDetail: {
      redlight: 'This layer shows red-light camera junctions. The official source does not provide live operating status or snapshot images for these cameras.',
      speed: 'This layer shows speed-camera housing locations. The official source does not provide live operating status or snapshot images for these cameras.',
    },
    officialSource: 'Official source',
    liveDataTime: 'Data time', speedNow: 'Average speed',
    speedLevels: { free: 'Free flow', moderate: 'Moderate', slow: 'Slow', unknown: 'No reading' },
    noLiveSpeed: 'No valid speed reading from the official source', directionLabel: 'Direction', showDetectors: 'Show detector locations', routeNumberLabel: 'Route number', speedLimitLabel: 'Road speed limit',
    flowCoverage: (mapped, expected) => `Matched ${mapped} / ${expected} official speed segments; segments without matching road geometry are not shown.`,
    speedLayerNote: 'Segment colours use official road speed limits and live average speeds: ordinary roads are red at ≤15, amber at ≤30 and green above 30 km/h; roads limited to 70 km/h or more are red at ≤25, amber at ≤50 and green above 50 km/h. Invalid, malformed or over-10-minute-old readings are grey.',
    parkingSpaces: 'Private car spaces', parkingNoLive: 'No live vacancy data',
    heightLimitLabel: 'Height limit', metres: height => `${height} m`, openingStatusLabel: 'Opening status',
    rainfallAmount: 'Rainfall in the past hour', millimetres: mm => `${mm} mm`,
    rainfallNote: 'HKO publishes district-maximum readings; markers sit at district reference points, not measuring stations.',
    incidentApproxNote: 'Approximate location inferred from the road name via the official Address Lookup Service.',
    incidentListTitle: count => `All notices (${count})`, incidentViewOnMap: 'Map', incidentNoLocation: 'No map location',
    incidentEmpty: 'There are no special traffic news notices right now.',
    emptyDetailTitle: 'See every road at a glance',
    emptyDetailBody: 'Select a camera marker or a coloured road segment on the map to view location details, live speeds or the latest traffic snapshot.',
    loadingOfficialData: 'Loading official data…', loadingLiveSpeeds: 'Loading live road speeds', partialUpdateFailure: 'Some data failed to update',
    inventoryFetched: time => `Data fetched ${time}`, noData: 'No data available', refreshAll: 'Reload all official data',
    openControls: 'Open layers and details', closeControls: 'Close layers and details', panelTitle: 'Layers and details',
    sourceDialogTitle: 'Sources and updates', closeSources: 'Close sources',
    sourceDescriptions: {
      redlight: 'Red-light camera junctions published by the Transport Department on the Common Spatial Data Infrastructure (CSDI). The app queries every record ID and the total count, loads locations in batches, and verifies completeness.',
      speed: 'Speed-camera housing locations published by the Transport Department on CSDI, excluding government tunnels and control areas. The app queries every record ID and the total count, loads locations in batches, and verifies completeness.',
      snapshot: 'The Transport Department’s complete traffic-snapshot location list (XML) and official JPEG images. The selected snapshot refreshes every two minutes; update time comes from the image response’s Last-Modified value.',
      flow: 'The Transport Department’s Traffic Data of Strategic / Major Roads: official processed average speeds (updated every 2 minutes) are classified using official road speed limits and drawn on the IRN CENTERLINE from the CSDI Road Network (2nd Generation). Optional detector points show current average readings.',
      incident: 'The Transport Department’s Special Traffic News (XML), bilingual. Official notices carry no coordinates; map pins are approximate positions inferred from road names via the official Address Lookup Service (ALS). Notices without a confident match appear in the list only.',
      parking: 'The DATA.GOV.HK one-stop car park information and vacancy API: basic car park details (location, height limit, opening hours) merged with real-time private-car vacancy counts.',
      rainfall: 'Hong Kong Observatory “Rainfall in the past hour” open data (JSON, every 15 minutes). Readings are district maxima; markers sit at district reference points, not at measuring stations.',
    },
    dataGovLink: 'DATA.GOV.HK', locationXml: 'Complete location XML', officialApi: 'Official CSDI API',
    sourceChecked: (count, expected, time, stale) => `Verified ${count} / ${expected} records · fetched ${time}${stale ? ' (update failed; last list retained)' : ''}`,
    sourceFootnote: 'All locations and traffic images come from the Hong Kong Government; no traffic data is simulated. Location lists refresh every five minutes. Snapshots are periodically updated still images, not live video, and the official source may return a “No Service” image. This website does not represent the Government of the Hong Kong SAR.',
    basemap: 'Basemap: ', osmContributors: 'OpenStreetMap contributors', openFreeMapPositron: 'OpenFreeMap Positron', nonGovernmentBasemap: ' (non-government basemap). ', governmentTerms: 'Government open-data terms',
    snapshotAlt: name => `Official traffic snapshot for ${name}`,
    snapshotTimeout: 'The snapshot timed out. Please retry.', snapshotDisplayFailed: 'The image could not be displayed. Please retry.',
    loadingSnapshot: 'Loading latest snapshot', reloadSnapshot: 'Reload snapshot', snapshotUpdated: time => `Image updated ${time}`,
    snapshotNoUpdateTime: 'The source did not provide an image update time', snapshotWaiting: 'Waiting for official image', refreshSnapshot: 'Refresh snapshot',
    snapshotStale: 'This image has not updated for more than 10 minutes and may be temporarily unavailable.',
    snapshotNote: 'Automatically refreshed every 2 minutes · Hong Kong time\nUpdate time comes from the official image file; see the image for its capture time. “No Service” means the official source has no image available.',
    mapLabel: 'Interactive map of Hong Kong traffic', mapKeyboardHelp: 'Use arrow keys to move the map and select a numbered cluster to zoom in; use panel search to find roads and locations by keyboard',
    zoomIn: 'Zoom in', zoomOut: 'Zoom out',
    showAll: 'Show all Hong Kong traffic', returnToHongKong: 'Return to all Hong Kong',
    mapLoadFailed: 'The interactive map or basemap could not fully load. Camera location data is unaffected; check your connection or reload.',
    mapLoading: 'Loading map', allLayersOff: 'All layers are off', cameraLoadFailed: 'Camera locations could not be loaded',
    noCameraLocations: 'No camera location data is available', turnOnLayer: 'Turn on a camera layer to see its locations on the map.',
    checkLayers: 'Check the layer status, then refresh and try again.', mapHint: 'Select a marker or road for details, or search in the panel',
    clusterLabel: count => `${count} camera locations; select to expand`,
  },
};

export function formatRecordDate(value: string, language: Language) {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) return value;
  return language === 'zh' ? `${match[1]}年${match[2]}月${match[3]}日` : `${match[1]}-${match[2]}-${match[3]}`;
}
