import sharp from 'sharp';

export interface CropSpec {
  mode: 'face' | 'figure';     // face = symmetry-axis center (front panel), figure = full silhouette
  anchorX: number;             // where subject center lands in frame, 0..1 (0.5 = centered)
  anchorY: number;             // 0.5 = centered, ~0.66 = lower third
  subjectFraction: number;     // subject width as fraction of output width
  straighten?: boolean;        // auto-level the product before cropping
  notes?: string;
}

export const DEFAULT_SPEC: CropSpec = {
  mode: 'figure',
  anchorX: 0.5,
  anchorY: 0.5,
  subjectFraction: 0.72,
  straighten: false,
};

export interface Detection {
  srcW: number;
  srcH: number;
  figure: [number, number, number, number]; // x0,y0,x1,y1 in source px
  centerFace: [number, number];
  centerFigure: [number, number];
  angle: number;                 // degrees to rotate to level (0 unless straighten requested)
  bg: [number, number, number];  // estimated background color (for rotation fill / editor)
  lowConfidence: boolean;        // detection was unsure — UI should auto-flag for a manual look
}

export interface CropBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/* ---------- integral-image morphology ---------- */

function integral(mask: Uint8Array, w: number, h: number): Int32Array {
  const I = new Int32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += mask[y * w + x];
      I[(y + 1) * (w + 1) + (x + 1)] = I[y * (w + 1) + (x + 1)] + row;
    }
  }
  return I;
}

function boxSum(I: Int32Array, w: number, x0: number, y0: number, x1: number, y1: number): number {
  const W = w + 1;
  return I[(y1 + 1) * W + (x1 + 1)] - I[y0 * W + (x1 + 1)] - I[(y1 + 1) * W + x0] + I[y0 * W + x0];
}

function dilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const I = integral(mask, w, h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
      out[y * w + x] = boxSum(I, w, x0, y0, x1, y1) > 0 ? 1 : 0;
    }
  }
  return out;
}

function erode(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const I = integral(mask, w, h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      out[y * w + x] = boxSum(I, w, x0, y0, x1, y1) === area ? 1 : 0;
    }
  }
  return out;
}

const open = (m: Uint8Array, w: number, h: number, r: number) => dilate(erode(m, w, h, r), w, h, r);
const close = (m: Uint8Array, w: number, h: number, r: number) => erode(dilate(m, w, h, r), w, h, r);

/** Fill interior holes (e.g. a glossy highlight punching a gap in a shiny subject). */
function fillHoles(mask: Uint8Array, w: number, h: number): Uint8Array {
  const reachable = new Uint8Array(w * h); // background connected to the border
  const stack = new Int32Array(w * h);
  let sp = 0;
  const push = (p: number) => { if (!mask[p] && !reachable[p]) { reachable[p] = 1; stack[sp++] = p; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (sp > 0) {
    const p = stack[--sp];
    const x = p % w, y = (p / w) | 0;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (y > 0) push(p - w);
    if (y < h - 1) push(p + w);
  }
  const out = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) out[p] = mask[p] || !reachable[p] ? 1 : 0;
  return out;
}

interface Comp { label: number; area: number; x0: number; y0: number; x1: number; y1: number; }

function components(mask: Uint8Array, w: number, h: number): { label: Int32Array; comps: Comp[] } {
  const label = new Int32Array(w * h);
  const comps: Comp[] = [];
  const stack = new Int32Array(w * h);
  let next = 0;
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || label[start]) continue;
    next++;
    let sp = 0, area = 0;
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    stack[sp++] = start;
    label[start] = next;
    while (sp > 0) {
      const p = stack[--sp];
      area++;
      const x = p % w, y = (p / w) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && mask[p - 1] && !label[p - 1]) { label[p - 1] = next; stack[sp++] = p - 1; }
      if (x < w - 1 && mask[p + 1] && !label[p + 1]) { label[p + 1] = next; stack[sp++] = p + 1; }
      if (y > 0 && mask[p - w] && !label[p - w]) { label[p - w] = next; stack[sp++] = p - w; }
      if (y < h - 1 && mask[p + w] && !label[p + w]) { label[p + w] = next; stack[sp++] = p + w; }
    }
    comps.push({ label: next, area, x0, y0, x1, y1 });
  }
  return { label, comps };
}

/** Largest component, plus nearby sizeable components merged in (a subject split by a
 *  highlight into two blobs, or a charm plus its attached chain). Returns a solid mask. */
function subjectMask(mask: Uint8Array, w: number, h: number): { mask: Uint8Array; x0: number; y0: number; x1: number; y1: number; area: number } | null {
  const { label, comps } = components(mask, w, h);
  if (comps.length === 0) return null;
  comps.sort((a, b) => b.area - a.area);
  const main = comps[0];
  // proximity window around the main component
  const mx = (main.x1 - main.x0) * 0.15 + w * 0.03;
  const my = (main.y1 - main.y0) * 0.15 + h * 0.03;
  const ex0 = main.x0 - mx, ex1 = main.x1 + mx, ey0 = main.y0 - my, ey1 = main.y1 + my;
  const keep = new Set<number>([main.label]);
  let x0 = main.x0, y0 = main.y0, x1 = main.x1, y1 = main.y1, area = main.area;
  for (let i = 1; i < comps.length; i++) {
    const c = comps[i];
    if (c.area < main.area * 0.15) break; // sorted, rest are smaller still
    const near = c.x1 >= ex0 && c.x0 <= ex1 && c.y1 >= ey0 && c.y0 <= ey1;
    if (!near) continue;
    keep.add(c.label);
    x0 = Math.min(x0, c.x0); y0 = Math.min(y0, c.y0);
    x1 = Math.max(x1, c.x1); y1 = Math.max(y1, c.y1);
    area += c.area;
  }
  const out = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) if (keep.has(label[p])) out[p] = 1;
  return { mask: out, x0, y0, x1: x1 + 1, y1: y1 + 1, area };
}

/** Mirror-symmetry axis: axis maximizing mask self-overlap. A one-sided bulge/zipper
 *  has no mirror partner so it cannot drag the axis. */
function symmetryAxis(comp: Uint8Array, w: number, h: number, x0: number, x1: number): number {
  const bodyC = (x0 + x1) / 2;
  const range = Math.max(8, Math.round((x1 - x0) * 0.12));
  let bestA = bodyC, bestOv = -1;
  const lo2 = Math.round(2 * (bodyC - range)), hi2 = Math.round(2 * (bodyC + range));
  for (let a2 = lo2; a2 <= hi2; a2++) {
    let ov = 0;
    const xs0 = Math.max(x0, a2 - (x1 - 1));
    const xs1 = Math.min(x1 - 1, a2 - x0);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = xs0; x <= xs1; x++) {
        if (comp[row + x] && comp[row + (a2 - x)]) ov++;
      }
    }
    if (ov > bestOv) { bestOv = ov; bestA = a2 / 2; }
  }
  return bestA;
}

/** Convex hull (monotone chain) of integer points. */
function convexHull(pts: number[][]): number[][] {
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const n = pts.length;
  if (n < 3) return pts;
  const cross = (o: number[], a: number[], b: number[]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: number[][] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: number[][] = [];
  for (let i = n - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

/** Tilt of the subject via the min-area bounding rectangle (rotating calipers on the
 *  hull). Robust to one-sided protrusions since the rectangle is set by the outer
 *  extremes of the main body. Returns degrees to rotate to level. */
function levelAngle(comp: Uint8Array, w: number, h: number): number {
  // contour points: subject pixels touching background (keeps the hull cheap)
  const pts: number[][] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!comp[y * w + x]) continue;
      if (x === 0 || x === w - 1 || y === 0 || y === h - 1 ||
          !comp[y * w + x - 1] || !comp[y * w + x + 1] || !comp[(y - 1) * w + x] || !comp[(y + 1) * w + x]) {
        pts.push([x, y]);
      }
    }
  }
  if (pts.length < 8) return 0;
  const hull = convexHull(pts);
  if (hull.length < 3) return 0;

  let bestAng = 0, bestArea = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const c = Math.cos(-ang), s = Math.sin(-ang);
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    for (const p of hull) {
      const rx = p[0] * c - p[1] * s;
      const ry = p[0] * s + p[1] * c;
      if (rx < minx) minx = rx; if (rx > maxx) maxx = rx;
      if (ry < miny) miny = ry; if (ry > maxy) maxy = ry;
    }
    const area = (maxx - minx) * (maxy - miny);
    if (area < bestArea) { bestArea = area; bestAng = ang; }
  }

  let deg = (bestAng * 180) / Math.PI; // orientation of a rectangle side
  // fold to the small tilt from axis-aligned
  deg = ((deg % 90) + 90) % 90;
  if (deg > 45) deg -= 90;
  const level = -deg;
  if (Math.abs(level) > 20) return 0; // implausible tilt for a straighten — skip
  return Math.round(level * 10) / 10;
}

/* ---------- background + masks ---------- */

function medianBg(data: Buffer, w: number, h: number): [number, number, number] {
  const band = Math.max(3, Math.round(Math.min(w, h) * 0.02));
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= band && x < w - band && y >= band && y < h - band) continue;
      const i = (y * w + x) * 3;
      rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]);
    }
  }
  const med = (a: number[]) => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
  return [med(rs), med(gs), med(bs)];
}

/* ---------- public API ---------- */

export type DetectQuality = 'fast' | 'full';

export async function detectSubject(buf: Buffer, straighten = false, quality: DetectQuality = 'full'): Promise<Detection> {
  const base = sharp(buf).rotate(); // honor EXIF orientation
  const meta = await base.metadata();
  const srcW = meta.width ?? 0;
  const srcH = meta.height ?? 0;
  if (!srcW || !srcH) throw new Error('Could not read image dimensions');

  // fast: 450px detection grid + 2 threshold candidates (~3x cheaper); the
  // low-confidence fallback still applies, so misses flag instead of failing.
  const detW = Math.min(quality === 'fast' ? 450 : 700, srcW);
  const scale = srcW / detW;
  const detH = Math.max(1, Math.round(srcH / scale));

  const { data } = await base
    .clone()
    .resize(detW, detH, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const bg = medianBg(data, detW, detH);
  const [br, bgc, bb] = bg;

  // precompute per-pixel distance-from-bg and saturation
  const N = detW * detH;
  const dist = new Float32Array(N);
  const sat = new Float32Array(N);
  let sum = 0, sum2 = 0;
  for (let p = 0; p < N; p++) {
    const i = p * 3;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const d = Math.hypot(r - br, g - bgc, b - bb);
    dist[p] = d; sum += d; sum2 += d * d;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    sat[p] = mx > 0 ? (mx - mn) / mx : 0;
  }
  const mean = sum / N;
  const std = Math.sqrt(Math.max(0, sum2 / N - mean * mean));
  const r = Math.max(3, Math.round(detW * 0.015));

  const buildAt = (distThr: number) => {
    const m = new Uint8Array(N);
    for (let p = 0; p < N; p++) m[p] = dist[p] > distThr || sat[p] > 0.22 ? 1 : 0;
    const cleaned = fillHoles(close(open(m, detW, detH, r), detW, detH, r), detW, detH);
    return subjectMask(cleaned, detW, detH);
  };

  // Adaptive: ascending thresholds. Low thr captures the most; if it grabs the whole
  // frame (background leaked), raise it. First threshold whose subject doesn't span the
  // whole frame is the maximal clean subject.
  const ks = quality === 'fast' ? [2.5, 4.5] : [2, 3, 4, 5, 6];
  const candidates = ks.map((k) => Math.max(16, mean + k * std));
  let chosen: ReturnType<typeof subjectMask> = null;
  for (const thr of candidates) {
    const s = buildAt(thr);
    if (!s || s.area === 0) continue;
    const spanW = (s.x1 - s.x0) / detW, spanH = (s.y1 - s.y0) / detH;
    if (spanW > 0.97 && spanH > 0.97) continue; // grabbed everything → raise threshold
    chosen = s;
    break;
  }

  const frameCenter: [number, number] = [srcW / 2, srcH / 2];
  const frac = chosen ? chosen.area / N : 0;

  // Safe fallback: detection empty, all-spanning, or a suspiciously tiny speck.
  // Centering on the whole frame avoids both "no crop" and "zoomed into a speck",
  // and we flag it so it surfaces for a manual look.
  if (!chosen || frac < 0.035) {
    let angle = 0;
    if (straighten && chosen) angle = levelAngle(chosen.mask, detW, detH);
    return {
      srcW, srcH,
      figure: [0, 0, srcW, srcH],
      centerFace: frameCenter,
      centerFigure: frameCenter,
      angle,
      bg,
      lowConfidence: true,
    };
  }

  const axis = symmetryAxis(chosen.mask, detW, detH, chosen.x0, chosen.x1);
  const maxShift = (chosen.x1 - chosen.x0) * 0.15;
  const axisClamped = Math.min(Math.max(axis, (chosen.x0 + chosen.x1) / 2 - maxShift), (chosen.x0 + chosen.x1) / 2 + maxShift);
  const angle = straighten ? levelAngle(chosen.mask, detW, detH) : 0;

  return {
    srcW, srcH,
    figure: [chosen.x0 * scale, chosen.y0 * scale, chosen.x1 * scale, chosen.y1 * scale],
    centerFace: [axisClamped * scale, ((chosen.y0 + chosen.y1) / 2) * scale],
    centerFigure: [((chosen.x0 + chosen.x1) / 2) * scale, ((chosen.y0 + chosen.y1) / 2) * scale],
    angle,
    bg,
    lowConfidence: false,
  };
}

export function computeCropBox(det: Detection, spec: CropSpec, outW: number, outH: number): CropBox {
  const subjectW = Math.max(1, det.figure[2] - det.figure[0]);
  const [cx, cy] = spec.mode === 'face' ? det.centerFace : det.centerFigure;
  const s = (spec.subjectFraction * outW) / subjectW; // output px per source px
  const width = outW / s;
  const height = outH / s;
  return {
    left: cx - spec.anchorX * width,
    top: cy - spec.anchorY * height,
    width,
    height,
  };
}

/** Render crop -> PNG. Rotates by `angle` about the crop-box center (filling exposed
 *  corners with the background color), then extracts the box, padding with edge
 *  replication where the box exceeds the source. */
export async function renderCrop(
  buf: Buffer,
  box: CropBox,
  outW: number,
  outH: number,
  angle = 0,
  bg: [number, number, number] = [255, 252, 247],
  quality: DetectQuality = 'full'
): Promise<Buffer> {
  const png = { compressionLevel: quality === 'fast' ? 6 : 9 }; // both lossless
  const base = sharp(buf).rotate();
  const meta = await base.metadata();
  const srcW = meta.width ?? 0;
  const srcH = meta.height ?? 0;
  const bgColor = { r: Math.round(bg[0]), g: Math.round(bg[1]), b: Math.round(bg[2]) };

  const W = Math.max(1, Math.round(box.width));
  const H = Math.max(1, Math.round(box.height));
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;

  if (Math.abs(angle) < 0.05) {
    // Fast path: no rotation. Extract with edge-replication padding.
    const L = Math.round(box.left), T = Math.round(box.top);
    const padL = Math.max(0, -L), padT = Math.max(0, -T);
    const padR = Math.max(0, L + W - srcW), padB = Math.max(0, T + H - srcH);
    let stage: Buffer;
    if (padL || padT || padR || padB) {
      stage = await base.extend({ left: padL, top: padT, right: padR, bottom: padB, extendWith: 'copy' }).toBuffer();
    } else {
      stage = await base.toBuffer();
    }
    return sharp(stage)
      .extract({ left: L + padL, top: T + padT, width: W, height: H })
      .resize(outW, outH, { kernel: sharp.kernel.lanczos3, fit: 'fill' })
      .png(png)
      .toBuffer();
  }

  // Rotation path: grab a square region around the box center big enough to hold the
  // rotated box, rotate it about its own center, then center-crop to the box size.
  const R = Math.ceil(Math.hypot(W, H)) + 4;
  const half = R / 2;
  const regionL = Math.round(cx - half);
  const regionT = Math.round(cy - half);
  const padL = Math.max(0, -regionL), padT = Math.max(0, -regionT);
  const padR = Math.max(0, regionL + R - srcW), padB = Math.max(0, regionT + R - srcH);

  let region = base;
  if (padL || padT || padR || padB) {
    region = sharp(await base.extend({ left: padL, top: padT, right: padR, bottom: padB, background: bgColor }).toBuffer());
  }
  const regionBuf = await region
    .extract({ left: regionL + padL, top: regionT + padT, width: R, height: R })
    .toBuffer();

  const rotatedBuf = await sharp(regionBuf)
    .rotate(angle, { background: bgColor }) // clockwise degrees; corners filled with bg
    .toBuffer();
  const rotMeta = await sharp(rotatedBuf).metadata();
  const rw = rotMeta.width ?? R, rh = rotMeta.height ?? R;
  const exL = Math.round((rw - W) / 2);
  const exT = Math.round((rh - H) / 2);

  return sharp(rotatedBuf)
    .extract({ left: Math.max(0, exL), top: Math.max(0, exT), width: W, height: H })
    .resize(outW, outH, { kernel: sharp.kernel.lanczos3, fit: 'fill' })
    .png(png)
    .toBuffer();
}
