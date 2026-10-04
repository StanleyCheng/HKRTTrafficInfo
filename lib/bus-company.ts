import lwbRoutes from "../data/lwb-routes.json" with { type: "json" }

// The shared ETA feed currently marks Long Win routes with company code KMB.
// These route numbers are the Long Win services on that same feed.
const routes = new Set(lwbRoutes as string[])

export function busCompany(route: string, code: string): "KMB" | "LWB" {
  if (code === "LWB" || routes.has(route)) return "LWB"
  return "KMB"
}
