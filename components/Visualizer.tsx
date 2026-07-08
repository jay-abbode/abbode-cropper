'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ImageResult } from '@/lib/types';

interface Props {
  currentName: string | null;
  currentUrl: string | null;      // object URL of the ORIGINAL being processed
  currentMeta: ImageResult['meta'] | null; // arrives when server responds
  done: ImageResult[];            // completed crops (ghost stack)
  index: number;
  total: number;
  logLines: string[];
}

const STAGE_MS = [900, 500, 500, 650]; // scan, bbox, axis, crop-frame

export default function Visualizer({ currentName, currentUrl, currentMeta, done, index, total, logLines }: Props) {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    setStage(0);
  }, [currentUrl]);

  useEffect(() => {
    if (!currentMeta) return;
    let s = 0;
    setStage(1);
    const timers: ReturnType<typeof setTimeout>[] = [];
    let acc = 0;
    for (s = 1; s < 5; s++) {
      acc += STAGE_MS[s - 1];
      timers.push(setTimeout(() => setStage(s + 0), acc)); // stages advance 1..4
    }
    return () => timers.forEach(clearTimeout);
  }, [currentMeta]);

  // map source coords -> display box (fit within 340x340)
  const view = useMemo(() => {
    if (!currentMeta) return null;
    const { srcW, srcH } = currentMeta;
    const scale = Math.min(340 / srcW, 340 / srcH);
    return { scale, w: srcW * scale, h: srcH * scale };
  }, [currentMeta]);

  const box = (v: [number, number, number, number]) =>
    view
      ? { left: v[0] * view.scale, top: v[1] * view.scale, width: (v[2] - v[0]) * view.scale, height: (v[3] - v[1]) * view.scale }
      : undefined;

  return (
    <div className="mx-auto flex max-w-4xl flex-col items-center gap-8 md:flex-row md:items-start md:justify-center">
      {/* Ghost alignment stack */}
      <div className="flex flex-col items-center">
        <p className="mb-2 text-sm text-espresso/60">Alignment stack</p>
        <div className="relative h-[260px] w-[260px] overflow-hidden rounded-xl border border-espresso/15 bg-white">
          {done.map((r) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={r.id}
              src={r.pngDataUrl}
              alt=""
              className="anim-settle absolute inset-0 h-full w-full object-contain"
              style={{ opacity: Math.max(0.1, 0.5 / Math.max(1, done.length)) + 0.08 }}
            />
          ))}
          {/* center crosshair */}
          <div className="pointer-events-none absolute left-1/2 top-0 h-full w-px bg-berry/60" />
          <div className="pointer-events-none absolute left-0 top-1/2 h-px w-full bg-berry/60" />
        </div>
        <p className="mt-2 text-xs text-espresso/50">{done.length} aligned — ghosts should overlap</p>
      </div>

      {/* Current image with detection overlay */}
      <div className="flex flex-col items-center">
        <p className="mb-2 text-sm text-espresso/60">
          {index + 1} / {total} — <span className="font-medium text-espresso">{currentName ?? '…'}</span>
        </p>
        <div className="relative flex h-[340px] w-[340px] items-center justify-center overflow-hidden rounded-xl border border-espresso/15 bg-white">
          {currentUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={currentUrl} alt="" className="max-h-full max-w-full object-contain" style={view ? { width: view.w, height: view.h } : undefined} />
          )}
          {view && currentMeta && (
            <div className="pointer-events-none absolute" style={{ width: view.w, height: view.h }}>
              {stage >= 1 && stage < 4 && (
                <div className="anim-scan absolute left-0 h-1 w-full bg-gradient-to-r from-transparent via-berry to-transparent" />
              )}
              {stage >= 2 && (
                <div
                  className="anim-draw absolute border-2 border-dashed border-espresso/70"
                  style={box(currentMeta.figure)}
                />
              )}
              {stage >= 3 && (
                <div
                  className="anim-draw absolute w-0.5 bg-berry"
                  style={{
                    left: currentMeta.centerFace[0] * view.scale,
                    top: currentMeta.figure[1] * view.scale,
                    height: (currentMeta.figure[3] - currentMeta.figure[1]) * view.scale,
                  }}
                />
              )}
              {stage >= 4 && (
                <div
                  className="anim-settle absolute border-[3px] border-plum shadow-[0_0_0_2000px_rgba(255,252,247,0.55)]"
                  style={{
                    left: currentMeta.cropBox.left * view.scale,
                    top: currentMeta.cropBox.top * view.scale,
                    width: currentMeta.cropBox.width * view.scale,
                    height: currentMeta.cropBox.height * view.scale,
                  }}
                />
              )}
            </div>
          )}
        </div>

        {/* Thinking log */}
        <div className="mt-3 h-24 w-[340px] overflow-hidden rounded-lg bg-espresso p-3 font-mono text-xs text-porcelain/90">
          {logLines.slice(-4).map((l, i) => (
            <p key={i} className="anim-draw truncate">
              {l}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
