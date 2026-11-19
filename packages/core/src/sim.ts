import { ACTIONS, type ActionDef } from './actions';
import { chooseDeterministic, generateCandidates, reasonFor, type Candidate } from './brain';
import { toPublicFrame } from './frame';
import { dailyHabitReview, recordHabitObservation, type HabitChange } from './habits';
import { makeHighlight } from './highlights';
import { consolidate, emotionFor, recall, remember } from './memory';
import { driftNeeds, initialNeeds, moodOf, pressure, satisfy } from './needs';
import { evolveTraits, initialTraits, traitTrends } from './personality';
import { keepDestination, validateProposal, type Proposal } from './plan';
import { Rng, clamp } from './rng';
import {
  NEED_KEYS,
  type Activity,
  type Decision,
  type EventType,
  type Habit,
  type Highlight,
  type LocationId,
  type Memory,
  type Needs,
  type Observation,
  type SimEvent,
  type SimState,
  type Weather,
  type WorldObject,
} from './types';
import {
  GIFT_DROP_X,
  LOCATIONS,
  MINUTES_PER_DAY,
  OBJECT_KINDS,
  dayOf,
  initialObjects,
  isSunset,
  locationAt,
  makeObject,
  phaseOf,
  WALK_SPEED,
} from './world';

/** Everything produced since the last drain — what the persistence layer must write. */
export interface Pending {
  events: SimEvent[];
  memories: Map<string, Memory>;
  habits: Map<string, Habit>;
  decisions: Decision[];
  objectsChanged: Set<string>;
  objectsRemoved: Set<string>;
  highlights: Highlight[];
  activities: Activity[];
  traitSnapshots: { day: number; minute: number; traits: SimState['character']['traits'] }[];
  dayEnded: number[];
}

function emptyPending(): Pending {
  return { events: [], memories: new Map(), habits: new Map(), decisions: [], objectsChanged: new Set(), objectsRemoved: new Set(), highlights: [], activities: [], traitSnapshots: [], dayEnded: [] };
}

export const START_MINUTE = 7 * 60; // Day 1, 07:00

export function createInitialState(seed = 20260101): SimState {
  const minute = START_MINUTE;
  const objects: Record<string, WorldObject> = {};
  for (const o of initialObjects(minute)) objects[o.id] = o;
  const traits = initialTraits();
  return {
    version: 1,
    seed,
    rngState: seed,
    minute,
    seq: 0,
    tick: 0,
    character: {
      id: 'calmling',
      name: 'Calmling',
      needs: initialNeeds(),
      traits,
      location: 'bedroom',
      x: 670,
      facing: -1,
      heldObjectId: null,
      activity: null,
      plan: [],
      goal: null,
      goalReason: null,
      lastAction: null,
      lastActionMinute: null,
      mood: 'calm',
      awake: true,
      failures: 0,
    },
    objects,
    env: { weather: 'clear', nextWeatherChangeAt: minute + 240 },
    memories: [],
    habits: {},
    observations: [],
    experienced: [],
    visited: ['bedroom'],
    counters: { id: 1 },
    traitHistory: [{ day: 1, traits: { ...traits } }],
    paused: false,
  };
}

export interface SimOptions {
  /** emit decision events for the log */
  logDecisions?: boolean;
}

/**
 * The deterministic simulation engine. It is the only code allowed to change
 * authoritative state. Brains propose; this engine validates and executes.
 */
export class Simulation {
  state: SimState;
  rng: Rng;
  pending: Pending = emptyPending();
  /** set when Calmling has nothing to do and a brain should decide */
  awaitingDecision = false;

  constructor(state: SimState, _opts: SimOptions = {}) {
    this.state = state;
    this.rng = new Rng(state.rngState);
  }

  static create(seed?: number): Simulation {
    const sim = new Simulation(createInitialState(seed));
    sim.emit('simulation_started', 'Calmling woke up on the island for the very first time.', { importance: 0.9, location: 'bedroom' });
    return sim;
  }

  // ------------------------------------------------------------------ ids --
  private nextId(prefix: string): string {
    const n = this.state.counters.id++;
    return `${prefix}_${n.toString(36)}`;
  }

  // --------------------------------------------------------------- events --
  emit(
    type: EventType,
    summary: string,
    opts: { location?: LocationId | null; objectIds?: string[]; action?: string; data?: Record<string, unknown>; importance?: number; highlightExtra?: { isGift?: boolean; firstOfKind?: boolean } } = {},
  ): SimEvent {
    const s = this.state;
    s.seq++;
    const ev: SimEvent = {
      id: `ev_${s.seq}`,
      seq: s.seq,
      minute: Math.round(s.minute * 100) / 100,
      day: dayOf(s.minute),
      type,
      summary,
      location: opts.location === undefined ? s.character.location : opts.location,
      objectIds: opts.objectIds ?? [],
      action: opts.action,
      data: opts.data ?? {},
      importance: opts.importance ?? 0.2,
    };
    this.pending.events.push(ev);
    const h = makeHighlight(this.nextId('hl'), ev, toPublicFrame(s), opts.highlightExtra);
    if (h) this.pending.highlights.push(h);
    return ev;
  }

  private remember(ev: SimEvent, input: Omit<Parameters<typeof remember>[2], 'relatedEventIds'> & { relatedEventIds?: string[] }): Memory {
    const m = remember(this.state, ev, { ...input, relatedEventIds: input.relatedEventIds ?? [ev.id], location: input.location ?? ev.location }, () => this.nextId('mem'));
    this.pending.memories.set(m.id, m);
    return m;
  }

  private touchObject(o: WorldObject) {
    this.pending.objectsChanged.add(o.id);
  }

  drain(): Pending {
    const p = this.pending;
    this.pending = emptyPending();
    this.state.rngState = this.rng.state;
    return p;
  }

  // ----------------------------------------------------------------- time --
  /** Advance simulated time by `minutes`. Optionally let the deterministic brain decide immediately. */
  tick(minutes: number, opts: { autoDecide?: boolean } = {}): void {
    const s = this.state;
    if (s.paused) return;
    s.tick++;
    let remaining = minutes;
    while (remaining > 1e-9) {
      const step = Math.min(1, remaining);
      remaining -= step;
      this.step(step, opts.autoDecide ?? false);
    }
    this.state.rngState = this.rng.state;
  }

  private step(dt: number, autoDecide: boolean) {
    const s = this.state;
    const c = s.character;
    const prevDay = dayOf(s.minute);
    s.minute += dt;
    const day = dayOf(s.minute);
    if (day !== prevDay) this.onNewDay(day);

    driftNeeds(c.needs, dt, !c.awake);
    const a = c.activity;
    if (a) {
      const total = Math.max(0.0001, a.endsAt - a.startedAt);
      for (const k of NEED_KEYS) {
        const g = a.gains[k];
        if (g) satisfy(c.needs, k, (g * dt) / total);
      }
      if (a.action === 'walk' && a.fromX !== undefined && a.toX !== undefined) {
        const t = Math.min(1, (s.minute - a.startedAt) / total);
        c.x = a.fromX + (a.toX - a.fromX) * t;
        c.location = locationAt(c.x);
      }
    }
    this.updateWorld(dt);
    if (c.awake) this.perceive();
    this.maybeInterrupt();
    if (c.activity && s.minute >= c.activity.endsAt) this.completeActivity();
    if (!c.activity) {
      if (c.plan.length) this.startStep();
      else {
        this.awaitingDecision = true;
        if (autoDecide) this.decideDeterministic();
      }
    }
    c.mood = moodOf(c.needs, c.awake);
  }

  // ---------------------------------------------------------------- world --
  private updateWorld(dt: number) {
    const s = this.state;
    const raining = s.env.weather === 'rain';
    for (const o of Object.values(s.objects)) {
      if (o.state.water !== undefined && o.heldBy === null) {
        const indoor = LOCATIONS[o.location].indoor;
        const before = o.state.water;
        o.state.water = clamp(before + (raining && !indoor ? 0.4 : -0.035) * dt);
        if (before >= 5 && o.state.water < 5 && !o.state.wilting) {
          o.state.wilting = 1;
          this.touchObject(o);
          this.emit('plant_wilted', `The ${o.name.toLowerCase()} is wilting from thirst.`, { location: o.location, objectIds: [o.id], importance: 0.35 });
        } else if (o.state.wilting && o.state.water > 30) {
          o.state.wilting = 0;
          this.touchObject(o);
        }
        if (Math.floor(before) !== Math.floor(o.state.water) && Math.floor(o.state.water) % 10 === 0) this.touchObject(o);
      }
      if (o.kind === 'sprout') {
        const water = o.state.water ?? 0;
        if (water > 20) o.state.growth = clamp((o.state.growth ?? 0) + 0.025 * dt * (0.5 + water / 100));
        if ((o.state.growth ?? 0) >= 100) this.bloom(o);
      }
      if (o.kind === 'apple_tree') {
        o.state.fruitProgress = (o.state.fruitProgress ?? 0) + dt / 360;
        if (o.state.fruitProgress >= 1) {
          o.state.fruitProgress = 0;
          if ((o.state.fruit ?? 0) < 5) {
            o.state.fruit = (o.state.fruit ?? 0) + 1;
            this.touchObject(o);
          }
        }
      }
    }
    if (s.minute >= s.env.nextWeatherChangeAt) {
      const options: Weather[] = s.env.weather === 'rain' ? ['cloudy', 'clear', 'clear'] : ['clear', 'clear', 'cloudy', 'breezy', 'rain'];
      const next = this.rng.pick(options);
      s.env.nextWeatherChangeAt = s.minute + this.rng.range(150, 480);
      if (next !== s.env.weather) {
        s.env.weather = next;
        const text: Record<Weather, string> = { clear: 'The sky cleared.', cloudy: 'Clouds drifted over the island.', rain: 'It started to rain.', breezy: 'A breeze picked up.' };
        this.emit('weather_changed', text[next], { location: null, data: { weather: next }, importance: next === 'rain' ? 0.25 : 0.1 });
      }
    }
  }

  private bloom(o: WorldObject) {
    if (o.state.bloomed) return;
    const mystery = !!o.state.mystery;
    const kind = mystery ? 'mystery_bloom' : 'sunflower';
    const def = OBJECT_KINDS[kind];
    o.kind = kind;
    o.name = def.name;
    o.tags = [...def.tags];
    o.state.bloomed = 1;
    o.state.growth = 100;
    this.touchObject(o);
    const ev = this.emit('plant_bloomed', `The ${def.name.toLowerCase()} that Calmling planted has bloomed.`, { location: o.location, objectIds: [o.id], importance: 0.65, data: { objectName: def.name } });
    this.remember(ev, { type: 'episodic', summary: `On Day ${ev.day}, the ${def.name.toLowerCase()} Calmling planted bloomed in the ${LOCATIONS[o.location].name.toLowerCase()}.`, importance: 0.65, relatedObjectIds: [o.id], emotion: { valence: 0.8, label: 'joy' } });
  }

  // ----------------------------------------------------------- perception --
  /** Calmling notices undiscovered objects close to it. */
  private perceive() {
    const s = this.state;
    const c = s.character;
    const radius = LOCATIONS[c.location].indoor ? 70 : 110;
    for (const o of Object.values(s.objects)) {
      if (o.discovered || o.heldBy) continue;
      if (Math.abs(o.x - c.x) > radius) continue;
      if (LOCATIONS[o.location].indoor !== LOCATIONS[c.location].indoor && o.location !== c.location) continue;
      o.discovered = true;
      this.touchObject(o);
      const gift = o.origin.type === 'gift' || o.origin.type === 'poll' || o.origin.type === 'community_goal';
      const where = LOCATIONS[o.location].name.toLowerCase();
      const ev = this.emit('object_discovered', `Calmling discovered ${article(o.name)} ${o.name.toLowerCase()} in the ${where}.`, {
        location: o.location,
        objectIds: [o.id],
        importance: gift ? 0.7 : 0.55,
        data: { objectName: o.name, locationName: where, origin: o.origin.type, sender: o.origin.by ?? null },
        highlightExtra: { isGift: gift, firstOfKind: !s.counters[`seen:${o.kind}`] },
      });
      s.counters[`seen:${o.kind}`] = (s.counters[`seen:${o.kind}`] ?? 0) + 1;
      this.remember(ev, {
        type: 'episodic',
        summary: `On Day ${ev.day}, Calmling discovered ${article(o.name)} ${o.name.toLowerCase()} in the ${where}.`,
        importance: gift ? 0.7 : 0.55,
        relatedObjectIds: [o.id],
        emotion: emotionFor(0.6, 'surprise'),
      });
      if (o.origin.type === 'gift' && o.origin.by) {
        this.remember(ev, {
          type: 'social',
          summary: `A viewer called ${o.origin.by} sent Calmling ${article(o.name)} ${o.name.toLowerCase()}.`,
          importance: 0.7,
          relatedObjectIds: [o.id],
          emotion: { valence: 0.6, label: 'warmth' },
          key: `gift:${o.id}`,
        });
      }
      // a brief reaction, unless asleep or busy with something uninterruptible
      if (c.activity && c.activity.interruptible && c.activity.action !== 'walk') {
        c.plan.unshift({ action: 'notice', targetId: o.id, location: c.location });
      } else if (!c.activity) {
        c.plan.unshift({ action: 'notice', targetId: o.id, location: c.location });
      }
    }
  }

  private maybeInterrupt() {
    const c = this.state.character;
    const a = c.activity;
    if (!a || !a.interruptible || a.action === 'walk' || !c.awake) return;
    const urgent = c.needs.energy < 10 || c.needs.hunger > 90;
    if (urgent && a.action !== 'sleep' && a.action !== 'eat_snack' && a.action !== 'eat_apple') {
      this.emit('activity_failed', `Calmling stopped ${ACTIONS[a.action].gerund} — ${c.needs.energy < 10 ? 'too tired' : 'too hungry'} to carry on.`, { action: a.action, objectIds: a.targetId ? [a.targetId] : [], data: { interrupted: true }, importance: 0.3 });
      c.activity = null;
      c.plan = [];
    }
  }

  // ------------------------------------------------------------- decisions --
  candidates(limit = 14): Candidate[] {
    return generateCandidates(this.state, limit);
  }

  recallFor(objectIds: string[] = []): Memory[] {
    return recall(this.state, { location: this.state.character.location, objectIds, limit: 6 });
  }

  /** Deterministic utility brain. Used directly, and as the fallback for the LLM. */
  decideDeterministic(source: Decision['source'] = 'deterministic'): Decision | null {
    const cands = this.candidates();
    const chosen = chooseDeterministic(cands, this.rng);
    if (!chosen) return this.idleFallback();
    return this.applyProposal({ action: chosen.action, targetId: chosen.targetId, goal: chosen.goal, reason: reasonFor(chosen) }, source, null, cands);
  }

  private idleFallback(): Decision | null {
    const c = this.state.character;
    // nothing valid (e.g. exhausted at an odd hour): sit quietly a moment
    c.activity = this.makeActivity({ action: 'pause', targetId: null, location: c.location }, 'pause', 'nothing else felt possible right now', null);
    this.awaitingDecision = false;
    return null;
  }

  /**
   * Validate a proposal from any brain. Invalid proposals are recorded and a
   * safe deterministic alternative is executed instead.
   */
  applyProposal(p: Proposal, source: Decision['source'], model: string | null, cands?: Candidate[]): Decision {
    const s = this.state;
    const c = s.character;
    const candidates = cands ?? this.candidates();
    const v = validateProposal(s, p);
    const decision: Decision = {
      id: this.nextId('dec'),
      minute: s.minute,
      day: dayOf(s.minute),
      source,
      model,
      goal: p.goal ?? ACTIONS[p.action]?.goal ?? 'unknown',
      action: p.action,
      targetId: p.targetId,
      reason: p.reason,
      valid: v.ok,
      rejectionReason: v.ok ? null : v.reason,
      candidates: candidates.slice(0, 8).map((x) => ({ action: x.action, targetId: x.targetId, score: Math.round(x.score * 100) / 100 })),
      thought: p.thought,
    };
    this.pending.decisions.push(decision);
    if (!v.ok) {
      const alt = chooseDeterministic(candidates, this.rng);
      if (!alt) {
        this.idleFallback();
        return decision;
      }
      const fallback = this.applyProposal({ action: alt.action, targetId: alt.targetId, goal: alt.goal, reason: `${reasonFor(alt)} (safe alternative: ${v.reason})` }, 'fallback', null, candidates);
      return fallback;
    }
    c.goal = decision.goal;
    c.goalReason = decision.reason;
    c.plan = v.steps;
    this.awaitingDecision = false;
    if (!c.activity) this.startStep(decision);
    return decision;
  }

  // ------------------------------------------------------------ activities --
  private makeActivity(step: { action: string; targetId: string | null; location: LocationId; x?: number }, goal: string, reason: string, decisionId: string | null, thought?: string): Activity {
    const s = this.state;
    const c = s.character;
    const def = ACTIONS[step.action];
    let duration = this.rng.range(def.duration[0], def.duration[1]);
    const gains: Partial<Needs> = { ...def.satisfies };
    if (step.action === 'walk' && step.x !== undefined) duration = Math.max(0.5, Math.abs(step.x - c.x) / WALK_SPEED);
    if (step.action === 'sleep') {
      duration = clamp(((100 - c.needs.energy) / 85) * 470, 120, 540);
      const mod = s.minute % MINUTES_PER_DAY;
      // at night, sleep through until morning (around 06:30–07:30)
      if (mod > 19 * 60 || mod < 6 * 60) {
        const untilMorning = (mod > 19 * 60 ? MINUTES_PER_DAY - mod : -mod) + 390 + this.rng.range(0, 60);
        duration = clamp(untilMorning, 120, 660);
      }
      gains.energy = 100 - c.needs.energy + 2;
    }
    let rewardBasis = 0;
    for (const k of NEED_KEYS) {
      const g = gains[k];
      if (g && g > 0) rewardBasis += pressure(c.needs, k) * g;
    }
    return {
      id: this.nextId('act'),
      goal,
      action: step.action,
      animation: def.animation,
      targetId: step.targetId,
      location: step.location,
      startedAt: s.minute,
      endsAt: s.minute + duration,
      fromX: step.action === 'walk' ? c.x : undefined,
      toX: step.action === 'walk' ? step.x : undefined,
      fromLocation: step.action === 'walk' ? c.location : undefined,
      reason,
      decisionId,
      interruptible: def.interruptible,
      thought,
      gains,
      rewardBasis: Math.min(1, rewardBasis / 25),
    };
  }

  private startStep(decision?: Decision) {
    const s = this.state;
    const c = s.character;
    const step = c.plan.shift();
    if (!step) return;
    const d = decision ?? null;
    // re-check that the target of this step still exists (the world may have changed)
    if (step.targetId && !s.objects[step.targetId] && step.action !== 'walk') {
      this.emit('activity_failed', `Calmling went to ${ACTIONS[step.action]?.label ?? step.action}, but it was no longer there.`, { action: step.action, importance: 0.3 });
      c.plan = [];
      c.failures++;
      return;
    }
    const a = this.makeActivity(step, c.goal ?? 'live', c.goalReason ?? '', d?.id ?? null, d?.thought);
    if (step.action === 'walk' && step.x !== undefined) c.facing = step.x >= c.x ? 1 : -1;
    else if (step.targetId && s.objects[step.targetId] && s.objects[step.targetId].heldBy !== 'calmling') c.facing = s.objects[step.targetId].x >= c.x ? 1 : -1;
    c.activity = a;
    this.pending.activities.push(a);
    if (step.action === 'sleep') {
      c.awake = false;
      this.emit('activity_started', 'Calmling curled up and fell asleep.', { action: 'sleep', objectIds: step.targetId ? [step.targetId] : [], importance: 0.3 });
    } else if (!ACTIONS[step.action].internal) {
      const target = step.targetId ? s.objects[step.targetId] : null;
      this.emit('activity_started', `Calmling started to ${ACTIONS[step.action].label}${target ? ` (${target.name.toLowerCase()})` : ''}.`, {
        action: step.action,
        objectIds: target ? [target.id] : [],
        data: { goal: c.goal, reason: c.goalReason },
        importance: 0.15,
      });
    }
  }

  private completeActivity() {
    const s = this.state;
    const c = s.character;
    const a = c.activity!;
    c.activity = null;
    const def = ACTIONS[a.action];
    const target = a.targetId ? s.objects[a.targetId] ?? null : null;

    if (a.action === 'walk') {
      c.x = a.toX ?? c.x;
      const loc = locationAt(c.x);
      const changed = loc !== a.fromLocation;
      c.location = loc;
      if (changed) {
        this.emit('arrived', `Calmling arrived at the ${LOCATIONS[loc].name.toLowerCase()}.`, { location: loc, importance: 0.1 });
        if (!s.visited.includes(loc)) {
          s.visited.push(loc);
          const ev = this.emit('first_time', `Calmling visited the ${LOCATIONS[loc].name.toLowerCase()} for the first time.`, { location: loc, importance: 0.6, data: { kind: 'location' } });
          this.remember(ev, { type: 'episodic', summary: `On Day ${ev.day}, Calmling explored the ${LOCATIONS[loc].name.toLowerCase()} for the first time.`, importance: 0.6, emotion: emotionFor(0.7, 'curious') });
        }
      }
      return;
    }

    const { succeeded, extra } = this.applyEffect(def, a, target);
    const reward = succeeded ? Math.min(1, a.rewardBasis * 0.8 + (extra ?? 0) + 0.1) : 0;

    if (def.internal) {
      if (a.action === 'wake_up') {
        this.emit('activity_completed', 'Calmling stretched and started the day.', { action: 'wake_up', importance: 0.1 });
      }
      return;
    }

    // bookkeeping that powers habits, personality and preferences
    if (target) {
      target.interactions++;
      target.lastInteractionMinute = s.minute;
      target.affinity = Math.round((target.affinity + reward) * 100) / 100;
      this.touchObject(target);
    }
    for (const k of Object.keys(s.counters)) if (k.startsWith('recent:')) s.counters[k] = Math.round(s.counters[k] * 0.8 * 100) / 100;
    s.counters[`recent:${a.action}`] = (s.counters[`recent:${a.action}`] ?? 0) + 1;
    s.counters[`done:${a.action}`] = (s.counters[`done:${a.action}`] ?? 0) + 1;
    s.counters[`locReward:${c.location}`] = Math.round(((s.counters[`locReward:${c.location}`] ?? 0) + reward) * 100) / 100;
    if (succeeded) c.failures = 0;

    const phase = phaseOf(a.startedAt);
    const ev = succeeded
      ? this.emit('activity_completed', this.completionSummary(def, target, extra), {
          action: a.action,
          objectIds: target ? [target.id] : [],
          data: { reward: Math.round(reward * 100) / 100, phase, goal: a.goal, durationMinutes: Math.round(a.endsAt - a.startedAt) },
          importance: 0.15 + reward * 0.2,
        })
      : this.emit('activity_failed', this.failureSummary(def, target), { action: a.action, objectIds: target ? [target.id] : [], importance: 0.3, data: { phase } });

    if (!succeeded && c.failures >= 3) {
      this.remember(ev, { type: 'episodic', summary: `On Day ${ev.day}, Calmling kept trying to ${def.label} without luck.`, importance: 0.45, relatedObjectIds: target ? [target.id] : [], emotion: emotionFor(-0.3, 'frustration') });
    }

    if (!s.experienced.includes(a.action)) {
      s.experienced.push(a.action);
      const fe = this.emit('first_time', `For the first time, Calmling ${pastTense(def, target)}.`, { action: a.action, objectIds: target ? [target.id] : [], importance: 0.6, data: { kind: 'action' } });
      this.remember(fe, { type: 'episodic', summary: `On Day ${fe.day}, Calmling ${pastTense(def, target)} for the first time.`, importance: 0.6, relatedObjectIds: target ? [target.id] : [], emotion: emotionFor(reward, 'curious') });
    }

    // habits
    const changes = recordHabitObservation(s, {
      eventId: ev.id,
      action: a.action,
      phase,
      location: c.location,
      objectId: target?.id ?? null,
      objectName: target?.name ?? null,
      objectKind: target?.kind ?? null,
      prevAction: c.lastActionMinute !== null && a.startedAt - c.lastActionMinute < 45 ? c.lastAction : null,
      hasAlternatives: !!target && Object.values(s.objects).some((o) => o.id !== target.id && o.discovered && o.kind !== target.kind && def.targetTags?.some((t) => o.tags.includes(t))),
      reward,
      day: dayOf(s.minute),
      minute: s.minute,
    });
    this.handleHabitChanges(changes);

    // personality evolves slowly from experience
    evolveTraits(s, a.action, reward, succeeded);
    if (!succeeded) {
      c.failures++;
      satisfy(c.needs, 'confidence', -3);
    }

    // preference memories emerge from repeated, rewarding interactions
    if (target && target.interactions >= 4 && target.affinity / target.interactions > 0.45) {
      const key = `pref:obj:${target.id}`;
      if (!s.memories.some((m) => m.key === key)) {
        this.remember(ev, {
          type: 'preference',
          summary: `Calmling has grown fond of the ${target.name.toLowerCase()} (${def.gerund}).`,
          importance: 0.6,
          relatedObjectIds: [target.id],
          relatedEventIds: [ev.id],
          emotion: { valence: 0.7, label: 'fondness' },
          key,
        });
      }
    }

    c.lastAction = a.action;
    c.lastActionMinute = s.minute;
  }

  private completionSummary(def: ActionDef, target: WorldObject | null, extra?: number): string {
    const t = target ? ` ${target.name.toLowerCase()}` : '';
    switch (def.id) {
      case 'sleep': return 'Calmling woke up after a long sleep.';
      case 'read': return `Calmling read the${t}.`;
      case 'water_plant': return `Calmling watered the${t}.`;
      case 'fish': return extra && extra > 0.1 ? 'Calmling caught a little fish and let it go again.' : 'Calmling fished for a while. Nothing bit.';
      case 'explore': return 'Calmling explored the forest clearing.';
      case 'eat_apple': return 'Calmling picked an apple and ate it.';
      case 'keep_object': return `Calmling put the${t} somewhere safe at home.`;
      case 'plant_seed':
      case 'plant_flower': return `Calmling planted something in the garden.`;
      case 'notice_audience': return 'Calmling waved to the people watching.';
      default: return `Calmling finished: ${def.label}${target ? ` (${target.name.toLowerCase()})` : ''}.`;
    }
  }

  private failureSummary(def: ActionDef, target: WorldObject | null): string {
    return `Calmling tried to ${def.label}${target ? ` (${target.name.toLowerCase()})` : ''}, but it didn't work out.`;
  }

  /** Concrete, validated world changes. Returns success + bonus reward. */
  private applyEffect(def: ActionDef, a: Activity, target: WorldObject | null): { succeeded: boolean; extra?: number } {
    const s = this.state;
    const c = s.character;
    const held = c.heldObjectId ? s.objects[c.heldObjectId] ?? null : null;
    switch (def.effect) {
      case 'sleep': {
        c.awake = true;
        c.plan.unshift({ action: 'wake_up', targetId: null, location: c.location });
        return { succeeded: true };
      }
      case 'pick_up': {
        if (!target || target.heldBy) return { succeeded: false };
        target.heldBy = 'calmling';
        c.heldObjectId = target.id;
        this.touchObject(target);
        this.emit('object_picked_up', `Calmling picked up the ${target.name.toLowerCase()}.`, { objectIds: [target.id], importance: 0.15 });
        return { succeeded: true };
      }
      case 'place': {
        const obj = a.action === 'keep_object' ? target : held;
        if (!obj) return { succeeded: false };
        const from = obj.location;
        obj.heldBy = null;
        obj.location = c.location;
        obj.x = a.action === 'keep_object' ? keepDestination(obj).x : Math.round(c.x + 10 * c.facing);
        if (c.heldObjectId === obj.id) c.heldObjectId = null;
        this.touchObject(obj);
        const ev = this.emit('object_placed', `Calmling put the ${obj.name.toLowerCase()} down in the ${LOCATIONS[obj.location].name.toLowerCase()}.`, {
          objectIds: [obj.id],
          data: { from, to: obj.location, kept: a.action === 'keep_object' },
          importance: a.action === 'keep_object' ? 0.45 : 0.1,
        });
        if (a.action === 'keep_object') {
          this.remember(ev, {
            type: 'semantic',
            summary: `The ${obj.name.toLowerCase()} is kept in the ${LOCATIONS[obj.location].name.toLowerCase()}${obj.location === 'bedroom' ? ', beside the bed' : ', on the shelf'}.`,
            importance: 0.5,
            relatedObjectIds: [obj.id],
            key: `where:${obj.id}`,
          });
        }
        return { succeeded: true, extra: a.action === 'keep_object' ? 0.2 : 0 };
      }
      case 'eat_apple': {
        if (!target || (target.state.fruit ?? 0) < 1) return { succeeded: false };
        target.state.fruit -= 1;
        this.touchObject(target);
        return { succeeded: true };
      }
      case 'water': {
        if (!target || !held || !held.tags.includes('water_tool')) return { succeeded: false };
        target.state.water = 100;
        target.state.wilting = 0;
        held.interactions++;
        this.touchObject(target);
        this.touchObject(held);
        return { succeeded: true, extra: 0.15 };
      }
      case 'tend': {
        if (!target) return { succeeded: false };
        if (target.state.growth !== undefined && target.state.growth < 100) target.state.growth = clamp(target.state.growth + 6);
        this.touchObject(target);
        return { succeeded: true };
      }
      case 'plant': {
        if (!held || !(held.tags.includes('seed') || held.tags.includes('plantable'))) return { succeeded: false };
        const x = this.freeGardenSpot();
        c.heldObjectId = null;
        if (held.tags.includes('seed')) {
          const mystery = held.kind === 'mystery_seed';
          this.removeObject(held.id, 'planted');
          const sprout = makeObject(this.nextId('obj'), 'sprout', 'garden', x, s.minute, { type: 'calmling', by: held.origin.by, byUserId: held.origin.byUserId, giftId: held.origin.giftId }, { discovered: true });
          sprout.name = mystery ? 'Mysterious sprout' : 'Sunflower sprout';
          sprout.state = { water: 70, growth: 0, inspected: 1, ...(mystery ? { mystery: 1 } : {}) };
          s.objects[sprout.id] = sprout;
          this.touchObject(sprout);
          const ev = this.emit('object_created', `Calmling planted the ${held.name.toLowerCase()} in the garden.`, { location: 'garden', objectIds: [sprout.id, held.id], importance: 0.55, data: { objectName: sprout.name, madeBy: 'calmling', fromGift: held.origin.by ?? null } });
          this.remember(ev, { type: 'episodic', summary: `On Day ${ev.day}, Calmling planted the ${held.name.toLowerCase()} in the garden.`, importance: 0.6, relatedObjectIds: [sprout.id, held.id], emotion: { valence: 0.6, label: 'hope' } });
        } else {
          held.heldBy = null;
          held.location = 'garden';
          held.x = x;
          held.state.planted = 1;
          held.name = `Planted ${held.name.toLowerCase()}`;
          this.touchObject(held);
          const ev = this.emit('object_moved', `Calmling planted the ${held.name.replace(/^Planted /, '')} in the garden.`, { location: 'garden', objectIds: [held.id], importance: 0.55, data: { planted: true } });
          this.remember(ev, { type: 'episodic', summary: `On Day ${ev.day}, Calmling planted the ${held.name.replace(/^Planted /, '')} in the garden.`, importance: 0.6, relatedObjectIds: [held.id], emotion: { valence: 0.6, label: 'care' } });
        }
        return { succeeded: true, extra: 0.2 };
      }
      case 'paint':
      case 'sketch':
      case 'photo': {
        const kind = def.effect === 'paint' ? 'painting' : def.effect === 'sketch' ? 'sketch' : 'photo';
        const existing = Object.values(s.objects).filter((o) => o.kind === kind).length;
        const chance = def.effect === 'sketch' ? 0.35 : def.effect === 'photo' ? 0.5 : 0.8;
        const tool = a.targetId ? s.objects[a.targetId] : null;
        if (tool) {
          tool.interactions++;
          this.touchObject(tool);
        }
        if (existing < 8 && this.rng.chance(chance)) {
          const subject = this.subject();
          const loc: LocationId = kind === 'painting' ? 'home' : c.location === 'bedroom' ? 'bedroom' : 'home';
          const o = makeObject(this.nextId('obj'), kind, loc, 480 + existing * 14 + Math.round(this.rng.range(0, 8)), s.minute, { type: 'calmling' }, { discovered: true });
          o.name = `${OBJECT_KINDS[kind].name} of ${subject}`;
          o.state = { inspected: 1 };
          s.objects[o.id] = o;
          this.touchObject(o);
          const ev = this.emit('object_created', `Calmling made a ${kind} of ${subject}.`, { objectIds: [o.id], importance: 0.5, data: { objectName: o.name, madeBy: 'calmling' }, highlightExtra: { firstOfKind: existing === 0 } });
          this.remember(ev, { type: 'episodic', summary: `On Day ${ev.day}, Calmling made a ${kind} of ${subject} and hung it at home.`, importance: 0.5, relatedObjectIds: [o.id], emotion: { valence: 0.7, label: 'pride' } });
          return { succeeded: true, extra: 0.15 };
        }
        s.counters[`portfolio:${kind}`] = (s.counters[`portfolio:${kind}`] ?? 0) + 1;
        return { succeeded: true };
      }
      case 'read': {
        if (!target) return { succeeded: false };
        return { succeeded: true };
      }
      case 'tea': {
        const cup = Object.values(s.objects).find((o) => o.kind === 'cup' && o.discovered && o.state.inspected && !o.heldBy);
        if (cup) {
          cup.interactions++;
          cup.affinity += 0.3;
          this.touchObject(cup);
        }
        return { succeeded: true };
      }
      case 'fish': {
        const caught = this.rng.chance(0.4 + (c.traits.patience - 50) / 300);
        if (!caught) {
          c.failures++;
          return { succeeded: true, extra: -0.1 };
        }
        s.counters.fishCaught = (s.counters.fishCaught ?? 0) + 1;
        return { succeeded: true, extra: 0.25 };
      }
      case 'explore': {
        if (this.rng.chance(0.4)) {
          const kinds = ['pinecone', 'feather', 'pebble', 'mushroom', 'shell'];
          const kind = this.rng.pick(kinds);
          const o = makeObject(this.nextId('obj'), kind, 'forest', Math.round(this.rng.range(30, 200)), s.minute, { type: 'discovery' }, { discovered: false });
          s.objects[o.id] = o;
          this.touchObject(o);
          // perception on the next step will register the discovery
          return { succeeded: true, extra: 0.2 };
        }
        return { succeeded: true };
      }
      case 'inspect': {
        if (!target) return { succeeded: false };
        target.state.inspected = 1;
        this.touchObject(target);
        const kd = OBJECT_KINDS[target.kind];
        const ev = this.emit('memory_formed', `Calmling learned something about the ${target.name.toLowerCase()}.`, { objectIds: [target.id], importance: 0.3 });
        this.remember(ev, {
          type: 'semantic',
          summary: `${kd?.description ?? target.name} It is in the ${LOCATIONS[target.location].name.toLowerCase()}.`,
          importance: 0.45,
          relatedObjectIds: [target.id],
          key: `obj:${target.id}`,
        });
        return { succeeded: true, extra: 0.1 };
      }
      case 'notice_audience': {
        const obs = s.observations.find((o) => !o.consumed);
        if (!obs) return { succeeded: false };
        obs.consumed = true;
        const themes = obs.themes.slice(0, 3).join(', ');
        const ev = this.emit('audience_noticed', `Calmling noticed the people watching${themes ? `, who were talking about ${themes}` : ''}, and waved.`, {
          importance: 0.5,
          data: { themes, messageCount: obs.messageCount, observationId: obs.id },
        });
        this.remember(ev, { type: 'social', summary: `On Day ${ev.day}, Calmling noticed viewers chatting${themes ? ` about ${themes}` : ''} and waved to them.`, importance: 0.45, emotion: { valence: 0.6, label: 'warmth' } });
        return { succeeded: true, extra: 0.1 };
      }
      default:
        return { succeeded: true };
    }
  }

  private subject(): string {
    const s = this.state;
    const c = s.character;
    if (isSunset(s.minute)) return 'the sunset';
    const nearby = Object.values(s.objects).filter((o) => o.discovered && o.location === c.location && !['furniture', 'tool', 'creative'].includes(OBJECT_KINDS[o.kind]?.category ?? ''));
    if (nearby.length && this.rng.chance(0.6)) return `the ${this.rng.pick(nearby).name.toLowerCase()}`;
    return `the ${LOCATIONS[c.location].name.toLowerCase()}`;
  }

  private freeGardenSpot(): number {
    const taken = Object.values(this.state.objects).filter((o) => o.location === 'garden').map((o) => o.x);
    for (let x = 330; x < 460; x += 12) if (!taken.some((t) => Math.abs(t - x) < 10)) return x;
    return 330 + Math.round(this.rng.range(0, 120));
  }

  private handleHabitChanges(changes: HabitChange[]) {
    for (const { habit, change } of changes) {
      this.pending.habits.set(habit.key, habit);
      const def = ACTIONS[habit.action];
      if (change === 'formed' || change === 'reformed') {
        const ev = this.emit('habit_formed', `A habit has formed: ${habit.label}.`, { action: habit.action, data: { label: habit.label, habitId: habit.id, strength: habit.strength, explanation: habit.explanation }, importance: 0.7 });
        this.remember(ev, {
          type: 'habit',
          summary: `Calmling often ${habit.label.charAt(0).toLowerCase()}${habit.label.slice(1)}.`,
          importance: 0.65,
          relatedEventIds: [ev.id, ...habit.occurrences.slice(-5).map((o) => o.eventId)],
          emotion: { valence: 0.5, label: 'familiarity' },
          key: `habit:${habit.key}`,
        });
      } else if (change === 'strengthened') {
        this.emit('habit_strengthened', `The habit "${habit.label}" grew stronger (${habit.strength.toFixed(0)}).`, { action: habit.action, data: { label: habit.label, habitId: habit.id, strength: habit.strength }, importance: 0.3 });
      } else if (change === 'dissolved' || change === 'fading') {
        const ev = this.emit('habit_faded', change === 'dissolved' ? `The habit "${habit.label}" has faded away.` : `The habit "${habit.label}" is fading.`, {
          action: habit.action,
          data: { label: habit.label, habitId: habit.id, strength: habit.strength, gerund: def?.gerund },
          importance: change === 'dissolved' ? 0.45 : 0.25,
        });
        if (change === 'dissolved') {
          this.remember(ev, { type: 'habit', summary: `Calmling used to ${habit.label.charAt(0).toLowerCase()}${habit.label.slice(1)}, but not any more.`, importance: 0.4, emotion: { valence: 0, label: 'change' }, key: `habit:${habit.key}` });
        }
      }
    }
  }

  private onNewDay(day: number) {
    const s = this.state;
    const c = s.character;
    this.pending.dayEnded.push(day - 1);
    const ev = this.emit('day_started', `Day ${day} began on the island.`, { location: null, importance: 0.2, data: { day } });
    // trait history & measurable personality change
    s.traitHistory.push({ day, traits: { ...c.traits } });
    if (s.traitHistory.length > 400) s.traitHistory.splice(1, s.traitHistory.length - 400);
    this.pending.traitSnapshots.push({ day, minute: s.minute, traits: { ...c.traits } });
    for (const t of traitTrends(s.traitHistory, c.traits, day, 7, 3).slice(0, 1)) {
      const key = `trait:${t.trait}:${Math.sign(t.delta)}`;
      if ((s.counters[`announced:${key}`] ?? 0) > day - 7) continue;
      s.counters[`announced:${key}`] = day;
      this.emit('trait_shift', t.statement, { location: null, importance: 0.55, data: { ...t } });
    }
    this.handleHabitChanges(dailyHabitReview(s, day));
    // semantic world facts, always recomputed from real state
    const gardenPlants = Object.values(s.objects).filter((o) => o.location === 'garden' && o.tags.includes('plant')).length;
    this.remember(ev, { type: 'semantic', summary: `The garden has ${gardenPlants} plant${gardenPlants === 1 ? '' : 's'} growing in it.`, importance: 0.3, key: 'fact:garden_plants', location: 'garden' });
    const bestLoc = (Object.keys(LOCATIONS) as LocationId[]).map((l) => [l, s.counters[`locReward:${l}`] ?? 0] as const).sort((a, b) => b[1] - a[1])[0];
    if (bestLoc && bestLoc[1] > 3) {
      this.remember(ev, { type: 'preference', summary: `Calmling seems happiest spending time at the ${LOCATIONS[bestLoc[0]].name.toLowerCase()}.`, importance: 0.55, key: 'pref:location', location: bestLoc[0], emotion: { valence: 0.6, label: 'fondness' } });
    }
    const { created, folded } = consolidate(s, day, () => this.nextId('mem'));
    for (const m of [...created, ...folded]) this.pending.memories.set(m.id, m);
    s.observations = s.observations.filter((o) => !o.consumed || s.minute - o.minute < 240).slice(-10);
  }

  // ----------------------------------------------------- external influence --
  /** A viewer gift, poll outcome or community build enters the world. */
  addExternalObject(input: { kind: string; location?: LocationId; origin: WorldObject['origin']; name?: string; eventType?: 'gift_arrived' | 'goal_completed' | 'poll_outcome'; id?: string }): WorldObject {
    const s = this.state;
    const def = OBJECT_KINDS[input.kind];
    if (!def) throw new Error(`unknown object kind ${input.kind}`);
    const structure = def.category === 'structure' || input.kind === 'flower_meadow';
    const location: LocationId = input.location ?? (input.kind === 'bridge' ? 'pond' : input.kind === 'treehouse' ? 'forest' : input.kind === 'flower_meadow' ? 'garden' : 'garden');
    const sameKindNearby = Object.values(s.objects).filter((o) => o.location === location && Math.abs(o.x - GIFT_DROP_X[location]) < 40).length;
    const x = structure ? (input.kind === 'bridge' ? 950 : input.kind === 'treehouse' ? 60 : input.kind === 'telescope' ? 800 : 420) : GIFT_DROP_X[location] - sameKindNearby * 9;
    const o = makeObject(input.id ?? this.nextId('obj'), input.kind, location, Math.round(x), s.minute, input.origin, { discovered: false, permanent: structure });
    if (input.name) o.name = input.name;
    if (input.kind === 'mystery_seed') o.state.mystery = 1;
    s.objects[o.id] = o;
    this.touchObject(o);
    const evType = input.eventType ?? 'gift_arrived';
    const by = input.origin.by ?? 'someone';
    const summary =
      evType === 'gift_arrived'
        ? `${by} sent ${article(o.name)} ${o.name.toLowerCase()}. It appeared in the ${LOCATIONS[location].name.toLowerCase()}.`
        : evType === 'goal_completed'
          ? `The community completed a project: ${article(o.name)} ${o.name.toLowerCase()} now stands in the ${LOCATIONS[location].name.toLowerCase()}.`
          : `The community vote brought ${article(o.name)} ${o.name.toLowerCase()} to the ${LOCATIONS[location].name.toLowerCase()}.`;
    this.emit(evType, summary, {
      location,
      objectIds: [o.id],
      importance: evType === 'gift_arrived' ? 0.4 : 0.8,
      data: { objectName: o.name, kind: o.kind, sender: by, senderUserId: input.origin.byUserId ?? null, giftId: input.origin.giftId ?? null, locationName: LOCATIONS[location].name.toLowerCase() },
      highlightExtra: { isGift: true },
    });
    this.emit('object_created', `${article(o.name, true)} ${o.name.toLowerCase()} was added to the world.`, { location, objectIds: [o.id], importance: 0.1, data: { objectName: o.name, madeBy: input.origin.type } });
    return o;
  }

  removeObject(id: string, reason: string): boolean {
    const s = this.state;
    const o = s.objects[id];
    if (!o) return false;
    if (s.character.heldObjectId === id) s.character.heldObjectId = null;
    delete s.objects[id];
    s.character.plan = s.character.plan.filter((p) => p.targetId !== id);
    this.pending.objectsRemoved.add(id);
    this.emit('object_removed', `The ${o.name.toLowerCase()} is no longer in the world (${reason}).`, { location: o.location, objectIds: [id], importance: 0.15, data: { reason } });
    return true;
  }

  addObservation(obs: Omit<Observation, 'id' | 'consumed' | 'minute'>): Observation {
    const o: Observation = { ...obs, id: this.nextId('obs'), minute: this.state.minute, consumed: false };
    this.state.observations.push(o);
    this.state.observations = this.state.observations.slice(-10);
    return o;
  }

  setPaused(p: boolean, reason = 'admin') {
    this.state.paused = p;
    this.emit('admin', p ? `Simulation paused (${reason}).` : `Simulation resumed (${reason}).`, { location: null, importance: 0 });
  }

  frame() {
    return toPublicFrame(this.state);
  }
}

function article(name: string, cap = false): string {
  const a = /^[aeiou]/i.test(name) ? 'an' : 'a';
  return cap ? a[0].toUpperCase() + a.slice(1) : a;
}

function pastTense(def: ActionDef, target: WorldObject | null): string {
  const t = target ? ` the ${target.name.toLowerCase()}` : '';
  const map: Record<string, string> = {
    sleep: 'slept through the night',
    rest: `sat down to rest`,
    eat_snack: 'had a snack from the pantry',
    eat_apple: 'picked an apple from the tree',
    drink_tea: 'made a cup of tea',
    water_plant: `watered${t}`,
    tend_garden: 'tended the garden',
    plant_seed: 'planted a seed',
    plant_flower: 'planted a flower',
    paint: 'painted a picture',
    sketch: 'drew in the sketchbook',
    read: `read${t}`,
    fish: 'went fishing',
    dance: 'danced',
    watch_sunset: 'watched the sunset',
    explore: 'explored the forest clearing',
    wander: 'wandered around',
    inspect: `examined${t}`,
    keep_object: `kept${t}`,
    cuddle: `cuddled${t}`,
    play: `played with${t}`,
    take_photo: 'took a photo',
    play_music: 'played the piano',
    stargaze: 'looked at the stars',
    notice_audience: 'waved to the people watching',
  };
  return map[def.id] ?? def.label;
}

/** Convenience runner for tests and accelerated mode. */
export function runFor(sim: Simulation, minutes: number, stepMinutes = 1, onDrain?: (p: Pending) => void): void {
  let left = minutes;
  while (left > 0) {
    const m = Math.min(stepMinutes, left);
    sim.tick(m, { autoDecide: true });
    left -= m;
    if (onDrain) onDrain(sim.drain());
  }
}

export { MINUTES_PER_DAY };
