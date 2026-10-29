import { createLeadLagCalculator } from './lead-lag.js';

const calculator = createLeadLagCalculator();
let dataRevision = 0;

self.addEventListener('message', event => {
  const message = event.data || {};
  try {
    if (message.type === 'set-data') {
      const length = calculator.setData(message.bars);
      dataRevision = message.revision;
      self.postMessage({ type: 'ready', revision: dataRevision, length });
      return;
    }

    if (message.type !== 'compute') return;
    if (message.revision !== dataRevision) throw new Error('Lead/lag worker data revision is out of date.');
    const result = calculator.compute({
      start: message.start,
      end: message.end,
      lookback: message.lookback
    });
    self.postMessage({ id: message.id, revision: dataRevision, result });
  } catch (error) {
    self.postMessage({
      id: message.id,
      revision: message.revision,
      error: error && error.message ? error.message : String(error)
    });
  }
});
