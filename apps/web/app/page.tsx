'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { LiveScene } from '@/components/LiveScene';
import { ChatPanel, CommunityGoalWidget, DiaryCard, GiftPanel, HabitsCard, MemoriesCard, NeedsCard, RecentMoments, StatusOverlay, useLiveConnection } from '@/components/live-widgets';

const TABS = [
  { id: 'chat', label: 'Chat' },
  { id: 'gift', label: 'Gift' },
  { id: 'moments', label: 'Moments' },
  { id: 'calmling', label: 'Calmling' },
] as const;

export default function LivePage() {
  useLiveConnection();
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('chat');
  return (
    <main className="mx-auto max-w-[1500px] px-0 pb-16 sm:px-6 sm:pt-5">
      {/* stage + chat */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_370px]">
        <div className="relative">
          <LiveScene className="aspect-[4/5] w-full sm:aspect-video sm:rounded-[1.6rem] sm:shadow-[var(--shadow-lift)] sm:ring-1 sm:ring-line" />
          <StatusOverlay />
        </div>
        <div className="card relative hidden overflow-hidden lg:block">
          <ChatPanel className="absolute inset-0" />
        </div>
      </div>

      {/* mobile: tabs */}
      <div className="lg:hidden">
        <div className="sticky top-[5.6rem] z-30 flex gap-1 border-b border-line bg-cream/90 px-3 py-2 backdrop-blur" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={`relative flex-1 rounded-full px-3 py-1.5 text-sm ${tab === t.id ? 'text-ink' : 'text-ink-soft'}`}>
              {tab === t.id && <motion.span layoutId="tab" className="absolute inset-0 rounded-full bg-paper shadow-[var(--shadow-soft)]" />}
              <span className="relative">{t.label}</span>
            </button>
          ))}
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} className="space-y-4 px-3 pt-4">
            {tab === 'chat' && (
              <div className="card flex h-[60vh] overflow-hidden">
                <ChatPanel className="w-full" />
              </div>
            )}
            {tab === 'gift' && (
              <>
                <GiftPanel />
                <CommunityGoalWidget />
              </>
            )}
            {tab === 'moments' && (
              <>
                <RecentMoments />
                <DiaryCard />
              </>
            )}
            {tab === 'calmling' && (
              <>
                <NeedsCard />
                <HabitsCard />
                <MemoriesCard />
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* desktop: below the stage */}
      <div className="mt-6 hidden gap-5 lg:grid lg:grid-cols-3">
        <div className="space-y-5">
          <GiftPanel />
          <CommunityGoalWidget />
        </div>
        <div className="space-y-5">
          <RecentMoments />
          <DiaryCard />
        </div>
        <div className="space-y-5">
          <HabitsCard />
          <MemoriesCard />
          <NeedsCard />
        </div>
      </div>
    </main>
  );
}
