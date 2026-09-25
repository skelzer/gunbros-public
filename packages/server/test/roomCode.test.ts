import { describe, expect, it } from 'vitest';
import { CODE_ALPHABET, generateRoomCode } from '../src/rooms.js';
import { config } from '../src/config.js';

describe('room codes', () => {
  it('is five unambiguous characters by default', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode();
      expect(code).toHaveLength(config.roomCodeLength);
      expect(code).toMatch(/^[A-Z2-9]+$/);
    }
  });

  it('never uses 0, O, 1 or I', () => {
    expect(CODE_ALPHABET).not.toMatch(/[01OI]/);
    const codes = Array.from({ length: 2000 }, () => generateRoomCode());
    expect(codes.join('')).not.toMatch(/[01OI]/);
  });

  it('uses the whole alphabet', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) for (const ch of generateRoomCode()) seen.add(ch);
    expect(seen.size).toBe(CODE_ALPHABET.length);
  });

  it('collides rarely enough to be worth retrying rather than counting', () => {
    // 32^5 = 33.5 M codes; 5000 draws should essentially never repeat.
    const codes = new Set(Array.from({ length: 5000 }, () => generateRoomCode()));
    expect(codes.size).toBeGreaterThan(4990);
  });

  it('honours an explicit length', () => {
    expect(generateRoomCode(8)).toHaveLength(8);
  });
});
