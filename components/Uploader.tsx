'use client';

import { useCallback, useRef, useState } from 'react';
import type { RunMode } from '@/lib/types';

interface Props {
  onStart: (files: File[], outW: number, outH: number, instruction: string, mode: RunMode) => void;
  busy: boolean;
  initialFiles?: File[];
  initialW?: number;
  initialH?: number;
  initialInstruction?: string;
  initialMode?: RunMode;
}

const ACCEPT = /\.(jpe?g|png|webp|tiff?)$/i;

const MODES: { id: RunMode; label: string; blurb: string }[] = [
  { id: 'instant', label: 'Instant', blurb: 'Fastest — crops in parallel with lighter detection. Review after.' },
  { id: 'default', label: 'Default', blurb: 'Watch it work; stop and resume any time.' },
  { id: 'manual', label: 'Full manual', blurb: 'Opens instantly. You place every crop yourself.' },
];

export default function Uploader({ onStart, busy, initialFiles, initialW, initialH, initialInstruction, initialMode }: Props) {
  const [files, setFiles] = useState<File[]>(initialFiles ?? []);
  const [outW, setOutW] = useState(initialW ?? 750);
  const [outH, setOutH] = useState(initialH ?? 750);
  const [instruction, setInstruction] = useState(initialInstruction ?? 'Center the product perfectly.');
  const [mode, setMode] = useState<RunMode>(initialMode ?? 'default');
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((list: FileList | File[]) => {
    const next = Array.from(list).filter((f) => ACCEPT.test(f.name));
    next.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    setFiles(next);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      addFiles(e.dataTransfer.files);
    },
    [addFiles]
  );

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer rounded-2xl border-2 border-dashed p-10 text-center transition-colors ${
          dragging ? 'border-berry bg-blush/20' : 'border-espresso/25 hover:border-plum'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          // @ts-expect-error non-standard folder-picker attribute
          webkitdirectory=""
          className="hidden"
          onChange={(e) => e.target.files && addFiles(e.target.files)}
        />
        <p className="text-lg font-serif">Upload a folder</p>
        <p className="mt-1 text-sm text-espresso/60">
          One product per batch. Click to pick a folder, or drag images in. JPG / PNG / WebP / TIFF.
        </p>
        {files.length > 0 && (
          <p className="mt-3 inline-block rounded-full bg-plum px-3 py-1 text-sm text-porcelain">
            {files.length} image{files.length === 1 ? '' : 's'} ready
          </p>
        )}
      </div>

      {/* processing mode */}
      <div>
        <span className="text-sm text-espresso/70">Mode</span>
        <div className="mt-1 grid grid-cols-3 gap-2">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`rounded-xl border-2 p-3 text-left transition ${
                mode === m.id ? 'border-plum bg-blush/25' : 'border-espresso/15 hover:border-plum/50'
              }`}
            >
              <span className="block font-medium">{m.label}</span>
              <span className="mt-0.5 block text-xs leading-snug text-espresso/60">{m.blurb}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-end gap-4">
        <label className="block">
          <span className="text-sm text-espresso/70">Width (px)</span>
          <input
            type="number"
            value={outW}
            min={16}
            max={4000}
            onChange={(e) => setOutW(parseInt(e.target.value, 10) || 0)}
            className="mt-1 block w-32 rounded-lg border border-espresso/25 bg-white px-3 py-2"
          />
        </label>
        <span className="pb-2 text-espresso/40">×</span>
        <label className="block">
          <span className="text-sm text-espresso/70">Height (px)</span>
          <input
            type="number"
            value={outH}
            min={16}
            max={4000}
            onChange={(e) => setOutH(parseInt(e.target.value, 10) || 0)}
            className="mt-1 block w-32 rounded-lg border border-espresso/25 bg-white px-3 py-2"
          />
        </label>
      </div>

      <label className="block">
        <span className="text-sm text-espresso/70">
          {mode === 'manual' ? 'Starting crop (you’ll adjust each by hand)' : 'Exactly what do you want?'}
        </span>
        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          rows={3}
          placeholder='e.g. "Center the front face of the product, filling about 70% of the frame" or "Product in the lower third, lots of breathing room"'
          className="mt-1 block w-full rounded-lg border border-espresso/25 bg-white px-3 py-2"
        />
      </label>

      <button
        disabled={busy || files.length === 0 || !outW || !outH}
        onClick={() => onStart(files, outW, outH, instruction, mode)}
        className="w-full rounded-xl bg-espresso px-6 py-3 text-lg text-porcelain transition hover:bg-plum disabled:opacity-40"
      >
        {mode === 'manual' ? 'Start manual editing' : mode === 'instant' ? 'Crop now' : 'Crop images'}
      </button>
    </div>
  );
}
