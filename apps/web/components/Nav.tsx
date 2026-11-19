'use client';

import { Bell, Cloud, LogOut, Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { session } from '@/lib/api';
import { useLive } from '@/lib/live';
import { useAuthDialog, useUser } from './auth';

const LINKS = [
  { href: '/', label: 'Live' },
  { href: '/world', label: 'World' },
  { href: '/memories', label: 'Memories' },
  { href: '/diary', label: 'Diary' },
  { href: '/community', label: 'Community' },
];

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span className="grid shrink-0 place-items-center rounded-full font-display font-bold text-white ring-2 ring-white/20" style={{ width: size, height: size, fontSize: size * 0.42, background: `linear-gradient(135deg, hsl(${h} 70% 68%), hsl(${(h + 40) % 360} 60% 52%))` }}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function Nav() {
  const path = usePathname();
  const router = useRouter();
  const user = useUser();
  const show = useAuthDialog((s) => s.show);
  const events = useLive((s) => s.events);
  const [seen, setSeen] = useState(0);
  const notable = events.filter((e) => ['gift_arrived', 'habit_formed', 'goal_completed', 'poll_outcome', 'audience_noticed', 'object_discovered'].includes(e.type));
  const unread = notable.length > seen;
  const [q, setQ] = useState(false);
  return (
    <header className="sticky top-0 z-40 bg-gradient-to-b from-[#1f1833] via-[#1f1833]/85 to-transparent">
      <div className="mx-auto flex h-16 max-w-[1560px] items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-display text-[1.7rem] font-extrabold tracking-tight text-white">
          <Cloud size={30} strokeWidth={2.2} /> Calmling
        </Link>
        <nav className="mx-auto hidden items-center gap-1 md:flex">
          {LINKS.map((l) => {
            const active = l.href === '/' ? path === '/' : path.startsWith(l.href);
            return (
              <Link key={l.href} href={l.href} className={`focus-ring flex items-center gap-2 rounded-full px-5 py-2 text-[0.98rem] font-semibold transition-colors ${active ? 'bg-white/14 text-white ring-1 ring-white/15' : 'text-white/85 hover:text-white'}`}>
                {l.href === '/' && <span className={`size-2 rounded-full bg-[#9fe0b4] ${active ? 'calm-glow' : 'opacity-70'}`} />}
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2 md:ml-0">
          {q ? (
            <form onSubmit={(e) => { e.preventDefault(); const v = (e.currentTarget.elements.namedItem('q') as HTMLInputElement).value; router.push(`/memories?q=${encodeURIComponent(v)}`); setQ(false); }}>
              <input name="q" autoFocus onBlur={() => setQ(false)} placeholder="Search memories…" className="w-44 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm text-white outline-none" />
            </form>
          ) : (
            <button onClick={() => setQ(true)} className="focus-ring grid size-10 place-items-center rounded-full bg-white/10 text-white hover:bg-white/15" aria-label="Search memories">
              <Search size={18} />
            </button>
          )}
          <Link href="/highlights" onClick={() => setSeen(notable.length)} className="focus-ring relative grid size-10 place-items-center rounded-full bg-white/10 text-white hover:bg-white/15" aria-label="Highlights">
            <Bell size={18} />
            {unread && <span className="absolute right-2.5 top-2.5 size-1.5 rounded-full bg-[#c2b2ff]/80" />}
          </Link>
          {user ? (
            <div className="flex items-center gap-1">
              <Link href="/profile" className="focus-ring rounded-full" data-testid="profile-link" title={user.username}>
                <Avatar name={user.username} size={42} />
                <span className="sr-only">{user.username}</span>
              </Link>
              <button onClick={() => session.clear()} className="focus-ring hidden rounded-full p-2 text-white/60 hover:text-white sm:block" aria-label="Sign out">
                <LogOut size={15} />
              </button>
            </div>
          ) : (
            <button onClick={() => show()} className="focus-ring rounded-full bg-white px-4 py-2 text-sm font-semibold text-[#2c2244] hover:bg-white/90" data-testid="sign-in">
              Join
            </button>
          )}
        </div>
      </div>
      <nav className="scroll-soft flex gap-1 overflow-x-auto px-3 pb-2 md:hidden">
        {[...LINKS, { href: '/highlights', label: 'Highlights' }, { href: '/about', label: 'About' }].map((l) => {
          const active = l.href === '/' ? path === '/' : path.startsWith(l.href);
          return (
            <Link key={l.href} href={l.href} className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-semibold ${active ? 'bg-white/14 text-white' : 'text-white/75'}`}>
              {l.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
