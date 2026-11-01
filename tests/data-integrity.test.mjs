// Data-integrity and import-robustness coverage for the workstation hardening pass.
// Every test builds its own deterministic fixture so counts, volumes, CVD, OHLC,
// profiles, bucket boundaries and events can be checked by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCsvByDay,
  parseCsvStreamByDay,
  createCsvDayParser,
  looksLikeHeader,
  inferHeaderlessLayout,
  parseRole
} from '../src/ingestion/csv-parser.js';
import { readTradeFiles } from '../src/app/import-controller.js';
import { PackedTradeRows } from '../src/data/packed-trade-rows.js';
import { aggregateDay } from '../src/data/day-aggregator.js';
import {
  workspaceMeta,
  workspaceJsonText,
  createWorkspaceJsonStream,
  workspaceStreamText
} from '../src/app/workspace-export.js';

const close = (actual, expected, message) => {
  assert.ok(Math.abs(actual - expected) < 1e-9, message + ' (expected ' + expected + ', got ' + actual + ')');
};
const readStream = text => new Response(text).body;
const readAll = async stream => {
  const text = await new Response(stream).text();
  return JSON.parse(text);
};

test('headerless four-column exports are accepted and classified', () => {
  const csv = [
    '50000.5,1.25,2026-08-01 00:00:00,taker',
    '50001.5,0.75,2026-08-01 00:00:01,maker'
  ].join('\n');
  const days = parseCsvByDay(csv, { barSteps: { '1m': 60 }, histLabels: ['tiny'] });
  assert.equal(days.size, 1);
  const day = days.get('2026-08-01');
  assert.equal(day.metrics.row_count, 2);
  close(day.metrics.buy_size, 1.25);
  close(day.metrics.sell_size, 0.75);
  close(day.metrics.total_size, 2);
  close(day.metrics.delta, 0.5);
  const bar = day.bars['1m'];
  close(bar.o[0], 50000.5);
  close(bar.h[0], 50001.5);
  close(bar.l[0], 50000.5);
  close(bar.c[0], 50001.5);
  assert.equal(bar.n[0], 2);
});

test('headerless five-column exports with BTCUSDT and BTCUSD_PERP are accepted', () => {
  for (const symbol of ['BTCUSDT', 'BTCUSD_PERP']) {
    const csv = [
      symbol + ',50000,2,2026-08-01 00:00:00,buy',
      symbol + ',49999,1,2026-08-01 00:00:02,sell'
    ].join('\n');
    const days = parseCsvByDay(csv, { acceptedSymbols: ['BTCUSD', 'BTCUSDT', 'BTCUSD_PERP'] });
    const day = days.get('2026-08-01');
    assert.equal(day.metrics.row_count, 2, symbol);
    close(day.metrics.buy_size, 2, symbol);
    close(day.metrics.sell_size, 1, symbol);
    close(day.metrics.delta, 1, symbol);
  }
});


test('canonical five-column fast parser accepts maker/taker and buy/sell role aliases', () => {
  const csv = [
    'product_symbol,price,size,timestamp,buyer_role',
    'BTCUSD,60000,3,2026-08-01 10:00:00,buy',
    'BTCUSD,59999,2,2026-08-01 10:00:01,sell',
    'BTCUSD,60001,5,2026-08-01 10:00:02, BUY ',
    'BTCUSD,59998,7,2026-08-01 10:00:03, Sell ',
    'BTCUSD,60002,13,2026-08-01 10:00:04,taker',
    'BTCUSD,59997,11,2026-08-01 10:00:05,maker'
  ].join('\\n');
  const day = parseCsvByDay(csv).get('2026-08-01');
  assert.equal(day.metrics.row_count, 6);
  close(day.metrics.buy_size, 21);
  close(day.metrics.sell_size, 20);
  close(day.metrics.delta, 1);
});

test('explicit symbol columns reject blank values in fast and general parser layouts', () => {
  const fastHeader = 'product_symbol,price,size,timestamp,buyer_role';
  assert.throws(
    () => parseCsvByDay([fastHeader, ',60000,1,2026-08-01 00:00:00,taker'].join('\\n')),
    /Missing product symbol at CSV row 2/
  );
  assert.throws(
    () => parseCsvByDay([fastHeader, 'BTCUSD,60000,1,2026-08-01 00:00:00,taker', '   ,60001,1,2026-08-01 00:00:01,maker'].join('\\n')),
    /Missing product symbol at CSV row 3/
  );

  const generalHeader = 'price,size,timestamp,buyer_role,symbol';
  assert.throws(
    () => parseCsvByDay([generalHeader, '60000,1,2026-08-01 00:00:00,taker,   '].join('\\n')),
    /Missing product symbol at CSV row 2/
  );
  assert.throws(
    () => parseCsvByDay([generalHeader, '60000,1,2026-08-01 00:00:00,taker,BTCUSD', '60001,1,2026-08-01 00:00:01,maker,'].join('\\n')),
    /Missing product symbol at CSV row 3/
  );
});

test('explicit symbol columns accept only configured BTC symbols', () => {
  const header = 'product_symbol,price,size,timestamp,buyer_role';
  const acceptedSymbols = ['BTCUSD', 'BTCUSDT', 'BTCUSD_PERP'];
  for (const symbol of acceptedSymbols) {
    const day = parseCsvByDay([
      header,
      symbol + ',60000,1,2026-08-01 00:00:00,taker'
    ].join('\\n'), { acceptedSymbols }).get('2026-08-01');
    assert.equal(day.metrics.row_count, 1, symbol);
  }
  assert.throws(
    () => parseCsvByDay([header, 'ETHUSD,60000,1,2026-08-01 00:00:00,taker'].join('\\n'), { acceptedSymbols }),
    /CSV row 2 has product_symbol="ETHUSD"/
  );
});

test('column aliases (side, qty, time, symbol) map to the canonical fields', () => {
  const csv = [
    'symbol,price,qty,time,side',
    'BTCUSD,60000,3,2026-08-01 10:00:00,taker',
    'BTCUSD,60001,1,2026-08-01 10:00:30,maker'
  ].join('\n');
  const day = parseCsvByDay(csv).get('2026-08-01');
  assert.equal(day.metrics.row_count, 2);
  close(day.metrics.total_size, 4);
  close(day.metrics.buy_size, 3);
  close(day.metrics.sell_size, 1);
});

test('repeated header blocks in concatenated daily exports are skipped', () => {
  const header = 'product_symbol,price,size,timestamp,buyer_role';
  const csv = [
    header,
    'BTCUSD,100,1,2026-08-01 00:00:00,taker',
    header,
    'BTCUSD,101,2,2026-08-01 00:00:01,maker',
    header,
    'BTCUSD,102,3,2026-08-02 00:00:00,taker'
  ].join('\n');
  const days = parseCsvByDay(csv);
  assert.deepEqual([...days.keys()], ['2026-08-01', '2026-08-02']);
  assert.equal(days.get('2026-08-01').metrics.row_count, 2);
  assert.equal(days.get('2026-08-02').metrics.row_count, 1);
});

test('empty, whitespace-only and corrupt inputs fail with actionable messages', async () => {
  assert.throws(() => parseCsvByDay(''), /No valid trade rows/);
  assert.throws(() => parseCsvByDay('\n\n   \n'), /No valid trade rows/);
  assert.throws(
    () => parseCsvByDay('not,a,valid,header\n1,2,3,4'),
    /must contain the price, size, timestamp, and buyer_role columns/
  );
  assert.throws(
    () => parseCsvByDay('price,size,timestamp,buyer_role\n60000,abc,2026-08-01 00:00:00,taker'),
    /Invalid size at CSV row 2/
  );
  assert.throws(
    () => parseCsvByDay('price,size,timestamp,buyer_role\n60000,1,2026-08-01 00:00:00,sideways'),
    /Unknown buyer_role "sideways"/
  );
  assert.throws(
    () => parseCsvByDay('price,size,timestamp,buyer_role\n60000,1,not-a-time,taker'),
    /Invalid timestamp/
  );
  assert.throws(
    () => parseCsvByDay('product_symbol,price,size,timestamp,buyer_role\nETHUSD,1,1,2026-08-01 00:00:00,taker'),
    /for BTCUSD/
  );
  assert.throws(
    () => parseCsvByDay('product_symbol,price,size,timestamp,buyer_role\nBTCUSD,1,1,2026-08-01 00:00:00,taker\nETHUSD,1,1,2026-08-01 00:00:01,taker'),
    /Mixed or different symbols are not combined/
  );
});

test('header and headerless detection helpers agree on canonical layouts', () => {
  assert.equal(parseRole('TAKER'), 1);
  assert.equal(parseRole('buy'), 1);
  assert.equal(parseRole('maker'), 0);
  assert.equal(parseRole('Sell'), 0);
  assert.equal(parseRole('other'), -1);
  assert.equal(looksLikeHeader(['product_symbol', 'price', 'size', 'timestamp', 'buyer_role']), true);
  assert.equal(looksLikeHeader(['BTCUSD', '50000', '1', '2026-08-01 00:00:00', 'taker']), false);
  const inferred = inferHeaderlessLayout(['BTCUSD', '50000', '1.5', '2026-08-01 00:00:00', 'taker'], ['BTCUSD']);
  assert.deepEqual(inferred, { price: 1, size: 2, timestamp: 3, role: 4, product: 0 });
});

test('streaming import reports monotonic byte progress and a final total', async () => {
  const lines = ['price,size,timestamp,buyer_role'];
  for (let i = 0; i < 5000; i++) {
    lines.push('60000,' + (i % 7 + 1) + ',2026-08-01 00:00:0' + (i % 10) + ',taker');
  }
  const csv = lines.join('\n');
  const totalBytes = Buffer.byteLength(csv);
  const reports = [];
  const days = await parseCsvStreamByDay(readStream(csv), 'fixture.csv', null, () => false, {
    barSteps: { '1m': 60 },
    histLabels: ['tiny'],
    totalBytes,
    onBytes: (bytesRead, total, name, rows) => reports.push({ bytesRead, total, name, rows })
  });
  assert.equal(days.get('2026-08-01').metrics.row_count, 5000);
  assert.ok(reports.length >= 1);
  const last = reports[reports.length - 1];
  assert.equal(last.bytesRead, totalBytes);
  assert.equal(last.total, totalBytes);
  assert.equal(last.name, 'fixture.csv');
  assert.equal(last.rows, 5000);
  for (let i = 1; i < reports.length; i++) {
    assert.ok(reports[i].bytesRead >= reports[i - 1].bytesRead, 'byte progress must be monotonic');
  }
});

test('cancellation stops the stream without returning partial days', async () => {
  const lines = ['price,size,timestamp,buyer_role'];
  for (let i = 0; i < 40000; i++) {
    lines.push('60000,1,2026-08-01 00:00:00,taker');
  }
  let calls = 0;
  await assert.rejects(
    parseCsvStreamByDay(readStream(lines.join('\n')), 'big.csv', null, () => ++calls > 0, {}),
    /Import cancelled by user/
  );
});

test('duplicate timestamps are preserved and aggregated exactly once each', () => {
  const csv = [
    'price,size,timestamp,buyer_role',
    '100,1,2026-08-01 00:00:00,taker',
    '100,1,2026-08-01 00:00:00,taker',
    '100,1,2026-08-01 00:00:00,maker',
    '101,2,2026-08-01 00:00:00,taker'
  ].join('\n');
  const day = parseCsvByDay(csv).get('2026-08-01');
  assert.equal(day.metrics.row_count, 4);
  close(day.metrics.total_size, 5);
  close(day.metrics.buy_size, 4);
  close(day.metrics.sell_size, 1);
  close(day.metrics.delta, 3);
  const bar = day.bars['1m'];
  assert.equal(bar.t.length, 1);
  assert.equal(bar.n[0], 4);
  close(bar.v[0], 5);
  close(bar.o[0], 100);
  close(bar.c[0], 101);
  close(bar.h[0], 101);
  close(bar.l[0], 100);
});

test('out-of-order prints are sorted without changing totals', () => {
  const csv = [
    'price,size,timestamp,buyer_role',
    '103,1,2026-08-01 00:02:00,maker',
    '101,2,2026-08-01 00:00:30,taker',
    '102,3,2026-08-01 00:01:15,taker'
  ].join('\n');
  const day = parseCsvByDay(csv).get('2026-08-01');
  const bars = day.bars['1m'];
  assert.deepEqual(bars.t, [0, 60, 120]);
  assert.deepEqual(bars.c, [101, 102, 103]);
  close(day.metrics.total_size, 6);
  close(day.metrics.buy_size, 5);
  close(day.metrics.sell_size, 1);
  close(day.metrics.start_price, 101);
  close(day.metrics.end_price, 103);
  // Replay order: the packed rows must be chronological after aggregation.
  const rows = new PackedTradeRows();
  rows.push(120, 103, 1, 0);
  rows.push(0, 101, 2, 1);
  rows.push(60, 102, 3, 1);
  rows.sortByTimestamp();
  assert.deepEqual([rows.get(0, 0), rows.get(1, 0), rows.get(2, 0)], [0, 60, 120]);
});

test('midnight and month boundaries split days correctly', () => {
  const csv = [
    'price,size,timestamp,buyer_role',
    '100,1,2026-08-31 23:59:59,taker',
    '101,2,2026-09-01 00:00:00,maker',
    '102,3,2026-09-01 23:59:59,taker',
    '103,4,2026-10-01 00:00:00,taker'
  ].join('\n');
  const days = parseCsvByDay(csv);
  assert.deepEqual([...days.keys()], ['2026-08-31', '2026-09-01', '2026-10-01']);
  assert.equal(days.get('2026-08-31').metrics.row_count, 1);
  assert.equal(days.get('2026-09-01').metrics.row_count, 2);
  assert.equal(days.get('2026-10-01').metrics.row_count, 1);
  assert.equal(days.get('2026-09-01').bars['1m'].t.length, 2);
});

test('interleaved dates are rejected instead of silently merged', () => {
  const csv = [
    'price,size,timestamp,buyer_role',
    '100,1,2026-08-01 00:00:00,taker',
    '101,1,2026-08-02 00:00:00,taker',
    '102,1,2026-08-01 00:00:01,taker'
  ].join('\n');
  assert.throws(() => parseCsvByDay(csv), /not contiguous/);
});

test('missing intervals leave gaps instead of synthesised bars', () => {
  const csv = [
    'price,size,timestamp,buyer_role',
    '100,1,2026-08-01 00:00:10,taker',
    '101,1,2026-08-01 00:05:10,maker'
  ].join('\n');
  const day = parseCsvByDay(csv).get('2026-08-01');
  assert.deepEqual(day.bars['1m'].t, [0, 300]);
  assert.equal(day.bars['5m'].t.length, 2);
  assert.equal(day.metrics.row_count, 2);
});

test('OHLC, CVD, profile and histogram boundaries are internally consistent', () => {
  const rows = new PackedTradeRows();
  const prints = [
    [0, 100, 5, 1],
    [0, 99, 3, 0],
    [10, 104, 9, 1],
    [20, 103, 24, 0],
    [30, 102, 49, 1],
    [40, 105, 99, 1],
    [50, 101, 219, 0],
    [59, 106, 671, 1],
    [60, 107, 672, 0],
    [120, 108, 999, 1],
    [180, 109, 1999, 0],
    [240, 110, 2000, 1]
  ];
  for (const print of prints) rows.push(...print);
  const day = aggregateDay('2026-08-01', rows, true, { '1m': 60 }, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']);
  const bar = day.bars['1m'];
  assert.deepEqual(bar.t, [0, 60, 120, 180, 240]);
  close(bar.o[0], 100);
  close(bar.h[0], 106);
  close(bar.l[0], 99);
  close(bar.c[0], 106);
  close(bar.v[0], 5 + 3 + 9 + 24 + 49 + 99 + 219 + 671);
  assert.equal(bar.n[0], 8);
  close(bar.b[0], 5 + 9 + 49 + 99 + 671);
  close(bar.s[0], 3 + 24 + 219);
  close(bar.d[0], bar.b[0] - bar.s[0]);
  // Profile buckets are floor(price/5); 99 and 100 land in adjacent buckets.
  const bucketFor = (price, minute = 0) => {
    const index = day.profile.m.findIndex((m, i) => m === minute && day.profile.p[i] === Math.floor(price / 5));
    return index < 0 ? null : day.profile.v[index];
  };
  close(bucketFor(100), 5 + 9 + 24 + 49 + 219); // prices 100-104 share a bucket
  close(bucketFor(99), 3);
  close(bucketFor(105), 99 + 671); // prices 105-106 share the next bucket
  // Histogram bucket boundaries (minute 0): 9/10, 24/25, 49/50, 99/100,
  // 219/220, 671/672, 999/1k, 1999/2k.
  assert.deepEqual(day.hist.slice(0, 9), [3, 1, 1, 1, 1, 1, 0, 0, 0]);
  assert.deepEqual(day.hist.slice(9, 18), [0, 0, 0, 0, 0, 0, 1, 0, 0]); // size 672
  assert.deepEqual(day.hist.slice(18, 27), [0, 0, 0, 0, 0, 0, 1, 0, 0]); // size 999
  assert.deepEqual(day.hist.slice(27, 36), [0, 0, 0, 0, 0, 0, 0, 1, 0]); // size 1999
  assert.deepEqual(day.hist.slice(36, 45), [0, 0, 0, 0, 0, 0, 0, 0, 1]); // size 2000
  // Every print at or above 220 becomes an event, exactly once.
  assert.equal(day.events.s.length, 5);
  assert.deepEqual(day.events.s, [671, 672, 999, 1999, 2000]);
  close(day.metrics.max_size, 2000);
  close(day.metrics.total_size, prints.reduce((sum, print) => sum + print[2], 0));
});

test('large-trade follow-through is measured only inside the 30 second tolerance', () => {
  const rows = new PackedTradeRows();
  rows.push(0, 100, 300, 1); // event, +60s print within tolerance
  rows.push(60, 101, 1, 1);
  rows.push(120, 102, 300, 0); // event, +60s print 50s later -> null
  rows.push(230, 103, 1, 1);
  const day = aggregateDay('2026-08-01', rows, true, { '1m': 60 }, ['tiny']);
  assert.equal(day.events.s.length, 2);
  close(day.events.r1[0], (101 / 100 - 1) * 100);
  assert.equal(day.events.r1[1], null);
  assert.equal(day.events.r5[0], null);
  assert.equal(day.events.r15[0], null);
});

test('readTradeFiles accepts CSV and ZIP selections and rejects overlaps', async () => {
  const csv = 'price,size,timestamp,buyer_role\n100,1,2026-08-01 00:00:00,taker\n';
  const file = new File([csv], 'one.csv', { type: 'text/csv' });
  const days = await readTradeFiles([file], { acceptedSymbols: ['BTCUSD', 'BTCUSDT', 'BTCUSD_PERP'] });
  assert.equal(days.size, 1);
  await assert.rejects(readTradeFiles([file, file], {}), /More than one selected file contains trades for 2026-08-01/);
  await assert.rejects(readTradeFiles([], {}), /No CSV or ZIP trade files were found/);
});

test('workspace export carries optional view state and stays backward compatible', async () => {
  const rows = new PackedTradeRows();
  rows.push(0, 100, 1, 1);
  const day = aggregateDay('2026-08-01', rows, true, { '1m': 60 }, ['tiny']);
  const days = new Map([['2026-08-01', day]]);
  const view = { activeChart: 'cvdChart', filters: { tf: '1m' }, focus: 42 };
  const meta = workspaceMeta('2026-08-01T00:00:00.000Z', view);
  const text = workspaceJsonText(days, meta);
  const doc = JSON.parse(text);
  assert.deepEqual(doc.view, view);
  assert.equal(doc.format, 'BTCUSD-Market-Mechanics-Lab');
  const streamed = await readAll(createWorkspaceJsonStream(days, meta));
  assert.deepEqual(streamed.view, view);
  assert.deepEqual(streamed.days, doc.days);
  const plain = JSON.parse(workspaceJsonText(days));
  assert.equal(plain.view, undefined);
  const plainStream = await readAll(createWorkspaceJsonStream(days));
  assert.equal(plainStream.view, undefined);
  assert.equal(await workspaceStreamText(days, meta), workspaceJsonText(days, meta));
});

test('a parser can be reused across many pushed lines without leaking state', () => {
  const parser = createCsvDayParser({ barSteps: { '1m': 60 }, histLabels: ['tiny'] });
  parser.pushLine('price,size,timestamp,buyer_role');
  parser.pushLine('100,1,2026-08-01 00:00:00,taker');
  parser.pushLine('101,1,2026-08-01 00:00:01,maker');
  const days = parser.finish();
  assert.equal(parser.rowCount, 2);
  assert.equal(parser.lineNo, 3);
  assert.equal(days.get('2026-08-01').metrics.row_count, 2);
});
