import {
  Simulation,
  composeDiaryTemplate,
  selectDiaryFacts,
  summarizeChat,
  toPublicFrame,
  type Pending,
  type PublicFrame,
  type ServerMessage,
  type SimEvent,
  type WorldObject,
  OBJECT_KINDS,
  type LocationId,
  type Proposal,
} from '@calmling/core';
import type { Config } from './config';
import type { Db } from './db';
import type { LlmClient } from './llm';
import { Store, type CommitExtras } from './store';

export type Broadcast = (msg: ServerMessage) => void;

function mergePending(a: Pending, b: Pending): Pending {
  a.events.push(...b.events);
  for (const [k, v] of b.memories) a.memories.set(k, v);
  for (const [k, v] of b.habits) a.habits.set(k, v);
  a.decisions.push(...b.decisions);
  for (const id of b.objectsChanged) a.objectsChanged.add(id);
  for (const id of b.objectsRemoved) {
    a.objectsRemoved.add(id);
    a.objectsChanged.delete(id);
  }
  a.highlights.push(...b.highlights);
  a.activities.push(...b.activities);
  a.traitSnapshots.push(...b.traitSnapshots);
  a.dayEnded.push(...b.dayEnded);
  return a;
}

/**
 * The persistent simulation service. Runs independently of any browser,
 * commits every tick transactionally, resumes from the last snapshot after a
 * restart, and pulls community input from durable database queues.
 */
export class SimulationRuntime {
  sim!: Simulation;
  store: Store;
  timeScale: number;
  running = false;
  private timer: NodeJS.Timeout | null = null;
  private inTick = false;
  private deciding = false;
  private pendingProposal: Proposal | 'fallback' | null = null;
  private lastObserveAt = 0;
  private lastChatSeen = new Date(0).toISOString();
  lastTickAt = 0;
  lastTickMs = 0;
  ticksSinceStart = 0;
  errorCount = 0;
  fastForwarding = false;
  private listeners: Broadcast[] = [];
  private lastObjects = new Map<string, string>();
  private lastBroadcastSeq = 0;

  constructor(public cfg: Config, public db: Db, public llm: LlmClient) {
    this.store = new Store(db);
    this.timeScale = cfg.timeScale;
  }

  onBroadcast(fn: Broadcast) {
    this.listeners.push(fn);
  }
  private broadcast(msg: ServerMessage) {
    for (const l of this.listeners) {
      try {
        l(msg);
      } catch (e) {
        void this.store.logError('broadcast', e);
      }
    }
  }

  /** Load the persisted life, or begin a new one if none exists. */
  async init() {
    await this.store.seedStatic(this.cfg.seed);
    const saved = await this.store.loadSnapshot();
    if (saved) {
      this.sim = new Simulation(saved);
      // an in-flight LLM decision cannot survive a restart: decide again
      if (!saved.character.activity && !saved.character.plan.length) this.sim.awaitingDecision = true;
      console.log(`[sim] resumed: day ${Math.floor(saved.minute / 1440) + 1}, tick ${saved.tick}, seq ${saved.seq}`);
    } else {
      this.sim = Simulation.create(this.cfg.seed);
      for (const id of Object.keys(this.sim.state.objects)) this.sim.pending.objectsChanged.add(id);
      await this.store.commit(this.sim.state, this.sim.drain());
      console.log('[sim] a brand new life began');
    }
    for (const o of Object.values(this.sim.state.objects)) this.lastObjects.set(o.id, JSON.stringify(o));
    this.lastBroadcastSeq = this.sim.state.seq;
    await this.ensureCommunityDefaults();
  }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = async () => {
      if (!this.running) return;
      const t0 = Date.now();
      await this.tickOnce();
      this.timer = setTimeout(loop, Math.max(10, this.cfg.tickMs - (Date.now() - t0)));
    };
    this.timer = setTimeout(loop, this.cfg.tickMs);
  }

  async stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    while (this.inTick) await new Promise((r) => setTimeout(r, 20));
  }

  /** One real-time tick: inbox → simulate → decide → commit → broadcast. */
  async tickOnce(): Promise<void> {
    if (this.inTick || this.fastForwarding) return;
    this.inTick = true;
    const t0 = Date.now();
    try {
      const extras = await this.processInbox();
      if (this.pendingProposal) {
        const p = this.pendingProposal;
        this.pendingProposal = null;
        if (this.sim.awaitingDecision) {
          if (p === 'fallback') this.sim.decideDeterministic('fallback');
          else this.sim.applyProposal(p, 'llm', this.cfg.openai.model);
        }
      }
      const minutes = ((this.cfg.tickMs / 1000) * this.timeScale) / 60;
      this.sim.tick(minutes);
      if (this.sim.awaitingDecision && !this.deciding && !this.sim.state.paused) await this.decide();
      const pending = this.sim.drain();
      await this.store.commit(this.sim.state, pending, extras);
      this.afterCommit(pending);
      this.lastTickAt = Date.now();
      this.ticksSinceStart++;
    } catch (e) {
      this.errorCount++;
      await this.store.logError('tick', e);
      // the in-memory state may contain uncommitted changes: reload the last checkpoint
      const saved = await this.store.loadSnapshot().catch(() => null);
      if (saved) {
        this.sim = new Simulation(saved);
        this.sim.awaitingDecision = !saved.character.activity && !saved.character.plan.length;
      }
    } finally {
      this.lastTickMs = Date.now() - t0;
      this.inTick = false;
    }
  }

  private async decide() {
    if (this.llm.canDecide()) {
      this.deciding = true;
      const cands = this.sim.candidates();
      const memories = this.sim.recallFor(cands.slice(0, 5).map((c) => c.targetId).filter((x): x is string => !!x));
      // LLM calls are async; the world keeps ticking while Calmling ponders
      void this.llm
        .decide(this.sim.state, cands, memories)
        .then((proposal) => {
          // applied at the start of the next tick so state only changes inside a tick
          this.pendingProposal = proposal ?? 'fallback';
        })
        .catch((e) => this.store.logError('llm', e))
        .finally(() => {
          this.deciding = false;
        });
      return;
    }
    this.sim.decideDeterministic();
  }

  private afterCommit(p: Pending) {
    const frame = toPublicFrame(this.sim.state);
    const changed: WorldObject[] = [];
    const removed: string[] = [];
    for (const o of frame.objects) {
      const sig = JSON.stringify(o);
      if (this.lastObjects.get(o.id) !== sig) {
        changed.push(o);
        this.lastObjects.set(o.id, sig);
      }
    }
    for (const id of [...this.lastObjects.keys()]) {
      if (!this.sim.state.objects[id]) {
        removed.push(id);
        this.lastObjects.delete(id);
      }
    }
    const { objects: _o, ...rest } = frame;
    this.broadcast({
      type: 'delta',
      serverTime: Date.now(),
      seq: frame.seq,
      prevSeq: this.lastBroadcastSeq,
      tick: frame.tick,
      minute: frame.minute,
      timeScale: this.timeScale,
      frame: rest,
      changedObjects: changed,
      removedObjectIds: removed,
      events: p.events.filter((e) => e.type !== 'activity_started' || e.importance > 0.1).slice(-30),
    });
    this.lastBroadcastSeq = frame.seq;
    for (const h of p.highlights) this.broadcast({ type: 'highlight', highlight: h });
    for (const day of p.dayEnded) if (day >= 1) void this.writeDiary(day);
  }

  fullFrame(): PublicFrame {
    return toPublicFrame(this.sim.state);
  }

  // -------------------------------------------------------------- inbox --
  /** Durable queues: pending gifts, completed goals and closed polls. */
  private async processInbox(): Promise<CommitExtras> {
    const extras: CommitExtras = { deliveredGifts: [], completedGoals: [], executedPolls: [] };
    const gifts = await this.db.query<{ id: string; kind: string; sender_name: string; sender_user_id: string; location: LocationId }>(
      "select id, kind, sender_name, sender_user_id, location from gifts where status = 'pending' order by created_at limit 20",
    );
    for (const g of gifts.rows) {
      const objectId = `gift_${g.id}`;
      if (!this.sim.state.objects[objectId]) {
        this.sim.addExternalObject({ id: objectId, kind: g.kind, location: g.location, origin: { type: 'gift', by: g.sender_name, byUserId: g.sender_user_id, giftId: g.id }, eventType: 'gift_arrived' });
      }
      extras.deliveredGifts.push({ giftId: g.id, objectId, day: Math.floor(this.sim.state.minute / 1440) + 1 });
    }
    const goals = await this.db.query<{ id: string; reward_kind: string; reward_label: string; title: string }>(
      "select id, reward_kind, reward_label, title from community_goals where status = 'completed' and completion_event_id is null limit 5",
    );
    for (const g of goals.rows) {
      const objectId = `goal_${g.id}`;
      if (!this.sim.state.objects[objectId]) this.sim.addExternalObject({ id: objectId, kind: g.reward_kind, name: g.reward_label, origin: { type: 'community_goal', by: 'the community' }, eventType: 'goal_completed' });
      const ev = this.sim.pending.events.filter((e) => e.type === 'goal_completed').pop();
      extras.completedGoals.push({ goalId: g.id, eventId: ev?.id ?? 'existing' });
    }
    await this.closeDuePolls(extras);
    await this.observeChat();
    return extras;
  }

  private async closeDuePolls(extras: CommitExtras) {
    const due = await this.db.query<{ id: string }>("select id from polls where status = 'open' and closes_at <= now() limit 5");
    for (const p of due.rows) {
      const tally = await this.db.query<{ id: string; kind: string; label: string; votes: number | string }>(
        `select o.id, o.kind, o.label, count(v.user_id) as votes from poll_options o left join poll_votes v on v.option_id = o.id
         where o.poll_id = $1 group by o.id, o.kind, o.label, o.sort order by count(v.user_id) desc, o.sort asc`,
        [p.id],
      );
      const winner = tally.rows[0];
      await this.db.query("update polls set status = 'closed', closed_at = now(), winning_option_id = $2 where id = $1", [p.id, winner?.id ?? null]);
    }
    const toExecute = await this.db.query<{ id: string; kind: string; label: string }>(
      `select p.id, o.kind, o.label from polls p join poll_options o on o.id = p.winning_option_id where p.status = 'closed' and p.outcome_event_id is null limit 5`,
    );
    for (const p of toExecute.rows) {
      const objectId = `poll_${p.id}`;
      if (!this.sim.state.objects[objectId] && OBJECT_KINDS[p.kind]) {
        this.sim.addExternalObject({ id: objectId, kind: p.kind, name: p.label, origin: { type: 'poll', by: 'the community vote' }, eventType: 'poll_outcome' });
      }
      const ev = this.sim.pending.events.filter((e) => e.type === 'poll_outcome').pop();
      extras.executedPolls.push({ pollId: p.id, eventId: ev?.id ?? 'existing' });
    }
    // keep one poll open at all times
    const open = await this.db.query("select 1 from polls where status = 'open' limit 1");
    if (!open.rows.length) await this.createDailyPoll();
  }

  async createDailyPoll(question = 'What should arrive on the island next?', options?: { label: string; kind: string }[]) {
    const day = Math.floor(this.sim.state.minute / 1440) + 1;
    const pool = [
      { label: 'A camera', kind: 'camera' },
      { label: 'A little piano', kind: 'piano' },
      { label: 'A mysterious seed', kind: 'mystery_seed' },
      { label: 'A telescope', kind: 'telescope' },
      { label: 'A painting set', kind: 'painting_set' },
      { label: 'A teddy bear', kind: 'teddy_bear' },
    ];
    const opts = options ?? [0, 1, 2].map((i) => pool[(day + i * 2) % pool.length]);
    const id = `poll_${Date.now().toString(36)}`;
    await this.db.tx(async (q) => {
      await q('insert into polls (id, question, closes_at) values ($1,$2, now() + ($3 || \' hours\')::interval)', [id, question, String(this.cfg.pollDurationHours)]);
      let i = 0;
      for (const o of opts) await q('insert into poll_options (id, poll_id, label, kind, sort) values ($1,$2,$3,$4,$5)', [`${id}_${i}`, id, o.label, o.kind, i++]);
    });
    return id;
  }

  private async ensureCommunityDefaults() {
    const g = await this.db.query('select 1 from community_goals limit 1');
    if (!g.rows.length) {
      const goals = [
        ['goal_meadow', 'Plant a community meadow', 'Every contribution plants flowers. When the meadow is full it appears in the garden.', 1000, 'flower_meadow', 'Community meadow'],
        ['goal_treehouse', 'Build a treehouse', 'Gather planks together for a treehouse in the forest clearing.', 300, 'treehouse', 'Treehouse'],
        ['goal_bridge', 'Build a bridge over the pond', 'A footbridge across the water, built by everyone.', 200, 'bridge', 'Bridge'],
      ] as const;
      for (const [id, title, desc, target, kind, label] of goals) {
        await this.db.query('insert into community_goals (id, title, description, target, reward_kind, reward_label) values ($1,$2,$3,$4,$5,$6) on conflict do nothing', [id, title, desc, target, kind, label]);
      }
    }
  }

  // -------------------------------------------------- chat observation --
  private async observeChat() {
    if (Date.now() - this.lastObserveAt < this.cfg.chatObserveEverySec * 1000) return;
    this.lastObserveAt = Date.now();
    const r = await this.db.query<{ id: string; username: string; text: string; hidden: boolean; flags: string[] | string; created_at: string | Date }>(
      'select id, username, text, hidden, flags, created_at from chat_messages where created_at > $1 order by created_at desc limit 50',
      [this.lastChatSeen],
    );
    if (!r.rows.length) return;
    const newest = r.rows[0].created_at;
    this.lastChatSeen = newest instanceof Date ? newest.toISOString() : String(newest);
    const summary = summarizeChat(r.rows.map((m) => ({ ...m, flags: typeof m.flags === 'string' ? (JSON.parse(m.flags) as string[]) : m.flags })));
    if (summary && summary.messageCount >= 1) this.sim.addObservation({ kind: 'chat_summary', ...summary });
  }

  // ------------------------------------------------------------ diary --
  async writeDiary(day: number): Promise<void> {
    try {
      const exists = await this.db.query('select 1 from diary_entries where day = $1', [day]);
      if (exists.rows.length) return;
      const evs = await this.db.query<Record<string, unknown>>('select * from simulation_events where day = $1 order by seq', [day]);
      const events = evs.rows.map(rowToEvent);
      const draft = composeDiaryTemplate(day, events);
      const llm = await this.llm.diary(day, selectDiaryFacts(events));
      const entry = llm ? { ...draft, ...llm, generator: 'llm' as const, model: this.cfg.openai.diaryModel } : draft;
      await this.db.query('insert into diary_entries (id, day, title, body, facts, generator, model) values ($1,$2,$3,$4,$5,$6,$7) on conflict (day) do nothing', [
        `diary_${day}`,
        day,
        entry.title,
        entry.body,
        JSON.stringify(entry.facts),
        entry.generator,
        entry.model,
      ]);
    } catch (e) {
      await this.store.logError('diary', e);
    }
  }

  // ------------------------------------------------------- admin tools --
  setPaused(p: boolean, by: string) {
    this.sim.setPaused(p, by);
  }

  /** Run `days` simulated days as fast as possible (deterministic brain), committing in batches. */
  async fastForward(days: number, onProgress?: (day: number) => void): Promise<{ days: number; events: number; ms: number }> {
    if (this.fastForwarding) throw new Error('already fast-forwarding');
    while (this.inTick) await new Promise((r) => setTimeout(r, 20));
    this.fastForwarding = true;
    const t0 = Date.now();
    let total = 0;
    try {
      const minutes = Math.round(days * 1440);
      let acc: Pending | null = null;
      for (let m = 0; m < minutes; m++) {
        this.sim.tick(1, { autoDecide: true });
        const p = this.sim.drain();
        total += p.events.length;
        acc = acc ? mergePending(acc, p) : p;
        if (m % 120 === 119 || m === minutes - 1) {
          await this.store.commit(this.sim.state, acc);
          for (const d of acc.dayEnded) if (d >= 1) await this.writeDiary(d);
          acc = null;
          onProgress?.(Math.floor(this.sim.state.minute / 1440) + 1);
        }
      }
    } finally {
      this.fastForwarding = false;
    }
    this.lastObjects.clear();
    for (const o of Object.values(this.sim.state.objects)) this.lastObjects.set(o.id, JSON.stringify(o));
    this.lastBroadcastSeq = this.sim.state.seq;
    this.broadcast({ type: 'snapshot', serverTime: Date.now(), timeScale: this.timeScale, frame: this.fullFrame() });
    return { days, events: total, ms: Date.now() - t0 };
  }

  removeObject(id: string, reason: string) {
    return this.sim.removeObject(id, reason);
  }
}

export function rowToEvent(r: Record<string, unknown>): SimEvent {
  const parse = <T>(v: unknown, d: T): T => (typeof v === 'string' ? (JSON.parse(v) as T) : ((v as T) ?? d));
  return {
    id: String(r.id),
    seq: Number(r.seq),
    minute: Number(r.minute),
    day: Number(r.day),
    type: r.type as SimEvent['type'],
    summary: String(r.summary),
    location: (r.location as SimEvent['location']) ?? null,
    objectIds: parse<string[]>(r.object_ids, []),
    action: (r.action as string) ?? undefined,
    data: parse<Record<string, unknown>>(r.data, {}),
    importance: Number(r.importance),
  };
}
