'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ImageResult } from '@/lib/types';

export interface Draft {
  box: { left: number; top: number; width: number; height: number };
  angle: number;
}

interface Props {
  items: ImageResult[];          // ALL results — the editor navigates freely
  index: number;                 // current position
  originalUrl: string;           // prepared-image object URL for items[index]
  outW: number;
  outH: number;
  onNavigate: (index: number) => void;
  onSave: (id: string, box: Draft['box'], angle: number) => Promise<void>;
  onDone: () => void;            // back to review
  getDraft: (id: string) => Draft | undefined;
  setDraft: (id: string, d: Draft) => void;
  busy: boolean;
}

const VIEW = 460;

export default function ManualEditor({ items, index, originalUrl, outW, outH, onNavigate, onSave, onDone, getDraft, setDraft, busy }: Props) {
  const item = items[index];
  const meta = item?.meta ?? null;

  const init = useCallback((): Draft => {
    const d = item ? getDraft(item.id) : undefined;
    if (d) return d;
    if (meta) return { box: meta.cropBox, angle: meta.angle ?? 0 };
    return { box: { left: 0, top: 0, width: 1000, height: (1000 * outH) / outW }, angle: 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, meta]);

  const [box, setBox] = useState(init().box);
  const [angle, setAngle] = useState(init().angle);
  const [ghostId, setGhostId] = useState<string | null>(null);
  const dragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  // Re-initialize when the image changes; keep any in-progress draft for it.
  useEffect(() => {
    const d = init();
    setBox(d.box);
    setAngle(d.angle);
    dragRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

  // Persist the working state as a draft so navigating away never loses edits.
  useEffect(() => {
    if (item) setDraft(item.id, { box, angle });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box, angle]);

  // Arrow-key navigation (skip when typing in an input/slider).
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      if (e.key === 'ArrowRight' && index < items.length - 1) onNavigate(index + 1);
      if (e.key === 'ArrowLeft' && index > 0) onNavigate(index - 1);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [index, items.length, onNavigate]);

  const aspect = outW / outH;
  const viewW = aspect >= 1 ? VIEW : VIEW * aspect;
  const viewH = aspect >= 1 ? VIEW / aspect : VIEW;
  const scale = viewW / box.width;
  const bgCss = `rgb(${meta?.bg?.[0] ?? 255}, ${meta?.bg?.[1] ?? 252}, ${meta?.bg?.[2] ?? 247})`;
  const references = items.filter((r) => r.id !== item?.id && !r.pending && r.pngDataUrl);
  const ghost = references.find((r) => r.id === ghostId) ?? null;

  const imgStyle = useMemo(
    () => ({
      width: (meta?.srcW ?? 0) * scale,
      height: (meta?.srcH ?? 0) * scale,
      transform: `translate(${-box.left * scale}px, ${-box.top * scale}px)`,
    }),
    [box, scale, meta?.srcW, meta?.srcH]
  );

  if (!item || !meta) return null;

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, left: box.left, top: box.top };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const a = (-angle * Math.PI) / 180;
    const sx = e.clientX - dragRef.current.x;
    const sy = e.clientY - dragRef.current.y;
    const dx = (Math.cos(a) * sx - Math.sin(a) * sy) / scale;
    const dy = (Math.sin(a) * sx + Math.cos(a) * sy) / scale;
    setBox((b) => ({ ...b, left: dragRef.current!.left - dx, top: dragRef.current!.top - dy }));
  };
  const onPointerUp = () => (dragRef.current = null);

  const zoom = (factor: number) => {
    setBox((b) => {
      const cx = b.left + b.width / 2;
      const cy = b.top + b.height / 2;
      const width = Math.max(32, b.width * factor);
      return { left: cx - width / 2, top: cy - width / aspect / 2, width, height: width / aspect };
    });
  };

  const zoomPct = Math.round((meta.cropBox.width / box.width) * 100);
  const reset = () => { setBox(meta.cropBox); setAngle(meta.angle ?? 0); };
  const flaggedLeft = items.filter((r) => r.flagged).length;
  const pendingLeft = items.filter((r) => r.pending).length;

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="flex items-center justify-between">
        <button
          onClick={() => index > 0 && onNavigate(index - 1)}
          disabled={index === 0}
          className="rounded-full border border-espresso/25 px-4 py-2 hover:bg-blush/30 disabled:opacity-30"
        >
          ←
        </button>
        <div className="text-center">
          <h2 className="text-2xl">Edit — {index + 1} of {items.length}</h2>
          <p className="text-sm text-espresso/60">
            {item.name}
            {item.pending && <span className="ml-2 rounded-full bg-plum/15 px-2 py-0.5 text-xs text-plum">not cropped yet</span>}
            {item.flagged && !item.pending && <span className="ml-2 rounded-full bg-berry/15 px-2 py-0.5 text-xs text-berry">flagged</span>}
          </p>
        </div>
        <button
          onClick={() => index < items.length - 1 && onNavigate(index + 1)}
          disabled={index === items.length - 1}
          className="rounded-full border border-espresso/25 px-4 py-2 hover:bg-blush/30 disabled:opacity-30"
        >
          →
        </button>
      </div>

      <p className="text-center text-xs text-espresso/50">
        Drag to reposition · scroll or slider to zoom · arrows or thumbnails to jump — in-progress tweaks are kept per image until you save.
      </p>

      <div
        className="relative mx-auto cursor-grab touch-none overflow-hidden rounded-xl border-2 border-plum active:cursor-grabbing"
        style={{ width: viewW, height: viewH, background: bgCss }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={(e) => zoom(e.deltaY > 0 ? 1.04 : 0.96)}
      >
        <div className="absolute inset-0" style={{ transform: `rotate(${angle}deg)`, transformOrigin: '50% 50%' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={originalUrl} alt="" draggable={false} className="pointer-events-none absolute left-0 top-0 max-w-none select-none" style={imgStyle} />
        </div>
        {ghost && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={ghost.pngDataUrl} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-contain opacity-40" />
        )}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-0 h-full w-px bg-berry/50" />
          <div className="absolute left-0 top-1/2 h-px w-full bg-berry/50" />
        </div>
      </div>

      {/* zoom */}
      <div className="flex items-center justify-center gap-3">
        <span className="w-14 text-right text-sm text-espresso/60">zoom</span>
        <input
          type="range"
          min={40}
          max={250}
          value={Math.min(250, Math.max(40, zoomPct))}
          onChange={(e) => {
            const target = parseInt(e.target.value, 10) / 100;
            const width = meta.cropBox.width / target;
            setBox((b) => {
              const cx = b.left + b.width / 2;
              const cy = b.top + b.height / 2;
              return { left: cx - width / 2, top: cy - width / aspect / 2, width, height: width / aspect };
            });
          }}
          className="w-56 accent-plum"
        />
        <span className="w-12 text-sm text-espresso/60">{zoomPct}%</span>
      </div>

      {/* rotate */}
      <div className="flex items-center justify-center gap-3">
        <span className="w-14 text-right text-sm text-espresso/60">rotate</span>
        <input
          type="range"
          min={-45}
          max={45}
          step={0.5}
          value={angle}
          onChange={(e) => setAngle(parseFloat(e.target.value))}
          className="w-56 accent-berry"
        />
        <span className="w-12 text-sm text-espresso/60">{angle.toFixed(1)}°</span>
        <button onClick={() => setAngle(0)} className="text-xs text-espresso/50 underline">level</button>
      </div>

      {/* ghost reference picker */}
      {references.length > 0 && (
        <div className="rounded-lg border border-espresso/15 bg-white/60 p-2">
          <p className="mb-1 text-center text-xs text-espresso/60">
            Ghost reference — overlay a good crop to match its placement {ghost ? `(showing ${ghost.name})` : ''}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              onClick={() => setGhostId(null)}
              className={`rounded px-2 py-1 text-xs ${ghostId === null ? 'bg-plum text-porcelain' : 'border border-espresso/25'}`}
            >
              none
            </button>
            {references.map((r) => (
              <button
                key={r.id}
                onClick={() => setGhostId(r.id === ghostId ? null : r.id)}
                className={`relative h-12 w-12 overflow-hidden rounded border-2 ${r.id === ghostId ? 'border-plum' : 'border-transparent'}`}
                title={r.name}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.pngDataUrl} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-center gap-3">
        <button onClick={reset} className="rounded-lg border border-espresso/25 px-4 py-2 hover:bg-blush/30">
          Reset to original
        </button>
        <button
          onClick={() => onSave(item.id, box, angle)}
          disabled={busy}
          className="rounded-lg bg-espresso px-6 py-2 text-porcelain hover:bg-plum disabled:opacity-40"
        >
          {busy ? 'Rendering…' : 'Save & next'}
        </button>
        <button onClick={onDone} disabled={busy} className="rounded-lg border border-plum px-4 py-2 text-plum hover:bg-blush/30 disabled:opacity-40">
          Done → review
        </button>
      </div>

      {(flaggedLeft > 0 || pendingLeft > 0) && (
        <p className="text-center text-xs text-espresso/50">
          {pendingLeft > 0 && `${pendingLeft} not cropped yet`}{pendingLeft > 0 && flaggedLeft > 0 && ' · '}{flaggedLeft > 0 && `${flaggedLeft} flagged`}
        </p>
      )}

      {/* full-batch thumbnail strip — jump anywhere */}
      <div className="flex flex-wrap justify-center gap-2">
        {items.map((r, idx) => (
          <button
            key={r.id}
            onClick={() => onNavigate(idx)}
            className={`relative h-12 w-12 overflow-hidden rounded border-2 ${idx === index ? 'border-plum' : r.flagged ? 'border-berry' : r.pending ? 'border-dashed border-espresso/40' : 'border-transparent'}`}
            title={r.name}
          >
            {(r.pngDataUrl || r.originalThumbUrl) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={r.pngDataUrl || r.originalThumbUrl} alt="" className={`h-full w-full object-cover ${r.pending ? 'opacity-50' : ''}`} />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
