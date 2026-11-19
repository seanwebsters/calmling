'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { create } from 'zustand';
import { useEffect, useState } from 'react';
import { api, session } from '@/lib/api';
import { Button } from './ui';

interface AuthUI {
  open: boolean;
  reason: string | null;
  show(reason?: string): void;
  hide(): void;
}
export const useAuthDialog = create<AuthUI>((set) => ({ open: false, reason: null, show: (reason) => set({ open: true, reason: reason ?? null }), hide: () => set({ open: false }) }));

export function useUser() {
  const [user, setUser] = useState<{ id: string; username: string } | null>(null);
  useEffect(() => {
    const sync = () => setUser(session.user());
    sync();
    window.addEventListener('calmling:auth', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('calmling:auth', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return user;
}

/** Ensures a signed-in user, prompting if needed. Returns false if not signed in. */
export function requireSignIn(reason: string): boolean {
  if (session.token()) return true;
  useAuthDialog.getState().show(reason);
  return false;
}

export function AuthDialog() {
  const { open, reason, hide } = useAuthDialog();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ token: string; user: { id: string; username: string } }>('/api/auth/register', { body: { username: name.trim() } });
      session.set(r.token, r.user);
      hide();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 grid place-items-center bg-ink/25 p-4 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={hide}>
          <motion.form
            onSubmit={submit}
            onClick={(e) => e.stopPropagation()}
            initial={{ y: 16, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 10, opacity: 0 }}
            className="card w-full max-w-sm p-6"
            data-testid="auth-dialog"
          >
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="font-display text-2xl">Join the island</h2>
                <p className="mt-1 text-sm text-ink-soft">{reason ?? 'Choose a name so your gifts, votes and messages are yours.'}</p>
              </div>
              <button type="button" onClick={hide} className="focus-ring rounded-full p-1 text-mist hover:bg-cream-2" aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <label className="text-xs font-medium text-ink-soft" htmlFor="username">
              Your name
            </label>
            <input
              id="username"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. emily"
              className="focus-ring mt-1 w-full rounded-xl border border-line bg-cream px-3 py-2.5 text-sm outline-none"
              data-testid="username-input"
            />
            <p className="mt-2 text-xs text-mist">3–20 letters, numbers or underscores. Development sign-in: no email or password yet.</p>
            {error && <p className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
            <Button type="submit" disabled={busy || name.trim().length < 3} className="mt-5 w-full" data-testid="join-button">
              {busy ? 'Joining…' : 'Join'}
            </Button>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
