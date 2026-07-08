import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { CropSpec, DEFAULT_SPEC } from '@/lib/detect';

export const runtime = 'nodejs';
export const maxDuration = 30;

const SYSTEM = `You translate a product-photo cropping instruction into JSON. The subject is auto-detected; you only choose framing.

Fields:
- "mode": "face" (center on the front panel via symmetry axis — use when user says front face, front panel, or complains a side bulge/gusset/zipper skews centering) or "figure" (center of full silhouette; default).
- "anchorX": 0..1 horizontal position of subject center in frame. 0.5 center, 0.33 left third, 0.67 right third.
- "anchorY": 0..1 vertical position of subject center. 0.5 center, 0.33 upper third, 0.67 lower third.
- "subjectFraction": 0.2..0.95 subject width relative to frame width. 0.72 is a standard product shot; "tight" ~0.85; "lots of breathing room / small" ~0.5.
- "straighten": true if the user wants the product auto-leveled/deskewed (says straighten, level, deskew, fix the tilt, it's crooked/tilted/rotated, align horizontally); otherwise false.
- "notes": one short sentence restating the framing.

If "currentSpec" and "feedback" are provided, adjust the current spec minimally per the feedback (e.g. "a bit more headroom" -> anchorY +0.04; "slightly smaller" -> subjectFraction -0.05; "nudge left" -> anchorX -0.03).

Respond with ONLY the JSON object. No markdown, no backticks, no commentary.`;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function sanitize(raw: Partial<CropSpec>): CropSpec {
  return {
    mode: raw.mode === 'face' ? 'face' : 'figure',
    anchorX: clamp(Number(raw.anchorX ?? 0.5) || 0.5, 0.05, 0.95),
    anchorY: clamp(Number(raw.anchorY ?? 0.5) || 0.5, 0.05, 0.95),
    subjectFraction: clamp(Number(raw.subjectFraction ?? 0.72) || 0.72, 0.2, 0.95),
    straighten: raw.straighten === true,
    notes: typeof raw.notes === 'string' ? raw.notes.slice(0, 200) : undefined,
  };
}

function keywordFallback(instruction: string, current?: CropSpec): CropSpec {
  const s = { ...(current ?? DEFAULT_SPEC) };
  const t = instruction.toLowerCase();
  if (/front (face|panel)|symmetr/.test(t)) s.mode = 'face';
  if (/whole|entire|full (figure|silhouette)/.test(t)) s.mode = 'figure';
  if (/lower third|bottom third/.test(t)) s.anchorY = 0.67;
  if (/upper third|top third/.test(t)) s.anchorY = 0.33;
  if (/left third/.test(t)) s.anchorX = 0.33;
  if (/right third/.test(t)) s.anchorX = 0.67;
  if (/\bcenter|centre|middle\b/.test(t)) { s.anchorX = 0.5; if (!/third/.test(t)) s.anchorY = 0.5; }
  if (/tight|large|big|fill/.test(t)) s.subjectFraction = 0.85;
  if (/small|breathing room|padding|margin/.test(t)) s.subjectFraction = 0.55;
  if (/bigger|larger|zoom in/.test(t)) s.subjectFraction = clamp(s.subjectFraction + 0.07, 0.2, 0.95);
  if (/smaller|zoom out/.test(t)) s.subjectFraction = clamp(s.subjectFraction - 0.07, 0.2, 0.95);
  if (/\bup\b|higher|headroom/.test(t)) s.anchorY = clamp(s.anchorY + 0.04, 0.05, 0.95);
  if (/\bdown\b|lower(?! third)/.test(t)) s.anchorY = clamp(s.anchorY - 0.04, 0.05, 0.95);
  if (/straighten|deskew|level|crooked|tilt|align horizontal/.test(t)) s.straighten = true;
  if (/no straighten|don'?t straighten|leave (the )?(tilt|angle)/.test(t)) s.straighten = false;
  s.notes = 'Parsed without AI (keyword fallback).';
  return sanitize(s);
}

export async function POST(req: NextRequest) {
  const { instruction = '', feedback, currentSpec } = await req.json();
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return NextResponse.json({ spec: keywordFallback(feedback || instruction, currentSpec) });
  }

  try {
    const anthropic = new Anthropic({ apiKey });
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: JSON.stringify({ instruction, feedback: feedback ?? null, currentSpec: currentSpec ?? null }),
        },
      ],
    });
    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .replace(/```json|```/g, '')
      .trim();
    const spec = sanitize(JSON.parse(text));
    return NextResponse.json({ spec });
  } catch {
    return NextResponse.json({ spec: keywordFallback(feedback || instruction, currentSpec) });
  }
}
