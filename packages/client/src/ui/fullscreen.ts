/**
 * Fullscreen and the orientation lock (DESIGN §7 item 150).
 *
 * A phone browser spends a third of a landscape screen on its own chrome, and this game
 * is 800 px of HUD across. One button in the lobby asks for the whole glass and, where
 * the browser allows it, pins the rotation to landscape so a phone put down flat does
 * not spin the board.
 *
 * Every part of it is optional and every part of it is refused somewhere: iOS Safari has
 * no `requestFullscreen` on an element it does not own and no orientation lock at all,
 * and a lock outside fullscreen throws on Chrome. So every call is guarded and every
 * rejection is swallowed — the button is a convenience, never a gate.
 */

interface OrientationLock {
  lock?(orientation: string): Promise<void>;
  unlock?(): void;
}

/** Is this browser able to do anything at all with the button? */
export function fullscreenSupported(): boolean {
  return typeof document.documentElement.requestFullscreen === 'function';
}

export function isFullscreen(): boolean {
  return document.fullscreenElement !== null;
}

/**
 * Ask for the whole screen, then for landscape. Resolves either way: what the browser
 * refused is not worth telling the player about, because the game works without it.
 */
export async function enterFullscreen(): Promise<void> {
  try {
    if (document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    }
  } catch {
    // Refused (a gesture the browser did not count, or an iframe without the permission).
  }
  const orientation: OrientationLock | undefined = window.screen?.orientation;
  try {
    await orientation?.lock?.('landscape');
  } catch {
    // No lock on this platform, or the browser wants fullscreen first and did not get it.
  }
}

/** Give the screen back. Also drops the orientation lock, which outlives fullscreen. */
export async function exitFullscreen(): Promise<void> {
  const orientation: OrientationLock | undefined = window.screen?.orientation;
  try {
    orientation?.unlock?.();
  } catch {
    // Never locked.
  }
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
  } catch {
    // Already gone.
  }
}
