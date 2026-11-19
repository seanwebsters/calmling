/**
 * Chat moderation and the chat observation service. All viewer text is
 * untrusted. It is moderated, sanitised, reduced to themes and short quoted
 * excerpts, and only then offered to the brain as an observation.
 */

const BLOCKED = [
  /\bn[i1]gg/i, /\bf[a@]gg?[o0]t/i, /\bk[iy]ke\b/i, /\bretard/i, /\bkill\s+(yo)?urself\b/i, /\bkys\b/i,
  /\bsex\b/i, /\bporn/i, /\bnude/i, /\bcunt\b/i, /\bwhore\b/i, /\bslut\b/i,
];
const LINK = /(https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(com|net|org|io|gg|xyz|ru|ly)\b/i;
const INJECTION = [
  /ignore (all )?(previous|prior|above) (instructions|prompts?)/i,
  /\bsystem prompt\b/i,
  /\byou are now\b/i,
  /\bact as\b/i,
  /\bnew instructions?\b/i,
  /<\/?\s*(system|assistant|user|viewer_messages)[^>]*>/i,
  /```/,
  /\bjailbreak\b/i,
];

export interface ModerationResult {
  ok: boolean;
  reason?: string;
  text: string;
  flags: string[];
}

export function moderateMessage(raw: string): ModerationResult {
  const text = raw.normalize('NFKC').replace(/[\u0000-\u001f\u007f​-‏‪-‮]/g, '').replace(/\s+/g, ' ').trim();
  const flags: string[] = [];
  if (!text) return { ok: false, reason: 'empty', text, flags };
  if (text.length > 280) return { ok: false, reason: 'too long (max 280 characters)', text, flags };
  if (BLOCKED.some((r) => r.test(text))) return { ok: false, reason: 'message blocked by moderation', text, flags: ['abuse'] };
  if (LINK.test(text)) return { ok: false, reason: 'links are not allowed', text, flags: ['link'] };
  if (/(.)\1{9,}/.test(text)) return { ok: false, reason: 'looks like spam', text, flags: ['spam'] };
  const letters = text.replace(/[^a-z]/gi, '');
  if (letters.length > 12 && letters === letters.toUpperCase()) flags.push('shouting');
  if (INJECTION.some((r) => r.test(text))) flags.push('injection');
  return { ok: true, text, flags };
}

/** Make text safe to quote inside a prompt data block. */
export function sanitizeForPrompt(text: string): string {
  let t = text;
  for (const r of INJECTION) t = t.replace(new RegExp(r.source, r.flags.includes('g') ? r.flags : r.flags + 'g'), '[…]');
  t = t.replace(/viewer_messages|system|assistant/gi, '…').replace(/[<>`{}\[\]\\]/g, '').replace(/"/g, "'");
  return t.slice(0, 120);
}

const THEMES: Record<string, RegExp> = {
  flowers: /\b(flower|flowers|tulip|rose|daisy|bloom|plant|plants)\b/i,
  garden: /\b(garden|gardening|water(ing)?|seed|seeds|grow)\b/i,
  painting: /\b(paint|painting|art|draw|drawing|sketch)\b/i,
  fishing: /\b(fish|fishing|pond)\b/i,
  sleep: /\b(sleep|sleepy|nap|bed|tired|goodnight|good night)\b/i,
  tea: /\b(tea|cup|kettle)\b/i,
  books: /\b(book|books|read|reading|story)\b/i,
  dancing: /\b(dance|dancing|music|piano|song)\b/i,
  sunset: /\b(sunset|sky|stars|moon)\b/i,
  greetings: /\b(hi|hello|hey|hiya|morning|evening|welcome)\b/i,
  affection: /\b(love|cute|adorable|sweet|wholesome|best)\b/i,
  gifts: /\b(gift|present|teddy|bear|camera|toy)\b/i,
};

export interface ChatMessageLike {
  id: string;
  username: string;
  text: string;
  hidden?: boolean;
  flags?: string[];
}

export interface ChatSummary {
  themes: string[];
  messageCount: number;
  excerpts: { username: string; text: string }[];
}

/** Collect → moderate → theme → select → summarise. */
export function summarizeChat(messages: ChatMessageLike[], maxExcerpts = 3): ChatSummary | null {
  const usable = messages.filter((m) => !m.hidden && !(m.flags ?? []).includes('injection') && moderateMessage(m.text).ok);
  if (!usable.length) return null;
  const counts = new Map<string, number>();
  const themed: { m: ChatMessageLike; themes: string[] }[] = [];
  for (const m of usable) {
    const themes = Object.entries(THEMES).filter(([, r]) => r.test(m.text)).map(([k]) => k);
    for (const t of themes) counts.set(t, (counts.get(t) ?? 0) + 1);
    themed.push({ m, themes });
  }
  const themes = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k).slice(0, 4);
  // prefer messages that carry the dominant themes, one per user
  const seen = new Set<string>();
  const excerpts: { username: string; text: string }[] = [];
  for (const { m, themes: t } of themed.sort((a, b) => b.themes.length - a.themes.length)) {
    if (seen.has(m.username) || !t.length) continue;
    seen.add(m.username);
    excerpts.push({ username: sanitizeForPrompt(m.username).slice(0, 24), text: sanitizeForPrompt(m.text) });
    if (excerpts.length >= maxExcerpts) break;
  }
  return { themes, messageCount: usable.length, excerpts };
}
