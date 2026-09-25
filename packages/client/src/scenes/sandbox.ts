/**
 * The dev sandbox (DESIGN §1.3, §9 Phase 2, §7 item 14).
 *
 * One browser tab plays a whole match against itself — armor vs armor by default, or
 * any pair through `?a=<mobileId>&b=<mobileId>`: the shared
 * simulation runs in `turns` mode, so the delay order, the 20 s timer, the move gauge
 * and the power bar are the real ones, and the keyboard simply follows whichever seat
 * the simulation says is active (`state.activeSeat` is authoritative — DESIGN §2.9).
 *
 * Everything on screen — the backbuffer, the camera, the HUD, the charge, the loop —
 * belongs to `MatchView`, which the networked match scene uses as well. The sandbox is
 * the *offline* driver of that view: an intent goes straight into `applyIntent` instead
 * of onto a socket, and the dev-only keys (new map, reroll wind, free play, switch
 * seat) live here rather than in the shared module.
 *
 * This module is imported through an `import.meta.env.DEV` guarded dynamic import, so
 * it is never part of a production bundle.
 */
import {
  applyIntent,
  createMatch,
  Prng,
  getMobileDef,
  hillsMap,
  isMobileImplemented,
  isSettled,
  isSkyEventId,
  maps,
  mobileIds,
  rerollWind,
  resetTurnMods,
  rollSkyEvent,
  turnAcceptsIntent,
  validateLoadout,
} from '@gunbros/shared';
import type {
  Intent,
  ItemId,
  MapDef,
  MatchMode,
  MatchState,
  MobileId,
  SeatSpec,
  SkyEventId,
} from '@gunbros/shared';
import { clientConstants } from '../data/clientConstants.js';
import { MatchView } from './matchView.js';
import type { GameOverView, MatchViewDriver, Scene } from './matchView.js';
import type { Keyboard } from '../input/keyboard.js';
import { soundModeWord } from '../state/session.js';

export type { Scene } from './matchView.js';

/**
 * `/sandbox?a=<mobileId>&b=<mobileId>` picks the two mobiles; anything unknown (or
 * missing) falls back to armor. `P` cycles the controlled seat's mobile through the
 * whole roster and restarts, which is how a Phase 4 mobile is looked at without a
 * server, a room or a second browser.
 */
function mobileFromQuery(key: string): MobileId {
  const raw = new URLSearchParams(window.location.search).get(key);
  if (raw && isMobileImplemented(raw)) return raw as MobileId;
  return 'armor';
}

/**
 * `/sandbox?map=<mapId>` picks the map (DESIGN §8.1: any id in `mapOrder`),
 * so a map can be looked at — silhouette, palette and parallax background — without a
 * server or a room. Anything unknown falls back to the first map in the picker.
 */
function mapFromQuery(): MapDef {
  const raw = new URLSearchParams(window.location.search).get('map');
  for (let i = 0; i < maps.length; i++) {
    const m = maps[i];
    if (m && m.id === raw) return m;
  }
  return hillsMap;
}

/**
 * `?sky=thor|tornado|force|none` pins the match's sky event (DESIGN §5): it stays up
 * and no weather comes or goes, like the server's `SKY_EVENT`. Anything else —
 * including no parameter at all — rolls one off the sandbox's own seed, so a plain
 * `/sandbox` still meets a tornado now and then, and lets the weather change at turn
 * ends. The roll is `sky.rollTable` weighted, the same table the server rolls from.
 */
function skyFromQuery(seed: number): { skyEvent: SkyEventId; skyStatic: boolean } {
  const raw = new URLSearchParams(window.location.search).get('sky');
  if (raw !== null && isSkyEventId(raw)) return { skyEvent: raw, skyStatic: true };
  return { skyEvent: rollSkyEvent(Prng.seed((seed ^ 0x5eed5417) >>> 0)), skyStatic: false };
}

export function mountSandbox(host: HTMLElement): Scene {
  host.replaceChildren();

  const map = mapFromQuery();
  let seed = (Date.now() & 0x7fffffff) >>> 0;
  let mode: MatchMode = 'turns';
  /** Seat 0 is team A (`?a=`), seat 1 is team B (`?b=`). */
  const seatMobiles: MobileId[] = [mobileFromQuery('a'), mobileFromQuery('b')];

  /**
   * Both seats carry the default loadout (DESIGN §4), so items can be tried without a
   * server, a room or a second browser: keys 1-6 spend them exactly as they do online,
   * because the sandbox driver hands the same `useItem` intent to `applyIntent`.
   */
  const loadout = (): ItemId[] => validateLoadout(clientConstants.loadout.default);

  const seats = (): SeatSpec[] => [
    {
      playerId: 'local-a',
      nick: 'Bro A',
      team: 'A',
      mobileId: seatMobiles[0] ?? 'armor',
      items: loadout(),
    },
    {
      playerId: 'local-b',
      nick: 'Bro B',
      team: 'B',
      mobileId: seatMobiles[1] ?? 'armor',
      items: loadout(),
    },
  ];
  const seatCount = 2;

  let match: MatchState = createMatch(seed, map, seats(), { mode, ...skyFromQuery(seed) });
  /** Only meaningful in free play; `turns` mode follows `match.activeSeat`. */
  let freeSeat = 0;

  const controlledSeat = (): number => (match.mode === 'turns' ? match.activeSeat : freeSeat);

  /** Next mobile in the roster for a seat, wrapping. */
  const cycleMobile = (seat: number): void => {
    const current = seatMobiles[seat] ?? 'armor';
    const at = mobileIds.indexOf(current);
    const next = mobileIds[(at + 1) % mobileIds.length] ?? 'armor';
    seatMobiles[seat] = next;
    newMatch(false);
    view.flash(`SEAT ${seat} ${getMobileDef(next).displayName.toUpperCase()}`);
  };

  /**
   * Free play has no turn to end, so nothing there ever forgets a turn's items: one
   * Dual would double every later shot from either seat, and a Bunge or a Power Up
   * would follow the sandbox around for the rest of the session. The shot the item
   * paid for settling is the only boundary free play has, so that is where this drops
   * them — after the shot, never before it, or the multipliers would be gone by the
   * time the blast asked for them. A `turns` match clears them in `finishTurn` and
   * never reaches this.
   */
  let freePlayShotPending = false;
  const clearFreePlayMods = (): void => {
    if (match.mode !== 'freePlay' || !freePlayShotPending) return;
    if (!isSettled(match)) return;
    freePlayShotPending = false;
    resetTurnMods(match);
  };

  const driver: MatchViewDriver = {
    // Offline: the "authority" is this very tab, so an intent is applied immediately
    // and its events go straight to the renderer.
    sendIntent(intent: Intent): void {
      if (intent.t === 'fire' && match.mode === 'freePlay') freePlayShotPending = true;
      view.handleEvents(applyIntent(match, intent));
    },
    controlledSeat,
    acceptsInput(): boolean {
      return turnAcceptsIntent(match, controlledSeat());
    },
    onInput(keyboard: Keyboard): void {
      clearFreePlayMods();
      if (keyboard.pressed('rerollWind')) {
        rerollWind(match);
        view.flash(`WIND ${match.wind.strength}`);
      }
      if (keyboard.pressed('newMap')) newMatch(true);
      if (keyboard.pressed('restart') && match.phase === 'ended') newMatch(true);
      if (keyboard.pressed('toggleMode')) {
        mode = mode === 'turns' ? 'freePlay' : 'turns';
        newMatch(false);
        view.flash(`MODE ${mode.toUpperCase()}`);
      }
      if (keyboard.pressed('switchSeat') && match.mode === 'freePlay') {
        driver.sendIntent({ t: 'move', seat: freeSeat, dir: 0 });
        freeSeat = (freeSeat + 1) % seatCount;
        keyboard.resetMove();
      }
      // P: swap the mobile under the seat we are driving and start again.
      if (keyboard.pressed('cycleMobile')) cycleMobile(controlledSeat());
    },
    debugLines(): string[] {
      return [
        `seed ${seed}`,
        `mode ${match.mode}`,
        `a ${seatMobiles[0]}  b ${seatMobiles[1]}`,
        `tick ${match.tick}  turn ${match.turn}`,
        `phase ${match.phase}  done ${match.completedTurns}`,
        `wind ${match.wind.strength} @ ${Math.round(match.wind.directionDeg)}`,
        `sky ${match.sky.kind}${match.sky.kind === 'thor' ? ` lv ${match.sky.level}` : ''}`,
        `cam ${view.director.isManual ? 'manual' : 'auto'}  sound ${soundModeWord(view.sound)}`,
      ];
    },
    helpText(touch: boolean): string {
      if (touch) {
        return (
          'Drag the dial to aim  Hold FIRE to charge  Hold < > to walk  ' +
          'Tap a shot or an item  Drag the map to look around  ' +
          `Sound ${soundModeWord(view.sound)}  Tap ? to close`
        );
      }
      return (
        'Tab shot  <- -> move  ^ v aim  Space/FIRE charge  X skip  1-6 items  Esc cancel  ' +
        `R wind  N map  P mobile  F cam${view.director.free ? '*' : ''}  ` +
        `M sound ${soundModeWord(view.sound)}  H this card  \` mode  C seat`
      );
    },
    gameOver(): GameOverView | null {
      if (match.phase !== 'ended') return null;
      return {
        title: match.winnerTeam === null ? 'DRAW' : `TEAM ${match.winnerTeam} WINS`,
        lines: [`${match.completedTurns} turns played`, 'Enter: play again    N: new map'],
      };
    },
  };

  const view = new MatchView(host, map, match, driver);

  const newMatch = (nextSeed: boolean): void => {
    if (nextSeed) seed = (seed * 1664525 + 1013904223) >>> 0;
    match = createMatch(seed, map, seats(), { mode, ...skyFromQuery(seed) });
    freeSeat = 0;
    freePlayShotPending = false;
    view.setMatch(match, map);
  };

  view.start();

  return {
    destroy(): void {
      view.destroy();
    },
  };
}
