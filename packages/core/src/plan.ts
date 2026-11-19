import { ACTIONS, type ActionDef } from './actions';
import type { LocationId, PlanStep, SimState, WorldObject } from './types';
import { LOCATIONS, OBJECT_KINDS, locationAt, locationCenter, phaseOf } from './world';

/** What a brain (LLM or deterministic) may propose. It is only a proposal. */
export interface Proposal {
  goal?: string;
  action: string;
  targetId: string | null;
  reason: string;
  thought?: string;
}

export type Validation =
  | { ok: true; steps: PlanStep[]; target: WorldObject | null; tool: WorldObject | null }
  | { ok: false; reason: string };

function available(o: WorldObject): boolean {
  return o.discovered && (o.heldBy === null || o.heldBy === 'calmling');
}

/** Find the most convenient object with a tool tag: held first, then here, then nearest. */
export function findTool(s: SimState, tag: string): WorldObject | null {
  const c = s.character;
  let best: WorldObject | null = null;
  let bestD = Infinity;
  for (const o of Object.values(s.objects)) {
    if (!o.tags.includes(tag) || !available(o)) continue;
    if (o.state.planted) continue;
    const d = o.heldBy === 'calmling' ? -1 : Math.abs(o.x - c.x);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

export function targetMatches(def: ActionDef, o: WorldObject, s: SimState): boolean {
  if (!def.targetTags) return false;
  if (!available(o)) return false;
  if (!def.targetTags.some((t) => o.tags.includes(t))) return false;
  if (def.targetFilter && !def.targetFilter(o, s)) return false;
  return true;
}

function standX(o: WorldObject): number {
  // stand beside objects, never on top of them
  const loc = LOCATIONS[o.location];
  const x = o.x - 14;
  return Math.max(loc.x0 + 4, Math.min(loc.x1 - 4, x));
}

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

/** Where a kept object goes. Cuddly things go beside the bed; the rest on the shelf. */
export function keepDestination(o: WorldObject): { location: LocationId; x: number } {
  if (o.tags.includes('cuddle') || o.tags.includes('plant')) return { location: 'bedroom', x: 640 + Math.round(hash(o.id) * 60) };
  return { location: 'home', x: 515 + Math.round(hash(o.id) * 60) };
}

/**
 * Deterministic validation + planning. Checks that the proposed action is
 * permitted right now, that the target exists and is reachable, that tools are
 * available and that Calmling has the energy. Returns a concrete step plan.
 */
export function validateProposal(s: SimState, p: Proposal): Validation {
  const def = ACTIONS[p.action];
  if (!def) return { ok: false, reason: `unknown action "${p.action}"` };
  if (def.internal) return { ok: false, reason: `"${p.action}" cannot be chosen directly` };
  const c = s.character;
  if (!c.awake) return { ok: false, reason: 'Calmling is asleep' };
  if (def.minEnergy && c.needs.energy < def.minEnergy) return { ok: false, reason: `not enough energy (${Math.round(c.needs.energy)} < ${def.minEnergy})` };
  const phase = phaseOf(s.minute);
  if (def.phases && !def.phases.includes(phase)) return { ok: false, reason: `not permitted during the ${phase}` };
  if (p.action === 'sleep' && phase !== 'night' && c.needs.energy > (phase === 'evening' ? 65 : 25)) return { ok: false, reason: 'not tired enough to sleep' };
  if (p.action === 'notice_audience' && !s.observations.some((o) => !o.consumed)) return { ok: false, reason: 'nothing from the audience to notice' };

  let target: WorldObject | null = null;
  if (def.targetTags) {
    if (!p.targetId) return { ok: false, reason: 'a target is required' };
    target = s.objects[p.targetId] ?? null;
    if (!target) return { ok: false, reason: `target ${p.targetId} does not exist` };
    if (!target.discovered) return { ok: false, reason: `Calmling has not noticed ${p.targetId} yet` };
    if (!targetMatches(def, target, s)) return { ok: false, reason: `${target.name} is not suitable for ${def.label}` };
  } else if (p.targetId) {
    // optional context targets are ignored rather than trusted
    target = null;
  }

  let tool: WorldObject | null = null;
  if (def.tool) {
    tool = findTool(s, def.tool);
    if (!tool) return { ok: false, reason: `no ${def.tool.replace('_', ' ')} available` };
    if (def.toolHeld && tool.heldBy !== 'calmling' && !(OBJECT_PORTABLE(tool))) return { ok: false, reason: `${tool.name} cannot be carried` };
  }

  const steps: PlanStep[] = [];
  let posX = c.x;
  let posLoc = c.location;
  let held = c.heldObjectId;
  const walkTo = (x: number) => {
    if (Math.abs(x - posX) > 6) {
      steps.push({ action: 'walk', targetId: null, location: locationAt(x), x });
      posX = x;
      posLoc = locationAt(x);
    }
  };
  const pickUp = (o: WorldObject) => {
    if (held && held !== o.id) {
      steps.push({ action: 'put_down', targetId: held, location: posLoc });
      held = null;
    }
    walkTo(standX(o));
    steps.push({ action: 'pick_up', targetId: o.id, location: o.location });
    held = o.id;
  };

  if (p.action === 'keep_object' && target) {
    if (held !== target.id) pickUp(target);
    const dest = keepDestination(target);
    walkTo(dest.x);
    steps.push({ action: 'keep_object', targetId: target.id, location: dest.location });
    return { ok: true, steps, target, tool };
  }

  if (tool && def.toolHeld && held !== tool.id) pickUp(tool);
  // put things down before settling in for the night
  if (p.action === 'sleep' && held && (!tool || held !== tool.id)) {
    steps.push({ action: 'put_down', targetId: held, location: posLoc });
    held = null;
  }

  // where does the action happen?
  if (def.at === 'target' && target) {
    if (target.heldBy !== 'calmling') walkTo(standX(target));
  } else if (tool && !def.toolHeld && tool.heldBy !== 'calmling') {
    walkTo(standX(tool));
  } else if (Array.isArray(def.at)) {
    if (!def.at.includes(posLoc)) {
      const nearest = [...def.at].sort((a, b) => Math.abs(locationCenter(a) - posX) - Math.abs(locationCenter(b) - posX))[0];
      walkTo(locationCenter(nearest));
    } else if (p.action === 'explore' || p.action === 'wander') {
      // move to a fresh spot inside the location
      const l = LOCATIONS[posLoc];
      const span = l.x1 - l.x0;
      walkTo(Math.round(l.x0 + span * (0.2 + 0.6 * hash(`${s.minute}:${p.action}`))));
    }
  }
  steps.push({ action: p.action, targetId: target?.id ?? tool?.id ?? null, location: posLoc });
  return { ok: true, steps, target, tool };
}

function OBJECT_PORTABLE(o: WorldObject): boolean {
  return OBJECT_KINDS[o.kind]?.portable ?? false;
}
