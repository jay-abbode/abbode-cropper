'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import type { ImageResult } from '@/lib/types';

interface Props {
  item: ImageResult;
  originalUrl: string;
  outW: number;
  outH: number;
  queuePos: string; // e.g. "1 of 3"
  onSave: (id: string, box: { left: number; top: number; width: number; height: number }) => Promise<void>;
  onSkip: () => void;
  busy: boolean;
}

const VIEW = 460;

export default function ManualEditor({ item, originalUrl, outW, outH, queuePos, onSave, onSkip, busy }: Props) {
  const [box, setBox] = useState(item.meta.cropBox);
  const dragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  const aspect = outW / outH;
  const viewW = aspect >= 1 ? VIEW : VIEW * aspect;
  const viewH = aspect >= 1 ? VIEW / aspect : VIEW;
  const scale = viewW / box.width; // display px per source px

  // position the full original image so that the crop box fills the viewport
  const imgStyle = useMemo(
    () => ({
      width: item.meta.srcW * scale,
      height: item.meta.srcH * scale,
      transform: `translate(${-box.left * scale}px, ${-box.top * scale}px)`,
    }),
    [box, scale, item.meta.srcW, item.meta.srcH]
  );

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, left: box.left, top: box.top };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = (e.clientX - dragRef.current.x) / scale;
    const dy = (e.clientY - dragRef.current.y) / scale;
    setBox((b) => ({ ...b, left: dragRef.current!.left - dx, top: dragRef.current!.top - dy }));
  };
  const onPointerUp = () => (dragRef.current = null);

  const zoom = useCallback(
    (factor: number) => {
      setBox((b) => {
        const cx = b.left + b.width / 2;
        const cy = b.top + b.height / 2;
        const width = Math.max(32, b.width * factor);
        const height = width / aspect;
        return { left: cx - width / 2, top: cy - height / 2, width, height };
      });
    },
    [aspect]
  );

  const zoomPct = Math.round((item.meta.cropBox.width / box.width) * 100);

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h2 className="text-center text-2xl">Manual edit — {queuePos}</h2>
      <p className="text-center text-sm text-espresso/60">{item.name} · drag to reposition, scroll or slider to zoom</p>

      <div
        className="relative mx-auto cursor-grab touch-none overflow-hidden rounded-xl border-2 border-plum bg-white active:cursor-grabbing"
        style={{ width: viewW, height: viewH }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={(e) => zoom(e.deltaY > 0 ? 1.04 : 0.96)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={originalUrl} alt="" draggable={false} className="pointer-events-none absolute left-0 top-0 max-w-none select-none" style={imgStyle} />
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-0 h-full w-px bg-berry/50" />
          <div className="absolute left-0 top-1/2 h-px w-full bg-berry/50" />
        </div>
      </div>

      <div className="flex items-center justify-center gap-3">
        <span className="text-sm text-espresso/60">zoom</span>
        <input
          type="range"
          min={40}
          max={250}
          value={zoomPct}
          onChange={(e) => {
            const target = parseInt(e.target.value, 10) / 100;
            const width = item.meta.cropBox.width / target;
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

      <div className="flex justify-center gap-3">
        <button onClick={() => setBox(item.meta.cropBox)} className="rounded-lg border border-espresso/25 px-4 py-2 hover:bg-blush/30">
          Reset
        </button>
        <button onClick={onSkip} disabled={busy} className="rounded-lg border border-espresso/25 px-4 py-2 hover:bg-blush/30 disabled:opacity-40">
          Skip
        </button>
        <button
          onClick={() => onSave(item.id, box)}
          disabled={busy}
          className="rounded-lg bg-espresso px-6 py-2 text-porcelain hover:bg-plum disabled:opacity-40"
        >
          {busy ? 'Rendering…' : 'Save & next'}
        </button>
      </div>
    </div>
  );
}
