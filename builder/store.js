// Projects saved in the browser (IndexedDB), so a refresh or a closed tab loses nothing.
const DB = 'flippy-builder', STORE = 'projects';

function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx(mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode), s = t.objectStore(STORE);
    const out = fn(s);
    t.oncomplete = () => { db.close(); res(out && 'result' in out ? out.result : undefined); };
    t.onerror = t.onabort = () => { db.close(); rej(t.error); };
  });
}

export const save = p => tx('readwrite', s => s.put({ ...p, updated: Date.now() }));
export const load = id => tx('readonly', s => s.get(id));
export const remove = id => tx('readwrite', s => s.delete(id));
export async function list() {
  const all = (await tx('readonly', s => s.getAll())) || [];
  return all.map(p => ({ id: p.id, title: p.title, pageCount: p.pages.length, updated: p.updated, thumb: p.images.thumbs[0] }))
    .sort((a, b) => b.updated - a.updated);
}
