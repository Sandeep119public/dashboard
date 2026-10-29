import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { zipCsvEntries, zipEntryStream } from '../src/ingestion/zip-reader.js';
import { PackedTradeRows } from '../src/data/packed-trade-rows.js';
import { aggregateDay } from '../src/data/day-aggregator.js';
import { readTradeFiles } from '../src/app/import-controller.js';

const html = readFileSync(new URL('../BTCUSD_Market_Mechanics_Lab_Fixed.html', import.meta.url), 'utf8');
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.match(html, /<script type="module">/);
assert.match(html, /<title>BTCUSD Market Mechanics Lab<\/title>/);
assert.doesNotMatch(html, /\b(?:yieldToUi|axisHoverTime|studioCards)\s*=|function\s+(?:sum|ema)\s*\(/);
assert.doesNotMatch(html, /Accuracy-Fixed Edition/);
assert.match(index, /BTCUSD_Market_Mechanics_Lab_Fixed\.html/);
assert.match(html, /import \{ readTradeFiles \} from '\.\/src\/app\/import-controller\.js'/);
assert.doesNotMatch(html, /import \{ (?:zipCsvEntries|PackedTradeRows|parseCsvStreamByDay)/);
assert.match(html, /window\.DATA = DATA;/);
assert.match(html, /name="description"/);
assert.match(html, /:focus-visible/);
assert.match(html, /safe-area-inset-bottom/);

function makeZip({ name = 'trades.csv', localName = name, comment = Buffer.alloc(0), data = 'timestamp,price,size,buyer_role,product_symbol\n2026-08-01 00:00:00,60000,1,taker,BTCUSD\n' } = {}) {
  const filename = Buffer.from(name);
  const localFilename = Buffer.from(localName);
  const payload = Buffer.from(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(payload.length, 18);
  local.writeUInt32LE(payload.length, 22);
  local.writeUInt16LE(localFilename.length, 26);
  const localRecord = Buffer.concat([local, localFilename, payload]);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt32LE(payload.length, 20);
  central.writeUInt32LE(payload.length, 24);
  central.writeUInt16LE(filename.length, 28);
  central.writeUInt32LE(0, 42);
  const centralRecord = Buffer.concat([central, filename]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralRecord.length, 12);
  eocd.writeUInt32LE(localRecord.length, 16);
  eocd.writeUInt16LE(comment.length, 20);
  return Buffer.concat([localRecord, centralRecord, eocd, comment]);
}

function asFile(bytes, name = 'sample.zip') {
  const blob = new Blob([bytes]);
  Object.defineProperty(blob, 'name', { value: name });
  return blob;
}

test('accepts a standard ZIP containing one CSV entry', async () => {
  const entries = await zipCsvEntries(asFile(makeZip()));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, 'trades.csv');
  assert.equal(entries[0].method, 0);
  assert.ok(entries[0].uncompSize > 0);
});

test('rejects a ZIP with no CSV entries', async () => {
  await assert.rejects(zipCsvEntries(asFile(makeZip({ name: 'readme.txt' }))), /No \.csv file found/);
});

test('rejects a central directory whose declared size is too short', async () => {
  const bytes = makeZip();
  const eocdOffset = bytes.length - 22;
  bytes.writeUInt32LE(1, eocdOffset + 12);
  await assert.rejects(zipCsvEntries(asFile(bytes)), /exceeds the declared directory size|overlaps its end record/);
});

test('rejects ZIP64 sentinel values with a useful error', async () => {
  const bytes = makeZip();
  const eocdOffset = bytes.length - 22;
  bytes.writeUInt16LE(0xffff, eocdOffset + 8);
  bytes.writeUInt16LE(0xffff, eocdOffset + 10);
  await assert.rejects(zipCsvEntries(asFile(bytes)), /ZIP64 archives are not supported/);
});

test('rejects an archive with a missing end-of-central-directory record', async () => {
  const bytes = makeZip().subarray(0, -22);
  await assert.rejects(zipCsvEntries(asFile(bytes)), /Could not read ZIP directory/);
});

test('sorts unordered trade rows without separating timestamp and trade fields', () => {
  const rows = new PackedTradeRows(2);
  rows.push(30, 300, 3, 1);
  rows.push(10, 100, 1, 0);
  rows.push(20, 200, 2, 1);
  rows.sortByTimestamp();
  assert.deepEqual(Array.from({ length: rows.length }, (_, i) => [
    rows.get(i, 0), rows.get(i, 1), rows.get(i, 2), rows.get(i, 3)
  ]), [[10, 100, 1, 0], [20, 200, 2, 1], [30, 300, 3, 1]]);
});

test('grows the packed trade buffer while preserving existing rows', () => {
  const rows = new PackedTradeRows(1);
  for (let i = 0; i < 17000; i++) rows.push(i, 60000 + i, 1, i % 2);
  assert.equal(rows.length, 17000);
  assert.equal(rows.get(0, 1), 60000);
  assert.equal(rows.get(16999, 1), 76999);
  assert.equal(rows.get(16999, 3), 1);
});

test('ignores a false end-record signature inside a valid ZIP comment', async () => {
  const comment = Buffer.from([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0]);
  const entries = await zipCsvEntries(asFile(makeZip({ comment })));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, 'trades.csv');
});

test('streams a stored CSV only after validating the local filename and directory bounds', async () => {
  const file = asFile(makeZip());
  const entries = await zipCsvEntries(file);
  const stream = await zipEntryStream(file, entries[0]);
  const body = await new Response(stream).text();
  assert.match(body, /2026-08-01 00:00:00,60000,1,taker,BTCUSD/);
});

test('rejects a local header filename that differs from the central directory', async () => {
  const file = asFile(makeZip({ name: 'trades.csv', localName: 'other.csv' }));
  const entries = await zipCsvEntries(file);
  await assert.rejects(zipEntryStream(file, entries[0]), /local filename does not match/);
});

test('rejects a compressed payload range that overlaps the central directory', async () => {
  const bytes = makeZip();
  const eocdOffset = bytes.length - 22;
  const directoryOffset = bytes.readUInt32LE(eocdOffset + 16);
  bytes.writeUInt32LE(bytes.length, directoryOffset + 20);
  const file = asFile(bytes);
  const entries = await zipCsvEntries(file);
  await assert.rejects(zipEntryStream(file, entries[0]), /Compressed data bounds are invalid/);
});


test('aggregates trade rows into stable OHLCV bars and signed flow', () => {
  const rows = new PackedTradeRows(4);
  rows.push(120, 60100, 2, 1);
  rows.push(60, 60000, 3, 0);
  rows.push(180, 60050, 4, 1);
  const result = aggregateDay('2026-08-01', rows, false, {'1m': 60}, ['tiny']);
  assert.equal(result.metrics.row_count, 3);
  assert.equal(result.metrics.start_price, 60000);
  assert.equal(result.metrics.end_price, 60050);
  assert.equal(result.metrics.total_size, 9);
  assert.equal(result.metrics.buy_size, 6);
  assert.equal(result.metrics.sell_size, 3);
  assert.equal(result.bars['1m'].o[0], 60000);
  assert.equal(result.bars['1m'].h[1], 60100);
  assert.equal(result.bars['1m'].l[1], 60100);
  assert.equal(result.bars['1m'].l[2], 60050);
  assert.equal(result.bars['1m'].c[2], 60050);
  assert.equal(result.bars['1m'].v[0], 3);
  assert.equal(result.bars['1m'].d[1], 2);
  assert.deepEqual(result.hist_labels, ['tiny']);
});

const sampleCsv = [
  'product_symbol,price,size,timestamp,buyer_role',
  'BTCUSD,60000,2,2026-08-01 00:00:00,taker',
  'BTCUSD,60002,3,2026-08-01 00:00:30,maker',
  'BTCUSD,60001,4,2026-08-02 00:00:00,taker'
].join('\n') + '\n';

test('CSV parser normalizes timestamp offsets and validates date boundaries', async () => {
  const { parseTradeTimestamp } = await import('../src/ingestion/csv-parser.js');
  assert.deepEqual(parseTradeTimestamp('2026-08-01 01:00:00+01:00'), { date: '2026-08-01', sec: 0 });
  assert.deepEqual(parseTradeTimestamp('2026-08-01 00:00:00Z'), { date: '2026-08-01', sec: 0 });
  assert.throws(() => parseTradeTimestamp('2026-02-30 00:00:00'), /Invalid calendar date/);
});

test('CSV parser aggregates sorted rows by date and preserves OHLCV and signed flow', async () => {
  const { parseCsvByDay } = await import('../src/ingestion/csv-parser.js');
  const days = parseCsvByDay(sampleCsv);
  assert.deepEqual([...days.keys()], ['2026-08-01', '2026-08-02']);
  const day = days.get('2026-08-01');
  assert.equal(day.metrics.row_count, 2);
  assert.equal(day.bars['1m'].o[0], 60000);
  assert.equal(day.bars['1m'].h[0], 60002);
  assert.equal(day.bars['1m'].l[0], 60000);
  assert.equal(day.bars['1m'].c[0], 60002);
  assert.equal(day.bars['1m'].v[0], 5);
  assert.equal(day.bars['1m'].d[0], -1);
});

test('CSV parser rejects malformed roles, wrong symbols and missing columns', async () => {
  const { parseCsvByDay } = await import('../src/ingestion/csv-parser.js');
  assert.throws(() => parseCsvByDay(sampleCsv.replace(',maker\n', ',unknown\n')), /Unknown buyer_role/);
  assert.throws(() => parseCsvByDay(sampleCsv.replace('BTCUSD,60000', 'ETHUSD,60000')), /for BTCUSD/);
  assert.throws(() => parseCsvByDay('price,size,timestamp\n60000,1,2026-08-01 00:00:00\n'), /needs price, size, timestamp and buyer_role/);
});

test('streaming CSV parser handles chunk boundaries across headers and rows', async () => {
  const { parseCsvStreamByDay } = await import('../src/ingestion/csv-parser.js');
  const encoder = new TextEncoder();
  const chunks = [sampleCsv.slice(0, 11), sampleCsv.slice(11, 49), sampleCsv.slice(49, 88), sampleCsv.slice(88)].map(s => encoder.encode(s));
  const stream = new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); } });
  const days = await parseCsvStreamByDay(stream, 'fixture.csv', null, () => false);
  assert.deepEqual([...days.keys()], ['2026-08-01', '2026-08-02']);
  assert.equal(days.get('2026-08-01').metrics.row_count, 2);
});

test('CSV parser preserves quoted commas in unused columns', async () => {
  const { parseCsvByDay } = await import('../src/ingestion/csv-parser.js');
  const csv = 'product_symbol,price,size,timestamp,buyer_role,note\nBTCUSD,60000,1,2026-08-01 00:00:00,taker,"large, normal print"\n';
  const days = parseCsvByDay(csv);
  assert.equal(days.get('2026-08-01').metrics.row_count, 1);
});

test('streaming CSV parser honors injected cancellation', async () => {
  const { parseCsvStreamByDay } = await import('../src/ingestion/csv-parser.js');
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(sampleCsv)); } });
  await assert.rejects(parseCsvStreamByDay(stream, 'fixture.csv', null, () => true), /Import cancelled by user/);
});


test('import controller reads CSV files and reports progress without DOM access', async () => {
  const events = [];
  const file = new Blob([sampleCsv]);
  Object.defineProperty(file, 'name', { value: 'fixture.csv' });
  const days = await readTradeFiles([file], {
    barSteps: { '1m': 60 },
    histLabels: ['tiny'],
    onProgress: event => events.push(event)
  });
  assert.deepEqual([...days.keys()], ['2026-08-01', '2026-08-02']);
  assert.equal(days.get('2026-08-01').metrics.row_count, 2);
  assert.ok(events.some(event => event.type === 'csv' && event.fileName === 'fixture.csv'));
});

test('import controller rejects overlapping dates in a single batch', async () => {
  const a = new Blob([sampleCsv]); Object.defineProperty(a, 'name', { value: 'a.csv' });
  const b = new Blob([sampleCsv]); Object.defineProperty(b, 'name', { value: 'b.csv' });
  await assert.rejects(readTradeFiles([a, b], { barSteps: { '1m': 60 }, histLabels: ['tiny'] }), /More than one selected file contains 2026-08-01/);
});

test('import controller honors cancellation before reading the next file', async () => {
  const file = new Blob([sampleCsv]); Object.defineProperty(file, 'name', { value: 'fixture.csv' });
  await assert.rejects(readTradeFiles([file], { shouldCancel: () => true }), /Import cancelled by user/);
});


test('import controller streams CSV entries from ZIP archives', async () => {
  const events = [];
  const file = asFile(makeZip(), 'controller.zip');
  const days = await readTradeFiles([file], {
    barSteps: { '1m': 60 },
    histLabels: ['tiny'],
    onProgress: event => events.push(event)
  });
  assert.deepEqual([...days.keys()], ['2026-08-01']);
  assert.equal(days.get('2026-08-01').metrics.row_count, 1);
  assert.ok(events.some(event => event.type === 'entry' && event.entryName === 'trades.csv'));
});
