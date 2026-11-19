import type { AnimationCommand, PublicFrame, WorldObject } from '@calmling/core';

/**
 * Renderer abstraction. The simulation never depends on a renderer. Any
 * implementation (this Phaser 2D prototype, a future Unity/Godot WebGL build,
 * or a headless broadcast renderer) consumes the same inputs:
 *   - the public frame (authoritative world + character state)
 *   - animation commands resolved by the shared state machine in @calmling/core
 */
export interface RenderInputs {
  frame: Omit<PublicFrame, 'objects'>;
  objects: Record<string, WorldObject>;
  minute: number;
  characterX: number;
  animation: AnimationCommand;
}

export interface CalmlingRenderer {
  mount(el: HTMLElement, read: () => RenderInputs | null): Promise<void>;
  destroy(): void;
}

export interface SpriteAnimationAsset {
  url: string;
  frameWidth: number;
  frameHeight: number;
  frames: number;
  frameRate: number;
  loop?: boolean;
}

export interface AssetManifest {
  version: number;
  character: {
    placeholder: boolean;
    label: string;
    scale: number;
    anchor: { x: number; y: number };
    /** a single still of the official character; the renderer animates it procedurally (squash, tilt, bob, blinks) */
    image?: {
      url: string;
      width: number;
      height: number;
      /** height in scene units before the global character scale */
      displayHeight: number;
      furColor: string;
      lidColor: string;
      /** eye centres/radii in image pixels, used to draw blinking eyelids */
      eyes: { x: number; y: number; rx: number; ry: number }[];
    };
    /** keyed by AnimationId from @calmling/core; missing clips fall back to the procedural placeholder */
    animations: Record<string, SpriteAnimationAsset>;
  };
  /** keyed by object kind, e.g. "teddy_bear": { url } */
  objects: Record<string, { url: string; width?: number; height?: number }>;
  environment: Record<string, { url: string }>;
}
