'use client';

import { BadgeCheck, Feather } from 'lucide-react';
import { usePolling } from '@/components/live-widgets';
import { Empty, PageHeader } from '@/components/ui';

interface Entry { id: string; day: number; title: string; body: string; generator: string; model: string | null; facts: { eventId: string; summary: string; minute: number }[] }

export default function DiaryPage() {
  const { data } = usePolling<{ entries: Entry[] }>('/api/diary?limit=30', 60000);
  return (
    <main className="mx-auto max-w-[860px] px-4 py-10 sm:px-6">
      <PageHeader eyebrow="Diary" title="Calmling's diary">
        Written at the end of each simulated day. The words are narrative interpretation; the facts beneath each entry are the verified events it was written from.
      </PageHeader>
      <div className="space-y-8">
        {!data?.entries.length && <Empty>The first entry is written when Day 1 ends. Ask an admin to fast-forward if you can't wait.</Empty>}
        {data?.entries.map((e) => (
          <article key={e.id} className="card overflow-hidden" data-testid="diary-entry">
            <div className="p-6 sm:p-8">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-lavender">Day {e.day}</p>
              <h2 className="mt-1 font-display text-2xl">{e.title}</h2>
              <p className="mt-4 font-serif text-[1.12rem] leading-[1.75] text-ink">{e.body}</p>
              <p className="mt-4 flex items-center gap-1.5 text-xs text-mist">
                <Feather size={13} /> {e.generator === 'llm' ? `AI-generated narrative (${e.model})` : 'Template narrative (no LLM configured)'} — interpretation, not a record.
              </p>
            </div>
            <details className="border-t border-line bg-cream/60 px-6 py-4 sm:px-8">
              <summary className="flex cursor-pointer items-center gap-1.5 text-sm font-medium text-calm-deep">
                <BadgeCheck size={15} /> {e.facts.length} verified events
              </summary>
              <ul className="mt-3 space-y-1.5 text-sm text-ink-soft">
                {e.facts.map((f) => (
                  <li key={f.eventId} className="flex gap-3">
                    <span className="w-12 shrink-0 tabular-nums text-mist">{String(Math.floor((f.minute % 1440) / 60)).padStart(2, '0')}:{String(Math.floor(f.minute % 60)).padStart(2, '0')}</span>
                    <span>{f.summary}</span>
                  </li>
                ))}
              </ul>
            </details>
          </article>
        ))}
      </div>
    </main>
  );
}
