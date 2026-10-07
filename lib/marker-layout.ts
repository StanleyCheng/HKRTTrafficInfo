export type MarkerPoint = { id: string; x: number; y: number; size: number };
export type MarkerOffset = { x: number; y: number };

const offsets: MarkerOffset[] = [
  { x: 0, y: 0 }, { x: 34, y: 0 }, { x: -34, y: 0 },
  { x: 0, y: -34 }, { x: 0, y: 34 },
  { x: 34, y: -34 }, { x: -34, y: -34 }, { x: 34, y: 34 }, { x: -34, y: 34 },
];

// Display pixels only: every source point survives, including an overcrowded point.
export function markerOffsets(points: MarkerPoint[]): Map<string, MarkerOffset> {
  const grid = new Map<string, MarkerPoint[]>();
  const result = new Map<string, MarkerOffset>();
  for (const point of [...points].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    const offset = offsets.find(offset => {
      const x = point.x + offset.x, y = point.y + offset.y;
      const gx = Math.floor(x / 40), gy = Math.floor(y / 40);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (grid.get(`${gx + dx}:${gy + dy}`)?.some(other =>
            Math.abs(x - other.x) < (point.size + other.size) / 2 + 2 &&
            Math.abs(y - other.y) < (point.size + other.size) / 2 + 2)) return false;
        }
      }
      return true;
    }) ?? offsets[0];
    result.set(point.id, offset);
    const placed = { ...point, x: point.x + offset.x, y: point.y + offset.y };
    const key = `${Math.floor(placed.x / 40)}:${Math.floor(placed.y / 40)}`;
    const bucket = grid.get(key);
    if (bucket) bucket.push(placed);
    else grid.set(key, [placed]);
  }
  return result;
}
