// Lead/lag statistics for the one-minute signed-flow series.
// State is kept inside the calculator so prefix sums are built once per data refresh,
// not once per chart-range change. Safe to use in the main thread or a dedicated worker.
import { pearson } from './series-math.js';

const DEFAULT_HORIZONS = [
  { label: 'Same bar', minutes: 0 },
  { label: '+1m', minutes: 1 },
  { label: '+5m', minutes: 5 },
  { label: '+15m', minutes: 15 },
  { label: '+30m', minutes: 30 },
  { label: '+60m', minutes: 60 }
];

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

function pickBars(bars) {
  if (!bars || !bars.t || !bars.c || !bars.d || !bars.v) {
    throw new TypeError('Lead/lag calculations need t, c, d, and v bar arrays.');
  }
  const length = bars.t.length;
  for (const field of ['c', 'd', 'v']) {
    if (bars[field].length !== length) throw new RangeError('Lead/lag field lengths do not match.');
  }
  return { t: bars.t, c: bars.c, d: bars.d, v: bars.v };
}

export function createLeadLagCalculator() {
  let bars = null;
  let prefixDelta = new Float64Array(0);
  let prefixVolume = new Float64Array(0);

  function setData(nextBars) {
    bars = pickBars(nextBars);
    prefixDelta = new Float64Array(bars.t.length + 1);
    prefixVolume = new Float64Array(bars.t.length + 1);
    for (let i = 0; i < bars.t.length; i++) {
      prefixDelta[i + 1] = prefixDelta[i] + Number(bars.d[i] || 0);
      prefixVolume[i + 1] = prefixVolume[i] + Number(bars.v[i] || 0);
    }
    return bars.t.length;
  }

  function compute({ start = -Infinity, end = Infinity, lookback = 5 } = {}) {
    if (!bars) throw new Error('Lead/lag data has not been loaded.');
    if (!Number.isFinite(lookback) || lookback < 1 || !Number.isInteger(lookback)) {
      throw new RangeError('Lead/lag lookback must be a positive integer.');
    }
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
      throw new RangeError('Lead/lag window bounds are invalid.');
    }

    const times = bars.t, closes = bars.c;
    const flows = DEFAULT_HORIZONS.map(() => []);
    const returns = DEFAULT_HORIZONS.map(() => []);
    const rangeLo = lowerBound(times, start), rangeHi = upperBound(times, end);
    const lookbackSeconds = Math.max(0, lookback - 1) * 60;

    for (let i = rangeLo; i < rangeHi; i++) {
      if (!Number.isFinite(closes[i])) continue;
      const begin = lowerBound(times, times[i] - lookbackSeconds);
      if (i - begin + 1 !== lookback || times[i] - times[begin] !== lookbackSeconds) continue;

      const volume = prefixVolume[i + 1] - prefixVolume[begin];
      if (!volume) continue;
      const flow = (prefixDelta[i + 1] - prefixDelta[begin]) / volume * 100;

      if (i > 0 && times[i] - times[i - 1] === 60 && closes[i - 1]) {
        flows[0].push(flow);
        returns[0].push((closes[i] / closes[i - 1] - 1) * 100);
      }

      for (let h = 1; h < DEFAULT_HORIZONS.length; h++) {
        const target = times[i] + DEFAULT_HORIZONS[h].minutes * 60;
        const j = lowerBound(times, target);
        if (j >= times.length || times[j] > end || !Number.isFinite(closes[j]) || !closes[i] || times[j] !== target) continue;
        flows[h].push(flow);
        returns[h].push((closes[j] / closes[i] - 1) * 100);
      }
    }

    const counts = flows.map(values => values.length);
    return {
      horizons: DEFAULT_HORIZONS.map(horizon => horizon.label),
      correlations: flows.map((values, i) => pearson(values, returns[i])),
      counts,
      forwardSamples: counts.slice(1).reduce((sum, count) => sum + count, 0)
    };
  }

  return {
    setData,
    compute,
    get length() { return bars ? bars.t.length : 0; }
  };
}

export function computeLeadLag(bars, options) {
  const calculator = createLeadLagCalculator();
  calculator.setData(bars);
  return calculator.compute(options);
}
