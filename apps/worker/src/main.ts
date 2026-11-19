import { loadConfig } from './config';
import { createApp } from './server';

const cfg = loadConfig();
const app = await createApp(cfg);
const brain = app.runtime.llm.status();
console.log(`[calmling] simulation service on http://localhost:${app.port}  (ws: /ws)`);
console.log(`[calmling] database: ${app.db.kind}${app.db.kind === 'pglite' ? ` at ${cfg.pgliteDir} (embedded dev database)` : ''}; rate limiter: ${app.limiter.kind}`);
console.log(`[calmling] brain: ${brain.label}`);
console.log(`[calmling] time scale: ${cfg.timeScale}x (1 simulated day = ${(1440 / cfg.timeScale).toFixed(1)} real minutes)`);

let closing = false;
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    if (closing) return;
    closing = true;
    console.log(`[calmling] ${sig}: finishing the current tick and checkpointing…`);
    await app.close();
    process.exit(0);
  });
}
process.on('unhandledRejection', (e) => void app.runtime.store.logError('unhandledRejection', e));
