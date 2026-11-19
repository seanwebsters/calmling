import type { PublicFrame, SimState } from './types';
import { clockString, dayOf, daylight, phaseOf } from './world';

export function toPublicFrame(s: SimState): PublicFrame {
  const c = s.character;
  return {
    seq: s.seq,
    tick: s.tick,
    minute: s.minute,
    day: dayOf(s.minute),
    timeOfDay: clockString(s.minute),
    phase: phaseOf(s.minute),
    daylight: daylight(s.minute),
    weather: s.env.weather,
    paused: s.paused,
    character: {
      location: c.location,
      x: c.x,
      facing: c.facing,
      mood: c.mood,
      awake: c.awake,
      heldObjectId: c.heldObjectId,
      needs: { ...c.needs },
      goal: c.goal,
      activity: c.activity ? { ...c.activity } : null,
    },
    objects: Object.values(s.objects).map((o) => ({ ...o, state: { ...o.state }, tags: [...o.tags], origin: { ...o.origin } })),
  };
}

/** Position of Calmling at an arbitrary (possibly extrapolated) minute. */
export function characterXAt(frame: PublicFrame, minute: number): number {
  const a = frame.character.activity;
  if (a && a.action === 'walk' && a.fromX !== undefined && a.toX !== undefined) {
    const t = Math.min(1, Math.max(0, (minute - a.startedAt) / Math.max(0.0001, a.endsAt - a.startedAt)));
    return a.fromX + (a.toX - a.fromX) * t;
  }
  return frame.character.x;
}
