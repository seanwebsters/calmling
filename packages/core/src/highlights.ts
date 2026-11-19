import type { Highlight, PublicFrame, SimEvent } from './types';

type Scores = Highlight['scores'];

const BASE: Partial<Record<SimEvent['type'], Partial<Scores>>> = {
  object_discovered: { novelty: 0.8, emotion: 0.5, visual: 0.6, narrative: 0.5 },
  first_time: { novelty: 0.9, emotion: 0.5, visual: 0.6, rarity: 0.7, narrative: 0.6 },
  habit_formed: { narrative: 0.9, rarity: 0.6, emotion: 0.3, novelty: 0.5 },
  goal_completed: { community: 1, visual: 0.8, narrative: 0.8, rarity: 0.9, novelty: 0.7 },
  poll_outcome: { community: 0.9, novelty: 0.7, narrative: 0.6, visual: 0.5 },
  gift_arrived: { community: 0.6, novelty: 0.4, visual: 0.3 },
  plant_bloomed: { visual: 0.8, emotion: 0.5, narrative: 0.5, novelty: 0.5 },
  audience_noticed: { community: 0.8, emotion: 0.5, visual: 0.4 },
  trait_shift: { narrative: 0.8, rarity: 0.5 },
  object_created: { visual: 0.6, novelty: 0.5, narrative: 0.4 },
};

/** Score an event on six axes. Only events above the threshold become highlights. */
export function scoreEvent(ev: SimEvent, extra: { isGift?: boolean; firstOfKind?: boolean } = {}): { score: number; scores: Scores } {
  const b = BASE[ev.type] ?? {};
  const scores: Scores = {
    novelty: b.novelty ?? 0,
    emotion: b.emotion ?? 0,
    visual: b.visual ?? 0,
    community: Math.max(b.community ?? 0, extra.isGift ? 0.7 : 0),
    rarity: Math.max(b.rarity ?? 0, extra.firstOfKind ? 0.8 : 0),
    narrative: b.narrative ?? 0,
  };
  const w = { novelty: 0.22, emotion: 0.16, visual: 0.16, community: 0.16, rarity: 0.14, narrative: 0.16 };
  let score = 0;
  for (const k of Object.keys(w) as (keyof Scores)[]) score += scores[k] * w[k];
  score = Math.min(1, score + ev.importance * 0.25);
  return { score: Math.round(score * 100) / 100, scores };
}

export const HIGHLIGHT_THRESHOLD = 0.5;

export function makeHighlight(id: string, ev: SimEvent, frame: PublicFrame, extra: { isGift?: boolean; firstOfKind?: boolean } = {}): Highlight | null {
  const { score, scores } = scoreEvent(ev, extra);
  if (score < HIGHLIGHT_THRESHOLD) return null;
  return { id, eventId: ev.id, minute: ev.minute, day: ev.day, title: titleFor(ev), description: ev.summary, score, scores, replay: frame };
}

function titleFor(ev: SimEvent): string {
  switch (ev.type) {
    case 'object_discovered': return 'A new discovery';
    case 'first_time': return 'A first time';
    case 'habit_formed': return 'A new habit';
    case 'goal_completed': return 'The community built something';
    case 'poll_outcome': return 'The vote arrived';
    case 'gift_arrived': return 'A gift arrived';
    case 'plant_bloomed': return 'Something bloomed';
    case 'audience_noticed': return 'Calmling noticed you';
    case 'trait_shift': return 'Calmling is changing';
    case 'object_created': return 'Calmling made something';
    default: return 'A moment';
  }
}

/** Manifest a video pipeline can consume to render clips. No clips are claimed. */
export function highlightManifest(h: Highlight[], opts: { timeScale: number; preRollSimMinutes?: number; durationSimMinutes?: number }) {
  return {
    format: 'calmling.highlight-manifest/v1',
    note: 'Replay instructions only. Clips must be rendered by a capture pipeline; none are pre-rendered.',
    timeScale: opts.timeScale,
    clips: h.map((x) => ({
      highlightId: x.id,
      eventId: x.eventId,
      title: x.title,
      caption: x.description,
      day: x.day,
      startMinute: x.minute - (opts.preRollSimMinutes ?? 2),
      endMinute: x.minute + (opts.durationSimMinutes ?? 6),
      score: x.score,
      frame: x.replay,
      aspectRatios: ['9:16', '16:9'],
    })),
  };
}
