'use client';

// Last-resort boundary (errors in the root layout itself).
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html>
      <body style={{ fontFamily: 'serif', background: '#FFFCF7', color: '#432222', display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, padding: 24, textAlign: 'center' }}>
        <h1>Something went wrong</h1>
        <p>Your work is autosaved in this browser — reload to restore your session.</p>
        <pre style={{ maxWidth: 600, overflow: 'auto', background: '#432222', color: '#FFFCF7', padding: 12, borderRadius: 8, fontSize: 12, textAlign: 'left' }}>
          {error?.message || 'Unknown error'}
        </pre>
        <button onClick={() => window.location.reload()} style={{ background: '#432222', color: '#FFFCF7', border: 0, borderRadius: 8, padding: '10px 20px', cursor: 'pointer' }}>
          Reload &amp; restore session
        </button>
      </body>
    </html>
  );
}
