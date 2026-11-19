'use client';

import { characterXAt, type ChatMessageDTO, type Highlight, type PublicFrame, type ServerMessage, type SimEvent, type WorldObject } from '@calmling/core';
import { create } from 'zustand';

export type ConnState = 'connecting' | 'live' | 'reconnecting' | 'offline';
type FrameCore = Omit<PublicFrame, 'objects'>;

interface LiveStore {
  conn: ConnState;
  frame: FrameCore | null;
  objects: Record<string, WorldObject>;
  receivedAt: number;
  timeScale: number;
  tickMs: number;
  events: SimEvent[];
  chat: ChatMessageDTO[];
  viewers: number;
  highlights: Highlight[];
  setConn(c: ConnState): void;
  apply(msg: ServerMessage): 'ok' | 'gap';
  setChat(m: ChatMessageDTO[]): void;
}

const EVENT_TYPES_SHOWN = new Set([
  'object_discovered', 'first_time', 'habit_formed', 'habit_faded', 'gift_arrived', 'goal_completed', 'poll_outcome', 'plant_bloomed',
  'audience_noticed', 'object_created', 'trait_shift', 'activity_completed', 'weather_changed', 'object_placed', 'activity_failed', 'day_started', 'simulation_started',
]);

function keepEvents(prev: SimEvent[], incoming: SimEvent[]): SimEvent[] {
  const seen = new Set(prev.map((e) => e.id));
  const add = incoming.filter((e) => !seen.has(e.id) && EVENT_TYPES_SHOWN.has(e.type) && !(e.type === 'activity_completed' && ['wake_up', 'notice', 'pause'].includes(e.action ?? '')));
  return [...prev, ...add].slice(-80);
}

export const useLive = create<LiveStore>((set, get) => ({
  conn: 'connecting',
  frame: null,
  objects: {},
  receivedAt: 0,
  timeScale: 30,
  tickMs: 1000,
  events: [],
  chat: [],
  viewers: 0,
  highlights: [],
  setConn: (conn) => set({ conn }),
  setChat: (chat) => set({ chat }),
  apply(msg) {
    const now = Date.now();
    switch (msg.type) {
      case 'hello':
      case 'snapshot': {
        const { objects, ...frame } = msg.frame;
        set({
          frame,
          objects: Object.fromEntries(objects.map((o) => [o.id, o])),
          receivedAt: now,
          timeScale: msg.timeScale,
          ...(msg.type === 'hello' ? { tickMs: msg.tickMs, events: keepEvents([], msg.recentEvents) } : {}),
        });
        return 'ok';
      }
      case 'delta': {
        const cur = get().frame;
        if (cur && msg.prevSeq !== cur.seq) return 'gap';
        const objects = { ...get().objects };
        for (const o of msg.changedObjects) objects[o.id] = o;
        for (const id of msg.removedObjectIds) delete objects[id];
        set({ frame: msg.frame, objects, receivedAt: now, timeScale: msg.timeScale, events: keepEvents(get().events, msg.events) });
        return 'ok';
      }
      case 'chat': {
        if (get().chat.some((m) => m.id === msg.message.id)) return 'ok';
        set({ chat: [...get().chat, msg.message].slice(-150) });
        return 'ok';
      }
      case 'chat_update': {
        set({ chat: get().chat.map((m) => (m.id === msg.id ? { ...m, ...(msg.hidden !== undefined ? { hidden: msg.hidden } : {}), ...(msg.reactions ? { reactions: msg.reactions } : {}) } : m)).filter((m) => !m.hidden) });
        return 'ok';
      }
      case 'viewers':
        set({ viewers: msg.count });
        return 'ok';
      case 'highlight':
        set({ highlights: [msg.highlight, ...get().highlights].slice(0, 20) });
        return 'ok';
      default:
        return 'ok';
    }
  },
}));

/** Simulated minute "now", extrapolated between server ticks so motion is smooth. */
export function liveMinute(): number {
  const { frame, receivedAt, timeScale, tickMs } = useLive.getState();
  if (!frame) return 0;
  if (frame.paused) return frame.minute;
  const elapsed = Math.min(Date.now() - receivedAt, tickMs * 3);
  return frame.minute + (elapsed / 1000) * (timeScale / 60);
}

export function liveCharacterX(): number {
  const { frame } = useLive.getState();
  if (!frame) return 500;
  return characterXAt({ ...frame, objects: [] }, liveMinute());
}

let socket: WebSocket | null = null;
let refs = 0;
let retry = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function wsUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_WS_URL;
  if (explicit) return explicit;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.hostname}:4000/ws`;
}

function connect() {
  retryTimer = null;
  const store = useLive.getState();
  store.setConn(retry ? 'reconnecting' : 'connecting');
  const ws = new WebSocket(wsUrl());
  socket = ws;
  ws.onopen = () => {
    retry = 0;
    useLive.getState().setConn('live');
  };
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data as string) as ServerMessage;
      if (useLive.getState().apply(msg) === 'gap') ws.send(JSON.stringify({ type: 'resync' }));
    } catch {
      /* ignore malformed */
    }
  };
  ws.onclose = () => {
    if (socket !== ws) return;
    socket = null;
    if (refs <= 0) return;
    retry++;
    useLive.getState().setConn(retry > 6 ? 'offline' : 'reconnecting');
    // exponential back-off with jitter; late-join sync happens via the hello snapshot
    const delay = Math.min(15000, 500 * 2 ** Math.min(retry, 5)) * (0.75 + Math.random() * 0.5);
    retryTimer = setTimeout(connect, delay);
  };
  ws.onerror = () => ws.close();
}

/** Subscribe a component to the shared live stream (one socket per tab). */
export function retainLive(): () => void {
  refs++;
  if (!socket && !retryTimer) connect();
  return () => {
    refs--;
    if (refs <= 0) {
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      socket?.close();
      socket = null;
    }
  };
}

export function reconnectNow() {
  retry = 0;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  socket?.close();
  if (!socket) connect();
}
