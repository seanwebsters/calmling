import { DRIVE_NEEDS, NEED_KEYS, type NeedKey, type Needs } from './types';
import { clamp } from './rng';

export const DRIVES = new Set<NeedKey>(DRIVE_NEEDS);

export function initialNeeds(): Needs {
  return { energy: 80, comfort: 70, happiness: 65, confidence: 55, hunger: 30, curiosity: 55, social: 35, creativity: 40 };
}

/** How strongly a need is pulling on Calmling right now, 0..1. */
export function pressure(needs: Needs, k: NeedKey): number {
  const v = needs[k];
  return DRIVES.has(k) ? v / 100 : (100 - v) / 100;
}

/**
 * Apply a "satisfaction" amount. Positive values are always good for Calmling:
 * they raise states (energy, comfort…) and relieve drives (hunger, curiosity…).
 */
export function satisfy(needs: Needs, k: NeedKey, amount: number): void {
  needs[k] = clamp(DRIVES.has(k) ? needs[k] - amount : needs[k] + amount);
}

/** Passive change per simulated minute. Rates soften near the extremes so the
 * character becomes motivated without spiralling into distress. */
const DRIFT: Record<NeedKey, number> = {
  energy: -0.055,
  comfort: -0.025,
  happiness: 0,
  confidence: 0,
  hunger: 0.055,
  curiosity: 0.06,
  social: 0.018,
  creativity: 0.04,
};

export function driftNeeds(needs: Needs, minutes: number, asleep: boolean): void {
  for (const k of NEED_KEYS) {
    let rate = DRIFT[k];
    if (asleep && (k === 'curiosity' || k === 'social' || k === 'creativity')) rate *= 0.2;
    if (asleep && k === 'hunger') rate *= 0.4;
    if (asleep && k === 'energy') rate = 0; // sleep action restores energy itself
    if (rate === 0) continue;
    const v = needs[k];
    // soften: urges slow down as they approach 95, states as they approach 8
    const soft = rate > 0 ? Math.max(0.05, (95 - v) / 95) : Math.max(0.05, (v - 8) / 92);
    needs[k] = clamp(v + rate * soft * minutes);
  }
  // happiness gently tracks overall wellbeing; confidence drifts to a resting level
  const wellbeing =
    (needs.energy + needs.comfort + (100 - needs.hunger) + (100 - needs.social * 0.6) + (100 - needs.creativity * 0.5) + (100 - needs.curiosity * 0.5)) / 6;
  needs.happiness = clamp(needs.happiness + (wellbeing - needs.happiness) * 0.004 * minutes);
  needs.confidence = clamp(needs.confidence + (60 - needs.confidence) * 0.0008 * minutes);
}

export function moodOf(needs: Needs, awake: boolean): string {
  if (!awake) return 'asleep';
  if (needs.energy < 22) return 'sleepy';
  if (needs.hunger > 72) return 'peckish';
  if (needs.happiness > 82) return 'joyful';
  if (needs.curiosity > 72) return 'curious';
  if (needs.creativity > 72) return 'inspired';
  if (needs.social > 70) return 'wistful';
  if (needs.comfort < 30) return 'restless';
  if (needs.confidence < 30) return 'unsure';
  if (needs.happiness > 66) return 'content';
  if (needs.happiness < 35) return 'quiet';
  return 'calm';
}
