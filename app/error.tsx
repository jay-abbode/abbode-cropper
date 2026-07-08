'use client';

// Route-level error boundary: a client exception lands here instead of the
// white "Application error" screen. Work is autosaved to the browser
// continuously, so reloading restores the session.

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-3xl">Something went wrong</h1>
      <p className="max-w-lg text-espresso/70">
        Don&apos;t worry — your crops and edits are autosaved in this browser. Reload and you&apos;ll get a
        <strong> Resume previous session</strong> option to pick up exactly where you left off.
      </p>
      <pre className="max-w-xl overflow-auto rounded-lg bg-espresso p-3 text-left text-xs text-porcelain/90">
        {error?.message || 'Unknown error'}{error?.digest ? `\ndigest: ${error.digest}` : ''}
      </pre>
      <p className="text-xs text-espresso/50">If this happens again, screenshot the box above — it says exactly what broke.</p>
      <div className="flex gap-3">
        <button onClick={() => reset()} className="rounded-lg border border-plum px-5 py-2 text-plum hover:bg-blush/30">
          Try to continue
        </button>
        <button onClick={() => window.location.reload()} className="rounded-lg bg-espresso px-5 py-2 text-porcelain hover:bg-plum">
          Reload &amp; restore session
        </button>
      </div>
    </main>
  );
}
