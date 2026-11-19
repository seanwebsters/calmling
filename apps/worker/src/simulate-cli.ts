/**
 * Offline accelerated simulation for testing long-term behaviour without a
 * database:  npm run simulate -- --days 7 --seed 42
 */
import { Simulation, activeHabits, runFor, traitTrends, composeDiaryTemplate, type SimEvent } from '@calmling/core';

const arg = (name: string, d: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : d;
};
const days = arg('days', 7);
const seed = arg('seed', Date.now() % 100000);
const sim = Simulation.create(seed);
const events: SimEvent[] = [];
const t0 = Date.now();
runFor(sim, days * 1440, 1, (p) => events.push(...p.events));
const s = sim.state;
const done: Record<string, number> = {};
for (const e of events) if (e.type === 'activity_completed' && e.action) done[e.action] = (done[e.action] ?? 0) + 1;
console.log(`Simulated ${days} days (seed ${seed}) in ${Date.now() - t0} ms — ${events.length} events\n`);
console.log('Activities:', Object.entries(done).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', '));
console.log('\nHabits:');
for (const h of activeHabits(s)) console.log(`  • ${h.label} — strength ${h.strength.toFixed(0)}\n    ${h.explanation}`);
console.log('\nPersonality trends:');
for (const t of traitTrends(s.traitHistory, s.character.traits, Math.floor(s.minute / 1440) + 1, 30, 1)) console.log(`  • ${t.statement}`);
console.log('\nImportant memories:');
for (const m of [...s.memories].sort((a, b) => b.importance - a.importance).slice(0, 12)) console.log(`  • [${m.type}] ${m.summary}`);
const lastDay = Math.max(1, Math.floor(s.minute / 1440));
const d = composeDiaryTemplate(lastDay, events.filter((e) => e.day === lastDay));
console.log(`\nDiary — ${d.title}\n  ${d.body}`);
