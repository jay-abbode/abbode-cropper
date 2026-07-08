import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { detectSubject, computeCropBox, renderCrop, CropSpec, DEFAULT_SPEC, DetectQuality } from '@/lib/detect';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: 'file missing' }, { status: 400 });
    }
    const outW = Math.min(4000, Math.max(16, parseInt(String(form.get('outW') ?? '750'), 10) || 750));
    const outH = Math.min(4000, Math.max(16, parseInt(String(form.get('outH') ?? '750'), 10) || 750));
    const quality: DetectQuality = form.get('quality') === 'fast' ? 'fast' : 'full';

    let spec: CropSpec = DEFAULT_SPEC;
    const rawSpec = form.get('spec');
    if (typeof rawSpec === 'string') {
      try { spec = { ...DEFAULT_SPEC, ...JSON.parse(rawSpec) }; } catch { /* keep default */ }
    }

    const buf = Buffer.from(await file.arrayBuffer());

    const rawBox = form.get('cropBox');
    const rawAngle = form.get('angle');
    const rawBg = form.get('bg');
    const manualAngle =
      typeof rawAngle === 'string' && rawAngle !== '' && Number.isFinite(parseFloat(rawAngle))
        ? Math.max(-45, Math.min(45, parseFloat(rawAngle)))
        : undefined;

    let box: { left: number; top: number; width: number; height: number };
    let angle: number;
    let meta;

    if (typeof rawBox === 'string') {
      // Manual placement: the client supplies box, angle, and background —
      // skip detection entirely (halves latency on every manual save).
      const b = JSON.parse(rawBox);
      box = { left: +b.left, top: +b.top, width: +b.width, height: +b.height };
      angle = manualAngle ?? 0;
      let bg: [number, number, number] = [255, 252, 247];
      if (typeof rawBg === 'string') {
        try {
          const g = JSON.parse(rawBg);
          if (Array.isArray(g) && g.length === 3) bg = [+g[0], +g[1], +g[2]];
        } catch { /* keep default */ }
      }
      const m = await sharp(buf).rotate().metadata();
      const srcW = m.width ?? 0;
      const srcH = m.height ?? 0;
      meta = {
        srcW, srcH,
        figure: [box.left, box.top, box.left + box.width, box.top + box.height] as [number, number, number, number],
        centerFace: [box.left + box.width / 2, box.top + box.height / 2] as [number, number],
        centerFigure: [box.left + box.width / 2, box.top + box.height / 2] as [number, number],
        angle, bg, lowConfidence: false, cropBox: box,
      };
      const png = await renderCrop(buf, box, outW, outH, angle, bg, quality);
      return NextResponse.json({ png: png.toString('base64'), meta });
    }

    // Automatic placement: full detection pipeline.
    const det = await detectSubject(buf, !!spec.straighten, quality);
    box = computeCropBox(det, spec, outW, outH);
    angle = manualAngle ?? (spec.straighten ? det.angle : 0);

    const png = await renderCrop(buf, box, outW, outH, angle, det.bg, quality);

    return NextResponse.json({
      png: png.toString('base64'),
      meta: {
        srcW: det.srcW,
        srcH: det.srcH,
        figure: det.figure,
        centerFace: det.centerFace,
        centerFigure: det.centerFigure,
        angle,
        bg: det.bg,
        lowConfidence: det.lowConfidence,
        cropBox: box,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'crop failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
