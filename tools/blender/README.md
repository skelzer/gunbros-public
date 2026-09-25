# Blender sprite pipeline (proof of concept)

Mobiles modelled procedurally in Blender, rendered headless with a hard toon shader,
then reduced to pixel art. All eighteen mobiles: the heavy tank (`armor` in the roster), the missile pod walker
(`bigfoot`), the mine layer (`raon`, atlas name `sapper`), the first organic one, the
`turtle`, the raptor-headed drone walker (`kalsiddon`, atlas name `shrike`) and the spitting
`frog` (`jfrog`), whose barrel layer is only the slime gob it spits, and three chibi
mechs: `vortex` (`jd`), `tempest` (`lightning`) and `zephyr`
(`boomer`), and three humanoids: `sorcerer` (`mage`), `herald`
(`aduka`) and `paladin` (`knight`), and four creatures: `skipper` (`grub`), `delver`
(`nak`), `frostbite` (`ice`), `triclops` (`trico`, a triceratops whose third eye is the gun) and
the four-legged dish walker `orbital` (`asate`) and the fire-breathing `wyvern`
(`dragon`), whose barrel layer is only its breath.
These are the game's default sprites. Open the client with `?sprites=pixel` to see the
hand-drawn pixel grids instead, for example `http://localhost:5173/sandbox?sprites=pixel`.

## Run it

```
./tools/blender/make_sprites.sh          # or: uv run tools/blender/make_sprites.py
```

About 15 seconds per mobile from nothing to final assets; pass atlas names to do only
some (`make_sprites.sh walker`). Needs Blender 4.2 or newer (developed
on 5.2 LTS) and `uv`. Blender is found through `$BLENDER`, then `PATH`, then the usual
install folders.

Output, all committed:

- `packages/client/public/sprites/blender/tank_body.png`, `tank_barrel.png`: sprite
  sheets, one row per state, 80 x 64 frames.
- `packages/client/public/sprites/blender/tank.json`: frame rects per state, frame
  duration, anchor, barrel pivot per frame, muzzle point.
- The same three files for `walker` (72 x 64 frames) `sapper` (64 x 56), `turtle` (68 x 60) and `shrike` (72 x 64).
- `tools/blender/comparison_<name>.png`: hand-drawn sprite against the new one.

`work/<name>/` holds raw renders and `<name>.blend` for inspection; previews sit beside it. It is ignored by
git; the scripts are the source of truth.

## How it works

| File | Job |
| --- | --- |
| `palette.json` | Every named colour a mobile may use. Each ramp (shadow, mid, light, highlight) becomes a toon material of the same name. No global cap: a mobile declares the ramps and flats it uses and is quantised to the outline plus those, at most 24 colours. |
| `render_common.py` | The look: orthographic side camera tilted 15 degrees, one sun from the top left, shader-to-RGB with constant colour ramps, Standard view transform, transparent film, 1 sample, minimum pixel filter. Also mesh helpers, the world-to-pixel projection and layered rendering. |
| `parts.py` | Reusable parts with their pose helpers. Caterpillar tracks (`build_tracks`, `pose_tracks`; tank and sapper) and two-bone legs (`two_bone_ik` with the knee bending to the front or the back, `aim`, `walk_foot`; walker and shrike), and `plant_z`, the z offset that keeps a far-side foot on the ground row under the tilted camera (every legged mobile). |
| `chibi_mech.py` | The original shared build and poses for the chibi bipeds (boots, stub legs, round torso, dome head, gun hinge, six states). Since the remodel every chibi mobile carries its own copy of the build so it can change the body; they still import its constants (`CANVAS`, `ANCHOR`, `STATES`, stance) and `add_cone`/`add_ring`. |
| `creature.py` | Helpers for the blobby creatures: blobs, flat shaded facets for ice and rock, cones, eyes with pupils, bands that hug a surface (grins, goggles), pose snapshot and restore, and the standard death effects timeline. |
| `build_mobile_tank.py`, `build_mobile_walker.py`, `build_mobile_sapper.py`, `build_mobile_turtle.py`, `build_mobile_shrike.py`, `build_mobile_frog.py`, `build_mobile_vortex.py`, `build_mobile_tempest.py`, `build_mobile_zephyr.py`, `build_mobile_sorcerer.py`, `build_mobile_herald.py`, `build_mobile_paladin.py`, `build_mobile_skipper.py`, `build_mobile_delver.py`, `build_mobile_frostbite.py`, `build_mobile_triclops.py`, `build_mobile_orbital.py`, `build_mobile_wyvern.py` | Geometry (primitives, bevels, booleans), part groups, and one `pose(state, frame)` function instead of keyframes. Each ends in `rc.run_mobile(...)`, which renders every frame as a `body` layer and a `barrel` layer, each with a flat colour id pass. The walker poses its legs with two-bone IK and moves its feet in whole pixels. |
| `postprocess.py` | Downscale, alpha threshold, palette quantise, part lines, outline, orphan removal, sheet packing, atlas, previews. |
| `make_sprites.py` | Glue. `make_sprites.sh` is a wrapper for it. |

Decisions worth knowing before changing anything:

- **Units.** One Blender unit is 10 sprite pixels. Sizes in the build script are written
  in pixels through `px()`.
- **Render at 4x, downscale by majority vote.** Every 4 x 4 block takes its most common
  palette colour, so no in-between colours appear. Rendering straight at 1x was tried
  and loses thin features (the fender line turns into dashes); an averaging filter
  muddies edges into wrong palette slots. See `iterations/03b_*.png`.
- **Id pass.** Shading alone cannot separate two parts of the same colour (turret on
  hull). Each part group renders in a flat code colour and post-processing draws a dark
  line where groups meet, on the lower numbered group, in that pixel's own shadow
  colour. The outer outline uses the single outline colour from the palette.
- **Whole pixel motion only** for anything that carries the barrel. Small rotations
  (1 to 3 degrees) cannot be represented at this size and just shuffle pixels between
  frames, which reads as flicker. Rotation is kept for big moves (the death).
- **The barrel contract.** The simulation spawns shells at pivot + 20 px along the aim,
  with the pivot 5 px ahead of and 29 px above the anchor (from the hand-drawn armor
  sprite in `packages/shared`). The model is built to land exactly there, so the muzzle
  and the shell agree without touching the simulation.
- **No rigs.** Creatures are separate parts (blobs, tubes, patches) with no rig and no
  skinning, that slide and hinge in whole pixels. Surface detail that would be a
  texture is geometry instead (shell scutes are patches in alternating part groups, so
  the id pass outlines every plate). A unique `ink` flat equal to the outline colour
  gives pupils and mouths a free dark.
- **`charge` is an optional sixth state.** The fire animation is over in under half a
  second and the camera leaves with the shell, so nobody sees it. A looping `charge`
  state is shown for as long as the active player holds the fire key (the simulation
  publishes the charging power, so every client sees it). Mobiles without one stay in
  idle. Every mobile has one; the playbook below makes it a required state.
- **Cloth is rigid shapes that move by visible amounts.** There is no cloth simulation and
  at this size there is no need for one. A robe or coat is a smooth cone with a hem ring
  that trails the step by a pixel; a cape, plume or tabard is a tapered plate hinged at
  the top that swings ten degrees or more (small angles only shuffle pixels); a hood is
  the dome plus a swept cone. A face is a dark visor band with two small glowing eyes.
- **Flat shading is a material choice.** Ice, crystal and drill flutes are low-poly and
  flat shaded so the toon ramp falls into facets; everything else is smooth. A faceted
  cone turned by half a facet between frames visibly spins (the delver's drill).
  White eyes on a pale body need a dark socket behind them. A pale body also needs
  something dark at its base (the frostbite's boots) or it floats.
- **Build for the side view.** The camera never moves, so shape things by their side
  silhouette: a triceratops frill modelled as a forward facing plate is a bar from the
  side, and only reads once it is a rounded shield swept back over the neck. Ask what the
  name promises (a `trico` is a triceratops, not a biped) before reaching for a body plan.
  A bare cone turned to face the camera shows its inside as one dark shadow step; a
  dish built as a bmesh surface of revolution with solidify has proper inner normals and
  can face the camera three-quarters (the orbital).
- **Curves for anything long and tapering, a fan mesh for a wing.** The wyvern's tail,
  neck, limbs and horns are bezier curves with a per-point bevel radius converted to
  meshes (`tube` in `build_mobile_wyvern.py`), which curl and taper where chains of
  blobs go lumpy. Its bat wings are a membrane fanned out from the wrist over the finger
  tips with a scalloped trailing edge, each panel cupped slightly towards the camera,
  with finger bones laid on top in their own part group. Rotating a wing about x folds
  it towards the camera, which the side view shows as a wing beat. Keep the cupping
  small (under a pixel): more gives each panel several shade steps and reads as noise.
  Glow groups are matched by number across layers, so give the barrel's flash the same
  number as the body's fire, or a solid body part sharing its number loses its lines.
- **Shape techniques that paid off in the Opus remodel** (each build script shows one):
  - A hard-surface hull, cockpit, hopper or blade is a side profile extruded across y
    (`prism` in the sapper, the walker's cockpit) with an angle-limited bevel. A raked
    nose says more than extra parts; a bevelled box always reads as a box.
  - Turned shapes (great helm, dish, robe) are lathe profiles, not scaled spheres: the
    flat top and straight sides make the silhouette (paladin, orbital, sorcerer).
  - An octagon, flat shaded and turned 22.5 degrees so a flat side faces the camera,
    gives three clean facet shades (orbital). A tube with `bevel_resolution = 1`, flat
    shaded, is a faceted limb for ice or rock (frostbite).
  - Plates on a dome are heightfield patches designed in the side view, depth from the
    ellipsoid, in alternating part groups (turtle). A segmented body is one spine
    function with a short pinched tube per segment, overlapping by a pixel, so the
    outline notches at every joint (skipper). Armour bands are `sliced` ellipsoids.
  - A stripe, trim or face opening on a curved surface is a slightly grown copy of the
    shape intersected with a box or ellipsoid; each layer needs more growth than what it
    sits on (paladin, herald). A hood face is a sphere scooped three-quarters to the
    camera with an `ink` sphere inside (sorcerer).
  - A folded bird wing is separate flat feather tubes, not a membrane, which goes scaly
    (shrike); tilt the tail down and past the wing tips or they merge. Light feather
    tips: the panel over a copy of itself scaled ~14% out from the root (zephyr).
  - A drill is a twisted star section, not a thread wound round a cone (delver).
  - Arcs read only as outlined warm tubes about 2 px thick (tempest). Missile warheads
    are stretched spheres, not cones (walker). Discs tilt about 40 degrees to the camera;
    at 60 they go face-on and melt (sapper).
- **Gotchas found in the remodel.**
  - Part groups match by prefix, first match wins: list `chest_vane` before `chest`.
  - `rc.add_sphere(scale=...)` takes pixel multipliers, not `px()`; a 0.9 px cutter
    silently deletes a part through its boolean. Set an object's origin before parenting
    boolean cutters to it, or the cut moves.
  - Discs standing proud of a face (eyes, sockets) and horns or frills over a head should
    have `visible_shadow = False`, or they shadow the face to its darkest step.
  - Anything placed on the near side of a dome projects across the middle of the face.
    The 15 degree tilt draws near-side details about 2 px low: keep eyes about 6 px above
    the pivot or the barrel layer covers them. On the chibis, face parts below about
    27 px collide with the gun.
  - A squinting white eye on a dark socket must squint the socket too, and not below
    half height, or it becomes a black ball. Eyes squinted below about 0.8 vanish.
  - Anything on the barrel layer that doesn't slide with the barrel (a mantlet) must be
    round about the pivot axis, so it reads the same at every aim. A hinge pin along y
    shows its end cap: keep it well under the barrel's radius.
  - Don't move `near_y` to cover protruding parts; it is where the mobile meets the
    ground. A robed figure keeps its skirt on the root and bobs only the bodice.
  - A flat plate square to the camera falls into one mid or shadow tone. Tip it about 15
    degrees up towards the sun for the light step; about 30 squashes it and throws a
    mirrored far copy into shadow (herald wings, zephyr wing). Parts laid over a round
    body should not cast shadows on it, or the body goes dark.
  - A white point on a crystal is its own child object in its own group: the id pass
    only swaps material slot 0, so a second slot corrupts it (frostbite). A pupil
    highlight needs a higher group number than the pupil, or it is outlined away.
  - A mobile can lighten itself without new colours by moving its own toon ramp
    thresholds after the materials are built (`brighten()` in the frog).
  - In the side view one oversized eye beats two: a far eye peeking round a snout gets
    clipped. Where a turret face is wanted, put it on the camera side of the dome.
  - The game is chibi-cute. A big readable face (eyes 4 px or more) matters more than
    realism: the tank, turtle and frog second passes brought theirs back.
  - A part that must show when it moves (a dropping jaw) has to sit in front of the
    belly and arms nearer the camera. Big head tilts in a death swing a long snout
    through the floor.
- **Deaths use the shared kit in `render_common.py`.** `set_burnt` slides every ramp one
  step darker and bottoms it out in soot, so a wreck keeps its hue and needs no new
  colours; painting everything char brown was tried first and gave an unreadable heap.
  `add_fire` and `pose_fire` give layered orange, yellow and white flames that carry
  the colour, glow without an outline and cast no shadow. The recipe for both mobiles:
  flash, fireball, the gun comes off (the barrel layer goes empty and a wreck prop in
  the body layer takes over under cover of the fireball), a big silhouette change,
  then two flames and a little smoke on the final held frame.
- **Canvases are generous.** Frame size costs nothing, and deaths throw parts a long way.
  `postprocess.py sprites` warns when any frame touches the edge of its canvas, which
  means something has probably been cut off.
- **Layers stay registered.** Same camera and canvas for both layers and every frame.
  The client draws the body at the anchor, then rotates the barrel frame about that
  frame's pivot.

## Looking at the result

```
uv run tools/blender/postprocess.py preview --work tools/blender/work/tank --out tools/blender/work/tank_preview.png
```

writes the sprite at 1x and 8x on the real map colours with the barrel at several
angles, plus `preview_frames.png` with every frame of every state, and prints how many
pixels change between consecutive frames (a quick flicker check). `iterations/` keeps
the previews from each pass of this proof of concept.

## Playbook: adding another mobile

1. **Read the contract.** From the mobile's hand-drawn sprite in `packages/shared`: anchor,
   `barrelPivot`, `barrelLength`. Pivot offset from the anchor and the muzzle distance are
   fixed by the simulation; build the model to land on them. Render the old sprite
   (`pnpm sprites:render <id>`) and look at it for the character, not to copy it.
2. **Copy the closest build script** to `build_mobile_<name>.py`: tank or sapper for
   tracks, walker or shrike for legs, turtle or frog for blobs. A biped with a big dome
   head: copy `build_mobile_vortex.py` or `build_mobile_paladin.py`. Replace the build
   function, `PART_GROUPS`, `STATES` and `pose()`; keep the `rc.run_mobile(...)` call.
   Take tracks, leg IK and step timing from `parts.py`, fire and burnt paint from the
   death kit in `render_common.py`.
3. **Give it a face.** Eyes that read at 1x (a light disc with a dark pupil, 3 px or
   more) do more for character than any amount of detail. Squint them with a z scale.
4. **Pick the barrel layer honestly.** A gun, pod or chute is modelled horizontal and
   rotates. If the mobile has no gun (it spits, breathes, casts), do not invent one:
   put only the projectile or effect on the barrel layer, as the frog and the grub do.
   If the weapon is an eye, put its pupil on the barrel layer, ahead of the pivot, and
   the eye looks where it aims (the triclops). If the simulation puts the pivot over
   the face, move the face, not the pivot (tempest, frostbite).
5. **Pose all six states**, in whole pixels for anything that carries the pivot:
   - `idle`: breathing, a blink, something small with a life of its own.
   - `move`: tracks roll, legs step, blobs hop with squash and stretch.
   - `charge`: **required**, 2 frames, looping. Shown for as long as the player holds
     the fire key, so it is the wind-up everybody actually sees: haul the gun back,
     crouch, narrow the eyes, make something shake.
   - `fire`: recoil and flash or projectile. Short, and the camera leaves with the
     shell, so do not hide anything important in it.
   - `hurt`: jolt and squint. The client may tint it.
   - `death`: flash, fireball, the gun comes off, a big silhouette change, a held last
     frame with a little fire or smoke. Machines burn (`set_burnt`); animals do
     something in character instead (the turtle withdraws, the frog flips over).
6. **Colours.** List them in `materials=`. Share the neutral ramps (steel, rubber, glass,
   smoke, the flats; `ink` is free) and add a hue ramp to `palette.json` only when nothing
   fits. The cap is 24 per mobile; post-processing refuses to go over it and using an
   undeclared material fails at build time.
7. **Register it**: a line in `MOBILES` in `make_sprites.py`, an entry in `ATLASES` in
   `packages/client/src/render/blenderSprites.ts`.
8. **Render, look, critique, repeat** (`make_sprites.sh <name>`). Open the preview and the
   frames strip every time. Checklist: silhouette readable at 1x; 3 to 4 clear value
   steps; no noise or broken outlines; the barrel reads against the body; no pixels
   popping between frames; no clip warnings. Keep each pass in `iterations/<name>/`.
   Expect two to four passes.
9. **Check it in the game** with `?a=<id>` in the sandbox (`?sprites=pixel` shows the old
   sprite for comparison): slope tilt,
   aim, the aim line leaving the muzzle, the charge pose while holding fire.

## The UI kit

The HUD and menu pieces go through the same toon and pixel pipeline as the mobiles, so
the UI shares their light, palette and outline.

```
pnpm ui:kit                              # or: uv run tools/blender/make_ui_kit.py
uv run tools/blender/make_ui_kit.py button status/   # re-render only some pieces
```

About 10 seconds for the whole kit. Output, committed:
`packages/client/public/ui/blender/ui_kit.png` and `ui_kit.json` (rect, kind, slices,
pivot and frames per piece). `work/ui_kit_preview.png` shows every piece at 1x and 3x plus
the nine-slices stretched. In the browser, `/uikit` on the dev server is the gallery
(`packages/client/src/scenes/uiKitGallery.ts`).

| File | Job |
| --- | --- |
| `build_ui_kit.py` | Every piece as a tiny scene. Reuses `render_common.py` for materials, render settings and the layered render with its id pass; replaces the tilted mobile camera with a square-on one and puts the key light top left *and in front* (`UI_LIGHT`). Each piece is a builder registered with `@piece(name, size, kind, ...)`. |
| `pack_ui_kit.py` | Runs each render through `postprocess.process_frame` (majority vote, palette, part lines, outline), makes nine-slice edges exact, shelf-packs the atlas and writes the preview. |
| `make_ui_kit.py` | Glue, with the Blender lookup of `make_sprites.py`. |
| `palette.json` | Gains `plate` and `well`, the HUD's navy steel and its dark recess, for panel faces and channels. |

The pieces, and what they are for:

- **Nine-slices** (`kind: nine`, slices in CSS order top, right, bottom, left): `panel`
  (riveted steel), `panel-dark` (read-only furniture), `panel-bar` (the HUD's bottom bar,
  a rail along the top), `recess` (a well), `frame-gold` (an open gold frame, for "this
  is yours"), `button/*` and `button-gold/*` in `normal`, `hover`, `pressed`,
  `disabled`, `trough` (the power bar, a 4 x 8 px channel inside), `trough-small` (hp,
  a 2 x 4 channel inside), `banner/gold` and `banner/steel` (turn banner plates),
  `card/*` (weapon cards: `normal`, `hover`, `selected`, `locked`), `slot/*` (item
  slots: `empty`, `filled`, `used`, `active`).
- **Bars** (`kind: hbar`, every column the same): `fill/*` (8 px tall) and
  `fill-small/*` (4 px) in `amber`, `cyan`, `green`, `red`, `violet`.
- **Sprites**: `dial` (60 px) and `dial-small` (52 px) angle dial faces with ticks every
  15 degrees, `dial-hub`, `wind-plate`, `power-marker` (the last shot's power, pivot at
  its tip). Their `pivot` is the point to place.
- **Strip**: `wind-arrow`, 24 frames every 15 degrees, clockwise on screen from pointing
  right, the convention of `WindState.directionDeg`. Turning the model instead of the
  sprite means the light stays top left at every angle.
- **Icons**: `shot/s1|s2|ss` and `item/<ItemId>` at 16 px, `status/*` at 12 px: shield,
  frozen, boost, dig, dual, ssReady, dead, offline, delay, heart, thor, tornado, force,
  mine.

Decisions worth knowing:

- **Canvas pixel coordinates.** Builders work in the piece's own 1x pixels, y down,
  with pixel *edges* on whole numbers; `W(x, y, d)` converts. Put a thin feature (a
  lip, a tick) on whole pixels: one straddling a pixel edge loses the majority vote on
  both sides and vanishes.
- **Slabs are heightfields.** `plate()` builds a rounded rectangle and a ring per
  `(inset, rise)` step, all facing the camera: a positive rise is a bevel, a negative
  one a recess, `hole=True` leaves the face out (a frame). A frame around a channel must
  have a hole, or its face hides the channel. `lathe()` does the same for round things.
- **Three looks of one material.** Hover and pressed are the same ramp with its toon
  thresholds moved (`mat(name, 'hi' | 'lo')`), so a state adds no colours.
- **Nine-slices are exact by construction.** Everything that varies (corners, rivets,
  the glint of a gem button, a banner's ribbon ends) sits inside the corner slices;
  the packer then copies the middle row and column over the edges and the centre, so
  stretching is lossless in the canvas and in CSS `border-image`.
- **Part groups** work as for mobiles; groups from 20 up glow (no outline, no lines),
  which is how fills and glints keep their colour to the edge.
- **Adding a piece:** write a builder with `@piece(...)`, add its name to the unions
  and `uiPieceNames()` in `packages/client/src/render/uiKit.ts` (the client test
  compares that list with the atlas), run `pnpm ui:kit`, and look at it at `/uikit`.

## Projectiles

Every shot, the pieces behaviours spawn (cluster bomblets, shatter shards, bubbles) and
the walking mines, through the same toon and pixel pipeline, into one atlas keyed by the
sprite key the simulation already puts on each projectile def and mine.

```
pnpm projectiles                         # or: uv run tools/blender/make_projectiles.py
uv run tools/blender/make_projectiles.py turtle ice      # re-render only those modules
uv run tools/blender/make_projectiles.py armor --only missile
uv run tools/blender/make_projectiles.py armor --assets /tmp/p --preview /tmp/p/armor.png
```

The whole roster renders in well under a minute. Output, committed:
`packages/client/public/sprites/blender/projectiles.png` and `projectiles.json` (mode,
size, directions, animation frames and frame rects per key). `work/projectiles_preview.png`
shows each piece's frames at 1x and a selection at 3x on a sky blue. In the browser,
`/projectiles` on the dev server is the gallery: every key per mobile, eight directions
still and a looping arc in flight, with keys the atlas lacks flagged in red
(`packages/client/src/scenes/projectileGallery.ts`).

| File | Job |
| --- | --- |
| `projectile_kit.py` | The toolbox: `@projectile(key, size, mode, ...)`, shapes built along the flight axis (`lathe` for shells, bolts and drills, `fins`, `cone`, `rod`, `ball`, `prism`, `torus`, `tube`), `turn` and `roll`, `extra_ramp`. Its docstring holds the rules. |
| `projectiles/<mobileId>.py` | One module per mobile, registering its pieces. Each renders into its own `work/projectiles/<module>/`, so modules can be worked on side by side. |
| `build_projectiles.py` | Blender side: a square-on camera, the mobiles' key light, no cast shadows; turns every `aim` and `spin` frame. |
| `pack_projectiles.py` | Runs every module's last render through `postprocess.process_frame`, shelf-packs the atlas, writes the preview. |
| `make_projectiles.py` | Glue. `--assets`/`--preview` write a private atlas of only the named modules. |

Decisions worth knowing:

- **Three modes.** `aim` pieces are rendered in 16 directions (optionally a few flicker
  frames each) and the client picks the one nearest the velocity; `spin` pieces turn
  clockwise frame by frame and play by age, backwards when flying left, so a boulder
  rolls the way it goes; `loop` pieces animate themselves (a wobbling gob, a blinking
  mine) and are drawn as they are.
- **Turn the model, never the sprite.** Rotating pixel art on the canvas smears it and
  turns the light upside down on a diving shell. Pre-rendered directions keep every
  pixel crisp and the light top left at every angle, the same reasoning as the wind arrow.
- **Built pointing right, y up, origin at the projectile.** The frame is drawn centred
  on the simulation's position (a mine stands on it instead). A silhouette has to stay
  1 px inside the canvas at every turn so the outline fits; the packer warns otherwise.
- **One zoom for all.** `ZOOM` in `build_projectiles.py` renders every piece that much
  bigger than it is modelled (1.3), by pulling the camera in and adding canvas pixels:
  the sprites grow crisp, the outline stays 1 px, and no module changes.
- **Art only.** Sprite keys are render tags: the collision radius, the trail and the
  explosion stay with the simulation and `effects.ts`. A key the atlas lacks falls back
  to the old square, and the client test fails until it has art.

## Maps

Painted maps (DESIGN §8.1): each map is a landscape modelled in Blender, seen square-on
from the side, and rendered through the same toon and pixel pipeline as the mobiles. The
picture's alpha *is* the terrain mask, so what you see is what you hit, and everything in
the picture (a windmill's sails, a tree, a buried chest) can be shot away. `hills`
(Rolling Hills) is the reference map; the other seven copy it.

```
pnpm maps hills                                   # or: uv run tools/blender/make_maps.py hills
uv run tools/blender/make_maps.py hills --dry     # render, check and preview; write nothing
uv run tools/blender/make_maps.py hills --only terrain        # re-render one canvas (or a plate name)
uv run tools/blender/make_maps.py hills --keep 04_windmill    # also file the previews in iterations/
uv run tools/blender/make_maps.py                 # every map module
```

`hills` renders in about 14 seconds (terrain at 4x, 7200 x 4000, in 3 to 4 s; four
plates in about a second each) and packs in about 10; only the maps named are touched.
Without `uv`, `python3 tools/blender/make_maps.py` works with numpy, Pillow and SciPy
installed.

Output, all committed:

- `packages/client/public/maps/<id>/terrain.png`: the ground, one pixel per map pixel,
  alpha exactly 0 or 255. `<plate>.png` per plate, `thumb.png` (160 x 90).
- `packages/shared/src/data/maps/masks/<id>.ts`, **generated**: `<id>Mask` (the mask as
  the RLE string `encodeRle` in `terrain/codec.ts` writes), `<id>Sky` (the sky gradient
  colours) and `<id>Plates` (every plate's size and placement).
- `work/maps/<id>/preview.png` (the whole map) and `preview_views.png` (what the game
  shows following a mobile at three places on a desktop and one on a phone, with the
  client's own parallax arithmetic), not committed. `iterations/maps/<id>/` keeps the
  previews of each pass.

| File | Job |
| --- | --- |
| `maps/map_kit.py` | The toolbox and the rules (its docstring). `define()` declares a map (size, sky, outline) and returns a spec to hang ramps (`ramp`, optionally `mottle`d), flats, the `@spec.terrain` builder and `@spec.plate(name, parallax)` builders on. Geometry in canvas pixels: profiles (`smooth`, `height_at`, `offset`, `wobble`), slabs (`prism`, `ground`, `band`, `stratum`), round things (`tube`, `rock`, `blob`, `lathe`, `cylinder`, `log`, `box`), and props that are terrain (`grass_edge`, `tuft`, `flowers`, `tree`, `pine`, `roof`, `planks`, `mountain`). |
| `maps/<id>.py` | One module per map: its palette, its profile, its terrain builder and its three to five plates. It needs nothing outside itself except the kit. |
| `maps/build_maps.py` | Blender side: builds each canvas in an empty scene under a square-on orthographic camera and the mobiles' key light, renders it and its id pass at 4x into `work/maps/<id>/`. |
| `maps/pack_maps.py` | Reduces the renders (majority vote to the palette, part lines, specks and pinholes, outline), crops the plates, composes the thumbnail and previews, checks the budgets, writes the assets and the generated TypeScript. |
| `make_maps.py` | Glue, with the Blender lookup of `make_sprites.py`. |

Decisions worth knowing:

- **Space.** Canvas pixels, x right, y **down**, depth `d` towards the camera: the map's
  own convention, so a profile in a module is a profile in the game. One canvas pixel
  per map pixel for the terrain; a plate is modelled in its own canvas and `P.at(x, y)`
  gives the plate point drawn behind map point (x, y) when the camera is centred on it.
- **No tilt.** The mobiles' camera looks down 15 degrees; a map's camera looks square on,
  because the silhouette is the collision. Top surfaces read through light instead: a
  face turned to the camera lands in a ramp's mid step, one turned up in light, a
  rounded edge turned to the top left in highlight. So texture is geometry (strata a
  pixel proud of the slab, stones half sunk in it, a rounded grass lip), plus `mottle`,
  which lets a noise choose between two ramps so a big face breaks into patches without
  a new colour.
- **One 4x frame, no tiles.** 7200 x 4000 renders in EEVEE in a few seconds, so there is
  no tiling. The packer is whole-array numpy (the mobiles' `postprocess.py` loops per
  pixel, which would take hours here): unique colours are snapped to the palette once,
  the majority vote runs one colour at a time over the 4 x 4 blocks.
- **The mask is the final alpha.** Solid specks under 24 px are dropped (a floating
  pixel would be ground a mobile could land on), sealed air pockets under 24 px are
  filled, and the 1 px outline goes on the *air* side of the silhouette, so it is part
  of the mask. The pack step checks the alpha against the mask it writes, and the
  client test checks the committed PNG against the committed RLE.
- **Indexed PNGs.** Slot 0 transparent, then the colours used: `hills` is 122 KB for all
  six files against a 1.2 MB budget. Budgets are enforced before anything is written:
  48 colours in the terrain, 32 in a plate (each canvas is quantised only to the ramps
  its own objects use), alpha exactly 0 or 255.
- **Plates are sized, not tiled.** A plate canvas is `800 + (W - 800) * parallax` by
  `600 + (H - 600) * parallax`, which covers the view at every camera position for every
  view height from 360 to 600. The packer crops the empty rows above the scenery into
  the layer's `y` and a flat run of rows at the bottom into `fillBelow`. The client
  draws it in one `drawImage` (`render/background.ts`), between whatever code-drawn
  layers the map file puts around it: the sky, the sun, clouds and birds still move.
- **Plates are quiet.** No cast shadows, their own outline colour (a dark tone of their
  own ramp, not the terrain's near-black), low contrast and bluer the further back: the
  playfield has to pop off them.
- **Walkable ground is smooth.** Walking probes three columns of a mobile's footprint and
  treats anything more than `maxStep` over its feet as a wall; the smallest `maxStep` in
  the roster is 4. So nothing on a surface meant to be walked may stick up more than 3 px
  (`map_kit.WALK_BUMP_PX`): `grass_edge` puts the blades and flowers on the *front* of
  the lip and only 2 to 3 px nubs on the silhouette, and `tuft` (4 to 8 px) is for
  slopes nobody stands on. The same probe makes any slope steeper than about
  `maxStep / 13` (17 to 21 degrees) a wall: a valley split in two by an outcrop is two
  pockets a mobile cannot leave.
- **Spawns and the ground have to agree.** The map pass found seats starting wedged on
  the lip of a slope (one footprint end above `maxStep`) and balanced on a pine's tip
  (both ends far below the feet), on the procedural maps too. `spawnGen.maxEdgeRisePx`
  (4) and `maxEdgeDipPx` (13) now keep the strict spawn stages off both.
- **Buried things cast no shadow.** A map is a cross-section: a fossil, a pebble in a
  stratum or a mine cart in its drift lies *in* the cut face, and the shadow it threw on
  the slab behind (Sunset Chasm's petrified log had a dark wedge under it,
  `docs/ui/maps/shadow_fix_pit_log.png`; every map had the same on its buried props and
  pebbles) is something no light could make. After the terrain builder runs,
  `map_kit.settle_shadows` looks square on at the ring 2 px outside each object's outline
  (ray casts through a BVH of the whole canvas, under a second for 2000 objects): if every
  point of it shows the *body* (anything reaching `BODY_BACK_PX` = 24 px or more behind the
  picture plane: slabs, strata, bedrock, the cave roof), another buried object, or a seam
  flush on the body (front at most `FLUSH_PX` = 4 px proud: a fault, a grass skirt), the
  object is buried and gets `visible_shadow = False`. Its toon shading from its normals
  stays. The grass lip and its blades, trees, houses and everything standing on a prop
  (a window on a wall, a ladder on a house) keep casting. It is automatic, so a new map
  cannot regress; `map_kit.cast_shadow(obj, True/False)` overrides one object. Shadows
  change colour only, never alpha, so re-rendering leaves every mask byte-identical.
- **A failed render stops the run.** Blender is started with `--python-exit-code 1`
  (without it a Python error in `build_maps.py` still exits 0) and `make_maps.py` also
  checks that every map named has a fresh `work/maps/<id>/meta.json`, so the packer never
  re-packs a stale render.
- **The sky lives in the module.** `define(sky=[...])` is written into the generated
  TypeScript, which the map file uses for its gradient layer, so the game and the
  thumbnail agree.
- **Thumbnails** are the whole map with each plate scaled to the map's width and lined
  up on the map's horizon row. Good enough at 160 x 90; the in-game views are what
  `preview_views.png` is for.

### Playbook: adding a map

1. **Read DESIGN §8.1 and `maps/hills.py`**, then look at `iterations/maps/hills/`
   in order: it shows what each pass changed and why.
2. **Copy `maps/hills.py` to `maps/<id>.py`.** Change `define(...)` (id, size 1600 to
   2000 by 900 to 1200, sky, outline), the ramps (four colours each, shadow to
   highlight; count them: outline + 4 per ramp + flats must stay at 48 or under), the
   profile, the terrain builder and the plates. Keep the module self-contained; if a
   helper would help two maps, add it to `map_kit.py` with a docstring.
3. **Author the profile** as control points left to right (`smooth()` runs a curve
   through them; repeat a point for a hard corner):
   - Know the spawn slots: margin 10 % of the width each side, then the usable width
     split into 2, 4 or 8 slots; a seat searches outward from its slot for the nearest
     legal column. Give every 2- and 4-seat slot a flat shelf (under 4 px of rise over
     26 px) wider than its jitter (6 % of a slot) plus 13 px each side, with 115 px of
     air over it. Put obstacles, trees and props everywhere else.
   - Keep important geometry in the lower part of the map: the camera follows mobiles
     and shells, and a ceiling above `height - viewHeight` is rarely on screen.
   - Slopes over about 20 degrees are walls. Make walls on purpose (a cliff, a ledge's
     back wall), and make sure no slot sits in a pocket between two of them.
   - Something that must not be spawned on (a crown, a roof) should be pointed or
     sloped: a round crown or a flat roof near a slot is a legal spawn.
   - A map with holes (a chasm, gaps between islands) just leaves them out of the
     silhouette: build separate `ground`/`prism` pieces instead of one slab.
4. **Render and look**: `uv run tools/blender/make_maps.py <id> --dry`, then open
   `work/maps/<id>/preview.png` and `preview_views.png`. Critique, fix, repeat; `--keep
   NN_label` on each pass you want to remember. Expect three to six passes.
5. **Wire it into shared**: `pnpm maps <id>` writes `masks/<id>.ts`. Copy
   `packages/shared/src/data/maps/hills.ts` to `<id>.ts` (for `pit`, `islands` and `cave`,
   replace the existing file): `source: { kind: 'mask', rle: <id>Mask }`, a background
   that interleaves `<id>Plates.*` with the code-drawn layers that move (the gradient with
   `<id>Sky` first), a fallback `palette` (with `scorch`, which also rims craters on the
   picture) and `art: { terrain: 'terrain.png', thumb: 'thumb.png' }`. Register it: one
   import and one line in `registered` in `data/maps/index.ts` (the order there does not
   matter; `mapOrder` fixes where it is listed). Remaking `pit`, `islands` or `cave`:
   delete its entry in `KNOWN_GAPS` and rewrite its own `describe` block in
   `test/maps.test.ts`, which asserts facts about the procedural generator.
6. **Tests**: `pnpm --filter @gunbros/shared test -- maps` runs the playability suite on
   your map (`test/mapPlayability.ts`): over 20 seeds and 2, 4 and 8 seats, legal spawns
   (grounded, 12 px of rock, under 30 degrees, headroom, separation), no seat in a
   sealed pocket (air flood-filled from the top and sides reaches it), nobody boxed in
   (an armor can drive 40 px one way or the other from a 2- or 4-seat spawn), and every
   seat can hit an opponent in still air with the reference shell, simulated with the
   shared projectile code against the real mask. Failures name the seed, the seat and
   the column. `pnpm --filter @gunbros/client test -- mapArt` checks the PNG's alpha
   against the mask, the plate sizes, the thumbnail and the byte budget.
7. **Look at it in the game**: `/sandbox?map=<id>&sky=none` on the dev server, at a
   desktop size and at a phone size (800 x 370 in the browser pane). Fire into the
   ground and into a prop: the hole is clear and rimmed with the map's `scorch` colours.
   Walk along the shelves. Watch the plates while the camera pans and rises: nothing
   should slide past the ground in a way that reads wrong, and no plate edge or fill
   should show.
8. **Checklist**: nothing buried throws a shadow on the face behind it (the build log
   prints how many objects `settle_shadows` buried; a prop embedded in another prop
   that is not itself buried keeps its shadow, so check those by eye); the silhouette
   reads at 1x; the playfield pops off the plates; three
   or four value steps per material, light from the top left; busy and chibi (big
   shapes, bold outlines, small details everywhere); nothing on a walkable surface over
   3 px; every PNG and colour budget met; all tests pass.

## Effects

Explosions, hit pops, smoke, the death blast, beams, the teleport and the vortex, as
flipbooks through the same toon and pixel pipeline, into one atlas the client plays by
age (DESIGN §8.2).

```
pnpm effects                                        # or: python3 tools/blender/make_effects.py
python3 tools/blender/make_effects.py blasts        # only one module (blasts, hits, smoke, beams)
python3 tools/blender/make_effects.py blasts --only 'blast_ice_*,death_blast'
python3 tools/blender/make_effects.py blasts --only blast_fire_m --dry   # look, write nothing
python3 tools/blender/make_effects.py --pack        # re-pack the last renders only
```

Every module renders in its own Blender, four at a time; the whole set takes about four
minutes (the blasts module is most of it), one effect five to twenty seconds. Output,
committed: `packages/client/public/sprites/blender/effects.png` (indexed, about 180 KB for
37 clips) and `effects.json`. `work/effects_preview.png` shows every frame of every clip
on its canvas at 2x (3x on a sky and a dusk sky when four or fewer are named), the anchor
marked in magenta (preview only). In the browser, `/effects` on the dev server loops
every clip at game speed on a strip of sky and ground (`scenes/effectGallery.ts`).
`iterations/effects/` keeps the previews of each pass.

| File | Job |
| --- | --- |
| `effects_kit.py` | The toolbox and its rules (docstring): `@effect(key, size, anchor, frames, ticks, materials, outline, loop, tile)`, the three looks (`heat`, `toon`, `flat`), the extra ramps and flats (`EFFECT_RAMPS`, `EFFECT_FLATS`, built from the old code ramps), shapes (`blob` metaballs, `ball`, `shard`, `chunk`, `ring`, `disc`, `star`, `bolt`, `zigzag`, and the projectile kit's `tube`, `lathe`, `prism`) and timeline helpers (`span`, `ease_in`, `ease_out`, `lerp`). |
| `effects/blasts.py` | The six blasts in three tiers, and the death blast. |
| `effects/hits.py`, `effects/smoke.py`, `effects/beams.py` | Hit pops; smoke puffs; beam segments, the beam burst, the teleport and the vortex. |
| `build_effects.py` | Blender side: a square-on camera placed so the effect's anchor lands on its anchor pixel, the mobiles' key light with no cast shadows, every frame built from scratch; small pieces that fly off the canvas are dropped. |
| `pack_effects.py` | The maps' whole-array reduction (majority vote to the clip's palette, part lines, specks, outline round the lit parts only, orphans), per-frame trim, shelf pack, indexed PNG, budget check (255 colours, 1.5 MB), preview. |
| `make_effects.py` | Glue: parallel Blender per module, then the packer. |

How an effect is made:

- **A function of time.** `build(i, t, rng)` returns frame `i`'s objects; `t` runs 0 to 1.
  The rng is re-seeded from the key for every frame, so the same puffs and shards come out
  every time and only what the build does with `t` moves them. Draw everything from the
  rng before branching on `t`, or later frames get different particles. A flicker that
  should change every frame (energy arcs) uses its own `random.Random(i)`.
- **Metaballs for anything soft.** Fireballs, flame tongues, the water crown and the plasma
  ball are metaball `blob`s converted to a mesh every frame, so the id pass and the
  toon shader treat them like any other part. Balls in a chain must sit closer than a third
  to half of their radius, or the tongue or sheet breaks into beads (the first fire and
  water passes did).
- **Three looks.** `heat` is unlit and shaded by facing (plus a little key light) through a
  constant ramp: each lobe of a fireball gets its own hot heart and a dark rim. Its
  `level` slides the ramp, which is how a fireball cools. Heat parts go in glow groups
  (>= 20): no outline, their dark rim is the edge. `toon` is the mobiles' lit ramp, for
  things with a surface (smoke, dust, rock, ice, water), outlined in the clip's own
  `outline` colour (a dark of its own hue, not the mobiles' near-black). `flat` is one
  unlit colour for flashes, sparkles and beam cores.
- **Frame timing is ticks.** Each clip lists ticks per frame; blasts start at 2 ticks a
  frame and slow to 5 or 6 as the smoke hangs. A flash frame is frame 0 and lasts 2 ticks.

Decisions and gotchas:

- **Tiers, not scaling.** Blasts come in three sizes (R = 16, 26, 40 px), each the same
  design built around R. The client takes the tier nearest the carve radius and adds
  satellite blasts past the largest; see DESIGN §7 item 173. One variant per clip: flips
  would move the light (item 174).
- **Smoke as separate balls, fire as one blob.** Merging the smoke into one metaball made
  a grey rock; overlapping plain spheres in six part groups, lit by the toon ramp, read as
  a cartoon cloud. The fire keeps merging, so it boils.
- **Cool from the rim in.** Puffs far from the centre turn to smoke first, so the smoke
  closes round a heart that is still burning instead of the whole ball switching at once.
- **Shape by type, not by colour.** First passes that read wrong: water as blue sticks
  (candles), then as a bowl of beads; ice as a thistle on a stem; fire as a pale onion,
  then as a tent. What worked: water is a low dome, then a thin crown sheet round a ring
  seen slightly from above with drops thrown off the rim; ice is a radial burst wider than
  tall that shatters, with a frost crust; fire is a wide row of tongues, yellow at the root
  and red at the tips, with the white core only in the first frames.
- **Name clash.** A flat and a palette.json ramp must not share a name: `white` is a ramp,
  so the pure white flat is `bright`.
- **Beams tile.** A beam segment is built well past both ends of its 32 px canvas and
  everything in it repeats every 32 px (the helix pitch is the tile), so tiles meet with no
  seam. `tile=True` exempts it from the edge check; the pack keeps it full height.
- **Anchor.** The event's position is the anchor pixel: the burst point for blasts, the hull
  centre for hit pops and the death blast, the feet for the teleport, the landing point for
  the beam burst, the top edge for a beam segment.
- **Adding an effect:** register it with `@effect` in a module (or a new module), list every
  ramp and flat it uses in `materials=`, render it with `--only <key> --dry`, look at the
  preview, then use it from `render/effects.ts` through `effectClip`/`drawEffectFrame` and
  add its key to the client test (`test/effectSprites.test.ts`) and the gallery.
