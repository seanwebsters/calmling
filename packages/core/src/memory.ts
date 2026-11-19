import type { LocationId, Memory, MemoryType, SimEvent, SimState } from './types';

export const MEMORY_LIMIT = 400;

export interface MemoryInput {
  type: MemoryType;
  summary: string;
  importance: number;
  relatedObjectIds?: string[];
  relatedEventIds: string[];
  location?: LocationId | null;
  emotion?: { valence: number; label: string };
  key?: string;
}

/**
 * Memories are always created from events that actually happened (their
 * relatedEventIds must point at emitted events). Keyed memories (semantic facts
 * and preferences) are updated in place so facts stay consistent.
 */
export function remember(s: SimState, ev: Pick<SimEvent, 'minute' | 'day'>, input: MemoryInput, mkId: () => string): Memory {
  if (!input.relatedEventIds.length) throw new Error('memories must be grounded in at least one event');
  if (input.key) {
    const existing = s.memories.find((m) => m.key === input.key);
    if (existing) {
      existing.summary = input.summary;
      existing.importance = Math.max(existing.importance, input.importance);
      existing.relatedEventIds = Array.from(new Set([...existing.relatedEventIds, ...input.relatedEventIds])).slice(-20);
      existing.relatedObjectIds = Array.from(new Set([...existing.relatedObjectIds, ...(input.relatedObjectIds ?? [])]));
      existing.minute = ev.minute;
      existing.day = ev.day;
      if (input.emotion) existing.emotion = input.emotion;
      return existing;
    }
  }
  const m: Memory = {
    id: mkId(),
    type: input.type,
    minute: ev.minute,
    day: ev.day,
    summary: input.summary,
    importance: Math.max(0, Math.min(1, input.importance)),
    relatedObjectIds: input.relatedObjectIds ?? [],
    relatedEventIds: input.relatedEventIds,
    location: input.location ?? null,
    emotion: input.emotion ?? { valence: 0.2, label: 'calm' },
    consolidated: false,
    key: input.key,
    recallCount: 0,
    lastRecalledMinute: null,
  };
  s.memories.push(m);
  return m;
}

export interface RecallContext {
  location?: LocationId;
  objectIds?: string[];
  limit?: number;
}

/** Retrieval: importance + recency + relevance to the current situation. */
export function recall(s: SimState, ctx: RecallContext): Memory[] {
  const objs = new Set(ctx.objectIds ?? []);
  const scored = s.memories.map((m) => {
    const ageDays = (s.minute - m.minute) / 1440;
    const recency = Math.exp(-ageDays / 7);
    const shared = m.relatedObjectIds.filter((id) => objs.has(id)).length;
    const relevance = Math.min(1, shared * 0.6) + (ctx.location && m.location === ctx.location ? 0.3 : 0);
    const typeBoost = m.type === 'habit' || m.type === 'preference' ? 0.15 : 0;
    return { m, score: m.importance + recency * 0.5 + relevance * 0.8 + typeBoost };
  });
  scored.sort((a, b) => b.score - a.score);
  const out = scored.slice(0, ctx.limit ?? 6).map((x) => x.m);
  for (const m of out) {
    m.recallCount++;
    m.lastRecalledMinute = s.minute;
  }
  return out;
}

/**
 * Consolidation: older, less important episodic memories of a day are folded
 * into a single summary memory. Object and event links are preserved, so facts
 * remain traceable. Returns [summaries created, memories consolidated].
 */
export function consolidate(s: SimState, today: number, mkId: () => string): { created: Memory[]; folded: Memory[] } {
  const created: Memory[] = [];
  const folded: Memory[] = [];
  const byDay = new Map<number, Memory[]>();
  for (const m of s.memories) {
    if (m.type !== 'episodic' || m.consolidated || m.importance >= 0.6 || today - m.day < 5) continue;
    if (!byDay.has(m.day)) byDay.set(m.day, []);
    byDay.get(m.day)!.push(m);
  }
  for (const [day, mems] of byDay) {
    if (mems.length < 2) continue;
    const parts = mems.slice(0, 6).map((m) => m.summary.replace(/^On Day \d+, /, '').replace(/\.$/, ''));
    const summary = `Day ${day} in short: ${parts.join('; ')}${mems.length > 6 ? `; and ${mems.length - 6} smaller moments` : ''}.`;
    const valence = mems.reduce((a, m) => a + m.emotion.valence, 0) / mems.length;
    const m: Memory = {
      id: mkId(),
      type: 'episodic',
      minute: mems[mems.length - 1].minute,
      day,
      summary,
      importance: 0.5,
      relatedObjectIds: Array.from(new Set(mems.flatMap((x) => x.relatedObjectIds))),
      relatedEventIds: Array.from(new Set(mems.flatMap((x) => x.relatedEventIds))).slice(0, 40),
      location: null,
      emotion: { valence, label: valence > 0.3 ? 'warm' : 'calm' },
      consolidated: false,
      key: `summary:day:${day}`,
      recallCount: 0,
      lastRecalledMinute: null,
    };
    for (const x of mems) x.consolidated = true;
    folded.push(...mems);
    created.push(m);
    s.memories = s.memories.filter((x) => !x.consolidated);
    s.memories.push(m);
  }
  // keep the working set bounded; the full history lives in the database
  if (s.memories.length > MEMORY_LIMIT) {
    const ranked = [...s.memories].sort((a, b) => b.importance + (b.minute / 1440) * 0.02 - (a.importance + (a.minute / 1440) * 0.02));
    s.memories = ranked.slice(0, MEMORY_LIMIT).sort((a, b) => a.minute - b.minute);
  }
  return { created, folded };
}

export function emotionFor(reward: number, kind: string): { valence: number; label: string } {
  const v = Math.max(-1, Math.min(1, reward * 1.4 - 0.2));
  const label = kind === 'surprise' ? 'surprise' : kind === 'curious' ? 'curiosity' : v > 0.6 ? 'joy' : v > 0.25 ? 'contentment' : v < -0.2 ? 'frustration' : 'calm';
  return { valence: Math.round(v * 100) / 100, label };
}
