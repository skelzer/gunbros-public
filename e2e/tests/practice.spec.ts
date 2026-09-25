/**
 * Practice against a bot (DESIGN §11, §7 item 192), in one browser: press "Practice vs
 * bot", ready, Start, play our turn, and watch the bot take its own — the turn has to
 * change hands, the bot's shell has to leave the barrel (the phase leaves `active` on
 * the authority's `fire`, never on a timeout in the time allowed), and the engine has to
 * agree with the authority at every turn end.
 *
 * The bot is on the server, so everything it does reaches this page as the ordinary
 * `aimEcho` / `chargingEcho` / `fire` a human opponent's intents would: the desync
 * counter staying at 0 is what says those were applied exactly as the authority did.
 */
import { expect, test } from '@playwright/test';
import type { ConsoleMessage } from '@playwright/test';
import type { MatchProbe } from './probe.js';

type Probe = Pick<MatchProbe, 'seat' | 'activeSeat' | 'turn' | 'phase' | 'desyncs' | 'ended'>;

test('practice vs bot: the bot takes a turn and fires', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' || msg.text().includes('desync')) errors.push(msg.text());
  });
  page.on('pageerror', (err: Error) => errors.push(err.message));

  const probe = (): Promise<Probe> =>
    page.evaluate(() => {
      const p = window.__gunbrosMatch;
      if (!p) throw new Error('no match probe (?debug=1)');
      return { seat: p.seat, activeSeat: p.activeSeat, turn: p.turn, phase: p.phase, desyncs: p.desyncs, ended: p.ended };
    });

  await page.goto('/?debug=1');
  await page.getByPlaceholder('your name').fill('Solo');
  await page.getByRole('button', { name: 'Practice vs bot' }).click();

  // The room: us, and a bot on the other team, already ready.
  await expect(page.locator('.players .player')).toHaveCount(2);
  const botCard = page.locator('.players .player.bot');
  await expect(botCard).toHaveCount(1);
  await expect(botCard).toContainText('Normal');

  await page.getByRole('button', { name: 'Ready' }).click();
  const start = page.getByRole('button', { name: 'Start match' });
  await expect(start).toBeEnabled();
  await start.click();

  await page.waitForFunction(() => window.__gunbrosMatch?.phase === 'active', undefined, { timeout: 30_000 });
  const first = await probe();
  const botSeat = first.seat === 0 ? 1 : 0;

  // Play turns until the bot has had one: ours is a one-second charge and a release.
  let botFired = false;
  for (let i = 0; i < 4 && !botFired; i++) {
    await page.waitForFunction(() => window.__gunbrosMatch?.phase === 'active', undefined, { timeout: 60_000 });
    const now = await probe();
    if (now.activeSeat === now.seat) {
      await page.keyboard.down('Space');
      await page.waitForFunction(() => (window.__gunbrosMatch?.power ?? 0) > 0, undefined, { timeout: 15_000 });
      await page.waitForTimeout(1000);
      await page.keyboard.up('Space');
      await page.waitForFunction(
        (turn) => {
          const p = window.__gunbrosMatch;
          return !!p && (p.phase !== 'active' || p.turn > turn);
        },
        now.turn,
        { timeout: 15_000 },
      );
      await page.waitForFunction((turn) => (window.__gunbrosMatch?.turn ?? 0) > turn, now.turn, { timeout: 60_000 });
      continue;
    }
    expect(now.activeSeat).toBe(botSeat);
    // The bot thinks for a second or two, may walk a few seconds, aims, charges and
    // fires: `active` ends on its `fire`, before the 20 s timer would end it.
    await page.waitForFunction(
      (turn) => {
        const p = window.__gunbrosMatch;
        return !!p && p.turn === turn && p.phase === 'resolving';
      },
      now.turn,
      { timeout: 20_000 },
    );
    botFired = true;
    // …and the turn changes hands once the shell has landed.
    await page.waitForFunction(
      (turn) => {
        const p = window.__gunbrosMatch;
        return !!p && (p.turn > turn || p.ended);
      },
      now.turn,
      { timeout: 60_000 },
    );
  }
  expect(botFired, 'the bot took a turn and fired').toBe(true);

  const after = await probe();
  expect(after.desyncs, 'no snapshot ever disagreed').toBe(0);
  expect(errors, 'no console errors or desync warnings').toEqual([]);
});
