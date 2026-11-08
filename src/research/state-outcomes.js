/**
 * Retrospective forward-return summaries conditioned on past-only state labels.
 * These are outcome measurements, not live features or predictive signals.
 * Samples are intentionally overlapping hourly observations.
 */
function median(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a,b)=>a-b), middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle-1] + sorted[middle]) / 2;
}
export function summarizeStateOutcomes(bars, stateResult, options = {}) {
  const length = Array.isArray(bars?.t) ? bars.t.length : -1;
  const keys = ['o','h','l','c'];
  if (length < 0 || keys.some(key => !Array.isArray(bars[key]) || bars[key].length !== length)) {
    throw new TypeError('Outcome analysis requires equal-length t, o, h, l and c arrays.');
  }
  if (!stateResult || !Array.isArray(stateResult.values) || stateResult.values.length !== length || !Array.isArray(stateResult.labels)) {
    throw new TypeError('State labels must align with the supplied bars.');
  }
  const intervalSeconds = options.intervalSeconds === undefined ? 3600 : Number(options.intervalSeconds);
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) throw new RangeError('intervalSeconds must be positive.');
  const horizons = (options.horizons || [1,4,24]).map(Number);
  if (!horizons.length || horizons.some(h => !Number.isInteger(h) || h < 1)) throw new RangeError('Horizons must be positive whole-bar counts.');
  const startTime = options.startTime === undefined ? -Infinity : Number(options.startTime);
  const endTime = options.endTime === undefined ? Infinity : Number(options.endTime);
  if (Number.isNaN(startTime) || Number.isNaN(endTime) || endTime < startTime) throw new RangeError('Outcome time window is invalid.');
  const buckets = stateResult.labels.map((label, code) => ({ code, label, horizons: horizons.map(barsAhead => ({ barsAhead, returns: [] })) }));
  const byCode = new Map(buckets.map(bucket => [bucket.code, bucket]));
  for (let i = 0; i < length; i++) {
    const timestamp = Number(bars.t[i]), close = Number(bars.c[i]), state = stateResult.values[i];
    if (timestamp < startTime || timestamp > endTime || !state || state.code <= 0 || !byCode.has(state.code) || !Number.isFinite(close) || close <= 0) continue;
    const bucket = byCode.get(state.code);
    for (let k = 0; k < horizons.length; k++) {
      const ahead = horizons[k], target = i + ahead;
      if (target >= length) continue;
      let contiguous = true;
      for (let j = i + 1; j <= target; j++) {
        if (Number(bars.t[j]) - Number(bars.t[j-1]) !== intervalSeconds) { contiguous = false; break; }
      }
      if (!contiguous) continue;
      const futureClose = Number(bars.c[target]);
      if (!Number.isFinite(futureClose) || futureClose <= 0) continue;
      bucket.horizons[k].returns.push((futureClose / close - 1) * 100);
    }
  }
  return {
    horizons,
    overlappingSamples: true,
    methodology: 'Retrospective close-to-close returns; only contiguous future bars count; state labels are past-only; hourly observations overlap.',
    states: buckets.map(bucket => ({
      code: bucket.code,
      label: bucket.label,
      horizons: bucket.horizons.map(item => {
        const values = item.returns, wins = values.filter(value => value > 0).length;
        return {
          barsAhead: item.barsAhead,
          samples: values.length,
          medianReturnPct: median(values),
          meanReturnPct: values.length ? values.reduce((sum,value)=>sum+value,0)/values.length : null,
          winRatePct: values.length ? wins / values.length * 100 : null
        };
      })
    }))
  };
}
