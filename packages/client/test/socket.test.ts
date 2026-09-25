/**
 * The socket's offline queue: room messages wait for the connection, in-match intents
 * are dropped (replayed after a reconnect they would act on a turn that moved on).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientMessage } from '@gunbros/shared';
import { GameSocket } from '../src/net/socket.js';

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static last: FakeWebSocket | null = null;
  readyState = FakeWebSocket.CONNECTING;
  sent: ClientMessage[] = [];
  private listeners = new Map<string, (event: unknown) => void>();
  constructor() {
    FakeWebSocket.last = this;
  }
  addEventListener(type: string, fn: (event: unknown) => void): void {
    this.listeners.set(type, fn);
  }
  removeEventListener(): void {}
  send(data: string): void {
    this.sent.push(JSON.parse(data) as ClientMessage);
  }
  close(): void {}
  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.listeners.get('open')?.({});
  }
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal('window', {
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => undefined,
    localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeSocket(onSend?: (msg: ClientMessage) => void): GameSocket {
  return new GameSocket({
    nick: () => 'tester',
    onMessage: () => undefined,
    onStatus: () => undefined,
    url: 'ws://test/ws',
    onSend,
  });
}

describe('GameSocket offline queue', () => {
  it('drops in-match intents made while offline and keeps room messages', () => {
    const socket = makeSocket();
    socket.send({ t: 'move', dir: 1, seq: 1 } as ClientMessage);
    socket.send({ t: 'fire', seq: 1 } as unknown as ClientMessage);
    socket.send({ t: 'leaveRoom' });
    const ws = FakeWebSocket.last;
    expect(ws).not.toBeNull();
    ws?.open();
    expect(ws?.sent.map((m) => m.t)).toEqual(['hello', 'leaveRoom']);
  });

  it('keeps the latest room message when the queue overflows', () => {
    const socket = makeSocket();
    for (let i = 0; i < 100; i++) socket.send({ t: 'setReady', ready: i % 2 === 0 } as ClientMessage);
    socket.send({ t: 'leaveRoom' });
    FakeWebSocket.last?.open();
    const sent = FakeWebSocket.last?.sent ?? [];
    expect(sent[sent.length - 1]?.t).toBe('leaveRoom');
  });

  it('reports every send to onSend, queued or not', () => {
    const seen: string[] = [];
    const socket = makeSocket((m) => seen.push(m.t));
    socket.send({ t: 'aim', relAngle: 10 } as unknown as ClientMessage);
    socket.send({ t: 'leaveRoom' });
    expect(seen).toEqual(['aim', 'leaveRoom']);
  });
});
