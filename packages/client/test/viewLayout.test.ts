/**
 * The view size and the HUD layout that hangs off it (DESIGN §7 items 142-143).
 *
 * All of it is arithmetic on two numbers — how wide the window is and how tall — which
 * is why it is here and not in a screenshot: a bar that starts four pixels below the
 * bottom of a phone's screen looks *fine* in every desktop screenshot ever taken, and a
 * walk arrow that comes out 18 CSS px is only a bug when a thumb is involved.
 */
import { describe, expect, it } from 'vitest';
import { clientConstants, belowOrderPanelY, hudVariantFor } from '../src/data/clientConstants.js';
import { canvasFit, viewSizeFor } from '../src/render/viewSize.js';
import {
  bottomBarLayout,
  hudBlocksDrag,
  hudHitTest,
  isOverBar,
  topClusterLayout,
  turnBannerPose,
} from '../src/render/hud.js';
import type { BottomBarLayout, Rect } from '../src/render/hud.js';

/** The screens this pass is aimed at, in CSS px. */
const SCREENS = {
  desktop: { w: 1600, h: 1200, dpr: 1, touch: false },
  laptop: { w: 1440, h: 780, dpr: 2, touch: false },
  ipadLandscape: { w: 1180, h: 820, dpr: 2, touch: true },
  pixel7Landscape: { w: 915, h: 412, dpr: 2.625, touch: true },
  iphone13Landscape: { w: 844, h: 390, dpr: 3, touch: true },
  /**
   * What a notched iPhone 13 actually gives the canvas in landscape: the page's
   * safe-area padding takes 47 px off each side (Playwright's 'iPhone 13 landscape'
   * descriptor is this viewport). A scale of 0.9375, not a shade over 1.
   */
  iphone13Notched: { w: 750, h: 342, dpr: 3, touch: true },
  /** The same phone with the home indicator's 21 px taken off the bottom as well. */
  iphone13NotchedInset: { w: 750, h: 369, dpr: 3, touch: true },
  iphoneSeLandscape: { w: 667, h: 375, dpr: 2, touch: true },
} as const;

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

/** Every rectangle inside the bar, named, in the order the hit test walks them. */
function barWidgets(layout: BottomBarLayout): { name: string; rect: Rect }[] {
  const widgets = [
    { name: 'dial', rect: layout.dial },
    { name: 'angleUp', rect: layout.angleUp },
    { name: 'angleDown', rect: layout.angleDown },
    { name: 'gauge', rect: layout.gauge },
    { name: 'moveLeft', rect: layout.moveLeft },
    { name: 'moveRight', rect: layout.moveRight },
    { name: 'power', rect: layout.power },
    { name: 'fire', rect: layout.fire },
    { name: 'skip', rect: layout.skip },
    { name: 'portrait', rect: layout.portrait },
  ];
  for (const shot of layout.shots) widgets.push({ name: `shot ${shot.shot}`, rect: shot.rect });
  for (let i = 0; i < layout.items.length; i++) {
    const r = layout.items[i];
    if (r) widgets.push({ name: `item ${i}`, rect: r });
  }
  return widgets;
}

describe('the internal resolution', () => {
  it('keeps 800x600 for a window at or above 4:3', () => {
    expect(viewSizeFor(1600, 1200)).toEqual({ width: 800, height: 600 });
    expect(viewSizeFor(1024, 768)).toEqual({ width: 800, height: 600 });
    // Taller than 4:3 (a portrait window) is clamped rather than grown.
    expect(viewSizeFor(500, 900)).toEqual({ width: 800, height: 600 });
  });

  it('follows the aspect of a landscape phone, to the pixel', () => {
    // 19.5:9 — the iPhone 13 family.
    expect(viewSizeFor(844, 390)).toEqual({ width: 800, height: 370 });
    // 20:9 — the Pixel 7 — lands exactly on the floor, so nothing is letterboxed.
    expect(viewSizeFor(915, 412)).toEqual({ width: 800, height: 360 });
    expect(viewSizeFor(667, 375)).toEqual({ width: 800, height: 450 });
    expect(viewSizeFor(1180, 820)).toEqual({ width: 800, height: 556 });
  });

  it('floors the height rather than leaving the HUD no room', () => {
    const v = clientConstants.view;
    // 21:9 and wider: the only case that is letterboxed, and only top and bottom.
    expect(viewSizeFor(2100, 900).height).toBe(v.minHeightPx);
    expect(viewSizeFor(0, 0)).toEqual({ width: v.widthPx, height: v.maxHeightPx });
  });
});

describe('the canvas fit', () => {
  it('takes a whole number of device pixels on a desktop', () => {
    const s = SCREENS.desktop;
    const fit = canvasFit(s.w, s.h, viewSizeFor(s.w, s.h), s.dpr, true);
    expect(fit.scale).toBe(2);
    expect(fit.cssWidth).toBe(1600);
    expect(fit.cssHeight).toBe(1200);
  });

  it('counts those device pixels at the real ratio, not in CSS px', () => {
    // 3 device px at dpr 1.5 is a CSS scale of 2, which an integer CSS rule would miss.
    const view = { width: 800, height: 600 };
    expect(canvasFit(1700, 1210, view, 1.5, true).scale).toBe(2);
    expect(canvasFit(1200, 900, view, 1.5, true).scale).toBe(4 / 3);
  });

  it('fills the glass exactly on a touch screen', () => {
    for (const key of ['iphone13Landscape', 'pixel7Landscape', 'iphoneSeLandscape'] as const) {
      const s = SCREENS[key];
      const view = viewSizeFor(s.w, s.h);
      const fit = canvasFit(s.w, s.h, view, s.dpr, false);
      expect(fit.cssWidth, key).toBeLessThanOrEqual(s.w + 0.001);
      expect(fit.cssHeight, key).toBeLessThanOrEqual(s.h + 0.001);
      // One of the two axes is filled to the pixel; the other is at most one row short.
      expect(Math.max(fit.cssWidth / s.w, fit.cssHeight / s.h), key).toBeGreaterThan(0.999);
      expect(Math.min(fit.cssWidth / s.w, fit.cssHeight / s.h), key).toBeGreaterThan(0.99);
    }
  });

  it('scales below 1 when the window is narrower than the backbuffer', () => {
    const s = SCREENS.iphoneSeLandscape;
    const fit = canvasFit(s.w, s.h, viewSizeFor(s.w, s.h), s.dpr, false);
    expect(fit.scale).toBeLessThan(1);
    // Height-limited: 375 CSS px over a 450 px buffer is a tighter fit than 667 / 800.
    expect(fit.scale).toBeCloseTo(375 / 450, 5);
  });
});

describe('the HUD variant', () => {
  it('is the compact one on every touch screen, a tablet included', () => {
    // A tablet used to keep the full HUD, whose toggles and walk keys come out 27-29
    // CSS px even at an iPad's 1.47 scale (DESIGN §7 item 165).
    expect(hudVariantFor(viewSizeFor(1180, 820).height, true)).toBe('compact');
    expect(hudVariantFor(viewSizeFor(1366, 1024).height, true)).toBe('compact');
    expect(hudVariantFor(viewSizeFor(844, 390).height, true)).toBe('compact');
    expect(hudVariantFor(viewSizeFor(915, 412).height, true)).toBe('compact');
    expect(hudVariantFor(viewSizeFor(667, 375).height, true)).toBe('compact');
  });

  it('is the full one on every window with a mouse, whatever its shape', () => {
    // 16:9 is the commonest desktop aspect there is, and the height rule alone put it
    // on a 800x450 buffer — inside the compact threshold. A keyboard player would have
    // lost the section captions, the move count and the 1-6 item digits with it.
    for (const [w, h] of [
      [1600, 1200],
      [1920, 1080],
      [1366, 768],
      [1280, 720],
      [900, 380],
    ] as const) {
      const view = viewSizeFor(w, h);
      expect(hudVariantFor(view.height, false), `${w}x${h}`).toBe('full');
      expect(bottomBarLayout(view, false).variant, `${w}x${h}`).toBe('full');
    }
  });

  it('leaves the top-left panels clear of the bar on the shortest view', () => {
    const view = { width: 800, height: clientConstants.view.minHeightPx };
    const layout = bottomBarLayout(view, true);
    expect(layout.variant).toBe('compact');
    expect(belowOrderPanelY('compact')).toBeLessThan(belowOrderPanelY('full'));
    // The debug panel starts at `belowPanelsY` and is eight lines of 12 px plus padding.
    const debugBottom = layout.belowPanelsY + clientConstants.sandbox.debugTopPx + 8 * 12 + 12;
    expect(debugBottom).toBeLessThan(layout.bar.y);
  });
});

describe('the bottom bar layout', () => {
  const heights = [360, 370, 412, 450, 480, 500, 556, 600];

  it('hangs off the bottom of every view, inside it', () => {
    for (const height of heights) {
      const view = { width: 800, height };
      const layout = bottomBarLayout(view, true);
      const screen: Rect = { x: 0, y: 0, w: view.width, h: view.height };
      expect(contains(screen, layout.bar), `bar in ${height}`).toBe(true);
      expect(layout.bar.y + layout.bar.h, `bar bottom at ${height}`).toBeLessThan(view.height);
      // Nothing above the bar may reach into it: the notice stack is the lowest of them.
      const notices = clientConstants.hud.notices;
      const noticesBottom = notices.topPx + notices.max * notices.bigLineHeightPx;
      expect(noticesBottom, `notices at ${height}`).toBeLessThan(layout.bar.y);
    }
  });

  it('keeps every widget inside the bar and off its neighbours', () => {
    for (const height of heights) {
      const layout = bottomBarLayout({ width: 800, height }, true);
      const widgets = barWidgets(layout);
      for (const w of widgets) {
        expect(contains(layout.bar, w.rect), `${w.name} inside the bar at ${height}`).toBe(true);
      }
      for (let i = 0; i < widgets.length; i++) {
        for (let j = i + 1; j < widgets.length; j++) {
          const a = widgets[i];
          const b = widgets[j];
          if (!a || !b) continue;
          // The dial's block holds the readout under the face, and the portrait sits in
          // the header strip above everything: neither is a button.
          if (a.name === 'dial' || b.name === 'dial') continue;
          if (a.name === 'portrait' || b.name === 'portrait') continue;
          expect(overlaps(a.rect, b.rect), `${a.name} over ${b.name} at ${height}`).toBe(false);
        }
      }
    }
  });

  it('answers the hit test with the widget that was drawn there', () => {
    for (const height of heights) {
      const layout = bottomBarLayout({ width: 800, height }, true);
      const centre = (r: Rect): [number, number] => [r.x + r.w / 2, r.y + r.h / 2];
      expect(hudHitTest(layout, ...centre(layout.fire))).toEqual({ kind: 'fire' });
      expect(hudHitTest(layout, ...centre(layout.skip))).toEqual({ kind: 'skip' });
      expect(hudHitTest(layout, ...centre(layout.angleUp))).toEqual({ kind: 'angle', delta: 1 });
      expect(hudHitTest(layout, ...centre(layout.angleDown))).toEqual({ kind: 'angle', delta: -1 });
      expect(hudHitTest(layout, ...centre(layout.moveLeft))).toEqual({ kind: 'move', dir: -1 });
      expect(hudHitTest(layout, ...centre(layout.moveRight))).toEqual({ kind: 'move', dir: 1 });
      expect(hudHitTest(layout, ...centre(layout.toggles.mute))).toEqual({
        kind: 'toggle',
        toggle: 'mute',
      });
      for (let i = 0; i < layout.items.length; i++) {
        const r = layout.items[i];
        if (!r) continue;
        expect(hudHitTest(layout, ...centre(r))).toEqual({ kind: 'item', index: i });
      }
      for (const shot of layout.shots) {
        expect(hudHitTest(layout, ...centre(shot.rect))).toEqual({
          kind: 'shot',
          shot: shot.shot,
        });
      }
      // A point on the bar that is not a widget is still the bar, not a camera drag.
      expect(isOverBar(layout, layout.bar.x + 1, layout.bar.y + 1)).toBe(true);
      expect(isOverBar(layout, 400, 10)).toBe(false);
    }
  });

  it('does not let a thumb between two toggles drag the board', () => {
    const layout = bottomBarLayout(viewSizeFor(844, 390), true);
    const mute = layout.toggles.mute;
    const help = layout.toggles.help;
    // The 6 px of air between the mute key and the controls key: no widget answers it,
    // and before `hudBlocksDrag` a press there was a camera drag starting on the HUD.
    const gapX = (mute.x + mute.w + help.x) / 2;
    const gapY = mute.y + mute.h / 2;
    expect(hudHitTest(layout, gapX, gapY)).toBeNull();
    expect(isOverBar(layout, gapX, gapY)).toBe(false);
    expect(hudBlocksDrag(layout, gapX, gapY)).toBe(true);
    // A toggle itself, and the open map beside the row, still answer as before.
    expect(hudBlocksDrag(layout, mute.x + 1, mute.y + 1)).toBe(true);
    expect(hudBlocksDrag(layout, 400, 10)).toBe(false);
    expect(hudBlocksDrag(layout, layout.bar.x + 1, layout.bar.y + 1)).toBe(true);
  });
});

describe('finger-sized targets', () => {
  /** Every control a player presses during a turn, and the smallest side it may have. */
  function targets(layout: BottomBarLayout): { name: string; rect: Rect }[] {
    return [
      { name: 'fire', rect: layout.fire },
      { name: 'skip', rect: layout.skip },
      { name: 'angleUp', rect: layout.angleUp },
      { name: 'angleDown', rect: layout.angleDown },
      { name: 'moveLeft', rect: layout.moveLeft },
      { name: 'moveRight', rect: layout.moveRight },
      { name: 'mute', rect: layout.toggles.mute },
      { name: 'help', rect: layout.toggles.help },
      { name: 'chat', rect: layout.toggles.chat },
      ...layout.shots.map((s) => ({ name: `shot ${s.shot}`, rect: s.rect })),
    ];
  }

  it('gives every control 44 CSS px on an iPhone 13, notch and home indicator included', () => {
    // The whole viewport (no insets) and the 750 px canvas the safe-area padding leaves
    // on the real phone (DESIGN §7 item 165): the item slots count too, since Bandage
    // and Teleport are pressed mid-turn.
    for (const key of ['iphone13Landscape', 'iphone13Notched', 'iphone13NotchedInset'] as const) {
      const s = SCREENS[key];
      const view = viewSizeFor(s.w, s.h);
      const fit = canvasFit(s.w, s.h, view, s.dpr, false);
      const layout = bottomBarLayout(view, true);
      const all = [
        ...targets(layout),
        ...layout.items.flatMap((r, i) => (r ? [{ name: `item${i}`, rect: r }] : [])),
      ];
      for (const t of all) {
        expect(t.rect.w * fit.scale, `${key} ${t.name} width`).toBeGreaterThanOrEqual(44);
        expect(t.rect.h * fit.scale, `${key} ${t.name} height`).toBeGreaterThanOrEqual(44);
      }
    }
  });

  it('records exactly which controls miss 44 px, and on which phone', () => {
    // DESIGN §7 item 149 claims a "known limit" list. This is that list, measured, so
    // the note and the geometry cannot drift apart: a number here changing is either a
    // control that was fixed or one that regressed, and either way the note is wrong.
    const smallest = (layout: BottomBarLayout, scale: number): string[] => {
      const rows: { name: string; w: number; h: number }[] = [
        ...targets(layout).map((t) => ({
          name: t.name.startsWith('shot') ? 'shot card' : t.name,
          w: t.rect.w,
          h: t.rect.h,
        })),
        ...layout.items.flatMap((r) => (r ? [{ name: 'item slot', w: r.w, h: r.h }] : [])),
      ];
      const short = new Set<string>();
      for (const r of rows) {
        if (r.w * scale < 44 || r.h * scale < 44) short.add(r.name);
      }
      return [...short].sort();
    };

    // An iPhone 13 in landscape draws its 750 px canvas at 0.9375, and everything a
    // thumb presses during a turn clears 44 px each way. The shot cards were the
    // exception (three stacked rows) until the 2 + 1 grid (DESIGN §7 item 164), and the
    // arrows, toggles, item slots and SKIP until they were grown to 47 (item 165). The
    // Pixel 7 and a tablet are bigger still.
    for (const key of [
      'iphone13Landscape',
      'iphone13Notched',
      'iphone13NotchedInset',
      'pixel7Landscape',
      'ipadLandscape',
    ] as const) {
      const big = SCREENS[key];
      const bigView = viewSizeFor(big.w, big.h);
      const bigScale = canvasFit(big.w, big.h, bigView, big.dpr, false).scale;
      expect(smallest(bottomBarLayout(bigView, true), bigScale), key).toEqual([]);
    }

    // An iPhone SE is 667 CSS px wide showing an 800 px board, so every backbuffer pixel
    // is 0.83 CSS px and nothing but FIRE and the drag pad can reach 44. This is the
    // floor of the target family and the reason the note exists.
    const small = SCREENS.iphoneSeLandscape;
    const smallView = viewSizeFor(small.w, small.h);
    const smallScale = canvasFit(small.w, small.h, smallView, small.dpr, false).scale;
    const smallLayout = bottomBarLayout(smallView, true);
    expect(smallest(smallLayout, smallScale)).toEqual([
      'angleDown',
      'angleUp',
      'chat',
      'help',
      'item slot',
      'moveLeft',
      'moveRight',
      'mute',
      'shot card',
      'skip',
    ]);
    // FIRE, the one key a turn cannot end without, clears it even there.
    expect(smallLayout.fire.w * smallScale).toBeGreaterThanOrEqual(44);
    expect(smallLayout.fire.h * smallScale).toBeGreaterThanOrEqual(44);
  });

  it('grows the same controls on a desktop, where they were already fine', () => {
    const s = SCREENS.desktop;
    const view = viewSizeFor(s.w, s.h);
    const fit = canvasFit(s.w, s.h, view, s.dpr, true);
    const layout = bottomBarLayout(view, false);
    expect(layout.variant).toBe('full');
    for (const t of targets(layout)) {
      expect(t.rect.w * fit.scale, `${t.name} width`).toBeGreaterThanOrEqual(30);
      expect(t.rect.h * fit.scale, `${t.name} height`).toBeGreaterThanOrEqual(30);
    }
  });
});

describe('the kit pieces in the bar', () => {
  // Kit pieces are drawn at whole scales only, and a nine-slice cannot be narrower than
  // its two corners (docs/ART.md §12). These are the sizes the bar asks them for.
  const variants = [
    bottomBarLayout({ width: 800, height: 600 }, false),
    bottomBarLayout({ width: 800, height: 370 }, true),
  ];

  it('asks for the troughs at a whole multiple of their height', () => {
    for (const layout of variants) {
      // The power trough is 16 px at 1x, the move trough 8.
      expect(layout.power.h % 16, `${layout.variant} power`).toBe(0);
      expect(layout.gauge.h % 8, `${layout.variant} gauge`).toBe(0);
      // Wide enough for its two end caps (7 px each at the scale it is drawn at).
      expect(layout.power.w).toBeGreaterThan(14 * (layout.power.h / 16));
    }
  });

  it('never asks a frame to be smaller than its corners', () => {
    for (const layout of variants) {
      // Cards have 9 px corners, slots and keys 7.
      for (const s of layout.shots) {
        expect(s.rect.w, `${layout.variant} card`).toBeGreaterThanOrEqual(18);
        expect(s.rect.h, `${layout.variant} card`).toBeGreaterThanOrEqual(18);
      }
      for (const r of [...layout.items, layout.fire, layout.skip, layout.angleUp, layout.moveLeft]) {
        if (!r) continue;
        expect(r.w, layout.variant).toBeGreaterThanOrEqual(14);
        expect(r.h, layout.variant).toBeGreaterThanOrEqual(14);
      }
    }
  });

  it('stands the weapon cards up on a desktop and puts them in a 2 + 1 grid on a phone', () => {
    const [full, compact] = variants;
    for (const s of full?.shots ?? []) expect(s.rect.h).toBeGreaterThan(s.rect.w);
    // Side by side on the desktop, one row.
    expect(new Set(full?.shots.map((s) => s.rect.y)).size).toBe(1);
    // On the phone: S1 and S2 share the top row, SS spans both under them.
    const [s1, s2, ss] = (compact?.shots ?? []).map((s) => s.rect);
    expect(compact?.shots.map((s) => s.shot)).toEqual(['s1', 's2', 'ss']);
    if (!s1 || !s2 || !ss) throw new Error('three shot cards');
    expect(s1.y).toBe(s2.y);
    expect(s1.x + s1.w).toBeLessThan(s2.x);
    expect(ss.y).toBeGreaterThan(s1.y + s1.h);
    expect(ss.x).toBe(s1.x);
    expect(ss.x + ss.w).toBe(s2.x + s2.w);
    expect(ss.w).toBeGreaterThan(ss.h);
  });

  it('keeps the bar exactly as tall as it was', () => {
    // The rework must not cover more of the play area than the HUD it replaced.
    expect(variants[0]?.bar.h).toBe(96);
    expect(variants[1]?.bar.h).toBe(124);
    // Only the owner tab stands proud of it, by a few px at the left end.
    for (const layout of variants) {
      expect(layout.top).toBeLessThan(layout.bar.y);
      expect(layout.bar.y - layout.top).toBeLessThanOrEqual(4);
    }
  });
});

describe('the top of the screen', () => {
  const heights = [360, 370, 450, 556, 600];

  it('puts the timer, wind and strength on one row, centred, clear of the corner panels', () => {
    for (const height of heights) {
      const view = { width: 800, height };
      const top = topClusterLayout(view);
      expect(top.timer.x + top.timer.w).toBeLessThanOrEqual(top.plate.x);
      expect(top.plate.x + top.plate.w).toBeLessThanOrEqual(top.strength.x);
      expect(top.plate.x + top.plate.w / 2).toBe(view.width / 2);
      // The player list owns the top left.
      const list = clientConstants.hud.order;
      expect(top.timer.x, `timer at ${height}`).toBeGreaterThan(list.x + list.widthPx);
      // The status tag and the notice stack come after the cluster, in that order.
      expect(top.tagY).toBeGreaterThan(top.plate.y + top.plate.h);
      expect(clientConstants.hud.notices.topPx).toBeGreaterThanOrEqual(
        top.tagY + clientConstants.hud.top.tagHeightPx,
      );
    }
  });

  it('is shorter than the stack it replaced', () => {
    // Wind, badge, timer and banner used to reach y 112 before the first notice at 116.
    const top = topClusterLayout({ width: 800, height: 600 });
    expect(top.tagY + clientConstants.hud.top.tagHeightPx).toBeLessThan(112);
  });

  it('fits the player list above the toggle row in both variants', () => {
    const o = clientConstants.hud.order;
    for (const variant of ['full', 'compact'] as const) {
      const rows = variant === 'compact' ? clientConstants.hud.compact.order.count : o.count;
      const bottom = o.y + o.headerHeightPx + rows * o.rowHeightPx + o.paddingPx;
      expect(bottom, variant).toBeLessThanOrEqual(belowOrderPanelY(variant));
    }
  });
});

describe('the turn banner', () => {
  const b = clientConstants.hud.banner;
  const total = b.inFrames + b.holdFrames + b.outFrames;

  it('drops in, holds, fades and then is gone for good', () => {
    expect(turnBannerPose(-1)).toBeNull();
    expect(turnBannerPose(Number.NaN)).toBeNull();
    const first = turnBannerPose(0);
    expect(first?.alpha).toBe(0);
    expect(first?.dy).toBeLessThan(0);
    expect(turnBannerPose(b.inFrames)).toEqual({ alpha: 1, dy: 0 });
    expect(turnBannerPose(b.inFrames + b.holdFrames - 1)).toEqual({ alpha: 1, dy: 0 });
    expect(turnBannerPose(total - 1)?.alpha).toBeGreaterThan(0);
    expect(turnBannerPose(total)).toBeNull();
    expect(turnBannerPose(total * 10)).toBeNull();
  });

  it('never gets brighter once it has started to fade, and never drops upward', () => {
    let last = 1;
    for (let age = b.inFrames; age < total; age++) {
      const pose = turnBannerPose(age);
      expect(pose).not.toBeNull();
      expect(pose?.alpha ?? 0).toBeLessThanOrEqual(last);
      last = pose?.alpha ?? 0;
    }
    let y = -Infinity;
    for (let age = 0; age <= b.inFrames; age++) {
      const dy = turnBannerPose(age)?.dy ?? 0;
      expect(dy).toBeGreaterThanOrEqual(y);
      y = dy;
    }
  });

  it('is gone within a couple of seconds', () => {
    expect(total).toBeLessThanOrEqual(150);
  });
});
