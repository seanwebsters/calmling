'use client';

import { motion } from 'framer-motion';
import { Check, Vote } from 'lucide-react';
import { useEffect, useState } from 'react';
import { requireSignIn } from '@/components/auth';
import { GoalCard, usePolling } from '@/components/live-widgets';
import { Button, Card, Empty, PageHeader, Pill } from '@/components/ui';
import { api } from '@/lib/api';

interface Poll { id: string; question: string; status: string; closes_at: string; winning_option_id: string | null; options: { id: string; label: string; votes: number; emoji: string }[]; myVote: string | null }

function Countdown({ to }: { to: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const ms = Math.max(0, new Date(to).getTime() - now);
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000);
  return <span className="tabular-nums">{h}h {m}m {s}s</span>;
}

function PollCard({ poll, onVoted }: { poll: Poll; onVoted: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const total = poll.options.reduce((a, o) => a + o.votes, 0);
  const open = poll.status === 'open';
  async function vote(optionId: string) {
    if (!requireSignIn('Sign in to vote — one free vote per poll.')) return;
    try {
      await api(`/api/polls/${poll.id}/vote`, { body: { optionId } });
      onVoted();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
    }
  }
  return (
    <Card title={poll.question} icon={<Vote size={17} />} action={open ? <Pill tone="calm">Closes in <Countdown to={poll.closes_at} /></Pill> : <Pill>Closed</Pill>}>
      <div className="space-y-2" data-testid="poll">
        {poll.options.map((o) => {
          const pct = total ? (o.votes / total) * 100 : 0;
          const mine = poll.myVote === o.id;
          const won = poll.winning_option_id === o.id;
          return (
            <button key={o.id} disabled={!open || !!poll.myVote} onClick={() => vote(o.id)} className={`focus-ring relative w-full overflow-hidden rounded-2xl border px-4 py-3 text-left transition-colors ${mine ? 'border-calm' : 'border-line hover:bg-cream-2'} disabled:cursor-default`} data-testid="poll-option">
              <motion.span className="absolute inset-y-0 left-0 bg-calm-soft" initial={{ width: 0 }} animate={{ width: poll.myVote || !open ? `${pct}%` : 0 }} transition={{ duration: 0.6 }} />
              <span className="relative flex items-center gap-3 text-sm">
                <span className="text-xl">{o.emoji}</span>
                <span className="flex-1 font-medium text-ink">{o.label}</span>
                {mine && <Check size={15} className="text-calm" />}
                {won && <Pill tone="moss">Winner</Pill>}
                {(poll.myVote || !open) && <span className="tabular-nums text-ink-soft">{o.votes}</span>}
              </span>
            </button>
          );
        })}
      </div>
      {err && <p className="mt-2 text-sm text-[#a2483a]">{err}</p>}
      <p className="mt-3 text-xs text-mist">When the poll closes the winning object arrives on the island. Calmling decides what, if anything, to do with it.</p>
    </Card>
  );
}

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
