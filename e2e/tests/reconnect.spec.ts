/**
 * Leaving and losing the connection around a match (review fixes, 2026-09-23).
 *
 * Each page's socket runs through `routeWebSocket`, so a test can cut it like a dropped
 * Wi-Fi link: the live socket closes and every reconnect attempt is refused until the
 * link is restored. The server sees an ordinary disconnect and keeps the seat for the
 * reconnect grace.
 *
 * 1. The match ends while a player is away: on reconnect the server only replays the
 *    room (phase back to lobby). The match scene has to say the match is over instead of
 *    carrying on against nobody.
 * 2. A player forfeits while offline: the queued `leaveRoom` goes out after `hello`, and
 *    the server's replay of the room and match must not pull them back in.
 */
import { expect, test } from '@playwright/test';
import type { Browser, BrowserContext, Page, WebSocketRoute } from '@playwright/test';
import type {} from './probe.js';

interface Link {
  cut(): Promise<void>;
  restore(): void;
}

async function switchableLink(page: Page): Promise<Link> {
  let online = true;
  let live: { client: WebSocketRoute; server: WebSocketRoute }[] = [];
  await page.routeWebSocket(/\/ws$/, (client) => {
    if (!online) {
      void client.close({ code: 4001, reason: 'offline (test)' });
      return;
    }
    const server = client.connectToServer();
    live.push({ client, server });
  });
  return {
    async cut() {
      online = false;
      const dropping = live;
      live = [];
      for (const { client, server } of dropping) {
        await server.close({ code: 4001, reason: 'offline (test)' });
        await client.close({ code: 4001, reason: 'offline (test)' });
      }
    },
    restore() {
      online = true;
    },
  };
}

interface Pair {
  contexts: BrowserContext[];
  host: Page;
  guest: Page;
  hostLink: Link;
  guestLink: Link;
}

async function startMatch(browser: Browser): Promise<Pair> {
  const contexts = [await browser.newContext(), await browser.newContext()];
  const [hostCtx, guestCtx] = contexts as [BrowserContext, BrowserContext];
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();
  const hostLink = await switchableLink(host);
  const guestLink = await switchableLink(guest);

  await host.goto('/?debug=1');
  await host.getByPlaceholder('your name').fill('Alfa');
  await host.getByRole('button', { name: 'Create room' }).click();
  const code = (await host.locator('.code-box .code').innerText()).trim();

  await guest.goto(`/r/${code}?debug=1`);
  await guest.getByPlaceholder('your name').fill('Bravo');
  await guest.getByRole('button', { name: 'Join', exact: true }).click();
  for (const page of [host, guest]) await expect(page.locator('.players .player')).toHaveCount(2);

  await guest.getByRole('button', { name: 'Ready' }).click();
  await host.getByRole('button', { name: 'Ready' }).click();
  await host.getByRole('button', { name: 'Start match' }).click();
  for (const page of [host, guest]) {
    await page.waitForFunction(() => window.__gunbrosMatch?.phase === 'active', undefined, {
      timeout: 30_000,
    });
  }
  return { contexts, host, guest, hostLink, guestLink };
}

test('a player who comes back after the match ended sees it is over', async ({ browser }) => {
  const { contexts, host, guest, guestLink } = await startMatch(browser);
  try {
    await guestLink.cut();
    await host.getByRole('button', { name: 'Forfeit & leave' }).click();
    await expect(host.getByRole('button', { name: 'Create room' })).toBeVisible();

    guestLink.restore();
    await expect(guest.locator('.end-title')).toHaveText('MATCH OVER', { timeout: 30_000 });
    await guest.getByRole('button', { name: 'Back to the room' }).click();
    await expect(guest.locator('.players .player')).toHaveCount(1);
  } finally {
    for (const context of contexts) await context.close();
  }
});

test('forfeiting while offline is not undone by the reconnect', async ({ browser }) => {
  const { contexts, host, guest, hostLink } = await startMatch(browser);
  try {
    await hostLink.cut();
    await host.getByRole('button', { name: 'Forfeit & leave' }).click();
    await expect(host.getByRole('button', { name: 'Create room' })).toBeVisible();

    hostLink.restore();
    // The opponent is told the match is over once the queued leave reaches the server...
    await expect(guest.locator('.end-title')).toHaveText('YOU WIN', { timeout: 30_000 });
    // ...and the player who left is still in the lobby, not back in the room or match.
    await expect(host.locator('.players .player')).toHaveCount(0);
    expect(await host.evaluate(() => window.__gunbrosMatch === undefined)).toBe(true);
    await expect(host.getByRole('button', { name: 'Create room' })).toBeVisible();
  } finally {
    for (const context of contexts) await context.close();
  }
});
