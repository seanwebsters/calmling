'use client';

import { useEffect, useMemo, useState } from 'react';
import { MomentRow, usePolling } from '@/components/live-widgets';
import { Card, Empty, PageHeader, Pill } from '@/components/ui';
import type { SimEvent } from '@calmling/core';

interface Mem { id: string; type: string; day: number; minute: number; summary: string; importance: number; relatedEventIds: string[]; emotion: { label?: string; valence?: number } }
const TYPES = ['all', 'episodic', 'social', 'habit', 'preference', 'semantic'] as const;
const TYPE_INFO: Record<string, string> = {
  episodic: 'Specific experiences', social: 'Moments involving viewers', habit: 'Recurring behaviour', preference: 'Likes, learned from experience', semantic: 'Facts about the world',
};

export default function MemoriesPage() {
  const [type, setType] = useState<(typeof TYPES)[number]>('all');
  const [q, setQ] = useState('');
  useEffect(() => setQ(new URLSearchParams(window.location.search).get('q') ?? ''), []);
  const { data } = usePolling<{ memories: Mem[] }>(`/api/memories?limit=300${type === 'all' ? '' : `&type=${type}`}`, 30000);
  const { data: ev } = usePolling<{ events: SimEvent[] }>('/api/events?limit=60&minImportance=0.45', 30000);
  const byDay = useMemo(() => {
    const m = new Map<number, Mem[]>();
    for (const x of (data?.memories ?? []).filter((x) => !q || x.summary.toLowerCase().includes(q.toLowerCase()))) m.set(x.day, [...(m.get(x.day) ?? []), x]);
    return [...m.entries()].sort((a, b) => b[0] - a[0]);
  }, [data, q]);
  return (
    <main className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6">
      <PageHeader eyebrow="Memory" title="What Calmling remembers">
        Every memory is created from a real simulation event and links back to it. Older small moments are folded into day summaries; important facts are kept.
      </PageHeader>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search memories…" className="mr-2 w-56 rounded-full border border-line bg-cream-2 px-4 py-1.5 text-sm text-ink outline-none" />
        {TYPES.map((t) => (
          <button key={t} onClick={() => setType(t)} className={`focus-ring rounded-full px-3.5 py-1.5 text-sm capitalize ${type === t ? 'bg-ink text-cream' : 'bg-paper text-ink-soft ring-1 ring-line hover:text-ink'}`}>
            {t}
          </button>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-8">
          {!byDay.length && <Empty>No memories yet.</Empty>}
          {byDay.map(([day, mems]) => (
            <section key={day}>
              <h2 className="mb-3 font-display text-2xl">Day {day}</h2>
              <ol className="relative space-y-3 border-l border-line pl-5">
                {mems.map((m) => (
                  <li key={m.id} className="relative">
                    <span className="absolute -left-[1.62rem] top-2 size-2.5 rounded-full bg-lavender ring-4 ring-cream" style={{ opacity: 0.35 + m.importance * 0.65 }} />
                    <div className="card px-4 py-3">
                      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-mist">
                        <Pill tone={m.type === 'social' ? 'calm' : m.type === 'habit' ? 'lavender' : m.type === 'preference' ? 'moss' : 'neutral'} className="!py-0.5">{m.type}</Pill>
                        {m.emotion?.label && <span>felt: {m.emotion.label}</span>}
                        <span>importance {m.importance.toFixed(2)}</span>
                        <span title={m.relatedEventIds.join(', ')}>· {m.relatedEventIds.length} source event{m.relatedEventIds.length === 1 ? '' : 's'}</span>
                      </div>
                      <p className="text-[0.95rem] text-ink">{m.summary}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
        <div className="space-y-5">
          <Card title="Memory types">
            <ul className="space-y-2 text-sm">
              {Object.entries(TYPE_INFO).map(([k, v]) => (
                <li key={k}><span className="font-medium capitalize text-ink">{k}</span> <span className="text-ink-soft">— {v}</span></li>
              ))}
            </ul>
          </Card>
          <Card title="Notable events">
            <ul className="divide-y divide-line/70">{(ev?.events ?? []).slice(0, 25).map((e) => <MomentRow key={e.id} e={e} />)}</ul>
          </Card>
        </div>
      </div>
    </main>
  );
}
