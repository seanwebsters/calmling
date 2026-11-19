import { LLM_JSON_SCHEMA, buildDiaryPrompt, buildDecisionPrompt, parseLlmDecision, type Candidate, type DiaryFact, type Memory, type Proposal, type SimState } from '@calmling/core';
import type { Config } from './config';
import type { Db } from './db';

export interface BrainStatus {
  mode: 'llm' | 'deterministic';
  label: string;
  model: string | null;
  reason: string;
  callsLastHour: number;
  spentTodayUsd: number;
  lastError: string | null;
}

/**
 * OpenAI-backed decision maker with cost controls. When no key is configured
 * (or the budget is exhausted, or the API fails) the deterministic utility
 * brain in @calmling/core is used instead, so Calmling keeps living.
 */
export class LlmClient {
  private calls: number[] = [];
  private lastCallAt = 0;
  private spentToday = 0;
  private spentDay = new Date().toISOString().slice(0, 10);
  lastError: string | null = null;
  consecutiveFailures = 0;
  private disabledUntil = 0;

  constructor(private cfg: Config['openai'], private db: Db) {}

  get enabled() {
    return !!this.cfg.apiKey;
  }

  async init() {
    const r = await this.db.query<{ total: number | string | null }>("select coalesce(sum(cost_usd),0) as total from api_usage where created_at >= date_trunc('day', now())");
    this.spentToday = Number(r.rows[0]?.total ?? 0);
  }

  status(): BrainStatus {
    const hourAgo = Date.now() - 3600_000;
    this.calls = this.calls.filter((t) => t > hourAgo);
    if (!this.enabled)
      return { mode: 'deterministic', label: 'Deterministic utility brain (no LLM configured)', model: null, reason: 'OPENAI_API_KEY is not set — decisions come from the built-in utility AI.', callsLastHour: 0, spentTodayUsd: 0, lastError: null };
    const reason = this.blockedReason();
    return {
      mode: 'llm',
      label: reason ? 'LLM configured — temporarily using deterministic fallback' : 'LLM decision-making',
      model: this.cfg.model,
      reason: reason ?? 'OpenAI proposes actions; the simulation validates them.',
      callsLastHour: this.calls.length,
      spentTodayUsd: Math.round(this.spentToday * 10000) / 10000,
      lastError: this.lastError,
    };
  }

  private blockedReason(): string | null {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.spentDay) {
      this.spentDay = today;
      this.spentToday = 0;
    }
    if (Date.now() < this.disabledUntil) return 'backing off after API errors';
    if (this.spentToday >= this.cfg.dailyBudgetUsd) return `daily budget of $${this.cfg.dailyBudgetUsd} reached`;
    const hourAgo = Date.now() - 3600_000;
    this.calls = this.calls.filter((t) => t > hourAgo);
    if (this.calls.length >= this.cfg.maxCallsPerHour) return 'hourly call limit reached';
    return null;
  }

  canDecide(): boolean {
    return this.enabled && !this.blockedReason() && Date.now() - this.lastCallAt >= this.cfg.minIntervalSec * 1000;
  }

  private async chat(purpose: string, model: string, system: string, user: string, schema: unknown | null): Promise<string> {
    this.calls.push(Date.now());
    this.lastCallAt = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs);
    try {
      const res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.cfg.apiKey}` },
        body: JSON.stringify({
          model,
          temperature: 0.8,
          max_tokens: 400,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          response_format: schema ? { type: 'json_schema', json_schema: schema } : { type: 'json_object' },
        }),
      });
      if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = (await res.json()) as { choices: { message: { content: string } }[]; usage?: { prompt_tokens: number; completion_tokens: number } };
      const inT = data.usage?.prompt_tokens ?? 0;
      const outT = data.usage?.completion_tokens ?? 0;
      const cost = (inT * this.cfg.inputPricePerM + outT * this.cfg.outputPricePerM) / 1_000_000;
      this.spentToday += cost;
      this.consecutiveFailures = 0;
      this.lastError = null;
      await this.db.query('insert into api_usage (provider, model, purpose, input_tokens, output_tokens, cost_usd, ok) values ($1,$2,$3,$4,$5,$6,true)', ['openai', model, purpose, inT, outT, cost]);
      return data.choices?.[0]?.message?.content ?? '';
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.lastError = msg;
      this.consecutiveFailures++;
      // exponential back-off: 30s, 60s, 120s … max 30 min
      this.disabledUntil = Date.now() + Math.min(1_800_000, 30_000 * 2 ** (this.consecutiveFailures - 1));
      await this.db.query('insert into api_usage (provider, model, purpose, ok, error) values ($1,$2,$3,false,$4)', ['openai', model, purpose, msg.slice(0, 500)]).catch(() => {});
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Ask the model to choose among validated candidates. Returns null on any problem. */
  async decide(state: SimState, candidates: Candidate[], memories: Memory[]): Promise<Proposal | null> {
    const prompt = buildDecisionPrompt(state, candidates, memories);
    try {
      const raw = await this.chat('decision', this.cfg.model, prompt.system, prompt.user, LLM_JSON_SCHEMA);
      return parseLlmDecision(raw, candidates);
    } catch {
      return null;
    }
  }

  async diary(day: number, facts: DiaryFact[]): Promise<{ title: string; body: string } | null> {
    if (!this.enabled || this.blockedReason()) return null;
    const p = buildDiaryPrompt(day, facts);
    try {
      const raw = await this.chat('diary', this.cfg.diaryModel, p.system, p.user, null);
      const parsed = JSON.parse(raw) as { title?: unknown; body?: unknown };
      if (typeof parsed.title !== 'string' || typeof parsed.body !== 'string' || parsed.body.length < 20) return null;
      return { title: parsed.title.slice(0, 120), body: parsed.body.slice(0, 2000) };
    } catch {
      return null;
    }
  }
}
