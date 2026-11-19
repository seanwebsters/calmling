import type { Activity, AnimationId, LocationId } from './types';

/**
 * Renderer-agnostic animation state machine. The simulation decides *what*
 * happens (activities). This module decides which clip should be visible at a
 * given simulated moment, including intro/outro transitions, so every viewer —
 * and any future Unity/Godot/3D renderer — reconstructs the same pose from the
 * same state, even after joining late.
 */

export interface ClipDef {
  id: AnimationId;
  /** real-time playback length of one loop, ms */
  durationMs: number;
  loop: boolean;
  speed: number;
  interruptible: boolean;
  /** clip played before / after the main loop */
  intro?: AnimationId;
  outro?: AnimationId;
  /** sim minutes the intro / outro occupy at the edges of the activity */
  edgeMinutes?: number;
  props?: string[];
  locations?: LocationId[];
}

const c = (id: AnimationId, durationMs: number, extra: Partial<ClipDef> = {}): ClipDef => ({ id, durationMs, loop: true, speed: 1, interruptible: true, ...extra });

export const CLIPS: Record<AnimationId, ClipDef> = {
  idle: c('idle', 4000),
  breathing: c('breathing', 3200),
  blinking: c('blinking', 220, { loop: false }),
  looking_around: c('looking_around', 2600),
  walking: c('walking', 700, { speed: 1 }),
  sitting: c('sitting', 4000),
  sleeping: c('sleeping', 5000, { interruptible: false, intro: 'sitting', outro: 'waking_up', edgeMinutes: 2, props: ['bed'], locations: ['bedroom'] }),
  waking_up: c('waking_up', 2400, { loop: false, interruptible: false }),
  stretching: c('stretching', 2400, { interruptible: false }),
  picking_up: c('picking_up', 900, { loop: false, interruptible: false }),
  carrying: c('carrying', 700),
  inspecting: c('inspecting', 2200, { intro: 'react_curious', edgeMinutes: 1 }),
  react_happy: c('react_happy', 1200, { loop: false }),
  react_curious: c('react_curious', 1400, { loop: false }),
  react_surprised: c('react_surprised', 1100, { loop: false }),
  drinking_tea: c('drinking_tea', 3000, { props: ['cup'], intro: 'sitting', edgeMinutes: 1 }),
  eating: c('eating', 1600, { props: ['food'] }),
  gardening: c('gardening', 1800, { props: ['trowel'] }),
  watering: c('watering', 2000, { props: ['watering_can'] }),
  painting: c('painting', 2600, { props: ['easel', 'brush'] }),
  reading: c('reading', 4200, { props: ['book'], intro: 'sitting', edgeMinutes: 1 }),
  fishing: c('fishing', 3600, { props: ['fishing_rod'], locations: ['pond'] }),
  dancing: c('dancing', 900),
  watching_sunset: c('watching_sunset', 5000, { intro: 'sitting', edgeMinutes: 1 }),
  resting: c('resting', 4500, { intro: 'sitting', edgeMinutes: 1 }),
  hugging: c('hugging', 2000, { props: ['teddy'] }),
  playing: c('playing', 1200),
  photographing: c('photographing', 1800, { props: ['camera'] }),
  waving: c('waving', 900, { outro: 'react_happy', edgeMinutes: 0.5 }),
};

export interface AnimationCommand {
  entity_id: 'calmling';
  animation: AnimationId;
  stage: 'intro' | 'loop' | 'outro';
  target_id: string | null;
  /** 0..1 progress through the whole activity */
  progress: number;
  duration_ms: number;
  speed: number;
  interruptible: boolean;
  props: string[];
}

/** Which clip is visible at `minute` for the given activity. */
export function resolveAnimation(activity: Activity | null, minute: number, timeScale: number): AnimationCommand {
  if (!activity) {
    return { entity_id: 'calmling', animation: ambientAt(minute), stage: 'loop', target_id: null, progress: 0, duration_ms: 4000, speed: 1, interruptible: true, props: [] };
  }
  const clip = CLIPS[activity.animation] ?? CLIPS.idle;
  const total = Math.max(0.0001, activity.endsAt - activity.startedAt);
  const t = Math.min(total, Math.max(0, minute - activity.startedAt));
  const edge = clip.edgeMinutes ?? 0;
  let animation: AnimationId = clip.id;
  let stage: AnimationCommand['stage'] = 'loop';
  if (clip.intro && t < edge && total > edge * 3) {
    animation = clip.intro;
    stage = 'intro';
  } else if (clip.outro && total - t < edge && total > edge * 3) {
    animation = clip.outro;
    stage = 'outro';
  }
  return {
    entity_id: 'calmling',
    animation,
    stage,
    target_id: activity.targetId,
    progress: t / total,
    duration_ms: Math.round((total * 60_000) / Math.max(1, timeScale)),
    speed: clip.speed,
    interruptible: activity.interruptible && clip.interruptible,
    props: clip.props ?? [],
  };
}

/** Ambient behaviour between activities: deterministic from time, so all viewers agree. */
export function ambientAt(minute: number): AnimationId {
  const slot = Math.floor(minute * 2);
  const r = Math.abs(Math.sin(slot * 12.9898) * 43758.5453) % 1;
  if (r < 0.5) return 'breathing';
  if (r < 0.8) return 'looking_around';
  return 'idle';
}

/** Subtle micro-motions every renderer should layer on top of any clip. */
export const AMBIENT_LAYERS = {
  blinkEveryMs: [2600, 5200] as const,
  breatheCycleMs: 3200,
  postureShiftEveryMs: [7000, 14000] as const,
};
