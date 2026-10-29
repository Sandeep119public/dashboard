// Time-window selection and OHLCV-preserving downsampling for dashboard charts.
// The source bars are injected so imported days can replace the combined data without rebuilding this module.
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

export function createBarSubsetter({ getBars, barSteps, maxRenderPoints = 3200, cacheLimit = 8 } = {}) {
  if (typeof getBars !== 'function') throw new TypeError('createBarSubsetter requires getBars().');
  if (!barSteps || typeof barSteps !== 'object') throw new TypeError('createBarSubsetter requires barSteps.');
  if (!Number.isInteger(maxRenderPoints) || maxRenderPoints < 1) throw new RangeError('maxRenderPoints must be a positive integer.');
  if (!Number.isInteger(cacheLimit) || cacheLimit < 1) throw new RangeError('cacheLimit must be a positive integer.');

  const cache = new Map();

  function cacheResult(key, value) {
    cache.set(key, value);
    if (cache.size > cacheLimit) cache.delete(cache.keys().next().value);
  }

  function subsetBars(timeframe, window) {
    const key = timeframe + '|' + window.s + '|' + window.e;
    if (cache.has(key)) return cache.get(key);

    const source = getBars()[timeframe];
    if (!source || !Array.isArray(source.t)) throw new Error('No bar series is available for timeframe "' + timeframe + '".');
    const step = barSteps[timeframe] || 60;
    const lo = lowerBound(source.t, window.s);
    const hi = upperBound(source.t, window.e);
    const count = Math.max(0, hi - lo);
    const breaks = [];
    for (let i = lo; i < hi; i++) breaks.push(i > lo && source.t[i] - source.t[i - 1] > step * 1.5);

    if (count <= maxRenderPoints) {
      const ids = Array.from({ length: count }, (_, i) => lo + i);
      const result = { x: source, ids, source, sourceLo: lo, sourceHi: hi, ends: null, groupSize: 1, compressed: false, breakBefore: breaks, step };
      cacheResult(key, result);
      return result;
    }

    const x = { t: [], o: [], h: [], l: [], c: [], v: [], n: [], b: [], s: [], d: [], pv: [] };
    const ends = [], breakBefore = [], segments = [];
    let segmentStart = lo;
    for (let i = lo + 1; i < hi; i++) {
      const gap = source.t[i] - source.t[i - 1] > step * 1.5;
      const sessionBoundary = Math.floor(source.t[i] / 86400) !== Math.floor(source.t[i - 1] / 86400);
      if (gap || sessionBoundary) {
        segments.push([segmentStart, i]);
        segmentStart = i;
      }
    }
    segments.push([segmentStart, hi]);

    let groupSize = Math.max(1, Math.ceil(count / maxRenderPoints));
    const estimatedPoints = () => segments.reduce((n, seg) => n + Math.ceil((seg[1] - seg[0]) / groupSize), 0);
    while (groupSize < count && estimatedPoints() > maxRenderPoints) groupSize++;

    const appendSegment = (segLo, segHi) => {
      for (let start = segLo; start < segHi; start += groupSize) {
        const end = Math.min(segHi, start + groupSize);
        let high = -Infinity, low = Infinity, volume = 0, trades = 0, buy = 0, sell = 0, delta = 0, priceVolume = 0;
        for (let i = start; i < end; i++) {
          if (Number.isFinite(source.h[i])) high = Math.max(high, source.h[i]);
          if (Number.isFinite(source.l[i])) low = Math.min(low, source.l[i]);
          volume += Number(source.v[i] || 0);
          trades += Number(source.n[i] || 0);
          buy += Number(source.b[i] || 0);
          sell += Number(source.s[i] || 0);
          delta += Number(source.d[i] || 0);
          priceVolume += source.pv && source.pv[i] !== null && source.pv[i] !== undefined ? Number(source.pv[i]) : 0;
        }
        x.t.push(source.t[end - 1]);
        x.o.push(source.o[start]);
        x.h.push(high === -Infinity ? null : high);
        x.l.push(low === Infinity ? null : low);
        x.c.push(source.c[end - 1]);
        x.v.push(volume);
        x.n.push(trades);
        x.b.push(buy);
        x.s.push(sell);
        x.d.push(delta);
        x.pv.push(priceVolume);
        ends.push(end - 1);
        breakBefore.push(start > lo && source.t[start] - source.t[start - 1] > step * 1.5);
      }
    };

    for (const [segLo, segHi] of segments) appendSegment(segLo, segHi);
    const ids = Array.from({ length: x.t.length }, (_, i) => i);
    const result = { x, ids, source, sourceLo: lo, sourceHi: hi, ends, groupSize, compressed: true, sourceCount: count, breakBefore, step };
    cacheResult(key, result);
    return result;
  }

  function clearCache() {
    cache.clear();
  }

  return { subsetBars, clearCache, get cacheSize() { return cache.size; } };
}
