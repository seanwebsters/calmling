import { LOCATIONS, type Habit, type Memory, type Pending, type SimState, type WorldObject } from '@calmling/core';
import type { Db } from './db';

const j = (v: unknown) => JSON.stringify(v);

export interface CommitExtras {
  deliveredGifts: { giftId: string; objectId: string; day: number }[];
  completedGoals: { goalId: string; eventId: string }[];
  executedPolls: { pollId: string; eventId: string }[];
}

/** Persistence for the simulation. Every tick is committed atomically with its snapshot. */
export class Store {
  constructor(public db: Db) {}

  async seedStatic(seed: number) {
    await this.db.query('insert into characters (id, name, seed) values ($1,$2,$3) on conflict (id) do nothing', ['calmling', 'Calmling', seed]);
    for (const l of Object.values(LOCATIONS)) {
      await this.db.query(
        'insert into world_locations (id, name, x0, x1, indoor, description) values ($1,$2,$3,$4,$5,$6) on conflict (id) do update set name = excluded.name, x0 = excluded.x0, x1 = excluded.x1, indoor = excluded.indoor, description = excluded.description',
        [l.id, l.name, l.x0, l.x1, l.indoor, l.description],
      );
    }
  }

  async loadSnapshot(): Promise<SimState | null> {
    const r = await this.db.query<{ state: SimState | string }>("select state from simulation_snapshots where id = 'current'");
    if (!r.rows.length) return null;
    const s = r.rows[0].state;
    return typeof s === 'string' ? (JSON.parse(s) as SimState) : s;
  }

  /** One transaction: events, memories, habits, objects, decisions, snapshot. Idempotent on replay. */
  async commit(state: SimState, p: Pending, extras: CommitExtras = { deliveredGifts: [], completedGoals: [], executedPolls: [] }) {
    await this.db.tx(async (q) => {
      for (const e of p.events) {
        await q(
          'insert into simulation_events (id, seq, minute, day, type, summary, location, object_ids, action, data, importance) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict (id) do nothing',
          [e.id, e.seq, e.minute, e.day, e.type, e.summary, e.location, j(e.objectIds), e.action ?? null, j(e.data), e.importance],
        );
      }
      for (const m of p.memories.values()) await upsertMemory(q, m);
      for (const h of p.habits.values()) await upsertHabit(q, h);
      for (const d of p.decisions) {
        await q(
          'insert into ai_decisions (id, minute, day, source, model, goal, action, target_id, reason, valid, rejection_reason, candidates, thought) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) on conflict (id) do nothing',
          [d.id, d.minute, d.day, d.source, d.model, d.goal, d.action, d.targetId, d.reason, d.valid, d.rejectionReason, j(d.candidates), d.thought ?? null],
        );
      }
      for (const a of p.activities) {
        await q(
          'insert into activities (id, character_id, action, goal, target_id, location, started_minute, ends_minute, decision_id, reason) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict (id) do nothing',
          [a.id, 'calmling', a.action, a.goal, a.targetId, a.location, a.startedAt, a.endsAt, a.decisionId, a.reason],
        );
      }
      for (const id of p.objectsChanged) {
        const o = state.objects[id];
        if (o) await upsertObject(q, o);
      }
      for (const id of p.objectsRemoved) await q('update world_objects set removed_at = now(), held_by = null where id = $1', [id]);
      for (const h of p.highlights) {
        await q(
          'insert into highlights (id, event_id, minute, day, title, description, score, scores, replay) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (id) do nothing',
          [h.id, h.eventId, h.minute, h.day, h.title, h.description, h.score, j(h.scores), j(h.replay)],
        );
      }
      for (const t of p.traitSnapshots) {
        await q('insert into personality_traits (character_id, day, minute, traits) values ($1,$2,$3,$4) on conflict (character_id, day) do nothing', ['calmling', t.day, t.minute, j(t.traits)]);
      }
      // gift interactions: completed activities and discoveries that touched a gifted object
      for (const e of p.events) {
        if (!['activity_completed', 'object_discovered', 'object_placed', 'object_moved', 'object_created', 'object_picked_up', 'plant_bloomed'].includes(e.type)) continue;
        for (const oid of e.objectIds) {
          const giftId = state.objects[oid]?.origin.giftId;
          if (!giftId) continue;
          await q(
            `insert into gift_interactions (gift_id, object_id, event_id, action, summary, minute, day)
             select $1,$2,$3,$4,$5,$6,$7 where exists (select 1 from gifts where id = $1) on conflict (event_id) do nothing`,
            [giftId, oid, e.id, e.action ?? e.type, e.summary, e.minute, e.day],
          );
        }
      }
      for (const g of extras.deliveredGifts) {
        await q("update gifts set status = 'delivered', object_id = $2, delivered_at = now(), delivered_day = $3 where id = $1", [g.giftId, g.objectId, g.day]);
        await q("update user_contribution_history set object_id = $2, day = $3 where kind = 'gift' and ref_id = $1", [g.giftId, g.objectId, g.day]);
      }
      for (const g of extras.completedGoals) await q('update community_goals set completion_event_id = $2 where id = $1', [g.goalId, g.eventId]);
      for (const pl of extras.executedPolls) await q('update polls set outcome_event_id = $2 where id = $1', [pl.pollId, pl.eventId]);

      const c = state.character;
      await q('delete from inventory where character_id = $1', ['calmling']);
      if (c.heldObjectId) await q('insert into inventory (character_id, object_id, acquired_minute) values ($1,$2,$3)', ['calmling', c.heldObjectId, state.minute]);
      await q(
        `insert into character_state (character_id, minute, day, location, x, mood, awake, needs, traits, activity, goal, held_object_id, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
         on conflict (character_id) do update set minute = excluded.minute, day = excluded.day, location = excluded.location, x = excluded.x, mood = excluded.mood,
           awake = excluded.awake, needs = excluded.needs, traits = excluded.traits, activity = excluded.activity, goal = excluded.goal, held_object_id = excluded.held_object_id, updated_at = now()`,
        ['calmling', state.minute, Math.floor(state.minute / 1440) + 1, c.location, c.x, c.mood, c.awake, j(c.needs), j(c.traits), c.activity ? j(c.activity) : null, c.goal, c.heldObjectId],
      );
      await q(
        `insert into simulation_snapshots (id, tick, seq, minute, state) values ('current', $1, $2, $3, $4)
         on conflict (id) do update set tick = excluded.tick, seq = excluded.seq, minute = excluded.minute, state = excluded.state, created_at = now()`,
        [state.tick, state.seq, state.minute, j(state)],
      );
      // a daily archive snapshot for audits and disaster recovery
      for (const day of p.dayEnded) {
        await q('insert into simulation_snapshots (id, tick, seq, minute, state) values ($1,$2,$3,$4,$5) on conflict (id) do nothing', [`day-${day + 1}-start`, state.tick, state.seq, state.minute, j(state)]);
      }
    });
  }

  async logError(scope: string, e: unknown) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.error(`[${scope}]`, err.message);
    await this.db.query('insert into worker_errors (scope, message, stack) values ($1,$2,$3)', [scope, err.message.slice(0, 2000), err.stack?.slice(0, 4000) ?? null]).catch(() => {});
  }

  async audit(actor: string, action: string, details: Record<string, unknown> = {}) {
    await this.db.query('insert into audit_log (actor, action, details) values ($1,$2,$3)', [actor, action, j(details)]);
  }
}

async function upsertMemory(q: Db['query'], m: Memory) {
  await q(
    `insert into memories (id, character_id, type, minute, day, summary, importance, related_object_ids, related_event_ids, location, emotion, consolidated, key, recall_count, updated_at)
     values ($1,'calmling',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())
     on conflict (id) do update set summary = excluded.summary, importance = excluded.importance, related_object_ids = excluded.related_object_ids,
       related_event_ids = excluded.related_event_ids, emotion = excluded.emotion, consolidated = excluded.consolidated, recall_count = excluded.recall_count,
       minute = excluded.minute, day = excluded.day, updated_at = now()`,
    [m.id, m.type, m.minute, m.day, m.summary, m.importance, j(m.relatedObjectIds), j(m.relatedEventIds), m.location, j(m.emotion), m.consolidated, m.key ?? null, m.recallCount],
  );
}

async function upsertHabit(q: Db['query'], h: Habit) {
  await q(
    `insert into habits (id, character_id, key, kind, label, action, phase, location, status, strength, formed_day, explanation, evidence, updated_at)
     values ($1,'calmling',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
     on conflict (key) do update set status = excluded.status, strength = excluded.strength, formed_day = excluded.formed_day,
       explanation = excluded.explanation, evidence = excluded.evidence, updated_at = now()`,
    [h.id, h.key, h.kind, h.label, h.action, h.phase, h.location, h.status, h.strength, h.formedDay, h.explanation, j(h.occurrences)],
  );
}

async function upsertObject(q: Db['query'], o: WorldObject) {
  await q(
    `insert into world_objects (id, kind, name, tags, location, x, held_by, state, discovered, origin, interactions, affinity, created_minute, created_day, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now())
     on conflict (id) do update set kind = excluded.kind, name = excluded.name, tags = excluded.tags, location = excluded.location, x = excluded.x,
       held_by = excluded.held_by, state = excluded.state, discovered = excluded.discovered, interactions = excluded.interactions,
       affinity = excluded.affinity, removed_at = null, updated_at = now()`,
    [o.id, o.kind, o.name, j(o.tags), o.location, o.x, o.heldBy, j(o.state), o.discovered, j(o.origin), o.interactions, o.affinity, o.createdAtMinute, o.createdDay],
  );
}
