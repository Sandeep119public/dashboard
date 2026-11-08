/**
 * Non-overlapping event study for transitions into past-only market states.
 * Excursions are measured from the event bar close across future OHLC bars.
 * Returns are hypothetical close-to-close outcomes after a configurable
 * round-trip cost. This is retrospective research, not a trading signal.
 */
function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function median(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function summarize(rows, side) {
  const gross = rows.map(row => row.grossReturnPct);
  const net = rows.map(row => row.netReturnPct);
  const mfe = rows.map(row => row.mfePct);
  const mae = rows.map(row => row.maePct);
  return {
    side,
    samples: rows.length,
    medianGrossReturnPct: median(gross),
    medianNetReturnPct: median(net),
    meanNetReturnPct: rows.length ? net.reduce((sum, value) => sum + value, 0) / rows.length : null,
    winRatePct: rows.length ? net.filter(value => value > 0).length / rows.length * 100 : null,
    medianMfePct: median(mfe),
    medianMaePct: median(mae)
  };
}

/**
 * @param {object} bars Equal-length t, o, h, l and c arrays.
 * @param {object} stateResult Result from classifyMarketStates().
 * @param {object} options intervalSeconds, horizons, side, costBps, startTime, endTime.
 */
export function analyzeStateEvents(bars, stateResult, options = {}) {
  const length = Array.isArray(bars?.t) ? bars.t.length : -1;
  const keys = ['o', 'h', 'l', 'c'];
  if (length < 0 || keys.some(key => !Array.isArray(bars[key]) || bars[key].length !== length)) {
    throw new TypeError('Event study requires equal-length t, o, h, l and c arrays.');
  }
  if (!stateResult || !Array.isArray(stateResult.values) || stateResult.values.length !== length || !Array.isArray(stateResult.labels)) {
    throw new TypeError('State labels must align with the supplied bars.');
  }
  const intervalSeconds = options.intervalSeconds === undefined ? 3600 : Number(options.intervalSeconds);
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) throw new RangeError('intervalSeconds must be positive.');
  const horizons = (options.horizons || [1, 4, 24]).map(Number);
  if (!horizons.length || horizons.some(value => !Number.isInteger(value) || value < 1) || new Set(horizons).size !== horizons.length) {
    throw new RangeError('Horizons must be unique positive whole-bar counts.');
  }
  const side = options.side || 'both';
  if (!['both', 'long', 'short'].includes(side)) throw new RangeError('side must be both, long or short.');
  const costBps = options.costBps === undefined ? 0 : Number(options.costBps);
  if (!Number.isFinite(costBps) || costBps < 0) throw new RangeError('costBps must be a non-negative finite number.');
  const startTime = options.startTime === undefined ? -Infinity : Number(options.startTime);
  const endTime = options.endTime === undefined ? Infinity : Number(options.endTime);
  if (Number.isNaN(startTime) || Number.isNaN(endTime) || endTime < startTime) throw new RangeError('Event time window is invalid.');

  const buckets = stateResult.labels.map((label, code) => ({
    code,
    label,
    horizons: horizons.map(barsAhead => ({
      barsAhead,
      sides: (side === 'both' ? ['long', 'short'] : [side]).map(name => ({ side: name, rows: [] }))
    }))
  }));
  const byCode = new Map(buckets.map(bucket => [bucket.code, bucket]));
  const events = [];
  for (let i = 0; i < length; i++) {
    const state = stateResult.values[i];
    if (!state || !Number.isInteger(state.code) || state.code <= 0 || !byCode.has(state.code)) continue;
    const previous = i > 0 ? stateResult.values[i - 1] : null;
    const gap = i > 0 && Number(bars.t[i]) - Number(bars.t[i - 1]) !== intervalSeconds;
    if (i > 0 && !gap && previous && previous.code === state.code) continue;
    const timestamp = Number(bars.t[i]);
    if (timestamp < startTime || timestamp > endTime) continue;
    const entry = finitePositive(bars.c[i]);
    if (entry === null) continue;
    events.push({ index: i, code: state.code, timestamp, entry });
  }

  const selectedByHorizon = new Map();
  for (const horizon of horizons) {
    let nextEligibleIndex = 0;
    const selected = [];
    for (const event of events) {
      const target = event.index + horizon;
      if (event.index < nextEligibleIndex || target >= length) continue;
      let contiguous = true;
      for (let j = event.index + 1; j <= target; j++) {
        if (Number(bars.t[j]) - Number(bars.t[j - 1]) !== intervalSeconds) {
          contiguous = false;
          break;
        }
      }
      if (!contiguous) continue;
      const futureClose = finitePositive(bars.c[target]);
      if (futureClose === null) continue;
      let highest = -Infinity, lowest = Infinity, valid = true;
      for (let j = event.index + 1; j <= target; j++) {
        const high = finitePositive(bars.h[j]), low = finitePositive(bars.l[j]);
        if (high === null || low === null || high < low) { valid = false; break; }
        highest = Math.max(highest, high);
        lowest = Math.min(lowest, low);
      }
      if (!valid || !Number.isFinite(highest) || !Number.isFinite(lowest)) continue;

      const longGross = (futureClose / event.entry - 1) * 100;
      const shortGross = (event.entry / futureClose - 1) * 100;
      const bucket = byCode.get(event.code);
      const horizonBucket = bucket.horizons[horizons.indexOf(horizon)];
      for (const sideBucket of horizonBucket.sides) {
        const isLong = sideBucket.side === 'long';
        const grossReturnPct = isLong ? longGross : shortGross;
        sideBucket.rows.push({
          grossReturnPct,
          netReturnPct: grossReturnPct - costBps / 100,
          mfePct: isLong ? (highest / event.entry - 1) * 100 : (event.entry / lowest - 1) * 100,
          maePct: isLong ? (1 - lowest / event.entry) * 100 : (highest / event.entry - 1) * 100
        });
      }
      selected.push(event);
      // Future windows are (event bar, target bar]. The next accepted event
      // must start after target, so no two observations share future bars.
      nextEligibleIndex = target + 1;
    }
    selectedByHorizon.set(horizon, selected);
  }

  return {
    horizons,
    side,
    costBps,
    detectedEvents: events.length,
    nonOverlapping: true,
    eventDefinition: 'First bar of each non-warm-up state run; a gap starts a new run.',
    methodology: 'Disjoint future windows per horizon; excursions use future OHLC; costs are a configurable round-trip deduction; state labels are past-only.',
    states: buckets.map(bucket => ({
      code: bucket.code,
      label: bucket.label,
      horizons: bucket.horizons.map(item => ({
        barsAhead: item.barsAhead,
        sides: item.sides.map(itemSide => summarize(itemSide.rows, itemSide.side))
      }))
    })),
    selectedEventsByHorizon: Object.fromEntries([...selectedByHorizon].map(([horizon, selected]) => [horizon, selected.length]))
  };
}
