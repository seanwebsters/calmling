import type { AnimationId, DayPhase, LocationId, NeedKey, SimState, TraitKey, WorldObject } from './types';

export type ActionCategory = 'rest' | 'food' | 'care' | 'creative' | 'explore' | 'social' | 'play' | 'ambient' | 'move';

export type EffectId =
  | 'sleep'
  | 'eat_apple'
  | 'water'
  | 'tend'
  | 'plant'
  | 'paint'
  | 'sketch'
  | 'read'
  | 'fish'
  | 'explore'
  | 'inspect'
  | 'pick_up'
  | 'place'
  | 'photo'
  | 'notice_audience'
  | 'tea'
  | 'none';

export interface ActionDef {
  id: string;
  label: string;
  /** "Reads", "Waters plants" — used for habit labels */
  habitLabel: string;
  /** "reading", "sleeping" — used for sequence habit labels */
  gerund: string;
  goal: string;
  category: ActionCategory;
  animation: AnimationId;
  /** Where the action can happen. 'target' = at the target object's location. */
  at: LocationId[] | 'target' | 'any';
  targetTags?: string[];
  targetFilter?: (o: WorldObject, s: SimState) => boolean;
  /** a tool (by tag) Calmling needs */
  tool?: string;
  /** true: the tool must be held (planner fetches it); false: act where the tool is */
  toolHeld?: boolean;
  duration: [number, number];
  satisfies: Partial<Record<NeedKey, number>>;
  traits: Partial<Record<TraitKey, number>>;
  phases?: DayPhase[];
  preferPhases?: DayPhase[];
  outdoor?: boolean;
  minEnergy?: number;
  interruptible: boolean;
  effect: EffectId;
  /** not a free choice; only used inside plans or automatically */
  internal?: boolean;
}

const plant = (o: WorldObject) => o.tags.includes('plant') && o.heldBy === null && o.state.water !== undefined;

export const ACTIONS: Record<string, ActionDef> = {
  walk: {
    id: 'walk', label: 'walk', habitLabel: 'Walks', gerund: 'walking', goal: 'travel', category: 'move', animation: 'walking',
    at: 'any', duration: [1, 1], satisfies: { energy: -1 }, traits: {}, interruptible: true, effect: 'none', internal: true,
  },
  pick_up: {
    id: 'pick_up', label: 'pick up', habitLabel: 'Picks up things', gerund: 'picking things up', goal: 'carry', category: 'move', animation: 'picking_up',
    at: 'target', duration: [1, 1], satisfies: {}, traits: {}, interruptible: false, effect: 'pick_up', internal: true,
  },
  put_down: {
    id: 'put_down', label: 'put down', habitLabel: 'Puts things down', gerund: 'putting things down', goal: 'carry', category: 'move', animation: 'picking_up',
    at: 'any', duration: [1, 1], satisfies: {}, traits: {}, interruptible: false, effect: 'place', internal: true,
  },
  notice: {
    id: 'notice', label: 'notice something', habitLabel: 'Notices things', gerund: 'noticing things', goal: 'notice', category: 'ambient', animation: 'react_surprised',
    at: 'any', duration: [1, 2], satisfies: { curiosity: 4 }, traits: {}, interruptible: false, effect: 'none', internal: true,
  },
  pause: {
    id: 'pause', label: 'pause for a moment', habitLabel: 'Pauses', gerund: 'pausing', goal: 'pause', category: 'ambient', animation: 'resting',
    at: 'any', duration: [5, 10], satisfies: { comfort: 2 }, traits: {}, interruptible: true, effect: 'none', internal: true,
  },
  wake_up: {
    id: 'wake_up', label: 'wake up and stretch', habitLabel: 'Stretches', gerund: 'stretching', goal: 'start_the_day', category: 'ambient', animation: 'stretching',
    at: 'any', duration: [3, 5], satisfies: { comfort: 4 }, traits: {}, interruptible: false, effect: 'none', internal: true,
  },

  sleep: {
    id: 'sleep', label: 'go to sleep', habitLabel: 'Sleeps', gerund: 'sleeping', goal: 'rest', category: 'rest', animation: 'sleeping',
    at: 'target', targetTags: ['sleep'], duration: [380, 520], satisfies: { energy: 85, comfort: 20, happiness: 4 }, traits: { patience: 0.1 },
    preferPhases: ['night'], interruptible: false, effect: 'sleep',
  },
  rest: {
    id: 'rest', label: 'sit and rest', habitLabel: 'Rests', gerund: 'resting', goal: 'rest', category: 'rest', animation: 'resting',
    at: 'target', targetTags: ['seat', 'rest'], duration: [20, 45], satisfies: { energy: 10, comfort: 18 }, traits: { patience: 0.4 },
    interruptible: true, effect: 'none',
  },
  eat_snack: {
    id: 'eat_snack', label: 'eat something from the pantry', habitLabel: 'Eats', gerund: 'eating', goal: 'feed_self', category: 'food', animation: 'eating',
    at: 'target', targetTags: ['food_source'], duration: [12, 20], satisfies: { hunger: 50, comfort: 6, energy: 4 }, traits: {},
    interruptible: false, effect: 'none',
  },
  eat_apple: {
    id: 'eat_apple', label: 'pick and eat an apple', habitLabel: 'Eats apples', gerund: 'eating apples', goal: 'feed_self', category: 'food', animation: 'eating',
    at: 'target', targetTags: ['fruit_source'], targetFilter: (o) => (o.state.fruit ?? 0) > 0, duration: [8, 14],
    satisfies: { hunger: 40, happiness: 4 }, traits: { adventurousness: 0.1 }, outdoor: true, interruptible: false, effect: 'eat_apple',
  },
  drink_tea: {
    id: 'drink_tea', label: 'make a cup of tea', habitLabel: 'Drinks tea', gerund: 'drinking tea', goal: 'feel_cosy', category: 'rest', animation: 'drinking_tea',
    at: 'target', targetTags: ['tea'], duration: [15, 25], satisfies: { comfort: 22, happiness: 5, hunger: 6 }, traits: { patience: 0.3 },
    interruptible: true, effect: 'tea',
  },
  water_plant: {
    id: 'water_plant', label: 'water a plant', habitLabel: 'Waters', gerund: 'watering plants', goal: 'take_care_of_garden', category: 'care', animation: 'watering',
    at: 'target', targetTags: ['waterable', 'plant'], targetFilter: (o) => plant(o) && (o.state.water ?? 100) < 75,
    tool: 'water_tool', toolHeld: true, duration: [5, 9], satisfies: { happiness: 6, confidence: 3, energy: -2 }, traits: { patience: 0.3 },
    preferPhases: ['morning', 'evening'], outdoor: false, interruptible: true, effect: 'water',
  },
  tend_garden: {
    id: 'tend_garden', label: 'tend the garden', habitLabel: 'Tends the garden', gerund: 'gardening', goal: 'take_care_of_garden', category: 'care', animation: 'gardening',
    at: 'target', targetTags: ['plant'], targetFilter: (o) => plant(o) && o.location === 'garden', duration: [15, 30],
    satisfies: { happiness: 6, creativity: 6, energy: -4, confidence: 2 }, traits: { patience: 0.4, creativity: 0.1 }, outdoor: true, minEnergy: 20,
    interruptible: true, effect: 'tend',
  },
  plant_seed: {
    id: 'plant_seed', label: 'plant something', habitLabel: 'Plants things', gerund: 'planting', goal: 'grow_something', category: 'care', animation: 'gardening',
    at: ['garden'], tool: 'seed', toolHeld: true, duration: [10, 16], satisfies: { creativity: 15, happiness: 8, curiosity: 6, energy: -4 },
    traits: { patience: 0.4, creativity: 0.2 }, outdoor: true, minEnergy: 20, interruptible: false, effect: 'plant',
  },
  plant_flower: {
    id: 'plant_flower', label: 'plant a flower in the garden', habitLabel: 'Plants flowers', gerund: 'planting flowers', goal: 'grow_something', category: 'care', animation: 'gardening',
    at: ['garden'], tool: 'plantable', toolHeld: true, duration: [8, 14], satisfies: { creativity: 10, happiness: 8, energy: -3 },
    traits: { patience: 0.3, creativity: 0.2 }, outdoor: true, minEnergy: 20, interruptible: false, effect: 'plant',
  },
  paint: {
    id: 'paint', label: 'paint a picture', habitLabel: 'Paints', gerund: 'painting', goal: 'make_something', category: 'creative', animation: 'painting',
    at: 'any', tool: 'paint_tool', toolHeld: false, duration: [30, 60], satisfies: { creativity: 45, happiness: 10, confidence: 5, energy: -6 },
    traits: { creativity: 0.8, patience: 0.2 }, minEnergy: 25, interruptible: true, effect: 'paint',
  },
  sketch: {
    id: 'sketch', label: 'draw in the sketchbook', habitLabel: 'Sketches', gerund: 'sketching', goal: 'make_something', category: 'creative', animation: 'painting',
    at: 'any', tool: 'draw', toolHeld: false, duration: [20, 35], satisfies: { creativity: 28, happiness: 5, energy: -3 },
    traits: { creativity: 0.6, patience: 0.2 }, minEnergy: 15, interruptible: true, effect: 'sketch',
  },
  read: {
    id: 'read', label: 'read a book', habitLabel: 'Reads', gerund: 'reading', goal: 'learn_something', category: 'creative', animation: 'reading',
    at: 'target', targetTags: ['readable'], targetFilter: (o) => o.heldBy === null || o.heldBy === 'calmling', duration: [25, 50],
    satisfies: { curiosity: 16, comfort: 10, happiness: 5 }, traits: { curiosity: 0.4, patience: 0.4 }, preferPhases: ['evening'],
    interruptible: true, effect: 'read',
  },
  fish: {
    id: 'fish', label: 'go fishing', habitLabel: 'Fishes', gerund: 'fishing', goal: 'relax_by_the_water', category: 'play', animation: 'fishing',
    at: ['pond'], tool: 'fish_tool', toolHeld: true, duration: [30, 55], satisfies: { comfort: 10, curiosity: 10, happiness: 8, social: 8, hunger: 6, energy: -4 },
    traits: { patience: 0.7, adventurousness: 0.2 }, outdoor: true, minEnergy: 20, interruptible: true, effect: 'fish',
  },
  dance: {
    id: 'dance', label: 'dance', habitLabel: 'Dances', gerund: 'dancing', goal: 'have_fun', category: 'play', animation: 'dancing',
    at: 'any', duration: [6, 12], satisfies: { happiness: 14, creativity: 8, social: 6, energy: -8, confidence: 4 }, traits: { playfulness: 0.8, confidence: 0.3 },
    minEnergy: 35, interruptible: true, effect: 'none',
  },
  watch_sunset: {
    id: 'watch_sunset', label: 'watch the sunset', habitLabel: 'Watches the sunset', gerund: 'watching the sunset', goal: 'enjoy_the_evening', category: 'rest', animation: 'watching_sunset',
    at: 'target', targetTags: ['view'], targetFilter: (o) => !['home', 'bedroom'].includes(o.location), duration: [25, 40], satisfies: { comfort: 15, happiness: 12, curiosity: 4, social: 4 }, traits: { patience: 0.5 },
    phases: ['evening'], outdoor: true, interruptible: true, effect: 'none',
  },
  explore: {
    id: 'explore', label: 'explore the forest clearing', habitLabel: 'Explores', gerund: 'exploring', goal: 'discover_something', category: 'explore', animation: 'looking_around',
    at: ['forest'], duration: [20, 40], satisfies: { curiosity: 35, happiness: 5, energy: -8 }, traits: { adventurousness: 0.8, curiosity: 0.5 },
    outdoor: true, minEnergy: 30, phases: ['dawn', 'morning', 'afternoon', 'evening'], interruptible: true, effect: 'explore',
  },
  wander: {
    id: 'wander', label: 'wander around', habitLabel: 'Wanders', gerund: 'wandering', goal: 'look_around', category: 'explore', animation: 'looking_around',
    at: ['garden', 'pond', 'forest'], duration: [6, 12], satisfies: { curiosity: 12, comfort: 2, social: 4 }, traits: { adventurousness: 0.3, curiosity: 0.3 },
    outdoor: true, interruptible: true, effect: 'none',
  },
  inspect: {
    id: 'inspect', label: 'take a closer look', habitLabel: 'Inspects things', gerund: 'inspecting things', goal: 'understand_new_thing', category: 'explore', animation: 'inspecting',
    at: 'target', targetTags: ['inspectable'], targetFilter: (o) => !o.state.inspected, duration: [4, 8], satisfies: { curiosity: 22, confidence: 2 },
    traits: { curiosity: 0.6 }, interruptible: true, effect: 'inspect',
  },
  keep_object: {
    id: 'keep_object', label: 'carry it home to keep', habitLabel: 'Collects things', gerund: 'collecting things', goal: 'keep_something_special', category: 'care', animation: 'carrying',
    at: 'target', targetTags: ['collectible', 'decor', 'cuddle', 'readable', 'play', 'cup', 'plant'],
    targetFilter: (o) => o.heldBy === null && !!o.state.inspected && o.location !== 'home' && o.location !== 'bedroom' && !o.state.planted && !o.permanent,
    duration: [1, 2], satisfies: { comfort: 8, happiness: 6, curiosity: 3 }, traits: { curiosity: 0.2, patience: 0.1 }, interruptible: false, effect: 'place',
  },
  cuddle: {
    id: 'cuddle', label: 'cuddle', habitLabel: 'Cuddles', gerund: 'cuddling', goal: 'feel_cosy', category: 'social', animation: 'hugging',
    at: 'target', targetTags: ['cuddle'], duration: [6, 12], satisfies: { comfort: 18, social: 18, happiness: 8 }, traits: { sociability: 0.3 },
    interruptible: true, effect: 'none',
  },
  play: {
    id: 'play', label: 'play with a toy', habitLabel: 'Plays', gerund: 'playing', goal: 'have_fun', category: 'play', animation: 'playing',
    at: 'target', targetTags: ['play'], duration: [8, 16], satisfies: { happiness: 14, social: 4, creativity: 6, energy: -5 }, traits: { playfulness: 0.8 },
    minEnergy: 25, interruptible: true, effect: 'none',
  },
  take_photo: {
    id: 'take_photo', label: 'take a photo', habitLabel: 'Takes photos', gerund: 'taking photos', goal: 'make_something', category: 'creative', animation: 'photographing',
    at: ['garden', 'pond', 'forest'], tool: 'photo_tool', toolHeld: true, duration: [4, 8], satisfies: { creativity: 22, curiosity: 12, happiness: 6 },
    traits: { creativity: 0.5, curiosity: 0.3 }, outdoor: true, interruptible: true, effect: 'photo',
  },
  play_music: {
    id: 'play_music', label: 'play the piano', habitLabel: 'Plays music', gerund: 'playing music', goal: 'make_something', category: 'creative', animation: 'playing',
    at: 'target', targetTags: ['music'], duration: [15, 30], satisfies: { creativity: 35, happiness: 12, social: 5, energy: -3 },
    traits: { creativity: 0.6, confidence: 0.3 }, interruptible: true, effect: 'none',
  },
  stargaze: {
    id: 'stargaze', label: 'look at the stars', habitLabel: 'Stargazes', gerund: 'stargazing', goal: 'wonder', category: 'explore', animation: 'watching_sunset',
    at: 'target', targetTags: ['stargaze'], phases: ['night', 'evening'], duration: [20, 35], satisfies: { curiosity: 28, comfort: 8 },
    traits: { curiosity: 0.5, patience: 0.3 }, interruptible: true, effect: 'none',
  },
  notice_audience: {
    id: 'notice_audience', label: 'wave to the people watching', habitLabel: 'Waves to viewers', gerund: 'waving to viewers', goal: 'connect', category: 'social', animation: 'waving',
    at: 'any', duration: [2, 4], satisfies: { social: 30, happiness: 6, confidence: 3 }, traits: { sociability: 0.6, confidence: 0.2 },
    interruptible: true, effect: 'notice_audience',
  },
};

export const CHOOSABLE_ACTIONS = Object.values(ACTIONS).filter((a) => !a.internal);

export function actionDef(id: string): ActionDef {
  const a = ACTIONS[id];
  if (!a) throw new Error(`Unknown action ${id}`);
  return a;
}
