/**
 * Holding a `turnEnd` until the local engine has played up to it (DESIGN §7 item 170).
 */
import { describe, expect, it } from 'vitest';
import type { ServerMessage } from '@gunbros/shared';
import { TurnEndHold } from '../src/net/turnEndHold.js';

function turnEnd(tick: number): ServerMessage {
  return { t: 'turnEnd', snapshot: { tick } } as unknown as ServerMessage;
}
const matchEnd = { t: 'matchEnd', winnerTeam: 'A', reason: 'eliminated' } as unknown as ServerMessage;
const chat = { t: 'chat', from: 'x', text: 'hi', ts: 0 } as unknown as ServerMessage;
const aimEcho = { t: 'aimEcho', seat: 0, relAngle: 10, tick: 120 } as unknown as ServerMessage;

describe('TurnEndHold', () => {
  it('holds a turnEnd the engine has not reached, and releases it on arrival there', () => {
    const hold = new TurnEndHold(180);
    expect(hold.offer(turnEnd(100), 70)).toBe(true);
    expect(hold.heldTick).toBe(100);
    expect(hold.release(99, 110)).toEqual([]);
    expect(hold.release(100, 110)).toEqual([turnEnd(100)]);
    expect(hold.heldTick).toBeNull();
  });

  it('applies a turnEnd at once when the engine is already there or past it', () => {
    const hold = new TurnEndHold(180);
    expect(hold.offer(turnEnd(100), 100)).toBe(false);
    expect(hold.offer(turnEnd(100), 104)).toBe(false);
    expect(hold.heldTick).toBeNull();
  });

  it('does not wait for an engine too far behind to be worth it', () => {
    const hold = new TurnEndHold(180);
    expect(hold.offer(turnEnd(500), 300)).toBe(false);
  });

  it('lets go once the engine falls too far behind while waiting', () => {
    const hold = new TurnEndHold(180);
    hold.offer(turnEnd(100), 70);
    expect(hold.release(80, 200)).toEqual([]);
    expect(hold.release(80, 261)).toEqual([turnEnd(100)]);
  });

  it('queues what arrives behind it, in order, but lets chat through', () => {
    const hold = new TurnEndHold(180);
    hold.offer(turnEnd(100), 70);
    expect(hold.offer(matchEnd, 72)).toBe(true);
    expect(hold.offer(chat, 72)).toBe(false);
    expect(hold.offer(aimEcho, 72)).toBe(true);
    expect(hold.release(100, 130)).toEqual([turnEnd(100), matchEnd, aimEcho]);
  });

  it('only a turnEnd starts a hold', () => {
    const hold = new TurnEndHold(180);
    expect(hold.offer(aimEcho, 0)).toBe(false);
    expect(hold.offer(matchEnd, 0)).toBe(false);
  });

  it('drops the held shot when a resync replaces the state', () => {
    const hold = new TurnEndHold(180);
    hold.offer(turnEnd(100), 70);
    const resync = { t: 'resync', snapshot: { tick: 400 } } as unknown as ServerMessage;
    expect(hold.offer(resync, 70)).toBe(false);
    expect(hold.heldTick).toBeNull();
  });
});
