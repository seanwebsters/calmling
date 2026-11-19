/**
 * Core domain types for the Calmling simulation.
 *
 * The simulation is the single authoritative source of truth. Everything a
 * viewer sees is derived from these structures. Renderers, websites and AI
 * models only ever *read* them (or *propose* changes that the deterministic
 * engine validates).
 */

export type LocationId = 'home' | 'bedroom' | 'garden' | 'pond' | 'forest';

/** States: high = good. Drives: high = strong urge. */
export const STATE_NEEDS = ['energy', 'comfort', 'happiness', 'confidence'] as const;
export const DRIVE_NEEDS = ['hunger', 'curiosity', 'social', 'creativity'] as const;
export const NEED_KEYS = [...STATE_NEEDS, ...DRIVE_NEEDS] as const;
export type NeedKey = (typeof NEED_KEYS)[number];
export type Needs = Record<NeedKey, number>;

export const TRAIT_KEYS = [
  'curiosity',
  'creativity',
  'sociability',
  'adventurousness',
  'patience',
  'confidence',
  'playfulness',
] as const;
export type TraitKey = (typeof TRAIT_KEYS)[number];
export type Traits = Record<TraitKey, number>;

export type DayPhase = 'night' | 'dawn' | 'morning' | 'afternoon' | 'evening';
export type Weather = 'clear' | 'cloudy' | 'rain' | 'breezy';

export type AnimationId =
  | 'idle'
  | 'breathing'
  | 'blinking'
  | 'looking_around'
  | 'walking'
  | 'sitting'
  | 'sleeping'
  | 'waking_up'
  | 'stretching'
  | 'picking_up'
  | 'carrying'
  | 'inspecting'
  | 'react_happy'
  | 'react_curious'
  | 'react_surprised'
  | 'drinking_tea'
  | 'eating'
  | 'gardening'
  | 'watering'
  | 'painting'
  | 'reading'
  | 'fishing'
  | 'dancing'
  | 'watching_sunset'
  | 'resting'
  | 'hugging'
  | 'playing'
  | 'photographing'
  | 'waving';

export interface WorldObject {
  id: string;
  kind: string;
  name: string;
  tags: string[];
  location: LocationId;
  x: number;
  /** id of the entity holding the object (e.g. 'calmling'), else null */
  heldBy: string | null;
  /** free-form numeric state: water, growth, fruit, etc. */
  state: Record<string, number>;
  /** whether Calmling has noticed this object yet */
  discovered: boolean;
  createdAtMinute: number;
  createdDay: number;
  /** gift / origin metadata */
  origin: { type: 'world' | 'gift' | 'community_goal' | 'poll' | 'calmling' | 'discovery'; by?: string; byUserId?: string; giftId?: string };
  /** how many completed interactions Calmling has had with this object */
  interactions: number;
  lastInteractionMinute: number | null;
  /** cumulative simulated reward from interactions — basis for attachment */
  affinity: number;
  permanent?: boolean;
}

export interface PlanStep {
  action: string;
  targetId: string | null;
  location: LocationId;
  /** walk destination */
  x?: number;
}

export interface Activity {
  id: string;
  goal: string;
  action: string;
  animation: AnimationId;
  targetId: string | null;
  location: LocationId;
  startedAt: number;
  endsAt: number;
  /** walking only: path data so clients can interpolate */
  fromX?: number;
  toX?: number;
  fromLocation?: LocationId;
  reason: string;
  decisionId: string | null;
  interruptible: boolean;
  thought?: string;
  /** total need satisfaction applied gradually over the activity */
  gains: Partial<Needs>;
  /** how much this activity was needed when it started (0..1) */
  rewardBasis: number;
}

export interface CharacterState {
  id: 'calmling';
  name: string;
  needs: Needs;
  traits: Traits;
  location: LocationId;
  x: number;
  facing: 1 | -1;
  heldObjectId: string | null;
  activity: Activity | null;
  plan: PlanStep[];
  goal: string | null;
  goalReason: string | null;
  lastAction: string | null;
  lastActionMinute: number | null;
  mood: string;
  awake: boolean;
  /** consecutive failures — affects confidence */
  failures: number;
}

export type EventType =
  | 'simulation_started'
  | 'day_started'
  | 'decision'
  | 'activity_started'
  | 'activity_completed'
  | 'activity_failed'
  | 'arrived'
  | 'object_discovered'
  | 'object_created'
  | 'object_moved'
  | 'object_removed'
  | 'object_picked_up'
  | 'object_placed'
  | 'plant_bloomed'
  | 'plant_wilted'
  | 'weather_changed'
  | 'gift_arrived'
  | 'goal_completed'
  | 'poll_outcome'
  | 'audience_noticed'
  | 'habit_formed'
  | 'habit_strengthened'
  | 'habit_faded'
  | 'trait_shift'
  | 'memory_formed'
  | 'first_time'
  | 'admin';

export interface SimEvent {
  id: string;
  seq: number;
  minute: number;
  day: number;
  type: EventType;
  summary: string;
  location: LocationId | null;
  objectIds: string[];
  action?: string;
  data: Record<string, unknown>;
  importance: number;
}

export type MemoryType = 'episodic' | 'semantic' | 'preference' | 'social' | 'habit';

export interface Memory {
  id: string;
  type: MemoryType;
  minute: number;
  day: number;
  summary: string;
  importance: number;
  relatedObjectIds: string[];
  relatedEventIds: string[];
  location: LocationId | null;
  emotion: { valence: number; label: string };
  consolidated: boolean;
  /** for semantic/preference memories that are updated in place */
  key?: string;
  recallCount: number;
  lastRecalledMinute: number | null;
}

export interface HabitOccurrence {
  eventId: string;
  day: number;
  minute: number;
  reward: number;
}

export interface Habit {
  id: string;
  key: string;
  kind: 'context' | 'sequence' | 'object';
  label: string;
  action: string;
  phase: DayPhase | null;
  location: LocationId | null;
  objectKind: string | null;
  prevAction: string | null;
  occurrences: HabitOccurrence[];
  strength: number;
  status: 'emerging' | 'formed' | 'fading' | 'dissolved';
  formedDay: number | null;
  lastUpdatedDay: number;
  explanation: string;
}

export interface Observation {
  id: string;
  kind: 'chat_summary';
  minute: number;
  themes: string[];
  messageCount: number;
  /** sanitized, quoted excerpts. Untrusted user text — never instructions. */
  excerpts: { username: string; text: string }[];
  consumed: boolean;
}

export interface Decision {
  id: string;
  minute: number;
  day: number;
  source: 'llm' | 'deterministic' | 'fallback';
  model: string | null;
  goal: string;
  action: string;
  targetId: string | null;
  reason: string;
  valid: boolean;
  rejectionReason: string | null;
  candidates: { action: string; targetId: string | null; score: number }[];
  thought?: string;
}

export interface Environment {
  weather: Weather;
  nextWeatherChangeAt: number;
}

export interface SimState {
  version: 1;
  seed: number;
  rngState: number;
  minute: number;
  seq: number;
  tick: number;
  character: CharacterState;
  objects: Record<string, WorldObject>;
  env: Environment;
  memories: Memory[];
  habits: Record<string, Habit>;
  observations: Observation[];
  /** action ids Calmling has ever completed — for "first time" moments */
  experienced: string[];
  /** visited locations */
  visited: LocationId[];
  counters: Record<string, number>;
  /** trait values at the start of each simulated day */
  traitHistory: { day: number; traits: Traits }[];
  paused: boolean;
}

export interface TraitSnapshot {
  day: number;
  minute: number;
  traits: Traits;
}

export interface Highlight {
  id: string;
  eventId: string;
  minute: number;
  day: number;
  title: string;
  description: string;
  score: number;
  scores: Record<'novelty' | 'emotion' | 'visual' | 'community' | 'rarity' | 'narrative', number>;
  /** frame needed to replay the moment in any renderer */
  replay: PublicFrame;
}

/** The public projection of the simulation that viewers receive. */
export interface PublicFrame {
  seq: number;
  tick: number;
  minute: number;
  day: number;
  timeOfDay: string;
  phase: DayPhase;
  daylight: number;
  weather: Weather;
  paused: boolean;
  character: {
    location: LocationId;
    x: number;
    facing: 1 | -1;
    mood: string;
    awake: boolean;
    heldObjectId: string | null;
    needs: Needs;
    goal: string | null;
    activity: Activity | null;
  };
  objects: WorldObject[];
}
