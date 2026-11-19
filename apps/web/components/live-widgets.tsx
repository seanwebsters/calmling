'use client';

import { ACTIONS, LOCATIONS, NEED_KEYS, locationAt, type ChatMessageDTO, type SimEvent } from '@calmling/core';
import { AnimatePresence, motion } from 'framer-motion';
import { BookOpen, Brain, Flag, Gift, Heart, MessageCircle, Send, Sparkles, Sprout, Target, Users, VolumeX } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, session } from '@/lib/api';
import { reconnectNow, retainLive, useLive } from '@/lib/live';
import { requireSignIn, useUser } from './auth';
import { Button, Card, Empty, Meter, Pill } from './ui';

export function useLiveConnection() {
  const setChat = useLive((s) => s.setChat);
  useEffect(() => {
    const release = retainLive();
    api<{ messages: ChatMessageDTO[] }>('/api/chat')
      .then((r) => setChat(r.messages))
      .catch(() => {});
    return release;
  }, [setChat]);
}

export function usePolling<T>(path: string, everyMs = 30000, admin = false): { data: T | null; reload: () => void; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api<T>(path, { admin })
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'failed'));
  }, [path, admin]);
  useEffect(() => {
    load();
    if (!everyMs) return;
    const t = setInterval(load, everyMs);
    return () => clearInterval(t);
  }, [load, everyMs]);
  return { data, reload: load, error };
}

export function activityLabel(action: string | undefined, toX?: number, targetName?: string | null): string {
  if (!action) return 'pausing for a moment';
  if (action === 'walk') return toX !== undefined ? `walking to the ${LOCATIONS[locationAt(toX)].name.toLowerCase()}` : 'walking';
  const def = ACTIONS[action];
  if (!def) return action;
  if (action === 'pick_up') return `picking up ${targetName ? `the ${targetName.toLowerCase()}` : 'something'}`;
  if (action === 'keep_object') return `putting ${targetName ? `the ${targetName.toLowerCase()}` : 'something'} away`;
  if (action === 'notice') return 'noticing something';
  return def.gerund;
}

const WEATHER: Record<string, string> = { clear: 'Clear', cloudy: 'Cloudy', rain: 'Rain', breezy: 'Breezy' };

export function StatusOverlay() {
  const frame = useLive((s) => s.frame);
  const conn = useLive((s) => s.conn);
  const viewers = useLive((s) => s.viewers);
  const objects = useLive((s) => s.objects);
  if (!frame) return null;
  const a = frame.character.activity;
  const label = activityLabel(a?.action, a?.toX, a?.targetId ? objects[a.targetId]?.name : null);
  return (
    <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap items-start justify-between gap-2 sm:inset-x-4 sm:top-4" data-testid="status-overlay">
      <div className="flex flex-wrap items-center gap-2">
        {conn === 'live' ? (
          <Pill tone="live" className="pointer-events-auto shadow-sm">
            <span className="live-dot size-1.5 rounded-full bg-white" /> LIVE
          </Pill>
        ) : (
          <button onClick={reconnectNow} className="pointer-events-auto">
            <Pill className="bg-paper/95 shadow-sm">{conn === 'offline' ? 'Offline — tap to retry' : 'Reconnecting…'}</Pill>
          </button>
        )}
        <span className="rounded-full bg-paper/90 px-3 py-1 text-sm text-ink shadow-sm backdrop-blur" data-testid="current-activity">
          Calmling is <strong className="font-semibold">{label}</strong>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="rounded-full bg-paper/90 px-2.5 py-1 font-medium text-ink shadow-sm" data-testid="day-number">
          Day {frame.day}
        </span>
        <span className="rounded-full bg-paper/90 px-2.5 py-1 tabular-nums text-ink shadow-sm">{frame.timeOfDay}</span>
        <span className="rounded-full bg-paper/90 px-2.5 py-1 capitalize text-ink shadow-sm">{frame.character.mood}</span>
        <span className="hidden rounded-full bg-paper/90 px-2.5 py-1 text-ink shadow-sm sm:inline">{WEATHER[frame.weather]}</span>
        {viewers > 0 && (
          <span className="hidden items-center gap-1 rounded-full bg-paper/90 px-2.5 py-1 text-ink shadow-sm sm:inline-flex">
            <Users size={12} /> {viewers}
          </span>
        )}
        {frame.paused && <Pill tone="lavender">Paused by admin</Pill>}
      </div>
    </div>
  );
}

const REACTIONS = ['💛', '😊', '🌱', '😮', '😂'] as const;

export function ChatPanel({ className = '' }: { className?: string }) {
  const chat = useLive((s) => s.chat);
  const user = useUser();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState<string[]>([]);
  const [menu, setMenu] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);

  useEffect(() => {
    try {
      setMuted(JSON.parse(localStorage.getItem('calmling.muted') ?? '[]'));
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    if (atBottom.current && list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [chat.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    if (!requireSignIn('Sign in to chat with everyone watching.')) return;
    try {
      setError(null);
      const r = await api<{ message: ChatMessageDTO }>('/api/chat', { body: { text } });
      useLive.getState().apply({ type: 'chat', message: r.message });
      setText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send');
    }
  }
  async function react(id: string, emoji: string) {
    if (!requireSignIn('Sign in to react.')) return;
    try {
      const r = await api<{ reactions: Record<string, number> }>(`/api/chat/${id}/react`, { body: { emoji } });
      useLive.getState().apply({ type: 'chat_update', id, reactions: r.reactions });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed');
    }
  }
  async function report(id: string) {
    if (!requireSignIn('Sign in to report messages.')) return;
    await api(`/api/chat/${id}/report`, { body: { reason: 'viewer report' } }).catch(() => {});
    setMenu(null);
    setError('Thanks — a moderator will take a look.');
  }
  async function block(userId: string) {
    if (!requireSignIn('Sign in to block people.')) return;
    await api('/api/users/block', { body: { userId } }).catch(() => {});
    const r = await api<{ messages: ChatMessageDTO[] }>('/api/chat');
    useLive.getState().setChat(r.messages);
    setMenu(null);
  }
  function mute(userId: string) {
    const next = [...new Set([...muted, userId])];
    setMuted(next);
    try {
      localStorage.setItem('calmling.muted', JSON.stringify(next));
    } catch {
      /* ignore */
    }
    setMenu(null);
  }

  const visible = chat.filter((m) => !m.hidden && !muted.includes(m.userId));
  return (
    <div className={`flex min-h-0 flex-col ${className}`} data-testid="chat-panel">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="flex items-center gap-2 font-display text-lg">
          <MessageCircle size={17} className="text-calm" /> Live chat
        </h2>
        <span className="text-xs text-mist">Calmling may notice. It won't obey.</span>
      </div>
      <div
        ref={list}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="scroll-soft min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 py-3"
      >
        {!visible.length && <p className="py-8 text-center text-sm text-mist">No messages yet. Say hello.</p>}
        {visible.map((m) => (
          <div key={m.id} className="group relative text-sm leading-snug" data-testid="chat-message">
            <span className="font-semibold text-calm-deep">{m.username}</span>{' '}
            <span className="text-[0.7rem] text-mist">{new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            <p className="break-words text-ink">{m.text}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {Object.entries(m.reactions).map(([e, n]) => (
                <button key={e} onClick={() => react(m.id, e)} className="rounded-full bg-cream-2 px-1.5 text-xs">
                  {e} {n}
                </button>
              ))}
              <div className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                {REACTIONS.map((e) => (
                  <button key={e} onClick={() => react(m.id, e)} className="rounded-full px-1 text-xs hover:bg-cream-2" aria-label={`React ${e}`}>
                    {e}
                  </button>
                ))}
                {m.userId !== user?.id && (
                  <button onClick={() => setMenu(menu === m.id ? null : m.id)} className="rounded-full px-1.5 text-xs text-mist hover:bg-cream-2" aria-label="More">
                    ···
                  </button>
                )}
              </div>
            </div>
            {menu === m.id && (
              <div className="absolute right-0 top-0 z-10 flex gap-1 rounded-xl border border-line bg-paper p-1 text-xs shadow-[var(--shadow-lift)]">
                <button onClick={() => report(m.id)} className="flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-cream-2">
                  <Flag size={12} /> Report
                </button>
                <button onClick={() => mute(m.userId)} className="flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-cream-2">
                  <VolumeX size={12} /> Mute
                </button>
                <button onClick={() => block(m.userId)} className="rounded-lg px-2 py-1 hover:bg-cream-2">
                  Block
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      <form onSubmit={send} className="border-t border-line p-3">
        {error && <p className="mb-2 text-xs text-[#a2483a]">{error}</p>}
        <div className="flex items-center gap-2 rounded-full border border-line bg-cream px-2 py-1">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={280}
            placeholder={user ? 'Say something kind…' : 'Join to chat'}
            className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-sm outline-none"
            data-testid="chat-input"
          />
          <button type="submit" className="focus-ring grid size-8 place-items-center rounded-full bg-calm text-white disabled:opacity-40" disabled={!text.trim()} aria-label="Send">
            <Send size={14} />
          </button>
        </div>
      </form>
    </div>
  );
}

interface CatalogItem {
  kind: string;
  name: string;
  description: string;
  emoji: string;
  category: string;
}

export function GiftPanel({ compact = false }: { compact?: boolean }) {
  const { data } = usePolling<{ gifts: CatalogItem[]; locations: { id: string; name: string }[] }>('/api/gifts/catalog', 0);
  const [kind, setKind] = useState('flower');
  const [location, setLocation] = useState('garden');
  const [status, setStatus] = useState<{ tone: 'ok' | 'err'; text: string; objectId?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const discovered = useLive((s) => (status?.objectId ? s.objects[status.objectId]?.discovered : false));
  const exists = useLive((s) => (status?.objectId ? !!s.objects[status.objectId] : false));

  async function send() {
    if (!requireSignIn('Sign in to send Calmling a gift.')) return;
    setBusy(true);
    try {
      const r = await api<{ gift: { objectId: string } }>('/api/gifts', { body: { kind, location } });
      setStatus({ tone: 'ok', text: 'Sent.', objectId: r.gift.objectId });
    } catch (e) {
      setStatus({ tone: 'err', text: e instanceof Error ? e.message : 'Could not send' });
    } finally {
      setBusy(false);
    }
  }

  const items = data?.gifts ?? [];
  return (
    <Card title="Send a gift" icon={<Gift size={17} />} action={!compact ? <Link className="text-xs text-calm hover:underline" href="/gifts">Catalogue</Link> : undefined}>
      <div className="grid grid-cols-5 gap-2" data-testid="gift-grid">
        {items.slice(0, compact ? 5 : 10).map((g) => (
          <motion.button
            whileTap={{ scale: 0.94 }}
            key={g.kind}
            onClick={() => setKind(g.kind)}
            title={g.description}
            data-testid={`gift-${g.kind}`}
            className={`focus-ring flex aspect-square flex-col items-center justify-center gap-1 rounded-2xl border text-[0.68rem] transition-colors ${kind === g.kind ? 'border-calm bg-calm-soft text-calm-deep' : 'border-line bg-cream hover:bg-cream-2'}`}
          >
            <span className="text-2xl leading-none">{g.emoji}</span>
            <span className="max-w-full truncate px-1">{g.name}</span>
          </motion.button>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label className="text-xs text-ink-soft" htmlFor="gift-loc">
          Leave it in the
        </label>
        <select id="gift-loc" value={location} onChange={(e) => setLocation(e.target.value)} className="focus-ring rounded-full border border-line bg-cream px-3 py-1.5 text-sm">
          {(data?.locations ?? []).map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <Button onClick={send} disabled={busy || !items.length} className="ml-auto" data-testid="send-gift">
          {busy ? 'Sending…' : `Send ${items.find((i) => i.kind === kind)?.name.toLowerCase() ?? 'gift'}`}
        </Button>
      </div>
      <AnimatePresence>
        {status && (
          <motion.p initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={`mt-3 rounded-xl px-3 py-2 text-sm ${status.tone === 'ok' ? 'bg-moss-soft text-[#3f6b42]' : 'bg-[#fbeae6] text-[#a2483a]'}`} data-testid="gift-status">
            {status.tone === 'err'
              ? status.text
              : discovered
                ? 'Calmling has noticed your gift. What happens next is up to Calmling.'
                : exists
                  ? 'Your gift is in the world. Calmling has not noticed it yet.'
                  : 'Sent — it will appear in the world in a moment.'}
          </motion.p>
        )}
      </AnimatePresence>
      <p className="mt-3 text-xs text-mist">Gifts are free. Calmling decides for itself whether to use, keep or ignore them.</p>
    </Card>
  );
}

interface Goal {
  id: string;
  title: string;
  description: string;
  target: number;
  progress: number;
  contributor_count: number;
  status: string;
  reward_label: string;
  per_user_daily_limit: number;
  myContributionToday: number;
}

export function GoalCard({ goal, onChange }: { goal: Goal; onChange: () => void }) {
  const [msg, setMsg] = useState<string | null>(null);
  const pct = Math.min(100, (goal.progress / goal.target) * 100);
  async function contribute() {
    if (!requireSignIn('Sign in to contribute to community projects.')) return;
    try {
      const r = await api<{ added: number; completed: boolean }>(`/api/community/goals/${goal.id}/contribute`, { body: { amount: Math.max(1, Math.min(5, goal.per_user_daily_limit - goal.myContributionToday)) } });
      setMsg(r.completed ? 'Complete! Watch the island.' : `You added ${r.added}.`);
      onChange();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'failed');
    }
  }
  return (
    <div className="rounded-2xl border border-line bg-cream/60 p-4" data-testid="goal-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium text-ink">{goal.title}</h3>
          <p className="mt-0.5 text-sm text-ink-soft">{goal.description}</p>
        </div>
        {goal.status === 'completed' ? <Pill tone="moss" className="whitespace-nowrap">Built</Pill> : <Pill tone="calm" className="whitespace-nowrap">{goal.contributor_count} helping</Pill>}
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-cream-2">
        <motion.div className="h-full rounded-full bg-gradient-to-r from-moss to-calm" initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.9 }} />
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-ink-soft">
        <span className="tabular-nums">
          {goal.progress.toLocaleString()} / {goal.target.toLocaleString()}
        </span>
        {goal.status === 'active' && (
          <Button variant="soft" onClick={contribute} className="!px-3 !py-1 text-xs" data-testid="contribute">
            <Sprout size={13} /> Contribute
          </Button>
        )}
      </div>
      {msg && <p className="mt-2 text-xs text-calm-deep">{msg}</p>}
    </div>
  );
}

export function CommunityGoalWidget() {
  const { data, reload } = usePolling<{ goals: Goal[] }>('/api/community/goals', 20000);
  const active = data?.goals.find((g) => g.status === 'active');
  return (
    <Card title="Community goal" icon={<Target size={17} />} action={<Link className="text-xs text-calm hover:underline" href="/community">All projects</Link>}>
      {active ? <GoalCard goal={active} onChange={reload} /> : <Empty>No active projects right now.</Empty>}
    </Card>
  );
}

const MOMENT_ICON: Record<string, string> = {
  object_discovered: '✨', first_time: '🌟', habit_formed: '🔁', habit_faded: '🍂', gift_arrived: '🎁', goal_completed: '🏗️', poll_outcome: '🗳️', plant_bloomed: '🌻',
  audience_noticed: '👋', object_created: '🎨', trait_shift: '🌱', weather_changed: '☁️', object_placed: '📦', activity_failed: '·', day_started: '☀️', simulation_started: '🌅', activity_completed: '·',
};

export function MomentRow({ e }: { e: SimEvent }) {
  return (
    <li className="flex gap-3 py-2 text-sm">
      <span className="w-5 shrink-0 text-center">{MOMENT_ICON[e.type] ?? '·'}</span>
      <span className="flex-1 text-ink">{e.summary}</span>
      <span className="shrink-0 text-xs tabular-nums text-mist">
        D{e.day} {String(Math.floor((e.minute % 1440) / 60)).padStart(2, '0')}:{String(Math.floor(e.minute % 60)).padStart(2, '0')}
      </span>
    </li>
  );
}

export function RecentMoments() {
  const events = useLive((s) => s.events);
  const shown = useMemo(() => [...events].filter((e) => e.type !== 'activity_completed' || e.importance > 0.25).reverse().slice(0, 8), [events]);
  return (
    <Card title="Recent moments" icon={<Sparkles size={17} />}>
      {shown.length ? <ul className="divide-y divide-line/70" data-testid="recent-moments">{shown.map((e) => <MomentRow key={e.id} e={e} />)}</ul> : <Empty>Moments will appear as Calmling lives its day.</Empty>}
    </Card>
  );
}

export function NeedsCard() {
  const needs = useLive((s) => s.frame?.character.needs);
  if (!needs) return null;
  const colors: Record<string, string> = { energy: '#5b8db8', comfort: '#a597cf', happiness: '#e9a58a', confidence: '#7ea67f', hunger: '#c9a35b', curiosity: '#5b8db8', social: '#e9879a', creativity: '#a597cf' };
  return (
    <Card title="How Calmling is doing" icon={<Heart size={17} />}>
      <div className="grid grid-cols-2 gap-x-5 gap-y-3">
        {NEED_KEYS.map((k) => (
          <Meter key={k} label={k === 'social' ? 'social interest' : k} value={needs[k]} color={colors[k]} />
        ))}
      </div>
      <p className="mt-4 text-xs leading-relaxed text-mist">Simulated needs on a 0–100 scale. Energy, comfort, happiness and confidence are better high; hunger, curiosity, social interest and creativity are urges. These are model values, not real feelings.</p>
    </Card>
  );
}

interface HabitDTO {
  id: string;
  label: string;
  strength: number;
  status: string;
  explanation: string;
  formedDay: number | null;
}

export function HabitsCard() {
  const { data } = usePolling<{ active: HabitDTO[]; emerging: HabitDTO[] }>('/api/habits', 30000);
  return (
    <Card title="Calmling's habits" icon={<Brain size={17} />}>
      {data?.active.length ? (
        <ul className="space-y-3" data-testid="habits">
          {data.active.slice(0, 5).map((h) => (
            <li key={h.id}>
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-ink">{h.label}</span>
                {h.status === 'fading' ? <Pill>fading</Pill> : <span className="text-xs tabular-nums text-mist">{Math.round(h.strength)}</span>}
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-cream-2">
                <div className="h-full rounded-full bg-lavender" style={{ width: `${h.strength}%` }} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>No habits yet. Habits form only when Calmling repeats something on several different days.</Empty>
      )}
      {!!data?.emerging.length && (
        <p className="mt-4 text-xs text-mist">
          Emerging: {data.emerging.slice(0, 3).map((h) => h.label.toLowerCase()).join(' · ')}
        </p>
      )}
    </Card>
  );
}

export function MemoriesCard() {
  const { data } = usePolling<{ memories: { id: string; type: string; day: number; summary: string; importance: number }[] }>('/api/memories?limit=40', 30000);
  const top = (data?.memories ?? []).filter((m) => m.type !== 'semantic').sort((a, b) => b.importance - a.importance || b.day - a.day).slice(0, 5);
  return (
    <Card title="Important memories" icon={<Sparkles size={17} />} action={<Link className="text-xs text-calm hover:underline" href="/memories">Timeline</Link>}>
      {top.length ? (
        <ul className="space-y-2.5">
          {top.map((m) => (
            <li key={m.id} className="text-sm">
              <Pill tone={m.type === 'social' ? 'calm' : m.type === 'habit' ? 'lavender' : m.type === 'preference' ? 'moss' : 'neutral'} className="mr-2 !py-0.5">
                {m.type}
              </Pill>
              <span className="text-ink">{m.summary}</span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>No memories yet.</Empty>
      )}
    </Card>
  );
}

export function DiaryCard() {
  const { data } = usePolling<{ entries: { id: string; day: number; title: string; body: string; generator: string }[] }>('/api/diary?limit=1', 60000);
  const e = data?.entries[0];
  return (
    <Card title="Today's diary" icon={<BookOpen size={17} />} action={<Link className="text-xs text-calm hover:underline" href="/diary">All entries</Link>}>
      {e ? (
        <article>
          <h3 className="font-display text-lg">{e.title}</h3>
          <p className="mt-2 font-display text-[0.98rem] italic leading-relaxed text-ink-soft">“{e.body}”</p>
          <p className="mt-3 text-xs text-mist">{e.generator === 'llm' ? 'AI-written' : 'Template-written'} narrative based on verified events.</p>
        </article>
      ) : (
        <Empty>The first diary entry is written when Calmling's first day ends.</Empty>
      )}
    </Card>
  );
}
