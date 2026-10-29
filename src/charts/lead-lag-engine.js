// Worker-backed lead/lag engine with a deterministic main-thread fallback.
// Series arrays are sent once per data revision; range and lookback changes send only small messages.
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

export function createLeadLagEngine({ workerFactory = defaultWorkerFactory } = {}) {
  let worker = null;
  let revision = 0;
  let nextId = 0;
  let currentCalculator = null;
  let currentBars = null;
  const pending = new Map();

  function fallback(record) {
    try {
      record.resolve(record.calculator.compute(record.options));
    } catch (error) {
      record.reject(error);
    }
  }

  function disableWorker() {
    const failed = worker;
    worker = null;
    try { failed?.terminate?.(); } catch (_) {}
    for (const [id, record] of pending) {
      pending.delete(id);
      fallback(record);
    }
  }

  function onMessage(event) {
    const message = event && event.data ? event.data : {};
    if (message.type === 'ready') return;
    const record = pending.get(message.id);
    if (!record) return;
    pending.delete(message.id);

    if (message.error || message.revision !== record.revision || !message.result) {
      fallback(record);
      return;
    }
    record.resolve(message.result);
  }

  try {
    worker = workerFactory ? workerFactory() : null;
    if (worker) {
      worker.onmessage = onMessage;
      worker.onerror = disableWorker;
      worker.onmessageerror = disableWorker;
    }
  } catch (_) {
    worker = null;
  }

  function setData(bars) {
    const cleanBars = barPayload(bars);
    const calculator = createLeadLagCalculator();
    calculator.setData(cleanBars);
    currentBars = cleanBars;
    currentCalculator = calculator;
    revision++;

    if (worker) {
      try {
        worker.postMessage({ type: 'set-data', revision, bars: cleanBars });
      } catch (_) {
        disableWorker();
      }
    }
    return revision;
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
      reject: null
    };
    if (!worker) {
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
        disableWorker();
        fallback(record);
      }
    });
  }

  function dispose() {
    disableWorker();
    currentBars = null;
    currentCalculator = null;
  }

  return {
    setData,
    compute,
    dispose,
    get workerActive() { return Boolean(worker); },
    get revision() { return revision; }
  };
}
