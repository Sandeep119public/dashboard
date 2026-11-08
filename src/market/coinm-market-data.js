/**
 * Binance COIN-M BTCUSD perpetual public market data.
 *
 * Units and provenance:
 * - Kline `volume`, aggregate-trade `q` and depth quantities are exchange
 *   CONTRACTS. For BTCUSD_PERP one contract is 100 USD face value.
 * - Kline taker-buy fields are in contracts (field 9 / stream `V`); the
 *   base-asset fields (field 10 / stream `Q`) are BTC and are not mixed in.
 * - Aggregate-trade `m` is "buyer is maker". It is never a taker side flag.
 * - Seconds candles are built only from executions observed in this session.
 *   Binance does not publish COIN-M seconds klines, so no seconds history is
 *   fabricated.
 */
const COINM_REST = 'https://dapi.binance.com';
const COINM_WS = 'wss://dstream.binance.com/stream';

export const COINM_SYMBOL = 'BTCUSD_PERP';
export const COINM_CONTRACT_USD = 100;
export const KLINE_INTERVALS = Object.freeze(['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M']);
export const SECOND_INTERVALS = Object.freeze(['1s', '5s', '10s', '15s', '30s']);
export const INTERVAL_MS = Object.freeze({ '1s': 1000, '5s': 5000, '10s': 10000, '15s': 15000, '30s': 30000 });
export const MARKET_INTERVALS = Object.freeze([
  ...SECOND_INTERVALS.map(value => ({
    value,
    label: value === '1s' ? '1 second' : value === '5s' ? '5 seconds' : value === '10s' ? '10 seconds' : value === '15s' ? '15 seconds' : '30 seconds',
    source: 'Live trade-built'
  })),
  ...KLINE_INTERVALS.map(value => ({
    value,
    label: value === '1M' ? '1 month' : value,
    source: 'Binance COIN-M candles'
  }))
]);

const KLINE_SET = new Set(KLINE_INTERVALS);
const SECOND_SET = new Set(SECOND_INTERVALS);
const finite = value => Number.isFinite(Number(value));
const positive = value => finite(value) && Number(value) > 0;
const nonNegative = value => finite(value) && Number(value) >= 0;

export function normalizeAggTrade(raw) {
  if (!raw || typeof raw !== 'object' || raw.e !== undefined && raw.e !== 'aggTrade') {
    throw new TypeError('Expected a Binance aggregate-trade event.');
  }
  const time = Number(raw.T ?? raw.time);
  const price = Number(raw.p ?? raw.price);
  const qty = Number(raw.q ?? raw.qty);
  if (!finite(time) || !positive(price) || !positive(qty)) {
    throw new TypeError('Aggregate trade contains an invalid timestamp, price or quantity.');
  }
  const makerFlag = raw.m !== undefined ? raw.m : raw.buyerIsMaker;
  if (typeof makerFlag !== 'boolean') {
    throw new TypeError('Aggregate trade must state whether the buyer was maker.');
  }
  const buyerIsMaker = makerFlag;
  const takerSide = buyerIsMaker ? 'SELL' : 'BUY';
  const makerSide = buyerIsMaker ? 'BUY' : 'SELL';
  const firstId = Number(raw.f);
  const lastId = Number(raw.l);
  const fills = Number.isFinite(firstId) && Number.isFinite(lastId) && lastId >= firstId ? lastId - firstId + 1 : 1;
  return {
    id: Number(raw.a ?? raw.id ?? 0),
    time,
    eventTime: Number(raw.E ?? raw.eventTime ?? time),
    price,
    qty,
    fills,
    buyerIsMaker,
    takerSide,
    makerSide,
    buyTakerQty: buyerIsMaker ? 0 : qty,
    sellTakerQty: buyerIsMaker ? qty : 0,
    makerBuyQty: buyerIsMaker ? qty : 0,
    makerSellQty: buyerIsMaker ? 0 : qty
  };
}

export function parseCoinMKline(row) {
  if (!Array.isArray(row) || row.length < 12) throw new TypeError('Expected a 12-field Binance COIN-M kline row.');
  const candle = {
    t: Number(row[0]),
    o: Number(row[1]),
    h: Number(row[2]),
    l: Number(row[3]),
    c: Number(row[4]),
    v: Number(row[5]),
    closeTime: Number(row[6]),
    baseVolume: Number(row[7]),
    trades: Number(row[8]),
    buyTaker: Number(row[9]),
    buyTakerBase: Number(row[10])
  };
  if (![candle.t, candle.closeTime, candle.o, candle.h, candle.l, candle.c, candle.v, candle.trades, candle.buyTaker].every(finite)) {
    throw new TypeError('Kline contains invalid numeric fields.');
  }
  if (candle.t <= 0 || candle.closeTime < candle.t) throw new TypeError('Kline timestamps are invalid.');
  if (![candle.o, candle.h, candle.l, candle.c].every(positive) || candle.v < 0 || candle.trades < 0 || candle.buyTaker < 0) {
    throw new TypeError('Kline contains an invalid price, volume or trade count.');
  }
  if (candle.h < Math.max(candle.o, candle.c, candle.l) || candle.l > Math.min(candle.o, candle.c, candle.h) || candle.h < candle.l) {
    throw new TypeError('Kline OHLC values are inconsistent.');
  }
  // Exchange values are contract quantities. A tiny tolerance protects against
  // decimal serialization while still rejecting USD-M-sized base volumes.
  if (candle.buyTaker > candle.v + 1e-9) throw new TypeError('Kline taker-buy volume exceeds total volume.');
  if (!nonNegative(candle.baseVolume)) candle.baseVolume = null;
  if (!nonNegative(candle.buyTakerBase)) candle.buyTakerBase = null;
  candle.sellTaker = Math.max(0, candle.v - candle.buyTaker);
  candle.makerSell = candle.buyTaker;
  candle.makerBuy = candle.sellTaker;
  candle.delta = candle.buyTaker - candle.sellTaker;
  return candle;
}

export function normalizeKlineEvent(k) {
  if (!k || typeof k !== 'object' || k.e !== undefined && k.e !== 'kline') {
    throw new TypeError('Expected a Binance kline stream payload.');
  }
  const candle = parseCoinMKline([
    k.t, k.o, k.h, k.l, k.c, k.v, k.T, 0, k.n,
    k.V ?? 0, k.Q ?? 0, 0
  ]);
  candle.interval = k.i || null;
  candle.symbol = k.s || null;
  candle.closed = Boolean(k.x);
  return candle;
}

export function createMinuteFootprintState() {
  return {
    minute: null,
    levels: new Map(),
    totalQty: 0,
    totalFills: 0,
    totalBuy: 0,
    totalSell: 0,
    maxQty: 0,
    latestPrice: null
  };
}

export function summarizeMinuteFootprint(state, visibleLevels = 80) {
  if (!state || !(state.levels instanceof Map) || state.minute === null) return null;
  const referencePrice = Number(state.latestPrice);
  let levels = Array.from(state.levels.values());
  if (levels.length > visibleLevels) {
    levels = levels
      .sort((a, b) => Math.abs(a.price - referencePrice) - Math.abs(b.price - referencePrice))
      .slice(0, visibleLevels);
  }
  levels.sort((a, b) => b.price - a.price);
  const denominator = state.totalBuy + state.totalSell;
  return {
    minute: state.minute,
    levels: levels.map(level => ({
      ...level,
      delta: level.buyTaker - level.sellTaker,
      imbalance: level.buyTaker + level.sellTaker > 0 ? (level.buyTaker - level.sellTaker) / (level.buyTaker + level.sellTaker) : 0
    })),
    levelsTotal: state.levels.size,
    truncated: state.levels.size > levels.length,
    totalQty: state.totalQty,
    totalFills: state.totalFills,
    totalBuy: state.totalBuy,
    totalSell: state.totalSell,
    maxQty: state.maxQty,
    imbalance: denominator > 0 ? (state.totalBuy - state.totalSell) / denominator : 0
  };
}

export function updateMinuteFootprint(state, trade, maxLevels = 500, visibleLevels = 80) {
  if (!state || !(state.levels instanceof Map)) throw new TypeError('Footprint state must contain a levels Map.');
  const minute = Math.floor(Number(trade.time) / 60000) * 60000;
  if (!Number.isFinite(minute) || !positive(trade.price)) {
    throw new TypeError('Footprint trade contains an invalid time or price.');
  }
  if (state.minute !== minute) {
    state.minute = minute;
    state.levels.clear();
    state.totalQty = 0;
    state.totalFills = 0;
    state.totalBuy = 0;
    state.totalSell = 0;
    state.maxQty = 0;
  }
  const price = Number(trade.price);
  state.latestPrice = price;
  const key = String(price);
  const qty = Number(trade.qty);
  if (!positive(qty)) throw new TypeError('Footprint trade quantity must be positive.');
  const fills = Number.isFinite(Number(trade.fills)) && Number(trade.fills) > 0 ? Number(trade.fills) : 1;
  let level = state.levels.get(key);
  if (!level) {
    level = { price, buyTaker: 0, sellTaker: 0, makerBuy: 0, makerSell: 0, trades: 0, fills: 0 };
    state.levels.set(key, level);
  }
  const buy = Number(trade.buyTakerQty !== undefined ? trade.buyTakerQty : (trade.buyerIsMaker ? 0 : qty));
  const sell = Number(trade.sellTakerQty !== undefined ? trade.sellTakerQty : (trade.buyerIsMaker ? qty : 0));
  if (!nonNegative(buy) || !nonNegative(sell) || buy + sell <= 0) {
    throw new TypeError('Footprint trade must contain a positive executed quantity on one side.');
  }
  level.buyTaker += buy;
  level.sellTaker += sell;
  level.makerSell += buy;
  level.makerBuy += sell;
  level.trades++;
  level.fills += fills;
  state.totalQty += qty;
  state.totalFills += fills;
  state.totalBuy += buy;
  state.totalSell += sell;
  state.maxQty = Math.max(state.maxQty, qty);
  while (state.levels.size > Math.max(1, maxLevels)) state.levels.delete(state.levels.keys().next().value);
  return summarizeMinuteFootprint(state, visibleLevels);
}

export function aggregateTradesToCandles(trades, intervalMs) {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new RangeError('intervalMs must be positive.');
  const sorted = Array.from(trades || []).slice().sort((a, b) => Number(a.time) - Number(b.time));
  const map = new Map();
  for (const trade of sorted) {
    const time = Number(trade.time);
    const price = Number(trade.price);
    const qty = Number(trade.qty);
    if (!finite(time) || !positive(price) || !positive(qty)) continue;
    const key = Math.floor(time / intervalMs) * intervalMs;
    let candle = map.get(key);
    if (!candle) {
      candle = {
        t: key, o: price, h: price, l: price, c: price,
        v: 0, trades: 0, fills: 0, buyTaker: 0, sellTaker: 0,
        makerBuy: 0, makerSell: 0, buyTrades: 0, sellTrades: 0
      };
      map.set(key, candle);
    }
    candle.h = Math.max(candle.h, price);
    candle.l = Math.min(candle.l, price);
    candle.c = price;
    candle.v += qty;
    candle.trades++;
    candle.fills += Number.isFinite(Number(trade.fills)) && Number(trade.fills) > 0 ? Number(trade.fills) : 1;
    const buy = trade.buyTakerQty !== undefined ? Number(trade.buyTakerQty) : (trade.buyerIsMaker ? 0 : qty);
    const sell = trade.sellTakerQty !== undefined ? Number(trade.sellTakerQty) : (trade.buyerIsMaker ? qty : 0);
    candle.buyTaker += buy;
    candle.sellTaker += sell;
    candle.makerBuy += sell;
    candle.makerSell += buy;
    if (buy > 0) candle.buyTrades++;
    if (sell > 0) candle.sellTrades++;
  }
  return Array.from(map.values()).sort((a, b) => a.t - b.t).map(candle => ({
    ...candle,
    delta: candle.buyTaker - candle.sellTaker
  }));
}

/**
 * Merge candle series by open time. Later series win, duplicate timestamps are
 * removed, gaps are preserved (never filled synthetically) and only the most
 * recent `maxBars` bars are retained.
 */
export function mergeCandleSeries(primary = [], overlay = [], maxBars = 5000) {
  const limit = Number.isFinite(Number(maxBars)) && Number(maxBars) > 0 ? Math.floor(Number(maxBars)) : 5000;
  const map = new Map();
  for (const candle of [...(primary || []), ...(overlay || [])]) {
    const t = Number(candle && candle.t);
    if (!Number.isFinite(t)) continue;
    map.set(t, { ...candle, t });
  }
  const bars = Array.from(map.values()).sort((a, b) => a.t - b.t);
  return bars.length > limit ? bars.slice(-limit) : bars;
}

export function isDepthSnapshotBridge(lastId, event) {
  const snapshotId = Number(lastId);
  return Number.isFinite(snapshotId)
    && Number.isFinite(Number(event && event.U))
    && Number.isFinite(Number(event && event.u))
    && Number(event.U) <= snapshotId
    && Number(event.u) >= snapshotId;
}

export function isDepthUpdateContinuous(lastId, event) {
  if (event && event.pu !== undefined && event.pu !== null) return Number(event.pu) === Number(lastId);
  const next = Number(lastId) + 1;
  return Number(event && event.U) <= next && Number(event && event.u) >= next;
}

export function applyDepthEvent(book, event) {
  if (!book || !(book.bids instanceof Map) || !(book.asks instanceof Map)) {
    throw new TypeError('Book must contain bid and ask Maps.');
  }
  if (!event || !Number.isFinite(Number(event.u))) throw new TypeError('Depth event must contain a final update id.');
  const changes = {
    bidAdded: 0, bidReduced: 0, askAdded: 0, askReduced: 0,
    bidChanges: {}, askChanges: {}
  };
  const apply = (map, levels, added, reduced, perPrice) => {
    for (const level of levels || []) {
      if (!Array.isArray(level) || level.length < 2) continue;
      const price = String(Number(level[0]));
      const qty = Number(level[1]);
      if (!positive(price) || !finite(qty) || qty < 0) continue;
      const prior = Number(map.get(price) || 0);
      if (qty === 0) map.delete(price);
      else map.set(price, qty);
      const delta = qty - prior;
      if (delta > 0) changes[added] += delta;
      else if (delta < 0) changes[reduced] += -delta;
      if (delta !== 0) perPrice[price] = (perPrice[price] || 0) + delta;
    }
  };
  apply(book.bids, event.b, 'bidAdded', 'bidReduced', changes.bidChanges);
  apply(book.asks, event.a, 'askAdded', 'askReduced', changes.askChanges);
  book.lastUpdateId = Number(event.u);
  book.updatedAt = Number(event.E ?? event.T ?? 0) || null;
  return changes;
}

function emptyStats() {
  return {
    events: 0, fills: 0, qty: 0, buyTaker: 0, sellTaker: 0,
    delta: 0, lastPrice: null, maxQty: 0, buyEvents: 0, sellEvents: 0
  };
}

function bookView(book, ready, changes = {}, updatedAt = null, lastUpdateId = null) {
  const bids = Array.from(book.bids, ([price, qty]) => ({ price: Number(price), qty }))
    .sort((a, b) => b.price - a.price).slice(0, 25);
  const asks = Array.from(book.asks, ([price, qty]) => ({ price: Number(price), qty }))
    .sort((a, b) => a.price - b.price).slice(0, 25);
  const bidDepth = bids.reduce((sum, level) => sum + level.qty, 0);
  const askDepth = asks.reduce((sum, level) => sum + level.qty, 0);
  return {
    ready,
    lastUpdateId: lastUpdateId !== null ? lastUpdateId : book.lastUpdateId,
    bids,
    asks,
    bidDepth,
    askDepth,
    changes,
    updatedAt
  };
}

export function createCoinMMarketFeed(options = {}) {
  const symbol = String(options.symbol || COINM_SYMBOL).trim().toUpperCase();
  const fetchImpl = options.fetchImpl || ((...args) => fetch(...args));
  const WebSocketImpl = options.WebSocketImpl || (typeof WebSocket !== 'undefined' ? WebSocket : null);
  const setTimer = options.setTimeoutImpl || ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimeoutImpl || (id => clearTimeout(id));
  const now = options.now || (() => Date.now());
  const staleAfterMs = Number.isFinite(Number(options.staleAfterMs)) ? Number(options.staleAfterMs) : 90000;
  const healthCheckMs = Number.isFinite(Number(options.healthCheckMs)) ? Number(options.healthCheckMs) : 15000;
  const maxRecentTrades = Number.isFinite(Number(options.maxRecentTrades)) ? Number(options.maxRecentTrades) : 40;
  const maxSecondBars = Number.isFinite(Number(options.maxSecondBars)) ? Number(options.maxSecondBars) : 5000;
  const maxLiveKlines = Number.isFinite(Number(options.maxLiveKlines)) ? Number(options.maxLiveKlines) : 5000;
  const maxFootprintLevels = Number.isFinite(Number(options.maxFootprintLevels)) ? Number(options.maxFootprintLevels) : 3000;
  const visibleFootprintLevels = Number.isFinite(Number(options.visibleFootprintLevels)) ? Number(options.visibleFootprintLevels) : 80;
  const depthLimit = Number.isFinite(Number(options.depthLimit)) ? Number(options.depthLimit) : 1000;
  const maxFootprintMinutes = Number.isFinite(Number(options.maxFootprintMinutes)) ? Math.max(1, Math.floor(Number(options.maxFootprintMinutes))) : 240;
  const maxDepthSamples = Number.isFinite(Number(options.maxDepthSamples)) ? Math.max(1, Math.floor(Number(options.maxDepthSamples))) : 1800;
  const onStatus = options.onStatus || (() => {});
  const onCandles = options.onCandles || (() => {});
  const onKline = options.onKline || (() => {});
  const onTrade = options.onTrade || (() => {});
  const onBook = options.onBook || (() => {});

  let socket = null;
  let retryTimer = null;
  let healthTimer = null;
  let stopped = true;
  let retryCount = 0;
  let generation = 0;
  let intervalRevision = 0;
  let activeInterval = '1m';
  let snapshotInFlight = false;
  let snapshotReady = false;
  let bookReady = false;
  let lastUpdateId = null;
  let depthBuffer = [];
  let resyncTimer = null;
  let book = { bids: new Map(), asks: new Map(), lastUpdateId: null, updatedAt: null };
  let recentTrades = [];
  let stats = emptyStats();
  let statsSince = null;
  let lastTradeId = null;
  let lastEventAt = null;
  let lastTradeAt = null;
  let lastBookAt = null;
  const footprintHistory = new Map();
  let latestFootprintMinute = null;
  let depthRecording = false;
  const depthHistory = [];
  let depthSegment = 0;
  const secondBars = new Map(SECOND_INTERVALS.map(tf => [tf, new Map()]));
  const liveKlines = new Map();

  const status = (state, message) => onStatus({ state, message });
  const clearHealth = () => {
    if (healthTimer !== null) {
      clearTimer(healthTimer);
      healthTimer = null;
    }
  };
  const clearResync = () => {
    if (resyncTimer !== null) {
      clearTimer(resyncTimer);
      resyncTimer = null;
    }
  };

  async function requestJson(url) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeout = controller ? setTimer(() => controller.abort(), 12000) : null;
    try {
      const response = await fetchImpl(url, controller ? { signal: controller.signal } : {});
      if (!response || !response.ok) throw new Error('Binance returned HTTP ' + (response ? response.status : 'no response') + '.');
      return await response.json();
    } finally {
      if (timeout !== null) clearTimer(timeout);
    }
  }

  async function loadKlines(interval, limit = 1000, window = {}) {
    if (!KLINE_SET.has(interval)) return [];
    const params = new URLSearchParams({ symbol, interval, limit: String(Math.min(1000, Math.max(1, Number(limit) || 1000))) });
    if (Number.isFinite(Number(window.startTime))) params.set('startTime', String(Math.floor(Number(window.startTime))));
    if (Number.isFinite(Number(window.endTime))) params.set('endTime', String(Math.floor(Number(window.endTime))));
    const rows = await requestJson(COINM_REST + '/dapi/v1/klines?' + params.toString());
    if (!Array.isArray(rows)) throw new Error('Unexpected Binance kline response.');
    return rows.map(parseCoinMKline);
  }

  async function loadOlderKlines(interval, beforeTime, limit = 1000) {
    const before = Number(beforeTime);
    if (!KLINE_SET.has(interval)) throw new RangeError('Older exchange candles are only available for Binance kline intervals.');
    if (!Number.isFinite(before) || before <= 0) throw new TypeError('beforeTime must be a positive candle timestamp.');
    const rows = await loadKlines(interval, limit, { endTime: Math.floor(before) - 1 });
    return rows.filter(candle => candle.t < before);
  }

  function getFootprintMinutes() {
    return Array.from(footprintHistory.keys()).sort((a, b) => a - b);
  }

  function getFootprint(minute) {
    const state = footprintHistory.get(Number(minute));
    return state ? summarizeMinuteFootprint(state, visibleFootprintLevels) : null;
  }

  function getLatestFootprint() {
    return latestFootprintMinute === null ? null : getFootprint(latestFootprintMinute);
  }

  function getSessionCandles(interval) {
    const map = secondBars.get(interval);
    return map ? Array.from(map.values()).map(candle => ({ ...candle })).sort((a, b) => a.t - b.t) : [];
  }

  function resetSession() {
    recentTrades = [];
    stats = emptyStats();
    statsSince = now();
    lastTradeId = null;
    lastEventAt = null;
    lastTradeAt = null;
    footprintHistory.clear();
    latestFootprintMinute = null;
    depthRecording = false;
    depthHistory.length = 0;
    depthSegment = 0;
    for (const map of secondBars.values()) map.clear();
    for (const map of liveKlines.values()) map.clear();
  }

  function addTrade(raw) {
    let trade;
    try {
      trade = normalizeAggTrade(raw);
    } catch (_) {
      return false;
    }
    if (Number.isFinite(trade.id) && trade.id > 0 && lastTradeId !== null && trade.id <= lastTradeId) return false;
    if (Number.isFinite(trade.id) && trade.id > 0) lastTradeId = trade.id;
    lastEventAt = now();
    lastTradeAt = lastEventAt;
    recentTrades.unshift(trade);
    if (recentTrades.length > maxRecentTrades) recentTrades.length = maxRecentTrades;
    stats.events++;
    stats.fills += trade.fills;
    stats.qty += trade.qty;
    stats.buyTaker += trade.buyTakerQty;
    stats.sellTaker += trade.sellTakerQty;
    stats.delta = stats.buyTaker - stats.sellTaker;
    stats.lastPrice = trade.price;
    stats.maxQty = Math.max(stats.maxQty, trade.qty);
    if (trade.takerSide === 'BUY') stats.buyEvents++;
    else stats.sellEvents++;
    for (const tf of SECOND_INTERVALS) {
      const ms = INTERVAL_MS[tf];
      const t = Math.floor(trade.time / ms) * ms;
      const map = secondBars.get(tf);
      let candle = map.get(t);
      if (!candle) {
        candle = {
          t, o: trade.price, h: trade.price, l: trade.price, c: trade.price,
          v: 0, trades: 0, fills: 0, buyTaker: 0, sellTaker: 0,
          makerBuy: 0, makerSell: 0, buyTrades: 0, sellTrades: 0
        };
        map.set(t, candle);
      }
      candle.h = Math.max(candle.h, trade.price);
      candle.l = Math.min(candle.l, trade.price);
      candle.c = trade.price;
      candle.v += trade.qty;
      candle.trades++;
      candle.fills += trade.fills;
      candle.buyTaker += trade.buyTakerQty;
      candle.sellTaker += trade.sellTakerQty;
      candle.makerBuy += trade.makerBuyQty;
      candle.makerSell += trade.makerSellQty;
      candle.delta = candle.buyTaker - candle.sellTaker;
      if (trade.takerSide === 'BUY') candle.buyTrades++;
      else candle.sellTrades++;
      while (map.size > maxSecondBars) map.delete(map.keys().next().value);
    }
    let candle = null;
    if (SECOND_SET.has(activeInterval)) {
      const intervalMs = INTERVAL_MS[activeInterval];
      const bucket = Math.floor(trade.time / intervalMs) * intervalMs;
      const current = secondBars.get(activeInterval).get(bucket);
      if (current) candle = { ...current };
    }
    const minute = Math.floor(trade.time / 60000) * 60000;
    let footprintState = footprintHistory.get(minute);
    const newFootprintMinute = !footprintState;
    if (!footprintState) {
      footprintState = createMinuteFootprintState();
      footprintState.minute = minute;
      footprintHistory.set(minute, footprintState);
    }
    const footprint = updateMinuteFootprint(footprintState, trade, maxFootprintLevels, visibleFootprintLevels);
    latestFootprintMinute = minute;
    while (footprintHistory.size > maxFootprintMinutes) footprintHistory.delete(footprintHistory.keys().next().value);
    onTrade(trade, {
      recentTrades: recentTrades.slice(),
      stats: { ...stats, since: statsSince },
      candle,
      footprint,
      footprintMinutes: newFootprintMinute ? getFootprintMinutes() : null
    });
    return true;
  }

  function notifyBook(changes = {}) {
    onBook(bookView(book, bookReady, changes, lastBookAt, lastUpdateId));
  }

  function copyDepthSample(sample) {
    if (!sample) return null;
    return {
      time: sample.time,
      updatedAt: sample.updatedAt,
      lastUpdateId: sample.lastUpdateId,
      segment: sample.segment,
      bids: sample.bids.map(level => ({ ...level })),
      asks: sample.asks.map(level => ({ ...level })),
      bidDepth: sample.bidDepth,
      askDepth: sample.askDepth,
      changes: sample.changes || {}
    };
  }

  function recordDepthSnapshot(changes = {}) {
    if (!depthRecording || !bookReady) return;
    const view = bookView(book, true, changes, lastBookAt, lastUpdateId);
    depthHistory.push({
      time: Number(lastBookAt) || now(),
      updatedAt: view.updatedAt,
      lastUpdateId: view.lastUpdateId,
      segment: depthSegment,
      bids: view.bids,
      asks: view.asks,
      bidDepth: view.bidDepth,
      askDepth: view.askDepth,
      changes: view.changes
    });
    while (depthHistory.length > maxDepthSamples) depthHistory.shift();
  }

  function getDepthHistory() {
    return depthHistory.map(copyDepthSample);
  }

  function getDepthHistoryInfo() {
    return {
      count: depthHistory.length,
      firstTime: depthHistory.length ? depthHistory[0].time : null,
      lastTime: depthHistory.length ? depthHistory[depthHistory.length - 1].time : null,
      recording: depthRecording,
      limit: maxDepthSamples
    };
  }

  function getDepthSnapshot(index) {
    const i = Math.floor(Number(index));
    return Number.isInteger(i) && i >= 0 && i < depthHistory.length ? copyDepthSample(depthHistory[i]) : null;
  }

  function setDepthRecording(enabled) {
    depthRecording = Boolean(enabled);
    if (depthRecording && bookReady) recordDepthSnapshot({});
    return depthRecording;
  }

  function applyAndNotify(event) {
    const wasReady = bookReady;
    const changes = applyDepthEvent(book, event);
    lastUpdateId = Number(event.u);
    book.lastUpdateId = lastUpdateId;
    bookReady = true;
    lastBookAt = now();
    lastEventAt = lastBookAt;
    notifyBook(changes);
    recordDepthSnapshot(changes);
    if (!wasReady) status('connected', 'Live COIN-M trades, candles and synchronized public depth are updating.');
  }

  function scheduleResync(g, delay = 400) {
    if (g !== generation || stopped) return;
    snapshotReady = false;
    bookReady = false;
    notifyBook();
    if (resyncTimer !== null) return;
    resyncTimer = setTimer(() => {
      resyncTimer = null;
      beginBookSync(g);
    }, delay);
  }

  function beginBookSync(g, seed = []) {
    if (g !== generation || stopped) return;
    if (resyncTimer !== null) {
      clearTimer(resyncTimer);
      resyncTimer = null;
    }
    if (seed.length) depthBuffer.push(...seed);
    if (depthBuffer.length > 2000) depthBuffer = depthBuffer.slice(-1000);
    if (snapshotInFlight) return;
    snapshotInFlight = true;
    snapshotReady = false;
    bookReady = false;
    lastBookAt = null;
    book = { bids: new Map(), asks: new Map(), lastUpdateId: null, updatedAt: null };
    lastUpdateId = null;
    notifyBook();
    status('syncing', 'Synchronizing the order-book snapshot with sequenced depth updates…');
    (async () => {
      try {
        const params = new URLSearchParams({ symbol, limit: String(depthLimit) });
        const snapshot = await requestJson(COINM_REST + '/dapi/v1/depth?' + params.toString());
        if (g !== generation || stopped) return;
        book = {
          bids: new Map((snapshot.bids || []).map(level => [String(Number(level[0])), Number(level[1])])),
          asks: new Map((snapshot.asks || []).map(level => [String(Number(level[0])), Number(level[1])])),
          lastUpdateId: Number(snapshot.lastUpdateId),
          updatedAt: now()
        };
        lastUpdateId = book.lastUpdateId;
        snapshotReady = true;
        snapshotInFlight = false;
        const queued = depthBuffer.splice(0);
        let sawFutureEvent = false;
        for (const event of queued) {
          if (g !== generation || stopped) return;
          const u = Number(event && event.u);
          if (!Number.isFinite(u) || u <= Number(lastUpdateId)) continue;
          if (!bookReady) {
            if (isDepthSnapshotBridge(lastUpdateId, event)) applyAndNotify(event);
            else sawFutureEvent = true;
            continue;
          }
          if (!isDepthUpdateContinuous(lastUpdateId, event)) {
            sawFutureEvent = true;
            continue;
          }
          applyAndNotify(event);
        }
        if (!bookReady) {
          notifyBook();
          if (sawFutureEvent) {
            status('syncing', 'Snapshot is behind the live stream. Refreshing the order book…');
            scheduleResync(g);
          } else {
            status('syncing', 'Snapshot loaded. Waiting for the first update that bridges the snapshot sequence…');
          }
        }
      } catch (error) {
        snapshotInFlight = false;
        if (g !== generation || stopped) return;
        status('warning', 'Order-book snapshot failed: ' + String(error && error.message || error));
        retryTimer = setTimer(() => {
          retryTimer = null;
          beginBookSync(g);
        }, 2500);
      }
    })();
  }

  function processDepth(event, g) {
    if (g !== generation || stopped || !event) return;
    const U = Number(event.U);
    const u = Number(event.u);
    if (!Number.isFinite(U) || !Number.isFinite(u)) return;
    lastEventAt = now();
    if (!snapshotReady) {
      depthBuffer.push(event);
      if (depthBuffer.length > 2000) {
        depthBuffer = depthBuffer.slice(-1000);
        if (!snapshotInFlight) beginBookSync(g, depthBuffer);
      }
      return;
    }
    if (bookReady && lastUpdateId !== null && u <= Number(lastUpdateId)) return;
    if (!bookReady) {
      if (lastUpdateId !== null && u < Number(lastUpdateId)) return;
      if (lastUpdateId !== null && U > Number(lastUpdateId)) {
        depthBuffer.push(event);
        status('syncing', 'Depth moved ahead of the snapshot. Refreshing the order book…');
        scheduleResync(g);
        return;
      }
      if (!isDepthSnapshotBridge(lastUpdateId, event)) return;
      applyAndNotify(event);
      return;
    }
    if (!isDepthUpdateContinuous(lastUpdateId, event)) {
      status('syncing', 'Depth sequence gap detected. Loading a fresh snapshot…');
      beginBookSync(g, [event]);
      return;
    }
    applyAndNotify(event);
  }

  function startHealthCheck(g) {
    clearHealth();
    if (!(healthCheckMs > 0) || !(staleAfterMs > 0)) return;
    const tick = () => {
      healthTimer = null;
      if (g !== generation || stopped) return;
      if (lastEventAt !== null && now() - lastEventAt > staleAfterMs) {
        status('warning', 'No market messages for ' + Math.round((now() - lastEventAt) / 1000) + 's. Reconnecting…');
        if (g === generation && !stopped) openSocket();
        return;
      }
      healthTimer = setTimer(tick, healthCheckMs);
    };
    healthTimer = setTimer(tick, healthCheckMs);
  }

  function openSocket() {
    if (!WebSocketImpl) {
      stopped = true;
      status('error', 'This browser does not support WebSocket market streams.');
      return;
    }
    if (retryTimer !== null) {
      clearTimer(retryTimer);
      retryTimer = null;
    }
    // Advance the generation before closing the previous socket so its close
    // handler is ignored instead of scheduling an unnecessary reconnect.
    const g = ++generation;
    depthSegment++;
    if (socket) {
      const old = socket;
      socket = null;
      try { old.close(); } catch (_) {}
    }
    clearHealth();
    clearResync();
    snapshotInFlight = false;
    snapshotReady = false;
    bookReady = false;
    depthBuffer = [];
    book = { bids: new Map(), asks: new Map(), lastUpdateId: null, updatedAt: null };
    lastUpdateId = null;
    lastBookAt = null;
    lastEventAt = now();
    notifyBook();
    const streams = [symbol.toLowerCase() + '@aggTrade', symbol.toLowerCase() + '@depth@100ms'];
    if (KLINE_SET.has(activeInterval)) streams.push(symbol.toLowerCase() + '@kline_' + activeInterval);
    let ws;
    try {
      ws = new WebSocketImpl(COINM_WS + '?streams=' + streams.join('/'));
    } catch (error) {
      stopped = true;
      status('error', 'Could not open the Binance market stream: ' + String(error && error.message || error));
      return;
    }
    socket = ws;
    status('connecting', 'Opening Binance COIN-M public market streams…');
    ws.onopen = () => {
      if (g !== generation || stopped) return;
      retryCount = 0;
      lastEventAt = now();
      status('connected', 'Live COIN-M trade and depth streams connected. Synchronizing the order book…');
      beginBookSync(g);
      startHealthCheck(g);
    };
    ws.onmessage = event => {
      if (g !== generation || stopped) return;
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch (_) {
        return;
      }
      const data = payload && payload.data ? payload.data : payload;
      if (!data) return;
      if (data.e === 'aggTrade') addTrade(data);
      else if (data.e === 'depthUpdate') processDepth(data, g);
      else if (data.e === 'kline' && data.k && KLINE_SET.has(activeInterval) && data.k.i === activeInterval) {
        try {
          const candle = normalizeKlineEvent(data.k);
          lastEventAt = now();
          let map = liveKlines.get(activeInterval);
          if (!map) {
            map = new Map();
            liveKlines.set(activeInterval, map);
          }
          map.set(Number(candle.t), candle);
          while (map.size > maxLiveKlines) map.delete(map.keys().next().value);
          onKline(candle, activeInterval);
        } catch (_) {}
      }
    };
    ws.onerror = () => {
      if (g === generation && !stopped) status('warning', 'WebSocket error. Waiting for the connection to recover…');
    };
    ws.onclose = () => {
      if (g !== generation || stopped) return;
      socket = null;
      clearHealth();
      clearResync();
      snapshotReady = false;
      bookReady = false;
      snapshotInFlight = false;
      depthBuffer = [];
      book = { bids: new Map(), asks: new Map(), lastUpdateId: null, updatedAt: null };
      lastUpdateId = null;
      lastBookAt = null;
      notifyBook();
      status('reconnecting', 'Market stream disconnected. Reconnecting automatically…');
      const wait = Math.min(30000, 1000 * Math.pow(2, Math.min(5, retryCount++)));
      retryTimer = setTimer(() => {
        retryTimer = null;
        if (!stopped) openSocket();
      }, wait);
    };
  }

  function mergeLiveKlines(interval, candles) {
    const map = new Map((candles || []).map(candle => [Number(candle.t), candle]));
    const live = liveKlines.get(interval);
    if (live) for (const [t, candle] of live) map.set(t, candle);
    return Array.from(map.values()).sort((a, b) => a.t - b.t);
  }

  async function refreshInterval(target = activeInterval) {
    if (KLINE_SET.has(target)) {
      try {
        const candles = await loadKlines(target, 1000);
        if (stopped || target !== activeInterval) return [];
        const merged = mergeLiveKlines(target, candles);
        onCandles({ interval: target, candles: merged, source: 'Binance COIN-M REST klines + live kline updates' });
        return merged;
      } catch (error) {
        if (target === activeInterval) {
          status('warning', 'Live stream may connect, but historical candles could not be loaded: ' + String(error && error.message || error));
        }
        return [];
      }
    }
    const candles = getSessionCandles(target);
    if (target === activeInterval) onCandles({ interval: target, candles, source: 'Live aggregate trades since connection' });
    return candles;
  }

  function connect(interval = activeInterval) {
    if (!KLINE_SET.has(interval) && !SECOND_SET.has(interval)) throw new RangeError('Unsupported market interval: ' + interval);
    if (!stopped) disconnect();
    if (retryTimer !== null) {
      clearTimer(retryTimer);
      retryTimer = null;
    }
    stopped = false;
    retryCount = 0;
    activeInterval = interval;
    intervalRevision++;
    resetSession();
    openSocket();
    return refreshInterval(interval);
  }

  async function setInterval(interval) {
    if (!KLINE_SET.has(interval) && !SECOND_SET.has(interval)) throw new RangeError('Unsupported market interval: ' + interval);
    const revision = ++intervalRevision;
    activeInterval = interval;
    if (stopped) return { interval, candles: [] };
    const candles = await refreshInterval(interval);
    if (stopped || revision !== intervalRevision) return { interval, candles: [] };
    openSocket();
    return { interval, candles };
  }

  function disconnect() {
    stopped = true;
    intervalRevision++;
    clearHealth();
    clearResync();
    if (retryTimer !== null) {
      clearTimer(retryTimer);
      retryTimer = null;
    }
    generation++;
    depthRecording = false;
    snapshotInFlight = false;
    snapshotReady = false;
    bookReady = false;
    depthBuffer = [];
    if (socket) {
      const old = socket;
      socket = null;
      try { old.close(); } catch (_) {}
    }
    book = { bids: new Map(), asks: new Map(), lastUpdateId: null, updatedAt: null };
    lastUpdateId = null;
    lastBookAt = null;
    notifyBook();
    status('disconnected', 'Disconnected. Historical candles remain visible; live trades and depth are paused.');
  }

  return {
    connect,
    disconnect,
    setInterval,
    loadKlines,
    loadOlderKlines,
    getSessionCandles,
    getFootprint,
    getFootprintMinutes,
    getLatestFootprint,
    setDepthRecording,
    getDepthRecording: () => depthRecording,
    getDepthHistory,
    getDepthHistoryInfo,
    getDepthSnapshot,
    getStatus: () => ({
      connected: !stopped,
      interval: activeInterval,
      symbol,
      bookReady,
      lastEventAt,
      lastTradeAt,
      lastBookAt,
      footprintMinutes: footprintHistory.size,
      depthRecording,
      depthSamples: depthHistory.length
    })
  };
}
