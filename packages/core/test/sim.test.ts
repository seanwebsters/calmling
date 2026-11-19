import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  HABIT_RULES,
  Simulation,
  activeHabits,
  composeDiaryTemplate,
  computeStrength,
  createInitialState,
  dailyHabitReview,
  recordHabitObservation,
  runFor,
  traitTrends,
  validateProposal,
  type SimEvent,
} from '../src';

function collect(sim: Simulation, minutes: number) {
  const events: SimEvent[] = [];
  runFor(sim, minutes, 1, (p) => events.push(...p.events));
  return events;
}

describe('needs and time', () => {
  it('needs change over time and stay within 0..100', () => {
    const sim = Simulation.create(1);
    const before = { ...sim.state.character.needs };
    collect(sim, 600);
    const after = sim.state.character.needs;
    expect(after).not.toEqual(before);
    for (const v of Object.values(after)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it('Calmling sleeps at night and moves between locations', () => {
    const sim = Simulation.create(2);
    const events = collect(sim, 1440 * 2);
    const sleeps = events.filter((e) => e.type === 'activity_started' && e.action === 'sleep');
    expect(sleeps.length).toBeGreaterThan(0);
    const night = sleeps.filter((e) => { const h = (e.minute % 1440) / 60; return h >= 19 || h < 5; });
    expect(night.length).toBeGreaterThan(0);
    const arrivals = new Set(events.filter((e) => e.type === 'arrived').map((e) => e.location));
    expect(arrivals.size).toBeGreaterThanOrEqual(3);
  });
});

describe('deterministic validation', () => {
  it('rejects a target that does not exist and executes a safe alternative', () => {
    const sim = Simulation.create(3);
    sim.tick(1);
    sim.state.character.activity = null;
    sim.state.character.plan = [];
    const d = sim.applyProposal({ action: 'water_plant', targetId: 'plant_does_not_exist', reason: 'test' }, 'llm', 'test-model');
    expect(sim.drain().decisions[0]).toMatchObject({ valid: false, source: 'llm' });
    expect(d.source).toBe('fallback');
    expect(d.valid).toBe(true);
    expect(sim.state.character.activity).not.toBeNull();
  });

  it('rejects unknown and internal actions, and checks tools and energy', () => {
    const s = createInitialState(4);
    expect(validateProposal(s, { action: 'teleport', targetId: null, reason: '' }).ok).toBe(false);
    expect(validateProposal(s, { action: 'pick_up', targetId: 'book_1', reason: '' }).ok).toBe(false);
    expect(validateProposal(s, { action: 'paint', targetId: null, reason: '' })).toMatchObject({ ok: false, reason: expect.stringContaining('paint tool') });
    s.character.needs.energy = 5;
    expect(validateProposal(s, { action: 'explore', targetId: null, reason: '' })).toMatchObject({ ok: false });
  });

  it('plans to fetch the watering can before watering', () => {
    const s = createInitialState(5);
    s.objects.sprout_1.state.water = 10;
    const v = validateProposal(s, { action: 'water_plant', targetId: 'sprout_1', reason: '' });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.steps.map((x) => x.action)).toEqual(['walk', 'pick_up', 'walk', 'water_plant']);
      expect(v.steps[1].targetId).toBe('watering_can_1');
    }
  });

  it('does not let the brain target objects Calmling has not noticed', () => {
    const sim = Simulation.create(6);
    const gift = sim.addExternalObject({ kind: 'teddy_bear', location: 'pond', origin: { type: 'gift', by: 'Emily' } });
    expect(validateProposal(sim.state, { action: 'cuddle', targetId: gift.id, reason: '' })).toMatchObject({ ok: false, reason: expect.stringContaining('not noticed') });
  });
});

describe('persistent world and gifts', () => {
  it('a gifted flower appears, is discovered, remembered and can be interacted with', () => {
    const sim = Simulation.create(7);
    collect(sim, 60);
    const flower = sim.addExternalObject({ kind: 'flower', origin: { type: 'gift', by: 'Emily', byUserId: 'u1', giftId: 'g1' } });
    expect(sim.state.objects[flower.id]).toBeDefined();
    expect(flower.discovered).toBe(false);
    const events = collect(sim, 1440 * 4);
    const f = sim.state.objects[flower.id];
    expect(f).toBeDefined(); // gifts persist unless a valid world event changes them
    expect(f.discovered).toBe(true);
    expect(events.some((e) => e.type === 'object_discovered' && e.objectIds.includes(flower.id))).toBe(true);
    expect(sim.state.memories.some((m) => m.type === 'social' && m.summary.includes('Emily') && m.relatedObjectIds.includes(flower.id))).toBe(true);
    expect(f.interactions).toBeGreaterThan(0);
  });

  it('actions change persistent world state (watering)', () => {
    const sim = Simulation.create(8);
    sim.state.objects.sprout_1.state.water = 5;
    sim.state.character.plan = [];
    sim.applyProposal({ action: 'water_plant', targetId: 'sprout_1', reason: 'thirsty plant' }, 'llm', null);
    for (let i = 0; i < 60 && sim.state.objects.sprout_1.state.water < 99; i++) sim.tick(1);
    expect(sim.state.objects.sprout_1.state.water).toBeGreaterThan(95);
  });
});

describe('memory', () => {
  it('every memory is grounded in emitted events', () => {
    const sim = Simulation.create(9);
    const ids = new Set(collect(sim, 1440 * 3).map((e) => e.id));
    ids.add('ev_1');
    expect(sim.state.memories.length).toBeGreaterThan(3);
    for (const m of sim.state.memories) {
      expect(m.relatedEventIds.length).toBeGreaterThan(0);
      for (const id of m.relatedEventIds) expect(ids.has(id)).toBe(true);
    }
  });

  it('consolidates older minor memories without losing object links', () => {
    const sim = Simulation.create(10);
    collect(sim, 1440 * 9);
    const summaries = sim.state.memories.filter((m) => m.key?.startsWith('summary:day:'));
    expect(summaries.length).toBeGreaterThan(0);
    for (const m of summaries) expect(m.relatedEventIds.length).toBeGreaterThan(1);
  });
});

describe('habits', () => {
  it('a habit forms only after repetition on several days, and fades when it stops', () => {
    const s = createInitialState(11);
    let ev = 0;
    const obs = (day: number) => ({ eventId: `ev_${++ev}`, action: 'paint', phase: 'afternoon' as const, location: 'home' as const, objectId: null, objectName: null, objectKind: null, prevAction: null, hasAlternatives: false, reward: 0.7, day, minute: day * 1440 + 900 });
    recordHabitObservation(s, obs(1));
    recordHabitObservation(s, obs(1));
    const key = 'ctx:paint:afternoon:home';
    expect(s.habits[key].status).toBe('emerging');
    for (const d of [2, 3]) recordHabitObservation(s, obs(d));
    expect(s.habits[key].status).toBe('emerging'); // 3 days is not enough
    const changes = recordHabitObservation(s, obs(4));
    expect(s.habits[key].status).toBe('formed');
    expect(changes.some((c) => c.change === 'formed')).toBe(true);
    expect(s.habits[key].occurrences.length).toBe(5);
    expect(s.habits[key].explanation).toMatch(/different days/);
    // stop painting: the habit weakens and dissolves
    let status = s.habits[key].status;
    for (let d = 5; d < 30 && status !== 'dissolved'; d++) {
      dailyHabitReview(s, d);
      status = s.habits[key]?.status ?? 'dissolved';
    }
    expect(status).toBe('dissolved');
    expect(computeStrength(s.habits[key], 30).strength).toBeLessThan(HABIT_RULES.dissolveStrength);
  });

  it('habits emerge from autonomous behaviour over a simulated week (not pre-scripted)', () => {
    const sim = Simulation.create(12);
    const events = collect(sim, 1440 * 7);
    const formed = events.filter((e) => e.type === 'habit_formed');
    expect(formed.length).toBeGreaterThan(0);
    for (const h of activeHabits(sim.state)) {
      // every habit has stored evidence that points at real events
      expect(h.occurrences.length).toBeGreaterThanOrEqual(HABIT_RULES.formMinOccurrences);
      const ids = new Set(events.map((e) => e.id));
      expect(h.occurrences.every((o) => ids.has(o.eventId))).toBe(true);
    }
  });

  it('different seeds lead to different lives', () => {
    const a = Simulation.create(100);
    const b = Simulation.create(200);
    collect(a, 1440 * 5);
    collect(b, 1440 * 5);
    const sig = (s: Simulation) => Object.entries(s.state.counters).filter(([k]) => k.startsWith('done:')).sort().map(([k, v]) => `${k}=${v}`).join(',');
    expect(sig(a)).not.toEqual(sig(b));
  });
});

describe('personality', () => {
  it('traits change gradually and statements are backed by history', () => {
    const sim = Simulation.create(13);
    const start = { ...sim.state.character.traits };
    collect(sim, 1440 * 10);
    const t = sim.state.character.traits;
    for (const k of Object.keys(start) as (keyof typeof start)[]) expect(Math.abs(t[k] - start[k])).toBeLessThan(25);
    expect(sim.state.traitHistory.length).toBeGreaterThanOrEqual(10);
    for (const trend of traitTrends(sim.state.traitHistory, t, 11)) {
      const base = sim.state.traitHistory.find((h) => h.day === trend.fromDay)!;
      expect(Math.abs(t[trend.trait] - base.traits[trend.trait])).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('persistence', () => {
  it('a restored snapshot continues the same life deterministically', () => {
    const sim = Simulation.create(14);
    collect(sim, 1440);
    sim.drain();
    const snap = JSON.parse(JSON.stringify(sim.state));
    const restored = new Simulation(JSON.parse(JSON.stringify(snap)));
    collect(sim, 600);
    collect(restored, 600);
    expect(restored.state.minute).toBe(sim.state.minute);
    expect(restored.state.character.x).toBe(sim.state.character.x);
    expect(restored.state.seq).toBe(sim.state.seq);
  });
});

describe('diary', () => {
  it('diary entries only cite real events', () => {
    const sim = Simulation.create(15);
    const events = collect(sim, 1440);
    const d = composeDiaryTemplate(1, events.filter((e) => e.day === 1));
    expect(d.body.length).toBeGreaterThan(40);
    const ids = new Set(events.map((e) => e.id));
    expect(d.facts.length).toBeGreaterThan(0);
    for (const f of d.facts) expect(ids.has(f.eventId)).toBe(true);
  });
});

describe('action library', () => {
  it('every action maps to an animation and has sane durations', () => {
    for (const a of Object.values(ACTIONS)) {
      expect(a.animation).toBeTruthy();
      expect(a.duration[0]).toBeLessThanOrEqual(a.duration[1]);
    }
  });
});
