/**
 * The Phase 4 extension points, tested where they are *used* rather than where they are
 * declared: the seventeen mobiles are written against these, four agents at a time, so
 * each one gets a test here that fails loudly if the plumbing moves.
 *
 * Covered: `ProjectileDef.defenceDebuff` (stack, cap, decay), `shieldDamageMultiplier`,
 * `BehaviourContext.beamStrike`, `mark` → `onTurnEffect`, `applyImpulse` and the
 * airborne `vx`, `registerTurnHook`, and mines in the hash and the snapshot.
 */
import { describe, expect, it } from 'vitest';
import { applyIntent, createMatch, step } from '../src/match/reducer.js';
import { isSettled, mobileOfSeat } from '../src/match/match.js';
import type { MatchState, SeatSpec } from '../src/match/match.js';
import { applySnapshot, hashState, takeSnapshot } from '../src/match/snapshot.js';
import { applyDamage } from '../src/rules/damage.js';
import { registerTurnHook } from '../src/rules/turn.js';
import { thorStrike } from '../src/rules/sky.js';
import { constants } from '../src/data/constants.js';
import { mage } from '../src/data/mobiles/mage.js';
import type { ShotDef } from '../src/data/mobiles/index.js';
import { registerBehaviour } from '../src/entities/behaviours/index.js';
import type { Behaviour, BehaviourContext, TurnEffect } from '../src/entities/behaviours/index.js';
import { createMine } from '../src/entities/mines.js';
import { createMobile } from '../src/entities/mobile.js';
import { armor } from '../src/data/mobiles/index.js';
import { flatTestMap } from './helpers.js';
import { createDuel, eventsOfType, hpOf } from './mobiles/helpers.js';

const seats: SeatSpec[] = [
  { playerId: 'p1', nick: 'one', team: 'A', mobileId: 'armor' },
  { playerId: 'p2', nick: 'two', team: 'B', mobileId: 'armor' },
];

/**
 * Swap mage's S1 for a test shot, run `body`, put it back. Mutating a def is how the
 * existing reducer tests reach the fire path; mage is a Phase 4 stub, so nothing else
 * in the suite depends on its numbers.
 */
function withMageShot(shot: ShotDef, body: () => void): void {
  const original = mage.shots.s1;
  (mage.shots as { s1: ShotDef }).s1 = shot;
  try {
    body();
  } finally {
    (mage.shots as { s1: ShotDef }).s1 = original;
  }
}

/** A shot that hits seat 1 on the flat duel arena (600 vs 1000, no wind). */
function hittingShot(overrides: Partial<ShotDef['projectile']> = {}): ShotDef {
  return {
    displayName: 'Test',
    delay: 250,
    projectile: { ...armor.shots.s1.projectile, ...overrides },
  };
}

const HIT_ANGLE = 45;
const HIT_POWER = 0.54;

describe('ProjectileDef.defenceDebuff', () => {
  it('stacks on the mobiles it damages and is capped', () => {
    withMageShot(hittingShot({ defenceDebuff: 0.5, damage: 10 }), () => {
      const state = createDuel('mage', 'armor', 7);
      const target = mobileOfSeat(state, 1);
      if (!target) throw new Error('no target');
      expect(target.defenceMod).toBe(0);

      applyIntent(state, { t: 'aim', seat: 0, relAngle: HIT_ANGLE });
      applyIntent(state, {
        t: 'fire',
        seat: 0,
        shot: 's1',
        relAngle: HIT_ANGLE,
        power: HIT_POWER,
      });
      for (let i = 0; i < 400 && !isSettled(state); i++) step(state);
      expect(target.defenceMod).toBeCloseTo(0.5, 6);

      applyIntent(state, {
        t: 'fire',
        seat: 0,
        shot: 's1',
        relAngle: HIT_ANGLE,
        power: HIT_POWER,
      });
      for (let i = 0; i < 400 && !isSettled(state); i++) step(state);
      // 1.0 would be the raw stack; the cap is what the target actually carries.
      expect(target.defenceMod).toBe(constants.debuff.max);
    });
  });

  it('multiplies incoming damage by (1 + defenceMod)', () => {
    const plain = createDuel('armor', 'armor', 7);
    const chilled = createDuel('armor', 'armor', 7);
    const target = mobileOfSeat(chilled, 1);
    if (!target) throw new Error('no target');
    target.defenceMod = 0.5;

    for (const state of [plain, chilled]) {
      applyIntent(state, { t: 'aim', seat: 0, relAngle: HIT_ANGLE });
      applyIntent(state, {
        t: 'fire',
        seat: 0,
        shot: 's1',
        relAngle: HIT_ANGLE,
        power: HIT_POWER,
      });
      for (let i = 0; i < 400 && !isSettled(state); i++) step(state);
    }
    const plainLost = armor.hp - hpOf(plain, 1);
    const chilledLost = armor.hp - hpOf(chilled, 1);
    expect(plainLost).toBeGreaterThan(0);
    expect(chilledLost).toBeCloseTo(plainLost * 1.5, 4);
  });

  it('thaws by constants.debuff.decayPerTurn at the victim\'s own turn start', () => {
    const state = createMatch(11, flatTestMap(), seats, { mode: 'turns' });
    step(state); // opens turn 1
    const victim = mobileOfSeat(state, 1);
    if (!victim) throw new Error('no victim');
    victim.defenceMod = 0.2;

    // Seat 0 gives its turn up; seat 1's turn then begins, and the decay runs there.
    let opened = false;
    for (let i = 0; i < 600 && !opened; i++) {
      if (state.phase === 'active' && state.activeSeat === 0) {
        applyIntent(state, { t: 'skip', seat: 0 });
      }
      for (const e of step(state)) {
        if (e.t === 'turnStart' && e.seat === 1) opened = true;
      }
    }
    expect(opened).toBe(true);
    expect(victim.defenceMod).toBeCloseTo(0.2 - constants.debuff.decayPerTurn, 6);
  });
});

describe('ProjectileDef.shieldDamageMultiplier', () => {
  it('drains the shield faster without changing what reaches hp', () => {
    const shielded = () => {
      const m = createMobile(0, 'armor', 'A', armor, 0, 0, 1);
      m.shield = 200;
      return m;
    };
    const plain = shielded();
    const broken = shielded();

    expect(applyDamage(plain, 100).shieldAbsorbed).toBe(100);
    expect(plain.shield).toBe(100);
    expect(plain.hp).toBe(armor.hp);

    // x2.5 against the shield: 100 damage strips 250, so the 200 left are gone and
    // the 20 points of raw damage that were not spent on it reach hp.
    const applied = applyDamage(broken, 100, 2.5);
    expect(applied.shieldAbsorbed).toBe(200);
    expect(broken.shield).toBe(0);
    expect(applied.hpLost).toBeCloseTo(20, 6);
  });
});

describe('BehaviourContext.beamStrike', () => {
  it('carves a column, emits a beam and damages what stands in it', () => {
    let fired = false;
    const behaviour: Behaviour = {
      onSpawn: (p, ctx) => {
        if (fired) return;
        fired = true;
        const target = ctx.mobiles[1];
        if (!target) return;
        ctx.beamStrike(target.x, target.y, 0, 14, { ...p.def, damage: 300 }, p.ownerSeat);
        p.alive = false;
      },
    };
    registerBehaviour('testBeam', behaviour);

    withMageShot(hittingShot({ behaviour: 'testBeam', sprite: 'testBolt' }), () => {
      const state = createDuel('mage', 'armor', 3);
      const hpBefore = hpOf(state, 1);
      const solidBefore = state.terrain.mask.reduce((n, v) => n + v, 0);
      const events: ReturnType<typeof step> = [];
      for (const e of applyIntent(state, {
        t: 'fire',
        seat: 0,
        shot: 's1',
        relAngle: 45,
        power: 0.5,
      })) {
        events.push(e);
      }
      for (let i = 0; i < 10 && !isSettled(state); i++) for (const e of step(state)) events.push(e);

      const beams = eventsOfType(events, 'beam');
      expect(beams).toHaveLength(1);
      const beam = beams[0];
      if (!beam) throw new Error('no beam');
      expect(beam.x1).toBe(beam.x2);
      expect(beam.y1).toBe(0);
      expect(beam.width).toBe(14);
      expect(beam.kind).toBe('testBolt');
      expect(state.terrain.mask.reduce((n, v) => n + v, 0)).toBeLessThan(solidBefore);
      expect(hpOf(state, 1)).toBeLessThan(hpBefore);
    });
  });

  it('is what thorStrike calls, at the level-1 default (DESIGN §7 item 9)', () => {
    const calls: Array<{ x: number; width: number; damage: number }> = [];
    const ctx = {
      activeSeat: 0,
      beamStrike: (x: number, _y: number, _fromY: number, width: number, def: { damage: number }) => {
        calls.push({ x, width, damage: def.damage });
      },
    } as unknown as BehaviourContext;
    thorStrike(ctx, 120, 400);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.x).toBe(120);
    expect(calls[0]?.damage).toBeGreaterThan(0);
  });
});

describe('BehaviourContext.mark and the onTurnEffect hook', () => {
  it('schedules an effect that calls the behaviour back with its payload', () => {
    const seen: TurnEffect[] = [];
    registerBehaviour('testMark', {
      onSpawn: (p, ctx) => {
        ctx.mark(p.x, p.y, 5, { behaviour: 'testMark', kind: 'testBolt', data: { bolts: 3 } });
        p.alive = false;
      },
      onTurnEffect: (effect) => {
        seen.push(effect);
      },
    });

    withMageShot(hittingShot({ behaviour: 'testMark' }), () => {
      const state = createDuel('mage', 'armor', 5);
      const events: ReturnType<typeof step> = [];
      for (const e of applyIntent(state, {
        t: 'fire',
        seat: 0,
        shot: 's1',
        relAngle: 45,
        power: 0.5,
      })) {
        events.push(e);
      }
      expect(state.turnEffects).toHaveLength(1);
      for (let i = 0; i < 12; i++) for (const e of step(state)) events.push(e);

      const marks = eventsOfType(events, 'mark');
      expect(marks).toHaveLength(1);
      expect(marks[0]?.kind).toBe('testBolt');
      expect(marks[0]?.ticksUntil).toBe(5);

      expect(seen).toHaveLength(1);
      expect(seen[0]?.kind).toBe('testBolt');
      expect(seen[0]?.behaviour).toBe('testMark');
      expect(seen[0]?.data.bolts).toBe(3);
      expect(seen[0]?.data.x).toBeDefined();
      // The queue drains, so a marked shot still lets the turn resolve.
      expect(state.turnEffects).toHaveLength(0);
      expect(isSettled(state)).toBe(true);
    });
  });
});

describe('BehaviourContext.applyImpulse', () => {
  it('throws a mobile, integrates vx while airborne and stops it on landing', () => {
    registerBehaviour('testImpulse', {
      onSpawn: (p, ctx) => {
        ctx.applyImpulse(1, 3, -4);
        p.alive = false;
      },
    });

    withMageShot(hittingShot({ behaviour: 'testImpulse' }), () => {
      const state = createDuel('mage', 'armor', 9);
      const target = mobileOfSeat(state, 1);
      if (!target) throw new Error('no target');
      const x0 = target.x;
      applyIntent(state, { t: 'fire', seat: 0, shot: 's1', relAngle: 45, power: 0.5 });
      expect(target.vx).toBe(3);
      expect(target.grounded).toBe(false);

      for (let i = 0; i < 5; i++) step(state);
      expect(target.x).toBeGreaterThan(x0);

      for (let i = 0; i < 120 && !target.grounded; i++) step(state);
      expect(target.grounded).toBe(true);
      expect(target.vx).toBe(0);
    });
  });

  it('puts vx in the state hash', () => {
    const a = createMatch(3, flatTestMap(), seats);
    const b = createMatch(3, flatTestMap(), seats);
    expect(hashState(a)).toBe(hashState(b));
    const m = mobileOfSeat(b, 0);
    if (!m) throw new Error('no mobile');
    m.vx = 2;
    expect(hashState(b)).not.toBe(hashState(a));
  });
});

describe('registerTurnHook', () => {
  it('runs every hook at turn start and turn end, in sorted key order', () => {
    const calls: string[] = [];
    registerTurnHook('zzTest', {
      onTurnStart: () => calls.push('zz:start'),
      onTurnEnd: () => calls.push('zz:end'),
    });
    registerTurnHook('aaTest', {
      onTurnStart: () => calls.push('aa:start'),
      onTurnEnd: () => calls.push('aa:end'),
    });
    try {
      const state = createMatch(11, flatTestMap(), seats, { mode: 'turns' });
      step(state);
      expect(calls).toEqual(['aa:start', 'zz:start']);

      let ended = false;
      for (let i = 0; i < 600 && !ended; i++) {
        if (state.phase === 'active') applyIntent(state, { t: 'skip', seat: state.activeSeat });
        for (const e of step(state)) if (e.t === 'turnEnd') ended = true;
      }
      expect(ended).toBe(true);
      expect(calls.slice(2, 4)).toEqual(['aa:end', 'zz:end']);
    } finally {
      // Leave the registry as we found it for the rest of the file.
      registerTurnHook('zzTest', {});
      registerTurnHook('aaTest', {});
    }
  });
});

describe('mines', () => {
  function stateWithMine(): MatchState {
    const state = createMatch(11, flatTestMap(), seats);
    const mine = createMine({ x: 700, y: 600, ownerSeat: 0 });
    mine.id = state.nextMineId++;
    state.mines.push(mine);
    return state;
  }

  it('are in the state hash', () => {
    const plain = createMatch(11, flatTestMap(), seats);
    const mined = stateWithMine();
    expect(hashState(mined)).not.toBe(hashState(plain));
  });

  it('survive a snapshot round trip', () => {
    const server = stateWithMine();
    const client = createMatch(11, flatTestMap(), seats);
    applySnapshot(client, takeSnapshot(server));
    expect(client.mines).toHaveLength(1);
    expect(client.mines[0]?.x).toBe(700);
    expect(client.mines[0]?.id).toBe(1);
    expect(client.nextMineId).toBe(server.nextMineId);
    expect(hashState(client)).toBe(hashState(server));
  });

  it('never block the turn from resolving (DESIGN §3)', () => {
    const state = stateWithMine();
    expect(isSettled(state)).toBe(true);
  });

  it('are created through ctx.addMine, which numbers them and emits mineSpawn', () => {
    registerBehaviour('testMine', {
      onSpawn: (p, ctx) => {
        ctx.addMine(createMine({ x: p.x, y: p.y, ownerSeat: p.ownerSeat, sprite: 'testMine' }));
        p.alive = false;
      },
    });
    withMageShot(hittingShot({ behaviour: 'testMine' }), () => {
      const state = createDuel('mage', 'armor', 13);
      const events = applyIntent(state, {
        t: 'fire',
        seat: 0,
        shot: 's1',
        relAngle: 45,
        power: 0.5,
      });
      expect(state.mines).toHaveLength(1);
      expect(state.mines[0]?.id).toBe(1);
      expect(state.mines[0]?.ttlTurns).toBe(constants.mine.ttlTurns);
      const spawns = eventsOfType(events, 'mineSpawn');
      expect(spawns).toHaveLength(1);
      expect(spawns[0]?.sprite).toBe('testMine');
    });
  });
});
