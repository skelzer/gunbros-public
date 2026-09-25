/**
 * The Phase 3 exit criterion, automated (DESIGN §9, §10): two browsers play three turns
 * of armor vs armor against the built server.
 *
 * Two contexts, because a room is two players and a context is a browser as far as
 * `localStorage` (the reconnect token, the nickname) is concerned. One creates a room,
 * the other joins by code, both ready up, the host starts, and then the seat whose turn
 * it is walks (from the second turn on), holds Space for a second and lets go. Each turn
 * has to *finish on both screens*: that is the real assertion, because it is only true
 * if the shooter's `fire` was validated, broadcast, replayed identically by both engines
 * and closed with a `turnEnd` whose hash both of them agreed with.
 *
 * Three turns, and a walk in two of them, on purpose: a charge-and-release turn carries
 * no `moveEcho`, and `moveEcho` is the message that has to be applied at exactly the
 * tick it names or the walk lands one tick out and the hashes differ (DESIGN §7 item 45).
 *
 * The HUD is canvas, so nothing here reads pixels. `?debug=1` exposes the same numbers
 * the debug panel draws as `window.__gunbrosMatch` (see `scenes/match.ts`), and the
 * desync counter in it is the one number that says the two simulations stayed equal.
 */
import { expect, test } from '@playwright/test';
import type { BrowserContext, ConsoleMessage, Page } from '@playwright/test';
// The probe's shape, and the `window.__gunbrosMatch` declaration with it.
import type { MatchProbe } from './probe.js';

/** Anything the page said that a passing run must not say. */
interface PageLog {
  errors: string[];
  desyncWarnings: string[];
}

function watch(page: Page, label: string): PageLog {
  const log: PageLog = { errors: [], desyncWarnings: [] };
  page.on('console', (msg: ConsoleMessage) => {
    const text = `[${label}] ${msg.text()}`;
    if (msg.type() === 'error') log.errors.push(text);
    if (text.includes('desync')) log.desyncWarnings.push(text);
  });
  page.on('pageerror', (err: Error) => log.errors.push(`[${label}] ${err.message}`));
  return log;
}

async function probe(page: Page): Promise<MatchProbe> {
  const value = await page.evaluate(() => {
    const p = window.__gunbrosMatch;
    if (!p) return null;
    return {
      seat: p.seat,
      activeSeat: p.activeSeat,
      turn: p.turn,
      completedTurns: p.completedTurns,
      phase: p.phase,
      tick: p.tick,
      desyncs: p.desyncs,
      ended: p.ended,
      power: p.power,
    };
  });
  expect(value, 'the match probe should exist (?debug=1)').not.toBeNull();
  return value as MatchProbe;
}

/** Wait until the match scene is up and the turn is accepting input. */
async function waitForActiveTurn(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__gunbrosMatch?.phase === 'active', undefined, {
    timeout: 30_000,
  });
}

/**
 * Play one turn: whoever the authority gave it to optionally walks, then charges and
 * fires, and *both* pages have to reach the next turn. Returns the seat that played.
 *
 * The assertion is the arrival at the next turn on both screens: it is only true if the
 * shot was validated, broadcast, replayed identically by both engines, and closed with a
 * `turnEnd` whose hash both of them agreed with.
 */
async function playTurn(pages: Page[], walk: boolean): Promise<number> {
  for (const page of pages) await waitForActiveTurn(page);
  const probes = await Promise.all(pages.map((page) => probe(page)));
  const first = probes[0];
  if (!first) throw new Error('no pages');
  const activeSeat = first.activeSeat;
  const turnBefore = first.turn;
  for (const p of probes) expect(p.activeSeat, 'both engines agree whose turn it is').toBe(activeSeat);

  const index = probes.findIndex((p) => p.seat === activeSeat);
  const shooter = pages[index];
  if (!shooter) throw new Error('the active seat is on neither page');

  if (walk) {
    // A real turn: walk a little before shooting. Each direction edge is a `move` the
    // server echoes back with the tick it applied it on.
    await shooter.keyboard.down('ArrowRight');
    await shooter.waitForTimeout(400);
    await shooter.keyboard.up('ArrowRight');
    await shooter.waitForTimeout(150);
  }

  // Hold the charge key for about a second (≈ 0.38 power) and let go: the release is
  // the only thing that fires (DESIGN §2.10). Waiting for the bar to actually move
  // before timing the hold is what makes this reliable — the charge is real time, so a
  // key pressed and released between two frames would be a shot that never happened,
  // and the turn would end on its 20 s timer with the test none the wiser.
  await shooter.keyboard.down('Space');
  await shooter.waitForFunction(() => (window.__gunbrosMatch?.power ?? 0) > 0, undefined, {
    timeout: 15_000,
  });
  await shooter.waitForTimeout(1000);
  await shooter.keyboard.up('Space');

  // The shot was accepted and echoed: the phase only leaves `active` on the authority's
  // `fire` (DESIGN §6.3 step 3), so this is the turn ending in a shell, not in a timeout.
  await shooter.waitForFunction(
    (turn) => {
      const p = window.__gunbrosMatch;
      return !!p && (p.phase !== 'active' || p.turn > turn);
    },
    turnBefore,
    { timeout: 15_000 },
  );

  for (const page of pages) {
    await page.waitForFunction(
      (turn) => {
        const p = window.__gunbrosMatch;
        return !!p && p.turn > turn && p.phase === 'active';
      },
      turnBefore,
      { timeout: 60_000 },
    );
  }
  return activeSeat;
}

test('two browser contexts join a room and play three turns', async ({ browser }) => {
  const contexts: BrowserContext[] = [await browser.newContext(), await browser.newContext()];
  const [hostCtx, guestCtx] = contexts as [BrowserContext, BrowserContext];

  try {
    const host = await hostCtx.newPage();
    const guest = await guestCtx.newPage();
    const hostLog = watch(host, 'host');
    const guestLog = watch(guest, 'guest');
    const logs = [hostLog, guestLog];

    // --- lobby: create -------------------------------------------------------
    await host.goto('/?debug=1');
    await host.getByPlaceholder('your name').fill('Alfa');
    await host.getByRole('button', { name: 'Create room' }).click();

    const code = (await host.locator('.code-box .code').innerText()).trim();
    expect(code).toMatch(/^[A-Z0-9]{4,8}$/);

    // --- lobby: join by the link the host would send -------------------------
    await guest.goto(`/r/${code}?debug=1`);
    await guest.getByPlaceholder('your name').fill('Bravo');
    await guest.getByRole('button', { name: 'Join', exact: true }).click();

    // Both are in the room, and each sees the other (`roomState` is broadcast whole).
    for (const page of [host, guest]) {
      await expect(page.locator('.players .player')).toHaveCount(2);
    }

    // --- ready up and start --------------------------------------------------
    await guest.getByRole('button', { name: 'Ready' }).click();
    await host.getByRole('button', { name: 'Ready' }).click();

    const startButton = host.getByRole('button', { name: 'Start match' });
    await expect(startButton).toBeEnabled();
    await startButton.click();

    await waitForActiveTurn(host);
    await waitForActiveTurn(guest);

    const before = { host: await probe(host), guest: await probe(guest) };
    expect(before.host.seat).not.toBe(before.guest.seat);
    // Both engines were built from the same `matchStart`, so they agree on the seat.
    expect(before.host.activeSeat).toBe(before.guest.activeSeat);

    // --- three turns, two of them with a walk first -------------------------
    //
    // The walk matters: a turn that is only a charge and a release carries no
    // `moveEcho`, and `moveEcho` is the message whose tick the client has to apply at
    // exactly the authority's tick or the walk lands one tick out and the hash differs
    // (DESIGN §7 item 45). Three turns also means the seat changes hands twice, so both
    // engines play both roles.
    const seats: number[] = [];
    for (let turnIndex = 0; turnIndex < 3; turnIndex++) {
      seats.push(await playTurn([host, guest], turnIndex > 0));
    }
    // The first hand-over is guaranteed (the second player starts at delay 0). After that
    // the order follows accumulated delay (DESIGN §2.8): a player who spent less turn time
    // can legitimately go twice in a row, so only require that both seats played.
    expect(seats[0]).not.toBe(seats[1]);
    expect(new Set(seats).size).toBe(2);

    const after = { host: await probe(host), guest: await probe(guest) };
    for (const [label, p] of Object.entries(after)) {
      expect(p.completedTurns, `${label}: three turns finished`).toBeGreaterThanOrEqual(3);
      expect(p.desyncs, `${label}: no snapshot ever disagreed`).toBe(0);
      expect(p.ended, `${label}: the match is still running`).toBe(false);
    }
    // Both simulations are on the same turn, from the same authority.
    expect(after.host.activeSeat).toBe(after.guest.activeSeat);
    expect(after.host.turn).toBe(after.guest.turn);

    for (const log of logs) {
      expect(log.desyncWarnings, 'no desync was logged').toEqual([]);
      expect(log.errors, 'no console errors').toEqual([]);
    }
  } finally {
    for (const context of contexts) await context.close();
  }
});
