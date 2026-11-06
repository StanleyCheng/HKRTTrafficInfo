export type SnapshotAdjustments = { brightness: number; contrast: number };
export const neutralAdjustments: SnapshotAdjustments = { brightness: 1, contrast: 1 };

/** Bounded exposure and contrast from a small luminance histogram; no invented details. */
export function snapshotAdjustments(pixels: Uint8ClampedArray): SnapshotAdjustments {
  const histogram = new Uint32Array(256);
  let count = 0, sum = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const luminance = Math.round(.2126 * pixels[i] + .7152 * pixels[i + 1] + .0722 * pixels[i + 2]);
    histogram[luminance]++; count++; sum += luminance;
  }
  if (!count) return neutralAdjustments;
  const percentile = (fraction: number) => {
    let total = 0;
    for (let i = 0; i < 256; i++) { total += histogram[i]; if (total >= count * fraction) return i; }
    return 255;
  };
  const range = percentile(.95) - percentile(.05);
  if (range < 12) return neutralAdjustments;
  return {
    brightness: Math.max(.9, Math.min(1.25, 118 / Math.max(1, sum / count))),
    contrast: Math.max(1, Math.min(1.35, 210 / range)),
  };
}
