'use client';

import { ACTIONS, OBJECT_KINDS, TRAIT_KEYS } from '@calmling/core';
import { Pause, Play, RefreshCw, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { MomentRow } from '@/components/live-widgets';
import { Button, Card, Empty, Meter, PageHeader, Pill } from '@/components/ui';
import { api, session } from '@/lib/api';

const TABS = ['Decisions', 'Habits', 'Memory', 'Personality', 'Events', 'World', 'Chat', 'Community', 'Highlights', 'Health'] as const;
type Tab = (typeof TABS)[number];

function useAdmin<T>(path: string, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => {
    api<T>(path, { admin: true }).then(setData, (e) => setErr(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => {
    load();
  }, [load]);
  return { data, err, load };
}

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [input, setInput] = useState('');
  useEffect(() => setToken(session.adminToken()), []);
  if (!token)
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <Card title="Admin" icon={<ShieldCheck size={17} />}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              session.setAdminToken(input);
              setToken(input);
            }}
          >
            <label className="text-sm text-ink-soft" htmlFor="tok">Admin token (ADMIN_TOKEN on the simulation service)</label>
            <input id="tok" type="password" value={input} onChange={(e) => setInput(e.target.value)} className="mt-2 w-full rounded-xl border border-line bg-cream px-3 py-2 text-sm" data-testid="admin-token" />
            <Button type="submit" className="mt-4 w-full" data-testid="admin-login">Open dashboard</Button>
          </form>
        </Card>
      </main>
    );
  return <Dashboard onLogout={() => { session.setAdminToken(null); setToken(null); }} />;
}

function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>('Decisions');
  const [tick, setTick] = useState(0);
  const ov = useAdmin<any>('/api/admin/overview', [tick]);
  const [msg, setMsg] = useState<string | null>(null);
  const [days, setDays] = useState(7);
  const [speed, setSpeed] = useState(30);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 5000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (ov.data?.runtime?.timeScale) setSpeed(ov.data.runtime.timeScale);
  }, [ov.data?.runtime?.timeScale]);

  async function act(path: string, body: unknown = {}, label = 'Done') {
    setBusy(true);
    try {
      const r = await api(path, { body, admin: true });
      setMsg(`${label}${r && typeof r === 'object' && 'ms' in r ? ` in ${(r as any).ms} ms (${(r as any).events} events)` : ''}`);
      setTick((x) => x + 1);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(false);
    }
  }

  if (ov.err) return <main className="mx-auto max-w-md px-4 py-16"><Empty>{ov.err}</Empty><Button className="mt-4" onClick={onLogout}>Try another token</Button></main>;
  const d = ov.data;
  const c = d?.state?.character;
  return (
    <main className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6">
      <PageHeader eyebrow="Admin" title="Simulation control" />
      {d && (
        <div className="mb-6 grid gap-4 lg:grid-cols-4">
          <Card title="Life">
            <p className="text-sm text-ink-soft">Day <strong className="text-ink">{d.state.day}</strong> · tick {d.state.tick} · seq {d.state.seq}</p>
            <p className="mt-1 text-sm text-ink-soft">At the <strong className="text-ink">{c.location}</strong>, {c.awake ? 'awake' : 'asleep'}, mood {c.mood}</p>
            <p className="mt-1 text-sm text-ink-soft">Doing: <strong className="text-ink">{c.activity?.action ?? (d.state.awaitingDecision ? 'deciding…' : '—')}</strong></p>
            <p className="mt-1 text-xs text-mist">Goal: {c.goal ?? '—'} — {c.goalReason}</p>
            {!!d.state.plan.length && <p className="mt-1 text-xs text-mist">Plan: {d.state.plan.map((p: any) => p.action).join(' → ')}</p>}
          </Card>
          <Card title="Controls">
            <div className="flex flex-wrap gap-2">
              {d.state.paused ? (
                <Button onClick={() => act('/api/admin/resume', {}, 'Resumed')} disabled={busy} data-testid="admin-resume"><Play size={14} /> Resume</Button>
              ) : (
                <Button variant="soft" onClick={() => act('/api/admin/pause', {}, 'Paused')} disabled={busy} data-testid="admin-pause"><Pause size={14} /> Pause</Button>
              )}
              <Button variant="ghost" onClick={() => setTick((x) => x + 1)}><RefreshCw size={14} /></Button>
            </div>
            <div className="mt-3 flex items-center gap-2 text-sm">
              <label htmlFor="spd" className="text-ink-soft">Speed</label>
              <input id="spd" type="number" min={1} max={3600} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="w-20 rounded-lg border border-line bg-cream px-2 py-1" />
              <span className="text-xs text-mist">sim s / real s</span>
              <Button variant="soft" className="!px-3 !py-1" onClick={() => act('/api/admin/speed', { timeScale: speed }, `Speed set to ${speed}×`)}>Set</Button>
            </div>
            <div className="mt-3 flex items-center gap-2 text-sm">
              <label htmlFor="ff" className="text-ink-soft">Fast-forward</label>
              <input id="ff" type="number" min={0.1} max={30} step={0.5} value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-20 rounded-lg border border-line bg-cream px-2 py-1" data-testid="ff-days" />
              <span className="text-xs text-mist">days</span>
              <Button variant="soft" className="!px-3 !py-1" disabled={busy} onClick={() => act('/api/admin/fast-forward', { days }, `Simulated ${days} days`)} data-testid="ff-run">{busy ? 'Running…' : 'Run'}</Button>
            </div>
            {msg && <p className="mt-3 text-xs text-calm-deep" data-testid="admin-msg">{msg}</p>}
          </Card>
          <Card title="Brain & spend">
            <Pill tone={d.brain.mode === 'llm' ? 'calm' : 'lavender'}>{d.brain.label}</Pill>
            <p className="mt-2 text-xs text-ink-soft">{d.brain.reason}</p>
            <p className="mt-2 text-sm text-ink-soft">Calls last hour: {d.brain.callsLastHour} · Spent today: ${Number(d.brain.spentTodayUsd).toFixed(4)}</p>
            {d.brain.lastError && <p className="mt-1 text-xs text-[#a2483a]">Last error: {d.brain.lastError}</p>}
            {d.spend.map((s: any, i: number) => (
              <p key={i} className="text-xs text-mist">{s.model}/{s.purpose}: {s.calls} calls, {s.failures} failed, ${Number(s.cost_usd ?? 0).toFixed(4)}</p>
            ))}
          </Card>
          <Card title="System">
            <p className="text-sm text-ink-soft">DB {d.runtime.db} · limiter {d.runtime.rateLimiter} · {d.runtime.viewers} viewers</p>
            <p className="text-sm text-ink-soft">Last tick {d.runtime.lastTickMs} ms, {d.runtime.lastTickAgoMs ?? '—'} ms ago</p>
            <p className="text-sm text-ink-soft">Errors (24h): {d.counts.errors24h} · open reports: {d.counts.reportsOpen}</p>
            <p className="text-xs text-mist">{d.counts.events} events · {d.counts.memories} memories · {d.counts.objects} objects · {d.counts.users} users · {d.counts.gifts} gifts</p>
            <button onClick={onLogout} className="mt-2 text-xs text-mist underline">Sign out of admin</button>
          </Card>
        </div>
      )}
      <div className="mb-5 flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-full px-3.5 py-1.5 text-sm ${tab === t ? 'bg-ink text-cream' : 'bg-paper text-ink-soft ring-1 ring-line'}`}>{t}</button>
        ))}
      </div>
      {tab === 'Decisions' && <Decisions tick={tick} />}
      {tab === 'Habits' && d && <Habits habits={d.habits} />}
      {tab === 'Memory' && d && <MemoryTab mem={d.workingMemory} obs={d.observations} />}
      {tab === 'Personality' && d && <Personality p={d.personality} needs={c.needs} />}
      {tab === 'Events' && <EventsTab tick={tick} />}
      {tab === 'World' && <WorldTab act={act} />}
      {tab === 'Chat' && <ChatTab act={act} tick={tick} />}
      {tab === 'Community' && <CommunityTab act={act} />}
      {tab === 'Highlights' && <HighlightsTab act={act} tick={tick} />}
      {tab === 'Health' && <HealthTab tick={tick} />}
    </main>
  );
}

function Decisions({ tick }: { tick: number }) {
  const { data } = useAdmin<{ decisions: any[] }>('/api/admin/decisions?limit=80', [tick]);
  return (
    <Card title="Why Calmling chose what it did">
      <div className="space-y-3">
        {(data?.decisions ?? []).map((x) => (
          <div key={x.id} className="rounded-xl bg-cream/70 px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="tabular-nums text-mist">D{x.day} {String(Math.floor((x.minute % 1440) / 60)).padStart(2, '0')}:{String(Math.floor(x.minute % 60)).padStart(2, '0')}</span>
              <Pill tone={x.source === 'llm' ? 'calm' : x.source === 'fallback' ? 'lavender' : 'neutral'}>{x.source}{x.model ? ` · ${x.model}` : ''}</Pill>
              <strong className="text-ink">{ACTIONS[x.action]?.label ?? x.action}</strong>
              {x.target_id && <span className="text-ink-soft">→ {x.target_id}</span>}
              {!x.valid && <Pill className="bg-[#fbeae6] text-[#a2483a]">rejected: {x.rejection_reason}</Pill>}
            </div>
            <p className="mt-1 text-ink-soft">{x.reason}</p>
            {x.thought && <p className="mt-1 italic text-ink-soft">“{x.thought}”</p>}
            <p className="mt-1 text-xs text-mist">Candidates: {x.candidates.slice(0, 6).map((cd: any) => `${cd.action}${cd.targetId ? `(${cd.targetId})` : ''} ${cd.score}`).join(' · ')}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Habits({ habits }: { habits: any[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {!habits.length && <Empty>No habit candidates yet.</Empty>}
      {habits.map((h) => (
        <Card key={h.id}>
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-medium text-ink">{h.label}</h3>
            <Pill tone={h.status === 'formed' ? 'moss' : h.status === 'fading' ? 'lavender' : 'neutral'}>{h.status}</Pill>
          </div>
          <Meter label="strength" value={h.strength} color="#a597cf" />
          <p className="mt-2 text-xs text-ink-soft">{h.explanation}</p>
          <details className="mt-2 text-xs text-mist">
            <summary className="cursor-pointer">Evidence ({h.occurrences.length} occurrences)</summary>
            <ul className="mt-1 space-y-0.5">
              {h.occurrences.slice(-12).map((o: any) => <li key={o.eventId}>Day {o.day} · {String(Math.floor((o.minute % 1440) / 60)).padStart(2, '0')}:{String(Math.floor(o.minute % 60)).padStart(2, '0')} · reward {o.reward} · {o.eventId}</li>)}
            </ul>
          </details>
        </Card>
      ))}
    </div>
  );
}

function MemoryTab({ mem, obs }: { mem: any[]; obs: any[] }) {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <Card title="Working memory (most recent)">
        <ul className="space-y-2 text-sm">
          {mem.map((m) => <li key={m.id}><Pill className="mr-2 !py-0.5">{m.type}</Pill>{m.summary} <span className="text-xs text-mist">· imp {m.importance.toFixed(2)} · recalled {m.recallCount}× · {m.relatedEventIds.length} events</span></li>)}
        </ul>
      </Card>
      <Card title="Audience observations">
        {obs.length ? obs.map((o) => (
          <div key={o.id} className="mb-3 text-sm">
            <p className="text-ink">{o.messageCount} messages · themes: {o.themes.join(', ') || '—'} {o.consumed && <Pill className="ml-1 !py-0.5">noticed</Pill>}</p>
            <ul className="text-xs text-ink-soft">{o.excerpts.map((e: any, i: number) => <li key={i}>“{e.text}” — {e.username}</li>)}</ul>
          </div>
        )) : <Empty>No chat observations yet.</Empty>}
      </Card>
    </div>
  );
}

function Personality({ p, needs }: { p: any; needs: Record<string, number> }) {
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <Card title="Traits">
        <div className="space-y-3">{TRAIT_KEYS.map((k) => <Meter key={k} label={k} value={p.traits[k]} color="#5b8db8" />)}</div>
        <div className="mt-4 space-y-1 text-sm text-ink-soft">{p.trends.length ? p.trends.map((t: any) => <p key={t.trait}>{t.statement}</p>) : <p className="text-mist">No measurable change yet (needs ≥2 points over recorded history).</p>}</div>
      </Card>
      <Card title="Needs">
        <div className="space-y-3">{Object.entries(needs).map(([k, v]) => <Meter key={k} label={k} value={v} />)}</div>
      </Card>
    </div>
  );
}

function EventsTab({ tick }: { tick: number }) {
  const { data } = useAdmin<{ events: any[] }>('/api/events?limit=150', [tick]);
  return <Card title="Event log"><ul className="divide-y divide-line/70">{(data?.events ?? []).map((e) => <MomentRow key={e.id} e={e} />)}</ul></Card>;
}

function WorldTab({ act }: { act: (p: string, b?: unknown, l?: string) => Promise<void> }) {
  const { data, load } = useAdmin<{ objects: any[] }>('/api/world');
  return (
    <Card title="Objects (gifts can be removed by moderators)">
      <ul className="space-y-1.5 text-sm">
        {(data?.objects ?? []).map((o) => (
          <li key={o.id} className="flex items-center gap-2">
            <span>{OBJECT_KINDS[o.kind]?.emoji}</span>
            <span className="text-ink">{o.name}</span>
            <span className="text-xs text-mist">{o.id} · {o.location} · {o.origin.type}{o.origin.by ? ` from ${o.origin.by}` : ''} · used {o.interactions}×</span>
            {!o.permanent && o.origin.type !== 'world' && (
              <button onClick={async () => { await act(`/api/admin/objects/${o.id}/remove`, {}, 'Removed'); load(); }} className="ml-auto text-xs text-[#a2483a] hover:underline">remove</button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ChatTab({ act, tick }: { act: (p: string, b?: unknown, l?: string) => Promise<void>; tick: number }) {
  const { data, load } = useAdmin<{ messages: any[] }>('/api/admin/chat', [tick]);
  return (
    <Card title="Moderation queue (most reported first)">
      <ul className="space-y-2 text-sm">
        {(data?.messages ?? []).map((m) => (
          <li key={m.id} className={`flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 ${m.hidden ? 'bg-cream-2 opacity-60' : 'bg-cream/70'}`}>
            <strong>{m.username}</strong>
            <span className="flex-1 text-ink">{m.text}</span>
            {Number(m.reports) > 0 && <Pill className="bg-[#fbeae6] text-[#a2483a]">{m.reports} reports</Pill>}
            {(typeof m.flags === 'string' ? JSON.parse(m.flags) : m.flags).map((f: string) => <Pill key={f}>{f}</Pill>)}
            <button className="text-xs text-calm-deep hover:underline" onClick={async () => { await act(`/api/admin/chat/${m.id}/hide`, { hidden: !m.hidden }, m.hidden ? 'Unhidden' : 'Hidden'); load(); }}>{m.hidden ? 'unhide' : 'hide'}</button>
            <button className="text-xs text-[#a2483a] hover:underline" onClick={() => act(`/api/admin/users/${m.user_id}/mute`, { minutes: 60 }, 'Muted for 1 hour')}>mute 1h</button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function CommunityTab({ act }: { act: (p: string, b?: unknown, l?: string) => Promise<void> }) {
  const [g, setG] = useState({ title: 'Decorate Calmling’s home', description: 'Bring a little piano into the cottage.', target: 50, rewardKind: 'piano', rewardLabel: 'Community piano' });
  const [p, setP] = useState({ question: 'What should we give Calmling tomorrow?', options: 'camera:A camera\npiano:A piano\nmystery_seed:A mysterious seed' });
  const big = Object.values(OBJECT_KINDS).filter((k) => !k.portable || k.pollOnly).map((k) => k.kind);
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <Card title="Create community goal">
        <div className="space-y-2 text-sm">
          <input className="w-full rounded-lg border border-line bg-cream px-3 py-2" value={g.title} onChange={(e) => setG({ ...g, title: e.target.value })} />
          <textarea className="w-full rounded-lg border border-line bg-cream px-3 py-2" value={g.description} onChange={(e) => setG({ ...g, description: e.target.value })} />
          <div className="flex gap-2">
            <input type="number" className="w-28 rounded-lg border border-line bg-cream px-3 py-2" value={g.target} onChange={(e) => setG({ ...g, target: Number(e.target.value) })} />
            <select className="flex-1 rounded-lg border border-line bg-cream px-3 py-2" value={g.rewardKind} onChange={(e) => setG({ ...g, rewardKind: e.target.value })}>{big.map((k) => <option key={k}>{k}</option>)}</select>
          </div>
          <input className="w-full rounded-lg border border-line bg-cream px-3 py-2" value={g.rewardLabel} onChange={(e) => setG({ ...g, rewardLabel: e.target.value })} />
          <Button onClick={() => act('/api/admin/goals', { ...g, perUserDailyLimit: 10 }, 'Goal created')}>Create goal</Button>
        </div>
      </Card>
      <Card title="Create poll (closes the current one)">
        <div className="space-y-2 text-sm">
          <input className="w-full rounded-lg border border-line bg-cream px-3 py-2" value={p.question} onChange={(e) => setP({ ...p, question: e.target.value })} />
          <textarea rows={4} className="w-full rounded-lg border border-line bg-cream px-3 py-2 font-mono text-xs" value={p.options} onChange={(e) => setP({ ...p, options: e.target.value })} />
          <p className="text-xs text-mist">One option per line: kind:Label</p>
          <Button onClick={() => act('/api/admin/polls', { question: p.question, options: p.options.split('\n').filter(Boolean).map((l) => { const [kind, ...rest] = l.split(':'); return { kind: kind.trim(), label: rest.join(':').trim() }; }) }, 'Poll created')}>Create poll</Button>
        </div>
      </Card>
    </div>
  );
}

function HighlightsTab({ act, tick }: { act: (p: string, b?: unknown, l?: string) => Promise<void>; tick: number }) {
  const { data, load } = useAdmin<{ highlights: any[] }>('/api/admin/highlights', [tick]);
  return (
    <Card title="Review highlights">
      <ul className="space-y-2 text-sm">
        {(data?.highlights ?? []).map((h) => (
          <li key={h.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-cream/70 px-3 py-2">
            <Pill tone="lavender">{h.title}</Pill>
            <span className="flex-1">{h.description}</span>
            <span className="text-xs text-mist">D{h.day} · {h.score}</span>
            <Pill>{h.status}</Pill>
            <button className="text-xs text-[#4f7a51] hover:underline" onClick={async () => { await act(`/api/admin/highlights/${h.id}/status`, { status: 'approved' }, 'Approved'); load(); }}>approve</button>
            <button className="text-xs text-[#a2483a] hover:underline" onClick={async () => { await act(`/api/admin/highlights/${h.id}/status`, { status: 'rejected' }, 'Rejected'); load(); }}>reject</button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function HealthTab({ tick }: { tick: number }) {
  const errs = useAdmin<{ errors: any[] }>('/api/admin/errors', [tick]);
  const audit = useAdmin<{ audit: any[] }>('/api/admin/audit', [tick]);
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <Card title="Errors">{errs.data?.errors.length ? <ul className="space-y-1 text-xs">{errs.data.errors.map((e) => <li key={e.id}><span className="text-mist">{new Date(e.created_at).toLocaleString()}</span> [{e.scope}] {e.message}</li>)}</ul> : <Empty>No errors recorded.</Empty>}</Card>
      <Card title="Audit log">{audit.data?.audit.length ? <ul className="space-y-1 text-xs">{audit.data.audit.map((a) => <li key={a.id}><span className="text-mist">{new Date(a.created_at).toLocaleString()}</span> {a.actor}: {a.action} {JSON.stringify(a.details)}</li>)}</ul> : <Empty>No admin actions yet.</Empty>}</Card>
    </div>
  );
}
