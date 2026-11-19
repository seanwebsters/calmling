'use client';

import { Download } from 'lucide-react';
import { usePolling } from '@/components/live-widgets';
import { Card, Empty, PageHeader, Pill } from '@/components/ui';

interface H { id: string; day: number; minute: number; title: string; description: string; score: number; scores: Record<string, number> }

export default function HighlightsPage() {
  const { data } = usePolling<{ highlights: H[] }>('/api/highlights?limit=60', 30000);
  return (
    <main className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6">
      <PageHeader eyebrow="Highlights" title="Moments worth keeping">
        Detected automatically from the event log and scored for novelty, emotion, visual interest, community relevance, rarity and narrative significance. Each has replay data; video clips are not rendered yet.
      </PageHeader>
      <a href="/api/highlights/manifest.json" className="mb-6 inline-flex items-center gap-2 rounded-full bg-paper px-4 py-2 text-sm text-calm-deep ring-1 ring-line hover:bg-cream-2">
        <Download size={15} /> Today's clip manifest (JSON)
      </a>
      {!data?.highlights.length && <Empty>No highlights yet.</Empty>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data?.highlights.map((h) => (
          <Card key={h.id}>
            <div className="mb-2 flex items-center justify-between">
              <Pill tone="lavender">{h.title}</Pill>
              <span className="text-xs tabular-nums text-mist">Day {h.day} · {String(Math.floor((h.minute % 1440) / 60)).padStart(2, '0')}:{String(Math.floor(h.minute % 60)).padStart(2, '0')}</span>
            </div>
            <p className="text-[0.95rem] text-ink">{h.description}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {Object.entries(h.scores).filter(([, v]) => v > 0).map(([k, v]) => (
                <span key={k} className="rounded-full bg-cream-2 px-2 py-0.5 text-[0.7rem] text-ink-soft">{k} {v.toFixed(1)}</span>
              ))}
              <span className="ml-auto text-xs font-medium text-calm-deep">score {h.score.toFixed(2)}</span>
            </div>
          </Card>
        ))}
      </div>
    </main>
  );
}
