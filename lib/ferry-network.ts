import piersFile from "../data/ferry-piers.json" with { type: "json" }
import { SUN_ROUTES } from "./ferry-routes.ts"
import type { FerryResponse } from "./types.ts"

type PierRecord = { id: string; nameTc: string; nameEn: string; lng: number; lat: number }
const piers = (piersFile as { piers: PierRecord[] }).piers

export function ferryPiers(): PierRecord[] {
  return piers
}

export function ferryPierFeatures(clock: FerryResponse | null): GeoJSON.FeatureCollection {
  const calls = new Map((clock?.ok ? clock.piers : []).map((pier) => [pier.id, pier.calls]))
  return {
    type: "FeatureCollection",
    features: piers.map((pier) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [pier.lng, pier.lat] },
      properties: {
        nameTc: pier.nameTc,
        nameEn: pier.nameEn,
        routes: JSON.stringify([]),
        board: JSON.stringify(calls.get(pier.id) ?? []),
      },
    })),
  }
}

export function ferryVesselFeatures(clock: FerryResponse | null): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: (clock?.ok ? clock.vessels : []).map((vessel) => {
      const sailing = SUN_ROUTES.find((item) => item.code === vessel.route)
      return {
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [vessel.lng, vessel.lat] },
        properties: {
          nameTc: vessel.nameTc,
          nameEn: vessel.nameEn,
          routes: JSON.stringify([]),
          board: JSON.stringify([{
            route: vessel.route,
            destTc: vessel.destTc || sailing?.destTc || "",
            destEn: vessel.destEn || sailing?.destEn || "",
            originTc: "",
            originEn: "",
            arriving: false,
            eta: vessel.eta,
            minutes: vessel.minutes,
            remarkTc: "",
            remarkEn: "",
            scheduled: false,
          }]),
        },
      }
    }),
  }
}
