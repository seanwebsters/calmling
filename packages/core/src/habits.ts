import { ACTIONS } from './actions';
import type { DayPhase, Habit, LocationId, SimState } from './types';
import { LOCATIONS } from './world';

/**
 * Habit engine. Nothing here knows which habits Calmling "should" have.
 * Every completed activity is recorded under a few context keys; a habit
 * emerges only when the same behaviour repeats on several different days in a
 * similar context and keeps being rewarding. Habits decay when the behaviour
 * stops.
 */

export const HABIT_RULES = {
  windowDays: 14,
  consistencyDays: 7,
  halfLifeDays: 4,
  formMinDistinctDays: 4,
  formMinOccurrences: 5,
  formStrength: 35,
  fadeStrength: 14,
  dissolveStrength: 6,
  maxOccurrences: 40,
};

const PHASE_LABEL: Record<DayPhase, string> = {
  night: 'at night',
  dawn: 'at dawn',
  morning: 'in the morning',
  afternoon: 'in the afternoon',
  evening: 'in the evening',
};

export interface HabitObservation {
  eventId: string;
  action: string;
  phase: DayPhase;
  location: LocationId;
  objectId: string | null;
  objectName: string | null;
  objectKind: string | null;
  prevAction: string | null;
  /** whether other objects could have served the same purpose */
  hasAlternatives: boolean;
  reward: number;
  day: number;
  minute: number;
}

function keysFor(o: HabitObservation): Omit<Habit, 'occurrences' | 'strength' | 'status' | 'formedDay' | 'lastUpdatedDay' | 'explanation' | 'id'>[] {
  const a = ACTIONS[o.action];
  const out: Omit<Habit, 'occurrences' | 'strength' | 'status' | 'formedDay' | 'lastUpdatedDay' | 'explanation' | 'id'>[] = [];
  const locName = LOCATIONS[o.location].name.toLowerCase();
  if (o.action !== 'sleep') out.push({
    key: `ctx:${o.action}:${o.phase}:${o.location}`,
    kind: 'context',
    label: `${a.habitLabel} ${PHASE_LABEL[o.phase]} (${locName})`,
    action: o.action,
    phase: o.phase,
    location: o.location,
    objectKind: null,
    prevAction: null,
  });
  // attachment to a particular object only means something if alternatives exist
  if (o.objectId && o.objectName && o.hasAlternatives) {
    out.push({
      key: `obj:${o.action}:${o.objectId}`,
      kind: 'object',
      label: `${a.habitLabel} — always the ${o.objectName.toLowerCase()}`,
      action: o.action,
      phase: null,
      location: o.location,
      objectKind: o.objectKind,
      prevAction: null,
    });
  }
  if (o.prevAction && o.prevAction !== o.action && ACTIONS[o.prevAction] && !ACTIONS[o.prevAction].internal) {
    out.push({
      key: `seq:${o.prevAction}>${o.action}`,
      kind: 'sequence',
      label: `${ACTIONS[o.prevAction].habitLabel} before ${a.gerund}`,
      action: o.action,
      phase: null,
      location: null,
      objectKind: null,
      prevAction: o.prevAction,
    });
  }
  return out;
}

export function computeStrength(h: Habit, today: number): { strength: number; distinctRecent: number; avgReward: number } {
  const R = HABIT_RULES;
  let sum = 0;
  let rewardSum = 0;
  let n = 0;
  const days = new Set<number>();
  for (const occ of h.occurrences) {
    const age = today - occ.day;
    if (age > R.windowDays) continue;
    const w = Math.pow(0.5, age / R.halfLifeDays);
    sum += w * (0.6 + occ.reward);
    rewardSum += occ.reward;
    n++;
    if (age < R.consistencyDays) days.add(occ.day);
  }
  const consistency = Math.min(1, days.size / 4);
  // repeated same-day occurrences count, but only consistency across days forms a habit
  const strength = Math.min(100, sum * 9 * (0.35 + 0.65 * consistency));
  return { strength: Math.round(strength * 10) / 10, distinctRecent: days.size, avgReward: n ? rewardSum / n : 0 };
}

export function explain(h: Habit, today: number): string {
  // explanation is regenerated from stored evidence every evaluation
  const { distinctRecent, avgReward } = computeStrength(h, today);
  const recent = h.occurrences.filter((o) => today - o.day < HABIT_RULES.consistencyDays).length;
  const base = `Seen ${recent} time${recent === 1 ? '' : 's'} on ${distinctRecent} different day${distinctRecent === 1 ? '' : 's'} in the last week`;
  const ctx = h.kind === 'sequence' ? `, each time right after ${ACTIONS[h.prevAction!]?.gerund ?? h.prevAction}` : h.kind === 'object' ? ', always with the same object' : '';
  return `${base}${ctx}. Average simulated reward ${avgReward.toFixed(2)}. Strength ${h.strength.toFixed(1)} (forms at ${HABIT_RULES.formStrength} with ≥${HABIT_RULES.formMinDistinctDays} distinct days and ≥${HABIT_RULES.formMinOccurrences} occurrences; fades below ${HABIT_RULES.fadeStrength}).`;
}

export type HabitChange = { habit: Habit; change: 'formed' | 'strengthened' | 'fading' | 'dissolved' | 'reformed' };

function evaluate(h: Habit, today: number): HabitChange['change'] | null {
  const R = HABIT_RULES;
  const { strength, distinctRecent } = computeStrength(h, today);
  const prevStrength = h.strength;
  h.strength = strength;
  h.lastUpdatedDay = today;
  let change: HabitChange['change'] | null = null;
  if ((h.status === 'emerging' || h.status === 'dissolved') && distinctRecent >= R.formMinDistinctDays && h.occurrences.length >= R.formMinOccurrences && strength >= R.formStrength) {
    change = h.status === 'dissolved' ? 'reformed' : 'formed';
    h.status = 'formed';
    h.formedDay = today;
  } else if (h.status === 'fading' && strength >= R.formStrength) {
    h.status = 'formed';
    change = 'strengthened';
  } else if (h.status === 'formed' && strength < R.fadeStrength) {
    h.status = 'fading';
    change = 'fading';
  } else if (h.status === 'fading' && strength < R.dissolveStrength) {
    h.status = 'dissolved';
    change = 'dissolved';
  } else if (h.status === 'formed' && Math.floor(strength / 20) > Math.floor(prevStrength / 20) && strength >= 40) {
    change = 'strengthened';
  }
  h.explanation = explain(h, today);
  return change;
}

export function recordHabitObservation(s: SimState, o: HabitObservation): HabitChange[] {
  const changes: HabitChange[] = [];
  for (const k of keysFor(o)) {
    let h = s.habits[k.key];
    if (!h) {
      h = { ...k, id: `habit_${Object.keys(s.habits).length + 1}_${k.key.length}`, occurrences: [], strength: 0, status: 'emerging', formedDay: null, lastUpdatedDay: o.day, explanation: '' };
      h.id = `habit_${hashKey(k.key)}`;
      s.habits[k.key] = h;
    }
    h.occurrences.push({ eventId: o.eventId, day: o.day, minute: o.minute, reward: Math.round(o.reward * 100) / 100 });
    if (h.occurrences.length > HABIT_RULES.maxOccurrences) h.occurrences.splice(0, h.occurrences.length - HABIT_RULES.maxOccurrences);
    const ch = evaluate(h, o.day);
    if (ch) changes.push({ habit: h, change: ch });
  }
  return changes;
}

/** Daily maintenance: decay, fade and prune. */
export function dailyHabitReview(s: SimState, today: number): HabitChange[] {
  const changes: HabitChange[] = [];
  for (const [key, h] of Object.entries(s.habits)) {
    const ch = evaluate(h, today);
    if (ch) changes.push({ habit: h, change: ch });
    const last = h.occurrences[h.occurrences.length - 1];
    if (h.status === 'emerging' && (!last || today - last.day > HABIT_RULES.windowDays)) delete s.habits[key];
  }
  return changes;
}

export function activeHabits(s: SimState): Habit[] {
  return Object.values(s.habits)
    .filter((h) => h.status === 'formed' || h.status === 'fading')
    .sort((a, b) => b.strength - a.strength);
}

/** How much habits pull Calmling towards an action in the current context (0..~1). */
export function habitPull(s: SimState, action: string, phase: DayPhase, location: LocationId, objectId: string | null): { pull: number; habit: Habit | null } {
  let best = 0;
  let bestH: Habit | null = null;
  const prev = s.character.lastAction;
  const recentPrev = s.character.lastActionMinute !== null && s.minute - s.character.lastActionMinute < 90;
  for (const h of Object.values(s.habits)) {
    if (h.action !== action || (h.status !== 'formed' && h.status !== 'fading')) continue;
    let match = false;
    if (h.kind === 'context') match = h.phase === phase;
    else if (h.kind === 'object') match = objectId !== null && h.key.endsWith(`:${objectId}`);
    else if (h.kind === 'sequence') match = recentPrev && h.prevAction === prev;
    if (!match) continue;
    const pull = (h.strength / 100) * (h.kind === 'context' && h.location !== location ? 0.7 : 1);
    if (pull > best) {
      best = pull;
      bestH = h;
    }
  }
  return { pull: best, habit: bestH };
}

function hashKey(k: string): string {
  let h = 5381;
  for (let i = 0; i < k.length; i++) h = ((h << 5) + h + k.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
