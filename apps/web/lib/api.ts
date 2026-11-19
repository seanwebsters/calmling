'use client';

const TOKEN_KEY = 'calmling.token';
const USER_KEY = 'calmling.user';
const ADMIN_KEY = 'calmling.admin';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, v);
  } catch {
    /* storage unavailable */
  }
}

export const session = {
  token: () => read(TOKEN_KEY),
  user: (): { id: string; username: string } | null => {
    const v = read(USER_KEY);
    try {
      return v ? JSON.parse(v) : null;
    } catch {
      return null;
    }
  },
  set(token: string, user: { id: string; username: string }) {
    write(TOKEN_KEY, token);
    write(USER_KEY, JSON.stringify(user));
    window.dispatchEvent(new Event('calmling:auth'));
  },
  clear() {
    write(TOKEN_KEY, null);
    write(USER_KEY, null);
    window.dispatchEvent(new Event('calmling:auth'));
  },
  adminToken: () => read(ADMIN_KEY),
  setAdminToken: (t: string | null) => write(ADMIN_KEY, t),
};

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown; admin?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const t = session.token();
  if (t) headers.authorization = `Bearer ${t}`;
  if (init.admin) headers['x-admin-token'] = session.adminToken() ?? '';
  const res = await fetch(path, { method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'), headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined, cache: 'no-store' });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* empty */
  }
  if (!res.ok) throw new ApiError(res.status, json?.error ?? `Request failed (${res.status})`);
  return json as T;
}
