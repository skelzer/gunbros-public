/** DESIGN §10: falling when the ground is removed, death below the map, steepness, tilt. */
import { describe, expect, it } from 'vitest';
import { constants } from '../src/data/constants.js';
import { armor } from '../src/data/mobiles.js';
import { mobileDefs } from '../src/data/mobiles/index.js';
import { Terrain } from '../src/terrain/terrain.js';
import { setAnim, setMoveDir, setRelAngle, stepMobile, settleOnGround, trueAngleDeg } from '../src/entities/mobile.js';
import { animDurationTicks } from '../src/sprites/pixelArt.js';
import { cosDeg, sinDeg } from '../src/math/trig.js';
import type { MobileState } from '../src/entities/mobile.js';
import type { SimEvent } from '../src/match/events.js';
import { flatTerrain, slopeTerrain, stepTerrain, makeArmor } from './helpers.js';

const MAP_H = 700;

function runTicks(m: MobileState, terrain: Terrain, ticks: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    stepMobile(m, armor, {
      terrain,
      mapHeight: MAP_H,
      emit: (e) => events.push(e),
      refillGauge: true,
    });
  }
  return events;
}

describe('mobile', () => {
  it('rests on the ground it was settled onto', () => {
    const terrain = flatTerrain(800, MAP_H, 400);
    const m = makeArmor(0, 200, 0);
    settleOnGround(m, armor, terrain);
    expect(m.y).toBe(400);
    runTicks(m, terrain, 30);
    expect(m.y).toBe(400);
    expect(m.grounded).toBe(true);
    expect(m.vy).toBe(0);
  });

  it('falls when the ground under it is carved away, and lands lower down', () => {
    const terrain = flatTerrain(800, MAP_H, 400);
    // A second, lower shelf to land on.
    for (let x = 150; x < 260; x++) terrain.fillColumnFrom(x, 520);
    const m = makeArmor(0, 200, 0);
    settleOnGround(m, armor, terrain);
    expect(m.y).toBe(400);

    terrain.carve(200, 430, 60);
    const events = runTicks(m, terrain, 120);

    expect(m.y).toBeGreaterThan(400);
    expect(m.grounded).toBe(true);
    expect(m.alive).toBe(true);
    expect(events.some((e) => e.t === 'land')).toBe(true);
  });

  it('dies when it falls below the map', () => {
    const terrain = flatTerrain(800, MAP_H, 400);
    const m = makeArmor(0, 200, 0);
    settleOnGround(m, armor, terrain);
    for (let x = 0; x < 800; x++) {
      for (let y = 0; y < MAP_H; y++) terrain.setSolid(x, y, false);
    }
    const events = runTicks(m, terrain, 600);
    expect(m.alive).toBe(false);
    expect(m.y).toBeGreaterThan(MAP_H + constants.mobile.deathBelowMapPx);
    const death = events.find((e) => e.t === 'death');
    expect(death).toBeDefined();
    expect(death?.t === 'death' && death.cause).toBe('fell');
  });

  it('caps its fall speed', () => {
    const terrain = new Terrain(800, MAP_H);
    const m = makeArmor(0, 200, 10);
    runTicks(m, terrain, 300);
    expect(m.vy).toBeLessThanOrEqual(constants.mobile.maxFallSpeed);
  });

  it('walks, spends the gauge and turns to face the way it moves', () => {
    const terrain = flatTerrain(800, MAP_H, 400);
    const m = makeArmor(0, 200, 0);
    settleOnGround(m, armor, terrain);
    setMoveDir(m, 1);
    const events: SimEvent[] = [];
    for (let i = 0; i < 60; i++) {
      stepMobile(m, armor, {
        terrain,
        mapHeight: MAP_H,
        emit: (e) => events.push(e),
        refillGauge: false,
      });
    }
    expect(m.x).toBeCloseTo(200 + armor.moveSpeed * 60, 6);
    expect(m.moveGauge).toBeCloseTo(armor.moveGauge - armor.moveSpeed * 60, 6);
    expect(m.facing).toBe(1);
    expect(m.anim.name).toBe('move');

    setMoveDir(m, -1);
    runTicks(m, terrain, 5);
    expect(m.facing).toBe(-1);
  });

  it('stops walking when the gauge runs out', () => {
    const terrain = flatTerrain(2000, MAP_H, 400);
    const m = makeArmor(0, 200, 0);
    settleOnGround(m, armor, terrain);
    setMoveDir(m, 1);
    for (let i = 0; i < 1000; i++) {
      stepMobile(m, armor, {
        terrain,
        mapHeight: MAP_H,
        emit: () => {},
        refillGauge: false,
      });
    }
    expect(m.moveGauge).toBe(0);
    expect(m.x).toBeCloseTo(200 + armor.moveGauge, 6);
  });

  it('steps up small rises but is blocked by a wall taller than maxStep', () => {
    const gentle = stepTerrain(800, MAP_H, 400, 300, armor.maxStep - 1);
    const climber = makeArmor(0, 250, 0);
    settleOnGround(climber, armor, gentle);
    setMoveDir(climber, 1);
    runTicks(climber, gentle, 120);
    expect(climber.x).toBeGreaterThan(320);
    expect(climber.y).toBe(400 - (armor.maxStep - 1));

    const wall = stepTerrain(800, MAP_H, 400, 300, armor.maxStep + 25);
    const blocked = makeArmor(0, 250, 0);
    settleOnGround(blocked, armor, wall);
    setMoveDir(blocked, 1);
    runTicks(blocked, wall, 200);
    // It walks up to the wall (footprint half-width away) and stops.
    expect(blocked.x).toBeLessThan(300);
    expect(blocked.x).toBeGreaterThan(250);
    expect(blocked.y).toBe(400);
  });

  it('climbs out of the crater its own S1 and S2 leave on flat ground', () => {
    // A shot stops on the first solid pixel, so its crater is a half disc with a
    // vertical rim: the last pixel of the climb is the tall one.
    for (const def of mobileDefs) {
      for (const shot of [def.shots.s1, def.shots.s2]) {
        const r = shot.projectile.carveRadius;
        const terrain = flatTerrain(800, MAP_H, 400);
        terrain.carve(400, 400, r);
        const m = makeArmor(0, 400, 200);
        settleOnGround(m, def, terrain);
        setMoveDir(m, 1);
        for (let i = 0; i < 400; i++) {
          stepMobile(m, def, { terrain, mapHeight: MAP_H, emit: () => {}, refillGauge: true });
        }
        expect(m.x, `${def.id} out of a ${r} px crater`).toBeGreaterThan(400 + r);
      }
    }
  });

  it('walks off a ledge and falls', () => {
    const terrain = flatTerrain(800, MAP_H, 400);
    for (let x = 400; x < 800; x++) {
      for (let y = 0; y < MAP_H; y++) terrain.setSolid(x, y, false);
    }
    const m = makeArmor(0, 350, 0);
    settleOnGround(m, armor, terrain);
    setMoveDir(m, 1);
    runTicks(m, terrain, 200);
    expect(m.x).toBeGreaterThan(400);
    expect(m.alive).toBe(false); // nothing below: it falls out of the world
  });

  it('smooths its tilt toward the slope it stands on', () => {
    const terrain = slopeTerrain(900, MAP_H, 200, 0.4);
    const m = makeArmor(0, 400, 0);
    settleOnGround(m, armor, terrain);
    m.tilt = 0;
    const target = terrain.sampleTilt(m.x, m.y, armor.footprint.w, constants.mobile.surfaceProbePx);
    expect(target).toBeGreaterThan(0.3);

    runTicks(m, terrain, 1);
    const afterOne = m.tilt;
    expect(afterOne).toBeGreaterThan(0);
    expect(afterOne).toBeLessThan(target); // smoothed, not snapped

    runTicks(m, terrain, 60);
    expect(Math.abs(m.tilt - target)).toBeLessThan(1e-3);
  });

  it('folds tilt and facing into the true aim angle', () => {
    const terrain = flatTerrain(800, MAP_H, 400);
    const m = makeArmor(0, 200, 0);
    settleOnGround(m, armor, terrain);
    setRelAngle(m, armor, 45);
    expect(trueAngleDeg(m)).toBeCloseTo(45, 9);

    // Facing mirrors through the vertical: 45 degrees above the horizon, pointing left.
    m.facing = -1;
    expect(trueAngleDeg(m)).toBeCloseTo(135, 9);

    m.facing = 1;
    m.tilt = -0.2; // sloping up to the right lifts the barrel
    expect(trueAngleDeg(m)).toBeCloseTo(45 + 11.459155902616464, 6);

    // Tilt is a world rotation of the hull, so it keeps its sign for either facing.
    m.facing = -1;
    expect(trueAngleDeg(m)).toBeCloseTo(135 + 11.459155902616464, 6);
  });

  it('never aims a left-facing mobile into its own feet', () => {
    const terrain = flatTerrain(800, MAP_H, 400);
    const m = makeArmor(0, 200, 0);
    settleOnGround(m, armor, terrain);
    m.facing = -1;
    for (let rel = armor.angleMin; rel <= armor.angleMax; rel += 5) {
      setRelAngle(m, armor, rel);
      const left = trueAngleDeg(m);
      m.facing = 1;
      const right = trueAngleDeg(m);
      m.facing = -1;
      // Mirror images: the same height above the horizon, opposite horizontal sense.
      expect(cosDeg(left)).toBeCloseTo(-cosDeg(right), 9);
      expect(sinDeg(left)).toBeCloseTo(sinDeg(right), 9);
    }
  });

  it('ignores a malformed move direction instead of walking to NaN', () => {
    const terrain = flatTerrain(800, MAP_H, 400);
    const m = makeArmor(0, 200, 0);
    settleOnGround(m, armor, terrain);
    setMoveDir(m, Number.NaN as unknown as -1 | 0 | 1);
    expect(m.moveDir).toBe(0);
    runTicks(m, terrain, 60);
    expect(m.x).toBe(200);
    expect(m.alive).toBe(true);
  });

  it('plays one-shot animations and hands back to idle', () => {
    const terrain = flatTerrain(800, MAP_H, 400);
    const m = makeArmor(0, 200, 0);
    settleOnGround(m, armor, terrain);
    setAnim(m, 'fire');
    const duration = animDurationTicks(armor.sprite, 'fire');
    expect(duration).toBeGreaterThan(1);

    runTicks(m, terrain, duration - 1);
    expect(m.anim.name).toBe('fire');
    runTicks(m, terrain, 1);
    expect(m.anim.name).toBe('idle');
  });

  it('clamps aim to the mobile angle range', () => {
    const m = makeArmor(0, 100, 100);
    setRelAngle(m, armor, 400);
    expect(m.relAngle).toBe(armor.angleMax);
    setRelAngle(m, armor, -400);
    expect(m.relAngle).toBe(armor.angleMin);
  });

  it('stands on a 1 px ledge instead of dropping through it', () => {
    const terrain = new Terrain(800, MAP_H);
    for (let x = 100; x < 300; x++) terrain.setSolid(x, 400, true);
    const m = makeArmor(0, 200, 300);
    runTicks(m, terrain, 120);
    expect(m.alive).toBe(true);
    expect(m.y).toBe(400);
    expect(m.grounded).toBe(true);
  });

  it('walks onto a 1 px bridge and stays on it', () => {
    const terrain = new Terrain(800, MAP_H);
    for (let x = 0; x < 800; x++) terrain.setSolid(x, 400, true);
    const m = makeArmor(0, 200, 300);
    runTicks(m, terrain, 60);
    setMoveDir(m, 1);
    runTicks(m, terrain, 40);
    setMoveDir(m, 0);
    runTicks(m, terrain, 60);
    expect(m.alive).toBe(true);
    expect(m.y).toBe(400);
  });

  it('stops against a ceiling when thrown upwards instead of rising through rock', () => {
    const terrain = flatTerrain(800, MAP_H, 400);
    for (let y = 300; y < 340; y++) for (let x = 0; x < 800; x++) terrain.setSolid(x, y, true);
    const m = makeArmor(0, 200, 360);
    settleOnGround(m, armor, terrain);
    m.vy = -5.4;
    for (let i = 0; i < 120; i++) {
      runTicks(m, terrain, 1);
      // Never any rock inside the hull.
      for (let y = Math.ceil(m.y - armor.footprint.h); y < Math.floor(m.y); y++) {
        expect(terrain.isSolid(m.x, y)).toBe(false);
      }
    }
    expect(m.y).toBe(400);
    expect(m.grounded).toBe(true);
  });

  it('does not skip through a thin wall when thrown sideways fast', () => {
    const terrain = flatTerrain(800, MAP_H, 400);
    for (let y = 300; y < 400; y++) for (let x = 250; x < 256; x++) terrain.setSolid(x, y, true);
    const m = makeArmor(0, 200, 0);
    settleOnGround(m, armor, terrain);
    m.vy = -3;
    m.vx = 12;
    runTicks(m, terrain, 120);
    expect(m.x).toBeLessThan(250);
    expect(m.alive).toBe(true);
  });

  it('lands on top of a small rise it drifts into instead of sinking its feet', () => {
    const terrain = stepTerrain(800, MAP_H, 400, 260, 4);
    const m = makeArmor(0, 200, 0);
    settleOnGround(m, armor, terrain);
    m.vy = -1;
    m.vx = 12;
    runTicks(m, terrain, 120);
    expect(m.grounded).toBe(true);
    expect(terrain.isSolid(m.x, m.y - 1)).toBe(false);
  });
});
