/**
 * Sound, the half of it that can be wrong without anyone hearing it (DESIGN §8).
 *
 * `audio/synth.ts` is oscillators and envelopes: it needs an AudioContext and is judged
 * by ear. `audio/sfx.ts` is the *mapping* — which event earns which voice, how loud,
 * how many of them one tick may play — and that is arithmetic over plain data, so it is
 * tested here with no DOM at all. The HUD helpers that came with the same pass (the
 * controls card's wrapping, the portrait crop) are pure for the same reason and are
 * tested alongside them.
 */
import { describe, expect, it } from 'vitest';
import { constants } from '@gunbros/shared';
import type { SimEvent } from '@gunbros/shared';
import {
  chargeBarIndex,
  chargeTickCues,
  cueForUi,
  cuesForEvent,
  cuesForEvents,
  levelFrom,
  mergeCues,
} from '../src/audio/sfx.js';
import type { SfxCue } from '../src/audio/sfx.js';
import { portraitCrop, wrapHelpLines } from '../src/render/hud.js';
import { clientConstants } from '../src/data/clientConstants.js';

const audio = clientConstants.audio;

function explosion(carveRadius: number): SimEvent {
  return {
    t: 'explosion',
    x: 100,
    y: 100,
    radius: carveRadius,
    carveRadius,
    damageType: 'explosive',
    ownerSeat: 0,
  };
}

function hit(hpLost: number, shieldAbsorbed = 0, seat = 1): SimEvent {
  return {
    t: 'hit',
    seat,
    x: 10,
    y: 10,
    amount: hpLost + shieldAbsorbed,
    shieldAbsorbed,
    hpLost,
    damageType: 'explosive',
    ownerSeat: 0,
  };
}

function names(cues: readonly SfxCue[]): string[] {
  return cues.map((cue) => cue.name);
}

function levelOf(cues: readonly SfxCue[], name: string): number {
  const cue = cues.find((c) => c.name === name);
  if (!cue) throw new Error(`no ${name} cue in [${names(cues).join(', ')}]`);
  return cue.level ?? 1;
}

describe('event mapping', () => {
  it('is silent for the events the renderer already tells', () => {
    const quiet: SimEvent[] = [
      { t: 'carve', x: 0, y: 0, r: 10 },
      { t: 'spawn', id: 1, ownerSeat: 0, sprite: 'shell', x: 0, y: 0, vx: 1, vy: 1 },
      { t: 'land', seat: 0, x: 0, y: 0 },
      { t: 'turnEnd', seat: 0, delays: [250, 0], cost: 250 },
      { t: 'mark', x: 0, y: 0, kind: 'bolt', ownerSeat: 0, ticksUntil: 60 },
      { t: 'mineMove', id: 2, x: 4, y: 4 },
    ];
    for (const event of quiet) expect(cuesForEvent(event)).toEqual([]);
  });

  it('scales the explosion with the carve radius and never goes fully quiet', () => {
    const big = levelOf(cuesForEvent(explosion(audio.mapping.explosionRefRadiusPx * 2)), 'explosion');
    const mid = levelOf(cuesForEvent(explosion(audio.mapping.explosionRefRadiusPx / 2)), 'explosion');
    const tiny = levelOf(cuesForEvent(explosion(1)), 'explosion');
    expect(big).toBe(1);
    expect(mid).toBeGreaterThan(audio.mapping.explosionMinLevel);
    expect(mid).toBeLessThan(big);
    expect(tiny).toBe(audio.mapping.explosionMinLevel);
  });

  it('counts shield damage toward a hit, at a discount', () => {
    const throughHp = levelOf(cuesForEvent(hit(100)), 'hit');
    const onShield = levelOf(cuesForEvent(hit(0, 100)), 'hit');
    const both = levelOf(cuesForEvent(hit(100, 100)), 'hit');
    expect(onShield).toBeGreaterThanOrEqual(audio.mapping.hitMinLevel);
    expect(onShield).toBeLessThan(throughHp);
    expect(both).toBeGreaterThan(throughHp);
  });

  it('pitches your own turn, damage and death apart from everyone else’s', () => {
    const mine = cuesForEvent({ t: 'turnStart', seat: 0, turn: 3 }, 0)[0];
    const theirs = cuesForEvent({ t: 'turnStart', seat: 1, turn: 3 }, 0)[0];
    expect(mine?.pitch).toBe(audio.mapping.selfPitchUp);
    expect(theirs?.pitch ?? 1).toBe(1);

    expect(cuesForEvent(hit(50, 0, 0), 0)[0]?.pitch).toBe(audio.mapping.selfPitchDown);
    expect(cuesForEvent(hit(50, 0, 1), 0)[0]?.pitch ?? 1).toBe(1);

    const died: SimEvent = { t: 'death', seat: 0, x: 0, y: 0, cause: 'damage' };
    expect(cuesForEvent(died, 0)[0]?.pitch).toBe(audio.mapping.selfPitchDown);
  });

  it('fires louder and lower the fuller the charge was', () => {
    const weak = cuesForEvent({ t: 'fire', seat: 0, shot: 's1', power: 0, angleDeg: 45, x: 0, y: 0 })[0];
    const full = cuesForEvent({ t: 'fire', seat: 0, shot: 's1', power: 1, angleDeg: 45, x: 0, y: 0 })[0];
    expect(weak?.level).toBe(audio.mapping.fireMinLevel);
    expect(full?.level).toBe(1);
    expect(full?.pitch).toBeLessThan(weak?.pitch ?? 0);
  });

  it('scales the wind whoosh against the shared maximum strength', () => {
    const max = cuesForEvent({ t: 'windChange', strength: constants.wind.maxStrength, directionDeg: 0 });
    const calm = cuesForEvent({ t: 'windChange', strength: 0, directionDeg: 0 });
    expect(levelOf(max, 'windChange')).toBe(1);
    expect(levelOf(calm, 'windChange')).toBe(audio.mapping.windMinLevel);
  });

  it('says nothing for a heal that healed nothing', () => {
    expect(cuesForEvent({ t: 'heal', seat: 0, amount: 0 })).toEqual([]);
    expect(names(cuesForEvent({ t: 'heal', seat: 0, amount: 120 }))).toEqual(['heal']);
  });

  it('gives beams, mines, teleports, items and the endings their own voices', () => {
    expect(names(cuesForEvent({ t: 'beam', x1: 0, y1: 0, x2: 0, y2: 9, width: 4, kind: 'thor', ownerSeat: 0 }))).toEqual(['zap']);
    expect(names(cuesForEvent({ t: 'mineSpawn', id: 1, ownerSeat: 0, x: 0, y: 0, sprite: 'mine' }))).toEqual(['mineDrop']);
    expect(names(cuesForEvent({ t: 'mineExplode', id: 1, x: 0, y: 0 }))).toEqual(['explosion']);
    expect(names(cuesForEvent({ t: 'teleport', seat: 0, fromX: 0, fromY: 0, x: 9, y: 9 }))).toEqual(['teleport']);
    expect(names(cuesForEvent({ t: 'itemUsed', seat: 0, itemId: 'bunge' }))).toEqual(['itemUsed']);
    expect(names(cuesForEvent({ t: 'suddenDeath', level: 1, multiplier: 2, completedTurns: 40 }))).toEqual(['suddenDeath']);
    expect(names(cuesForEvent({ t: 'matchEnd', winnerTeam: 'A', completedTurns: 12 }))).toEqual(['matchEnd']);
  });

  it('gives every sky event a sound of its own (DESIGN §5)', () => {
    expect(
      names(cuesForEvent({ t: 'skyStrike', kind: 'thor', x: 10, y: 20, level: 2, ownerSeat: 0 })),
    ).toEqual(['zap']);
    expect(names(cuesForEvent({ t: 'skyLevelUp', kind: 'thor', level: 2, hits: 3 }))).toEqual([
      'skyLevelUp',
    ]);
    expect(names(cuesForEvent({ t: 'tornadoCapture', id: 1, ownerSeat: 0, x: 4, y: 5 }))).toEqual([
      'tornadoIn',
    ]);
    expect(
      names(cuesForEvent({ t: 'tornadoRelease', id: 1, ownerSeat: 0, x: 4, y: 5, vx: 1, vy: -2 })),
    ).toEqual(['tornadoOut']);
    expect(names(cuesForEvent({ t: 'skyForce', id: 1, ownerSeat: 0, x: 4, y: 5 }))).toEqual([
      'skyForce',
    ]);
    // Your own shell going up the funnel is pitched apart from everyone else's, like
    // every other event that names a seat (DESIGN §7 item 114).
    const mine = cuesForEvent({ t: 'tornadoCapture', id: 1, ownerSeat: 2, x: 4, y: 5 }, 2);
    expect(mine[0]?.pitch).toBeGreaterThan(1);
  });

  it('measures a level against its reference and clamps it', () => {
    expect(levelFrom(5, 10)).toBeCloseTo(0.5);
    expect(levelFrom(50, 10)).toBe(1);
    expect(levelFrom(-5, 10)).toBe(0);
    expect(levelFrom(3, 0)).toBe(1);
  });
});

describe('merging one tick', () => {
  it('plays one voice per sound, at the loudest level asked for', () => {
    const merged = mergeCues([
      { name: 'hit', level: 0.3 },
      { name: 'hit', level: 0.9 },
      { name: 'hit', level: 0.5 },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.level).toBe(0.9);
  });

  it('keeps the loudest cue’s own pitch with it', () => {
    const merged = mergeCues([
      { name: 'hit', level: 0.2, pitch: 1 },
      { name: 'hit', level: 0.8, pitch: 0.75 },
    ]);
    expect(merged[0]?.pitch).toBe(0.75);
  });

  it('caps a busy tick and keeps the events that matter', () => {
    const merged = mergeCues(
      [
        { name: 'hit' },
        { name: 'itemUsed' },
        { name: 'explosion' },
        { name: 'death' },
        { name: 'mineDrop' },
      ],
      2,
    );
    expect(names(merged)).toEqual(['death', 'explosion']);
  });

  it('collapses the eight-shell volley a split shot lands in one tick', () => {
    const events: SimEvent[] = [];
    for (let i = 0; i < 8; i++) {
      events.push(explosion(20), { t: 'carve', x: i, y: 0, r: 20 }, hit(40, 0, 1));
    }
    const cues = cuesForEvents(events, 0);
    expect(cues.length).toBeLessThanOrEqual(audio.maxCuesPerTick);
    expect(new Set(names(cues)).size).toBe(cues.length);
    expect(names(cues)).toContain('explosion');
  });

  it('is silent for a tick with no events', () => {
    expect(cuesForEvents([])).toEqual([]);
  });
});

describe('the charge (DESIGN §2.10)', () => {
  const bars = constants.power.majorBars;

  it('counts the major bars the shared power data draws', () => {
    expect(chargeBarIndex(0)).toBe(0);
    expect(chargeBarIndex(1 / bars - 0.001)).toBe(0);
    expect(chargeBarIndex(1 / bars)).toBe(1);
    expect(chargeBarIndex(1)).toBe(bars);
    expect(chargeBarIndex(5)).toBe(bars);
  });

  it('ticks once per bar crossed, rising as it goes', () => {
    expect(chargeTickCues(0, 0.1)).toEqual([]);
    const one = chargeTickCues(0, 1 / bars + 0.01);
    expect(names(one)).toEqual(['chargeTick']);
    // A frame long enough to cross two bars ticks twice, each higher than the last.
    const two = chargeTickCues(0, 2 / bars + 0.01);
    expect(two).toHaveLength(2);
    expect(two[1]?.pitch ?? 0).toBeGreaterThan(two[0]?.pitch ?? 0);
  });

  it('never ticks backwards when the bar is reset', () => {
    expect(chargeTickCues(1, 0)).toEqual([]);
    expect(chargeTickCues(0.9, 0.9)).toEqual([]);
  });
});

describe('UI cues', () => {
  it('has a distinct sound for a refusal', () => {
    expect(cueForUi('denied').name).toBe('uiDenied');
    expect(cueForUi('click').name).toBe('uiClick');
    expect(cueForUi('select').name).toBe('uiClick');
    expect(cueForUi('select').pitch).toBe(audio.mapping.selectPitch);
  });
});

describe('HUD helpers', () => {
  it('wraps the controls card without splitting an entry', () => {
    const text = 'Tab shot  <- -> move  ^ v aim  Space/FIRE charge  X skip  1-6 items';
    const lines = wrapHelpLines(text, 24);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(24);
    // Nothing is lost and nothing is invented.
    expect(lines.join('  ')).toBe(text);
  });

  it('keeps an over-long entry rather than dropping it', () => {
    const lines = wrapHelpLines('Space/FIRE charge and hold', 5);
    expect(lines).toEqual(['Space/FIRE charge and hold']);
  });

  it('wraps an empty help string to nothing', () => {
    expect(wrapHelpLines('')).toEqual([]);
    expect(wrapHelpLines('   ')).toEqual([]);
  });

  it('shows the whole sprite, shrunk by an integer divisor to fit the plate', () => {
    // 56x48 (docs/ART.md's default canvas) into the 24x16 inner plate: a clean 1/3.
    const crop = portraitCrop(56, 48, 24, 16);
    expect(crop.sx).toBe(0);
    expect(crop.sy).toBe(0);
    expect(crop.sw).toBe(56);
    expect(crop.sh).toBe(48);
    expect(crop.dw).toBe(19);
    expect(crop.dh).toBe(16);
    expect(crop.dx).toBe(3);
    expect(crop.dy).toBe(0);
  });

  it('halves a 40x32 sprite rather than cropping it', () => {
    const crop = portraitCrop(40, 32, 24, 16);
    expect(crop.dw).toBe(20);
    expect(crop.dh).toBe(16);
    expect(crop.sw).toBe(40);
    expect(crop.sh).toBe(32);
  });

  it('never blows a portrait up past its drawn size', () => {
    const crop = portraitCrop(20, 10, 26, 16);
    expect(crop.sw).toBe(20);
    expect(crop.sh).toBe(10);
    expect(crop.dw).toBe(20);
    expect(crop.dh).toBe(10);
    expect(crop.sx).toBe(0);
    expect(crop.sy).toBe(0);
    expect(crop.dx).toBe(3);
    expect(crop.dy).toBe(3);
  });

  it('keeps the biggest allowed canvas inside the plate', () => {
    const crop = portraitCrop(64, 56, 24, 16);
    expect(crop.dw).toBeLessThanOrEqual(24);
    expect(crop.dh).toBeLessThanOrEqual(16);
    expect(crop.dw).toBeGreaterThan(8);
  });
});
