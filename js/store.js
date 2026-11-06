// Storage: IndexedDB with an in-memory fallback when the browser blocks it.
const DB_NAME = 'margin';
const DB_VERSION = 1;
const KEEP_VERSIONS = 20;

let dbPromise = null;
export let persistent = true;

const mem = { notes: new Map(), handles: new Map(), versions: new Map(), seq: 1 };

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in self)) { reject(new Error('IndexedDB unavailable')); return; }
      let req;
      try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { reject(e); return; }
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('notes')) d.createObjectStore('notes', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('handles')) d.createObjectStore('handles');
        if (!d.objectStoreNames.contains('versions')) {
          const v = d.createObjectStore('versions', { keyPath: 'vid', autoIncrement: true });
          v.createIndex('noteId', 'noteId');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Storage is blocked by another tab'));
    }).catch((err) => { persistent = false; throw err; });
  }
  return dbPromise;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}
function result(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function init() {
  try { await open(); persistent = true; } catch { persistent = false; }
  return persistent;
}

export async function allNotes() {
  if (!persistent) return [...mem.notes.values()].map((n) => ({ ...n }));
  const d = await open();
  return result(d.transaction('notes').objectStore('notes').getAll());
}

export async function putNote(note) {
  const copy = { ...note };
  if (!persistent) { mem.notes.set(copy.id, copy); return; }
  const d = await open();
  const tx = d.transaction('notes', 'readwrite');
  tx.objectStore('notes').put(copy);
  return done(tx);
}

export async function deleteNote(id) {
  if (!persistent) {
    mem.notes.delete(id); mem.handles.delete(id);
    for (const [k, v] of mem.versions) if (v.noteId === id) mem.versions.delete(k);
    return;
  }
  const d = await open();
  const tx = d.transaction(['notes', 'handles', 'versions'], 'readwrite');
  tx.objectStore('notes').delete(id);
  tx.objectStore('handles').delete(id);
  const cur = tx.objectStore('versions').index('noteId').openCursor(IDBKeyRange.only(id));
  cur.onsuccess = () => { const c = cur.result; if (c) { c.delete(); c.continue(); } };
  return done(tx);
}

// File handles (Chromium only). Structured-clone into IndexedDB so "Save to file" survives a restart.
export async function getHandle(id) {
  if (!persistent) return mem.handles.get(id) || null;
  try {
    const d = await open();
    return (await result(d.transaction('handles').objectStore('handles').get(id))) || null;
  } catch { return null; }
}
export async function setHandle(id, handle) {
  if (!persistent) { mem.handles.set(id, handle); return; }
  try {
    const d = await open();
    const tx = d.transaction('handles', 'readwrite');
    tx.objectStore('handles').put(handle, id);
    await done(tx);
  } catch { mem.handles.set(id, handle); }
}
export async function allHandles() {
  const out = new Map();
  if (!persistent) return new Map(mem.handles);
  try {
    const d = await open();
    const tx = d.transaction('handles');
    const store = tx.objectStore('handles');
    const [keys, vals] = await Promise.all([result(store.getAllKeys()), result(store.getAll())]);
    keys.forEach((k, i) => out.set(k, vals[i]));
  } catch { /* ignore */ }
  return out;
}

// Versions: last KEEP_VERSIONS snapshots per note.
export async function addVersion(v) {
  const rec = { noteId: v.noteId, name: v.name, content: v.content, at: v.at || Date.now(), reason: v.reason || 'Autosave' };
  if (!persistent) {
    mem.versions.set(mem.seq++, { ...rec, vid: mem.seq });
  } else {
    const d = await open();
    const tx = d.transaction('versions', 'readwrite');
    tx.objectStore('versions').add(rec);
    await done(tx);
  }
  await prune(v.noteId);
}

export async function listVersions(noteId) {
  let list;
  if (!persistent) list = [...mem.versions.values()].filter((v) => v.noteId === noteId);
  else {
    const d = await open();
    list = await result(d.transaction('versions').objectStore('versions').index('noteId').getAll(IDBKeyRange.only(noteId)));
  }
  return list.sort((a, b) => b.at - a.at);
}

async function prune(noteId) {
  const list = await listVersions(noteId);
  const extra = list.slice(KEEP_VERSIONS);
  if (!extra.length) return;
  if (!persistent) { for (const v of extra) for (const [k, m] of mem.versions) if (m === v) mem.versions.delete(k); return; }
  const d = await open();
  const tx = d.transaction('versions', 'readwrite');
  for (const v of extra) tx.objectStore('versions').delete(v.vid);
  await done(tx);
}

export async function restoreVersions(list) {
  if (!list || !list.length) return;
  if (!persistent) { for (const v of list) mem.versions.set(mem.seq++, { ...v }); return; }
  const d = await open();
  const tx = d.transaction('versions', 'readwrite');
  for (const v of list) tx.objectStore('versions').put(v);
  await done(tx);
}
