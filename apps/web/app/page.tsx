'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useRef, useState } from 'react';
import { LiveScene } from '@/components/LiveScene';
import { ChatPanel, DiaryCard, GiftPanel, HabitsCard, MemoriesCard, NeedsCard, RecentMoments, StatusOverlay, usePolling, useLiveConnection } from '@/components/live-widgets';
import { PollCard, type Poll } from '@/components/poll';
import { StageStrip } from '@/components/stage-strip';
import { Empty } from '@/components/ui';

const TABS = [
  { id: 'chat', label: 'Chat' },
  { id: 'gifts', label: 'Gifts' },
  { id: 'vote', label: 'Vote' },
] as const;
type TabId = (typeof TABS)[number]['id'];

function VoteTab() {
  const { data, reload } = usePolling<{ polls: Poll[] }>('/api/polls', 15000);
  const open = data?.polls.find((p) => p.status === 'open');
  return <div className="scroll-soft h-full overflow-y-auto p-3">{open ? <PollCard poll={open} onVoted={reload} /> : <Empty>No poll open right now.</Empty>}</div>;
}

function SidePanel({ tab, setTab }: { tab: TabId; setTab: (t: TabId) => void }) {
  return (
    <div className="glass flex h-full min-h-0 flex-col overflow-hidden rounded-[1.8rem]">
      <div className="m-3 flex rounded-full bg-white/8 p-1" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={`relative flex-1 rounded-full py-2.5 text-[1.05rem] font-bold transition-colors ${tab === t.id ? 'text-[#4b3a8f]' : 'text-white/85 hover:text-white'}`} data-testid={`tab-${t.id}`}>
            {tab === t.id && <motion.span layoutId="sidetab" className="absolute inset-0 rounded-full bg-gradient-to-b from-[#e9e2ff] to-[#cfc2ff]" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
            <span className="relative">{t.label}</span>
          </button>
        ))}
      </div>
      <div className="relative min-h-0 flex-1">
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="absolute inset-0">
            {tab === 'chat' && <ChatPanel header={false} className="h-full" />}
            {tab === 'gifts' && (
              <div className="scroll-soft h-full overflow-y-auto p-3">
                <GiftPanel compact />
              </div>
            )}
            {tab === 'vote' && <VoteTab />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

export default function LivePage() {
  useLiveConnection();
  const [tab, setTab] = useState<TabId>('chat');
  const stage = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const openGifts = () => {
    setTab('gifts');
    panel.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  return (
    <main className="mx-auto max-w-[1560px] px-3 pb-16 pt-2 sm:px-6">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px]">
        <div ref={stage} className="relative overflow-hidden rounded-[1.8rem] shadow-[0_30px_80px_-30px_rgb(0_0_0/0.8)] ring-1 ring-white/15">
          <LiveScene className="aspect-[4/5] w-full sm:aspect-video" />
          <StatusOverlay stageRef={stage} />
        </div>
        <div ref={panel} className="h-[70vh] min-h-[420px] lg:h-auto">
          <SidePanel tab={tab} setTab={setTab} />
        </div>
      </div>

      <StageStrip onOpenGifts={openGifts} />

      <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        <div className="space-y-5">
          <RecentMoments />
        </div>
        <div className="space-y-5">
          <DiaryCard />
          <HabitsCard />
        </div>
        <div className="space-y-5">
          <MemoriesCard />
          <NeedsCard />
        </div>
      </div>
    </main>
  );
}
