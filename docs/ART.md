# ART.md — the pixel art style guide

The visual target is the chibi, busy, colourful look of early-2000s 2D online artillery
games: big heads on small bodies, bold near-black outlines, saturated palettes, a light
that always comes from the top left, and far more small detail than a realistic sprite
would carry. Nostalgic charm beats realism everywhere. When a choice is between "correct"
and "characterful", pick characterful.

This file is the contract for the art pass. Every mobile sprite, and every agent working
on one, follows it.

---

## 0. The loop: draw, render, look, fix

Sprites are data (`packages/shared/src/sprites/mobiles/<id>.ts`), so they can be looked at
without a browser:

```
pnpm sprites:render armor                       # one sheet -> .art-preview/armor.png
pnpm sprites:render armor --scale 6             # bigger pixels
pnpm sprites:render armor --no-guides           # without the anchor/pivot overlay
pnpm sprites:render all                         # every sheet + .art-preview/_roster.png
pnpm sprites:render mage --out /tmp/look        # somewhere else
```

The sheet puts each animation on its own row, frames left to right, on a checkerboard so
transparent pixels are unmistakable, and labels each row with its frame count, its
`frameTicks` and whether it loops. The overlay draws the anchor as a magenta cross, the
barrel pivot as a cyan dot and the barrel vector at 45°, so "the muzzle is in the wrong
place" is visible rather than inferred. `all` also writes `_roster.png`: every mobile's
first idle frame at 3×, standing on one baseline, which is how the roster is judged as a
set rather than one sprite at a time.

`.art-preview/` is git-ignored. **Do not ship a sprite you have not looked at.**

---

## 1. Canvas, anchor and footprint

| Class | Canvas | Examples |
| --- | --- | --- |
| Standard mobile | **56 × 48** | armor, mage, nak, boomer, jd, ice, aduka, knight, jfrog, grub, turtle, lightning, raon |
| Big walker / beast | up to **64 × 56** | bigfoot, kalsiddon, trico, dragon, asate |

Rules:

- **The canvas may grow; the gameplay numbers may not.** `width`, `height`, `anchor`,
  `barrelPivot` and `barrelLength` are art, and the renderer reads them. `footprint`,
  `hp`, `shots` and every other number in `packages/shared/src/data/**` are gameplay and
  are off limits — the only line an art agent may touch in a mobile's data file is its
  `sprite` reference.
- **Anchor at the feet centre**: `anchor = { x: round(width / 2), y: height }`. `y ===
  height` means "the bottom edge of the frame". The mobile is drawn with its anchor on the
  terrain contact point, so the drawing must actually reach the bottom row.
- **Fill the footprint.** Footprints are 22–34 px wide. Keep the drawn body (not counting a
  barrel or a tail sticking out) roughly **36–48 px wide** so the mobile visibly covers the
  ground it occupies. A 26 px drawing inside a 56 px canvas looks like a toy that missed.
- Leave 1–2 px of margin at the top and sides of the canvas for the outline; effects such
  as a muzzle flash may use the remaining space.

---

## 2. Proportions — chibi, not scale model

- The **head, cockpit, turret or dome is 40–50 % of the frame's height**. On the 56 × 48
  reference that is a 17–22 px tall dome sitting on a 12 px hull.
- Bodies are **rounded**: ellipses and round-rects, never a bare rectangle. A silhouette
  with a corner on it should have a reason for that corner.
- Limbs, treads and legs are **stubby and oversized** — feet and treads wider than the body
  they carry. Two or three fat segments beat five thin ones.
- The silhouette must be readable at 1× in a single colour. Squint at the render: if you
  cannot tell armor from turtle by shape alone, the shape is wrong.
- Everything faces **right**; the renderer mirrors for the other facing.
- **Feet on the ground.** At rest, every visible foot touches the anchor row. Stubby feet
  and boots stand flat. A long foot that shows its toes (shrike, walker, wyvern) may
  have its rear foot on its toes with the heel 2–3 px up, but the toes still touch the
  ground. Claw and toe tips may cut 1 px into the ground; a whole foot never sinks. In
  the Blender pipeline the camera's 15° tilt draws a foot at z 0 higher the further back
  it stands, so far-side feet must add `parts.plant_z(far_y, near_y)` to their z in
  every state, walk cycles included.

---

## 3. Outline

- **1 px near-black outline** (`#10141c`) around every form — the outer silhouette *and*
  the internal forms that need to separate (turret from hull, arm from body, barrel from
  mantlet). Interior separation lines are what make the art read as busy rather than
  muddy.
- **2 px at the bottom of the silhouette.** The extra row weights the sprite onto the
  ground and keeps it legible against textured terrain.
- The outline is one colour, never anti-aliased, never a lighter "outline of the fill".
- No stray single pixels outside the outline. If a detail needs to poke out (an antenna, a
  whisker), outline it too.

---

## 4. Shading

Light comes from the **top left**, always.

Every material is a **4 tone ramp**: highlight, light, mid, shadow. Shade by position, not
by fiddling: the top-left ~20 % of a form is highlight, then light, then mid, and the
bottom-right ~25 % is shadow. Add a **rim light** one pixel inside the top and left edges
of each major form — that single pass is most of what makes a flat blob look rounded.

- Three tones minimum per material, four preferred. Two is flat; six is mud.
- Do not dither. Bands are the look.
- Ambient bounce is not worth it at this size. Keep the shadow side clean and saturated
  rather than grey.

---

## 5. Palette

Each sprite declares its own `palette` array (`#rrggbb`, lower case — the tests enforce
it). Start from this shared base of 24 and add up to ~6 per-mobile accent colours; a
sprite of 24–30 entries is normal. Reuse the base indices in the same order across mobiles
so the roster reads as one set.

| idx | hex | name | | idx | hex | name |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | `#10141c` | outline | | c | `#ffcf4d` | lamp amber |
| 1 | `#245c33` | body shadow | | d | `#fff0b0` | flash core |
| 2 | `#3f8f4e` | body mid | | e | `#d84b3a` | accent red |
| 3 | `#62bb64` | body light | | f | `#96271f` | accent red dark |
| 4 | `#9ee08a` | body highlight | | g | `#7fd8ff` | glass / eye |
| 5 | `#3b4652` | metal shadow | | h | `#d8f4ff` | glass highlight |
| 6 | `#6d7c8c` | metal mid | | i | `#8a939c` | smoke light |
| 7 | `#a8b8c6` | metal light | | j | `#575f68` | smoke dark |
| 8 | `#dfe9f2` | metal highlight | | k | `#4a4038` | charred |
| 9 | `#1c222b` | tread/boot shadow | | l | `#2a2622` | charred dark |
| a | `#39424e` | tread/boot mid | | m `#b05147` / n `#8c3b32` / o `#5e2620` | hurt light / mid / shadow |
| b | `#5b6775` | tread/boot light | | p `#ff8a2b` / q `#ffd34d` | flame orange / yellow |

Indices 1–4 are the *body* ramp: **re-hue them per mobile** (mage purple, jd deep blue,
dragon crimson, jfrog green…) while keeping the same value steps. Everything from 5 down
stays put so smoke, fire, damage and metal look the same on every mobile.

Colours are bright and saturated. A muddy desaturated mobile is a bug.

---

## 6. Faces

Anything that could plausibly have a face gets one, and it is the most detailed part of the
sprite.

- **Creatures** (trico, jfrog, dragon, grub, turtle, bigfoot, raon): big rounded eyes,
  whites plus a dark pupil plus a 1–2 px highlight in the pupil's top-left. Add a brow or a
  mouth if there is room. Eyes sit in the upper half of the head and are larger than
  realism allows.
- **Machines** (armor, nak, lightning, kalsiddon, jd, ice, asate, boomer): a glass visor or
  a lamp cluster reading as eyes — a cyan/amber band with two bright sockets. The reference
  sprite does exactly this.
- **Humanoids** (mage, knight, aduka): a hood shadow or a helmet slit with two glowing
  points beats a drawn face at this size.
- The face **reacts**: it squints on `fire` and `hurt`, and goes dark on `death`.
- Keep the face's colour through the `hurt` red flash — losing it loses the character.

---

## 7. Animations

| Anim | Frames | `frameTicks` | Loop | What happens |
| --- | --- | --- | --- | --- |
| `idle` | 2–4 (**≥ 2**) | 18–30 | yes | Breathing / bobbing. Move the head or a hanging part 1 px, never the feet. Sway an antenna, a tail, a flame. |
| `move` | 4 (**≥ 2**) | 5–8 | yes | Treads roll (shift the cleat pattern one step per frame), legs step, the body rocks 1 px. Feet stay on the ground line. |
| `fire` | 3 (**≥ 2**) | 4–6 | no | Frame 0: the whole mobile kicks back 2–3 px, the barrel retracts into its mantlet, a big muzzle flash. Frame 1: half the recoil, small flash. Frame 2: settled, no flash. |
| `hurt` | 2 (**≥ 1**) | 4–6 | no | Full-body flush to the hurt ramp (m/n/o) plus a 1–2 px jolt away from the impact. The face squints. |
| `death` | 4 (**≥ 2**) | 8–12 | no | Frame 0: hurt tint, the mobile sags, the barrel or head droops. Frame 1: charred, flames, a smoke puff. Frame 2: the head collapses into the body, smoke column. Frame 3: a burnt-out wreck under rising smoke. |

`loop` is `true` for `idle` and `move`, `false` for `fire`, `hurt` and `death` — the tests
enforce that. `frameTicks` is at 60 Hz: `fire` at 4 ticks × 3 frames is 12 ticks, which is
the whole recoil.

Smoke rises as **overlapping circles that get bigger and drift as they climb**; flames are
a 3 tone blob (core `d`, mid `q`, edge `p`) and never outlined.

---

## 8. Barrel pivot conventions

`barrelPivot` is where the weapon is hinged and `barrelLength` is the distance from there
to the muzzle, in sprite pixels. `muzzlePosition` in the simulation spawns every shot from
`pivot + barrelLength` along the aim, and the client draws the aim line from the same
point, so these two numbers *are* the gun.

- Put the pivot at the visual hinge: the centre of the mantlet, the shoulder joint, the
  creature's mouth, the staff's grip.
- Draw the barrel horizontally pointing right at rest. `barrelLength` is then the distance
  from the pivot to the drawn tip (add 1–2 px so the shot clears the muzzle brake).
- **Never let the muzzle end inside the body.** After changing either number run
  `pnpm sprites:render <id>` and check the cyan vector leaves the silhouette, and run the
  shared test suite — `test/mobiles/selfHit.test.ts` fails when a mobile detonates its own
  shot on its own hull.
- For a mobile that fires from its mouth or hands rather than a barrel, keep
  `barrelLength` small (4–8) and place the pivot at the opening.

---

## 9. Do / don't

**Do**

- Draw the idle frame first, look at it at 5×, and only then animate it.
- Add small detail everywhere: rivets, bolt lines, vents, panel seams, warning stripes,
  lamp glints, tufts, sparkles, buckles, stitching. Busy is the target.
- Give each mobile one loud accent (a red pennant, a gold trim, a glowing rune) so it is
  identifiable in the roster sheet.
- Keep the same detail *density* across the roster — one over-rendered mobile makes the
  other seventeen look unfinished.
- Re-render and look after every change.

**Don't**

- Don't anti-alias, dither, or use translucent colours — every pixel is opaque or `.`.
- Don't draw a mobile that is symmetrical left-to-right; it must read as facing right.
- Don't let a sprite float: the drawing has to touch the anchor row.
- Don't reuse another mobile's silhouette with a different hue and call it done.
- Don't change `footprint`, `hp`, `shots`, damage or any other gameplay number.
- Don't touch another agent's sprite files, `docs/PROGRESS.md`, or commit anything.

---

## 10. What the tests enforce

`packages/shared/test/sprites.test.ts` runs these against **every** sprite in
`sprites/mobiles/index.ts`, each against its own declared dimensions:

- `kind: 'pixels'`; `width` and `height` integers in **16…96**.
- Every frame is exactly `height` rows of exactly `width` characters; every character is
  `.` or a base-36 index that exists in `palette`.
- Palette entries match `/^#[0-9a-f]{6}$/` — lower case, six digits, no shorthand.
- Frame counts: `idle ≥ 2`, `move ≥ 2`, `fire ≥ 2`, `hurt ≥ 1`, `death ≥ 2`, none above 8.
  Every `frameTicks` > 0. `loop` is true for `idle`/`move`, false for `fire`/`death`.
- `anchor` and `barrelPivot` inside the frame (`y === height` is legal and means the bottom
  edge); `0 < barrelLength ≤ max(width, height)`.
- More than 40 opaque pixels in every frame, and `idle[0]` at least 24 px wide with its
  lowest drawn row at or below `anchor.y - 3`.

`test/mobiles/roster.test.ts` additionally checks each mobile definition points at its own
sprite. Run `pnpm --filter @gunbros/shared test` after every sprite change, then
`pnpm -r typecheck && pnpm -r lint && pnpm test` before handing back.

---

## 11. Reference sprite: `armor`

`packages/shared/src/sprites/mobiles/armor.ts` is the worked example. It is a 56 × 48
chibi tank: a 17 px domed turret (≈ 40 % of the height) with a commander's cupola and a
wide cyan visor holding two eyes, a rivetted hull with a red warning flash, a stowage box
and a headlamp, and treads deliberately too big for it with five road wheels and rolling
cleats. Anchor `{ x: 28, y: 48 }`, pivot `{ x: 33, y: 19 }`, `barrelLength: 20`, 27 palette
entries.

An example row, the cupola and the top of the dome from `idle[0]` (base-36 palette
indices, `.` is transparent — `7`/`8` are the metal ramp on the cupola, `0` the outline,
`gh` the visor glass, and the column of `7` on the left is the antenna):

```
'........7fff0.....00000.................................',
'........7000....007777700...............................',
'........7.......087776660...............................',
'........7......07776666660..............................',
'........7.......066666600...............................',
'........7.......006666500...............................',
'........7.....0033000003300.............................',
'............0000000000033330............................',
'..........hhhgggggggggg002220...........................',
```

The whole thing, and the animation timing, is in that file; the sheet it produces is
`.art-preview/armor.png`. Match its density, its outline weight and its shading, not its
subject.

---

## 12. The UI kit

The HUD and the menus are pixel art too. Their frames, buttons, gauges and icons are
modelled in Blender and rendered through the mobiles' toon and pixel pipeline, so they
share the same light, palette and outline: `pnpm ui:kit` builds
`packages/client/public/ui/blender/ui_kit.png` and its JSON (how it works:
`tools/blender/README.md`, "The UI kit"). Look at every piece at 1x and 3x at `/uikit` on
the dev server.

Using it, from `packages/client/src/render/uiKit.ts`:

- Canvas: `drawNineSlice(ctx, 'panel', x, y, w, h, scale)` for frames,
  `drawBar(ctx, 'fill/amber', x, y, w)` inside a `trough`, `drawUiPiece` and
  `drawUiPieceAt` (on the piece's pivot) for sprites and icons, and
  `stripFrameFor('wind-arrow', directionDeg)` for the arrow frame. Each returns false
  until the atlas has loaded; draw the old skin for those frames.
- DOM: `installUiKitCss()` turns every nine-slice into a class (`.uk-panel`,
  `.uk-card-selected`, ...) as a `border-image` at `--uk-scale` CSS px per pixel
  (default 2), plus `.uk-btn` and `.uk-btn-gold`, which follow hover, press and
  `:disabled` themselves. `uiPieceElement('item/teleport', 2)` is an icon as a canvas.
- Scale whole numbers only. A nine-slice is at least its two corners wide.
- Rules for new pieces: light from the top left, three or four tones per material, the
  1 px outline, readable at 1x. Hover and pressed states shift the same ramp rather
  than adding colours.
