import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Db } from './db';

/**
 * Development-grade authentication: a viewer claims a unique username and
 * receives an HMAC-signed token. Good enough to attribute gifts, votes and
 * chat. Replace with Supabase Auth (or another IdP) before a public launch.
 */
export interface User {
  id: string;
  username: string;
  role: 'viewer' | 'admin';
  muted_until: string | Date | null;
  banned: boolean;
}

export function signToken(userId: string, secret: string): string {
  const sig = createHmac('sha256', secret).update(userId).digest('base64url');
  return `${userId}.${sig}`;
}

export function verifyToken(token: string, secret: string): string | null {
  const i = token.lastIndexOf('.');
  if (i < 1) return null;
  const userId = token.slice(0, i);
  const expected = Buffer.from(signToken(userId, secret).slice(i + 1));
  const got = Buffer.from(token.slice(i + 1));
  return expected.length === got.length && timingSafeEqual(expected, got) ? userId : null;
}

export const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

export async function registerUser(db: Db, username: string): Promise<User | null> {
  const id = `u_${randomBytes(9).toString('base64url')}`;
  const r = await db.query<User>('insert into users (id, username) values ($1,$2) on conflict (username) do nothing returning id, username, role, muted_until, banned', [id, username]);
  return r.rows[0] ?? null;
}

export async function getUser(db: Db, id: string): Promise<User | null> {
  const r = await db.query<User>('select id, username, role, muted_until, banned from users where id = $1', [id]);
  return r.rows[0] ?? null;
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
