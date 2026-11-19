import type { ChatMessageDTO, ServerMessage } from '@calmling/core';
import { createServer, type Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { buildApi } from './api';
import type { Config } from './config';
import { openDatabase, type Db } from './db';
import { HttpError, readJson, send } from './http';
import { LlmClient } from './llm';
import { memoryLimiter, redisLimiter, type RateLimiter } from './ratelimit';
import { SimulationRuntime } from './runtime';

export interface App {
  server: Server;
  runtime: SimulationRuntime;
  db: Db;
  limiter: RateLimiter;
  port: number;
  close(): Promise<void>;
}

/** Build the whole service: database, simulation, HTTP API and WebSocket fan-out. */
export async function createApp(cfg: Config, opts: { db?: Db; startLoop?: boolean } = {}): Promise<App> {
  const db = opts.db ?? (await openDatabase({ databaseUrl: cfg.databaseUrl, pgliteDir: cfg.pgliteDir }));
  let limiter: RateLimiter = memoryLimiter();
  if (cfg.redisUrl) {
    try {
      limiter = await redisLimiter(cfg.redisUrl);
    } catch (e) {
      console.warn('[redis] unavailable, using in-memory rate limiting:', (e as Error).message);
    }
  }
  const llm = new LlmClient(cfg.openai, db);
  await llm.init();
  const rt = new SimulationRuntime(cfg, db, llm);
  await rt.init();

  const clients = new Set<WebSocket>();
  const sendAll = (msg: ServerMessage) => {
    const data = JSON.stringify(msg);
    for (const ws of clients) if (ws.readyState === ws.OPEN && ws.bufferedAmount < 2_000_000) ws.send(data);
    // multi-instance fan-out channel (a separate gateway can subscribe)
    if (limiter.publish && (msg.type === 'delta' || msg.type === 'chat')) void limiter.publish('calmling:stream', data).catch(() => {});
  };
  rt.onBroadcast(sendAll);

  const api = buildApi({
    rt,
    limiter,
    broadcastChat: (m: ChatMessageDTO) => sendAll({ type: 'chat', message: m }),
    broadcastChatUpdate: (id, patch) => sendAll({ type: 'chat_update', id, ...patch }),
    viewerCount: () => clients.size,
  });

  const server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (origin && (cfg.corsOrigins.includes(origin) || cfg.corsOrigins.includes('*'))) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'origin');
      res.setHeader('access-control-allow-headers', 'content-type, authorization, x-admin-token');
      res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    }
    res.setHeader('x-content-type-options', 'nosniff');
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    const m = api.match(req.method ?? 'GET', url.pathname);
    if (!m) return send(res, 404, { error: 'not found' });
    try {
      const body = await readJson(req);
      const ip = (String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress) ?? 'unknown';
      const out = await m.handler({ req, res, params: m.params, query: url.searchParams, body, ip });
      if (!res.writableEnded) send(res, 200, out ?? { ok: true });
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message, ...e.extra });
      await rt.store.logError(`api ${url.pathname}`, e);
      send(res, 500, { error: 'internal error' });
    }
  });

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
  wss.on('connection', async (ws) => {
    if (clients.size >= 5000) {
      ws.close(1013, 'too many viewers on this instance');
      return;
    }
    clients.add(ws);
    const recent = await db.query('select * from simulation_events where importance >= 0.2 order by seq desc limit 25').catch(() => ({ rows: [] }));
    const { rowToEvent } = await import('./runtime');
    const hello: ServerMessage = { type: 'hello', serverTime: Date.now(), timeScale: rt.timeScale, tickMs: cfg.tickMs, frame: rt.fullFrame(), recentEvents: (recent.rows as Record<string, unknown>[]).map(rowToEvent).reverse() };
    ws.send(JSON.stringify(hello));
    let msgs = 0;
    const reset = setInterval(() => (msgs = 0), 10_000);
    ws.on('message', (raw) => {
      if (++msgs > 20) return ws.close(1008, 'rate limited');
      try {
        const m = JSON.parse(String(raw)) as { type: string };
        if (m.type === 'resync') ws.send(JSON.stringify({ type: 'snapshot', serverTime: Date.now(), timeScale: rt.timeScale, frame: rt.fullFrame() } satisfies ServerMessage));
        else if (m.type === 'ping') ws.send(JSON.stringify({ type: 'viewers', count: clients.size } satisfies ServerMessage));
      } catch {
        /* ignore malformed */
      }
    });
    ws.on('close', () => {
      clients.delete(ws);
      clearInterval(reset);
    });
    ws.on('error', () => clients.delete(ws));
  });
  // periodic full snapshots let clients self-heal from any drift
  const snapTimer = setInterval(() => sendAll({ type: 'snapshot', serverTime: Date.now(), timeScale: rt.timeScale, frame: rt.fullFrame() }), 30_000);
  const viewersTimer = setInterval(() => sendAll({ type: 'viewers', count: clients.size }), 10_000);

  await new Promise<void>((r) => server.listen(cfg.port, r));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : cfg.port;
  if (opts.startLoop !== false) rt.start();

  return {
    server,
    runtime: rt,
    db,
    limiter,
    port,
    async close() {
      clearInterval(snapTimer);
      clearInterval(viewersTimer);
      await rt.stop();
      for (const c of clients) c.terminate();
      wss.close();
      await new Promise<void>((r) => server.close(() => r()));
      await limiter.close();
      if (!opts.db) await db.close();
    },
  };
}
