import type { DayPhase, LocationId, WorldObject } from './types';

export const MINUTES_PER_DAY = 1440;

export interface LocationDef {
  id: LocationId;
  name: string;
  /** horizontal extent on the island panorama, world units 0..1000 */
  x0: number;
  x1: number;
  indoor: boolean;
  description: string;
}

/** The island is laid out as a panorama: forest – garden – home/bedroom – pond. */
export const LOCATIONS: Record<LocationId, LocationDef> = {
  forest: { id: 'forest', name: 'Forest clearing', x0: 0, x1: 220, indoor: false, description: 'A mossy clearing ringed by tall pines.' },
  garden: { id: 'garden', name: 'Garden', x0: 220, x1: 470, indoor: false, description: 'Soft soil, an apple tree and a little shed.' },
  home: { id: 'home', name: 'Home', x0: 470, x1: 610, indoor: true, description: 'A round cottage with a kettle and a reading chair.' },
  bedroom: { id: 'bedroom', name: 'Bedroom', x0: 610, x1: 720, indoor: true, description: 'A small room with a bed under a round window.' },
  pond: { id: 'pond', name: 'Pond', x0: 720, x1: 1000, indoor: false, description: 'A still pond with lily pads and a wooden jetty.' },
};

export const LOCATION_IDS = Object.keys(LOCATIONS) as LocationId[];

export function locationAt(x: number): LocationId {
  for (const l of LOCATION_IDS) {
    const d = LOCATIONS[l];
    if (x >= d.x0 && x < d.x1) return l;
  }
  return x < 0 ? 'forest' : 'pond';
}

export function locationCenter(id: LocationId): number {
  const d = LOCATIONS[id];
  return (d.x0 + d.x1) / 2;
}

/** walking speed in world units per simulated minute */
export const WALK_SPEED = 30;

export function phaseOf(minute: number): DayPhase {
  const m = ((minute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const h = m / 60;
  if (h < 5 || h >= 22) return 'night';
  if (h < 7) return 'dawn';
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

export function dayOf(minute: number): number {
  return Math.floor(minute / MINUTES_PER_DAY) + 1;
}

export function minuteOfDay(minute: number): number {
  return ((minute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

export function clockString(minute: number): string {
  const m = Math.floor(minuteOfDay(minute));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** 0 at night, 1 at midday, smooth around dawn and dusk */
export function daylight(minute: number): number {
  const h = minuteOfDay(minute) / 60;
  if (h < 5 || h >= 21.5) return 0;
  if (h < 7.5) return (h - 5) / 2.5;
  if (h > 18.5) return Math.max(0, (21.5 - h) / 3);
  return 1;
}

export function isSunset(minute: number): boolean {
  const h = minuteOfDay(minute) / 60;
  return h >= 18 && h < 20.5;
}

export interface ObjectKindDef {
  kind: string;
  name: string;
  description: string;
  category: 'nature' | 'comfort' | 'creative' | 'tool' | 'toy' | 'furniture' | 'food' | 'structure' | 'collectible';
  tags: string[];
  /** default allowed locations for placement */
  emoji: string;
  /** can it be carried? */
  portable: boolean;
  giftable?: boolean;
  pollOnly?: boolean;
  initialState?: Record<string, number>;
}

/**
 * Object catalogue. Interaction tags drive which actions may target an object;
 * nothing is scripted per individual object.
 */
export const OBJECT_KINDS: Record<string, ObjectKindDef> = {
  // world furniture & fixtures
  bed: { kind: 'bed', name: 'Bed', description: 'A soft bed with a patchwork quilt.', category: 'furniture', tags: ['sleep', 'rest'], emoji: '🛏️', portable: false },
  armchair: { kind: 'armchair', name: 'Reading chair', description: 'A worn, comfortable armchair.', category: 'furniture', tags: ['seat', 'rest'], emoji: '🪑', portable: false },
  kettle: { kind: 'kettle', name: 'Kettle', description: 'A little copper kettle.', category: 'tool', tags: ['tea'], emoji: '🫖', portable: false },
  pantry: { kind: 'pantry', name: 'Pantry', description: 'Shelves of oats, honey and jam.', category: 'furniture', tags: ['food_source'], emoji: '🥫', portable: false },
  bookshelf: { kind: 'bookshelf', name: 'Bookshelf', description: 'A shelf for keeping treasures.', category: 'furniture', tags: ['shelf'], emoji: '📚', portable: false },
  bench: { kind: 'bench', name: 'Bench', description: 'A wooden bench facing west.', category: 'furniture', tags: ['seat', 'rest', 'view'], emoji: '🪵', portable: false },
  jetty: { kind: 'jetty', name: 'Jetty', description: 'A small wooden jetty over the water.', category: 'structure', tags: ['fishing_spot', 'view', 'seat'], emoji: '🌊', portable: false },
  shed: { kind: 'shed', name: 'Garden shed', description: 'A tiny shed for tools.', category: 'structure', tags: ['storage'], emoji: '🛖', portable: false },
  apple_tree: { kind: 'apple_tree', name: 'Apple tree', description: 'An old apple tree.', category: 'nature', tags: ['tree', 'fruit_source', 'plant', 'shade'], emoji: '🌳', portable: false, initialState: { fruit: 3, water: 70, growth: 100 } },
  pine: { kind: 'pine', name: 'Old pine', description: 'A tall pine tree with a mossy trunk.', category: 'nature', tags: ['tree', 'view', 'shade'], emoji: '🌲', portable: false },
  sketchbook: { kind: 'sketchbook', name: 'Sketchbook', description: 'A small sketchbook with a pencil.', category: 'creative', tags: ['draw'], emoji: '📒', portable: true },
  fishing_rod: { kind: 'fishing_rod', name: 'Fishing rod', description: 'A bamboo fishing rod.', category: 'tool', tags: ['fish_tool'], emoji: '🎣', portable: true },
  painting: { kind: 'painting', name: 'Painting', description: 'A painting made by Calmling.', category: 'creative', tags: ['art', 'decor'], emoji: '🖼️', portable: true },
  sketch: { kind: 'sketch', name: 'Sketch', description: 'A pencil sketch made by Calmling.', category: 'creative', tags: ['art', 'decor'], emoji: '📝', portable: true },
  photo: { kind: 'photo', name: 'Photo', description: 'A photograph taken by Calmling.', category: 'creative', tags: ['art', 'decor'], emoji: '📷', portable: true },
  apple: { kind: 'apple', name: 'Apple', description: 'A crisp red apple.', category: 'food', tags: ['food'], emoji: '🍎', portable: true },
  sprout: { kind: 'sprout', name: 'Seedling', description: 'Something newly planted.', category: 'nature', tags: ['plant', 'waterable'], emoji: '🌱', portable: false, initialState: { water: 60, growth: 0 } },
  sunflower: { kind: 'sunflower', name: 'Sunflower', description: 'A tall sunflower grown from seed.', category: 'nature', tags: ['plant', 'waterable', 'inspectable', 'view'], emoji: '🌻', portable: false, initialState: { water: 60, growth: 100 } },
  mystery_bloom: { kind: 'mystery_bloom', name: 'Glowing bloom', description: 'A flower that glows softly at night.', category: 'nature', tags: ['plant', 'waterable', 'inspectable', 'view'], emoji: '🪷', portable: false, initialState: { water: 60, growth: 100 } },
  // collectibles found while exploring
  pinecone: { kind: 'pinecone', name: 'Pinecone', description: 'A perfectly round pinecone.', category: 'collectible', tags: ['collectible', 'inspectable'], emoji: '🌰', portable: true },
  feather: { kind: 'feather', name: 'Blue feather', description: 'A striped blue feather.', category: 'collectible', tags: ['collectible', 'inspectable'], emoji: '🪶', portable: true },
  pebble: { kind: 'pebble', name: 'Shiny pebble', description: 'A pebble that sparkles when wet.', category: 'collectible', tags: ['collectible', 'inspectable'], emoji: '🪨', portable: true },
  mushroom: { kind: 'mushroom', name: 'Spotted mushroom', description: 'A tiny spotted mushroom.', category: 'collectible', tags: ['collectible', 'inspectable'], emoji: '🍄', portable: true },
  shell: { kind: 'shell', name: 'Snail shell', description: 'An empty spiral shell.', category: 'collectible', tags: ['collectible', 'inspectable'], emoji: '🐚', portable: true },

  // viewer gifts (free, virtual)
  flower: { kind: 'flower', name: 'Flower', description: 'A bright potted flower. It could be kept or planted.', category: 'nature', tags: ['gift', 'plant', 'waterable', 'plantable', 'inspectable', 'decor'], emoji: '🌷', portable: true, giftable: true, initialState: { water: 70, growth: 100 } },
  teddy_bear: { kind: 'teddy_bear', name: 'Teddy bear', description: 'A soft teddy bear with a stitched smile.', category: 'comfort', tags: ['gift', 'cuddle', 'inspectable', 'decor'], emoji: '🧸', portable: true, giftable: true },
  book: { kind: 'book', name: 'Book', description: 'A storybook with a blue cover.', category: 'creative', tags: ['gift', 'readable', 'inspectable'], emoji: '📘', portable: true, giftable: true },
  camera: { kind: 'camera', name: 'Camera', description: 'A small instant camera.', category: 'creative', tags: ['gift', 'photo_tool', 'inspectable'], emoji: '📷', portable: true, giftable: true },
  watering_can: { kind: 'watering_can', name: 'Watering can', description: 'A tin watering can.', category: 'tool', tags: ['gift', 'water_tool', 'inspectable'], emoji: '🪣', portable: true, giftable: true },
  painting_set: { kind: 'painting_set', name: 'Painting set', description: 'An easel, brushes and a tin of paints.', category: 'creative', tags: ['gift', 'paint_tool', 'inspectable'], emoji: '🎨', portable: true, giftable: true },
  cup: { kind: 'cup', name: 'Cup', description: 'A hand-thrown clay cup.', category: 'comfort', tags: ['gift', 'cup', 'inspectable', 'decor'], emoji: '☕', portable: true, giftable: true },
  toy: { kind: 'toy', name: 'Spinning top', description: 'A painted wooden spinning top.', category: 'toy', tags: ['gift', 'play', 'inspectable'], emoji: '🪀', portable: true, giftable: true },
  seed: { kind: 'seed', name: 'Seed packet', description: 'A packet of sunflower seeds.', category: 'nature', tags: ['gift', 'seed', 'inspectable'], emoji: '🌻', portable: true, giftable: true },
  decorative_plant: { kind: 'decorative_plant', name: 'Potted fern', description: 'A leafy fern in a pot.', category: 'nature', tags: ['gift', 'plant', 'waterable', 'inspectable', 'decor'], emoji: '🪴', portable: true, giftable: true, initialState: { water: 70, growth: 100 } },

  // poll / community outcomes
  piano: { kind: 'piano', name: 'Little piano', description: 'A small upright piano.', category: 'creative', tags: ['music', 'inspectable'], emoji: '🎹', portable: false, pollOnly: true },
  mystery_seed: { kind: 'mystery_seed', name: 'Mysterious seed', description: 'A seed that hums faintly.', category: 'nature', tags: ['seed', 'inspectable', 'mystery'], emoji: '🫘', portable: true, pollOnly: true },
  telescope: { kind: 'telescope', name: 'Telescope', description: 'A brass telescope pointed at the sky.', category: 'structure', tags: ['stargaze', 'inspectable', 'view'], emoji: '🔭', portable: false, pollOnly: true },
  treehouse: { kind: 'treehouse', name: 'Treehouse', description: 'A treehouse built by the community.', category: 'structure', tags: ['seat', 'rest', 'view', 'inspectable'], emoji: '🏡', portable: false },
  bridge: { kind: 'bridge', name: 'Bridge', description: 'A wooden footbridge across the pond.', category: 'structure', tags: ['view', 'inspectable'], emoji: '🌉', portable: false },
  flower_meadow: { kind: 'flower_meadow', name: 'Community meadow', description: 'Thousands of flowers planted by viewers.', category: 'nature', tags: ['view', 'inspectable', 'plant'], emoji: '🌼', portable: false },
};

export const GIFT_KINDS = Object.values(OBJECT_KINDS).filter((k) => k.giftable).map((k) => k.kind);

export function makeObject(
  id: string,
  kind: string,
  location: LocationId,
  x: number,
  minute: number,
  origin: WorldObject['origin'] = { type: 'world' },
  extra: Partial<WorldObject> = {},
): WorldObject {
  const def = OBJECT_KINDS[kind];
  if (!def) throw new Error(`Unknown object kind: ${kind}`);
  return {
    id,
    kind,
    name: def.name,
    tags: [...def.tags],
    location,
    x,
    heldBy: null,
    state: { ...(def.initialState ?? {}) },
    discovered: origin.type === 'world',
    createdAtMinute: minute,
    createdDay: Math.floor(minute / MINUTES_PER_DAY) + 1,
    origin,
    interactions: 0,
    lastInteractionMinute: null,
    affinity: 0,
    ...extra,
  };
}

/** Starting world for a brand new life. */
export function initialObjects(minute: number): WorldObject[] {
  const p = { permanent: true };
  return [
    makeObject('bed_1', 'bed', 'bedroom', 690, minute, { type: 'world' }, p),
    makeObject('armchair_1', 'armchair', 'home', 500, minute, { type: 'world' }, p),
    makeObject('kettle_1', 'kettle', 'home', 585, minute, { type: 'world' }, p),
    makeObject('pantry_1', 'pantry', 'home', 600, minute, { type: 'world' }, p),
    makeObject('bookshelf_1', 'bookshelf', 'home', 530, minute, { type: 'world' }, p),
    makeObject('shed_1', 'shed', 'garden', 240, minute, { type: 'world' }, p),
    makeObject('apple_tree_1', 'apple_tree', 'garden', 300, minute, { type: 'world' }, p),
    makeObject('pine_1', 'pine', 'forest', 110, minute, { type: 'world' }, p),
    makeObject('bench_1', 'bench', 'pond', 760, minute, { type: 'world' }, p),
    makeObject('jetty_1', 'jetty', 'pond', 900, minute, { type: 'world' }, p),
    makeObject('sketchbook_1', 'sketchbook', 'home', 545, minute),
    makeObject('fishing_rod_1', 'fishing_rod', 'pond', 880, minute),
    makeObject('watering_can_1', 'watering_can', 'garden', 255, minute),
    makeObject('book_1', 'book', 'home', 532, minute, { type: 'world' }, { name: 'Old atlas' }),
    makeObject('sprout_1', 'sprout', 'garden', 380, minute, { type: 'world' }, { name: 'Daisy patch', state: { water: 50, growth: 60 } }),
  ];
}

export const GIFT_DROP_X: Record<LocationId, number> = {
  garden: 440,
  home: 560,
  bedroom: 650,
  pond: 790,
  forest: 180,
};
