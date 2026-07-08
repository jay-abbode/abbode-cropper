// Session autosave in IndexedDB. Everything is best-effort: a storage failure
// must never take the app down, so every call swallows errors after a warn.
// Three stores: 'kv' (state doc + drafts), 'pngs' (id -> rendered data URL),
// 'blobs' (id -> prepared image Blob, so a restored session can keep editing
// and rendering without re-uploading the folder).

import type { CropMeta, CropSpec, RunMode } from './types';

export interface SavedResult {
  id: string;
  name: string;
  meta: CropMeta | null;
  flagged: boolean;
  pending?: boolean;
}

export interface SavedSession {
  version: 1;
  savedAt: number;
  mode: RunMode;
  dims: { w: number; h: number };
  instruction: string;
  spec: CropSpec | null;
  results: SavedResult[];
  drafts: [string, { box: { left: number; top: number; width: number; height: number }; angle: number }][];
  editIndex: number;
  phase: 'review' | 'editing';
}

const DB_NAME = 'abbode-cropper-session';
const DB_VER = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of ['kv', 'pngs', 'blobs']) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  try {
    const db = await openDb();
    return await new Promise<T | null>((resolve) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => resolve(null);
      t.onabort = () => resolve(null);
    });
  } catch (e) {
    console.warn('session storage unavailable:', e);
    return null;
  }
}

export const saveState = (s: SavedSession) => tx('kv', 'readwrite', (st) => st.put(s, 'state'));
export const loadState = () => tx<SavedSession>('kv', 'readonly', (st) => st.get('state'));
export const savePng = (id: string, dataUrl: string) => tx('pngs', 'readwrite', (st) => st.put(dataUrl, id));
export const saveBlob = (id: string, blob: Blob) => tx('blobs', 'readwrite', (st) => st.put(blob, id));
export const loadPng = (id: string) => tx<string>('pngs', 'readonly', (st) => st.get(id));
export const loadBlob = (id: string) => tx<Blob>('blobs', 'readonly', (st) => st.get(id));

export async function loadAll<T>(store: 'pngs' | 'blobs'): Promise<Map<string, T>> {
  const out = new Map<string, T>();
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const t = db.transaction(store, 'readonly');
      const cur = t.objectStore(store).openCursor();
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c) return resolve();
        out.set(String(c.key), c.value as T);
        c.continue();
      };
      cur.onerror = () => resolve();
    });
  } catch (e) {
    console.warn('session storage unavailable:', e);
  }
  return out;
}

export async function clearSession(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const t = db.transaction(['kv', 'pngs', 'blobs'], 'readwrite');
      t.objectStore('kv').clear();
      t.objectStore('pngs').clear();
      t.objectStore('blobs').clear();
      t.oncomplete = () => resolve();
      t.onerror = () => resolve();
      t.onabort = () => resolve();
    });
  } catch { /* nothing to clear */ }
}
