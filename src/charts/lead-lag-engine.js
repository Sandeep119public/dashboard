// Worker-backed lead/lag engine with a deterministic main-thread fallback.
// Series arrays are sent once per data revision; range and lookback changes send only small messages.
// Small windows run on the main thread because the worker round-trip costs more than the
// calculation, while long windows stay off the main thread. A worker that errors, fails to
// load or stops responding is terminated and its pending work falls back safely.
import { createLeadLagCalculator } from './lead-lag.js';

function defaultWorkerFactory() {
  if (typeof Worker !== 'function') return null;
  return new Worker(new URL('./lead-lag.worker.js', import.meta.url), { type: 'module' });
}

function barPayload(bars) {
  if (!bars || !bars.t || !bars.c || !bars.d || !bars.v) {
    throw new TypeError('Lead/lag engine needs t, c, d, and v arrays.');
  }
  return { t: bars.t, c: bars.c, d: bars.d, v: bars.v };
}

function lowerBound(times, target) {
  let lo = 0, hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperBound(times, target) {
  let lo = 0, hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function createLeadLagEngine({
  workerFactory = defaultWorkerFactory,
  timeoutMs = 5000,
  maxMainThreadBars = 4000,
  maxWorkerFailures = 3
} = {}) {
  let worker = null;
  let revision = 0;
  let nextId = 0;
  let currentCalculator = null;
  let currentBars = null;
  let consecutiveFailures = 0;
  let lastMode = 'main';
  let disposed = false;
  const pending = new Map();

  function fallback(record) {
    lastMode = 'fallback';
    try {
      record.resolve(record.calculator.compute(record.options));
    } catch (error) {
      record.reject(error);
    }
  }

  function clearRecord(id, record) {
    if (record && record.timer !== null) {
      clearTimeout(record.timer);
      record.timer = null;
    }
    pending.delete(id);
  }

  function disableWorker(reason) {
    const failed = worker;
    worker = null;
    if (failed) {
      try {
        failed.onmessage = null;
        failed.onerror = null;
        failed.onmessageerror = null;
        failed.terminate?.();
      } catch (_) {}
    }
    if (reason === 'failure') consecutiveFailures++;
    const records = [...pending.values()];
    pending.clear();
    // Resolve after the current event handler so a failed worker cannot block the UI thread.
    for (const record of records) {
      if (record.timer !== null) { clearTimeout(record.timer); record.timer = null; }
      queueMicrotask(() => fallback(record));
    }
  }

  function onMessage(event) {
    const message = event && event.data ? event.data : {};
    if (message.type === 'ready') {
      consecutiveFailures = 0;
      return;
    }
    const record = pending.get(message.id);
    if (!record) return;
    clearRecord(message.id, record);

    if (message.error || message.revision !== record.revision || !message.result) {
      fallback(record);
      return;
    }
    consecutiveFailures = 0;
    lastMode = 'worker';
    record.resolve(message.result);
  }

  function onWorkerFailure() {
    disableWorker('failure');
  }

  function createWorker() {
    if (worker || disposed || !workerFactory) return worker;
    if (consecutiveFailures >= maxWorkerFailures) return null;
    try {
      const created = workerFactory();
      if (!created) return null;
      created.onmessage = onMessage;
      created.onerror = onWorkerFailure;
      created.onmessageerror = onWorkerFailure;
      worker = created;
    } catch (_) {
      consecutiveFailures++;
      worker = null;
    }
    return worker;
  }

  function sendData() {
    if (!worker || !currentBars) return;
    try {
      worker.postMessage({ type: 'set-data', revision, bars: currentBars });
    } catch (_) {
      disableWorker('failure');
    }
  }

  function setData(bars) {
    const cleanBars = barPayload(bars);
    const calculator = createLeadLagCalculator();
    calculator.setData(cleanBars);
    currentBars = cleanBars;
    currentCalculator = calculator;
    revision++;

    if (worker) sendData();
    else if (createWorker()) sendData();
    return revision;
  }

  function countBars(options) {
    if (!currentBars || !currentBars.t.length) return 0;
    const times = currentBars.t;
    const start = Number.isFinite(options.start) ? options.start : -Infinity;
    const end = Number.isFinite(options.end) ? options.end : Infinity;
    return Math.max(0, upperBound(times, end) - lowerBound(times, start));
  }

  function compute(options = {}) {
    if (!currentBars || !currentCalculator) {
      return Promise.reject(new Error('Lead/lag data has not been loaded.'));
    }
    const record = {
      calculator: currentCalculator,
      options,
      revision,
      resolve: null,
      reject: null,
      timer: null
    };

    // Short windows: the worker round-trip dominates, so keep the result local.
    if (!worker || countBars(options) <= maxMainThreadBars) {
      lastMode = worker ? 'main' : 'fallback';
      return Promise.resolve().then(() => record.calculator.compute(record.options));
    }

    const id = ++nextId;
    return new Promise((resolve, reject) => {
      record.resolve = resolve;
      record.reject = reject;
      pending.set(id, record);
      try {
        worker.postMessage({ type: 'compute', id, revision: record.revision, ...options });
      } catch (_) {
        pending.delete(id);
        disableWorker('failure');
        fallback(record);
        return;
      }
      record.timer = setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        record.timer = null;
        disableWorker('failure');
        fallback(record);
      }, timeoutMs);
    });
  }

  function dispose() {
    disposed = true;
    disableWorker('dispose');
    currentBars = null;
    currentCalculator = null;
  }

  return {
    setData,
    compute,
    dispose,
    get workerActive() { return Boolean(worker); },
    get lastMode() { return lastMode; },
    get revision() { return revision; }
  };
}
