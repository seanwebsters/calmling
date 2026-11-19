'use client';

import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

export function Card({ title, icon, action, children, className = '' }: { title?: ReactNode; icon?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: 'easeOut' }} className={`card p-5 ${className}`}>
      {(title || action) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 font-display text-[1.15rem] font-medium tracking-tight text-ink">
            {icon && <span className="text-calm">{icon}</span>}
            {title}
          </h2>
          {action}
        </header>
      )}
      {children}
    </motion.section>
  );
}

export function Pill({ children, tone = 'neutral', className = '' }: { children: ReactNode; tone?: 'neutral' | 'calm' | 'lavender' | 'moss' | 'live'; className?: string }) {
  const tones = {
    neutral: 'bg-cream-2 text-ink-soft',
    calm: 'bg-calm-soft text-calm-deep',
    lavender: 'bg-lavender-soft text-[#6a5ba3]',
    moss: 'bg-moss-soft text-[#4f7a51]',
    live: 'bg-[#e8604c] text-white',
  };
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${tones[tone]} ${className}`}>{children}</span>;
}

export function Button({ children, onClick, disabled, variant = 'primary', type = 'button', className = '', ...rest }: { children: ReactNode; onClick?: () => void; disabled?: boolean; variant?: 'primary' | 'soft' | 'ghost'; type?: 'button' | 'submit'; className?: string; 'data-testid'?: string }) {
  const v = {
    primary: 'bg-calm text-white hover:bg-calm-deep shadow-[0_6px_16px_-8px_rgb(62_108_148/0.7)]',
    soft: 'bg-calm-soft text-calm-deep hover:bg-[#cfdfee]',
    ghost: 'text-ink-soft hover:bg-cream-2',
  };
  return (
    <motion.button whileTap={{ scale: 0.97 }} type={type} onClick={onClick} disabled={disabled} className={`focus-ring inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${v[variant]} ${className}`} {...rest}>
      {children}
    </motion.button>
  );
}

export function PageHeader({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  return (
    <div className="mb-8 max-w-2xl">
      {eyebrow && <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-lavender">{eyebrow}</p>}
      <h1 className="font-display text-4xl font-medium tracking-tight text-ink sm:text-5xl">{title}</h1>
      {children && <div className="mt-3 text-[1.02rem] leading-relaxed text-ink-soft">{children}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl bg-cream-2/70 px-4 py-6 text-center text-sm text-ink-soft">{children}</p>;
}

export function Meter({ value, color = '#5b8db8', label }: { value: number; color?: string; label: string }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-ink-soft">
        <span>{label}</span>
        <span className="tabular-nums">{Math.round(value)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-cream-2">
        <motion.div className="h-full rounded-full" style={{ background: color }} animate={{ width: `${Math.max(2, Math.min(100, value))}%` }} transition={{ duration: 0.8 }} />
      </div>
    </div>
  );
}
