// Pure chart-series calculations. The caller supplies the bar subset and time-axis converter,
// so these helpers stay independent of the DOM and Plotly.
function subsetRollingRatio(sub, window) {
  const out = [];
  let sd = 0, sv = 0, next = 0, segmentStart = sub.sourceLo;
  const source = sub.source, lo = sub.sourceLo, hi = sub.sourceHi;
  const ends = sub.ends, width = Math.max(1, window), step = sub.step;

  for (let i = lo; i < hi; i++) {
    if (i > lo && source.t[i] - source.t[i - 1] > step * 1.5) {
      sd = 0;
      sv = 0;
      segmentStart = i;
    }
    sd += Number(source.d[i] || 0);
    sv += Number(source.v[i] || 0);
    const remove = i - width;
    if (remove >= segmentStart) {
      sd -= Number(source.d[remove] || 0);
      sv -= Number(source.v[remove] || 0);
    }

    if (sub.compressed) {
      if (next < ends.length && i === ends[next]) {
        out.push(sv ? sd / sv * 100 : 0);
        next++;
      }
    } else {
      out.push(sv ? sd / sv * 100 : 0);
    }
  }
  return out;
}

function lineArrays(sub, values, toTimestamp) {
  if (typeof toTimestamp !== 'function') {
    throw new TypeError('lineArrays requires a timestamp converter.');
  }
  const xs = [], ys = [], ids = sub.ids;
  for (let k = 0; k < ids.length; k++) {
    if (k > 0 && sub.breakBefore && sub.breakBefore[k]) {
      const ta = sub.x.t[ids[k - 1]], tb = sub.x.t[ids[k]];
      xs.push(toTimestamp(ta + (tb - ta) / 2));
      ys.push(null);
    }
    xs.push(toTimestamp(sub.x.t[ids[k]]));
    ys.push(values[k] === undefined ? null : values[k]);
  }
  return { x: xs, y: ys };
}

function emaForSubset(sub, period) {
  if (!Number.isFinite(period) || period <= 0) throw new RangeError('EMA period must be positive.');
  const source = sub.source;
  const lo = Math.max(0, sub.sourceLo - period * 5), hi = sub.sourceHi;
  const targets = new Set(sub.compressed ? sub.ends : sub.ids), out = [];
  const alpha = 2 / (period + 1);
  let prev = null;

  for (let i = lo; i < hi; i++) {
    if (i > lo && source.t[i] - source.t[i - 1] > sub.step * 1.5) prev = null;
    const value = Number(source.c[i]);
    if (!Number.isFinite(value)) continue;
    prev = prev === null ? value : value * alpha + prev * (1 - alpha);
    if (i >= sub.sourceLo && targets.has(i)) out.push(prev);
  }
  return out;
}

function tradeWeightedAverageForSubset(sub) {
  const source = sub.source, hi = sub.sourceHi;
  if (sub.sourceLo >= hi) return { values: [], exact: true };

  const firstDay = Math.floor(source.t[sub.sourceLo] / 86400);
  const scanLo = lowerBoundTime(source.t, firstDay * 86400);
  const targets = new Set(sub.compressed ? sub.ends : sub.ids);
  const out = [];
  let day = -1, pv = 0, vv = 0, exact = true;

  for (let i = scanLo; i < hi; i++) {
    const dayKey = Math.floor(source.t[i] / 86400);
    if (dayKey !== day) {
      day = dayKey;
      pv = 0;
      vv = 0;
    }
    const volume = Number(source.v[i] || 0);
    const rawPriceVolume = source.pv && source.pv.length === source.t.length ? source.pv[i] : null;
    if (rawPriceVolume !== null && rawPriceVolume !== undefined && Number.isFinite(Number(rawPriceVolume))) {
      pv += Number(rawPriceVolume);
    } else {
      const typicalPrice = (Number(source.h[i]) + Number(source.l[i]) + Number(source.c[i])) / 3;
      pv += typicalPrice * volume;
      if (volume > 0) exact = false;
    }
    vv += volume;
    if (i >= sub.sourceLo && targets.has(i)) out.push(vv ? pv / vv : null);
  }
  return { values: out, exact };
}

function rollingRatio(delta, volume, window, times, step) {
  const out = new Array(delta.length);
  let sumDelta = 0, sumVolume = 0, segmentStart = 0;
  const width = Math.max(1, Number(window) || 1);
  for (let i = 0; i < delta.length; i++) {
    if (i > 0 && times && times[i] - times[i - 1] > step * 1.5) {
      sumDelta = 0;
      sumVolume = 0;
      segmentStart = i;
    }
    sumDelta += Number(delta[i] || 0);
    sumVolume += Number(volume[i] || 0);
    const remove = i - width;
    if (remove >= segmentStart) {
      sumDelta -= Number(delta[remove] || 0);
      sumVolume -= Number(volume[remove] || 0);
    }
    out[i] = sumVolume ? sumDelta / sumVolume * 100 : 0;
  }
  return out;
}

function lowerBoundTime(times, target) {
  let lo = 0, hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function createChartSeriesMath({ toTimestamp } = {}) {
  if (typeof toTimestamp !== 'function') {
    throw new TypeError('createChartSeriesMath requires a toTimestamp function.');
  }
  return {
    subsetRollingRatio,
    lineArrays: (subset, values) => lineArrays(subset, values, toTimestamp),
    emaForSubset,
    tradeWeightedAverageForSubset,
    rollingRatio
  };
}
