import { describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import { Connection } from '../src/connection.js';
import { config } from '../src/config.js';

function fakeSocket(bufferedAmount: number) {
  const sent: string[] = [];
  let terminated = false;
  const socket = {
    readyState: 1,
    bufferedAmount,
    send: (data: string) => sent.push(data),
    terminate: () => {
      terminated = true;
    },
    close: () => {},
  };
  return { socket, sent, isTerminated: () => terminated };
}

describe('Connection.send', () => {
  it('sends while the client keeps up', () => {
    const f = fakeSocket(0);
    const conn = new Connection(f.socket as unknown as WebSocket);
    conn.send({ t: 'error', code: 'x', message: 'y' });
    expect(f.sent).toHaveLength(1);
    expect(f.isTerminated()).toBe(false);
  });

  it('drops a socket that stopped reading instead of buffering without limit', () => {
    const f = fakeSocket(config.maxBufferedBytes + 1);
    const conn = new Connection(f.socket as unknown as WebSocket);
    conn.send({ t: 'error', code: 'x', message: 'y' });
    expect(f.sent).toHaveLength(0);
    expect(f.isTerminated()).toBe(true);
  });
});
