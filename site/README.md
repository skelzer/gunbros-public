# GunBros splash page

The static landing page for <https://gunbros.example.com>: one HTML page, one
stylesheet, one small script, and pixel art cut from the game's own files at build time.
No framework, no bundler, no dependencies beyond Node 22.

## Build

```
pnpm site          # node site/build.mjs  ->  site/dist/
pnpm site:og       # node site/og.mjs     ->  site/og.png (committed; rerun when the art changes)
```

`site/build.mjs` reads the game and writes `site/dist/` (git-ignored):

| Output | From |
| --- | --- |
| `art/hero/` terrain and plates | `packages/client/public/maps/hills/`, placed with the numbers in `packages/shared/src/data/maps/masks/hills.ts` |
| `art/mobiles/<atlas>.png` | each mobile's Blender sheet (`public/sprites/blender/`): the idle loop, barrel over body, row 0 level (roster), row 1 raised 32° (hero), cropped to the loop's bounds |
| roster names, classes, SS names | `packages/shared/src/data/mobiles/*.ts` |
| `art/maps/<id>.png` | each map rendered through its plates and terrain at a fixed camera (`MAP_FOCUS`), with two mobiles on the ground (`MAP_CAST`) |
| `art/wordmark.png` | the lobby's 7×9 letters in `packages/client/src/ui/pixelFont.ts` |
| `art/ui_kit.png` + generated CSS | `public/ui/blender/ui_kit.png|json` |
| `icons/`, `og.png` | `public/icons/`, `site/og.png` |

The map one-liners are in `MAP_IDEAS` in `build.mjs` (from `docs/PROGRESS.md`). The
page text lives in `site/index.html`; the build fills its `<!--ROSTER-->`, `<!--MAPS-->`,
`/*UI_CSS*/` and `"__HERO_DATA__"` markers.

## The PLAY button

`GAME_URL` at the top of `site/script.js`. Empty (the default) means the game is not
online yet: PLAY shows a greyed "Coming soon" key and the hero says online play is on
its way. Set it, for example to `'https://play.gunbros.example.com'`, rebuild, and
PLAY links there everywhere on the page.

## Preview

```
pnpm site
python3 -m http.server 8140 --directory site/dist     # http://localhost:8140
```

## Deploy (Cloudflare Workers static assets)

Live at https://gunbros.example.com.

```
pnpm site:deploy        # builds site/dist, then wrangler deploy from site/
```

`site/wrangler.jsonc` describes the Worker `gunbros-site`: static assets from `./dist`
and a custom-domain route for `gunbros.example.com`, which creates the DNS record and
the certificate on the first deploy (example.com is on Cloudflare DNS). Wrangler asks
to log in once (`npx wrangler login`). `wrangler pages deploy` no longer works from inside
this pnpm workspace: recent wrangler hands Pages over to Workers and refuses to run its
app detection at a workspace root, so the site is a Workers static-assets app instead.

To turn PLAY on once the game is deployed, set `GAME_URL` at the top of
`site/script.js` and deploy again.

`site/_headers` (copied into `dist/`) sets a strict Content-Security-Policy (self plus
Google Fonts), `nosniff`, and a one-day cache for `art/` and `icons/`.

## Budget

About 360 KiB for the whole of `dist/`, plus the Silkscreen font from Google Fonts (the
only outside request). Everything below the hero is `loading="lazy"`. Reduced motion
stops the camera sweep, the clouds and every sprite and CSS animation.
