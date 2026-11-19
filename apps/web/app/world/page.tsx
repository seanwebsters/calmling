'use client';

import { LOCATIONS, OBJECT_KINDS, type LocationId, type WorldObject } from '@calmling/core';
import { motion } from 'framer-motion';
import { MapPin } from 'lucide-react';
import { useState } from 'react';
import { LiveScene } from '@/components/LiveScene';
import { StatusOverlay, useLiveConnection } from '@/components/live-widgets';
import { Card, PageHeader, Pill } from '@/components/ui';
import { useLive } from '@/lib/live';

const ORDER: LocationId[] = ['forest', 'garden', 'home', 'bedroom', 'pond'];
const TINT: Record<LocationId, string> = { forest: '#7ea67f', garden: '#c9a35b', home: '#e9a58a', bedroom: '#a597cf', pond: '#5b8db8' };

function describe(o: WorldObject): string[] {
  const out: string[] = [];
  if (o.origin.type === 'gift') out.push(`Gift from ${o.origin.by}`);
  if (o.origin.type === 'poll') out.push('Chosen by community vote');
  if (o.origin.type === 'community_goal') out.push('Built by the community');
  if (o.origin.type === 'calmling') out.push('Made by Calmling');
  if (o.origin.type === 'discovery') out.push('Found while exploring');
  if (!o.discovered) out.push('Not noticed yet');
  if (o.state.water !== undefined) out.push(`Water ${Math.round(o.state.water)}%`);
  if (o.state.growth !== undefined && o.state.growth < 100) out.push(`Growing ${Math.round(o.state.growth)}%`);
  if (o.state.fruit !== undefined) out.push(`${o.state.fruit} apple${o.state.fruit === 1 ? '' : 's'}`);
  if (o.state.wilting) out.push('Wilting');
  if (o.interactions) out.push(`Used ${o.interactions}×`);
  return out;
}

export default function WorldPage() {
  useLiveConnection();
  const objects = useLive((s) => s.objects);
  const frame = useLive((s) => s.frame);
  const [sel, setSel] = useState<LocationId | null>(null);
  const list = Object.values(objects).filter((o) => o.discovered || o.origin.type !== 'discovery');
  const held = frame?.character.heldObjectId ? objects[frame.character.heldObjectId] : null;
  return (
    <main className="mx-auto max-w-[1300px] px-4 py-10 sm:px-6">
      <PageHeader eyebrow="The island" title="Calmling's world">
        Five places, one persistent world. Everything here is stored by the simulation: if Calmling moves a chair, it stays moved.
      </PageHeader>
      <div className="relative mb-8 overflow-hidden rounded-[1.6rem] ring-1 ring-line">
        <LiveScene className="aspect-[21/9] w-full" />
        <StatusOverlay />
      </div>
      {/* island strip */}
      <div className="mb-8 flex overflow-hidden rounded-2xl ring-1 ring-line">
        {ORDER.map((id) => {
          const l = LOCATIONS[id];
          const here = frame?.character.location === id;
          return (
            <button key={id} onClick={() => setSel(sel === id ? null : id)} style={{ flexGrow: l.x1 - l.x0, background: `${TINT[id]}22` }} className={`relative px-3 py-4 text-left transition-colors hover:brightness-95 ${sel === id ? 'ring-2 ring-inset ring-calm' : ''}`}>
              <span className="block text-sm font-medium text-ink">{l.name}</span>
              <span className="text-xs text-ink-soft">{list.filter((o) => o.location === id).length} things</span>
              {here && (
                <motion.span layoutId="here" className="absolute right-2 top-2">
                  <Pill tone="live" className="!px-2 !py-0.5">
                    <MapPin size={11} /> Calmling
                  </Pill>
                </motion.span>
              )}
            </button>
          );
        })}
      </div>
      {held && (
        <p className="mb-6 text-sm text-ink-soft">
          Calmling is carrying the <strong className="text-ink">{held.name.toLowerCase()}</strong>.
        </p>
      )}
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {ORDER.filter((id) => !sel || sel === id).map((id) => (
          <Card key={id} title={LOCATIONS[id].name} icon={<span className="inline-block size-2.5 rounded-full" style={{ background: TINT[id] }} />}>
            <p className="-mt-2 mb-4 text-sm text-ink-soft">{LOCATIONS[id].description}</p>
            <ul className="space-y-2">
              {list
                .filter((o) => o.location === id && !o.heldBy)
                .sort((a, b) => a.x - b.x)
                .map((o) => (
                  <li key={o.id} className="flex items-start gap-3 rounded-xl bg-cream/70 px-3 py-2">
                    <span className="text-lg leading-6">{OBJECT_KINDS[o.kind]?.emoji ?? '•'}</span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink">{o.name}</p>
                      <p className="text-xs text-ink-soft">{describe(o).join(' · ') || OBJECT_KINDS[o.kind]?.description}</p>
                    </div>
                  </li>
                ))}
            </ul>
          </Card>
        ))}
      </div>
    </main>
  );
}
