import type { BusEta, BusRouteStop, BusVehicle } from './bus-route.ts'
import { ETA_KEEP_MS } from './place-arrivals.ts'
const FRESH = ETA_KEEP_MS

// ETA rank is local to a stop, not a vehicle ID. Once a bus passes a stop,
// its following bus becomes rank 1 there while remaining rank 2 downstream.
// Match successive boards in arrival order, allowing ranks to shift. Keep
// timetable and live rows separate and reject physically impossible links.
// These chains remain estimates: the feeds publish neither bus GPS nor IDs.
export function inferBusVehicles(stops: BusRouteStop[], etas: BusEta[], now: number, idPrefix: string): BusVehicle[] {
  if (!Number.isFinite(now)) return [];
  const bySeq = new Map(stops.map((stop) => [stop.seq, stop]));
  const byEntry = new Map<string, BusEta>();
  for (const eta of etas) {
    if (!Number.isFinite(eta.at) || !Number.isFinite(eta.observed) || now - eta.observed >= FRESH || eta.observed > now + 30_000
      || !Number.isInteger(eta.rank) || eta.rank < 1 || !Number.isFinite(bySeq.get(eta.seq)?.distance) || bySeq.get(eta.seq)!.distance < 0) continue;
    const key = `${eta.seq}:${eta.rank}`;
    const existing = byEntry.get(key);
    if (!existing || eta.observed > existing.observed) byEntry.set(key, eta);
  }
  const boards = new Map<number, BusEta[]>();
  for (const eta of byEntry.values()) {
    const board = boards.get(eta.seq) ?? [];
    board.push(eta);
    boards.set(eta.seq, board);
  }
  type Chain = { rows: BusEta[]; startDistance: number };
  const chains: Chain[] = [];
  let previous: Chain[] = [];
  for (const [seq, board] of [...boards].sort(([a], [b]) => a - b)) {
    board.sort((a, b) => a.at - b.at || a.rank - b.rank);
    const current: Chain[] = [];
    let cursor = 0;
    for (const eta of board) {
      const stop = bySeq.get(seq)!;
      const index = previous.findIndex((chain, index) => {
        if (index < cursor) return false;
        const last = chain.rows.at(-1)!;
        const distance = stop.distance - bySeq.get(last.seq)!.distance;
        const seconds = (eta.at - last.at) / 1000;
        // Slow traffic is legitimate. A lower speed threshold used to remove
        // every bus in congestion; only non-forward/impossible links fail.
        return eta.scheduled === last.scheduled && distance > 0 && seconds > 0 && distance / seconds <= 25;
      });
      if (index !== -1) {
        const chain = previous[index];
        cursor = index + 1;
        chain.rows.push(eta);
        current.push(chain);
      } else {
        const inconsistent = previous.findIndex((chain, index) => {
          const last = chain.rows.at(-1)!;
          return index >= cursor && last.rank === eta.rank && last.scheduled === eta.scheduled && eta.at >= last.at;
        });
        if (inconsistent !== -1) {
          // Rounded/equal or impossibly close ETAs cannot establish another
          // bus. Skip this anchor and keep the preceding evidence available.
          current.push(previous[inconsistent]);
          cursor = inconsistent + 1;
          continue;
        }
        // A new earlier arrival at the immediately downstream stop indicates
        // a bus has passed the previous stop. Never project it back through
        // that stop (possibly kilometres toward the origin).
        const preceding = boards.get(seq - 1);
        const passed = preceding?.length && preceding.every(row => row.at > eta.at);
        const chain = { rows: [eta], startDistance: passed ? bySeq.get(seq - 1)!.distance : 0 };
        chains.push(chain);
        current.push(chain);
      }
    }
    previous = current;
  }
  // Each arrival is consumed once. Nearby buses may be bunched together, so
  // geographical proximity alone must not collapse separate services.
  return chains.flatMap(chain => {
    const first = chain.rows[0];
    const vehicle = vehicleFromChain(chain.rows, bySeq, chain.startDistance, now, `${idPrefix}:${first.rank}:${first.seq}`);
    return vehicle ? [{ ...vehicle, scheduled: first.scheduled }] : [];
  });
}

function vehicleFromChain(chain: BusEta[], bySeq: Map<number, BusRouteStop>, startDistance: number, now: number, id: string): BusVehicle | null {
  const first = chain[0]!, last = chain.at(-1)!;
  const firstStop = bySeq.get(first.seq)!;
  // A later observation elsewhere must not renew an older trajectory anchor.
  const validUntil = Math.min(...chain.map(eta => eta.observed)) + FRESH;
  if (now >= validUntil || chain.length === 1 && (firstStop.distance <= 0 || now >= last.at)) return null;
  const timeline = chain.map(eta => ({ distance: bySeq.get(eta.seq)!.distance, at: eta.at }));
  if (now < first.at && firstStop.distance > startDistance) {
    const second = timeline[1];
    const speed = second ? (second.distance - firstStop.distance) / ((second.at - first.at) / 1000) : 6;
    if (!(speed > 0) || speed > 25) return null;
    timeline.unshift({ distance: startDistance, at: first.at - (firstStop.distance - startDistance) / speed * 1000 });
  }
  if (timeline.length < 2) return null;
  const next = timeline.findIndex(point => point.at > now);
  const index = next < 0 ? timeline.length - 2 : Math.max(0, next - 1);
  const from = timeline[index], to = timeline[index + 1];
  return { id, fromDistance: from.distance, toDistance: to.distance, departureAt: from.at, arrivalAt: to.at, validUntil, timeline };
}

