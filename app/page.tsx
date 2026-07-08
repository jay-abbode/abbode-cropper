'use client';

import { useCallback, useRef, useState } from 'react';
import Uploader from '@/components/Uploader';
import Visualizer from '@/components/Visualizer';
import Carousel from '@/components/Carousel';
import ManualEditor from '@/components/ManualEditor';
import type { CropSpec, ImageResult } from '@/lib/types';

type Phase = 'setup' | 'processing' | 'review' | 'editing';

export default function Home() {
  const [phase, setPhase] = useState<Phase>('setup');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filesRef = useRef<File[]>([]);
  const urlsRef = useRef<Map<string, string>>(new Map()); // id -> object URL of original
  const [dims, setDims] = useState({ w: 750, h: 750 });
  const [instruction, setInstruction] = useState('');
  const [spec, setSpec] = useState<CropSpec | null>(null);

  const [results, setResults] = useState<ImageResult[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [current, setCurrent] = useState<{ name: string; url: string; meta: ImageResult['meta'] | null; index: number }>({
    name: '',
    url: '',
    meta: null,
    index: 0,
  });

  const [editQueue, setEditQueue] = useState<string[]>([]);

  const pushLog = (l: string) => setLog((prev) => [...prev, l]);

  const parseSpec = useCallback(async (instr: string, feedback?: string, currentSpec?: CropSpec): Promise<CropSpec> => {
    const res = await fetch('/api/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: instr, feedback, currentSpec }),
    });
    const json = await res.json();
    return json.spec as CropSpec;
  }, []);

  const cropOne = useCallback(
    async (file: File, useSpec: CropSpec, box?: { left: number; top: number; width: number; height: number }) => {
      const form = new FormData();
      form.append('file', file);
      form.append('outW', String(dims.w));
      form.append('outH', String(dims.h));
      form.append('spec', JSON.stringify(useSpec));
      if (box) form.append('cropBox', JSON.stringify(box));
      const res = await fetch('/api/crop', { method: 'POST', body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `crop failed for ${file.name}`);
      return json as { png: string; meta: ImageResult['meta'] };
    },
    [dims]
  );

  const runBatch = useCallback(
    async (useSpec: CropSpec) => {
      setPhase('processing');
      setResults([]);
      setError(null);
      const files = filesRef.current;
      const MIN_MS = 2700; // let the visualizer breathe per image

      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const id = `${i}-${f.name}`;
        let url = urlsRef.current.get(id);
        if (!url) {
          url = URL.createObjectURL(f);
          urlsRef.current.set(id, url);
        }
        setCurrent({ name: f.name, url, meta: null, index: i });
        pushLog(`▸ ${f.name}: estimating background…`);
        const t0 = performance.now();
        try {
          const { png, meta } = await cropOne(f, useSpec);
          pushLog(`  masking subject → figure ${Math.round(meta.figure[2] - meta.figure[0])}×${Math.round(meta.figure[3] - meta.figure[1])}px`);
          setCurrent({ name: f.name, url, meta, index: i });
          if (useSpec.mode === 'face') pushLog(`  symmetry axis @ x=${Math.round(meta.centerFace[0])} (front face)`);
          pushLog(`  normalizing scale, settling crop… ✓`);
          const elapsed = performance.now() - t0;
          if (elapsed < MIN_MS) await new Promise((r) => setTimeout(r, MIN_MS - elapsed));
          setResults((prev) => [
            ...prev,
            { id, name: f.name.replace(/\.[^.]+$/, '') + '.png', pngDataUrl: `data:image/png;base64,${png}`, meta, flagged: false },
          ]);
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'unknown error';
          pushLog(`  ✗ ${msg}`);
          setError(`Failed on ${f.name}: ${msg}`);
          setPhase('setup');
          return;
        }
      }
      setPhase('review');
    },
    [cropOne]
  );

  const onStart = useCallback(
    async (files: File[], w: number, h: number, instr: string) => {
      setBusy(true);
      try {
        filesRef.current = files;
        urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
        urlsRef.current.clear();
        setDims({ w, h });
        setInstruction(instr);
        setLog([`Parsing instruction: “${instr}”`]);
        const s = await parseSpec(instr);
        setSpec(s);
        pushLog(`Spec → mode=${s.mode}, anchor=(${s.anchorX.toFixed(2)}, ${s.anchorY.toFixed(2)}), subject=${Math.round(s.subjectFraction * 100)}% width`);
        await runBatch(s);
      } finally {
        setBusy(false);
      }
    },
    [parseSpec, runBatch]
  );

  const onFeedbackRerun = useCallback(
    async (feedback: string) => {
      if (!spec) return;
      setBusy(true);
      try {
        setLog([`Applying feedback: “${feedback}”`]);
        const s = await parseSpec(instruction, feedback, spec);
        setSpec(s);
        pushLog(`New spec → mode=${s.mode}, anchor=(${s.anchorX.toFixed(2)}, ${s.anchorY.toFixed(2)}), subject=${Math.round(s.subjectFraction * 100)}%`);
        await runBatch(s);
      } finally {
        setBusy(false);
      }
    },
    [spec, instruction, parseSpec, runBatch]
  );

  const onToggleFlag = useCallback((id: string) => {
    setResults((prev) => prev.map((r) => (r.id === id ? { ...r, flagged: !r.flagged } : r)));
  }, []);

  const onEditFlagged = useCallback(() => {
    setEditQueue(results.filter((r) => r.flagged).map((r) => r.id));
    setPhase('editing');
  }, [results]);

  const advanceEdit = useCallback(() => {
    setEditQueue((q) => {
      const next = q.slice(1);
      if (next.length === 0) setPhase('review');
      return next;
    });
  }, []);

  const onSaveEdit = useCallback(
    async (id: string, box: { left: number; top: number; width: number; height: number }) => {
      const idx = parseInt(id.split('-')[0], 10);
      const file = filesRef.current[idx];
      if (!file || !spec) return;
      setBusy(true);
      try {
        const { png, meta } = await cropOne(file, spec, box);
        setResults((prev) =>
          prev.map((r) => (r.id === id ? { ...r, pngDataUrl: `data:image/png;base64,${png}`, meta, flagged: false } : r))
        );
        advanceEdit();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'edit failed');
      } finally {
        setBusy(false);
      }
    },
    [cropOne, spec, advanceEdit]
  );

  const onDownload = useCallback(async () => {
    setBusy(true);
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      for (const r of results) {
        zip.file(r.name, r.pngDataUrl.split(',')[1], { base64: true });
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `crops_${dims.w}x${dims.h}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setBusy(false);
    }
  }, [results, dims]);

  const onStartOver = useCallback(() => {
    setPhase('setup');
    setResults([]);
    setSpec(null);
    setLog([]);
    setError(null);
  }, []);

  const editingItem = phase === 'editing' && editQueue.length > 0 ? results.find((r) => r.id === editQueue[0]) : null;

  return (
    <main className="min-h-screen px-4 py-10">
      <header className="mb-10 text-center">
        <h1 className="text-4xl">Abbode Cropper</h1>
        <p className="mt-1 text-espresso/60">Batch product crops — detected, aligned, sanity-checked.</p>
      </header>

      {error && (
        <p className="mx-auto mb-6 max-w-2xl rounded-lg bg-berry/10 px-4 py-3 text-sm text-berry">{error}</p>
      )}

      {phase === 'setup' && <Uploader onStart={onStart} busy={busy} />}

      {phase === 'processing' && (
        <Visualizer
          currentName={current.name}
          currentUrl={current.url}
          currentMeta={current.meta}
          done={results}
          index={current.index}
          total={filesRef.current.length}
          logLines={log}
        />
      )}

      {phase === 'review' && (
        <Carousel
          results={results}
          onToggleFlag={onToggleFlag}
          onFeedbackRerun={onFeedbackRerun}
          onEditFlagged={onEditFlagged}
          onDownload={onDownload}
          onStartOver={onStartOver}
          busy={busy}
        />
      )}

      {phase === 'editing' && editingItem && (
        <ManualEditor
          item={editingItem}
          originalUrl={urlsRef.current.get(editingItem.id) ?? ''}
          outW={dims.w}
          outH={dims.h}
          queuePos={`${results.filter((r) => r.flagged).length - editQueue.length + 1} of ${results.filter((r) => r.flagged).length || editQueue.length}`}
          onSave={onSaveEdit}
          onSkip={advanceEdit}
          busy={busy}
        />
      )}
    </main>
  );
}
