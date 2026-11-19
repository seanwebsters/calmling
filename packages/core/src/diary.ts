import { ACTIONS } from './actions';
import { Rng } from './rng';
import type { SimEvent } from './types';

export interface DiaryFact {
  eventId: string;
  minute: number;
  summary: string;
}

export interface DiaryDraft {
  day: number;
  title: string;
  body: string;
  facts: DiaryFact[];
  generator: 'template' | 'llm';
  model: string | null;
}

/** Pick the verified facts a diary entry may talk about. */
export function selectDiaryFacts(events: SimEvent[], max = 14): DiaryFact[] {
  const interesting = events.filter((e) =>
    ['object_discovered', 'first_time', 'habit_formed', 'habit_faded', 'gift_arrived', 'goal_completed', 'poll_outcome', 'plant_bloomed', 'audience_noticed', 'object_created', 'trait_shift', 'weather_changed', 'activity_failed'].includes(e.type) ||
    (e.type === 'activity_completed' && e.action !== 'walk' && e.action !== 'pick_up' && e.action !== 'put_down' && e.action !== 'notice'),
  );
  // prefer important ones, keep chronological order
  const ranked = [...interesting].sort((a, b) => b.importance - a.importance).slice(0, max);
  return ranked.sort((a, b) => a.minute - b.minute).map((e) => ({ eventId: e.id, minute: e.minute, summary: e.summary }));
}

const OPENERS = ['Dear diary,', 'Today was a', 'Diary, it is me again.', 'Hello again, diary.'];

/**
 * Deterministic diary writer used when no LLM is configured. Every sentence is
 * derived from a verified event of the day.
 */
export function composeDiaryTemplate(day: number, events: SimEvent[]): DiaryDraft {
  const rng = new Rng(day * 7919);
  const facts = selectDiaryFacts(events);
  const done = new Map<string, number>();
  for (const e of events) if (e.type === 'activity_completed' && e.action && ACTIONS[e.action] && !ACTIONS[e.action].internal) done.set(e.action, (done.get(e.action) ?? 0) + 1);
  const lines: string[] = [];
  const opener = rng.pick(OPENERS);
  const weather = events.filter((e) => e.type === 'weather_changed').map((e) => String(e.data.weather));
  lines.push(opener === 'Today was a' ? `Today was a ${weather.includes('rain') ? 'rainy' : 'gentle'} sort of day.` : opener);

  for (const e of events) {
    const d = e.data as Record<string, string>;
    switch (e.type) {
      case 'gift_arrived':
        lines.push(rng.pick([`Someone called ${d.sender} sent me a ${String(d.objectName).toLowerCase()}. I don't know why, but it made the day feel bigger.`, `A ${String(d.objectName).toLowerCase()} appeared near ${d.locationName}. A note said it was from ${d.sender}.`]));
        break;
      case 'object_discovered':
        lines.push(rng.pick([`I found something new: a ${String(d.objectName).toLowerCase()}. I wasn't sure what it was at first.`, `There was a ${String(d.objectName).toLowerCase()} by the ${String(d.locationName).toLowerCase()} that I had never seen before.`]));
        break;
      case 'first_time':
        lines.push(`For the very first time, I tried to ${ACTIONS[e.action ?? '']?.label ?? 'do something new'}. ${rng.pick(['I think I liked it.', 'It was harder than it looked.', 'I might do it again.'])}`);
        break;
      case 'habit_formed':
        lines.push(`I have noticed something about myself. ${d.label}. It just feels right now.`);
        break;
      case 'habit_faded':
        lines.push(`I haven't been ${String(d.gerund ?? 'doing that')} much lately. Funny how things change.`);
        break;
      case 'plant_bloomed':
        lines.push(`The ${String(d.objectName).toLowerCase()} bloomed! I watered it and waited and now it is really here.`);
        break;
      case 'goal_completed':
        lines.push(`Something wonderful happened: a ${String(d.objectName).toLowerCase()} appeared. Lots of people made it together, I think.`);
        break;
      case 'poll_outcome':
        lines.push(`A ${String(d.objectName).toLowerCase()} turned up today. It feels like someone chose it for me.`);
        break;
      case 'audience_noticed':
        lines.push(`I waved at the people watching. They were talking about ${d.themes || 'all sorts of things'}.`);
        break;
      case 'object_created':
        if (d.madeBy === 'calmling') lines.push(`I made a ${String(d.objectName).toLowerCase()}. I put it somewhere safe.`);
        break;
      case 'activity_failed':
        lines.push(`I tried to ${ACTIONS[e.action ?? '']?.label ?? 'do something'} but it didn't work out.`);
        break;
    }
  }
  const top = [...done.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (top.length) {
    const parts = top.map(([a, n]) => `${ACTIONS[a].gerund}${n > 1 ? ` (${n} times)` : ''}`);
    lines.push(`Most of the day I spent ${parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0]}.`);
  }
  if (lines.length === 1) lines.push('It was a quiet day. Quiet days are allowed.');
  lines.push(rng.pick(['Goodnight.', 'More tomorrow.', 'I wonder what tomorrow will bring.', 'That is all for today.']));
  const firstFact = facts.find((f) => !/weather/i.test(f.summary));
  return { day, title: `Day ${day}${firstFact ? ` — ${shortTitle(firstFact.summary)}` : ''}`, body: lines.join(' '), facts, generator: 'template', model: null };
}

function shortTitle(s: string): string {
  const t = s.replace(/^Calmling /, '').replace(/\.$/, '');
  return t.length > 48 ? t.slice(0, 45) + '…' : t;
}

export function buildDiaryPrompt(day: number, facts: DiaryFact[]): { system: string; user: string } {
  return {
    system:
      'You write the private diary of Calmling, a gentle animated character. Write in the first person, warm, simple, characterful and occasionally funny, not childish. 80-160 words. ' +
      'Only mention things that appear in the verified event list. Do not invent events, objects, people or feelings that contradict the events. Reply with JSON {"title": string, "body": string}.',
    user: `Day ${day}. Verified events:\n${facts.map((f) => `- ${f.summary}`).join('\n') || '- a quiet day with nothing notable'}`,
  };
}
