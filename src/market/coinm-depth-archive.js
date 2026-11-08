const DB_NAME = 'btc-usd-market-mechanics';
const STORE_NAME = 'depth-snapshots';
const DEFAULT_LIMIT = 50000;

function cloneSample(sample) {
  return {
    ...sample,
    bids: (sample.bids || []).map(level => ({ price: Number(level.price), qty: Number(level.qty) })),
    asks: (sample.asks || []).map(level => ({ price: Number(level.price), qty: Number(level.qty) })),
    changes: sample.changes && typeof sample.changes === 'object' ? {
      ...sample.changes,
      bidChanges: { ...(sample.changes.bidChanges || {}) },
      askChanges: { ...(sample.changes.askChanges || {}) }
    } : {}
  };
}

export function createDepthArchiveStore(options = {}) {
  const indexedDBImpl = options.indexedDBImpl === undefined
    ? (typeof indexedDB !== 'undefined' ? indexedDB : null)
    : options.indexedDBImpl;
  const maxSamples = Math.max(1, Math.floor(Number(options.maxSamples) || DEFAULT_LIMIT));
  const dbName = String(options.dbName || DB_NAME);
  const memory = new Map();
  let dbPromise = null;

  function keyFor(sample) {
    return String(sample.symbol || 'BTCUSD_PERP') + ':' + Number(sample.segment || 0) + ':' +
      Number(sample.time) + ':' + Number(sample.lastUpdateId);
  }
  function open() {
    if (!indexedDBImpl) return Promise.resolve(null);
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDBImpl.open(dbName, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          const store = database.createObjectStore(STORE_NAME, { keyPath: 'key' });
          store.createIndex('time', 'time', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open local depth archive.'));
      request.onblocked = () => reject(new Error('Local depth archive is blocked by another tab.'));
    });
    return dbPromise;
  }
  async function append(samples, symbol = 'BTCUSD_PERP') {
    if (!Array.isArray(samples) || !samples.length) return { saved: 0, total: memory.size };
    const rows = samples.map(sample => {
      const copy = cloneSample(sample);
      copy.symbol = symbol;
      copy.key = keyFor(copy);
      return copy;
    });
    const database = await open();
    if (!database) {
      for (const row of rows) memory.set(row.key, row);
      const ordered = Array.from(memory.values()).sort((a, b) => a.time - b.time);
      while (ordered.length > maxSamples) memory.delete(ordered.shift().key);
      return { saved: rows.length, total: memory.size, persistent: false };
    }
    await new Promise((resolve, reject) => {
      const tx = database.transaction(STORE_NAME, 'readwrite');
      const objectStore = tx.objectStore(STORE_NAME);
      for (const row of rows) objectStore.put(row);
      const all = objectStore.getAll();
      all.onsuccess = () => {
        const ordered = all.result.sort((a, b) => a.time - b.time);
        for (const stale of ordered.slice(0, Math.max(0, ordered.length - maxSamples))) objectStore.delete(stale.key);
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('Could not save local depth archive.'));
      tx.onabort = () => reject(tx.error || new Error('Local depth archive write was aborted.'));
    });
    return { saved: rows.length, total: Math.min(maxSamples, rows.length), persistent: true };
  }
  async function load(options = {}) {
    const symbol = String(options.symbol || 'BTCUSD_PERP');
    const limit = Math.max(1, Math.min(maxSamples, Math.floor(Number(options.limit) || maxSamples)));
    const database = await open();
    let rows;
    if (!database) rows = Array.from(memory.values());
    else rows = await new Promise((resolve, reject) => {
      const tx = database.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error || new Error('Could not read local depth archive.'));
    });
    return rows.filter(row => row.symbol === symbol).sort((a, b) => a.time - b.time).slice(-limit).map(cloneSample);
  }
  async function clear(options = {}) {
    const symbol = options.symbol ? String(options.symbol) : null;
    const database = await open();
    if (!database) {
      if (!symbol) memory.clear();
      else for (const [key, row] of memory) if (row.symbol === symbol) memory.delete(key);
      return;
    }
    if (!symbol) {
      await new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).clear();
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('Could not clear local depth archive.'));
      });
      return;
    }
    const rows = await load({ symbol, limit: maxSamples });
    const tx = database.transaction(STORE_NAME, 'readwrite');
    const objectStore = tx.objectStore(STORE_NAME);
    for (const row of rows) objectStore.delete(row.key);
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('Could not clear local depth archive.'));
    });
  }
  return { append, load, clear, persistent: Boolean(indexedDBImpl), maxSamples };
}
