// Minimal IndexedDB wrapper for READZO. No external dependencies.
// Stores translation progress and generated audio keyed by document content hash,
// so work survives tab close and reopening the same PDF resumes where it left off.

const DB_NAME = 'readzo';
const DB_VERSION = 1;

export type PageStatus = 'pending' | 'done' | 'error';

export interface DocMeta {
  docHash: string;
  fileName: string;
  numPages: number;
  createdAt: number;
  updatedAt: number;
}

export interface PageRecord {
  docHash: string;
  pageNo: number;
  style: string;
  status: PageStatus;
  original: string;
  translated: string;
  updatedAt: number;
}

export interface AudioRecord {
  docHash: string;
  pageNo: number;
  voice: string;
  blob: Blob;
  updatedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('documents')) {
        db.createObjectStore('documents', { keyPath: 'docHash' });
      }
      if (!db.objectStoreNames.contains('pages')) {
        db.createObjectStore('pages', { keyPath: ['docHash', 'pageNo', 'style'] });
      }
      if (!db.objectStoreNames.contains('audio')) {
        db.createObjectStore('audio', { keyPath: ['docHash', 'pageNo', 'voice'] });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function request<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      }),
  );
}

// ── pages ──────────────────────────────────────────────────────────────────
export const getPage = (docHash: string, pageNo: number, style: string) =>
  request<PageRecord | undefined>('pages', 'readonly', (s) => s.get([docHash, pageNo, style]));

export const putPage = (rec: PageRecord) =>
  request<IDBValidKey>('pages', 'readwrite', (s) => s.put(rec));

export function getDocPages(docHash: string, style: string): Promise<PageRecord[]> {
  return request<PageRecord[]>('pages', 'readonly', (s) => s.getAll()).then((all) =>
    all
      .filter((p) => p.docHash === docHash && p.style === style)
      .sort((a, b) => a.pageNo - b.pageNo),
  );
}

// ── audio ──────────────────────────────────────────────────────────────────
export const getAudio = (docHash: string, pageNo: number, voice: string) =>
  request<AudioRecord | undefined>('audio', 'readonly', (s) => s.get([docHash, pageNo, voice]));

export const putAudio = (rec: AudioRecord) =>
  request<IDBValidKey>('audio', 'readwrite', (s) => s.put(rec));

// ── documents ──────────────────────────────────────────────────────────────
export const putDocMeta = (m: DocMeta) =>
  request<IDBValidKey>('documents', 'readwrite', (s) => s.put(m));

export const getDocMeta = (docHash: string) =>
  request<DocMeta | undefined>('documents', 'readonly', (s) => s.get(docHash));

export const listDocuments = () =>
  request<DocMeta[]>('documents', 'readonly', (s) => s.getAll()).then((d) =>
    d.sort((a, b) => b.updatedAt - a.updatedAt),
  );

export function deleteDocument(docHash: string): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['documents', 'pages', 'audio'], 'readwrite');
        tx.objectStore('documents').delete(docHash);
        for (const storeName of ['pages', 'audio'] as const) {
          const cursorReq = tx.objectStore(storeName).openCursor();
          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (cursor) {
              if ((cursor.value as { docHash: string }).docHash === docHash) cursor.delete();
              cursor.continue();
            }
          };
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

export async function touchDocMeta(docHash: string): Promise<void> {
  const meta = await getDocMeta(docHash);
  if (meta) await putDocMeta({ ...meta, updatedAt: Date.now() });
}
