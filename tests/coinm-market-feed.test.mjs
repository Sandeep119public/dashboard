import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoinMMarketFeed } from '../src/market/coinm-market-data.js';

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve));
};

function createClock(start = 1_000_000) {
  let time = start;
  let nextId = 1;
  const tasks = new Map();
  const clock = {
    now: () => time,
    setTimeout(fn, ms) {
      const id = nextId++;
      tasks.set(id, { id, due: time + Math.max(0, Number(ms) || 0), fn });
      return id;
    },
    clearTimeout(id) {
      tasks.delete(id);
    },
    pending: () => tasks.size,
    async advance(ms) {
      time += Math.max(0, Number(ms) || 0);
      for (;;) {
        const due = [...tasks.values()]
          .filter(task => task.due <= time)
          .sort((a, b) => a.due - b.due || a.id - b.id);
        if (!due.length) break;
        for (const task of due) {
          if (!tasks.has(task.id)) continue;
          tasks.delete(task.id);
          task.fn();
          await flush();
        }
      }
      await flush();
    }
  };
  return clock;
}

class FakeSocket {
  static all = [];
  static reset() { FakeSocket.all = []; }
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.closed = false;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    FakeSocket.all.push(this);
  }
  open() { this.readyState = 1; if (this.onopen) this.onopen(); }
  message(payload) { if (this.onmessage) this.onmessage({ data: JSON.stringify(payload) }); }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    if (this.onclose) this.onclose();
  }
}

function kline(t, close, volume = '10', buyTaker = '6') {
  return [t, String(close), String(close + 2), String(close - 2), String(close), volume, t + 59999, '0.001', 4, buyTaker, '0.001', '0'];
}

function response(body) {
  return { ok: true, status: 200, json: async () => body };
}

function createFetch({ snapshotIds = [1000], klines = null } = {}) {
  let depthCall = 0;
  const calls = { depth: [], klines: [] };
  const impl = async url => {
    if (url.includes('/dapi/v1/depth')) {
      calls.depth.push(url);
      const id = snapshotIds[Math.min(depthCall, snapshotIds.length - 1)];
      depthCall++;
      return response({
        lastUpdateId: id,
        bids: [['100', '1'], ['99', '2']],
        asks: [['101', '2'], ['102', '3']]
      });
    }
    if (url.includes('/dapi/v1/klines')) {
      calls.klines.push(url);
      const interval = new URL(url).searchParams.get('interval');
      if (klines && klines[interval]) return klines[interval](url);
      return response([kline(1700000000000, 100)]);
    }
    throw new Error('Unexpected request: ' + url);
  };
  impl.calls = calls;
  return impl;
}

function createFeed(overrides = {}) {
  const clock = overrides.clock || createClock();
  const events = { status: [], candles: [], trades: [], books: [], klines: [] };
  const fetchImpl = overrides.fetchImpl || createFetch();
  const feed = createCoinMMarketFeed({
    fetchImpl,
    WebSocketImpl: FakeSocket,
    setTimeoutImpl: clock.setTimeout,
    clearTimeoutImpl: clock.clearTimeout,
    now: clock.now,
    staleAfterMs: overrides.staleAfterMs ?? 100000,
    healthCheckMs: overrides.healthCheckMs ?? 5000,
    ...overrides.options,
    onStatus: event => events.status.push(event),
    onCandles: event => events.candles.push(event),
    onTrade: (trade, state) => events.trades.push({ trade, state }),
    onBook: view => events.books.push(view),
    onKline: (candle, interval) => events.klines.push({ candle, interval })
  });
  return { clock, feed, events, fetchImpl };
}

async function syncBook(feed, socket, id = 1000) {
  socket.open();
  await flush();
  socket.message({ e: 'depthUpdate', U: id - 5, u: id, b: [['100', '5']], a: [['101', '4']] });
  await flush();
}

test('connects with REST klines and bridges the depth snapshot sequence', async () => {
  FakeSocket.reset();
  const { feed, events, fetchImpl } = createFeed();
  await feed.connect('1m');

  assert.equal(FakeSocket.all.length, 1);
  assert.match(FakeSocket.all[0].url, /streams=btcusd_perp@aggTrade\/btcusd_perp@depth@100ms\/btcusd_perp@kline_1m/);
  assert.equal(events.candles.at(-1).interval, '1m');
  assert.equal(events.candles.at(-1).candles.length, 1);
  assert.equal(events.status.at(-1).state, 'connecting');

  await syncBook(feed, FakeSocket.all[0], 1000);
  const view = events.books.at(-1);
  assert.equal(view.ready, true);
  assert.equal(view.lastUpdateId, 1000);
  assert.equal(view.bids[0].price, 100);
  assert.equal(view.bids[0].qty, 5);
  assert.deepEqual(view.changes.bidChanges, { 100: 4 });
  assert.deepEqual(view.changes.askChanges, { 101: 2 });
  assert.equal(events.status.at(-1).state, 'connected');
  assert.equal(fetchImpl.calls.depth.length, 1);

  const booksBefore = events.books.length;
  FakeSocket.all[0].message({ e: 'depthUpdate', U: 1000, u: 1000, pu: 999, b: [['100', '9']], a: [] });
  assert.equal(events.books.length, booksBefore, 'stale or duplicate update ids must be ignored');

  FakeSocket.all[0].message({ e: 'depthUpdate', U: 1001, u: 1002, pu: 1000, b: [['100', '3']], a: [['101', '0']] });
  const next = events.books.at(-1);
  assert.equal(next.lastUpdateId, 1002);
  assert.equal(next.bids[0].qty, 3);
  assert.equal(next.asks.some(level => level.price === 101), false);
  assert.deepEqual(next.changes.bidChanges, { 100: -2 });
  assert.deepEqual(next.changes.askChanges, { 101: -4 });

  FakeSocket.all[0].message({ e: 'aggTrade', a: 7, p: '100', q: '3', T: 1700000001000, m: false });
  assert.equal(events.trades.length, 1);
  assert.equal(events.trades[0].trade.takerSide, 'BUY');
  assert.equal(events.trades[0].state.stats.buyTaker, 3);
  assert.equal(events.trades[0].state.footprint.levels[0].buyTaker, 3);

  feed.disconnect();
});

test('a pu gap replaces the snapshot instead of applying a discontinuous diff', async () => {
  FakeSocket.reset();
  const { feed, events, fetchImpl, clock } = createFeed({
    fetchImpl: createFetch({ snapshotIds: [1000, 1020, 1040] })
  });
  await feed.connect('1m');
  await syncBook(feed, FakeSocket.all[0], 1000);
  const socket = FakeSocket.all[0];

  socket.message({ e: 'depthUpdate', U: 1010, u: 1011, pu: 1009, b: [['100', '1']], a: [] });
  await flush();
  assert.equal(fetchImpl.calls.depth.length, 2, 'a gap must request a fresh snapshot');
  assert.equal(events.books.at(-1).ready, false);

  socket.message({ e: 'depthUpdate', U: 1018, u: 1021, pu: 1017, b: [['100', '7']], a: [] });
  assert.equal(events.books.at(-1).ready, true);
  assert.equal(events.books.at(-1).bids[0].qty, 7);
  assert.equal(events.status.at(-1).state, 'connected');
  feed.disconnect();
});

test('a snapshot behind the buffered stream retries on a timer and does not loop', async () => {
  FakeSocket.reset();
  const { feed, events, fetchImpl, clock } = createFeed({
    fetchImpl: createFetch({ snapshotIds: [1000, 1000, 1010] })
  });
  await feed.connect('1m');
  await syncBook(feed, FakeSocket.all[0], 1000);
  const socket = FakeSocket.all[0];

  socket.message({ e: 'depthUpdate', U: 1005, u: 1006, pu: 1004, b: [['100', '1']], a: [] });
  await flush();
  assert.equal(fetchImpl.calls.depth.length, 2);
  assert.equal(events.books.at(-1).ready, false);

  await clock.advance(399);
  assert.equal(fetchImpl.calls.depth.length, 2, 'resync must wait for its cooldown');
  await clock.advance(1);
  await flush();
  assert.equal(fetchImpl.calls.depth.length, 3, 'the delayed resync must fetch a newer snapshot');

  socket.message({ e: 'depthUpdate', U: 1010, u: 1012, pu: 1009, b: [['100', '8']], a: [] });
  assert.equal(events.books.at(-1).ready, true);
  assert.equal(events.books.at(-1).bids[0].qty, 8);
  feed.disconnect();
});

test('reconnects with exponential backoff and ignores the intentionally replaced socket', async () => {
  FakeSocket.reset();
  const { feed, events, clock } = createFeed();
  await feed.connect('1m');
  const first = FakeSocket.all[0];
  first.open();
  await flush();

  first.close();
  assert.equal(events.status.at(-1).state, 'reconnecting');
  assert.equal(FakeSocket.all.length, 1);
  await clock.advance(999);
  assert.equal(FakeSocket.all.length, 1);
  await clock.advance(1);
  assert.equal(FakeSocket.all.length, 2, 'first retry waits one second');

  const second = FakeSocket.all[1];
  assert.equal(first.closed, true);
  second.close();
  await clock.advance(1999);
  assert.equal(FakeSocket.all.length, 2);
  await clock.advance(1);
  assert.equal(FakeSocket.all.length, 3, 'second retry waits two seconds');

  feed.disconnect();
});

test('health watchdog replaces a socket that stops delivering messages', async () => {
  FakeSocket.reset();
  const { feed, events, clock } = createFeed({ staleAfterMs: 250, healthCheckMs: 100 });
  await feed.connect('1m');
  const first = FakeSocket.all[0];
  first.open();
  await flush();

  await clock.advance(200);
  assert.equal(FakeSocket.all.length, 1);
  await clock.advance(100);
  assert.equal(FakeSocket.all.length, 2, 'stale feed must be replaced');
  assert.equal(first.closed, true);
  assert.ok(events.status.some(event => /No market messages/.test(event.message)));
  feed.disconnect();
});

test('an out-of-order candle response cannot overwrite the selected timeframe', async () => {
  FakeSocket.reset();
  const deferred = {};
  const klines = {
    '5m': () => new Promise(resolve => { deferred['5m'] = resolve; }),
    '1h': () => new Promise(resolve => { deferred['1h'] = resolve; })
  };
  const { feed, events } = createFeed({ fetchImpl: createFetch({ klines }) });
  await feed.connect('1m');

  const slow = feed.setInterval('5m');
  const fast = feed.setInterval('1h');
  assert.equal(feed.getStatus().interval, '1h');

  deferred['1h'](response([kline(1700000000000, 300)]));
  await fast;
  deferred['5m'](response([kline(1700000000000, 200)]));
  await slow;

  assert.equal(feed.getStatus().interval, '1h');
  assert.equal(events.candles.at(-1).interval, '1h');
  assert.equal(events.candles.at(-1).candles[0].c, 300);
  assert.equal(events.candles.some(event => event.interval === '5m'), false);
  feed.disconnect();
});

test('changing to a seconds interval builds live candles without a kline request', async () => {
  FakeSocket.reset();
  const { feed, events, fetchImpl } = createFeed();
  await feed.connect('1m');
  const socket = FakeSocket.all[0];
  socket.open();
  await flush();

  await feed.setInterval('10s');
  assert.equal(events.candles.at(-1).interval, '10s');
  assert.deepEqual(events.candles.at(-1).candles, []);
  assert.equal(fetchImpl.calls.klines.some(url => url.includes('interval=10s')), false);
  assert.match(FakeSocket.all.at(-1).url, /@aggTrade\/btcusd_perp@depth@100ms$/);
  assert.doesNotMatch(FakeSocket.all.at(-1).url, /kline/, 'COIN-M has no seconds kline stream');

  FakeSocket.all.at(-1).message({ e: 'aggTrade', a: 1, p: '100', q: '4', T: 1700000000000, m: true });
  assert.equal(events.trades.at(-1).state.candle.v, 4);
  assert.equal(events.trades.at(-1).state.candle.sellTaker, 4);
  feed.disconnect();
});


test('session footprint history retains prior UTC minutes and exposes selectable summaries', async () => {
  FakeSocket.reset();
  const { feed, events } = createFeed();
  await feed.connect('1m');
  const socket = FakeSocket.all[0];
  socket.open();
  await flush();
  const firstTime = 1700000001000;
  const secondTime = firstTime + 60000;
  socket.message({ e: 'aggTrade', a: 1, p: '100', q: '2', T: firstTime, m: false });
  socket.message({ e: 'aggTrade', a: 2, p: '101', q: '3', T: secondTime, m: true });

  const firstMinute = Math.floor(firstTime / 60000) * 60000;
  const secondMinute = Math.floor(secondTime / 60000) * 60000;
  assert.deepEqual(feed.getFootprintMinutes(), [firstMinute, secondMinute]);
  assert.deepEqual(events.trades.at(-1).state.footprintMinutes, [firstMinute, secondMinute]);
  const older = feed.getFootprint(firstMinute);
  assert.equal(older.totalQty, 2);
  assert.equal(older.totalBuy, 2);
  assert.equal(older.totalSell, 0);
  assert.equal(older.levels[0].price, 100);
  assert.equal(feed.getLatestFootprint().minute, secondMinute);
  feed.disconnect();
});

test('session footprint history is bounded by retained UTC minutes', async () => {
  FakeSocket.reset();
  const { feed } = createFeed({ options: { maxFootprintMinutes: 1 } });
  await feed.connect('1m');
  const socket = FakeSocket.all[0];
  socket.message({ e: 'aggTrade', a: 1, p: '100', q: '2', T: 1700000001000, m: false });
  socket.message({ e: 'aggTrade', a: 2, p: '101', q: '3', T: 1700000061000, m: true });
  assert.deepEqual(feed.getFootprintMinutes(), [Math.floor(1700000061000 / 60000) * 60000]);
  assert.equal(feed.getDepthHistoryInfo().count, 0);
  feed.disconnect();
});

test('older exchange candles page strictly before the oldest retained candle', async () => {
  FakeSocket.reset();
  const fetchImpl = createFetch({
    klines: {
      '1m': url => {
        const endTime = new URL(url).searchParams.get('endTime');
        return response(endTime
          ? [kline(1699999940000, 90), kline(1699999880000, 89)]
          : [kline(1700000000000, 100)]);
      }
    }
  });
  const { feed } = createFeed({ fetchImpl });
  await feed.connect('1m');
  const older = await feed.loadOlderKlines('1m', 1700000000000, 1000);
  assert.deepEqual(older.map(candle => candle.t), [1699999940000, 1699999880000]);
  const request = fetchImpl.calls.klines.at(-1);
  assert.equal(new URL(request).searchParams.get('endTime'), '1699999999999');
  assert.equal(new URL(request).searchParams.get('limit'), '1000');
  await assert.rejects(feed.loadOlderKlines('10s', 1700000000000), /only available for Binance kline intervals/i);
  feed.disconnect();
});

test('depth recording is opt-in, bounded, replayable and stops capturing when disabled', async () => {
  FakeSocket.reset();
  const { feed } = createFeed({ options: { maxDepthSamples: 2, depthSampleIntervalMs: 0 } });
  await feed.connect('1m');
  const socket = FakeSocket.all[0];
  await syncBook(feed, socket, 1000);
  assert.equal(feed.getDepthHistoryInfo().count, 0, 'depth must not be recorded by default');
  assert.equal(feed.setDepthRecording(true), true);
  assert.equal(feed.getDepthHistoryInfo().count, 1, 'starting capture records the current synchronized book');
  socket.message({ e: 'depthUpdate', U: 1001, u: 1002, pu: 1000, b: [['100', '3']], a: [] });
  socket.message({ e: 'depthUpdate', U: 1003, u: 1003, pu: 1002, b: [['100', '2']], a: [] });
  assert.equal(feed.getDepthHistoryInfo().count, 2, 'history is capped at the configured sample count');
  const newest = feed.getDepthSnapshot(1);
  assert.equal(newest.bids[0].qty, 2);
  newest.bids[0].qty = 999;
  assert.equal(feed.getDepthSnapshot(1).bids[0].qty, 2, 'replay snapshots are defensive copies');
  feed.setDepthRecording(false);
  socket.message({ e: 'depthUpdate', U: 1004, u: 1004, pu: 1003, b: [['100', '1']], a: [] });
  assert.equal(feed.getDepthHistoryInfo().count, 2, 'stopped capture must not retain further updates');
  assert.equal(feed.getDepthHistoryInfo().recording, false);
  feed.disconnect();
});


test('backfills bounded COIN-M aggregate trades into per-minute historical footprints', async () => {
  FakeSocket.reset();
  const now = 1700003600000;
  const start = now - 180000;
  const urls = [];
  const fetchImpl = async url => {
    urls.push(url);
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/dapi/v1/aggTrades')) {
      const params = parsed.searchParams;
      if (params.has('startTime')) {
        return response([
          { a: 10, p: '100', q: '2', T: start, m: false, f: 10, l: 10 },
          { a: 11, p: '100', q: '3', T: start + 60000, m: true, f: 11, l: 11 }
        ]);
      }
      return response([
        { a: 12, p: '101', q: '4', T: start + 120000, m: false, f: 12, l: 12 }
      ]);
    }
    return createFetch()(url);
  };
  const { feed } = createFeed({ fetchImpl, options: { now: () => now } });
  const result = await feed.backfillFootprintHistory({ startTime: start, endTime: now - 1, maxPages: 5, maxTrades: 20, limit: 2 });
  assert.equal(result.tradesCount, 3);
  assert.equal(result.truncated, false);
  assert.equal(result.minutes.length, 3);
  assert.equal(result.footprints.reduce((sum, item) => sum + item.totalQty, 0), 9);
  assert.equal(result.footprints[0].source, 'Binance REST backfill');
  assert.equal(urls.filter(url => url.includes('/aggTrades')).length, 2);
  assert.match(urls[0], /startTime=/);
  assert.match(urls[1], /fromId=12/);
});

test('backfill rejects ranges outside Binance 48-hour history and configured retention', async () => {
  FakeSocket.reset();
  const now = 1700003600000;
  const { feed } = createFeed({ options: { now: () => now, maxFootprintMinutes: 120 } });
  await assert.rejects(feed.backfillFootprintHistory({ startTime: now - 49 * 3600000, endTime: now - 1 }), /most recent 48 hours/);
  await assert.rejects(feed.backfillFootprintHistory({ minutes: 121 }), /limited to 120 minutes/);
});
