import { Viewport } from "./viewport.js";
import { Renderer } from "./renderer.js";
import { InfoCard } from "./infocard.js";
import { pixelToHex } from "./hexgeom.js";

const canvas = document.getElementById("triangleCanvas");
const ctx = canvas.getContext("2d");
const resetViewBtn = document.getElementById("resetViewBtn");
const contextMenu = document.getElementById("contextMenu");

let dirty = true;

// The highlighted selection persists across pan/zoom - it's only cleared when
// the user clicks/taps anywhere on the canvas (see the pointerup handler below).
let highlightSelection = null;

const viewport = new Viewport(canvas, {
  onChange: () => {
    dirty = true;
  },
});
const renderer = new Renderer(canvas, ctx);
const infoCard = new InfoCard();

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  dirty = true;
}

window.addEventListener("resize", resizeCanvas);
resizeCanvas();
viewport.reset();

function screenToHex(sx, sy) {
  const world = viewport.screenToWorld(sx, sy);
  const { n, k } = pixelToHex(world.x, world.y);
  if (n < 0 || k < 0 || k > n) return null;
  return { n, k };
}

// The context menu (shown on click/tap) lets the user pick what to highlight
// from the clicked cell: itself, its row, or one of its two diagonals.
let downPos = null;

canvas.addEventListener("pointerdown", (e) => {
  const rect = canvas.getBoundingClientRect();
  downPos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  hideContextMenu(); // re-shown by pointerup below if this turns out to be a tap, not a drag
});

canvas.addEventListener("pointerup", (e) => {
  const rect = canvas.getBoundingClientRect();
  const up = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  if (downPos && Math.hypot(up.x - downPos.x, up.y - downPos.y) > 5) return; // was a drag/pan

  // Any click/tap on the canvas clears the current highlight, whether or not it lands on a cell.
  highlightSelection = null;
  infoCard.hide();
  dirty = true;

  const hex = screenToHex(up.x, up.y);
  if (hex) {
    showContextMenu(up.x, up.y, hex);
  } else {
    hideContextMenu();
  }
});

function showContextMenu(screenX, screenY, hex) {
  contextMenu.dataset.n = hex.n;
  contextMenu.dataset.k = hex.k;
  contextMenu.style.left = `${screenX}px`;
  contextMenu.style.top = `${screenY}px`;
  contextMenu.classList.remove("hidden");
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

function frame() {
  if (dirty) {
    dirty = viewport.isInteracting; // keep redrawing while a gesture/inertia is active
    renderer.renderStatic(viewport, highlightSelection);
  }
  // Always runs: a cheap blit of the cached static content plus the animated highlight glow.
  renderer.renderFrame(viewport, highlightSelection);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
