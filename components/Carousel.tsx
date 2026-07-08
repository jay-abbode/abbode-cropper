'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ImageResult, RunMode } from '@/lib/types';

interface Props {
  results: ImageResult[];
  mode: RunMode;
  onToggleFlag: (id: string) => void;
  onFeedbackRerun: (feedback: string) => void;
  onEditAt: (index: number) => void;     // open the editor on any image
  onEditFlagged: () => void;
  onDownload: () => void;
  onStartOver: () => void;
  onResume: () => void;
  remaining: number;
  busy: boolean;
  busyNote?: string | null;
}

export default function Carousel({ results, mode, onToggleFlag, onFeedbackRerun, onEditAt, onEditFlagged, onDownload, onStartOver, onResume, remaining, busy, busyNote }: Props) {
  const [i, setI] = useState(0);
  const [showGrid, setShowGrid] = useState(true);
  const [showGhost, setShowGhost] = useState(false);
  const [feedback, setFeedback] = useState('');

  const cur = results[Math.min(i, results.length - 1)];
  const rendered = results.filter((r) => !r.pending && r.pngDataUrl);
  const prevRendered = (() => {
    for (let k = 1; k < results.length; k++) {
      const r = results[(i - k + results.length) % results.length];
      if (!r.pending && r.pngDataUrl && r.id !== cur?.id) return r;
    }
    return null;
  })();
  const flaggedCount = results.filter((r) => r.flagged).length;
  const pendingCount = results.filter((r) => r.pending).length;

  const step = useCallback(
    (d: number) => setI((v) => (v + d + results.length) % results.length),
    [results.length]
  );

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft') step(-1);
      if (e.key === 'f' && cur) onToggleFlag(cur.id);
      if (e.key === 'e' && cur) onEditAt(i);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [step, cur, i, onToggleFlag, onEditAt]);

  if (!cur) return null;

  const lowConfCount = results.filter((r) => r.flagged && r.meta?.lowConfidence).length;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h2 className="text-center text-2xl">Sanity check</h2>
      <p className="text-center text-sm text-espresso/60">
        Arrow keys to browse, <kbd className="rounded bg-espresso/10 px-1">f</kbd> to flag, <kbd className="rounded bg-espresso/10 px-1">e</kbd> to edit. You can open any image in the editor at any time.
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
          {lowConfCount} crop{lowConfCount === 1 ? ' was' : 's were'} auto-flagged — detection was unsure. Framed to the full photo as a safe default; open them in the editor to refine.
        </p>
      )}

      {busy && busyNote && (
        <p className="mx-auto max-w-xl rounded-lg bg-plum/10 px-4 py-2 text-center text-sm text-plum">{busyNote}</p>
      )}

      <div className="flex items-center justify-center gap-4">
        <button onClick={() => step(-1)} className="rounded-full border border-espresso/25 px-4 py-2 hover:bg-blush/30">←</button>

        <div className="relative overflow-hidden rounded-xl border border-espresso/15 bg-white" style={{ width: 420, height: 420 }}>
          {cur.pending ? (
            <>
              {cur.originalThumbUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={cur.originalThumbUrl} alt={cur.name} className="h-full w-full object-contain opacity-50" />
              )}
              <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-espresso/70">
                Not cropped yet — press <kbd className="rounded bg-espresso/10 px-1">e</kbd> or Edit to place it
              </span>
            </>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cur.pngDataUrl} alt={cur.name} className="h-full w-full object-contain" />
          )}
          {showGhost && prevRendered && !cur.pending && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={prevRendered.pngDataUrl} alt="" className="absolute inset-0 h-full w-full object-contain opacity-35" />
          )}
          {showGrid && !cur.pending && (
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

      <div className="flex flex-wrap items-center justify-center gap-3 text-sm">
        <span className="text-espresso/60">{i + 1} / {results.length} — {cur.name}</span>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} /> grid
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={showGhost} onChange={(e) => setShowGhost(e.target.checked)} /> ghost
        </label>
        <button
          onClick={() => onEditAt(i)}
          disabled={busy}
          className="rounded-full bg-plum px-3 py-1 text-porcelain hover:bg-berry disabled:opacity-40"
        >
          Edit this image
        </button>
        <button
          onClick={() => onToggleFlag(cur.id)}
          className={`rounded-full px-3 py-1 ${cur.flagged ? 'bg-berry text-porcelain' : 'border border-berry text-berry hover:bg-blush/30'}`}
        >
          {cur.flagged ? 'Unflag' : 'Flag'}
        </button>
      </div>

      {/* thumbnails */}
      <div className="flex flex-wrap justify-center gap-2">
        {results.map((r, idx) => (
          <button
            key={r.id}
            onClick={() => setI(idx)}
            onDoubleClick={() => onEditAt(idx)}
            className={`relative h-14 w-14 overflow-hidden rounded border-2 ${idx === i ? 'border-plum' : r.pending ? 'border-dashed border-espresso/40' : 'border-transparent'}`}
            title={`${r.name}${r.pending ? ' (not cropped)' : ''} — double-click to edit`}
          >
            {(r.pngDataUrl || r.originalThumbUrl) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={r.pngDataUrl || r.originalThumbUrl} alt="" className={`h-full w-full object-cover ${r.pending ? 'opacity-50' : ''}`} />
            )}
            {r.flagged && <span className="absolute inset-0 border-2 border-berry" />}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-espresso/15 bg-white p-4">
        {mode !== 'manual' && (
          <>
            <p className="mb-2 text-sm font-medium">Something off across the batch? Describe it and rerun:</p>
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={2}
              placeholder='e.g. "Everything needs a bit more headroom" or "Make the product ~10% smaller"'
              className="w-full rounded-lg border border-espresso/25 px-3 py-2"
            />
          </>
        )}
        <div className={`flex flex-wrap gap-3 ${mode !== 'manual' ? 'mt-3' : ''}`}>
          {mode !== 'manual' && (
            <button
              disabled={busy || !feedback.trim()}
              onClick={() => onFeedbackRerun(feedback)}
              className="rounded-lg bg-plum px-4 py-2 text-porcelain hover:bg-berry disabled:opacity-40"
            >
              Rerun with feedback
            </button>
          )}
          <button
            disabled={busy || flaggedCount === 0}
            onClick={onEditFlagged}
            className="rounded-lg border border-plum px-4 py-2 text-plum hover:bg-blush/30 disabled:opacity-40"
          >
            Edit flagged ({flaggedCount})
          </button>
          <button
            disabled={busy || rendered.length + pendingCount === 0}
            onClick={onDownload}
            className="rounded-lg bg-espresso px-4 py-2 text-porcelain hover:bg-plum disabled:opacity-40"
          >
            Download ZIP{pendingCount > 0 ? ` (${pendingCount} render first)` : ''}
          </button>
          <button disabled={busy} onClick={onStartOver} className="ml-auto text-sm text-espresso/50 underline">
            start over
          </button>
        </div>
      </div>
    </div>
  );
}
