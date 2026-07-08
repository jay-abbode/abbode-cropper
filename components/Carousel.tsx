'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ImageResult } from '@/lib/types';

interface Props {
  results: ImageResult[];
  onToggleFlag: (id: string) => void;
  onFeedbackRerun: (feedback: string) => void;
  onEditFlagged: () => void;
  onDownload: () => void;
  onStartOver: () => void;
  onResume: () => void;
  remaining: number;
  busy: boolean;
}

export default function Carousel({ results, onToggleFlag, onFeedbackRerun, onEditFlagged, onDownload, onStartOver, onResume, remaining, busy }: Props) {
  const [i, setI] = useState(0);
  const [showGrid, setShowGrid] = useState(true);
  const [showGhost, setShowGhost] = useState(false);
  const [feedback, setFeedback] = useState('');

  const cur = results[i];
  const prev = results[(i - 1 + results.length) % results.length];
  const flaggedCount = results.filter((r) => r.flagged).length;

  const step = useCallback(
    (d: number) => setI((v) => (v + d + results.length) % results.length),
    [results.length]
  );

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft') step(-1);
      if (e.key === 'f') onToggleFlag(cur.id);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [step, cur, onToggleFlag]);

  if (!cur) return null;

  const lowConfCount = results.filter((r) => r.flagged && r.meta.lowConfidence).length;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h2 className="text-center text-2xl">Sanity check</h2>
      <p className="text-center text-sm text-espresso/60">
        Arrow keys to browse, <kbd className="rounded bg-espresso/10 px-1">f</kbd> to flag. Toggle the ghost overlay to compare alignment with the previous image.
      </p>

      {remaining > 0 && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-plum/40 bg-blush/20 p-3 text-center">
          <p className="text-sm text-espresso/80">
            Batch was stopped — {results.length} done, <strong>{remaining}</strong> not yet cropped. Fix anything here, then pick up where you left off.
          </p>
          <button
            onClick={onResume}
            disabled={busy}
            className="rounded-lg bg-plum px-5 py-2 text-porcelain hover:bg-berry disabled:opacity-40"
          >
            Resume — crop remaining {remaining}
          </button>
        </div>
      )}

      {lowConfCount > 0 && (
        <p className="mx-auto max-w-xl rounded-lg bg-berry/10 px-4 py-2 text-center text-sm text-berry">
          {lowConfCount} crop{lowConfCount === 1 ? ' was' : 's were'} auto-flagged — detection was unsure (tricky subject or background). They&apos;re framed to the full photo as a safe default; use manual edit to refine.
        </p>
      )}

      <div className="flex items-center justify-center gap-4">
        <button onClick={() => step(-1)} className="rounded-full border border-espresso/25 px-4 py-2 hover:bg-blush/30">←</button>

        <div className="relative overflow-hidden rounded-xl border border-espresso/15 bg-white" style={{ width: 420, height: 420 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cur.pngDataUrl} alt={cur.name} className="h-full w-full object-contain" />
          {showGhost && results.length > 1 && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={prev.pngDataUrl} alt="" className="absolute inset-0 h-full w-full object-contain opacity-35" />
          )}
          {showGrid && (
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute left-1/3 top-0 h-full w-px bg-berry/40" />
              <div className="absolute left-2/3 top-0 h-full w-px bg-berry/40" />
              <div className="absolute left-0 top-1/3 h-px w-full bg-berry/40" />
              <div className="absolute left-0 top-2/3 h-px w-full bg-berry/40" />
              <div className="absolute left-1/2 top-0 h-full w-px bg-plum/70" />
              <div className="absolute left-0 top-1/2 h-px w-full bg-plum/70" />
            </div>
          )}
          {cur.flagged && (
            <span className="absolute right-2 top-2 rounded-full bg-berry px-3 py-1 text-xs text-porcelain">flagged</span>
          )}
        </div>

        <button onClick={() => step(1)} className="rounded-full border border-espresso/25 px-4 py-2 hover:bg-blush/30">→</button>
      </div>

      <div className="flex items-center justify-center gap-3 text-sm">
        <span className="text-espresso/60">{i + 1} / {results.length} — {cur.name}</span>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} /> grid
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={showGhost} onChange={(e) => setShowGhost(e.target.checked)} /> ghost
        </label>
        <button
          onClick={() => onToggleFlag(cur.id)}
          className={`rounded-full px-3 py-1 ${cur.flagged ? 'bg-berry text-porcelain' : 'border border-berry text-berry hover:bg-blush/30'}`}
        >
          {cur.flagged ? 'Unflag' : 'Flag for edit'}
        </button>
      </div>

      {/* thumbnails */}
      <div className="flex flex-wrap justify-center gap-2">
        {results.map((r, idx) => (
          <button key={r.id} onClick={() => setI(idx)} className={`relative h-14 w-14 overflow-hidden rounded border-2 ${idx === i ? 'border-plum' : 'border-transparent'}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={r.pngDataUrl} alt="" className="h-full w-full object-cover" />
            {r.flagged && <span className="absolute inset-0 border-2 border-berry" />}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-espresso/15 bg-white p-4">
        <p className="mb-2 text-sm font-medium">Something off across the batch? Describe it and rerun:</p>
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          rows={2}
          placeholder='e.g. "Everything needs a bit more headroom" or "Make the product ~10% smaller"'
          className="w-full rounded-lg border border-espresso/25 px-3 py-2"
        />
        <div className="mt-3 flex flex-wrap gap-3">
          <button
            disabled={busy || !feedback.trim()}
            onClick={() => onFeedbackRerun(feedback)}
            className="rounded-lg bg-plum px-4 py-2 text-porcelain hover:bg-berry disabled:opacity-40"
          >
            Rerun with feedback
          </button>
          <button
            disabled={busy || flaggedCount === 0}
            onClick={onEditFlagged}
            className="rounded-lg border border-plum px-4 py-2 text-plum hover:bg-blush/30 disabled:opacity-40"
          >
            Manually edit flagged ({flaggedCount})
          </button>
          <button
            disabled={busy}
            onClick={onDownload}
            className="rounded-lg bg-espresso px-4 py-2 text-porcelain hover:bg-plum disabled:opacity-40"
          >
            Download ZIP
          </button>
          <button disabled={busy} onClick={onStartOver} className="ml-auto text-sm text-espresso/50 underline">
            start over
          </button>
        </div>
      </div>
    </div>
  );
}
