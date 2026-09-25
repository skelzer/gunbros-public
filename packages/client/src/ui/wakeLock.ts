/**
 * The screen wake lock (DESIGN §7 item 151).
 *
 * A turn-based game is long stretches of watching somebody else play, which is exactly
 * the input pattern a phone reads as "nobody is here" before it dims and locks. The
 * Screen Wake Lock API says otherwise for as long as a match is on screen.
 *
 * The lock is dropped by the browser whenever the tab is hidden — switching apps, the
 * screen locking anyway — and is *not* given back on return, so the `visibilitychange`
 * re-request is not an optimisation but the difference between the lock lasting one
 * app-switch and lasting the match.
 *
 * Unsupported (Safari before 16.4, any browser with the feature off) is a no-op: this is
 * a comfort, not a requirement.
 */

interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

function api(): WakeLockLike | undefined {
  return (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
}

export interface WakeLockHandle {
  /** Let the screen sleep again, and stop re-requesting. */
  release(): void;
}

/**
 * Hold the screen awake until the returned handle is released.
 *
 * Returns synchronously: the request itself is a promise, but the caller (a scene being
 * mounted) has nothing to wait for and nothing to do if it fails.
 */
export function keepScreenAwake(): WakeLockHandle {
  let sentinel: WakeLockSentinelLike | null = null;
  let done = false;
  /** A request is in flight: a burst of taps must not queue a request each. */
  let pending = false;

  const request = (): void => {
    if (done || pending || sentinel || document.visibilityState !== 'visible') return;
    const wakeLock = api();
    if (!wakeLock) return;
    pending = true;
    void wakeLock
      .request('screen')
      .finally(() => {
        pending = false;
      })
      .then((next) => {
        if (done) {
          void next.release();
          return;
        }
        sentinel = next;
        // The browser releases it on its own when the tab is hidden; forget it so the
        // next visibility change asks for a fresh one rather than holding a dead handle.
        next.addEventListener('release', () => {
          if (sentinel === next) sentinel = null;
        });
      })
      .catch(() => {
        // Refused (no user gesture yet, battery saver, policy). Try again on the next
        // visibility change; a match with no wake lock still plays perfectly.
      });
  };

  const onVisibility = (): void => {
    if (document.visibilityState === 'visible') request();
  };

  document.addEventListener('visibilitychange', onVisibility);
  // A browser that wants a user gesture for the lock refuses the request made when the
  // scene mounts; the next tap on the game is one, so ask again then (a no-op while
  // the lock is held).
  document.addEventListener('pointerup', request, { passive: true });
  request();

  return {
    release(): void {
      if (done) return;
      done = true;
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('pointerup', request);
      const held = sentinel;
      sentinel = null;
      if (held && !held.released) void held.release().catch(() => undefined);
    },
  };
}
