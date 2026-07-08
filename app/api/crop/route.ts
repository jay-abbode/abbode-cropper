import { NextRequest, NextResponse } from 'next/server';
import { detectSubject, computeCropBox, renderCrop, CropSpec, DEFAULT_SPEC } from '@/lib/detect';

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

    let spec: CropSpec = DEFAULT_SPEC;
    const rawSpec = form.get('spec');
    if (typeof rawSpec === 'string') {
      try { spec = { ...DEFAULT_SPEC, ...JSON.parse(rawSpec) }; } catch { /* keep default */ }
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const det = await detectSubject(buf, !!spec.straighten);

    // Manual edit sends an explicit crop box and (optionally) a rotation angle.
    let box;
    let angle = spec.straighten ? det.angle : 0;
    const rawBox = form.get('cropBox');
    if (typeof rawBox === 'string') {
      const b = JSON.parse(rawBox);
      box = { left: +b.left, top: +b.top, width: +b.width, height: +b.height };
    } else {
      box = computeCropBox(det, spec, outW, outH);
    }
    const rawAngle = form.get('angle');
    if (typeof rawAngle === 'string' && rawAngle !== '') {
      const a = parseFloat(rawAngle);
      if (Number.isFinite(a)) angle = Math.max(-45, Math.min(45, a));
    }

    const png = await renderCrop(buf, box, outW, outH, angle, det.bg);

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
