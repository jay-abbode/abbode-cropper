'use client';

import { useCallback, useRef, useState } from 'react';
import Uploader from '@/components/Uploader';
import Visualizer from '@/components/Visualizer';
import Carousel from '@/components/Carousel';
import ManualEditor, { Draft } from '@/components/ManualEditor';
import { prepareImage, probeImage } from '@/lib/resize';
import type { CropSpec, CropMeta, ImageResult, RunMode } from '@/lib/types';

type Phase = 'setup' | 'processing' | 'review' | 'editing';

const INSTANT_POOL = 4; // parallel crop requests in Instant mode

export default function Home() {
  const [phase, setPhase] = useState<Phase>('setup');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyNote, setBusyNote] = useState<string | null>(null);

  const filesRef = useRef<File[]>([]);
  const urlsRef = useRef<Map<string, string>>(new Map());     // id -> prepared-image object URL (coordinate space)
  const rawUrlsRef = useRef<Map<string, string>>(new Map());  // id -> raw upload object URL (thumbnails only)
  const preparedRef = useRef<Map<string, Blob>>(new Map());   // id -> possibly-downscaled blob actually sent
  const metaPromisesRef = useRef<Map<string, Promise<void>>>(new Map()); // dedupes lazy meta synthesis
  const draftsRef = useRef<Map<string, Draft>>(new Map());    // per-image in-progress editor state
  const abortRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const resumeIndexRef = useRef(0);
  const modeRef = useRef<RunMode>('default');
  const resultsRef = useRef<ImageResult[]>([]);               // mirror of results for async flows
  const [mode, setMode] = useState<RunMode>('default');
  const [dims, setDims] = useState({ w: 750, h: 750 });
  const [instruction, setInstruction] = useState('');
  const [spec, setSpec] = useState<CropSpec | null>(null);

  const [results, _setResults] = useState<ImageResult[]>([]);
  const setResults = useCallback((updater: (prev: ImageResult[]) => ImageResult[]) => {
    _setResults((prev) => {
      const next = updater(prev);
      resultsRef.current = next;
      return next;
    });
  }, []);

  const [completed, setCompleted] = useState(0); // instant-mode progress
  const [log, setLog] = useState<string[]>([]);
  const [current, setCurrent] = useState<{ name: string; url: string; meta: CropMeta | null; index: number }>({
    name: '', url: '', meta: null, index: 0,
  });
  const [editIndex, setEditIndex] = useState(0);

  const pushLog = (l: string) => setLog((prev) => [...prev, l]);

  const sleep = (ms: number, signal?: AbortSignal) =>
    new Promise<void>((resolve) => {
      const t = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
    });

  const idOf = (i: number) => `${i}-${filesRef.current[i]?.name ?? i}`;
  const indexOf = (id: string) => parseInt(id.split('-')[0], 10);

  const ensurePrepared = useCallback(async (i: number): Promise<{ blob: Blob; url: string }> => {
    const id = idOf(i);
    const cachedBlob = preparedRef.current.get(id);
    const cachedUrl = urlsRef.current.get(id);
    if (cachedBlob && cachedUrl) return { blob: cachedBlob, url: cachedUrl };
    const prep = await prepareImage(filesRef.current[i]);
    preparedRef.current.set(id, prep.blob);
    urlsRef.current.set(id, prep.url);
    return prep;
  }, []);

  const parseSpec = useCallback(async (instr: string, feedback?: string, currentSpec?: CropSpec): Promise<CropSpec> => {
    const res = await fetch('/api/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: instr, feedback, currentSpec }),
    });
    const json = await res.json();
    return json.spec as CropSpec;
  }, []);

  interface CropOpts {
    spec?: CropSpec | null;
    box?: Draft['box'];
    angle?: number;
    bg?: [number, number, number];
    quality?: 'fast' | 'full';
    signal?: AbortSignal;
  }

  const cropOne = useCallback(
    async (blob: Blob, name: string, opts: CropOpts) => {
      const form = new FormData();
      form.append('file', blob, name);
      form.append('outW', String(dims.w));
      form.append('outH', String(dims.h));
      if (opts.spec) form.append('spec', JSON.stringify(opts.spec));
      if (opts.box) form.append('cropBox', JSON.stringify(opts.box));
      if (opts.angle !== undefined) form.append('angle', String(opts.angle));
      if (opts.bg) form.append('bg', JSON.stringify(opts.bg));
      if (opts.quality) form.append('quality', opts.quality);
      const res = await fetch('/api/crop', { method: 'POST', body: form, signal: opts.signal });
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
      return JSON.parse(raw) as { png: string; meta: CropMeta };
    },
    [dims]
  );

  /* ---------- Default mode: sequential batch with the visualizer ---------- */

  const runBatch = useCallback(
    async (useSpec: CropSpec, startIndex = 0, preserve = false) => {
      setPhase('processing');
      if (!preserve) setResults(() => []);
      setError(null);
      abortRef.current = false;
      const files = filesRef.current;
      const MIN_MS = 2700; // let the visualizer breathe per image
      let done = 0;

      for (let i = startIndex; i < files.length; i++) {
        if (abortRef.current) { resumeIndexRef.current = i; break; }
        const f = files[i];
        const id = idOf(i);
        setCurrent({ name: f.name, url: urlsRef.current.get(id) ?? '', meta: null, index: i });
        pushLog(`▸ ${f.name}: preparing image…`);
        const t0 = performance.now();
        try {
          const before = preparedRef.current.get(id);
          const { blob, url } = await ensurePrepared(i);
          if (!before && blob.size < f.size * 0.9) {
            pushLog(`  downscaled ${(f.size / 1e6).toFixed(1)}→${(blob.size / 1e6).toFixed(1)} MB for upload`);
          }
          if (abortRef.current) { resumeIndexRef.current = i; break; }
          setCurrent({ name: f.name, url, meta: null, index: i });

          const controller = new AbortController();
          controllerRef.current = controller;
          const { png, meta } = await cropOne(blob, f.name, { spec: useSpec, quality: 'full', signal: controller.signal });

          pushLog(`  masking subject → figure ${Math.round(meta.figure[2] - meta.figure[0])}×${Math.round(meta.figure[3] - meta.figure[1])}px`);
          setCurrent({ name: f.name, url, meta, index: i });
          if (useSpec.mode === 'face') pushLog(`  symmetry axis @ x=${Math.round(meta.centerFace[0])} (front face)`);
          if (useSpec.straighten && Math.abs(meta.angle) > 0.05) pushLog(`  auto-leveled ${meta.angle > 0 ? '+' : ''}${meta.angle}°`);
          pushLog(meta.lowConfidence ? '  ⚠ detection unsure — flagged for review' : '  normalizing scale, settling crop… ✓');
          const elapsed = performance.now() - t0;
          if (elapsed < MIN_MS) await sleep(MIN_MS - elapsed, controller.signal);
          setResults((prev) => [
            ...prev,
            { id, name: f.name.replace(/\.[^.]+$/, '') + '.png', pngDataUrl: `data:image/png;base64,${png}`, meta, flagged: meta.lowConfidence },
          ]);
          done++;
        } catch (e) {
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
        setPhase(preserve || done > 0 ? 'review' : 'setup');
      } else {
        resumeIndexRef.current = files.length;
        setPhase('review');
      }
    },
    [cropOne, ensurePrepared, setResults]
  );

  /* ---------- Instant mode: parallel pool, lighter detection ---------- */

  const runInstant = useCallback(
    async (useSpec: CropSpec) => {
      setPhase('processing');
      setResults(() => []);
      setError(null);
      setCompleted(0);
      const files = filesRef.current;
      resumeIndexRef.current = files.length; // no resume concept here
      let cursor = 0;
      const failed: string[] = [];

      const worker = async () => {
        for (;;) {
          const i = cursor++;
          if (i >= files.length) return;
          const f = files[i];
          const id = idOf(i);
          try {
            const { blob } = await ensurePrepared(i);
            let out: { png: string; meta: CropMeta };
            try {
              out = await cropOne(blob, f.name, { spec: useSpec, quality: 'fast' });
            } catch {
              out = await cropOne(blob, f.name, { spec: useSpec, quality: 'fast' }); // one retry
            }
            const item: ImageResult = {
              id,
              name: f.name.replace(/\.[^.]+$/, '') + '.png',
              pngDataUrl: `data:image/png;base64,${out.png}`,
              meta: out.meta,
              flagged: out.meta.lowConfidence,
            };
            setResults((prev) => [...prev, item].sort((a, b) => indexOf(a.id) - indexOf(b.id)));
          } catch (e) {
            failed.push(f.name);
          } finally {
            setCompleted((c) => c + 1);
          }
        }
      };

      await Promise.all(Array.from({ length: Math.min(INSTANT_POOL, files.length) }, worker));

      if (failed.length) setError(`${failed.length} failed and were skipped: ${failed.join(', ')} — rerun, or restart in Default mode to watch what happens.`);
      setPhase(resultsRef.current.length > 0 ? 'review' : 'setup');
    },
    [cropOne, ensurePrepared, setResults]
  );

  /* ---------- Manual mode: no batch pass, entries open instantly ---------- */

  // Synthesize meta for a lazy manual entry: prepared dims + border-median bg,
  // largest centered aspect-correct box. No server call.
  const ensureMeta = useCallback(
    (i: number): Promise<void> => {
      const id = idOf(i);
      const existing = resultsRef.current.find((r) => r.id === id);
      if (existing?.meta) return Promise.resolve();
      const inFlight = metaPromisesRef.current.get(id);
      if (inFlight) return inFlight;
      const p = (async () => {
        const { blob } = await ensurePrepared(i);
        const probe = await probeImage(blob);
        const aspect = dims.w / dims.h;
        const bw = Math.min(probe.width, probe.height * aspect);
        const bh = bw / aspect;
        const box = { left: (probe.width - bw) / 2, top: (probe.height - bh) / 2, width: bw, height: bh };
        const meta: CropMeta = {
          srcW: probe.width,
          srcH: probe.height,
          figure: [0, 0, probe.width, probe.height],
          centerFace: [probe.width / 2, probe.height / 2],
          centerFigure: [probe.width / 2, probe.height / 2],
          angle: 0,
          bg: probe.bg,
          lowConfidence: false,
          cropBox: box,
        };
        setResults((prev) => prev.map((r) => (r.id === id ? { ...r, meta } : r)));
      })().finally(() => metaPromisesRef.current.delete(id));
      metaPromisesRef.current.set(id, p);
      return p;
    },
    [dims, ensurePrepared, setResults]
  );

  const startManual = useCallback(async () => {
    const files = filesRef.current;
    resumeIndexRef.current = files.length;
    setResults(() =>
      files.map((f, i) => {
        const id = idOf(i);
        let raw = rawUrlsRef.current.get(id);
        if (!raw) {
          raw = URL.createObjectURL(f);
          rawUrlsRef.current.set(id, raw);
        }
        return {
          id,
          name: f.name.replace(/\.[^.]+$/, '') + '.png',
          pngDataUrl: '',
          meta: null,
          flagged: false,
          pending: true,
          originalThumbUrl: raw,
        };
      })
    );
    await ensureMeta(0);
    setEditIndex(0);
    setPhase('editing');
    void ensureMeta(1).catch(() => {}); // prefetch the next image in the background
  }, [ensureMeta, setResults]);

  /* ---------- Start / rerun ---------- */

  const onStart = useCallback(
    async (files: File[], w: number, h: number, instr: string, runMode: RunMode) => {
      setBusy(true);
      try {
        filesRef.current = files;
        urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
        rawUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
        urlsRef.current.clear();
        rawUrlsRef.current.clear();
        preparedRef.current.clear();
        metaPromisesRef.current.clear();
        draftsRef.current.clear();
        modeRef.current = runMode;
        setMode(runMode);
        setDims({ w, h });
        setInstruction(instr);
        setError(null);

        if (runMode === 'manual') {
          setSpec(null);
          await startManual();
          return;
        }

        setLog([`Parsing instruction: “${instr}”`]);
        const s = await parseSpec(instr);
        setSpec(s);
        pushLog(`Spec → mode=${s.mode}, anchor=(${s.anchorX.toFixed(2)}, ${s.anchorY.toFixed(2)}), subject=${Math.round(s.subjectFraction * 100)}% width`);
        if (runMode === 'instant') await runInstant(s);
        else await runBatch(s);
      } finally {
        setBusy(false);
      }
    },
    [parseSpec, runBatch, runInstant, startManual]
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
        if (modeRef.current === 'instant') await runInstant(s);
        else await runBatch(s);
      } finally {
        setBusy(false);
      }
    },
    [spec, instruction, parseSpec, runBatch, runInstant]
  );

  /* ---------- Editing (free navigation over all results) ---------- */

  const onEditAt = useCallback(
    async (i: number) => {
      setBusy(true);
      try {
        await ensureMeta(i);
        setEditIndex(i);
        setPhase('editing');
        if (i + 1 < filesRef.current.length) void ensureMeta(i + 1).catch(() => {});
      } catch (e) {
        setError(e instanceof Error ? e.message : 'could not open image');
      } finally {
        setBusy(false);
      }
    },
    [ensureMeta]
  );

  const onEditFlagged = useCallback(() => {
    const i = resultsRef.current.findIndex((r) => r.flagged);
    void onEditAt(i >= 0 ? i : 0);
  }, [onEditAt]);

  const onNavigate = useCallback(
    async (i: number) => {
      const clamped = Math.max(0, Math.min(filesRef.current.length - 1, i));
      setBusy(true);
      try {
        await ensureMeta(clamped);
        setEditIndex(clamped);
        if (clamped + 1 < filesRef.current.length) void ensureMeta(clamped + 1).catch(() => {});
      } catch (e) {
        setError(e instanceof Error ? e.message : 'could not open image');
      } finally {
        setBusy(false);
      }
    },
    [ensureMeta]
  );

  const onSaveEdit = useCallback(
    async (id: string, box: Draft['box'], angle: number) => {
      const idx = indexOf(id);
      const file = filesRef.current[idx];
      if (!file) return;
      setBusy(true);
      try {
        const { blob } = await ensurePrepared(idx);
        const item = resultsRef.current.find((r) => r.id === id);
        const { png, meta } = await cropOne(blob, file.name, {
          box,
          angle,
          bg: item?.meta?.bg,
          quality: 'full',
        });
        setResults((prev) =>
          prev.map((r) =>
            r.id === id ? { ...r, pngDataUrl: `data:image/png;base64,${png}`, meta, flagged: false, pending: false } : r
          )
        );
        draftsRef.current.delete(id);
        if (idx + 1 < filesRef.current.length) await onNavigate(idx + 1);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'edit failed');
      } finally {
        setBusy(false);
      }
    },
    [cropOne, ensurePrepared, onNavigate, setResults]
  );

  const onDoneEditing = useCallback(() => setPhase('review'), []);

  /* ---------- Download (renders any still-pending manual items first) ---------- */

  const onDownload = useCallback(async () => {
    setBusy(true);
    try {
      const pending = resultsRef.current.filter((r) => r.pending);
      for (let k = 0; k < pending.length; k++) {
        const id = pending[k].id;
        const idx = indexOf(id);
        setBusyNote(`Rendering ${k + 1} of ${pending.length} untouched images with the default centered crop…`);
        await ensureMeta(idx);
        const item = resultsRef.current.find((r) => r.id === id);
        if (!item?.meta) continue;
        const { blob } = await ensurePrepared(idx);
        const { png, meta } = await cropOne(blob, filesRef.current[idx].name, {
          box: item.meta.cropBox,
          angle: item.meta.angle,
          bg: item.meta.bg,
          quality: 'full',
        });
        setResults((prev) =>
          prev.map((r) => (r.id === id ? { ...r, pngDataUrl: `data:image/png;base64,${png}`, meta, pending: false } : r))
        );
      }
      setBusyNote(null);

      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      for (const r of resultsRef.current) {
        if (!r.pngDataUrl) continue;
        zip.file(r.name, r.pngDataUrl.split(',')[1], { base64: true });
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `crops_${dims.w}x${dims.h}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'download failed');
    } finally {
      setBusyNote(null);
      setBusy(false);
    }
  }, [cropOne, dims, ensureMeta, ensurePrepared, setResults]);

  /* ---------- Abort / resume / reset ---------- */

  const handleAbort = useCallback(() => {
    abortRef.current = true;
    controllerRef.current?.abort();
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
    setResults(() => []);
    setSpec(null);
    setLog([]);
    setError(null);
    draftsRef.current.clear();
    metaPromisesRef.current.clear();
  }, [setResults]);

  const editingItem = phase === 'editing' ? results[editIndex] : null;

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

      {phase === 'processing' && mode === 'instant' && (
        <div className="mx-auto max-w-md space-y-4 pt-10 text-center">
          <p className="text-lg">Cropping {INSTANT_POOL} at a time…</p>
          <div className="h-2 w-full overflow-hidden rounded-full bg-espresso/10">
            <div
              className="h-full rounded-full bg-plum transition-all duration-200"
              style={{ width: `${filesRef.current.length ? (completed / filesRef.current.length) * 100 : 0}%` }}
            />
          </div>
          <p className="text-sm text-espresso/60">
            {completed} / {filesRef.current.length} — you’ll review them next
          </p>
        </div>
      )}

      {phase === 'review' && (
        <Carousel
          results={results}
          mode={mode}
          onToggleFlag={(id) => setResults((prev) => prev.map((r) => (r.id === id ? { ...r, flagged: !r.flagged } : r)))}
          onFeedbackRerun={onFeedbackRerun}
          onEditAt={onEditAt}
          onEditFlagged={onEditFlagged}
          onDownload={onDownload}
          onStartOver={onStartOver}
          onResume={onResume}
          remaining={Math.max(0, filesRef.current.length - resumeIndexRef.current)}
          busy={busy}
          busyNote={busyNote}
        />
      )}

      {phase === 'editing' && editingItem && (
        <ManualEditor
          items={results}
          index={editIndex}
          originalUrl={urlsRef.current.get(editingItem.id) ?? ''}
          outW={dims.w}
          outH={dims.h}
          onNavigate={onNavigate}
          onSave={onSaveEdit}
          onDone={onDoneEditing}
          getDraft={(id) => draftsRef.current.get(id)}
          setDraft={(id, d) => draftsRef.current.set(id, d)}
          busy={busy}
        />
      )}
    </main>
  );
}
