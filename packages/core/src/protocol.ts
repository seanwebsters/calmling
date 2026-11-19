import type { Highlight, Memory, PublicFrame, SimEvent, WorldObject } from './types';

/** Wire protocol between the simulation service and every viewer. */
export type ServerMessage =
  | { type: 'hello'; serverTime: number; timeScale: number; tickMs: number; frame: PublicFrame; recentEvents: SimEvent[] }
  | { type: 'snapshot'; serverTime: number; timeScale: number; frame: PublicFrame }
  | {
      type: 'delta';
      serverTime: number;
      seq: number;
      prevSeq: number;
      tick: number;
      minute: number;
      timeScale: number;
      frame: Omit<PublicFrame, 'objects'>;
      changedObjects: WorldObject[];
      removedObjectIds: string[];
      events: SimEvent[];
    }
  | { type: 'chat'; message: ChatMessageDTO }
  | { type: 'chat_update'; id: string; hidden?: boolean; reactions?: Record<string, number> }
  | { type: 'community'; kind: 'goal' | 'poll' | 'gift'; id: string }
  | { type: 'memory'; memory: Memory }
  | { type: 'highlight'; highlight: Highlight }
  | { type: 'viewers'; count: number };

export type ClientMessage = { type: 'resync' } | { type: 'ping' };

export interface ChatMessageDTO {
  id: string;
  userId: string;
  username: string;
  text: string;
  createdAt: string;
  reactions: Record<string, number>;
  hidden: boolean;
}
