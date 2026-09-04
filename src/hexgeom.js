// Hexagon geometry for a "pointy-top" hex grid arranged as Pascal's triangle.
//
// Row n has n+1 cells, k = 0..n. Using standard axial hex coordinates with
// q = k - n, r = n, the pixel position (at unit size, i.e. hex "radius" = 1) is:
//   x = sqrt(3) * (q + r/2) = sqrt(3) * (k - n/2)
//   y = 1.5 * r             = 1.5 * n
// This is exactly the layout where each cell touches its two parents above it,
// which is what makes the hex grid double as a Pascal's triangle.

export const SQRT3 = Math.sqrt(3);

/** World-space centre (unit hex radius = 1) of cell (n, k). */
export function hexWorldPos(n, k) {
  return {
    x: SQRT3 * (k - n / 2),
    y: 1.5 * n,
  };
}

/** The 6 corner points of a pointy-top hexagon centred at (cx, cy) with the given radius. */
export function hexCorners(cx, cy, radius) {
  const pts = new Array(6);
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    pts[i] = [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
  }
  return pts;
}

/**
 * Inverse of hexWorldPos: given a world-space point (unit hex radius = 1),
 * find the nearest cell (n, k) using cube-coordinate rounding.
 * Returns { n, k } which may lie outside the valid triangle (n < 0 or k
 * outside [0, n]); callers should clamp/validate as needed.
 */
export function pixelToHex(x, y) {
  const qf = (SQRT3 / 3) * x - (1 / 3) * y;
  const rf = (2 / 3) * y;
  const { q, r } = cubeRound(qf, rf);
  return { n: r, k: q + r };
}

function cubeRound(qf, rf) {
  const xf = qf;
  const zf = rf;
  const yf = -xf - zf;

  let x = Math.round(xf);
  let y = Math.round(yf);
  let z = Math.round(zf);

  const dx = Math.abs(x - xf);
  const dy = Math.abs(y - yf);
  const dz = Math.abs(z - zf);

  if (dx > dy && dx > dz) {
    x = -y - z;
  } else if (dy > dz) {
    y = -x - z;
  } else {
    z = -x - y;
  }

  return { q: x, r: z };
}
