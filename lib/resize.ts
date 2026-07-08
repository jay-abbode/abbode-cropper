// Client-side downscaling so uploads stay under Vercel's 4.5 MB function body
// limit. The source only needs to be large enough for the final crop (which is
// resized to the requested output, e.g. 750x750), so shrinking a huge original
// to ~3000px on the long edge is visually lossless for the result and gets the
// file comfortably under the cap. Files already within limits pass through
// untouched, so nothing changes for normal-sized photos.

export interface Prepared {
  blob: Blob;
  url: string; // object URL of whatever we ended up uploading (kept consistent everywhere)
}

const MAX_EDGE = 3000; // px on the long edge after downscaling
const MAX_BYTES = 4_000_000; // stay safely below the 4.5 MB platform limit

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas toBlob failed'))), type, quality);
  });
}

interface Loaded {
  w: number;
  h: number;
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  close: () => void;
}

async function load(file: File): Promise<Loaded | null> {
  // Prefer createImageBitmap (fast, honors most orientation); fall back to <img>.
  try {
    const bmp = await createImageBitmap(file);
    return {
      w: bmp.width,
      h: bmp.height,
      draw: (ctx, w, h) => ctx.drawImage(bmp, 0, 0, w, h),
      close: () => bmp.close(),
    };
  } catch {
    try {
      const url = URL.createObjectURL(file);
      const img = await new Promise<HTMLImageElement>((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = () => rej(new Error('image decode failed'));
        im.src = url;
      });
      return {
        w: img.naturalWidth,
        h: img.naturalHeight,
        draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
        close: () => URL.revokeObjectURL(url),
      };
    } catch {
      return null;
    }
  }
}

export async function prepareImage(file: File): Promise<Prepared> {
  const info = await load(file);
  // Unreadable, or already small enough → upload the original as-is.
  if (!info) return { blob: file, url: URL.createObjectURL(file) };
  const longEdge = Math.max(info.w, info.h);
  if (file.size <= MAX_BYTES && longEdge <= MAX_EDGE) {
    info.close();
    return { blob: file, url: URL.createObjectURL(file) };
  }

  const scale = Math.min(1, MAX_EDGE / longEdge);
  const w = Math.max(1, Math.round(info.w * scale));
  const h = Math.max(1, Math.round(info.h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    info.close();
    return { blob: file, url: URL.createObjectURL(file) };
  }
  info.draw(ctx, w, h);
  info.close();

  const isPng = file.type === 'image/png' || /\.png$/i.test(file.name);
  let blob: Blob;
  if (isPng) {
    blob = await canvasToBlob(canvas, 'image/png');
    if (blob.size > MAX_BYTES) blob = await canvasToBlob(canvas, 'image/jpeg', 0.9);
  } else {
    let q = 0.92;
    blob = await canvasToBlob(canvas, 'image/jpeg', q);
    while (blob.size > MAX_BYTES && q > 0.5) {
      q -= 0.1;
      blob = await canvasToBlob(canvas, 'image/jpeg', q);
    }
  }

  // Extreme fallback: extraordinarily detailed image still over the cap → shrink harder.
  if (blob.size > MAX_BYTES) {
    const s2 = 2200 / Math.max(w, h);
    const c2 = document.createElement('canvas');
    c2.width = Math.max(1, Math.round(w * s2));
    c2.height = Math.max(1, Math.round(h * s2));
    const cx2 = c2.getContext('2d');
    if (cx2) {
      cx2.drawImage(canvas, 0, 0, c2.width, c2.height);
      blob = await canvasToBlob(c2, 'image/jpeg', 0.85);
    }
  }

  return { blob, url: URL.createObjectURL(blob) };
}
