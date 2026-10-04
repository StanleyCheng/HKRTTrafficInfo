export type SpeedBand = "free" | "slow" | "congested" | "unknown"

export type Corridor = {
  id: string
  roadTc: string
  roadEn: string
  direction: string
  speedKmh: number | null
  band: SpeedBand
  lengthKm: number
  detectorCount: number
  coordinates: [number, number][]
}

export type SpeedSummary = {
  corridorCount: number
  detectorCount: number
  meanSpeedKmh: number | null
  free: number
  slow: number
  congested: number
  unknown: number
}

export type SegmentSummary = {
  ok: boolean
  stale?: boolean
  fetchedAt?: string
  error?: string
  observedAt: string | null
  validCount: number
  invalidCount: number
  meanSpeedKmh: number | null
}

export type NetworkStatus = {
  ok: boolean
  stale?: boolean
  fetchedAt?: string
  error?: string
  revisionDate: string | null
  usedOnMap: boolean
  reason: string
}

export type TrafficResponse = {
  ok: boolean
  stale?: boolean
  fetchedAt?: string
  error?: string
  observedAt: string | null
  corridors: Corridor[]
  summary: SpeedSummary
  segments: SegmentSummary
  network: NetworkStatus
}

export type HarbourJourney = {
  from: string
  to: string
  minutes: number | null
  colour: "red" | "amber" | "green" | "none"
  note: string | null
}

export type ApproachLeg = {
  code: string
  name: string
  minutes: number | null
  colour: HarbourJourney["colour"]
}

export type ApproachPoint = {
  id: string
  observedAt?: string
  name: string
  nameTc: string
  coordinates: [number, number]
  legs: ApproachLeg[]
}

export type ApproachesResponse = {
  ok: boolean
  cacheable?: boolean
  stale?: boolean
  fetchedAt?: string
  error?: string
  capturedAt: string | null
  points: ApproachPoint[]
}

export type PictureResponse = {
  ok: boolean
  stale?: boolean
  fetchedAt?: string
  error?: string
  cameras: GeoJSON.FeatureCollection
  works: GeoJSON.FeatureCollection
  tolls: GeoJSON.FeatureCollection
}

export type IncidentsResponse = {
  ok: boolean
  stale?: boolean
  fetchedAt?: string
  error?: string
  observedAt: string | null
  incidents: GeoJSON.FeatureCollection
}

export type ControlPointsResponse = {
  ok: boolean
  stale?: boolean
  fetchedAt?: string
  error?: string
  observedAt: string | null
  points: GeoJSON.FeatureCollection
}

export type WeatherWarning = {
  id: string
  code: string
  name: string
  shortName: string
  detail: string
  tone: "red" | "amber"
  urgent: boolean
  score: number
}

export type WeatherConditions = {
  temperatureC: number | null
  rainfallMm: number | null
  rainfallPlace: string
}

export type WarningsResponse = {
  ok: boolean
  stale?: boolean
  fetchedAt?: string
  error?: string
  observedAt: string | null
  warnings: WeatherWarning[]
  conditions: WeatherConditions
}

export type MtrTimeType = "A" | "D"

export type MtrTrain = {
  id: string
  line: string
  dest: string
  plat: string
  ttnt: number
  observedAt: string
  delay: boolean
  timeType: MtrTimeType
  anchor: string
  path: string[]
  hold: string[]
}

export type MtrCalling = {
  dest: string
  plat: string
  ttnt: number
  delay: boolean
  timeType: MtrTimeType
}

export type MtrBoard = {
  observedAt?: string
  line: string
  station: string
  message: string
  trains: MtrCalling[]
}

export type MtrResponse = {
  ok: boolean
  stale?: boolean
  fetchedAt?: string
  error?: string
  observedAt: string | null
  trains: MtrTrain[]
  boards: MtrBoard[]
}

export type KmbCall = {
  route: string
  destTc: string
  destEn: string
  eta: string
  minutes: number | null
  scheduled: boolean
  remarkTc: string
  remarkEn: string
  company: "KMB" | "LWB"
}

export type KmbStopBoard = {
  id: string
  nameTc: string
  nameEn: string
  lng: number
  lat: number
  routes: string[]
  calls: KmbCall[]
}

export type KmbPlacesResponse = {
  ok: boolean
  stale?: boolean
  fetchedAt?: string
  error?: string
  stops: Omit<KmbStopBoard, "calls">[]
}

export type KmbResponse = {
  ok: boolean
  stale?: boolean
  fetchedAt?: string
  error?: string
  observedAt: string | null
  stops: KmbStopBoard[]
  cacheable?: boolean
}

export type LrtCalling = {
  route: string
  dest: string
  destTc: string
  destEn: string
  ttnt: number
  timeType: "A" | "D"
  plat: string
}

export type LrtBoard = {
  observedAt?: string
  station: string
  calls: LrtCalling[]
}

export type LrtResponse = {
  ok: boolean
  stale?: boolean
  fetchedAt?: string
  error?: string
  observedAt: string | null
  trains: MtrTrain[]
  boards: LrtBoard[]
}

export type CitybusCall = {
  route: string
  destTc: string
  destEn: string
  eta: string
  minutes: number | null
  scheduled: boolean
  remarkTc: string
  remarkEn: string
}

export type CitybusStopBoard = {
  id: string
  nameTc: string
  nameEn: string
  lng: number
  lat: number
  routes: string[]
  calls: CitybusCall[]
}

export type CitybusPlacesResponse = {
  ok: boolean
  stale?: boolean
  fetchedAt?: string
  error?: string
  stops: Omit<CitybusStopBoard, "calls">[]
}

export type CitybusResponse = {
  ok: boolean
  stale?: boolean
  fetchedAt?: string
  error?: string
  observedAt: string | null
  stops: CitybusStopBoard[]
  cacheable?: boolean
}

export type GmbCall = CitybusCall
export type GmbStopBoard = CitybusStopBoard
export type GmbPlacesResponse = CitybusPlacesResponse
export type GmbResponse = CitybusResponse

export type NlbCall = CitybusCall
export type NlbStopBoard = CitybusStopBoard
export type NlbPlacesResponse = CitybusPlacesResponse
export type NlbResponse = CitybusResponse

export type FerryCall = {
  route: string
  destTc: string
  destEn: string
  originTc: string
  originEn: string
  arriving: boolean
  eta: string
  minutes: number | null
  remarkTc: string
  remarkEn: string
  scheduled?: boolean
}

export type FerryPier = {
  id: string
  nameTc: string
  nameEn: string
  lng: number
  lat: number
  calls: FerryCall[]
}

export type FerryVessel = {
  id: string
  nameTc: string
  nameEn: string
  lng: number
  lat: number
  route: string
  eta: string
  minutes: number | null
  destTc?: string
  destEn?: string
  fix: "gps" | "clock"
  fromLng?: number
  fromLat?: number
  toLng?: number
  toLat?: number
  departAt?: number | null
  arriveAt?: number | null
  pathLng?: number[]
  pathLat?: number[]
}

export type FerryResponse = {
  ok: boolean
  stale?: boolean
  fetchedAt?: string
  error?: string
  observedAt: string | null
  piers: FerryPier[]
  vessels: FerryVessel[]
  cacheable?: boolean
}

export type WatchLayer = "speed" | "cameras" | "works" | "tolls" | "incidents" | "control" | "mtr" | "kmb" | "lrt" | "citybus" | "gmb" | "nlb" | "ferry"

export type WatchLayers = Record<WatchLayer, boolean>

export type Basemap = "satellite" | "street" | "buildings"
