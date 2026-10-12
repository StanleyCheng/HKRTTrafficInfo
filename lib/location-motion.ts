export type LocationPoint = [latitude: number, longitude: number];
type FrameClock = { now: () => number; request: (callback: FrameRequestCallback) => number; cancel: (id: number) => void };

// Follow the incoming GPS cadence, without leaving the confirmed fix more than
// one second behind. Linear motion avoids braking and restarting at each fix.
export const locationTransitionDuration = (elapsed: number) => Math.max(150, Math.min(1000, Number.isFinite(elapsed) ? elapsed : 1000));

export function createLocationMotion(render: (point: LocationPoint) => void, clock: FrameClock = {
  now: () => performance.now(),
  request: callback => requestAnimationFrame(callback),
  cancel: id => cancelAnimationFrame(id),
}) {
  let current: LocationPoint | undefined;
  let target: LocationPoint | undefined;
  let frame: number | undefined;
  let revision = 0;
  let disposed = false;
  const cancel = () => {
    revision++;
    if (frame !== undefined) clock.cancel(frame);
    frame = undefined;
  };
  const draw = (point: LocationPoint) => { current = point; render(point); };
  const moveTo = (point: LocationPoint, duration: number) => {
    if (disposed) return;
    cancel();
    target = [...point];
    if (!current || duration <= 0 || !Number.isFinite(duration) || current[0] === target[0] && current[1] === target[1]) {
      draw(target);
      return;
    }
    const from = current, to = target, started = clock.now(), active = revision;
    const tick = (at: number) => {
      if (disposed || active !== revision) return;
      frame = undefined;
      const progress = Math.max(0, Math.min(1, (at - started) / duration));
      // Never project speed or heading beyond a confirmed fix. A new fix starts
      // from the displayed position, including when it interrupts this frame.
      draw(progress === 1 ? to : [from[0] + (to[0] - from[0]) * progress, from[1] + (to[1] - from[1]) * progress]);
      if (progress < 1 && !disposed && active === revision) frame = clock.request(tick);
    };
    frame = clock.request(tick);
  };
  return {
    moveTo,
    finish: () => { if (target) moveTo(target, 0); },
    dispose: () => { disposed = true; cancel(); },
  };
}
