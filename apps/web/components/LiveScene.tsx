'use client';

import { resolveAnimation } from '@calmling/core';
import { useEffect, useRef, useState } from 'react';
import { liveCharacterX, liveMinute, useLive } from '@/lib/live';
import type { AssetManifest, CalmlingRenderer, RenderInputs } from '@/game/types';

/** Mounts the renderer. The renderer pulls the authoritative shared state every frame. */
export function LiveScene({ className = '' }: { className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const hasFrame = useLive((s) => !!s.frame);

  useEffect(() => {
    let renderer: CalmlingRenderer | null = null;
    let cancelled = false;
    (async () => {
      try {
        const manifest = (await fetch('/assets/manifest.json').then((r) => r.json())) as AssetManifest;
        const { PhaserRenderer } = await import('@/game/phaser-renderer');
        if (cancelled || !host.current) return;
        renderer = new PhaserRenderer(manifest);
        const read = (): RenderInputs | null => {
          const st = useLive.getState();
          if (!st.frame) return null;
          const minute = liveMinute();
          return { frame: st.frame, objects: st.objects, minute, characterX: liveCharacterX(), animation: resolveAnimation(st.frame.character.activity, minute, st.timeScale) };
        };
        await renderer.mount(host.current, read);
      } catch (e) {
        setFailed(e instanceof Error ? e.message : 'renderer failed');
      }
    })();
    return () => {
      cancelled = true;
      renderer?.destroy();
    };
  }, []);

  return (
    <div className={`relative overflow-hidden bg-[#f6efe0] ${className}`}>
      <div ref={host} className="absolute inset-0 [&_canvas]:!h-full [&_canvas]:!w-full [&_canvas]:object-cover" data-testid="live-scene" />
      {!hasFrame && !failed && (
        <div className="absolute inset-0 grid place-items-center text-ink-soft">
          <div className="flex flex-col items-center gap-3">
            <div className="size-10 animate-spin rounded-full border-2 border-calm/30 border-t-calm" />
            <p className="text-sm">Finding Calmling…</p>
          </div>
        </div>
      )}
      {failed && <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-ink-soft">The live scene could not start ({failed}). The simulation is still running — try reloading.</div>}
    </div>
  );
}
