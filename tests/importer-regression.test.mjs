import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipCsvEntries, zipEntryStream } from '../src/ingestion/zip-reader.js';
import { PackedTradeRows } from '../src/data/packed-trade-rows.js';
import { aggregateDay } from '../src/data/day-aggregator.js';
import { readTradeFiles } from '../src/app/import-controller.js';
import { createWorkspaceJsonStream, workspaceJsonText, workspaceMeta, workspaceStreamText } from '../src/app/workspace-export.js';
import { bindMobileQuickActions } from '../src/ui/mobile-quick-actions.js';
import { createLatestRenderQueue } from '../src/charts/latest-render-queue.js';
import { createBarSubsetter } from '../src/charts/bar-subsetter.js';
import { createChartSeriesMath } from '../src/charts/series-math.js';
import { createLeadLagCalculator, computeLeadLag } from '../src/charts/lead-lag.js';
import { createLeadLagEngine } from '../src/charts/lead-lag-engine.js';

const html = readFileSync(new URL('../BTCUSD_Market_Mechanics_Lab_Fixed.html', import.meta.url), 'utf8');
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const serviceWorker = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const repoRoot = fileURLToPath(new URL('../', import.meta.url));
assert.doesNotMatch(serviceWorker, /cacheIfSuccessful/, 'do not reintroduce the unused service-worker helper');
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
assert.match(html, /location\.protocol!=='file:'/);
assert.match(html, /id='fileProtocolNotice'/);
assert.match(html, /safe-area-inset-right/);
assert.match(html, /\.panel-action\{min-height:44px;min-width:44px/);
assert.match(html, /id="stampDate">No data loaded</);
assert.match(html, /swHost==='localhost'/);
assert.match(html, /createWorkspaceJsonStream\(DAYS,meta\)/, 'workspace export must stream day JSON instead of building one large string');
assert.doesNotMatch(html, /const text=JSON\.stringify\(payload\)/);
assert.match(html, /file\.stream\(\)\.pipeThrough\(new DecompressionStream\('gzip'\)\)/, 'workspace import must stream gzip instead of buffering the file');
assert.match(html, /text=null;[\s\S]{0,500}doc=null;[\s\S]{0,200}rebuildCombined\(\)/, 'workspace import must release text and document before rebuilding combined arrays');
const cacheVersion = Number(/btc-mechanics-shell-v(\d+)/.exec(serviceWorker)?.[1]);
assert.ok(cacheVersion >= 23, 'service-worker cache version must be bumped for changed shell assets');

test('inline browser module parses as valid JavaScript', () => {
  const match = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  assert.ok(match, 'the inline module script must exist');
  const checkDir = mkdtempSync(resolve(tmpdir(), 'btc-mechanics-module-check-'));
  const checkPath = resolve(checkDir, 'dashboard-inline.mjs');
  try {
    writeFileSync(checkPath, match[1], 'utf8');
    execFileSync(process.execPath, ['--check', checkPath], { stdio: 'pipe' });
  } finally {
    rmSync(checkDir, { recursive: true, force: true });
  }
});

test('UI copy matches the empty-data state and avoids stale sample-date claims', () => {
  assert.ok(cacheVersion >= 23, 'changed UI shell requires a new service-worker cache version');
  assert.match(html, /id="startDate" type="date" value="" \/>/);
  assert.match(html, /id="endDate" type="date" value="" \/>/);
  assert.match(html, /id="dataStatus" class="data-status">No trade data loaded yet\. Add a daily CSV or ZIP file to begin\.<\/div>/);
  assert.doesNotMatch(html, /Loaded data: 2026-09-01 only|September 1, 2026 only|Only one date is embedded initially/);
  assert.match(html, /thresholdMax/);
  assert.match(html, /What this dataset cannot reveal/);
  assert.match(html, /The source may omit timezone metadata/);
  assert.match(html, /aria-label',expand\.title/);
  assert.doesNotMatch(html, /date summary\/summaries|day\(s\)|Import trade data|No \.CSV or \.ZIP trade files were found|name:'Buyer taker size'|name:'Buyer maker size'|Buyer is taker|Buyer is maker\*|EMA20 %\{y|EMA50 %\{y|Timestamp hour as supplied|CVD · selected-window cumulative|Weighted price %\{y/);
  assert.match(html, /name:'Buy-side proxy size'/);
  assert.match(html, /name:'Sell-side proxy size'/);
});


test('combined 10-second bars are built lazily and stay out of the eager rebuild', () => {
  assert.match(html, /const EAGER_TIMEFRAMES = \['1m','5m','15m','1h'\];/, 'eager timeframes must exclude 10-second bars');
  assert.match(html, /function buildCombinedBars\(tf\)/, 'lazy combined builder must exist');
  assert.match(html, /function ensureBars\(tf\)\{ if\(!B\[tf\]\) B\[tf\]=buildCombinedBars\(tf\); return B\[tf\]; \}/, 'ensureBars must build a missing timeframe on demand');
  assert.match(html, /const subsetBars = \(tf, window\) => \{ ensureBars\(tf\); return barSubsetter\.subsetBars\(tf, window\); \}/, 'subsetBars must resolve lazy timeframes');
  assert.match(html, /const bars=\{\};for\(const tf of EAGER_TIMEFRAMES\)/, 'eager rebuild must not build 10-second bars');
  assert.match(html, /const tf=\$\('tf'\)\.value,w=getWindow\(\),x=ensureBars\(tf\)/, 'bar export must resolve lazy timeframes');
  assert.match(html, /COMBINED_DATES=dates\.slice\(\)/, 'lazy builder must reuse the combined date order');
  assert.doesNotMatch(html, /B\['10s'\]/, 'nothing may read combined 10-second bars eagerly');
  assert.doesNotMatch(html, /for\(const tf of Object\.keys\(BAR_STEPS\)\)\{bars\[tf\]/, 'rebuild must iterate the eager list, not every step');
});

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
  await assert.rejects(zipCsvEntries(asFile(makeZip({ name: 'readme.txt' }))), /No CSV file was found/);
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
  assert.throws(() => parseCsvByDay('price,size,timestamp\n60000,1,2026-08-01 00:00:00\n'), /must contain the price, size, timestamp, and buyer_role columns/);
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

test('CSV parser handles CRLF, mixed case, duplicate seconds and fractional timestamps', async () => {
  const { parseCsvByDay, parseTradeTimestamp } = await import('../src/ingestion/csv-parser.js');
  const parsedStamp = parseTradeTimestamp('2026-08-01 00:00:00.123456');
  assert.equal(parsedStamp.date, '2026-08-01');
  assert.equal(parsedStamp.sec, 0.123456);

  const csv = [
    'product_symbol,price,size,timestamp,buyer_role',
    'btcusd,60000.10,1.5,2026-08-01 00:00:00.123456,TAKER',
    ' btcusd , 60000.20 , 2.5 , 2026-08-01 00:00:00.123456 , maker ',
    'BTCUSD,60001.50,300,2026-08-01 00:02:00.999999,taker'
  ].join('\r\n') + '\r\n';
  const day = parseCsvByDay(csv).get('2026-08-01');
  assert.equal(day.metrics.row_count, 3);
  assert.deepEqual(day.bars['1m'].t, [0, 120]);
  assert.equal(day.bars['1m'].n[0], 2);
  assert.equal(day.bars['1m'].c[0], 60000.2);
  assert.equal(day.bars['1m'].v[0], 4);
  assert.equal(day.bars['1m'].d[0], -1);
  assert.equal(day.metrics.minute_flow_return_corr, null);
  assert.equal(day.events.t[0], 120.999999);
});

test('CSV parser rejects malformed quoting, blank numbers and blank timestamps', async () => {
  const { parseCsvByDay } = await import('../src/ingestion/csv-parser.js');
  const header = 'product_symbol,price,size,timestamp,buyer_role,note\n';
  assert.throws(() => parseCsvByDay(header + 'BTCUSD,60000,1,2026-08-01 00:00:00,taker,"unterminated\n'), /Malformed CSV quoting/);
  assert.throws(() => parseCsvByDay(header + 'BTCUSD,,1,2026-08-01 00:00:00,taker,ok\n'), /Invalid price/);
  assert.throws(() => parseCsvByDay(header + 'BTCUSD,60000,,2026-08-01 00:00:00,taker,ok\n'), /Invalid size/);
  assert.throws(() => parseCsvByDay(header + 'BTCUSD,60000,1,,taker,ok\n'), /Missing timestamp/);
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
  await assert.rejects(readTradeFiles([a, b], { barSteps: { '1m': 60 }, histLabels: ['tiny'] }), /More than one selected file contains trades for 2026-08-01/);
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


function workspaceFixtureDays() {
  const day = date => ({
    metrics: { date, row_count: 3, start_price: 60000, end_price: 60001, return_pct: 0.0017, low: 59999, high: 60002, total_size: 6, buy_size: 4, sell_size: 2, delta: 2, imbalance_pct: 33.333, median_size: 1, p90: 3, p95: 3, p99: 3, max_size: 3, active_seconds_pct: 0.0035, minute_flow_return_corr: 0.12 },
    bars: { '1m': { t: [0, 60], o: [60000, 60001], h: [60002, 60003], l: [59999, 60000], c: [60001, 60002], v: [3, 3], n: [2, 1], b: [2, 2], s: [1, 1], d: [1, 1], pv: [180000, 180003] } },
    profile: { m: [0, 1], p: [12000, 12001], v: [2, 3], d: [1, -1] },
    hist: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    hist_labels: ['1–9', '10–24', '25–49', '50–99', '100–219', '220–671', '672–999', '1k–1.9k', '2k+'],
    events: { t: [0.5], p: [60000], s: [300], r: [1], r1: [0.1], r5: [null], r15: [null] }
  });
  return new Map([['2026-08-01', day('2026-08-01')], ['2026-08-02', day('2026-08-02')]]);
}

test('workspace export streams byte-identical JSON and gzip content', async () => {
  const days = workspaceFixtureDays();
  const meta = workspaceMeta('2026-10-29T00:00:00.000Z');
  const expected = JSON.stringify({ format: meta.format, version: meta.version, exported_at: meta.exported_at, days: [...days.entries()] });
  assert.equal(workspaceJsonText(days, meta), expected);
  assert.equal(await workspaceStreamText(days, meta), expected);
  const parsed = JSON.parse(expected);
  assert.equal(parsed.format, 'BTCUSD-Market-Mechanics-Lab');
  assert.equal(parsed.version, 1);
  assert.equal(parsed.days.length, 2);
  assert.equal(parsed.days[0][1].hist_labels[0], '1–9');
  const compressed = await new Response(createWorkspaceJsonStream(days, meta).pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  const roundTrip = await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  assert.equal(roundTrip, expected, 'streamed gzip must decompress to the exact legacy JSON text');
});

test('workspace export emits a valid empty payload', async () => {
  const meta = workspaceMeta('2026-10-29T00:00:00.000Z');
  const expected = JSON.stringify({ format: meta.format, version: meta.version, exported_at: meta.exported_at, days: [] });
  assert.equal(await workspaceStreamText(new Map(), meta), expected);
});

test('local JavaScript imports resolve and are included in the offline app shell', () => {
  const sourceFiles = [
    'BTCUSD_Market_Mechanics_Lab_Fixed.html',
    'src/app/import-controller.js',
    'src/app/workspace-export.js',
    'src/ui/mobile-quick-actions.js',
    'src/charts/latest-render-queue.js',
    'src/charts/bar-subsetter.js',
    'src/charts/series-math.js',
    'src/charts/lead-lag.js',
    'src/charts/lead-lag-engine.js',
    'src/charts/lead-lag.worker.js',
    'src/ingestion/zip-reader.js',
    'src/ingestion/csv-parser.js',
    'src/data/packed-trade-rows.js',
    'src/data/day-aggregator.js'
  ];
  const shellMatch = /const SHELL = \[([\s\S]*?)\];/.exec(serviceWorker);
  assert.ok(shellMatch, 'service worker must declare its precache shell');
  const shellPaths = new Set(
    [...shellMatch[1].matchAll(/new URL\(['"]([^'"]+)['"],\s*ROOT\)/g)]
      .map(match => match[1].replace(/^\.\//, ''))
  );

  const leadLagEngineSource = readFileSync(resolve(repoRoot, 'src/charts/lead-lag-engine.js'), 'utf8');
  assert.match(leadLagEngineSource, /new URL\(['"]\.\/lead-lag\.worker\.js['"],\s*import\.meta\.url\)/);
  assert.ok(shellPaths.has('src/charts/lead-lag.worker.js'), 'lead/lag worker must be available offline');

  for (const shellPath of shellPaths) {
    if (!shellPath) continue;
    assert.ok(existsSync(resolve(repoRoot, shellPath)), `service worker precaches missing path: ${shellPath}`);
  }

  for (const sourceFile of sourceFiles) {
    const source = readFileSync(resolve(repoRoot, sourceFile), 'utf8');
    for (const match of source.matchAll(/\bfrom\s+['"]([.]{1,2}\/[^'"]+)['"]/g)) {
      const specifier = match[1];
      const targetPath = fileURLToPath(new URL(specifier, new URL(sourceFile, new URL('../', import.meta.url))));
      assert.ok(existsSync(targetPath), `${sourceFile} imports missing module ${specifier}`);
      const relativePath = relative(repoRoot, targetPath).split(sep).join('/');
      assert.ok(shellPaths.has(relativePath), `${sourceFile} imports ${relativePath}, but it is missing from the service-worker precache`);
    }
  }
});


test('mobile quick-action controller wires import, charts, replay, and filters', () => {
  const buttons = ['import', 'charts', 'replay', 'filters'].map(action => {
    let clickHandler = null;
    const attributes = {};
    return {
      dataset: { mobileAction: action },
      addEventListener(type, handler) { if (type === 'click') clickHandler = handler; },
      removeEventListener(type, handler) { if (type === 'click' && clickHandler === handler) clickHandler = null; },
      trigger() { clickHandler?.(); },
      setAttribute(name, value) { attributes[name] = value; },
      getAttribute(name) { return attributes[name] ?? null; }
    };
  });
  const [importButton, chartsButton, replayButton, filtersButton] = buttons;
  const bar = { querySelectorAll: selector => selector === '[data-mobile-action]' ? buttons : [] };
  const scrolls = [];
  const scrollTarget = name => ({ name, scrollIntoView(options) { scrolls.push({ name, options }); } });
  const chartCard = scrollTarget('chart-card');
  let plot = null;
  const plotElement = { closest: selector => selector === '.chartcard' ? chartCard : null };
  const replayTarget = scrollTarget('replay');
  const controlsTarget = scrollTarget('controls');
  let advancedOpen = false;
  const documentRef = {
    body: { classList: { contains: name => name === 'show-advanced' && advancedOpen } },
    querySelector(selector) {
      if (selector === '.chartcard:not(.panel-hidden) .plot') return plot;
      if (selector === '.sectionhead') return scrollTarget('sectionhead');
      if (selector === '.replay-box') return replayTarget;
      if (selector === '.controls') return controlsTarget;
      return null;
    }
  };
  const scheduled = [];
  const windowRef = {
    matchMedia: () => ({ matches: true }),
    setTimeout(callback, delay) { scheduled.push({ callback, delay }); }
  };
  let importRunning = false;
  let pickerClicks = 0;
  let cancelRequests = 0;
  let presets = [];
  let resizeCalls = 0;
  const advancedToggle = { click() { advancedOpen = !advancedOpen; } };

  const dispose = bindMobileQuickActions({
    bar, documentRef, windowRef,
    isImportRunning: () => importRunning,
    requestImportCancel: () => { cancelRequests++; },
    fileInput: { click() { pickerClicks++; } },
    applyQuestionPreset: (...args) => { presets.push(args); plot = plotElement; },
    resizeStudioCharts: () => { resizeCalls++; },
    advancedToggle
  });

  importButton.trigger();
  assert.equal(pickerClicks, 1);
  importRunning = true;
  importButton.trigger();
  assert.equal(cancelRequests, 1);
  assert.equal(pickerClicks, 1);

  chartsButton.trigger();
  assert.deepEqual(presets, [['price-flow', true]]);
  assert.ok(scrolls.some(item => item.name === 'chart-card'));
  assert.equal(scheduled[0].delay, 180);
  scheduled[0].callback();
  assert.equal(resizeCalls, 1);

  replayButton.trigger();
  assert.ok(scrolls.some(item => item.name === 'replay'));

  filtersButton.trigger();
  assert.equal(filtersButton.getAttribute('aria-expanded'), 'true');
  assert.ok(scrolls.some(item => item.name === 'controls'));
  assert.ok(scrolls.every(item => item.options.behavior === 'auto'));

  dispose();
  chartsButton.trigger();
  assert.equal(presets.length, 1, 'disposal removes the click listeners');
});


test('chart render queue keeps only the newest pending request per chart', async () => {
  let releaseFirst;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  const rendered = [];
  const afterRendered = [];
  const queue = createLatestRenderQueue({
    async render(_key, _target, request) {
      rendered.push(request.value);
      if (request.value === 1) await firstGate;
    },
    afterRender(_key, _target, request) { afterRendered.push(request.value); }
  });
  const target = {};
  const first = queue.enqueue('priceChart', target, { value: 1 });
  const second = queue.enqueue('priceChart', target, { value: 2 });
  const third = queue.enqueue('priceChart', target, { value: 3 });
  assert.deepEqual(rendered, [1]);
  releaseFirst();
  await Promise.all([first, second, third]);
  assert.deepEqual(rendered, [1, 3]);
  assert.deepEqual(afterRendered, [1, 3]);
});

test('chart render queue rejects a terminal render error and recovers for the next request', async () => {
  const rendered = [];
  const queue = createLatestRenderQueue({
    async render(_key, _target, request) {
      rendered.push(request.value);
      if (request.value === 'bad') throw new Error('synthetic render failure');
    }
  });
  await assert.rejects(queue.enqueue('flowChart', {}, { value: 'bad' }), /synthetic render failure/);
  await queue.enqueue('flowChart', {}, { value: 'good' });
  assert.deepEqual(rendered, ['bad', 'good']);
});


function makeBarSeries(records) {
  const fields = ['t', 'o', 'h', 'l', 'c', 'v', 'n', 'b', 's', 'd', 'pv'];
  return Object.fromEntries(fields.map(field => [field, records.map(record => record[field])]));
}

function sampleBars(times) {
  return makeBarSeries(times.map((t, i) => ({
    t, o: 100 + i, h: 101 + i, l: 99 + i, c: 100 + i,
    v: i + 1, n: i + 1, b: i + 2, s: i, d: 2,
    pv: (100 + i) * (i + 1)
  })));
}

test('bar subsetter applies inclusive time bounds and can invalidate cached data', () => {
  let bars = { '1m': sampleBars([0, 60, 120, 180, 240]) };
  const subsetter = createBarSubsetter({ getBars: () => bars, barSteps: { '1m': 60 }, maxRenderPoints: 10 });
  const window = { s: 60, e: 180 };
  const first = subsetter.subsetBars('1m', window);
  assert.deepEqual(first.ids, [1, 2, 3]);
  assert.equal(first.sourceLo, 1);
  assert.equal(first.sourceHi, 4);
  assert.equal(first.compressed, false);
  assert.strictEqual(subsetter.subsetBars('1m', window), first);

  const replacement = sampleBars([100, 160, 220, 280, 340]);
  bars = { '1m': replacement };
  assert.strictEqual(subsetter.subsetBars('1m', window), first, 'cached data is reused until explicitly invalidated');
  subsetter.clearCache();
  const refreshed = subsetter.subsetBars('1m', window);
  assert.notStrictEqual(refreshed, first);
  assert.strictEqual(refreshed.source, replacement);
  assert.deepEqual(refreshed.ids, [0, 1]);
});

test('bar subsetter downsamples while preserving OHLCV, trade counts and price-volume sums', () => {
  const source = sampleBars([0, 60, 120, 180, 240, 300]);
  const subsetter = createBarSubsetter({ getBars: () => ({ '1m': source }), barSteps: { '1m': 60 }, maxRenderPoints: 2 });
  const result = subsetter.subsetBars('1m', { s: 0, e: 300 });
  assert.equal(result.compressed, true);
  assert.equal(result.groupSize, 3);
  assert.deepEqual(result.x.t, [120, 300]);
  assert.deepEqual(result.x.o, [100, 103]);
  assert.deepEqual(result.x.h, [103, 106]);
  assert.deepEqual(result.x.l, [99, 102]);
  assert.deepEqual(result.x.c, [102, 105]);
  assert.deepEqual(result.x.v, [6, 15]);
  assert.deepEqual(result.x.n, [6, 15]);
  assert.deepEqual(result.x.b, [9, 18]);
  assert.deepEqual(result.x.s, [3, 12]);
  assert.deepEqual(result.x.d, [6, 6]);
  assert.deepEqual(result.x.pv, [608, 1562]);
  assert.deepEqual(result.ends, [2, 5]);
  assert.deepEqual(result.ids, [0, 1]);
});

test('bar subsetter preserves gaps and midnight boundaries when grouping long ranges', () => {
  const times = [0, 60, 600, 660, 86340, 86400, 86460, 86520];
  const source = sampleBars(times);
  const subsetter = createBarSubsetter({ getBars: () => ({ '1m': source }), barSteps: { '1m': 60 }, maxRenderPoints: 2 });
  const result = subsetter.subsetBars('1m', { s: 0, e: 86520 });
  assert.equal(result.compressed, true);
  assert.deepEqual(result.x.t, [60, 660, 86340, 86520]);
  assert.deepEqual(result.x.v, [3, 7, 5, 21]);
  assert.deepEqual(result.breakBefore, [false, true, true, false]);
  assert.equal(result.x.t[2] < 86400, true, 'a group must not merge across the midnight boundary');
  assert.equal(result.x.t[3] >= 86400, true);
});

test('bar subsetter keeps its cache within the configured size limit', () => {
  const source = sampleBars([0, 60, 120, 180]);
  const subsetter = createBarSubsetter({ getBars: () => ({ '1m': source }), barSteps: { '1m': 60 }, maxRenderPoints: 10, cacheLimit: 2 });
  subsetter.subsetBars('1m', { s: 0, e: 0 });
  subsetter.subsetBars('1m', { s: 60, e: 60 });
  subsetter.subsetBars('1m', { s: 120, e: 120 });
  assert.equal(subsetter.cacheSize, 2);
  assert.deepEqual(subsetter.subsetBars('1m', { s: 60, e: 60 }).ids, [1]);
  assert.equal(subsetter.cacheSize, 2);
});

test('bar subsetter reports a missing timeframe with a readable error', () => {
  const subsetter = createBarSubsetter({ getBars: () => ({}), barSteps: { '1m': 60 } });
  assert.throws(() => subsetter.subsetBars('1m', { s: 0, e: 60 }), /No bar series is available/);
});


test('chart series math keeps rolling imbalance separate across data gaps', () => {
  const math = createChartSeriesMath({ toTimestamp: value => value * 1000 });
  const delta = [2, -1, 3, 1];
  const volume = [4, 2, 6, 2];
  const times = [0, 60, 600, 660];
  const result = math.rollingRatio(delta, volume, 2, times, 60);
  assert.equal(result.length, 4);
  assert.equal(result[0], 50);
  assert.ok(Math.abs(result[1] - (1 / 6 * 100)) < 1e-10);
  assert.equal(result[2], 50);
  assert.equal(result[3], 50);
});

test('chart series math maps compressed rolling imbalance to source group endpoints', () => {
  const math = createChartSeriesMath({ toTimestamp: value => value * 1000 });
  const source = makeBarSeries([
    { t: 0, o: 1, h: 1, l: 1, c: 1, v: 4, n: 1, b: 3, s: 1, d: 2, pv: 4 },
    { t: 60, o: 1, h: 1, l: 1, c: 1, v: 2, n: 1, b: 0, s: 1, d: -1, pv: 2 },
    { t: 600, o: 1, h: 1, l: 1, c: 1, v: 6, n: 1, b: 5, s: 2, d: 3, pv: 6 },
    { t: 660, o: 1, h: 1, l: 1, c: 1, v: 2, n: 1, b: 2, s: 1, d: 1, pv: 2 }
  ]);
  const subset = { source, sourceLo: 0, sourceHi: 4, step: 60, compressed: true, ends: [1, 3] };
  const result = math.subsetRollingRatio(subset, 2);
  assert.equal(result.length, 2);
  assert.ok(Math.abs(result[0] - (1 / 6 * 100)) < 1e-10);
  assert.equal(result[1], 50);
});

test('chart line arrays insert null breaks at gaps and use the injected time converter', () => {
  const math = createChartSeriesMath({ toTimestamp: value => value * 1000 });
  const source = sampleBars([0, 60, 600]);
  const subset = { x: source, ids: [0, 1, 2], breakBefore: [false, false, true] };
  const result = math.lineArrays(subset, [10, 11, 12]);
  assert.deepEqual(result.x, [0, 60000, 330000, 600000]);
  assert.deepEqual(result.y, [10, 11, null, 12]);
});

test('EMA calculation resets across gaps and includes available historical warm-up', () => {
  const math = createChartSeriesMath({ toTimestamp: value => value * 1000 });
  const source = sampleBars([0, 60, 120, 180, 600, 660, 720]);
  source.c = [10, 12, 14, 16, 100, 102, 104];
  const subset = { source, sourceLo: 2, sourceHi: 7, ids: [2, 3, 4, 5, 6], compressed: false, step: 60 };
  const result = math.emaForSubset(subset, 2);
  assert.equal(result.length, 5);
  assert.ok(Math.abs(result[0] - 13.1111111111) < 1e-8);
  assert.ok(Math.abs(result[1] - 15.0370370370) < 1e-8);
  assert.equal(result[2], 100, 'EMA restarts after a sufficiently large timestamp gap');
  assert.ok(Math.abs(result[3] - 101.3333333333) < 1e-8);
  assert.ok(Math.abs(result[4] - 103.1111111111) < 1e-8);
});

test('trade-weighted price resets daily and identifies legacy HLC3 fallback', () => {
  const math = createChartSeriesMath({ toTimestamp: value => value * 1000 });
  const source = makeBarSeries([
    { t: 86340, o: 100, h: 110, l: 90, c: 100, v: 2, n: 1, b: 1, s: 1, d: 0, pv: 200 },
    { t: 86400, o: 200, h: 210, l: 190, c: 200, v: 4, n: 1, b: 3, s: 1, d: 2, pv: 800 },
    { t: 86460, o: 300, h: 310, l: 290, c: 300, v: 2, n: 1, b: 2, s: 0, d: 2, pv: 800 }
  ]);
  const subset = { source, sourceLo: 0, sourceHi: 3, ids: [0, 1, 2], compressed: false };
  const exact = math.tradeWeightedAverageForSubset(subset);
  assert.equal(exact.exact, true);
  assert.deepEqual(exact.values, [100, 200, 800 / 3]);

  const legacySource = makeBarSeries([
    { t: 0, o: 100, h: 110, l: 90, c: 100, v: 2, n: 1, b: 1, s: 1, d: 0, pv: null }
  ]);
  const legacy = math.tradeWeightedAverageForSubset({ source: legacySource, sourceLo: 0, sourceHi: 1, ids: [0], compressed: false });
  assert.equal(legacy.exact, false);
  assert.deepEqual(legacy.values, [100]);
});

test('chart series math rejects missing time converters and invalid EMA periods', () => {
  assert.throws(() => createChartSeriesMath(), /requires a toTimestamp function/);
  const math = createChartSeriesMath({ toTimestamp: value => value });
  assert.throws(() => math.emaForSubset({ source: sampleBars([0]), sourceLo: 0, sourceHi: 1, ids: [0], step: 60 }, 0), /EMA period must be positive/);
});


test('median ignores missing values and handles odd/even samples', () => {
  const math = createChartSeriesMath({ toTimestamp: value => value });
  assert.equal(math.median([3, 1, 2]), 2);
  assert.equal(math.median([8, null, 2, 4, 6]), 5);
  assert.equal(math.median([null, NaN, Infinity]), null);
});

test('Pearson correlation handles positive, negative, invalid and degenerate samples', () => {
  const math = createChartSeriesMath({ toTimestamp: value => value });
  assert.equal(math.pearson([1, 2, 3, 4], [2, 4, 6, 8]), 1);
  assert.equal(math.pearson([1, 2, 3, 4], [8, 6, 4, 2]), -1);
  assert.equal(math.pearson([1, 2, 3, NaN], [2, 4, 6, 100]), 1);
  assert.equal(math.pearson([1, 1, 1], [2, 3, 4]), null);
  assert.equal(math.pearson([1, 2], [2, 4]), null);
});


function makeLeadLagBars(times = Array.from({ length: 16 }, (_, i) => i * 60)) {
  return {
    t: times,
    c: times.map((_, i) => 100 + [0, 1, -1, 3, 2, 5, 4, 7, 5, 8, 6, 9, 8, 11, 10, 13][i % 16]),
    d: times.map((_, i) => [2, -1, 3, 1, -2, 4, -1, 2, 5, -3, 1, 4, -2, 3, -1, 2][i % 16]),
    v: times.map((_, i) => [4, 2, 6, 3, 5, 8, 4, 7, 9, 5, 3, 8, 4, 6, 5, 7][i % 16])
  };
}

test('lead-lag calculator enforces exact minute horizons and requested time bounds', () => {
  const bars = makeLeadLagBars();
  const calculator = createLeadLagCalculator();
  assert.equal(calculator.setData(bars), 16);
  assert.equal(calculator.length, 16);
  const result = calculator.compute({ start: 120, end: 600, lookback: 3 });
  assert.deepEqual(result.horizons, ['Same bar', '+1m', '+5m', '+15m', '+30m', '+60m']);
  assert.deepEqual(result.counts, [9, 8, 4, 0, 0, 0]);
  assert.equal(result.forwardSamples, 12);
  assert.ok(result.correlations.slice(0, 3).every(value => value === null || Number.isFinite(value)));
});

test('lead-lag calculator does not build lookback windows across missing minutes', () => {
  const bars = makeLeadLagBars([0, 60, 120, 600, 660, 720, 780, 840]);
  const calculator = createLeadLagCalculator();
  calculator.setData(bars);
  const result = calculator.compute({ start: 0, end: 840, lookback: 3 });
  assert.equal(result.counts[0], 4);
  assert.equal(result.counts[1], 2);
  assert.equal(result.counts[2], 0);
});

test('worker-disabled lead-lag engine returns the same result as the calculator', async () => {
  const bars = makeLeadLagBars();
  const engine = createLeadLagEngine({ workerFactory: () => null });
  engine.setData(bars);
  assert.equal(engine.workerActive, false);
  const options = { start: 60, end: 600, lookback: 2 };
  assert.deepEqual(await engine.compute(options), computeLeadLag(bars, options));
  engine.dispose();
});

test('lead-lag engine sends data once and accepts worker results', async () => {
  class FakeWorker {
    constructor() { this.onmessage = null; this.onerror = null; this.onmessageerror = null; this.calculator = createLeadLagCalculator(); this.revision = 0; this.messages = []; }
    postMessage(message) {
      this.messages.push(message);
      if (message.type === 'set-data') {
        this.calculator.setData(message.bars);
        this.revision = message.revision;
        queueMicrotask(() => this.onmessage?.({ data: { type: 'ready', revision: this.revision } }));
        return;
      }
      if (message.type === 'compute') {
        queueMicrotask(() => {
          try {
            const result = this.calculator.compute(message);
            this.onmessage?.({ data: { id: message.id, revision: this.revision, result } });
          } catch (error) {
            this.onmessage?.({ data: { id: message.id, revision: this.revision, error: error.message } });
          }
        });
      }
    }
    terminate() { this.terminated = true; }
  }
  let fakeWorker;
  const engine = createLeadLagEngine({ workerFactory: () => (fakeWorker = new FakeWorker()), maxMainThreadBars: 0 });
  const bars = makeLeadLagBars();
  engine.setData(bars);
  const options = { start: 60, end: 600, lookback: 2 };
  const result = await engine.compute(options);
  assert.deepEqual(result, computeLeadLag(bars, options));
  assert.equal(fakeWorker.messages.filter(message => message.type === 'set-data').length, 1);
  assert.equal(fakeWorker.messages.filter(message => message.type === 'compute').length, 1);
  assert.equal(engine.workerActive, true);
  engine.dispose();
  assert.equal(fakeWorker.terminated, true);
});

test('lead-lag engine falls back to the main thread when a worker fails', async () => {
  class FailingWorker {
    postMessage(message) {
      if (message.type === 'compute') queueMicrotask(() => this.onerror?.(new Error('synthetic worker failure')));
    }
    terminate() { this.terminated = true; }
    onmessage = null;
    onerror = null;
    onmessageerror = null;
  }
  let worker;
  const engine = createLeadLagEngine({ workerFactory: () => (worker = new FailingWorker()), maxMainThreadBars: 0 });
  const bars = makeLeadLagBars();
  engine.setData(bars);
  const options = { start: 60, end: 600, lookback: 2 };
  const result = await engine.compute(options);
  assert.deepEqual(result, computeLeadLag(bars, options));
  assert.equal(engine.workerActive, false);
  assert.equal(worker.terminated, true);
});

test('lead-lag engine times out a silent worker and falls back', async () => {
  class SilentWorker {
    constructor() { this.onmessage = null; this.onerror = null; this.onmessageerror = null; this.computeMessages = 0; }
    postMessage(message) { if (message.type === 'compute') this.computeMessages++; }
    terminate() { this.terminated = true; }
  }
  let worker;
  const engine = createLeadLagEngine({ workerFactory: () => (worker = new SilentWorker()), timeoutMs: 20, maxMainThreadBars: 0 });
  const bars = makeLeadLagBars();
  engine.setData(bars);
  const options = { start: 60, end: 600, lookback: 2 };
  assert.deepEqual(await engine.compute(options), computeLeadLag(bars, options));
  assert.equal(worker.computeMessages, 1);
  assert.equal(worker.terminated, true);
  assert.equal(engine.workerActive, false);
  assert.equal(engine.lastMode, 'fallback');
  engine.dispose();
});

test('lead-lag engine recreates a worker after a transient failure', async () => {
  class FlakyWorker {
    constructor() {
      this.onmessage = null; this.onerror = null; this.onmessageerror = null;
      this.calculator = createLeadLagCalculator(); this.revision = 0; this.failNextCompute = true;
    }
    postMessage(message) {
      if (message.type === 'set-data') {
        this.calculator.setData(message.bars); this.revision = message.revision;
        queueMicrotask(() => this.onmessage?.({ data: { type: 'ready', revision: this.revision } }));
        return;
      }
      if (message.type !== 'compute') return;
      if (this.failNextCompute) {
        this.failNextCompute = false;
        queueMicrotask(() => this.onerror?.(new Error('synthetic transient failure')));
        return;
      }
      queueMicrotask(() => {
        const result = this.calculator.compute(message);
        this.onmessage?.({ data: { id: message.id, revision: this.revision, result } });
      });
    }
    terminate() { this.terminated = true; }
  }
  const workers = [];
  const engine = createLeadLagEngine({
    workerFactory: () => {
      const worker = new FlakyWorker();
      worker.failNextCompute = workers.length === 0;
      workers.push(worker);
      return worker;
    },
    maxMainThreadBars: 0
  });
  const bars = makeLeadLagBars();
  const options = { start: 60, end: 600, lookback: 2 };
  engine.setData(bars);
  assert.deepEqual(await engine.compute(options), computeLeadLag(bars, options));
  assert.equal(engine.workerActive, false);
  assert.equal(workers[0].terminated, true);

  engine.setData(bars);
  assert.deepEqual(await engine.compute(options), computeLeadLag(bars, options));
  assert.equal(workers.length, 2);
  assert.equal(engine.workerActive, true);
  assert.equal(engine.lastMode, 'worker');
  engine.dispose();
});

test('lead-lag engine rejects a stale worker revision and uses local data', async () => {
  class StaleWorker {
    constructor() { this.onmessage = null; this.onerror = null; this.onmessageerror = null; }
    postMessage(message) {
      if (message.type === 'set-data') {
        queueMicrotask(() => this.onmessage?.({ data: { type: 'ready', revision: message.revision } }));
        return;
      }
      if (message.type === 'compute') {
        queueMicrotask(() => this.onmessage?.({ data: { id: message.id, revision: message.revision - 1, result: { counts: [999] } } }));
      }
    }
    terminate() { this.terminated = true; }
  }
  const engine = createLeadLagEngine({ workerFactory: () => new StaleWorker(), maxMainThreadBars: 0 });
  const bars = makeLeadLagBars();
  engine.setData(bars);
  const options = { start: 60, end: 600, lookback: 2 };
  assert.deepEqual(await engine.compute(options), computeLeadLag(bars, options));
  assert.equal(engine.workerActive, true);
  engine.dispose();
});

test('lead-lag engine keeps small windows on the main thread and honors the adaptive threshold', async () => {
  class CountingWorker {
    constructor() { this.onmessage = null; this.onerror = null; this.onmessageerror = null; this.calculator = createLeadLagCalculator(); this.revision = 0; this.computeMessages = 0; }
    postMessage(message) {
      if (message.type === 'set-data') {
        this.calculator.setData(message.bars); this.revision = message.revision;
        queueMicrotask(() => this.onmessage?.({ data: { type: 'ready', revision: this.revision } }));
        return;
      }
      if (message.type === 'compute') {
        this.computeMessages++;
        queueMicrotask(() => this.onmessage?.({ data: { id: message.id, revision: this.revision, result: this.calculator.compute(message) } }));
      }
    }
    terminate() { this.terminated = true; }
  }
  let worker;
  const engine = createLeadLagEngine({ workerFactory: () => (worker = new CountingWorker()) });
  const bars = makeLeadLagBars();
  engine.setData(bars);
  const options = { start: 60, end: 600, lookback: 2 };
  assert.deepEqual(await engine.compute(options), computeLeadLag(bars, options));
  assert.equal(worker.computeMessages, 0);
  assert.equal(engine.lastMode, 'main');

  const forced = createLeadLagEngine({ workerFactory: () => (worker = new CountingWorker()), maxMainThreadBars: 0 });
  forced.setData(bars);
  assert.deepEqual(await forced.compute(options), computeLeadLag(bars, options));
  assert.equal(worker.computeMessages, 1);
  assert.equal(forced.lastMode, 'worker');
  engine.dispose();
  forced.dispose();
});

test('lead-lag engine resolves pending work and rejects new work after dispose', async () => {
  class SilentWorker {
    constructor() { this.onmessage = null; this.onerror = null; this.onmessageerror = null; }
    postMessage() {}
    terminate() { this.terminated = true; }
  }
  const engine = createLeadLagEngine({ workerFactory: () => new SilentWorker(), timeoutMs: 1000, maxMainThreadBars: 0 });
  const bars = makeLeadLagBars();
  engine.setData(bars);
  const options = { start: 60, end: 600, lookback: 2 };
  const pending = engine.compute(options);
  engine.dispose();
  assert.deepEqual(await pending, computeLeadLag(bars, options));
  await assert.rejects(engine.compute(options), /data has not been loaded/);
});
