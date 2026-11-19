'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogOut, User } from 'lucide-react';
import { session } from '@/lib/api';
import { useAuthDialog, useUser } from './auth';

const LINKS = [
  { href: '/', label: 'Live' },
  { href: '/world', label: 'World' },
  { href: '/memories', label: 'Memories' },
  { href: '/diary', label: 'Diary' },
  { href: '/community', label: 'Community' },
  { href: '/highlights', label: 'Highlights' },
];

export function Nav() {
  const path = usePathname();
  const user = useUser();
  const show = useAuthDialog((s) => s.show);
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-cream/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1500px] items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="font-display text-[1.35rem] font-semibold tracking-[0.14em] text-ink">
          CALMLING
        </Link>
        <nav className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => {
            const active = l.href === '/' ? path === '/' : path.startsWith(l.href);
            return (
              <Link key={l.href} href={l.href} className={`focus-ring rounded-full px-3 py-1.5 text-sm transition-colors ${active ? 'bg-paper text-ink shadow-[var(--shadow-soft)]' : 'text-ink-soft hover:text-ink'}`}>
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Link href="/about" className="hidden text-sm text-ink-soft hover:text-ink sm:block">
            About
          </Link>
          {user ? (
            <div className="flex items-center gap-1">
              <Link href="/profile" className="focus-ring flex items-center gap-2 rounded-full bg-paper px-3 py-1.5 text-sm shadow-[var(--shadow-soft)]" data-testid="profile-link">
                <User size={15} className="text-calm" /> {user.username}
              </Link>
              <button onClick={() => session.clear()} className="focus-ring rounded-full p-2 text-mist hover:bg-cream-2" aria-label="Sign out">
                <LogOut size={15} />
              </button>
            </div>
          ) : (
            <button onClick={() => show()} className="focus-ring rounded-full bg-ink px-3.5 py-1.5 text-sm text-cream hover:bg-ink/90" data-testid="sign-in">
              Join
            </button>
          )}
        </div>
      </div>
      <nav className="scroll-soft flex gap-1 overflow-x-auto px-3 pb-2 md:hidden">
        {LINKS.map((l) => {
          const active = l.href === '/' ? path === '/' : path.startsWith(l.href);
          return (
            <Link key={l.href} href={l.href} className={`whitespace-nowrap rounded-full px-3 py-1 text-sm ${active ? 'bg-paper text-ink shadow-[var(--shadow-soft)]' : 'text-ink-soft'}`}>
              {l.label}
            </Link>
          );
        })}
        <Link href="/about" className="whitespace-nowrap rounded-full px-3 py-1 text-sm text-ink-soft">
          About
        </Link>
      </nav>
    </header>
  );
}
