import sharp from 'sharp';

export interface CropSpec {
  mode: 'face' | 'figure';     // face = symmetry-axis center (front panel), figure = full silhouette
  anchorX: number;             // where subject center lands in frame, 0..1 (0.5 = centered)
  anchorY: number;             // 0.5 = centered, ~0.66 = lower third
  subjectFraction: number;     // subject width as fraction of output width
  notes?: string;
}

export const DEFAULT_SPEC: CropSpec = {
  mode: 'figure',
  anchorX: 0.5,
  anchorY: 0.5,
  subjectFraction: 0.72,
};

export interface Detection {
  srcW: number;
  srcH: number;
  figure: [number, number, number, number]; // x0,y0,x1,y1 in source px
  centerFace: [number, number];
  centerFigure: [number, number];
}

export interface CropBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/* ---------- mask helpers (operate on downsampled raw RGB) ---------- */

function buildMask(data: Buffer, w: number, h: number): Uint8Array {
  // background estimate from 10px border ring
  let br = 0, bg = 0, bb = 0, n = 0;
  const band = Math.max(4, Math.round(Math.min(w, h) * 0.015));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= band && x < w - band && y >= band && y < h - band) continue;
      const i = (y * w + x) * 3;
      br += data[i]; bg += data[i + 1]; bb += data[i + 2]; n++;
    }
  }
  br /= n; bg /= n; bb /= n;

  // border distance stats -> adaptive threshold
  let sum = 0, sum2 = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= band && x < w - band && y >= band && y < h - band) continue;
      const i = (y * w + x) * 3;
      const d = Math.hypot(data[i] - br, data[i + 1] - bg, data[i + 2] - bb);
      sum += d; sum2 += d * d;
    }
  }
  const mean = sum / n;
  const std = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  const thr = Math.max(30, mean + 5 * std);

  const mask = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    const i = p * 3;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const dist = Math.hypot(r - br, g - bg, b - bb);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = mx > 0 ? (mx - mn) / mx : 0;
    mask[p] = dist > thr || sat > 0.28 ? 1 : 0;
  }
  return mask;
}

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
  // inclusive coords
  const W = w + 1;
  return I[(y1 + 1) * W + (x1 + 1)] - I[y0 * W + (x1 + 1)] - I[(y1 + 1) * W + x0] + I[y0 * W + x0];
}

function morphOpen(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const I1 = integral(mask, w, h);
  const eroded = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      eroded[y * w + x] = boxSum(I1, w, x0, y0, x1, y1) === area ? 1 : 0;
    }
  }
  const I2 = integral(eroded, w, h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
      out[y * w + x] = boxSum(I2, w, x0, y0, x1, y1) > 0 ? 1 : 0;
    }
  }
  return out;
}

function largestComponent(mask: Uint8Array, w: number, h: number): Uint8Array {
  const label = new Int32Array(w * h);
  let next = 0;
  let bestLabel = -1, bestSize = 0;
  const stack = new Int32Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || label[start]) continue;
    next++;
    let sp = 0, size = 0;
    stack[sp++] = start;
    label[start] = next;
    while (sp > 0) {
      const p = stack[--sp];
      size++;
      const x = p % w, y = (p / w) | 0;
      if (x > 0 && mask[p - 1] && !label[p - 1]) { label[p - 1] = next; stack[sp++] = p - 1; }
      if (x < w - 1 && mask[p + 1] && !label[p + 1]) { label[p + 1] = next; stack[sp++] = p + 1; }
      if (y > 0 && mask[p - w] && !label[p - w]) { label[p - w] = next; stack[sp++] = p - w; }
      if (y < h - 1 && mask[p + w] && !label[p + w]) { label[p + w] = next; stack[sp++] = p + w; }
    }
    if (size > bestSize) { bestSize = size; bestLabel = next; }
  }
  const out = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) out[p] = label[p] === bestLabel ? 1 : 0;
  return out;
}

/** Mirror-symmetry axis: axis (in half-pixel steps) maximizing mask self-overlap.
 *  A one-sided bulge/zipper-pull has no mirror partner, so it cannot drag the axis. */
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
        const mx = a2 - x;
        if (comp[row + x] && comp[row + mx]) ov++;
      }
    }
    if (ov > bestOv) { bestOv = ov; bestA = a2 / 2; }
  }
  return bestA;
}

/* ---------- public API ---------- */

export async function detectSubject(buf: Buffer): Promise<Detection> {
  const base = sharp(buf).rotate(); // honor EXIF orientation
  const meta = await base.metadata();
  const srcW = meta.width ?? 0;
  const srcH = meta.height ?? 0;
  if (!srcW || !srcH) throw new Error('Could not read image dimensions');

  const detW = Math.min(700, srcW);
  const scale = srcW / detW;
  const detH = Math.max(1, Math.round(srcH / scale));

  const { data } = await base
    .clone()
    .resize(detW, detH, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let mask = buildMask(data, detW, detH);
  const r = Math.max(4, Math.round(detW * 0.02));
  mask = morphOpen(mask, detW, detH, r);
  const comp = largestComponent(mask, detW, detH);

  let x0 = detW, x1 = 0, y0 = detH, y1 = 0, count = 0;
  for (let y = 0; y < detH; y++) {
    for (let x = 0; x < detW; x++) {
      if (!comp[y * detW + x]) continue;
      count++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (count < 50) {
    // fallback: treat whole frame as subject
    return {
      srcW, srcH,
      figure: [0, 0, srcW, srcH],
      centerFace: [srcW / 2, srcH / 2],
      centerFigure: [srcW / 2, srcH / 2],
    };
  }
  x1 += 1; y1 += 1;

  const axis = symmetryAxis(comp, detW, detH, x0, x1);
  const figC: [number, number] = [((x0 + x1) / 2) * scale, ((y0 + y1) / 2) * scale];
  // clamp face-axis correction to 15% of subject width (safety on non-symmetric products)
  const maxShift = (x1 - x0) * 0.15;
  const axisClamped = Math.min(Math.max(axis, (x0 + x1) / 2 - maxShift), (x0 + x1) / 2 + maxShift);

  return {
    srcW, srcH,
    figure: [x0 * scale, y0 * scale, x1 * scale, y1 * scale],
    centerFace: [axisClamped * scale, ((y0 + y1) / 2) * scale],
    centerFigure: figC,
  };
}

export function computeCropBox(det: Detection, spec: CropSpec, outW: number, outH: number): CropBox {
  const [fx0, , fx1] = [det.figure[0], det.figure[1], det.figure[2]];
  const subjectW = Math.max(1, fx1 - fx0);
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

/** Render crop -> PNG. Pads with edge replication when the box exceeds the source. */
export async function renderCrop(buf: Buffer, box: CropBox, outW: number, outH: number): Promise<Buffer> {
  const base = sharp(buf).rotate();
  const meta = await base.metadata();
  const srcW = meta.width ?? 0;
  const srcH = meta.height ?? 0;

  const L = Math.round(box.left);
  const T = Math.round(box.top);
  const W = Math.max(1, Math.round(box.width));
  const H = Math.max(1, Math.round(box.height));

  const padL = Math.max(0, -L);
  const padT = Math.max(0, -T);
  const padR = Math.max(0, L + W - srcW);
  const padB = Math.max(0, T + H - srcH);

  // Stage 1: materialize rotation (+ edge-replication padding if the box
  // overflows the source). sharp's internal op order runs extract before
  // extend within one pipeline, so extend must be flattened to a buffer first.
  let stage1: Buffer;
  if (padL || padT || padR || padB) {
    stage1 = await base
      .extend({ left: padL, top: padT, right: padR, bottom: padB, extendWith: 'copy' })
      .toBuffer();
  } else {
    stage1 = await base.toBuffer();
  }

  return sharp(stage1)
    .extract({ left: L + padL, top: T + padT, width: W, height: H })
    .resize(outW, outH, { kernel: sharp.kernel.lanczos3, fit: 'fill' })
    .png({ compressionLevel: 9 })
    .toBuffer();
}
