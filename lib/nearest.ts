export function nearestPoints<T extends { lng: number; lat: number }>(
  points: readonly T[],
  lng: number,
  lat: number,
  limit: number,
): T[] {
  const cos = Math.cos((lat * Math.PI) / 180)
  return points
    .map((point) => {
      const x = (point.lng - lng) * cos
      const y = (point.lat - lat)
      return { point, distance: x * x + y * y }
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .map((item) => item.point)
}
