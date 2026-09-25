/**
 * The same match, played with fingers (DESIGN §7 items 144-149, §10).
 *
 * `smoke.spec.ts` drives the game from the keyboard, which is the one input path the
 * brother this pass is for does not have. Two emulated iPhone 13s in landscape play
 * three turns here without a single key press: hold a walk arrow, hold FIRE, let go.
 *
 * Three things are asserted that only a touch run can see.
 *
 * - **Every walk stops.** The client sends `move dir: ±1` when the arrow goes down and
 *   `move dir: 0` when it comes up, and the second one used to go missing from the
 *   second walk of a match onwards: the held controls were read inside the tick loop,
 *   the tick loop stops at the authority's clock, and while the mobile walks the
 *   authority's own echoes pin the local clock to exactly that (DESIGN §7 item 154).
 *   The mobile then walked until the whole gauge was spent with no way to stop it. A
 *   `move` frame with no `dir: 0` after it is that bug, so the socket is read directly.
 * - **The two engines stay equal.** A turn with a real walk in it produced exactly one
 *   desync per client per match, in a single field (`moveGauge`) that nothing on screen
 *   shows, and the keyboard suite never caught it because it depends on how the clocks
 *   happen to line up (DESIGN §7 item 156).
 * - **The controls are finger-sized.** The walk arrows are measured on the live canvas,
 *   in CSS px, through the debug probe's `hudRect`.
 */
import { devices, expect, test } from '@playwright/test';
import type { BrowserContext, CDPSession, ConsoleMessage, Page } from '@playwright/test';

// The probe's shape, and the `window.__gunbrosMatch` / `window.__sent` declarations.
import type { ControlName, Rect, SentFrame } from './probe.js';

// An iPhone 13 lying on its side, as Playwright describes it: 750x342, which is what a
// notched iPhone actually leaves the page once the safe-area padding and Safari's bar are
// taken off its 844x390 glass. The canvas is drawn at 0.9375 there, not a shade over 1,
// which is the case the HUD's 44 px targets have to survive (DESIGN §7 item 165).
// `isMobile` and `hasTouch` are what make the page answer `(pointer: coarse)`, which is
// what puts the HUD in its compact variant. The browser type is the project's: only the
// viewport and the touch screen are borrowed.
const { defaultBrowserType: _browser, ...iphone13 } = devices['iPhone 13 landscape'];
test.use(iphone13);

/** Every control `hudRect` answers for, all of which a thumb presses. */
const CONTROLS: readonly ControlName[] = [
  'fire',
  'skip',
  'moveLeft',
  'moveRight',
  'angleUp',
  'angleDown',
  'dial',
  's1',
  's2',
  'ss',
  'mute',
  'help',
  'chat',
  'item0',
  'item1',
  'item2',
  'item3',
  'item4',
  'item5',
];

/** Record every frame this page sends, before the app opens its socket. */
async function installSocketLog(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const sent: SentFrame[] = [];
    window.__sent = sent;
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (this: WebSocket, data: string): void {
      try {
        const frame = JSON.parse(data) as { t: string; dir?: number };
        sent.push({ at: Math.round(performance.now()), t: frame.t, dir: frame.dir });
      } catch {
        // Not our JSON: nothing to record.
      }
      send.call(this, data as string);
    };
  });
}

function watch(page: Page, label: string): { errors: string[]; desyncs: string[] } {
  const log = { errors: [] as string[], desyncs: [] as string[] };
  page.on('console', (msg: ConsoleMessage) => {
    const text = `[${label}] ${msg.text()}`;
    if (msg.type() === 'error') log.errors.push(text);
    if (text.includes('desync')) log.desyncs.push(text);
  });
  page.on('pageerror', (err: Error) => log.errors.push(`[${label}] ${err.message}`));
  return log;
}

/** Where a HUD control is on the page right now, in CSS px (`?debug=1` only). */
async function control(page: Page, name: ControlName): Promise<Rect> {
  const rect = await page.evaluate(
    (which) => window.__gunbrosMatch?.hudRect(which) ?? null,
    name,
  );
  expect(rect, `the ${name} control should be on screen`).not.toBeNull();
  return rect as Rect;
}

/**
 * Press and hold, with a real finger.
 *
 * `page.touchscreen.tap` is a touch down and up in one call, and every control this
 * test drives is a *hold*: the walk arrows and FIRE both do their work between the two
 * halves. CDP is the only way to send them apart.
 */
async function touchDown(cdp: CDPSession, rect: Rect): Promise<void> {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }],
  });
}

async function touchUp(cdp: CDPSession): Promise<void> {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** The browser takes the finger away: an edge swipe, the home indicator, a call. */
async function touchCancel(cdp: CDPSession): Promise<void> {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
}

async function waitForActiveTurn(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__gunbrosMatch?.phase === 'active', undefined, {
    timeout: 30_000,
  });
}

/**
 * Every `move` frame this page sent, paired up: a direction and the stop that followed
 * it. A walk with no stop is the bug this test exists for.
 */
function unstoppedWalks(frames: SentFrame[]): SentFrame[] {
  const moves = frames.filter((f) => f.t === 'move');
  const unstopped: SentFrame[] = [];
  for (let i = 0; i < moves.length; i++) {
    const move = moves[i];
    if (!move || move.dir === 0) continue;
    const next = moves[i + 1];
    if (!next || next.dir !== 0) unstopped.push(move);
  }
  return unstopped;
}

test('two phones play three turns with nothing but fingers', async ({ browser }) => {
  const contexts: BrowserContext[] = [await browser.newContext(), await browser.newContext()];
  const [hostCtx, guestCtx] = contexts as [BrowserContext, BrowserContext];

  try {
    const host = await hostCtx.newPage();
    const guest = await guestCtx.newPage();
    const logs = [watch(host, 'host'), watch(guest, 'guest')];
    await installSocketLog(host);
    await installSocketLog(guest);
    const cdp: CDPSession[] = [
      await hostCtx.newCDPSession(host),
      await guestCtx.newCDPSession(guest),
    ];

    // --- into a room, with taps ----------------------------------------------
    await host.goto('/?debug=1');
    await host.getByPlaceholder('your name').fill('Alfa');
    await host.getByRole('button', { name: 'Create room' }).tap();
    const code = (await host.locator('.code-box .code').innerText()).trim();

    await guest.goto(`/r/${code}?debug=1`);
    await guest.getByPlaceholder('your name').fill('Bravo');
    await guest.getByRole('button', { name: 'Join', exact: true }).tap();
    for (const page of [host, guest]) {
      await expect(page.locator('.players .player')).toHaveCount(2);
    }

    // The room's own blocker: the Ready/Start row used to float over the item shelf, so
    // a tap meant for Teleport pressed Ready — or, on the host, started the match
    // (DESIGN §7 item 161). Ask the document what is actually on top of the shelf at
    // the scroll position the screen opens on, which is what a thumb would hit.
    for (const page of [host, guest]) {
      const covered = await page.evaluate(() => {
        const shelf = Array.from(document.querySelectorAll('.btn.item-pick'));
        return shelf
          .map((node) => {
            const box = node.getBoundingClientRect();
            // Only the ones a thumb could reach without scrolling anything: the shelf
            // scrolls sideways, so most of the eight are off the right-hand edge.
            const onScreen =
              box.width > 0 &&
              box.top >= 0 &&
              box.bottom <= window.innerHeight &&
              box.left >= 0 &&
              box.right <= window.innerWidth;
            if (!onScreen) return null;
            const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
            return node.contains(top) || node === top ? null : (node.textContent ?? '?');
          })
          .filter((name) => name !== null);
      });
      expect(covered, 'every visible item button answers its own centre').toEqual([]);
    }

    // A fling past the end of the room stays in the room. The visually hidden labels
    // used to hang off `#app` and make it scrollable, so a thumb that reached the bottom
    // of the setup card carried on into `#app` and slid the whole screen off into an
    // empty board.
    for (let i = 0; i < 4; i++) {
      await cdp[1]?.send('Input.synthesizeScrollGesture', {
        x: 300,
        y: 250,
        yDistance: -400,
        speed: 3000,
        gestureSourceType: 'touch',
      });
    }
    // Whether a synthesized fling actually scrolls depends on the compositor: it does
    // locally and does nothing on CI's headless Linux Chromium. So the room is checked
    // for having something to scroll, not for having scrolled, and the assertion that
    // guards the bug is the second one: `#app` never moves.
    const scrolled = await guest.evaluate(() => {
      const menu = document.querySelector('.menu');
      return {
        app: document.getElementById('app')?.scrollTop ?? -1,
        menuOverflow: menu ? menu.scrollHeight - menu.clientHeight : -1,
      };
    });
    expect(scrolled.menuOverflow, 'the room has more than a screen to scroll').toBeGreaterThan(0);
    expect(scrolled.app, 'the screen behind it did not scroll').toBe(0);

    await guest.getByRole('button', { name: 'Ready' }).tap();
    await host.getByRole('button', { name: 'Ready' }).tap();
    const start = host.getByRole('button', { name: 'Start match' });
    await expect(start).toBeEnabled();
    await start.tap();

    const pages = [host, guest];
    for (const page of pages) await waitForActiveTurn(page);

    // --- the controls are finger-sized ---------------------------------------
    // Every one of them, on the 750 px canvas: the arrows, toggles, item slots and SKIP
    // were 39-43 CSS px here before they were grown to 47 backbuffer px.
    for (const name of CONTROLS) {
      const rect = await control(host, name);
      expect(rect.w, `${name} width in CSS px`).toBeGreaterThanOrEqual(44);
      expect(rect.h, `${name} height in CSS px`).toBeGreaterThanOrEqual(44);
    }

    // --- the chat button opens the line, and closes it ------------------------
    // It acts on the release, inside the handler, because that is the only place iOS
    // raises the keyboard for a focus (DESIGN §7 item 166); and a second tap closes it,
    // which it could not do while every press on the canvas blurred the field first.
    const chatOpen = (page: Page): Promise<boolean> =>
      page.evaluate(() => {
        const row = document.querySelector<HTMLElement>('.chat-overlay .chat-row');
        const input = document.querySelector('.chat-overlay .chat-input');
        return !!row && !row.hidden && document.activeElement === input;
      });
    const chatKey = await control(guest, 'chat');
    await guest.touchscreen.tap(chatKey.x + chatKey.w / 2, chatKey.y + chatKey.h / 2);
    await expect.poll(() => chatOpen(guest), { message: 'the tap opened the chat line' }).toBe(true);
    await guest.keyboard.type('hi from a thumb');
    await guest.keyboard.press('Enter');
    await expect(host.locator('.chat-overlay .chat-log')).toContainText('hi from a thumb');
    await guest.touchscreen.tap(chatKey.x + chatKey.w / 2, chatKey.y + chatKey.h / 2);
    await expect.poll(() => chatOpen(guest), { message: 'the second tap closed it' }).toBe(false);

    // --- three turns, every one of them a walk and a charge ------------------
    for (let turn = 0; turn < 3; turn++) {
      for (const page of pages) await waitForActiveTurn(page);
      const active = await host.evaluate(() => window.__gunbrosMatch?.activeSeat ?? -1);
      const seats = await Promise.all(
        pages.map((page) => page.evaluate(() => window.__gunbrosMatch?.seat ?? -1)),
      );
      const index = seats.indexOf(active);
      expect(index, 'the active seat is on one of the two phones').toBeGreaterThanOrEqual(0);
      const shooter = pages[index] as Page;
      const finger = cdp[index] as CDPSession;
      const turnBefore = await shooter.evaluate(() => window.__gunbrosMatch?.turn ?? -1);

      // Hold a walk arrow for the best part of a second, then let go. The release is
      // the half that went missing.
      await touchDown(finger, await control(shooter, 'moveRight'));
      await shooter.waitForTimeout(800);
      await touchUp(finger);
      await shooter.waitForTimeout(300);

      // Hold FIRE until the bar has actually moved, then let go: the release fires.
      await touchDown(finger, await control(shooter, 'fire'));
      await shooter.waitForFunction(() => (window.__gunbrosMatch?.power ?? 0) > 0, undefined, {
        timeout: 15_000,
      });
      await shooter.waitForTimeout(900);
      await touchUp(finger);

      for (const page of pages) {
        await page.waitForFunction(
          (before) => {
            const probe = window.__gunbrosMatch;
            return !!probe && probe.turn > before && probe.phase === 'active';
          },
          turnBefore,
          { timeout: 60_000 },
        );
      }
    }

    // --- a cancelled FIRE never shoots ----------------------------------------
    // iOS cancels a touch for an edge swipe, the home indicator right beside FIRE, a
    // notification or a call. That used to be read as a release, and fired a half-charged
    // shot the player never let go of (DESIGN §7 item 168).
    {
      for (const page of pages) await waitForActiveTurn(page);
      const active = await host.evaluate(() => window.__gunbrosMatch?.activeSeat ?? -1);
      const seats = await Promise.all(
        pages.map((page) => page.evaluate(() => window.__gunbrosMatch?.seat ?? -1)),
      );
      const index = seats.indexOf(active);
      const shooter = pages[index] as Page;
      const finger = cdp[index] as CDPSession;
      const fires = (): Promise<number> =>
        shooter.evaluate(() => (window.__sent ?? []).filter((f) => f.t === 'fire').length);
      const firesBefore = await fires();
      const turnBefore = await shooter.evaluate(() => window.__gunbrosMatch?.turn ?? -1);
      await touchDown(finger, await control(shooter, 'fire'));
      await shooter.waitForFunction(() => (window.__gunbrosMatch?.power ?? 0) > 0.05, undefined, {
        timeout: 15_000,
      });
      await touchCancel(finger);
      await expect
        .poll(() => shooter.evaluate(() => window.__gunbrosMatch?.power ?? -1), {
          message: 'the cancel threw the charge away',
        })
        .toBe(0);
      await shooter.waitForTimeout(500);
      expect(await fires(), 'a cancelled FIRE sent no fire').toBe(firesBefore);
      const after = await shooter.evaluate(() => ({
        turn: window.__gunbrosMatch?.turn ?? -1,
        phase: window.__gunbrosMatch?.phase ?? '',
      }));
      expect(after, 'the turn is still the shooter\'s to take').toEqual({
        turn: turnBefore,
        phase: 'active',
      });
    }

    // --- what the socket saw --------------------------------------------------
    for (const [label, page] of [['host', host], ['guest', guest]] as const) {
      const frames = await page.evaluate(() => window.__sent ?? []);
      const moves = frames.filter((f) => f.t === 'move');
      expect(moves.length, `${label}: the walks reached the wire`).toBeGreaterThan(0);
      expect(
        unstoppedWalks(frames),
        `${label}: every walk is followed by a stop`,
      ).toEqual([]);
      // And the stop follows the release, not the end of the gauge.
      for (let i = 0; i < moves.length; i += 2) {
        const walk = moves[i];
        const stop = moves[i + 1];
        if (!walk || !stop) continue;
        expect(stop.at - walk.at, `${label}: the walk lasted as long as the press`).toBeLessThan(
          1500,
        );
      }
    }

    for (const [label, page] of [['host', host], ['guest', guest]] as const) {
      const probe = await page.evaluate(() => {
        const p = window.__gunbrosMatch;
        return p ? { desyncs: p.desyncs, completedTurns: p.completedTurns, ended: p.ended } : null;
      });
      expect(probe, `${label}: the probe exists`).not.toBeNull();
      // The console line names the fields that differed (`PlaybackResult.diff`), so a
      // failure here says what desynced rather than only that something did.
      const said = logs.flatMap((l) => l.desyncs).join(' | ');
      expect(probe?.desyncs, `${label}: no snapshot ever disagreed — ${said}`).toBe(0);
      expect(probe?.completedTurns, `${label}: three turns finished`).toBeGreaterThanOrEqual(3);
      expect(probe?.ended, `${label}: the match is still running`).toBe(false);
    }

    for (const log of logs) {
      expect(log.desyncs, 'no desync was logged').toEqual([]);
      expect(log.errors, 'no console errors').toEqual([]);
    }
  } finally {
    for (const context of contexts) await context.close();
  }
});
