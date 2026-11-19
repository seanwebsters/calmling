'use client';

import { Gift, Sprout, Vote } from 'lucide-react';
import { useAuthDialog, useUser } from '@/components/auth';
import { usePolling } from '@/components/live-widgets';
import { Button, Card, Empty, PageHeader, Pill } from '@/components/ui';

interface Profile {
  user: { username: string };
  gifts: { id: string; kind: string; status: string; facts: string[] }[];
  history: { kind: string; summary: string; created_at: string; day: number | null }[];
  memories: { id: string; summary: string; day: number }[];
  pollsParticipated: number;
  projects: { title: string; amount: number }[];
}

function ProfileInner() {
  const { data, error } = usePolling<Profile>('/api/profile', 20000);
  if (error) return <Empty>{error}</Empty>;
  if (!data) return <Empty>Loading…</Empty>;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        <h2 className="font-display text-2xl">Your gifts</h2>
        {!data.gifts.length && <Empty>You haven't sent anything yet.</Empty>}
        {data.gifts.map((g) => (
          <Card key={g.id}>
            <ul className="space-y-1.5" data-testid="gift-facts">
              {g.facts.map((f, i) => (
                <li key={i} className={i === 0 ? 'font-display text-lg text-ink' : 'text-sm text-ink-soft'}>{f}</li>
              ))}
            </ul>
          </Card>
        ))}
        {!!data.memories.length && (
          <Card title="Memories connected to you">
            <ul className="space-y-2 text-sm">{data.memories.map((m) => <li key={m.id}><span className="text-mist">Day {m.day} · </span>{m.summary}</li>)}</ul>
          </Card>
        )}
      </div>
      <div className="space-y-5">
        <Card title="Your part in the story">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-2xl bg-cream-2 p-3"><Gift className="mx-auto text-calm" size={18} /><p className="mt-1 text-xl font-semibold">{data.gifts.length}</p><p className="text-xs text-ink-soft">gifts</p></div>
            <div className="rounded-2xl bg-cream-2 p-3"><Vote className="mx-auto text-lavender" size={18} /><p className="mt-1 text-xl font-semibold">{data.pollsParticipated}</p><p className="text-xs text-ink-soft">votes</p></div>
            <div className="rounded-2xl bg-cream-2 p-3"><Sprout className="mx-auto text-moss" size={18} /><p className="mt-1 text-xl font-semibold">{data.projects.length}</p><p className="text-xs text-ink-soft">projects</p></div>
          </div>
        </Card>
        <Card title="History">
          {data.history.length ? (
            <ul className="space-y-2 text-sm">{data.history.map((h, i) => <li key={i} className="flex gap-2"><Pill className="!py-0.5">{h.kind}</Pill><span className="text-ink">{h.summary}</span></li>)}</ul>
          ) : (
            <Empty>Nothing yet.</Empty>
          )}
        </Card>
        <p className="text-xs leading-relaxed text-mist">Everything here is generated from the real event history. Participation matters, but Calmling is never obliged to pay attention to any particular gift.</p>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const user = useUser();
  const show = useAuthDialog((s) => s.show);
  return (
    <main className="mx-auto max-w-[1100px] px-4 py-10 sm:px-6">
      <PageHeader eyebrow="Profile" title={user ? `Hello, ${user.username}` : 'Your contributions'}>
        What you've added to the shared life, and what became of it.
      </PageHeader>
      {user ? <ProfileInner /> : <Button onClick={() => show()}>Join to see your contributions</Button>}
    </main>
  );
}
