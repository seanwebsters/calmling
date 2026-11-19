'use client';

import { motion } from 'framer-motion';
import { Check, Vote } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { requireSignIn } from './auth';
import { Card, Pill } from './ui';

export interface Poll { id: string; question: string; status: string; closes_at: string; winning_option_id: string | null; options: { id: string; label: string; votes: number; emoji: string }[]; myVote: string | null }

export function Countdown({ to }: { to: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const ms = Math.max(0, new Date(to).getTime() - now);
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000);
  return <span className="tabular-nums">{h}h {m}m {s}s</span>;
}

export function PollCard({ poll, onVoted }: { poll: Poll; onVoted: () => void }) {
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
      {err && <p className="mt-2 text-sm text-danger">{err}</p>}
      <p className="mt-3 text-xs text-mist">When the poll closes the winning object arrives on the island. Calmling decides what, if anything, to do with it.</p>
    </Card>
  );
}

