import { loadConfig } from './config';
import { connectPglite, connectPostgres, migrate } from './db';

const cfg = loadConfig();
const db = cfg.databaseUrl ? await connectPostgres(cfg.databaseUrl) : await connectPglite(cfg.pgliteDir);
const applied = await migrate(db);
console.log(applied.length ? `applied: ${applied.join(', ')}` : 'database is up to date');
await db.close();
