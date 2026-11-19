import { resolve } from 'node:path';

const env = process.env;
const num = (v: string | undefined, d: number) => (v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : d);

export interface Config {
  port: number;
  databaseUrl: string | null;
  pgliteDir: string;
  redisUrl: string | null;
  tickMs: number;
  /** simulated seconds per real second */
  timeScale: number;
  seed: number;
  authSecret: string;
  adminToken: string;
  corsOrigins: string[];
  openai: { apiKey: string | null; model: string; diaryModel: string; baseUrl: string; maxCallsPerHour: number; dailyBudgetUsd: number; inputPricePerM: number; outputPricePerM: number; timeoutMs: number; minIntervalSec: number };
  chatObserveEverySec: number;
  pollDurationHours: number;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const cfg: Config = {
    port: num(env.PORT ?? env.WORKER_PORT, 4000),
    databaseUrl: env.DATABASE_URL || null,
    pgliteDir: env.PGLITE_DIR || resolve(process.cwd(), '.data/pglite'),
    redisUrl: env.REDIS_URL || null,
    tickMs: num(env.TICK_MS, 1000),
    timeScale: num(env.TIME_SCALE, 30),
    seed: num(env.SIM_SEED, 20260101),
    authSecret: env.AUTH_SECRET || 'dev-only-insecure-secret-change-me',
    adminToken: env.ADMIN_TOKEN || 'dev-admin',
    corsOrigins: (env.CORS_ORIGINS || 'http://localhost:3000').split(',').map((s) => s.trim()),
    openai: {
      apiKey: env.OPENAI_API_KEY || null,
      model: env.OPENAI_MODEL || 'gpt-4o-mini',
      diaryModel: env.OPENAI_DIARY_MODEL || env.OPENAI_MODEL || 'gpt-4o-mini',
      baseUrl: env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      maxCallsPerHour: num(env.LLM_MAX_CALLS_PER_HOUR, 120),
      dailyBudgetUsd: num(env.LLM_DAILY_BUDGET_USD, 2),
      inputPricePerM: num(env.LLM_INPUT_PRICE_PER_M, 0.15),
      outputPricePerM: num(env.LLM_OUTPUT_PRICE_PER_M, 0.6),
      timeoutMs: num(env.LLM_TIMEOUT_MS, 10000),
      minIntervalSec: num(env.LLM_MIN_INTERVAL_SEC, 20),
    },
    chatObserveEverySec: num(env.CHAT_OBSERVE_EVERY_SEC, 45),
    pollDurationHours: num(env.POLL_DURATION_HOURS, 24),
    ...overrides,
  };
  if (process.env.NODE_ENV === 'production' && (cfg.authSecret.startsWith('dev-') || cfg.adminToken === 'dev-admin')) {
    throw new Error('AUTH_SECRET and ADMIN_TOKEN must be set in production');
  }
  return cfg;
}
