// Pan/zoom camera for the triangle canvas.
//
// Coordinate spaces:
//  - "world" space is the unit hex-grid space used by hexgeom.js (hex radius = 1).
//  - "screen" space is CSS pixels within the canvas element.
//  - screen = world * scale + pan   (scale = on-screen pixel radius of a hex)

export const MIN_SCALE = 0.015;
export const MAX_SCALE = 400;

const FRICTION = 0.94;
const VELOCITY_STOP_THRESHOLD = 0.02; // px/ms
const INTERACTION_SETTLE_MS = 150;

export class Viewport {
  constructor(canvas, { onChange } = {}) {
    this.canvas = canvas;
    this.onChange = onChange || (() => {});

    this.scale = 40;
    this.panX = 0;
    this.panY = 0;
    this.isInteracting = false;

    this._pointers = new Map(); // pointerId -> {x, y}
    this._lastPan = null; // for single-pointer drag
    this._lastPinchDist = null;
    this._lastMidpoint = null;
    this._velX = 0;
    this._velY = 0;
    this._lastMoveTime = 0;
    this._settleTimer = null;
    this._inertiaRunning = false;

    this._attachEvents();
  }

  reset() {
    const rect = this.canvas.getBoundingClientRect();
    this.scale = 40;
    this.panX = rect.width / 2;
    // Push the apex below the toolbar (its height varies with layout/safe-area-inset) rather
    // than a fixed offset - the apex hex's topmost point sits `scale` px above its centre.
    const toolbar = document.getElementById("toolbar");
    const toolbarBottom = toolbar ? toolbar.getBoundingClientRect().bottom - rect.top : 30;
    const TOP_MARGIN = 24;
    this.panY = Math.max(70, toolbarBottom + TOP_MARGIN + this.scale);
    this._notify();
  }

  /** Centre the view horizontally on a given row, keeping current scale. */
  goToRow(n) {
    const rect = this.canvas.getBoundingClientRect();
    this.panX = rect.width / 2;
    this.panY = rect.height / 2 - n * 1.5 * this.scale;
    this._notify();
  }

  screenToWorld(sx, sy) {
    return { x: (sx - this.panX) / this.scale, y: (sy - this.panY) / this.scale };
  }

  worldToScreen(wx, wy) {
    return { x: wx * this.scale + this.panX, y: wy * this.scale + this.panY };
  }

  zoomAt(sx, sy, factor) {
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.scale * factor));
    const actualFactor = newScale / this.scale;
    this.panX = sx - (sx - this.panX) * actualFactor;
    this.panY = sy - (sy - this.panY) * actualFactor;
    this.scale = newScale;
  }

  /** Pan by a screen-space delta (e.g. from an arrow-key press). */
  panBy(dx, dy) {
    this.panX += dx;
    this.panY += dy;
    this._markInteracting();
    this._scheduleSettle();
    this._notify();
  }

  /** Zoom in/out centred on the canvas's own centre (e.g. from a +/- key press). */
  zoomCentered(factor) {
    const rect = this.canvas.getBoundingClientRect();
    this.zoomAt(rect.width / 2, rect.height / 2, factor);
    this._markInteracting();
    this._scheduleSettle();
    this._notify();
  }

  _attachEvents() {
    const canvas = this.canvas;

    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const factor = Math.exp(-e.deltaY * 0.0015);
        this.zoomAt(sx, sy, factor);
        this._markInteracting();
        this._scheduleSettle(); // wheel events have no "release" - debounce the settle ourselves
        this._notify();
      },
      { passive: false }
    );

    canvas.addEventListener("pointerdown", (e) => {
      canvas.setPointerCapture(e.pointerId);
      const rect = canvas.getBoundingClientRect();
      this._pointers.set(e.pointerId, { x: e.clientX - rect.left, y: e.clientY - rect.top });
      this._stopInertia();
      this._velX = 0;
      this._velY = 0;
      this._lastMoveTime = performance.now();
      this._markInteracting();
    });

    canvas.addEventListener("pointermove", (e) => {
      if (!this._pointers.has(e.pointerId)) return;
      const rect = canvas.getBoundingClientRect();
      const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      this._pointers.set(e.pointerId, point);

      if (this._pointers.size === 1) {
        this._handleSingleDrag(point);
      } else if (this._pointers.size === 2) {
        this._handlePinch();
      }
      this._notify();
    });

    const releasePointer = (e) => {
      if (!this._pointers.has(e.pointerId)) return;
      this._pointers.delete(e.pointerId);
      this._lastPinchDist = null;
      this._lastMidpoint = null;
      this._lastPan = null;

      if (this._pointers.size === 0) {
        const speed = Math.hypot(this._velX, this._velY);
        if (speed > VELOCITY_STOP_THRESHOLD) {
          this._startInertia();
        } else {
          this._scheduleSettle();
        }
      }
    };
    canvas.addEventListener("pointerup", releasePointer);
    canvas.addEventListener("pointercancel", releasePointer);
  }

  _handleSingleDrag(point) {
    const prev = this._lastPan;
    this._lastPan = point;
    if (!prev) return;

    const now = performance.now();
    const dt = Math.max(1, now - this._lastMoveTime);
    const dx = point.x - prev.x;
    const dy = point.y - prev.y;

    this.panX += dx;
    this.panY += dy;

    this._velX = dx / dt;
    this._velY = dy / dt;
    this._lastMoveTime = now;
  }

  _handlePinch() {
    const pts = [...this._pointers.values()];
    const [a, b] = pts;
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

    if (this._lastPinchDist != null) {
      const factor = dist / this._lastPinchDist;
      this.zoomAt(mid.x, mid.y, factor);
    }
    if (this._lastMidpoint) {
      this.panX += mid.x - this._lastMidpoint.x;
      this.panY += mid.y - this._lastMidpoint.y;
    }
    this._lastPinchDist = dist;
    this._lastMidpoint = mid;
  }

  _markInteracting() {
    this.isInteracting = true;
    if (this._settleTimer) {
      clearTimeout(this._settleTimer);
      this._settleTimer = null;
    }
  }

  _scheduleSettle() {
    if (this._settleTimer) clearTimeout(this._settleTimer);
    this._settleTimer = setTimeout(() => {
      this.isInteracting = false;
      this._settleTimer = null;
      this._notify();
    }, INTERACTION_SETTLE_MS);
  }

  _startInertia() {
    this._inertiaRunning = true;
    const step = () => {
      if (!this._inertiaRunning) return;
      this.panX += this._velX * 16;
      this.panY += this._velY * 16;
      this._velX *= FRICTION;
      this._velY *= FRICTION;
      this._notify();

      const speed = Math.hypot(this._velX, this._velY);
      if (speed < VELOCITY_STOP_THRESHOLD) {
        this._inertiaRunning = false;
        this._scheduleSettle();
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  _stopInertia() {
    this._inertiaRunning = false;
  }

  _notify() {
    this.onChange();
  }
}
