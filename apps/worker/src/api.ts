import {
  GIFT_KINDS,
  LOCATIONS,
  OBJECT_KINDS,
  activeHabits,
  highlightManifest,
  moderateMessage,
  traitTrends,
  type ChatMessageDTO,
  type Highlight,
  type LocationId,
  type Traits,
} from '@calmling/core';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { USERNAME_RE, getUser, registerUser, safeEqual, signToken, verifyToken, type User } from './auth';
import { HttpError, Router, type Ctx } from './http';
import type { RateLimiter } from './ratelimit';
import { rowToEvent, type SimulationRuntime } from './runtime';

const parseJson = <T>(v: unknown, d: T): T => (typeof v === 'string' ? (JSON.parse(v) as T) : ((v as T) ?? d));
const bool = (v: unknown) => v === true || v === 't' || v === 'true';

function body<T extends z.ZodType>(schema: T, ctx: Ctx): z.infer<T> {
  const r = schema.safeParse(ctx.body ?? {});
  if (!r.success) throw new HttpError(400, r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  return r.data;
}

export interface ApiDeps {
  rt: SimulationRuntime;
  limiter: RateLimiter;
  broadcastChat: (m: ChatMessageDTO) => void;
  broadcastChatUpdate: (id: string, patch: { hidden?: boolean; reactions?: Record<string, number> }) => void;
  viewerCount: () => number;
}

export function buildApi({ rt, limiter, broadcastChat, broadcastChatUpdate, viewerCount }: ApiDeps): Router {
  const db = rt.db;
  const cfg = rt.cfg;
  const r = new Router();

  async function currentUser(ctx: Ctx): Promise<User | null> {
    const h = ctx.req.headers.authorization;
    if (!h?.startsWith('Bearer ')) return null;
    const id = verifyToken(h.slice(7), cfg.authSecret);
    if (!id) return null;
    return getUser(db, id);
  }
  async function requireUser(ctx: Ctx): Promise<User> {
    const u = await currentUser(ctx);
    if (!u) throw new HttpError(401, 'sign in to do that');
    if (u.banned) throw new HttpError(403, 'this account is banned');
    return u;
  }
  function requireAdmin(ctx: Ctx): string {
    const t = (ctx.req.headers['x-admin-token'] as string | undefined) ?? '';
    if (!t || !safeEqual(t, cfg.adminToken)) throw new HttpError(401, 'admin token required');
    return 'admin';
  }
  async function limit(key: string, max: number, windowSec: number) {
    const res = await limiter.hit(key, max, windowSec);
    if (!res.ok) throw new HttpError(429, `slow down — try again in ${res.retryAfterSec}s`, { retryAfterSec: res.retryAfterSec });
  }
  const day = () => Math.floor(rt.sim.state.minute / 1440) + 1;

  // ---------------------------------------------------------------- health --
  r.get('/health', async () => {
    await db.query('select 1');
    const stale = rt.running && !rt.sim.state.paused && rt.lastTickAt > 0 && Date.now() - rt.lastTickAt > cfg.tickMs * 10;
    if (stale) throw new HttpError(503, 'simulation loop is stalled');
    return { ok: true, running: rt.running, paused: rt.sim.state.paused, tick: rt.sim.state.tick, lastTickAgoMs: rt.lastTickAt ? Date.now() - rt.lastTickAt : null, db: db.kind, rateLimiter: limiter.kind };
  });

  // ------------------------------------------------------------- auth --
  r.post('/api/auth/register', async (ctx) => {
    await limit(`register:${ctx.ip}`, 10, 3600);
    const { username } = body(z.object({ username: z.string().regex(USERNAME_RE, '3–20 letters, numbers or _') }), ctx);
    if (/admin|calmling|moderator/i.test(username)) throw new HttpError(400, 'that name is reserved');
    const u = await registerUser(db, username);
    if (!u) throw new HttpError(409, 'that name is taken');
    return { token: signToken(u.id, cfg.authSecret), user: { id: u.id, username: u.username } };
  });
  r.get('/api/auth/me', async (ctx) => {
    const u = await currentUser(ctx);
    return { user: u ? { id: u.id, username: u.username, mutedUntil: u.muted_until } : null };
  });

  // ------------------------------------------------------------ state --
  r.get('/api/state', () => ({ frame: rt.fullFrame(), timeScale: rt.timeScale, tickMs: cfg.tickMs, serverTime: Date.now(), brain: rt.llm.status(), viewers: viewerCount() }));

  r.get('/api/world', async () => {
    const s = rt.sim.state;
    const objects = Object.values(s.objects).filter((o) => o.discovered || o.origin.type !== 'discovery');
    return {
      locations: Object.values(LOCATIONS).map((l) => ({ ...l, objectCount: objects.filter((o) => o.location === l.id).length })),
      objects,
      visited: s.visited,
      weather: s.env.weather,
      day: day(),
    };
  });

  r.get('/api/events', async (ctx) => {
    const lim = Math.min(200, Number(ctx.query.get('limit') ?? 50));
    const before = Number(ctx.query.get('before') ?? Number.MAX_SAFE_INTEGER);
    const minImportance = Number(ctx.query.get('minImportance') ?? 0);
    const rows = await db.query('select * from simulation_events where seq < $1 and importance >= $2 order by seq desc limit $3', [before, minImportance, lim]);
    return { events: rows.rows.map(rowToEvent) };
  });

  r.get('/api/memories', async (ctx) => {
    const type = ctx.query.get('type');
    const lim = Math.min(300, Number(ctx.query.get('limit') ?? 100));
    const rows = await db.query(
      `select * from memories where consolidated = false ${type ? 'and type = $2' : ''} order by day desc, minute desc limit $1`,
      type ? [lim, type] : [lim],
    );
    return {
      memories: rows.rows.map((m: Record<string, unknown>) => ({
        id: m.id, type: m.type, minute: Number(m.minute), day: Number(m.day), summary: m.summary, importance: Number(m.importance),
        relatedObjectIds: parseJson(m.related_object_ids, []), relatedEventIds: parseJson(m.related_event_ids, []), location: m.location, emotion: parseJson(m.emotion, {}),
      })),
    };
  });

  r.get('/api/habits', () => {
    const s = rt.sim.state;
    const all = Object.values(s.habits).sort((a, b) => b.strength - a.strength);
    return {
      active: activeHabits(s),
      emerging: all.filter((h) => h.status === 'emerging').slice(0, 12),
      dissolved: all.filter((h) => h.status === 'dissolved').slice(0, 12),
    };
  });

  r.get('/api/personality', async () => {
    const s = rt.sim.state;
    const hist = await db.query<{ day: number; traits: Traits | string }>('select day, traits from personality_traits order by day asc');
    const history = hist.rows.map((h) => ({ day: Number(h.day), traits: parseJson<Traits>(h.traits, s.character.traits) }));
    const merged = history.length ? history : s.traitHistory;
    return {
      traits: s.character.traits,
      history: merged,
      trends30: traitTrends(merged, s.character.traits, day(), 30),
      trends7: traitTrends(merged, s.character.traits, day(), 7),
    };
  });

  r.get('/api/diary', async (ctx) => {
    const lim = Math.min(60, Number(ctx.query.get('limit') ?? 14));
    const rows = await db.query('select * from diary_entries order by day desc limit $1', [lim]);
    return { entries: rows.rows.map((d: Record<string, unknown>) => ({ ...d, facts: parseJson(d.facts, []) })) };
  });
  r.post('/api/admin/diary/:day', async (ctx) => {
    requireAdmin(ctx);
    const d = Number(ctx.params.day);
    await db.query('delete from diary_entries where day = $1', [d]);
    await rt.writeDiary(d);
    return { ok: true };
  });

  const mapHighlight = (h: Record<string, unknown>): Highlight & { status: string } => ({
    id: String(h.id), eventId: String(h.event_id), minute: Number(h.minute), day: Number(h.day), title: String(h.title), description: String(h.description),
    score: Number(h.score), scores: parseJson(h.scores, {} as Highlight['scores']), replay: parseJson(h.replay, {} as Highlight['replay']), status: String(h.status),
  });
  r.get('/api/highlights', async (ctx) => {
    const lim = Math.min(100, Number(ctx.query.get('limit') ?? 30));
    const rows = await db.query("select * from highlights where status <> 'rejected' order by day desc, score desc limit $1", [lim]);
    return { highlights: rows.rows.map(mapHighlight) };
  });
  r.get('/api/highlights/manifest.json', async (ctx) => {
    const d = Number(ctx.query.get('day') ?? day());
    const rows = await db.query("select * from highlights where day = $1 and status <> 'rejected' order by score desc limit 20", [d]);
    return highlightManifest(rows.rows.map(mapHighlight), { timeScale: rt.timeScale });
  });

  // ------------------------------------------------------------- gifts --
  r.get('/api/gifts/catalog', () => ({
    gifts: GIFT_KINDS.map((k) => ({ kind: k, name: OBJECT_KINDS[k].name, description: OBJECT_KINDS[k].description, category: OBJECT_KINDS[k].category, emoji: OBJECT_KINDS[k].emoji, tags: OBJECT_KINDS[k].tags })),
    locations: (['garden', 'home', 'pond', 'forest'] as LocationId[]).map((id) => ({ id, name: LOCATIONS[id].name })),
    limits: { perHour: 3, perDay: 10 },
  }));

  r.post('/api/gifts', async (ctx) => {
    const u = await requireUser(ctx);
    const input = body(z.object({ kind: z.enum(GIFT_KINDS as [string, ...string[]]), location: z.enum(['garden', 'home', 'pond', 'forest']).default('garden'), message: z.string().max(140).optional() }), ctx);
    await limit(`gift:h:${u.id}`, 3, 3600);
    await limit(`gift:d:${u.id}`, 10, 86400);
    await limit('gift:global', 120, 60);
    let message: string | null = null;
    if (input.message) {
      const m = moderateMessage(input.message);
      if (!m.ok) throw new HttpError(400, `message: ${m.reason}`);
      message = m.text;
    }
    // cap clutter: at most 40 undelivered + undiscovered gifts in the world
    const crowd = Object.values(rt.sim.state.objects).filter((o) => o.origin.type === 'gift' && !o.discovered).length;
    if (crowd >= 40) throw new HttpError(429, 'the island is full of unopened gifts — try again later');
    const id = `g${randomBytes(6).toString('hex')}`;
    const name = OBJECT_KINDS[input.kind].name;
    await db.tx(async (q) => {
      await q('insert into gifts (id, kind, sender_user_id, sender_name, message, location) values ($1,$2,$3,$4,$5,$6)', [id, input.kind, u.id, u.username, message, input.location]);
      await q('insert into user_contribution_history (user_id, kind, ref_id, summary) values ($1,$2,$3,$4)', [u.id, 'gift', id, `You sent Calmling ${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name.toLowerCase()}.`]);
    });
    return { gift: { id, kind: input.kind, status: 'pending', objectId: `gift_${id}` }, note: 'Your gift will appear in the world within a moment. Calmling may or may not notice it.' };
  });

  // -------------------------------------------------------------- chat --
  const toDTO = (m: Record<string, unknown>, reactions: Record<string, number> = {}): ChatMessageDTO => ({
    id: String(m.id), userId: String(m.user_id), username: String(m.username), text: String(m.text), createdAt: new Date(m.created_at as string).toISOString(), reactions, hidden: bool(m.hidden),
  });
  async function reactionsFor(ids: string[]): Promise<Map<string, Record<string, number>>> {
    const out = new Map<string, Record<string, number>>();
    if (!ids.length) return out;
    const rows = await db.query<{ message_id: string; emoji: string; n: number | string }>('select message_id, emoji, count(*) as n from chat_reactions where message_id = any($1) group by message_id, emoji', [ids]);
    for (const x of rows.rows) {
      const m = out.get(x.message_id) ?? {};
      m[x.emoji] = Number(x.n);
      out.set(x.message_id, m);
    }
    return out;
  }

  r.get('/api/chat', async (ctx) => {
    const u = await currentUser(ctx);
    const rows = await db.query(
      `select * from chat_messages c where hidden = false ${u ? 'and not exists (select 1 from user_blocks b where b.user_id = $2 and b.blocked_user_id = c.user_id)' : ''} order by created_at desc limit $1`,
      u ? [80, u.id] : [80],
    );
    const ids = rows.rows.map((m: Record<string, unknown>) => String(m.id));
    const reacts = await reactionsFor(ids);
    return { messages: rows.rows.reverse().map((m: Record<string, unknown>) => toDTO(m, reacts.get(String(m.id)))) };
  });

  r.post('/api/chat', async (ctx) => {
    const u = await requireUser(ctx);
    if (u.muted_until && new Date(u.muted_until) > new Date()) throw new HttpError(403, 'you are muted for now');
    const { text } = body(z.object({ text: z.string().min(1).max(400) }), ctx);
    const m = moderateMessage(text);
    await limit(`chat:attempts:${u.id}`, 30, 60);
    if (!m.ok) throw new HttpError(400, m.reason ?? 'blocked');
    await limit(`chat:burst:${u.id}`, 1, 2);
    await limit(`chat:min:${u.id}`, 12, 60);
    // duplicate-message spam
    const dup = await db.query("select 1 from chat_messages where user_id = $1 and text = $2 and created_at > now() - interval '2 minutes'", [u.id, m.text]);
    if (dup.rows.length) throw new HttpError(429, 'you just said that');
    const id = `c${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
    const row = await db.query('insert into chat_messages (id, user_id, username, text, flags) values ($1,$2,$3,$4,$5) returning *', [id, u.id, u.username, m.text, JSON.stringify(m.flags)]);
    const dto = toDTO(row.rows[0] as Record<string, unknown>);
    broadcastChat(dto);
    return { message: dto };
  });

  r.post('/api/chat/:id/react', async (ctx) => {
    const u = await requireUser(ctx);
    const { emoji } = body(z.object({ emoji: z.enum(['💛', '😊', '🌱', '😮', '😂']) }), ctx);
    await limit(`react:${u.id}`, 30, 60);
    const exists = await db.query('select 1 from chat_reactions where message_id = $1 and user_id = $2 and emoji = $3', [ctx.params.id, u.id, emoji]);
    if (exists.rows.length) await db.query('delete from chat_reactions where message_id = $1 and user_id = $2 and emoji = $3', [ctx.params.id, u.id, emoji]);
    else await db.query('insert into chat_reactions (message_id, user_id, emoji) select $1,$2,$3 where exists (select 1 from chat_messages where id = $1)', [ctx.params.id, u.id, emoji]);
    const reactions = (await reactionsFor([ctx.params.id])).get(ctx.params.id) ?? {};
    broadcastChatUpdate(ctx.params.id, { reactions });
    return { reactions };
  });

  r.post('/api/chat/:id/report', async (ctx) => {
    const u = await requireUser(ctx);
    const { reason } = body(z.object({ reason: z.string().max(200).optional() }), ctx);
    await limit(`report:${u.id}`, 20, 3600);
    await db.query('insert into chat_reports (message_id, reporter_id, reason) select $1,$2,$3 where exists (select 1 from chat_messages where id = $1) on conflict do nothing', [ctx.params.id, u.id, reason ?? null]);
    // auto-hide after 3 independent reports, pending admin review
    const n = await db.query<{ n: number | string }>('select count(*) as n from chat_reports where message_id = $1', [ctx.params.id]);
    if (Number(n.rows[0].n) >= 3) {
      await db.query("update chat_messages set hidden = true, hidden_reason = 'auto: reported' where id = $1", [ctx.params.id]);
      broadcastChatUpdate(ctx.params.id, { hidden: true });
    }
    return { ok: true };
  });

  r.post('/api/users/block', async (ctx) => {
    const u = await requireUser(ctx);
    const { userId, unblock } = body(z.object({ userId: z.string().min(1).max(40), unblock: z.boolean().optional() }), ctx);
    if (userId === u.id) throw new HttpError(400, 'you cannot block yourself');
    if (unblock) await db.query('delete from user_blocks where user_id = $1 and blocked_user_id = $2', [u.id, userId]);
    else await db.query('insert into user_blocks (user_id, blocked_user_id) select $1,$2 where exists (select 1 from users where id = $2) on conflict do nothing', [u.id, userId]);
    return { ok: true };
  });
  r.get('/api/users/blocks', async (ctx) => {
    const u = await requireUser(ctx);
    const rows = await db.query('select b.blocked_user_id as id, u.username from user_blocks b join users u on u.id = b.blocked_user_id where b.user_id = $1', [u.id]);
    return { blocked: rows.rows };
  });

  // --------------------------------------------------------- community --
  r.get('/api/community/goals', async (ctx) => {
    const u = await currentUser(ctx);
    const rows = await db.query('select * from community_goals order by status asc, created_at asc');
    let mine: Record<string, number> = {};
    if (u) {
      const c = await db.query<{ goal_id: string; n: number | string }>("select goal_id, coalesce(sum(amount),0) as n from community_contributions where user_id = $1 and created_at > now() - interval '1 day' group by goal_id", [u.id]);
      mine = Object.fromEntries(c.rows.map((x) => [x.goal_id, Number(x.n)]));
    }
    return { goals: rows.rows.map((g: Record<string, unknown>) => ({ ...g, myContributionToday: mine[String(g.id)] ?? 0 })) };
  });

  r.post('/api/community/goals/:id/contribute', async (ctx) => {
    const u = await requireUser(ctx);
    const { amount } = body(z.object({ amount: z.number().int().min(1).max(10) }), ctx);
    await limit(`contrib:${u.id}`, 20, 60);
    const result = await db.tx(async (q) => {
      const g = (await q<Record<string, unknown>>('select * from community_goals where id = $1 for update', [ctx.params.id])).rows[0];
      if (!g) throw new HttpError(404, 'no such goal');
      if (g.status !== 'active') throw new HttpError(409, 'this project is already complete');
      const today = Number((await q<{ n: number | string }>("select coalesce(sum(amount),0) as n from community_contributions where goal_id = $1 and user_id = $2 and created_at > now() - interval '1 day'", [g.id, u.id])).rows[0].n);
      const allowed = Math.min(amount, Number(g.per_user_daily_limit) - today, Number(g.target) - Number(g.progress));
      if (allowed <= 0) throw new HttpError(429, `daily limit reached (${g.per_user_daily_limit} per day)`);
      const first = (await q('select 1 from community_contributions where goal_id = $1 and user_id = $2 limit 1', [g.id, u.id])).rows.length === 0;
      await q('insert into community_contributions (goal_id, user_id, amount) values ($1,$2,$3)', [g.id, u.id, allowed]);
      const progress = Number(g.progress) + allowed;
      const completed = progress >= Number(g.target);
      await q(
        `update community_goals set progress = $2, contributor_count = contributor_count + $3, status = $4, completed_at = case when $5 then now() else completed_at end where id = $1`,
        [g.id, progress, first ? 1 : 0, completed ? 'completed' : 'active', completed],
      );
      await q('insert into user_contribution_history (user_id, kind, ref_id, summary, day) values ($1,$2,$3,$4,$5)', [u.id, 'contribution', g.id, `You added ${allowed} to “${g.title}”.`, day()]);
      return { progress, completed, added: allowed };
    });
    return result;
  });

  r.get('/api/polls', async (ctx) => {
    const u = await currentUser(ctx);
    const polls = await db.query('select * from polls order by created_at desc limit 10');
    const out = [];
    for (const p of polls.rows as Record<string, unknown>[]) {
      const opts = await db.query('select o.*, (select count(*) from poll_votes v where v.option_id = o.id) as votes from poll_options o where o.poll_id = $1 order by sort', [p.id]);
      const mine = u ? (await db.query<{ option_id: string }>('select option_id from poll_votes where poll_id = $1 and user_id = $2', [p.id, u.id])).rows[0]?.option_id ?? null : null;
      out.push({ ...p, options: opts.rows.map((o: Record<string, unknown>) => ({ ...o, votes: Number(o.votes), emoji: OBJECT_KINDS[String(o.kind)]?.emoji ?? '🎁' })), myVote: mine });
    }
    return { polls: out };
  });

  r.post('/api/polls/:id/vote', async (ctx) => {
    const u = await requireUser(ctx);
    const { optionId } = body(z.object({ optionId: z.string().min(1).max(60) }), ctx);
    await limit(`vote:${u.id}`, 10, 60);
    await db.tx(async (q) => {
      const p = (await q<{ status: string; closes_at: string; question: string }>('select status, closes_at, question from polls where id = $1', [ctx.params.id])).rows[0];
      if (!p) throw new HttpError(404, 'no such poll');
      if (p.status !== 'open' || new Date(p.closes_at) <= new Date()) throw new HttpError(409, 'this poll has closed');
      const o = (await q<{ label: string }>('select label from poll_options where id = $1 and poll_id = $2', [optionId, ctx.params.id])).rows[0];
      if (!o) throw new HttpError(400, 'no such option');
      const ins = await q('insert into poll_votes (poll_id, user_id, option_id) values ($1,$2,$3) on conflict (poll_id, user_id) do nothing returning poll_id', [ctx.params.id, u.id, optionId]);
      if (!ins.rows.length) throw new HttpError(409, 'you have already voted in this poll');
      await q('insert into user_contribution_history (user_id, kind, ref_id, summary, day) values ($1,$2,$3,$4,$5)', [u.id, 'vote', ctx.params.id, `You voted for “${o.label}” in “${p.question}”.`, day()]);
    });
    return { ok: true };
  });

  // ------------------------------------------------------------ profile --
  r.get('/api/profile', async (ctx) => {
    const u = await requireUser(ctx);
    const s = rt.sim.state;
    const gifts = await db.query<Record<string, unknown>>('select * from gifts where sender_user_id = $1 order by created_at desc limit 50', [u.id]);
    const giftFacts = [];
    for (const g of gifts.rows) {
      const obj = g.object_id ? s.objects[String(g.object_id)] : undefined;
      const inter = await db.query<{ action: string; n: number | string }>('select action, count(*) as n from gift_interactions where gift_id = $1 group by action', [g.id]);
      const counts = Object.fromEntries(inter.rows.map((x) => [x.action, Number(x.n)]));
      const name = OBJECT_KINDS[String(g.kind)]?.name.toLowerCase() ?? String(g.kind);
      const facts: string[] = [`You gave Calmling ${/^[aeiou]/.test(name) ? 'an' : 'a'} ${name}${g.delivered_day ? ` on Day ${g.delivered_day}` : ''}.`];
      if (g.status === 'pending') facts.push('It is on its way into the world.');
      else if (!obj && g.object_id) facts.push('It is no longer in the world.');
      else if (obj) {
        if (!obj.discovered) facts.push('Calmling has not noticed it yet.');
        else {
          const verbs: Record<string, string> = { read: 'read it', cuddle: 'cuddled it', play: 'played with it', water_plant: 'watered it', inspect: 'examined it', keep_object: 'carried it home', take_photo: 'taken photos with it', paint: 'painted with it', plant_flower: 'planted it', plant_seed: 'planted it', tend_garden: 'tended it', drink_tea: 'drunk tea with it' };
          for (const [a, n] of Object.entries(counts)) if (verbs[a]) facts.push(`Calmling has ${verbs[a]} ${n === 1 ? 'once' : `${n} times`}.`);
          if (obj.interactions === 0 && !Object.keys(counts).some((a) => verbs[a])) facts.push('Calmling has noticed it but has not used it yet.');
          const where = obj.heldBy === 'calmling' ? 'Calmling is holding it right now.' : `It is currently in the ${LOCATIONS[obj.location].name.toLowerCase()}${obj.location === 'bedroom' ? ', beside the bed' : ''}${obj.state.planted ? ', planted in the soil' : ''}.`;
          facts.push(where);
        }
      }
      giftFacts.push({ id: g.id, kind: g.kind, status: g.status, createdAt: g.created_at, objectId: g.object_id, facts, interactions: counts });
    }
    const history = await db.query('select kind, ref_id, summary, object_id, day, created_at from user_contribution_history where user_id = $1 order by created_at desc limit 100', [u.id]);
    const memories = await db.query(
      "select id, summary, day, type from memories where type = 'social' and related_object_ids ?| $1::text[] order by day desc limit 20",
      [gifts.rows.map((g) => String(g.object_id ?? `gift_${g.id}`))],
    ).catch(() => ({ rows: [] }));
    const votes = await db.query<{ n: number | string }>('select count(*) as n from poll_votes where user_id = $1', [u.id]);
    const contribs = await db.query('select g.title, sum(c.amount) as amount from community_contributions c join community_goals g on g.id = c.goal_id where c.user_id = $1 group by g.title', [u.id]);
    return { user: { id: u.id, username: u.username }, gifts: giftFacts, history: history.rows, memories: memories.rows, pollsParticipated: Number(votes.rows[0].n), projects: contribs.rows };
  });

  // -------------------------------------------------------------- admin --
  r.get('/api/admin/overview', async (ctx) => {
    requireAdmin(ctx);
    const s = rt.sim.state;
    const q1 = async (sql: string) => Number(((await db.query<{ n: number | string }>(sql)).rows[0]?.n) ?? 0);
    return {
      state: { minute: s.minute, day: day(), tick: s.tick, seq: s.seq, paused: s.paused, character: s.character, env: s.env, plan: s.character.plan, awaitingDecision: rt.sim.awaitingDecision },
      runtime: { running: rt.running, timeScale: rt.timeScale, tickMs: cfg.tickMs, lastTickMs: rt.lastTickMs, lastTickAgoMs: rt.lastTickAt ? Date.now() - rt.lastTickAt : null, ticksSinceStart: rt.ticksSinceStart, errorCount: rt.errorCount, fastForwarding: rt.fastForwarding, db: db.kind, rateLimiter: limiter.kind, viewers: viewerCount() },
      brain: rt.llm.status(),
      counts: {
        events: await q1('select count(*) as n from simulation_events'),
        memories: await q1('select count(*) as n from memories'),
        objects: Object.keys(s.objects).length,
        users: await q1('select count(*) as n from users'),
        chat: await q1('select count(*) as n from chat_messages'),
        reportsOpen: await q1('select count(distinct message_id) as n from chat_reports r join chat_messages m on m.id = r.message_id where m.hidden = false'),
        gifts: await q1('select count(*) as n from gifts'),
        errors24h: await q1("select count(*) as n from worker_errors where created_at > now() - interval '1 day'"),
      },
      spend: (await db.query("select model, purpose, count(*) as calls, sum(input_tokens) as input_tokens, sum(output_tokens) as output_tokens, sum(cost_usd) as cost_usd, sum(case when ok then 0 else 1 end) as failures from api_usage where created_at > now() - interval '1 day' group by model, purpose")).rows,
      personality: { traits: s.character.traits, trends: traitTrends(s.traitHistory, s.character.traits, day(), 30) },
      habits: Object.values(s.habits).sort((a, b) => b.strength - a.strength).slice(0, 40),
      workingMemory: s.memories.slice(-60).reverse(),
      observations: s.observations,
    };
  });
  r.get('/api/admin/decisions', async (ctx) => {
    requireAdmin(ctx);
    const rows = await db.query('select * from ai_decisions order by minute desc limit $1', [Math.min(300, Number(ctx.query.get('limit') ?? 60))]);
    return { decisions: rows.rows.map((d: Record<string, unknown>) => ({ ...d, candidates: parseJson(d.candidates, []) })) };
  });
  r.get('/api/admin/errors', async (ctx) => {
    requireAdmin(ctx);
    return { errors: (await db.query('select * from worker_errors order by created_at desc limit 100')).rows };
  });
  r.get('/api/admin/audit', async (ctx) => {
    requireAdmin(ctx);
    return { audit: (await db.query('select * from audit_log order by created_at desc limit 100')).rows };
  });
  r.get('/api/admin/chat', async (ctx) => {
    requireAdmin(ctx);
    const rows = await db.query(
      `select m.*, (select count(*) from chat_reports r where r.message_id = m.id) as reports from chat_messages m order by (select count(*) from chat_reports r where r.message_id = m.id) desc, m.created_at desc limit 100`,
    );
    return { messages: rows.rows };
  });
  r.post('/api/admin/pause', async (ctx) => {
    requireAdmin(ctx);
    rt.setPaused(true, 'admin');
    await rt.store.audit('admin', 'pause');
    return { paused: true };
  });
  r.post('/api/admin/resume', async (ctx) => {
    requireAdmin(ctx);
    rt.setPaused(false, 'admin');
    await rt.store.audit('admin', 'resume');
    return { paused: false };
  });
  r.post('/api/admin/speed', async (ctx) => {
    requireAdmin(ctx);
    const { timeScale } = body(z.object({ timeScale: z.number().min(1).max(3600) }), ctx);
    rt.timeScale = timeScale;
    await rt.store.audit('admin', 'speed', { timeScale });
    return { timeScale };
  });
  r.post('/api/admin/fast-forward', async (ctx) => {
    requireAdmin(ctx);
    const { days } = body(z.object({ days: z.number().min(0.01).max(30) }), ctx);
    await rt.store.audit('admin', 'fast_forward', { days });
    return rt.fastForward(days);
  });
  r.post('/api/admin/goals', async (ctx) => {
    requireAdmin(ctx);
    const kinds = Object.keys(OBJECT_KINDS).filter((k) => !OBJECT_KINDS[k].portable || OBJECT_KINDS[k].pollOnly) as [string, ...string[]];
    const g = body(z.object({ title: z.string().min(3).max(80), description: z.string().min(3).max(300), target: z.number().int().min(1).max(1_000_000), rewardKind: z.enum(kinds), rewardLabel: z.string().min(1).max(60), perUserDailyLimit: z.number().int().min(1).max(100).default(10) }), ctx);
    const id = `goal_${Date.now().toString(36)}`;
    await db.query('insert into community_goals (id, title, description, target, reward_kind, reward_label, per_user_daily_limit) values ($1,$2,$3,$4,$5,$6,$7)', [id, g.title, g.description, g.target, g.rewardKind, g.rewardLabel, g.perUserDailyLimit]);
    await rt.store.audit('admin', 'create_goal', { id, ...g });
    return { id };
  });
  r.post('/api/admin/polls', async (ctx) => {
    requireAdmin(ctx);
    const p = body(z.object({ question: z.string().min(3).max(120), options: z.array(z.object({ label: z.string().min(1).max(60), kind: z.enum(Object.keys(OBJECT_KINDS) as [string, ...string[]]) })).min(2).max(5), closeExisting: z.boolean().default(true) }), ctx);
    if (p.closeExisting) await db.query("update polls set closes_at = now() where status = 'open'");
    const id = await rt.createDailyPoll(p.question, p.options);
    await rt.store.audit('admin', 'create_poll', { id, ...p });
    return { id };
  });
  r.post('/api/admin/polls/:id/close', async (ctx) => {
    requireAdmin(ctx);
    await db.query("update polls set closes_at = now() where id = $1 and status = 'open'", [ctx.params.id]);
    return { ok: true };
  });
  r.post('/api/admin/chat/:id/hide', async (ctx) => {
    requireAdmin(ctx);
    const { hidden } = body(z.object({ hidden: z.boolean().default(true) }), ctx);
    await db.query('update chat_messages set hidden = $2, hidden_reason = $3 where id = $1', [ctx.params.id, hidden, hidden ? 'admin' : null]);
    broadcastChatUpdate(ctx.params.id, { hidden });
    await rt.store.audit('admin', hidden ? 'hide_message' : 'unhide_message', { id: ctx.params.id });
    return { ok: true };
  });
  r.post('/api/admin/users/:id/mute', async (ctx) => {
    requireAdmin(ctx);
    const { minutes, ban } = body(z.object({ minutes: z.number().int().min(0).max(525600), ban: z.boolean().optional() }), ctx);
    await db.query("update users set muted_until = case when $2::int = 0 then null else now() + ($2::int || ' minutes')::interval end, banned = coalesce($3, banned) where id = $1", [ctx.params.id, minutes, ban ?? null]);
    await rt.store.audit('admin', 'mute_user', { id: ctx.params.id, minutes, ban });
    return { ok: true };
  });
  r.post('/api/admin/objects/:id/remove', async (ctx) => {
    requireAdmin(ctx);
    const ok = rt.removeObject(ctx.params.id, 'removed by a moderator');
    if (!ok) throw new HttpError(404, 'no such object');
    await rt.store.audit('admin', 'remove_object', { id: ctx.params.id });
    return { ok };
  });
  r.get('/api/admin/highlights', async (ctx) => {
    requireAdmin(ctx);
    return { highlights: (await db.query('select * from highlights order by created_at desc limit 100')).rows.map(mapHighlight) };
  });
  r.post('/api/admin/highlights/:id/status', async (ctx) => {
    requireAdmin(ctx);
    const { status } = body(z.object({ status: z.enum(['new', 'approved', 'rejected']) }), ctx);
    await db.query('update highlights set status = $2 where id = $1', [ctx.params.id, status]);
    return { ok: true };
  });

  return r;
}
