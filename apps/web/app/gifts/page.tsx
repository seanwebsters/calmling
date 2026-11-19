'use client';

import { GiftPanel, usePolling } from '@/components/live-widgets';
import { Card, PageHeader, Pill } from '@/components/ui';

export default function GiftsPage() {
  const { data } = usePolling<{ gifts: { kind: string; name: string; description: string; emoji: string; category: string; tags: string[] }[] }>('/api/gifts/catalog', 0);
  const uses: Record<string, string> = {
    plantable: 'can be planted', readable: 'can be read', cuddle: 'can be cuddled', play: 'can be played with', photo_tool: 'takes photos', water_tool: 'waters plants', paint_tool: 'for painting',
    seed: 'can be planted', cup: 'for tea', decor: 'can be kept', waterable: 'needs water',
  };
  return (
    <main className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6">
      <PageHeader eyebrow="Gifts" title="Something for the island">
        Every gift becomes a real object in the persistent world. Calmling may find it, use it, carry it home, plant it — or never notice it at all.
      </PageHeader>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="grid gap-4 sm:grid-cols-2">
          {(data?.gifts ?? []).map((g) => (
            <Card key={g.kind}>
              <div className="flex gap-4">
                <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-cream-2 text-3xl">{g.emoji}</span>
                <div>
                  <h3 className="font-display text-lg">{g.name}</h3>
                  <p className="text-sm text-ink-soft">{g.description}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {g.tags.filter((t) => uses[t]).map((t) => (
                      <Pill key={t} className="!py-0.5">{uses[t]}</Pill>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
        <div className="lg:sticky lg:top-20 lg:self-start">
          <GiftPanel compact={false} />
        </div>
      </div>
    </main>
  );
}
