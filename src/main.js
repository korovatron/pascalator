import { Viewport } from "./viewport.js";
import { Renderer } from "./renderer.js";
import { InfoCard } from "./infocard.js";
import { pixelToHex } from "./hexgeom.js";
import { shadingPatternName } from "./triangle.js";

// iOS can misreport window.innerHeight in standalone/full-screen PWA mode (especially right
// after launch, or rotating back to portrait), leaving a gap of raw page background at the
// bottom of the screen - correcting a --actual-vh custom property a few times after
// launch/rotation/resume (used by #app in style.css) avoids it. Ported from Graphiti (same
// author) - see temp/graphiti/ios-pwa-bottom-bar-fix.md for the full writeup. Called first,
// before anything else, since the very first paint needs the corrected height too.
function fixIOSViewportBug() {
  const isPWA =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    window.navigator.standalone === true;
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  let lastKnownHeight = 0;

  const setActualViewportHeight = () => {
    let viewportHeight = window.innerHeight;

    // iOS PWA/standalone mode can under-report the height by ~59px (iPhone) / ~32px (iPad)
    // in portrait - compensate up to the real screen height when the shortfall looks like
    // this specific bug (small enough that it's not just a genuinely short window). iOS
    // calculates safe-area-inset-top asynchronously after launch, so --safe-area-top (see
    // style.css, needs viewport-fit=cover to be non-zero at all) may still read 0 here on
    // the earliest staggered check - remainingShortfall re-tests after accounting for it.
    // NOTE: tried unconditionally forcing screenPortraitHeight regardless of window.innerHeight
    // (skipping this detection entirely) - that made things strictly worse (bug on every load,
    // not just repeat navigation, and twice the gap), proving window.innerHeight is NOT always
    // supposed to equal the full screen height in standalone mode - so this heuristic, however
    // imperfect, needs to stay.
    if (isIOS && isPWA && window.innerHeight > window.innerWidth) {
      const screenPortraitHeight = Math.max(window.screen.height, window.screen.width);
      const difference = screenPortraitHeight - viewportHeight;

      if (difference > 15 && difference <= 180) {
        const safeTopPx = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--safe-area-top")) || 0;
        const heightWithSafeTop = viewportHeight + safeTopPx;
        const remainingShortfall = screenPortraitHeight - heightWithSafeTop;

        if (remainingShortfall > 8) viewportHeight = screenPortraitHeight;
        else if (safeTopPx > 0) viewportHeight = heightWithSafeTop;
        else viewportHeight = screenPortraitHeight;
      }
    }

    document.documentElement.style.setProperty("--actual-vh", `${viewportHeight}px`);

    // Only re-trigger canvas/viewport layout if the height actually changed meaningfully -
    // avoids redundant resets from the staggered re-checks below settling on the same value.
    if (lastKnownHeight > 0 && Math.abs(viewportHeight - lastKnownHeight) > 30) {
      window.dispatchEvent(new Event("resize"));
    }
    lastKnownHeight = viewportHeight;
  };

  const scheduleUpdates = (delays) => {
    for (const delay of delays) setTimeout(setActualViewportHeight, delay);
  };

  // The height-comparison logic above only helps when window.innerHeight is *misreporting* a
  // height that's actually available - but on some in-app navigations the WKWebView's own
  // native frame is genuinely the wrong (short) size at the OS level, and window.innerHeight
  // faithfully (if unhelpfully) reports that same wrong value, giving nothing for the
  // comparison above to detect. Confirmed manually: rotating to landscape and back to portrait
  // always fixes it, because that forces iOS to redo a full native relayout of the WKWebView's
  // frame for the new orientation. We can't trigger a real rotation from JS, but briefly
  // touching the viewport meta tag's content is a long-standing trick for coaxing WebKit into
  // recomputing its viewport/frame geometry outside of an actual zoom/rotation gesture - worth
  // trying here since simply re-running the measurement/correction logic did not help.
  const nudgeNativeLayout = () => {
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return;
    const original = meta.getAttribute("content");
    meta.setAttribute("content", `${original}, shrink-to-fit=no`);
    requestAnimationFrame(() => meta.setAttribute("content", original));
  };

  // Cold launch can settle on the *correct* --actual-vh from the very first synchronous
  // call (before isIOS+isPWA's own eventual settling), so the >30px-change guard above
  // never fires again and the canvas never gets told to re-measure against it - only a
  // genuine native resize/orientationchange (e.g. rotating and back) was forcing that
  // re-measure, which is exactly the symptom this unconditionally re-dispatches a resize
  // event a few times regardless of whether --actual-vh itself changed.
  const scheduleUnconditionalLayoutRefreshes = (delays) => {
    if (!isIOS || !isPWA) return;
    for (const delay of delays) {
      setTimeout(() => {
        nudgeNativeLayout();
        window.dispatchEvent(new Event("resize"));
      }, delay);
    }
  };

  // iOS doesn't always have the correct value ready right at launch, so re-check a few
  // times over the next ~2.4s rather than relying on a single measurement.
  setActualViewportHeight();
  scheduleUpdates([50, 100, 200, 350, 600, 900, 1300, 1800, 2400]);
  scheduleUnconditionalLayoutRefreshes([350, 900, 1800, 2400]);

  window.addEventListener("resize", setActualViewportHeight);
  // Also nudge on orientation change - not just re-checking the height: an orientation change
  // is exactly the kind of transition where WebKit's hit-testing geometry (which routes taps
  // to elements) can lag behind its own visual repaint, leaving on-screen buttons visually
  // correct but unresponsive to taps (suspected same root cause as the bottom-bar bug).
  window.addEventListener("orientationchange", () => {
    scheduleUpdates([50, 100, 200, 350, 600, 900, 1300, 1800]);
    scheduleUnconditionalLayoutRefreshes([350, 900, 1800]);
  });
  if (screen.orientation) {
    screen.orientation.addEventListener("change", () => scheduleUpdates([50, 100, 200, 350, 600, 900, 1300, 1800]));
  }
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) scheduleUpdates([50, 200, 500, 900]); // app resumed from background
  });

  // Navigating between pages in the PWA (e.g. Home -> Explore -> Home -> Explore) doesn't
  // always do a genuine fresh page load - WebKit can restore a previous visit from the
  // back-forward cache (bfcache) instead, in which case NONE of the script above re-runs at
  // all (it only ever ran once, on that page's original load) and the WebView's safe-area/
  // frame renegotiation on restore isn't guaranteed to match what our correction would have
  // computed - this is suspected to be the root cause of the iOS PWA bottom-bar bug
  // appearing intermittently on repeated in-app navigation but never on a fresh app launch.
  // `pageshow`'s `persisted` flag is true specifically for a bfcache restore, so redo the
  // whole correction sequence manually in that case.
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    setActualViewportHeight();
    scheduleUpdates([50, 100, 200, 350, 600, 900, 1300, 1800, 2400]);
    scheduleUnconditionalLayoutRefreshes([350, 900, 1800, 2400]);
  });
}


fixIOSViewportBug();

const canvas = document.getElementById("triangleCanvas");
const ctx = canvas.getContext("2d");
const resetViewBtn = document.getElementById("resetViewBtn");
const contextMenu = document.getElementById("contextMenu");

// The shading card (bordered, with radio buttons) is now shown on all screen sizes - only its
// text labels get abbreviated on narrow screens via CSS (see .label-full/.label-short in
// style.css). Kept in sync with the shared colourMode/shadingModulus state below.
const colourModeRadiosWide = document.querySelectorAll('input[name="colourModeWide"]');
const shadingModulusSelectWide = document.getElementById("shadingModulusWide");
const shadingModuloRowWide = document.getElementById("shadingModuloRowWide");
const shadingPatternNameWideEl = document.getElementById("shadingPatternNameWide");

// Colour swatches (native <input type="color"> pickers) - wide screens only, shown at the
// bottom of the shading card: one swatch for "none" mode, two for "modulo" mode.
const shadingSwatchesNone = document.getElementById("shadingSwatchesNone");
const noneColorInput = document.getElementById("noneColorInput");
const shadingSwatchesModulo = document.getElementById("shadingSwatchesModulo");
const shadingZeroColorInput = document.getElementById("shadingZeroColorInput");
const shadingNonzeroColorInput = document.getElementById("shadingNonzeroColorInput");

let dirty = true;

// Cell colouring is a global view setting, independent of the cell/row/diagonal highlight
// selection below - "technicolour" (magnitude ROYGBIV, the default) and "modulo" (e.g. mod 2
// reveals Sierpinski's triangle) are mutually exclusive; highlighting still works on top of
// either. The modulus itself is remembered even while modulo isn't the active mode.
let colourMode = "technicolour";
let shadingModulus = 2;

// The highlighted selection persists across pan/zoom - it's replaced/cleared
// whenever the user taps/clicks anywhere on the canvas (see the pointerup handler below).
let highlightSelection = null;

const viewport = new Viewport(canvas, {
  onChange: () => {
    dirty = true;
  },
});
const renderer = new Renderer(canvas, ctx);
const infoCard = new InfoCard();

noneColorInput.value = renderer.noneFillColor;
shadingZeroColorInput.value = renderer.shadingZeroColor;
shadingNonzeroColorInput.value = renderer.shadingNonzeroColor;

noneColorInput.addEventListener("input", () => {
  renderer.setNoneFillColor(noneColorInput.value);
  dirty = true;
});

shadingZeroColorInput.addEventListener("input", () => {
  renderer.setShadingZeroColor(shadingZeroColorInput.value);
  dirty = true;
});

shadingNonzeroColorInput.addEventListener("input", () => {
  renderer.setShadingNonzeroColor(shadingNonzeroColorInput.value);
  dirty = true;
});

// Unconditionally reset on every "resize" event (including the synthetic ones
// fixIOSViewportBug() redispatches several times in the first ~2.5s after an iOS PWA launch,
// to force a re-measure against the corrected --actual-vh) - this can wipe out panning done in
// that window, but that's an accepted tradeoff: fixing the iOS bottom-bar bug reliably matters
// more than preserving a pan gesture nobody but a developer testing immediately after launch
// would ever do.
function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  viewport.reset(); // also marks dirty via its onChange callback - a resize/orientation change is disorienting enough that starting fresh is clearer than trying to preserve the old pan/zoom
}

window.addEventListener("resize", resizeCanvas);
window.addEventListener("orientationchange", resizeCanvas);
resizeCanvas();

function screenToHex(sx, sy) {
  const world = viewport.screenToWorld(sx, sy);
  const { n, k } = pixelToHex(world.x, world.y);
  if (n < 0 || k < 0 || k > n) return null;
  return { n, k };
}

// A plain tap/left-click highlights the clicked cell directly. The context menu
// (row/diagonal/cell options) instead opens on a right-click or a long press/tap.
const LONG_PRESS_MS = 500;
const DRAG_THRESHOLD = 5;

let downPos = null;
let downOnCell = false;
let longPressTimer = null;
let longPressFired = false;

function clearLongPressTimer() {
  if (longPressTimer !== null) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

// Desktop-only affordance: pointer/click-finger cursor over a cell, hand cursor elsewhere.
function updateCursor(pointerType, x, y) {
  if (pointerType !== "mouse") return;
  canvas.style.cursor = screenToHex(x, y) ? "pointer" : "grab";
}

canvas.addEventListener("pointerdown", (e) => {
  const rect = canvas.getBoundingClientRect();
  downPos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  downOnCell = !!screenToHex(downPos.x, downPos.y);
  longPressFired = false;
  hideContextMenu(); // re-shown below if this turns out to be a right-click or long press

  if (e.button === 2) return; // right-click opens the menu via the "contextmenu" event instead
  clearLongPressTimer();
  longPressTimer = setTimeout(() => {
    longPressTimer = null;
    longPressFired = true;
    const hex = screenToHex(downPos.x, downPos.y);
    if (hex) showContextMenu(downPos.x, downPos.y, hex);
  }, LONG_PRESS_MS);
});

canvas.addEventListener("pointermove", (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  if (!downPos) {
    updateCursor(e.pointerType, x, y);
    return;
  }

  const dragging = Math.hypot(x - downPos.x, y - downPos.y) > DRAG_THRESHOLD;
  if (dragging) clearLongPressTimer();
  if (e.pointerType === "mouse") canvas.style.cursor = dragging ? "grabbing" : downOnCell ? "pointer" : "grab";
});

canvas.addEventListener("pointerup", (e) => {
  clearLongPressTimer();
  if (longPressFired || e.button === 2) {
    downPos = null;
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const up = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  const wasDrag = downPos && Math.hypot(up.x - downPos.x, up.y - downPos.y) > DRAG_THRESHOLD;
  downPos = null;
  updateCursor(e.pointerType, up.x, up.y);
  if (wasDrag) return; // was a drag/pan

  const hex = screenToHex(up.x, up.y);
  // Any tap while something is already highlighted (row/diagonal/cell/hockey stick) just
  // clears it - a new cell highlight is only set from a tap when nothing is highlighted yet,
  // so switching to a different cell always takes a clear tap followed by a selecting tap.
  if (highlightSelection) {
    highlightSelection = null;
    infoCard.hide();
  } else if (hex) {
    highlightSelection = { type: "cell", n: hex.n, k: hex.k };
    infoCard.show(hex.n, hex.k, highlightSelection);
  } else {
    infoCard.hide();
  }
  dirty = true;
});

canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  clearLongPressTimer();
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const hex = screenToHex(x, y);
  if (hex) showContextMenu(x, y, hex);
});

function showContextMenu(screenX, screenY, hex) {
  contextMenu.dataset.n = hex.n;
  contextMenu.dataset.k = hex.k;
  contextMenu.classList.remove("hidden");

  // Clamp so the menu never gets clipped off the bottom/right (or top/left) of the viewport.
  const margin = 8;
  const maxLeft = window.innerWidth - contextMenu.offsetWidth - margin;
  const maxTop = window.innerHeight - contextMenu.offsetHeight - margin;
  contextMenu.style.left = `${Math.max(margin, Math.min(screenX, maxLeft))}px`;
  contextMenu.style.top = `${Math.max(margin, Math.min(screenY, maxTop))}px`;
}

function hideContextMenu() {
  contextMenu.classList.add("hidden");
}

for (const button of contextMenu.querySelectorAll("button[data-highlight]")) {
  button.addEventListener("click", () => {
    highlightSelection = {
      type: button.dataset.highlight,
      n: Number(contextMenu.dataset.n),
      k: Number(contextMenu.dataset.k),
    };
    dirty = true;
    hideContextMenu();
    infoCard.show(highlightSelection.n, highlightSelection.k, highlightSelection);
  });
}

// Close the context menu on any interaction outside it (but not the click that opens it).
document.addEventListener("pointerdown", (e) => {
  if (!contextMenu.classList.contains("hidden") && !contextMenu.contains(e.target) && e.target !== canvas) {
    hideContextMenu();
  }
});

resetViewBtn.addEventListener("click", () => viewport.reset());

// Keyboard controls: arrow keys pan, +/- zoom in/out (centred on the canvas). Ignored while
// a form control has focus (so typing in a select/colour picker isn't hijacked) or while a
// modifier key is held (so browser/OS shortcuts like Ctrl+= for page zoom still work).
const KEY_PAN_STEP = 60; // screen px per press
const KEY_ZOOM_FACTOR = 1.2;

document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

  switch (e.key) {
    case "ArrowUp":
      viewport.panBy(0, KEY_PAN_STEP);
      break;
    case "ArrowDown":
      viewport.panBy(0, -KEY_PAN_STEP);
      break;
    case "ArrowLeft":
      viewport.panBy(KEY_PAN_STEP, 0);
      break;
    case "ArrowRight":
      viewport.panBy(-KEY_PAN_STEP, 0);
      break;
    case "+":
    case "=":
      viewport.zoomCentered(KEY_ZOOM_FACTOR);
      break;
    case "-":
    case "_":
      viewport.zoomCentered(1 / KEY_ZOOM_FACTOR);
      break;
    default:
      return;
  }
  e.preventDefault();
});

// Explains tap/click vs long-press/right-click - shown automatically on first visit, and
// reopenable any time via the "?" toolbar button. Not shown again after being dismissed once
// (localStorage may be unavailable e.g. private browsing - fails open, showing every visit).
const helpModal = document.getElementById("helpModal");
const helpBtn = document.getElementById("helpBtn");
const helpModalClose = document.getElementById("helpModalClose");
const HELP_SEEN_KEY = "pascalatorExploreHelpSeen";

function showHelpModal() {
  helpModal.classList.remove("hidden");
}

function hideHelpModal() {
  helpModal.classList.add("hidden");
  try {
    localStorage.setItem(HELP_SEEN_KEY, "1");
  } catch {
    // localStorage unavailable - the modal will just show again next visit, which is fine.
  }
}

helpBtn.addEventListener("click", showHelpModal);
helpModalClose.addEventListener("click", hideHelpModal);
helpModal.addEventListener("click", (e) => {
  if (e.target === helpModal) hideHelpModal(); // clicking the backdrop, not the card itself
});

let helpAlreadySeen = false;
try {
  helpAlreadySeen = localStorage.getItem(HELP_SEEN_KEY) === "1";
} catch {
  helpAlreadySeen = false;
}
if (!helpAlreadySeen) showHelpModal();

/** Pushes the current colourMode/shadingModulus state out to the shading card UI. */
function syncShadingUI() {
  for (const radio of colourModeRadiosWide) radio.checked = radio.value === colourMode;
  shadingModulusSelectWide.value = String(shadingModulus);

  const isModulo = colourMode === "modulo";
  shadingModuloRowWide.classList.toggle("hidden", !isModulo);
  shadingSwatchesNone.classList.toggle("hidden", colourMode !== "none");
  shadingSwatchesModulo.classList.toggle("hidden", !isModulo);

  const name = isModulo ? shadingPatternName(shadingModulus) : null;
  // On narrow screens (see .label-full/.label-short in style.css) drop a trailing " triangle"
  // to save space, e.g. "Sierpinski triangle" -> "Sierpinski".
  if (name) {
    const shortName = name.replace(/ triangle$/i, "");
    shadingPatternNameWideEl.innerHTML = `<span class="label-full">${name}</span><span class="label-short">${shortName}</span>`;
  } else {
    shadingPatternNameWideEl.textContent = "";
  }
  shadingPatternNameWideEl.classList.toggle("hidden", !name);
}

for (const radio of colourModeRadiosWide) {
  radio.addEventListener("change", () => {
    if (!radio.checked) return;
    colourMode = radio.value;
    syncShadingUI();
    dirty = true;
  });
}

shadingModulusSelectWide.addEventListener("change", () => {
  shadingModulus = Number(shadingModulusSelectWide.value);
  syncShadingUI();
  dirty = true;
});

function frame() {
  if (dirty) {
    dirty = viewport.isInteracting; // keep redrawing while a gesture/inertia is active
    renderer.renderStatic(viewport, highlightSelection, colourMode, shadingModulus);
  }
  // Always runs: a cheap blit of the cached static content plus the animated highlight glow.
  renderer.renderFrame(viewport, highlightSelection);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
