/**
 * The touch controls (DESIGN §7 items 144-146).
 *
 * The parts worth pinning are the arithmetic: how fast a held arrow moves the angle,
 * how far a finger may slide and still count as a tap, and which widget the dial's drag
 * pad is allowed to steal a press from. None of that needs a browser, and all of it is
 * the difference between a control that feels right and one that does not.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clientConstants } from '../src/data/clientConstants.js';
import { aimHoldFactor, isTap, PointerInput } from '../src/input/pointer.js';
import type { PointerSample } from '../src/input/pointer.js';
import { releaseOutcome } from '../src/input/pointerRole.js';
import type { PointerRole } from '../src/input/pointerRole.js';
import { bottomBarLayout, hudHitTest } from '../src/render/hud.js';
import { viewSizeFor } from '../src/render/viewSize.js';

function sample(x: number, y: number): PointerSample {
  return { id: 1, x, y, startX: x, startY: y, startedAt: 0, cancelled: false, touch: true };
}

describe('the aim hold ramp', () => {
  const a = clientConstants.input.aimHold;

  it('starts at the designed rate, so a short press is still a nudge', () => {
    expect(aimHoldFactor(0)).toBe(1);
    expect(aimHoldFactor(a.accelFromMs)).toBe(1);
    expect(aimHoldFactor(a.accelFromMs - 1)).toBe(1);
  });

  it('ramps to the cap and holds there', () => {
    expect(aimHoldFactor(a.accelFromMs + a.rampMs / 2)).toBeCloseTo(1 + (a.maxFactor - 1) / 2, 6);
    expect(aimHoldFactor(a.accelFromMs + a.rampMs)).toBeCloseTo(a.maxFactor, 6);
    expect(aimHoldFactor(60_000)).toBeCloseTo(a.maxFactor, 6);
  });

  it('never goes backwards, and survives nonsense', () => {
    let previous = 0;
    for (let ms = 0; ms <= 3000; ms += 50) {
      const factor = aimHoldFactor(ms);
      expect(factor).toBeGreaterThanOrEqual(previous);
      previous = factor;
    }
    expect(aimHoldFactor(-100)).toBe(1);
    expect(aimHoldFactor(Number.NaN)).toBe(1);
  });

  it('crosses a whole angle range in a press a thumb will actually hold', () => {
    // armor is [-10, 70]: 80 degrees. At `aimDegPerTick` per tick and 60 ticks a
    // second, the ramp has to get that under a couple of seconds or the arrows are
    // decoration and only the drag pad is usable.
    const perTick = clientConstants.input.aimDegPerTick;
    let degrees = 0;
    let ms = 0;
    while (degrees < 80 && ms < 10_000) {
      degrees += perTick * aimHoldFactor(ms);
      ms += 1000 / 60;
    }
    expect(degrees).toBeGreaterThanOrEqual(80);
    expect(ms).toBeLessThan(2000);
  });
});

describe('tap versus drag', () => {
  it('forgives the wobble of a finger that meant to hold still', () => {
    const p = sample(100, 100);
    const slop = clientConstants.input.tapSlopPx;
    expect(isTap(p, 100, 100)).toBe(true);
    expect(isTap(p, 100 + slop, 100 - slop)).toBe(true);
    expect(isTap(p, 100 + slop + 0.01, 100)).toBe(false);
    expect(isTap(p, 100, 100 + slop + 0.01)).toBe(false);
  });

  it('calls a real drag a drag, so panning the map never fires a teleport', () => {
    expect(isTap(sample(200, 150), 260, 150)).toBe(false);
  });
});

describe('the angle drag pad', () => {
  it('answers a press on the dial, on every view', () => {
    for (const height of [360, 370, 450, 480, 600]) {
      const layout = bottomBarLayout({ width: 800, height }, true);
      const centre = {
        x: layout.dial.x + layout.dial.w / 2,
        y: layout.dial.y + layout.dial.h / 2,
      };
      expect(hudHitTest(layout, centre.x, centre.y), `dial at ${height}`).toEqual({ kind: 'aim' });
    }
  });

  it('never steals a press from a button it overlaps', () => {
    // The pad is offered every point last, so a widget whose rectangle shares a pixel
    // with the dial's block still wins it.
    for (const height of [360, 370, 450, 600]) {
      const layout = bottomBarLayout({ width: 800, height }, true);
      const buttons = [
        { name: 'angleUp', rect: layout.angleUp },
        { name: 'angleDown', rect: layout.angleDown },
        { name: 'moveLeft', rect: layout.moveLeft },
        { name: 'moveRight', rect: layout.moveRight },
        { name: 'fire', rect: layout.fire },
        { name: 'skip', rect: layout.skip },
        ...layout.shots.map((s) => ({ name: `shot ${s.shot}`, rect: s.rect })),
      ];
      for (const b of buttons) {
        const hit = hudHitTest(layout, b.rect.x + b.rect.w / 2, b.rect.y + b.rect.h / 2);
        expect(hit?.kind, `${b.name} at ${height}`).not.toBe('aim');
      }
    }
  });

  it('is a thumb-sized pad on a landscape phone', () => {
    const layout = bottomBarLayout(viewSizeFor(844, 390), true);
    expect(layout.variant).toBe('compact');
    // 844 CSS px over an 800 px buffer is a scale just above 1, so backbuffer px are
    // CSS px here: the pad has to be a real target, not a decoration.
    expect(layout.dial.w).toBeGreaterThanOrEqual(44);
    expect(layout.dial.h).toBeGreaterThanOrEqual(44);
  });

  it('sweeps the whole range of any mobile in one comfortable drag', () => {
    // The widest range in the roster is 80 degrees (armor). A drag pad that needed more
    // than the bar is tall would be a control you cannot finish.
    const perPx = clientConstants.input.aimDragDegPerPx;
    const layout = bottomBarLayout(viewSizeFor(844, 390), true);
    expect(80 / perPx).toBeLessThanOrEqual(layout.view.height - layout.bar.h);
  });
});

describe('the hooks that run inside the event handlers', () => {
  // The module is DOM code, but only a sliver of the DOM: an element that takes
  // listeners, a window, and a document whose focused element can be blurred. Faked
  // here so the one thing a real browser test cannot see — *which call stack* a hook
  // runs in — is pinned (DESIGN §7 item 166).
  type Listener = (e: unknown) => void;
  const listeners = new Map<string, Listener>();
  const canvas = {
    addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
    removeEventListener: (type: string) => listeners.delete(type),
  };
  let blurred = 0;
  const field = {
    tagName: 'INPUT',
    isContentEditable: false,
    blur: () => {
      blurred++;
    },
  };

  function fire(type: string, x: number, y: number): void {
    listeners.get(type)?.({
      type,
      pointerId: 7,
      pointerType: 'touch',
      button: 0,
      clientX: x,
      clientY: y,
      preventDefault: () => undefined,
    });
  }

  function mount(onRelease: (x: number, y: number) => void, gestures: string[]): PointerInput {
    class FakeElement {}
    Object.setPrototypeOf(field, FakeElement.prototype);
    vi.stubGlobal('HTMLElement', FakeElement);
    vi.stubGlobal('document', { activeElement: field });
    vi.stubGlobal('window', {
      addEventListener: (type: string, fn: Listener) => listeners.set(`window:${type}`, fn),
      removeEventListener: (type: string) => listeners.delete(`window:${type}`),
    });
    blurred = 0;
    const input = new PointerInput();
    input.attach(canvas as unknown as HTMLElement, (x, y) => ({ x, y }), {
      onGesture: () => gestures.push('gesture'),
      // The "chat button" is everything left of x = 100.
      keepsFocus: (p) => p.x < 100,
      onRelease: (p) => onRelease(p.x, p.y),
    });
    return input;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    listeners.clear();
  });

  it('keeps the chat line focused through a press on its own button, and acts on the release', () => {
    const released: number[][] = [];
    const gestures: string[] = [];
    const input = mount((x, y) => released.push([x, y]), gestures);
    fire('pointerdown', 50, 20);
    expect(blurred, 'the press on the chat button leaves the field alone').toBe(0);
    expect(released, 'nothing happens on the press').toEqual([]);
    fire('pointerup', 52, 21);
    expect(released, 'the release runs in the handler, not on a frame').toEqual([[52, 21]]);
    // The unlock runs on both halves: the release is the gesture a finger makes.
    expect(gestures).toEqual(['gesture', 'gesture']);
    input.detach();
  });

  it('closes the keyboard on a press anywhere else, and never acts on a cancel', () => {
    const released: number[][] = [];
    const input = mount((x, y) => released.push([x, y]), []);
    fire('pointerdown', 300, 200);
    expect(blurred, 'a press on the game takes the focus away').toBe(1);
    fire('pointercancel', 300, 200);
    expect(released, 'a cancelled pointer is not a tap').toEqual([]);
    // The cancel is still a release as far as the holds are concerned, but marked as
    // one, so the frame loop commits nothing on it either (DESIGN §7 item 168).
    expect(input.ups.length).toBe(1);
    expect(input.ups[0]?.cancelled).toBe(true);
    input.detach();
  });

  it('marks a real release as not cancelled', () => {
    const input = mount(() => undefined, []);
    fire('pointerdown', 300, 200);
    fire('pointerup', 301, 200);
    expect(input.ups.map((p) => p.cancelled)).toEqual([false]);
    input.detach();
  });

  it('ends every finger as cancelled when the window is lost', () => {
    const input = mount(() => undefined, []);
    fire('pointerdown', 300, 200);
    listeners.get('window:blur')?.({});
    expect(input.ups.map((p) => p.cancelled)).toEqual([true]);
    expect(input.active.size).toBe(0);
    input.detach();
  });

  it('keeps the last real position through a cancel, whose coordinates are junk', () => {
    const input = mount(() => undefined, []);
    fire('pointerdown', 300, 200);
    fire('pointercancel', 0, 0);
    expect(input.ups[0]).toMatchObject({ x: 300, y: 200, cancelled: true });
    input.detach();
  });
});

describe('what the end of a pointer means', () => {
  // The frame loop's release handling, pure (DESIGN §7 items 162 and 168). A cancelled
  // pointer — an edge swipe, the home indicator next to FIRE, a notification, a call —
  // must clear its holds and commit nothing.
  const frame = 10;
  const released = (x = 300, y = 200): PointerSample => sample(x, y);
  const cancelled = (x = 300, y = 200): PointerSample => ({ ...sample(x, y), cancelled: true });
  const fireRole: PointerRole = { kind: 'fire', frame: frame - 5 };

  it('never fires a shot on a cancelled FIRE: it aborts the charge', () => {
    expect(releaseOutcome(fireRole, cancelled(), frame)).toEqual({ kind: 'abortCharge' });
    // Even one that went down this very frame.
    expect(releaseOutcome({ kind: 'fire', frame }, cancelled(), frame)).toEqual({ kind: 'abortCharge' });
  });

  it('leaves a released FIRE to the charge, and names a release that came too soon', () => {
    expect(releaseOutcome(fireRole, released(), frame)).toEqual({ kind: 'none' });
    expect(releaseOutcome({ kind: 'fire', frame }, released(), frame)).toEqual({ kind: 'fireTooShort' });
  });

  it('never spends an item on a cancel', () => {
    const role: PointerRole = { kind: 'item', index: 2 };
    expect(releaseOutcome(role, cancelled(), frame)).toEqual({ kind: 'none' });
    expect(releaseOutcome(role, released(), frame)).toEqual({ kind: 'useItem', index: 2 });
    const slid = { ...sample(300, 200), x: 360 };
    expect(releaseOutcome(role, slid, frame), 'sliding off backs out').toEqual({ kind: 'none' });
  });

  it('never commits a teleport spot on a cancel', () => {
    const role: PointerRole = { kind: 'target' };
    expect(releaseOutcome(role, cancelled(), frame)).toEqual({ kind: 'none' });
    expect(releaseOutcome(role, released(420, 130), frame)).toEqual({ kind: 'commitTarget', x: 420, y: 130 });
  });

  it('hands the camera back however a started drag ended', () => {
    const started: PointerRole = { kind: 'drag', startX: 0, startY: 0, started: true };
    const idle: PointerRole = { kind: 'drag', startX: 0, startY: 0, started: false };
    expect(releaseOutcome(started, cancelled(), frame)).toEqual({ kind: 'endDrag' });
    expect(releaseOutcome(started, released(), frame)).toEqual({ kind: 'endDrag' });
    expect(releaseOutcome(idle, released(), frame)).toEqual({ kind: 'none' });
  });

  it('does nothing on the release of a hold or a tap, cancelled or not', () => {
    const holds: PointerRole[] = [
      { kind: 'tap' },
      { kind: 'angle', delta: 1 },
      { kind: 'move', dir: -1 },
      { kind: 'aim', startY: 0, startAngle: 0 },
    ];
    for (const role of holds) {
      expect(releaseOutcome(role, released(), frame)).toEqual({ kind: 'none' });
      expect(releaseOutcome(role, cancelled(), frame)).toEqual({ kind: 'none' });
    }
  });
});
