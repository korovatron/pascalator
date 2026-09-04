import { SQRT3, hexWorldPos, hexCorners, pixelToHex } from "./hexgeom.js";
import { getExactDigits, hslToRgb, log10Binomial, magnitudeColor, magnitudeIsLight, scientificFromDigitString, scientificFromLog10 } from "./triangle.js";

// Level-of-detail thresholds, expressed as on-screen hex radius in pixels
// (== viewport.scale).
const LARGE_MIN_SCALE = 22; // hexes drawn individually, with labels
const MEDIUM_MIN_SCALE = 2.5; // hexes drawn individually, fill only (batched)
// below MEDIUM_MIN_SCALE: switch to a per-pixel magnitude field

const ABSOLUTE_MAX_ROW = 2_000_000; // sanity guard against runaway loops
const COLOR_BUCKETS = 24;

const LABEL_FONT_FAMILY = '"Cascadia Code", Consolas, monospace';
const MIN_FONT_SIZE = 8;
const FONT_MEASURE_SIZE = 32; // reference size for measuring text width (monospace scales linearly)

const HIGHLIGHT_CYCLE_MS = 6000; // time for the highlight glow to sweep through the full spectrum once

// hexCorners()'s corner i to i+1 edge borders the neighbour at this (dn, dk) offset
// (derived from the pointy-top axial layout in hexgeom.js).
const EDGE_NEIGHBOR_OFFSET = [
  [0, 1], // right edge -> (n, k+1)
  [1, 1], // lower-right edge -> (n+1, k+1)
  [1, 0], // lower-left edge -> (n+1, k)
  [0, -1], // left edge -> (n, k-1)
  [-1, -1], // upper-left edge -> (n-1, k-1)
  [-1, 0], // upper-right edge -> (n-1, k)
];

export class Renderer {
  constructor(canvas, ctx) {
    this.canvas = canvas;
    this.ctx = ctx;
    // The tiered hex/pixel content is expensive to recompute, so it's rendered into this
    // offscreen buffer only when the view actually changes. Every animation frame just
    // blits this buffer then draws the (cheap, animated) highlight on top of it.
    this.staticCanvas = document.createElement("canvas");
    this.staticCtx = this.staticCanvas.getContext("2d");
    // Per-cell label text/font-size fit, keyed "n,k", from the last settled (non-interacting)
    // render - see _renderLargeTier. Cell geometry/colour is always recomputed live, but the
    // (costlier) label fit is only recomputed on settle and reused meanwhile.
    this.labelCache = new Map();
  }

  /** Renders the tiered hex/pixel content into the offscreen buffer. Called every frame while dirty (including throughout a pan/zoom gesture). */
  renderStatic(viewport, highlightSelection) {
    const { canvas, staticCanvas, staticCtx: ctx } = this;
    if (staticCanvas.width !== canvas.width || staticCanvas.height !== canvas.height) {
      staticCanvas.width = canvas.width;
      staticCanvas.height = canvas.height;
    }

    const dpr = window.devicePixelRatio || 1;
    const cssWidth = canvas.width / dpr;
    const cssHeight = canvas.height / dpr;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const { scale } = viewport;
    if (scale < MEDIUM_MIN_SCALE) {
      this._renderPixelField(ctx, viewport, dpr);
    } else if (scale < LARGE_MIN_SCALE) {
      this._renderMediumTier(ctx, viewport, cssWidth, cssHeight);
    } else {
      this._renderLargeTier(ctx, viewport, cssWidth, cssHeight);
    }

    if (highlightSelection) {
      this._renderDimOverlay(ctx, viewport, cssWidth, cssHeight, highlightSelection);
    }

    ctx.restore();
    return this._visibleRowRange(viewport, cssHeight);
  }

  /** Cheap per-frame draw: blits the cached static buffer, then draws the animated highlight on top. */
  renderFrame(viewport, highlightSelection) {
    const { ctx, canvas, staticCanvas } = this;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(staticCanvas, 0, 0);
    ctx.restore();

    if (highlightSelection) {
      const dpr = window.devicePixelRatio || 1;
      const cssWidth = canvas.width / dpr;
      const cssHeight = canvas.height / dpr;
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this._renderHighlight(ctx, viewport, cssWidth, cssHeight, highlightSelection);
      ctx.restore();
    }
  }

  _visibleRowRange(viewport, cssHeight) {
    const topWorld = viewport.screenToWorld(0, 0).y;
    const bottomWorld = viewport.screenToWorld(0, cssHeight).y;
    const nMin = Math.max(0, Math.floor(topWorld / 1.5) - 1);
    const nMax = Math.min(ABSOLUTE_MAX_ROW, Math.floor(bottomWorld / 1.5) + 1);
    return { nMin, nMax };
  }

  _visibleKRange(n, viewport, cssWidth) {
    const leftWorld = viewport.screenToWorld(0, 0).x;
    const rightWorld = viewport.screenToWorld(cssWidth, 0).x;
    let kMin = Math.floor(leftWorld / SQRT3 + n / 2) - 1;
    let kMax = Math.ceil(rightWorld / SQRT3 + n / 2) + 1;
    kMin = Math.max(0, kMin);
    kMax = Math.min(n, kMax);
    return { kMin, kMax };
  }

  /**
   * Resolves a highlight selection ({type, n, k}, where (n, k) is the cell that
   * was clicked/tapped) to the list of visible cells it covers:
   *  - "cell": just that one cell.
   *  - "row": every visible cell in row n.
   *  - "diagSwNe": every visible cell with the same k (fixed column - runs NE to SW).
   *  - "diagNwSe": every visible cell with the same (n - k) (fixed "right index" - runs NW to SE).
   */
  _selectionCells(viewport, cssWidth, cssHeight, selection) {
    const { type, n, k } = selection;
    const cells = [];

    if (type === "cell") {
      cells.push({ n, k });
      return cells;
    }

    if (type === "row") {
      const { kMin, kMax } = this._visibleKRange(n, viewport, cssWidth);
      for (let visibleK = kMin; visibleK <= kMax; visibleK++) cells.push({ n, k: visibleK });
      return cells;
    }

    const { nMin, nMax } = this._visibleRowRange(viewport, cssHeight);

    if (type === "diagSwNe") {
      for (let visibleN = Math.max(nMin, k); visibleN <= nMax; visibleN++) cells.push({ n: visibleN, k });
      return cells;
    }

    if (type === "diagNwSe") {
      const rightIndex = n - k;
      for (let visibleN = nMin; visibleN <= nMax; visibleN++) {
        const visibleK = visibleN - rightIndex;
        if (visibleK >= 0 && visibleK <= visibleN) cells.push({ n: visibleN, k: visibleK });
      }
      return cells;
    }

    return cells;
  }

  /** Dims every cell except the highlighted selection, via a single overlay fill with hex-shaped holes. */
  _renderDimOverlay(ctx, viewport, cssWidth, cssHeight, selection) {
    const { scale } = viewport;
    const radius = Math.max(scale * 0.98, 4);

    const path = new Path2D();
    path.rect(0, 0, cssWidth, cssHeight);
    for (const { n, k } of this._selectionCells(viewport, cssWidth, cssHeight, selection)) {
      const world = hexWorldPos(n, k);
      const { x: cx, y: cy } = viewport.worldToScreen(world.x, world.y);
      const corners = hexCorners(cx, cy, radius);
      path.moveTo(corners[0][0], corners[0][1]);
      for (let i = 1; i < 6; i++) path.lineTo(corners[i][0], corners[i][1]);
      path.closePath();
    }

    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.72)";
    ctx.fill(path, "evenodd");
    ctx.restore();
  }

  /** Outlines every cell in the selection with a slowly colour-cycling neon glow - shared edges between adjacent selected cells are skipped, so only the outer boundary glows. */
  _renderHighlight(ctx, viewport, cssWidth, cssHeight, selection) {
    const { scale } = viewport;
    const radius = Math.max(scale * 0.98, 4);

    const cells = this._selectionCells(viewport, cssWidth, cssHeight, selection);
    const cellSet = new Set(cells.map(({ n, k }) => `${n},${k}`));

    const path = new Path2D();
    for (const { n, k } of cells) {
      const world = hexWorldPos(n, k);
      const { x: cx, y: cy } = viewport.worldToScreen(world.x, world.y);
      const corners = hexCorners(cx, cy, radius);
      for (let i = 0; i < 6; i++) {
        const [dn, dk] = EDGE_NEIGHBOR_OFFSET[i];
        if (cellSet.has(`${n + dn},${k + dk}`)) continue; // shared with another selected cell - not a boundary edge
        const [x1, y1] = corners[i];
        const [x2, y2] = corners[(i + 1) % 6];
        path.moveTo(x1, y1);
        path.lineTo(x2, y2);
      }
    }

    const hue = ((performance.now() % HIGHLIGHT_CYCLE_MS) / HIGHLIGHT_CYCLE_MS) * 360;
    const { r, g, b } = hslToRgb(hue, 1, 0.55);
    const glowColor = `rgb(${r}, ${g}, ${b})`;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // Wide soft halo
    ctx.lineWidth = Math.max(6, scale * 0.22);
    ctx.strokeStyle = glowColor;
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = Math.max(24, scale * 0.7);
    ctx.stroke(path);
    // Vivid mid glow
    ctx.lineWidth = Math.max(3, Math.min(7, scale * 0.14));
    ctx.strokeStyle = glowColor;
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = Math.max(16, scale * 0.45);
    ctx.stroke(path);
    // White-hot core
    ctx.lineWidth = Math.max(1.5, Math.min(3, scale * 0.06));
    ctx.strokeStyle = "#ffffff";
    ctx.shadowColor = "#ffffff";
    ctx.shadowBlur = Math.max(8, scale * 0.2);
    ctx.stroke(path);
    ctx.restore();
  }

  _renderLargeTier(ctx, viewport, cssWidth, cssHeight) {
    const { scale } = viewport;
    const { nMin, nMax } = this._visibleRowRange(viewport, cssHeight);
    const interacting = viewport.isInteracting;

    // Available space inside the hex for text, with a comfortable margin either side.
    const availableWidth = SQRT3 * scale * 0.72;
    const availableHeight = scale * 0.95;

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 1;
    ctx.font = `${FONT_MEASURE_SIZE}px ${LABEL_FONT_FAMILY}`;

    // Label text/fit only gets recomputed on settle (see below); while interacting, the
    // cache from the last settle is reused, so it's left untouched here.
    if (!interacting) this.labelCache.clear();

    for (let n = nMin; n <= nMax; n++) {
      const { kMin, kMax } = this._visibleKRange(n, viewport, cssWidth);
      const rowMaxLog = n > 0 ? log10Binomial(n, Math.floor(n / 2)) : 0;
      for (let k = kMin; k <= kMax; k++) {
        const t = rowMaxLog > 0 ? log10Binomial(n, k) / rowMaxLog : 1;
        const world = hexWorldPos(n, k);
        const { x: cx, y: cy } = viewport.worldToScreen(world.x, world.y);
        const corners = hexCorners(cx, cy, scale * 0.96);

        ctx.beginPath();
        ctx.moveTo(corners[0][0], corners[0][1]);
        for (let i = 1; i < 6; i++) ctx.lineTo(corners[i][0], corners[i][1]);
        ctx.closePath();
        ctx.fillStyle = magnitudeColor(t);
        ctx.fill();
        ctx.strokeStyle = "rgba(10, 10, 20, 0.5)";
        ctx.stroke();

        const key = `${n},${k}`;
        let entry = interacting ? this.labelCache.get(key) : null;
        if (interacting && !entry) continue; // newly-exposed cell - leave blank until settle
        if (!entry) {
          const { label, fontSize } = this._fitCellLabel(ctx, n, k, availableWidth, availableHeight);
          entry = { label, fontSize, scale };
          this.labelCache.set(key, entry);
        }

        // While interacting, the cached fit was sized for a possibly different scale -
        // rescale it so the label still tracks the hex's live on-screen size.
        const drawFontSize = interacting ? entry.fontSize * (scale / entry.scale) : entry.fontSize;
        ctx.font = `${drawFontSize}px ${LABEL_FONT_FAMILY}`;
        ctx.fillStyle = magnitudeIsLight(t) ? "#0b0d16" : "#f0f0f5";
        ctx.fillText(entry.label, cx, cy);
        ctx.font = `${FONT_MEASURE_SIZE}px ${LABEL_FONT_FAMILY}`; // restore for the next cell's measureText
      }
    }
  }

  /**
   * Picks the most readable label for cell (n, k): the full integer, or
   * scientific notation - whichever renders at a larger, more legible font
   * size. Scientific notation is tried at progressively fewer significant
   * figures until it fits at a comfortable size. Values are truncated, not
   * rounded (a deliberate simplification - the exact value is always
   * available in the info card).
   */
  _fitCellLabel(ctx, n, k, availableWidth, availableHeight) {
    const fontSizeToFit = (text) => {
      const width = ctx.measureText(text).width;
      const fontSize = width > 0 ? (FONT_MEASURE_SIZE * availableWidth) / width : availableHeight;
      return Math.min(fontSize, availableHeight);
    };

    const exactDigits = getExactDigits(n, k);
    const log10Value = exactDigits ? null : log10Binomial(n, k);

    let sciLabel, sciFontSize;
    for (let sigFigs = 4; sigFigs >= 1; sigFigs--) {
      const text = exactDigits
        ? scientificFromDigitString(exactDigits, sigFigs)
        : scientificFromLog10(log10Value, sigFigs);
      sciLabel = text;
      sciFontSize = fontSizeToFit(text);
      if (sciFontSize >= MIN_FONT_SIZE || sigFigs === 1) break;
    }
    sciFontSize = Math.max(sciFontSize, MIN_FONT_SIZE);

    if (exactDigits) {
      const fullFontSize = fontSizeToFit(exactDigits);
      // Only prefer the full integer when it's at least as legible as scientific notation.
      if (fullFontSize >= sciFontSize) {
        return { label: exactDigits, fontSize: fullFontSize };
      }
    }
    return { label: sciLabel, fontSize: sciFontSize };
  }

  _renderMediumTier(ctx, viewport, cssWidth, cssHeight) {
    const { scale } = viewport;
    const { nMin, nMax } = this._visibleRowRange(viewport, cssHeight);

    const buckets = new Array(COLOR_BUCKETS);
    for (let i = 0; i < COLOR_BUCKETS; i++) buckets[i] = new Path2D();

    for (let n = nMin; n <= nMax; n++) {
      const { kMin, kMax } = this._visibleKRange(n, viewport, cssWidth);
      const rowMaxLog = n > 0 ? log10Binomial(n, Math.floor(n / 2)) : 0;
      for (let k = kMin; k <= kMax; k++) {
        const t = rowMaxLog > 0 ? log10Binomial(n, k) / rowMaxLog : 1;
        const bucket = Math.min(COLOR_BUCKETS - 1, Math.max(0, Math.floor(t * COLOR_BUCKETS)));

        const world = hexWorldPos(n, k);
        const { x: cx, y: cy } = viewport.worldToScreen(world.x, world.y);
        const corners = hexCorners(cx, cy, scale * 0.98);

        const path = buckets[bucket];
        path.moveTo(corners[0][0], corners[0][1]);
        for (let i = 1; i < 6; i++) path.lineTo(corners[i][0], corners[i][1]);
        path.closePath();
      }
    }

    for (let i = 0; i < COLOR_BUCKETS; i++) {
      ctx.fillStyle = magnitudeColor((i + 0.5) / COLOR_BUCKETS);
      ctx.fill(buckets[i]);
    }
  }

  _renderPixelField(ctx, viewport, dpr) {
    const { canvas } = this;
    // putImageData always writes raw device pixels regardless of the current
    // canvas transform, so this method works directly in device-pixel space
    // and converts to CSS pixels (the space the viewport understands) itself.
    const stride = Math.max(1, Math.round((viewport.isInteracting ? 6 : 2) * dpr));

    const deviceWidth = canvas.width;
    const deviceHeight = canvas.height;
    const w = Math.ceil(deviceWidth / stride);
    const h = Math.ceil(deviceHeight / stride);
    const imgData = ctx.createImageData(deviceWidth, deviceHeight);
    const data = imgData.data;
    const rowBytes = deviceWidth * 4;

    for (let by = 0; by < h; by++) {
      const deviceY = (by + 0.5) * stride;
      const sy = deviceY / dpr;
      for (let bx = 0; bx < w; bx++) {
        const deviceX = (bx + 0.5) * stride;
        const sx = deviceX / dpr;
        const world = viewport.screenToWorld(sx, sy);
        const { n, k } = pixelToHex(world.x, world.y);

        let r = 0, g = 0, b = 0; // background colour when outside the triangle
        if (n >= 0 && n <= ABSOLUTE_MAX_ROW && k >= 0 && k <= n) {
          const rowMaxLog = n > 0 ? log10Binomial(n, Math.floor(n / 2)) : 0;
          const t = rowMaxLog > 0 ? log10Binomial(n, k) / rowMaxLog : 1;
          const color = magnitudeColor(t);
          const m = color.match(/(\d+), (\d+), (\d+)/);
          r = +m[1];
          g = +m[2];
          b = +m[3];
        }

        const yStart = by * stride;
        const yEnd = Math.min(deviceHeight, yStart + stride);
        const xStart = bx * stride;
        const xEnd = Math.min(deviceWidth, xStart + stride);
        for (let py = yStart; py < yEnd; py++) {
          const rowStart = py * rowBytes + xStart * 4;
          for (let px = xStart; px < xEnd; px++) {
            const idx = rowStart + (px - xStart) * 4;
            data[idx] = r;
            data[idx + 1] = g;
            data[idx + 2] = b;
            data[idx + 3] = 255;
          }
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);
  }
}
