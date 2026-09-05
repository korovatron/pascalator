# iOS PWA "bottom bar" viewport bug - root cause and fix

This documents how the long-standing iOS home-screen/standalone-PWA bug (a gap of raw
background visible at the bottom of the screen, on top of a fixed-viewport app shell) was
finally resolved in Pascalator, after being carried unresolved for over a year across several
sibling apps (Graphiti, Komplexiti, Mandelscope) via a JS-based workaround originally written
for Graphiti. Apply the same fix to those apps.

## Symptoms

- A black/background-coloured bar appears at the bottom of the screen in standalone/fullscreen
  PWA mode on iOS, as if the app's content is rendered shorter than the real screen.
- Historically believed to happen mainly on cold app launch. In practice (once tested more
  thoroughly) it's deterministic: **it happens on every single load in portrait**, and never in
  landscape.
- Rotating to landscape and back to portrait always fixes it immediately.
- After the bug is showing, navigating to a different page in the app and back re-introduces it
  every time (this is really just "another portrait page load", not a separate bug).
- A related/same-root-cause symptom: after an orientation change, on-screen buttons can become
  visually correct but unresponsive to taps for a while (WebKit's hit-testing geometry lagging
  behind its own visual repaint).
- Only ever affected pages with a fixed-viewport "app shell" layout (`position: fixed`/`overflow:
  hidden` root elements sized via a viewport-height unit) - normal scrolling document pages
  (e.g. a plain content/landing page using `min-height: 100vh` with normal overflow) never show
  the bug at all, even in the same app, even though they're subject to the exact same iOS
  environment.

## Root cause

iOS WebKit's standalone-mode viewport-height calculation (`100vh`/`100dvh`/`window.innerHeight`)
has a **first-paint bug specifically in portrait orientation**: on the very first layout pass
after a fresh document load (cold launch, or navigating to a new page within the PWA), it
computes a viewport height that's shorter than the true screen height. The value is
**genuinely wrong at the browser/OS level** - `window.innerHeight` isn't lying about a value
that's secretly available elsewhere, the WKWebView's own native frame really is laid out short.
Only a genuine orientation change forces WebKit to redo a full native relayout pass, which
computes the height correctly.

This means:

- Any JS-based "detect the wrong height and correct it" approach is fighting a losing battle:
  there's nothing to detect via comparing `window.innerHeight` against `screen.height`/
  `visualViewport.height`/etc. - they're all wrong together, consistently, in exactly the same
  way, on every affected load.
- Fixed-viewport app shells (this app's `explore.html`, using `position:fixed` +
  `overflow:hidden` + a viewport-height CSS unit) expose the bug visually as a hard-edged gap.
  Normal scrolling pages don't, because a slightly-too-short computed height just means very
  slightly less scrollable content - there's no fixed/clipped container to reveal a seam against.

## What did NOT work (don't waste time repeating these)

All of the following were tried, in this order, on a real device, and none of them fixed it:

1. The original "Graphiti" JS workaround (a `fixIOSViewportBug()` function): read
   `window.innerHeight`, compare against `Math.max(screen.width, screen.height)`, and if the
   shortfall looked like "the bug" (a specific px range), write the corrected value to a
   `--actual-vh` custom property used by the CSS instead of `100vh`. Re-checked on a staggered
   schedule of `setTimeout`s for ~2.5s after load/orientation change/visibility change.
   - This is the fix that was silently failing/making things worse throughout - see below.
2. Guarding `resizeCanvas()`/canvas resets to skip redundant resize events when the measured
   size hadn't changed (to avoid wiping user pan/zoom in the first few seconds after load) -
   this broke the workaround's ability to force a re-measure, making the bug *more* frequent.
3. Handling back-forward-cache (`pageshow`/`event.persisted`) restores by re-running the
   correction - didn't help, because the bug isn't about the script failing to re-run, it's
   about the browser's own layout being wrong regardless of whether/when our script runs.
4. Toggling the `<meta name="viewport">` tag's content briefly (a known trick for nudging
   WebKit into recomputing viewport geometry outside of a real zoom/rotation) - no effect.
5. Unconditionally forcing `viewportHeight = screenPortraitHeight` on every check, skipping the
   shortfall-detection heuristic entirely (reasoning: "there's no address bar in standalone mode
   so the height should always just equal the screen") - this was **strictly worse**: the bug
   then appeared on literally every load (including first launch, which was previously always
   fine) and was twice the height. This proves `window.innerHeight` is **not** always supposed
   to equal the full screen height in standalone mode - there's a legitimate, consistent gap
   (likely related to the home indicator safe area) that a naive "always force full screen"
   approach overshoots.
6. Preferring `window.visualViewport.height` over `window.innerHeight`, plus forcing a
   synchronous reflow (`document.body.offsetHeight`) before reading it, based on a comparison
   with a sibling app ("Mandelscope") believed to not have the bug - this comparison turned out
   to be invalid (Mandelscope has the exact same bug, just not noticed before), so this avenue
   was abandoned too.
7. Switching the CSS unit from `100dvh` to `100lvh` (Large Viewport Height - assumes all browser
   chrome retracted, which should need no dynamic recalculation in a true fullscreen PWA) -
   behaved identically to `100dvh`. This ruled out "which specific viewport unit" as the
   variable that mattered.

## What actually fixed it

**Delete the entire JS workaround.** Don't try to detect or correct the height in JavaScript at
all. Use plain CSS with a fallback chain, exactly the same way the (never-buggy) normal
scrolling pages in the same app already did:

```css
html, body {
  height: 100%;
  height: 100vh;
  height: 100lvh; /* or 100dvh - see note below */
}

#app { /* the fixed-viewport app-shell container */
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  height: 100lvh;
}
```

No `--actual-vh` custom property, no `fixIOSViewportBug()`, no staggered `setTimeout` re-checks,
no `resize`/`orientationchange`/`pageshow`/`visibilitychange` listeners recomputing anything, no
viewport-meta nudging. `resizeCanvas()`/equivalent canvas-resolution-sync code can and should
stay bound to plain `resize`/`orientationchange` events (that's just normal canvas housekeeping,
unrelated to this bug) - only the *iOS-specific height-correction* logic needs to go.

It's not fully understood *why* removing the correction entirely fixed the visible symptom when
`window.innerHeight` is still sometimes wrong on first paint in portrait - but empirically,
confirmed via a temporary on-screen debug overlay and extensive repeated testing (cold launches,
repeated in-app navigation, rotation) on a real device, the bug did not reproduce at all once the
JS workaround was removed. It's possible the JS workaround itself (its dispatched synthetic
`resize` events, its `--actual-vh` custom property writes forcing style recalculation at
inopportune moments) was actively interfering with WebKit's own eventual self-correction, rather
than the underlying height ever truly being uncorrectable. Given `100lvh`/`100dvh` behaved
identically in testing, either unit is fine - keep both in the fallback chain (`100vh` then
`100lvh`/`100dvh`) for older-browser safety, since the modern units are simply ignored by
browsers that don't understand them.

## How to apply this to another app

1. Find the equivalent of `fixIOSViewportBug()` (likely ported from the same Graphiti original)
   and delete the whole function, including its call site and all the event listeners it
   registers (`resize`, `orientationchange`, `screen.orientation` `change`, `visibilitychange`,
   any `pageshow` handling for it).
2. Find every CSS use of the `--actual-vh` custom property (search for `actual-vh`) and replace
   `var(--actual-vh, 100vh)` with plain `100lvh` (keeping a preceding `100vh` declaration as a
   fallback for old browsers, per the cascade-fallback pattern above).
3. Leave any *other* resize/orientationchange-driven logic alone (e.g. canvas resolution
   updates, layout recalculations unrelated to the viewport-height bug specifically).
4. Bump the service worker's cache version so the fix actually reaches installed PWAs instead of
   being served from a stale cache.
5. Test on a real iOS device in standalone/home-screen mode specifically (not just Safari-the-
   browser, and not just the desktop simulator) - this bug does not reproduce in a desktop
   browser or Safari's own browser chrome, only in standalone/fullscreen display mode.
