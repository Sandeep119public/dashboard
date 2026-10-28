import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../BTCUSD_Market_Mechanics_Lab_Fixed.html', import.meta.url), 'utf8');
const start = html.indexOf('async function zipCsvEntries(file){');
const end = html.indexOf('async function zipEntryStream(file,entry){', start);
assert.ok(start >= 0 && end > start, 'ZIP directory parser must remain available for regression tests');
const zipCsvEntries = new Function(`${html.slice(start, end)}; return zipCsvEntries;`)();
const streamStart = html.indexOf('async function zipEntryStream(file,entry){');
const streamEnd = html.indexOf('\nfunction syncImportControls()', streamStart);
assert.ok(streamStart >= 0 && streamEnd > streamStart, 'ZIP entry stream reader must remain available for regression tests');
const zipEntryStream = new Function(`${html.slice(streamStart, streamEnd)}; return zipEntryStream;`)();
const rowsStart = html.indexOf('class PackedTradeRows {');
const rowsEnd = html.indexOf('function aggregateDay(', rowsStart);
assert.ok(rowsStart >= 0 && rowsEnd > rowsStart, 'packed trade buffer must remain available for regression tests');
const PackedTradeRows = new Function(`${html.slice(rowsStart, rowsEnd)}; return PackedTradeRows;`)();

function makeZip({ name = 'trades.csv', localName = name, comment = Buffer.alloc(0), data = 'timestamp,price,size,buyer_role,product_symbol\\n2026-08-01 00:00:00,60000,1,taker,BTCUSD\\n' } = {}) {
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
  local.writeUInt16LE(filename.length, 26);
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
