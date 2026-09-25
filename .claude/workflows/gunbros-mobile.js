export const meta = {
  name: 'gunbros-mobile',
  description: 'Mobile landscape support: adaptive canvas layout, touch controls, responsive lobby/room, PWA manifest; verify under phone emulation; fix',
  phases: [
    { title: 'Layout', detail: 'fit-to-screen canvas, adaptive internal height, HUD/camera' },
    { title: 'Touch + PWA', detail: 'pointer/touch controls, responsive DOM, manifest, orientation hint' },
    { title: 'Verify', detail: 'build/e2e, phone-emulated playtest, usability review' },
    { title: 'Fix', detail: 'address verified issues' },
  ],
}

const COMMON = `
You are working in the repository at the repository root (git repo, pushed to GitHub). The game is complete for desktop (683 unit tests, Playwright smoke). GOAL OF THIS PASS: the owner's brother will play on a PHONE IN LANDSCAPE (iPhone and Android, Safari and Chrome). Everything must be usable with fingers: lobby, room, and the match.
FIRST read docs/DESIGN.md §1.3 and §2 (view and camera: internal 800x600 nearest-neighbour), docs/PROGRESS.md, and the client code you build on: packages/client/src/render/canvas.ts, render/camera.ts, render/hud.ts (pure bottomBarLayout/hudHitTest helpers), scenes/matchView.ts, scenes/match.ts, scenes/sandbox.ts, scenes/lobby.ts, scenes/room.ts, ui/**, input/**, data/clientConstants.ts, index.html, and packages/client/test/**.
Rules:
- TypeScript strict; keep conventions. No gameplay/sim changes (packages/shared untouched except nothing). The simulation stays 800-px-wide-world agnostic: only presentation changes.
- Presentation tunables in packages/client/src/data/clientConstants.ts.
- Do NOT git commit/add; do not edit docs/PROGRESS.md. Append to docs/DESIGN.md §7 Assumptions if you make a choice the design left open (re-read before appending).
- Leave no servers running; use ports 8180-8199 for anything you start and kill it afterwards.
- Existing tests must keep passing; update pure-helper tests when geometry changes intentionally.
- Verify with Playwright (installed in e2e/): use device descriptors such as devices['iPhone 13 landscape'] and devices['iPhone SE landscape'] (or explicit viewport 667x375 / 844x390 / 932x430 with isMobile:true, hasTouch:true, deviceScaleFactor 3). Throwaway scripts go under /private/tmp/claude-504 but must be RUN FROM the e2e directory (copy them in as .tmp-*.mjs and delete afterwards) so @playwright/test resolves. For touch holds use a CDP session (Input.dispatchTouchEvent touchStart/touchEnd) or page.touchscreen.tap for taps.
`

const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    publicApi: { type: 'string' },
    commandsVerified: { type: 'array', items: { type: 'string' } },
    testsPass: { type: 'boolean' },
    knownIssues: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'filesChanged', 'publicApi', 'commandsVerified', 'testsPass', 'knownIssues'],
}

const ISSUES_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          file: { type: 'string' },
          description: { type: 'string' },
          suggestedFix: { type: 'string' },
        },
        required: ['severity', 'file', 'description', 'suggestedFix'],
      },
    },
  },
  required: ['ok', 'issues'],
}

phase('Layout')
log('Layout agent: fit-to-screen canvas with adaptive internal height')
const layout = await agent(`${COMMON}
YOUR TASK: make the match canvas fit any landscape screen with a finger-sized HUD.
Design (record it in DESIGN §7): the internal backbuffer keeps a fixed width of 800 px, but its HEIGHT adapts to the screen aspect: height = clamp(round(800 * screenH / screenW), clientConstants.view.minHeight (e.g. 400), 600). Desktop windows near 4:3 keep 800x600; a phone at 844x390 gets 800x370→ clamped to 400 (so 800x400 letterboxed slightly) — pick the clamp so a 19.5:9 phone gets no letterbox if you can (min height ~369); decide and document. The canvas is then scaled to fit the window: integer scale when scale >= 1 (desktop, as today), fractional fit scale when the window is smaller than the backbuffer (phones/tablets) — never letterbox more than necessary; keep imageSmoothing off and CSS image-rendering: pixelated; account for devicePixelRatio so the canvas stays crisp (backbuffer rendered at DPR-aware size is NOT needed; the CSS scaling of the 800-wide buffer at DPR 3 is fine, but make sure the CSS size is computed from visualViewport / innerWidth and updates on resize and orientationchange, and that safe-area insets (env(safe-area-inset-*)) are respected so the HUD is not under the notch or home indicator).
Then make every consumer height-aware: camera bounds/clamping and follow use the actual view height; the HUD bottom bar anchors to the bottom (bottomBarLayout takes the view size; keep it pure and update its tests), top-centre wind/timer/banner positions, the delay list, debug overlay, sky label, effects (screen shake), name tags, the chat overlay, the game-over plate, the sandbox and the networked match scene both. Nothing may overlap or clip at 800x370..800x600.
Touch target sizing: when the fit scale is below 1, the HUD must still be usable — make the bottom bar buttons at least 44 CSS px tall on a 390-px-tall phone (i.e. compute a HUD "compact/large" variant: bigger buttons and text, fewer decorative elements, when clientConstants says the view is short). Keep the layout helper pure so it can be unit tested for both variants.
Verify with Playwright screenshots at iPhone SE landscape (667x375), iPhone 13 landscape (844x390), Pixel 7 landscape (915x412), iPad landscape (1180x820) and a 1600x1200 desktop, in the sandbox (start Vite on port 8181): view every screenshot, iterate until nothing clips and everything is readable, kill Vite. Run pnpm --filter @gunbros/client typecheck, lint, test, build.
Return a report; in publicApi describe the new view-size API (how a scene gets the current internal size, how the HUD variant is chosen) for the next agent.`, { label: 'layout', model: 'opus', effort: 'high', schema: REPORT_SCHEMA })
if (!layout) throw new Error('layout agent failed')
log('Layout done')

phase('Touch + PWA')
log('Touch agent: pointer controls, responsive DOM, manifest')
const touch = await agent(`${COMMON}
CONTEXT from the layout agent: ${layout.publicApi}
YOUR TASK: make everything work with fingers, and make the app feel native on a phone.
1. Match input: convert mouse handling to Pointer Events with touch-action: none on the canvas; multi-touch: one finger can hold FIRE while another taps angle/move buttons (track pointers by pointerId); press-and-hold auto-repeat on the angle and move buttons (movement while held, angle stepping with acceleration); tap on shot/item/skip/chat buttons; drag on the world pans the camera; tap on the map in teleport-targeting mode sends the target; prevent the page from scrolling/zooming/bouncing (touch-action, overscroll-behavior, preventDefault on gesturestart, user-scalable=no in the viewport meta, viewport-fit=cover). Long-press must not open the context menu. Keep keyboard/mouse working on desktop.
2. Add an on-screen "AIM" drag pad or slider as the primary touch aiming control if the arrow buttons feel too slow (your call: a vertical drag on the angle dial that changes relAngle continuously is the simplest; show the numeric angle while dragging). Also a hold-to-charge behaviour on the big FIRE button with a visible ring/bar under the finger.
3. In-match chat on phone: the chat button opens a DOM input overlay that plays well with the virtual keyboard (the canvas must not resize weirdly when the keyboard opens: use visualViewport events; closing the keyboard returns to the game).
4. Lobby and room DOM: fully responsive for 667x375 up to desktop: a compact single-screen room in landscape (scrollable sections, the mobile picker as a horizontally scrollable strip of portraits, items as a strip, big Ready/Start buttons, room code with a share button using navigator.share when available and copy fallback), inputs with proper font-size >= 16px so iOS does not zoom, no hover-only affordances.
5. PWA: public/manifest.webmanifest (name GunBros, display standalone, orientation landscape, theme/background colours, icons 192/512 generated as PNG from the armor sprite with the repo's PNG encoder in tools/sprites — add a small script tools/icons.ts and commit the generated PNGs under packages/client/public/icons/), apple-touch-icon and apple-mobile-web-app-capable meta, a "Fullscreen" button in the lobby (requestFullscreen + screen.orientation.lock('landscape') where available, silently ignored otherwise), and a portrait-orientation overlay "Rotate your phone" shown via a (orientation: portrait) media query on phones only. Make sure the server serves /manifest.webmanifest and /icons/* with correct content types (packages/server/src/index.ts content-type map).
6. Wake lock: request navigator.wakeLock while in a match if available, re-request on visibilitychange.
Verify with Playwright under iPhone 13 landscape emulation with hasTouch (start the built server on port 8182 after pnpm -r build): create a room in one context, join by link from a second phone-emulated context, both ready, start, and with touch only: hold FIRE (CDP touch events) to fire a shot, tap an item, tap the angle pad, pan the camera, open and send a chat line; screenshot each step and view them; then repeat lobby/room screenshots at iPhone SE landscape. Kill servers. Run pnpm -r typecheck, lint, test, build and pnpm e2e.
Return a report.`, { label: 'touch+pwa', model: 'opus', effort: 'high', schema: REPORT_SCHEMA })
if (!touch) throw new Error('touch agent failed')
log('Touch + PWA done')

phase('Verify')
const verifyCommon = `${COMMON}
You are a VERIFIER. Do not edit any repository file. Prior agents reported: ${JSON.stringify([...layout.knownIssues, ...touch.knownIssues])}`
const checks = await parallel([
  () => agent(`${verifyCommon}
Run pnpm install, pnpm -r typecheck, pnpm -r lint, pnpm -r test, pnpm -r build, pnpm e2e; report failures verbatim. Then check that the desktop experience did not regress: at a 1600x1200 viewport the canvas is 800x600 at integer scale 2 with the full HUD; at 1280x720 it fits without clipping. Kill servers.`, { label: 'verify:build', phase: 'Verify', model: 'opus', effort: 'medium', schema: ISSUES_SCHEMA }),
  () => agent(`${verifyCommon}
Phone playtest. Build and run the built server on PORT=8185. Two Playwright contexts with devices['iPhone 13 landscape'] (hasTouch true) and one with devices['iPhone SE landscape'] as the guest: full flow using ONLY touch (page.touchscreen.tap and CDP Input.dispatchTouchEvent for holds): nickname, create room, share/copy code, join via /r/CODE on the other phone, pick mobiles from the portrait strip, pick a loadout, ready, start; then 4 turns: aim with the pad/dial, move with the on-screen buttons, hold FIRE to charge and release, use an item, use teleport by tapping the map, open chat and send a message, pan the camera by dragging, and let one turn time out. After each step screenshot both phones and VIEW them. Check: no element under the notch/home-indicator safe areas, buttons >= 44 CSS px, text legible, no accidental page scroll or zoom, no console errors, desyncs 0, turn advances. Also reload the guest mid-match and confirm reconnection on the phone layout. Report every failure with the screenshot path. Kill the server.`, { label: 'verify:phone', phase: 'Verify', model: 'opus', effort: 'high', schema: ISSUES_SCHEMA }),
  () => agent(`${verifyCommon}
Usability and code review for mobile: read the new pointer/touch code, the layout code and the DOM scenes. Look for: pointer handlers that leak (no pointercancel handling; a finger lifted outside the canvas leaves FIRE charging forever), double-firing from both touch and synthesized mouse events, hover-only affordances, iOS-specific traps (100vh, input zoom under 16px, requestFullscreen unsupported on iPhone must not throw or block, orientation.lock rejections unhandled, audio not unlocked on touchend), the manifest and icons served with correct MIME types by the server, the HUD variant selection being pure and tested, the desktop path unchanged. Report concrete issues with file/line.`, { label: 'verify:review', phase: 'Verify', model: 'opus', effort: 'high', schema: ISSUES_SCHEMA }),
])
const issues = checks.filter(Boolean).flatMap(c => c.issues)
log(`Verification found ${issues.length} issues`)

phase('Fix')
let fix = null
if (issues.length > 0) {
  fix = await agent(`${COMMON}
CONTEXT: The mobile pass is implemented. Verifiers found the issues below. Fix every blocker and major and the cheap minors; re-verify visually under iPhone 13 landscape emulation for anything visual. Then run pnpm -r typecheck, lint, test, build and pnpm e2e; all must pass. Leave no servers running.
ISSUES:
${JSON.stringify(issues, null, 2)}
Return a report.`, { label: 'fix', model: 'opus', effort: 'high', schema: REPORT_SCHEMA })
}
return { layout, touch, issues, fix }