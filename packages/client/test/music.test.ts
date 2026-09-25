/**
 * The music (DESIGN §8.3), the half that can be wrong without anyone hearing it: which
 * track a screen asks for, that every map has one, that every track the table names is
 * a file in `public/music/`, and the sound button's three steps. The player itself is an
 * `<audio>` element and a gain node, and is judged by ear.
 */
import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { constants, mapOrder } from '@gunbros/shared';
import type { MatchState, TurnPhase } from '@gunbros/shared';
import { matchScene, trackFor, trackUrl } from '../src/audio/music.js';
import type { MusicTrack } from '../src/audio/music.js';
import { clientConstants } from '../src/data/clientConstants.js';
import { nextSoundMode, soundModeWord } from '../src/state/session.js';
import type { SoundMode } from '../src/state/session.js';

const music = clientConstants.music;
const MUSIC_DIR = new URL('../public/music/', import.meta.url);
/** Every track together. They load one at a time, but the image carries them all. */
const MAX_TOTAL_BYTES = 20_000_000;

/** Just the fields `matchScene` reads. */
function match(mapId: string, completedTurns: number, phase: TurnPhase = 'active'): MatchState {
  return { map: { id: mapId }, completedTurns, phase } as unknown as MatchState;
}

describe('which track plays', () => {
  it('plays the lobby track in the lobby and the room', () => {
    expect(trackFor({ kind: 'lobby' })).toBe(music.lobby);
  });

  it("plays the map's own track through a normal match", () => {
    expect(trackFor(matchScene(match('pit', 0)))).toBe(music.maps.pit);
    expect(trackFor(matchScene(match('cave', 3)))).toBe(music.maps.cave);
  });

  it('switches to the sudden-death track on the turn sudden death starts', () => {
    const before = constants.suddenDeath.afterTurns - 1;
    expect(trackFor(matchScene(match('hills', before)))).toBe(music.maps.hills);
    expect(trackFor(matchScene(match('hills', before + 1)))).toBe(music.suddenDeath);
    expect(trackFor(matchScene(match('hills', constants.suddenDeath.secondAfterTurns)))).toBe(
      music.suddenDeath,
    );
  });

  it('plays the results over everything once the match has ended', () => {
    expect(trackFor(matchScene(match('forge', 0, 'ended')))).toBe(music.results);
    const late = constants.suddenDeath.secondAfterTurns + 5;
    expect(trackFor(matchScene(match('forge', late, 'ended')))).toBe(music.results);
  });

  it("takes the scene's word for the end over the simulation's", () => {
    // A forfeit: the server ended the match, the local sim is mid-turn.
    expect(trackFor(matchScene(match('temple', 2), true))).toBe(music.results);
    // Only the authority ends a networked match: a sim that got there first does not.
    expect(trackFor(matchScene(match('temple', 2, 'ended'), false))).toBe(music.maps.temple);
  });

  it('plays nothing on a map the table does not know', () => {
    expect(trackFor(matchScene(match('nowhere', 0)))).toBeNull();
  });
});

describe('the track table', () => {
  // The soundtrack is not in the public repository (public/music/README.md).
  const files = new Set(readdirSync(MUSIC_DIR).filter((f) => f.endsWith('.mp3')));
  const used = new Set<MusicTrack>([
    ...Object.values(music.maps),
    music.lobby,
    music.suddenDeath,
    music.results,
  ]);

  it('gives every map in the pool a track', () => {
    for (const id of mapOrder) expect(music.maps[id], id).toBeDefined();
  });

  it('has a file for every track it names, and ships none it does not', () => {
    if (files.size === 0) return;
    for (const track of used) expect(files, track).toContain(`${track}.mp3`);
    for (const file of files) {
      expect(used, `${file} is in public/music but nothing plays it`).toContain(
        file.replace(/\.mp3$/, '') as MusicTrack,
      );
    }
  });

  it('has a gain for every track it plays', () => {
    for (const track of used) {
      const gain = music.tracks[track].gain;
      expect(gain, track).toBeGreaterThan(0);
      // `busGain` times the loudest track still has headroom under full scale.
      expect(gain * music.busGain, track).toBeLessThan(1);
    }
  });

  it('stays inside its size budget', () => {
    let total = 0;
    for (const file of files) total += statSync(fileURLToPath(new URL(file, MUSIC_DIR))).size;
    expect(total).toBeLessThan(MAX_TOTAL_BYTES);
  });

  it('points each track at its file under the public root', () => {
    expect(trackUrl('farline4')).toBe('/music/farline4.mp3');
  });
});

describe('the sound button', () => {
  it('steps on, then music off, then off, then back on', () => {
    const seen: SoundMode[] = ['on'];
    for (let i = 0; i < 3; i++) seen.push(nextSoundMode(seen[seen.length - 1] as SoundMode));
    expect(seen).toEqual(['on', 'noMusic', 'off', 'on']);
  });

  it('names each step for the controls card', () => {
    expect(['on', 'noMusic', 'off'].map((m) => soundModeWord(m as SoundMode))).toEqual([
      'on',
      'music off',
      'off',
    ]);
  });
});
