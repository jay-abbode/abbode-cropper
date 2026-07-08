'use client';

import { useCallback, useRef, useState } from 'react';
import Uploader from '@/components/Uploader';
import Visualizer from '@/components/Visualizer';
import Carousel from '@/components/Carousel';
import ManualEditor from '@/components/ManualEditor';
import { prepareImage } from '@/lib/resize';
import type { CropSpec, ImageResult, RunMode } from '@/lib/types';

type Phase = 'setup' | 'processing' | 'review' | 'editing';

export default function Home() {
  const [phase, setPhase] = useState<Phase>('setup');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filesRef = useRef<File[]>([]);
  const urlsRef = useRef<Map<string, string>>(new Map()); // id -> object URL of the uploaded image
  const preparedRef = useRef<Map<string, Blob>>(new Map()); // id -> possibly-downscaled blob actually sent
  const abortRef = useRef(false); // set by the Stop button to break the batch loop
  const controllerRef = useRef<AbortController | null>(null); // cancels the in-flight crop request
  const resumeIndexRef = useRef(0); // next image to process if a batch was stopped early
  const modeRef = useRef<RunMode>('default'); // active processing mode for this run
  const [mode, setMode] = useState<RunMode>('default');
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
  const [editTotal, setEditTotal] = useState(0); // size of the current edit session (for "k of N")

  const pushLog = (l: string) => setLog((prev) => [...prev, l]);

  // Sleep that resolves immediately if the batch is aborted mid-wait.
  const sleep = (ms: number, signal?: AbortSignal) =>
    new Promise<void>((resolve) => {
      const t = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
    });

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
    async (blob: Blob, name: string, useSpec: CropSpec, box?: { left: number; top: number; width: number; height: number }, angle?: number, signal?: AbortSignal) => {
      const form = new FormData();
      form.append('file', blob, name);
      form.append('outW', String(dims.w));
      form.append('outH', String(dims.h));
      form.append('spec', JSON.stringify(useSpec));
      if (box) form.append('cropBox', JSON.stringify(box));
      if (angle !== undefined) form.append('angle', String(angle));
      const res = await fetch('/api/crop', { method: 'POST', body: form, signal });
      const raw = await res.text();
      if (!res.ok) {
        let msg = `server error ${res.status}`;
        try {
          msg = JSON.parse(raw).error || msg;
        } catch {
          if (res.status === 413 || /request en|too large/i.test(raw)) {
            msg = 'image too large to upload even after downscaling — tell me and I’ll shrink harder';
          }
        }
        throw new Error(msg);
      }
      return JSON.parse(raw) as { png: string; meta: ImageResult['meta'] };
    },
    [dims]
  );

  const runBatch = useCallback(
    async (useSpec: CropSpec, startIndex = 0, preserve = false) => {
      setPhase('processing');
      if (!preserve) setResults([]);
      setError(null);
      abortRef.current = false;
      const files = filesRef.current;
      const animate = modeRef.current === 'default';
      const MIN_MS = animate ? 2700 : 0; // Instant / Full-manual run as fast as possible
      let completed = 0;

      for (let i = startIndex; i < files.length; i++) {
        if (abortRef.current) { resumeIndexRef.current = i; break; }
        const f = files[i];
        const id = `${i}-${f.name}`;
        setCurrent({ name: f.name, url: urlsRef.current.get(id) ?? '', meta: null, index: i });
        pushLog(`▸ ${f.name}: preparing image…`);
        const t0 = performance.now();
        try {
          let blob = preparedRef.current.get(id);
          let url = urlsRef.current.get(id);
          if (!blob || !url) {
            const prep = await prepareImage(f);
            blob = prep.blob;
            url = prep.url;
            preparedRef.current.set(id, blob);
            urlsRef.current.set(id, url);
            if (blob.size < f.size * 0.9) {
              pushLog(`  downscaled ${(f.size / 1e6).toFixed(1)}→${(blob.size / 1e6).toFixed(1)} MB for upload`);
            }
          }
          if (abortRef.current) { resumeIndexRef.current = i; break; }
          setCurrent({ name: f.name, url, meta: null, index: i });

          const controller = new AbortController();
          controllerRef.current = controller;
          const { png, meta } = await cropOne(blob, f.name, useSpec, undefined, undefined, controller.signal);

          pushLog(`  masking subject → figure ${Math.round(meta.figure[2] - meta.figure[0])}×${Math.round(meta.figure[3] - meta.figure[1])}px`);
          setCurrent({ name: f.name, url, meta, index: i });
          if (useSpec.mode === 'face') pushLog(`  symmetry axis @ x=${Math.round(meta.centerFace[0])} (front face)`);
          if (useSpec.straighten && Math.abs(meta.angle) > 0.05) pushLog(`  auto-leveled ${meta.angle > 0 ? '+' : ''}${meta.angle}°`);
          pushLog(meta.lowConfidence ? '  ⚠ detection unsure — flagged for review' : '  normalizing scale, settling crop… ✓');
          const elapsed = performance.now() - t0;
          if (elapsed < MIN_MS) await sleep(MIN_MS - elapsed, controller.signal);
          setResults((prev) => [
            ...prev,
            {
              id,
              name: f.name.replace(/\.[^.]+$/, '') + '.png',
              pngDataUrl: `data:image/png;base64,${png}`,
              meta,
              flagged: modeRef.current === 'manual' ? true : meta.lowConfidence, // manual edits every image; others auto-flag only uncertain crops
            },
          ]);
          completed++;
        } catch (e) {
          // A user-triggered abort surfaces as an AbortError — that's not a failure.
          if (abortRef.current || (e instanceof DOMException && e.name === 'AbortError')) { resumeIndexRef.current = i; break; }
          const msg = e instanceof Error ? e.message : 'unknown error';
          pushLog(`  ✗ ${msg}`);
          setError(`Failed on ${f.name}: ${msg}`);
          setPhase('setup');
          return;
        }
      }

      controllerRef.current = null;
      if (abortRef.current) {
        pushLog(`■ stopped — ${resumeIndexRef.current} of ${files.length} reached`);
        setPhase(preserve || completed > 0 ? 'review' : 'setup');
      } else {
        resumeIndexRef.current = files.length; // finished the batch — nothing to resume
        if (modeRef.current === 'manual' && completed > 0) {
          // Full manual: hand every image to the editor in order.
          const ids = files.map((f, i) => `${i}-${f.name}`);
          setEditQueue(ids);
          setEditTotal(ids.length);
          setPhase('editing');
        } else {
          setPhase('review');
        }
      }
    },
    [cropOne]
  );

  const onStart = useCallback(
    async (files: File[], w: number, h: number, instr: string, runMode: RunMode) => {
      setBusy(true);
      try {
        filesRef.current = files;
        urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
        urlsRef.current.clear();
        preparedRef.current.clear();
        modeRef.current = runMode;
        setMode(runMode);
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
    const ids = results.filter((r) => r.flagged).map((r) => r.id);
    setEditQueue(ids);
    setEditTotal(ids.length);
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
    async (id: string, box: { left: number; top: number; width: number; height: number }, angle: number) => {
      const idx = parseInt(id.split('-')[0], 10);
      const file = filesRef.current[idx];
      const blob = preparedRef.current.get(id) ?? file;
      if (!blob || !spec) return;
      setBusy(true);
      try {
        const { png, meta } = await cropOne(blob, file?.name ?? 'image.png', spec, box, angle);
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

  const handleAbort = useCallback(() => {
    abortRef.current = true;
    controllerRef.current?.abort(); // cancel the crop request in flight
    pushLog('■ stopping…');
  }, []);

  const onResume = useCallback(async () => {
    if (!spec) return;
    setBusy(true);
    try {
      await runBatch(spec, resumeIndexRef.current, true);
    } finally {
      setBusy(false);
    }
  }, [spec, runBatch]);

  const onStartOver = useCallback(() => {
    abortRef.current = false;
    resumeIndexRef.current = 0;
    setPhase('setup');
    setResults([]);
    setSpec(null);
    setLog([]);
    setError(null);
    // filesRef / dims / instruction are preserved so the Uploader re-seeds and
    // you can rewrite the instruction without re-selecting the folder.
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

      {phase === 'setup' && (
        <Uploader
          onStart={onStart}
          busy={busy}
          initialFiles={filesRef.current.length ? filesRef.current : undefined}
          initialW={dims.w}
          initialH={dims.h}
          initialInstruction={instruction || undefined}
          initialMode={mode}
        />
      )}

      {phase === 'processing' && mode === 'default' && (
        <Visualizer
          currentName={current.name}
          currentUrl={current.url}
          currentMeta={current.meta}
          done={results}
          index={current.index}
          total={filesRef.current.length}
          logLines={log}
          onAbort={handleAbort}
        />
      )}

      {phase === 'processing' && mode !== 'default' && (
        <div className="mx-auto max-w-md space-y-4 pt-10 text-center">
          <p className="text-lg">{mode === 'manual' ? 'Preparing images for manual editing…' : 'Cropping…'}</p>
          <div className="h-2 w-full overflow-hidden rounded-full bg-espresso/10">
            <div
              className="h-full rounded-full bg-plum transition-all duration-200"
              style={{ width: `${filesRef.current.length ? ((current.index + 1) / filesRef.current.length) * 100 : 0}%` }}
            />
          </div>
          <p className="text-sm text-espresso/60">
            {Math.min(current.index + 1, filesRef.current.length)} / {filesRef.current.length}
            {mode === 'manual' ? ' — then you’ll adjust each one' : ' — you’ll review them next'}
          </p>
        </div>
      )}

      {phase === 'review' && (
        <Carousel
          results={results}
          onToggleFlag={onToggleFlag}
          onFeedbackRerun={onFeedbackRerun}
          onEditFlagged={onEditFlagged}
          onDownload={onDownload}
          onStartOver={onStartOver}
          onResume={onResume}
          remaining={Math.max(0, filesRef.current.length - resumeIndexRef.current)}
          busy={busy}
        />
      )}

      {phase === 'editing' && editingItem && (
        <ManualEditor
          item={editingItem}
          originalUrl={urlsRef.current.get(editingItem.id) ?? ''}
          outW={dims.w}
          outH={dims.h}
          references={results.filter((r) => r.id !== editingItem.id)}
          queuePos={`${editTotal - editQueue.length + 1} of ${editTotal}`}
          onSave={onSaveEdit}
          onSkip={advanceEdit}
          busy={busy}
        />
      )}
    </main>
  );
}
