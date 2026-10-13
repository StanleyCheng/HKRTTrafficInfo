export type TransitIdentitySample = { id: string; key: string; destination: string; distance: number; observedAt: number };

// Arrival feeds have no physical vehicle IDs. These IDs only preserve UI continuity
// for nearby estimates on the same directed track; they never identify a real train.
export function reconcileTransitIdentities(previous: TransitIdentitySample[], next: TransitIdentitySample[], now: number): string[] {
  const fresh = (sample: TransitIdentitySample) => Number.isFinite(sample.distance) && Number.isFinite(sample.observedAt)
    && sample.observedAt <= now + 60_000 && now - sample.observedAt <= 180_000;
  const candidates: { previous: number; next: number; gap: number }[] = [];
  previous.forEach((before, beforeIndex) => {
    if (!fresh(before)) return;
    next.forEach((after, afterIndex) => {
      if (!fresh(after) || before.key !== after.key || before.destination !== after.destination) return;
      const gap = Math.abs(before.distance - after.distance);
      if (gap <= 750) candidates.push({ previous: beforeIndex, next: afterIndex, gap });
    });
  });
  candidates.sort((a, b) => a.gap - b.gap || a.previous - b.previous || a.next - b.next);
  const usedPrevious = new Set<number>(), usedIds = new Set<string>();
  const identities = new Map<number, string>();
  for (const candidate of candidates) {
    const id = previous[candidate.previous].id;
    if (usedPrevious.has(candidate.previous) || identities.has(candidate.next) || usedIds.has(id)) continue;
    usedPrevious.add(candidate.previous); identities.set(candidate.next, id); usedIds.add(id);
  }
  const previousIds = new Set(previous.map(sample => sample.id));
  return next.map((sample, index) => {
    const matched = identities.get(index);
    if (matched !== undefined) return matched;
    let id = sample.id;
    // A serial supplied by the feed can be reused for the following train. Give
    // an unmatched estimate a fresh UI identity instead of reviving an old marker.
    if (previousIds.has(id) || usedIds.has(id)) id = `${sample.id}:estimate-${Math.round(now)}-${index}`;
    while (usedIds.has(id)) id += '-new';
    usedIds.add(id);
    return id;
  });
}
