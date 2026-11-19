import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Minimal database interface shared by node-postgres and embedded PGlite. */
export interface Db {
  kind: 'postgres' | 'pglite';
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  tx<T>(fn: (q: Db['query']) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export async function connectPostgres(url: string): Promise<Db> {
  const pg = await import('pg');
  const pool = new pg.default.Pool({ connectionString: url, max: 10, ssl: /sslmode=require|supabase\.co/.test(url) ? { rejectUnauthorized: false } : undefined });
  pool.on('error', (e) => console.error('[db] pool error', e.message));
  const query = async <T>(sql: string, params: unknown[] = []) => {
    const r = await pool.query(sql, params as unknown[]);
    return { rows: r.rows as T[] };
  };
  return {
    kind: 'postgres',
    query,
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const res = await fn(async <T>(sql: string, params: unknown[] = []) => ({ rows: (await client.query(sql, params as unknown[])).rows as T[] }));
        await client.query('commit');
        return res;
      } catch (e) {
        await client.query('rollback').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

/**
 * Embedded PostgreSQL (WASM) for zero-setup local development and tests.
 * Same SQL, same migrations; data persists in `dir` (or memory when dir is null).
 */
export async function connectPglite(dir: string | null): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  if (dir) mkdirSync(dir, { recursive: true });
  const db = dir ? new PGlite(dir) : new PGlite();
  await db.waitReady;
  // PGlite is single-connection: serialise access so transactions never interleave
  let chain: Promise<unknown> = Promise.resolve();
  const lock = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
  };
  const raw = async <T>(sql: string, params: unknown[] = []) => ({ rows: (await db.query(sql, params as unknown[])).rows as T[] });
  return {
    kind: 'pglite',
    query: (sql, params) => lock(() => raw(sql, params)),
    tx: (fn) => lock(() => db.transaction(async (t) => fn(async <T>(sql: string, params: unknown[] = []) => ({ rows: (await t.query(sql, params as unknown[])).rows as T[] })))),
    close: () => db.close(),
  };
}

const here = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = resolve(here, '../../../db/migrations');

export async function migrate(db: Db): Promise<string[]> {
  await db.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const done = new Set((await db.query<{ name: string }>('select name from schema_migrations')).rows.map((r) => r.name));
  const applied: string[] = [];
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    const sql = readFileSync(resolve(MIGRATIONS_DIR, f), 'utf8');
    await db.tx(async (q) => {
      if (db.kind === 'pglite') {
        // PGlite's extended protocol takes one statement at a time
        for (const stmt of splitSql(sql)) await q(stmt);
      } else await q(sql);
      await q('insert into schema_migrations (name) values ($1)', [f]);
    });
    applied.push(f);
  }
  return applied;
}

function splitSql(sql: string): string[] {
  return sql
    .replace(/--.*$/gm, '')
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function openDatabase(cfg: { databaseUrl: string | null; pgliteDir: string | null }): Promise<Db> {
  const db = cfg.databaseUrl ? await connectPostgres(cfg.databaseUrl) : await connectPglite(cfg.pgliteDir);
  await migrate(db);
  return db;
}
