'use client';

import { motion } from 'framer-motion';
import { ArrowRight, Gift, MoreHorizontal, Sprout } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { requireSignIn } from './auth';
import { usePolling } from './live-widgets';

const QUICK = [
  { kind: 'flower', label: 'Flower', emoji: '🌼' },
  { kind: 'book', label: 'Book', emoji: '📘' },
  { kind: 'teddy_bear', label: 'Teddy', emoji: '🧸' },
  { kind: 'camera', label: 'Camera', emoji: '📷' },
];

/** The strip under the stage: gift call-to-action, one-tap gifts and the community goal. */
export function StageStrip({ onOpenGifts }: { onOpenGifts: () => void }) {
  const [toast, setToast] = useState<string | null>(null);
  const goals = usePolling<{ goals: { id: string; title: string; target: number; progress: number; status: string }[] }>('/api/community/goals', 20000);
  const goal = goals.data?.goals.find((g) => g.status === 'active') ?? goals.data?.goals[0];

  async function quick(kind: string, label: string) {
    if (!requireSignIn(`Sign in to send Calmling a ${label.toLowerCase()}.`)) return;
    try {
      await api('/api/gifts', { body: { kind, location: 'garden' } });
      setToast(`Your ${label.toLowerCase()} is on its way to the garden. Calmling may or may not notice it.`);
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Could not send');
    }
    setTimeout(() => setToast(null), 5000);
  }

  return (
    <div className="relative mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_420px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <motion.button
        whileHover={{ y: -2 }}
        whileTap={{ scale: 0.98 }}
        onClick={onOpenGifts}
        className="focus-ring flex items-center gap-5 rounded-[1.6rem] border border-white/20 bg-gradient-to-br from-[#9a7cf2] via-[#8a6ae6] to-[#b48aea] px-6 py-5 text-left text-white shadow-[0_18px_40px_-18px_rgb(139_114_240/0.9)]"
      >
        <Gift size={50} strokeWidth={1.6} className="shrink-0" />
        <span className="flex-1">
          <span className="block font-display text-[1.45rem] font-extrabold leading-tight">Send a gift</span>
          <span className="block text-[0.98rem] text-white/90">Add something special to Calmling&apos;s world</span>
        </span>
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-white/25">
          <ArrowRight size={20} />
        </span>
      </motion.button>

      <div className="grid grid-cols-5 gap-3">
        {QUICK.map((q) => (
          <motion.button
            key={q.kind}
            whileHover={{ y: -3 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => quick(q.kind, q.label)}
            className="glass focus-ring flex flex-col items-center justify-center gap-1 rounded-[1.4rem] py-3 text-white"
            data-testid={`quick-${q.kind}`}
          >
            <span className="text-[2.3rem] leading-none drop-shadow">{q.emoji}</span>
            <span className="text-[0.95rem] font-semibold">{q.label}</span>
          </motion.button>
        ))}
        <Link href="/gifts" className="glass focus-ring flex flex-col items-center justify-center gap-1 rounded-[1.4rem] py-3 text-white">
          <MoreHorizontal size={34} />
          <span className="text-[0.95rem] font-semibold">More</span>
        </Link>
      </div>

      {goal && (
        <Link href="/community" className="glass focus-ring relative overflow-hidden rounded-[1.6rem] px-6 py-5 text-white lg:col-span-2 xl:col-span-1">
          <span className="pointer-events-none absolute -right-2 -top-1 select-none text-[4.2rem] opacity-90">💐</span>
          <span className="flex items-center gap-2 font-display text-[1.3rem] font-extrabold">
            <Sprout size={22} className="text-moss" /> Community goal
          </span>
          <span className="mt-1 block pr-16 text-[1.02rem] text-white/90">{goal.title}</span>
          <span className="mt-3 flex items-center gap-3">
            <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/15">
              <motion.span className="block h-full rounded-full bg-gradient-to-r from-[#a58bff] to-[#d7a6ff]" initial={{ width: 0 }} animate={{ width: `${Math.min(100, (goal.progress / goal.target) * 100)}%` }} transition={{ duration: 1 }} />
            </span>
            <span className="text-sm font-semibold tabular-nums">
              {goal.progress.toLocaleString()} / {goal.target.toLocaleString()}
            </span>
            <span className="grid size-8 place-items-center rounded-full bg-white/20">
              <ArrowRight size={16} />
            </span>
          </span>
        </Link>
      )}
      {toast && (
        <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="chip absolute -top-14 left-1/2 z-10 -translate-x-1/2 rounded-full px-4 py-2 text-sm font-medium shadow-lg">
          {toast}
        </motion.p>
      )}
    </div>
  );
}
