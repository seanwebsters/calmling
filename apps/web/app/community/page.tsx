'use client';

import { GoalCard, usePolling } from '@/components/live-widgets';
import { PollCard, type Poll } from '@/components/poll';
import { Empty, PageHeader } from '@/components/ui';

export default function CommunityPage() {
  const goals = usePolling<{ goals: any[] }>('/api/community/goals', 15000);
  const polls = usePolling<{ polls: Poll[] }>('/api/polls', 15000);
  const open = polls.data?.polls.filter((p) => p.status === 'open') ?? [];
  const past = polls.data?.polls.filter((p) => p.status === 'closed') ?? [];
  return (
    <main className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6">
      <PageHeader eyebrow="Community" title="Change the world, not the character">
        Build things together and vote on what arrives next. You shape Calmling's surroundings; Calmling chooses how to live in them.
      </PageHeader>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-5">
          <h2 className="font-display text-2xl">Today's poll</h2>
          {open.length ? open.map((p) => <PollCard key={p.id} poll={p} onVoted={polls.reload} />) : <Empty>Loading poll…</Empty>}
          {!!past.length && (
            <>
              <h2 className="pt-4 font-display text-2xl">Poll history</h2>
              {past.slice(0, 5).map((p) => <PollCard key={p.id} poll={p} onVoted={polls.reload} />)}
            </>
          )}
        </div>
        <div className="space-y-5">
          <h2 className="font-display text-2xl">Projects</h2>
          {(goals.data?.goals ?? []).map((g) => <GoalCard key={g.id} goal={g} onChange={goals.reload} />)}
          <p className="text-xs text-mist">Contributions are free and limited per person per day. Completed projects become permanent parts of the island.</p>
        </div>
      </div>
    </main>
  );
}
