// Minimal promise wrapper over IndexedDB (no idb/dexie: SPEC §14). One DB per
// name, object stores keyed by an in-line `key` path or out-of-line keys.

export interface StoreDef {
  name: string;
  keyPath?: string;
}

const dbs = new Map<string, Promise<IDBDatabase>>();

export function idbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

/** Open (and upgrade) a database; cached per name. */
export function openDb(
  name: string,
  version: number,
  stores: readonly StoreDef[],
): Promise<IDBDatabase> {
  const cached = dbs.get(name);
  if (cached) return cached;
  const p = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of stores) {
        if (!db.objectStoreNames.contains(s.name)) {
          db.createObjectStore(
            s.name,
            s.keyPath ? { keyPath: s.keyPath } : undefined,
          );
        }
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbs.delete(name);
      };
      resolve(db);
    };
    req.onerror = () => {
      dbs.delete(name);
      reject(req.error);
    };
    req.onblocked = () =>
      reject(new Error(`IndexedDB "${name}" upgrade blocked`));
  });
  dbs.set(name, p);
  return p;
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGet<T>(
  db: IDBDatabase,
  store: string,
  key: IDBValidKey,
): Promise<T | undefined> {
  return done(db.transaction(store).objectStore(store).get(key)) as Promise<
    T | undefined
  >;
}

export async function idbGetAll<T>(
  db: IDBDatabase,
  store: string,
): Promise<T[]> {
  return done(db.transaction(store).objectStore(store).getAll()) as Promise<
    T[]
  >;
}

export async function idbPut<T>(
  db: IDBDatabase,
  store: string,
  value: T,
  key?: IDBValidKey,
): Promise<void> {
  const tx = db.transaction(store, "readwrite");
  tx.objectStore(store).put(value, key);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function idbDelete(
  db: IDBDatabase,
  store: string,
  key: IDBValidKey,
): Promise<void> {
  const tx = db.transaction(store, "readwrite");
  tx.objectStore(store).delete(key);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbCount(
  db: IDBDatabase,
  store: string,
): Promise<number> {
  return done(db.transaction(store).objectStore(store).count());
}
