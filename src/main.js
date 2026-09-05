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
    // this specific bug (small enough that it's not just a genuinely short window).
    if (isIOS && isPWA && window.innerHeight > window.innerWidth) {
      const screenPortraitHeight = Math.max(window.screen.height, window.screen.width);
      const difference = screenPortraitHeight - viewportHeight;
      if (difference > 15 && difference <= 180) viewportHeight = screenPortraitHeight;
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

  // iOS doesn't always have the correct value ready right at launch, so re-check a few
  // times over the next ~2s rather than relying on a single measurement.
  setActualViewportHeight();
  scheduleUpdates([50, 100, 200, 350, 600, 900, 1300, 1800]);

  window.addEventListener("resize", setActualViewportHeight);
  window.addEventListener("orientationchange", () => scheduleUpdates([50, 100, 200, 350, 600, 900, 1300, 1800]));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) scheduleUpdates([50, 200, 500, 900]); // app resumed from background
  });
}

fixIOSViewportBug();

const canvas = document.getElementById("triangleCanvas");
const ctx = canvas.getContext("2d");
const resetViewBtn = document.getElementById("resetViewBtn");
const contextMenu = document.getElementById("contextMenu");

// Two parallel UIs for the same colour-mode state - a bordered "card" with radio buttons on
// wide screens, a single pair of stacked dropdowns (no card) on narrow screens (see the
// @media rule in style.css that shows/hides each). Both are kept in sync with the shared
// colourMode/shadingModulus state below, whichever one the user actually interacts with.
const colourModeRadiosWide = document.querySelectorAll('input[name="colourModeWide"]');
const shadingModulusSelectWide = document.getElementById("shadingModulusWide");
const shadingModuloRowWide = document.getElementById("shadingModuloRowWide");
const shadingPatternNameWideEl = document.getElementById("shadingPatternNameWide");
const colourModeSelectNarrow = document.getElementById("colourModeNarrow");
const shadingModulusSelectNarrow = document.getElementById("shadingModulusNarrow");
const shadingModuloRowNarrow = document.getElementById("shadingModuloRowNarrow");
const shadingPatternNameNarrowEl = document.getElementById("shadingPatternNameNarrow");

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

/** Pushes the current colourMode/shadingModulus state out to both the wide-card and narrow-dropdown UIs. */
function syncShadingUI() {
  for (const radio of colourModeRadiosWide) radio.checked = radio.value === colourMode;
  colourModeSelectNarrow.value = colourMode;
  shadingModulusSelectWide.value = String(shadingModulus);
  shadingModulusSelectNarrow.value = String(shadingModulus);

  const isModulo = colourMode === "modulo";
  shadingModuloRowWide.classList.toggle("hidden", !isModulo);
  shadingModuloRowNarrow.classList.toggle("hidden", !isModulo);
  shadingSwatchesNone.classList.toggle("hidden", colourMode !== "none");
  shadingSwatchesModulo.classList.toggle("hidden", !isModulo);

  const name = isModulo ? shadingPatternName(shadingModulus) : null;
  shadingPatternNameWideEl.textContent = name || "";
  shadingPatternNameWideEl.classList.toggle("hidden", !name);
  shadingPatternNameNarrowEl.textContent = name || "";
  shadingPatternNameNarrowEl.classList.toggle("hidden", !name);
}

for (const radio of colourModeRadiosWide) {
  radio.addEventListener("change", () => {
    if (!radio.checked) return;
    colourMode = radio.value;
    syncShadingUI();
    dirty = true;
  });
}

colourModeSelectNarrow.addEventListener("change", () => {
  colourMode = colourModeSelectNarrow.value;
  syncShadingUI();
  dirty = true;
});

shadingModulusSelectWide.addEventListener("change", () => {
  shadingModulus = Number(shadingModulusSelectWide.value);
  syncShadingUI();
  dirty = true;
});

shadingModulusSelectNarrow.addEventListener("change", () => {
  shadingModulus = Number(shadingModulusSelectNarrow.value);
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
