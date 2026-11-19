import { ACTIONS } from './actions';
import { clamp } from './rng';
import { TRAIT_KEYS, type SimState, type TraitKey, type Traits } from './types';

export function initialTraits(): Traits {
  return { curiosity: 62, creativity: 55, sociability: 48, adventurousness: 45, patience: 58, confidence: 50, playfulness: 52 };
}

const RATE = 0.06;

/** Gradual, measurable trait change from lived experience. Never a rewrite. */
export function evolveTraits(s: SimState, action: string, reward: number, succeeded: boolean): void {
  const def = ACTIONS[action];
  if (!def) return;
  const t = s.character.traits;
  for (const [k, aff] of Object.entries(def.traits) as [TraitKey, number][]) {
    // rewarding experiences reinforce the traits they express; unrewarding ones barely move them
    const delta = aff * RATE * (reward - 0.15) * 2;
    t[k] = clamp(t[k] + delta, 5, 95);
  }
  if (!succeeded) t.confidence = clamp(t.confidence - 0.12, 5, 95);
  else if (reward > 0.5) t.confidence = clamp(t.confidence + 0.02, 5, 95);
}

const PHRASES: Record<TraitKey, [string, string]> = {
  curiosity: ['more curious', 'less curious'],
  creativity: ['more creative', 'less drawn to making things'],
  sociability: ['more sociable', 'more private'],
  adventurousness: ['more adventurous', 'more of a homebody'],
  patience: ['more patient', 'less patient'],
  confidence: ['more confident', 'less sure of itself'],
  playfulness: ['more playful', 'more serious'],
};

export interface TraitTrend {
  trait: TraitKey;
  delta: number;
  fromDay: number;
  toDay: number;
  statement: string;
}

/**
 * Only produces statements that the stored history supports: a trait must have
 * moved by at least `minDelta` points between two recorded days.
 */
export function traitTrends(history: { day: number; traits: Traits }[], current: Traits, currentDay: number, windowDays = 30, minDelta = 2): TraitTrend[] {
  if (!history.length) return [];
  const fromDay = Math.max(1, currentDay - windowDays);
  const base = history.find((h) => h.day >= fromDay) ?? history[0];
  if (!base || base.day >= currentDay) return [];
  const span = currentDay - base.day;
  const out: TraitTrend[] = [];
  for (const k of TRAIT_KEYS) {
    const delta = current[k] - base.traits[k];
    if (Math.abs(delta) < minDelta) continue;
    out.push({
      trait: k,
      delta: Math.round(delta * 10) / 10,
      fromDay: base.day,
      toDay: currentDay,
      statement: `Calmling has become ${PHRASES[k][delta > 0 ? 0 : 1]} over the last ${span} day${span === 1 ? '' : 's'} (${base.traits[k].toFixed(1)} → ${current[k].toFixed(1)}).`,
    });
  }
  return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}
